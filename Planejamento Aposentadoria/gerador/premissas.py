# -*- coding: utf-8 -*-
"""Aba Premissas: todas as entradas do modelo, categorizadas, mais os valores derivados.

Layout das linhas escalares
  A rótulo | B unidade | C Porto Velho / geral (entrada) | D Campinas (entrada, se diferente)
  E USADO no modelo (PV / geral) | F USADO Campinas | G-H livres | I notas e fontes
O valor "usado" = entrada, ou o valor imposto por um cenário/teste da aba Cenarios (fonte verde).
"""
import datetime as dt
from fw import *
from openpyxl.worksheet.datavalidation import DataValidation

D = dt.date
SPEC = []          # ("sec", título) | ("it", dict) | ("tbl", dict) | ("txt", texto)
ITEMS = {}         # chave -> dict do item


def sec_(t):
    SPEC.append(("sec", t))


def txt_(t):
    SPEC.append(("txt", t))


def it(key, label, unit, v, vc=None, fmt="brl", nt="", opts=None, key_=False, kind="in"):
    d = dict(key=key, label=label, unit=unit, v=v, vc=vc, fmt=fmt, note=nt, opts=opts, key_=key_, kind=kind)
    SPEC.append(("it", d))
    ITEMS[key] = d


def calc(key, label, unit, f, fmt="brl", nt=""):
    """Valor derivado: f é uma função sem argumentos que devolve a fórmula (chamada depois do layout)."""
    it(key, label, unit, None, fmt=fmt, nt=nt, kind="calc")
    ITEMS[key]["f"] = f


def tbl(name, title, cols, rows, fmt="brl", nt="", first_col_label=None):
    """Tabela de entradas. rows = [(chave_linha, rótulo, [valores...], fmt opcional)]."""
    SPEC.append(("tbl", dict(name=name, title=title, cols=cols, rows=rows, fmt=fmt, note=nt, first=first_col_label)))


def IDX(d):
    """Converte uma data (fórmula/célula) em nº do mês do modelo (mês 1 = início)."""
    s = P("inicio")
    return f"((YEAR({d})-YEAR({s}))*12+MONTH({d})-MONTH({s})+1)"


# =====================================================================================
sec_("1. DADOS PESSOAIS E OBJETIVO")
it("nasc", "Data de nascimento", "data", D(1994, 10, 6), fmt="date", key_=True)
it("inicio", "Mês de início da simulação (mês 1)", "data", D(2026, 12, 1), fmt="date",
   nt="Os valores em 'R$ de hoje' estão a preços deste mês. Tudo é corrigido pelo IPCA a partir daqui.")
it("idade_apos", "Idade de aposentadoria", "anos", 65, fmt="int", key_=True)
it("meta", "Renda mensal desejada na aposentadoria (líquida, no bolso)", "R$ hoje/mês", 32400, key_=True,
   nt="Poder de compra de hoje. O modelo corrige pela inflação até a aposentadoria e durante ela.")
it("criterio", "Critério do veredito", "opção", "Viver de rendimentos",
   opts=["Viver de rendimentos", "Consumir até a idade-limite"],
   nt="Viver de rendimentos = perpetuidade: o patrimônio real nunca diminui. Consumir = o patrimônio vai a zero na idade-limite.")
it("idade_lim", "Idade-limite (só no critério 'consumir')", "anos", 95, fmt="int")
it("pat_ini", "Patrimônio financeiro atual (investimentos já acumulados)", "R$", 150000, key_=True,
   nt="Informado: R$ 150 mil aplicados a 100% do CDI (nov/2026). Somente aplicações financeiras (não incluir carro ou bens).")
it("reserva_meses", "Reserva de emergência mínima", "meses de gasto", 6, fmt="int",
   nt="Usada no alerta de liquidez: o patrimônio não deveria ficar abaixo de N meses dos gastos recorrentes.")

sec_("2. TRABALHO E RENDA (PJ)")
it("cidade", "Cidade da simulação", "opção", "Porto Velho", opts=["Porto Velho", "Campinas"], key_=True,
   nt="Porto Velho: mantém o emprego atual. Campinas: muda na data abaixo e recomeça a carreira (rampa de faturamento).")
it("fat_pv", "Faturamento bruto mensal em Porto Velho (contrato atual)", "R$ hoje/mês", 32400, key_=True)
it("g_real", "Crescimento real do faturamento (acima da inflação)", "% a.a.", 0.0, fmt="pct",
   nt="0% = só repõe a inflação. Aplicado no mês de reajuste.")
it("mes_reaj", "Mês do reajuste anual do faturamento", "1-12", 1, fmt="int")
txt_("Campinas (usados só se a cidade for Campinas)")
it("mud_data", "Campinas: data da mudança", "data", D(2028, 5, 1), fmt="date",
   nt="Padrão: junto com o casamento. Antes disso ela segue em Porto Velho com o emprego atual.")
it("fat_cps_ini", "Campinas: faturamento no 1º mês após a mudança", "R$ hoje/mês", 10000,
   nt="VALIDAR. Recomeço: plantões e primeiras consultas. Cresce em linha reta até o valor 'estabelecida'.")
it("fat_cps_est", "Campinas: faturamento quando estabelecida", "R$ hoje/mês", 32400,
   nt="Padrão = mesmo valor de Porto Velho (comparação neutra). Mercado maior pode permitir valor mais alto.")
