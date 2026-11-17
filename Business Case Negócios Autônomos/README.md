# Business Case — Negócios autônomos em Porto Velho (RO)

Estudo de negócios 100% (ou quase) autônomos para Porto Velho. A comparação usa sempre um fluxo de caixa de 5 anos, para que todos os casos sejam comparáveis.

## Etapa 1 — Triagem e stress test (`triagem/`)

- **Relatório:** [`triagem/STRESS_TEST.md`](triagem/STRESS_TEST.md). Traz o resumo para decisão, o método, os fatos de Porto Velho, a long list de 35 ideias, os resultados, as finalistas e a proposta de abas da planilha.
- **Gráficos:** `triagem/resultados/retorno_x_autonomia.png` e `triagem/resultados/monte_carlo_vpl.png`.
- **Dados gerados:** `triagem/resultados/*.csv` e `tabelas.md`.

### Regerar

```bash
pip install numpy pandas matplotlib
cd triagem
python3 gerar_saidas.py     # caso-base, choques, Monte Carlo (neutro e estresse), alavancas, gráficos e tabelas
python3 alavancas.py        # só as alavancas das finalistas
```

| Arquivo | Papel |
|---|---|
| `motor.py` | Fluxo anual de 5 anos em moeda constante. Calcula VPL, TIR, TIRM, payback simples e descontado, ROI, MOIC, Simples Nacional por faixa (Anexos I, II, III e locação) e valor residual (maior entre liquidação e continuidade com deságio) |
| `premissas.py` | Premissas globais (TMA real de 15%, IPCA, custo da hora humana) e de cada ideia |
| `rodar.py` | Choques determinísticos, Monte Carlo neutro e de estresse, e o multiplicador de demanda, preço ou capex que zera o VPL |
| `alavancas.py` | Combinações de alavancas para as finalistas (ponto, preço, solar) |
| `graficos.py` / `gerar_saidas.py` | Gráficos e tabelas em markdown |

## Etapa 2 — Planilha de business cases

A fazer, depois da escolha das abas. Vai seguir o padrão de cores do modelo da pecuária: fonte azul com fundo amarelo-claro para entradas, preto para fórmulas, verde para links entre abas e verde-claro para resultados.
