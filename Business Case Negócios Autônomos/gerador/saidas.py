# -*- coding: utf-8 -*-
"""Abas de saída e controle: Painel (comparativo e ranking), Sensibilidade (Tabela de Dados), Checks, Capa e Instruções."""
import os
from estilo import *
from premissas_globais import G
from aba_caso import KPI, SCOL
from openpyxl.worksheet.formula import DataTableFormula
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule, DataBarRule
from openpyxl.chart import BarChart, Reference
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.drawing.line import LineProperties
from openpyxl.chart.text import RichText
from openpyxl.drawing.text import Paragraph, ParagraphProperties, CharacterProperties, Font as DFont

# O LibreOffice (usado só na verificação automática) não lê Tabelas de Dados nativas do Excel.
# Com LO_VERIFY=1 gera-se uma cópia de teste em que cada célula usa a função equivalente TABLE()/MULTIPLE.OPERATIONS.
LO = bool(os.environ.get("LO_VERIFY"))

F_VERDE = PatternFill("solid", fgColor="C6EFCE")
F_AMAR = PatternFill("solid", fgColor="FFEB9C")
F_VERM = PatternFill("solid", fgColor="FFC7CE")
F_VERDE2 = PatternFill("solid", fgColor="E2EFDA")

COLS = [  # (título, chave KPI ou None, coluna do cenário, formato, largura)
    ("Código", None, None, "gen", 9), ("Negócio", None, None, "gen", 46), ("Categoria", None, None, "gen", 20),
    ("Investimento (R$)", "inv", "B", "brl", 13), ("Capital próprio (R$)", "cap_proprio", "B", "brl", 13),
    ("Receita ano 5 (R$)", "rec5", "B", "brl", 13), ("Margem EBITDA ano 5", "mg5", "B", "pct", 10),
    ("Horas / semana", "horas", "B", "num", 9), ("VPL Base (R$)", "vpl", "B", "brl", 13),
    ("TIR real Base", "tir", "B", "pct", 10), ("TIR Pessimista", "tir", "P", "pct", 10), ("TIR Otimista", "tir", "O", "pct", 10),
    ("TIR Estresse global", "tir", "E", "pct", 10), ("TIR acionista Base", "tir_acion", "B", "pct", 10),
    ("Payback simples (anos)", "pb", "B", "anos", 9), ("Payback descontado (anos)", "pbd", "B", "anos", 10),
    ("ROI 5 anos", "roi", "B", "pct", 9), ("MOIC", "moic", "B", "mult", 8), ("Margem de segurança", "ms", "B", "pct", 10),
    ("Dependência do valor residual", "dep_vr", "B", "pct", 11), ("Risco regulatório", None, None, "gen", 11),
    ("Veredito", "veredito", "B", "gen", 22), ("Ranking (TIR Base)", None, None, "idx", 9), ("Checks da aba", None, None, "gen", 9),
    ("VPL Estresse (R$)", "vpl", "E", "brl", 13),
]
PR0 = 9   # primeira linha de dados do Painel


def txt(size=9, color="595959", bold=False):
    cp = CharacterProperties(sz=size * 100, b=bold, solidFill=color, latin=DFont(typeface="Arial"))
    return RichText(p=[Paragraph(pPr=ParagraphProperties(defRPr=cp), endParaRPr=cp)])


