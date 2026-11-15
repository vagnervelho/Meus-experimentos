# -*- coding: utf-8 -*-
"""Verificação automática: recalcula a planilha no LibreOffice em vários cenários e compara com a réplica.

Uso:  LO_VERIFY=1 python3 build.py /tmp/sim_verif.xlsx && python3 verificar.py /tmp/sim_verif.xlsx
Cada cenário é imposto pelas células TESTE da aba Cenarios (valida também a cadeia de alavancas).
"""
import os
import subprocess
import sys
import tempfile
from openpyxl import load_workbook
import cenarios as CN
import premissas as PR
import replica

CN.layout()
SRC = sys.argv[1]
TMP = tempfile.mkdtemp()

CASES = [
    ("Base", {}, {}),
    ("Campinas", {"cidade": "Campinas"}, {"cidade": 2}),
    ("Sem imóvel", {"imovel_valor": 0}, {"imovel_valor": 0}),
    ("Casa 1,5 mi + Price", {"imovel_valor": 1500000, "sistema": "Price"}, {"imovel_valor": 1500000, "sistema": 2}),
    ("Cônjuge 0% + 2 filhos", {"conj_pct": 0, "n_filhos": 2}, {"conj_pct": 0.0, "n_filhos": 2}),
    ("Gastos −20% + INSS + consumir", {"gasto_var": -0.2, "inss_modo": "Estimativa do modelo", "criterio": "Consumir até a idade-limite"},
     {"gasto_var": -0.2, "inss_modo": 2, "criterio": 2}),
    ("Lucro Presumido + Simples s/ corr.", {"regime": "Lucro Presumido"}, {"regime": 2}),
    ("Simples sem correção + fat +20%", {"simples_corr": "Não", "fat_var": 0.2}, {"simples_corr": 2, "fat_var": 0.2}),
    ("Amortizar 50% + atraso 36m + CDI 12%", {"amort_extra": 0.5, "compra_atraso": 36, "cdi_lp": 0.12},
     {"amort_extra": 0.5, "compra_atraso": 36, "cdi_lp": 0.12}),
    ("Campinas 3 filhos escola pública", {"cidade": "Campinas", "n_filhos": 3, "escola": "Pública", "anos_estab": 5},
     {"cidade": 2, "n_filhos": 3, "escola": 2, "anos_estab": 5}),
    ("Alíquota manual + idade 60 + meta 25k", {"regime": "Alíquota manual", "idade_apos": 60, "meta": 25000},
     {"regime": 3, "idade_apos": 60, "meta": 25000}),
    ("Licença 12m + 0 consultas + casamento 300k", {"licenca": 12, "mkt_consultas": 0, "cas_valor": 300000, "filho_var": 0.25},
     {"licenca": 12, "mkt_consultas": 0, "cas_valor": 300000, "filho_var": 0.25}),
]

KEYS = [("p65_real", 14), ("k_star", 40), ("renda_total", 46), ("pct_meta", 47), ("aporte", 51)]


def lo_calc(path):
    out = os.path.join(TMP, "out")
    subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", out, path],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
    return os.path.join(out, os.path.basename(path))


