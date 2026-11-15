# -*- coding: utf-8 -*-
"""Saídas: Aposentadoria (veredito), Resumo_Anual, Painel, Checks e Instrucoes."""
from fw import *
import graficos as G
from openpyxl.formatting.rule import FormulaRule, CellIsRule

AP = "Aposentadoria"
APOS = []      # ("sec", título) | (chave, rótulo, unidade, f(), formato, nota)
NY = 69        # anos no resumo anual (2026 a 2094)


def A(k):
    return OUT[k]


def cr(code, key):
    return colrange(code, key)


def _s(t):
    APOS.append(("sec", t))


def _r(key, lab, unit, f, fmt="brl", nt="", hl=False):
    APOS.append((key, lab, unit, f, fmt, nt, hl))


# ====================================================================================== APOSENTADORIA
_s("1. LINHA DO TEMPO")
_r("idade_hoje_o", "Idade no início da simulação", "anos", lambda: f"={P('idade_hoje')}", "int")
_r("data_apos_o", "Mês da aposentadoria (aniversário)", "data", lambda: f"={P('data_apos')}", "date")
_r("t_star", "Último mês de trabalho (nº do mês)", "nº", lambda: f"={P('t_apos')}-1", "int")
_r("anos_acum", "Anos de acumulação", "anos", lambda: f"={A('t_star')}/12", "num")
_s("2. PATRIMÔNIO NA APOSENTADORIA")
_r("p65_nom", "Patrimônio financeiro na véspera da aposentadoria (nominal)", "R$",
   lambda: f"=INDEX({cr('Fluxo_Mensal', 'p_fim')},{A('t_star')})")
_r("idx65", "Índice de preços nessa data (hoje = 1,00)", "índice", lambda: f"=INDEX({cr('Macro', 'idx')},{A('t_star')})", "fac")
_r("p65_real", "Patrimônio financeiro aos 65 — em R$ de hoje", "R$ hoje", lambda: f"={A('p65_nom')}/{A('idx65')}", "brl",
   "Só aplicações financeiras: é o que gera renda.", True)
_r("imov65_real", "Imóvel (parte dela) — em R$ de hoje", "R$ hoje",
   lambda: f"=INDEX({cr('Fluxo_Mensal', 'imov_dela')},{A('t_star')})/{A('idx65')}", "brl", "Patrimônio ilíquido: não entra na renda.")
_r("pt65_real", "Patrimônio total (financeiro + imóvel − dívida) — R$ de hoje", "R$ hoje",
   lambda: f"=INDEX({cr('Fluxo_Mensal', 'pt')},{A('t_star')})/{A('idx65')}")
_r("quit65", "Saldo do financiamento quitado aos 65 (parte dela, R$ de hoje)", "R$ hoje",
   lambda: f"=INDEX({cr('Moradia', 'quit')},{A('t_star')})*(1-INDEX({cr('Macro', 'conj')},{A('t_star')}))/{A('idx65')}", "brl",
   "Zero quando o financiamento termina antes da aposentadoria.")
_s("3. RENDIMENTO DO PATRIMÔNIO NA APOSENTADORIA (premissas de longo prazo)")
_r("r_bruto", "Juro real bruto (antes do IR)", "% a.a.", lambda: f"={P('r_real_bruto_a')}", "pct2")
_r("r_liq_nom", "Rendimento nominal líquido de IR", "% a.a.", lambda: f"=(1+{P('r_liq_lp_m')})^12-1", "pct2")
_r("r_real_a", "Rendimento REAL líquido", "% a.a.", lambda: f"={P('r_real_lp_a')}", "pct2",
   "É a taxa que paga a aposentadoria. O IR incide também sobre a parte do rendimento que só repõe a inflação.", True)
_r("r_real_m", "Rendimento real líquido ao mês", "% a.m.", lambda: f"={P('r_real_lp_m')}", "pct3")
_r("ir_come", "Perda de juro real por causa do IR", "pp a.a.", lambda: f"={A('r_bruto')}-{A('r_real_a')}", "pct2")
_s("4. INSS (estimativa pelas regras da EC 103/2019 — mulher: 60% + 2% por ano acima de 15)")
_r("inss_nfut", "Meses de contribuição simulados até a aposentadoria", "meses", lambda: f"=SUM({cr('Renda', 'contrib')})", "int")
_r("inss_anos", "Tempo total de contribuição", "anos", lambda: f"={P('inss_anos_ant')}+{A('inss_nfut')}/12", "num")
_r("inss_media", "Média dos salários de contribuição (R$ de hoje)", "R$ hoje",
   lambda: f"=IFERROR(({P('inss_anos_ant')}*12*{P('inss_media_ant')}+SUM({cr('Renda', 'sc_r')}))/({P('inss_anos_ant')}*12+{A('inss_nfut')}),0)")
_r("inss_coef", "Coeficiente do benefício", "%", lambda: f"=MIN(1,0.6+0.02*MAX(0,{A('inss_anos')}-15))", "pct")
_r("inss_est", "Benefício estimado (R$ de hoje/mês)", "R$ hoje",
   lambda: f"=IF({A('inss_anos')}>=15,MIN({P('teto_inss')},{A('inss_coef')}*{A('inss_media')}),0)")
_r("inss_final", "Benefício do INSS considerado no veredito", "R$ hoje",
   lambda: f"=CHOOSE({P('inss_modo')},0,{A('inss_est')},{P('inss_manual')})", "brl",
   "Escolha em Premissas › seção 9. Padrão: não considerar (conservador).", True)
_s("5. CAPITAL NECESSÁRIO AOS 65 (R$ de hoje)")
_r("meta_o", "Meta de renda líquida mensal", "R$ hoje", lambda: f"={P('meta')}")
_r("w_net", "Renda que o patrimônio precisa pagar (meta − INSS)", "R$ hoje", lambda: f"=MAX(0,{A('meta_o')}-{A('inss_final')})")
_r("n_cons", "Meses de consumo (critério 'consumir')", "meses", lambda: f"=MAX(1,({P('idade_lim')}-{P('idade_apos')})*12)", "int")
_r("k_perp", "Capital para viver só de rendimentos (perpetuidade)", "R$ hoje",
   lambda: f"=IF({A('r_real_m')}>0,{A('w_net')}/{A('r_real_m')},1E+12)", "brl", "K = renda ÷ juro real mensal. O patrimônio real nunca cai.")
_r("k_cons", "Capital para consumir tudo até a idade-limite", "R$ hoje",
   lambda: f"=IF({A('r_real_m')}=0,{A('w_net')}*{A('n_cons')},{A('w_net')}*(1-(1+{A('r_real_m')})^(-{A('n_cons')}))/{A('r_real_m')})", "brl",
   "K = renda × [1 − (1+r)^−N] ÷ r (valor presente de uma renda corrigida pela inflação).")
_r("k_star", "CAPITAL NECESSÁRIO pelo critério escolhido", "R$ hoje",
   lambda: f"=CHOOSE({P('criterio')},{A('k_perp')},{A('k_cons')})", "brl", "", True)
_s("6. VEREDITO")
_r("renda_perp", "Renda que o patrimônio sustenta para sempre", "R$ hoje/mês", lambda: f"={A('p65_real')}*{A('r_real_m')}", "brl",
   "Negativa quando o patrimônio aos 65 é negativo (déficit acumulado): mede quanto falta, não uma renda.")
