# -*- coding: utf-8 -*-
"""Aba Cenarios: alavancas, cenários prontos, tornado e tabelas de sensibilidade (Tabelas de Dados do Excel).

Cadeia de cada alavanca (linha da tabela de alavancas)
  valor imposto (col U) = TESTE (col T, entrada das Tabelas de Dados)  se preenchido
                        senão TORNADO ativo (col S)                    se o índice do tornado apontar para ela
                        senão CENÁRIO ativo (col P, da coluna do cenário escolhido em D4)
                        senão vazio  -> a aba Premissas usa o valor digitado.
As Tabelas de Dados exigem que a célula de entrada esteja na mesma aba: por isso seletor, índice do
tornado e células de teste ficam aqui.
"""
from fw import *
import premissas as PR
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.chart import BarChart, Reference, Series
import graficos as G

CS = "Cenarios"
SEL = "$D$4"          # cenário ativo
KT = "$D$5"           # índice do tornado
ROW_NAMES = 10
LEV0 = 11

# chave, rótulo, modo, item da aba Premissas (ou multiplicador), formato, tornado (baixo, alto), descrição do teste
LEVERS = [
    ("cidade", "Cidade", "sel", "cidade", "gen", None, ""),
    ("cdi_lp", "CDI de longo prazo", "abs", "cdi_lp", "pct2", ("=C{r}-0.02", "=C{r}+0.02"), "−2 pp / +2 pp"),
    ("ipca_lp", "IPCA de longo prazo", "abs", "ipca_lp", "pct2", ("=C{r}-0.01", "=C{r}+0.01"), "−1 pp / +1 pp"),
    ("pct_cdi", "Rentabilidade (% do CDI)", "abs", "pct_cdi", "pct", ("=C{r}-0.1", "=C{r}+0.1"), "−10 pp / +10 pp do CDI"),
    ("fat_var", "Variação do faturamento", "mult", "fat_mult", "pct", ("=-0.2", "=0.2"), "−20% / +20%"),
    ("g_real", "Crescimento real do faturamento", "abs", "g_real", "pct", ("=C{r}-0.01", "=C{r}+0.015"), "−1 pp / +1,5 pp a.a."),
    ("gasto_var", "Variação dos gastos pessoais", "mult", "gasto_mult", "pct", ("=-0.2", "=0.2"), "−20% / +20%"),
    ("imovel_valor", "Valor do imóvel (R$ de hoje)", "abs", "imovel_valor", "brl", ("=C{r}*0.75", "=C{r}*1.25"), "−25% / +25%"),
    ("compra_atraso", "Antecipar (−) / adiar (+) a compra", "add", "compra_atraso", "int", ("=-24", "=36"), "2 anos antes / 3 anos depois"),
    ("entrada", "Entrada do imóvel (%)", "abs", "entrada", "pct", ("=MAX(0.2,C{r}-0.1)", "=MIN(1,C{r}+0.2)"), "−10 pp / +20 pp"),
    ("taxa_fin", "Juros do financiamento", "abs", "taxa_fin", "pct2", ("=C{r}-0.02", "=C{r}+0.02"), "−2 pp / +2 pp"),
    ("sistema", "Sistema de amortização", "sel", "sistema", "gen", None, ""),
    ("amort_extra", "Sobra usada para amortizar", "abs", "amort_extra", "pct", ("=C{r}", "=MIN(1,C{r}+0.5)"), "atual / +50% da sobra"),
    ("n_filhos", "Número de filhos", "abs", "n_filhos", "int", ("=MAX(0,C{r}-1)", "=MIN(3,C{r}+1)"), "um a menos / um a mais"),
    ("filho_var", "Variação dos custos dos filhos", "mult", "filho_mult", "pct", ("=-0.25", "=0.25"), "−25% / +25%"),
    ("escola", "Escola", "sel", "escola", "gen", None, ""),
    ("faculdade", "Faculdade", "sel", "faculdade", "gen", None, ""),
    ("licenca", "Meses de licença sem faturar", "abs", "licenca", "int", ("=MAX(0,C{r}-2)", "=C{r}+6"), "−2 / +6 meses"),
    ("conj_pct", "Parcela paga pelo cônjuge", "conj", "conj_pct", "pct", ("=0", "=MIN(1,C{r}+0.2)"), "não divide / +20 pp"),
    ("cas_valor", "Custo total do casamento", "abs", "cas_valor", "brl", ("=C{r}*0.5", "=C{r}*1.5"), "−50% / +50%"),
    ("mkt_consultas", "Consultas adicionais do marketing", "abs", "mkt_consultas", "num", ("=0", "=C{r}*2"), "nenhuma / o dobro"),
    ("anos_estab", "Anos para se estabelecer em Campinas", "abs", "anos_estab", "num", ("=MAX(1,C{r}-2)", "=C{r}+3"),
     "−2 / +3 anos (só em Campinas)"),
    ("idade_apos", "Idade de aposentadoria", "abs", "idade_apos", "int", ("=C{r}-3", "=C{r}+3"), "3 anos antes / depois"),
    ("meta", "Meta de renda (R$ de hoje)", "abs", "meta", "brl", ("=C{r}*0.8", "=C{r}*1.2"), "−20% / +20%"),
    ("criterio", "Critério do veredito", "sel", "criterio", "gen", None, ""),
    ("regime", "Regime tributário", "sel", "regime", "gen", None, ""),
    ("simples_corr", "Faixas do Simples corrigidas?", "sel", "simples_corr", "gen", None, ""),
    ("inss_modo", "INSS na aposentadoria", "sel", "inss_modo", "gen", None, ""),
]

