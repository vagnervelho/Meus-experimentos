# -*- coding: utf-8 -*-
"""Gera 'Negocios_Autonomos_PVH.xlsx': um business case por aba, todos com o mesmo motor de cálculo.

Uso:  python3 build.py [saida.xlsx] [modulo_de_casos]
Requer openpyxl. Sem macros: só fórmulas e uma Tabela de Dados nativa do Excel (aba Sensibilidade).
Com LO_VERIFY=1 gera uma cópia para verificação no LibreOffice (Tabela de Dados trocada por TABLE()).
"""
import os
import sys
import importlib
from openpyxl import Workbook
import premissas_globais as pg
import aba_caso
import saidas

AQUI = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(AQUI, "..", "Negocios_Autonomos_PVH.xlsx")
MOD = sys.argv[2] if len(sys.argv) > 2 else "casos"
VERSAO = "Versão 1.0 — nov/2026."

INSTR = [
    ("h", "1. PARA QUE SERVE"),
    ("p", "Comparar, com a mesma régua, dezenas de negócios autônomos (ou quase) para Porto Velho (RO). Cada aba BC é um business case "
          "completo: modelo de negócio, premissas com fonte, investimento, custos, tributos, financiamento, três cenários próprios e um "
          "estresse global, com VPL, TIR, TIRM, payback, ROI e MOIC sobre um fluxo de caixa de 5 anos."),
    ("h", "2. COMO USAR (5 passos)"),
    ("p", "1) Em Premissas, revise as entradas globais: TMA, custo da hora humana, tarifa de energia, aluguéis, condições de financiamento. "
          "Tudo o que está ali vale para todas as abas."),
    ("p", "2) No Painel, leia o comparativo e o ranking. Clique no código de um negócio para abrir a aba dele."),
    ("p", "3) Em cada aba BC, ajuste as células azuis: premissas operacionais (preço, volume, capacidade), investimento, custos fixos, "
          "horas humanas por semana (premissa de entrada) e % financiado. O quadro do topo mostra os indicadores nos quatro cenários."),
    ("p", "4) Em Sensibilidade, mude os choques globais (demanda, preço, investimento, custos fixos, energia, atraso, horas) para estressar "
          "todos os negócios de uma vez. A coluna 'Estresse global' do Painel responde na hora. A Tabela de Dados mostra o VPL de um "
          "negócio escolhido para várias combinações de demanda e preço."),
    ("p", "5) Confira a aba Checks: ERRO = integridade quebrada; ALERTA = premissa fora da faixa (ex.: investimento acima do capital)."),
    ("h", "3. CÓDIGO DE CORES"),
    ("p", "Fonte AZUL em fundo AMARELO-CLARO: entrada editável. Fundo AMARELO FORTE: premissa-chave. Fonte PRETA: fórmula da própria aba. "
          "Fonte VERDE: fórmula que busca dado em outra aba. Fundo CINZA: totais, auxiliares e Tabela de Dados (não editar). Fundo "
          "VERDE-CLARO: indicadores do cenário Base. No Painel, a TIR fica verde se ≥ TMA, amarela se entre o Tesouro IPCA+ e a TMA, "
          "vermelha se abaixo do Tesouro."),
    ("p", "Cor das guias: azul-escuro = início; amarelo = entradas globais; verde = saídas; vermelho = controle; azul-claro = abas de negócio."),
    ("h", "4. DESENHO DAS ABAS DE NEGÓCIO (todas iguais)"),
    ("p", "Linhas 7 a 25: quadro de indicadores (colunas C = Pessimista, D = Base, E = Otimista, F = Estresse global). Seções 1 a 7: "
          "modelo de negócio, premissas operacionais, investimento, custos fixos, custos proporcionais à receita, tempo humano, tributos e "
          "financiamento, cenários e rampa de maturação. Seções 8 a 12: projeção anual (colunas C = ano 0, D a H = anos 1 a 5) para cada "
          "cenário. Seção 13: checks. Coluna K: fonte e lógica de cada premissa."),
    ("h", "5. LÓGICA DO CÁLCULO (igual para todos os negócios)"),
    ("p", "Receita_t = receita madura × maturação_t × multiplicador de demanda × multiplicador de preço. A receita madura vem das premissas "
          "operacionais (capacidade × utilização × preço). A maturação segue a rampa da aba, deslocada no tempo pelo atraso do cenário."),
    ("p", "Custos variáveis: energia (kWh × tarifa global × multiplicador de energia), água (m³ × tarifa) e insumos/CMV acompanham o VOLUME. "
          "Meios de pagamento, royalties, repasses e comissões acompanham a RECEITA. Custos fixos são mensais (× 12). O tempo humano é "
          "custo: horas/semana × 52 × custo da hora (desligável em Premissas). A perda esperada com sinistros é probabilidade × custo."),
    ("p", "Tributos: Simples Nacional com alíquota efetiva por faixa = (receita anual × alíquota nominal − parcela a deduzir) ÷ receita "
          "anual, pelas tabelas da aba Premissas (Anexos I, II, III e III sem ISS para locação de bens móveis). Alternativa: alíquota fixa "
          "sobre a receita (regime 2), por exemplo Lucro Presumido."),
    ("p", "EBITDA = receita − custos variáveis − custos proporcionais − tributos − fixos − energia fixa − tempo humano − sinistros. "
          "Fluxo operacional livre = EBITDA − manutenção e reposição (% do capex a partir do ano 2). Fluxo do projeto: ano 0 = −(capex + "
          "capital de giro + pré-operacional); anos 1 a 5 = fluxo operacional; ano 5 soma o valor residual."),
    ("p", "Valor residual no ano 5 = o MAIOR entre (a) liquidar os ativos (Σ capex × % de revenda) e (b) continuar operando: fluxo do ano 5 "
          "× fator de anuidade na TMA pelos anos de vida útil remanescente × (1 − deságio de liquidez). Mais o capital de giro devolvido. "
          "O mesmo método em todas as abas mantém a comparação justa entre ativos de vida curta e longa."),
    ("p", "Financiamento (opcional): % do investimento, taxa nominal convertida em real pelo IPCA, prazo e carência globais, amortização "
          "constante (SAC) em termos reais, juros sobre o saldo. O saldo restante é quitado no ano 5. Gera a TIR do acionista; a TIR do "
          "projeto não muda. No Simples, juros não reduzem imposto."),
    ("h", "6. INDICADORES"),
    ("p", "VPL = fluxo do ano 0 + VPL(TMA; anos 1 a 5). TIR = taxa que zera o VPL (função TIR/IRR). TIR nominal = (1 + TIR real) × "
          "(1 + IPCA) − 1. TIRM = TIR modificada (MIRR), com saídas descontadas pela TMA e entradas reinvestidas à taxa de reinvestimento. "
          "Payback simples e descontado: anos até o acumulado ficar ≥ 0, com interpolação dentro do ano e sem valor residual. ROI 5 anos = "
          "(Σ fluxos operacionais + valor residual − investimento) ÷ investimento. MOIC = (Σ fluxos operacionais + valor residual) ÷ "
          "investimento. Exposição máxima = pior saldo acumulado. Dependência do valor residual = VP do valor residual ÷ VP das entradas."),
    ("p", "Margem de segurança = quanto a demanda pode cair até o VPL zerar, por aproximação linear entre o Base e o Base com demanda −20% "
          "(bloco auxiliar). Ponto de equilíbrio operacional = custos fixos totais ÷ margem de contribuição da receita madura."),
    ("h", "7. CENÁRIOS"),
    ("p", "Pessimista e Otimista: multiplicadores próprios de cada negócio (a largura da incerteza muda de um negócio para outro). "
          "Estresse global: o caso-base multiplicado pelos choques da aba Sensibilidade, iguais para todos (comparação justa). "
          "Padrão do estresse: demanda −20%, preço −5%, investimento +15%, custos fixos +10%, energia +15%, maturação 6 meses mais lenta."),
    ("h", "8. VEREDITO"),
    ("p", "AVANÇAR: VPL > 0 no Base e no Estresse global. AVANÇAR COM CAUTELA: VPL > 0 no Base, mas negativo no Estresse. SÓ COM ALAVANCAS: "
          "TIR do Base entre o Tesouro IPCA+ e a TMA (precisa de ponto, preço ou custo melhores). DESCARTAR: TIR abaixo do Tesouro IPCA+."),
    ("h", "9. SIMPLIFICAÇÕES ASSUMIDAS"),
    ("p", "Fluxo anual (não mensal); moeda constante; capital de giro constante; receita anual como aproximação da RBT12 do Simples; "
          "sinistros como perda esperada; financiamento tratado como corrigido pela inflação; sem depreciação fiscal (irrelevante no Simples); "
          "sem valorização imobiliária (o investidor não compra terreno). Negócios em rede (várias máquinas ou pontos) são modelados como "
          "uma unidade agregada."),
    ("h", "10. FONTES E VALIDAÇÃO"),
    ("p", "As premissas vêm de pesquisa de mercado de nov/2026: concorrência e preços em Porto Velho, dados de franqueadoras e operadores "
          "(tratados como otimistas), IBGE, INMET, ANEEL e legislação. A coluna K de cada aba cita a fonte ou a lógica. Premissas marcadas "
          "VALIDAR devem ser confirmadas no campo antes de investir. O relatório de triagem (STRESS_TEST.md) documenta a pesquisa."),
    ("h", "11. COMO REGERAR OU ALTERAR A ESTRUTURA"),
    ("p", "A planilha é produzida pelo código em 'gerador/' (Python + openpyxl): casos.py define os negócios; aba_caso.py, o motor das abas; "
          "premissas_globais.py, as entradas globais; saidas.py, o Painel, a Sensibilidade, os Checks e a Capa; referencia.py replica o "
          "cálculo em Python e verificar.py compara a planilha recalculada com a referência. Mudanças de premissa se fazem no Excel; "
          "mudanças de estrutura (novas linhas ou negócios), no código."),
]


