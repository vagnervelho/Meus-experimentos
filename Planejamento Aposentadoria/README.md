# Simulador de Aposentadoria — médica PJ (Porto Velho × Campinas)

Modelo em Excel que responde: **ela consegue se aposentar aos 65 anos com renda líquida de R$ 32.400 por mês, em poder de compra de hoje?** Se a resposta for não, o modelo mostra quanto falta e quais premissas mais pesam.

- **Arquivo principal:** `Simulador_Aposentadoria.xlsx`
- **Horizonte:** mensal, de dez/2026 até os 100 anos dela (816 meses), em valores nominais com colunas em R$ de hoje
- **Sem macros:** só fórmulas e Tabelas de Dados nativas do Excel
- **Calibração:** Boletim Focus de 09/11/2026, legislação de 2026 (Simples, IRPF, INSS) e preços de Porto Velho e Campinas de nov/2026

## Como usar

1. Abra `Simulador_Aposentadoria.xlsx` no Excel (2016 ou mais recente).
2. Na aba `Premissas`, edite somente as células amarelas com fonte azul.
   - Preencha o patrimônio financeiro atual, que está zerado.
   - Confira os itens marcados **VALIDAR**.
   - Escolha a cidade (Porto Velho ou Campinas) na seção 2.
3. Leia o resultado no topo da aba `Premissas`, no `Painel` e na aba `Aposentadoria`. Os alertas ficam na aba `Checks`.
4. Na aba `Cenarios`, compare os 12 cenários prontos pelo seletor `D4` (1 = caso base).
5. Pressione **F9** para atualizar o tornado e as tabelas de sensibilidade. O arquivo vem em "Automático, exceto Tabelas de Dados" para não ficar lento a cada digitação.

## Código de cores

| Aparência | Significado |
|---|---|
| Fonte azul, fundo amarelo-claro | Entrada editável |
| Fundo amarelo mais forte | Premissa-chave |
| Fonte preta | Fórmula com dados da própria aba |
| Fonte verde | Fórmula que busca dado em outra aba |
| Fundo cinza | Cálculo, total ou área de Tabela de Dados (não editar) |
| Fundo verde-claro | Resultado em destaque |

Cor das guias: amarelo = entradas, verde = saídas, cinza = motores de cálculo, vermelho = controle.

## Estrutura das abas

| Aba | Tipo | Conteúdo |
|---|---|---|
| `Premissas` | Entrada | Todas as entradas, em 12 seções, com o resultado resumido no topo |
| `Painel` | Saída | Veredito, indicadores, gráficos e as premissas que mais pesam |
| `Fluxo_Mensal` | Saída | Fluxo de caixa dela mês a mês: entradas, saídas, sobra e patrimônio |
| `Resumo_Anual` | Saída | Fluxo de caixa por ano, nominal e em R$ de hoje |
| `Aposentadoria` | Saída | Capital necessário, renda sustentável, veredito, imóvel, marketing, INSS |
| `Cenarios` | Entrada/Saída | Alavancas, 12 cenários prontos, tornado e 17 tabelas de sensibilidade |
| `Renda` | Motor | Faturamento, Simples (Fator R) ou Lucro Presumido, INSS, IR, marketing e salário-maternidade |
| `Moradia` | Motor | Aluguel, custos do lar, compra do imóvel, financiamento SAC/Price |
| `Familia` | Motor | Casamento, filhos por faixa etária, licença e plano de saúde |
| `Macro` | Motor | Calendário, idade, curva de CDI e IPCA, índices |
| `Checks` | Controle | 9 testes de integridade (ERRO) e 16 alertas de premissa (ALERTA) |
| `Instrucoes` | Apoio | Uso, fórmulas, simplificações, glossário e fontes |

## Lógica central

### Valores e taxas

- **R$ de hoje → nominal:** valor × I(t), onde I(t) = I(t−1) × (1 + IPCA mensal) e I = 1,00 em dez/2026.
- **Rendimento das aplicações:** CDI mensal × % do CDI × (1 − IR) − custódia.
- **Taxa real:** (1 + rendimento líquido) ÷ (1 + IPCA) − 1.
- O IR incide também sobre a parte do rendimento que só repõe a inflação. Com CDI de 10% e IPCA de 4%, o juro real cai de 5,8% para 4,3% ao ano.

