# -*- coding: utf-8 -*-
"""Mini-framework para gerar o modelo em Excel com formulas vivas (openpyxl).

Ideia central: cada linha de calculo recebe uma CHAVE. As formulas sao escritas como
templates que citam chaves em vez de enderecos; o framework resolve os enderecos.

Tokens de template
  {chave}            mesma aba, mesma coluna (mes)          -> E12
  {Aba!chave}        outra aba, mesma coluna                -> Rebanho!E12
  {chave|p}          coluna anterior (mes t-1); no mes 1 vira 0
  {chave|all}        linha inteira (120 meses)              -> $E12:$DT12
  {chave|cum}        do mes 1 ate o mes atual               -> $E12:E12
  {chave|prev}       do mes 1 ate o mes anterior            -> $E12:D12
  {chave|tot}        coluna de total                        -> $C12
  {a|to:b}           bloco de linhas a..b na mesma coluna   -> E12:E19
  {t} {ano} {mes} {seca}   linhas de tempo do cabecalho (3, 5, 6, 7)
  [nome]             premissa escalar (endereco absoluto)
  [nome|m]           premissa mensal (12 colunas) indexada pelo mes-calendario
  [nome|y]           premissa anual (10 colunas) indexada pelo ano do modelo
"""
import re
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.comments import Comment

NM = 120            # meses
C0 = 5              # coluna do mes 1 (E)
CL = C0 + NM - 1    # coluna do mes 120 (DT)
R0 = 9              # primeira linha de dados nas abas mensais
FONT = "Arial"

BLUE, BLACK, GREEN, WHITE, GRAY = "0000FF", "000000", "007A33", "FFFFFF", "595959"
F_IN = PatternFill("solid", fgColor="FFF2CC")
F_KEY = PatternFill("solid", fgColor="FFFF00")
F_HEAD = PatternFill("solid", fgColor="1F3864")
F_SEC = PatternFill("solid", fgColor="D9E1F2")
F_TIME = PatternFill("solid", fgColor="F2F2F2")
F_TOT = PatternFill("solid", fgColor="EDEDED")
F_OUT = PatternFill("solid", fgColor="E2EFDA")
THIN = Side(style="thin", color="BFBFBF")

FMT = {
    "brl": '#,##0;(#,##0);"-"', "num": '#,##0.0;(#,##0.0);"-"', "num2": '#,##0.00;(#,##0.00);"-"',
    "int": '#,##0;(#,##0);"-"', "pct": '0.0%;(0.0%);"-"', "pct2": '0.00%;(0.00%);"-"',
    "fac": '0.000', "date": 'mmm/yy', "gen": 'General', "idx": '0', "mult": '0.00"x"',
}

SHEETS = {}     # codigo -> nome da aba
ROWS = {}       # (codigo, chave) -> linha
PREM = {}       # nome -> (aba, linha, coluna)

TOK = re.compile(r'\{(?:([A-Za-z_]+)!)?([A-Za-z0-9_]+)(?:\|([a-z]+)(?::([A-Za-z0-9_]+))?)?\}')
PTOK = re.compile(r'\[([A-Za-z0-9_]+)(?:\|([my]))?\]')
TIME = {"t": 3, "ano": 5, "mes": 6, "seca": 7}


def font(color=BLACK, bold=False, italic=False, size=10):
    return Font(name=FONT, size=size, bold=bold, italic=italic, color=color)


def paddr(name, cur_sheet=None, absolute=True):
    sh, r, c = PREM[name]
    a = f"${L(c)}${r}" if absolute else f"{L(c)}{r}"
    return a if sh == cur_sheet else f"{sh}!{a}"


def resolve(tpl, code, col=None):
    """Converte um template em formula Excel. col = indice da coluna (None fora de abas mensais)."""
    cur = SHEETS.get(code, code)

    def rep(m):
        sh, key, mod, arg = m.groups()
        if sh is None and key in TIME:
            return f"{L(col)}${TIME[key]}"
        scode = sh or code
        pre = "" if scode == code else SHEETS[scode] + "!"
        r = ROWS[(scode, key)]
        if mod is None:
            return f"{pre}{L(col)}{r}"
        if mod == "p":
            return "0" if col == C0 else f"{pre}{L(col-1)}{r}"
        if mod == "all":
            return f"{pre}${L(C0)}{r}:${L(CL)}{r}"
        if mod == "cum":
            return f"{pre}${L(C0)}{r}:{L(col)}{r}"
        if mod == "prev":
            if col == C0:   # sem meses anteriores: aponta para a linha de tempo (nunca e lido)
                return f"${L(C0)}$3:${L(C0)}$3"
            return f"{pre}${L(C0)}{r}:{L(col-1)}{r}"
        if mod == "tot":
            return f"{pre}$C{r}"
        if mod == "last":
            return f"{pre}${L(CL)}{r}"
        if mod == "to":
            r2 = ROWS[(scode, arg)]
            return f"{pre}{L(col)}{r}:{L(col)}{r2}"
        raise ValueError(mod)

    def prep(m):
        name, mod = m.groups()
        sh, r, c = PREM[name]
        pre = "" if sh == cur else sh + "!"
        if mod == "m":
            return f"INDEX({pre}${L(c)}${r}:${L(c+11)}${r},{L(col)}$6)"
        if mod == "y":
            return f"INDEX({pre}${L(c)}${r}:${L(c+9)}${r},{L(col)}$5)"
        return f"{pre}${L(c)}${r}"

    return PTOK.sub(prep, TOK.sub(rep, tpl))


