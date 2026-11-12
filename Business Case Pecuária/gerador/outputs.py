# -*- coding: utf-8 -*-
"""Abas de saida: Retorno, Resumo_Anual, tabelas de dados, Painel, Checks, Capa, Instrucoes."""
from framework import *
from inputs import SCEN_ROW0, LEVERS, SHOCKS, SH_ROW0, SCEN_NAMES
from openpyxl.worksheet.formula import DataTableFormula
from openpyxl.chart import LineChart, BarChart, Reference, Series
from openpyxl.formatting.rule import CellIsRule, FormulaRule
import os
# O LibreOffice (usado so na verificacao automatica) nao le Tabelas de Dados com varias colunas.
# Com LO_VERIFY=1 gera-se uma copia de teste em que cada celula usa a funcao equivalente TABLE();
# o arquivo entregue usa sempre a Tabela de Dados nativa do Excel.
LO = bool(os.environ.get("LO_VERIFY"))


def data_table(ws, r1, c1, r2, c2, row_input=None, col_input=None):
    """Tabela de Dados. Cabecalho de formulas na linha r1-1 (1 variavel) ou canto (r1-1, c1-1) (2 variaveis)."""
    two = row_input is not None and col_input is not None
    if not LO:
        ref = f"{L(c1)}{r1}:{L(c2)}{r2}"
        ws.cell(r1, c1).value = (DataTableFormula(ref=ref, dt2D=True, dtr=True, r1=row_input, r2=col_input) if two
                                 else DataTableFormula(ref=ref, dt2D=False, dtr=False, r1=col_input))
        return
    ab = lambda a: "$" + a[0] + "$" + a[1:]
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            if two:
                f = f"=TABLE(${L(c1-1)}${r1-1},{ab(col_input)},${L(c1-1)}{r},{ab(row_input)},{L(c)}${r1-1})"
            else:
                f = f"=TABLE({L(c)}${r1-1},{ab(col_input)},${L(c1-1)}{r})"
            ws.cell(r, c).value = f

ALL = lambda code, key: f"{SHEETS[code]}!${L(C0)}${ROWS[(code, key)]}:${L(CL)}${ROWS[(code, key)]}"
TOT = lambda code, key: f"{SHEETS[code]}!$C${ROWS[(code, key)]}"
YR = lambda code: f"{SHEETS[code]}!${L(C0)}$5:${L(CL)}$5"


def title(ws, t, sub, ncol=14):
    ws.sheet_view.showGridLines = False
    ws["A1"] = t
    ws["A1"].font = font(WHITE, True, size=13)
    ws["A2"] = sub
    ws["A2"].font = font(WHITE, italic=True)
    for rr in (1, 2):
        for c in range(1, ncol + 1):
            ws.cell(rr, c).fill = F_HEAD


def sec(ws, r, t, ncol=14):
    for c in range(1, ncol + 1):
        ws.cell(r, c).fill = F_SEC
    ws.cell(r, 1, t).font = font(bold=True, size=11)


def put(ws, addr, v, fmt="brl", bold=False, color=None, fill=None):
    x = ws[addr]
    x.value = v
    x.number_format = FMT[fmt]
    col = color or (GREEN if isinstance(v, str) and v.startswith("=") and "!" in v else BLACK)
    x.font = font(col, bold)
    if fill:
        x.fill = fill
    return x


