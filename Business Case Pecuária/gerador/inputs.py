# -*- coding: utf-8 -*-
"""Abas de entrada: Cenarios, Sensibilidade (alavancas) e Premissas."""
from framework import *
import os

DEFAULT_SCEN = 3

SCEN_NAMES = [
    "1. Cria (venda de bezerros)",
    "2. Recria a pasto (compra bezerro, vende boi magro)",
    "3. Recria + engorda a pasto (compra bezerro, vende boi gordo)",
    "4. Engorda em semiconfinamento (compra boi magro)",
    "5. Confinamento com ração comprada (compra boi magro)",
    "6. Confinamento + lavoura própria (soja, milho safrinha, silagem)",
    "7. Ciclo completo a pasto (cria + recria + engorda)",
    "8. Misto: cria + recria/engorda em semiconfinamento + milho próprio",
    "9. Personalizado (exemplo: recria a pasto ampliada com crédito rural)",
]
SCEN_SHORT = ["1 Cria", "2 Recria", "3 Recria+eng.", "4 Semiconf.", "5 Confin.", "6 Conf.+lav.", "7 Ciclo compl.", "8 Misto", "9 Personal."]
# (nome, rotulo, unidade, formato, valores dos 9 cenarios, nota)
LEVERS = [
    ("matr_ini", "Matrizes compradas no início", "cab", "int", [20, 0, 0, 0, 0, 0, 14, 6, 0],
     "Vacas de cria adquiridas no mês de compra definido em Premissas. Zero desliga a unidade de CRIA."),
    ("bez_ano", "Bezerros desmamados comprados por ano", "cab/ano", "int", [0, 20, 15, 0, 0, 0, 0, 6, 40],
     "Compra externa de bezerros para a RECRIA (distribuída pelo perfil mensal em Premissas)."),
    ("bm_ano", "Bois magros comprados por ano", "cab/ano", "int", [0, 0, 0, 22, 18, 14, 0, 0, 0],
     "Compra externa de boi magro para a ENGORDA, metade em cada um dos dois meses abaixo."),
    ("mes_bm1", "Mês da 1ª compra de boi magro", "1-12", "idx", [5, 5, 5, 4, 5, 5, 5, 5, 5],
     "Confinamento: maio (1º giro da seca). Pasto/semi: início da transição."),
    ("mes_bm2", "Mês da 2ª compra de boi magro", "1-12", "idx", [9, 9, 9, 10, 9, 9, 9, 9, 9],
     "Confinamento: setembro (2º giro, após a saída do 1º). Use o mesmo mês da 1ª compra para concentrar tudo em um lote."),
    ("recria_on", "Unidade RECRIA ativa (1 = sim, 0 = não)", "flag", "idx", [0, 1, 1, 0, 0, 0, 1, 1, 1],
     "Se 0, bezerros machos desmamados são vendidos e não há compra de bezerros."),
    ("eng_on", "Unidade ENGORDA ativa (1 = sim, 0 = não)", "flag", "idx", [0, 0, 1, 1, 1, 1, 1, 1, 0],
     "Se 0, a recria vende boi magro; se 1, o boi magro é transferido para a engorda."),
    ("mix_pasto", "% da engorda terminada a pasto", "%", "pct", [1, 1, 1, 0, 0, 0, 1, 0, 1],
     "As três linhas de mix devem somar 100% (ver Checks)."),
    ("mix_semi", "% da engorda em semiconfinamento", "%", "pct", [0, 0, 0, 1, 0, 0, 0, 1, 0], ""),
    ("mix_conf", "% da engorda em confinamento", "%", "pct", [0, 0, 0, 0, 1, 1, 0, 0, 0], ""),
    ("cap_conf", "Capacidade estática do confinamento", "cab", "int", [0, 0, 0, 0, 9, 7, 0, 0, 0],
     "Dimensiona o investimento em estrutura de confinamento e alimenta o teste de capacidade."),
    ("area_milho", "Área de milho grão (safrinha)", "ha", "num", [0, 0, 0, 0, 0, 8, 0, 5, 0],
     "Milho 2ª safra: pode suceder soja/silagem na mesma área."),
    ("area_sil", "Área de milho para silagem (verão)", "ha", "num", [0, 0, 0, 0, 0, 2, 0, 0, 0], ""),
    ("area_soja", "Área de soja (verão)", "ha", "num", [0, 0, 0, 0, 0, 8, 0, 0, 0],
     "A soja é vendida em grão; o farelo usado na ração é sempre comprado."),
    ("area_terc", "Pasto ocioso arrendado a terceiros", "ha", "num", [75, 75, 72, 78, 90, 72, 70, 70, 50],
     "Com capital limitado sobra pasto: alugar a terceiros gera renda (valor em Premissas > Terra) e reduz a manutenção por conta própria."),
    ("regime_terra", "Regime da terra (1 própria já detida, 2 arrendada, 3 a adquirir)", "1-3", "idx",
     [1, 1, 1, 1, 1, 1, 1, 1, 1],
     "1: sem desembolso, só arrendamento imputado gerencial. 2: paga arrendamento. 3: compra no mês 1."),
    ("func", "Funcionários fixos contratados", "nº", "num", [0, 0, 0, 0, 0, 0, 0, 0, 0],
     "0 = mão de obra familiar (pai e filho). PREMISSA-CHAVE: a R$ 200 mil a escala não paga um salário fixo."),
    ("cred_inv", "Crédito rural de investimento contratado no mês 1", "R$", "brl",
     [0, 0, 0, 0, 0, 0, 0, 0, 200000], "Condições (taxa, carência, prazo) em Premissas > Financiamento."),
    ("cred_cust", "Crédito de custeio contratado no mês 1", "R$", "brl", [0, 0, 0, 0, 0, 0, 0, 0, 0],
     "Parcela única ao fim da carência (ver Premissas)."),
]
SCEN_ROW0 = 10
SEL = "$C$4"