def main():
    casos = importlib.import_module(MOD).CASOS
    wb = Workbook()
    wb.remove(wb.active)
    pg.build_premissas(wb)
    _ws, r_sens = pg.build_sensibilidade_inputs(wb)
    abas = [aba_caso.build(wb, c) for c in casos]
    saidas.build_painel(wb, abas)
    saidas.finish_sensibilidade(wb, abas, r_sens)
    saidas.build_checks(wb, abas)
    desc = [("Capa", "Início", "Resumo, legenda de cores e índice."),
            ("Instrucoes", "Início", "Como usar, lógica do cálculo, indicadores, cenários, veredito, simplificações e fontes."),
            ("Premissas", "Entrada", "Entradas globais: TMA, inflação, custo da hora, tarifas, aluguéis, financiamento e tabelas do Simples."),
            ("Painel", "Saída", "Comparativo de todos os negócios, ranking por TIR e gráfico."),
            ("Sensibilidade", "Entrada/Saída", "Choques globais para estressar todos os negócios e Tabela de Dados demanda × preço."),
            ("Checks", "Controle", "Integridade de cada aba e alertas de premissa.")]
    desc += [(a.c["aba"], "Negócio", f"{a.c['nome']} — {a.c['resumo']}") for a in abas]
    saidas.build_capa(wb, abas, desc, VERSAO)
    saidas.build_instrucoes(wb, INSTR)
    ordem = ["Capa", "Instrucoes", "Premissas", "Painel", "Sensibilidade", "Checks"] + [a.c["aba"] for a in abas]
    wb._sheets = [wb[n] for n in ordem]
    cores = {"Capa": "1F3864", "Instrucoes": "1F3864", "Premissas": "FFC000", "Sensibilidade": "FFC000", "Painel": "00B050",
             "Checks": "C00000"}
    for nm in ordem:
        wb[nm].sheet_properties.tabColor = cores.get(nm, "8EA9DB")
    from openpyxl.worksheet.properties import PageSetupProperties
    for nm in ("Painel", "Capa"):
        w = wb[nm]
        w.page_setup.orientation = "landscape"
        w.page_setup.fitToWidth, w.page_setup.fitToHeight = 1, 0
        w.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    wb.active = 0
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = (ws.title == "Capa")
    wb.calculation.fullCalcOnLoad = True
    wb.save(OUT)
    print("salvo:", os.path.abspath(OUT), "|", len(abas), "negócios")


if __name__ == "__main__":
    main()