_r("renda_cons", "Renda que o patrimônio sustenta até a idade-limite", "R$ hoje/mês",
   lambda: f"=IF({A('r_real_m')}=0,{A('p65_real')}/{A('n_cons')},PMT({A('r_real_m')},{A('n_cons')},-{A('p65_real')}))")
_r("renda_fin", "Renda do patrimônio pelo critério escolhido", "R$ hoje/mês",
   lambda: f"=CHOOSE({P('criterio')},{A('renda_perp')},{A('renda_cons')})")
_r("renda_total", "RENDA MENSAL SUSTENTÁVEL (patrimônio + INSS)", "R$ hoje/mês",
   lambda: f"={A('renda_fin')}+{A('inss_final')}", "brl", "", True)
_r("pct_meta", "% DA META ATINGIDO", "%", lambda: f"=IFERROR({A('renda_total')}/{A('meta_o')},0)", "pct", "", True)
_r("veredito", "VEREDITO", "", lambda: f'=IF({A("pct_meta")}>=1,"ATINGE A META","NÃO ATINGE A META")', "gen", "", True)
_r("gap_real", "Lacuna de patrimônio (necessário − projetado)", "R$ hoje", lambda: f"={A('k_star')}-{A('p65_real')}", "brl",
   "Negativo = sobra patrimônio.")
_r("fv_fac", "Fator: R$ 1 extra por mês (R$ de hoje) vira quanto aos 65 (R$ de hoje)", "R$ hoje",
   lambda: f"=INDEX({cr('Macro', 'gcum')},{A('t_star')})*SUMPRODUCT(({cr('Macro', 't')}<={A('t_star')})*{cr('Macro', 'ig')})/{A('idx65')}",
   "brl2", "Soma de cada aporte mensal corrigido pela inflação e capitalizado pelo rendimento líquido até os 65.")
_r("aporte", "Aporte mensal extra necessário (+) ou folga (−)", "R$ hoje/mês",
   lambda: f"=IF({A('fv_fac')}>0,{A('gap_real')}/{A('fv_fac')},0)", "brl",
   "Valor constante em R$ de hoje, de hoje até os 65, que fecha a lacuna. Negativo = ela pode gastar isso a mais.", True)
_r("gasto_max", "Gasto pessoal máximo compatível com a meta (aprox.)", "R$ hoje/mês",
   lambda: f"={P('gasto_pes_ativo')}-{A('aporte')}", "brl", "Gastos pessoais atuais − aporte extra necessário.", True)
_r("idade_if", "Idade em que atinge o capital necessário", "anos",
   lambda: f'=IFERROR(INDEX({cr("Macro", "idade")},MATCH(1,{cr("Fluxo_Mensal", "ating")},0)),"Não atinge antes da aposentadoria")', "int",
   "Independência financeira: a partir daí o patrimônio já pagaria a meta.")
_r("data_if", "Mês em que atinge", "data",
   lambda: f'=IFERROR(INDEX({cr("Macro", "data")},MATCH(1,{cr("Fluxo_Mensal", "ating")},0)),"-")', "date")
_r("idade_esg", "Idade em que o patrimônio se esgota na aposentadoria", "anos",
   lambda: f'=IFERROR(INDEX({cr("Macro", "idade")},MATCH(1,{cr("Fluxo_Mensal", "esgot")},0)),"Não se esgota até os 100")', "int")
_r("min_saldo", "Menor saldo financeiro na fase ativa (R$ de hoje)", "R$ hoje", lambda: f"=MIN({cr('Fluxo_Mensal', 'p_min_aux')})", "brl",
   "Negativo = em algum mês ela precisaria de crédito.")
_r("data_min", "Mês do menor saldo", "data",
   lambda: f"=INDEX({cr('Macro', 'data')},MATCH({A('min_saldo')},{cr('Fluxo_Mensal', 'p_min_aux')},0))", "date")
_r("meses_neg", "Meses com saldo negativo (fase ativa)", "meses",
   lambda: f'=COUNTIFS({cr("Fluxo_Mensal", "p_fim")},"<0",{cr("Macro", "trab")},1)', "int")
_s("7. COMPRA DO IMÓVEL — viabilidade")
_r("tc", "Mês da compra (nº; 99999 = sem compra)", "nº", lambda: f"={P('t_compra')}", "int")
_r("compra_dt", "Data da compra", "data", lambda: f'=IF({A("tc")}>{NM},"Sem compra",INDEX({cr("Macro", "data")},{A("tc")}))', "date")
_r("v_compra", "Valor do imóvel na compra (nominal, total)", "R$", lambda: f"={P('V_compra')}")
_r("desemb", "Entrada + ITBI + reforma — parte dela (nominal)", "R$",
   lambda: f"=IF({A('tc')}>{NM},0,INDEX({cr('Fluxo_Mensal', 'g_imo1')},{A('tc')}))")
_r("p_antes", "Patrimônio dela no mês anterior à compra (nominal)", "R$",
   lambda: f"=IF({A('tc')}>{NM},0,INDEX({cr('Fluxo_Mensal', 'p_fim')},MAX(1,{A('tc')}-1)))")
_r("p_depois", "Patrimônio dela logo após a compra (nominal)", "R$",
   lambda: f"=IF({A('tc')}>{NM},0,INDEX({cr('Fluxo_Mensal', 'p_fim')},{A('tc')}))", "brl", "Negativo = a entrada não cabe no patrimônio.")
_r("fin_dela", "Valor financiado — parte dela (nominal)", "R$",
   lambda: f"=IF({A('tc')}>{NM},0,{P('fin_valor')}*(1-INDEX({cr('Macro', 'conj')},{A('tc')})))")
_r("prest1", "Primeira prestação — parte dela (nominal)", "R$",
   lambda: f"=IF({A('tc')}>={NM},0,INDEX({cr('Fluxo_Mensal', 'g_prest')},{A('tc')}+1))")
_r("comprom1", "Primeira prestação ÷ faturamento bruto dela", "%",
   lambda: f"=IF({A('tc')}>={NM},0,INDEX({cr('Moradia', 'comprom')},{A('tc')}+1))", "pct", "Bancos costumam aceitar até 30%.")
_r("comprom_max", "Maior comprometimento da renda com a prestação", "%", lambda: f"=MAX({cr('Moradia', 'comprom')})", "pct")
_r("prazo_ef", "Meses com saldo devedor (prazo efetivo)", "meses", lambda: f'=COUNTIF({cr("Moradia", "sd_fim")},">1")', "int")
_r("juros_tot", "Juros pagos no financiamento (casal, nominal)", "R$", lambda: f"=SUM({cr('Moradia', 'juros')})")
_s("8. MARKETING PESSOAL")
_r("mkt_rec", "Receita adicional na maturidade", "R$ hoje/mês", lambda: f"={P('mkt_consultas')}*{P('mkt_ticket')}")
_r("mkt_aliq", "Carga tributária atual (tributos + INSS + IR)", "%", lambda: f"=INDEX({cr('Renda', 'aliq_tot')},1)", "pct")
_r("mkt_liq", "Ganho líquido mensal do marketing na maturidade", "R$ hoje/mês",
   lambda: f"={A('mkt_rec')}*(1-{A('mkt_aliq')})-{P('mkt_valor')}", "brl", "Negativo = o marketing custa mais do que traz.")
