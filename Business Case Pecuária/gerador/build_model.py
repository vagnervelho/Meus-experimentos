# -*- coding: utf-8 -*-
"""Gera o modelo 'Business_Case_Pecuaria.xlsx'.

Uso:  python3 build_model.py [caminho_de_saida.xlsx]
Requer openpyxl. Nao ha macros: o arquivo contem apenas formulas e Tabelas de Dados nativas do Excel.
"""
import sys, os
from framework import *
import inputs, engines, outputs
from openpyxl import Workbook
from openpyxl.worksheet.datavalidation import DataValidation

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Business_Case_Pecuaria.xlsx")

DESC = [
    ("Capa", "Início", "Índice, legenda de cores e status do modelo."),
    ("Instrucoes", "Início", "Como usar, lógica do modelo, glossário, simplificações e fontes."),
    ("Painel", "Saída", "Indicadores-chave e gráficos do cenário ativo."),
    ("Cenarios", "Entrada", "Seletor do cenário, alavancas de cada estratégia e comparação dos 9 cenários (Tabela de Dados)."),
    ("Premissas", "Entrada", "Todas as premissas técnicas, de preço, custo, investimento, crédito e tributos."),
    ("Sensibilidade", "Entrada/Saída", "Choques nas variáveis-chave, tornado e tabelas cruzadas (Tabelas de Dados)."),
    ("Precos", "Motor", "Curvas mensais de preço: base × sazonalidade × ciclo × choque."),
    ("Rebanho", "Motor", "Fluxo de cabeças e de peso: cria, recria, engorda; lotação; valor do rebanho."),
    ("Nutricao", "Motor", "Balanço forrageiro e demanda de ração por unidade e ingrediente."),
    ("Lavoura", "Motor", "Produção de milho, silagem e soja; estoque; produzir × comprar."),
    ("Operacional", "Motor", "Receitas, deduções, compras de animais, custos variáveis e fixos."),
    ("Capex", "Motor", "Cronograma de investimentos, reposição e depreciação."),
    ("Divida_Tributos", "Motor", "Crédito rural e IRPF da atividade rural."),
    ("DRE", "Saída", "Demonstração de resultado gerencial mensal consolidada."),
    ("Fluxo_Caixa", "Saída", "Fluxo de caixa direto mensal, necessidade de aporte e fluxo descontado."),
    ("Balanco", "Saída", "Balanço patrimonial gerencial mensal (teste de integridade)."),
    ("Unidades", "Saída", "Resultado por unidade de negócio com preços de transferência."),
    ("Resumo_Anual", "Saída", "Demonstrações e indicadores consolidados por ano."),
    ("Retorno", "Saída", "VPL, TIR, payback, exposição de caixa e indicadores físicos."),
    ("Checks", "Controle", "Testes de integridade (ERRO) e alertas de premissa (ALERTA)."),
]
TAB = {"Início": "1F3864", "Entrada": "FFC000", "Entrada/Saída": "FFC000", "Motor": "7F7F7F", "Saída": "00B050", "Controle": "C00000"}

