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


def retorno_x_autonomia(base, mc, veredito, rotulos, arq, tma):
    fig, ax = plt.subplots(figsize=(10, 6.2), dpi=200)
    fig.patch.set_facecolor(SURF)
    _base(ax)
    for k in base.index:
        x = base.loc[k, "horas_semana"]
        y = mc.loc[k, "tir_p50"] * 100
        lo, hi = mc.loc[k, "tir_p10"] * 100, mc.loc[k, "tir_p90"] * 100
        cor = VERED[veredito[k]]
        ax.plot([x, x], [lo, hi], color=cor, lw=2, alpha=0.45, solid_capstyle="round", zorder=2)
        s = 30 + base.loc[k, "inv0"] / 2500
        ax.scatter([x], [y], s=s, color=cor, edgecolor=SURF, linewidth=2, zorder=3)
        ax.annotate(rotulos[k], (x, y), xytext=(8, 4), textcoords="offset points", fontsize=8.5, color=INK)
    ax.axhline(tma * 100, color=INK2, lw=1, ls=(0, (4, 3)))
    ax.text(ax.get_xlim()[1], tma * 100 + 0.8, f"TMA real {tma:.0%}", ha="right", va="bottom", fontsize=8.5, color=INK2)
    ax.axhline(7.7, color=GRID, lw=1)
    ax.text(ax.get_xlim()[1], 7.7 - 0.8, "Tesouro IPCA+ ~7,7% real", ha="right", va="top", fontsize=8.5, color=INK2)
    ax.set_xlabel("Horas humanas por semana (reposição, limpeza, manutenção, atendimento)", color=INK2, fontsize=9.5)
    ax.set_ylabel("TIR real em 5 anos — mediana do Monte Carlo (%)", color=INK2, fontsize=9.5)
    ax.set_title("Retorno × autonomia: ponto = mediana; barra = P10–P90; área = investimento",
                 loc="left", fontsize=11, color=INK, pad=12)
    hand = [Line2D([0], [0], marker="o", color="w", markerfacecolor=c, markersize=9, label=v) for v, c in VERED.items()]
    ax.legend(handles=hand, frameon=False, fontsize=9, loc="upper right", labelcolor=INK)
    fig.tight_layout()
    fig.savefig(arq, facecolor=SURF)
    plt.close(fig)


def faixa_vpl(mc, veredito, rotulos, arq):
    ordem = mc.sort_values("vpl_p50").index
    fig, ax = plt.subplots(figsize=(10, 0.48 * len(ordem) + 1.4), dpi=200)
    fig.patch.set_facecolor(SURF)
    _base(ax)
    for i, k in enumerate(ordem):
        cor = VERED[veredito[k]]
        p10, p50, p90 = (mc.loc[k, c] / 1000 for c in ("vpl_p10", "vpl_p50", "vpl_p90"))
        ax.plot([p10, p90], [i, i], color=cor, lw=6, alpha=0.35, solid_capstyle="round")
        ax.scatter([p50], [i], s=60, color=cor, edgecolor=SURF, linewidth=2, zorder=3)
        ax.text(max(p90, p50) + 15, i, f"P(VPL<0) = {mc.loc[k, 'p_vpl_neg']:.0%}", va="center", fontsize=8.5, color=INK2)
    ax.axvline(0, color=INK2, lw=1)
    ax.set_yticks(range(len(ordem)))
    ax.set_yticklabels([rotulos[k] for k in ordem], fontsize=9, color=INK)
    ax.set_xlabel("VPL na TMA real (R$ mil) — barra = P10 a P90, ponto = mediana", color=INK2, fontsize=9.5)
    ax.set_title("Monte Carlo: quanto valor cada ideia cria (ou destrói) nos 5 anos", loc="left", fontsize=11, color=INK, pad=12)
    hand = [Line2D([0], [0], marker="o", color="w", markerfacecolor=c, markersize=9, label=v) for v, c in VERED.items()]
    ax.legend(handles=hand, frameon=False, fontsize=9, loc="lower right", labelcolor=INK)
    fig.tight_layout()
    fig.savefig(arq, facecolor=SURF)
    plt.close(fig)
