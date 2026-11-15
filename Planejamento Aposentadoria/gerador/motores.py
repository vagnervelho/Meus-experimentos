# -*- coding: utf-8 -*-
"""Motores mensais (linhas = meses): Macro, Renda, Familia, Moradia e Fluxo_Mensal.

Convenções
  * Valores em R$ de hoje viram nominais multiplicando pelo índice de preços {Macro!idx} (mês 1 = 1,00).
  * Despesas compartilhadas com o cônjuge são calculadas pelo total do casal nas abas Moradia/Familia;
    a parte dela = total × (1 − parcela do cônjuge) é aplicada no Fluxo_Mensal.
  * Na aposentadoria (mês >= t_apos) param renda do trabalho e gastos da fase ativa; entra a meta de gasto.
"""
from fw import *
from premissas import IDX

NO = 99999


def build(sheets):
    M = MSheet(sheets["Macro"], "Macro", "MACRO — calendário, idade, juros, inflação e índices",
               "Uma linha por mês. Índice de preços: mês 1 = 1,00. Taxas mensais equivalentes às anuais.")
    R = MSheet(sheets["Renda"], "Renda", "RENDA — faturamento da PJ, tributos, INSS, IR, marketing e salário-maternidade",
               "Simples Nacional (Fator R), Lucro Presumido ou alíquota manual. Valores nominais (R$ correntes).")
    F = MSheet(sheets["Familia"], "Familia", "FAMÍLIA — casamento, filhos, licença-maternidade e plano de saúde",
               "Custos dos filhos e montagem da casa em valor TOTAL do casal; a parte dela é aplicada no Fluxo_Mensal.")
    H = MSheet(sheets["Moradia"], "Moradia", "MORADIA — aluguel, lar, compra do imóvel e financiamento (SAC / Price)",
               "Valores TOTAIS do casal (a parte dela é aplicada no Fluxo_Mensal). Nominais.")
    X = MSheet(sheets["Fluxo_Mensal"], "Fluxo_Mensal", "FLUXO DE CAIXA MENSAL DELA — entradas, saídas, sobra e patrimônio",
               "Valores nominais (R$ correntes), parte dela. Colunas 'R$ de hoje' no final. Uma linha por mês até os 100 anos.")
    macro(M)
    renda(R)
    familia(F)
    moradia(H)
    fluxo(X)
    return [M, R, F, H, X]


