# -*- coding: utf-8 -*-
"""Motores de calculo (abas mensais). Somente formulas."""
from framework import *


def stage(M, x, nome, G, alvo, mort, ent, kgent):
    """Bloco de lotes por mes de entrada. Peso do lote c no fim do mes t = w0 + G(t) - G(c-1),
    onde G e o ganho acumulado do sistema. Evita matriz lote x mes: tudo em linhas."""
    M.row(f"{x}_ent", f"{nome}: entradas", "cab", ent, "num",
          note="Cabeças que entram na fase neste mês (compras externas + transferências internas).")
    M.row(f"{x}_kgent", f"{nome}: peso total das entradas", "kg", kgent, "int")
    M.row(f"{x}_morte", f"{nome}: mortes (lançadas na entrada)", "cab", f"={{{x}_ent}}*[{mort}]*[f_mort]", "num2")
    M.row(f"{x}_n", f"{nome}: entradas líquidas de mortes", "cab", f"={{{x}_ent}}-{{{x}_morte}}", "num")
    M.row(f"{x}_w0", f"{nome}: peso médio de entrada do lote", "kg/cab", f"=IF({{{x}_ent}}>0,{{{x}_kgent}}/{{{x}_ent}},0)", "num", None)
    M.row(f"{x}_exit", f"{nome}: mês de saída do lote que entrou neste mês", "mês nº",
          f"=IF({{{x}_n}}>0,MAX({{t}},SUMPRODUCT(--({{{G}|all}}<{{{G}|p}}+[{alvo}]-{{{x}_w0}}))+1),0)", "idx", None,
          note="Primeiro mês em que o ganho acumulado desde a entrada atinge (peso-alvo − peso de entrada). "
               "Conta quantos meses têm ganho acumulado abaixo do necessário e soma 1. 121 = não sai dentro do horizonte.")
    M.row(f"{x}_K", f"{nome}: constante de peso do lote [n × (w0 − G anterior)]", "kg", f"={{{x}_n}}*({{{x}_w0}}-{{{G}|p}})", "int", None,
          note="Auxiliar: permite somar o peso de todos os lotes presentes sem matriz. Peso total = presentes × G(t) + ΣK.")
    M.row(f"{x}_sai", f"{nome}: saídas (atingiram o peso-alvo)", "cab", f"=SUMIFS({{{x}_n|all}},{{{x}_exit|all}},{{t}})", "num")
    M.row(f"{x}_Kout", f"{nome}: constante de peso dos lotes que saem", "kg", f"=SUMIFS({{{x}_K|all}},{{{x}_exit|all}},{{t}})", "int", None)
    M.row(f"{x}_pres", f"{nome}: cabeças presentes durante o mês", "cab", f"={{{x}_est|p}}+{{{x}_n}}", "num", "avg")
    M.row(f"{x}_est", f"{nome}: estoque no fim do mês", "cab", f"={{{x}_pres}}-{{{x}_sai}}", "num", "last", bold=True)
    M.row(f"{x}_sumK", f"{nome}: ΣK dos lotes presentes", "kg", f"={{{x}_sumK|p}}+{{{x}_K}}-{{{x}_Kout|p}}", "int", None)
    M.row(f"{x}_pv", f"{nome}: peso vivo total (meio do mês)", "kg", f"={{{x}_pres}}*({{{G}}}+{{{G}|p}})/2+{{{x}_sumK}}", "int", "avg")
    M.row(f"{x}_kgsai", f"{nome}: peso vivo total das saídas", "kg", f"={{{x}_sai}}*{{{G}}}+{{{x}_Kout}}", "int")
    M.row(f"{x}_kgest", f"{nome}: peso vivo do estoque no fim do mês", "kg", f"={{{x}_pres}}*{{{G}}}+{{{x}_sumK}}-{{{x}_kgsai}}", "int", "last")


def build_precos(wb):
    M = Monthly(wb, "Pr", "Precos", "PREÇOS — curvas mensais", "Preço = base × sazonalidade × ciclo × choque de sensibilidade. Moeda constante.")
    M.sec("Animais")
    M.row("pa", "Arroba do boi gordo", "R$/@", "=[p_arroba]*[saz_arroba|m]*[ciclo_arroba|y]*[f_arroba]", "num2", "avg")
    M.row("pvaca", "Arroba da vaca", "R$/@", "={pa}*(1-[des_vaca])", "num2", "avg")
    M.row("pbz", "Bezerro desmamado", "R$/kg vivo", "=[p_bez_kg]*[saz_repos|m]*[ciclo_repos|y]*[f_repos]", "num2", "avg")
    M.row("pbza", "Bezerra desmamada", "R$/kg vivo", "={pbz}*(1-[des_bezerra])", "num2", "avg")
    M.row("pbm", "Boi magro", "R$/kg vivo", "=[p_bm_kg]*[saz_repos|m]*[ciclo_repos|y]*[f_repos]", "num2", "avg")
    M.row("pmatr", "Matriz", "R$/cab", "=[p_matriz]*[ciclo_repos|y]*[f_repos]", "brl", "avg")
    M.row("ptouro", "Touro", "R$/cab", "=[p_touro]*[ciclo_repos|y]*[f_repos]", "brl", "avg")
    M.row("pgv_p", "Boi gordo a pasto em R$/kg vivo", "R$/kg vivo", "={pa}*[rend_p]/15", "num2", "avg", note="Arroba × rendimento de carcaça / 15 kg.")
    M.row("pgv_s", "Boi gordo de semiconfinamento em R$/kg vivo", "R$/kg vivo", "={pa}*[rend_s]/15", "num2", "avg")
    M.row("pgv_c", "Boi gordo de confinamento em R$/kg vivo", "R$/kg vivo", "={pa}*[rend_c]/15", "num2", "avg")
    M.sec("Grãos e ração (R$/t de matéria natural)")
    M.row("pmil", "Milho — compra", "R$/t", "=[pi_mil]*[saz_graos|m]*[ciclo_graos|y]*[f_racao]", "brl", "avg")
    M.row("pmil_v", "Milho — venda", "R$/t", "={pmil}-[spread_milho]/60*1000", "brl", "avg")
    M.row("psoja", "Soja — venda", "R$/t", "=[p_soja_sc]/60*1000*[ciclo_graos|y]*[f_racao]", "brl", "avg")
    M.row("psil", "Silagem de milho — compra", "R$/t", "=[pi_sil]*[ciclo_graos|y]*[f_racao]", "brl", "avg")
    M.row("pfar", "Farelo de soja", "R$/t", "=[pi_far]*[ciclo_graos|y]*[f_racao]", "brl", "avg")
    M.row("pnuc", "Núcleo para confinamento/semi", "R$/t", "=[pi_nuc]*[f_racao]", "brl", "avg")
    M.row("psal", "Sal mineral", "R$/t", "=[pi_sal]*[f_racao]", "brl", "avg")
    M.row("pprot", "Proteinado", "R$/t", "=[pi_prot]*[f_racao]", "brl", "avg")
    M.row("pvol", "Volumoso emergencial", "R$/t MS", "=[p_vol]*[f_racao]", "brl", "avg")
    return M