it("anos_estab", "Campinas: anos até se estabelecer", "anos", 3, fmt="num")
it("mud_custo", "Campinas: custo da mudança (frete, viagens, caução) — total do casal", "R$ hoje", 25000)
txt_("Marketing pessoal")
it("mkt_valor", "Marketing pessoal: investimento mensal", "R$ hoje/mês", 1500, key_=True)
it("mkt_ini", "Marketing: início", "data", D(2026, 12, 1), fmt="date")
it("mkt_consultas", "Marketing: consultas adicionais por mês (na maturidade)", "consultas/mês", 6, fmt="num",
   nt="VALIDAR. Efeito esperado do marketing. Ponto de equilíbrio ≈ 4 a 5 consultas/mês (ver aba Aposentadoria).")
it("mkt_ticket", "Marketing: valor médio de cada consulta adicional", "R$ hoje", 400, nt="VALIDAR com a tabela dela.")
it("mkt_rampa", "Marketing: meses até atingir a maturidade", "meses", 12, fmt="int",
   nt="Na mudança para Campinas a rampa recomeça (a clientela é local).")

sec_("3. TRIBUTOS E CUSTOS DA PJ")
it("regime", "Regime tributário", "opção", "Simples Nacional", opts=["Simples Nacional", "Lucro Presumido", "Alíquota manual"],
   key_=True)
it("pl_pct", "Simples: pró-labore como % do faturamento", "%", 0.28, fmt="pct",
   nt="Fator R = folha ÷ faturamento. Com 28% ou mais a PJ fica no Anexo III (alíquota menor); abaixo, Anexo V.")
it("simples_corr", "Simples: faixas corrigidas pela inflação ao longo do tempo?", "opção", "Sim", opts=["Sim", "Não"],
   nt="'Não' = lei atual congelada: com o faturamento nominal crescendo, ela sobe de faixa e paga mais (efeito escadinha).")
it("teto_inss", "Teto do INSS (salário de contribuição máximo, 2026)", "R$/mês", 8475.55, fmt="brl2",
   nt="Portaria Interministerial MPS/MF 2026. Corrigido pela inflação no modelo.")
it("inss_aliq", "Contribuição do sócio ao INSS sobre o pró-labore (até o teto)", "%", 0.11, fmt="pct")
it("contador", "Contabilidade da PJ", "R$ hoje/mês", 500)
it("iss", "Lucro Presumido: ISS municipal", "%", 0.03, 0.03, fmt="pct", nt="VALIDAR com o contador (varia por município e serviço).")
it("pl_lp", "Lucro Presumido: pró-labore mensal", "R$ hoje/mês", 1621, nt="1 salário mínimo (2026). Sobre ele: INSS 11% + 20% patronal.")
it("aliq_manual", "Alíquota manual: carga total sobre o faturamento", "%", 0.16, fmt="pct",
   nt="Inclui tudo (tributos da PJ + INSS + IR do pró-labore). Usada só no regime 'Alíquota manual'.")
it("sal_mat", "Recebe salário-maternidade do INSS (4 meses por filho)?", "opção", "Sim", opts=["Sim", "Não"],
   nt="Pago pelo INSS à contribuinte individual: média dos salários de contribuição, limitado ao teto.")

sec_("4. CUSTO DE VIDA E CÔNJUGE")
it("gasto_pes", "Gastos pessoais dela (pet, cartão, carro, seguro RC, passagens, alimentação)", "R$ hoje/mês", 15000, 16500,
   key_=True, nt="Campinas: VALIDAR (custo de vida maior + passagens para visitar a família). Plano de saúde fica à parte (seção 7).")
it("gasto_pes_cas", "Variação dos gastos pessoais após o casamento", "%", 0.0, fmt="pct",
   nt="Ex.: -10% se parte da alimentação passar para o mercado da casa (custos do lar).")
it("conj_divide", "O cônjuge divide as despesas do casal?", "opção", "Sim", opts=["Sim", "Não"], key_=True)
it("conj_pct", "Parcela paga pelo cônjuge nas despesas compartilhadas", "%", 0.50, fmt="pct", key_=True,
   nt="Compartilhadas: aluguel, lar, mudança, imóvel (entrada, parcelas, custos), montagem da casa e filhos. "
      "Não entram: gastos pessoais dela, plano de saúde dela e marketing.")

sec_("5. CASAMENTO")
it("cas_data", "Data do casamento", "data", D(2028, 5, 1), fmt="date", key_=True)
it("cas_valor", "Custo total do casamento (festa, lua de mel etc.)", "R$ hoje", 200000, key_=True)
it("cas_pct", "Parcela paga por ela", "%", 0.50, fmt="pct", key_=True)
it("cas_meses", "Pagamento distribuído nos N meses até o casamento", "meses", 12, fmt="int")
it("montagem", "Montagem da casa ao começar a morar junto (móveis, eletros) — total do casal", "R$ hoje", 60000,
   nt="VALIDAR. Gasto no mês em que começa o aluguel. Coloque 0 se não se aplicar.")