_r("mkt_be", "Consultas por mês para pagar o marketing", "consultas",
   lambda: f"=IFERROR({P('mkt_valor')}/({P('mkt_ticket')}*(1-{A('mkt_aliq')})),0)", "num")
_s("9. SAÚDE E CARGA TRIBUTÁRIA")
_r("plano65", "Plano de saúde dela aos 65 (estimativa, R$ de hoje/mês)", "R$ hoje",
   lambda: f"=IF({P('cidade')}=2,{PC('plano_dela')},{P('plano_dela')})*INDEX({TB('ans_f')},10)/{P('ans_ref')}"
           f"*(1+{P('infl_saude')})^(({P('t_apos')}-1)/12)", "brl",
   "Faixa 59+ da ANS e reajuste acima do IPCA. Esse gasto precisa caber dentro da meta de aposentadoria.")
_r("aliq_hoje", "Carga total sobre o faturamento hoje", "%", lambda: f"=INDEX({cr('Renda', 'aliq_tot')},1)", "pct")
_r("aliq_fim", "Carga total sobre o faturamento no último ano de trabalho", "%",
   lambda: f"=INDEX({cr('Renda', 'aliq_tot')},MAX(1,{A('t_star')}-6))", "pct",
   "Se as faixas do Simples não forem corrigidas, a carga sobe com o faturamento nominal.")
_r("liq_hoje", "Renda líquida do trabalho no 1º mês", "R$", lambda: f"=INDEX({cr('Renda', 'liq')},1)")
_s("10. CAPITAL NECESSÁRIO POR CRITÉRIO (R$ de hoje)")
_r("kt_perp", "Viver só de rendimentos (perpetuidade)", "R$ hoje", lambda: f"={A('k_perp')}")
for _age in (85, 90, 95, 100):
    _r(f"kt_{_age}", f"Consumir o capital até os {_age} anos", "R$ hoje",
       (lambda a: (lambda: f"=IF({A('r_real_m')}=0,{A('w_net')}*MAX(1,({a}-{P('idade_apos')})*12),"
                           f"{A('w_net')}*(1-(1+{A('r_real_m')})^(-MAX(1,({a}-{P('idade_apos')})*12)))/{A('r_real_m')})"))(_age))


def layout_apos():
    r = 4
    for it in APOS:
        if it[0] == "sec":
            r += 2
        else:
            OUT[it[0]] = f"{AP}!$D${r}"
            r += 1


def render_apos(ws):
    title(ws, "APOSENTADORIA — capital necessário, renda sustentável e veredito",
          "Tudo em R$ de hoje (poder de compra de dez/2026), salvo indicação. Fonte verde = valor vindo de outra aba.", 6)
    for k, w in {"A": 64, "B": 13, "C": 2, "D": 20, "E": 2, "F": 95}.items():
        ws.column_dimensions[k].width = w
    r = 4
    for it in APOS:
        if it[0] == "sec":
            r += 1
            sec(ws, r, it[1], 6)
            r += 1
            continue
        key, lab, unit, f, fmt, nt, hl = it
        ws.cell(r, 1, lab).font = font(bold=hl)
        ws.cell(r, 1).alignment = Alignment(indent=1)
        ws.cell(r, 2, unit).font = font(GRAY, italic=True, size=9)
        x = put(ws, f"D{r}", f(), fmt, bold=hl, fill=F_OUT if hl else None)
        if nt:
            ws.cell(r, 6, nt).font = font(GRAY, italic=True, size=9)
        r += 1
    ws.conditional_formatting.add(A("veredito").split("!")[1].replace("$", ""),
                                  FormulaRule(formula=[f'{A("pct_meta").split("!")[1]}>=1'], fill=F_OUT,
                                              font=font(GREEN, True)))
    ws.conditional_formatting.add(A("veredito").split("!")[1].replace("$", ""),
                                  FormulaRule(formula=[f'{A("pct_meta").split("!")[1]}<1'], fill=F_BAD,
                                              font=font(RED, True)))
    ws.freeze_panes = "A4"
    ws.sheet_view.zoomScale = 90


# ====================================================================================== RESUMO ANUAL
RCOLS = [  # chave, rótulo, unidade, tipo (sum/end/calc), origem, formato, largura
    ("ano", "Ano", "ano", None, None, "int", 7),
    ("idade", "Idade (dez.)", "anos", "end", ("Macro", "idade"), "int", 7),
    ("cidade", "Cidade (dez.)", "", "end", ("Fluxo_Mensal", "cidade"), "gen", 11),
    ("fase", "Fase (dez.)", "", "end", ("Fluxo_Mensal", "fase"), "gen", 12),
    ("fb", "Faturamento bruto", "R$", "sum", "fb", "brl", 11),
    ("trib", "Tributos, INSS e IR", "R$", "sum", "trib", "brl", 10),
    ("custos_pj", "Contabilidade e marketing", "R$", "sum", "custos_pj", "brl", 10),
    ("salmat", "Salário-maternidade", "R$", "sum", "salmat", "brl", 10),
    ("liq", "Renda líquida do trabalho", "R$", "sum", "liq", "brl", 11),
    ("inss", "INSS (aposentadoria)", "R$", "sum", "inss_ben", "brl", 10),
    ("pes", "Gastos pessoais", "R$", "sum", "g_pes", "brl", 10),
    ("mor", "Aluguel e lar", "R$", "sum", "g_mor", "brl", 10),
    ("imo", "Imóvel (entrada, parcelas, custos, amort. extra)", "R$", "sum", ["g_imo1", "g_prest", "g_prop", "g_amx"], "brl", 12),
    ("fil", "Filhos", "R$", "sum", "g_fil", "brl", 10),
    ("sau", "Plano de saúde dela", "R$", "sum", "g_sau", "brl", 10),
    ("cev", "Casamento e eventos", "R$", "sum", ["g_cas", "g_ev"], "brl", 10),
    ("apo", "Gasto na aposentadoria", "R$", "sum", "g_apo", "brl", 11),
    ("sai", "TOTAL DE SAÍDAS", "R$", "sum", ["sai", "g_amx"], "brl", 11),
    ("sobra", "SOBRA DO ANO", "R$", "sum", "sobra", "brl", 11),
    ("rend", "Rendimentos", "R$", "sum", "rend", "brl", 10),
    ("pfim", "Patrimônio financeiro (dez.)", "R$", "end", ("Fluxo_Mensal", "p_fim"), "brl", 12),
    ("ptfim", "Patrimônio total (dez.)", "R$", "end", ("Fluxo_Mensal", "pt"), "brl", 12),
    ("r_liq", "Renda líquida — R$ hoje", "R$ hoje", "sum", "r_liq", "brl", 10),
    ("r_inss", "INSS — R$ hoje", "R$ hoje", "sum", "r_inss", "brl", 9),
    ("r_pes", "Gastos pessoais — R$ hoje", "R$ hoje", "sum", "r_pes", "brl", 10),
    ("r_mor", "Aluguel e lar — R$ hoje", "R$ hoje", "sum", "r_mor", "brl", 10),
    ("r_imo", "Imóvel — R$ hoje", "R$ hoje", "sum", "r_imo", "brl", 10),
    ("r_fil", "Filhos — R$ hoje", "R$ hoje", "sum", "r_fil", "brl", 10),
    ("r_sau", "Saúde — R$ hoje", "R$ hoje", "sum", "r_sau", "brl", 9),
    ("r_cev", "Casamento e eventos — R$ hoje", "R$ hoje", "sum", "r_cev", "brl", 10),
    ("r_apo", "Aposentadoria — R$ hoje", "R$ hoje", "sum", "r_apo", "brl", 10),
    ("r_sobra", "Sobra — R$ hoje", "R$ hoje", "sum", "r_sobra", "brl", 10),
    ("r_p", "Patrimônio financeiro (dez.) — R$ hoje", "R$ hoje", "end", ("Fluxo_Mensal", "p_real"), "brl", 12),
    ("r_k", "Capital necessário (dez.) — R$ hoje", "R$ hoje", "end", ("Fluxo_Mensal", "k_real"), "brl", 12),
    ("r_pt", "Patrimônio total (dez.) — R$ hoje", "R$ hoje", "end", ("Fluxo_Mensal", "pt_real"), "brl", 12),
    ("tx_poup", "Taxa de poupança (sobra ÷ renda líquida)", "%", "calc", None, "pct", 9),
    ("carga", "Carga tributária (÷ faturamento)", "%", "calc", None, "pct", 9),
]
RC = {k: i + 1 for i, (k, *_) in enumerate(RCOLS)}
RY0 = 7