def build_retorno(wb):
    ws = wb.create_sheet("Retorno")
    SHEETS["R"] = "Retorno"
    title(ws, "RETORNO E INDICADORES — cenário ativo", "Indicadores calculados sobre os 120 meses. Alimentam o Painel e as Tabelas de Dados.", 5)
    K = [
        ("sec", "RETORNO DO PROJETO (sem alavancagem)"),
        ("k_vpl", "Valor presente líquido (VPL)", "R$", "brl", f"=SUM({ALL('FC','vp')})",
         "Fluxo de caixa livre mensal + valor terminal por liquidação, descontados à taxa real."),
        ("k_tir", "Taxa interna de retorno real (TIR a.a.)", "% a.a.", "pct", f'=IFERROR((1+IRR({ALL("FC","fcl_vt")},0.01))^12-1,"n/d")',
         "TIR mensal anualizada. 'n/d' quando o fluxo não troca de sinal."),
        ("k_expo", "Exposição máxima de caixa", "R$", "brl", f"=-MIN(0,{TOT('FC','cum')})",
         "Maior saldo negativo do fluxo livre acumulado: quanto dinheiro o projeto consome antes de se pagar."),
        ("k_pb", "Payback simples", "meses", "int", f'=IF({TOT("FC","pb")}=0,"não atinge",{TOT("FC","pb")})', "Primeiro mês com fluxo livre acumulado ≥ 0 (sem valor terminal)."),
        ("k_ref", "VPL de referência: arrendar toda a área útil a terceiros", "R$", "brl", f"=SUM({ALL('FC','vp_ref')})",
         "Alternativa passiva: nenhum investimento, só a renda do arrendamento. É o custo de oportunidade da terra."),
        ("k_inc", "VPL incremental: operar a fazenda × arrendar tudo", "R$", "brl", "={k_vpl}-{k_ref}",
         "INDICADOR DE DECISÃO: positivo = a operação cria valor além do que a terra renderia arrendada e do custo do capital."),
        ("k_vt", "Valor terminal por liquidação (mês 120)", "R$", "brl", f"=SUM({ALL('FC','vt')})", "Rebanho, estoques, recebíveis, imobilizado líquido."),
        ("sec", "VISÃO DO SÓCIO"),
        ("k_cap", "Capital total aportado pelos sócios", "R$", "brl", f"=SUM({ALL('FC','aporte')})+SUM({ALL('FC','aporte_ad')})", "Aporte inicial + aportes adicionais exigidos."),
        ("k_apad", "   dos quais aportes adicionais (acima do capital disponível)", "R$", "brl", f"=SUM({ALL('FC','aporte_ad')})",
         "Se > 0, o capital informado não sustenta o cenário."),
        ("k_tirs", "TIR real do sócio (a.a.)", "% a.a.", "pct", f'=IFERROR((1+IRR({ALL("FC","fs")},0.01))^12-1,"n/d")', "Considera dívida e liquidação no mês 120."),
        ("k_moic", "Múltiplo do capital (patrimônio final / capital aportado)", "x", "mult",
         f"=IF({{k_cap}}>0,({TOT('FC','caixa')}+{{k_vt}}-{TOT('F','divida')})/{{k_cap}},0)", ""),
        ("k_caixa", "Saldo de caixa no mês 120", "R$", "brl", f"={TOT('FC','caixa')}", ""),
        ("k_divmax", "Dívida máxima", "R$", "brl", f"=MAX({ALL('F','divida')})", ""),
        ("sec", "RESULTADO"),
        ("k_rec", "Receita bruta média anual", "R$/ano", "brl", f"={TOT('D','rb')}/10", ""),
        ("k_ebitda", "EBITDA médio anual", "R$/ano", "brl", f"={TOT('D','ebitda')}/10", ""),
        ("k_mg", "Margem EBITDA sobre receita líquida", "%", "pct", f"=IF({TOT('D','rl')}>0,{TOT('D','ebitda')}/{TOT('D','rl')},0)", ""),
        ("k_ll", "Lucro líquido acumulado em 10 anos", "R$", "brl", f"={TOT('D','ll')}", ""),
        ("k_cr", "Margem acumulada — cria", "R$", "brl", f"={TOT('U','cr')}", "Com transferências a mercado e arrendamento imputado."),
        ("k_re", "Margem acumulada — recria", "R$", "brl", f"={TOT('U','re')}", ""),
        ("k_en", "Margem acumulada — engorda", "R$", "brl", f"={TOT('U','en')}", ""),
        ("k_la", "Margem acumulada — lavoura e grãos", "R$", "brl", f"={TOT('U','la')}", ""),
        ("k_es", "Resultado acumulado — estrutura", "R$", "brl", f"={TOT('U','es')}", "Custos fixos líquidos do arrendamento imputado recebido."),
        ("sec", "INDICADORES FÍSICOS"),
        ("k_cab", "Rebanho no mês 120", "cab", "num", f"={TOT('Reb','cab_total')}", ""),
        ("k_lot", "Lotação média", "UA/ha", "num2", f"={TOT('Reb','lotacao')}", ""),
        ("k_lotmax", "Lotação máxima", "UA/ha", "num2", f"=MAX({ALL('Reb','lotacao')})", ""),
        ("k_cabv", "Cabeças vendidas em 10 anos", "cab", "num", f"={TOT('Reb','cab_vend')}", ""),
        ("k_arr", "Arrobas de boi gordo vendidas em 10 anos", "@", "num", f"={TOT('O','arr_tot')}", ""),
        ("k_arrha", "Arrobas de boi gordo por hectare útil por ano", "@/ha/ano", "num2", f"={{k_arr}}/10/{paddr('area_util')}", ""),
        ("k_def", "Déficit de forragem acumulado", "t MS", "num", f"={TOT('N','f_def')}", "Se alto, a lotação está acima do que o pasto suporta."),
        ("k_conf", "Pico de animais no confinamento", "cab", "num", f"=MAX({ALL('Reb','ec_pres')})", ""),
    ]
    r = 4
    pend = []
    for it in K:
        if it[0] == "sec":
            r += 1
            sec(ws, r, it[1], 5)
            r += 1
            continue
        name, lab, unit, fmt, f, note = it
        PREM[name] = ("Retorno", r, 3)
        ws.cell(r, 1, lab).font = font()
        ws.cell(r, 2, unit).font = font(GRAY, italic=True)
        pend.append((r, f, fmt))
        ws.cell(r, 4, note).font = font(GRAY, italic=True, size=9)
        r += 1
    for r, f, fmt in pend:
        f = re.sub(r"\{(k_[a-z]+)\}", lambda m: f"$C${PREM[m.group(1)][1]}", f)
        x = ws.cell(r, 3, f)
        x.number_format = FMT[fmt]
        x.font = font(GREEN if "!" in f else BLACK, True)
        x.fill = F_OUT
        x.alignment = Alignment(horizontal="right")
    ws.column_dimensions["A"].width = 62
    ws.column_dimensions["B"].width = 11
    ws.column_dimensions["C"].width = 18
    ws.column_dimensions["D"].width = 100
    return ws