SCEN = [
    ("Base (Premissas)", {}),
    ("Campinas", {"cidade": "Campinas"}),
    ("Conservador", {"cdi_lp": 0.09, "ipca_lp": 0.045, "fat_var": -0.10, "gasto_var": 0.10, "mkt_consultas": 0, "taxa_fin": 0.145}),
    ("Otimista", {"cdi_lp": 0.11, "ipca_lp": 0.035, "fat_var": 0.15, "g_real": 0.01, "mkt_consultas": 12}),
    ("Casa de R$ 1,5 mi", {"imovel_valor": 1500000}),
    ("Sem comprar (aluguel)", {"imovel_valor": 0}),
    ("Cônjuge não divide", {"conj_pct": 0}),
    ("2 filhos", {"n_filhos": 2}),
    ("3 filhos", {"n_filhos": 3}),
    ("Escola pública", {"escola": "Pública"}),
    ("Amortizar c/ 50% da sobra", {"amort_extra": 0.5}),
    ("Livre (monte o seu)", {}),
]
NS = len(SCEN)
LROW = {}            # chave da alavanca -> linha
TORN = []            # lista de chaves com tornado


def layout():
    for i, lv in enumerate(LEVERS):
        LROW[lv[0]] = LEV0 + i
        if lv[5]:
            TORN.append(lv[0])
    PR.LEVCELL = lambda key: f"{CS}!$U${LROW[key]}"


def maps():
    """Mapas usados na aba Premissas: item -> (chave, modo) e alavanca -> célula 'valor imposto'."""
    lever_of, lev_cells = {}, {}
    for key, lab, mode, item, fmt, torn, desc in LEVERS:
        lev_cells[key] = f"{CS}!$U${LROW[key]}"
        if mode in ("abs", "sel", "conj"):
            lever_of[item] = (key, mode)
    for item in ("fat_pv", "fat_cps_ini", "fat_cps_est"):
        lever_of[item] = ("fat_mult", "mult")
    lever_of["gasto_pes"] = ("gasto_mult", "mult")
    return lever_of, lev_cells


def _opts(item):
    return PR.ITEMS[item]["opts"]


