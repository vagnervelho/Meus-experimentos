# -*- coding: utf-8 -*-
"""Réplica independente do simulador em Python puro (verificação).

Implementa as mesmas regras de negócio descritas na aba Instrucoes, sem usar as fórmulas da planilha.
Uso:  from replica import simulate; r = simulate(overrides={"cidade": 2})
As entradas padrão vêm de premissas.values(); 'overrides' troca valores (seletores como números 1/2/3).
"""
import datetime as dt
import premissas as PR

NM = 816
SEL = {"criterio": ["Viver de rendimentos", "Consumir até a idade-limite"], "cidade": ["Porto Velho", "Campinas"],
       "regime": ["Simples Nacional", "Lucro Presumido", "Alíquota manual"], "simples_corr": ["Sim", "Não"],
       "sal_mat": ["Sim", "Não"], "conj_divide": ["Sim", "Não"], "sistema": ["SAC", "Price"], "escola": ["Particular", "Pública"],
       "faculdade": ["Pública", "Particular"], "plano_inicio": ["No nascimento do 1º filho", "No casamento", "Data específica"],
       "inss_modo": ["Não considerar", "Estimativa do modelo", "Valor manual"]}


def inputs(overrides=None):
    v = PR.values()
    for k, opts in SEL.items():
        v[k] = opts.index(v[k]) + 1
    v.update({"fat_var": 0.0, "gasto_var": 0.0, "filho_var": 0.0, "compra_atraso": 0})
    for k, x in (overrides or {}).items():
        v[k] = x
    return v


def band(lo_list, x):
    b = 0
    for i, lo in enumerate(lo_list):
        if x >= lo:
            b = i
    return b