def build_anual(wb):
    ws = wb.create_sheet("Resumo_Anual")
    SHEETS["A"] = "Resumo_Anual"
    title(ws, "RESUMO ANUAL — demonstrações e indicadores por ano do modelo", "Soma (ou saldo de fim de ano) das linhas mensais do cenário ativo.", 14)
    ws["A4"] = "Ano do modelo"
    ws["A4"].font = font(bold=True)
    for y in range(1, 11):
        x = ws.cell(4, 3 + y, y)
        x.font = font(bold=True)
        x.fill = F_TIME
        x.alignment = Alignment(horizontal="center")
    x = ws.cell(4, 14, "Total")
    x.font = font(bold=True)
    x.fill = F_TIME
    x.alignment = Alignment(horizontal="center")
    S = [
        ("sec", "DRE GERENCIAL"),
        ("D", "rb", "Receita bruta", "sum", "brl", 0), ("D", "ded", "(−) Deduções", "sum", "brl", 0),
        ("D", "compras", "(−) Compras de animais", "sum", "brl", 0), ("D", "dv_reb", "(+/−) Variação do valor do rebanho", "sum", "brl", 0),
        ("D", "dv_gr", "(+/−) Variação do estoque de grãos", "sum", "brl", 0), ("D", "alim", "(−) Alimentação comprada", "sum", "brl", 0),
        ("D", "var", "(−) Sanidade, operação e pasto", "sum", "brl", 0), ("D", "lav", "(−) Custos de lavoura", "sum", "brl", 0),
        ("D", "mc", "Margem de contribuição", "sum", "brl", 1), ("D", "fixos", "(−) Custos fixos", "sum", "brl", 0),
        ("D", "ebitda", "EBITDA", "sum", "brl", 1), ("D", "dep", "(−) Depreciação", "sum", "brl", 0), ("D", "jur", "(−) Juros", "sum", "brl", 0),
        ("D", "ir", "(−) IRPF", "sum", "brl", 0), ("D", "ll", "Lucro líquido", "sum", "brl", 1),
        ("sec", "RESULTADO POR UNIDADE DE NEGÓCIO"),
        ("U", "cr", "Margem da cria", "sum", "brl", 0), ("U", "re", "Margem da recria", "sum", "brl", 0), ("U", "en", "Margem da engorda", "sum", "brl", 0),
        ("U", "la", "Margem da lavoura e grãos", "sum", "brl", 0), ("U", "es", "Resultado da estrutura", "sum", "brl", 0),
        ("U", "soma", "Soma = EBITDA", "sum", "brl", 1),
        ("sec", "FLUXO DE CAIXA"),
        ("FC", "op", "Fluxo operacional", "sum", "brl", 0), ("FC", "inv", "Fluxo de investimento", "sum", "brl", 0),
        ("FC", "fcl", "Fluxo de caixa livre", "sum", "brl", 1), ("FC", "fin", "Fluxo de financiamento", "sum", "brl", 0),
        ("FC", "aporte_ad", "   dos quais aportes adicionais dos sócios", "sum", "brl", 0),
        ("FC", "caixa", "Saldo de caixa no fim do ano", "end", "brl", 1),
        ("sec", "BALANÇO (fim do ano)"),
        ("BP", "reb", "Rebanho a valor de mercado", "end", "brl", 0), ("BP", "imob", "Imobilizado líquido", "end", "brl", 0),
        ("BP", "ativo", "Ativo total", "end", "brl", 1), ("BP", "divida", "Crédito rural", "end", "brl", 0),
        ("sec", "INDICADORES FÍSICOS"),
        ("Reb", "cab_total", "Rebanho no fim do ano (cab)", "end", "num", 0), ("Reb", "matr", "Matrizes no fim do ano (cab)", "end", "num", 0),
        ("Reb", "nasc", "Nascimentos (cab)", "sum", "num", 0), ("Reb", "cab_vend", "Cabeças vendidas", "sum", "num", 0),
        ("O", "arr_tot", "Arrobas de boi gordo vendidas", "sum", "num", 0), ("Reb", "lotacao", "Lotação média (UA/ha)", "avg", "num2", 0),
        ("N", "f_def", "Déficit de forragem (t MS)", "sum", "num", 0), ("N", "d_mil", "Milho consumido (t)", "sum", "num", 0),
        ("Lv", "prod_mi", "Milho produzido (t)", "sum", "num", 0), ("Lv", "mi_compra", "Milho comprado (t)", "sum", "num", 0),
        ("Pr", "pa", "Preço médio da arroba (R$/@)", "avg", "num2", 0),
    ]
    r = 5
    for it in S:
        if it[0] == "sec":
            r += 1
            sec(ws, r, it[1], 14)
            r += 1
            continue
        code, key, lab, how, fmt, bold = it
        ROWS[("A", f"{code}_{key}")] = r
        ws.cell(r, 1, lab).font = font(bold=bool(bold))
        for y in range(1, 11):
            col = L(3 + y)
            if how == "sum":
                f = f"=SUMIFS({ALL(code,key)},{YR(code)},{col}$4)"
            elif how == "avg":
                f = f"=AVERAGEIFS({ALL(code,key)},{YR(code)},{col}$4)"
            else:
                f = f"=INDEX({ALL(code,key)},1,{col}$4*12)"
            x = ws.cell(r, 3 + y, f)
            x.number_format = FMT[fmt]
            x.font = font(GREEN, bool(bold))
        tf = {"sum": f"=SUM(D{r}:M{r})", "avg": f"=AVERAGE(D{r}:M{r})", "end": f"=M{r}"}[how]
        x = ws.cell(r, 14, tf)
        x.number_format = FMT[fmt]
        x.font = font(bold=True)
        x.fill = F_TOT
        r += 1
    ws.column_dimensions["A"].width = 50
    ws.column_dimensions["B"].width = 2
    ws.column_dimensions["C"].width = 2
    for c in range(4, 15):
        ws.column_dimensions[L(c)].width = 14
    ws.freeze_panes = "D5"
    return ws