def render(ws, lo=False):
    title(ws, "CENÁRIOS E SENSIBILIDADE — quanto cada premissa mexe no objetivo",
          "Pressione F9 para atualizar as tabelas (o arquivo calcula 'Automático, exceto Tabelas de Dados'). "
          "Resultados medidos pela renda que o patrimônio sustenta aos 65 anos, em R$ de hoje.", 23)
    widths = {"A": 40, "B": 16, "C": 14}
    for k, w in widths.items():
        ws.column_dimensions[k].width = w
    for c in range(4, 16):
        ws.column_dimensions[L(c)].width = 12.5
    for c, w in zip("PQRSTUVW", (12, 12, 12, 12, 12, 12, 13, 26)):
        ws.column_dimensions[c].width = w
    ws.sheet_view.zoomScale = 85

    # --------------------------------------------------------------- controles
    put(ws, "A4", "Cenário ativo (1 a 12) — muda o modelo inteiro", "gen", bold=True)
    x = put(ws, "D4", 1, "int", color=BLUE, fill=F_KEY, bold=True, border=True, align="center")
    dv = DataValidation(type="whole", operator="between", formula1="1", formula2=str(NS))
    ws.add_data_validation(dv)
    dv.add("D4")
    put(ws, "E4", f"=INDEX($D${ROW_NAMES}:${L(3 + NS)}${ROW_NAMES},{SEL})", "gen", bold=True)
    put(ws, "A5", "Índice do tornado (deixe 0 — usado pelas tabelas)", "gen", color=GRAY)
    put(ws, "D5", 0, "int", color=BLUE, fill=F_IN, border=True, align="center")
    test_rng = f"$T${LEV0}:$T${LEV0 + len(LEVERS) - 1}"
    put(ws, "A6", "Estado do modelo", "gen", bold=True)
    put(ws, "D6", f'=IF(AND({SEL}=1,{KT}=0,COUNTA({test_rng})=0),"Caso base: o modelo usa exatamente a aba Premissas",'
                  f'"ATENÇÃO: cenário ou teste ativo — os resultados NÃO são o caso base")', "gen", bold=True)
    OUT["estado"] = f"{CS}!$D$6"
    OUT["ativos"] = f"{CS}!$D$7"
    put(ws, "A7", "Cenários/testes ativos (0 = nenhum)", "gen", color=GRAY)
    put(ws, "D7", f"=IF({SEL}<>1,1,0)+IF({KT}<>0,1,0)+COUNTA({test_rng})", "int")

    # --------------------------------------------------------------- tabela de alavancas
    sec(ws, ROW_NAMES - 1, "A. ALAVANCAS — cada coluna é um cenário pronto; células vazias = usa a aba Premissas", 23)
    heads = ["Alavanca", "Formato", "Base (Premissas)"] + [None] * NS + ["Cenário ativo", "Tornado: baixo", "Tornado: alto",
                                                                            "Tornado ativo", "TESTE (tabelas)", "Valor imposto",
                                                                            "Usado no modelo", "Teste do tornado"]
    for c, h in enumerate(heads, 1):
        if h is None:
            continue
        x = ws.cell(ROW_NAMES, c, h)
        x.font = font(WHITE, True, size=9)
        x.fill = F_HEAD
        x.alignment = Alignment(horizontal="center", wrap_text=True, vertical="center")
    for j, (nm, _) in enumerate(SCEN):
        x = ws.cell(ROW_NAMES, 4 + j, nm)
        x.font = font(BLUE, True, size=9)
        x.fill = F_KEY
        x.alignment = Alignment(horizontal="center", wrap_text=True, vertical="center")
        x.border = BOX
    ws.row_dimensions[ROW_NAMES].height = 42
    for i, (key, lab, mode, item, fmt, torn, desc) in enumerate(LEVERS):
        r = LROW[key]
        ws.cell(r, 1, lab).font = font()
        ws.cell(r, 2, {"sel": "opção", "mult": "% de variação", "add": "meses", "abs": "valor", "conj": "%"}[mode]).font = font(GRAY, size=9)
        # base
        if mode in ("mult", "add"):
            base = 0
        elif mode == "conj":
            base = f"=IF({P('conj_divide')}=1,{PI(item)},0)"
        elif item in ("imovel_valor",):
            base = f"=IF({P('cidade')}=2,{PIC(item)},{PI(item)})"
        else:
            base = f"={PI(item)}"
        put(ws, f"C{r}", base, fmt, fill=F_TOT)
        fm = FMT.get(fmt, fmt)
        for j, (nm, ov) in enumerate(SCEN):
            x = ws.cell(r, 4 + j)
            if key in ov:
                x.value = ov[key]
            x.number_format = fm
            x.font = font(BLUE)
            x.fill = F_IN
            x.border = BOX
        rng = f"D{r}:{L(3 + NS)}{r}"
        put(ws, f"P{r}", f'=IF(INDEX({rng},{SEL})="","",INDEX({rng},{SEL}))', fmt)
        if torn:
            ti = TORN.index(key)
            put(ws, f"Q{r}", torn[0].format(r=r), fmt, fill=F_TOT)
            put(ws, f"R{r}", torn[1].format(r=r), fmt, fill=F_TOT)
            put(ws, f"S{r}", f'=IF({KT}={2 * ti + 1},Q{r},IF({KT}={2 * ti + 2},R{r},""))', fmt)
            ws.cell(r, 23, desc).font = font(GRAY, size=9)
        else:
            put(ws, f"S{r}", '=""', fmt)
        x = ws.cell(r, 20)
        x.number_format = fm
        x.font = font(BLUE, True)
        x.fill = F_IN
        x.border = BOX
        put(ws, f"U{r}", f'=IF(T{r}<>"",T{r},IF(S{r}<>"",S{r},P{r}))', fmt)
        if mode in ("mult", "add"):
            used = f"=N(U{r})" if mode == "add" else f"={P(item)}-1"
        else:
            used = f"={P(item)}"
        uf = fm
        if mode == "sel":
            uf = PR._opts_fmt(_opts(item))
        put(ws, f"V{r}", used, "gen", fill=F_OUT).number_format = uf
        if mode == "sel":
            dv = DataValidation(type="list", formula1='"' + ",".join(_opts(item)) + '"', allow_blank=True)
            ws.add_data_validation(dv)
            dv.add(f"D{r}:{L(3 + NS)}{r}")
            dv.add(f"T{r}")
    last_lev = LEV0 + len(LEVERS) - 1
    r = last_lev + 2
    ws.cell(r, 1, "Como montar um cenário: escreva o valor na coluna do cenário (ou use o 12, 'Livre') e escolha o número em D4. "
                  "Para voltar ao caso base, D4 = 1. Não digite nas colunas P a V.").font = font(GRAY, italic=True, size=9)

    r += 2
    r = _compare(ws, r, lo)
    r = _tornado(ws, r, lo)
    r = _one_way(ws, r, lo)
    r = _two_way(ws, r, lo)
    ws.freeze_panes = "B4"


