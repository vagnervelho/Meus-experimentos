# -*- coding: utf-8 -*-
"""Estilo dos graficos (padrao de apresentacao executiva).

Regras: sem titulo dentro do grafico (a mensagem fica numa celula acima, calculada por formula),
sem borda, grade horizontal discreta, eixos em R$ mil, poucas cores com papel fixo.
Paleta categorica validada para daltonismo (separacao e contraste):
  cria/serie principal  #24528F   recria/desfavoravel  #C8641E
  engorda               #1C9AA0   lavoura              #8A63B8
  contexto/nao rateado  #A6A6A6   negativo             #C0392B
"""
from openpyxl.chart import LineChart, BarChart, Reference, Series
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.layout import Layout, ManualLayout
from openpyxl.drawing.line import LineProperties
from openpyxl.drawing.text import Paragraph, ParagraphProperties, CharacterProperties, Font as DFont

NAVY, ORANGE, TEAL, VIOLET, GREY, RED = "24528F", "C8641E", "1C9AA0", "8A63B8", "A6A6A6", "C0392B"
INK, MUTED, GRID = "262626", "595959", "E4E4E4"
K = '#,##0,;(#,##0,);"-"'          # milhares
W, H = 16.2, 7.4                   # cm


def txt(size=9, color=MUTED, bold=False):
    cp = CharacterProperties(sz=size * 100, b=bold, solidFill=color, latin=DFont(typeface="Arial"))
    return RichText(p=[Paragraph(pPr=ParagraphProperties(defRPr=cp), endParaRPr=cp)])


def base(ch, yfmt=K, legend=True, gap=None):
    ch.title = None
    ch.style = None
    ch.roundedCorners = False
    ch.width, ch.height = W, H
    ch.graphical_properties = GraphicalProperties(noFill=True, ln=LineProperties(noFill=True))
    ch.plot_area.spPr = GraphicalProperties(noFill=True, ln=LineProperties(noFill=True))
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
    ch.y_axis.majorGridlines.spPr = GraphicalProperties(ln=LineProperties(solidFill=GRID, w=6350))
    ch.y_axis.number_format = yfmt
    if legend:
        ch.legend.position = "t"
        ch.legend.txPr = txt()
        ch.legend.overlay = False
    else:
        ch.legend = None
    if gap is not None:
        ch.gapWidth = gap
    return ch


def line_series(ws, row, c1, c2, title, color, width_pt=2.0, dash=None):
    s = Series(Reference(ws, min_col=c1, max_col=c2, min_row=row), title=title)
    s.smooth = False
    s.marker.symbol = "none"
    s.graphicalProperties.line.solidFill = color
    s.graphicalProperties.line.width = int(width_pt * 12700)
    if dash:
        s.graphicalProperties.line.dashStyle = dash
    return s


def bar_series(ref, title, color, labels=False, title_from_data=False):
    s = Series(ref, title=title, title_from_data=title_from_data)
    s.graphicalProperties.solidFill = color
    s.graphicalProperties.line.solidFill = "FFFFFF"      # filete branco separa segmentos empilhados
    s.graphicalProperties.line.width = 9525
    s.invertIfNegative = False
    if labels:
        s.dLbls = DataLabelList()
        s.dLbls.showVal = True
        s.dLbls.showSerName = s.dLbls.showCatName = s.dLbls.showLegendKey = s.dLbls.showPercent = False
        s.dLbls.numFmt = '#,##0,;(#,##0,);""'
        s.dLbls.txPr = txt(8, "FFFFFF", True)
        s.dLbls.position = "inEnd"
    return s


def monthly_axis(ch):
    ch.x_axis.tickLblSkip = 12
    ch.x_axis.tickMarkSkip = 12
    ch.x_axis.number_format = "0"
