# -*- coding: utf-8 -*-
"""Verificação automática: recalcula a planilha no LibreOffice e compara cada indicador com a
implementação de referência em Python (referencia.py). Também procura erros de fórmula em todas as abas.

Uso: python3 verificar.py <planilha_recalculada_pelo_libreoffice.xlsx> [modulo_de_casos]
"""
import sys
import importlib
import numpy as np
from openpyxl import load_workbook
from aba_caso import KPI, SCOL
from referencia import calcular

ERROS = ("#REF!", "#VALUE!", "#NAME?", "#DIV/0!", "#NUM!", "#N/A", "Err:", "#NULL!")


def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    return np.nan


def main(arq, mod="casos"):
    casos = importlib.import_module(mod).CASOS
    wb = load_workbook(arq, data_only=True)
    n_err = 0
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.startswith(ERROS):
                    if n_err < 15:
                        print(f"ERRO {ws.title}!{c.coordinate}: {c.value}")
                    n_err += 1
    print(f"células com erro: {n_err}")
    pior = 0.0
    n_cmp = 0
    falhas = []
    for caso in casos:
        ws = wb[caso["aba"]]
        ref = calcular(caso)
        for s, col in SCOL.items():
            for k in ("inv", "cap_proprio", "rec5", "mg5", "vpl", "tir", "tir_nom", "tirm", "tir_acion", "pb", "pbd", "roi",
                      "moic", "expo", "dep_vr", "horas"):
                xv = ws.cell(KPI[k], col).value
                rv = ref[s][k]
                xn, rn = num(xv), float(rv) if rv is not None else np.nan
                if np.isnan(rn) and (xv in ("n/d", "> 5") or np.isnan(xn)):
                    continue
                if np.isnan(xn) or np.isnan(rn):
                    falhas.append((caso["aba"], s, k, xv, rv))
                    continue
                d = abs(xn - rn) / max(1.0, abs(rn))
                pior = max(pior, d)
                n_cmp += 1
                if d > 1e-6:
                    falhas.append((caso["aba"], s, k, xv, rv))
        for k in ("ms", "pe"):
            xv, rv = ws.cell(KPI[k], SCOL["B"]).value, ref["B"][k]
            if isinstance(xv, (int, float)) and not np.isnan(rv):
                d = abs(xv - rv) / max(1.0, abs(rv))
                pior = max(pior, d)
                n_cmp += 1
                if d > 1e-6:
                    falhas.append((caso["aba"], "B", k, xv, rv))
            elif not (xv == "n/d" and np.isnan(rv)):
                falhas.append((caso["aba"], "B", k, xv, rv))
        xv = ws.cell(KPI["veredito"], SCOL["B"]).value
        if xv != ref["B"]["veredito"]:
            falhas.append((caso["aba"], "B", "veredito", xv, ref["B"]["veredito"]))
        n_cmp += 1
    print(f"comparações: {n_cmp} | maior diferença relativa: {pior:.2e} | falhas: {len(falhas)}")
    for f in falhas[:30]:
        print("  FALHA", f)
    return n_err == 0 and not falhas



def verificar_extras(arq, mod="casos"):
    """Confere a Tabela de Dados da aba Sensibilidade e o ranking ordenado do Painel."""
    import referencia as R
    casos = importlib.import_module(mod).CASOS
    wb = load_workbook(arq, data_only=True)
    ws = wb["Sensibilidade"]
    # localizar a tabela: célula com o código escolhido e o canto
    sel = None
    for row in ws.iter_rows(min_row=1, max_row=60):
        for c in row:
            if c.value == "Negócio (código)":
                sel = ws.cell(c.row, 3).value
                r_sel = c.row
    corner = r_sel + 4
    caso = next(c for c in casos if c["cod"] == sel)
    pior, n = 0.0, 0
    for i in range(7):
        d = ws.cell(corner + 1 + i, 2).value
        for j in range(6):
            p = ws.cell(corner, 3 + j).value
            g = R.globais_padrao()
            g["s_dem"], g["s_pre"] = d, p
            ref = R.calcular(caso, g)["E"]["vpl"]
            xv = ws.cell(corner + 1 + i, 3 + j).value
            pior = max(pior, abs(xv - ref) / max(1.0, abs(ref)))
            n += 1
    print(f"Tabela de Dados ({sel}): {n} células, maior diferença relativa {pior:.2e}")
    # ranking ordenado
    p = wb["Painel"]
    tirs = []
    for r in range(9, 9 + len(casos)):
        v = p.cell(r, 10).value
        tirs.append((v if isinstance(v, (int, float)) else -9, p.cell(r, 2).value))
    esperado = [nm for _v, nm in sorted(tirs, key=lambda x: -x[0])]
    r0 = None
    for row in p.iter_rows(min_row=9 + len(casos), max_row=9 + len(casos) + 6):
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("RANKING"):
                r0 = c.row
    obtido = [p.cell(r0 + 2 + k, 2).value for k in range(len(casos))]
    print("Ranking ordenado confere:", obtido == esperado)
    return pior < 1e-6 and obtido == esperado


if __name__ == "__main__":
    arq, mod = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "casos")
    ok1 = main(arq, mod)
    ok2 = verificar_extras(arq, mod)
    print("RESULTADO:", "OK" if (ok1 and ok2) else "PROBLEMAS")