# --------------------------------------------------------------------- B. comparação dos cenários
OUTS = [("pct_meta", "% da meta", "pct"), ("renda_total", "Renda sustentável (R$ hoje/mês)", "brl"),
        ("p65_real", "Patrimônio financeiro aos 65 (R$ hoje)", "brl"), ("k_star", "Capital necessário (R$ hoje)", "brl"),
        ("aporte", "Aporte extra (+) ou folga (−) por mês (R$ hoje)", "brl"),
        ("gasto_max", "Gasto pessoal máximo compatível (R$ hoje/mês)", "brl"),
        ("idade_if", "Atinge o capital necessário aos", "gen"), ("min_saldo", "Menor saldo financeiro (R$ hoje)", "brl")]
SHORT = [OUTS[0], OUTS[1], OUTS[2], OUTS[4], OUTS[6]]


def _head_row(ws, r, c1, outs, first_label):
    """Linha de rótulos (r) e linha de fórmulas da tabela (r+1)."""
    x = ws.cell(r, c1 - 1, first_label)
    x.font = font(WHITE, True, size=9)
    x.fill = F_HEAD
    x.alignment = Alignment(horizontal="center", wrap_text=True, vertical="center")
    for j, (k, lab, fm) in enumerate(outs):
        x = ws.cell(r, c1 + j, lab)
        x.font = font(WHITE, True, size=9)
        x.fill = F_HEAD
        x.alignment = Alignment(horizontal="center", wrap_text=True, vertical="center")
        y = ws.cell(r + 1, c1 + j, f"={OUT[k]}")
        y.number_format = FMT[fm]
        y.font = font(GRAY, italic=True, size=8)
        y.fill = F_TIME
    ws.cell(r + 1, c1 - 1, "(valor atual →)").font = font(GRAY, italic=True, size=8)
    ws.row_dimensions[r].height = 40


def _results_fmt(ws, r1, r2, c1, outs):
    for rr in range(r1, r2 + 1):
        for j, (k, lab, fm) in enumerate(outs):
            x = ws.cell(rr, c1 + j)
            x.number_format = FMT[fm]
            x.font = font()
            x.fill = F_OUT if j == 0 else PatternFill()
            x.border = BOX


