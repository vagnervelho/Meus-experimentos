# -*- coding: utf-8 -*-
"""Implementação de referência em Python da MESMA lógica das abas do Excel.
Serve para (1) verificar a planilha recalculada pelo LibreOffice e (2) gerar tabelas do relatório.
"""
import re
import numpy as np
from premissas_globais import GLOBAIS, FAIXAS, CHOQUES

TOK = re.compile(r"\{([A-Za-z0-9_]+)\}")
GTOK = re.compile(r"\[([A-Za-z0-9_]+)\]")


def globais_padrao():
    g = {it[0]: it[3] for it in GLOBAIS if it[0] != "sec"}
    g["fin_real"] = (1 + g["fin_taxa"]) / (1 + g["ipca"]) - 1
    for k, _l, _u, v, _f, _n in CHOQUES:
        g[k] = v
    return g


def _eval(expr, loc, g):
    if not isinstance(expr, str):
        return float(expr)
    e = expr[1:] if expr.startswith("=") else expr
    e = TOK.sub(lambda m: repr(float(loc[m.group(1)])), e)
    e = GTOK.sub(lambda m: repr(float(g[m.group(1)])), e)
    e = e.replace("^", "**").replace("MIN(", "min(").replace("MAX(", "max(")
    return float(eval(e, {"__builtins__": {}}, {"min": min, "max": max}))


def simples(rec, anexo, regime, aliq_fixa):
    if regime != 1:
        return rec * aliq_fixa
    if rec <= 0:
        return 0.0
    k = 0
    for i, f in enumerate(FAIXAS):
        if rec >= f[0]:
            k = i
    f = FAIXAS[k]
    col = {1: (1, 2), 2: (3, 4), 3: (5, 6), 4: (5, 6)}[anexo]
    v = max(0.0, rec * f[col[0]] - f[col[1]])
    if anexo == 4:
        v *= (1 - f[7])
    return v


def irr(fc):
    fc = np.asarray(fc, float)
    raizes = np.roots(fc[::-1])
    cand = [1 / x.real - 1 for x in raizes if abs(x.imag) < 1e-9 and x.real > 0]
    cand = [r for r in cand if -0.9 < r < 10]          # abaixo de −90% o Excel mostra n/d
    if not cand:
        return np.nan
    return min(cand, key=abs) if len(cand) > 1 else cand[0]


def mirr(fc, fin, reinv):
    fc = np.asarray(fc, float)
    n = len(fc) - 1
    t = np.arange(n + 1)
    pv_neg = np.sum(np.where(fc < 0, fc, 0) / (1 + fin) ** t)
    fv_pos = np.sum(np.where(fc > 0, fc, 0) * (1 + reinv) ** (n - t))
    if pv_neg >= 0 or fv_pos <= 0:
        return np.nan
    return (fv_pos / -pv_neg) ** (1 / n) - 1


