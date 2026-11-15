# -*- coding: utf-8 -*-
"""Mini-framework para gerar o simulador em Excel com fórmulas vivas (openpyxl).

Abas mensais: cada LINHA é um mês (linha 8 = mês 1 = dez/2026). Cada coluna de cálculo
recebe uma CHAVE; as fórmulas são escritas como templates que citam chaves, e o
framework resolve os endereços na hora de gravar.

Tokens dos templates das abas mensais
  {chave}          mesma aba, mesma linha (mês t)                 -> K8
  {Aba!chave}      outra aba mensal, mesma linha                  -> Renda!K8
  {chave|p}        linha anterior (mês t-1); no mês 1 usa o valor inicial da coluna
  {chave|c}        coluna inteira (todos os meses)                -> $K$8:$K$823
  {Aba!chave|c}    coluna inteira de outra aba
Premissas entram como endereços absolutos, via P('chave') (usado), PC('chave') (usado Campinas),
PI('chave') (entrada digitada) e TB('tabela') (intervalos de tabelas).
"""
import re
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule

NM = 816            # meses simulados: dez/2026 a nov/2094 (até os 100 anos)
R0 = 8              # primeira linha de dados nas abas mensais
RL = R0 + NM - 1    # última linha de dados
FONT = "Arial"

BLUE, BLACK, GREEN, WHITE, GRAY, RED = "0000FF", "000000", "007A33", "FFFFFF", "595959", "C00000"
F_IN = PatternFill("solid", fgColor="FFF2CC")
F_KEY = PatternFill("solid", fgColor="FFE699")
F_HEAD = PatternFill("solid", fgColor="1F3864")
F_SEC = PatternFill("solid", fgColor="D9E1F2")
F_GRP = PatternFill("solid", fgColor="BDD7EE")
F_TIME = PatternFill("solid", fgColor="F2F2F2")
F_TOT = PatternFill("solid", fgColor="EDEDED")
F_OUT = PatternFill("solid", fgColor="E2EFDA")
F_BAD = PatternFill("solid", fgColor="F8CBAD")
F_WARN = PatternFill("solid", fgColor="FFEB9C")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

FMT = {
    "brl": '#,##0;-#,##0;"-"', "brl2": '#,##0.00;-#,##0.00;"-"', "rs": '"R$ "#,##0;-"R$ "#,##0;"-"',
    "rsk": '"R$ "#,##0,"mil";-"R$ "#,##0,"mil";"-"', "rsm": '"R$ "#,##0.00,,"mi";-"R$ "#,##0.00,,"mi";"-"',
    "int": '0', "num": '#,##0.0', "num2": '#,##0.00', "pct": '0.0%', "pct2": '0.00%', "pct3": '0.000%',
    "fac": '0.0000', "date": 'mmm/yyyy', "gen": 'General', "anos": '0" anos"', "meses": '0" meses"',
    "x": '0.00"x"', "flag": '0;-0;"-"',
}

SHEETS = {}     # código -> nome da aba
COLS = {}       # (código, chave) -> coluna
INIT = {}       # (código, chave) -> template do valor inicial (mês 1) para {chave|p}
PREM = {}       # chave -> linha na aba Premissas
TBL = {}        # nome -> intervalo absoluto (com aba)
OUT = {}        # chave -> endereço absoluto de uma saída (com aba)

TOK = re.compile(r'\{(?:([A-Za-z_]+)!)?([A-Za-z0-9_]+)(?:\|([a-z]+))?\}')


def font(color=BLACK, bold=False, italic=False, size=10):
    return Font(name=FONT, size=size, bold=bold, italic=italic, color=color)


# ---------------------------------------------------------------- endereços de premissas
PS = "Premissas"


def P(k):
    """Valor USADO no modelo (Porto Velho / geral)."""
    return f"{PS}!$E${PREM[k]}"


def PC(k):
    """Valor USADO para Campinas."""
    return f"{PS}!$F${PREM[k]}"


def PI(k):
    """Entrada digitada (Porto Velho / geral)."""
    return f"{PS}!$C${PREM[k]}"


def PIC(k):
    return f"{PS}!$D${PREM[k]}"


def TB(name):
    return TBL[name]


def colrange(code, key):
    c = COLS[(code, key)]
    return f"{SHEETS[code]}!${L(c)}${R0}:${L(c)}${RL}"


def resolve(tpl, code, r):
    def rep(m):
        sh, key, mod = m.groups()
        scode = sh or code
        c = COLS[(scode, key)]
        pre = "" if scode == code else f"{SHEETS[scode]}!"
        if mod is None:
            return f"{pre}{L(c)}{r}"
        if mod == "p":
            if r == R0:
                if scode == code:
                    return "(" + resolve(INIT[(scode, key)], code, r) + ")"
                return "0"
            return f"{pre}{L(c)}{r-1}"
        if mod == "c":
            return f"{pre}${L(c)}${R0}:${L(c)}${RL}"
        raise ValueError(mod)
    return TOK.sub(rep, tpl)


def style_formula(cell, f, bold=False):
    cell.font = font(GREEN if isinstance(f, str) and "!" in f else BLACK, bold)


def title(ws, t, sub, ncol=12):
    ws.sheet_view.showGridLines = False
    ws["A1"] = t
    ws["A1"].font = font(WHITE, True, size=13)
    ws["A2"] = sub
    ws["A2"].font = font(WHITE, italic=True)
    for rr in (1, 2):
        for c in range(1, ncol + 1):
            ws.cell(rr, c).fill = F_HEAD


def sec(ws, r, t, ncol=12, c0=1):
    for c in range(c0, ncol + 1):
        ws.cell(r, c).fill = F_SEC
    ws.cell(r, c0, t).font = font(bold=True, size=11)