def _pct_scale(ws, rng):
    ws.conditional_formatting.add(rng, ColorScaleRule(start_type="num", start_value=0.5, start_color="F8696B",
                                                      mid_type="num", mid_value=1, mid_color="FFEB84",
                                                      end_type="num", end_value=1.3, end_color="63BE7B"))


def _compare(ws, r, lo):
    sec(ws, r, "B. COMPARAÇÃO DOS CENÁRIOS PRONTOS (Tabela de Dados sobre o seletor D4)", 23)
    OUT["sec_compare"] = r
    r += 1
    _head_row(ws, r, 4, OUTS, "Cenário nº")
    ws.cell(r, 1, "Cenário").font = font(WHITE, True, size=9)
    ws.cell(r, 1).fill = F_HEAD
    r1 = r + 2
    for j in range(NS):
        rr = r1 + j
        put(ws, f"A{rr}", f"=INDEX($D${ROW_NAMES}:${L(3 + NS)}${ROW_NAMES},C{rr})", "gen", bold=True)
        put(ws, f"C{rr}", j + 1, "int", align="center")
    r2 = r1 + NS - 1
    data_table(ws, r1, 4, r2, 3 + len(OUTS), col_input="D4", lo=lo)
    _results_fmt(ws, r1, r2, 4, OUTS)
    _pct_scale(ws, f"D{r1}:D{r2}")
    OUT["cmp_rows"] = (r1, r2)
    return r2 + 3


# --------------------------------------------------------------------- C. tornado
def _tornado(ws, r, lo):
    n = len(TORN)
    sec(ws, r, "C. TORNADO — o que mais mexe na renda sustentável aos 65 (uma premissa por vez, demais no valor atual)", 23)
    OUT["sec_torn"] = r
    r += 1
    ws.cell(r, 1, "Barras = variação da renda sustentável (R$ de hoje/mês) em relação ao valor atual "
                  f"(R$ hoje). Ordenado do maior para o menor impacto.").font = font(GRAY, italic=True, size=9)
    r += 1
    # tabela de dados bruta (à direita, colunas Y:AC)
    rt = r
    ws.column_dimensions["X"].width = 3
    for c in ("Y", "Z", "AA", "AB", "AC"):
        ws.column_dimensions[c].width = 12
    x = ws.cell(rt, 25, "k")
    x.font = font(WHITE, True, size=9)
    x.fill = F_HEAD
    tout = [("renda_total", "Renda sust.", "brl"), ("pct_meta", "% meta", "pct"), ("p65_real", "Patrim. 65", "brl"),
            ("aporte", "Aporte/folga", "brl")]
    for j, (k, lab, fm) in enumerate(tout):
        x = ws.cell(rt, 26 + j, lab)
        x.font = font(WHITE, True, size=9)
        x.fill = F_HEAD
        y = ws.cell(rt + 1, 26 + j, f"={OUT[k]}")
        y.number_format = FMT[fm]
        y.font = font(GRAY, size=8)
    ws.cell(rt - 1, 25, "Cálculo do tornado (Tabela de Dados — não editar)").font = font(GRAY, italic=True, size=9)
    t1 = rt + 2
    for i in range(2 * n):
        put(ws, f"Y{t1 + i}", i + 1, "int", color=GRAY)
    data_table(ws, t1, 26, t1 + 2 * n - 1, 29, col_input="D5", lo=lo)
    for i in range(2 * n):
        for j, (k, lab, fm) in enumerate(tout):
            ws.cell(t1 + i, 26 + j).number_format = FMT[fm]
            ws.cell(t1 + i, 26 + j).font = font(GRAY, size=8)

    # tabela legível por alavanca
    hdr = ["Premissa testada", "Teste", "Renda: baixo", "Renda: alto", "Δ baixo (R$/mês)", "Δ alto (R$/mês)",
           "% meta: baixo", "% meta: alto", "Impacto (auxiliar)"]
    for j, h in enumerate(hdr):
        x = ws.cell(r, 1 + j, h)
        x.font = font(WHITE, True, size=9)
        x.fill = F_HEAD
        x.alignment = Alignment(horizontal="center", wrap_text=True)
    ws.row_dimensions[r].height = 30
    base = OUT["renda_total"]
    d1 = r + 1
    for i, key in enumerate(TORN):
        rr = d1 + i
        lv = LEVERS[[l[0] for l in LEVERS].index(key)]
        lo_row, hi_row = t1 + 2 * i, t1 + 2 * i + 1
        put(ws, f"A{rr}", lv[1], "gen")
        put(ws, f"B{rr}", lv[6], "gen", color=GRAY, size=9)
        put(ws, f"C{rr}", f"=Z{lo_row}", "brl")
        put(ws, f"D{rr}", f"=Z{hi_row}", "brl")
        put(ws, f"E{rr}", f"=C{rr}-{base}", "brl")
        put(ws, f"F{rr}", f"=D{rr}-{base}", "brl")
        put(ws, f"G{rr}", f"=AA{lo_row}", "pct")
        put(ws, f"H{rr}", f"=AA{hi_row}", "pct")
        put(ws, f"I{rr}", f"=MAX(ABS(E{rr}),ABS(F{rr}))+ROW()/1E6", "brl", color=GRAY)
    d2 = d1 + n - 1
    # ordenada (para o gráfico): do menor para o maior impacto, para as barras maiores ficarem no topo
    r = d2 + 2
    ws.cell(r - 1, 1, "Ordenado por impacto (base do gráfico)").font = font(GRAY, italic=True, size=9)
    for j, h in enumerate(["Premissa (teste)", "Δ baixo (R$/mês)", "Δ alto (R$/mês)"]):
        x = ws.cell(r, 1 + j, h)
        x.font = font(WHITE, True, size=9)
        x.fill = F_HEAD
        x.alignment = Alignment(horizontal="center", wrap_text=True)
    s1 = r + 1
    for i in range(n):
        rr = s1 + i
        m = f"MATCH(LARGE($I${d1}:$I${d2},{n - i}),$I${d1}:$I${d2},0)"
        put(ws, f"A{rr}", f'=INDEX($A${d1}:$A${d2},{m})&" ("&INDEX($B${d1}:$B${d2},{m})&")"', "gen", size=9)
        put(ws, f"B{rr}", f"=INDEX($E${d1}:$E${d2},{m})", "brl")
        put(ws, f"C{rr}", f"=INDEX($F${d1}:$F${d2},{m})", "brl")
    s2 = s1 + n - 1
    OUT["torn_sorted"] = (s1, s2)
    OUT["torn_rows"] = (d1, d2)
    ch = G.tornado(ws, s1, s2)
    ws.add_chart(ch, f"E{s1 - 1}")
    return max(s2 + 3, s1 + 26)