sec_("6. MORADIA E IMÓVEL")
txt_("Até o casamento ela mora com os pais (sem custo de moradia). A partir daí: aluguel até a compra do imóvel.")
it("aluguel", "Aluguel (do casamento até a compra)", "R$ hoje/mês", 4500, 5500, nt="VALIDAR. 3 quartos em bairro bom. Anúncios nov/2026: PV R$ 3,8–6,5 mil; Campinas (Cambuí/Taquaral) R$ 4,3–6 mil.")
it("cond_alug", "Condomínio + IPTU do imóvel alugado", "R$ hoje/mês", 800, 1300)
it("lar", "Custos do lar: contas, mercado, diarista, internet", "R$ hoje/mês", 4500, 5500, nt="VALIDAR. Total do casal.")
it("imovel_valor", "Valor do imóvel (casa equivalente)", "R$ hoje", 2000000, 3000000, key_=True,
   nt="Campinas: VALIDAR. m² médio Campinas R$ 8,2 mil (FipeZap set/2026) vs. ~R$ 4,1 mil em PV: casa equivalente custa ~1,5x. 0 = não comprar (aluguel para sempre).")
it("compra_data", "Data da compra", "data", D(2031, 11, 1), D(2031, 11, 1), fmt="date", key_=True)
it("valoriz", "Valorização real do imóvel (acima do IPCA)", "% a.a.", 0.0, fmt="pct")
it("itbi", "ITBI + escritura e registro", "% do valor", 0.03, 0.037, fmt="pct", nt="ITBI: Porto Velho 2%, Campinas 2,7% + registro (~1%; escritura dispensada no financiamento).")
it("reforma", "Reforma e mobília na compra — total do casal", "R$ hoje", 100000, nt="VALIDAR. Coloque 0 se não se aplicar.")
it("entrada", "Entrada (recursos próprios)", "% do valor", 0.30, fmt="pct", nt="100% = compra à vista.")
it("sistema", "Sistema de amortização", "opção", "SAC", opts=["SAC", "Price"],
   nt="SAC: parcela começa alta e cai. Price: parcela fixa, mais juros no total.")
it("taxa_fin", "Taxa de juros efetiva do financiamento (inclui TR estimada)", "% a.a.", 0.13, fmt="pct2",
   nt="SFH (imóvel até R$ 2,25 mi): juros limitados a 12% a.a. + TR (TR ~2% hoje; ~1% no longo prazo). Bancos nov/2026: 11,2% a 15% + TR.")
it("prazo", "Prazo do financiamento", "meses", 360, fmt="int")
it("seguro", "Seguros MIP + DFI", "% a.m. do saldo", 0.0003, fmt="pct3")
it("custo_proprio", "IPTU + condomínio + manutenção do imóvel próprio", "R$ hoje/mês", 2000, 2800)
it("amort_extra", "Parcela da sobra mensal usada para amortizar o financiamento", "%", 0.0, fmt="pct",
   nt="Amortização extra reduz o prazo. Vale a pena quando os juros do financiamento > rendimento líquido.")

sec_("7. FILHOS E SAÚDE")
it("n_filhos", "Número de filhos", "0 a 3", 1, fmt="int", key_=True)
it("f1_data", "Nascimento do 1º filho", "data", D(2031, 11, 1), fmt="date", key_=True)
it("f2_data", "Nascimento do 2º filho (se houver)", "data", D(2034, 11, 1), fmt="date")
it("f3_data", "Nascimento do 3º filho (se houver)", "data", D(2037, 11, 1), fmt="date")
it("dep_ate", "Idade em que o filho deixa de ser dependente", "anos", 23, fmt="int",
   nt="Custos até a véspera desse aniversário (23 = até 22 anos completos).")
it("custo_nasc", "Custo no nascimento (parto, enxoval, quarto)", "R$ hoje", 30000, nt="VALIDAR.")
it("escola", "Escola (2 a 17 anos)", "opção", "Particular", opts=["Particular", "Pública"], key_=True)
it("faculdade", "Faculdade (18 a 22 anos)", "opção", "Pública", opts=["Pública", "Particular"], key_=True)
it("fator_cps", "Campinas: multiplicador dos custos básicos e babá", "x", 1.20, fmt="x",
   nt="Cesta básica Campinas ~21% acima de PV; babá: piso paulista R$ 1.874 vs. salário mínimo em RO.")
it("infl_edu", "Inflação da educação acima do IPCA", "pp a.a.", 0.015, fmt="pct",
   nt="Mensalidades subiram 9,8% em 2026 (IPCA ~5,2%).")
it("licenca", "Licença-maternidade: meses sem faturar (por filho)", "meses", 6, fmt="int", key_=True)
it("lic_pct", "Faturamento mantido durante a licença", "%", 0.0, fmt="pct")
it("plano_dela", "Plano de saúde dela (preço de hoje na faixa 29–33 anos)", "R$ hoje/mês", 800, 950,
   nt="VALIDAR. Plano PME (via CNPJ) com boa cobertura. Hoje ela é dependente do plano dos pais; passa a pagar o próprio na data abaixo.")
it("plano_filho", "Plano de saúde por filho (faixa 0–18 anos)", "R$ hoje/mês", 400, 480, nt="VALIDAR.")
it("plano_inicio", "Início do plano de saúde próprio", "opção", "No nascimento do 1º filho",
   opts=["No nascimento do 1º filho", "No casamento", "Data específica"])