def put(ws, addr, v, fmt="brl", bold=False, color=None, fill=None, size=10, align=None, wrap=False, border=False):
    x = ws[addr]
    x.value = v
    x.number_format = FMT.get(fmt, fmt)
    col = color or (GREEN if isinstance(v, str) and v.startswith("=") and "!" in v else BLACK)
    x.font = font(col, bold, size=size)
    if fill:
        x.fill = fill
    if align or wrap:
        x.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap)
    if border:
        x.border = BOX
    return x


def note(cell, text, w=420, h=150):
    cell.comment = Comment(text, "Modelo")
    cell.comment.width, cell.comment.height = w, h


# ---------------------------------------------------------------- abas mensais (linhas = meses)
class MSheet:
    """Aba mensal. Linha 1-2 título; 4 grupo; 5 rótulo; 6 unidade; dados a partir da linha 8."""

    def __init__(self, ws, code, title_txt, subtitle):
        self.ws, self.code = ws, code
        self.title_txt, self.subtitle = title_txt, subtitle
        SHEETS[code] = ws.title
        self.cols, self.groups = [], []
        self.next = 1

    def group(self, t):
        self.groups.append([t, self.next, self.next - 1])

    def col(self, key, label, unit, tpl, fmt="brl", w=12.5, note_txt=None, init="0", bold=False):
        c = self.next
        self.next += 1
        COLS[(self.code, key)] = c
        INIT[(self.code, key)] = init
        self.cols.append(dict(key=key, c=c, label=label, unit=unit, tpl=tpl, fmt=fmt, w=w, note=note_txt, bold=bold))
        if self.groups:
            self.groups[-1][2] = c
        return c

    def time_cols(self, with_year=False, with_age=True):
        """Colunas de tempo padrão: A = mês nº (constante), B = data, C = idade."""
        self.group("TEMPO")
        self.col("t", "Mês nº", "nº", None, "int", 7)
        if self.code == "Macro":
            return
        self.col("data", "Mês", "data", "={Macro!data}", "date", 10)
        if with_year:
            self.col("ano", "Ano", "ano", "={Macro!ano}", "int", 7)
        if with_age:
            self.col("idade", "Idade dela", "anos", "={Macro!idade}", "int", 7)

    def render(self):
        ws = self.ws
        last = self.next - 1
        ws.sheet_view.showGridLines = False
        ws["A1"] = self.title_txt
        ws["A1"].font = font(WHITE, True, size=13)
        ws["A2"] = self.subtitle
        ws["A2"].font = font(WHITE, italic=True)
        for rr in (1, 2):
            for c in range(1, max(last, 12) + 1):
                ws.cell(rr, c).fill = F_HEAD
        for t, c1, c2 in self.groups:
            if c2 < c1:
                continue
            for c in range(c1, c2 + 1):
                ws.cell(4, c).fill = F_GRP
                ws.cell(4, c).border = Border(left=THIN if c == c1 else None)
            ws.cell(4, c1, t).font = font(bold=True)
        for cd in self.cols:
            c = cd["c"]
            h = ws.cell(5, c, cd["label"])
            h.font = font(bold=True, size=9)
            h.alignment = Alignment(wrap_text=True, vertical="top", horizontal="center")
            h.fill = F_TIME
            u = ws.cell(6, c, cd["unit"])
            u.font = font(GRAY, italic=True, size=8)
            u.alignment = Alignment(horizontal="center")
            u.fill = F_TIME
            if cd["note"]:
                note(h, cd["note"])
            ws.column_dimensions[L(c)].width = cd["w"]
            for i in range(NM):
                r = R0 + i
                x = ws.cell(r, c)
                if cd["tpl"] is None:          # coluna de tempo constante
                    x.value = i + 1
                    x.font = font(bold=True)
                else:
                    f = resolve(cd["tpl"], self.code, r)
                    x.value = f
                    x.font = font(GREEN if "!" in f else BLACK, cd["bold"])
                x.number_format = FMT[cd["fmt"]]
        ws.row_dimensions[5].height = 54
        ws.freeze_panes = ws.cell(R0, 4 if self.code != "Macro" else 2)
        ws.sheet_view.zoomScale = 85


# ---------------------------------------------------------------- Tabelas de Dados
def data_table(ws, r1, c1, r2, c2, row_input=None, col_input=None, lo=False):
    """Tabela de Dados nativa do Excel (Dados > Teste de Hipóteses > Tabela de Dados).
    1 variável: valores na coluna c1-1 (linhas r1..r2), fórmulas na linha r1-1 (colunas c1..c2), entrada = col_input.
    2 variáveis: fórmula no canto (r1-1, c1-1), valores da linha em r1-1, da coluna em c1-1.
    lo=True grava a função equivalente TABLE() (MULTIPLE.OPERATIONS) para a verificação no LibreOffice."""
    from openpyxl.worksheet.formula import DataTableFormula
    two = row_input is not None and col_input is not None
    if not lo:
        ref = f"{L(c1)}{r1}:{L(c2)}{r2}"
        ws.cell(r1, c1).value = (DataTableFormula(ref=ref, dt2D=True, dtr=True, r1=row_input, r2=col_input) if two
                                 else DataTableFormula(ref=ref, dt2D=False, dtr=False, r1=col_input))
        return
    ab = lambda a: "$" + re.match(r"[A-Z]+", a).group(0) + "$" + re.search(r"\d+", a).group(0)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            if two:
                f = f"=TABLE(${L(c1-1)}${r1-1},{ab(col_input)},${L(c1-1)}{r},{ab(row_input)},{L(c)}${r1-1})"
            else:
                f = f"=TABLE({L(c)}${r1-1},{ab(col_input)},${L(c1-1)}{r})"
            ws.cell(r, c).value = f