# ------------------------------------------------------------------------------------------- MACRO
def macro(M):
    M.time_cols()
    M.col("data", "Mês", "data", f"=EDATE({P('inicio')},{{t}}-1)", "date", 10)
    M.col("ano", "Ano", "ano", "=YEAR({data})", "int", 7)
    M.col("mes", "Mês do ano", "1-12", "=MONTH({data})", "int", 6)
    M.col("idm", "Idade em meses", "meses", f"=(YEAR({{data}})-YEAR({P('nasc')}))*12+MONTH({{data}})-MONTH({P('nasc')})", "int", 8)
    M.col("idade", "Idade (anos completos)", "anos", "=INT({idm}/12)", "int", 8)
    M.group("FASE E CIDADE")
    M.col("trab", "Fase ativa? (1 = trabalhando)", "flag", f"=IF({{t}}<{P('t_apos')},1,0)", "flag", 9,
          "1 até o mês anterior ao aniversário de aposentadoria; 0 depois.")
    M.col("cid", "Cidade no mês (1 = PV, 2 = Campinas)", "1/2", f"=IF(AND({P('cidade')}=2,{{t}}>={P('t_mud')}),2,1)", "int", 9)
    M.col("conj", "Parcela do cônjuge nas despesas compartilhadas", "%", f"=IF({{t}}>={P('t_cas')},{P('conj_pct')},0)", "pct", 9,
          "Vale a partir do casamento. Antes disso ela paga 100% do que for dela.")
    M.group("JUROS E INFLAÇÃO")
    M.col("cdi", "CDI do ano", "% a.a.", f"=IFERROR(INDEX({TB('cdi_curva')},MATCH({{ano}},{TB('ano_curva')},0)),{P('cdi_lp')})", "pct2", 8)
    M.col("ipca", "IPCA do ano", "% a.a.", f"=IFERROR(INDEX({TB('ipca_curva')},MATCH({{ano}},{TB('ano_curva')},0)),{P('ipca_lp')})", "pct2", 8)
    M.col("cdi_m", "CDI ao mês", "% a.m.", "=(1+{cdi})^(1/12)-1", "pct3", 8)
    M.col("ipca_m", "IPCA ao mês", "% a.m.", "=(1+{ipca})^(1/12)-1", "pct3", 8)
    M.col("idx", "Índice de preços (mês 1 = 1,00)", "índice", "=IF({t}=1,1,{idx|p}*(1+{ipca_m}))", "fac", 9,
          "Multiplica valores em R$ de hoje para obter o valor nominal do mês. Dividir por ele deflaciona.", init="1")
    M.col("rliq", "Rendimento líquido das aplicações", "% a.m.",
          f"={{cdi_m}}*{P('pct_cdi')}*(1-{P('ir_inv')})-((1+{P('custodia')})^(1/12)-1)", "pct3", 9,
          "CDI do mês × % do CDI × (1 − IR) − custódia. IR cobrado mês a mês (hipótese conservadora).")
    M.col("rreal", "Rendimento REAL líquido", "% a.m.", "=(1+{rliq})/(1+{ipca_m})-1", "pct3", 9)
    M.col("rdiv", "Taxa sobre saldo negativo", "% a.m.", f"=(1+{{rliq}})*(1+{P('spread_div')})^(1/12)-1", "pct3", 9,
          "Rendimento líquido + spread de crédito (padrão 0 = déficit corrigido pela mesma taxa das aplicações).")
    M.group("ÍNDICES AUXILIARES")
    M.col("ri", "Fator de reajuste do faturamento", "índice",
          f"=IF({{t}}=1,1,IF({{mes}}={P('mes_reaj')},{{idx}}*(1+{P('g_real')})^(({{t}}-1)/12),{{ri|p}}))", "fac", 9,
          "Reajuste anual: no mês de reajuste o faturamento repõe a inflação acumulada e soma o crescimento real.", init="1")
    M.col("gcum", "Crescimento acumulado das aplicações", "índice", "={gcum|p}*(1+{rliq})", "fac", 10,
          "G(t) = Π(1 + rendimento). Usado no cálculo do aporte adicional necessário.", init="1")
    M.col("ig", "Índice de preços ÷ crescimento acumulado", "fator", "={idx}/{gcum}", "fac", 9)
    M.col("esaude", "Inflação extra da saúde (acumulada)", "fator", f"=(1+{P('infl_saude')})^(({{t}}-1)/12)", "fac", 9)
    M.col("eedu", "Inflação extra da educação (acumulada)", "fator", f"=(1+{P('infl_edu')})^(({{t}}-1)/12)", "fac", 9)


