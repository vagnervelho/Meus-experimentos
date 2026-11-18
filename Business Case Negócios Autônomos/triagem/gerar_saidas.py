# -*- coding: utf-8 -*-
"""Roda tudo e grava gráficos + tabelas em markdown usadas no STRESS_TEST.md."""
import os
import numpy as np
import pandas as pd
import rodar
import alavancas
from graficos import retorno_x_autonomia, faixa_vpl
from premissas import IDEIAS, G

VEREDITO = {
    "qud": "Modelar", "qua": "Modelar", "lvc": "Modelar",
    "lav": "Modelar com ressalvas", "agg": "Modelar com ressalvas", "sol3": "Modelar com ressalvas",
    "sst": "Modelar com ressalvas",
    "ljs": "Descartar", "sol": "Descartar", "est": "Descartar", "mkt": "Descartar", "ven": "Descartar",
    "acd": "Descartar", "evc": "Descartar",
}
ROT = {
    "lav": "Lavanderia de rua", "lvc": "Lavanderia em condomínios", "ljs": "Lava-jato self-service",
    "agg": "Água + gelo", "agm": "Água + gelo (MVP de teste)", "sst": "Self storage (contêineres)",
    "sol": "Solar GD 75 kWp", "sol3": "Solar GD 300 kWp", "est": "Sala de estudos 24h",
    "qua": "Quadras cobertas", "qud": "Quadras descobertas", "mkt": "Minimercados em condomínio",
    "ven": "Vending (10 máquinas)", "acd": "Academia 24h", "evc": "Eletroposto DC",
    "_off": {
        "sst": (-10, -4, "right"), "lav": (9, 3, "left"), "qua": (9, 0, "left"), "lvc": (9, 0, "left"),
        "qud": (9, 0, "left"), "agg": (9, -6, "left"), "ljs": (9, -6, "left"), "est": (9, -3, "left"),
        "acd": (9, 0, "left"), "sol3": (-10, 4, "right"), "sol": (-9, -9, "right"), "evc": (9, 0, "left"),
        "mkt": (-9, 6, "right"), "ven": (9, 0, "left"),
    },
    "_dx": {"qud": -0.45, "lvc": 0.0, "qua": 0.45, "sst": -0.9, "est": 0.0,
            "agg": -0.2, "ljs": 0.35, "acd": 0.9, "lav": 0.0},
}
AQUI = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(AQUI, "resultados")


def pct(x, d=1):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "n/d"
    v = round(x * 100, d)
    v = 0.0 if v == 0 else v          # evita "-0%"
    return f"{v:.{d}f}%".replace(".", ",")


def brl(x):
    return "n/d" if np.isnan(x) else f"{x / 1000:,.0f}".replace(",", ".")


def anos(x):
    return "> 5" if np.isnan(x) else f"{x:.1f}".replace(".", ",")


def main():
    base, stress, mc, fl, _ = rodar.main(n_mc=4000, verbose=False)
    retorno_x_autonomia(base, mc, VEREDITO, ROT, os.path.join(OUT, "retorno_x_autonomia.png"), G["tma_real"])
    faixa_vpl(mc, VEREDITO, ROT, os.path.join(OUT, "monte_carlo_vpl.png"))
    ordem = base.sort_values("tir_real", ascending=False).index
    # Tabela 1 — caso-base
    t1 = ["| Ideia | Investimento (R$ mil) | Receita madura (R$ mil/ano) | Margem EBITDA | Horas/sem | TIR real | TIR nominal | VPL @15% (R$ mil) | Payback (anos) | ROI 5 anos | Margem de segurança da demanda |",
          "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for k in ordem:
        b = base.loc[k]
        t1.append(f"| {ROT[k]} | {brl(b.inv0)} | {brl(b.receita_madura)} | {pct(b.margem_ebitda, 0)} | {b.horas_semana:.0f} | "
                  f"{pct(b.tir_real)} | {pct(b.tir_nominal)} | {brl(b.vpl)} | {anos(b.payback)} | {pct(b.roi_5a, 0)} | "
                  f"{pct(b.margem_seguranca, 0)} |")
    # Tabela 2 — o que precisa mudar para VPL = 0
    t2 = ["| Ideia | Demanda necessária | Preço necessário | Capex máximo | P(VPL<0) MC neutro | P(VPL<0) MC estresse | TIR P10–P90 (neutro) |",
          "|---|---:|---:|---:|---:|---:|---:|"]
    for k in ordem:
        b, m = base.loc[k], mc.loc[k]
        f = lambda v: "n/d" if np.isnan(v) else f"{(v - 1) * 100:+.0f}%"
        t2.append(f"| {ROT[k]} | {f(b.demanda_equilibrio)} | {f(b.preco_equilibrio)} | {f(b.capex_equilibrio)} | "
                  f"{pct(m.neutro_p_vpl_neg, 0)} | {pct(m.p_vpl_neg, 0)} | {pct(m.neutro_tir_p10, 0)} a {pct(m.neutro_tir_p90, 0)} |")
    # Tabela 3 — estresses (TIR real)
    piv = stress.pivot(index="id", columns="estresse", values="tir_real").loc[ordem]
    cols = list(rodar.ESTRESSES.keys())
    curto = {c: c.split(" (")[0] if c.startswith("Combinado") else c for c in cols}
    t3 = ["| Ideia | Base | " + " | ".join(curto[c] for c in cols) + " |", "|---|---:|" + "---:|" * len(cols)]
    for k in ordem:
        t3.append(f"| {ROT[k]} | {pct(base.loc[k, 'tir_real'], 0)} | " + " | ".join(pct(piv.loc[k, c], 0) for c in cols) + " |")
    # Tabela 4 — alavancas
    al = alavancas.rodar()
    t4 = ["| Ideia | Alavanca | TIR real | VPL @15% (R$ mil) | Payback (anos) |", "|---|---|---:|---:|---:|"]
    for _, r in al.iterrows():
        t4.append(f"| {ROT[r.id]} | {r.alavanca} | {pct(r.tir)} | {brl(r.vpl)} | {anos(r.payback)} |")
    md = "\n\n".join(["\n".join(t) for t in (t1, t2, t3, t4)])
    open(os.path.join(OUT, "tabelas.md"), "w", encoding="utf-8").write(md)
    print(md)


if __name__ == "__main__":
    main()