SC_OUT = [("k_vpl", "VPL (R$)", "brl"), ("k_inc", "VPL incremental vs. arrendar tudo (R$)", "brl"), ("k_tir", "TIR real a.a.", "pct"), ("k_expo", "Exposição máx. de caixa (R$)", "brl"),
          ("k_apad", "Aporte adicional exigido (R$)", "brl"), ("k_pb", "Payback (meses)", "int"), ("k_ebitda", "EBITDA médio anual (R$)", "brl"),
          ("k_ll", "Lucro líquido 10 anos (R$)", "brl"), ("k_cab", "Rebanho final (cab)", "num"),
          ("k_lot", "Lotação média (UA/ha)", "num2")]


def finish_cenarios(wb):
    ws = wb["Cenarios"]
    h = SCEN_ROW0 + len(LEVERS) + 3
    sec(ws, h - 2, "COMPARAÇÃO DOS 9 CENÁRIOS (Tabela de Dados — recalcula sozinha; não edite as células cinza)", 13)
    ws.cell(h - 1, 1, "Cenário").font = font(bold=True)
    ws.cell(h - 1, 2, "#").font = font(bold=True)
    ws.cell(h, 1, "Cenário ativo (linha de fórmulas que a tabela replica)").font = font(bold=True)
    for j, (k, lab, fmt) in enumerate(SC_OUT):
        x = ws.cell(h - 1, 3 + j, lab)
        x.font = font(bold=True, size=9)
        x.alignment = Alignment(wrap_text=True, horizontal="center", vertical="center")
        y = ws.cell(h, 3 + j, f"={paddr(k)}")
        y.number_format = FMT[fmt]
        y.font = font(GREEN, True)
        y.fill = F_OUT
        y.alignment = Alignment(horizontal="right")
    ws.row_dimensions[h - 1].height = 32
    for i in range(9):
        r = h + 1 + i
        ws.cell(r, 1, f"=INDEX($D$8:$L$8,1,B{r})").font = font()
        b = ws.cell(r, 2, i + 1)
        b.font = font(bold=True)
        b.alignment = Alignment(horizontal="center")
        for j, (k, lab, fmt) in enumerate(SC_OUT):
            x = ws.cell(r, 3 + j, 0)
            x.number_format = FMT[fmt]
            x.fill = F_TOT
            x.alignment = Alignment(horizontal="right")
    data_table(ws, h + 1, 3, h + 9, 2 + len(SC_OUT), col_input="C4")
    ws.cell(h + 11, 1, "Como ler: o VPL já inclui a renda do pasto arrendado a terceiros. O VPL incremental desconta o que a terra renderia "
                        "100% arrendada: é ele que diz se vale a pena operar. Aporte adicional > 0 = capital insuficiente para o cenário.").font = font(GRAY, italic=True, size=9)
    ws.conditional_formatting.add(f"C{h+1}:C{h+9}", CellIsRule(operator="lessThan", formula=["0"], font=Font(name=FONT, size=10, color="C00000")))
    return h