### Capital necessário aos 65 (R$ de hoje)

- **Viver de rendimentos:** K = renda ÷ r_real.
- **Consumir até a idade-limite:** K = renda × [1 − (1 + r)^−N] ÷ r.
- Nos dois casos, renda = meta − INSS. O INSS só entra se a opção estiver ligada na seção 9.

### Veredito e ação

- **Veredito:** renda sustentável = patrimônio aos 65 × r_real + INSS. Atinge a meta se a renda sustentável for ≥ 100% da meta.
- **Aporte extra:** lacuna ÷ fator de capitalização. É o valor mensal constante, em R$ de hoje, que fecha a lacuna se for poupado desde hoje.
- **Gasto pessoal máximo compatível com a meta** ≈ gasto pessoal atual − aporte extra.

### Tributos da PJ

- **Simples Nacional:** alíquota efetiva = (RBT12 × nominal − parcela) ÷ RBT12. Anexo III se o Fator R for ≥ 28%; abaixo disso, Anexo V.
- **Pró-labore:** INSS de 11% até o teto, mais IR pela tabela com a redução da Lei 15.270/2025.

### Cônjuge e saldo negativo

- **Despesas compartilhadas** (moradia, imóvel, filhos) são calculadas pelo total do casal. A parte dela é total × (1 − parcela do cônjuge).
- **Saldo negativo:** tratado como déficit acumulado, corrigido pela mesma taxa das aplicações. Assim o modelo mede quanto falta. O spread de crédito é opcional e pode ser ligado nas premissas.

## Resultado do caso base (premissas-padrão)

| Indicador | Valor |
|---|---|
| Veredito | **NÃO ATINGE** |
| Capital necessário aos 65 (viver de rendimentos) | R$ 9,28 milhões de hoje |
| Patrimônio financeiro projetado aos 65 | −R$ 2,26 milhões de hoje: o plano gera déficit depois da compra da casa |
| Aporte extra para atingir a meta | R$ 13,6 mil por mês, de hoje até os 65 |
| Renda líquida do trabalho hoje | R$ 25,4 mil por mês, com carga de 16% sobre o faturamento |

Leia antes de decidir: a seção 7 da aba `Instrucoes` lista as simplificações. Os itens marcados VALIDAR são estimativas que devem ser confirmadas com a realidade dela.

## Regerar a planilha

```bash
pip install openpyxl
python3 gerador/build.py                 # grava Simulador_Aposentadoria.xlsx nesta pasta
```

| Arquivo | Papel |
|---|---|
| `fw.py` | Framework: colunas com chave, templates de fórmula, estilos, Tabelas de Dados |
| `premissas.py` | Aba `Premissas`: entradas, tabelas da legislação e valores derivados |
| `motores.py` | Abas mensais `Macro`, `Renda`, `Familia`, `Moradia` e `Fluxo_Mensal` |
| `saidas.py` | `Aposentadoria`, `Resumo_Anual`, `Painel`, `Checks` e `Instrucoes` |
| `cenarios.py` | Alavancas, cenários prontos, tornado e tabelas de sensibilidade |
| `graficos.py` | Estilo dos gráficos |
| `build.py` | Montagem do arquivo |
| `replica.py` | Réplica independente do modelo em Python puro, usada para verificação |
| `verificar.py` | Recalcula no LibreOffice em 12 cenários e compara com a réplica; emula as Tabelas de Dados |

Verificação:

```bash
LO_VERIFY=1 python3 gerador/build.py /tmp/verif.xlsx
python3 gerador/verificar.py /tmp/verif.xlsx                               # 12 cenários × réplica
python3 gerador/verificar.py /tmp/verif.xlsx Simulador_Aposentadoria.xlsx  # emula as Tabelas de Dados
```

Para mudar uma premissa, edite direto no Excel. Mudanças de estrutura, como novas linhas, colunas ou abas, devem ser feitas no código, para manter as fórmulas consistentes. Um arquivo regerado só mostra os números depois de aberto e recalculado no Excel.
