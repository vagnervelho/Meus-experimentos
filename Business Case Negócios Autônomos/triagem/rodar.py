# -*- coding: utf-8 -*-
"""Roda a triagem: caso-base, testes de estresse determinísticos e Monte Carlo para cada ideia.
Uso: python3 rodar.py            -> imprime as tabelas e grava resultados/*.csv
"""
import os
import numpy as np
import pandas as pd
from motor import projetar, demanda_equilibrio, ANOS
from premissas import IDEIAS, G

AQUI = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(AQUI, "resultados")
os.makedirs(OUT, exist_ok=True)

ESTRESSES = {
    "Demanda -30%": dict(demanda=0.70),
    "Preço -15%": dict(preco=0.85),
    "Capex +25%": dict(capex=1.25),
    "Maturação 1 ano mais lenta": dict(atraso=1.0),
    "Energia +30%": dict(energia=1.30),
    "Custos fixos +20%": dict(fixo=1.20),
    "Horas humanas x2": dict(horas=2.0),
    "Tempo humano de graça (visão 'do bolso')": dict(horas=0.0),
    "Sem valor residual": dict(residual=0.0),
    "Combinado (dem -20%, preço -5%, capex +15%, energia +15%, atraso 6m)":
        dict(demanda=0.80, preco=0.95, capex=1.15, energia=1.15, atraso=0.5, fixo=1.10),
}


def tri(rng, lo, mode, hi, n):
    return rng.triangular(lo, mode, hi, n)


def monte_carlo(p, g, n=4000, seed=7):
    rng = np.random.default_rng(seed)
    dlo, dhi = p.get("demanda_faixa", (0.65, 1.15))
    plo, phi = p.get("preco_faixa", (0.85, 1.05))
    draws = dict(
        demanda=tri(rng, dlo, 1.0, dhi, n),
        preco=tri(rng, plo, 1.0, phi, n),
        capex=tri(rng, 0.95, 1.0, p.get("capex_max", 1.30), n),
        fixo=tri(rng, 0.92, 1.0, 1.20, n),
        energia=tri(rng, 0.95, 1.0, 1.30, n),
        residual=tri(rng, 0.60, 1.0, 1.10, n),
        horas=tri(rng, 0.80, 1.0, 1.50, n),
    )
    atrasos, probs = zip(*p.get("atraso_dist", [(0.0, 0.55), (0.5, 0.30), (1.0, 0.15)]))
    draws["atraso"] = rng.choice(atrasos, size=n, p=probs)
    ps, cs = p.get("p_sinistro", 0.0), p.get("custo_sinistro", 0.0)
    sin = (rng.random((n, ANOS)) < ps) * cs
    res = []
    for i in range(n):
        ch = {k: float(v[i]) for k, v in draws.items()}
        ch["sinistros"] = sin[i]
        o = projetar(p, g, ch)
        res.append((o["vpl"], o["tir"], o["pb"], o["roi"]))
    a = np.array(res, float)
    vplv, tirv, pbv, roiv = a.T
    return dict(
        p_vpl_neg=float(np.mean(vplv < 0)),
        vpl_p10=np.percentile(vplv, 10), vpl_p50=np.percentile(vplv, 50), vpl_p90=np.percentile(vplv, 90),
        tir_p10=np.nanpercentile(tirv, 10), tir_p50=np.nanpercentile(tirv, 50), tir_p90=np.nanpercentile(tirv, 90),
        p_sem_payback=float(np.mean(np.isnan(pbv))),
        roi_p50=np.percentile(roiv, 50),
        vpl_amostra=vplv, tir_amostra=tirv,
    )


def main(n_mc=4000, verbose=True):
    g = G
    base_rows, stress_rows, mc_rows, fluxos = [], [], [], []
    mc_full = {}
    for k, p in IDEIAS.items():
        o = projetar(p, g)
        eq = demanda_equilibrio(p, g)
        base_rows.append(dict(
            id=k, ideia=p["nome"], capex=o["capex"], inv0=o["inv0"], receita_madura=o["receita_madura"],
            margem_ebitda=o["margem_ebitda"], horas_semana=o["horas"], vpl=o["vpl"], tir_real=o["tir"],
            tir_nominal=o["tir_nominal"], tir_sem_vr=o["tir_sem_vr"], tirm=o["tirm"], payback=o["pb"],
            payback_desc=o["pb_desc"], roi_5a=o["roi"], moic=o["moic"], residual=o["residual"],
            demanda_equilibrio=eq, margem_seguranca=(1 - eq) if not np.isnan(eq) else np.nan,
            vt_liq=o["vt_liq"], vt_econ=o["vt_econ"], dep_vt=o["dep_vt"],
        ))
        for i in range(ANOS + 1):
            fluxos.append(dict(id=k, ano=i, fc=o["fc_vt"][i],
                               receita=o["receita"][i - 1] if i else 0.0, ebitda=o["ebitda"][i - 1] if i else 0.0))
        for nome, ch in ESTRESSES.items():
            s = projetar(p, g, ch)
            stress_rows.append(dict(id=k, estresse=nome, vpl=s["vpl"], tir_real=s["tir"], payback=s["pb"]))
        mc = monte_carlo(p, g, n=n_mc)
        mc_full[k] = mc
        mc_rows.append(dict(id=k, **{x: y for x, y in mc.items() if not x.endswith("amostra")}))
    base = pd.DataFrame(base_rows).set_index("id")
    stress = pd.DataFrame(stress_rows)
    mc = pd.DataFrame(mc_rows).set_index("id")
    fl = pd.DataFrame(fluxos)
    base.to_csv(os.path.join(OUT, "base.csv"), float_format="%.4f")
    stress.to_csv(os.path.join(OUT, "estresse.csv"), index=False, float_format="%.4f")
    mc.to_csv(os.path.join(OUT, "monte_carlo.csv"), float_format="%.4f")
    fl.to_csv(os.path.join(OUT, "fluxos.csv"), index=False, float_format="%.2f")
    if verbose:
        pd.set_option("display.width", 250)
        pd.set_option("display.max_columns", 30)
        fmt = base[["capex", "receita_madura", "margem_ebitda", "horas_semana", "vpl", "tir_real", "tir_sem_vr",
                    "payback", "roi_5a", "moic", "margem_seguranca", "dep_vt"]].copy()
        print(fmt.round(3).to_string())
        print()
        piv = stress.pivot(index="id", columns="estresse", values="vpl")
        print((piv / 1000).round(0).to_string())
        print()
        print(mc[["p_vpl_neg", "vpl_p10", "vpl_p50", "vpl_p90", "tir_p10", "tir_p50", "tir_p90",
                  "p_sem_payback"]].round(3).to_string())
    return base, stress, mc, fl, mc_full


if __name__ == "__main__":
    main()
