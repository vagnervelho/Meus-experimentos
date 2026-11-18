# -*- coding: utf-8 -*-
"""Gráficos da triagem (PNG estático): retorno x autonomia e faixa do Monte Carlo."""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

SURF, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
SLOT = ["#2a78d6", "#eb6834", "#1baf7a"]          # categorias 1-3 (validadas all-pairs)
VERED = {"Modelar": SLOT[0], "Modelar com ressalvas": SLOT[1], "Descartar": SLOT[2]}


def _base(ax):
    ax.set_facecolor(SURF)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.tick_params(colors=INK2, labelsize=9)
    ax.grid(False)


def retorno_x_autonomia(base, mc, veredito, rotulos, arq, tma, piso=-35.0):
    fig, ax = plt.subplots(figsize=(10.5, 6.6), dpi=200)
    fig.patch.set_facecolor(SURF)
    _base(ax)
    ax.set_ylim(piso - 3, 42)
    ax.set_xlim(-1, 30)
    for k in base.index:
        if k not in veredito:
            continue
        x = base.loc[k, "horas_semana"] + rotulos.get("_dx", {}).get(k, 0.0)   # deslocamento visual p/ horas iguais
        y = base.loc[k, "tir_real"] * 100
        lo, hi = mc.loc[k, "neutro_tir_p10"] * 100, mc.loc[k, "neutro_tir_p90"] * 100
        cor = VERED[veredito[k]]
        cortado = y < piso
        yp = max(y, piso)
        ax.plot([x, x], [max(lo, piso), max(hi, piso)], color=cor, lw=2.2, alpha=0.40, solid_capstyle="round", zorder=2)
        s = 30 + base.loc[k, "inv0"] / 2500
        ax.scatter([x], [yp], s=s, color=cor, edgecolor=SURF, linewidth=2, zorder=3, marker="v" if cortado else "o")
        txt = rotulos[k] + (f" ({y:.0f}%)" if cortado else "")
        dx, dy, ha = rotulos.get("_off", {}).get(k, (8, 4, "left"))
        ax.annotate(txt, (x, yp), xytext=(dx, dy), textcoords="offset points", fontsize=8.5, color=INK, ha=ha)
    ax.axhline(tma * 100, color=INK2, lw=1, ls=(0, (4, 3)), zorder=1)
    ax.text(29.6, tma * 100 + 0.8, f"TMA real {tma:.0%}", ha="right", va="bottom", fontsize=8.5, color=INK2)
    ax.axhline(7.7, color=GRID, lw=1.2, zorder=1)
    ax.text(29.6, 7.7 - 0.8, "Tesouro IPCA+ ≈ 7,7% real", ha="right", va="top", fontsize=8.5, color=INK2)
    ax.axhline(0, color=GRID, lw=0.8, zorder=1)
    ax.set_xlabel("Horas humanas por semana (reposição, limpeza, manutenção, atendimento)", color=INK2, fontsize=9.5)
    ax.set_ylabel("TIR real em 5 anos, com valor residual (%)", color=INK2, fontsize=9.5)
    ax.set_title("Retorno × autonomia em Porto Velho", loc="left", fontsize=12, color=INK, pad=22, fontweight="bold")
    ax.text(0, 1.015, "Ponto = caso-base · barra = P10–P90 do Monte Carlo neutro · tamanho = investimento · "
            "ideias com as mesmas horas foram afastadas na horizontal para leitura", transform=ax.transAxes,
            fontsize=8.5, color=INK2)
    hand = [Line2D([0], [0], marker="o", color="w", markerfacecolor=c, markersize=9, label=v) for v, c in VERED.items()]
    ax.legend(handles=hand, frameon=False, fontsize=9, loc="upper right", labelcolor=INK)
    fig.tight_layout()
    fig.savefig(arq, facecolor=SURF)
    plt.close(fig)


def faixa_vpl(mc, veredito, rotulos, arq):
    ordem = [k for k in mc.sort_values("neutro_vpl_p50").index if k in veredito]
    fig, ax = plt.subplots(figsize=(11, 0.5 * len(ordem) + 1.6), dpi=200)
    fig.patch.set_facecolor(SURF)
    _base(ax)
    for i, k in enumerate(ordem):
        cor = VERED[veredito[k]]
        p10, p50, p90 = (mc.loc[k, c] / 1000 for c in ("neutro_vpl_p10", "neutro_vpl_p50", "neutro_vpl_p90"))
        ax.plot([p10, p90], [i, i], color=cor, lw=6, alpha=0.35, solid_capstyle="round")
        ax.scatter([p50], [i], s=60, color=cor, edgecolor=SURF, linewidth=2, zorder=3)
        ax.text(1.02, i, f"{mc.loc[k, 'neutro_p_vpl_neg']:.0%}", transform=ax.get_yaxis_transform(),
                va="center", ha="right", fontsize=8.5, color=INK)
        ax.text(1.12, i, f"{mc.loc[k, 'p_vpl_neg']:.0%}", transform=ax.get_yaxis_transform(),
                va="center", ha="right", fontsize=8.5, color=INK)
    top = len(ordem) - 0.35
    ax.text(1.02, top, "P(VPL<0)\nneutro", transform=ax.get_yaxis_transform(), va="bottom", ha="right", fontsize=8, color=INK2)
    ax.text(1.12, top, "P(VPL<0)\nestresse", transform=ax.get_yaxis_transform(), va="bottom", ha="right", fontsize=8, color=INK2)
    ax.axvline(0, color=INK2, lw=1)
    ax.set_ylim(-0.7, len(ordem) - 0.3)
    ax.set_yticks(range(len(ordem)))
    ax.set_yticklabels([rotulos[k] for k in ordem], fontsize=9, color=INK)
    ax.set_xlabel("VPL na TMA real de 15% (R$ mil) — barra = P10 a P90; ponto = mediana do Monte Carlo neutro", color=INK2, fontsize=9.5)
    ax.set_title("Monte Carlo: quanto valor cada ideia cria (ou destrói) em 5 anos", loc="left", fontsize=12, color=INK,
                 pad=14, fontweight="bold")
    hand = [Line2D([0], [0], marker="o", color="w", markerfacecolor=c, markersize=9, label=v) for v, c in VERED.items()]
    ax.legend(handles=hand, frameon=False, fontsize=9, loc="upper left", labelcolor=INK)
    fig.subplots_adjust(left=0.2, right=0.84, top=0.92, bottom=0.1)
    fig.savefig(arq, facecolor=SURF)
    plt.close(fig)
