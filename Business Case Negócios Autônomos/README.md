# Business Case — Negócios autônomos em Porto Velho (RO)

Estudo de negócios 100% (ou quase) autônomos para Porto Velho. A comparação usa sempre um fluxo de caixa de 5 anos, para que todos os casos sejam comparáveis.

## Etapa 2 — Planilha com 34 business cases

- **Arquivo:** [`Negocios_Autonomos_PVH.xlsx`](Negocios_Autonomos_PVH.xlsx). Tem 40 abas: Capa, Instruções, Premissas, Painel, Sensibilidade, Checks e uma aba por negócio (BC01 a BC34).
- **Resultados:** [`RESULTADOS.md`](RESULTADOS.md) traz o ranking dos 34 negócios, com TIR nos quatro cenários, VPL, payback, ROI, margem de segurança, a visão "do bolso" e a TIR do acionista com financiamento.
- **Premissas do investidor:**
  - capital de R$ 250–600 mil;
  - financiamento opcional (FNO/Pronampe);
  - sem terreno: toda área é arrendada;
  - horas humanas por semana entram como premissa em cada aba.

### Como usar
1. **Premissas:** revise as entradas globais (TMA real de 15%, custo da hora, tarifa de energia, aluguéis, condições do financiamento).
2. **Painel:** leia o comparativo e o ranking. O código de cada negócio abre a aba dele.
3. **Aba BC:** ajuste as células azuis. O quadro do topo mostra os indicadores em quatro cenários: Pessimista, Base, Otimista e Estresse global.
4. **Sensibilidade:** estresse todos os negócios ao mesmo tempo. A Tabela de Dados cruza demanda × preço para o negócio escolhido.
5. **Checks:** confira o status de cada aba.

### Código de cores
O mesmo do Business Case Pecuária:

| Estilo | Significado |
|---|---|
| Fonte azul em fundo amarelo-claro | Entrada |
| Fundo amarelo forte | Premissa-chave |
| Fonte preta | Fórmula da própria aba |
| Fonte verde | Vínculo com outra aba |
| Fundo cinza | Total ou auxiliar |
| Fundo verde-claro | Resultado do cenário Base |

No Painel, a TIR fica verde se ≥ TMA, amarela entre o Tesouro IPCA+ e a TMA, e vermelha abaixo do Tesouro.

### Motor (igual em todas as abas)
- **Receita:** receita madura × rampa de maturação (com atraso por cenário) × demanda × preço.
- **Custos variáveis:**
  - energia, água e insumos/CMV seguem o volume;
  - pagamentos, royalties, repasses e comissões seguem a receita.
- **Custos fixos e tributos:**
  - custos fixos mensais;
  - tempo humano: horas/semana × 52 × R$/h;
  - perda esperada com sinistros;
  - Simples Nacional por faixa (Anexos I, II, III e III sem ISS) ou alíquota fixa.
- **Fluxo de caixa:**
  - FCL = EBITDA − manutenção do capex;
  - valor residual no ano 5 = o maior entre liquidar os ativos e continuar operando (com deságio de liquidez);
  - financiamento SAC em termos reais.
- **Indicadores:**
  - VPL, TIR, TIR nominal, TIRM, TIR do acionista;
  - payback simples e descontado, ROI de 5 anos, MOIC;
  - exposição de caixa, dependência do valor residual;
  - margem de segurança da demanda, ponto de equilíbrio e veredito.

### Gerador e verificação (`gerador/`)

| Arquivo | Papel |
|---|---|
| `casos_a.py`, `casos_b.py` (`casos.py` junta os dois) | Os 34 negócios: tese, premissas com fonte, capex, custos, cenários |
| `aba_caso.py` | Desenho e fórmulas de cada aba de negócio |
| `premissas_globais.py` | Abas Premissas (com as tabelas do Simples) e Sensibilidade |
| `saidas.py` | Painel, ranking, gráfico, Tabela de Dados, Checks, Capa e Instruções |
| `build.py` | Monta a planilha |
| `referencia.py` | A mesma lógica em Python, independente do Excel |
| `verificar.py` | Compara a planilha recalculada no LibreOffice com a referência, célula a célula, e procura erros de fórmula |
| `resumo.py` | Gera `RESULTADOS.md` |

```bash
pip install openpyxl numpy
cd gerador
python3 build.py                       # grava ../Negocios_Autonomos_PVH.xlsx
python3 resumo.py                      # grava ../RESULTADOS.md
# verificação (precisa do LibreOffice):
LO_VERIFY=1 python3 build.py /tmp/verif.xlsx
soffice --headless --calc --convert-to xlsx --outdir /tmp/lo /tmp/verif.xlsx
python3 verificar.py /tmp/lo/verif.xlsx
```

Última verificação: 0 células com erro; 2.018 indicadores iguais à referência (diferença máxima de 5×10⁻¹⁴); Tabela de Dados e ranking conferidos.

Mudanças de premissa se fazem no Excel. Mudanças de estrutura (novas linhas ou negócios) se fazem no código. O arquivo gerado é recalculado pelo Excel ao abrir.

## Etapa 1 — Triagem e stress test (`triagem/`)

- **Relatório:** [`triagem/STRESS_TEST.md`](triagem/STRESS_TEST.md). Traz o método, os fatos de Porto Velho, a long list de 35 ideias, o Monte Carlo e as alavancas.
- **Código:** `triagem/` (motor, Monte Carlo, gráficos). Regerar com `python3 gerar_saidas.py`.