def render_resumo(ws):
    title(ws, "RESUMO ANUAL — fluxo de caixa dela por ano (nominal e em R$ de hoje)",
          "Somas dos meses de cada ano (dez/2026 é só um mês). Estoques = posição de dezembro. Fonte: Fluxo_Mensal.", len(RCOLS))
    SHEETS["Resumo_Anual"] = ws.title
    for i, (k, lab, unit, kind, src, fmt, w) in enumerate(RCOLS):
        c = i + 1
        h = ws.cell(5, c, lab)
        h.font = font(WHITE, True, size=9)
        h.fill = F_HEAD
        h.alignment = Alignment(wrap_text=True, horizontal="center", vertical="center")
        u = ws.cell(6, c, unit)
        u.font = font(GRAY, italic=True, size=8)
        u.alignment = Alignment(horizontal="center")
        ws.column_dimensions[L(c)].width = w
    ws.cell(4, RC["fb"], "VALORES NOMINAIS (R$ correntes)").font = font(bold=True)
    ws.cell(4, RC["r_liq"], "EM R$ DE HOJE").font = font(bold=True)
    for c in range(RC["fb"], RC["ptfim"] + 1):
        ws.cell(4, c).fill = F_GRP
    for c in range(RC["r_liq"], len(RCOLS) + 1):
        ws.cell(4, c).fill = F_OUT
    ws.row_dimensions[5].height = 52
    yr = cr("Fluxo_Mensal", "ano")
    for i in range(NY):
        r = RY0 + i
        for k, lab, unit, kind, src, fmt, w in RCOLS:
            c = RC[k]
            if k == "ano":
                f = f"=YEAR({P('inicio')})" if i == 0 else f"=A{r-1}+1"
            elif kind == "sum":
                srcs = src if isinstance(src, list) else [src]
                f = "=" + "+".join(f"SUMIFS({cr('Fluxo_Mensal', s)},{yr},$A{r})" for s in srcs)
            elif kind == "end":
                f = f"=INDEX({cr(src[0], src[1])},MATCH($A{r},{yr},1))"
            elif k == "tx_poup":
                f = f"=IF({L(RC['liq'])}{r}>0,{L(RC['sobra'])}{r}/{L(RC['liq'])}{r},0)"
            elif k == "carga":
                f = f"=IF({L(RC['fb'])}{r}>0,{L(RC['trib'])}{r}/{L(RC['fb'])}{r},0)"
            x = ws.cell(r, c, f)
            x.number_format = FMT[fmt]
            x.font = font(GREEN if "!" in f else BLACK, k in ("sobra", "pfim", "r_p", "ano"))
            if k in ("sobra", "r_sobra"):
                pass
    ws.conditional_formatting.add(f"A{RY0}:{L(len(RCOLS))}{RY0 + NY - 1}",
                                  FormulaRule(formula=[f'$D{RY0}="Aposentadoria"'], fill=PatternFill("solid", fgColor="F2F2F2")))
    ws.freeze_panes = ws.cell(RY0, 3)
    ws.sheet_view.showGridLines = False
    ws.sheet_view.zoomScale = 85


# ====================================================================================== CHECKS
CHECKS = []    # (tipo, descrição, f_valor(), formato, f_problema(valor_addr), detalhe())


def _c(kind, desc, fv, fmt, fbad, det=None):
    CHECKS.append((kind, desc, fv, fmt, fbad, det))