it("plano_data", "Data específica do início do plano (se escolhida acima)", "data", D(2031, 11, 1), fmt="date")
it("infl_saude", "Reajuste do plano acima do IPCA (além da mudança de faixa etária)", "pp a.a.", 0.025, fmt="pct",
   nt="Planos individuais subiram ~IPCA + 2,5 pp ao ano nas últimas décadas; PME subiu 13,5% em 2026. Faixas da ANS na tabela abaixo.")
tbl("filhos", "Custos mensais de cada filho por faixa etária (R$ de hoje, total do casal)",
    ["0–1 ano", "2–5", "6–10", "11–14", "15–17", "18–22"],
    [("band_lo", "Idade inicial da faixa (anos)", [0, 2, 6, 11, 15, 18], "int"),
     ("basico", "Custos básicos: alimentação, roupas, saúde extra, lazer, atividades", [2500, 2000, 2000, 2300, 2800, 3000], None),
     ("baba", "Babá / creche", [2800, 1500, 0, 0, 0, 0], None),
     ("esc_pv", "Escola particular — Porto Velho (mensalidade + material)", [0, 1800, 2100, 2400, 2800, 0], None),
     ("esc_cps", "Escola particular — Campinas (mensalidade + material)", [0, 2800, 3300, 3700, 4200, 0], None),
     ("esc_pub", "Escola pública — custo adicional (transporte, material)", [0, 300, 300, 400, 400, 0], None),
     ("fac_pub", "Faculdade pública — custo adicional (material, transporte, moradia parcial)", [0, 0, 0, 0, 0, 1500], None),
     ("fac_part", "Faculdade particular — mensalidade", [0, 0, 0, 0, 0, 4500], None)],
    nt="VALIDAR os valores. Os custos básicos e a babá são multiplicados pelo fator de Campinas quando ela mora lá.")
tbl("ans", "Faixas etárias da ANS: fator de preço do plano (0–18 anos = 1,00)",
    ["0–18", "19–23", "24–28", "29–33", "34–38", "39–43", "44–48", "49–53", "54–58", "59+"],
    [("ans_lo", "Idade inicial da faixa", [0, 19, 24, 29, 34, 39, 44, 49, 54, 59], "int"),
     ("ans_f", "Fator de preço", [1.00, 1.20, 1.40, 1.60, 1.80, 2.05, 2.45, 3.10, 4.00, 6.00], "num2")],
    nt="Fatores típicos que respeitam a regra da ANS (59+ ≤ 6x a 1ª faixa). VALIDAR com a tabela da operadora escolhida.")

sec_("8. INVESTIMENTOS E MACROECONOMIA")
tbl("curva", "Curva de juros e inflação por ano (Boletim Focus) — depois de 2030 vale o longo prazo",
    ["2026", "2027", "2028", "2029", "2030"],
    [("ano_curva", "Ano", [2026, 2027, 2028, 2029, 2030], "int"),
     ("cdi_curva", "CDI médio do ano", [0.1365, 0.129, 0.1165, 0.1055, 0.1015], "pct2"),
     ("ipca_curva", "IPCA do ano", [0.0522, 0.049, 0.040, 0.040, 0.040], "pct2")],
    nt="Focus 09/11/2026: Selic fim de ano 13,75% / 12,50% / 11,00% / 10,25%; IPCA 5,22% / 4,90% / 4,00% / 4,00%. CDI médio ≈ Selic média do ano − 0,10 pp. 2026 vale só para dez/2026.")
it("cdi_lp", "CDI médio de longo prazo (a partir de 2031)", "% a.a.", 0.10, fmt="pct2", key_=True,
   nt="Focus aponta Selic de 10,25% no fim de 2029.")
it("ipca_lp", "IPCA médio de longo prazo (a partir de 2031)", "% a.a.", 0.04, fmt="pct2", key_=True,
   nt="Meta do BC é 3%, mas as expectativas estão em 4% (Focus 2028-29). O que importa é o juro REAL: CDI − IPCA.")
it("pct_cdi", "Rentabilidade das aplicações", "% do CDI", 1.00, fmt="pct", key_=True)
it("ir_inv", "IR sobre os rendimentos", "%", 0.15, fmt="pct",
   nt="15% = aplicações de mais de 2 anos (tabela regressiva). Cobrado mês a mês no modelo (conservador).")
it("custodia", "Taxas de custódia / administração", "% a.a.", 0.0, fmt="pct2")
it("spread_div", "Saldo negativo: juros adicionais sobre o rendimento das aplicações", "pp a.a.", 0.0, fmt="pct",
   nt="0 = o saldo negativo é tratado como DÉFICIT acumulado, corrigido pela mesma taxa das aplicações (mostra quanto faltaria). "
      "Use 10–20 pp para simular o custo de cobrir o déficit com crédito bancário. Sempre gera alerta.")

sec_("9. INSS NA APOSENTADORIA")
it("inss_modo", "Benefício do INSS no cálculo", "opção", "Não considerar",
   opts=["Não considerar", "Estimativa do modelo", "Valor manual"],
   nt="Padrão conservador: não conta com o INSS. A estimativa usa as regras da EC 103/2019 (mulher: 60% + 2% por ano acima de 15).")