INSTR = [
    ("h", "1. PARA QUE SERVE"),
    ("p", "Planejar, do zero, um negócio de pecuária de corte em Rondônia: quanto investir, quanto gastar por mês, quando o caixa volta e qual combinação de fases (cria, recria, engorda a pasto, semiconfinamento, confinamento) e de suprimento de ração (comprada ou produzida) remunera melhor o capital."),
    ("h", "2. COMO USAR (5 passos)"),
    ("p", "1) Em Cenarios!C4 escolha o cenário (1 a 9). O cenário 9 é livre para montar a estratégia de vocês."),
    ("p", "2) Em Cenarios, ajuste as alavancas da coluna do cenário (células amarelas): cabeças compradas, unidades ativas, mix de terminação, áreas de lavoura, crédito."),
    ("p", "3) Em Premissas, revise as células amarelas — em especial as de amarelo forte (premissas-chave) e todas as marcadas VALIDAR."),
    ("p", "4) Leia o Painel e a aba Checks. ERRO significa modelo inconsistente; ALERTA significa premissa a revisar (ex.: capital insuficiente, pasto superlotado)."),
    ("p", "5) Use a tabela de comparação em Cenarios e a aba Sensibilidade para testar a robustez da decisão."),
    ("h", "3. CÓDIGO DE CORES"),
    ("p", "Fonte AZUL em fundo AMARELO-CLARO: entrada editável. Fundo AMARELO FORTE: premissa-chave. Fonte PRETA: fórmula da própria aba. Fonte VERDE: fórmula que busca dado em outra aba. Fundo CINZA: totais e resultados de Tabela de Dados (não editar). Fundo VERDE-CLARO: resultado em destaque."),
    ("p", "Cor das guias: amarelo = entradas; cinza = motores de cálculo; verde = saídas; vermelho = controle."),
    ("h", "4. ARQUITETURA (entradas → motores → saídas)"),
    ("p", "Todas as abas mensais têm o mesmo desenho: coluna A rótulo, B unidade, C total/referência, colunas E a DT = meses 1 a 120. O mês t está sempre na mesma coluna em todas as abas. Passe o mouse sobre os rótulos com triângulo vermelho para ler a lógica da linha."),
    ("p", "Precos → Rebanho → Nutricao → Lavoura → Operacional → Capex → Divida_Tributos → DRE / Fluxo_Caixa / Balanco → Unidades → Resumo_Anual / Retorno → Painel."),
    ("h", "5. LÓGICA DOS PRINCIPAIS CÁLCULOS"),
    ("p", "Rebanho de cria: matrizes(t) = matrizes(t−1) + compras + novilhas incorporadas − mortes − descartes. Nascimentos(t) = matrizes(t−9) × natalidade × % dos partos no mês. Desmamados(t) = nascimentos(t − idade à desmama) × (1 − mortalidade)."),
    ("p", "Recria e engorda (lotes): cada sistema tem uma linha de ganho acumulado G(t) = Σ GMD × dias. Um lote que entra no mês c com peso w0 pesa w0 + G(t) − G(c−1) no mês t e sai no primeiro mês em que atinge o peso-alvo. Isso dá o mês de saída, o peso de venda e o peso vivo em estoque sem precisar de uma matriz lote × mês."),
    ("p", "Arrobas vendidas = peso vivo × rendimento de carcaça ÷ 15. Receita = arrobas × preço da arroba do mês."),
    ("p", "Nutrição: consumo de cada ingrediente = peso vivo da categoria × % do PV por dia × dias. Matéria natural = matéria seca ÷ teor de MS ÷ (1 − perdas). Pasto: oferta por hectare × área, com carregamento de forragem diferida; o déficit vira compra de volumoso."),
    ("p", "Produzir × comprar: a lavoura abastece um estoque; o rebanho consome; a falta é comprada e o excedente de milho é vendido. A unidade Lavoura 'vende' ao rebanho a preço de mercado e paga arrendamento imputado: se a margem dela for positiva, produzir vale mais que comprar."),
    ("p", "Resultado por unidade: bezerros passam da cria para a recria, e bois magros da recria para a engorda, a preço de mercado. Assim cada fase tem margem própria e a soma fecha com o EBITDA (teste em Checks)."),
    ("p", "Resultado gerencial: rebanho e grãos são avaliados a mercado todo mês; a variação do valor em estoque entra no resultado (lógica do CPC 29 — ativo biológico a valor justo). Por isso lucro e caixa diferem bastante nos primeiros anos."),
    ("p", "Caixa: se o saldo cair abaixo do mínimo, o modelo registra 'aporte adicional dos sócios'. Não há empréstimo automático, portanto não há referência circular."),
    ("p", "Custo de oportunidade da terra: o indicador 'VPL incremental' compara o cenário com a alternativa passiva de arrendar toda a área útil a terceiros. O VPL comum pode ser positivo só porque a terra já é de vocês; o incremental mostra se OPERAR cria valor além disso. A alavanca 'pasto ocioso arrendado a terceiros' permite combinar as duas coisas."),
    ("p", "Retorno: VPL e TIR sobre o fluxo de caixa livre mensal mais o valor terminal por liquidação no mês 120 (rebanho a mercado menos custo de venda, estoques, imobilizado líquido). Não se usa perpetuidade."),
    ("p", "IRPF (pessoa física): base anual = menor entre o resultado em regime de caixa (investimentos dedutíveis, prejuízos compensáveis) e 20% da receita bruta; aplica-se a tabela progressiva; paga-se em abril do ano seguinte."),
    ("h", "6. TABELAS DE DADOS (sem macros)"),
    ("p", "As comparações de cenários e as sensibilidades usam o recurso nativo Dados > Teste de Hipóteses > Tabela de Dados. Elas recalculam o modelo inteiro para cada linha. Se o Excel ficar lento, use Fórmulas > Opções de Cálculo > 'Automático, exceto Tabelas de Dados' e pressione F9 quando quiser atualizá-las."),
    ("p", "Não digite dentro das áreas cinza das tabelas. Para mudar os eixos das tabelas cruzadas, altere apenas os percentuais azuis da borda."),
    ("h", "7. SIMPLIFICAÇÕES ASSUMIDAS (leia antes de decidir)"),
    ("p", "• Moeda constante: sem inflação. Preços variam só por sazonalidade, ciclo e choques. A taxa de desconto é real; os juros do crédito são tratados como reais (conservador)."),
    ("p", "• Cabeças fracionárias e mortalidade lançada na entrada de cada fase."),
    ("p", "• Fêmeas excedentes são vendidas à desmama (não há recria/engorda de novilhas para abate)."),
    ("p", "• Bezerros comprados têm o mesmo peso do desmamado próprio; boi magro comprado entra no peso-alvo da recria."),
    ("p", "• Lavoura com operações terceirizadas (sem frota própria); milho grão é safrinha e pode suceder soja ou silagem na mesma área."),
    ("p", "• Terra própria já detida não entra no fluxo de caixa; cobra-se arrendamento imputado só na visão por unidade. Os 100 ha são tratados como área aberta consolidada (reserva legal e APP fora dessa conta)."),
    ("p", "• Ano fiscal = ano do modelo (12 meses a partir da data de início). Tributos são estimativas para planejamento, não substituem o contador."),
    ("p", "• Custos fixos não são rateados entre as fases: ficam na unidade Estrutura."),
    ("h", "8. GLOSSÁRIO"),
    ("p", "Cria: vacas produzindo bezerros até a desmama. Recria: do bezerro desmamado ao boi magro. Engorda/terminação: do boi magro ao abate. Arroba (@): 15 kg de carcaça. Rendimento de carcaça: carcaça ÷ peso vivo. GMD: ganho médio diário de peso. UA: unidade animal = 450 kg de peso vivo. Lotação: UA por hectare de pasto. MS/MN: matéria seca / matéria natural. Semiconfinamento: animal em pasto recebendo concentrado no cocho. Funrural: contribuição previdenciária sobre a receita rural. Exposição máxima de caixa: maior saldo negativo acumulado do projeto."),
    ("h", "9. FONTES E VALIDAÇÃO DOS NÚMEROS"),
    ("p", "Preços com referência pública estão anotados ao lado de cada premissa (Safras & Mercado, Datagro, Scot Consultoria, Cepea). Coeficientes técnicos seguem faixas usuais de literatura (Embrapa Gado de Corte, Embrapa Rondônia). Onde está escrito 'Estimativa do modelador' ou 'VALIDAR', o número é um ponto de partida e deve ser confirmado na região antes de qualquer decisão: cotações em leilões e frigoríficos locais, revendas de insumos, Emater-RO, sindicato rural e contador."),
    ("h", "10. COMO REGERAR OU ALTERAR A ESTRUTURA"),
    ("p", "A planilha é gerada pelo código Python da pasta 'gerador' (build_model.py). Alterações de premissas se fazem direto no Excel; alterações de estrutura (novas linhas, novas abas) devem ser feitas no código, para manter a consistência das fórmulas."),
]