def finish_sens(wb):
    ws = wb["Sensibilidade"]
    n = len(SHOCKS)
    h = SH_ROW0 + n + 3   # cabecalho do tornado
    sec(ws, h - 2, "TORNADO — efeito de cada variável isolada sobre o cenário ativo (Tabela de Dados)", 11)
    for c, t in ((1, "Caso"), (2, "#"), (3, "VPL (R$)"), (4, "TIR real a.a."), (5, "Exposição máx. (R$)")):
        ws.cell(h - 1, c, t).font = font(bold=True)
    for c, k, fmt in ((3, "k_vpl", "brl"), (4, "k_tir", "pct"), (5, "k_expo", "brl")):
        x = ws.cell(h, c, f"={paddr(k)}")
        x.number_format = FMT[fmt]
        x.font = font(GREEN, True)
        x.fill = F_OUT
    ws.cell(h, 1, "Cenário ativo (linha de fórmulas)").font = font(bold=True)
    for k in range(2 * n + 1):
        r = h + 1 + k
        if k == 0:
            lab = "Base (sem choque de teste)"
        else:
            i = (k - 1) // 2
            lab = f'={"A"}{SH_ROW0+i}&" — teste {"A" if k % 2 else "B"} ("&TEXT({"C" if k % 2 else "D"}{SH_ROW0+i},"+0%;-0%")&")"'
        ws.cell(r, 1, lab).font = font()
        ws.cell(r, 2, k).font = font(bold=True)
        for c, fmt in ((3, "brl"), (4, "pct"), (5, "brl")):
            x = ws.cell(r, c, 0)
            x.number_format = FMT[fmt]
            x.fill = F_TOT
    data_table(ws, h + 1, 3, h + 1 + 2 * n, 5, col_input="C4")
    t0 = h + 2 * n + 4
    sec(ws, t0 - 1, "TORNADO — resumo (variação do VPL em relação à base)", 11)
    for c, t in enumerate(["Variável", "VPL teste A", "VPL teste B", "Δ VPL teste A", "Δ VPL teste B", "Amplitude"], 1):
        ws.cell(t0, c, t).font = font(bold=True)
    for i in range(n):
        r = t0 + 1 + i
        ws.cell(r, 1, f"=A{SH_ROW0+i}").font = font()
        put(ws, f"B{r}", f"=INDEX($C${h+1}:$C${h+1+2*n},{2*i+2})")
        put(ws, f"C{r}", f"=INDEX($C${h+1}:$C${h+1+2*n},{2*i+3})")
        put(ws, f"D{r}", f"=B{r}-$C${h+1}")
        put(ws, f"E{r}", f"=C{r}-$C${h+1}")
        put(ws, f"F{r}", f"=ABS(D{r})+ABS(E{r})", bold=True)
    PREM["torn"] = ("Sensibilidade", t0 + 1, 1)
    # tabelas cruzadas
    axis = [-0.2, -0.1, 0, 0.1, 0.2]
    tabs = [("VPL (R$): preço da arroba (colunas) × preço de reposição (linhas)", SH_ROW0 + 0, SH_ROW0 + 1, "Reposição ↓ / Arroba →"),
            ("VPL (R$): preço da arroba (colunas) × preço de grãos e ração (linhas)", SH_ROW0 + 0, SH_ROW0 + 2, "Ração ↓ / Arroba →"),
            ("VPL (R$): ganho médio diário (colunas) × taxa de natalidade (linhas)", SH_ROW0 + 3, SH_ROW0 + 4, "Natalidade ↓ / GMD →")]
    r = t0 + n + 4
    for ttl, rin, cin, corner in tabs:
        sec(ws, r, ttl + " — Tabela de Dados sobre os choques manuais", 11)
        ws.cell(r + 1, 1, corner).font = font(GRAY, italic=True)
        x = ws.cell(r + 1, 2, f"={paddr('k_vpl')}")
        x.number_format = ';;;'
        x.font = font(GREEN)
        for j, a in enumerate(axis):
            y = ws.cell(r + 1, 3 + j, a)
            y.number_format = '+0%;-0%;0%'
            y.font = font(BLUE, True)
            y.fill = F_IN
            z = ws.cell(r + 2 + j, 2, a)
            z.number_format = '+0%;-0%;0%'
            z.font = font(BLUE, True)
            z.fill = F_IN
            for jj in range(5):
                w = ws.cell(r + 2 + j, 3 + jj, 0)
                w.number_format = FMT["brl"]
                w.fill = F_TOT
        data_table(ws, r + 2, 3, r + 6, 7, row_input=f"B{rin}", col_input=f"B{cin}")
        ws.conditional_formatting.add(f"C{r+2}:G{r+6}", CellIsRule(operator="lessThan", formula=["0"], font=Font(name=FONT, size=10, color="C00000")))
        r += 9
    ch = BarChart()
    ch.type = "bar"
    ch.title = "Tornado: variação do VPL por variável"
    ch.height, ch.width = 9, 22
    ch.add_data(Reference(ws, min_col=4, max_col=5, min_row=t0, max_row=t0 + n), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=t0 + 1, max_row=t0 + n))
    ch.overlap = 100
    ws.add_chart(ch, f"H{t0-1}")
    return h, t0