it("inss_manual", "Benefício manual (se escolhido)", "R$ hoje/mês", 0)
it("inss_anos_ant", "Anos de contribuição ao INSS até hoje", "anos", 5, fmt="num", nt="VALIDAR (extrato do CNIS no Meu INSS).")
it("inss_media_ant", "Média dos salários de contribuição até hoje", "R$ hoje/mês", 4000, nt="VALIDAR (extrato do CNIS).")

sec_("10. EVENTOS EXTRAS (gastos pontuais ou recorrentes dela, em R$ de hoje)")
SPEC.append(("events", None))

sec_("11. TABELAS DA LEGISLAÇÃO (2026) — atualizar se a lei mudar")
tbl("s3", "Simples Nacional — Anexo III (serviços médicos com Fator R ≥ 28%)",
    ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5", "Faixa 6"],
    [("s_lim", "Receita bruta 12 meses a partir de (R$)", [0, 180000, 360000, 720000, 1800000, 3600000], None),
     ("s3n", "Alíquota nominal", [0.06, 0.112, 0.135, 0.16, 0.21, 0.33], "pct"),
     ("s3d", "Parcela a deduzir (R$)", [0, 9360, 17640, 35640, 125640, 648000], None),
     ("s5n", "Anexo V — alíquota nominal (Fator R < 28%)", [0.155, 0.18, 0.195, 0.205, 0.23, 0.305], "pct"),
     ("s5d", "Anexo V — parcela a deduzir (R$)", [0, 4500, 9900, 17100, 62100, 540000], None)],
    nt="LC 123/2006 (redação da LC 155/2016). Alíquota efetiva = (RBT12 × nominal − parcela) ÷ RBT12. Limite do Simples: R$ 4,8 mi.")
tbl("ir", "IRPF — tabela progressiva mensal (pró-labore)",
    ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5"],
    [("ir_lim", "Base de cálculo a partir de (R$)", [0, 2428.81, 2826.66, 3751.06, 4664.69], "brl2"),
     ("ir_aliq", "Alíquota", [0, 0.075, 0.15, 0.225, 0.275], "pct"),
     ("ir_ded", "Parcela a deduzir (R$)", [0, 182.16, 394.16, 675.49, 908.73], "brl2")],
    nt="Tabela vigente desde mai/2025. O modelo supõe a tabela corrigida pela inflação no futuro.")
it("ir_simpl", "IRPF: desconto simplificado mensal", "R$", 607.20, fmt="brl2")
it("ir_red_lim1", "Lei 15.270/2025: isenção para rendimentos até", "R$/mês", 5000, fmt="brl2")
it("ir_red_max", "Lei 15.270/2025: redução máxima nessa faixa", "R$/mês", 312.89, fmt="brl2")
it("ir_red_lim2", "Lei 15.270/2025: redução parcial até", "R$/mês", 7350, fmt="brl2")
it("ir_red_a", "Lei 15.270/2025: redução = A − B × rendimento → A", "R$", 978.62, fmt="brl2")
it("ir_red_b", "Lei 15.270/2025: redução = A − B × rendimento → B", "fator", 0.133145, fmt="fac")
it("lp_pis", "Lucro Presumido: PIS", "%", 0.0065, fmt="pct2")
it("lp_cofins", "Lucro Presumido: COFINS", "%", 0.03, fmt="pct2")
it("lp_presuncao", "Lucro Presumido: presunção de lucro (serviços)", "%", 0.32, fmt="pct")
it("lp_irpj", "Lucro Presumido: IRPJ sobre o lucro presumido", "%", 0.15, fmt="pct")
it("lp_csll", "Lucro Presumido: CSLL sobre o lucro presumido", "%", 0.09, fmt="pct")
it("lp_adic", "Lucro Presumido: adicional de IRPJ", "%", 0.10, fmt="pct")
it("lp_adic_lim", "Lucro Presumido: lucro presumido isento do adicional", "R$/mês", 20000)

sec_("12. VALORES DERIVADOS (calculados — não editar)")
calc("idade_hoje", "Idade no início da simulação", "anos", lambda: f'=DATEDIF({P("nasc")},{P("inicio")},"y")', "int")
calc("t_apos", "Mês da aposentadoria (nº do mês do modelo)", "nº",
     lambda: "=" + IDX(f"EDATE({P('nasc')},12*{P('idade_apos')})"), "int")
calc("data_apos", "Data da aposentadoria", "data", lambda: f"=EDATE({P('inicio')},{P('t_apos')}-1)", "date")
calc("t_inss_ben", "Mês de início do benefício do INSS (idade mínima 62)", "nº",
     lambda: f"=MAX({P('t_apos')},{IDX('EDATE(' + P('nasc') + ',12*62)')})", "int")
calc("t_cas", "Mês do casamento", "nº", lambda: "=" + IDX(P("cas_data")), "int")
calc("t_mud", "Mês da mudança para Campinas", "nº", lambda: "=" + IDX(P("mud_data")), "int")
calc("t_mora", "Mês em que começa a morar fora da casa dos pais", "nº",
     lambda: f"=IF({P('cidade')}=2,MIN({P('t_cas')},{P('t_mud')}),{P('t_cas')})", "int")
calc("imovel_ativo", "Valor do imóvel da cidade escolhida", "R$ hoje",
     lambda: f"=IF({P('cidade')}=2,{PC('imovel_valor')},{P('imovel_valor')})")