def build_capa(wb):
    ws = wb.create_sheet("Capa")
    outputs.title(ws, "BUSINESS CASE — PECUÁRIA DE CORTE EM RONDÔNIA", "Modelo financeiro integrado: cria, recria, engorda e lavoura. Horizonte de 120 meses. Sem macros.", 6)
    ws["A4"] = "Cenário ativo"
    ws["A5"] = "Status do modelo"
    ws["A6"] = "VPL do cenário ativo (R$)"
    ws["A7"] = "Aporte adicional exigido (R$)"
    for r in range(4, 8):
        ws.cell(r, 1).font = font(bold=True)
    outputs.put(ws, "B4", f"={paddr('scen_nome')}", "gen", True)
    outputs.put(ws, "B5", f"={paddr('status')}", "gen", True)
    outputs.put(ws, "B6", f"={paddr('k_vpl')}", "brl", True)
    outputs.put(ws, "B7", f"={paddr('k_apad')}", "brl", True)
    ws["A8"] = "VPL incremental vs. arrendar tudo (R$)"
    ws["A8"].font = font(bold=True)
    outputs.put(ws, "B8", f"={paddr('k_inc')}", "brl", True)
    ws["B8"].alignment = Alignment(horizontal="left")
    for r in range(4, 8):
        ws.cell(r, 2).alignment = Alignment(horizontal="left")
    outputs.sec(ws, 10, "LEGENDA DE CORES", 6)
    leg = [("Entrada editável", font(BLUE), F_IN, "Fonte azul em fundo amarelo-claro. Únicas células que devem ser digitadas."),
           ("Premissa-chave", font(BLUE, True), F_KEY, "Entradas que mais movem o resultado ou que vieram do usuário."),
           ("Fórmula local", font(BLACK), None, "Fonte preta: cálculo com dados da própria aba."),
           ("Vínculo entre abas", font(GREEN), None, "Fonte verde: fórmula que busca dado em outra aba."),
           ("Total / Tabela de Dados", font(BLACK, True), F_TOT, "Fundo cinza: totais e áreas calculadas automaticamente. Não editar."),
           ("Resultado em destaque", font(BLACK, True), F_OUT, "Fundo verde-claro: valor ativo ou indicador final.")]
    for i, (t, f, fill, d) in enumerate(leg):
        x = ws.cell(11 + i, 1, t)
        x.font = f
        if fill:
            x.fill = fill
        ws.cell(11 + i, 2, d).font = font(GRAY, italic=True)
    outputs.sec(ws, 18, "ÍNDICE DAS ABAS (clique para navegar)", 6)
    for c, t in enumerate(["Aba", "Descrição", "Tipo"], 1):
        ws.cell(19, c, t).font = font(bold=True)
    for i, (nm, tp, d) in enumerate(DESC):
        r = 20 + i
        x = ws.cell(r, 1, nm)
        x.hyperlink = f"#'{nm}'!A1"
        x.font = Font(name=FONT, size=10, color="0563C1", underline="single")
        ws.cell(r, 2, d).font = font()
        ws.cell(r, 3, tp).font = font(GRAY, italic=True)
    r = 20 + len(DESC) + 1
    ws.cell(r, 1, "Versão 1.0 — modelo de planejamento. Os números-padrão são pontos de partida e devem ser validados na região antes de qualquer decisão de investimento.").font = font(GRAY, italic=True, size=9)
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 105
    ws.column_dimensions["C"].width = 16
    return ws