def build_rebanho(wb):
    M = Monthly(wb, "Reb", "Rebanho", "REBANHO — fluxo de cabeças e peso por categoria",
                "Estoque final = inicial + nascimentos + compras + transferências − mortes − vendas. Cabeças fracionárias (modelo de planejamento).")
    M.sec("CRIA — matrizes")
    M.row("comp_matr", "Compra de matrizes", "cab", "=IF({t}=[mes_compra_matr],[matr_ini],0)", "num")
    M.row("nov_incorp", "Novilhas incorporadas como matrizes", "cab",
          "=IF({t}>[meses_nov],INDEX({nov_ret|prev},{t}-[meses_nov])*(1-[mort_ad]*[f_mort]*[meses_nov]/12),0)", "num",
          note="Novilhas retidas há [meses da desmama à 1ª monta] meses, líquidas da mortalidade do período.")
    M.row("matr_morte", "Mortes de matrizes", "cab", "={matr|p}*[mort_ad]*[f_mort]/12", "num2")
    M.row("matr_desc", "Descarte de matrizes (venda para abate)", "cab", "=IF({mes}=[mes_descarte],{matr|p}*[descarte_matr],0)", "num")
    M.row("matr", "Matrizes — estoque final", "cab", "={matr|p}+{comp_matr}+{nov_incorp}-{matr_morte}-{matr_desc}", "num", "last", bold=True)
    M.sec("CRIA — bezerros")
    M.row("nasc", "Nascimentos", "cab",
          "=INDEX({matr|cum},MAX(1,{t}-[gest]))*IF({t}<=12,[pct_prenhes],MIN(0.98,[natal]*[f_natal]))*[dist_partos|m]", "num",
          note="Matrizes existentes 9 meses antes × taxa de natalidade × % dos partos do mês. Nos 12 primeiros meses usa a taxa de parição das matrizes compradas.")
    M.row("bez_morte", "Mortes de bezerros até a desmama", "cab", "={nasc}*[mort_bez]*[f_mort]", "num2")
    M.row("desm", "Desmamados (machos + fêmeas)", "cab", "=IF({t}>[idade_desm],INDEX({nasc|prev},{t}-[idade_desm])*(1-[mort_bez]*[f_mort]),0)", "num")
    M.row("bez_pe", "Bezerros ao pé — estoque final", "cab", "={bez_pe|p}+{nasc}-{bez_morte}-{desm}", "num", "last", bold=True)
    M.row("desm_m", "Machos desmamados", "cab", "={desm}*[pct_machos]", "num")
    M.row("desm_f", "Fêmeas desmamadas", "cab", "={desm}-{desm_m}", "num")
    M.row("desm_m_transf", "Machos transferidos para a recria", "cab", "={desm_m}*[recria_on]", "num")
    M.row("desm_m_venda", "Machos vendidos à desmama", "cab", "={desm_m}-{desm_m_transf}", "num")
    M.row("nov_ret", "Fêmeas retidas para reposição", "cab", "={desm_f}*[pct_ret]", "num")
    M.row("bezerras_venda", "Bezerras vendidas à desmama", "cab", "={desm_f}-{nov_ret}", "num")
    M.sec("CRIA — novilhas de reposição e touros")
    M.row("nov_morte", "Mortes de novilhas (lançadas na retenção)", "cab", "={nov_ret}*[mort_ad]*[f_mort]*[meses_nov]/12", "num2")
    M.row("nov", "Novilhas de reposição — estoque final", "cab", "={nov|p}+{nov_ret}-{nov_morte}-{nov_incorp}", "num", "last", bold=True)
    M.row("touro_desc", "Descarte de touros", "cab", "={touros|p}*[desc_touro]/12", "num2")
    M.row("comp_touro", "Compra de touros", "cab", "=MAX(0,{matr}/[rel_touro]-({touros|p}-{touro_desc}))", "num2",
          note="Compra o necessário para manter a relação vacas/touro.")
    M.row("touros", "Touros — estoque final", "cab", "={touros|p}-{touro_desc}+{comp_touro}", "num2", "last", bold=True)

    M.sec("GANHO ACUMULADO POR SISTEMA (kg por cabeça desde o mês 1)")
    for k, nm, g in (("G_rec", "recria a pasto", "gmd_rec"), ("G_p", "engorda a pasto", "gmd_p"),
                     ("G_s", "semiconfinamento", "gmd_s"), ("G_c", "confinamento", "gmd_c")):
        M.row(k, f"Ganho acumulado — {nm}", "kg", f"={{{k}|p}}+[{g}|m]*[f_gmd]*[dias]", "num", None,
              note="Soma mês a mês de GMD × dias. É a 'régua' que dá o peso de qualquer lote sem matriz lote × mês.")

    M.sec("RECRIA — lotes")
    M.row("rec_comp", "Compra de bezerros", "cab", "=[bez_ano]*[perfil_bez|m]*[fator_compra|y]*[recria_on]", "num")
    stage(M, "rec", "Recria", "G_rec", "peso_bm", "mort_rec", "={rec_comp}+{desm_m_transf}", "=({rec_comp}+{desm_m_transf})*[peso_desm_m]")
    M.row("rec_venda", "Bois magros vendidos (engorda desligada)", "cab", "={rec_sai}*(1-[eng_on])", "num")
    M.row("transito", "Bois magros em transferência para a engorda (entram no mês seguinte)", "cab", "={rec_sai}*[eng_on]", "num", None)

    M.sec("ENGORDA — entradas")
    M.row("comp_bm", "Compra de bois magros", "cab", "=[bm_ano]*[perfil_bm|m]*[fator_compra|y]*[eng_on]", "num")
    M.row("eng_ent", "Entradas totais na engorda", "cab", "={transito|p}+{comp_bm}", "num")
    M.row("eng_kgent", "Peso total das entradas na engorda", "kg", "={rec_kgsai|p}*[eng_on]+{comp_bm}*[peso_bm]", "int")
    for x, nm, G, alvo, mort, mix in (("ep", "Engorda a pasto", "G_p", "peso_ab_p", "mort_p", "mix_pasto"),
                                      ("es", "Semiconfinamento", "G_s", "peso_ab_s", "mort_s", "mix_semi"),
                                      ("ec", "Confinamento", "G_c", "peso_ab_c", "mort_c", "mix_conf")):
        M.sec(f"ENGORDA — {nm.upper()} — lotes")
        stage(M, x, nm, G, alvo, mort, f"={{eng_ent}}*[{mix}]", f"={{eng_kgent}}*[{mix}]")

    M.sec("PESO VIVO POR CATEGORIA (base da nutrição e da lotação)")
    M.row("pv_matr", "Peso vivo — matrizes", "kg", "={matr}*[peso_matr]", "int", "avg")
    M.row("pv_nov", "Peso vivo — novilhas", "kg", "={nov}*[peso_nov]", "int", "avg")
    M.row("pv_touro", "Peso vivo — touros", "kg", "={touros}*[peso_touro]", "int", "avg")
    M.row("pv_bez", "Peso vivo — bezerros ao pé", "kg", "={bez_pe}*[peso_bez]", "int", "avg")
    M.row("pv_rec", "Peso vivo — recria", "kg", "={rec_pv}", "int", "avg")
    M.row("pv_ep", "Peso vivo — engorda a pasto", "kg", "={ep_pv}", "int", "avg")
    M.row("pv_es", "Peso vivo — semiconfinamento", "kg", "={es_pv}", "int", "avg")
    M.row("pv_ec", "Peso vivo — confinamento", "kg", "={ec_pv}", "int", "avg")
    M.sec("LOTAÇÃO")
    M.row("ua_cria", "UA em pasto — cria", "UA", "=SUM({pv_matr|to:pv_bez})/[kg_ua]", "num", "avg")
    M.row("ua_rec", "UA em pasto — recria", "UA", "={pv_rec}/[kg_ua]", "num", "avg")
    M.row("ua_eng", "UA em pasto — engorda (pasto + semi)", "UA", "=({pv_ep}+{pv_es})/[kg_ua]", "num", "avg")
    M.row("ua_pasto", "UA em pasto — total", "UA", "={ua_cria}+{ua_rec}+{ua_eng}", "num", "avg", bold=True)
    M.row("ua_total", "UA total (inclui confinamento)", "UA", "={ua_pasto}+{pv_ec}/[kg_ua]", "num", "avg")
    M.row("lotacao", "Lotação", "UA/ha", "=IF([area_pasto]>0,{ua_pasto}/[area_pasto],0)", "num2", "avg", bold=True)
    M.row("cab_total", "Rebanho total no fim do mês", "cab",
          "={matr}+{nov}+{touros}+{bez_pe}+{rec_est}+{ep_est}+{es_est}+{ec_est}+{transito}", "num", "last", bold=True)
    M.row("cab_vend", "Cabeças vendidas", "cab",
          "={matr_desc}+{touro_desc}+{desm_m_venda}+{bezerras_venda}+{rec_venda}+{ep_sai}+{es_sai}+{ec_sai}", "num")

    M.sec("VALOR DE MERCADO DO REBANHO (valor justo, base do balanço)")
    M.row("v_cria", "Valor — rebanho de cria", "R$",
          "={matr}*{Pr!pmatr}+{nov}*[peso_nov]*{Pr!pbza}+{touros}*{Pr!ptouro}*[f_touro_val]+{bez_pe}*[f_bez_val]*[peso_desm_m]*{Pr!pbz}",
          "brl", "last", note="Matriz e touro por cabeça; novilha pelo peso × preço da bezerra; bezerro ao pé como % do desmamado.")
    M.row("v_rec", "Valor — recria", "R$",
          "=IF({rec_est}>0.0001,{rec_kgest}*({Pr!pbz}+({Pr!pbm}-{Pr!pbz})*MIN(1,MAX(0,({rec_kgest}/{rec_est}-[peso_desm_m])/([peso_bm]-[peso_desm_m])))),0)",
          "brl", "last", note="Peso em estoque × R$/kg interpolado entre o preço do bezerro e o do boi magro conforme o peso médio.")
    for x, pg, alvo in (("ep", "pgv_p", "peso_ab_p"), ("es", "pgv_s", "peso_ab_s"), ("ec", "pgv_c", "peso_ab_c")):
        M.row(f"v_{x}", f"Valor — engorda ({x})", "R$",
              f"=IF({{{x}_est}}>0.0001,{{{x}_kgest}}*({{Pr!pbm}}+({{Pr!{pg}}}-{{Pr!pbm}})*MIN(1,MAX(0,({{{x}_kgest}}/{{{x}_est}}-[peso_bm])/([{alvo}]-[peso_bm])))),0)",
              "brl", "last")
    M.row("v_trans", "Valor — bois magros em transferência", "R$", "={rec_kgsai}*[eng_on]*{Pr!pbm}", "brl", "last")
    M.row("v_eng", "Valor — engorda total", "R$", "={v_ep}+{v_es}+{v_ec}+{v_trans}", "brl", "last")
    M.row("v_total", "VALOR TOTAL DO REBANHO", "R$", "={v_cria}+{v_rec}+{v_eng}", "brl", "last", bold=True)

    M.sec("RECONCILIAÇÃO DE CABEÇAS (teste)")
    M.row("rc_ent", "Entradas externas (compras + nascimentos)", "cab", "={comp_matr}+{comp_touro}+{nasc}+{rec_comp}+{comp_bm}", "num")
    M.row("rc_morte", "Mortes totais", "cab", "={matr_morte}+{nov_morte}+{bez_morte}+{rec_morte}+{ep_morte}+{es_morte}+{ec_morte}", "num2")
    M.row("rc_saldo", "Estoque teórico (entradas − mortes − vendas acumuladas)", "cab", "={rc_saldo|p}+{rc_ent}-{rc_morte}-{cab_vend}", "num", "last")
    M.row("rc_dif", "Diferença para o estoque do modelo (deve ser 0)", "cab", "={rc_saldo}-{cab_total}", "num2", "max")
    return M