calc("t_compra", "Mês da compra do imóvel (99999 = não compra)", "nº",
     lambda: f"=IF({P('imovel_ativo')}<=0,99999,MAX(1,"
             f"{IDX('IF(' + P('cidade') + '=2,' + PC('compra_data') + ',' + P('compra_data') + ')')}+{P('compra_atraso')}))", "int")
calc("V_compra", "Valor do imóvel na data da compra (nominal)", "R$",
     lambda: f"=IF({P('t_compra')}>{NM},0,{P('imovel_ativo')}*INDEX({colrange('Macro', 'idx')},{P('t_compra')})"
             f"*(1+{P('valoriz')})^(({P('t_compra')}-1)/12))")
calc("itbi_ativo", "ITBI + registro da cidade escolhida", "%", lambda: f"=IF({P('cidade')}=2,{PC('itbi')},{P('itbi')})", "pct")
calc("custo_proprio_ativo", "Custo mensal do imóvel próprio da cidade escolhida", "R$ hoje/mês",
     lambda: f"=IF({P('cidade')}=2,{PC('custo_proprio')},{P('custo_proprio')})")
calc("fin_valor", "Valor financiado (total do casal, nominal)", "R$", lambda: f"={P('V_compra')}*(1-{P('entrada')})")
calc("i_fin_m", "Juros do financiamento ao mês", "% a.m.", lambda: f"=(1+{P('taxa_fin')})^(1/12)-1", "pct3")
calc("A_sac", "SAC: amortização mensal constante", "R$", lambda: f"=IF({P('prazo')}>0,{P('fin_valor')}/{P('prazo')},0)")
calc("PMT_price", "Price: prestação fixa (sem seguros)", "R$",
     lambda: f"=IF({P('fin_valor')}>0,{P('fin_valor')}*{P('i_fin_m')}/(1-(1+{P('i_fin_m')})^(-{P('prazo')})),0)")
calc("t_f1", "Mês de nascimento do 1º filho", "nº", lambda: "=" + IDX(P("f1_data")), "int")
calc("t_f2", "Mês de nascimento do 2º filho", "nº", lambda: "=" + IDX(P("f2_data")), "int")
calc("t_f3", "Mês de nascimento do 3º filho", "nº", lambda: "=" + IDX(P("f3_data")), "int")
calc("t_plano", "Mês de início do plano de saúde próprio", "nº",
     lambda: f"=CHOOSE({P('plano_inicio')},IF({P('n_filhos')}>=1,{P('t_f1')},99999),{P('t_cas')},{IDX(P('plano_data'))})", "int")
calc("t_mkt", "Mês de início do marketing", "nº", lambda: "=" + IDX(P("mkt_ini")), "int")
calc("anexo", "Anexo do Simples (Fator R)", "anexo", lambda: f"=IF({P('pl_pct')}>=0.28,3,5)", "int")
calc("ans_ref", "Fator ANS da faixa de referência do preço dela (29–33)", "fator",
     lambda: f"=INDEX({TB('ans_f')},MATCH(29,{TB('ans_lo')},1))", "num2")
calc("r_liq_lp_m", "Longo prazo: rendimento líquido ao mês", "% a.m.",
     lambda: f"=((1+{P('cdi_lp')})^(1/12)-1)*{P('pct_cdi')}*(1-{P('ir_inv')})-((1+{P('custodia')})^(1/12)-1)", "pct3")
calc("ipca_lp_m", "Longo prazo: IPCA ao mês", "% a.m.", lambda: f"=(1+{P('ipca_lp')})^(1/12)-1", "pct3")
calc("r_real_lp_m", "Longo prazo: rendimento REAL líquido ao mês", "% a.m.",
     lambda: f"=(1+{P('r_liq_lp_m')})/(1+{P('ipca_lp_m')})-1", "pct3")
calc("r_real_lp_a", "Longo prazo: rendimento REAL líquido ao ano", "% a.a.", lambda: f"=(1+{P('r_real_lp_m')})^12-1", "pct2")
calc("r_real_bruto_a", "Longo prazo: rendimento REAL bruto ao ano (antes do IR)", "% a.a.",
     lambda: f"=(1+{P('cdi_lp')}*{P('pct_cdi')})/(1+{P('ipca_lp')})-1", "pct2")
calc("gasto_pes_ativo", "Gastos pessoais na cidade escolhida", "R$ hoje/mês",
     lambda: f"=IF({P('cidade')}=2,{PC('gasto_pes')},{P('gasto_pes')})")
calc("fat_mult", "Multiplicador do faturamento (cenários)", "x", lambda: f"=1+N({LEVCELL('fat_var')})", "x")
calc("gasto_mult", "Multiplicador dos gastos pessoais (cenários)", "x", lambda: f"=1+N({LEVCELL('gasto_var')})", "x")
calc("filho_mult", "Multiplicador dos custos dos filhos (cenários)", "x", lambda: f"=1+N({LEVCELL('filho_var')})", "x")
calc("compra_atraso", "Antecipação (-) ou atraso (+) da compra do imóvel (cenários)", "meses",
     lambda: f"=N({LEVCELL('compra_atraso')})", "int")