def define_checks():
    X = "Fluxo_Mensal"
    _c("ERRO", "Fluxo fecha: sobra = entradas − saídas − amortização extra (soma de todos os meses)",
       lambda: f"=SUM({cr(X, 'sobra')})-(SUM({cr(X, 'ent')})-SUM({cr(X, 'sai')})-SUM({cr(X, 'g_amx')}))", "brl2", lambda v: f"ABS({v})>1")
    _c("ERRO", "Patrimônio fecha: saldo final = inicial + rendimentos + sobras",
       lambda: f"=INDEX({cr(X, 'p_fim')},{NM})-({P('pat_ini')}+SUM({cr(X, 'rend')})+SUM({cr(X, 'sobra')}))", "brl2",
       lambda v: f"ABS({v})>1")
    _c("ERRO", "Financiamento fecha: financiado = amortizações + extra + quitação + saldo final",
       lambda: f"=SUM({cr('Moradia', 'fin')})-(SUM({cr('Moradia', 'amort')})+SUM({cr('Moradia', 'extra')})+SUM({cr('Moradia', 'quit')})"
               f"+INDEX({cr('Moradia', 'sd_fim')},{NM}))", "brl2", lambda v: f"ABS({v})>1")
    _c("ERRO", "Saldo devedor nunca negativo", lambda: f"=MIN({cr('Moradia', 'sd_fim')})", "brl2", lambda v: f"{v}<-0.01")
    _c("ERRO", "Aposentadoria depois do início da simulação (mês da aposentadoria > 1)", lambda: f"={P('t_apos')}", "int",
       lambda v: f"{v}<=1")
    _c("ERRO", "Casamento, mudança e filhos com datas a partir do início da simulação",
       lambda: f"=MIN({P('t_cas')},IF({P('cidade')}=2,{P('t_mud')},99),IF({P('n_filhos')}>=1,{P('t_f1')},99),"
               f"IF({P('n_filhos')}>=2,{P('t_f2')},99),IF({P('n_filhos')}>=3,{P('t_f3')},99))", "int", lambda v: f"{v}<1")
    _c("ERRO", "Número de filhos entre 0 e 3 (inteiro)", lambda: f"={P('n_filhos')}", "int",
       lambda v: f"OR({v}<0,{v}>3,{v}<>INT({v}))")
    _c("ERRO", "Percentuais entre 0% e 100% (entrada, cônjuge, casamento, licença)",
       lambda: f"=MIN({P('entrada')},{P('conj_pct')},{P('cas_pct')},{P('lic_pct')})*(MAX({P('entrada')},{P('conj_pct')},{P('cas_pct')},{P('lic_pct')})<=1)",
       "pct", lambda v: f"OR({v}<0,MAX({P('entrada')},{P('conj_pct')},{P('cas_pct')},{P('lic_pct')})>1)")
    _c("ERRO", "Juro real líquido de longo prazo positivo (senão a perpetuidade não existe)", lambda: f"={P('r_real_lp_a')}", "pct2",
       lambda v: f"AND({P('criterio')}=1,{v}<=0)")
    _c("ALERTA", "Saldo financeiro negativo em algum mês da fase ativa (ela precisaria de crédito)", lambda: f"={A('meses_neg')}", "int",
       lambda v: f"{v}>0",
       lambda: f'="Pior momento: "&MONTH({A("data_min")})&"/"&YEAR({A("data_min")})&" — menor saldo ≈ R$ "&ROUND({A("min_saldo")}/1000,0)&" mil (R$ de hoje)"')
    _c("ALERTA", "Patrimônio abaixo da reserva de emergência (depois dos 2 primeiros anos)",
       lambda: f"=SUM({cr(X, 'abaixo_res')})", "int", lambda v: f"{v}>0",
       lambda: f'=IFERROR("Primeiro mês: "&MONTH(INDEX({cr("Macro", "data")},MATCH(1,{cr(X, "abaixo_res")},0)))&"/"&YEAR(INDEX({cr("Macro", "data")},MATCH(1,{cr(X, "abaixo_res")},0))),"")')
    _c("ALERTA", "Prestação do financiamento acima de 30% do faturamento dela (critério bancário)",
       lambda: f"={A('comprom_max')}", "pct", lambda v: f"{v}>0.3")
    _c("ALERTA", "Financiamento passa da aposentadoria (saldo quitado com o patrimônio aos 65)", lambda: f"={A('quit65')}", "brl",
       lambda v: f"{v}>1")
    _c("ALERTA", "Filho ainda dependente na aposentadoria (custo deveria caber na meta)",
       lambda: "=" + "+".join(f"AND({P('n_filhos')}>={k},INT(({P('t_apos')}-{P(f't_f{k}')})/12)<{P('dep_ate')})*1" for k in (1, 2, 3)),
       "int", lambda v: f"{v}>0")
    _c("ALERTA", "Faturamento acima de R$ 600 mil/ano em R$ de hoje (IRPF mínimo, Lei 15.270/2025)",
       lambda: f"=MAX({cr(X, 'r_fb')})*12", "brl", lambda v: f"{v}>600000")
    _c("ALERTA", "Lucro distribuído acima de R$ 50 mil/mês nominais (retenção de 10% na fonte)",
       lambda: f"=MAX({cr('Renda', 'dist')})", "brl", lambda v: f"{v}>50000",
       lambda: f'="Meses acima do limite: "&COUNTIF({cr("Renda", "dist")},">50000")&" (limite nominal, sem correção)"')
    _c("ALERTA", "Receita de 12 meses acima do limite do Simples (R$ 4,8 milhões)",
       lambda: f"=MAX({cr('Renda', 'rbt_tab')})", "brl", lambda v: f"AND({P('regime')}=1,{v}>4800000)")
    _c("ALERTA", "Fator R abaixo de 28%: PJ cai no Anexo V do Simples (alíquota bem maior)", lambda: f"={P('anexo')}", "int",
       lambda v: f"AND({P('regime')}=1,{v}=5)")
    _c("ALERTA", "Compra do imóvel em Campinas antes da mudança", lambda: f"={P('t_compra')}-{P('t_mud')}", "int",
       lambda v: f"AND({P('cidade')}=2,{P('t_compra')}<99999,{v}<0)")
    _c("ALERTA", "Nascimento de filho até 6 meses da compra do imóvel (licença sem faturar + entrada no mesmo período)",
       lambda: "=" + "+".join(f"AND({P('n_filhos')}>={k},ABS({P(f't_f{k}')}-{P('t_compra')})<=6)*1" for k in (1, 2, 3)), "int",
       lambda v: f"{v}>0")
    _c("ALERTA", "Patrimônio se esgota durante a aposentadoria", lambda: f"=SUM({cr(X, 'esgot')})", "int", lambda v: f"{v}>0",
       lambda: f'="Idade: "&{A("idade_esg")}')
    _c("ALERTA", "Imóvel acima do teto do SFH (R$ 2,25 mi): juros do SFI podem ser maiores", lambda: f"={P('imovel_ativo')}", "brl",
       lambda v: f"{v}>2250000")
    _c("ALERTA", "Entrada abaixo de 20% (bancos financiam até 80% no SAC)", lambda: f"={P('entrada')}", "pct",
       lambda v: f"AND({P('t_compra')}<99999,{v}<0.2)")
    _c("ALERTA", "Patrimônio financeiro atual não informado (está zero)", lambda: f"={P('pat_ini')}", "brl", lambda v: f"{v}=0")
    _c("ALERTA", "Cenário ou teste ativo na aba Cenarios (resultados não são o caso base)", lambda: f"={OUT['ativos']}", "int",
       lambda v: f"{v}>0")


def render_checks(ws):
    title(ws, "CHECKS — testes de integridade (ERRO) e alertas de premissa (ALERTA)",
          "ERRO = modelo inconsistente (corrigir antes de usar). ALERTA = situação que merece atenção ou decisão.", 6)
    for k, w in {"A": 10, "B": 92, "C": 16, "D": 12, "E": 70}.items():
        ws.column_dimensions[k].width = w
    put(ws, "A4", "Erros:", "gen", bold=True)
    put(ws, "A5", "Alertas:", "gen", bold=True)
    r0 = 8
    for c, h in enumerate(["Tipo", "Teste", "Valor", "Status", "Detalhe"], 1):
        x = ws.cell(r0 - 1, c, h)
        x.font = font(WHITE, True)
        x.fill = F_HEAD
    for i, (kind, desc, fv, fmt, fbad, det) in enumerate(CHECKS):
        r = r0 + i
        ws.cell(r, 1, kind).font = font(bold=True, color=RED if kind == "ERRO" else "9C5700")
        ws.cell(r, 2, desc).font = font()
        put(ws, f"C{r}", fv(), fmt)
        put(ws, f"D{r}", f'=IF({fbad(f"C{r}")},"{kind}","OK")', "gen", bold=True, align="center")
        if det:
            put(ws, f"E{r}", f'=IF(D{r}="OK","",{det()[1:]})', "gen", size=9)
    r1, r2 = r0, r0 + len(CHECKS) - 1
    put(ws, "B4", f'=COUNTIF(D{r1}:D{r2},"ERRO")', "int", bold=True)
    put(ws, "B5", f'=COUNTIF(D{r1}:D{r2},"ALERTA")', "int", bold=True)
    OUT["n_erros"] = f"Checks!$B$4"
    OUT["n_alertas"] = f"Checks!$B$5"
    OUT["checks_rng"] = (r1, r2)
    ws.conditional_formatting.add(f"D{r1}:D{r2}", CellIsRule(operator="equal", formula=['"ERRO"'], fill=F_BAD, font=font(RED, True)))
    ws.conditional_formatting.add(f"D{r1}:D{r2}", CellIsRule(operator="equal", formula=['"ALERTA"'], fill=F_WARN, font=font("9C5700", True)))
    ws.conditional_formatting.add(f"D{r1}:D{r2}", CellIsRule(operator="equal", formula=['"OK"'], fill=F_OUT, font=font(GREEN, True)))
    ws.freeze_panes = "A8"