def build_instr(wb):
    ws = wb.create_sheet("Instrucoes")
    outputs.title(ws, "INSTRUÇÕES, LÓGICA E DOCUMENTAÇÃO DO MODELO", "Leia uma vez antes de usar.", 2)
    r = 4
    for kind, t in INSTR:
        if kind == "h":
            r += 1
            outputs.sec(ws, r, t, 2)
        else:
            x = ws.cell(r, 1, t)
            x.font = font()
            x.alignment = Alignment(wrap_text=True, vertical="top")
            ws.row_dimensions[r].height = 15 * (1 + len(t) // 150)
        r += 1
    ws.column_dimensions["A"].width = 160
    return ws


def main():
    wb = Workbook()
    wb.remove(wb.active)
    inputs.build_cenarios(wb)
    inputs.build_sens_inputs(wb)
    P = inputs.build_premissas(wb)
    mods = [engines.build_precos(wb), engines.build_rebanho(wb), engines.build_nutricao(wb), engines.build_lavoura(wb),
            engines.build_operacional(wb), engines.build_capex(wb, P), engines.build_fin(wb), engines.build_dre(wb),
            engines.build_fc(wb), engines.build_bp(wb), engines.build_unidades(wb)]
    P.render()
    for m in mods:
        m.render()
    outputs.build_retorno(wb)
    outputs.build_anual(wb)
    sc_h = outputs.finish_cenarios(wb)
    _, t0 = outputs.finish_sens(wb)
    outputs.build_checks(wb)
    outputs.build_painel(wb, sc_h, t0)
    build_capa(wb)
    build_instr(wb)
    # validacoes de entrada
    cs = wb["Cenarios"]
    dv = DataValidation(type="whole", operator="between", formula1="1", formula2="9", showErrorMessage=True,
                        errorTitle="Cenário inválido", error="Digite um número inteiro de 1 a 9.")
    cs.add_data_validation(dv)
    dv.add("C4")
    # ordem e cores das guias
    order = [d[0] for d in DESC]
    wb._sheets = [wb[n] for n in order]
    for nm, tp, _ in DESC:
        wb[nm].sheet_properties.tabColor = TAB[tp]
    from openpyxl.worksheet.properties import PageSetupProperties
    for nm in ("Painel", "Capa", "Retorno", "Checks", "Resumo_Anual"):
        w = wb[nm]
        w.page_setup.orientation = "landscape"
        w.page_setup.fitToWidth, w.page_setup.fitToHeight = 1, 1
        w.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    wb.active = 0
    wb.calculation.fullCalcOnLoad = True
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = (ws.title == "Capa")
    wb.save(OUT)
    no_auto_title(OUT)
    print("salvo:", os.path.abspath(OUT))


def no_auto_title(path):
    """Impede o Excel de criar titulo automatico em graficos de uma serie (o titulo fica nas celulas)."""
    import zipfile, shutil, re as _re
    tmp = path + ".tmp"
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for it in zin.infolist():
            data = zin.read(it.filename)
            if it.filename.startswith("xl/charts/chart") and b"autoTitleDeleted" not in data:
                x = data.decode("utf-8")
                x = _re.sub(r"<((?:\w+:)?)plotArea>", lambda m: f'<{m.group(1)}autoTitleDeleted val="1"/><{m.group(1)}plotArea>', x, count=1)
                x = _re.sub(r'<((?:\w+:)?)numFmt formatCode="([^"]*)"\s*/>', r'<\1numFmt formatCode="\2" sourceLinked="0"/>', x)
                data = x.encode("utf-8")
            zout.writestr(it, data)
    shutil.move(tmp, path)


if __name__ == "__main__":
    main()
