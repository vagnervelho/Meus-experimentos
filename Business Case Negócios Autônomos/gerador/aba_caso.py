# -*- coding: utf-8 -*-
"""Constrói uma aba de business case. Todas as abas têm o MESMO desenho, então os indicadores ficam nas
mesmas células em todas elas (o Painel aproveita isso).

Layout: A rótulo | B unidade | C ano 0 ou valor | D..H anos 1..5 | I total | K fonte/lógica.
Blocos de projeção: Base, Pessimista, Otimista, Estresse global (choques da aba Sensibilidade) e Auxiliar
(Base com demanda −20%, usado só para a margem de segurança).

Tokens nas fórmulas das definições:  {chave} = premissa da própria aba ; [chave] = premissa global.
"""
import re
from estilo import *
from premissas_globais import G
from openpyxl.worksheet.datavalidation import DataValidation

TOK = re.compile(r"\{([A-Za-z0-9_]+)\}")
GTOK = re.compile(r"\[([A-Za-z0-9_]+)\]")

# linhas fixas do quadro de indicadores (iguais em todas as abas)
KPI_ROW0 = 7
KPIS = [  # (chave, rótulo, unidade, formato)
    ("inv", "Investimento total (capex + capital de giro + pré-operacional)", "R$", "brl"),
    ("cap_proprio", "Capital próprio necessário (investimento − financiamento)", "R$", "brl"),
    ("rec5", "Receita no ano 5 (maturidade)", "R$/ano", "brl"),
    ("mg5", "Margem EBITDA no ano 5", "%", "pct"),
    ("vpl", "VPL do projeto na TMA real", "R$", "brl"),
    ("tir", "TIR real do projeto (5 anos, com valor residual)", "% a.a.", "pct"),
    ("tir_nom", "TIR nominal equivalente", "% a.a.", "pct"),
    ("tirm", "TIRM real (reinvestimento à taxa global)", "% a.a.", "pct"),
    ("tir_acion", "TIR real do acionista (com financiamento)", "% a.a.", "pct"),
    ("pb", "Payback simples (sem valor residual)", "anos", "anos"),
    ("pbd", "Payback descontado (sem valor residual)", "anos", "anos"),
    ("roi", "ROI acumulado em 5 anos", "%", "pct"),
    ("moic", "MOIC (caixa recebido ÷ investido)", "×", "mult"),
    ("expo", "Exposição máxima de caixa", "R$", "brl"),
    ("dep_vr", "Dependência do valor residual (% do valor presente das entradas)", "%", "pct"),
    ("horas", "Horas humanas por semana", "h/sem", "num"),
    ("ms", "Margem de segurança da demanda (queda que zera o VPL)", "%", "pct"),
    ("pe", "Ponto de equilíbrio operacional (% da demanda madura)", "%", "pct"),
    ("veredito", "Veredito (regra no Painel)", "", "gen"),
]
KPI = {k: KPI_ROW0 + i for i, (k, *_r) in enumerate(KPIS)}
SCOL = {"P": 3, "B": 4, "O": 5, "E": 6}          # colunas do quadro de indicadores
SCEN_COL = {"P": "C", "B": "D", "O": "E", "E": "F", "H": "G"}
ANOS = ["Ano 0", "Ano 1", "Ano 2", "Ano 3", "Ano 4", "Ano 5"]
YC = ["C", "D", "E", "F", "G", "H"]                # colunas dos anos 0..5


def gref(k):
    return G[k]