def style_formula(cell, f):
    cell.font = font(GREEN if "!" in f else BLACK)


class Monthly:
    """Aba mensal: A rotulo | B unidade | C total | D (vazia) | E..DT = meses 1..120."""

    def __init__(self, wb, code, name, title, subtitle):
        self.ws = wb.create_sheet(name)
        self.code, self.name = code, name
        SHEETS[code] = name
        self.r = R0
        self.items = []
        ws = self.ws
        ws["A1"] = title
        ws["A1"].font = font(WHITE, True, size=13)
        ws["A2"] = subtitle
        ws["A2"].font = font(WHITE, italic=True)
        for rr in (1, 2):
            for c in range(1, CL + 1):
                ws.cell(rr, c).fill = F_HEAD
        labels = {3: ("Mês do modelo", "nº"), 4: ("Data (fim do mês)", "data"), 5: ("Ano do modelo", "nº"),
                  6: ("Mês-calendário", "1-12"), 7: ("Estação seca (1 = sim)", "flag")}
        for rr, (lab, un) in labels.items():
            ws.cell(rr, 1, lab).font = font(bold=True)
            ws.cell(rr, 2, un).font = font(GRAY, italic=True)
            for c in range(1, CL + 1):
                ws.cell(rr, c).fill = F_TIME
        ws.cell(3, 3, "Total / ref.").font = font(bold=True)
        ws.cell(3, 3).alignment = Alignment(horizontal="center")
        for i in range(NM):
            c = C0 + i
            cl = L(c)
            ws.cell(3, c, 1 if i == 0 else f"={L(c-1)}3+1")
            ws.cell(4, c, f"=EOMONTH({paddr('data_ini')},{cl}3-1)")
            ws.cell(5, c, f"=INT(({cl}3-1)/12)+1")
            ws.cell(6, c, f"=MONTH({cl}4)")
            sh, r, c0 = PREM["seca"]
            ws.cell(7, c, f"=INDEX({sh}!${L(c0)}${r}:${L(c0+11)}${r},{cl}6)")
            for rr, fm in ((3, "idx"), (4, "date"), (5, "idx"), (6, "idx"), (7, "idx")):
                x = ws.cell(rr, c)
                x.number_format = FMT[fm]
                x.font = font(GREEN if rr in (4, 7) else BLACK, bold=(rr == 3))
                x.alignment = Alignment(horizontal="center")
        ws.column_dimensions["A"].width = 52
        ws.column_dimensions["B"].width = 11
        ws.column_dimensions["C"].width = 15
        ws.column_dimensions["D"].width = 2
        for c in range(C0, CL + 1):
            ws.column_dimensions[L(c)].width = 11.5
        ws.freeze_panes = ws.cell(R0, C0)
        ws.sheet_view.zoomScale = 85
        ws.sheet_view.showGridLines = False

    def sec(self, title):
        self.r += 1
        self.items.append(("sec", self.r, title))
        self.r += 1

    def row(self, key, label, unit, f, fmt="brl", tot="sum", note=None, bold=False):
        ROWS[(self.code, key)] = self.r
        self.items.append(("row", self.r, key, label, unit, f, fmt, tot, note, bold))
        self.r += 1

    def render(self):
        ws = self.ws
        for it in self.items:
            if it[0] == "sec":
                _, r, title = it
                for c in range(1, CL + 1):
                    ws.cell(r, c).fill = F_SEC
                ws.cell(r, 1, title).font = font(bold=True, size=11)
                continue
            _, r, key, label, unit, f, fmt, tot, note, bold = it
            a = ws.cell(r, 1, label)
            a.font = font(bold=bold)
            if not bold:
                a.alignment = Alignment(indent=1)
            if note:
                a.comment = Comment(note, "Modelo")
                a.comment.width, a.comment.height = 380, 140
            ws.cell(r, 2, unit).font = font(GRAY, italic=True)
            rng = f"{L(C0)}{r}:{L(CL)}{r}"
            tf = {"sum": f"=SUM({rng})", "avg": f"=AVERAGE({rng})", "max": f"=MAX({rng})",
                  "min": f"=MIN({rng})", "last": f"={L(CL)}{r}", None: None}[tot]
            if tf:
                tcell = ws.cell(r, 3, tf)
                tcell.number_format = FMT[fmt]
                tcell.font = font(bold=True)
                tcell.fill = F_TOT
            for i in range(NM):
                c = C0 + i
                x = ws.cell(r, c, resolve(f, self.code, c))
                x.number_format = FMT[fmt]
                style_formula(x, x.value)
                if bold:
                    x.font = font(x.font.color.rgb[-6:], True)
                    x.border = Border(top=THIN)