def build_painel(wb, abas):
    ws = wb.create_sheet("Painel")
    n = len(abas)
    ncol = len(COLS)
    faixa_titulo(ws, "PAINEL — comparativo de todos os negócios autônomos (5 anos, R$ constantes de 2026)",
                 "Tudo aqui é calculado a partir das abas BC. Clique no código para abrir a aba do negócio.", ncol)
    ws.cell(3, 1, "TMA real").font = font(bold=True)
    formula(ws.cell(3, 2), f"={G['tma']}", "pct")
    ws.cell(3, 3, "Tesouro IPCA+ real").font = font(bold=True)
    formula(ws.cell(3, 4), f"={G['tesouro']}", "pct")
    ws.cell(3, 5, "Horas a R$/h").font = font(bold=True)
    formula(ws.cell(3, 6), f"={G['custo_hora']}", "brl2")
    ws.cell(3, 7, "Contar horas?").font = font(bold=True)
    formula(ws.cell(3, 8), f"={G['conta_horas']}", "idx")
    tma_c, tes_c = "$B$3", "$D$3"
    # resumo dos vereditos
    secao(ws, 4, "RESUMO", ncol)
    vcol = L(1 + [c[0] for c in COLS].index("Veredito"))
    rng_v = f"${vcol}${PR0}:${vcol}${PR0 + n - 1}"
    for i, (rot, crit) in enumerate((("Negócios analisados", None), ("AVANÇAR", "AVANÇAR"), ("AVANÇAR COM CAUTELA", "AVANÇAR COM CAUTELA"),
                                     ("SÓ COM ALAVANCAS", "SÓ COM ALAVANCAS"), ("DESCARTAR", "DESCARTAR"))):
        x = ws.cell(5, 2 + i, rot)
        x.font = font(bold=True)
        x.alignment = Alignment(horizontal="center", wrap_text=True)
        f = f"=COUNTA($A${PR0}:$A${PR0 + n - 1})" if crit is None else f'=COUNTIF({rng_v},"{crit}")'
        formula(ws.cell(6, 2 + i), f, "idx", True, F_OUT)
        ws.cell(6, 2 + i).alignment = Alignment(horizontal="center")
    ws.row_dimensions[5].height = 40
    nota(ws, 6, "Regra do veredito: AVANÇAR = VPL > 0 no Base e no Estresse global · AVANÇAR COM CAUTELA = VPL > 0 só no Base · "
                "SÓ COM ALAVANCAS = TIR Base entre o Tesouro IPCA+ e a TMA · DESCARTAR = TIR Base abaixo do Tesouro.", col=8)
    secao(ws, 7, "COMPARATIVO — cenário Base, salvo indicação na coluna", ncol)
    for j, (t, *_r) in enumerate(COLS):
        x = ws.cell(8, 1 + j, t)
        x.font = font(bold=True)
        x.fill = F_TIME
        x.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[L(1 + j)].width = COLS[j][4]
    ws.row_dimensions[8].height = 44
    tir_col = L(1 + [c[0] for c in COLS].index("TIR real Base"))
    for i, a in enumerate(abas):
        r = PR0 + i
        c = a.c
        sh = f"'{c['aba']}'"
        for j, (t, k, s, fmt, _w) in enumerate(COLS):
            x = ws.cell(r, 1 + j)
            if t == "Código":
                x.value = c["cod"]
                x.hyperlink = f"#{sh}!A1"
                x.font = font("0563C1", underline="single")
            elif t == "Negócio":
                x.value = c["nome"]
                x.font = font()
            elif t == "Categoria":
                x.value = c["categoria"]
                x.font = font(GRAY)
            elif t == "Risco regulatório":
                x.value = c["risco_reg"]
                x.font = font(GRAY)
            elif t == "Ranking (TIR Base)":
                formula(x, f'=IF(ISNUMBER({tir_col}{r}),RANK({tir_col}{r},${tir_col}${PR0}:${tir_col}${PR0 + n - 1},0),"—")', "idx")
            elif t == "Checks da aba":
                formula(x, f'=IF(COUNTIF({sh}!{a.check_range},"ERRO")>0,"ERRO",IF(COUNTIF({sh}!{a.check_range},"ALERTA")>0,"ALERTA","OK"))', "gen")
            else:
                formula(x, f"={sh}!${L(SCOL[s])}${KPI[k]}", fmt)
            x.alignment = Alignment(horizontal="left" if t in ("Negócio", "Categoria", "Veredito", "Risco regulatório") else "right")
    last = PR0 + n - 1
    # formatação condicional
    for t in ("TIR real Base", "TIR Pessimista", "TIR Otimista", "TIR Estresse global", "TIR acionista Base"):
        col = L(1 + [c[0] for c in COLS].index(t))
        rng = f"{col}{PR0}:{col}{last}"
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f"AND(ISNUMBER({col}{PR0}),{col}{PR0}>={tma_c})"], fill=F_VERDE))
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f"AND(ISNUMBER({col}{PR0}),{col}{PR0}>={tes_c},{col}{PR0}<{tma_c})"], fill=F_AMAR))
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f"OR(NOT(ISNUMBER({col}{PR0})),{col}{PR0}<{tes_c})"], fill=F_VERM))
    vr = f"{vcol}{PR0}:{vcol}{last}"
    for crit, fill in (("AVANÇAR", F_VERDE), ("AVANÇAR COM CAUTELA", F_VERDE2), ("SÓ COM ALAVANCAS", F_AMAR), ("DESCARTAR", F_VERM)):
        ws.conditional_formatting.add(vr, FormulaRule(formula=[f'{vcol}{PR0}="{crit}"'], fill=fill))
    vpl_col = L(1 + [c[0] for c in COLS].index("VPL Base (R$)"))
    ws.conditional_formatting.add(f"{vpl_col}{PR0}:{vpl_col}{last}", DataBarRule(start_type="min", end_type="max", color="5B9BD5"))
    ck = L(1 + [c[0] for c in COLS].index("Checks da aba"))
    ws.conditional_formatting.add(f"{ck}{PR0}:{ck}{last}", FormulaRule(formula=[f'{ck}{PR0}="ERRO"'], fill=F_VERM))
    ws.conditional_formatting.add(f"{ck}{PR0}:{ck}{last}", FormulaRule(formula=[f'{ck}{PR0}="ALERTA"'], fill=F_AMAR))
    # ranking ordenado
    r0 = last + 3
    secao(ws, r0, "RANKING POR TIR REAL NO CENÁRIO BASE (ordenado automaticamente)", ncol)
    hdr = ["Posição", "Negócio", "TIR real Base", "VPL Base (R$)", "Investimento (R$)", "Horas / semana", "TIR Estresse global", "Veredito"]
    for j, t in enumerate(hdr):
        if t:
            x = ws.cell(r0 + 1, 1 + j, t)
            x.font = font(bold=True)
            x.fill = F_TIME
            x.alignment = Alignment(horizontal="center", wrap_text=True)
    ws.row_dimensions[r0 + 1].height = 30
    idx = {t: L(1 + [c[0] for c in COLS].index(t)) for t in ("Negócio", "TIR real Base", "VPL Base (R$)", "Investimento (R$)",
                                                              "Horas / semana", "TIR Estresse global", "Veredito")}
    # coluna auxiliar no Painel principal (Z): TIR numérica + desempate
    aux = L(ncol + 2)
    ws.cell(8, ncol + 2, "Auxiliar ranking").font = font(GRAY, italic=True, size=8)
    for i in range(n):
        r = PR0 + i
        formula(ws.cell(r, ncol + 2), f"=IF(ISNUMBER({tir_col}{r}),{tir_col}{r},-9)+ROW()/1000000000", "num3", fill=F_TOT)
        ws.cell(r, ncol + 2).font = font(GRAY, size=8)
    auxr = f"${aux}${PR0}:${aux}${last}"
    for k in range(n):
        r = r0 + 2 + k
        formula(ws.cell(r, 1), k + 1, "idx")
        m = f"MATCH(LARGE({auxr},{k + 1}),{auxr},0)"
        for j, t in enumerate(["Negócio", "TIR real Base", "VPL Base (R$)", "Investimento (R$)", "Horas / semana", "TIR Estresse global",
                               "Veredito"]):
            col = idx[t]
            fmt = {"TIR real Base": "pct", "TIR Estresse global": "pct", "VPL Base (R$)": "brl", "Investimento (R$)": "brl",
                   "Horas / semana": "num"}.get(t, "gen")
            formula(ws.cell(r, 2 + j), f"=INDEX(${col}${PR0}:${col}${last},{m})", fmt)
    rl = r0 + 2 + n - 1
    for col_t in ("C", "G"):
        rng = f"{col_t}{r0 + 2}:{col_t}{rl}"
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f"AND(ISNUMBER({col_t}{r0 + 2}),{col_t}{r0 + 2}>={tma_c})"], fill=F_VERDE))
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f"AND(ISNUMBER({col_t}{r0 + 2}),{col_t}{r0 + 2}>={tes_c},{col_t}{r0 + 2}<{tma_c})"], fill=F_AMAR))
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f"OR(NOT(ISNUMBER({col_t}{r0 + 2})),{col_t}{r0 + 2}<{tes_c})"], fill=F_VERM))
    vr2 = f"H{r0 + 2}:H{rl}"
    for crit, fill in (("AVANÇAR", F_VERDE), ("AVANÇAR COM CAUTELA", F_VERDE2), ("SÓ COM ALAVANCAS", F_AMAR), ("DESCARTAR", F_VERM)):
        ws.conditional_formatting.add(vr2, FormulaRule(formula=[f'H{r0 + 2}="{crit}"'], fill=fill))
    # gráfico de barras (ranking)
    ch = BarChart()
    ch.type = "bar"
    ch.title = None
    ch.style = None
    ch.legend = None
    ch.height, ch.width = max(9, 0.5 * n), 17
    data = Reference(ws, min_col=3, min_row=r0 + 1, max_row=rl)
    cats = Reference(ws, min_col=2, min_row=r0 + 2, max_row=rl)
    ch.add_data(data, titles_from_data=True)
    ch.set_categories(cats)
    s = ch.series[0]
    s.graphicalProperties.solidFill = "24528F"
    s.graphicalProperties.line.noFill = True
    s.invertIfNegative = False
    ch.y_axis.number_format = "0%"
    ch.y_axis.majorGridlines = None
    ch.x_axis.scaling.orientation = "maxMin"     # 1º do ranking no topo
    ch.x_axis.tickLblPos = "low"                  # rótulos à esquerda, fora das barras negativas
    ch.x_axis.txPr = txt(8)
    ch.y_axis.txPr = txt(8)
    ch.x_axis.delete = False
    ch.y_axis.delete = False
    ch.graphical_properties = GraphicalProperties(solidFill="FFFFFF", ln=LineProperties(noFill=True))
    ws.add_chart(ch, f"J{r0 + 1}")
    ws.freeze_panes = ws.cell(PR0, 3)
    ws.sheet_view.zoomScale = 85
    return ws, r0


