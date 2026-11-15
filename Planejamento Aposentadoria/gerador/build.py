# -*- coding: utf-8 -*-
"""Gera 'Simulador_Aposentadoria.xlsx'.

Uso:  python3 build.py [saida.xlsx]
Requer openpyxl. Sem macros: só fórmulas e Tabelas de Dados nativas do Excel.
LO_VERIFY=1 grava uma cópia de verificação sem as Tabelas de Dados; LO_VERIFY=2 grava as tabelas com a
função TABLE() (equivalente no LibreOffice). O arquivo entregue usa sempre as Tabelas de Dados do Excel.
"""
import os
import sys
from openpyxl import Workbook
from openpyxl.workbook.properties import CalcProperties
import fw
from fw import *
import premissas as PR
import cenarios as CN
import motores as MO
import saidas as SA

HERE = os.path.dirname(os.path.abspath(__file__))
OUTFILE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "Simulador_Aposentadoria.xlsx")
LOV = os.environ.get("LO_VERIFY", "")
LO = {"": False, "1": "skip", "2": True}[LOV]

ORDER = ["Premissas", "Painel", "Fluxo_Mensal", "Resumo_Anual", "Aposentadoria", "Cenarios",
         "Renda", "Moradia", "Familia", "Macro", "Checks", "Instrucoes"]
TABC = {"Premissas": "FFC000", "Cenarios": "FFC000", "Painel": "00B050", "Fluxo_Mensal": "00B050", "Resumo_Anual": "00B050",
        "Aposentadoria": "00B050", "Renda": "7F7F7F", "Moradia": "7F7F7F", "Familia": "7F7F7F", "Macro": "7F7F7F",
        "Checks": "C00000", "Instrucoes": "1F3864"}

_dt = fw.data_table


def data_table(ws, r1, c1, r2, c2, row_input=None, col_input=None, lo=False):
    if lo == "skip":
        return
    _dt(ws, r1, c1, r2, c2, row_input=row_input, col_input=col_input, lo=lo)


CN.data_table = data_table


def top_box(ws):
    """Resultado resumido no topo da aba Premissas."""
    A = SA.A
    r = PR.TOP0
    sec(ws, r, "RESULTADO DO CENÁRIO ATIVO (atualiza ao editar as premissas)", 9)
    rows = [
        ("Veredito", f"={A('veredito')}", "gen", f"={A('pct_meta')}", "pct", "da meta (renda sustentável ÷ meta)"),
        ("Renda mensal sustentável aos 65 (patrimônio + INSS)", f"={A('renda_total')}", "rs", f"={P('meta')}", "rs", "← meta"),
        ("Patrimônio financeiro aos 65 (R$ de hoje)", f"={A('p65_real')}", "rs", f"={A('k_star')}", "rs", "← capital necessário"),
        ("Aporte extra (+) ou folga (−) por mês, de hoje até os 65", f"={A('aporte')}", "rs", None, None,
         "R$ de hoje por mês. Positivo = precisa poupar isso a mais."),
        ("Gasto pessoal máximo compatível com a meta", f"={A('gasto_max')}", "rs", f"={P('gasto_pes_ativo')}", "rs", "← gasto pessoal atual"),
        ("Atinge o capital necessário aos", f"={A('idade_if')}", "anos", None, None, "independência financeira"),
        ("Menor saldo financeiro na fase ativa (R$ de hoje)", f"={A('min_saldo')}", "rs", f"={A('data_min')}", "date", "← quando"),
        ("Checks", f'={OUT["n_erros"]}&" erro(s) / "&{OUT["n_alertas"]}&" alerta(s)"', "gen", None, None, "detalhes na aba Checks"),
        ("Estado", f"={OUT['estado']}", "gen", None, None, ""),
    ]
    for i, (lab, f1, fm1, f2, fm2, nt) in enumerate(rows):
        rr = r + 1 + i
        ws.cell(rr, 1, lab).font = font(bold=True)
        ws.cell(rr, 1).alignment = Alignment(indent=1)
        x = put(ws, f"C{rr}", f1, fm1, bold=True, fill=F_OUT, size=11 if i == 0 else 10)
        if i in (0, 7, 8):
            ws.merge_cells(start_row=rr, start_column=3, end_row=rr, end_column=4 if i == 0 else 8)
        if f2:
            put(ws, f"{'E' if i == 0 else 'D'}{rr}", f2, fm2, bold=True)
        if nt:
            ws.cell(rr, 6 if i == 0 else (9 if i in (7, 8) else 5), nt).font = font(GRAY, italic=True, size=9)
    v = f"C{r + 1}"
    pct = A("pct_meta")
    ws.conditional_formatting.add(f"C{r + 1}:D{r + 1}", fw.FormulaRule(formula=[f"{pct}>=1"], fill=F_OUT, font=font(GREEN, True, size=11)))
    ws.conditional_formatting.add(f"C{r + 1}:D{r + 1}", fw.FormulaRule(formula=[f"{pct}<1"], fill=F_BAD, font=font(RED, True, size=11)))


def main():
    wb = Workbook()
    wb.remove(wb.active)
    sheets = {n: wb.create_sheet(n) for n in ORDER}
    for n, c in TABC.items():
        sheets[n].sheet_properties.tabColor = c
    # 1) layout (endereços) antes de qualquer fórmula
    PR.layout()
    CN.layout()
    SA.layout_apos()
    msheets = MO.build(sheets)
    # 2) motores
    for m in msheets:
        m.render()
    # 3) saídas, cenários, checks, premissas, painel
    SA.render_apos(sheets["Aposentadoria"])
    SA.render_resumo(sheets["Resumo_Anual"])
    CN.render(sheets["Cenarios"], lo=LO)
    SA.define_checks()
    SA.render_checks(sheets["Checks"])
    lever_of, lev_cells = CN.maps()
    PR.render(sheets["Premissas"], lever_of, lev_cells)
    top_box(sheets["Premissas"])
    SA.render_painel(sheets["Painel"], sheets["Resumo_Anual"])
    SA.render_instr(sheets["Instrucoes"])
    # impressão: abas de leitura em 1 página de largura
    for n, orient in (("Premissas", "portrait"), ("Painel", "landscape"), ("Aposentadoria", "portrait"), ("Cenarios", "landscape"),
                      ("Checks", "landscape"), ("Instrucoes", "portrait"), ("Resumo_Anual", "landscape")):
        ws = sheets[n]
        ws.page_setup.orientation = orient
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.sheet_properties.pageSetUpPr.fitToPage = True
    sheets["Painel"].print_area = "A1:P62"
    if os.environ.get("VIS"):
        order = ["Premissas", "Painel", "Aposentadoria", "Cenarios", "Checks", "Resumo_Anual", "Instrucoes"]
        wb._sheets = [sheets[n] for n in order] + [s_ for s_ in wb._sheets if s_.title not in order]
    wb.calculation = CalcProperties(fullCalcOnLoad=True, calcMode="auto" if LO else "autoNoTable")
    wb.active = 0
    wb.save(OUTFILE)
    print("gravado:", os.path.abspath(OUTFILE))


if __name__ == "__main__":
    main()