# ====================================================================================== PAINEL
def tile(ws, r, c, label, f, fmt, sub=None, w=2):
    """Bloco de indicador: rótulo (linha r), valor grande (r+1), subtítulo (r+2). Ocupa w colunas."""
    ws.merge_cells(start_row=r, start_column=c, end_row=r, end_column=c + w - 1)
    ws.merge_cells(start_row=r + 1, start_column=c, end_row=r + 1, end_column=c + w - 1)
    ws.merge_cells(start_row=r + 2, start_column=c, end_row=r + 2, end_column=c + w - 1)
    a = ws.cell(r, c, label)
    a.font = font(GRAY, True, size=9)
    a.alignment = Alignment(horizontal="center", wrap_text=True)
    b = ws.cell(r + 1, c, f)
    b.font = font("1F3864", True, size=18)
    b.number_format = FMT.get(fmt, fmt)
    b.alignment = Alignment(horizontal="center", vertical="center", shrink_to_fit=True)
    if sub:
        s = ws.cell(r + 2, c, sub)
        s.font = font(GRAY, italic=True, size=8)
        s.alignment = Alignment(horizontal="center", wrap_text=True)
        s.number_format = FMT["gen"]
    for rr in range(r, r + 3):
        for cc in range(c, c + w):
            ws.cell(rr, cc).fill = PatternFill("solid", fgColor="F5F8FC")
    return b


def render_painel(ws, ra):
    title(ws, "PAINEL — ela vai conseguir se aposentar aos 65 com R$ 32,4 mil por mês (de hoje)?",
          "Resumo do cenário ativo. Valores em R$ de hoje (poder de compra de dez/2026). Detalhes nas abas Aposentadoria e Resumo_Anual.", 16)
    for c in range(1, 17):
        ws.column_dimensions[L(c)].width = 11.5
    ws.column_dimensions["A"].width = 2
    put(ws, "B4", f"={OUT['estado']}", "gen", bold=True, color=GRAY)
    put(ws, "J4", f'="Checks: "&{OUT["n_erros"]}&" erro(s), "&{OUT["n_alertas"]}&" alerta(s) — veja a aba Checks"', "gen", bold=True,
        color=GRAY)
    # veredito
    ws.merge_cells("B6:P7")
    v = ws["B6"]
    v.value = (f'=IF({A("pct_meta")}>=1,"ATINGE A META — a renda sustentável aos "&{P("idade_apos")}&" anos cobre "&ROUND({A("pct_meta")}*100,0)'
               f'&"% da meta de R$ "&ROUND({P("meta")}/1000,1)&" mil/mês",IF({A("p65_real")}<0,"NÃO ATINGE — o plano gera déficit: aos "'
               f'&{P("idade_apos")}&" anos o saldo dela seria NEGATIVO em R$ "&ROUND(-{A("p65_real")}/1000000,2)&" mi (R$ de hoje)",'
               f'"NÃO ATINGE — a renda sustentável aos "&{P("idade_apos")}&" anos cobre só "&ROUND({A("pct_meta")}*100,0)'
               f'&"% da meta de R$ "&ROUND({P("meta")}/1000,1)&" mil/mês"))')
    v.font = font(WHITE, True, size=16)
    v.alignment = Alignment(horizontal="center", vertical="center")
    v.fill = PatternFill("solid", fgColor="1F3864")
    ws.conditional_formatting.add("B6:P7", FormulaRule(formula=[f"{A('pct_meta')}>=1"], fill=PatternFill("solid", fgColor="2E7D32", bgColor="2E7D32")))
    ws.conditional_formatting.add("B6:P7", FormulaRule(formula=[f"{A('pct_meta')}<1"], fill=PatternFill("solid", fgColor="B03A2E", bgColor="B03A2E")))
    tile(ws, 9, 2, "% da meta atingido", f"={A('pct_meta')}", "pct",
         f'=IF({A("pct_meta")}<0,"negativo = termina a carreira com déficit","renda sustentável ÷ meta")')
    tile(ws, 9, 5, "Renda mensal sustentável (R$ hoje)", f"={A('renda_total')}", "rs", f'="meta: R$ "&ROUND({P("meta")}/1000,1)&" mil"')
    tile(ws, 9, 8, "Patrimônio financeiro aos 65 (R$ hoje)", f"={A('p65_real')}", "rsm",
         f'="necessário: R$ "&ROUND({A("k_star")}/1000000,2)&" mi"')
    tile(ws, 9, 11, "Aporte extra (+) ou folga (−) por mês", f"={A('aporte')}", "rs", "R$ de hoje, de agora até os 65")
    tile(ws, 9, 14, "Gasto pessoal máximo compatível", f"={A('gasto_max')}", "rs",
         f'="hoje: R$ "&ROUND({P("gasto_pes_ativo")}/1000,1)&" mil/mês"')
    tile(ws, 13, 2, "Atinge o capital necessário aos", f"={A('idade_if')}", "anos", "independência financeira")
    tile(ws, 13, 5, "Menor saldo financeiro (R$ hoje)", f"={A('min_saldo')}", "rs", f'=IF({A("min_saldo")}<0,"precisa de crédito","nunca fica negativo")')
    tile(ws, 13, 8, "Rendimento real líquido (longo prazo)", f"={A('r_real_a')}", "pct2", f'="juro real bruto: "&ROUND({A("r_bruto")}*100,1)&"% a.a."')
    tile(ws, 13, 11, "Imóvel: 1ª prestação dela", f"={A('prest1')}", "rs", f'="= "&ROUND({A("comprom1")}*100,0)&"% do faturamento dela"')
    tile(ws, 13, 14, "Carga tributária da PJ hoje", f"={A('aliq_hoje')}", "pct", "tributos + INSS + IR ÷ faturamento")

    for rr, h in ((9, 28), (10, 34), (11, 26), (13, 28), (14, 34), (15, 26), (17, 18), (35, 18)):
        ws.row_dimensions[rr].height = h
    # gráficos (dados do Resumo_Anual)
    rs, re_ = RY0, RY0 + NY - 1
    n_acum = 35                     # dez/2026 a 2060 (fase ativa + 1º ano de aposentadoria com as premissas-padrão)
    cat = RC["idade"]
    r = 17
    put(ws, f"B{r}", f'="Patrimônio financeiro × capital necessário (R$ milhões de hoje) — aos "&{P("idade_apos")}&": R$ "&'
                     f'ROUND({A("p65_real")}/1000000,1)&" mi de R$ "&ROUND({A("k_star")}/1000000,1)&" mi"', "gen", bold=True, color=BLACK)
    ch = G.lines(ra, cat, rs, rs + n_acum - 1, [(RC["r_p"], "Patrimônio financeiro", G.NAVY, 2.25, None),
                                               (RC["r_k"], "Capital necessário", G.ORANGE, 1.75, "dash"),
                                               (RC["r_pt"], "Patrimônio total (com imóvel)", G.GREY, 1.25, None)], skip=3)
    ws.add_chart(ch, f"B{r + 1}")
    put(ws, f"J{r}", "Para onde vai o dinheiro dela (R$ mil de hoje por ano, fase ativa)", "gen", bold=True)
    nwork = 34
    ch = G.stacked(ra, cat, rs, rs + nwork - 1, [(RC["r_pes"], "Pessoais", G.NAVY), (RC["r_mor"], "Aluguel e lar", G.TEAL),
                                                 (RC["r_imo"], "Imóvel", G.ORANGE), (RC["r_fil"], "Filhos", G.VIOLET),
                                                 (RC["r_sau"], "Saúde", G.GOLD), (RC["r_cev"], "Casamento e eventos", G.GREY)])
    ws.add_chart(ch, f"J{r + 1}")
    r = 35
    put(ws, f"B{r}", "Renda líquida × sobra do ano (R$ mil de hoje)", "gen", bold=True)
    ch = G.bars(ra, cat, rs, rs + nwork - 1, [(RC["r_liq"], "Renda líquida do trabalho", G.NAVY), (RC["r_sobra"], "Sobra (aporte/resgate)", G.ORANGE)])
    ws.add_chart(ch, f"B{r + 1}")
    put(ws, f"J{r}", f'="Fase de aposentadoria: patrimônio em R$ milhões de hoje — "&IF(ISNUMBER({A("idade_esg")}),'
                     f'"se esgota aos "&{A("idade_esg")},"não se esgota até os 100")', "gen", bold=True, color=BLACK)
    ch = G.lines(ra, cat, rs + n_acum - 3, re_, [(RC["r_p"], "Patrimônio financeiro", G.NAVY, 2.25, None),
                                                (RC["r_k"], "Capital necessário", G.ORANGE, 1.5, "dash")], skip=5)
    ws.add_chart(ch, f"J{r + 1}")
    # alavancas
    r = 53
    sec(ws, r, "As premissas que mais mexem no resultado (tornado da aba Cenarios — pressione F9 para atualizar)", 16, 2)
    s1, s2 = OUT["torn_sorted"]
    hdrs = ["Premissa (teste)", "", "", "", "", "Δ renda: baixo", "Δ renda: alto"]
    for j, h in enumerate(hdrs):
        x = ws.cell(r + 1, 2 + j, h or None)
        x.font = font(WHITE, True, size=9)
        x.fill = F_HEAD
    ws.merge_cells(start_row=r + 1, start_column=2, end_row=r + 1, end_column=6)
    put(ws, f"J{r + 1}", "Δ = variação da renda mensal sustentável aos 65 (R$ de hoje) quando a premissa vai para o valor baixo/alto do teste.",
        "gen", color=GRAY, size=9)
    for i in range(6):
        rr = r + 2 + i
        src = s2 - i
        ws.merge_cells(start_row=rr, start_column=2, end_row=rr, end_column=6)
        put(ws, f"B{rr}", f"=Cenarios!A{src}", "gen")
        put(ws, f"G{rr}", f"=Cenarios!B{src}", "rs")
        put(ws, f"H{rr}", f"=Cenarios!C{src}", "rs")
    ws.sheet_view.zoomScale = 85