def finish_sensibilidade(wb, abas, r_ini):
    ws = wb["Sensibilidade"]
    n = len(abas)
    r = r_ini + 1
    secao(ws, r, "TABELA DE DADOS — VPL do negócio escolhido sob o estresse global, variando demanda × preço", 12)
    r += 1
    ws.cell(r, 1, "Negócio (código)").font = font(bold=True)
    entrada(ws.cell(r, 3), abas[0].c["cod"], "gen", True)
    sel = f"$C${r}"
    dv = DataValidation(type="list", formula1=f"=Painel!$A${PR0}:$A${PR0 + n - 1}", showErrorMessage=True)
    ws.add_data_validation(dv)
    dv.add(f"C{r}")
    ws.cell(r, 5, "Escolha o código na lista. Os demais choques (investimento, fixos, energia, atraso, horas) ficam como estão acima.").font = font(GRAY, italic=True, size=9)
    r += 1
    ws.cell(r, 1, "Negócio escolhido").font = font(bold=True)
    vpl_e = L(1 + [c[0] for c in COLS].index("VPL Estresse (R$)"))
    formula(ws.cell(r, 3), f"=INDEX(Painel!$B${PR0}:$B${PR0 + n - 1},MATCH({sel},Painel!$A${PR0}:$A${PR0 + n - 1},0))", "gen")
    r += 1
    ws.cell(r, 1, "Linhas = choque de demanda; colunas = choque de preço. Valores em R$. Fundo cinza = calculado pelo Excel (não editar).").font = font(GRAY, italic=True, size=9)
    r += 2
    corner = r
    formula(ws.cell(corner, 2), f"=INDEX(Painel!${vpl_e}${PR0}:${vpl_e}${PR0 + n - 1},MATCH({sel},Painel!$A${PR0}:$A${PR0 + n - 1},0))", "brl", True, F_OUT)
    precos = [0.85, 0.90, 0.95, 1.00, 1.05, 1.10]
    demandas = [0.60, 0.70, 0.80, 0.90, 1.00, 1.10, 1.20]
    for j, p in enumerate(precos):
        entrada(ws.cell(corner, 3 + j), p, "mult")
    for i, d in enumerate(demandas):
        entrada(ws.cell(corner + 1 + i, 2), d, "mult")
    r1, c1, r2, c2 = corner + 1, 3, corner + len(demandas), 2 + len(precos)
    row_input = G["s_pre"].split("!")[1].replace("$", "")
    col_input = G["s_dem"].split("!")[1].replace("$", "")
    if not LO:
        ws.cell(r1, c1).value = DataTableFormula(ref=f"{L(c1)}{r1}:{L(c2)}{r2}", dt2D=True, dtr=True, r1=row_input, r2=col_input)
    else:
        ab = lambda a: "$" + a[0] + "$" + a[1:]
        for rr in range(r1, r2 + 1):
            for cc in range(c1, c2 + 1):
                ws.cell(rr, cc).value = f"=TABLE(${L(c1 - 1)}${r1 - 1},{ab(col_input)},${L(c1 - 1)}{rr},{ab(row_input)},{L(cc)}${r1 - 1})"
    for rr in range(r1, r2 + 1):
        for cc in range(c1, c2 + 1):
            x = ws.cell(rr, cc)
            x.number_format = FMT["brl"]
            x.fill = F_TOT
            x.font = font()
    ws.conditional_formatting.add(f"{L(c1)}{r1}:{L(c2)}{r2}", FormulaRule(formula=[f"{L(c1)}{r1}<0"], font=Font(color=RED)))
    ws.cell(corner - 1, 3, "Preço →").font = font(bold=True)
    ws.cell(corner + 1, 1, "Demanda ↓").font = font(bold=True)
    nota(ws, r2 + 2, "Tabela de Dados nativa do Excel: recalcula todas as abas para cada célula. Se o Excel ficar lento, use "
                     "Fórmulas > Opções de Cálculo > 'Automático, exceto Tabelas de Dados' e pressione F9 para atualizar.", col=1)
    return dict(sel=sel, corner=corner, r1=r1, c1=c1, precos=precos, demandas=demandas)