# ------------------------------------------------------------------------------------------- RENDA
def renda(R):
    R.time_cols()
    R.group("FATURAMENTO")
    R.col("ri", "Fator de reajuste", "índice", "={Macro!ri}", "fac", 9)
    R.col("fpv", "Faturamento Porto Velho (base)", "R$", f"={P('fat_pv')}*{{ri}}", "brl", 11)
    R.col("fcps", "Faturamento Campinas (rampa de recomeço)", "R$",
          f"=IF({{t}}<{P('t_mud')},{{fpv}},({P('fat_cps_ini')}+({P('fat_cps_est')}-{P('fat_cps_ini')})"
          f"*MIN(1,({{t}}-{P('t_mud')})/(12*MAX(1/12,{P('anos_estab')}))))*{{ri}})", "brl", 11,
          "Antes da mudança: emprego de Porto Velho. Depois: começa no faturamento inicial e sobe em linha reta até o valor 'estabelecida'.")
    R.col("fbase", "Faturamento base da cidade escolhida", "R$", f"=IF({P('cidade')}=2,{{fcps}},{{fpv}})*{{Macro!trab}}", "brl", 11)
    R.col("lic", "Em licença-maternidade?", "flag", "={Familia!lic}", "flag", 8)
    R.col("fbase_ef", "Faturamento base após licença", "R$", f"={{fbase}}*IF({{lic}}=1,{P('lic_pct')},1)", "brl", 11)
    R.col("mkt_on", "Marketing ativo?", "flag", f"=IF(AND({{t}}>={P('t_mkt')},{{Macro!trab}}=1),1,0)", "flag", 8)
    R.col("mkt_anc", "Início da rampa do marketing", "mês nº",
          f"=IF(AND({P('cidade')}=2,{{t}}>={P('t_mud')}),MAX({P('t_mkt')},{P('t_mud')}),{P('t_mkt')})", "int", 8)
    R.col("mkt_rampa", "Maturidade do marketing", "%",
          f"=IF({{mkt_on}}=1,MIN(1,MAX(0,{{t}}-{{mkt_anc}}+1)/MAX(1,{P('mkt_rampa')})),0)", "pct", 8)
    R.col("fmkt", "Receita adicional do marketing", "R$",
          f"={P('mkt_consultas')}*{P('mkt_ticket')}*{{ri}}*{{mkt_rampa}}*IF({{lic}}=1,{P('lic_pct')},1)", "brl", 11)
    R.col("fb", "FATURAMENTO BRUTO TOTAL", "R$", "={fbase_ef}+{fmkt}", "brl", 12, bold=True)
    R.group("SIMPLES NACIONAL / LUCRO PRESUMIDO")
    R.col("cum", "Faturamento acumulado", "R$", "={cum|p}+{fb}", "brl", 12)
    R.col("rbt12", "Receita bruta dos 12 meses anteriores (RBT12)", "R$",
          f"=IF({{t}}<=13,{{cum|p}}+MAX(0,13-{{t}})*{PI('fat_pv')},{{cum|p}}-INDEX({{cum|c}},{{t}}-13))", "brl", 12,
          "Nos primeiros 12 meses completa com o faturamento atual (a PJ já existe).")
    R.col("rbt_tab", "RBT12 usada na tabela", "R$", f"=IF({P('simples_corr')}=1,{{rbt12}}/{{Macro!idx}},{{rbt12}})", "brl", 12,
          "Faixas corrigidas pela inflação = compara a RBT12 em R$ de hoje com a tabela atual.")
    R.col("faixa", "Faixa do Simples", "1-6", f"=MATCH({{rbt_tab}},{TB('s_lim')},1)", "int", 6)
    R.col("aliq_s", "Alíquota efetiva do Simples", "%",
          f"=IFERROR(MAX(0,({{rbt_tab}}*IF({P('anexo')}=3,INDEX({TB('s3n')},{{faixa}}),INDEX({TB('s5n')},{{faixa}}))"
          f"-IF({P('anexo')}=3,INDEX({TB('s3d')},{{faixa}}),INDEX({TB('s5d')},{{faixa}})))/{{rbt_tab}}),0)", "pct2", 9,
          "(RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12. Anexo III se Fator R ≥ 28%, senão Anexo V.")
    R.col("aliq_lp", "Alíquota do Lucro Presumido (sem adicional)", "%",
          f"={P('lp_pis')}+{P('lp_cofins')}+{P('lp_presuncao')}*({P('lp_irpj')}+{P('lp_csll')})+IF({{Macro!cid}}=2,{PC('iss')},{P('iss')})", "pct2", 9)
    R.col("trib", "Tributos sobre o faturamento (DAS ou PIS/COFINS/IRPJ/CSLL/ISS)", "R$",
          f"=CHOOSE({P('regime')},{{fb}}*{{aliq_s}},{{fb}}*{{aliq_lp}}+{P('lp_adic')}*MAX(0,{P('lp_presuncao')}*{{fb}}-{P('lp_adic_lim')}),"
          f"{{fb}}*{P('aliq_manual')})", "brl", 11)
    R.group("PRÓ-LABORE, INSS E IR")
    R.col("pl", "Pró-labore", "R$",
          f"=CHOOSE({P('regime')},{P('pl_pct')}*{{fb}},{P('pl_lp')}*{{Macro!idx}}*{{Macro!trab}},0)", "brl", 10)
    R.col("teto", "Teto do INSS", "R$", f"={P('teto_inss')}*{{Macro!idx}}", "brl", 9)
    R.col("inss", "INSS do sócio (11% até o teto)", "R$", f"={P('inss_aliq')}*MIN({{pl}},{{teto}})", "brl", 9)
    R.col("cpp", "INSS patronal 20% (só Lucro Presumido)", "R$", f"=IF({P('regime')}=2,0.2*{{pl}},0)", "brl", 9)
    R.col("pl_ref", "Pró-labore de referência (sem licença)", "R$",
          f"=CHOOSE({P('regime')},{P('pl_pct')}*{{fbase}},{P('pl_lp')}*{{Macro!idx}}*{{Macro!trab}},0)", "brl", 10)
    R.col("salmat", "Salário-maternidade (INSS)", "R$",
          f"=IF(AND({P('sal_mat')}=1,{{Familia!mat}}=1),MIN({{teto}},{{pl_ref}}),0)", "brl", 10,
          "4 meses por filho, limitado ao teto do INSS.")
    R.col("rend_r", "Rendimento tributável (R$ de hoje)", "R$ hoje", "=({pl}+{salmat})/{Macro!idx}", "brl", 10)
    R.col("base_r", "Base do IR (R$ de hoje)", "R$ hoje",
          f"=MAX(0,{{rend_r}}-MAX({{inss}}/{{Macro!idx}},{P('ir_simpl')}))", "brl", 10,
          "Rendimento − maior entre INSS e o desconto simplificado. Tabela suposta corrigida pela inflação.")
    R.col("irb_r", "IR pela tabela (R$ de hoje)", "R$ hoje",
          f"=MAX(0,{{base_r}}*INDEX({TB('ir_aliq')},MATCH({{base_r}},{TB('ir_lim')},1))-INDEX({TB('ir_ded')},MATCH({{base_r}},{TB('ir_lim')},1)))",
          "brl", 9)
    R.col("red_r", "Redução da Lei 15.270/2025 (R$ de hoje)", "R$ hoje",
          f"=IF({{rend_r}}<={P('ir_red_lim1')},MIN({{irb_r}},{P('ir_red_max')}),IF({{rend_r}}<={P('ir_red_lim2')},"
          f"MAX(0,MIN({{irb_r}},{P('ir_red_a')}-{P('ir_red_b')}*{{rend_r}})),0))", "brl", 9)
    R.col("irrf", "IR retido sobre pró-labore e salário-maternidade", "R$", "=MAX(0,{irb_r}-{red_r})*{Macro!idx}", "brl", 10)
    R.group("CUSTOS DA PJ")
    R.col("contab", "Contabilidade", "R$", f"={P('contador')}*{{Macro!idx}}*{{Macro!trab}}", "brl", 9)
    R.col("mkt_custo", "Marketing pessoal", "R$", f"=IF({{mkt_on}}=1,{P('mkt_valor')}*{{Macro!idx}},0)", "brl", 9)
    R.group("RESULTADO")
    R.col("trib_tot", "Total de tributos e INSS", "R$", "={trib}+{inss}+{cpp}+{irrf}", "brl", 11)
    R.col("custos_pj", "Contabilidade + marketing", "R$", "={contab}+{mkt_custo}", "brl", 10)
    R.col("liq", "RENDA LÍQUIDA DO TRABALHO (inclui salário-maternidade)", "R$", "={fb}-{trib_tot}-{custos_pj}+{salmat}",
          "brl", 12, bold=True)
    R.col("aliq_tot", "Carga total (tributos + INSS + IR) ÷ faturamento", "%", "=IFERROR({trib_tot}/{fb},0)", "pct", 9)
    R.col("dist", "Lucro distribuído (isento)", "R$", "={fb}-{trib}-{cpp}-{pl}-{custos_pj}", "brl", 10,
          "Desde 2026, distribuições acima de R$ 50 mil/mês por empresa sofrem retenção de 10% (alerta na aba Checks).")
    R.col("sc_r", "Salário de contribuição ao INSS (R$ de hoje)", "R$ hoje",
          "=IF({Macro!trab}=1,MIN({pl},{teto})/{Macro!idx},0)", "brl", 10)
    R.col("contrib", "Mês com contribuição ao INSS?", "flag", "=IF({pl}+{salmat}>0,1,0)", "flag", 8)


