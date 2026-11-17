# -*- coding: utf-8 -*-
"""Motor de triagem: fluxo de caixa anual de 5 anos, em moeda constante (R$ reais).

Convenções
- Ano 0 = investimento (capex + capital de giro + pré-operacional). Anos 1..5 = operação.
- Tudo em termos reais: a TMA também é real. TIR nominal equivalente = (1+TIR real)*(1+IPCA)-1.
- Receita = volume x preço. Custos que acompanham o VOLUME (CMV, energia variável, insumos) não caem
  quando o preço cai; custos que acompanham a RECEITA (Simples, taxa de cartão/PIX, royalties,
  repasse ao condomínio) caem junto com ela.
- O tempo humano é custo: horas/semana x custo da hora (R$/h). "Autônomo" não significa tempo grátis.
- Valor residual no fim do ano 5 = valor de mercado dos ativos (% do capex) + devolução do giro.
"""
import numpy as np

ANOS = 5

# ---------------------------------------------------------------- Simples Nacional (LC 123, tabelas LC 155/2016)
SIMPLES = {
    "I":   [(180e3, .040, 0), (360e3, .073, 5940), (720e3, .095, 13860), (1.8e6, .107, 22500),
            (3.6e6, .143, 87300), (4.8e6, .190, 378000)],
    "II":  [(180e3, .045, 0), (360e3, .078, 5940), (720e3, .100, 13860), (1.8e6, .112, 22500),
            (3.6e6, .147, 85500), (4.8e6, .300, 720000)],
    "III": [(180e3, .060, 0), (360e3, .112, 9360), (720e3, .135, 17640), (1.8e6, .160, 35640),
            (3.6e6, .210, 125640), (4.8e6, .330, 648000)],
}
ISS_SHARE_III = [.335, .32, .325, .325, .335, 0.0]   # fatia do ISS dentro do DAS do Anexo III, por faixa


def aliquota_simples(rbt12, anexo):
    """Alíquota efetiva = (RBT12 x alíquota nominal - parcela a deduzir) / RBT12.
    anexo 'III_loc' = locação de bens móveis (Anexo III sem a parcela do ISS)."""
    if rbt12 <= 0:
        return 0.0
    base = "III" if anexo.startswith("III") else anexo
    for i, (teto, aliq, ded) in enumerate(SIMPLES[base]):
        if rbt12 <= teto:
            ef = (rbt12 * aliq - ded) / rbt12
            if anexo == "III_loc":
                ef *= (1 - ISS_SHARE_III[i])
            return ef
    return SIMPLES[base][-1][1]


# ---------------------------------------------------------------- matemática financeira
def vpl(taxa, fc):
    t = np.arange(len(fc))
    return float(np.sum(np.asarray(fc, float) / (1 + taxa) ** t))


def tir(fc):
    """TIR pelas raízes do polinômio em x = 1/(1+r). NaN se não houver raiz real com r em (-95%, 1000%)."""
    fc = np.asarray(fc, float)
    raizes = np.roots(fc[::-1])
    cand = [1 / x.real - 1 for x in raizes if abs(x.imag) < 1e-9 and x.real > 0]
    cand = [r for r in cand if -0.95 < r < 10]
    if not cand:
        return np.nan
    return min(cand, key=abs) if len(cand) > 1 else cand[0]


def tirm(fc, taxa_fin, taxa_reinv):
    """TIR modificada: saídas descontadas à taxa de financiamento, entradas capitalizadas à de reinvestimento."""
    fc = np.asarray(fc, float)
    n = len(fc) - 1
    t = np.arange(n + 1)
    pv_neg = np.sum(np.where(fc < 0, fc, 0) / (1 + taxa_fin) ** t)
    fv_pos = np.sum(np.where(fc > 0, fc, 0) * (1 + taxa_reinv) ** (n - t))
    if pv_neg >= 0 or fv_pos <= 0:
        return np.nan
    return (fv_pos / -pv_neg) ** (1 / n) - 1


def payback(fc):
    """Anos até o acumulado ficar >= 0, com interpolação linear dentro do ano. NaN = não paga em 5 anos."""
    fc = np.asarray(fc, float)
    cum = np.cumsum(fc)
    for t in range(1, len(fc)):
        if cum[t] >= 0 and fc[t] > 0:
            return t - 1 + (-cum[t - 1]) / fc[t]
    return np.nan


def rampa(base, atraso=0.0):
    """Curva de maturação: fator de utilização médio de cada ano (0..1+). Atraso em anos desloca a curva."""
    x = np.arange(0, ANOS + 1)
    y = np.concatenate([[0.0], np.asarray(base, float)])
    return np.interp(np.arange(1, ANOS + 1) - atraso, x, y)


# ---------------------------------------------------------------- projeção de uma ideia
CHOQUE_NEUTRO = dict(demanda=1.0, preco=1.0, capex=1.0, fixo=1.0, energia=1.0, atraso=0.0,
                     residual=1.0, horas=1.0, sinistros=None)