def build_nutricao(wb):
    M = Monthly(wb, "N", "Nutricao", "NUTRIÇÃO — balanço forrageiro e demanda de ração",
                "Demanda = peso vivo × consumo (% PV/dia) × dias. MS = matéria seca; MN = matéria natural (o que se compra).")
    sh, r1, c0 = PREM["diet1"]
    r8 = PREM["diet8"][1]

    def sp(a, b, ra, rb, j):
        col = L(c0 + j)
        return f"SUMPRODUCT({{Reb!{a}|to:{b}}},Premissas!${col}${ra}:${col}${rb})"

    M.sec("BALANÇO FORRAGEIRO (t de matéria seca)")
    M.row("f_oferta", "Oferta de forragem aproveitável", "t MS", "=[area_pasto]*[prod_pasto|m]/1000", "num")
    M.row("f_dem", "Demanda de pasto do rebanho", "t MS", "=" + sp("pv_matr", "pv_ec", r1, r8, 0) + "*[dias]/1000", "num")
    M.row("f_saldo", "Saldo (estoque diferido + oferta − demanda)", "t MS", "={f_est|p}*(1-[perda_forr])+{f_oferta}-{f_dem}", "num", None)
    M.row("f_est", "Estoque de forragem diferida", "t MS", "=MIN(MAX(0,{f_saldo}),[cap_forr]*[area_pasto]/1000)", "num", "avg",
          note="Sobra das águas carregada para a seca, limitada à capacidade de vedação e sujeita a perda mensal.")
    M.row("f_def", "Déficit de forragem (coberto com volumoso comprado)", "t MS", "=MAX(0,-{f_saldo})", "num", bold=True)
    M.row("f_custo", "Custo do volumoso emergencial", "R$", "={f_def}*{Pr!pvol}", "brl")

    M.sec("DEMANDA DE RAÇÃO E SUPLEMENTOS POR UNIDADE (t de matéria natural)")
    units = (("cria", "pv_matr", "pv_bez", r1, r1 + 3), ("rec", "pv_rec", "pv_rec", r1 + 4, r1 + 4), ("eng", "pv_ep", "pv_ec", r1 + 5, r8))
    names = {"sil": "Silagem de milho", "mil": "Milho grão", "far": "Farelo de soja", "nuc": "Núcleo", "sal": "Sal mineral", "prot": "Proteinado"}
    un = {"cria": "cria", "rec": "recria", "eng": "engorda"}
    for j, k in enumerate(["sil", "mil", "far", "nuc", "sal", "prot"], 1):
        for u, a, b, ra, rb in units:
            seca = "*{seca}" if k == "prot" else ""
            M.row(f"d_{k}_{u}", f"{names[k]} — {un[u]}", "t MN",
                  "=" + sp(a, b, ra, rb, j) + f"*[dias]/1000/[ms_{k}]/(1-[pd_{k}]){seca}", "num2")
        M.row(f"d_{k}", f"{names[k]} — total", "t MN", f"={{d_{k}_cria}}+{{d_{k}_rec}}+{{d_{k}_eng}}", "num", bold=True)

    M.sec("CUSTO DA ALIMENTAÇÃO A PREÇO DE MERCADO, POR UNIDADE (base do preço de transferência)")
    for u in ("cria", "rec", "eng"):
        M.row(f"cf_{u}", f"Ração e suplementos consumidos — {un[u]}", "R$",
              "=" + "+".join(f"{{d_{k}_{u}}}*{{Pr!p{k}}}" for k in ["sil", "mil", "far", "nuc", "sal", "prot"]), "brl")
    M.row("cf_tot", "Ração e suplementos consumidos — total a mercado", "R$", "={cf_cria}+{cf_rec}+{cf_eng}", "brl", bold=True)
    return M