def simulate(overrides=None):
    v = inputs(overrides)
    ini = v["inicio"]

    def idx(d):
        return (d.year - ini.year) * 12 + d.month - ini.month + 1

    def edate(d, m):
        y, mo = divmod(d.month - 1 + m, 12)
        return dt.date(d.year + y, mo + 1, 1)

    cidade = v["cidade"]
    conj_used = v["conj_pct"] if v["conj_divide"] == 1 or "conj_pct" in (overrides or {}) else 0.0
    fat_mult, gasto_mult, filho_mult = 1 + v["fat_var"], 1 + v["gasto_var"], 1 + v["filho_var"]
    nasc = v["nasc"]
    t_apos = idx(edate(nasc, 12 * v["idade_apos"]))
    t_inss = max(t_apos, idx(edate(nasc, 12 * 62)))
    t_cas = idx(v["cas_data"])
    t_mud = idx(v["mud_data"])
    t_mora = min(t_cas, t_mud) if cidade == 2 else t_cas
    imov = v["imovel_valor@c"] if cidade == 2 else v["imovel_valor"]
    if "imovel_valor" in (overrides or {}):
        imov = v["imovel_valor"]
    comp_dt = v["compra_data@c"] if cidade == 2 else v["compra_data"]
    t_compra = 99999 if imov <= 0 else max(1, idx(comp_dt) + v["compra_atraso"])
    itbi = v["itbi@c"] if cidade == 2 else v["itbi"]
    cprop = v["custo_proprio@c"] if cidade == 2 else v["custo_proprio"]
    tf = [idx(v["f1_data"]), idx(v["f2_data"]), idx(v["f3_data"])]
    nf = v["n_filhos"]
    t_plano = {1: tf[0] if nf >= 1 else 99999, 2: t_cas, 3: idx(v["plano_data"])}[v["plano_inicio"]]
    t_mkt = idx(v["mkt_ini"])
    anexo = 3 if v["pl_pct"] >= 0.28 else 5
    ans_ref = v["ans_f"][band(v["ans_lo"], 29)]

    # séries
    I, RI, G = [0.0] * (NM + 1), [0.0] * (NM + 1), [0.0] * (NM + 1)
    G[0] = 1.0
    res = {k: [0.0] * (NM + 1) for k in ("fb", "liq", "trib_tot", "salmat", "p", "sobra", "prest", "g_pes", "g_fil", "g_sau",
                                       "g_mor", "g_imo1", "sd", "rend", "pl", "sc_r", "contrib", "ating", "k_real", "irrf", "aliq_s",
                                       "dist", "esgot", "pt")}
    fb_hist = PR.ITEMS["fat_pv"]["v"]
    fbs = {}
    V = 0.0
    sd = 0.0
    P = v["pat_ini"]
    date = lambda t: edate(ini, t - 1)
    # pré-cálculo do índice (necessário para o valor do imóvel na compra)
    for t in range(1, NM + 1):
        d = date(t)
        ipca = v["ipca_curva"][v["ano_curva"].index(d.year)] if d.year in v["ano_curva"] else v["ipca_lp"]
        I[t] = 1.0 if t == 1 else I[t - 1] * (1 + ipca) ** (1 / 12)
    if t_compra <= NM:
        V = imov * I[t_compra] * (1 + v["valoriz"]) ** ((t_compra - 1) / 12)
    fin = V * (1 - v["entrada"])
    i_m = (1 + v["taxa_fin"]) ** (1 / 12) - 1
    A_sac = fin / v["prazo"] if v["prazo"] > 0 else 0
    pmt = fin * i_m / (1 - (1 + i_m) ** (-v["prazo"])) if fin > 0 else 0

    # INSS (precisa do pró-labore de todos os meses) -> 1ª passada só da renda
    ev = []
    for (desc, val, d0, rep, n, pct) in v["events"]:
        t0 = idx(d0)
        per = 12 * rep if rep and rep > 0 else 100000
        nn = max(1, n or 0) if rep and rep > 0 else 1
        ev.append((t0, per, t0 + per * (nn - 1), val, pct))

    def lp_rate(t):
        d = date(t)
        if d.year in v["ano_curva"]:
            k = v["ano_curva"].index(d.year)
            return v["cdi_curva"][k], v["ipca_curva"][k]
        return v["cdi_lp"], v["ipca_lp"]

    rows = []
    for t in range(1, NM + 1):
        d = date(t)
        cdi, ipca = lp_rate(t)
        cdi_m, ipca_m = (1 + cdi) ** (1 / 12) - 1, (1 + ipca) ** (1 / 12) - 1
        rliq = cdi_m * v["pct_cdi"] * (1 - v["ir_inv"]) - ((1 + v["custodia"]) ** (1 / 12) - 1)
        rdiv = (1 + rliq) * (1 + v["spread_div"]) ** (1 / 12) - 1
        G[t] = G[t - 1] * (1 + rliq)
        RI[t] = 1.0 if t == 1 else (I[t] * (1 + v["g_real"]) ** ((t - 1) / 12) if d.month == v["mes_reaj"] else RI[t - 1])
        idm = (d.year - nasc.year) * 12 + d.month - nasc.month
        age = idm // 12
        trab = 1 if t < t_apos else 0
        cid = 2 if (cidade == 2 and t >= t_mud) else 1
        conj = conj_used if t >= t_cas else 0.0
        # filhos
        lic = mat = 0
        fil_tot = 0.0
        for k in range(3):
            act = nf >= k + 1
            a = (t - tf[k]) // 12 if (act and t >= tf[k]) else -1
            dep = 1 if (0 <= a < v["dep_ate"] and trab) else 0
            tot = 0.0
            if dep:
                b = band(v["band_lo"], a)
                vida = (v["basico"][b] + v["baba"][b]) * (v["fator_cps"] if cid == 2 else 1) * I[t]
                esc = ((v["esc_cps"][b] if cid == 2 else v["esc_pv"][b]) if v["escola"] == 1 else v["esc_pub"][b])
                fac = v["fac_pub"][b] if v["faculdade"] == 1 else v["fac_part"][b]
                edu = (esc + fac) * I[t] * (1 + v["infl_edu"]) ** ((t - 1) / 12)
                pf = (v["plano_filho@c"] if cid == 2 else v["plano_filho"])
                plano = pf * v["ans_f"][band(v["ans_lo"], a)] / v["ans_f"][0] * I[t] * (1 + v["infl_saude"]) ** ((t - 1) / 12)
                tot += vida + edu + plano
            if act and t == tf[k] and trab:
                tot += v["custo_nasc"] * I[t]
            fil_tot += tot * filho_mult
            if act and tf[k] <= t < tf[k] + v["licenca"]:
                lic = 1
            if act and tf[k] <= t < tf[k] + 4:
                mat = 1
        # renda
        fpv = v["fat_pv"] * fat_mult * RI[t]
        if t < t_mud:
            fcps = fpv
        else:
            ini_c, est_c = v["fat_cps_ini"] * fat_mult, v["fat_cps_est"] * fat_mult
            fcps = (ini_c + (est_c - ini_c) * min(1, (t - t_mud) / (12 * max(1 / 12, v["anos_estab"])))) * RI[t]
        fbase = (fcps if cidade == 2 else fpv) * trab
        licf = v["lic_pct"] if lic else 1
        fbase_ef = fbase * licf
        mkt_on = 1 if (t >= t_mkt and trab) else 0
        anc = max(t_mkt, t_mud) if (cidade == 2 and t >= t_mud) else t_mkt
        ramp = min(1, max(0, t - anc + 1) / max(1, v["mkt_rampa"])) if mkt_on else 0
        fmkt = v["mkt_consultas"] * v["mkt_ticket"] * RI[t] * ramp * licf
        fb = fbase_ef + fmkt
        fbs[t] = fb
        rbt12 = sum(fbs.get(s, fb_hist) if s >= 1 else fb_hist for s in range(t - 12, t))
        rbt = rbt12 / I[t] if v["simples_corr"] == 1 else rbt12
        fx = band(v["s_lim"], rbt)
        nom, pd = (v["s3n"][fx], v["s3d"][fx]) if anexo == 3 else (v["s5n"][fx], v["s5d"][fx])
        aliq_s = max(0, (rbt * nom - pd) / rbt) if rbt > 0 else 0
        iss = v["iss@c"] if cid == 2 else v["iss"]
        aliq_lp = v["lp_pis"] + v["lp_cofins"] + v["lp_presuncao"] * (v["lp_irpj"] + v["lp_csll"]) + iss
        reg = v["regime"]
        if reg == 1:
            trib = fb * aliq_s
            pl = v["pl_pct"] * fb
            pl_ref = v["pl_pct"] * fbase
        elif reg == 2:
            trib = fb * aliq_lp + v["lp_adic"] * max(0, v["lp_presuncao"] * fb - v["lp_adic_lim"])
            pl = pl_ref = v["pl_lp"] * I[t] * trab
        else:
            trib = fb * v["aliq_manual"]
            pl = pl_ref = 0.0
        teto = v["teto_inss"] * I[t]
        inss = v["inss_aliq"] * min(pl, teto)
        cpp = 0.2 * pl if reg == 2 else 0.0
        salmat = min(teto, pl_ref) if (v["sal_mat"] == 1 and mat) else 0.0
        rend_r = (pl + salmat) / I[t]
        base_r = max(0, rend_r - max(inss / I[t], v["ir_simpl"]))
        fi = band(v["ir_lim"], base_r)
        irb = max(0, base_r * v["ir_aliq"][fi] - v["ir_ded"][fi])
        if rend_r <= v["ir_red_lim1"]:
            red = min(irb, v["ir_red_max"])
        elif rend_r <= v["ir_red_lim2"]:
            red = max(0, min(irb, v["ir_red_a"] - v["ir_red_b"] * rend_r))
        else:
            red = 0
        irrf = max(0, irb - red) * I[t]
        contab = v["contador"] * I[t] * trab
        mkt_c = v["mkt_valor"] * I[t] if mkt_on else 0.0
        trib_tot = trib + inss + cpp + irrf
        liq = fb - trib_tot - contab - mkt_c + salmat
        # família
        nmc = min(v["cas_meses"], t_cas)
        cas_pg = v["cas_valor"] / nmc * I[t] if (t_cas - nmc < t <= t_cas) else 0.0
        mont = v["montagem"] * I[t] if t == t_mora else 0.0
        pl_on = 1 if (t >= t_plano and trab) else 0
        pdela = (v["plano_dela@c"] if cid == 2 else v["plano_dela"])
        g_sau = pdela * v["ans_f"][band(v["ans_lo"], age)] / ans_ref * I[t] * (1 + v["infl_saude"]) ** ((t - 1) / 12) if pl_on else 0.0
        # moradia
        alug_on = 1 if (t_mora <= t < t_compra and trab) else 0
        alug = alug_on * (v["aluguel@c"] if cid == 2 else v["aluguel"]) * I[t]
        cond = alug_on * (v["cond_alug@c"] if cid == 2 else v["cond_alug"]) * I[t]
        lar = ((v["lar@c"] if cid == 2 else v["lar"]) * I[t]) if (t >= t_mora and trab) else 0.0
        mud = v["mud_custo"] * I[t] if (cidade == 2 and t == t_mud) else 0.0
        comp = 1 if t == t_compra else 0
        imov1 = comp * (V * v["entrada"] + V * itbi + v["reforma"] * I[t])
        sd_ini = sd
        juros = sd_ini * i_m
        if sd_ini > 0:
            amort = min(sd_ini, A_sac) if v["sistema"] == 1 else min(sd_ini, max(0, pmt - juros))
        else:
            amort = 0.0
        seg = sd_ini * v["seguro"]
        prest = juros + amort + seg
        cprop_v = cprop * I[t] if (t >= t_compra and trab) else 0.0
        # fluxo
        inss_ben = 0.0  # preenchido na 2ª passada
        g_pes = trab * (v["gasto_pes@c"] if cid == 2 else v["gasto_pes"]) * gasto_mult * \
            ((1 + v["gasto_pes_cas"]) if t >= t_cas else 1) * I[t]
        sh = 1 - conj
        g_ev = sum(val * pct for (t0, per, tl, val, pct) in ev if t0 <= t <= tl and (t - t0) % per == 0) * I[t] * trab
        g_apo = v["meta"] * I[t] if not trab else 0.0
        rows.append(dict(t=t, I=I[t], rliq=rliq, rdiv=rdiv, trab=trab, conj=conj, idm=idm, age=age, fb=fb, liq=liq,
                         trib_tot=trib_tot, salmat=salmat, pl=pl, teto=teto, irrf=irrf, aliq_s=aliq_s,
                         dist=fb - trib - cpp - pl - contab - mkt_c, fbase=fbase,
                         g_pes=g_pes, g_mor=(alug + cond + lar + mud) * sh, g_imo1=imov1 * sh, prest=prest, juros=juros, amort=amort,
                         sd_ini=sd_ini, g_prop=cprop_v * sh, g_cas=cas_pg * v["cas_pct"] + mont * sh, g_fil=fil_tot * sh,
                         g_sau=g_sau, g_ev=g_ev, g_apo=g_apo, comp=comp))
        # saldo devedor (amortização extra depende da sobra: calculada na 2ª passada)
        sd = sd_ini - amort + comp * fin   # provisório; refeito abaixo
    # INSS estimado
    n_fut = sum(1 for r in rows if r["pl"] + r["salmat"] > 0)
    soma_sc = sum(min(r["pl"], r["teto"]) / r["I"] for r in rows if r["trab"])
    anos = v["inss_anos_ant"] + n_fut / 12
    media = (v["inss_anos_ant"] * 12 * v["inss_media_ant"] + soma_sc) / (v["inss_anos_ant"] * 12 + n_fut) if n_fut or v["inss_anos_ant"] else 0
    coef = min(1, 0.6 + 0.02 * max(0, anos - 15))
    est = min(v["teto_inss"], coef * media) if anos >= 15 else 0
    inss_final = {1: 0.0, 2: est, 3: v["inss_manual"]}[v["inss_modo"]]
    # 2ª passada: financiamento com amortização extra + patrimônio
    sd = 0.0
    P = v["pat_ini"]
    out_P, out_real = [], []
    for r in rows:
        t = r["t"]
        sd_ini = sd
        juros = sd_ini * i_m
        if sd_ini > 0:
            amort = min(sd_ini, A_sac) if v["sistema"] == 1 else min(sd_ini, max(0, pmt - juros))
        else:
            amort = 0.0
        seg = sd_ini * v["seguro"]
        prest = juros + amort + seg
        sh = 1 - r["conj"]
        inss_ben = inss_final * r["I"] if t >= t_inss else 0.0
        ent = r["liq"] + inss_ben
        sai = r["g_pes"] + r["g_mor"] + r["g_imo1"] + prest * sh + r["g_prop"] + r["g_cas"] + r["g_fil"] + r["g_sau"] + r["g_ev"] + r["g_apo"]
        sobra_pre = ent - sai
        extra = min(sd_ini - amort, v["amort_extra"] * max(0, sobra_pre) / sh) if (sd_ini - amort > 0 and r["conj"] < 1) else 0.0
        quit = max(0, sd_ini - amort - extra) if t == t_apos - 1 else 0.0
        sd = sd_ini - amort - extra - quit + r["comp"] * fin
        sobra = sobra_pre - (extra + quit) * sh
        rend = P * r["rliq"] if P >= 0 else P * r["rdiv"]
        P = P + rend + sobra
        r.update(prest_dela=prest * sh, sobra=sobra, P=P, sd=sd, rend=rend, inss_ben=inss_ben, extra=extra, quit=quit)
    # saídas
    lp_m = ((1 + v["cdi_lp"]) ** (1 / 12) - 1) * v["pct_cdi"] * (1 - v["ir_inv"]) - ((1 + v["custodia"]) ** (1 / 12) - 1)
    ipca_lp_m = (1 + v["ipca_lp"]) ** (1 / 12) - 1
    rr = (1 + lp_m) / (1 + ipca_lp_m) - 1
    w = max(0, v["meta"] - inss_final)
    n_cons = max(1, (v["idade_lim"] - v["idade_apos"]) * 12)
    k_perp = w / rr if rr > 0 else 1e12
    k_cons = w * (1 - (1 + rr) ** (-n_cons)) / rr if rr != 0 else w * n_cons
    k_star = k_perp if v["criterio"] == 1 else k_cons
    ts = t_apos - 1
    p65 = rows[ts - 1]["P"] / rows[ts - 1]["I"]
    renda_perp = p65 * rr
    renda_cons = p65 * rr / (1 - (1 + rr) ** (-n_cons)) if rr != 0 else p65 / n_cons
    renda = (renda_perp if v["criterio"] == 1 else renda_cons) + inss_final
    fv = G[ts] * sum(rows[t - 1]["I"] / G[t] for t in range(1, ts + 1)) / rows[ts - 1]["I"]
    aporte = (k_star - p65) / fv
    # idade em que atinge
    idade_if = None
    for r in rows:
        if not r["trab"]:
            break
        kr = w / rr if v["criterio"] == 1 else w * (1 - (1 + rr) ** (-max(1, 12 * v["idade_lim"] - r["idm"]))) / rr
        if r["P"] >= kr * r["I"]:
            idade_if = r["age"]
            break
    minsal = min(r["P"] / r["I"] for r in rows if r["trab"])
    return dict(rows=rows, p65_real=p65, k_star=k_star, renda_total=renda, pct_meta=renda / v["meta"], aporte=aporte,
                inss_final=inss_final, inss_est=est, idade_if=idade_if, min_saldo=minsal, t_apos=t_apos, t_compra=t_compra,
                V=V, fin=fin, fv_fac=fv, k_perp=k_perp, k_cons=k_cons, r_real_m=rr)


if __name__ == "__main__":
    r = simulate()
    for k in ("p65_real", "k_star", "renda_total", "pct_meta", "aporte", "idade_if", "min_saldo", "inss_est", "t_apos", "t_compra", "V"):
        print(k, r[k])
