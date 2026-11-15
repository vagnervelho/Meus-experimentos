# -*- coding: utf-8 -*-
"""Gráficos no padrão executivo do repositório: sem título interno (a mensagem fica numa célula
acima, calculada por fórmula), sem borda, sem linhas de grade, fundo branco, poucas cores com papel fixo.
Paleta validada para daltonismo: principal #24528F, contraste #C8641E, apoio #1C9AA0 / #8A63B8,
contexto #A6A6A6, negativo #C0392B."""
from openpyxl.chart import LineChart, BarChart, Reference, Series
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText
from openpyxl.drawing.line import LineProperties
from openpyxl.drawing.text import Paragraph, ParagraphProperties, CharacterProperties, Font as DFont

NAVY, ORANGE, TEAL, VIOLET, GREY, RED, GOLD = "24528F", "C8641E", "1C9AA0", "8A63B8", "A6A6A6", "C0392B", "B8860B"
MUTED = "595959"
K = '#,##0,;-#,##0,;"0"'          # milhares
MI = '#,##0.0,,;-#,##0.0,,;"0"'   # milhões


def txt(size=9, color=MUTED, bold=False):
    cp = CharacterProperties(sz=size * 100, b=bold, solidFill=color, latin=DFont(typeface="Arial"))
    return RichText(p=[Paragraph(pPr=ParagraphProperties(defRPr=cp), endParaRPr=cp)])


def base(ch, yfmt=K, legend=True, w=16.5, h=7.6):
    ch.title = None
    ch.style = None
    ch.roundedCorners = False
    ch.width, ch.height = w, h
    ch.graphical_properties = GraphicalProperties(solidFill="FFFFFF", ln=LineProperties(noFill=True))
    ch.plot_area.spPr = GraphicalProperties(solidFill="FFFFFF", ln=LineProperties(noFill=True))
    for ax in (ch.x_axis, ch.y_axis):
        ax.delete = False
        ax.title = None
        ax.txPr = txt()
        ax.majorTickMark = "none"
        ax.minorTickMark = "none"
    ch.x_axis.tickLblPos = "low"
    ch.x_axis.spPr = GraphicalProperties(ln=LineProperties(solidFill="BFBFBF", w=9525))
    ch.x_axis.majorGridlines = None
    ch.y_axis.spPr = GraphicalProperties(ln=LineProperties(noFill=True))
    ch.y_axis.majorGridlines = None
    ch.y_axis.number_format = yfmt
    if legend:
        ch.legend.position = "t"
        ch.legend.txPr = txt()
        ch.legend.overlay = False
    else:
        ch.legend = None
    return ch


def lines(ws, cat_col, r1, r2, series, yfmt=MI, w=16.5, h=7.6, skip=5):
    """series = [(coluna, título, cor, largura_pt, tracejado)]"""
    ch = LineChart()
    base(ch, yfmt, w=w, h=h)
    for col, ttl, color, wd, dash in series:
        s = Series(Reference(ws, min_col=col, min_row=r1, max_row=r2), title=ttl)
        s.smooth = False
        s.marker.symbol = "none"
        s.graphicalProperties.line.solidFill = color
        s.graphicalProperties.line.width = int(wd * 12700)
        if dash:
            s.graphicalProperties.line.dashStyle = dash
        ch.series.append(s)
    ch.set_categories(Reference(ws, min_col=cat_col, min_row=r1, max_row=r2))
    ch.x_axis.tickLblSkip = skip
    ch.x_axis.tickMarkSkip = skip
    return ch


def stacked(ws, cat_col, r1, r2, series, yfmt=K, w=16.5, h=7.6, skip=3):
    ch = BarChart()
    ch.type = "col"
    ch.grouping = "stacked"
    ch.overlap = 100
    base(ch, yfmt, w=w, h=h)
    ch.gapWidth = 40
    for col, ttl, color in series:
        s = Series(Reference(ws, min_col=col, min_row=r1, max_row=r2), title=ttl)
        s.graphicalProperties.solidFill = color
        s.graphicalProperties.line.solidFill = "FFFFFF"
        s.graphicalProperties.line.width = 6350
        s.invertIfNegative = False
        ch.series.append(s)
    ch.set_categories(Reference(ws, min_col=cat_col, min_row=r1, max_row=r2))
    ch.x_axis.tickLblSkip = skip
    return ch


def bars(ws, cat_col, r1, r2, series, yfmt=K, w=16.5, h=7.6, skip=3):
    ch = BarChart()
    ch.type = "col"
    ch.grouping = "clustered"
    base(ch, yfmt, w=w, h=h)
    ch.gapWidth = 40
    for col, ttl, color in series:
        s = Series(Reference(ws, min_col=col, min_row=r1, max_row=r2), title=ttl)
        s.graphicalProperties.solidFill = color
        s.invertIfNegative = False
        ch.series.append(s)
    ch.set_categories(Reference(ws, min_col=cat_col, min_row=r1, max_row=r2))
    ch.x_axis.tickLblSkip = skip
    return ch


def tornado(ws, s1, s2):
    ch = BarChart()
    ch.type = "bar"
    ch.grouping = "clustered"
    ch.overlap = 100
    base(ch, K, w=18, h=12)
    ch.gapWidth = 35
    for col, ttl, color in ((2, "Teste baixo", ORANGE), (3, "Teste alto", NAVY)):
        s = Series(Reference(ws, min_col=col, min_row=s1, max_row=s2), title=ttl)
        s.graphicalProperties.solidFill = color
        s.graphicalProperties.line.noFill = True
        s.invertIfNegative = False
        ch.series.append(s)
    ch.set_categories(Reference(ws, min_col=1, min_row=s1, max_row=s2))
    ch.x_axis.tickLblPos = "low"
    ch.y_axis.number_format = K
    return ch