# --------------------------------------------------------------------- D. uma variável
ONE = [
    ("cdi_lp", "Taxa de juros: CDI de longo prazo", [0.07, 0.08, 0.09, 0.10, 0.11, 0.12, 0.13, 0.14], "pct", None),
    ("fat_var", "Salário: variação do faturamento", [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.5], "pct", "fat"),
    ("imovel_valor", "Imóvel: valor da casa (R$ de hoje; 0 = não comprar)", [0, 1000000, 1500000, 2000000, 2500000, 3000000, 3500000],
     "brl", None),
    ("n_filhos", "Filhos: quantidade", [0, 1, 2, 3], "int", None),
    ("gasto_var", "Gastos pessoais: variação", [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3], "pct", "gasto"),
    ("conj_pct", "Cônjuge: parcela das despesas compartilhadas", [0, 0.2, 0.35, 0.5, 0.65, 0.8], "pct", None),
    ("idade_apos", "Idade de aposentadoria", [55, 58, 60, 62, 65, 67, 70], "int", None),
    ("meta", "Meta de renda mensal (R$ de hoje)", [20000, 25000, 30000, 32400, 35000, 40000, 45000], "brl", None),
    ("entrada", "Imóvel: entrada (100% = à vista)", [0.2, 0.3, 0.4, 0.5, 0.7, 1.0], "pct", None),
    ("taxa_fin", "Imóvel: juros do financiamento", [0.10, 0.11, 0.12, 0.13, 0.14, 0.15], "pct2", None),
    ("mkt_consultas", "Marketing: consultas adicionais por mês", [0, 3, 6, 9, 12, 15], "num", None),
    ("licenca", "Licença-maternidade: meses sem faturar", [0, 4, 6, 9, 12], "int", None),
]