class Aba:
    def __init__(self, wb, caso):
        self.c = caso
        self.ws = wb.create_sheet(caso["aba"])
        self.ref = {}           # chave local -> $C$linha
        self.r = 1

    # ------------------------------------------------------------------ utilidades
    def res(self, f):
        """Resolve tokens de uma fórmula. Números passam direto."""
        if not isinstance(f, str):
            return f
        f = TOK.sub(lambda m: self.ref[m.group(1)], f)
        f = GTOK.sub(lambda m: gref(m.group(1)), f)
        return f

    def linha_valor(self, chave, rotulo, unidade, valor, fmt="num", nt="", chave_destaque=False, bold=False, fill=None):
        """Uma premissa/derivada com valor na coluna C. Entrada se número; fórmula se string iniciada por '='."""
        ws, r = self.ws, self.r
        ws.cell(r, CA, rotulo).font = font(bold=bold)
        if not bold:
            ws.cell(r, CA).alignment = Alignment(indent=1)
        ws.cell(r, CB, unidade).font = font(GRAY, italic=True)
        x = ws.cell(r, C0)
        if isinstance(valor, str) and valor.startswith("="):
            formula(x, self.res(valor), fmt, bold, fill)
        else:
            entrada(x, valor, fmt, chave_destaque)
        if nt:
            nota(ws, r, nt)
        if chave:
            self.ref[chave] = f"$C${r}"
        self.r += 1
        return r

    def cab(self, titulo):
        self.r += 1
        secao(self.ws, self.r, titulo)
        self.r += 1

    def cab_colunas(self, rotulos, cols=None):
        ws, r = self.ws, self.r
        cols = cols or list(range(1, 1 + len(rotulos)))
        for c, t in zip(cols, rotulos):
            x = ws.cell(r, c, t)
            x.font = font(bold=True)
            x.fill = F_TIME
            x.alignment = Alignment(horizontal="center", wrap_text=True)
        self.r += 1

    # ------------------------------------------------------------------ construção
    def build(self):
        c, ws = self.c, self.ws
        faixa_titulo(ws, f"{c['cod']} — {c['nome'].upper()}", c["resumo"])
        ws.column_dimensions["A"].width = 58
        ws.column_dimensions["B"].width = 11
        for col in "CDEFGHI":
            ws.column_dimensions[col].width = 14
        ws.column_dimensions["J"].width = 2
        ws.column_dimensions["K"].width = 95
        x = ws.cell(3, 1, "← Voltar ao Painel")
        x.hyperlink = "#'Painel'!A1"
        x.font = font("0563C1", underline="single")
        ws.cell(3, 3, f"Categoria: {c['categoria']}").font = font(GRAY, italic=True)
        ws.cell(3, 11, f"Risco regulatório: {c['risco_reg']}  ·  Autonomia: {c['autonomia']}").font = font(GRAY, italic=True)
        # quadro de indicadores (preenchido no fim, quando as linhas dos blocos são conhecidas)
        secao(ws, 5, "RESULTADO — indicadores de decisão (5 anos, R$ constantes de 2026)")
        for col, t in zip((1, 2, 3, 4, 5, 6, 11), ("Indicador", "Unid.", "Pessimista", "Base", "Otimista",
                                                    "Estresse global", "Como ler")):
            x = ws.cell(6, col, t)
            x.font = font(bold=True)
            x.fill = F_TIME
            x.alignment = Alignment(horizontal="center")
        self.r = KPI_ROW0 + len(KPIS) + 1
        self.sec_texto()
        self.sec_operacional()
        self.sec_investimento()
        self.sec_fixos()
        self.sec_receita_pct()
        self.sec_trib_fin()
        self.sec_cenarios()
        self.blocos = {}
        for s, titulo in (("B", "8. PROJEÇÃO — CENÁRIO BASE"), ("P", "9. PROJEÇÃO — CENÁRIO PESSIMISTA"),
                          ("O", "10. PROJEÇÃO — CENÁRIO OTIMISTA"),
                          ("E", "11. PROJEÇÃO — ESTRESSE GLOBAL (choques da aba Sensibilidade sobre o Base)"),
                          ("H", "12. AUXILIAR — Base com demanda 20% menor (só para a margem de segurança)")):
            self.blocos[s] = self.bloco(s, titulo)
        self.quadro_kpi()
        self.sec_checks()
        ws.freeze_panes = "C7"
        ws.sheet_view.zoomScale = 90
        return self

    # 1 ------------------------------------------------------------------------------------------
    def sec_texto(self):
        self.cab("1. MODELO DE NEGÓCIO")
        ws = self.ws
        for rot, chave in (("O que é", "oque"), ("Por que em Porto Velho", "pvh"), ("Como opera sem gente", "autonomo"),
                           ("Principais riscos", "riscos"), ("Regulação e licenças", "regulacao"),
                           ("Fontes e confiança das premissas", "fontes")):
            r = self.r
            ws.cell(r, 1, rot).font = font(bold=True)
            ws.cell(r, 1).alignment = Alignment(vertical="top")
            x = ws.cell(r, 2, self.c["texto"][chave])
            x.font = font()
            x.alignment = Alignment(wrap_text=True, vertical="top")
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=11)
            ws.row_dimensions[r].height = max(15, 13.5 * (1 + len(self.c["texto"][chave]) // 175))
            self.r += 1

    # 2 ------------------------------------------------------------------------------------------
    def sec_operacional(self):
        self.cab("2. PREMISSAS OPERACIONAIS (motor de receita e de custos variáveis)")
        self.cab_colunas(["Premissa", "Unidade", "Valor"] + [""] * 7 + ["Fonte / lógica"])
        for d in self.c["drivers"]:
            k, rot, un, v = d[:4]
            nt = d[4] if len(d) > 4 else ""
            fmt = d[5] if len(d) > 5 else ("num" if not isinstance(v, str) else "num")
            chave_dest = d[6] if len(d) > 6 else False
            self.linha_valor(k, rot, un, v, fmt, nt, chave_dest)
        self.r += 1
        rr = []
        for i, (rot, f) in enumerate(self.c["receitas"]):
            rr.append(self.linha_valor(f"rec_{i}", f"Receita madura — {rot}", "R$/ano", "=" + f, "brl"))
        soma = "+".join(f"C{x}" for x in rr)
        self.linha_valor("RMAD", "Receita bruta madura (ano típico em plena maturidade)", "R$/ano", "=" + soma, "brl",
                         "Demanda e preço do caso-base; os cenários aplicam multiplicadores sobre este valor.", bold=True, fill=F_TOT)
        self.linha_valor("kwh_v", "Energia variável na maturidade", "kWh/ano", "=" + self.c.get("energia_kwh", "0"), "int",
                         self.c.get("nota_energia", ""))
        self.linha_valor("EMAD", "Custo de energia variável na maturidade", "R$/ano", "={kwh_v}*[tarifa_kwh]", "brl")
        self.linha_valor("m3_v", "Água variável na maturidade", "m³/ano", "=" + self.c.get("agua_m3", "0"), "int")
        self.linha_valor("AGUA", "Custo de água variável na maturidade", "R$/ano", "={m3_v}*[agua_m3]", "brl")
        self.linha_valor("INS", "Insumos, CMV e outros custos variáveis na maturidade", "R$/ano",
                         "=" + self.c.get("insumos", "0"), "brl", self.c.get("nota_insumos", ""))
        self.linha_valor("AIMAD", "Água + insumos + CMV (variáveis, sem energia)", "R$/ano", "={AGUA}+{INS}", "brl", bold=True, fill=F_TOT)
        self.linha_valor("CVMAD", "Custo variável total na maturidade (% da receita)", "%",
                         "=IF({RMAD}=0,0,({EMAD}+{AIMAD})/{RMAD})", "pct")

    # 3 ------------------------------------------------------------------------------------------
    def sec_investimento(self):
        self.cab("3. INVESTIMENTO (o investidor não tem terreno: nenhuma linha inclui compra de terreno)")
        self.cab_colunas(["Item", "Unidade", "Valor (R$)", "% revenda no ano 5"] + [""] * 6 + ["Fonte / lógica"])
        ws = self.ws
        linhas = []
        for item in self.c["capex"]:
            rot, v, res = item[:3]
            nt = item[3] if len(item) > 3 else ""
            r = self.r
            ws.cell(r, 1, rot).font = font()
            ws.cell(r, 1).alignment = Alignment(indent=1)
            ws.cell(r, 2, "R$").font = font(GRAY, italic=True)
            x = ws.cell(r, 3)
            if isinstance(v, str):
                formula(x, self.res(v if v.startswith("=") else "=" + v), "brl")
            else:
                entrada(x, v, "brl")
            entrada(ws.cell(r, 4), res, "pct")
            if nt:
                nota(ws, r, nt)
            linhas.append(r)
            self.r += 1
        a, b = linhas[0], linhas[-1]
        self.linha_valor("CAPEX", "Capex total", "R$", f"=SUM(C{a}:C{b})", "brl", bold=True, fill=F_TOT)
        self.linha_valor("LIQ", "Valor de liquidação dos ativos no ano 5", "R$", f"=SUMPRODUCT(C{a}:C{b},D{a}:D{b})", "brl",
                         "Quanto o mercado pagaria pelos ativos usados (obras e instalações valem ~0).")
        self.linha_valor("GIRO", "Capital de giro (estoque, caixa mínimo)", "R$", self.c["giro"], "brl",
                         "Investido no ano 0 e devolvido no ano 5.")
        self.linha_valor("PREOP", "Pré-operacional (licenças, projeto, marketing de lançamento)", "R$", self.c["preop"], "brl")
        self.linha_valor("INV", "Investimento total", "R$", "={CAPEX}+{GIRO}+{PREOP}", "brl", bold=True, fill=F_TOT)
        self.linha_valor("MANUT", "Manutenção e reposição de equipamentos (a partir do ano 2)", "% capex/ano", self.c["manut"], "pct",
                         "No ano 1 vale a garantia dos equipamentos.")
        self.linha_valor("VIDA", "Vida útil remanescente após o ano 5 (para o valor de continuidade)", "anos", self.c["vida_rest"], "int",
                         "Anos de fluxo que um comprador pagaria além do ano 5.")
        self.linha_valor("ANUID", "Fator de anuidade na TMA (auxiliar)", "×", "=IF({VIDA}<=0,0,(1-(1+[tma])^(-{VIDA}))/[tma])", "num2")
        self.linha_valor("PSIN", "Probabilidade anual de sinistro (furto, vandalismo, pane grave)", "%", self.c["p_sin"], "pct")
        self.linha_valor("CSIN", "Custo por sinistro", "R$", self.c["c_sin"], "brl", "Entra como perda esperada (probabilidade × custo) todo ano.")

    # 4 ------------------------------------------------------------------------------------------
    def sec_fixos(self):
        self.cab("4. CUSTOS FIXOS MENSAIS")
        self.cab_colunas(["Item", "Unidade", "R$/mês"] + [""] * 7 + ["Fonte / lógica"])
        linhas = []
        for item in self.c["fixos"]:
            rot, v = item[:2]
            nt = item[2] if len(item) > 2 else ""
            linhas.append(self.linha_valor(None, rot, "R$/mês", v if not isinstance(v, str) else ("=" + v if not v.startswith("=") else v),
                                           "brl", nt))
        a, b = linhas[0], linhas[-1]
        self.linha_valor("FIXM", "Total fixo mensal (exceto energia)", "R$/mês", f"=SUM(C{a}:C{b})", "brl", bold=True, fill=F_TOT)
        self.linha_valor("kwh_f", "Energia fixa (iluminação, refrigeração de base, climatização, standby)", "kWh/mês",
                         self.c.get("energia_fixa_kwh", 0), "int", self.c.get("nota_energia_fixa", ""))
        self.linha_valor("FIXO_OUT", "Custos fixos anuais (exceto energia)", "R$/ano", "={FIXM}*12", "brl", bold=True)
        self.linha_valor("FIXO_EN", "Energia fixa anual", "R$/ano", "={kwh_f}*12*[tarifa_kwh]", "brl", bold=True)

    # 5 ------------------------------------------------------------------------------------------
    def sec_receita_pct(self):
        self.cab("5. CUSTOS PROPORCIONAIS À RECEITA")
        self.cab_colunas(["Item", "Unidade", "% da receita"] + [""] * 7 + ["Fonte / lógica"])
        linhas = []
        for item in self.c["crec"]:
            rot, v = item[:2]
            nt = item[2] if len(item) > 2 else ""
            linhas.append(self.linha_valor(None, rot, "%", v, "pct", nt))
        a, b = linhas[0], linhas[-1]
        self.linha_valor("CREC", "Total proporcional à receita", "%", f"=SUM(C{a}:C{b})", "pct", bold=True, fill=F_TOT)

    # 6 ------------------------------------------------------------------------------------------
    def sec_trib_fin(self):
        self.cab("6. TEMPO HUMANO, TRIBUTOS E FINANCIAMENTO")
        c = self.c
        self.linha_valor("HORAS", "Horas humanas por semana (premissa de entrada)", "h/sem", c["horas"], "num",
                         c.get("nota_horas", "Premissa de entrada: ajuste ao seu modelo de operação."), chave_destaque=True)
        self.linha_valor("CHORA", "Custo da hora humana (global)", "R$/h", "=[custo_hora]", "brl2")
        self.linha_valor("CONTA", "Contar horas como custo? (global)", "1/0", "=[conta_horas]", "idx")
        self.linha_valor("REGIME", "Regime tributário (1 = Simples; 2 = alíquota fixa)", "1/2", c.get("regime", 1), "idx",
                         "1 = Simples Nacional pelas tabelas da aba Premissas; 2 = alíquota fixa sobre a receita (ex.: Lucro Presumido).")
        self.linha_valor("ANEXO", "Anexo do Simples (código de 1 a 4)", "1-4", c["anexo"], "idx",
                         "1 = Anexo I (comércio); 2 = Anexo II (indústria); 3 = Anexo III (serviços); 4 = Anexo III sem ISS (locação de bens móveis). "
                         + c.get("nota_anexo", ""))
        self.linha_valor("ALIQF", "Alíquota fixa sobre a receita (só se regime = 2)", "%", c.get("aliq_fixa", 0.0), "pct",
                         c.get("nota_aliq", "Ex.: Lucro Presumido em locação ≈ 11–14% da receita."))
        self.linha_valor("TRIBMAT", "Alíquota efetiva na maturidade (auxiliar)", "%",
                         "=IF({RMAD}<=0,0,IF({REGIME}=1,MAX(0,{RMAD}*INDEX(" + self._aliq() + ",MATCH({RMAD},[LIM],1))"
                         "-INDEX(" + self._ded() + ",MATCH({RMAD},[LIM],1)))*IF({ANEXO}=4,1-INDEX([ISS],MATCH({RMAD},[LIM],1)),1),"
                         "{RMAD}*{ALIQF})/{RMAD})", "pct")
        self.linha_valor("FINL", "% do investimento financiado nesta aba", "%", c.get("fin", 0.0), "pct",
                         "0% = só capital próprio. O financiamento não muda a TIR do projeto, só a do acionista.")
        self.linha_valor("FIN", "% financiado efetivo (usa o global da aba Premissas se for > 0)", "%",
                         "=IF([fin_global]>0,[fin_global],{FINL})", "pct")
        self.linha_valor("FINR", "Taxa real do financiamento (global)", "% a.a.", "=[fin_real]", "pct")
        self.linha_valor("PRAZO", "Prazo do financiamento (global)", "anos", "=[fin_prazo]", "int")
        self.linha_valor("CAR", "Carência (global)", "anos", "=[fin_carencia]", "int")

    def _aliq(self):
        return "CHOOSE({ANEXO}," + ",".join(["[A1]", "[A2]", "[A3]", "[A3]"]) + ")"

    def _ded(self):
        return "CHOOSE({ANEXO}," + ",".join(["[D1]", "[D2]", "[D3]", "[D3]"]) + ")"

    # 7 ------------------------------------------------------------------------------------------
    def sec_cenarios(self):
        self.cab("7. CENÁRIOS E MATURAÇÃO")
        self.cab_colunas(["Multiplicador sobre o caso-base", "Unid.", "Pessimista", "Base", "Otimista", "Estresse global",
                          "Auxiliar (−20% demanda)", "", "", "", "Lógica"])
        ws = self.ws
        cen = self.c["cenarios"]
        nomes = [("dem", "Demanda (volume)", "×", "s_dem", "mult"), ("pre", "Preço", "×", "s_pre", "mult"),
                 ("cap", "Investimento (capex)", "×", "s_cap", "mult"), ("fix", "Custos fixos", "×", "s_fix", "mult"),
                 ("ene", "Energia", "×", "s_ene", "mult"), ("atr", "Atraso da maturação", "anos", "s_atr", "num"),
                 ("hor", "Horas humanas", "×", "s_hor", "mult")]
        self.mrow = {}
        for i, (k, rot, un, sk, fm) in enumerate(nomes):
            r = self.r
            ws.cell(r, 1, rot).font = font()
            ws.cell(r, 1).alignment = Alignment(indent=1)
            ws.cell(r, 2, un).font = font(GRAY, italic=True)
            base = 0.0 if k == "atr" else 1.0
            entrada(ws.cell(r, 3), cen["P"][i], fm)
            entrada(ws.cell(r, 4), base, fm)
            entrada(ws.cell(r, 5), cen["O"][i], fm)
            if k == "atr":
                formula(ws.cell(r, 6), f"=D{r}+{G[sk]}", fm)
            else:
                formula(ws.cell(r, 6), f"=D{r}*{G[sk]}", fm)
            formula(ws.cell(r, 7), f"=D{r}*0.8" if k == "dem" else f"=D{r}", fm, fill=F_TOT)
            self.mrow[k] = r
            self.r += 1
        nota(ws, self.mrow["dem"], "Pessimista e otimista são próprios deste negócio (largura da incerteza). "
                                   "Estresse global = Base × choques da aba Sensibilidade (iguais para todos os negócios).")
        nota(ws, self.mrow["atr"], "Atraso desloca a curva de maturação no tempo (0,5 = seis meses).")
        # rampa
        self.r += 1
        for j in range(5):
            x = ws.cell(self.r, CY[j], f"Ano {j + 1}")
            x.font = font(bold=True)
            x.fill = F_TIME
            x.alignment = Alignment(horizontal="center")
        self.r += 1
        r = self.r
        ws.cell(r, 1, "Rampa de maturação (% da demanda madura, anos 1 a 5)").font = font(bold=True)
        ws.cell(r, 2, "%").font = font(GRAY, italic=True)
        for j, v in enumerate(self.c["rampa"]):
            entrada(ws.cell(r, CY[j]), v, "pct")
        nota(ws, r, self.c.get("nota_rampa", "Tempo até o ponto ficar conhecido e a clientela formar hábito."))
        self.rampa_row = r
        self.r += 1
        r = self.r
        ws.cell(r, 1, "Rampa estendida (auxiliar: índices 0 a 6)").font = font(GRAY, italic=True)
        formula(ws.cell(r, 3), 0, "pct", fill=F_TOT)
        for j in range(5):
            formula(ws.cell(r, CY[j]), f"={L(CY[j])}{self.rampa_row}", "pct", fill=F_TOT)
        formula(ws.cell(r, CT), f"=H{self.rampa_row}", "pct", fill=F_TOT)
        self.rext = f"$C${r}:$I${r}"
        self.r += 1

    # 8-12 ---------------------------------------------------------------------------------------
    def bloco(self, s, titulo):
        ws = self.ws
        self.r += 1
        r = self.r
        secao(ws, r, titulo)
        for j, t in enumerate(ANOS):
            x = ws.cell(r, 3 + j, t)
            x.font = font(bold=True)
            x.alignment = Alignment(horizontal="center")
        ws.cell(r, CT, "Total 1–5").font = font(bold=True)
        self.r += 1
        sc = SCEN_COL[s]
        M = {k: f"${sc}${row}" for k, row in self.mrow.items()}
        R = {}
        ordem = ["t", "fd", "mat", "vol", "rec", "ener_v", "agua_ins", "crec", "trib", "fixo", "ener_f", "horas", "sin", "ebitda",
                 "mg", "manut", "fcl", "inv", "vr", "fc", "acum", "fcd", "acumd", "pbs", "pbd", "div", "jur", "amo", "fca"]
        for i, k in enumerate(ordem):
            R[k] = self.r + i
        rot = {
            "t": ("Ano (t)", "nº"), "fd": ("Fator de desconto na TMA real", "×"), "mat": ("Fator de maturação (rampa com atraso)", "%"),
            "vol": ("Volume relativo à demanda madura do caso-base", "×"), "rec": ("Receita bruta", "R$"),
            "ener_v": ("(−) Energia variável", "R$"), "agua_ins": ("(−) Água, insumos e CMV", "R$"),
            "crec": ("(−) Custos proporcionais à receita", "R$"), "trib": ("(−) Tributos (Simples Nacional ou alíquota fixa)", "R$"),
            "fixo": ("(−) Custos fixos (exceto energia)", "R$"), "ener_f": ("(−) Energia fixa", "R$"),
            "horas": ("(−) Tempo humano", "R$"), "sin": ("(−) Perda esperada com sinistros", "R$"), "ebitda": ("(=) EBITDA", "R$"),
            "mg": ("Margem EBITDA", "%"), "manut": ("(−) Manutenção e reposição de equipamentos", "R$"),
            "fcl": ("(=) Fluxo de caixa operacional livre", "R$"), "inv": ("(−) Investimento inicial", "R$"),
            "vr": ("(+) Valor residual no ano 5 (maior entre liquidar e continuar) + giro", "R$"),
            "fc": ("(=) FLUXO DE CAIXA DO PROJETO", "R$"), "acum": ("Fluxo acumulado (sem valor residual)", "R$"),
            "fcd": ("Fluxo descontado (sem valor residual)", "R$"), "acumd": ("Fluxo descontado acumulado", "R$"),
            "pbs": ("Auxiliar: payback simples", "anos"), "pbd": ("Auxiliar: payback descontado", "anos"),
            "div": ("Saldo devedor do financiamento (fim do ano, real)", "R$"), "jur": ("(−) Juros reais", "R$"),
            "amo": ("(−) Amortização", "R$"), "fca": ("(=) FLUXO DE CAIXA DO ACIONISTA", "R$"),
        }
        fmts = {"t": "idx", "fd": "num3", "mat": "pct", "vol": "num2", "mg": "pct", "pbs": "anos", "pbd": "anos"}
        bold = {"ebitda", "fcl", "fc", "fca", "rec"}
        aux = {"t", "fd", "mat", "vol", "acum", "fcd", "acumd", "pbs", "pbd"}
        for k in ordem:
            rr = R[k]
            lab, un = rot[k]
            ws.cell(rr, 1, lab).font = font(bold=k in bold, color=GRAY if k in aux else BLACK, italic=k in aux)
            if k not in bold:
                ws.cell(rr, 1).alignment = Alignment(indent=1)
            ws.cell(rr, 2, un).font = font(GRAY, italic=True)
        rx = self.ref
        tma = gref("tma")
        for j, col in enumerate(YC):          # j = ano 0..5
            def put(k, f, fmt=None, b=False, fill=None):
                formula(ws.cell(R[k], 3 + j), self.res(f) if isinstance(f, str) else f, fmt or fmts.get(k, "brl"), b or k in bold, fill)
            put("t", j, "idx")
            put("fd", f"=1/(1+{tma})^{col}{R['t']}")
            if j == 0:
                put("inv", f"=-({{CAPEX}}*{M['cap']}+{{GIRO}}+{{PREOP}})")
                put("fc", f"={col}{R['inv']}")
                put("acum", f"={col}{R['fc']}")
                put("fcd", f"={col}{R['fc']}*{col}{R['fd']}")
                put("acumd", f"={col}{R['fcd']}")
                put("div", f"=-{col}{R['inv']}*{{FIN}}")
                put("fca", f"={col}{R['inv']}+{col}{R['div']}")
                continue
            p = YC[j - 1]
            x = f"({col}{R['t']}-{M['atr']})"
            put("mat", f"=IF({x}<=0,0,(1-({x}-INT({x})))*INDEX({self.rext},1,MIN(INT({x}),6)+1)"
                       f"+({x}-INT({x}))*INDEX({self.rext},1,MIN(INT({x})+1,6)+1))")
            put("vol", f"={col}{R['mat']}*{M['dem']}")
            put("rec", f"={{RMAD}}*{col}{R['vol']}*{M['pre']}")
            put("ener_v", f"=-{{EMAD}}*{col}{R['vol']}*{M['ene']}")
            put("agua_ins", f"=-{{AIMAD}}*{col}{R['vol']}")
            put("crec", f"=-{col}{R['rec']}*{{CREC}}")
            rec = f"{col}{R['rec']}"
            put("trib", "=-IF({REGIME}=1,MAX(0," + rec + "*INDEX(" + self._aliq() + ",MATCH(" + rec + ",[LIM],1))-INDEX("
                + self._ded() + ",MATCH(" + rec + ",[LIM],1)))*IF({ANEXO}=4,1-INDEX([ISS],MATCH(" + rec + ",[LIM],1)),1),"
                + rec + "*{ALIQF})")
            put("fixo", f"=-{{FIXO_OUT}}*{M['fix']}")
            put("ener_f", f"=-{{FIXO_EN}}*{M['ene']}*{M['fix']}")
            put("horas", f"=-{{HORAS}}*{M['hor']}*52*{{CHORA}}*{{CONTA}}")
            put("sin", "=-{PSIN}*{CSIN}")
            put("ebitda", f"=SUM({col}{R['rec']}:{col}{R['sin']})")
            put("mg", f"=IF({col}{R['rec']}=0,0,{col}{R['ebitda']}/{col}{R['rec']})")
            put("manut", 0 if j == 1 else f"=-{{CAPEX}}*{M['cap']}*{{MANUT}}")
            put("fcl", f"={col}{R['ebitda']}+{col}{R['manut']}")
            if j == 5:
                put("vr", f"=MAX({{LIQ}}*{M['cap']},MAX(0,{col}{R['fcl']})*{{ANUID}}*(1-[desagio]))+{{GIRO}}")
                put("fc", f"={col}{R['fcl']}+{col}{R['vr']}")
            else:
                put("fc", f"={col}{R['fcl']}")
            put("acum", f"={p}{R['acum']}+{col}{R['fcl']}")
            put("fcd", f"={col}{R['fcl']}*{col}{R['fd']}")
            put("acumd", f"={p}{R['acumd']}+{col}{R['fcd']}")
            for kk, base in (("pbs", "acum"), ("pbd", "acumd")):
                put(kk, f'=IF(AND({p}{R[base]}<0,{col}{R[base]}>=0),{col}{R["t"]}-1+(-{p}{R[base]})/({col}{R[base]}-{p}{R[base]}),"")')
            put("jur", f"=-{p}{R['div']}*{{FINR}}")
            put("amo", f"=-IF({col}{R['t']}<={{CAR}},0,MIN({p}{R['div']},$C${R['div']}/MAX(1,{{PRAZO}}-{{CAR}})))")
            put("div", f"=MAX(0,{p}{R['div']}+{col}{R['amo']})")
            if j == 5:
                put("fca", f"={col}{R['fc']}+{col}{R['jur']}+{col}{R['amo']}-{col}{R['div']}")
            else:
                put("fca", f"={col}{R['fc']}+{col}{R['jur']}+{col}{R['amo']}")
        # totais 1-5
        for k in ("rec", "ener_v", "agua_ins", "crec", "trib", "fixo", "ener_f", "horas", "sin", "ebitda", "manut", "fcl", "jur", "amo"):
            formula(ws.cell(R[k], CT), f"=SUM(D{R[k]}:H{R[k]})", "brl", k in bold, F_TOT)
        for k in ("fc", "fca"):
            formula(ws.cell(R[k], CT), f"=SUM(C{R[k]}:H{R[k]})", "brl", True, F_TOT)
        for k in ("fc", "fca"):
            for cc in range(1, 10):
                ws.cell(R[k], cc).border = Border(top=THIN)
        self.r = R["fca"] + 1
        return R

    # quadro de indicadores -------------------------------------------------------------------------
    def quadro_kpi(self):
        ws = self.ws
        tma, ipca, reinv = gref("tma"), gref("ipca"), gref("reinv")
        como_ler = {
            "inv": "Tudo o que sai no ano 0. O investidor não tem terreno: área sempre arrendada.",
            "cap_proprio": "Parte que sai do seu bolso se usar o % financiado da seção 6.",
            "vpl": "> 0: cria valor acima da TMA. Inclui o valor residual no ano 5.",
            "tir": "Compare com a TMA real (Premissas) e com o Tesouro IPCA+ (~7,7% real).",
            "tir_acion": "Igual à TIR do projeto quando não há financiamento.",
            "pb": "Anos até recuperar o investimento sem contar o valor residual. '> 5' = não recupera no horizonte.",
            "roi": "(Σ fluxos operacionais + valor residual − investimento) ÷ investimento.",
            "dep_vr": "Quanto do valor vem do fim do ano 5. Acima de ~40%, a decisão depende muito do 'depois'.",
            "ms": "Quanto a demanda pode cair até o VPL zerar (aproximação linear). Negativo = falta demanda.",
            "pe": "Nível de demanda (vs. a madura) em que o EBITDA zera.",
            "veredito": "AVANÇAR: VPL > 0 no Base e no Estresse · CAUTELA: só no Base · ALAVANCAS: TIR entre Tesouro e TMA.",
        }
        for k, lab, un, fmt in KPIS:
            r = KPI[k]
            ws.cell(r, 1, lab).font = font(bold=k in ("vpl", "tir", "veredito"))
            ws.cell(r, 2, un).font = font(GRAY, italic=True)
            if k in como_ler:
                nota(ws, r, como_ler[k])
        for s, col in SCOL.items():
            R = self.blocos[s]
            M = {k: f"${SCEN_COL[s]}${row}" for k, row in self.mrow.items()}

            def put(k, f, fmt):
                x = ws.cell(KPI[k], col)
                formula(x, self.res(f), fmt, s == "B" and k in ("vpl", "tir"), F_OUT if s == "B" else None)
                x.alignment = Alignment(horizontal="right")
            fc = f"$C${R['fc']}:$H${R['fc']}"
            put("inv", f"=-$C${R['inv']}", "brl")
            put("cap_proprio", f"=-$C${R['fca']}", "brl")
            put("rec5", f"=$H${R['rec']}", "brl")
            put("mg5", f"=$H${R['mg']}", "pct")
            put("vpl", f"=$C${R['fc']}+NPV({tma},$D${R['fc']}:$H${R['fc']})", "brl")
            put("tir", f'=IFERROR(IRR({fc}),IFERROR(IRR({fc},-0.3),IFERROR(IRR({fc},-0.6),IFERROR(IRR({fc},-0.85),"n/d"))))', "pct")
            tir = f"{L(col)}{KPI['tir']}"
            put("tir_nom", f'=IF(ISNUMBER({tir}),(1+{tir})*(1+{ipca})-1,"n/d")', "pct")
            put("tirm", f'=IFERROR(MIRR({fc},{tma},{reinv}),"n/d")', "pct")
            fca = f"$C${R['fca']}:$H${R['fca']}"
            put("tir_acion", f'=IF({{FIN}}=0,{tir},IFERROR(IRR({fca}),IFERROR(IRR({fca},-0.3),IFERROR(IRR({fca},-0.6),IFERROR(IRR({fca},-0.85),"n/d")))))', "pct")
            put("pb", f'=IF(COUNT($D${R["pbs"]}:$H${R["pbs"]})=0,"> 5",MIN($D${R["pbs"]}:$H${R["pbs"]}))', "anos")
            put("pbd", f'=IF(COUNT($D${R["pbd"]}:$H${R["pbd"]})=0,"> 5",MIN($D${R["pbd"]}:$H${R["pbd"]}))', "anos")
            inv = f"(-$C${R['inv']})"
            put("roi", f"=(SUM($D${R['fcl']}:$H${R['fcl']})+$H${R['vr']}-{inv})/{inv}", "pct")
            put("moic", f"=(SUM($D${R['fcl']}:$H${R['fcl']})+$H${R['vr']})/{inv}", "mult")
            put("expo", f"=-MIN(0,MIN($C${R['acum']}:$H${R['acum']}))", "brl")
            pvr = f"($H${R['vr']}*$H${R['fd']})"
            put("dep_vr", f"={pvr}/({pvr}+SUMPRODUCT(($D${R['fcl']}:$H${R['fcl']}>0)*$D${R['fcl']}:$H${R['fcl']}*$D${R['fd']}:$H${R['fd']}))", "pct")
            put("horas", f"={{HORAS}}*{M['hor']}", "num")
            if s == "B":
                H = self.blocos["H"]
                v1 = f"$D${KPI['vpl']}"
                vh = f"($C${H['fc']}+NPV({tma},$D${H['fc']}:$H${H['fc']}))"
                put("ms", f'=IF(ABS({v1}-{vh})<0.01,"n/d",0.2*{v1}/({v1}-{vh}))', "pct")
                put("pe", '=IF(({RMAD}*(1-{CREC}-{TRIBMAT})-{EMAD}-{AIMAD})<=0,"n/d",'
                          '({FIXO_OUT}+{FIXO_EN}+{HORAS}*52*{CHORA}*{CONTA}+{PSIN}*{CSIN})/({RMAD}*(1-{CREC}-{TRIBMAT})-{EMAD}-{AIMAD}))', "pct")
                vb, ve, tb = f"$D${KPI['vpl']}", f"$F${KPI['vpl']}", f"$D${KPI['tir']}"
                put("veredito", f'=IF({vb}>0,IF({ve}>0,"AVANÇAR","AVANÇAR COM CAUTELA"),IF(AND(ISNUMBER({tb}),{tb}>={gref("tesouro")}),'
                                f'"SÓ COM ALAVANCAS","DESCARTAR"))', "gen")
                ws.cell(KPI["veredito"], col).font = font(bold=True)
                ws.cell(KPI["veredito"], col).alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                ws.row_dimensions[KPI["veredito"]].height = 27
            else:
                for k in ("ms", "pe", "veredito"):
                    x = ws.cell(KPI[k], col, "—")
                    x.font = font(GRAY)
                    x.alignment = Alignment(horizontal="right")

    # checks -------------------------------------------------------------------------------------
    def sec_checks(self):
        self.cab("13. CHECKS DESTA ABA")
        ws = self.ws
        B = self.blocos["B"]
        checks = [
            ("Sem erro de fórmula no quadro de indicadores", f'=IF(SUMPRODUCT(--ISERROR($C${KPI_ROW0}:$F${KPI["veredito"]}))=0,"OK","ERRO")'),
            ("EBITDA do Base = receita − custos (integridade)",
             f'=IF(ABS($I${B["ebitda"]}-SUM($I${B["rec"]}:$I${B["sin"]}))<1,"OK","ERRO")'),
            ("Investimento dentro da faixa de capital (sem financiamento)",
             f'=IF(AND({{INV}}>={gref("cap_min")},{{INV}}<={gref("cap_max")}),"OK","ALERTA")'),
            ("Capital próprio cabe no máximo disponível", f'=IF($D${KPI["cap_proprio"]}<={gref("cap_max")},"OK","ALERTA")'),
            ("Rampa de maturação entre 0% e 120%", f'=IF(AND(MIN(D{self.rampa_row}:H{self.rampa_row})>=0,MAX(D{self.rampa_row}:H{self.rampa_row})<=1.2),"OK","ALERTA")'),
            ("Financiamento quitado ou liquidado no ano 5", f'=IF($H${B["div"]}>=0,"OK","ERRO")'),
        ]
        self.check_rows = []
        for lab, f in checks:
            r = self.r
            ws.cell(r, 1, lab).font = font()
            x = ws.cell(r, 3)
            formula(x, self.res(f), "gen", True)
            self.check_rows.append(r)
            self.r += 1
        self.check_range = f"$C${self.check_rows[0]}:$C${self.check_rows[-1]}"


def build(wb, caso):
    a = Aba(wb, caso).build()
    # validações de entrada
    ws = a.ws
    dv = DataValidation(type="whole", operator="between", formula1="1", formula2="4", showErrorMessage=True,
                        error="Anexo: 1 = I, 2 = II, 3 = III, 4 = III locação sem ISS.")
    ws.add_data_validation(dv)
    dv.add(a.ref["ANEXO"].replace("$", ""))
    dv2 = DataValidation(type="whole", operator="between", formula1="1", formula2="2", showErrorMessage=True)
    ws.add_data_validation(dv2)
    dv2.add(a.ref["REGIME"].replace("$", ""))
    dv3 = DataValidation(type="decimal", operator="between", formula1="0", formula2="0.9", showErrorMessage=True, error="De 0% a 90%.")
    ws.add_data_validation(dv3)
    dv3.add(a.ref["FINL"].replace("$", ""))
    return a