def build_lavoura(wb):
    M = Monthly(wb, "Lv", "Lavoura", "LAVOURA E SUPRIMENTO DE GRÃOS — produzir ou comprar",
                "Produção própria abastece o estoque; o gado consome; falta é comprada e excedente de milho é vendido.")
    crops = (("mi", "Milho safrinha", "a_milho", "*60/1000"), ("si", "Milho silagem", "a_sil", ""), ("so", "Soja", "a_soja", "*60/1000"))
    M.sec("PRODUÇÃO E CUSTOS POR CULTURA")
    for k, nm, area, conv in crops:
        M.row(f"pl_{k}", f"{nm}: custo de plantio e tratos", "R$", f"=IF({{mes}}=[pl_{k}],[{area}]*[custo_{k}]*[pp_{k}],0)", "brl")
        M.row(f"colhe_{k}", f"{nm}: há colheita neste mês? (1 = sim)", "flag",
              f"=IF(AND({{mes}}=[co_{k}],{{t}}>MOD([co_{k}]-[pl_{k}],12)),1,0)", "idx", None,
              note="Só colhe se já houve um plantio dentro do horizonte do modelo.")
        M.row(f"cc_{k}", f"{nm}: custo de colheita", "R$", f"={{colhe_{k}}}*[{area}]*[custo_{k}]*(1-[pp_{k}])", "brl")
        M.row(f"prod_{k}", f"{nm}: produção", "t", f"={{colhe_{k}}}*[{area}]*[prod_{k}]{conv}", "num")
    M.row("lav_custo", "Custo total de lavoura", "R$", "={pl_mi}+{cc_mi}+{pl_si}+{cc_si}+{pl_so}+{cc_so}", "brl", bold=True)
    M.sec("MILHO GRÃO — estoque (t)")
    M.row("mi_disp", "Disponível (estoque anterior + produção)", "t", "={mi_est|p}+{prod_mi}", "num", None)
    M.row("mi_cons", "Consumo do rebanho", "t", "={N!d_mil}", "num")
    M.row("mi_compra", "Compra externa", "t", "=MAX(0,{mi_cons}-{mi_disp})", "num")
    M.row("mi_venda", "Venda do excedente acima da capacidade de armazenagem", "t", "=MAX(0,{mi_disp}-{mi_cons}-[cap_armazem])", "num")
    M.row("mi_est", "Estoque final", "t", "={mi_disp}+{mi_compra}-{mi_cons}-{mi_venda}", "num", "last", bold=True)
    M.sec("SILAGEM — estoque (t MN)")
    M.row("si_disp", "Disponível (estoque anterior + produção)", "t", "={si_est|p}+{prod_si}", "num", None)
    M.row("si_cons", "Consumo do rebanho", "t", "={N!d_sil}", "num")
    M.row("si_compra", "Compra externa", "t", "=MAX(0,{si_cons}-{si_disp})", "num")
    M.row("si_est", "Estoque final", "t", "={si_disp}+{si_compra}-{si_cons}", "num", "last", bold=True)
    M.sec("VALORES (R$)")
    M.row("r_soja", "Receita de soja", "R$", "={prod_so}*{Pr!psoja}", "brl")
    M.row("r_milho", "Receita de milho excedente", "R$", "={mi_venda}*{Pr!pmil_v}", "brl")
    M.row("c_milho", "Compra de milho", "R$", "={mi_compra}*{Pr!pmil}", "brl")
    M.row("c_sil", "Compra de silagem", "R$", "={si_compra}*{Pr!psil}", "brl")
    M.row("transf", "Transferência interna: consumo do rebanho a preço de mercado", "R$", "={mi_cons}*{Pr!pmil}+{si_cons}*{Pr!psil}", "brl",
          note="Receita gerencial da unidade Lavoura; custo das unidades de pecuária. Elimina-se no consolidado.")
    M.row("v_est", "Valor do estoque de grãos e silagem", "R$", "={mi_est}*{Pr!pmil}+{si_est}*{Pr!psil}", "brl", "last")
    M.row("arr_imp", "Arrendamento imputado da área de lavoura", "R$", "=[area_lav]*[arr_lav]/12", "brl")
    return M