CHECKS = []


def build_checks(wb):
    ws = wb.create_sheet("Checks")
    SHEETS["Ck"] = "Checks"
    title(ws, "CHECKS — testes de integridade e alertas do cenário ativo", "ERRO = o modelo está inconsistente (não use os números). ALERTA = premissa a revisar; o modelo continua válido.", 5)
    for c, t in enumerate(["Teste", "Valor", "Limite", "Status", "O que significa"], 1):
        ws.cell(4, c, t).font = font(bold=True)
        ws.cell(4, c).fill = F_SEC
    mx = lambda code, key: f"MAX(MAX({ALL(code,key)}),-MIN({ALL(code,key)}))"
    T = [
        ("E", "Balanço fecha (ativo − passivo − PL)", f"={mx('BP','dif')}", 1, "<=", "Maior diferença mensal em R$. Deve ser zero."),
        ("E", "Soma das unidades = EBITDA consolidado", f"={mx('U','dif')}", 1, "<=", "Preços de transferência e rateios se anulam no consolidado."),
        ("E", "Reconciliação de cabeças", f"={mx('Reb','rc_dif')}", 0.01, "<=", "Entradas − mortes − vendas = estoque, em todos os meses."),
        ("E", "Nenhum estoque de animais negativo", f"=-MIN(0,MIN({ALL('Reb','matr')}),MIN({ALL('Reb','nov')}),MIN({ALL('Reb','bez_pe')}),MIN({ALL('Reb','rec_est')}),MIN({ALL('Reb','ep_est')}),MIN({ALL('Reb','es_est')}),MIN({ALL('Reb','ec_est')}))", 0.001, "<=", ""),
        ("E", "Mix de terminação soma 100%", f"=ABS({paddr('mix_pasto')}+{paddr('mix_semi')}+{paddr('mix_conf')}-1)", 0.0001, "<=", "Ajuste as três linhas de mix em Cenarios."),
        ("E", "Distribuição de partos soma 100%", f"=ABS(SUM(Premissas!$D${PREM['dist_partos'][1]}:$O${PREM['dist_partos'][1]})-1)", 0.0001, "<=", ""),
        ("E", "Perfil de compra de bezerros soma 100%", f"=ABS(SUM(Premissas!$D${PREM['perfil_bez'][1]}:$O${PREM['perfil_bez'][1]})-1)", 0.0001, "<=", ""),
        ("E", "Área de pasto não negativa", f"=-MIN(0,{paddr('area_pasto')})", 0, "<=", "Lavoura maior que a área útil."),
        ("E", "GMD sem valores negativos", f"=-MIN(0,MIN(Premissas!$D${PREM['gmd_rec'][1]}:$O${PREM['gmd_c'][1]}))", 0, "<=", "O motor de lotes exige ganho acumulado não decrescente."),
        ("E", "Cenário selecionado entre 1 e 9", f"=IF(AND({paddr('scen_sel')}>=1,{paddr('scen_sel')}<=9,{paddr('scen_sel')}=INT({paddr('scen_sel')})),0,1)", 0, "<=", ""),
        ("E", "Caso do tornado zerado", f"=ABS({paddr('caso')})", 0, "<=", "Sensibilidade!C4 deve ficar em 0 fora da Tabela de Dados."),
        ("A", "Aporte adicional exigido (R$)", f"={paddr('k_apad')}", 0, "<=", "Capital informado não cobre a exposição de caixa: reduza escala, use crédito ou aporte mais."),
        ("A", "Lotação máxima (UA/ha)", f"={paddr('k_lotmax')}", f"={paddr('lot_max')}", "<=", "Acima da referência: o pasto não suporta; aparece custo de volumoso emergencial."),
        ("A", "Déficit de forragem acumulado (t MS)", f"={paddr('k_def')}", 5, "<=", "Volumoso comprado para cobrir falta de pasto."),
        ("A", "Pico no confinamento ≤ capacidade estática (cab acima)", f"=MAX(0,{paddr('k_conf')}-{paddr('cap_conf')})", 0.5, "<=", "Aumente a capacidade no cenário ou escalone os lotes."),
        ("A", "Choques manuais de sensibilidade zerados", f"=SUMPRODUCT(ABS(Sensibilidade!$B${SH_ROW0}:$B${SH_ROW0+len(SHOCKS)-1}))", 0, "<=", "Há choque manual ativo: os números não são o caso-base."),
        ("A", "VPL do cenário ativo ≥ 0", f"=-MIN(0,{paddr('k_vpl')})", 0, "<=", "VPL negativo: o cenário não remunera o capital à taxa de desconto."),
        ("A", "VPL incremental ≥ 0 (operar rende mais que arrendar tudo)", f"=-MIN(0,{paddr('k_inc')})", 0, "<=", "Negativo: arrendar toda a área a terceiros gera mais valor que este cenário."),
    ]
    r = 5
    for kind, lab, f, lim, op, note in T:
        ws.cell(r, 1, lab).font = font()
        x = ws.cell(r, 2, f)
        x.number_format = '#,##0.00'
        x.font = font(GREEN)
        y = ws.cell(r, 3, lim)
        y.number_format = '#,##0.00'
        y.font = font(GREEN if isinstance(lim, str) else BLUE)
        bad = "ERRO" if kind == "E" else "ALERTA"
        s = ws.cell(r, 4, f'=IF(B{r}<=C{r}+0.000001,"OK","{bad}")')
        s.font = font(bold=True)
        s.alignment = Alignment(horizontal="center")
        ws.cell(r, 5, note).font = font(GRAY, italic=True, size=9)
        r += 1
    last = r - 1
    ws.conditional_formatting.add(f"D5:D{last}", CellIsRule(operator="equal", formula=['"OK"'], fill=PatternFill("solid", bgColor="C6EFCE", fgColor="C6EFCE")))
    ws.conditional_formatting.add(f"D5:D{last}", CellIsRule(operator="equal", formula=['"ERRO"'], fill=PatternFill("solid", bgColor="FFC7CE", fgColor="FFC7CE")))
    ws.conditional_formatting.add(f"D5:D{last}", CellIsRule(operator="equal", formula=['"ALERTA"'], fill=PatternFill("solid", bgColor="FFEB9C", fgColor="FFEB9C")))
    r += 1
    ws.cell(r, 1, "Erros de integridade").font = font(bold=True)
    put(ws, f"B{r}", f'=COUNTIF(D5:D{last},"ERRO")', "int", True)
    PREM["n_erros"] = ("Checks", r, 2)
    ws.cell(r + 1, 1, "Alertas").font = font(bold=True)
    put(ws, f"B{r+1}", f'=COUNTIF(D5:D{last},"ALERTA")', "int", True)
    PREM["n_alertas"] = ("Checks", r + 1, 2)
    ws.cell(r + 2, 1, "Status geral do modelo").font = font(bold=True)
    put(ws, f"B{r+2}", f'=IF(B{r}>0,"ERRO — revisar",IF(B{r+1}>0,"OK com alertas","OK"))', "gen", True)
    PREM["status"] = ("Checks", r + 2, 2)
    ws.column_dimensions["A"].width = 56
    ws.column_dimensions["B"].width = 16
    ws.column_dimensions["C"].width = 12
    ws.column_dimensions["D"].width = 12
    ws.column_dimensions["E"].width = 95
    return ws