def build_checks(wb, abas):
    ws = wb.create_sheet("Checks")
    faixa_titulo(ws, "CHECKS — integridade do modelo e alertas de premissa",
                 "ERRO = fórmula ou integridade quebrada (corrigir). ALERTA = premissa fora da faixa esperada (revisar).", 6)
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 50
    for c in "CDEF":
        ws.column_dimensions[c].width = 16
    ws.cell(4, 1, "Resumo").font = font(bold=True)
    n = len(abas)
    formula(ws.cell(4, 2), f'=IF(COUNTIF($C$8:$C${7 + n},"ERRO")>0,"HÁ ERROS",IF(COUNTIF($C$8:$C${7 + n},"ALERTA")>0,"OK COM ALERTAS","TUDO OK"))',
            "gen", True, F_OUT)
    secao(ws, 6, "POR ABA", 6)
    for j, t in enumerate(("Código", "Negócio", "Status", "Nº de ERRO", "Nº de ALERTA")):
        x = ws.cell(7, 1 + j, t)
        x.font = font(bold=True)
        x.fill = F_TIME
    for i, a in enumerate(abas):
        r = 8 + i
        sh = f"'{a.c['aba']}'"
        x = ws.cell(r, 1, a.c["cod"])
        x.hyperlink = f"#{sh}!A1"
        x.font = font("0563C1", underline="single")
        ws.cell(r, 2, a.c["nome"]).font = font()
        formula(ws.cell(r, 4), f'=COUNTIF({sh}!{a.check_range},"ERRO")', "int")
        formula(ws.cell(r, 5), f'=COUNTIF({sh}!{a.check_range},"ALERTA")', "int")
        formula(ws.cell(r, 3), f'=IF(D{r}>0,"ERRO",IF(E{r}>0,"ALERTA","OK"))', "gen", True)
    ws.conditional_formatting.add(f"C8:C{7 + n}", FormulaRule(formula=['C8="ERRO"'], fill=F_VERM))
    ws.conditional_formatting.add(f"C8:C{7 + n}", FormulaRule(formula=['C8="ALERTA"'], fill=F_AMAR))
    ws.conditional_formatting.add(f"C8:C{7 + n}", FormulaRule(formula=['C8="OK"'], fill=F_VERDE))
    ws.freeze_panes = "A8"
    return ws