def projetar(p, g, choque=None):
    """p = premissas da ideia; g = premissas globais (TMA, custo da hora, IPCA); choque = multiplicadores.
    Retorna dict com séries anuais (anos 0..5) e indicadores."""
    c = dict(CHOQUE_NEUTRO)
    if choque:
        c.update(choque)
    capex = p["capex"] * c["capex"]
    giro = p.get("giro", 0.0) * c["demanda"]
    inv0 = capex + giro + p.get("preop", 0.0)

    r = rampa(p["rampa"], c["atraso"]) * c["demanda"]          # volume relativo à maturidade-base
    receita = p["receita_madura"] * r * c["preco"]
    # custos de volume: parte energia (sofre choque de tarifa) e parte outros
    cv = p["custo_vol_pct"] * p["receita_madura"] * r
    cv_energia = cv * p.get("energia_share_vol", 0.0) * c["energia"]
    cv_outros = cv * (1 - p.get("energia_share_vol", 0.0))
    # custos sobre receita (sem o Simples)
    cr = receita * p.get("custo_rec_pct", 0.0)
    # Simples Nacional sobre a receita do ano
    simples = np.array([receita[i] * aliquota_simples(receita[i], p["anexo"]) for i in range(ANOS)])
    # custos fixos: energia fixa + demais
    fx_energia = p.get("fixo_energia", 0.0) * c["energia"] * c["fixo"]
    fx_outros = (p["fixo_ano"] - p.get("fixo_energia", 0.0)) * c["fixo"]
    fixos = np.full(ANOS, fx_energia + fx_outros)
    # tempo humano
    horas = p["horas_semana"] * c["horas"]
    mao_obra = np.full(ANOS, horas * 52 * g["custo_hora"])
    # perda esperada com sinistro (furto, vandalismo, pane grave) — valor esperado no determinístico
    if c["sinistros"] is None:
        sinistro = np.full(ANOS, p.get("p_sinistro", 0.0) * p.get("custo_sinistro", 0.0))
    else:
        sinistro = np.asarray(c["sinistros"], float)
    ebitda = receita - cv_energia - cv_outros - cr - simples - fixos - mao_obra - sinistro
    manut = np.full(ANOS, capex * p.get("manut_pct", 0.0))
    manut[0] = 0.0                                             # garantia no 1º ano
    # giro acompanha a receita (simplificação: giro inicial proporcional à maturidade)
    giro_t = p.get("giro", 0.0) * r
    dgiro = np.diff(np.concatenate([[giro], giro_t]))
    fcl = ebitda - manut - dgiro
    # Valor residual no fim do ano 5 = o maior entre (a) liquidar os ativos e (b) continuar operando.
    # (a) liquidação: % do capex que o mercado paga pelos ativos usados;
    # (b) continuidade: fluxo do ano 5 (sem giro) por mais N anos de vida útil, a valor presente na TMA,
    #     com desconto de liquidez (negócio pequeno vende com deságio). Mesmo método para todas as ideias.
    tma = g["tma_real"]
    vt_liq = capex * p["residual_pct"]
    fc_estavel = ebitda[-1] - manut[-1]
    n_rest = p.get("vida_rest", 5)
    anuidade = (1 - (1 + tma) ** -n_rest) / tma if n_rest > 0 else 0.0
    vt_econ = max(0.0, fc_estavel) * anuidade * (1 - g.get("desagio_vt", 0.30))
    vt = max(vt_liq, vt_econ) * c["residual"]
    residual = vt + giro_t[-1]
    fc = np.concatenate([[-inv0], fcl])
    fc_vt = fc.copy()
    fc_vt[-1] += residual

    pv_vt = residual / (1 + tma) ** ANOS
    pv_entradas = float(np.sum(np.maximum(fcl, 0) / (1 + tma) ** np.arange(1, ANOS + 1))) + pv_vt
    out = dict(
        inv0=inv0, capex=capex, receita=receita, ebitda=ebitda, fcl=fcl, fc=fc, fc_vt=fc_vt, residual=residual,
        simples=simples, fixos=fixos, mao_obra=mao_obra, horas=horas,
        vpl=vpl(tma, fc_vt), tir=tir(fc_vt), tir_sem_vr=tir(fc),
        tirm=tirm(fc_vt, tma, g["taxa_reinv"]),
        pb=payback(fc), pb_desc=payback(fc / (1 + tma) ** np.arange(ANOS + 1)),
        roi=(fcl.sum() + residual - inv0) / inv0, moic=(fcl.sum() + residual) / inv0,
        margem_ebitda=ebitda[-1] / receita[-1] if receita[-1] else np.nan,
        receita_madura=receita[-1], vt_liq=vt_liq, vt_econ=vt_econ,
        dep_vt=pv_vt / pv_entradas if pv_entradas > 0 else np.nan,
    )
    out["tir_nominal"] = (1 + out["tir"]) * (1 + g["ipca"]) - 1 if not np.isnan(out["tir"]) else np.nan
    return out


def demanda_equilibrio(p, g, alvo="vpl"):
    """Multiplicador de demanda que zera o VPL (margem de segurança = 1 - resultado)."""
    lo, hi = 0.05, 3.0
    f = lambda m: projetar(p, g, dict(demanda=m))["vpl"]
    if f(hi) < 0:
        return np.nan
    if f(lo) > 0:
        return lo
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if f(mid) > 0:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)
