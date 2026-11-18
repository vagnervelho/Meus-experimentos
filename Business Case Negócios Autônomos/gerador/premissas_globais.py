# -*- coding: utf-8 -*-
"""Abas Premissas (entradas globais + tabelas do Simples) e Sensibilidade (choques globais + Tabela de Dados)."""
from estilo import *
from openpyxl.worksheet.datavalidation import DataValidation

G = {}          # chave -> referência absoluta (ex.: Premissas!$C$6)
FAIXAS = [      # (limite inferior, Anexo I aliq, ded, Anexo II aliq, ded, Anexo III aliq, ded, fatia do ISS no Anexo III)
    (0.00, .040, 0, .045, 0, .060, 0, .335),
    (180000.01, .073, 5940, .078, 5940, .112, 9360, .320),
    (360000.01, .095, 13860, .100, 13860, .135, 17640, .325),
    (720000.01, .107, 22500, .112, 22500, .160, 35640, .325),
    (1800000.01, .143, 87300, .147, 85500, .210, 125640, .335),
    (3600000.01, .190, 378000, .300, 720000, .330, 648000, .000),
]

# (chave, rótulo, unidade, valor, formato, chave-destaque, nota)
GLOBAIS = [
    ("sec", "RETORNO EXIGIDO E MACRO (tudo em termos reais: R$ constantes de 2026)"),
    ("tma", "TMA real (taxa mínima de atratividade)", "% a.a.", 0.15, "pct", True,
     "Tesouro IPCA+ 2032 = IPCA + 7,68% em 11/11/2026, mais ~7 p.p. de prêmio por negócio pequeno, ilíquido e operado pelo dono. ≈ 20% nominal."),
    ("tesouro", "Retorno real sem risco (Tesouro IPCA+)", "% a.a.", 0.077, "pct", False,
     "Referência para o veredito: abaixo disso, o negócio rende menos que o título público."),
    ("ipca", "Inflação esperada (IPCA) — só para traduzir taxas", "% a.a.", 0.045, "pct", False,
     "IPCA 12 meses = 4,63% (out/2026); Focus: 5,0% em 2027 e 4,0% em 2028–29. Só converte taxas reais em nominais."),
    ("reinv", "Taxa de reinvestimento real (TIRM)", "% a.a.", 0.08, "pct", False,
     "≈ CDI real médio esperado: Selic 13,75% (Copom 04/11/2026) caindo para ~10,5% em 2029 (Focus 16/11/2026), IPCA ~4,5%."),
    ("desagio", "Deságio de liquidez no valor de continuidade (ano 5)", "%", 0.30, "pct", False,
     "Negócio pequeno vende com desconto. Aplicado ao valor presente dos fluxos após o ano 5."),
    ("sec", "TEMPO HUMANO E CAPITAL DO INVESTIDOR"),
    ("custo_hora", "Custo da hora humana", "R$/h", 30.0, "brl2", True,
     "Operador terceirizado com encargos ou custo de oportunidade do dono. 'Autônomo' não significa tempo grátis."),
    ("conta_horas", "Contar as horas humanas como custo? (1 = sim; 0 = não)", "1/0", 1, "idx", False,
     "Com 0, o modelo mostra a visão 'do bolso' (como se o seu tempo valesse zero)."),
    ("cap_min", "Capital disponível — mínimo", "R$", 250000, "brl", False, "Faixa informada pelo investidor."),
    ("cap_max", "Capital disponível — máximo", "R$", 600000, "brl", True, "Acima disso, o caso exige financiamento."),
    ("sec", "TARIFAS E PREÇOS LOCAIS (Porto Velho)"),
    ("tarifa_kwh", "Energia elétrica — baixa tensão comercial, com impostos", "R$/kWh", 1.00, "brl2", True,
     "Energisa RO: TE+TUSD ~R$ 0,75 após a redução de ago/2026, ICMS 19,5%, PIS/Cofins ~5%, bandeira verde. Reajuste anual em 13/12 (EST +6%). VALIDAR na conta."),
    ("agua_m3", "Água — tarifa comercial CAERD", "R$/m³", 10.0, "brl2", False, "EST R$ 7–14 (sem rede de esgoto na maior parte da cidade). VALIDAR na conta."),
    ("aluguel_loja", "Aluguel de loja/ponto comercial em avenida", "R$/m²/mês", 25.0, "brl2", False, "29 anúncios (nov/2026): mediana de lojas R$ 19/m², avenidas R$ 25 (15–40)."),
    ("aluguel_sala", "Aluguel de sala comercial", "R$/m²/mês", 28.0, "brl2", False, "Anúncios: mediana R$ 25/m² (sala de 80 m² no Olaria por R$ 2 mil)."),
    ("aluguel_galpao", "Aluguel de galpão", "R$/m²/mês", 12.0, "brl2", False, "9 anúncios: mediana R$ 11,7/m² (7–15)."),
    ("aluguel_terreno", "Arrendamento de terreno urbano (sem construção)", "R$/m²/mês", 2.5, "brl2", False,
     "Anúncios: R$ 1,6–3/m² (1.080 m² na Estrada da Penal por R$ 1.700). O investidor não tem terreno: todo caso que usa área paga arrendamento."),
    ("dias", "Dias de operação por ano", "dias", 360, "int", False, "Negócios 24h/7 dias, descontando paradas."),
    ("sec", "FINANCIAMENTO (condições padrão para todas as abas)"),
    ("fin_global", "% do investimento financiado em TODAS as abas (0 = usa o % de cada aba)", "%", 0.0, "pct", False,
     "Atalho para comparar 'e se eu financiar X% de tudo'. Deixe 0 para respeitar o valor de cada aba."),
    ("fin_taxa", "Taxa nominal do financiamento", "% a.a.", 0.10, "pct", True,
     "FNO (Banco da Amazônia) para micro e pequena empresa: TFC ≈ IPCA + ~4,6% ≈ 9,5–10,3% a.a. (EST). Pronampe: Selic + 6% ≈ 19,75%. VALIDAR com o banco."),
    ("fin_prazo", "Prazo total (incluindo carência)", "anos", 8, "int", False, "FNO costuma ir até 12 anos; Pronampe até 6. Inteiro de 1 a 12."),
    ("fin_carencia", "Carência de principal", "anos", 2, "int", False, "Durante a carência, paga só juros. FNO até ~4 anos; Pronampe até 1."),
]