EVENTS = [  # descrição, valor (R$ hoje), 1ª data, repetir a cada (anos), nº de vezes, parcela dela
    ("Troca de carro (R$ 150 mil novo − ~50% de revenda)", 75000, D(2030, 1, 1), 6, 5, 1.0),
    ("", None, None, None, None, None), ("", None, None, None, None, None), ("", None, None, None, None, None),
    ("", None, None, None, None, None), ("", None, None, None, None, None), ("", None, None, None, None, None),
    ("", None, None, None, None, None),
]

LEVCELL = None   # definido em cenarios.py: função chave_alavanca -> endereço da célula "valor imposto"


# =====================================================================================
COLW = {"A": 66, "B": 15, "C": 23, "D": 14, "E": 23, "F": 14, "G": 13, "H": 13, "I": 82}
TOP0 = 4          # caixa de resultado: linhas 4 a 14
HDR = 16          # cabeçalho das colunas de entrada
EV = {}           # endereços da tabela de eventos


def layout():
    """Atribui linhas a todos os itens e tabelas (antes de qualquer fórmula ser escrita)."""
    r = HDR + 1
    for kind, d in SPEC:
        if kind == "sec":
            r += 1
            r += 1
        elif kind == "txt":
            r += 1
        elif kind == "it":
            PREM[d["key"]] = r
            r += 1
        elif kind == "tbl":
            d["r_title"] = r
            r += 1                      # título
            d["r_head"] = r
            r += 1                      # cabeçalho
            for key, lab, vals, fmt in d["rows"]:
                n = len(vals)
                TBL[key] = f"{PS}!$C${r}:${L(2 + n)}${r}"
                d.setdefault("rr", {})[key] = r
                r += 1
            r += 1
        elif kind == "events":
            EV["head"] = r
            EV["r1"] = r + 1
            EV["r2"] = r + len(EVENTS)
            for nm, cl in (("ev_val", "C"), ("ev_dt", "D"), ("ev_rep", "E"), ("ev_n", "F"), ("ev_pct", "G"),
                           ("ev_t", "K"), ("ev_per", "L"), ("ev_last", "M")):
                TBL[nm] = f"{PS}!${cl}${EV['r1']}:${cl}${EV['r2']}"
            r = EV["r2"] + 2
    return r


def render(ws, lever_of, lev_cells):
    """lever_of: chave do item -> (chave da alavanca, modo). lev_cells: chave da alavanca -> célula 'valor imposto'."""
    title(ws, "SIMULADOR DE APOSENTADORIA — PREMISSAS (todas as entradas)",
          "Edite só as células amarelas com fonte azul. Coluna C = Porto Velho / geral; D = Campinas (quando diferente). "
          "Colunas E e F mostram o valor que o modelo está usando.", 9)
    for k, w in COLW.items():
        ws.column_dimensions[k].width = w
    ws.sheet_view.zoomScale = 90
    for c, lab in enumerate(["Premissa", "Unidade", "Porto Velho / Geral", "Campinas", "Usado (PV/Geral)",
                             "Usado (Campinas)", "", "", "Notas, fontes e o que validar"], 1):
        x = ws.cell(HDR, c, lab)
        x.font = font(WHITE, True)
        x.fill = F_HEAD
        x.alignment = Alignment(horizontal="center" if 2 < c < 9 else "left", wrap_text=True, vertical="center")
    ws.row_dimensions[HDR].height = 30
    ws.freeze_panes = f"C{HDR + 1}"

    r = HDR + 1
    for kind, d in SPEC:
        if kind == "sec":
            r += 1
            for c in range(1, 10):
                ws.cell(r, c).fill = F_SEC
            ws.cell(r, 1, d).font = font(bold=True, size=11)
            r += 1
        elif kind == "txt":
            ws.cell(r, 1, d).font = font(GRAY, italic=True, size=9)
            r += 1
        elif kind == "it":
            _item(ws, d, lever_of, lev_cells)
            r += 1
        elif kind == "tbl":
            _table(ws, d)
            r = max(d["rr"].values()) + 2
        elif kind == "events":
            _events(ws)
            r = EV["r2"] + 2


def _input_cell(x, v, fmt, key_):
    x.value = v
    x.number_format = FMT.get(fmt, fmt)
    x.font = font(BLUE, key_)
    x.fill = F_KEY if key_ else F_IN
    x.border = BOX


def _opts_fmt(opts):
    """Formato numérico que exibe o texto da opção (até 3 opções)."""
    q = lambda s: '"' + s.replace('"', '') + '"'
    if len(opts) == 2:
        return f"[=1]{q(opts[0])};[=2]{q(opts[1])};General"
    return f"[=1]{q(opts[0])};[=2]{q(opts[1])};{q(opts[2])}"


def opts_arr(opts):
    return "{" + ",".join('"' + o + '"' for o in opts) + "}"


