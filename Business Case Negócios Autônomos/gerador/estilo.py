# -*- coding: utf-8 -*-
"""Estilo visual do modelo (mesmo código de cores do Business Case Pecuária)."""
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L

FONT = "Arial"
BLUE, BLACK, GREEN, WHITE, GRAY, RED = "0000FF", "000000", "007A33", "FFFFFF", "595959", "C00000"
F_IN = PatternFill("solid", fgColor="FFF2CC")      # entrada editável
F_KEY = PatternFill("solid", fgColor="FFFF00")     # premissa-chave
F_HEAD = PatternFill("solid", fgColor="1F3864")    # faixa de título
F_SEC = PatternFill("solid", fgColor="D9E1F2")     # cabeçalho de seção
F_TIME = PatternFill("solid", fgColor="F2F2F2")    # cabeçalho de colunas
F_TOT = PatternFill("solid", fgColor="EDEDED")     # totais / auxiliares
F_OUT = PatternFill("solid", fgColor="E2EFDA")     # resultado em destaque
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

FMT = {
    "brl": '#,##0;(#,##0);"-"', "brl2": '#,##0.00;(#,##0.00);"-"', "num": '#,##0.0;(#,##0.0);"-"',
    "num2": '#,##0.00;(#,##0.00);"-"', "num3": '0.000', "int": '#,##0;(#,##0);"-"', "pct": '0.0%;(0.0%);"-"',
    "pct2": '0.00%;(0.00%);"-"', "mult": '0.00"x"', "anos": '0.0', "gen": "General", "idx": "0",
}

# colunas do layout das abas de caso
CA, CB, C0 = 1, 2, 3          # A rótulo, B unidade, C = ano 0 / valor
CY = [4, 5, 6, 7, 8]          # D..H = anos 1..5
CT, CN = 9, 11                # I total, K nota
NCOL = 11


def font(color=BLACK, bold=False, italic=False, size=10, underline=None):
    return Font(name=FONT, size=size, bold=bold, italic=italic, color=color, underline=underline)


def faixa_titulo(ws, titulo, sub, ncol=NCOL):
    ws.sheet_view.showGridLines = False
    ws["A1"] = titulo
    ws["A1"].font = font(WHITE, True, size=13)
    ws["A2"] = sub
    ws["A2"].font = font(WHITE, italic=True)
    for r in (1, 2):
        for c in range(1, ncol + 1):
            ws.cell(r, c).fill = F_HEAD


def secao(ws, r, titulo, ncol=NCOL):
    for c in range(1, ncol + 1):
        ws.cell(r, c).fill = F_SEC
    ws.cell(r, 1, titulo).font = font(bold=True, size=11)


def entrada(cell, v, fmt="num", chave=False):
    cell.value = v
    cell.number_format = FMT[fmt]
    cell.font = font(BLUE, chave)
    cell.fill = F_KEY if chave else F_IN
    cell.border = BOX


def formula(cell, f, fmt="brl", bold=False, fill=None):
    cell.value = f
    cell.number_format = FMT[fmt]
    externo = isinstance(f, str) and "!" in f
    cell.font = font(GREEN if externo else BLACK, bold)
    if fill is not None:
        cell.fill = fill


def nota(ws, r, texto, col=CN):
    x = ws.cell(r, col, texto)
    x.font = font(GRAY, italic=True, size=9)
    return x