# ------------------------------------------------------------------------------------------- FAMÍLIA
def familia(F):
    F.time_cols()
    F.group("CASAMENTO")
    F.col("cas_pg", "Pagamento do casamento (total do casal)", "R$",
          f"=IF(AND({{t}}>{P('t_cas')}-MIN({P('cas_meses')},{P('t_cas')}),{{t}}<={P('t_cas')}),"
          f"{P('cas_valor')}/MIN({P('cas_meses')},{P('t_cas')})*{{Macro!idx}},0)", "brl", 11,
          "Distribuído nos N meses até o casamento.")
    F.col("cas_dela", "Casamento — parte dela", "R$", f"={{cas_pg}}*{P('cas_pct')}", "brl", 10)
    F.col("mont", "Montagem da casa (total do casal)", "R$", f"=IF({{t}}={P('t_mora')},{P('montagem')}*{{Macro!idx}},0)", "brl", 10)
    for k in (1, 2, 3):
        tf = P(f"t_f{k}")
        F.group(f"FILHO {k}")
        F.col(f"f{k}_id", f"Idade do filho {k}", "anos",
              f"=IF(AND({P('n_filhos')}>={k},{{t}}>={tf}),INT(({{t}}-{tf})/12),-1)", "int", 7, "-1 = ainda não nasceu / não existe.")
        F.col(f"f{k}_dep", "Dependente?", "flag",
              f"=IF(AND({{f{k}_id}}>=0,{{f{k}_id}}<{P('dep_ate')},{{Macro!trab}}=1),1,0)", "flag", 7,
              "Custos só na fase ativa dela; depois da aposentadoria a meta de gasto cobre tudo (há alerta se ainda houver dependente).")
        F.col(f"f{k}_b", "Faixa etária", "1-6", f"=IF({{f{k}_dep}}=1,MATCH({{f{k}_id}},{TB('band_lo')},1),0)", "int", 6)
        F.col(f"f{k}_vida", "Custos básicos + babá", "R$",
              f"=IF({{f{k}_dep}}=1,(INDEX({TB('basico')},{{f{k}_b}})+INDEX({TB('baba')},{{f{k}_b}}))"
              f"*IF({{Macro!cid}}=2,{P('fator_cps')},1)*{{Macro!idx}},0)", "brl", 10)
        F.col(f"f{k}_edu", "Escola / faculdade", "R$",
              f"=IF({{f{k}_dep}}=1,(IF({P('escola')}=1,IF({{Macro!cid}}=2,INDEX({TB('esc_cps')},{{f{k}_b}}),INDEX({TB('esc_pv')},{{f{k}_b}})),"
              f"INDEX({TB('esc_pub')},{{f{k}_b}}))+IF({P('faculdade')}=1,INDEX({TB('fac_pub')},{{f{k}_b}}),INDEX({TB('fac_part')},{{f{k}_b}})))"
              f"*{{Macro!idx}}*{{Macro!eedu}},0)", "brl", 10)
        F.col(f"f{k}_nasc", "Nascimento (parto, enxoval)", "R$",
              f"=IF(AND({P('n_filhos')}>={k},{{t}}={tf},{{Macro!trab}}=1),{P('custo_nasc')}*{{Macro!idx}},0)", "brl", 10)
        F.col(f"f{k}_plano", "Plano de saúde do filho", "R$",
              f"=IF({{f{k}_dep}}=1,IF({{Macro!cid}}=2,{PC('plano_filho')},{P('plano_filho')})"
              f"*INDEX({TB('ans_f')},MATCH({{f{k}_id}},{TB('ans_lo')},1))/INDEX({TB('ans_f')},1)*{{Macro!idx}}*{{Macro!esaude}},0)", "brl", 9)
        F.col(f"f{k}_tot", f"Total do filho {k}", "R$",
              f"=({{f{k}_vida}}+{{f{k}_edu}}+{{f{k}_nasc}}+{{f{k}_plano}})*{P('filho_mult')}", "brl", 10, bold=True)
        F.col(f"f{k}_lic", "Licença em curso?", "flag",
              f"=IF(AND({P('n_filhos')}>={k},{{t}}>={tf},{{t}}<{tf}+{P('licenca')}),1,0)", "flag", 7)
        F.col(f"f{k}_mat", "Salário-maternidade?", "flag",
              f"=IF(AND({P('n_filhos')}>={k},{{t}}>={tf},{{t}}<{tf}+4),1,0)", "flag", 7)
    F.group("TOTAIS DOS FILHOS")
    F.col("filhos_tot", "CUSTO TOTAL DOS FILHOS (casal)", "R$", "={f1_tot}+{f2_tot}+{f3_tot}", "brl", 11, bold=True)
    F.col("n_dep", "Nº de dependentes", "nº", "={f1_dep}+{f2_dep}+{f3_dep}", "int", 7)
    F.col("lic", "Licença em curso (algum filho)", "flag", "=MAX({f1_lic},{f2_lic},{f3_lic})", "flag", 7)
    F.col("mat", "Salário-maternidade (algum filho)", "flag", "=MAX({f1_mat},{f2_mat},{f3_mat})", "flag", 7)
    F.group("PLANO DE SAÚDE DELA")
    F.col("pl_on", "Plano próprio ativo?", "flag", f"=IF(AND({{t}}>={P('t_plano')},{{Macro!trab}}=1),1,0)", "flag", 7)
    F.col("pl_fx", "Fator da faixa etária (ANS)", "fator",
          f"=INDEX({TB('ans_f')},MATCH({{Macro!idade}},{TB('ans_lo')},1))/{P('ans_ref')}", "num2", 8,
          "Relativo à faixa 29–33 anos, em que o preço foi informado.")
    F.col("pl_val", "Plano de saúde dela", "R$",
          f"=IF({{pl_on}}=1,IF({{Macro!cid}}=2,{PC('plano_dela')},{P('plano_dela')})*{{pl_fx}}*{{Macro!idx}}*{{Macro!esaude}},0)", "brl", 10,
          bold=True)