def _item(ws, d, lever_of, lev_cells):
    r = PREM[d["key"]]
    ws.cell(r, 1, d["label"]).font = font(bold=d["key_"])
    ws.cell(r, 1).alignment = Alignment(indent=1, wrap_text=False)
    ws.cell(r, 2, d["unit"]).font = font(GRAY, italic=True, size=9)
    if d["note"]:
        ws.cell(r, 9, d["note"]).font = font(GRAY, italic=True, size=9)
    fmt = d["fmt"]
    city = d["vc"] is not None
    lev = lever_of.get(d["key"])
    if d["kind"] == "calc":
        x = ws.cell(r, 5, d["f"]())
        x.number_format = FMT.get(fmt, fmt)
        x.font = font(GREEN if "!" in x.value.replace(PS + "!", "") else BLACK)
        x.fill = F_TOT
        return
    _input_cell(ws.cell(r, 3), d["v"], fmt, d["key_"])
    if city:
        _input_cell(ws.cell(r, 4), d["vc"], fmt, d["key_"])
    else:
        ws.cell(r, 4).fill = F_TIME
    if d["opts"]:
        dv = DataValidation(type="list", formula1='"' + ",".join(d["opts"]) + '"', allow_blank=False)
        ws.add_data_validation(dv)
        dv.add(ws.cell(r, 3))
        arr = opts_arr(d["opts"])
        base = f"MATCH(C{r},{arr},0)"
        if lev:
            v = lev_cells[lev[0]]
            f = f'=IF({v}="",{base},IF(ISNUMBER({v}),{v},MATCH({v},{arr},0)))'
        else:
            f = "=" + base
        ufmt = _opts_fmt(d["opts"])
        cells = [(5, f)]
    else:
        ufmt = FMT.get(fmt, fmt)
        cells = []
        for c_in, c_out in ((3, 5), (4, 6)) if city else ((3, 5),):
            a = f"{L(c_in)}{r}"
            if lev is None:
                f = f"={a}"
            else:
                key, mode = lev
                v = lev_cells.get(key)
                if mode == "abs":
                    f = f'=IF({v}="",{a},{v})'
                elif mode == "conj":
                    f = f'=IF({v}="",IF({P("conj_divide")}=1,{a},0),{v})'
                elif mode == "mult":
                    f = f"={a}*{P(key)}"
                else:
                    raise ValueError(mode)
            cells.append((c_out, f))
    for c, f in cells:
        x = ws.cell(r, c, f)
        x.number_format = ufmt
        x.font = font(GREEN if "Cenarios!" in f else BLACK)
        x.fill = F_TOT
    if not city:
        ws.cell(r, 6).fill = F_TIME


def _table(ws, d):
    ws.cell(d["r_title"], 1, d["title"]).font = font(bold=True)
    if d["note"]:
        ws.cell(d["r_title"], 9, d["note"]).font = font(GRAY, italic=True, size=9)
    for i, h in enumerate(d["cols"]):
        x = ws.cell(d["r_head"], 3 + i, h)
        x.font = font(bold=True, size=9)
        x.fill = F_TIME
        x.alignment = Alignment(horizontal="center")
    for key, lab, vals, fmt in d["rows"]:
        r = d["rr"][key]
        ws.cell(r, 1, lab).font = font()
        ws.cell(r, 1).alignment = Alignment(indent=1)
        for i, v in enumerate(vals):
            _input_cell(ws.cell(r, 3 + i), v, fmt or d["fmt"], False)


def _events(ws):
    h = EV["head"]
    heads = {1: "Descrição do evento", 3: "Valor (R$ hoje)", 4: "1ª data", 5: "Repetir a cada (anos; 0 = uma vez)",
             6: "Nº de vezes", 7: "Parcela dela", 11: "Mês nº", 12: "Intervalo (meses)", 13: "Último mês"}
    for c, t in heads.items():
        x = ws.cell(h, c, t)
        x.font = font(bold=True, size=9)
        x.fill = F_TIME
        x.alignment = Alignment(horizontal="center", wrap_text=True)
    ws.row_dimensions[h].height = 28
    ws.cell(h, 9, "Gastos que não estão nos R$ 15 mil: troca de carro, viagens grandes, ajuda à família, cursos. "
                  "Só valem até a aposentadoria.").font = font(GRAY, italic=True, size=9)
    for i, (desc, val, dte, rep, n, pct) in enumerate(EVENTS):
        r = EV["r1"] + i
        x = ws.cell(r, 1, desc or None)
        x.font = font(BLUE)
        x.fill = F_IN
        x.border = BOX
        for c, v, fm in ((3, val, "brl"), (4, dte, "date"), (5, rep, "int"), (6, n, "int"), (7, pct, "pct")):
            _input_cell(ws.cell(r, c), v, fm, False)
        ws.cell(r, 11, f'=IF(OR(C{r}="",D{r}=""),99999,{IDX(f"D{r}")})').number_format = FMT["int"]
        ws.cell(r, 12, f"=IF(N(E{r})>0,12*E{r},100000)").number_format = FMT["int"]
        ws.cell(r, 13, f"=K{r}+L{r}*(IF(N(E{r})>0,MAX(1,N(F{r})),1)-1)").number_format = FMT["int"]
        for c in (11, 12, 13):
            ws.cell(r, c).font = font(GRAY, size=9)
            ws.cell(r, c).fill = F_TOT
    for c in ("K", "L", "M"):
        ws.column_dimensions[c].width = 10


def values():
    """Dicionário {chave: valor de entrada} para a réplica em Python (verificação)."""
    out = {}
    for kind, d in SPEC:
        if kind == "it" and d["kind"] == "in":
            out[d["key"]] = d["v"]
            if d["vc"] is not None:
                out[d["key"] + "@c"] = d["vc"]
        elif kind == "tbl":
            for key, lab, vals, fmt in d["rows"]:
                out[key] = list(vals)
    out["events"] = [e for e in EVENTS if e[1]]
    return out
