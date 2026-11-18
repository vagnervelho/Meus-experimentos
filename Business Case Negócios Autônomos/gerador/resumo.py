# -*- coding: utf-8 -*-
"""Gera RESULTADOS.md com o ranking dos 34 negócios (mesma lógica da planilha, via referencia.py)."""
import os
import numpy as np
import referencia as R
from casos import CASOS

AQUI = os.path.dirname(os.path.abspath(__file__))


def pct(x):
    return "n/d" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x * 100:.1f}%".replace(".", ",")


def mil(x):
    return f"{x / 1000:,.0f}".replace(",", ".")


def anos(x):
    return "> 5" if np.isnan(x) else f"{x:.1f}".replace(".", ",")


def main():
    g = R.globais_padrao()
    g0 = dict(g, conta_horas=0)
    gf = dict(g, fin_global=0.5)
    linhas = []
    for c in CASOS:
        o = R.calcular(c, g)
        b = o["B"]
        linhas.append(dict(c=c, b=b, p=o["P"], ot=o["O"], e=o["E"], bolso=R.calcular(c, g0)["B"]["tir"],
                           fin=R.calcular(c, gf)["B"]["tir_acion"]))
    linhas.sort(key=lambda x: -(x["b"]["tir"] if not np.isnan(x["b"]["tir"]) else -9))
    out = ["# Resultados da planilha — 34 negócios autônomos em Porto Velho", "",
           "Cenário Base, TMA real de 15%, tempo humano a R$ 30/h, R$ constantes de 2026. Valores idênticos aos da planilha "
           "(verificados célula a célula no LibreOffice contra `referencia.py`). Regenerar com `python3 gerador/resumo.py`.", "",
           "| # | Negócio | Investimento (R$ mil) | Horas/sem | TIR real Base | TIR Pessimista | TIR Otimista | TIR Estresse global | "
           "VPL Base (R$ mil) | Payback (anos) | ROI 5 anos | Margem de segurança | TIR sem custo de horas | TIR acionista c/ 50% FNO | Veredito |",
           "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
    for i, x in enumerate(linhas, 1):
        c, b = x["c"], x["b"]
        out.append(f"| {i} | {c['cod']} {c['nome']} | {mil(b['inv'])} | {b['horas']:.0f} | {pct(b['tir'])} | {pct(x['p']['tir'])} | "
                   f"{pct(x['ot']['tir'])} | {pct(x['e']['tir'])} | {mil(b['vpl'])} | {anos(b['pb'])} | {pct(b['roi'])} | {pct(b['ms'])} | "
                   f"{pct(x['bolso'])} | {pct(x['fin'])} | {b['veredito']} |")
    out += ["", "Notas:",
            "- *TIR sem custo de horas* = visão 'do bolso' (Premissas: contar horas = 0). A diferença mostra quanto do retorno é, na verdade, o seu salário.",
            "- *TIR acionista c/ 50% FNO* = 50% do investimento financiado a 10% a.a. nominal, 8 anos, 2 de carência (Premissas).",
            "- *Margem de segurança* = queda de demanda que zera o VPL (negativo = falta demanda para pagar a TMA).",
            "- Veredito: AVANÇAR = VPL > 0 no Base e no Estresse global; AVANÇAR COM CAUTELA = só no Base; SÓ COM ALAVANCAS = TIR entre "
            "o Tesouro IPCA+ (7,7%) e a TMA; DESCARTAR = abaixo do Tesouro."]
    open(os.path.join(AQUI, "..", "RESULTADOS.md"), "w", encoding="utf-8").write("\n".join(out) + "\n")
    print("\n".join(out[:42]))


if __name__ == "__main__":
    main()