def build_painel(wb, sc_h, torn_t0):
    ws = wb.create_sheet("Painel")
    SHEETS["Pn"] = "Painel"
    title(ws, "PAINEL — visão executiva do cenário ativo", "Troque o cenário em Cenarios!C4. Tudo aqui é fórmula; nada deve ser digitado.", 20)
    ws["A4"] = "Cenário ativo"
    ws["A4"].font = font(bold=True)
    put(ws, "B4", f"={paddr('scen_nome')}", "gen", True)
    ws["A5"] = "Status do modelo"
    ws["A5"].font = font(bold=True)
    put(ws, "B5", f"={paddr('status')}", "gen", True)
    cards = [("VPL (R$)", "k_vpl", "brl"), ("VPL incremental vs. arrendar tudo (R$)", "k_inc", "brl"), ("TIR real a.a.", "k_tir", "pct"), ("Exposição máxima de caixa (R$)", "k_expo", "brl"),
             ("Aporte adicional exigido (R$)", "k_apad", "brl"), ("Payback (meses)", "k_pb", "int"), ("EBITDA médio anual (R$)", "k_ebitda", "brl"),
             ("Lucro líquido em 10 anos (R$)", "k_ll", "brl"), ("Múltiplo do capital", "k_moic", "mult"), ("Rebanho no mês 120 (cab)", "k_cab", "num"),
             ("Lotação média (UA/ha)", "k_lot", "num2"), ("Margem 10 anos — cria (R$)", "k_cr", "brl"), ("Margem 10 anos — recria (R$)", "k_re", "brl"),
             ("Margem 10 anos — engorda (R$)", "k_en", "brl"), ("Margem 10 anos — lavoura (R$)", "k_la", "brl"), ("Resultado 10 anos — estrutura (R$)", "k_es", "brl")]
    sec(ws, 7, "INDICADORES-CHAVE", 20)
    for i, (lab, k, fmt) in enumerate(cards):
        r = 6 + 2 + i
        ws.cell(r, 1, lab).font = font()
        x = put(ws, f"B{r}", f"={paddr(k)}", fmt, True, fill=F_OUT)
        x.alignment = Alignment(horizontal="right")
    ws.column_dimensions["A"].width = 38
    ws.column_dimensions["B"].width = 26
    ws.column_dimensions["C"].width = 3
    A = wb["Resumo_Anual"]
    ar = lambda k: ROWS[("A", k)]
    # 1 caixa mensal
    fc = wb["Fluxo_Caixa"]
    c1 = LineChart()
    c1.title = "Saldo de caixa e fluxo livre acumulado (R$, mensal)"
    c1.height, c1.width = 8.5, 17
    for key in ("caixa", "cum"):
        rr = ROWS[("FC", key)]
        s = Series(Reference(fc, min_col=C0, max_col=CL, min_row=rr), title=fc.cell(rr, 1).value.split(" (")[0].capitalize())
        s.smooth = False
        c1.series.append(s)
    c1.set_categories(Reference(fc, min_col=C0, max_col=CL, min_row=3))
    c1.x_axis.title = "Mês do modelo"
    c1.x_axis.tickLblSkip = 12
    ws.add_chart(c1, "D4")
    # 2 EBITDA por unidade
    c2 = BarChart()
    c2.type = "col"
    c2.grouping = "stacked"
    c2.overlap = 100
    c2.title = "Resultado por unidade de negócio (R$/ano)"
    c2.height, c2.width = 8.5, 17
    for k in ("U_cr", "U_re", "U_en", "U_la", "U_es"):
        c2.series.append(Series(Reference(A, min_col=4, max_col=13, min_row=ar(k)), title=A.cell(ar(k), 1).value))
    c2.set_categories(Reference(A, min_col=4, max_col=13, min_row=4))
    ws.add_chart(c2, "N4")
    # 3 rebanho
    rb = wb["Rebanho"]
    c3 = LineChart()
    c3.title = "Rebanho (cabeças) e UA em pasto"
    c3.height, c3.width = 8.5, 17
    for key, t in (("cab_total", "Cabeças"), ("ua_pasto", "UA em pasto")):
        rr = ROWS[("Reb", key)]
        c3.series.append(Series(Reference(rb, min_col=C0, max_col=CL, min_row=rr), title=t))
    c3.set_categories(Reference(rb, min_col=C0, max_col=CL, min_row=3))
    c3.x_axis.tickLblSkip = 12
    ws.add_chart(c3, "D22")
    # 4 FCL anual
    c4 = BarChart()
    c4.type = "col"
    c4.title = "Fluxo de caixa livre e lucro líquido (R$/ano)"
    c4.height, c4.width = 8.5, 17
    for k in ("FC_fcl", "D_ll"):
        c4.series.append(Series(Reference(A, min_col=4, max_col=13, min_row=ar(k)), title=A.cell(ar(k), 1).value))
    c4.set_categories(Reference(A, min_col=4, max_col=13, min_row=4))
    ws.add_chart(c4, "N22")
    # 5 cenarios
    cs = wb["Cenarios"]
    c5 = BarChart()
    c5.type = "bar"
    c5.title = "VPL por cenário (R$)"
    c5.height, c5.width = 9.5, 17
    c5.series.append(Series(Reference(cs, min_col=3, min_row=sc_h + 1, max_row=sc_h + 9), title="VPL"))
    c5.set_categories(Reference(cs, min_col=1, min_row=sc_h + 1, max_row=sc_h + 9))
    c5.legend = None
    ws.add_chart(c5, "D40")
    # 6 tornado
    ss = wb["Sensibilidade"]
    n = len(SHOCKS)
    c6 = BarChart()
    c6.type = "bar"
    c6.title = "Tornado: variação do VPL (R$)"
    c6.height, c6.width = 9.5, 17
    c6.add_data(Reference(ss, min_col=4, max_col=5, min_row=torn_t0, max_row=torn_t0 + n), titles_from_data=True)
    c6.set_categories(Reference(ss, min_col=1, min_row=torn_t0 + 1, max_row=torn_t0 + n))
    c6.overlap = 100
    ws.add_chart(c6, "N40")
    return ws