# (nome, rotulo, baixa, alta)
SHOCKS = [
    ("f_arroba", "Preço da arroba (boi e vaca)", -0.10, 0.10),
    ("f_repos", "Preço de reposição (bezerro, boi magro, matriz, touro)", -0.10, 0.10),
    ("f_racao", "Preços de grãos e ração (milho, soja, farelo, suplementos)", -0.15, 0.15),
    ("f_gmd", "Ganho médio diário (todas as fases)", -0.10, 0.10),
    ("f_natal", "Taxa de natalidade", -0.10, 0.10),
    ("f_mort", "Mortalidade (todas as categorias)", 0.50, -0.50),
    ("f_fixos", "Custos fixos", 0.15, -0.15),
    ("f_capex", "Investimentos (capex)", 0.20, -0.20),
]
SH_ROW0 = 9


def build_cenarios(wb):
    ws = wb.create_sheet("Cenarios")
    SHEETS["C"] = "Cenarios"
    ws.sheet_view.showGridLines = False
    ws["A1"] = "CENÁRIOS — escolha da estratégia e comparação lado a lado"
    ws["A1"].font = font(WHITE, True, size=13)
    ws["A2"] = ("Digite em C4 o número do cenário (1 a 9). Todo o modelo recalcula. A tabela no fim desta aba é "
                "uma Tabela de Dados do Excel que roda os 9 cenários automaticamente.")
    ws["A2"].font = font(WHITE, italic=True)
    for rr in (1, 2):
        for c in range(1, 15):
            ws.cell(rr, c).fill = F_HEAD
    ws["A4"] = "CENÁRIO SELECIONADO (1 a 9)"
    ws["A4"].font = font(bold=True, size=11)
    ws["C4"] = int(os.environ.get("SCEN", DEFAULT_SCEN))
    ws["C4"].font = font(BLUE, True, size=12)
    ws["C4"].fill = F_KEY
    ws["C4"].alignment = Alignment(horizontal="center")
    ws["A5"] = "Nome do cenário ativo"
    ws["C5"] = f"=INDEX($D$8:$L$8,1,{SEL})"
    ws["C5"].font = font(bold=True)
    PREM["scen_sel"] = ("Cenarios", 4, 3)
    PREM["scen_nome"] = ("Cenarios", 5, 3)
    ws["A7"] = "Alavancas por cenário"
    ws["A7"].font = font(bold=True, size=11)
    for c in range(1, 15):
        ws.cell(7, c).fill = F_SEC
    ws["C7"] = "ATIVO"
    ws["C7"].font = font(bold=True)
    ws["C7"].alignment = Alignment(horizontal="center")
    for i in range(9):
        x = ws.cell(7, 4 + i, i + 1)
        x.font = font(bold=True)
        x.alignment = Alignment(horizontal="center")
        y = ws.cell(8, 4 + i, SCEN_NAMES[i])
        y.font = font(BLUE, True, size=9)
        y.fill = F_IN
        y.alignment = Alignment(wrap_text=True, vertical="top")
    ws["A8"] = "Nome do cenário"
    ws["A9"] = "Nome curto (rótulo dos gráficos)"
    for i, nm in enumerate(SCEN_SHORT):
        z = ws.cell(9, 4 + i, nm)
        z.font = font(BLUE, size=9)
        z.fill = F_IN
        z.alignment = Alignment(horizontal="center")
    ws["M7"] = "Notas"
    ws["M7"].font = font(bold=True)
    ws.row_dimensions[8].height = 66
    for j, (name, lab, unit, fmt, vals, note) in enumerate(LEVERS):
        r = SCEN_ROW0 + j
        ws.cell(r, 1, lab).font = font()
        ws.cell(r, 2, unit).font = font(GRAY, italic=True)
        a = ws.cell(r, 3, f"=INDEX($D{r}:$L{r},1,{SEL})")
        a.font = font(bold=True)
        a.fill = F_OUT
        a.number_format = FMT[fmt]
        PREM[name] = ("Cenarios", r, 3)
        for i, v in enumerate(vals):
            x = ws.cell(r, 4 + i, v)
            x.font = font(BLUE)
            x.fill = F_IN
            x.number_format = FMT[fmt]
            x.border = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
        ws.cell(r, 13, note).font = font(GRAY, italic=True, size=9)
    ws.column_dimensions["A"].width = 60
    ws.column_dimensions["B"].width = 9
    ws.column_dimensions["C"].width = 14
    for c in range(4, 13):
        ws.column_dimensions[L(c)].width = 17
    ws.column_dimensions["M"].width = 95
    ws.freeze_panes = "D10"
    return ws


def build_sens_inputs(wb):
    ws = wb.create_sheet("Sensibilidade")
    SHEETS["S"] = "Sensibilidade"
    ws.sheet_view.showGridLines = False
    ws["A1"] = "SENSIBILIDADE — choques nas variáveis-chave, tornado e tabelas cruzadas"
    ws["A1"].font = font(WHITE, True, size=13)
    ws["A2"] = ("Coluna B: choque manual (fica aplicado em todo o modelo). As tabelas abaixo são Tabelas de Dados "
                "do Excel e sempre partem do cenário ativo em Cenarios!C4.")
    ws["A2"].font = font(WHITE, italic=True)
    for rr in (1, 2):
        for c in range(1, 12):
            ws.cell(rr, c).fill = F_HEAD
    ws["A4"] = "Caso do tornado em execução (deixe 0 — é a célula que a Tabela de Dados varia)"
    ws["C4"] = int(os.environ.get("CASO", 0))
    ws["C4"].font = font(BLUE, True)
    ws["C4"].fill = F_IN
    PREM["caso"] = ("Sensibilidade", 4, 3)
    for c in range(1, 12):
        ws.cell(7, c).fill = F_SEC
    for c, t in enumerate(["Variável", "Choque manual", "Δ teste A", "Δ teste B", "Fator efetivo"], 1):
        ws.cell(7, c, t).font = font(bold=True)
    ws.cell(8, 1, "Ordem: teste A é o lado desfavorável, teste B o favorável.").font = font(GRAY, italic=True, size=9)
    for i, (name, lab, lo, hi) in enumerate(SHOCKS):
        r = SH_ROW0 + i
        ws.cell(r, 1, lab).font = font()
        man = [float(v) for v in os.environ["SHOCKS"].split(",")][i] if os.environ.get("SHOCKS") else 0.0
        for c, v in ((2, man), (3, lo), (4, hi)):
            x = ws.cell(r, c, v)
            x.font = font(BLUE)
            x.fill = F_IN
            x.number_format = '+0.0%;-0.0%;0.0%'
            x.border = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
        e = ws.cell(r, 5, f"=(1+B{r})*(1+IF($C$4={2*i+1},C{r},IF($C$4={2*i+2},D{r},0)))")
        e.number_format = FMT["fac"]
        e.font = font(bold=True)
        e.fill = F_OUT
        PREM[name] = ("Sensibilidade", r, 5)
    ws.column_dimensions["A"].width = 60
    for c in range(2, 12):
        ws.column_dimensions[L(c)].width = 16
    return ws


MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
ANOS = [f"Ano {i}" for i in range(1, 11)]
CATS = ["Matrizes", "Novilhas de reposição", "Touros", "Bezerros ao pé", "Recria", "Engorda a pasto",
        "Engorda semiconfinamento", "Confinamento"]
INGS = ["Pasto", "Silagem de milho", "Milho grão", "Farelo de soja", "Núcleo conf./semi", "Sal mineral",
        "Proteinado (só na seca)"]
ING_CODES = ["pasto", "sil", "mil", "far", "nuc", "sal", "prot"]
# % do peso vivo por dia, em materia seca
DIET = [
    [0.0200, 0, 0, 0, 0, 0.00018, 0.0005],
    [0.0220, 0, 0, 0, 0, 0.00020, 0.0010],
    [0.0180, 0, 0, 0, 0, 0.00012, 0],
    [0.0080, 0, 0, 0, 0, 0, 0],
    [0.0220, 0, 0, 0, 0, 0.00020, 0.0010],
    [0.0210, 0, 0, 0, 0, 0.00020, 0.0015],
    [0.0130, 0, 0.0075, 0.0015, 0.0005, 0, 0],
    [0, 0.0060, 0.0145, 0.0018, 0.0007, 0, 0],
]
# (descricao, unidade/gatilho, qtd, valor unitario, mes, vida util anos, residual, formula do "ativo")
CAPEX = [
    ("Cercas: divisão de piquetes e reparos (R$/km)", 2.0, 8000, 1, 15, 0.0, "=IF([tem_gado]>0,1,0)",
     "Assume cerca de divisa existente. Referência RO: R$ 7-10 mil/km (5 fios, lascas). Validar."),
    ("Curral de manejo simples com tronco e balança", 1, 30000, 1, 20, 0.10, "=IF([tem_gado]>0,1,0)",
     "Estrutura mínima para manejo sanitário e pesagem."),
    ("Água: bebedouros, reservatório e rede", 1, 10000, 1, 15, 0.0, "=IF([tem_gado]>0,1,0)", ""),
    ("Cochos para sal e suplemento a pasto", 1, 3500, 1, 8, 0.0, "=IF([tem_gado]>0,1,0)", ""),
    ("Recuperação/reforma de pastagem (R$/ha)", "=[area_pasto]*[pct_reforma]", 1700, 1, 8, 0.0,
     "=IF([tem_gado]>0,1,0)", "Qtd = área de pasto × % a reformar. Calcário, adubo, sementes, operações."),
    ("Estrutura de confinamento (R$/cab de capacidade)", "=[cap_conf]", 450, 1, 15, 0.0,
     "=IF([eng_on]*[mix_conf]>0,1,0)", "Cochos, cercas, piso de cocho, bebedouro. Só se houver confinamento."),
    ("Silo trincheira / lonas", 1, 6000, 1, 10, 0.0, "=IF([eng_on]*[mix_conf]>0,1,0)", ""),
    ("Equipamentos de trato usados (carreta/misturador simples)", 1, 18000, 1, 10, 0.20,
     "=IF([eng_on]*[mix_conf]>0,1,0)", ""),
    ("Cochos de suplementação para semiconfinamento", 1, 5000, 1, 8, 0.0, "=IF([eng_on]*[mix_semi]>0,1,0)", ""),
    ("Ferramentas, arreios, animal de serviço ou moto", 1, 9000, 1, 8, 0.20, "=IF([tem_gado]>0,1,0)", ""),
    ("Trator usado 75 cv (opcional — padrão: serviços terceirizados)", 0, 110000, 1, 12, 0.30, 1,
     "Qtd 0 por padrão: operações de lavoura e pasto entram como serviço contratado no custo/ha."),
    ("Projetos, licenças, CAR, despesas pré-operacionais", 1, 3000, 1, 10, 0.0, 1, ""),
]
LABOR = [
    ("Vaqueiro / caseiro (CLT rural)", "=[func]", 2700, 0.40, "Qtd vem do cenário. Encargos incluem 13º, férias, FGTS, INSS."),
    ("Pró-labore dos sócios", 0, 3000, 0.11, "Padrão 0: sócios não retiram. Ative para medir o custo real do trabalho da família."),
    ("Diaristas e serviços eventuais (verba mensal)", 1, 600, 0.0, ""),
]
IR_TABLE = [(0, 0, 0), (26963.20, 0.075, 2022.24), (33919.80, 0.15, 4566.23), (45012.60, 0.225, 7942.17),
            (55976.16, 0.275, 10740.98)]