def build_capa(wb, abas, desc_abas, versao):
    ws = wb.create_sheet("Capa")
    faixa_titulo(ws, "NEGÓCIOS AUTÔNOMOS EM PORTO VELHO (RO) — BUSINESS CASES COMPARÁVEIS",
                 f"{len(abas)} negócios, mesmo motor de cálculo, fluxo de caixa de 5 anos em R$ constantes. Sem macros. {versao}", 4)
    ws.column_dimensions["A"].width = 50
    ws.column_dimensions["B"].width = 95
    ws.column_dimensions["C"].width = 16
    ws.column_dimensions["D"].width = 16
    n = len(abas)
    linhas = [("Negócios analisados", "=Painel!B6", "idx"), ("AVANÇAR (VPL > 0 no Base e no Estresse)", "=Painel!C6", "idx"),
              ("AVANÇAR COM CAUTELA (VPL > 0 só no Base)", "=Painel!D6", "idx"), ("SÓ COM ALAVANCAS (TIR entre Tesouro e TMA)", "=Painel!E6", "idx"),
              ("DESCARTAR (TIR abaixo do Tesouro)", "=Painel!F6", "idx"),
              ("Maior TIR real no Base", f"=MAX(Painel!$J${PR0}:$J${PR0 + n - 1})", "pct"),
              ("Negócio com a maior TIR", f"=INDEX(Painel!$B${PR0}:$B${PR0 + n - 1},MATCH(MAX(Painel!$J${PR0}:$J${PR0 + n - 1}),Painel!$J${PR0}:$J${PR0 + n - 1},0))", "gen"),
              ("Status dos checks", "=Checks!B4", "gen")]
    for i, (rot, f, fmt) in enumerate(linhas):
        r = 4 + i
        ws.cell(r, 1, rot).font = font(bold=True)
        formula(ws.cell(r, 2), f, fmt, True)
        ws.cell(r, 2).alignment = Alignment(horizontal="left")
    r = 4 + len(linhas) + 1
    secao(ws, r, "LEGENDA DE CORES", 4)
    leg = [("Entrada editável", font(BLUE), F_IN, "Fonte azul em fundo amarelo-claro. Únicas células que devem ser digitadas."),
           ("Premissa-chave", font(BLUE, True), F_KEY, "Entradas que mais movem o resultado (TMA, energia, horas, choques)."),
           ("Fórmula local", font(BLACK), None, "Fonte preta: cálculo com dados da própria aba."),
           ("Vínculo entre abas", font(GREEN), None, "Fonte verde: fórmula que busca dado em outra aba (Premissas, Sensibilidade)."),
           ("Total / auxiliar", font(BLACK, True), F_TOT, "Fundo cinza: totais, auxiliares e Tabela de Dados. Não editar."),
           ("Resultado em destaque", font(BLACK, True), F_OUT, "Fundo verde-claro: indicadores do cenário Base."),
           ("Semáforo da TIR", font(BLACK), F_VERDE, "Verde ≥ TMA · amarelo entre Tesouro IPCA+ e TMA · vermelho abaixo do Tesouro.")]
    for i, (t, f, fill, d) in enumerate(leg):
        x = ws.cell(r + 1 + i, 1, t)
        x.font = f
        if fill:
            x.fill = fill
        ws.cell(r + 1 + i, 2, d).font = font(GRAY, italic=True)
    r = r + 1 + len(leg) + 1
    secao(ws, r, "ÍNDICE DAS ABAS (clique para navegar)", 4)
    for j, t in enumerate(("Aba", "Descrição", "Tipo")):
        ws.cell(r + 1, 1 + j, t).font = font(bold=True)
    rr = r + 2
    for nm, tp, d in desc_abas:
        x = ws.cell(rr, 1, nm)
        x.hyperlink = f"#'{nm}'!A1"
        x.font = font("0563C1", underline="single")
        ws.cell(rr, 2, d).font = font()
        ws.cell(rr, 3, tp).font = font(GRAY, italic=True)
        rr += 1
    ws.cell(rr + 1, 1, "Modelo de planejamento: os números-padrão são pontos de partida. Antes de investir, valide no campo as premissas "
                       "marcadas VALIDAR nas abas (preços, demanda, aluguel, tarifas).").font = font(GRAY, italic=True, size=9)
    return ws


def build_instrucoes(wb, texto):
    ws = wb.create_sheet("Instrucoes")
    faixa_titulo(ws, "INSTRUÇÕES, LÓGICA E DOCUMENTAÇÃO DO MODELO", "Leia uma vez antes de usar.", 1)
    r = 4
    for kind, t in texto:
        if kind == "h":
            r += 1
            secao(ws, r, t, 1)
        else:
            x = ws.cell(r, 1, t)
            x.font = font()
            x.alignment = Alignment(wrap_text=True, vertical="top")
            ws.row_dimensions[r].height = 14 * (1 + len(t) // 165)
        r += 1
    ws.column_dimensions["A"].width = 170
    return ws