def _one_way(ws, r, lo):
    sec(ws, r, "D. TABELAS DE UMA VARIÁVEL (as demais premissas ficam no valor atual)", 23)
    OUT["sec_one"] = r
    r += 2
    OUT["one_blocks"] = {}
    for key, ttl, vals, fm, extra in ONE:
        ws.cell(r, 1, ttl).font = font(bold=True, size=11)
        r += 1
        _head_row(ws, r, 4, SHORT, "Valor testado")
        ws.cell(r, 1, "").fill = F_HEAD
        ws.cell(r, 2, "Equivale a" if extra else "").fill = F_HEAD
        ws.cell(r, 2).font = font(WHITE, True, size=9)
        r1 = r + 2
        for i, v in enumerate(vals):
            put(ws, f"C{r1 + i}", v, fm, bold=True, align="center", fill=F_TIME)
            if extra == "fat":
                put(ws, f"B{r1 + i}", f"={PI('fat_pv')}*(1+C{r1 + i})", "rs", color=GRAY)
            elif extra == "gasto":
                put(ws, f"B{r1 + i}", f"={PI('gasto_pes')}*(1+C{r1 + i})", "rs", color=GRAY)
        r2 = r1 + len(vals) - 1
        data_table(ws, r1, 4, r2, 3 + len(SHORT), col_input=f"T{LROW[key]}", lo=lo)
        _results_fmt(ws, r1, r2, 4, SHORT)
        _pct_scale(ws, f"D{r1}:D{r2}")
        OUT["one_blocks"][key] = (r1, r2)
        r = r2 + 2
    return r + 1


# --------------------------------------------------------------------- E. duas variáveis
TWO = [
    ("cdi_lp", [0.08, 0.09, 0.10, 0.11, 0.12, 0.13], "pct", "ipca_lp", [0.03, 0.035, 0.04, 0.045, 0.05], "pct",
     "Juros × inflação de longo prazo: o que importa é o juro REAL (linhas: CDI; colunas: IPCA)"),
    ("fat_var", [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4], "pct", "gasto_var", [-0.2, -0.1, 0, 0.1, 0.2], "pct",
     "Faturamento × gastos pessoais (variações sobre o valor atual)"),
    ("imovel_valor", [0, 1000000, 1500000, 2000000, 2500000, 3000000], "brl", "n_filhos", [0, 1, 2, 3], "int",
     "Valor da casa (linhas) × número de filhos (colunas)"),
    ("anos_estab", [1, 2, 3, 4, 5, 6], "num", "cidade", ["Porto Velho", "Campinas"], "gen",
     "Campinas: anos até se estabelecer (linhas) × cidade (colunas)"),
    ("idade_apos", [58, 60, 62, 65, 67, 70], "int", "meta", [25000, 30000, 32400, 35000, 40000], "brl",
     "Idade de aposentadoria (linhas) × meta de renda (colunas)"),
]


def _two_way(ws, r, lo):
    sec(ws, r, "E. TABELAS DE DUAS VARIÁVEIS — % da meta atingido (verde ≥ 100%)", 23)
    OUT["sec_two"] = r
    r += 2
    for rk, rv, rf, ck, cv, cf, ttl in TWO:
        ws.cell(r, 1, ttl).font = font(bold=True, size=11)
        r += 1
        corner = ws.cell(r, 3, f"={OUT['pct_meta']}")
        corner.number_format = FMT["pct"]
        corner.font = font(GRAY, italic=True, size=8)
        corner.fill = F_TIME
        ws.cell(r, 2, "% da meta →").font = font(GRAY, italic=True, size=8)
        for j, v in enumerate(cv):
            put(ws, f"{L(4 + j)}{r}", v, cf, bold=True, align="center", fill=F_TIME)
        r1 = r + 1
        for i, v in enumerate(rv):
            put(ws, f"C{r1 + i}", v, rf, bold=True, align="center", fill=F_TIME)
        r2 = r1 + len(rv) - 1
        data_table(ws, r1, 4, r2, 3 + len(cv), row_input=f"T{LROW[ck]}", col_input=f"T{LROW[rk]}", lo=lo)
        for rr in range(r1, r2 + 1):
            for j in range(len(cv)):
                x = ws.cell(rr, 4 + j)
                x.number_format = FMT["pct"]
                x.border = BOX
        _pct_scale(ws, f"D{r1}:{L(3 + len(cv))}{r2}")
        r = r2 + 3
    return r