def locais(caso, g):
    """Valores das premissas e derivadas da aba (equivalente às seções 2 a 6)."""
    loc = {}
    for d in caso["drivers"]:
        loc[d[0]] = _eval(d[3], loc, g)
    rmad = sum(_eval(f, loc, g) for _r, f in caso["receitas"])
    loc["RMAD"] = rmad
    loc["kwh_v"] = _eval(caso.get("energia_kwh", "0"), loc, g)
    loc["EMAD"] = loc["kwh_v"] * g["tarifa_kwh"]
    loc["m3_v"] = _eval(caso.get("agua_m3", "0"), loc, g)
    loc["AGUA"] = loc["m3_v"] * g["agua_m3"]
    loc["INS"] = _eval(caso.get("insumos", "0"), loc, g)
    loc["AIMAD"] = loc["AGUA"] + loc["INS"]
    capex = [(_eval(v if not isinstance(v, str) else (v if v.startswith("=") else "=" + v), loc, g), res)
             for (_rot, v, res, *_n) in caso["capex"]]
    loc["CAPEX"] = sum(v for v, _ in capex)
    loc["LIQ"] = sum(v * r for v, r in capex)
    loc["GIRO"], loc["PREOP"] = float(caso["giro"]), float(caso["preop"])
    loc["INV"] = loc["CAPEX"] + loc["GIRO"] + loc["PREOP"]
    loc["MANUT"], loc["VIDA"] = caso["manut"], caso["vida_rest"]
    tma = g["tma"]
    loc["ANUID"] = 0.0 if loc["VIDA"] <= 0 else (1 - (1 + tma) ** (-loc["VIDA"])) / tma
    loc["PSIN"], loc["CSIN"] = caso["p_sin"], caso["c_sin"]
    loc["FIXM"] = sum(_eval(v if not isinstance(v, str) else (v if v.startswith("=") else "=" + v), loc, g)
                      for (_rot, v, *_n) in caso["fixos"])
    loc["FIXO_OUT"] = loc["FIXM"] * 12
    loc["FIXO_EN"] = caso.get("energia_fixa_kwh", 0) * 12 * g["tarifa_kwh"]
    loc["CREC"] = sum(v for (_rot, v, *_n) in caso["crec"])
    loc["HORAS"] = caso["horas"]
    loc["REGIME"], loc["ANEXO"], loc["ALIQF"] = caso.get("regime", 1), caso["anexo"], caso.get("aliq_fixa", 0.0)
    loc["TRIBMAT"] = 0.0 if rmad <= 0 else simples(rmad, loc["ANEXO"], loc["REGIME"], loc["ALIQF"]) / rmad
    loc["FIN"] = g["fin_global"] if g["fin_global"] > 0 else caso.get("fin", 0.0)
    return loc


def multiplicadores(caso, g):
    P, O = caso["cenarios"]["P"], caso["cenarios"]["O"]
    chaves = ["dem", "pre", "cap", "fix", "ene", "atr", "hor"]
    B = [1, 1, 1, 1, 1, 0, 1]
    E = [B[0] * g["s_dem"], g["s_pre"], g["s_cap"], g["s_fix"], g["s_ene"], g["s_atr"], g["s_hor"]]
    H = [0.8, 1, 1, 1, 1, 0, 1]
    return {s: dict(zip(chaves, v)) for s, v in (("P", P), ("B", B), ("O", O), ("E", E), ("H", H))}


def maturacao(rampa, atr):
    ext = [0.0] + list(rampa) + [rampa[-1]]
    out = []
    for t in range(1, 6):
        x = t - atr
        if x <= 0:
            out.append(0.0)
            continue
        k = int(np.floor(x))
        f = x - k
        out.append((1 - f) * ext[min(k, 6)] + f * ext[min(k + 1, 6)])
    return np.array(out)