def build_premissas(wb):
    ws = wb.create_sheet("Premissas")
    faixa_titulo(ws, "PREMISSAS GLOBAIS — valem para todas as abas de negócio",
                 "Fonte azul em fundo amarelo = entrada editável. Amarelo forte = premissa-chave. Altere aqui e todas as abas recalculam.", 11)
    for c, w in zip("ABCDEFGHIJK", (62, 12, 14, 2, 14, 14, 14, 14, 14, 14, 14)):
        ws.column_dimensions[c].width = w
    ws.column_dimensions["L"].width = 90
    r = 4
    for item in GLOBAIS:
        if item[0] == "sec":
            r += 1
            secao(ws, r, item[1], 12)
            r += 1
            continue
        k, lab, un, v, fmt, key, nt = item
        ws.cell(r, 1, lab).font = font()
        ws.cell(r, 2, un).font = font(GRAY, italic=True)
        entrada(ws.cell(r, 3), v, fmt, key)
        nota(ws, r, nt, col=12)
        G[k] = f"Premissas!$C${r}"
        r += 1
    # taxa real do financiamento (derivada)
    ws.cell(r, 1, "Taxa real do financiamento (derivada)").font = font()
    ws.cell(r, 2, "% a.a.").font = font(GRAY, italic=True)
    formula(ws.cell(r, 3), f"=(1+{G['fin_taxa'].split('!')[1]})/(1+{G['ipca'].split('!')[1]})-1", "pct")
    nota(ws, r, "O modelo trata a dívida em termos reais (como se fosse corrigida pela inflação), amortização constante (SAC).", col=12)
    G["fin_real"] = f"Premissas!$C${r}"
    r += 2
    # Simples Nacional
    secao(ws, r, "SIMPLES NACIONAL — tabelas da LC 123/2006 (redação da LC 155/2016)", 12)
    r += 1
    heads = ["Faixa (receita bruta anual a partir de)", "", "De (R$)", "", "Anexo I alíq.", "Anexo I dedução",
             "Anexo II alíq.", "Anexo II dedução", "Anexo III alíq.", "Anexo III dedução", "Fatia do ISS (III)"]
    for c, h in enumerate(heads, 1):
        x = ws.cell(r, c, h)
        x.font = font(bold=True)
        x.fill = F_TIME
        x.alignment = Alignment(horizontal="center", wrap_text=True)
    ws.row_dimensions[r].height = 30
    r += 1
    r0 = r
    for i, f in enumerate(FAIXAS):
        lim, a1, d1, a2, d2, a3, d3, iss = f
        ws.cell(r, 1, f"Faixa {i + 1}").font = font()
        entrada(ws.cell(r, 3), lim, "brl2")
        for c, v, fm in ((5, a1, "pct2"), (6, d1, "brl"), (7, a2, "pct2"), (8, d2, "brl"), (9, a3, "pct2"),
                         (10, d3, "brl"), (11, iss, "pct")):
            entrada(ws.cell(r, c), v, fm)
        r += 1
    r1 = r - 1
    # matrizes para INDEX: colunas do anexo 1..4 (4 = Anexo III locação de bens móveis: mesma tabela do III, sem o ISS)
    G["LIM"] = f"Premissas!$C${r0}:$C${r1}"
    G["ISS"] = f"Premissas!$K${r0}:$K${r1}"
    G["A1"], G["D1"] = f"Premissas!$E${r0}:$E${r1}", f"Premissas!$F${r0}:$F${r1}"
    G["A2"], G["D2"] = f"Premissas!$G${r0}:$G${r1}", f"Premissas!$H${r0}:$H${r1}"
    G["A3"], G["D3"] = f"Premissas!$I${r0}:$I${r1}", f"Premissas!$J${r0}:$J${r1}"
    nota(ws, r, "Alíquota efetiva = (receita anual × alíquota nominal − parcela a deduzir) ÷ receita anual. Anexo 4 do modelo = Anexo III "
                "sem a parcela do ISS (locação de bens móveis, LC 123 art. 18 §5º-A). Receita anual usada como aproximação da RBT12.", col=1)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=12)
    ws.cell(r, 1).alignment = Alignment(wrap_text=True)
    ws.row_dimensions[r].height = 30
    ws.freeze_panes = "A4"
    # validações
    dv = DataValidation(type="whole", operator="between", formula1="0", formula2="1", showErrorMessage=True)
    ws.add_data_validation(dv)
    dv.add(G["conta_horas"].split("!")[1].replace("$", ""))
    dv2 = DataValidation(type="whole", operator="between", formula1="1", formula2="12", showErrorMessage=True)
    ws.add_data_validation(dv2)
    dv2.add(G["fin_prazo"].split("!")[1].replace("$", ""))
    dv3 = DataValidation(type="decimal", operator="between", formula1="0", formula2="0.9", showErrorMessage=True,
                         error="Use de 0% a 90%.")
    ws.add_data_validation(dv3)
    dv3.add(G["fin_global"].split("!")[1].replace("$", ""))
    return ws