def build_operacional(wb):
    M = Monthly(wb, "O", "Operacional", "OPERACIONAL — receitas, compras e custos (regime de competência)",
                "Valores positivos. Os sinais são aplicados na DRE e no Fluxo de Caixa.")
    M.sec("RECEITAS")
    for x, nm, rend in (("ep", "pasto", "rend_p"), ("es", "semiconfinamento", "rend_s"), ("ec", "confinamento", "rend_c")):
        M.row(f"arr_{x}", f"Arrobas vendidas — boi gordo de {nm}", "@", f"={{Reb!{x}_kgsai}}*[{rend}]/15", "num", note="Peso vivo × rendimento de carcaça / 15.")
    M.row("arr_tot", "Arrobas de boi gordo vendidas", "@", "={arr_ep}+{arr_es}+{arr_ec}", "num", bold=True)
    M.row("r_gordo", "Venda de boi gordo", "R$", "={arr_tot}*{Pr!pa}", "brl")
    M.row("r_bm", "Venda de boi magro", "R$", "={Reb!rec_kgsai}*(1-[eng_on])*{Pr!pbm}", "brl")
    M.row("r_bez", "Venda de bezerros desmamados", "R$", "={Reb!desm_m_venda}*[peso_desm_m]*{Pr!pbz}", "brl")
    M.row("r_bza", "Venda de bezerras desmamadas", "R$", "={Reb!bezerras_venda}*[peso_desm_f]*{Pr!pbza}", "brl")
    M.row("r_vaca", "Venda de vacas de descarte", "R$", "={Reb!matr_desc}*[peso_matr]*[rend_vaca]/15*{Pr!pvaca}", "brl")
    M.row("r_touro", "Venda de touros de descarte", "R$", "={Reb!touro_desc}*[peso_touro]*[rend_touro]/15*{Pr!pvaca}", "brl")
    M.row("r_anim", "Receita de animais", "R$", "={r_gordo}+{r_bm}+{r_bez}+{r_bza}+{r_vaca}+{r_touro}", "brl", bold=True)
    M.row("r_graos", "Receita de grãos (soja + milho excedente)", "R$", "={Lv!r_soja}+{Lv!r_milho}", "brl")
    M.row("r_arr", "Receita de arrendamento de pasto a terceiros", "R$", "=[a_terc]*[arr_pasto]/12", "brl",
          note="Renda da terra que o capital disponível não consegue ocupar com gado próprio. Tributação simplificada: entra na base do IRPF rural, sem Funrural.")
    M.row("r_total", "RECEITA BRUTA", "R$", "={r_anim}+{r_graos}+{r_arr}", "brl", bold=True)
    M.sec("DEDUÇÕES DA RECEITA")
    M.row("d_funrural", "Funrural e ICMS", "R$", "=({r_anim}+{r_graos})*([funrural]+[icms])", "brl")
    M.row("d_taxas", "Taxas por cabeça, comissão e frete de venda", "R$", "={Reb!cab_vend}*([taxa_cab]+[frete_venda])+{r_anim}*[com_venda]", "brl")
    M.row("ded", "Deduções totais", "R$", "={d_funrural}+{d_taxas}", "brl", bold=True)
    M.sec("COMPRA DE ANIMAIS")
    M.row("c_matr", "Matrizes", "R$", "={Reb!comp_matr}*{Pr!pmatr}", "brl")
    M.row("c_touro", "Touros", "R$", "={Reb!comp_touro}*{Pr!ptouro}", "brl")
    M.row("c_bez", "Bezerros", "R$", "={Reb!rec_comp}*[peso_desm_m]*{Pr!pbz}", "brl")
    M.row("c_bm", "Bois magros", "R$", "={Reb!comp_bm}*[peso_bm]*{Pr!pbm}", "brl")
    M.row("aq_cria", "Comissão e frete de compra — cria", "R$", "=({c_matr}+{c_touro})*[com_compra]+({Reb!comp_matr}+{Reb!comp_touro})*[frete_compra]", "brl")
    M.row("aq_rec", "Comissão e frete de compra — recria", "R$", "={c_bez}*[com_compra]+{Reb!rec_comp}*[frete_compra]", "brl")
    M.row("aq_eng", "Comissão e frete de compra — engorda", "R$", "={c_bm}*[com_compra]+{Reb!comp_bm}*[frete_compra]", "brl")
    M.row("compras", "Compras de animais totais", "R$", "={c_matr}+{c_touro}+{c_bez}+{c_bm}+{aq_cria}+{aq_rec}+{aq_eng}", "brl", bold=True)
    M.sec("TRANSFERÊNCIAS INTERNAS A PREÇO DE MERCADO (não são caixa)")
    M.row("t_cr", "Cria → recria: bezerros desmamados", "R$", "={Reb!desm_m_transf}*[peso_desm_m]*{Pr!pbz}", "brl")
    M.row("t_re", "Recria → engorda: bois magros", "R$", "={Reb!rec_kgsai}*[eng_on]*{Pr!pbm}", "brl")
    M.sec("ALIMENTAÇÃO COMPRADA (desembolso)")
    M.row("a_conc", "Farelo, núcleo, sal mineral e proteinado", "R$",
          "={N!d_far}*{Pr!pfar}+{N!d_nuc}*{Pr!pnuc}+{N!d_sal}*{Pr!psal}+{N!d_prot}*{Pr!pprot}", "brl")
    M.row("a_graos", "Milho e silagem comprados", "R$", "={Lv!c_milho}+{Lv!c_sil}", "brl")
    M.row("a_vol", "Volumoso emergencial", "R$", "={N!f_custo}", "brl")
    M.row("alim", "Alimentação comprada total", "R$", "={a_conc}+{a_graos}+{a_vol}", "brl", bold=True)
    M.sec("OUTROS CUSTOS VARIÁVEIS")
    M.row("s_cria", "Sanidade e reprodução — cria", "R$", "={Reb!matr}*([san_cria]+[repro])/12", "brl")
    M.row("s_rec", "Sanidade — recria", "R$", "={Reb!rec_pres}*[san_rec]/12", "brl")
    M.row("s_eng", "Sanidade e protocolo de entrada — engorda", "R$",
          "=({Reb!ep_pres}+{Reb!es_pres}+{Reb!ec_pres})*[san_eng]/12+{Reb!ec_ent}*[prot_conf]", "brl")
    M.row("o_eng", "Operação de confinamento e semiconfinamento", "R$", "=({Reb!ec_pres}*[op_conf]+{Reb!es_pres}*[op_semi])*[dias]", "brl")
    M.row("m_pasto", "Manutenção de pastagem", "R$", "=[area_pasto]*[manut_pasto]/12", "brl")
    M.row("var_out", "Outros custos variáveis totais", "R$", "={s_cria}+{s_rec}+{s_eng}+{o_eng}+{m_pasto}", "brl", bold=True)
    M.sec("CUSTOS FIXOS")
    M.row("fx_mo", "Mão de obra", "R$", "=[mao_obra]*[f_fixos]", "brl")
    M.row("fx_ger", "Energia, administração e assistência técnica", "R$", "=([energia]+[admin]+[assist])*[f_fixos]", "brl")
    M.row("fx_man", "Manutenção de benfeitorias e equipamentos", "R$", "=[capex_base]*[manut_benf]/12*[f_fixos]", "brl")
    M.row("fx_itr", "ITR e taxas anuais", "R$", "=IF({mes}=[mes_itr],[itr],0)", "brl")
    M.row("fx_arr", "Arrendamento pago (regime de terra = 2)", "R$", "=IF([regime_terra]=2,([area_pasto]+[area_benf])*[arr_pasto]+[area_lav]*[arr_lav],0)/12", "brl")
    M.row("fixos", "Custos fixos totais", "R$", "={fx_mo}+{fx_ger}+{fx_man}+{fx_itr}+{fx_arr}", "brl", bold=True)
    return M


def build_capex(wb, P):
    M = Monthly(wb, "K", "Capex", "INVESTIMENTOS — cronograma e depreciação",
                "Cada item é reposto ao fim da vida útil pelo valor líquido do residual. Depreciação linear.")
    M.sec("DESEMBOLSO POR ITEM")
    n = len(P.cap_rows)
    for i, r in enumerate(P.cap_rows):
        lab = P.ws.cell(r, 1).value
        a = lambda c: f"Premissas!${c}${r}"
        M.row(f"cx{i}", lab, "R$",
              f"=IF({a('J')}>0,IF({{t}}={a('F')},{a('J')},IF(AND({{t}}>{a('F')},MOD({{t}}-{a('F')},{a('G')}*12)=0),{a('J')}*(1-{a('H')})*[reinv_on],0)),0)", "brl")
    M.row("capex", "Investimento em benfeitorias e equipamentos", "R$", "=SUM({cx0|to:cx%d})" % (n - 1), "brl", bold=True)
    M.row("terra", "Aquisição de terra (regime = 3)", "R$", "=IF(AND([regime_terra]=3,{t}=1),[area_total]*[valor_ha],0)", "brl")
    M.sec("DEPRECIAÇÃO POR ITEM")
    for i, r in enumerate(P.cap_rows):
        lab = P.ws.cell(r, 1).value
        a = lambda c: f"Premissas!${c}${r}"
        M.row(f"dp{i}", lab, "R$",
              f"=IF(AND({{t}}>={a('F')},OR([reinv_on]=1,{{t}}<{a('F')}+{a('G')}*12)),{a('J')}*(1-{a('H')})/({a('G')}*12),0)", "brl")
    M.row("deprec", "Depreciação total", "R$", "=SUM({dp0|to:dp%d})" % (n - 1), "brl", bold=True)
    M.sec("SALDOS")
    M.row("imob", "Imobilizado líquido (sem terra)", "R$", "={imob|p}+{capex}-{deprec}", "brl", "last", bold=True)
    M.row("terra_s", "Terra adquirida (custo)", "R$", "={terra_s|p}+{terra}", "brl", "last")
    return M