def main():
    from saidas import OUT, layout_apos
    layout_apos()
    addr = {k: OUT[k].split("!")[1].replace("$", "") for k in ("p65_real", "k_star", "renda_total", "pct_meta", "aporte", "min_saldo")}
    worst = 0.0
    for name, tests, ov in CASES:
        wb = load_workbook(SRC)
        ws = wb["Cenarios"]
        for k, val in tests.items():
            ws[f"T{CN.LROW[k]}"] = val
        p = os.path.join(TMP, "caso.xlsx")
        wb.save(p)
        res = load_workbook(lo_calc(p), data_only=True)
        ap = res["Aposentadoria"]
        rp = replica.simulate(ov)
        line = []
        for k in ("p65_real", "k_star", "renda_total", "pct_meta", "aporte", "min_saldo"):
            a = ap[addr[k]].value
            b = rp[k]
            err = abs(a - b) / max(1.0, abs(b))
            worst = max(worst, err)
            line.append(f"{k}={a:,.2f} (réplica {b:,.2f})" if err > 1e-6 else f"{k} ok")
        # série mensal do patrimônio
        fx = res["Fluxo_Mensal"]
        from fw import COLS
        import motores  # noqa
        col = None
        for c in range(1, fx.max_column + 1):
            if fx.cell(5, c).value == "PATRIMÔNIO FINANCEIRO (fim do mês)":
                col = c
        maxd = 0.0
        for i, row in enumerate(rp["rows"]):
            a = fx.cell(8 + i, col).value
            maxd = max(maxd, abs(a - row["P"]) / max(1000.0, abs(row["P"])))
        worst = max(worst, maxd)
        errs = sum(1 for wsx in res.worksheets for r in wsx.iter_rows() for c in r
                   if isinstance(c.value, str) and (c.value.startswith("#") or c.value.startswith("Err:")))
        print(f"[{name}] erros de fórmula={errs} | dif. máx. patrimônio mensal={maxd:.2e} | " + "; ".join(line))
    print(f"\nMAIOR DIFERENÇA RELATIVA: {worst:.2e}")


if __name__ == "__main__" and len(sys.argv) == 2:
    main()


def verify_tables(excel_file, verify_file):
    """Emula as Tabelas de Dados do Excel: para células amostradas, lê ref/r1/r2 gravados no arquivo do Excel,
    impõe o(s) valor(es) do cabeçalho na(s) célula(s) de entrada de uma cópia sem tabelas e recalcula no LibreOffice."""
    from openpyxl.worksheet.formula import DataTableFormula
    from openpyxl.utils import range_boundaries
    wx = load_workbook(excel_file)["Cenarios"]
    tables = []
    for row in wx.iter_rows():
        for c in row:
            if isinstance(c.value, DataTableFormula):
                d = c.value
                tables.append((range_boundaries(d.ref), str(d.r1), str(d.r2) if d.r2 else None, str(d.dt2D) in ("1", "True")))
    print(f"Tabelas de Dados encontradas: {len(tables)}")
    inv = {f"T{r}": k for k, r in CN.LROW.items()}
    samples = []
    for (c1, r1, c2, r2), i1, i2, two in tables:
        if two:
            picks = [(r1, c1), (r2, c2)]
        else:
            picks = [(r1, c1), ((r1 + r2) // 2, c1), (r2, c1)]
        samples += [((c1, r1, c2, r2), i1, i2, two, pr) for pr in picks]
    for (c1, r1, c2, r2), i1, i2, two, (rr, cc) in samples:
        wb = load_workbook(verify_file)
        ws = wb["Cenarios"]
        if two:
            rowval = wx.cell(r1 - 1, cc).value      # valor da linha de cabeçalho -> célula de entrada de LINHA (r1)
            colval = wx.cell(rr, c1 - 1).value      # valor da coluna de cabeçalho -> célula de entrada de COLUNA (r2)
            ws[i1] = rowval
            ws[i2] = colval
            formula = wx.cell(r1 - 1, c1 - 1).value
            desc = f"{inv.get(i1, i1)}={rowval}, {inv.get(i2, i2)}={colval}"
        else:
            val = wx.cell(rr, c1 - 1).value
            ws[i1] = val
            formula = wx.cell(r1 - 1, cc).value
            desc = f"{inv.get(i1, i1)}={val}"
        p = os.path.join(TMP, "tab.xlsx")
        wb.save(p)
        res = load_workbook(lo_calc(p), data_only=True)
        sh, a = formula[1:].split("!")
        got = res[sh][a.replace("$", "")].value
        print(f"  tabela {wx.cell(r1, c1).coordinate}: {desc:55s} -> {formula[1:]:24s} = {got}")


if __name__ == "__main__" and len(sys.argv) > 2:
    verify_tables(sys.argv[2], SRC)
