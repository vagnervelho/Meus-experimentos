# Business Case — Pecuária de Corte em Rondônia

Modelo financeiro em Excel para planejar, do zero, um negócio de gado de corte: cria, recria, engorda (pasto, semiconfinamento, confinamento) e lavoura para ração (milho, silagem, soja), com ração produzida ou comprada.

- **Arquivo principal:** `Business_Case_Pecuaria.xlsx`
- **Horizonte:** 120 meses, mensal, em moeda constante (sem inflação)
- **Sem macros:** só fórmulas e Tabelas de Dados nativas do Excel
- **Calibração inicial:** Rondônia, ~100 ha, capital próprio de R$ 200 mil, pessoa física

## Como usar

1. Abra `Business_Case_Pecuaria.xlsx` no Excel (2016 ou mais recente).
2. Em `Cenarios!C4`, escolha o cenário (1 a 9). O cenário 9 é livre para montar a estratégia de vocês.
3. Ajuste as alavancas do cenário na aba `Cenarios` e as premissas na aba `Premissas` (somente células amarelas com fonte azul).
4. Leia o `Painel` e a aba `Checks`.
5. Compare estratégias na tabela do fim da aba `Cenarios` e teste a robustez na aba `Sensibilidade`.

Se o Excel ficar lento: Fórmulas > Opções de Cálculo > "Automático, exceto Tabelas de Dados", e F9 para atualizar as tabelas.

## Código de cores

| Aparência | Significado |
|---|---|
| Fonte azul, fundo amarelo-claro | Entrada editável |
| Fundo amarelo forte | Premissa-chave |
| Fonte preta | Fórmula com dados da própria aba |
| Fonte verde | Fórmula que busca dado em outra aba |
| Fundo cinza | Totais e áreas de Tabela de Dados (não editar) |
| Fundo verde-claro | Resultado em destaque |

Cor das guias: amarelo = entradas, cinza = motores de cálculo, verde = saídas, vermelho = controle.

## Estrutura das abas

| Aba | Tipo | Conteúdo |
|---|---|---|
| `Capa` | Início | Índice, legenda e status do modelo |
| `Instrucoes` | Início | Uso, lógica, glossário, simplificações e fontes |
| `Painel` | Saída | Indicadores-chave e gráficos do cenário ativo |
| `Cenarios` | Entrada | Seletor, alavancas por estratégia e comparação dos 9 cenários |
| `Premissas` | Entrada | Premissas técnicas, de preço, custo, investimento, crédito e tributos |
| `Sensibilidade` | Entrada/Saída | Choques, tornado e tabelas cruzadas |
| `Precos` | Motor | Preço = base × sazonalidade × ciclo × choque |
| `Rebanho` | Motor | Fluxo de cabeças e de peso, lotação, valor do rebanho |
| `Nutricao` | Motor | Balanço forrageiro e demanda de ração |
| `Lavoura` | Motor | Produção, estoque de grãos, produzir × comprar |
| `Operacional` | Motor | Receitas, deduções, compras e custos |
| `Capex` | Motor | Investimentos, reposição e depreciação |
| `Divida_Tributos` | Motor | Crédito rural e IRPF da atividade rural |
| `DRE` | Saída | Resultado gerencial mensal |
| `Fluxo_Caixa` | Saída | Caixa mensal, necessidade de aporte, fluxo descontado |
| `Balanco` | Saída | Balanço mensal (teste de integridade) |
| `Unidades` | Saída | Resultado por unidade de negócio com preço de transferência |
| `Resumo_Anual` | Saída | Demonstrações e indicadores por ano |
| `Retorno` | Saída | VPL, TIR, payback, exposição de caixa, indicadores físicos |
| `Checks` | Controle | Testes de integridade (ERRO) e alertas de premissa (ALERTA) |

Todas as abas mensais têm o mesmo desenho: coluna A rótulo, B unidade, C total, colunas E a DT = meses 1 a 120. As linhas com lógica menos óbvia têm comentário no rótulo.

## Princípios de modelagem

- **Unidades de negócio com preço de transferência a mercado.** Cria vende bezerro à recria, recria vende boi magro à engorda, lavoura vende milho e silagem ao rebanho. Cada unidade tem margem própria e a soma fecha com o EBITDA consolidado.
- **Terra separada da operação.** Cada unidade paga arrendamento imputado. O indicador "VPL incremental" compara o cenário com a alternativa de arrendar toda a área a terceiros.
- **Motor de lotes sem matriz.** Cada sistema tem uma linha de ganho acumulado; o peso de um lote é o peso de entrada mais o ganho acumulado desde a entrada, e ele sai quando atinge o peso-alvo.
- **Rebanho a valor de mercado.** A variação do valor do estoque entra no resultado gerencial; o balanço fecha todo mês.
- **Sem circularidade.** Falta de caixa vira "aporte adicional dos sócios", não empréstimo automático.
- **Valor terminal por liquidação**, não por perpetuidade.

## O que validar antes de decidir

Os números-padrão são pontos de partida. As premissas marcadas "VALIDAR" ou "Estimativa do modelador" na aba `Premissas` devem ser confirmadas na região: preços de arroba, bezerro, boi magro, matriz, milho, soja e insumos; produtividade do pasto; custos de cerca, curral e reforma de pastagem; valor de arrendamento; alíquotas e tabela do IRPF (com contador).

## Regerar a planilha

A planilha é produzida pelo código em `gerador/`:

```bash
pip install openpyxl
python3 gerador/build_model.py            # grava Business_Case_Pecuaria.xlsx nesta pasta
```

| Arquivo | Papel |
|---|---|
| `framework.py` | Linhas com chave, templates de fórmula, estilos |
| `inputs.py` | Abas `Cenarios`, `Sensibilidade` (alavancas) e `Premissas` |
| `engines.py` | Abas mensais de cálculo |
| `outputs.py` | `Retorno`, `Resumo_Anual`, Tabelas de Dados, `Painel`, `Checks` |
| `build_model.py` | Montagem, `Capa`, `Instrucoes` |

Mudanças de premissa se fazem direto no Excel. Mudanças de estrutura (novas linhas ou abas) devem ser feitas no código, para manter a consistência das fórmulas. Um arquivo regerado só mostra números depois de aberto e recalculado no Excel.