def build_fin(wb):
    M = Monthly(wb, "F", "Divida_Tributos", "DÍVIDA E TRIBUTOS", "Crédito rural (juros mensais, amortização constante após a carência) e IRPF da atividade rural.")
    for k in (1, 2):
        M.sec(f"LINHA DE CRÉDITO {k}")
        M.row(f"lib{k}", "Liberação", "R$", f"=IF({{t}}=[l{k}_mes],[l{k}_val],0)", "brl")
        M.row(f"am{k}", "Amortização", "R$", f"=IF(AND({{t}}>[l{k}_mes]+[l{k}_car],{{t}}<=[l{k}_mes]+[l{k}_car]+[l{k}_n]),[l{k}_val]/[l{k}_n],0)", "brl")
        M.row(f"ju{k}", "Juros", "R$", f"={{sd{k}|p}}*((1+[l{k}_tx])^(1/12)-1)", "brl")
        M.row(f"sd{k}", "Saldo devedor", "R$", f"={{sd{k}|p}}+{{lib{k}}}-{{am{k}}}", "brl", "last", bold=True)
    M.sec("TOTAIS DA DÍVIDA")
    M.row("lib", "Liberações", "R$", "={lib1}+{lib2}", "brl")
    M.row("amort", "Amortizações", "R$", "={am1}+{am2}", "brl")
    M.row("juros", "Juros", "R$", "={ju1}+{ju2}", "brl")
    M.row("divida", "Saldo devedor total", "R$", "={sd1}+{sd2}", "brl", "last", bold=True)
    M.sec("IRPF DA ATIVIDADE RURAL (apurado no fim de cada ano do modelo)")
    tab = "Premissas!" + f"${L(PREM['ir_tab'][2])}${PREM['ir_tab'][1]}:${L(PREM['ir_tab_end'][2])}${PREM['ir_tab_end'][1]}"
    T = lambda x: f"({x}*VLOOKUP({x},{tab},2,TRUE)-VLOOKUP({x},{tab},3,TRUE))"
    M.row("fim_ano", "Fim de ano? (1 = sim)", "flag", "=IF(MOD({t},12)=0,1,0)", "idx", None)
    M.row("rb_ano", "Receita bruta do ano", "R$", "=IF({fim_ano}=1,SUMIFS({O!r_total|all},$E$5:$DT$5,{ano}),0)", "brl")
    M.row("res_ano", "Resultado da atividade rural do ano (regime de caixa)", "R$",
          "=IF({fim_ano}=1,SUMIFS({FC!op_pre|all},$E$5:$DT$5,{ano})-SUMIFS({K!capex|all},$E$5:$DT$5,{ano})-SUMIFS({juros|all},$E$5:$DT$5,{ano}),0)",
          "brl", note="Receitas recebidas − despesas pagas − investimentos (dedutíveis, exceto terra nua) − juros.")
    M.row("prej", "Prejuízo acumulado a compensar", "R$", "=IF({fim_ano}=1,MAX(0,{prej|p}-{res_ano}),{prej|p})", "brl", "last")
    M.row("base_res", "Base pelo resultado (após compensar prejuízos)", "R$", "=IF({fim_ano}=1,MAX(0,{res_ano}-{prej|p}),0)", "brl")
    M.row("base_pres", "Base presumida (20% da receita bruta)", "R$", "={rb_ano}*[pres]", "brl")
    M.row("base", "Base tributável (a menor)", "R$", "=MIN({base_res},{base_pres})", "brl", bold=True)
    M.row("irpf", "IRPF devido", "R$", f"=IF({{base}}>0,{T('({base}+[outras_rendas])')}-{T('[outras_rendas]')},0)", "brl", bold=True,
          note="Imposto incremental: tabela progressiva sobre (base rural + outras rendas) menos o imposto sobre as outras rendas.")
    M.row("irpf_pago", "IRPF pago", "R$", "=IF({t}>[lag_irpf],INDEX({irpf|prev},{t}-[lag_irpf]),0)", "brl")
    M.row("irpf_ap", "IRPF a pagar (saldo)", "R$", "={irpf_ap|p}+{irpf}-{irpf_pago}", "brl", "last")
    return M


def build_dre(wb):
    M = Monthly(wb, "D", "DRE", "DRE GERENCIAL — consolidado mensal",
                "Rebanho e grãos avaliados a valor de mercado: a variação do estoque entra no resultado (CPC 29). Custos com sinal negativo.")
    M.sec("RESULTADO")
    M.row("rb", "Receita bruta", "R$", "={O!r_total}", "brl", bold=True)
    M.row("ded", "(−) Deduções", "R$", "=-{O!ded}", "brl")
    M.row("rl", "Receita líquida", "R$", "={rb}+{ded}", "brl", bold=True)
    M.row("compras", "(−) Compras de animais", "R$", "=-{O!compras}", "brl")
    M.row("dv_reb", "(+/−) Variação do valor do rebanho", "R$", "={Reb!v_total}-{Reb!v_total|p}", "brl",
          note="Crescimento, ganho de peso e variação de preço dos animais em estoque.")
    M.row("dv_gr", "(+/−) Variação do estoque de grãos e silagem", "R$", "={Lv!v_est}-{Lv!v_est|p}", "brl")
    M.row("alim", "(−) Alimentação comprada", "R$", "=-{O!alim}", "brl")
    M.row("var", "(−) Sanidade, operação e manutenção de pasto", "R$", "=-{O!var_out}", "brl")
    M.row("lav", "(−) Custos de lavoura", "R$", "=-{Lv!lav_custo}", "brl")
    M.row("mc", "Margem de contribuição", "R$", "={rl}+{compras}+{dv_reb}+{dv_gr}+{alim}+{var}+{lav}", "brl", bold=True)
    M.row("fixos", "(−) Custos fixos", "R$", "=-{O!fixos}", "brl")
    M.row("ebitda", "EBITDA", "R$", "={mc}+{fixos}", "brl", bold=True)
    M.row("dep", "(−) Depreciação", "R$", "=-{K!deprec}", "brl")
    M.row("jur", "(−) Juros", "R$", "=-{F!juros}", "brl")
    M.row("ir", "(−) IRPF da atividade rural", "R$", "=-{F!irpf}", "brl")
    M.row("ll", "LUCRO LÍQUIDO", "R$", "={ebitda}+{dep}+{jur}+{ir}", "brl", bold=True)
    return M