# ====================================================================================== INSTRUÇÕES
INSTR = [
    ("h", "1. PARA QUE SERVE"),
    ("p", "Responder se ela consegue se aposentar aos 65 anos com renda líquida equivalente a R$ 32.400 por mês em poder de compra de hoje, "
          "considerando a PJ no Simples, o marketing pessoal, o casamento, a moradia (aluguel e depois casa própria), os filhos, a "
          "licença-maternidade, o plano de saúde e a escolha entre Porto Velho e Campinas. Também mostra o que fazer quando a resposta é não: "
          "quanto poupar a mais por mês, quanto ela pode gastar e quais premissas mais pesam."),
    ("h", "2. COMO USAR (5 passos)"),
    ("p", "1) Aba Premissas: revise as células amarelas (fonte azul). As de amarelo mais forte são as premissas-chave. Preencha o patrimônio "
          "financeiro atual (está zero) e confira os itens marcados VALIDAR."),
    ("p", "2) Escolha a cidade (Porto Velho ou Campinas) na seção 2 da aba Premissas. Os valores específicos de Campinas ficam na coluna D."),
    ("p", "3) Leia o resultado no topo da aba Premissas, no Painel e na aba Aposentadoria. Veja os alertas na aba Checks."),
    ("p", "4) Aba Cenarios: troque o cenário em D4 (1 = caso base) para comparar alternativas prontas, ou monte o seu na coluna 12 (Livre)."),
    ("p", "5) Pressione F9 para atualizar as tabelas de sensibilidade e o tornado da aba Cenarios. O arquivo vem configurado como "
          "'Automático, exceto Tabelas de Dados' para não ficar lento a cada digitação."),
    ("h", "3. CÓDIGO DE CORES"),
    ("p", "Fonte AZUL em fundo AMARELO-CLARO: entrada editável. Amarelo mais forte: premissa-chave. Fonte PRETA: fórmula da própria aba. "
          "Fonte VERDE: fórmula que busca dado em outra aba. Fundo CINZA: cálculo/total (não editar). Fundo VERDE-CLARO: resultado em destaque."),
    ("h", "4. ARQUITETURA"),
    ("p", "Entradas (Premissas, Cenarios) → motores mensais (Macro, Renda, Familia, Moradia) → Fluxo_Mensal → saídas (Aposentadoria, "
          "Resumo_Anual, Painel) → controle (Checks). As abas mensais têm uma linha por mês, de dez/2026 até os 100 anos dela (816 meses); "
          "o mês t está na mesma linha em todas elas. Passe o mouse sobre os cabeçalhos com triângulo vermelho para ler a lógica da coluna."),
    ("h", "5. LÓGICA DOS CÁLCULOS"),
    ("p", "Inflação: índice de preços I(t) = I(t−1) × (1 + IPCA mensal), com I = 1,00 no mês 1. Todo valor informado em R$ de hoje vira nominal "
          "multiplicando por I(t); dividir por I(t) volta para R$ de hoje. Taxas mensais: i_m = (1 + i_a)^(1/12) − 1."),
    ("p", "Faturamento: valor de hoje × fator de reajuste (no mês de reajuste repõe a inflação acumulada e soma o crescimento real). "
          "Em Campinas: até a mudança, emprego de Porto Velho; depois, rampa linear do faturamento inicial até o 'estabelecida' em N anos."),
    ("p", "Marketing: custo mensal fixo (corrigido pela inflação) e receita adicional = consultas × valor da consulta × maturidade "
          "(rampa linear; recomeça na mudança de cidade)."),
    ("p", "Simples Nacional: RBT12 = faturamento dos 12 meses anteriores; alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ "
          "RBT12, no Anexo III se o Fator R (pró-labore ÷ faturamento) for ≥ 28%, senão no Anexo V. Sobre o pró-labore: INSS de 11% até o "
          "teto e IR pela tabela progressiva (com a redução da Lei 15.270/2025). Os lucros distribuídos são isentos."),
    ("p", "Licença-maternidade: N meses sem faturar a partir do nascimento; o INSS paga salário-maternidade por 4 meses (média do pró-labore, "
          "limitada ao teto)."),
    ("p", "Despesas compartilhadas (aluguel, lar, imóvel, filhos, montagem da casa) são calculadas pelo total do casal; a parte dela é "
          "total × (1 − parcela do cônjuge), a partir do casamento. O casamento tem rateio próprio (50% dela)."),
    ("p", "Financiamento: SAC (amortização = financiado ÷ prazo; juros = saldo × taxa mensal) ou Price (prestação = PV × i ÷ [1 − (1+i)^−n]). "
          "Amortização extra (% da sobra) reduz o prazo. Se o saldo passar da aposentadoria, é quitado com o patrimônio no último mês de trabalho."),
    ("p", "Patrimônio: P(t) = P(t−1) + rendimento + sobra do mês. Rendimento = P(t−1) × CDI mensal × % do CDI × (1 − IR) − custódia. "
          "Sobra negativa é resgate; saldo negativo paga juros de crédito (CDI + spread) e gera alerta."),
    ("p", "Capital necessário aos 65 (R$ de hoje): viver de rendimentos → K = renda ÷ r_real; consumir até a idade-limite → "
          "K = renda × [1 − (1 + r_real)^−N] ÷ r_real, onde r_real = (1 + rendimento líquido) ÷ (1 + IPCA) − 1 ao mês e renda = meta − INSS."),
    ("p", "Veredito: renda sustentável = patrimônio aos 65 (R$ de hoje) × r_real (ou a PMT no critério 'consumir') + INSS. "
          "% da meta = renda sustentável ÷ meta. ATINGE se ≥ 100%."),
    ("p", "Aporte extra necessário: lacuna ÷ fator de capitalização, onde o fator soma cada R$ 1 de hoje aportado por mês, corrigido pela "
          "inflação e capitalizado pelo rendimento líquido até os 65. É o valor constante, em R$ de hoje, que fecha a lacuna. "
          "Gasto pessoal máximo ≈ gastos pessoais atuais − aporte extra."),
    ("p", "Na aposentadoria, todo mês ela saca a meta corrigida pela inflação (menos o INSS, se considerado). O gráfico do Painel mostra "
          "se o patrimônio se mantém ou se esgota."),
    ("h", "6. ABA CENARIOS (sensibilidade)"),
    ("p", "Cada alavanca tem: valor base (Premissas), valor em cada cenário pronto, valores do tornado e uma célula TESTE usada pelas Tabelas "
          "de Dados. O valor imposto segue a prioridade TESTE > tornado > cenário ativo > Premissas. As tabelas recalculam o modelo inteiro "
          "para cada valor testado, mantendo as demais premissas no valor atual."),
    ("p", "Não digite dentro das áreas de resultado das tabelas. Para trocar os valores testados, edite apenas os números em negrito da "
          "coluna C (ou da linha de cabeçalho, nas tabelas de duas variáveis)."),
    ("h", "7. SIMPLIFICAÇÕES (leia antes de decidir)"),
    ("p", "• IR das aplicações cobrado mês a mês (como se houvesse come-cotas). Na prática, um título de longo prazo adia o IR — o modelo é "
          "conservador. LCI/LCA isentas podem ser simuladas ajustando o % do CDI e o IR."),
    ("p", "• Tabela do IR, teto do INSS, faixas do Simples (opção 'Sim') e limites da Lei 15.270 supostos corrigidos pela inflação."),
    ("p", "• Reforma tributária (CBS/IBS a partir de 2027): não projetada. Teste o efeito com 'Alíquota manual' ou com o Lucro Presumido."),
    ("p", "• Imóvel: valor de mercado entra no patrimônio total, mas não gera renda na aposentadoria. TR embutida na taxa efetiva."),
    ("p", "• Cônjuge: entra só como parcela das despesas compartilhadas. A renda dele não entra no fluxo dela."),
    ("p", "• Depois dos 65, a meta cobre todos os gastos (inclusive o plano de saúde, que na faixa 59+ fica bem mais caro — veja a estimativa "
          "na aba Aposentadoria)."),
    ("p", "• Cada filho tem custos por faixa etária até a idade de dependência; os custos param na aposentadoria dela (há alerta)."),
    ("p", "• Estimativa do INSS simplificada (média em R$ de hoje, regra de cálculo da EC 103/2019). Não substitui a simulação do Meu INSS."),
    ("p", "• Tributos são estimativas para planejamento e não substituem o contador."),
    ("h", "8. GLOSSÁRIO"),
    ("p", "R$ de hoje: valor com o poder de compra de dez/2026. Nominal: valor em reais da época. Juro real: rendimento acima da inflação. "
          "Perpetuidade: viver só dos rendimentos, sem consumir o principal. RBT12: receita bruta dos últimos 12 meses. Fator R: folha "
          "(pró-labore) ÷ faturamento. SAC/Price: sistemas de amortização. SFH: Sistema Financeiro da Habitação (imóveis até R$ 2,25 mi, juros "
          "limitados). ITBI: imposto municipal na compra do imóvel. ANS: agência que regula as faixas etárias dos planos de saúde."),
    ("h", "9. FONTES DOS VALORES PADRÃO (nov/2026)"),
    ("p", "Boletim Focus de 09/11/2026 (Selic 13,75% → 10,25% em 2029; IPCA 5,22% → 4,00%); Portaria MPS/MF 13/2026 (teto do INSS "
          "R$ 8.475,55); Decreto 12.797/2025 (salário mínimo R$ 1.621); Receita Federal (tabela do IRPF e Lei 15.270/2025); LC 123/2006 e "
          "LC 155/2016 (Simples); taxas de financiamento divulgadas por Caixa, Itaú, Santander e Bradesco (out/2026); FipeZap (m² de Campinas); "
          "anúncios de aluguel e escolas em Porto Velho e Campinas; ANS (faixas etárias e reajustes). Itens marcados VALIDAR são estimativas "
          "que devem ser confirmadas com a realidade dela."),
]