def projetar(caso, g, m, loc):
    tma = g["tma"]
    mat = maturacao(caso["rampa"], m["atr"])
    vol = mat * m["dem"]
    rec = loc["RMAD"] * vol * m["pre"]
    ener_v = -loc["EMAD"] * vol * m["ene"]
    agua_ins = -loc["AIMAD"] * vol
    crec = -rec * loc["CREC"]
    trib = -np.array([simples(x, loc["ANEXO"], loc["REGIME"], loc["ALIQF"]) for x in rec])
    fixo = -np.full(5, loc["FIXO_OUT"] * m["fix"])
    ener_f = -np.full(5, loc["FIXO_EN"] * m["ene"] * m["fix"])
    horas = -np.full(5, loc["HORAS"] * m["hor"] * 52 * g["custo_hora"] * g["conta_horas"])
    sin = -np.full(5, loc["PSIN"] * loc["CSIN"])
    ebitda = rec + ener_v + agua_ins + crec + trib + fixo + ener_f + horas + sin
    manut = np.array([0.0] + [-loc["CAPEX"] * m["cap"] * loc["MANUT"]] * 4)
    fcl = ebitda + manut
    inv = -(loc["CAPEX"] * m["cap"] + loc["GIRO"] + loc["PREOP"])
    vr = max(loc["LIQ"] * m["cap"], max(0.0, fcl[-1]) * loc["ANUID"] * (1 - g["desagio"])) + loc["GIRO"]
    fc = np.concatenate([[inv], fcl])
    fc[-1] += vr
    fd = 1 / (1 + tma) ** np.arange(6)
    acum = np.cumsum(np.concatenate([[inv], fcl]))
    acumd = np.cumsum(np.concatenate([[inv], fcl]) * fd)

    def pb(a):
        for t in range(1, 6):
            if a[t - 1] < 0 <= a[t]:
                return t - 1 + (-a[t - 1]) / (a[t] - a[t - 1])
        return np.nan
    # financiamento (real, SAC, carência)
    L = -inv * loc["FIN"]
    div = [L]
    jur, amo = [], []
    for t in range(1, 6):
        j = -div[-1] * g["fin_real"]
        a = 0.0 if t <= g["fin_carencia"] else -min(div[-1], L / max(1, g["fin_prazo"] - g["fin_carencia"]))
        jur.append(j)
        amo.append(a)
        div.append(max(0.0, div[-1] + a))
    fca = np.concatenate([[inv + L], fc[1:] + np.array(jur) + np.array(amo)])
    fca[-1] -= div[-1]
    vpl = fc[0] + np.sum(fc[1:] / (1 + tma) ** np.arange(1, 6))
    pvr = vr * fd[-1]
    dep = pvr / (pvr + np.sum(np.where(fcl > 0, fcl, 0) * fd[1:]))
    t = irr(fc)
    return dict(inv=-inv, cap_proprio=-(inv + L), rec5=rec[-1], mg5=ebitda[-1] / rec[-1] if rec[-1] else 0.0, vpl=vpl,
                tir=t, tir_nom=(1 + t) * (1 + g["ipca"]) - 1 if not np.isnan(t) else np.nan,
                tirm=mirr(fc, tma, g["reinv"]), tir_acion=t if loc["FIN"] == 0 else irr(fca),
                pb=pb(acum), pbd=pb(acumd), roi=(fcl.sum() + vr + inv) / -inv, moic=(fcl.sum() + vr) / -inv,
                expo=-min(0.0, acum.min()), dep_vr=dep, horas=loc["HORAS"] * m["hor"], rec=rec, ebitda=ebitda, fc=fc, vr=vr)


def calcular(caso, g=None):
    g = g or globais_padrao()
    loc = locais(caso, g)
    ms = multiplicadores(caso, g)
    out = {s: projetar(caso, g, ms[s], loc) for s in ("P", "B", "O", "E", "H")}
    b, h = out["B"], out["H"]
    out["B"]["ms"] = np.nan if abs(b["vpl"] - h["vpl"]) < 0.01 else 0.2 * b["vpl"] / (b["vpl"] - h["vpl"])
    den = loc["RMAD"] * (1 - loc["CREC"] - loc["TRIBMAT"]) - loc["EMAD"] - loc["AIMAD"]
    num = loc["FIXO_OUT"] + loc["FIXO_EN"] + loc["HORAS"] * 52 * g["custo_hora"] * g["conta_horas"] + loc["PSIN"] * loc["CSIN"]
    out["B"]["pe"] = np.nan if den <= 0 else num / den
    if b["vpl"] > 0:
        ver = "AVANÇAR" if out["E"]["vpl"] > 0 else "AVANÇAR COM CAUTELA"
    else:
        ver = "SÓ COM ALAVANCAS" if (not np.isnan(b["tir"]) and b["tir"] >= g["tesouro"]) else "DESCARTAR"
    out["B"]["veredito"] = ver
    out["loc"] = loc
    return out