def build_fc(wb):
    M = Monthly(wb, "FC", "Fluxo_Caixa", "FLUXO DE CAIXA — método direto, mensal", "Entradas positivas, saídas negativas. Inclui avaliação por fluxo de caixa descontado.")
    lag = lambda row, l: f"IF([{l}]=0,{{{row}}},IF({{t}}>[{l}],INDEX({{{row}|prev}},{{t}}-[{l}]),0))"
    M.sec("OPERACIONAL")
    M.row("receb", "Recebimento de vendas", "R$", "=" + lag("O!r_total", "lag_rec"), "brl")
    M.row("ded", "Deduções pagas (Funrural, taxas)", "R$", "=-{O!ded}", "brl")
    M.row("compras", "Compras de animais", "R$", "=-{O!compras}", "brl")
    M.row("alim", "Pagamento de ração e suplementos", "R$", "=-" + lag("O!alim", "lag_pag"), "brl")
    M.row("var", "Sanidade, operação e manutenção de pasto", "R$", "=-{O!var_out}", "brl")
    M.row("lav", "Custos de lavoura", "R$", "=-{Lv!lav_custo}", "brl")
    M.row("fixos", "Custos fixos", "R$", "=-{O!fixos}", "brl")
    M.row("op_pre", "Fluxo operacional antes do IRPF", "R$", "={receb}+{ded}+{compras}+{alim}+{var}+{lav}+{fixos}", "brl", bold=True)
    M.row("ir", "IRPF pago", "R$", "=-{F!irpf_pago}", "brl")
    M.row("op", "FLUXO OPERACIONAL", "R$", "={op_pre}+{ir}", "brl", bold=True)
    M.sec("INVESTIMENTO")
    M.row("capex", "Benfeitorias e equipamentos", "R$", "=-{K!capex}", "brl")
    M.row("terra", "Aquisição de terra", "R$", "=-{K!terra}", "brl")
    M.row("inv", "FLUXO DE INVESTIMENTO", "R$", "={capex}+{terra}", "brl", bold=True)
    M.row("fcl", "FLUXO DE CAIXA LIVRE DO PROJETO", "R$", "={op}+{inv}", "brl", bold=True)
    M.sec("FINANCIAMENTO")
    M.row("aporte", "Aporte inicial de capital próprio", "R$", "=IF({t}=1,[capital],0)", "brl")
    M.row("lib", "Liberação de crédito", "R$", "={F!lib}", "brl")
    M.row("amort", "Amortização de crédito", "R$", "=-{F!amort}", "brl")
    M.row("jur", "Juros pagos", "R$", "=-{F!juros}", "brl")
    M.row("pre", "Caixa antes de aporte adicional", "R$", "={caixa|p}+{fcl}+{aporte}+{lib}+{amort}+{jur}", "brl", None)
    M.row("aporte_ad", "Aporte adicional dos sócios (cobre caixa abaixo do mínimo)", "R$", "=MAX(0,[caixa_min]-{pre})", "brl",
          note="Se aparecer valor aqui, o capital disponível não sustenta o cenário: reduza a escala, alongue o crédito ou aporte mais.")
    M.row("fin", "FLUXO DE FINANCIAMENTO", "R$", "={aporte}+{lib}+{amort}+{jur}+{aporte_ad}", "brl", bold=True)
    M.row("caixa", "SALDO DE CAIXA NO FIM DO MÊS", "R$", "={pre}+{aporte_ad}", "brl", "last", bold=True)
    M.sec("AVALIAÇÃO — FLUXO DE CAIXA DESCONTADO")
    M.row("cum", "Fluxo de caixa livre acumulado", "R$", "={cum|p}+{fcl}", "brl", "min",
          note="O mínimo desta linha (coluna C) é a exposição máxima de caixa: o capital que o projeto exige.")
    M.row("vt", "Valor terminal por liquidação (mês 120)", "R$",
          "=IF({t}=120,{Reb!v_total}*(1-[custo_liq])+{Lv!v_est}+{BP!receber}-{BP!fornec}-{F!irpf_ap}+{K!imob}+{K!terra_s}*(1+[valoriz])^10,0)", "brl",
          note="Rebanho a mercado menos custo de venda + estoques + recebíveis − obrigações + imobilizado líquido + terra adquirida corrigida. Não usa perpetuidade.")
    M.row("fcl_vt", "Fluxo livre + valor terminal", "R$", "={fcl}+{vt}", "brl")
    M.row("fd", "Fator de desconto", "fator", "=1/(1+[tx_desc])^({t}/12)", "fac", None)
    M.row("vp", "Valor presente do fluxo", "R$", "={fcl_vt}*{fd}", "brl")
    M.row("ref", "Referência: renda de arrendar toda a área útil a terceiros (sem pecuária própria)", "R$",
          "=IF([regime_terra]=2,0,[area_util]*[arr_pasto]/12)", "brl",
          note="Custo de oportunidade da terra. Se o VPL do cenário não superar o valor presente desta renda, arrendar a fazenda rende mais do que operar.")
    M.row("vp_ref", "Valor presente da renda de referência", "R$", "={ref}*{fd}", "brl")
    M.row("pb", "Marcador de payback (mês em que o acumulado fica ≥ 0 pela 1ª vez)", "mês nº",
          "=IF(AND({cum}>=0,COUNTIF({pb|prev},\">0\")=0),{t},0)", "idx", "max")
    M.row("fs", "Fluxo do sócio (aportes negativos; no mês 120 recebe caixa + valor terminal − dívida)", "R$",
          "=-{aporte}-{aporte_ad}+IF({t}=120,{caixa}+{vt}-{F!divida},0)", "brl")
    return M


def build_bp(wb):
    M = Monthly(wb, "BP", "Balanco", "BALANÇO PATRIMONIAL GERENCIAL — mensal", "Serve principalmente como teste de integridade: ativo = passivo + patrimônio em todos os meses.")
    M.sec("ATIVO")
    M.row("caixa", "Caixa", "R$", "={FC!caixa}", "brl", "last")
    M.row("receber", "Contas a receber", "R$", "={receber|p}+{O!r_total}-{FC!receb}", "brl", "last")
    M.row("graos", "Estoque de grãos e silagem", "R$", "={Lv!v_est}", "brl", "last")
    M.row("reb", "Rebanho a valor de mercado", "R$", "={Reb!v_total}", "brl", "last")
    M.row("imob", "Imobilizado líquido", "R$", "={K!imob}", "brl", "last")
    M.row("terra", "Terra adquirida", "R$", "={K!terra_s}", "brl", "last")
    M.row("ativo", "ATIVO TOTAL", "R$", "={caixa}+{receber}+{graos}+{reb}+{imob}+{terra}", "brl", "last", bold=True)
    M.sec("PASSIVO E PATRIMÔNIO LÍQUIDO")
    M.row("fornec", "Fornecedores de ração", "R$", "={fornec|p}+{O!alim}+{FC!alim}", "brl", "last")
    M.row("divida", "Crédito rural", "R$", "={F!divida}", "brl", "last")
    M.row("irpf", "IRPF a pagar", "R$", "={F!irpf_ap}", "brl", "last")
    M.row("capital", "Capital aportado pelos sócios", "R$", "={capital|p}+{FC!aporte}+{FC!aporte_ad}", "brl", "last")
    M.row("lucros", "Lucros acumulados", "R$", "={lucros|p}+{D!ll}", "brl", "last")
    M.row("passivo", "PASSIVO + PATRIMÔNIO LÍQUIDO", "R$", "={fornec}+{divida}+{irpf}+{capital}+{lucros}", "brl", "last", bold=True)
    M.row("dif", "Diferença (deve ser 0)", "R$", "={ativo}-{passivo}", "num2", "max")
    return M