def render_instr(ws):
    title(ws, "INSTRUÇÕES — como usar, lógica, simplificações e fontes", "Leia as seções 2 e 7 antes de tomar decisões com o modelo.", 2)
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = 150
    r = 4
    for kind, t in INSTR:
        if kind == "h":
            r += 1
            sec(ws, r, t, 2, 2)
        else:
            x = ws.cell(r, 2, t)
            x.font = font()
            x.alignment = Alignment(wrap_text=True, vertical="top")
            ws.row_dimensions[r].height = max(15, 15 * (len(t) // 140 + 1))
        r += 1
    r += 1
    sec(ws, r, "ÍNDICE DAS ABAS", 2, 2)
    r += 1
    for nm, d in TABS:
        x = ws.cell(r, 2, f"{nm} — {d}")
        x.hyperlink = f"#'{nm}'!A1"
        x.font = font(BLUE)
        r += 1


TABS = [
    ("Premissas", "todas as entradas, com o resultado resumido no topo"),
    ("Painel", "veredito, indicadores e gráficos"),
    ("Fluxo_Mensal", "fluxo de caixa dela mês a mês, até os 100 anos"),
    ("Resumo_Anual", "fluxo de caixa por ano, nominal e em R$ de hoje"),
    ("Aposentadoria", "capital necessário, renda sustentável, veredito, imóvel, marketing, INSS"),
    ("Cenarios", "cenários prontos, tornado e tabelas de sensibilidade"),
    ("Renda", "faturamento, Simples/Lucro Presumido, INSS, IR, marketing, salário-maternidade"),
    ("Moradia", "aluguel, lar, compra do imóvel, financiamento SAC/Price"),
    ("Familia", "casamento, filhos, licença, plano de saúde"),
    ("Macro", "calendário, idade, CDI, IPCA, índices"),
    ("Checks", "testes de integridade e alertas"),
    ("Instrucoes", "esta aba"),
]