CHOQUES = [  # (chave, rótulo, unidade, valor, formato, nota)
    ("s_dem", "Demanda (× do caso-base)", "×", 0.80, "mult", "1,00 = sem choque. 0,80 = demanda 20% menor em todos os negócios."),
    ("s_pre", "Preço (× do caso-base)", "×", 0.95, "mult", "Guerra de preço / concorrência."),
    ("s_cap", "Investimento (× do caso-base)", "×", 1.15, "mult", "Estouro de orçamento de obra e equipamentos."),
    ("s_fix", "Custos fixos (× do caso-base)", "×", 1.10, "mult", "Aluguel, manutenção, serviços."),
    ("s_ene", "Energia (× da tarifa)", "×", 1.15, "mult", "Reajuste real da Energisa / bandeiras."),
    ("s_atr", "Atraso da maturação (anos somados ao caso-base)", "anos", 0.5, "num", "0,5 = a curva de maturação anda 6 meses mais devagar."),
    ("s_hor", "Horas humanas (× do caso-base)", "×", 1.0, "mult", "Operação real costuma exigir mais horas que o planejado."),
]


def build_sensibilidade_inputs(wb):
    ws = wb.create_sheet("Sensibilidade")
    faixa_titulo(ws, "SENSIBILIDADE — choques globais aplicados a TODOS os negócios ao mesmo tempo",
                 "Os choques abaixo alimentam a coluna 'Estresse global' de cada aba e do Painel. Padrão = estresse combinado da triagem.", 12)
    for c, w in zip("ABCDEFGHIJKL", (52, 10, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12)):
        ws.column_dimensions[c].width = w
    secao(ws, 4, "CHOQUES GLOBAIS (entradas)", 12)
    r = 5
    for k, lab, un, v, fmt, nt in CHOQUES:
        ws.cell(r, 1, lab).font = font()
        ws.cell(r, 2, un).font = font(GRAY, italic=True)
        entrada(ws.cell(r, 3), v, fmt, True)
        x = ws.cell(r, 5, nt)
        x.font = font(GRAY, italic=True, size=9)
        G[k] = f"Sensibilidade!$C${r}"
        r += 1
    ws.freeze_panes = "A4"
    return ws, r