class Prem:
    """Aba de premissas: A rotulo | B unidade | C (vazia) | D.. valores | notas em E (escalar) ou Q (tabela)."""

    def __init__(self, wb, name="Premissas"):
        self.ws = wb.create_sheet(name)
        self.name = name
        SHEETS["P"] = name
        self.r = 4
        self.pending = []
        ws = self.ws
        ws["A1"] = "PREMISSAS — todas as entradas do modelo"
        ws["A1"].font = font(WHITE, True, size=13)
        ws["A2"] = ("Células amarelas com fonte azul = entradas editáveis. Fonte verde = valor trazido de outra aba "
                    "(Cenarios / Sensibilidade). Fonte preta = cálculo. Altere somente as células azuis.")
        ws["A2"].font = font(WHITE, italic=True)
        for rr in (1, 2):
            for c in range(1, 18):
                ws.cell(rr, c).fill = F_HEAD
        ws.column_dimensions["A"].width = 58
        ws.column_dimensions["B"].width = 13
        ws.column_dimensions["C"].width = 2
        for c in range(4, 16):
            ws.column_dimensions[L(c)].width = 12
        ws.column_dimensions["P"].width = 2
        ws.column_dimensions["Q"].width = 90
        ws.freeze_panes = "D4"
        ws.sheet_view.zoomScale = 90
        ws.sheet_view.showGridLines = False

    def sec(self, title):
        self.r += 1
        for c in range(1, 18):
            self.ws.cell(self.r, c).fill = F_SEC
        self.ws.cell(self.r, 1, title).font = font(bold=True, size=11)
        self.r += 1

    def head(self, labels, title=""):
        self.ws.cell(self.r, 1, title).font = font(GRAY, italic=True)
        for i, lab in enumerate(labels):
            x = self.ws.cell(self.r, 4 + i, lab)
            x.font = font(bold=True)
            x.fill = F_TIME
            x.alignment = Alignment(horizontal="center", wrap_text=True)
        self.r += 1

    def _cell(self, r, c, v, fmt, kind):
        x = self.ws.cell(r, c)
        x.number_format = FMT[fmt]
        if kind == "in":
            x.value = v
            x.font = font(BLUE)
            x.fill = F_IN
            x.border = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
        elif kind == "key":
            x.value = v
            x.font = font(BLUE, True)
            x.fill = F_KEY
            x.border = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
        else:
            self.pending.append((r, c, v))
        return x

    def s(self, name, label, v, unit="", note="", fmt="num", kind="in"):
        """Premissa escalar em D."""
        r = self.r
        PREM[name] = (self.name, r, 4)
        self.ws.cell(r, 1, label).font = font()
        self.ws.cell(r, 2, unit).font = font(GRAY, italic=True)
        self._cell(r, 4, v, fmt, kind)
        if note:
            self.ws.cell(r, 5, note).font = font(GRAY, italic=True, size=9)
        self.r += 1

    def v(self, name, label, vals, unit="", note="", fmt="num", kind="in"):
        """Premissa vetorial (12 meses ou 10 anos) em D.."""
        r = self.r
        PREM[name] = (self.name, r, 4)
        self.ws.cell(r, 1, label).font = font()
        self.ws.cell(r, 2, unit).font = font(GRAY, italic=True)
        for i, val in enumerate(vals):
            k = "calc" if isinstance(val, str) and val.startswith("=") else kind
            self._cell(r, 4 + i, val, fmt, k)
        if note:
            self.ws.cell(r, 17, note).font = font(GRAY, italic=True, size=9)
        self.r += 1

    def text(self, t):
        self.ws.cell(self.r, 1, t).font = font(GRAY, italic=True, size=9)
        self.r += 1

    def render(self):
        for r, c, tpl in self.pending:
            x = self.ws.cell(r, c, resolve(tpl, "P"))
            style_formula(x, x.value)