# ------------------------------------------------------------------------------------------- MORADIA
def moradia(H):
    H.time_cols()
    H.group("ALUGUEL E LAR")
    H.col("alug_on", "Morando de aluguel?", "flag",
          f"=IF(AND({{t}}>={P('t_mora')},{{t}}<{P('t_compra')},{{Macro!trab}}=1),1,0)", "flag", 8)
    H.col("aluguel", "Aluguel", "R$", f"={{alug_on}}*IF({{Macro!cid}}=2,{PC('aluguel')},{P('aluguel')})*{{Macro!idx}}", "brl", 10)
    H.col("cond_a", "Condomínio + IPTU (alugado)", "R$",
          f"={{alug_on}}*IF({{Macro!cid}}=2,{PC('cond_alug')},{P('cond_alug')})*{{Macro!idx}}", "brl", 10)
    H.col("lar", "Custos do lar", "R$",
          f"=IF(AND({{t}}>={P('t_mora')},{{Macro!trab}}=1),IF({{Macro!cid}}=2,{PC('lar')},{P('lar')}),0)*{{Macro!idx}}", "brl", 10)
    H.col("mud", "Mudança para Campinas", "R$", f"=IF(AND({P('cidade')}=2,{{t}}={P('t_mud')}),{P('mud_custo')}*{{Macro!idx}},0)", "brl", 10)
    H.group("COMPRA DO IMÓVEL")
    H.col("compra", "Mês da compra?", "flag", f"=IF({{t}}={P('t_compra')},1,0)", "flag", 7)
    H.col("entrada_v", "Entrada", "R$", f"={{compra}}*{P('V_compra')}*{P('entrada')}", "brl", 11)
    H.col("itbi_v", "ITBI + registro", "R$", f"={{compra}}*{P('V_compra')}*{P('itbi_ativo')}", "brl", 10)
    H.col("reforma_v", "Reforma e mobília", "R$", f"={{compra}}*{P('reforma')}*{{Macro!idx}}", "brl", 10)
    H.col("fin", "Valor financiado", "R$", f"={{compra}}*{P('fin_valor')}", "brl", 11)
    H.group("FINANCIAMENTO")
    H.col("sd_ini", "Saldo devedor no início do mês", "R$", "={sd_fim|p}", "brl", 11)
    H.col("juros", "Juros", "R$", f"={{sd_ini}}*{P('i_fin_m')}", "brl", 10)
    H.col("amort", "Amortização", "R$",
          f"=IF({{sd_ini}}>0,IF({P('sistema')}=1,MIN({{sd_ini}},{P('A_sac')}),MIN({{sd_ini}},MAX(0,{P('PMT_price')}-{{juros}}))),0)", "brl", 10,
          "SAC: amortização constante. Price: prestação fixa − juros. Com amortização extra, o prazo encurta.")
    H.col("seguro", "Seguros MIP + DFI", "R$", f"={{sd_ini}}*{P('seguro')}", "brl", 9)
    H.col("prest", "PRESTAÇÃO (juros + amortização + seguros)", "R$", "={juros}+{amort}+{seguro}", "brl", 11, bold=True)
    H.col("extra", "Amortização extra", "R$",
          f"=IF(AND({{sd_ini}}-{{amort}}>0,{{Macro!conj}}<1),MIN({{sd_ini}}-{{amort}},{P('amort_extra')}*MAX(0,{{Fluxo_Mensal!sobra_pre}})"
          f"/(1-{{Macro!conj}})),0)", "brl", 10,
          "Parte da sobra dela; o cônjuge acompanha na mesma proporção.")
    H.col("quit", "Quitação na aposentadoria", "R$", f"=IF({{t}}={P('t_apos')}-1,MAX(0,{{sd_ini}}-{{amort}}-{{extra}}),0)", "brl", 10,
          "Se o financiamento passar dos 65 anos, o saldo é quitado com o patrimônio no último mês de trabalho.")
    H.col("sd_fim", "Saldo devedor no fim do mês", "R$", "={sd_ini}-{amort}-{extra}-{quit}+{fin}", "brl", 11)
    H.group("IMÓVEL PRÓPRIO")
    H.col("custo_prop", "IPTU + condomínio + manutenção", "R$",
          f"=IF(AND({{t}}>={P('t_compra')},{{Macro!trab}}=1),{P('custo_proprio_ativo')}*{{Macro!idx}},0)", "brl", 10)
    H.col("valor_merc", "Valor de mercado do imóvel", "R$",
          f"=IF({{t}}>={P('t_compra')},{P('V_compra')}*{{Macro!idx}}/INDEX({{Macro!idx|c}},{P('t_compra')})"
          f"*(1+{P('valoriz')})^(({{t}}-{P('t_compra')})/12),0)", "brl", 12)
    H.group("TOTAIS (CASAL)")
    H.col("mor_rec", "Moradia recorrente (aluguel + cond. + lar + mudança)", "R$", "={aluguel}+{cond_a}+{lar}+{mud}", "brl", 11)
    H.col("imov_one", "Desembolso na compra (entrada + ITBI + reforma)", "R$", "={entrada_v}+{itbi_v}+{reforma_v}", "brl", 11)
    H.col("comprom", "Prestação dela ÷ faturamento base dela", "%", "=IFERROR({prest}*(1-{Macro!conj})/{Renda!fbase},0)", "pct", 9,
          "Critério bancário usual: até 30% da renda bruta.")