def build_premissas(wb):
    P = Prem(wb)
    ws = P.ws

    P.sec("1. GERAL")
    from datetime import date
    P.s("data_ini", "Data de início do projeto (1º dia do mês 1)", date(2027, 1, 1), "data",
        "Use sempre 1º de janeiro para que o ano do modelo coincida com o ano-calendário (IRPF).", "date")
    ws.cell(P.r - 1, 4).number_format = "dd/mm/yyyy"
    P.s("tx_desc", "Taxa de desconto real (a.a.)", 0.08, "% a.a.",
        "Modelo em moeda constante (sem inflação). Custo de oportunidade real do capital (referência: título público indexado à inflação + prêmio de risco). Definido pelo modelador.", "pct")
    P.s("capital", "Capital próprio aportado no mês 1", 200000, "R$", "Informado pelo usuário: cerca de R$ 200 mil.", "brl", "key")
    P.s("caixa_min", "Caixa mínimo operacional", 8000, "R$",
        "Se o caixa cair abaixo disso, o modelo registra 'aporte adicional dos sócios' (sinal de capital insuficiente).", "brl")
    P.s("dias", "Dias por mês (média)", 30.4, "dias", "365/12.", "num")
    P.s("lag_rec", "Prazo de recebimento das vendas", 1, "meses", "0 = à vista; 1 = 30 dias (padrão de frigorífico). Inteiro de 0 a 6.", "idx")
    P.s("lag_pag", "Prazo de pagamento de ração e insumos de alimentação", 0, "meses", "Inteiro de 0 a 6.", "idx")
    P.s("custo_liq", "Deságio/custo de venda na liquidação final do rebanho", 0.05, "%",
        "Aplicado ao valor do rebanho no valor terminal (mês 120).", "pct")
    P.s("tem_gado", "Há pecuária no cenário? (1 = sim)", "=IF([matr_ini]+[bez_ano]*[recria_on]+[bm_ano]*[eng_on]>0,1,0)", "flag",
        "Calculado a partir do cenário. Liga os investimentos básicos de pecuária.", "idx", "calc")

    P.sec("2. TERRA E CAPACIDADE")
    P.s("area_total", "Área total aberta da fazenda", 100, "ha",
        "Informado pelo usuário: ~100 ha. Considerada área aberta consolidada (fora de reserva legal e APP).", "num", "key")
    P.s("area_benf", "Área não produtiva (benfeitorias, estradas, aguadas)", 5, "ha", "Estimativa do modelador: 5%.", "num")
    P.s("area_util", "Área útil", "=[area_total]-[area_benf]", "ha", "", "num", "calc")
    P.s("a_milho", "Área de milho grão safrinha (do cenário)", "=[area_milho]", "ha", "", "num", "calc")
    P.s("a_sil", "Área de milho silagem (do cenário)", "=[area_sil]", "ha", "", "num", "calc")
    P.s("a_soja", "Área de soja (do cenário)", "=[area_soja]", "ha", "", "num", "calc")
    P.s("area_lav", "Área ocupada por lavoura", "=MAX([a_soja]+[a_sil],[a_milho])", "ha",
        "Milho safrinha sucede soja/silagem na mesma área; por isso é o MÁXIMO, não a soma.", "num", "calc")
    P.s("a_terc", "Pasto arrendado a terceiros (do cenário)", "=[area_terc]", "ha", "Gera receita de arrendamento; manutenção por conta do arrendatário.", "num", "calc")
    P.s("area_pasto", "Área de pastagem em uso próprio", "=[area_util]-[area_lav]-[a_terc]", "ha", "Resíduo: área útil menos lavoura menos pasto arrendado a terceiros.", "num", "calc")
    P.s("valor_ha", "Valor de mercado da terra", 20000, "R$/ha",
        "Pastagem formada em RO: faixa ampla (R$ 12-35 mil/ha conforme região). VALIDAR com corretor local.", "brl")
    P.s("valoriz", "Valorização real da terra (a.a.)", 0.02, "% a.a.", "Só afeta o valor terminal quando regime = 3 (terra adquirida).", "pct")
    P.s("arr_pasto", "Arrendamento de pasto", 600, "R$/ha/ano",
        "Referência: aluguel de pasto ~R$ 40-50/cab/mês com ~1,2 cab/ha. Usado como arrendamento pago (regime 2) e imputado.", "brl")
    P.s("arr_lav", "Arrendamento de área de lavoura", 1150, "R$/ha/ano", "Referência: ~10 sacas de soja/ha/ano.", "brl")
    P.head(MESES, "Perfis mensais (por mês-calendário)")
    P.v("seca", "Estação seca (1 = sim)", [0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0], "flag",
        "Rondônia: seca de junho a setembro. Liga o proteinado e marca a linha 7 das abas mensais.", "idx")
    P.v("prod_pasto", "Forragem aproveitável (consumível pelo gado)", [520, 520, 500, 450, 350, 220, 150, 120, 180, 350, 480, 520],
        "kg MS/ha/mês", "Braquiária sem adubação pesada: ~9 t MS/ha/ano produzidas × ~50% de eficiência de pastejo ≈ 4,4 t. Fonte: faixas Embrapa; calibrar no local.", "int")
    P.s("cap_forr", "Estoque máximo de forragem diferida (vedação de pasto)", 1500, "kg MS/ha", "Sobra das águas que pode ser carregada para a seca.", "int")
    P.s("perda_forr", "Perda mensal da forragem diferida", 0.15, "%/mês", "Senescência e acamamento.", "pct")
    P.s("kg_ua", "Peso de 1 UA (unidade animal)", 450, "kg", "Convenção.", "int")
    P.s("lot_max", "Lotação de referência para alerta", 1.6, "UA/ha", "Só gera alerta em Checks; o custo do excesso aparece como volumoso emergencial.", "num")

    P.sec("3. ZOOTECNIA — CRIA")
    P.s("mes_compra_matr", "Mês do modelo em que as matrizes são compradas", 1, "mês", "", "idx")
    P.s("pct_prenhes", "Taxa de parição das matrizes compradas (1º ano)", 0.65, "%", "Vacas compradas prenhes/paridas. Vale para os nascimentos dos 12 primeiros meses.", "pct")
    P.s("natal", "Taxa de natalidade (bezerros nascidos / matriz exposta)", 0.78, "%", "Faixa: 65% (extensivo) a 85% (IATF e boa nutrição). Sofre o choque de sensibilidade.", "pct")
    P.s("gest", "Defasagem concepção → parto", 9, "meses", "Gestação bovina ~285 dias. Não alterar.", "idx")
    P.head(MESES, "Distribuição dos partos")
    P.v("dist_partos", "Distribuição dos partos no ano", [0, 0, 0, 0, 0, 0, 0, 0.3, 0.4, 0.3, 0, 0], "% por mês",
        "Estação de monta nov-jan → partos ago-out. Deve somar 100%.", "pct")
    P.s("mort_bez", "Mortalidade do nascimento à desmama", 0.04, "%", "", "pct")
    P.s("idade_desm", "Idade à desmama", 8, "meses", "Inteiro ≥ 1.", "idx")
    P.s("pct_machos", "Proporção de machos ao nascer", 0.5, "%", "", "pct")
    P.s("pct_ret", "Fêmeas desmamadas retidas para reposição", 0.55, "%", "As demais são vendidas à desmama.", "pct")
    P.s("ret_eq", "   Retenção de equilíbrio (referência, rebanho estável)",
        "=([descarte_matr]+[mort_ad])/([natal]*(1-[mort_bez])*(1-[pct_machos])*(1-[mort_ad]*[meses_nov]/12))", "%",
        "Cálculo de apoio: retenção que repõe exatamente descarte + mortes.", "pct", "calc")
    P.s("meses_nov", "Meses da desmama até a novilha entrar como matriz", 16, "meses", "Desmama aos 8 + 16 = 1ª monta aos 24 meses. Inteiro ≥ 1.", "idx")
    P.s("mort_ad", "Mortalidade anual de adultos (matrizes, novilhas)", 0.015, "% a.a.", "", "pct")
    P.s("descarte_matr", "Descarte anual de matrizes", 0.18, "% a.a.", "Vacas vazias e velhas, vendidas para abate.", "pct")
    P.s("mes_descarte", "Mês-calendário do descarte", 6, "1-12", "Após diagnóstico de gestação e desmama.", "idx")
    P.s("rel_touro", "Vacas por touro", 25, "nº", "Monta natural. Modelo trabalha com cabeças fracionárias.", "int")
    P.s("desc_touro", "Descarte anual de touros", 0.20, "% a.a.", "Vida útil de ~5 anos.", "pct")
    P.s("peso_matr", "Peso médio da matriz", 450, "kg", "", "int")
    P.s("peso_nov", "Peso médio da novilha de reposição", 300, "kg", "", "int")
    P.s("peso_touro", "Peso médio do touro", 750, "kg", "", "int")
    P.s("peso_bez", "Peso médio do bezerro ao pé", 110, "kg", "", "int")
    P.s("peso_desm_m", "Peso do macho à desmama (= peso do bezerro comprado)", 200, "kg", "", "int")
    P.s("peso_desm_f", "Peso da fêmea à desmama", 185, "kg", "", "int")
    P.s("rend_vaca", "Rendimento de carcaça — vaca de descarte", 0.50, "%", "", "pct")
    P.s("rend_touro", "Rendimento de carcaça — touro de descarte", 0.52, "%", "", "pct")

    P.sec("4. ZOOTECNIA — RECRIA E ENGORDA")
    P.s("peso_bm", "Peso do boi magro (saída da recria / entrada da engorda)", 380, "kg", "", "int")
    P.s("peso_ab_p", "Peso de abate — engorda a pasto", 520, "kg", "", "int")
    P.s("peso_ab_s", "Peso de abate — semiconfinamento", 530, "kg", "", "int")
    P.s("peso_ab_c", "Peso de abate — confinamento", 550, "kg", "", "int")
    P.s("rend_p", "Rendimento de carcaça — pasto", 0.52, "%", "", "pct")
    P.s("rend_s", "Rendimento de carcaça — semiconfinamento", 0.535, "%", "", "pct")
    P.s("rend_c", "Rendimento de carcaça — confinamento", 0.555, "%", "", "pct")
    P.s("mort_rec", "Mortalidade na fase de recria", 0.015, "% da fase", "Lançada na entrada do lote (simplificação).", "pct")
    P.s("mort_p", "Mortalidade na engorda a pasto", 0.010, "% da fase", "", "pct")
    P.s("mort_s", "Mortalidade no semiconfinamento", 0.008, "% da fase", "", "pct")
    P.s("mort_c", "Mortalidade no confinamento", 0.005, "% da fase", "", "pct")
    P.head(MESES, "Ganho médio diário por mês-calendário (kg/cab/dia) — não usar valores negativos")
    P.v("gmd_rec", "GMD recria a pasto", [0.60, 0.60, 0.58, 0.52, 0.42, 0.30, 0.22, 0.20, 0.26, 0.45, 0.58, 0.60], "kg/dia",
        "Águas 0,55-0,65; seca 0,2-0,3 com proteinado. Média ≈ 0,44 kg/dia.", "num2")
    P.v("gmd_p", "GMD engorda a pasto", [0.65, 0.65, 0.62, 0.55, 0.45, 0.32, 0.25, 0.22, 0.28, 0.48, 0.62, 0.65], "kg/dia", "", "num2")
    P.v("gmd_s", "GMD semiconfinamento", [0.95, 0.95, 0.95, 0.90, 0.85, 0.80, 0.75, 0.75, 0.78, 0.88, 0.95, 0.95], "kg/dia",
        "Concentrado ~1% do PV sobre pasto.", "num2")
    P.v("gmd_c", "GMD confinamento", [1.50] * 12, "kg/dia", "Nelore inteiro, dieta 75-80% concentrado: 1,4-1,7.", "num2")

    P.sec("5. COMPRAS DE ANIMAIS")
    P.head(MESES, "Perfis de compra")
    P.v("perfil_bez", "Distribuição da compra anual de bezerros", [0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 0, 0, 0], "% por mês",
        "Maio-junho: pico de oferta de desmama. Deve somar 100%.", "pct")
    P.v("perfil_bm", "Distribuição da compra anual de boi magro", [f"=0.5*IF({L(4+i)}$%d={i+1},1,0)" for i in range(12)], "% por mês",
        "Calculado: 50% em cada mês de compra do cenário.", "pct", "calc")
    P.head(ANOS, "Fator de escala das compras por ano (1,0 = quantidade do cenário)")
    P.v("fator_compra", "Fator anual de compras (bezerros e boi magro)", [1.0] * 10, "fator",
        "Use para rampa de crescimento, ex.: 1,0 / 1,2 / 1,5 ... reinvestindo o caixa gerado.", "num2")
    P.s("com_compra", "Comissão na compra de animais", 0.02, "% do valor", "Corretor/leilão.", "pct")
    P.s("frete_compra", "Frete na compra de animais", 60, "R$/cab", "", "brl")

    P.sec("6. NUTRIÇÃO")
    P.head(INGS, "Consumo de matéria seca por dia, em % do peso vivo, por categoria × ingrediente")
    for i, cat in enumerate(CATS):
        P.v(f"diet{i+1}", cat, DIET[i], "% PV/dia", "", "pct2")
        if i == 0:
            ws.cell(P.r - 1, 17, "Ex.: confinamento 2,30% do PV (silagem 0,60 + milho 1,45 + farelo 0,18 + núcleo 0,07). "
                                   "Proteinado só é consumido nos meses marcados como seca.").font = font(GRAY, italic=True, size=9)
    P.head(INGS[1:], "Parâmetros por ingrediente comprado/produzido")
    P.v("ms", "Teor de matéria seca", [0.33, 0.88, 0.89, 0.95, 0.98, 0.92], "%", "Converte MS em matéria natural (o que se compra).", "pct")
    P.v("perda", "Perdas de armazenagem e cocho", [0.12, 0.03, 0.02, 0.02, 0.03, 0.03], "%", "", "pct")
    P.v("preco_ing", "Preço posto na fazenda", [380, "=[p_milho_sc]/60*1000", 1850, 3500, 3000, 2600], "R$/t",
        "Silagem comprada R$ 380/t MN; farelo R$ 1.850/t; núcleo R$ 3,50/kg; sal mineral R$ 3,00/kg; proteinado R$ 2,60/kg. Estimativas do modelador — VALIDAR com revendas locais.", "brl")
    PREM["ms_sil"], PREM["ms_mil"], PREM["ms_far"], PREM["ms_nuc"], PREM["ms_sal"], PREM["ms_prot"] = [
        (P.name, P.r - 3, 4 + i) for i in range(6)]
    for i, k in enumerate(["sil", "mil", "far", "nuc", "sal", "prot"]):
        PREM["pd_" + k] = (P.name, P.r - 2, 4 + i)
        PREM["pi_" + k] = (P.name, P.r - 1, 4 + i)
    P.s("p_vol", "Volumoso emergencial comprado (déficit de pasto)", 600, "R$/t MS", "Feno/silagem comprados quando a demanda supera pasto + forragem diferida.", "brl")

    P.sec("7. PREÇOS (base, em moeda constante)")
    P.s("p_arroba", "Arroba do boi gordo em Rondônia", 300, "R$/@",
        "Referência: Vilhena/RO R$ 280-295/@ em nov/2025 (Safras & Mercado, Datagro). Cotação de 2026 não localizada — ATUALIZAR (Emater-RO, Cepea).", "brl", "key")
    P.s("des_vaca", "Deságio da arroba da vaca sobre o boi", 0.08, "%", "", "pct")
    P.s("p_bez_kg", "Bezerro desmamado macho", 14.5, "R$/kg vivo",
        "Referência: Scot Consultoria, RO, bezerro nelore 240 kg a R$ 3.338/cab em jul/2026 (R$ 13,9/kg); ágio para animal mais leve.", "num2", "key")
    P.s("des_bezerra", "Deságio da bezerra sobre o bezerro (R$/kg)", 0.12, "%", "", "pct")
    P.s("p_bm_kg", "Boi magro", 11.4, "R$/kg vivo", "380 kg ≈ R$ 4.330/cab (ágio de ~14% sobre a arroba do gordo). Sem cotação de RO localizada — VALIDAR.", "num2", "key")
    P.s("p_matriz", "Matriz nelore (prenhe ou parida)", 4300, "R$/cab", "Estimativa do modelador — VALIDAR em leilões locais.", "brl")
    P.s("p_touro", "Touro nelore PO/avaliado", 14000, "R$/cab", "Estimativa do modelador.", "brl")
    P.s("f_touro_val", "Valor contábil médio do touro em uso (% do preço de compra)", 0.6, "%", "Para avaliação do rebanho.", "pct")
    P.s("f_bez_val", "Valor do bezerro ao pé (% do valor do desmamado)", 0.45, "%", "Para avaliação do rebanho.", "pct")
    P.s("p_milho_sc", "Milho em Rondônia (compra, posto fazenda)", 55, "R$/sc 60kg",
        "Referência: média Brasil R$ 60/sc em jun/2026 (Safras & Mercado); RO costuma ter desconto. VALIDAR.", "num2", "key")
    P.s("spread_milho", "Desconto do milho na venda (frete e base)", 6, "R$/sc", "Preço de venda = compra − desconto.", "num2")
    P.s("p_soja_sc", "Soja em Rondônia (venda)", 118, "R$/sc 60kg", "Estimativa do modelador — VALIDAR (Conab/cerealistas de Vilhena).", "num2")
    P.head(MESES, "Índices sazonais (média ≈ 1,00)")
    P.v("saz_arroba", "Sazonalidade da arroba", [0.99, 0.98, 0.97, 0.97, 0.97, 0.98, 1.00, 1.02, 1.03, 1.04, 1.03, 1.02], "índice", "Entressafra (ago-nov) paga mais.", "fac")
    P.v("saz_repos", "Sazonalidade da reposição", [1.02, 1.02, 1.01, 1.00, 0.98, 0.97, 0.97, 0.98, 1.00, 1.01, 1.02, 1.02], "índice", "Oferta de desmama pressiona maio-julho.", "fac")
    P.v("saz_graos", "Sazonalidade do milho", [1.04, 1.05, 1.04, 1.02, 1.00, 0.97, 0.94, 0.94, 0.97, 1.00, 1.01, 1.02], "índice", "Colheita da safrinha em jul-ago.", "fac")
    P.head(ANOS, "Índices do ciclo de preços por ano (1,00 = preço base)")
    P.v("ciclo_arroba", "Ciclo pecuário — arroba", [1.00, 0.98, 0.95, 0.93, 0.94, 0.97, 1.00, 1.02, 1.00, 0.98], "índice",
        "PREMISSA DO MODELADOR: preços de 2026 estão em pico de ciclo (bezerro em recorde real); assume-se fase de baixa nos anos 2-5. Para neutralizar, coloque 1,00 em todos.", "fac")
    P.v("ciclo_repos", "Ciclo pecuário — reposição", [1.00, 0.96, 0.90, 0.87, 0.89, 0.95, 1.00, 1.04, 1.00, 0.96], "índice",
        "A reposição oscila mais que a arroba.", "fac")
    P.v("ciclo_graos", "Ciclo — grãos e ração", [1.0] * 10, "índice", "", "fac")

    P.sec("8. VENDAS — DEDUÇÕES")
    P.s("funrural", "Funrural + RAT + SENAR sobre a receita bruta (pessoa física)", 0.015, "%",
        "1,2% + 0,1% + 0,2%. Alternativa: recolher sobre a folha. VALIDAR com contador.", "pct")
    P.s("icms", "ICMS sobre vendas", 0.0, "%", "Venda interna de gado em RO em geral diferida/isenta; venda interestadual é tributada. VALIDAR.", "pct")
    P.s("taxa_cab", "Taxas por cabeça vendida (GTA, fundos sanitários)", 12, "R$/cab", "Estimativa.", "brl")
    P.s("com_venda", "Comissão sobre venda de animais", 0.0, "%", "", "pct")
    P.s("frete_venda", "Frete de venda por conta do produtor", 0, "R$/cab", "Em geral o frigorífico/comprador busca.", "brl")

    P.sec("9. CUSTOS OPERACIONAIS")
    P.s("san_cria", "Sanidade — cria (por matriz, inclui bezerro)", 95, "R$/cab/ano", "Vacinas obrigatórias, vermífugos, carrapaticida.", "brl")
    P.s("repro", "Custo reprodutivo (IATF, exames) por matriz", 0, "R$/cab/ano", "0 = monta natural. IATF: ~R$ 60-90 por protocolo.", "brl")
    P.s("san_rec", "Sanidade — recria", 55, "R$/cab/ano", "", "brl")
    P.s("san_eng", "Sanidade — engorda", 45, "R$/cab/ano", "", "brl")
    P.s("prot_conf", "Protocolo de entrada no confinamento", 30, "R$/cab", "Vermífugo, vacinas, brinco.", "brl")
    P.s("op_conf", "Custo operacional do confinamento (sem ração)", 1.60, "R$/cab/dia", "Combustível, manutenção, mão de obra de trato.", "num2")
    P.s("op_semi", "Custo operacional do semiconfinamento (sem ração)", 0.40, "R$/cab/dia", "", "num2")
    P.s("manut_pasto", "Manutenção de pastagem", 180, "R$/ha/ano", "Roçada, controle de invasoras, adubação de manutenção leve.", "brl")
    P.head(["Qtd", "Salário (R$/mês)", "Encargos (%)", "Custo mensal"], "Mão de obra")
    lab_rows = []
    for nm, q, sal, enc, note in LABOR:
        r = P.r
        ws.cell(r, 1, nm).font = font()
        if isinstance(q, str):
            P.pending.append((r, 4, q))
            ws.cell(r, 4).number_format = FMT["num"]
        else:
            P._cell(r, 4, q, "num", "in")
        P._cell(r, 5, sal, "brl", "in")
        P._cell(r, 6, enc, "pct", "in")
        x = ws.cell(r, 7, f"=D{r}*E{r}*(1+F{r})")
        x.number_format = FMT["brl"]
        x.font = font()
        ws.cell(r, 17, note).font = font(GRAY, italic=True, size=9)
        lab_rows.append(r)
        P.r += 1
    P.s("mao_obra", "Mão de obra total", f"=SUM(G{lab_rows[0]}:G{lab_rows[-1]})", "R$/mês", "", "brl", "calc")
    P.s("energia", "Energia, combustível e comunicação", 550, "R$/mês", "", "brl")
    P.s("admin", "Contabilidade e despesas administrativas", 350, "R$/mês", "", "brl")
    P.s("assist", "Assistência técnica (veterinário/zootecnista)", 250, "R$/mês", "", "brl")
    P.s("manut_benf", "Manutenção de benfeitorias e equipamentos", 0.02, "% do capex a.a.", "", "pct")
    P.s("itr", "ITR, CCIR e taxas anuais", 600, "R$/ano", "Pago em setembro.", "brl")
    P.s("mes_itr", "Mês-calendário de pagamento do ITR", 9, "1-12", "", "idx")

    P.sec("10. LAVOURA (operações terceirizadas, incluídas no custo por hectare)")
    P.head(["Milho safrinha", "Milho silagem", "Soja"], "Parâmetros por cultura")
    P.v("lav_prod", "Produtividade (milho e soja em sc/ha; silagem em t MN/ha)", [85, 38, 58], "ver rótulo",
        "RO: milho 2ª safra 80-100 sc/ha; soja 55-62 sc/ha (Conab/Embrapa RO); silagem 35-45 t/ha.", "num")
    P.v("lav_custo", "Custo total de produção", [3900, 5600, 5000], "R$/ha", "Insumos + operações terceirizadas + colheita/ensilagem. Estimativas — VALIDAR.", "brl")
    P.v("lav_plantio", "Mês-calendário de plantio", [2, 11, 10], "1-12", "", "idx")
    P.v("lav_colheita", "Mês-calendário de colheita", [7, 3, 2], "1-12", "", "idx")
    P.v("lav_pct_pl", "% do custo desembolsado no plantio (resto na colheita)", [0.6, 0.6, 0.6], "%", "", "pct")
    for i, k in enumerate(["mi", "si", "so"]):
        PREM["prod_" + k] = (P.name, P.r - 5, 4 + i)
        PREM["custo_" + k] = (P.name, P.r - 4, 4 + i)
        PREM["pl_" + k] = (P.name, P.r - 3, 4 + i)
        PREM["co_" + k] = (P.name, P.r - 2, 4 + i)
        PREM["pp_" + k] = (P.name, P.r - 1, 4 + i)
    P.s("cap_armazem", "Milho próprio mantido em estoque (excedente é vendido)", 60, "t", "Limite de armazenagem/silo bolsa.", "num")

    P.sec("11. INVESTIMENTOS (CAPEX)")
    P.s("pct_reforma", "% da área de pasto a recuperar no início", 0.15, "%", "Assume pasto já formado, com 15% degradado.", "pct")
    P.s("reinv_on", "Reinvestir ao fim da vida útil (1 = sim)", 1, "flag", "Reposição pelo valor líquido do residual.", "idx")
    P.head(["Qtd", "Valor unit. (R$)", "Mês", "Vida útil (anos)", "Residual (%)", "Ativo? (1/0)", "Valor total (R$)"], "Itens de investimento")
    cap_rows = []
    for desc, q, vu, mes, vida, res, ativo, note in CAPEX:
        r = P.r
        ws.cell(r, 1, desc).font = font()
        for c, v, fm in ((4, q, "num"), (5, vu, "brl"), (6, mes, "idx"), (7, vida, "idx"), (8, res, "pct"), (9, ativo, "idx")):
            if isinstance(v, str):
                P.pending.append((r, c, v))
                ws.cell(r, c).number_format = FMT[fm]
            else:
                P._cell(r, c, v, fm, "in")
        P.pending.append((r, 10, f"=D{r}*E{r}*I{r}*[f_capex]"))
        ws.cell(r, 10).number_format = FMT["brl"]
        ws.cell(r, 17, note).font = font(GRAY, italic=True, size=9)
        cap_rows.append(r)
        P.r += 1
    P.cap_rows = cap_rows
    P.s("capex_base", "Total investido em benfeitorias e equipamentos", f"=SUM(J{cap_rows[0]}:J{cap_rows[-1]})", "R$", "Base da manutenção anual.", "brl", "calc")

    P.sec("12. FINANCIAMENTO")
    P.head(["Valor (R$)", "Mês liberação", "Taxa a.a.", "Carência (meses)", "Nº parcelas mensais"], "Linhas de crédito")
    loans = [("Linha 1 — crédito rural de investimento", "=[cred_inv]", 1, 0.095, 24, 72,
              "Referência Pronamp/Pronaf investimento: 8-10,5% a.a. Em moeda constante a taxa nominal é conservadora. Juros mensais na carência; amortização constante depois."),
             ("Linha 2 — custeio pecuário", "=[cred_cust]", 1, 0.11, 12, 1, "Parcela única após 12 meses.")]
    for k, (nm, val, mes, tx, car, n, note) in enumerate(loans, 1):
        r = P.r
        ws.cell(r, 1, nm).font = font()
        P.pending.append((r, 4, val))
        ws.cell(r, 4).number_format = FMT["brl"]
        P._cell(r, 5, mes, "idx", "in")
        P._cell(r, 6, tx, "pct", "in")
        P._cell(r, 7, car, "idx", "in")
        P._cell(r, 8, n, "idx", "in")
        ws.cell(r, 17, note).font = font(GRAY, italic=True, size=9)
        for j, nm2 in enumerate(["val", "mes", "tx", "car", "n"]):
            PREM[f"l{k}_{nm2}"] = (P.name, r, 4 + j)
        P.r += 1

    P.sec("13. TRIBUTOS — IRPF DA ATIVIDADE RURAL (pessoa física)")
    P.s("pres", "Base presumida (% da receita bruta)", 0.20, "%", "Lei 8.023/90: tributa-se o MENOR entre o resultado (regime de caixa) e 20% da receita bruta.", "pct")
    P.s("outras_rendas", "Outras rendas tributáveis anuais do titular", 0, "R$/ano", "Posiciona a faixa do IRPF. 0 = atividade rural é a única renda.", "brl")
    P.s("lag_irpf", "Meses entre o fim do ano e o pagamento do IRPF", 4, "meses", "Declaração/quota em abril.", "idx")
    P.head(["Base a partir de", "Alíquota", "Parcela a deduzir"], "Tabela progressiva anual do IRPF")
    r0 = P.r
    for a, b, c in IR_TABLE:
        P._cell(P.r, 4, a, "num2", "in")
        P._cell(P.r, 5, b, "pct", "in")
        P._cell(P.r, 6, c, "num2", "in")
        P.r += 1
    ws.cell(r0, 17, "Tabela anual vigente para o ano-calendário 2024/2025. ATUALIZAR: a lei que isenta até R$ 5 mil/mês e a reforma tributária (IBS/CBS) mudam esses valores. VALIDAR com contador.").font = font(GRAY, italic=True, size=9)
    PREM["ir_tab"] = (P.name, r0, 4)
    PREM["ir_tab_end"] = (P.name, P.r - 1, 6)

    # perfil_bm depende da linha de meses do cenario: corrige as formulas pendentes
    sh, rr, cc = PREM["perfil_bm"]
    fixed = []
    for (r, c, tpl) in P.pending:
        if r == rr and isinstance(tpl, str) and "%d" in tpl:
            i = c - 4
            tpl = f"=0.5*IF([mes_bm1]={i+1},1,0)+0.5*IF([mes_bm2]={i+1},1,0)"
        fixed.append((r, c, tpl))
    P.pending = fixed
    return P