def build_unidades(wb):
    M = Monthly(wb, "U", "Unidades", "RESULTADO POR UNIDADE DE NEGÓCIO — cria, recria, engorda, lavoura, estrutura",
                "Transferências internas a preço de mercado. Cada unidade paga arrendamento imputado pela terra que usa. A soma das unidades fecha com o EBITDA consolidado.")
    ded = lambda v: f"=-IF({{O!r_anim}}+{{O!r_graos}}>0,{{O!ded}}*({v})/({{O!r_anim}}+{{O!r_graos}}),0)"
    sh = lambda u: f"IF({{Reb!ua_pasto}}>0,{{Reb!{u}}}/{{Reb!ua_pasto}},0)"
    pool = "({O!m_pasto}+{O!a_vol})"
    arr = "([area_pasto]*[arr_pasto]/12)"
    M.sec("CRIA")
    M.row("cr_v", "Vendas externas (bezerros, bezerras, descartes)", "R$", "={O!r_bez}+{O!r_bza}+{O!r_vaca}+{O!r_touro}", "brl")
    M.row("cr_t", "(+) Transferência de bezerros para a recria", "R$", "={O!t_cr}", "brl")
    M.row("cr_c", "(−) Compras de matrizes e touros", "R$", "=-({O!c_matr}+{O!c_touro}+{O!aq_cria})", "brl")
    M.row("cr_dv", "(+/−) Variação do valor do rebanho de cria", "R$", "={Reb!v_cria}-{Reb!v_cria|p}", "brl")
    M.row("cr_d", "(−) Deduções", "R$", ded("{cr_v}"), "brl")
    M.row("cr_a", "(−) Ração e suplementos", "R$", "=-{N!cf_cria}", "brl")
    M.row("cr_s", "(−) Sanidade e reprodução", "R$", "=-{O!s_cria}", "brl")
    M.row("cr_p", "(−) Pasto: manutenção e volumoso (rateio por UA)", "R$", f"=-{pool}*{sh('ua_cria')}", "brl")
    M.row("cr_arr", "(−) Arrendamento imputado", "R$", f"=-{arr}*{sh('ua_cria')}", "brl")
    M.row("cr", "MARGEM DA CRIA", "R$", "=SUM({cr_v|to:cr_arr})", "brl", bold=True)
    M.sec("RECRIA")
    M.row("re_v", "Vendas externas de boi magro", "R$", "={O!r_bm}", "brl")
    M.row("re_t", "(+) Transferência de bois magros para a engorda", "R$", "={O!t_re}", "brl")
    M.row("re_ti", "(−) Bezerros recebidos da cria", "R$", "=-{O!t_cr}", "brl")
    M.row("re_c", "(−) Compras de bezerros", "R$", "=-({O!c_bez}+{O!aq_rec})", "brl")
    M.row("re_dv", "(+/−) Variação do valor do rebanho de recria", "R$", "={Reb!v_rec}-{Reb!v_rec|p}", "brl")
    M.row("re_d", "(−) Deduções", "R$", ded("{re_v}"), "brl")
    M.row("re_a", "(−) Ração e suplementos", "R$", "=-{N!cf_rec}", "brl")
    M.row("re_s", "(−) Sanidade", "R$", "=-{O!s_rec}", "brl")
    M.row("re_p", "(−) Pasto: manutenção e volumoso (rateio por UA)", "R$", f"=-{pool}*{sh('ua_rec')}", "brl")
    M.row("re_arr", "(−) Arrendamento imputado", "R$", f"=-{arr}*{sh('ua_rec')}", "brl")
    M.row("re", "MARGEM DA RECRIA", "R$", "=SUM({re_v|to:re_arr})", "brl", bold=True)
    M.sec("ENGORDA")
    M.row("en_v", "Vendas de boi gordo", "R$", "={O!r_gordo}", "brl")
    M.row("en_ti", "(−) Bois magros recebidos da recria", "R$", "=-{O!t_re}", "brl")
    M.row("en_c", "(−) Compras de bois magros", "R$", "=-({O!c_bm}+{O!aq_eng})", "brl")
    M.row("en_dv", "(+/−) Variação do valor do rebanho de engorda", "R$", "={Reb!v_eng}-{Reb!v_eng|p}", "brl")
    M.row("en_d", "(−) Deduções", "R$", ded("{en_v}"), "brl")
    M.row("en_a", "(−) Ração e suplementos", "R$", "=-{N!cf_eng}", "brl")
    M.row("en_s", "(−) Sanidade e operação de cocho", "R$", "=-({O!s_eng}+{O!o_eng})", "brl")
    M.row("en_p", "(−) Pasto: manutenção e volumoso (rateio por UA)", "R$", f"=-{pool}*{sh('ua_eng')}", "brl")
    M.row("en_arr", "(−) Arrendamento imputado", "R$", f"=-{arr}*{sh('ua_eng')}", "brl")
    M.row("en", "MARGEM DA ENGORDA", "R$", "=SUM({en_v|to:en_arr})", "brl", bold=True)
    M.sec("LAVOURA E SUPRIMENTO DE GRÃOS")
    M.row("la_v", "Vendas externas de soja e milho", "R$", "={O!r_graos}", "brl")
    M.row("la_t", "(+) Milho e silagem entregues ao rebanho (a mercado)", "R$", "={Lv!transf}", "brl")
    M.row("la_c", "(−) Milho e silagem comprados de terceiros", "R$", "=-{O!a_graos}", "brl")
    M.row("la_dv", "(+/−) Variação do estoque", "R$", "={Lv!v_est}-{Lv!v_est|p}", "brl")
    M.row("la_d", "(−) Deduções", "R$", ded("{la_v}"), "brl")
    M.row("la_k", "(−) Custos de produção da lavoura", "R$", "=-{Lv!lav_custo}", "brl")
    M.row("la_arr", "(−) Arrendamento imputado", "R$", "=-{Lv!arr_imp}", "brl")
    M.row("la", "MARGEM DA LAVOURA", "R$", "=SUM({la_v|to:la_arr})", "brl", bold=True)
    M.sec("ESTRUTURA (custos não rateados e dono da terra)")
    M.row("es_r", "(+) Arrendamento de pasto recebido de terceiros", "R$", "={O!r_arr}", "brl")
    M.row("es_f", "(−) Custos fixos", "R$", "=-{O!fixos}", "brl")
    M.row("es_arr", "(+) Arrendamento imputado recebido das unidades", "R$", "=-({cr_arr}+{re_arr}+{en_arr}+{la_arr})", "brl")
    M.row("es_p", "(−) Pasto ocioso (sem gado para ratear)", "R$", f"=-{pool}-({{cr_p}}+{{re_p}}+{{en_p}})", "brl")
    M.row("es", "RESULTADO DA ESTRUTURA", "R$", "={es_r}+{es_f}+{es_arr}+{es_p}", "brl", bold=True)
    M.sec("FECHAMENTO")
    M.row("soma", "Soma das unidades", "R$", "={cr}+{re}+{en}+{la}+{es}", "brl", bold=True)
    M.row("dif", "Diferença para o EBITDA consolidado (deve ser 0)", "R$", "={soma}-{D!ebitda}", "num2", "max")
    return M
