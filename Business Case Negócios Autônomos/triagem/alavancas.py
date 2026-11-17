# -*- coding: utf-8 -*-
"""Alavancas: o que muda a TIR das finalistas (choques combinados, mesmo motor)."""
import pandas as pd
from motor import projetar
from premissas import IDEIAS, G

ALAVANCAS = {
    "lav": {
        "Solar 20 kWp no telhado (energia -50%, +R$ 55 mil)": dict(energia=0.50, capex=255 / 200),
        "Ponto em posto 24h (aluguel -40%, demanda +10%)": dict(fixo=0.82, demanda=1.10),
        "Preço R$ 18,50 (+9%)": dict(preco=1.09),
        "Solar + posto + preço": dict(energia=0.50, capex=255 / 200, fixo=0.82, demanda=1.10, preco=1.09),
    },
    "agg": {
        "Solar 16 kWp (energia -60%, +R$ 45 mil)": dict(energia=0.40, capex=315 / 270),
        "Ponto em posto/supermercado (demanda +15%)": dict(demanda=1.15),
        "Água a R$ 0,40/L e gelo a R$ 11 (+11%)": dict(preco=1.11),
        "Solar + ponto + preço": dict(energia=0.40, capex=315 / 270, demanda=1.15, preco=1.11),
    },
    "lvc": {
        "Uso 25% abaixo do plano em cada condomínio": dict(demanda=0.75),
        "Repasse ao condomínio 10% (em vez de 5%)": dict(_rec=0.12),
        "Preço R$ 15 por ciclo (+7%)": dict(preco=1.07),
    },
    "qud": {
        "Ocupação nobre 50% (em vez de 65%)": dict(demanda=0.50 / 0.65 * 0.95 + 0.05),
        "Preço R$ 100/h no nobre (+11%)": dict(preco=1.11),
    },
}


def rodar():
    linhas = []
    for k, alav in ALAVANCAS.items():
        p = IDEIAS[k]
        b = projetar(p, G)
        linhas.append(dict(id=k, alavanca="(caso-base)", tir=b["tir"], vpl=b["vpl"], payback=b["pb"]))
        for nome, ch in alav.items():
            if not ch:
                continue
            pp = dict(p)
            ch = dict(ch)
            if "_rec" in ch:
                pp["custo_rec_pct"] = ch.pop("_rec")
            o = projetar(pp, G, ch)
            linhas.append(dict(id=k, alavanca=nome, tir=o["tir"], vpl=o["vpl"], payback=o["pb"]))
    return pd.DataFrame(linhas)


if __name__ == "__main__":
    df = rodar()
    df["tir"] = (df["tir"] * 100).round(1)
    df["vpl"] = (df["vpl"] / 1000).round(0)
    print(df.round(2).to_string(index=False))