# ------------------------------------------------------------------------------------------- FLUXO
def fluxo(X):
    X.time_cols(with_year=True)
    X.col("fase", "Fase", "", '=IF({Macro!trab}=1,"Trabalho","Aposentadoria")', "gen", 12)
    X.col("cidade", "Cidade", "", '=IF({Macro!cid}=2,"Campinas","Porto Velho")', "gen", 11)
    idx = "{Macro!idx}"
    conj = "(1-{Macro!conj})"
    X.group("ENTRADAS")
    X.col("fb", "Faturamento bruto", "R$", "={Renda!fb}", "brl", 11)
    X.col("trib", "(−) Tributos, INSS e IR", "R$", "={Renda!trib_tot}", "brl", 10)
    X.col("custos_pj", "(−) Contabilidade e marketing", "R$", "={Renda!custos_pj}", "brl", 10)
    X.col("salmat", "(+) Salário-maternidade", "R$", "={Renda!salmat}", "brl", 10)
    X.col("liq", "Renda líquida do trabalho", "R$", "={Renda!liq}", "brl", 11, bold=True)
    X.col("inss_ben", "Benefício do INSS (aposentadoria)", "R$", f"=IF({{t}}>={P('t_inss_ben')},{OUT['inss_final']}*{idx},0)", "brl", 10)
    X.col("ent", "TOTAL DE ENTRADAS", "R$", "={liq}+{inss_ben}", "brl", 11, bold=True)
    X.group("SAÍDAS (PARTE DELA)")
    X.col("g_pes", "Gastos pessoais", "R$",
          f"={{Macro!trab}}*IF({{Macro!cid}}=2,{PC('gasto_pes')},{P('gasto_pes')})*IF({{t}}>={P('t_cas')},1+{P('gasto_pes_cas')},1)*{idx}",
          "brl", 10)
    X.col("g_mor", "Aluguel, condomínio, lar e mudança", "R$", f"={{Moradia!mor_rec}}*{conj}", "brl", 10)
    X.col("g_imo1", "Imóvel: entrada, ITBI e reforma", "R$", f"={{Moradia!imov_one}}*{conj}", "brl", 11)
    X.col("g_prest", "Imóvel: prestações", "R$", f"={{Moradia!prest}}*{conj}", "brl", 10)
    X.col("g_prop", "Imóvel: IPTU, condomínio, manutenção", "R$", f"={{Moradia!custo_prop}}*{conj}", "brl", 10)
    X.col("g_cas", "Casamento e montagem da casa", "R$", f"={{Familia!cas_dela}}+{{Familia!mont}}*{conj}", "brl", 10)
    X.col("g_fil", "Filhos", "R$", f"={{Familia!filhos_tot}}*{conj}", "brl", 10)
    X.col("g_sau", "Plano de saúde dela", "R$", "={Familia!pl_val}", "brl", 10)
    X.col("g_ev", "Eventos extras", "R$",
          f"=SUMPRODUCT(({{t}}>={TB('ev_t')})*({{t}}<={TB('ev_last')})*(MOD({{t}}-{TB('ev_t')},{TB('ev_per')})=0)"
          f"*{TB('ev_val')}*{TB('ev_pct')})*{idx}*{{Macro!trab}}", "brl", 10)
    X.col("g_apo", "Gasto na aposentadoria (meta)", "R$", f"=IF({{Macro!trab}}=0,{P('meta')}*{idx},0)", "brl", 11)
    X.col("sai", "TOTAL DE SAÍDAS", "R$", "={g_pes}+{g_mor}+{g_imo1}+{g_prest}+{g_prop}+{g_cas}+{g_fil}+{g_sau}+{g_ev}+{g_apo}",
          "brl", 11, bold=True)
    X.col("sobra_pre", "Sobra antes da amortização extra", "R$", "={ent}-{sai}", "brl", 11)
    X.col("g_amx", "Amortização extra e quitação (parte dela)", "R$", f"=({{Moradia!extra}}+{{Moradia!quit}})*{conj}", "brl", 11)
    X.col("sobra", "SOBRA DO MÊS (aporte + / resgate −)", "R$", "={sobra_pre}-{g_amx}", "brl", 12, bold=True)
    X.group("INVESTIMENTOS")
    X.col("p_ini", "Saldo no início do mês", "R$", "={p_fim|p}", "brl", 12,
          "No mês 1 = patrimônio financeiro atual (aba Premissas).")
    X.col("rend", "Rendimento líquido", "R$", "=IF({p_ini}>=0,{p_ini}*{Macro!rliq},{p_ini}*{Macro!rdiv})", "brl", 10,
          "Saldo positivo rende o CDI líquido; saldo negativo (déficit) é corrigido pela taxa da coluna 'Taxa sobre saldo negativo' da aba Macro.")
    X.col("p_fim", "PATRIMÔNIO FINANCEIRO (fim do mês)", "R$", "={p_ini}+{rend}+{sobra}", "brl", 13, bold=True,
          init=P("pat_ini"))   # valor "anterior" lido por {p_fim|p} no mês 1
    X.col("p_real", "Patrimônio financeiro (R$ de hoje)", "R$ hoje", f"={{p_fim}}/{idx}", "brl", 12)
    X.group("META E LIQUIDEZ")
    X.col("k_real", "Capital necessário (R$ de hoje)", "R$ hoje",
          f"=IF({P('criterio')}=1,IF({P('r_real_lp_m')}>0,{OUT['w_net']}/{P('r_real_lp_m')},1E+12),"
          f"IF({P('r_real_lp_m')}=0,{OUT['w_net']}*MAX(1,12*{P('idade_lim')}-{{Macro!idm}}),"
          f"{OUT['w_net']}*(1-(1+{P('r_real_lp_m')})^(-MAX(1,12*{P('idade_lim')}-{{Macro!idm}})))/{P('r_real_lp_m')}))", "brl", 12,
          "Patrimônio que sustenta a meta líquida de INSS, pelo critério escolhido, se ela parasse neste mês.")
    X.col("k_nom", "Capital necessário (nominal)", "R$", f"={{k_real}}*{idx}", "brl", 12)
    X.col("ating", "Já atingiu o capital necessário?", "flag", "=IF(AND({Macro!trab}=1,{p_fim}>={k_nom}),1,0)", "flag", 8)
    X.col("reserva", "Reserva de emergência mínima", "R$",
          f"={P('reserva_meses')}*({{g_pes}}+{{g_mor}}+{{g_prest}}+{{g_prop}}+{{g_fil}}+{{g_sau}})", "brl", 11)
    X.col("abaixo_res", "Abaixo da reserva? (após 24 meses)", "flag",
          "=IF(AND({Macro!trab}=1,{t}>24,{p_fim}<{reserva}),1,0)", "flag", 8)
    X.col("p_min_aux", "Saldo na fase ativa (auxiliar do mínimo)", "R$ hoje", "=IF({Macro!trab}=1,{p_real},1E+15)", "brl", 11)
    X.col("esgot", "Patrimônio esgotado na aposentadoria?", "flag", "=IF(AND({Macro!trab}=0,{p_fim}<0),1,0)", "flag", 8)
    X.group("PATRIMÔNIO TOTAL")
    X.col("imov_dela", "Imóvel — parte dela (mercado)", "R$", f"={{Moradia!valor_merc}}*{conj}", "brl", 12)
    X.col("sd_dela", "Saldo devedor — parte dela", "R$", f"={{Moradia!sd_fim}}*{conj}", "brl", 12)
    X.col("pt", "PATRIMÔNIO TOTAL (financeiro + imóvel − dívida)", "R$", "={p_fim}+{imov_dela}-{sd_dela}", "brl", 13, bold=True)
    X.col("pt_real", "Patrimônio total (R$ de hoje)", "R$ hoje", f"={{pt}}/{idx}", "brl", 12)
    X.group("EM R$ DE HOJE (para o resumo anual e os gráficos)")
    for key, lab, expr in (("r_fb", "Faturamento bruto", "{fb}"), ("r_liq", "Renda líquida do trabalho", "{liq}"),
                           ("r_inss", "INSS", "{inss_ben}"), ("r_pes", "Gastos pessoais", "{g_pes}"),
                           ("r_mor", "Aluguel e lar", "{g_mor}"), ("r_imo", "Imóvel (tudo)", "({g_imo1}+{g_prest}+{g_prop}+{g_amx})"),
                           ("r_fil", "Filhos", "{g_fil}"), ("r_sau", "Saúde dela", "{g_sau}"),
                           ("r_cev", "Casamento e eventos", "({g_cas}+{g_ev})"), ("r_apo", "Gasto na aposentadoria", "{g_apo}"),
                           ("r_sobra", "Sobra do mês", "{sobra}"), ("r_rend", "Rendimento", "{rend}")):
        X.col(key, lab, "R$ hoje", f"={expr}/{idx}", "brl", 10)
