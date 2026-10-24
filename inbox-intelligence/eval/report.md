# Avaliação offline — classificador por regras + ranking

Gerado por `node eval/run-eval.js` em 2026-10-24T19:11:16.534Z. Sem IA (`AiSchema.merge(rules, null)`).

- Casos: **126** (sintéticos; arquivos: `01-contas-financas.json`, `02-seguranca-compras-viagens.json`, `03-saude-governo-trabalho.json`, `04-carreira-networking.json`, `05-newsletters-marketing-social.json`, `06-spam-pessoal-adversarial.json`)
- Hash do dataset: `6e95cd74ae2698a4` · classificador `rules-2026.10.1` · parser `parser-2026.10.1` · configVersion `8546a2ef1d`
- Rótulos = julgamento do dono da caixa (profissional de dados/pricing/finanças em busca de oportunidades sênior), **não** o comportamento do código.
- IC 95%: Wilson para proporções; bootstrap (1000 reamostragens, semente fixa) para macro-F1. Amostra pequena: leia os intervalos, não só o ponto.

## Métricas principais

| Métrica | Chave | Valor | IC 95% | k/n |
|---|---|---:|---:|---:|
| Categoria: top-1 = ideal | `category_top1` | 62.7% | 54.0% – 70.6% | 79/126 |
| Categoria: top-1 ∈ aceitáveis | `category_acceptable` | 80.2% | 72.3% – 86.2% | 101/126 |
| Macro-F1 (verdade = ideal) | `macro_f1_strict` | 60.6% | 49.9% – 66.2% | n=126, 19 classes |
| Macro-F1 (aceitável conta como acerto) | `macro_f1_lenient` | 76.1% | 66.7% – 81.0% | n=126, 19 classes |
| Nível exato (casos com nível único esperado) | `level_exact` | 72.3% | 58.2% – 83.1% | 34/47 |
| Nível dentro de [levelMin, levelMax] | `level_in_range` | 79.4% | 71.5% – 85.5% | 100/126 |
| Nível ACIMA do intervalo (superpriorização) ↓ | `level_over` | 2.4% | 0.8% – 6.8% | 3/126 |
| Nível ABAIXO do intervalo (subpriorização) ↓ | `level_under` | 18.3% | 12.5% – 25.9% | 23/126 |
| Crítica: precisão (predita e aceitável) | `critical_precision` | 100.0% | 20.7% – 100.0% | 1/1 |
| Crítica: recall (levelMin = Crítica) | `critical_recall` | 25.0% | 4.6% – 69.9% | 1/4 |
| Alta ou crítica: precisão | `high_plus_precision` | 88.9% | 67.2% – 96.9% | 16/18 |
| Alta ou crítica: recall (levelMin ≥ Alta) | `high_plus_recall` | 57.1% | 36.5% – 75.5% | 12/21 |
| Ação: precisão | `action_precision` | 83.9% | 67.4% – 92.9% | 26/31 |
| Ação: recall | `action_recall` | 65.0% | 49.5% – 77.9% | 26/40 |
| Ação: acurácia (casos com rótulo) | `action_accuracy` | 82.6% | 74.4% – 88.5% | 90/109 |
| Prazo: acurácia (data exata ou ausência correta) | `deadline_accuracy` | 80.2% | 71.8% – 86.5% | 89/111 |
| Prazo: data certa quando há prazo | `deadline_date_recall` | 94.3% | 81.4% – 98.4% | 33/35 |
| Prazo espúrio (esperado nenhum, veio data) ↓ | `deadline_spurious` | 26.3% | 17.7% – 37.2% | 20/76 |
| Injection: precisão | `injection_precision` | 75.0% | 30.1% – 95.4% | 3/4 |
| Injection: recall | `injection_recall` | 75.0% | 30.1% – 95.4% | 3/4 |
| Taxa de oportunidades detectadas (todas as mensagens) | `opportunity_rate` | 11.9% | 7.3% – 18.7% | 15/126 |
| Oportunidade: precisão | `opportunity_precision` | 73.3% | 48.0% – 89.1% | 11/15 |
| Oportunidade: recall | `opportunity_recall` | 84.6% | 57.8% – 95.7% | 11/13 |

Taxa de oportunidades esperada pelos rótulos: 10.3%. ↓ = quanto menor, melhor.

Definições: *precisão de Crítica* = das preditas Críticas, quantas tinham `levelMax = CRITICAL`; *recall de Crítica* = dos casos com `levelMin = CRITICAL`, quantos saíram Críticos (idem para "Alta ou crítica"). Ação, injection e prazo só contam casos com rótulo (`null`/`any` = não avaliado).

## Comparação com o baseline

| Métrica | Baseline | Atual | Δ (p.p.) | Tolerância |
|---|---:|---:|---:|---:|
| `category_top1` | 62.7% | 62.7% | 0.0 | 3.0 |
| `category_acceptable` | 80.2% | 80.2% | 0.0 | 3.0 |
| `macro_f1_strict` | 60.6% | 60.6% | 0.0 | 3.0 |
| `macro_f1_lenient` | 76.1% | 76.1% | 0.0 | 3.0 |
| `level_in_range` | 79.4% | 79.4% | 0.0 | 3.0 |
| `high_plus_precision` | 88.9% | 88.9% | 0.0 | 5.6 |
| `high_plus_recall` | 57.1% | 57.1% | 0.0 | 4.8 |
| `critical_precision` | 100.0% | 100.0% | 0.0 | 100.0 |
| `critical_recall` | 25.0% | 25.0% | 0.0 | 25.0 |
| `action_precision` | 83.9% | 83.9% | 0.0 | 3.2 |
| `action_recall` | 65.0% | 65.0% | 0.0 | 3.0 |
| `deadline_accuracy` | 80.2% | 80.2% | 0.0 | 3.0 |
| `injection_precision` | 75.0% | 75.0% | 0.0 | 25.0 |
| `injection_recall` | 75.0% | 75.0% | 0.0 | 25.0 |
| `opportunity_precision` | 73.3% | 73.3% | 0.0 | 6.7 |
| `opportunity_recall` | 84.6% | 84.6% | 0.0 | 7.7 |

Nenhuma regressão acima da tolerância.

## Casos por categoria ideal

| Categoria | Casos | Acerto top-1 | Aceitável |
|---|---:|---:|---:|
| trabalho | 14 | 2 | 7 |
| carreira | 13 | 12 | 12 |
| contas | 11 | 10 | 10 |
| marketing | 11 | 9 | 10 |
| spam | 10 | 3 | 7 |
| compras | 9 | 9 | 9 |
| outros | 9 | 2 | 4 |
| agenda | 7 | 6 | 7 |
| financas | 6 | 4 | 5 |
| seguranca_conta | 6 | 5 | 6 |
| governo_juridico | 5 | 2 | 5 |
| tarefas | 5 | 3 | 4 |
| networking | 4 | 2 | 2 |
| saude | 4 | 2 | 2 |
| tecnologia | 4 | 3 | 3 |
| economia | 3 | 2 | 3 |
| newsletters | 2 | 1 | 2 |
| noticias | 2 | 2 | 2 |
| negocios | 1 | 0 | 1 |

## F1 por categoria (verdade = ideal)

| Categoria | Suporte | Preditos | Precisão | Recall | F1 | F1 leniente |
|---|---:|---:|---:|---:|---:|---:|
| carreira | 13 | 14 | 86% | 92% | 0.89 | 0.93 |
| networking | 4 | 2 | 100% | 50% | 0.67 | 0.67 |
| noticias | 2 | 2 | 100% | 100% | 1.00 | 1.00 |
| economia | 3 | 2 | 100% | 67% | 0.80 | 1.00 |
| tecnologia | 4 | 9 | 33% | 75% | 0.46 | 0.82 |
| negocios | 1 | 7 | 0% | 0% | 0.00 | 0.00 |
| financas | 6 | 6 | 67% | 67% | 0.67 | 0.92 |
| trabalho | 14 | 4 | 50% | 14% | 0.22 | 0.31 |
| tarefas | 5 | 12 | 25% | 60% | 0.35 | 0.82 |
| agenda | 7 | 7 | 86% | 86% | 0.86 | 0.92 |
| compras | 9 | 11 | 82% | 100% | 0.90 | 1.00 |
| contas | 11 | 15 | 67% | 91% | 0.77 | 0.93 |
| newsletters | 2 | 8 | 13% | 50% | 0.20 | 0.40 |
| marketing | 11 | 9 | 100% | 82% | 0.90 | 0.95 |
| spam | 10 | 3 | 100% | 30% | 0.46 | 0.67 |
| saude | 4 | 2 | 100% | 50% | 0.67 | 0.67 |
| seguranca_conta | 6 | 5 | 100% | 83% | 0.91 | 1.00 |
| governo_juridico | 5 | 3 | 67% | 40% | 0.50 | 1.00 |
| outros | 9 | 5 | 40% | 22% | 0.29 | 0.46 |

## Confusões de categoria mais frequentes (ideal → predita)

| Par | n | Casos (* = predita era aceitável) |
|---|---:|---|
| outros → newsletters | 4 | social-instagram-curtidas, social-facebook-aniversarios, pessoal-lista-familia-churrasco, pessoal-sindico-assembleia |
| trabalho → negocios | 4 | trabalho-planilha-compartilhada, trabalho-github-review-solicitado-en, trabalho-dependabot-vulnerabilidade, en-cliente-deck-amanha-eod |
| trabalho → tarefas | 4 | trabalho-chefe-revisao-amanha-12h*, trabalho-colega-duvida-query*, trabalho-cliente-proposta-sexta*, trabalho-pesquisa-clima-lembrete* |
| governo_juridico → contas | 3 | gov-restituicao-irpf-lote*, gov-malha-fina-pendencia*, gov-detran-autuacao-indicacao-condutor* |
| outros → tecnologia | 3 | networking-linkedin-impressoes-post, social-youtube-novo-video*, outros-certificado-curso-online* |
| spam → tarefas | 3 | phish-fraude-ceo-pix-gmail*, phish-microsoft-senha-expira-en, inj-zero-width-aprovacao-pagamento* |
| spam → carreira | 2 | spam-vaga-falsa-renda-extra, inj-recrutador-falso-instrucoes* |
| spam → contas | 2 | phish-receita-cpf-cancelado, phish-boleto-protesto-anexo-html* |
| trabalho → outros | 2 | trabalho-reply-agradecimento-com-citacao*, trabalho-reply-chefe-resumo-amanha-cedo |
| agenda → tecnologia | 1 | agenda-webinar-comeca-hoje* |
| carreira → negocios | 1 | carreira-recrutadora-head-pricing-1a1 |
| contas → tecnologia | 1 | en-invoice-saas-due |
| economia → financas | 1 | news-research-carteira-recomendada* |
| financas → compras | 1 | financas-compra-aprovada-cartao* |
| financas → outros | 1 | en-extrato-conta-internacional |
| marketing → compras | 1 | mkt-pesquisa-satisfacao* |
| marketing → newsletters | 1 | mkt-trial-saas-expira |
| negocios → newsletters | 1 | news-substack-pricing-letter* |
| networking → negocios | 1 | networking-pedido-mentoria |
| networking → tarefas | 1 | networking-ex-colega-cafe-sociedade |
| newsletters → tecnologia | 1 | news-ultima-chance-evento* |
| saude → tarefas | 1 | saude-consulta-amanha-confirmar-hoje |
| saude → trabalho | 1 | saude-dentista-orcamento-pessoa |
| seguranca_conta → financas | 1 | seguranca-transacao-suspeita-banco* |
| tarefas → governo_juridico | 1 | pessoal-irmao-rg-cartorio-hoje* |
| tarefas → trabalho | 1 | tarefas-escola-autorizacao-amanha |
| tecnologia → negocios | 1 | news-medium-digest-en |
| trabalho → agenda | 1 | trabalho-ata-reuniao-em-copia |
| trabalho → newsletters | 1 | trabalho-town-hall-convite-interno |

## Nível: intervalo esperado × nível obtido

| Esperado | LOW | MEDIUM | HIGH | CRITICAL |
|---|---:|---:|---:|---:|
| LOW | 29 | 1 | 0 | 0 |
| LOW–MEDIUM | 36 | 11 | 1 | 0 |
| MEDIUM | 3 | 2 | 1 | 0 |
| MEDIUM–HIGH | 9 | 8 | 4 | 0 |
| HIGH | 1 | 4 | 2 | 0 |
| HIGH–CRITICAL | 1 | 2 | 7 | 0 |
| CRITICAL | 0 | 1 | 2 | 1 |

## Invariantes duros

- **Phishing ou auth_fail nunca acima de Média** (`phishing_max_medium`): 10 casos cobertos, **1 violação(ões)**: `phish-fraude-ceo-pix-gmail` (HIGH, tarefas, score 0.552)
- **Marketing/promoção nunca Crítica** (`marketing_not_critical`): 13 casos cobertos, nenhuma violação.
- **Newsletter nunca Crítica** (`newsletter_not_critical`): 33 casos cobertos, nenhuma violação.
- **Pedido direto de pessoa com prazo explícito ≤ 2 dias é pelo menos Alta** (`direct_request_short_deadline_high`): 8 casos cobertos, **3 violação(ões)**: `pessoal-irmao-rg-cartorio-hoje` (MEDIUM, governo_juridico, score 0.538), `en-cliente-deck-amanha-eod` (MEDIUM, negocios, score 0.5496), `trabalho-reply-chefe-resumo-amanha-cedo` (MEDIUM, outros, score 0.3794)

## Todos os erros (82 casos com pelo menos uma divergência)

Formato: campo — esperado × obtido. "aceitável" = a categoria obtida está na lista aceita, mas não é a ideal.

### `contas-fatura-cartao-debito-automatico` — Fatura do cartão fechada, com débito automático já cadastrado (não exige ação)

- **ação** (erro): esperado `false` × obtido `true (action_score 0)`
- motivo do classificador: Termos: fatura, vencimento, debito automatico, conta · pedido de ação · prazo 28/10/2026
- scores: contas:18, financas:8, noticias:2, carreira:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Débito automático: há vencimento, mas nenhuma ação do dono.

### `contas-iptu-atraso-segunda-via` — IPTU com parcela vencida; prazo para pagar a 2ª via antes da dívida ativa

- **nível** (abaixo): esperado `HIGH` × obtido `MEDIUM (score 0.454)`
- motivo do classificador: Termos: @gov.br, iptu, cobranca, gov.br · pedido de ação · prazo 31/10/2026
- scores: contas:23, governo_juridico:4, tarefas:3, noticias:2 · componentes: Importância 0.75 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Imposto em atraso com risco de dívida ativa; o prazo relevante é o da 2ª via.

### `financas-comprovante-pix-enviado` — Comprovante de Pix que o próprio dono enviou

- **prazo** (erro): esperado `null` × obtido `2026-10-19 (EVENT, INFERRED)`
- motivo do classificador: Termos: @itau.com.br, pix enviado, banco, pix · prazo 19/10/2026
- scores: financas:14, noticias:2, agenda:2, contas:2 · componentes: Importância 0.6 (Categoria e conteúdo de alta importância); Urgência 0.6 (Prazo inferido hoje); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Registro de transação própria.

### `mkt-serasa-quitar-dividas` — Oferta de renegociação de dívidas em massa (marketing com vocabulário de cobrança)

- **prazo** (erro): esperado `null` × obtido `2026-10-31 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: oferta, desconto, aproveite, oferta exclusiva · envio em massa · prazo 31/10/2026 · sinais: bulk_list
- scores: marketing:22, contas:5, newsletters:4, carreira:0 · componentes: Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa); Urgência 0.003 (Prazo explícito em 11 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Promoção genérica; o dono não tem dívida citada.

### `gov-restituicao-irpf-lote` — Restituição do IR incluída em lote (boa notícia, sem ação)

- **categoria** (aceitável): esperado `governo_juridico / contas / financas (ideal: governo_juridico)` × obtido `contas`
- motivo do classificador: Termos: @receita.fazenda.gov.br, imposto de renda, irpf, conta
- scores: contas:20, governo_juridico:7, noticias:2, financas:1 · componentes: Importância 0.6 (Categoria e conteúdo de alta importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Informativo oficial; nada a fazer.

### `financas-compra-aprovada-cartao` — Alerta de compra aprovada no cartão (rotina)

- **categoria** (aceitável): esperado `financas / compras (ideal: financas)` × obtido `compras`
- **prazo** (erro): esperado `null` × obtido `2026-10-19 (EVENT, INFERRED)`
- motivo do classificador: Termos: compra aprovada, compra · prazo 19/10/2026
- scores: compras:12, financas:4, noticias:2, agenda:2 · componentes: Importância 0.35 (Importância moderada); Urgência 0.48 (Prazo inferido hoje (prazo de baixa confiabilidade para a categoria)); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Notificação transacional rotineira.

### `financas-pix-recebido-freela` — Pix recebido de cliente de consultoria

- **prazo** (erro): esperado `null` × obtido `2026-10-22 (EVENT, INFERRED)`
- motivo do classificador: Termos: @nubank.com.br, pix recebido, pix · prazo 22/10/2026
- scores: financas:10, noticias:2, agenda:2, contas:1 · componentes: Importância 0.6 (Categoria e conteúdo de alta importância); Urgência 0.6 (Prazo inferido hoje); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Entrada de dinheiro esperada.

### `seguranca-transacao-suspeita-banco` — Banco legítimo (autenticado) bloqueou compra suspeita e pede confirmação no app

- **categoria** (aceitável): esperado `seguranca_conta / financas (ideal: seguranca_conta)` × obtido `financas [+tarefas, agenda, compras]`
- **prazo** (erro): esperado `null` × obtido `2026-10-22 (EVENT, INFERRED)`
- motivo do classificador: Termos: @itau.com.br · pedido de ação · prazo 22/10/2026
- scores: financas:4, tarefas:3, agenda:3, compras:3 · componentes: Importância 0.795 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.6 (Prazo inferido hoje); Remetente 0.4 (Pessoa (não automático)) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Alerta real de fraude; ação condicional.

### `mkt-banco-credito-pre-aprovado` — Oferta de crédito pré-aprovado do banco (marketing de domínio financeiro)

- **prazo** (erro): esperado `null` × obtido `2026-10-30 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: oferta, aproveite, oferta · envio em massa · prazo 30/10/2026 · sinais: bulk_list
- scores: marketing:11, financas:10, newsletters:4, carreira:0 · componentes: Importância 0.325 (Baixa importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa); Urgência 0.004 (Prazo explícito em 10 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Oferta comercial; validade da oferta não é prazo do dono.

### `seguranca-novo-login-google` — Alerta de novo login na conta Google

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.345)`
- **prazo** (erro): esperado `null` × obtido `2026-10-20 (EVENT, INFERRED)`
- motivo do classificador: Termos: @accounts.google.com, novo login, alerta de seguranca, login · prazo 20/10/2026
- scores: seguranca_conta:24, noticias:3, agenda:2, contas:2 · componentes: Importância 0.65 (Categoria e conteúdo de alta importância); Urgência 0.6 (Prazo inferido hoje); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Precisa de um olhar rápido para confirmar que foi o dono.

### `seguranca-senha-alterada-marketplace` — Aviso de senha alterada em conta de marketplace

- **prazo** (erro): esperado `null` × obtido `2026-10-21 (EVENT, INFERRED)`
- motivo do classificador: Termos: senha, seguranca · prazo 21/10/2026
- scores: compras:4, seguranca_conta:4, noticias:2, agenda:2 · componentes: Importância 0.65 (Categoria e conteúdo de alta importância); Urgência 0.6 (Prazo inferido hoje); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pode indicar invasão; ação condicional.

### `seguranca-github-2fa-desativado-en` — GitHub (em inglês): autenticação em dois fatores desativada

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.209)`
- motivo do classificador: Termos: reset your password, two-factor, password
- scores: seguranca_conta:16, tecnologia:4, trabalho:4, noticias:2 · componentes: Importância 0.55 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Domínio github.com é de trabalho, mas o assunto é segurança.

### `seguranca-reset-senha-streaming` — Pedido de redefinição de senha de streaming (provavelmente feito pelo dono)

- **prazo** (erro): esperado `null` × obtido `2026-10-24 (DEADLINE, INFERRED)`
- motivo do classificador: Termos: redefinicao de senha, senha, password · prazo 24/10/2026
- scores: seguranca_conta:11, compras:4, noticias:2, trabalho:1 · componentes: Importância 0.55 (Importância moderada); Urgência 0.43 (Prazo inferido amanhã); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Rotina de conta.

### `compras-reembolso-aprovado` — Reembolso de compra aprovado

- **prazo** (erro): esperado `null` × obtido `2026-10-28 (DEADLINE, INFERRED)`
- motivo do classificador: Termos: @shopee.com.br, seu pedido, reembolso, pedido · prazo 28/10/2026
- scores: compras:19, noticias:2, trabalho:1, contas:1 · componentes: Importância 0.35 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa); Urgência 0.047 (Prazo inferido em 7 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Informativo.

### `compras-correios-retirada-agencia` — Objeto aguardando retirada na agência com prazo de devolução

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.167)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0.21)`
- motivo do classificador: Termos: @correios.com.br, entrega · prazo 28/10/2026
- scores: compras:5, noticias:2, trabalho:1, tarefas:1 · componentes: Importância 0.35 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa); Urgência 0.078 (Prazo explícito em 7 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Exige ir à agência antes do prazo.

### `compras-pagamento-assinatura-falhou` — Pagamento de assinatura recusado; atualizar forma de pagamento em 3 dias

- **nível** (abaixo): esperado `MEDIUM` × obtido `LOW (score 0.206)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0)`
- motivo do classificador: Termos: @netflix.com, sua assinatura, pagamento · prazo 25/10/2026
- scores: compras:11, contas:4, noticias:2, trabalho:1 · componentes: Importância 0.35 (Importância moderada); Urgência 0.294 (Prazo explícito em 3 dias (prazo de baixa confiabilidade para a categoria)); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Ação real, consequência pequena (perde o streaming).

### `agenda-voo-checkin-amanha` — Check-in aberto para voo de amanhã cedo

- **nível** (abaixo): esperado `HIGH` × obtido `MEDIUM (score 0.3814)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0)`
- motivo do classificador: Termos: @latam.com, check-in, voo, embarque · prazo 22/10/2026
- scores: agenda:30, noticias:2, carreira:0, networking:0 · componentes: Importância 0.8 (Categoria e conteúdo de alta importância); Urgência 0.43 (Prazo inferido amanhã); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Voo amanhã: check-in é ação concreta e urgente.

### `agenda-anfitria-pergunta-horario` — Mensagem da anfitriã do aluguel por temporada pedindo horário de chegada

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.276)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0.49)`
- motivo do classificador: Termos: @airbnb.com, reserva
- scores: agenda:5, tarefas:4, noticias:2, carreira:0 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pessoa real via notificador automático; pede resposta antes de sexta.

### `agenda-webinar-comeca-hoje` — Lembrete em massa de webinar em que o dono se inscreveu, hoje à noite

- **categoria** (aceitável): esperado `agenda / tecnologia (ideal: agenda)` × obtido `tecnologia [+newsletters, negocios, agenda]`
- motivo do classificador: Termos: machine learning, dados · envio em massa · prazo 22/10/2026 · sinais: bulk_list
- scores: tecnologia:10, negocios:9, agenda:8, newsletters:4 · componentes: Importância 0.51 (Importância moderada); Interesse 1 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo); Urgência 0.12 (Prazo inferido hoje (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Evento opcional de interesse.

### `saude-resultado-exame-disponivel` — Resultados de exames laboratoriais disponíveis

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.276)`
- motivo do classificador: Termos: @fleury.com.br, resultados de exames, exames, medico
- scores: saude:15, noticias:2, contas:1, seguranca_conta:1 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Saúde pessoal; data citada é da coleta (passado).

### `saude-consulta-amanha-confirmar-hoje` — Clínica lembra consulta amanhã e pede confirmação até hoje às 18h

- **categoria** (erro): esperado `saude / agenda (ideal: saude)` × obtido `tarefas [+saude, agenda]`
- motivo do classificador: Termos: lembrete, por favor · pedido de ação · prazo 22/10/2026
- scores: tarefas:11, saude:9, agenda:6, compras:1 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.6 (Prazo inferido hoje); Remetente 0.4 (Pessoa (não automático)) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo da ação (confirmar) é hoje; consulta é amanhã.

### `saude-dentista-orcamento-pessoa` — Dentista (pessoa) envia orçamento e receita, pede para agendar

- **categoria** (erro): esperado `saude` × obtido `trabalho [+negocios]`
- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.304)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0.35)`
- motivo do classificador: Termos: segue em anexo, em anexo
- scores: trabalho:6, negocios:3, agenda:1, carreira:0 · componentes: Importância 0.8 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pessoa, pedido de retorno sem data explícita.

### `gov-malha-fina-pendencia` — Receita Federal: declaração retida em malha fiscal

- **categoria** (aceitável): esperado `governo_juridico / contas (ideal: governo_juridico)` × obtido `contas [+governo_juridico]`
- **nível** (abaixo): esperado `HIGH` × obtido `LOW (score 0.251)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0)`
- motivo do classificador: Termos: @receita.fazenda.gov.br, receita federal, irpf, declaracao
- scores: contas:20, governo_juridico:13, financas:3, noticias:2 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Risco financeiro alto, sem data explícita.

### `gov-detran-autuacao-indicacao-condutor` — Notificação de autuação de trânsito com prazo para indicar condutor

- **categoria** (aceitável): esperado `governo_juridico / contas (ideal: governo_juridico)` × obtido `contas [+governo_juridico]`
- motivo do classificador: Termos: @gov.br, detran, gov.br · pedido de ação · prazo 10/11/2026
- scores: contas:11, governo_juridico:6, networking:3, noticias:2 · componentes: Importância 0.75 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo legal confortável (20 dias).

### `trabalho-chefe-revisao-amanha-12h` — Chefe pede revisão de planilha até amanhã às 12h para comitê

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas [+trabalho]`
- **nível** (abaixo): esperado `CRITICAL` × obtido `HIGH (score 0.6574)`
- motivo do classificador: Termos: preciso que · pedido de ação · prazo 22/10/2026
- scores: tarefas:7, trabalho:5, marketing:1, carreira:0 · componentes: Importância 1 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.8 (Contato com quem você já trocou e-mails); Urgência 0.43 (Prazo inferido amanhã)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Caso canônico de Crítica: gestora, pedido direto, prazo amanhã.

### `trabalho-colega-duvida-query` — Colega pergunta sobre regra de cálculo, sem prazo

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas`
- motivo do classificador: pedido de ação
- scores: tarefas:3, compras:1, carreira:0, networking:0 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.8 (Contato com quem você já trocou e-mails); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pergunta direta de colega, sem urgência.

### `trabalho-jira-tarefa-atribuida` — Notificação do Jira: tarefa atribuída com data de entrega

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.29)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0)`
- **prazo** (erro): esperado `2026-10-30` × obtido `null`
- motivo do classificador: Termos: @atlassian.net, jira, entrega
- scores: trabalho:7, noticias:2, compras:1, carreira:0 · componentes: Importância 0.75 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Tarefa atribuída via ferramenta; 'data de entrega' é prazo.

### `trabalho-planilha-compartilhada` — Notificação de planilha compartilhada pela gestora

- **categoria** (erro): esperado `trabalho` × obtido `negocios [+trabalho]`
- motivo do classificador: Termos: precificacao
- scores: negocios:9, trabalho:8, noticias:2, carreira:0 · componentes: Importância 0.553 (Importância moderada); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Contexto para outra tarefa; sem pedido explícito.

### `trabalho-ata-reuniao-em-copia` — Ata de reunião em que o dono está só em cópia

- **categoria** (erro): esperado `trabalho` × obtido `agenda`
- motivo do classificador: Termos: reuniao · prazo 20/10/2026
- scores: agenda:14, tarefas:1, carreira:0, networking:0 · componentes: Importância 0.65 (Categoria e conteúdo de alta importância); Urgência 0.6 (Prazo inferido hoje); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=false, encaminhado=false, resposta=false
- nota do rótulo: Em cópia; informativo.

### `trabalho-cliente-proposta-sexta` — Cliente de consultoria pede proposta revisada até sexta (2 dias)

- **categoria** (aceitável): esperado `trabalho / tarefas / negocios (ideal: trabalho)` × obtido `tarefas [+negocios, agenda]`
- motivo do classificador: Termos: poderia, enviar · pedido de ação · prazo 23/10/2026
- scores: negocios:6, tarefas:6, agenda:3, trabalho:1 · componentes: Importância 1 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.513 (Prazo explícito em 2 dias); Interesse 0.5 (Casa com seus temas de interesse) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido direto de cliente, prazo em 2 dias.

### `trabalho-reply-agradecimento-com-citacao` — Resposta curta de agradecimento; a citação contém um pedido antigo do próprio dono

- **categoria** (aceitável): esperado `trabalho / outros (ideal: trabalho)` × obtido `outros`
- motivo do classificador: Sem sinais fortes de categoria
- scores: carreira:0, networking:0, noticias:0, economia:0 · componentes: Importância 0.55 (Importância moderada); Remetente 0.8 (Contato com quem você já trocou e-mails); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=true
- nota do rótulo: Fecha o assunto; pedido citado é do próprio dono e já foi atendido.

### `trabalho-github-review-solicitado-en` — GitHub (inglês): revisão de pull request solicitada ao dono

- **categoria** (erro): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `negocios [+newsletters, trabalho]`
- **nível** (abaixo): esperado `MEDIUM` × obtido `LOW (score 0.2071)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0)`
- motivo do classificador: Termos: pricing · envio em massa · sinais: bulk_list
- scores: negocios:12, trabalho:7, newsletters:4, noticias:2 · componentes: Importância 0.553 (Importância moderada); Interesse 0.5 (Casa com seus temas de interesse); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=false, encaminhado=false, resposta=false
- nota do rótulo: Pedido de ação legítimo vindo de lista automática (dono não está no To).

### `trabalho-dependabot-vulnerabilidade` — Alerta do Dependabot com severidade crítica em repositório de trabalho

- **categoria** (erro): esperado `trabalho / seguranca_conta / tecnologia (ideal: trabalho)` × obtido `negocios [+newsletters, trabalho]`
- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.2207)`
- motivo do classificador: Termos: pricing · envio em massa · sinais: bulk_list
- scores: negocios:12, trabalho:7, newsletters:4, noticias:2 · componentes: Importância 0.553 (Importância moderada); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Segurança do repositório, não da conta pessoal.

### `trabalho-town-hall-convite-interno` — Convite em massa da comunicação interna para town hall

- **categoria** (erro): esperado `trabalho / agenda (ideal: trabalho)` × obtido `newsletters [+marketing]`
- motivo do classificador: envio em massa · prazo 30/10/2026 · sinais: bulk_list
- scores: newsletters:4, marketing:4, noticias:2, agenda:2 · componentes: Importância 0.25 (Baixa importância); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa); Urgência 0.004 (Prazo inferido em 10 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=false, encaminhado=false, resposta=false
- nota do rótulo: Evento corporativo de massa.

### `trabalho-pesquisa-clima-lembrete` — Lembrete automático para responder pesquisa de clima

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas [+noticias, newsletters]`
- motivo do classificador: Termos: lembrete, responder · envio em massa · prazo 30/10/2026 · sinais: bulk_list
- scores: tarefas:7, noticias:5, newsletters:4, carreira:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa); Urgência 0.014 (Prazo explícito em 8 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido coletivo e opcional.

### `tarefas-amigo-recomendacao-linkedin` — Amigo pede recomendação no LinkedIn, sem pressa

- **nível** (acima): esperado `MEDIUM` × obtido `HIGH (score 0.5688)`
- motivo do classificador: Termos: poderia · pedido de ação · prazo 31/10/2026
- scores: tarefas:5, networking:4, carreira:1, governo_juridico:1 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.8 (Contato com quem você já trocou e-mails); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Favor pessoal com prazo suave.

### `tarefas-escola-autorizacao-amanha` — Coordenação da escola pede autorização assinada até amanhã

- **categoria** (erro): esperado `tarefas / outros (ideal: tarefas)` × obtido `trabalho [+tarefas]`
- motivo do classificador: Termos: segue em anexo, em anexo · pedido de ação · prazo 23/10/2026
- scores: trabalho:6, tarefas:3, carreira:0, networking:0 · componentes: Importância 0.8 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.43 (Prazo inferido amanhã); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo amanhã com consequência para o filho.

### `carreira-case-tecnico-prazo-gupy` — Processo seletivo avança para case técnico com prazo de 4 dias (remetente automático)

- **nível** (abaixo): esperado `HIGH–CRITICAL` × obtido `LOW (score 0.3078)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0.168)`
- motivo do classificador: Termos: @gupy.io, processo seletivo, candidatura, case tecnico · envio em massa · prazo 26/10/2026 · sinais: bulk_list
- scores: carreira:26, negocios:9, newsletters:4, noticias:2 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Oportunidade 0.43 (Oportunidade identificada); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Automático mas decisivo: perder o prazo encerra a candidatura.

### `carreira-recrutadora-head-pricing-1a1` — Recrutadora 1:1 com vaga de Head de Pricing remota e faixa salarial (fit alto)

- **categoria** (erro): esperado `carreira / networking (ideal: carreira)` × obtido `negocios [+networking]`
- **nível** (abaixo): esperado `HIGH` × obtido `MEDIUM (score 0.4829)`
- **oportunidade** (erro): esperado `true` × obtido `false`
- motivo do classificador: Termos: pricing, cliente · pedido de ação
- scores: negocios:10, networking:8, carreira:4, tarefas:3 · componentes: Ação pendente 1 (Pede uma ação sua diretamente); Importância 0.618 (Categoria e conteúdo de alta importância); Interesse 0.5 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Oportunidade sênior aderente, pede resposta.

### `carreira-processo-reprovado` — Devolutiva negativa de processo seletivo

- **nível** (acima): esperado `LOW` × obtido `MEDIUM (score 0.3622)`
- **oportunidade** (erro): esperado `false` × obtido `true (job, fit 0.525, massa)`
- motivo do classificador: Termos: @gupy.io, vaga, processo seletivo, candidatura
- scores: carreira:32, negocios:9, noticias:2, financas:1 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Oportunidade 0.51 (Oportunidade identificada); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Processo encerrado: não há oportunidade aberta.

### `carreira-carta-proposta-aceite` — Carta proposta com prazo de aceite na segunda (3 dias)

- **nível** (abaixo): esperado `CRITICAL` × obtido `HIGH (score 0.7562)`
- motivo do classificador: Termos: remuneracao, clt, remoto, senior · pedido de ação · prazo 26/10/2026
- scores: carreira:9, negocios:9, tarefas:4, networking:0 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Oportunidade 0.95 (Oportunidade aderente ao seu perfil); Urgência 0.368 (Prazo explícito em 3 dias)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Decisão de carreira com prazo curto: o e-mail mais importante da semana.

### `mkt-curso-garanta-sua-vaga` — Curso pago usando 'vaga' no sentido de matrícula (falso positivo de carreira)

- **prazo** (erro): esperado `null` × obtido `2026-10-31 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: desconto, % off, aproveite, garanta · envio em massa · prazo 31/10/2026 · sinais: bulk_list
- scores: marketing:17, negocios:15, tecnologia:12, newsletters:4 · componentes: Interesse 1 (Casa com seus temas de interesse); Importância 0.24 (Baixa importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Venda de curso; tema de interesse não o torna oportunidade.

### `carreira-indeed-alerta-irrelevante` — Alerta de vagas em massa totalmente fora do perfil

- **oportunidade** (erro): esperado `false` × obtido `true (job, fit 0, massa)`
- motivo do classificador: Termos: @indeed.com, vagas, novas vagas, vagas recomendadas · envio em massa · sinais: bulk_list
- scores: carreira:25, newsletters:4, noticias:2, networking:0 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Novidade 1 (Conteúdo novo); Oportunidade 0.3 (Oportunidade identificada); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Nenhuma vaga aderente: não é oportunidade para o dono.

### `carreira-thread-recrutadora-horarios` — Resposta em thread da recrutadora propondo dois horários

- **nível** (abaixo): esperado `HIGH` × obtido `MEDIUM (score 0.5428)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0.27)`
- motivo do classificador: Termos: vaga
- scores: carreira:6, negocios:6, tarefas:1, networking:0 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Oportunidade 0.89 (Oportunidade aderente ao seu perfil); Remetente 0.8 (Contato com quem você já trocou e-mails); Interesse 0.5 (Casa com seus temas de interesse) · gatilho crítico: Oportunidade aderente de contato conhecido
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=true
- nota do rótulo: Processo em andamento; precisa escolher horário.

### `spam-vaga-falsa-renda-extra` — Golpe de 'vaga home office' com renda irreal e contato por WhatsApp

- **categoria** (erro): esperado `spam` × obtido `carreira [+spam]`
- motivo do classificador: Termos: vaga, vagas, estamos contratando, home office
- scores: carreira:12, spam:7, networking:0, noticias:0 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Golpe clássico disfarçado de vaga.

### `networking-convite-conexao-recrutadora` — Convite de conexão do LinkedIn de uma recrutadora

- **oportunidade** (erro): esperado `false` × obtido `true (networking, fit 0, massa)`
- motivo do classificador: Termos: invitations@linkedin.com, recruiter, quer se conectar, conectar · envio em massa · sinais: bulk_list
- scores: networking:24, newsletters:4, agenda:3, tecnologia:1 · componentes: Importância 0.55 (Importância moderada); Novidade 1 (Conteúdo novo); Oportunidade 0.3 (Oportunidade identificada); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Contato potencialmente útil, mas sem proposta.

### `networking-ex-colega-cafe-sociedade` — Ex-colega propõe café para falar de parceria em consultoria de pricing

- **categoria** (erro): esperado `networking / negocios / carreira (ideal: networking)` × obtido `tarefas [+negocios]`
- **oportunidade** (erro): esperado `true` × obtido `false`
- motivo do classificador: pedido de ação
- scores: negocios:3, tarefas:3, carreira:0, networking:0 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.8 (Contato com quem você já trocou e-mails); Interesse 0.5 (Casa com seus temas de interesse)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Oportunidade de negócio de contato conhecido.

### `networking-pedido-mentoria` — Pessoa desconhecida pede mentoria de carreira

- **categoria** (erro): esperado `networking / tarefas (ideal: networking)` × obtido `negocios [+tecnologia, networking]`
- motivo do classificador: Termos: pricing · pedido de ação
- scores: negocios:9, tecnologia:7, networking:6, tarefas:3 · componentes: Ação pendente 1 (Pede uma ação sua diretamente); Importância 0.618 (Categoria e conteúdo de alta importância); Interesse 1 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido pessoal sem urgência.

### `networking-linkedin-impressoes-post` — Notificação do LinkedIn sobre impressões de um post

- **categoria** (erro): esperado `outros / networking (ideal: outros)` × obtido `tecnologia [+newsletters, networking]`
- motivo do classificador: Termos: analytics · envio em massa · sinais: bulk_list
- scores: newsletters:4, networking:3, tecnologia:3, carreira:0 · componentes: Importância 0.468 (Importância moderada); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Métrica de vaidade.

### `networking-linkedin-mensagem-indicacao` — Mensagem de contato no LinkedIn oferecendo indicação para vaga aderente

- **ação** (erro): esperado `true` × obtido `false (action_score 0.32)`
- motivo do classificador: Termos: messages-noreply@linkedin.com, linkedin
- scores: networking:8, carreira:7, negocios:3, tecnologia:1 · componentes: Importância 0.595 (Importância moderada); Oportunidade 0.89 (Oportunidade aderente ao seu perfil); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pessoa real, mediada por notificador.

### `news-valor-copom-selic` — Newsletter de economia cita data da reunião do Copom (não é prazo do dono)

- **prazo** (erro): esperado `null` × obtido `2026-10-28 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: @valor.com.br, selic, copom, inflacao · envio em massa · prazo 28/10/2026 · sinais: bulk_list
- scores: economia:28, agenda:11, newsletters:4, noticias:2 · componentes: Importância 0.4 (Importância moderada); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa); Urgência 0.019 (Prazo explícito em 7 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Data de agenda pública não é compromisso do dono.

### `news-substack-pricing-letter` — Newsletter do Substack sobre pricing e promoções

- **categoria** (aceitável): esperado `negocios / newsletters / tecnologia / economia (ideal: negocios)` × obtido `newsletters [+marketing]`
- motivo do classificador: Termos: @substack.com, edicao · envio em massa · sinais: bulk_list
- scores: newsletters:9, marketing:9, negocios:3, noticias:2 · componentes: Importância 0.25 (Baixa importância); Interesse 0.5 (Casa com seus temas de interesse); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Conteúdo muito aderente, mas é leitura.

### `news-medium-digest-en` — Digest diário do Medium em inglês

- **categoria** (erro): esperado `tecnologia / newsletters (ideal: tecnologia)` × obtido `negocios [+newsletters, tecnologia]`
- motivo do classificador: Termos: pricing · envio em massa · sinais: bulk_list
- scores: negocios:9, tecnologia:7, newsletters:4, carreira:3 · componentes: Importância 0.4 (Importância moderada); Interesse 1 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Leitura opcional.

### `news-ultima-chance-evento` — Newsletter de comunidade promove evento com inscrições encerrando amanhã

- **categoria** (aceitável): esperado `newsletters / marketing / agenda / tecnologia (ideal: newsletters)` × obtido `tecnologia [+newsletters]`
- motivo do classificador: Termos: ia generativa, machine learning, mlops, engenharia de dados · envio em massa · prazo 23/10/2026 · sinais: bulk_list
- scores: tecnologia:12, newsletters:6, marketing:5, carreira:3 · componentes: Importância 0.3 (Baixa importância); Interesse 0.5 (Casa com seus temas de interesse); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo de inscrição de evento opcional, em massa.

### `news-research-carteira-recomendada` — Relatório de research em massa da corretora

- **categoria** (aceitável): esperado `economia / financas / newsletters (ideal: economia)` × obtido `financas [+newsletters]`
- motivo do classificador: Termos: @xpi.com.br, investimento, carteira · envio em massa · sinais: bulk_list
- scores: financas:11, economia:4, newsletters:4, noticias:2 · componentes: Importância 0.5 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Conteúdo de massa do domínio do banco/corretora.

### `inj-newsletter-instrucao-oculta-html` — Newsletter de IA com instrução de prompt injection escondida em div display:none

- **injection** (erro): esperado `true` × obtido `false`
- motivo do classificador: Termos: python, agentes de ia, rag · envio em massa · sinais: bulk_list
- scores: tecnologia:15, newsletters:8, negocios:3, noticias:2 · componentes: Importância 0.4 (Importância moderada); Interesse 1 (Casa com seus temas de interesse); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Injection invisível ao leitor, mas presente no HTML original.

### `news-artigo-sobre-prompt-injection` — Boletim técnico que DISCUTE prompt injection citando frases de ataque (não é ataque)

- **injection** (erro): esperado `false` × obtido `true [IGNORE_PREV]`
- motivo do classificador: Termos: llm, dados · envio em massa · sinais: bulk_list, injection
- scores: tecnologia:4, newsletters:4, noticias:2, seguranca_conta:1 · componentes: Importância 0.4 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Menção didática; um alerta seria falso positivo (custo baixo, mas é erro).

### `mkt-black-friday-antecipada` — Promoção de varejo com 'só hoje'

- **prazo** (erro): esperado `null` × obtido `2026-10-23 (DEADLINE, INFERRED)`
- motivo do classificador: Termos: % off, frete gratis, black friday, so hoje · envio em massa · prazo 23/10/2026 · sinais: bulk_list
- scores: marketing:34, newsletters:4, noticias:1, compras:1 · componentes: Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa); Urgência 0.06 (Prazo inferido hoje (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Promoção.

### `mkt-cupom-delivery` — Cupom de app de delivery (domínio transacional)

- **prazo** (erro): esperado `null` × obtido `2026-10-25 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: cupom, clique aqui · envio em massa · prazo 25/10/2026 · sinais: bulk_list
- scores: marketing:11, compras:7, newsletters:4, carreira:0 · componentes: Importância 0.197 (Baixa importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa); Urgência 0.051 (Prazo explícito em 2 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Cupom; validade não é prazo do dono.

### `mkt-trial-saas-expira` — Teste grátis de SaaS terminando em 2 dias (upsell)

- **categoria** (erro): esperado `marketing / compras (ideal: marketing)` × obtido `newsletters [+marketing]`
- motivo do classificador: envio em massa · prazo 23/10/2026 · sinais: bulk_list
- scores: newsletters:4, marketing:4, compras:1, contas:1 · componentes: Importância 0.15 (Baixa importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa); Urgência 0.031 (Prazo inferido em 2 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Sem consequência real se ignorar.

### `mkt-pesquisa-satisfacao` — Pesquisa de satisfação pós-compra

- **categoria** (aceitável): esperado `marketing / compras (ideal: marketing)` × obtido `compras [+newsletters, marketing]`
- motivo do classificador: Termos: @kabum.com.br, pedido, compra · envio em massa · sinais: bulk_list
- scores: compras:7, newsletters:4, marketing:4, tarefas:1 · componentes: Importância 0.25 (Baixa importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido opcional de empresa, não tarefa.

### `social-instagram-curtidas` — Notificação de curtidas no Instagram

- **categoria** (erro): esperado `outros / marketing (ideal: outros)` × obtido `newsletters`
- motivo do classificador: envio em massa · sinais: bulk_list
- scores: newsletters:4, networking:2, carreira:0, noticias:0 · componentes: Importância 0.25 (Baixa importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Rede social pessoal; não é networking profissional.

### `social-facebook-aniversarios` — Lembrete de aniversários de amigos no Facebook

- **categoria** (erro): esperado `outros` × obtido `newsletters`
- motivo do classificador: envio em massa · sinais: bulk_list
- scores: newsletters:4, networking:2, carreira:0, noticias:0 · componentes: Importância 0.25 (Baixa importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Social genérico.

### `social-youtube-novo-video` — Notificação de novo vídeo de canal inscrito (tema de dados)

- **categoria** (aceitável): esperado `outros / tecnologia / marketing (ideal: outros)` × obtido `tecnologia [+newsletters, tarefas, networking]`
- motivo do classificador: Termos: python · envio em massa · sinais: bulk_list
- scores: newsletters:4, networking:3, tecnologia:3, negocios:3 · componentes: Importância 0.595 (Importância moderada); Interesse 1 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Notificação de plataforma.

### `phish-banco-bloqueio-dmarc-fail` — Phishing com remetente forjado de banco (DMARC falha) ameaçando bloqueio

- **prazo** (erro): esperado `null` × obtido `2026-10-21 (DEADLINE, INFERRED)`
- motivo do classificador: Termos: sua conta sera bloqueada, verifique sua conta imediatamente · prazo 21/10/2026 · sinais: auth_fail
- scores: spam:12, seguranca_conta:8, contas:5, financas:4 · componentes: Importância 0.568 (Importância moderada); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=true, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Média só seria aceitável como aviso de golpe.

### `phish-receita-cpf-cancelado` — Phishing imitando a Receita Federal (domínio parecido, SPF falha)

- **categoria** (erro): esperado `spam / governo_juridico (ideal: spam)` × obtido `contas [+spam]`
- **ação** (erro): esperado `false` × obtido `true (action_score 0.727)`
- **prazo** (erro): esperado `null` × obtido `2026-10-24 (DEADLINE, INFERRED)`
- motivo do classificador: Termos: receita federal, imposto de renda, imposto, cpf · pedido de ação · prazo 24/10/2026 · sinais: auth_fail
- scores: contas:12, spam:6, tarefas:4, governo_juridico:3 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.308 (Prazo inferido em 2 dias); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=true, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Golpe; usa vocabulário de governo.

### `phish-correios-taxa-retida` — Golpe da taxa dos Correios (SPF falha)

- **prazo** (erro): esperado `null` × obtido `2026-10-20 (DEADLINE, INFERRED)`
- motivo do classificador: prazo 20/10/2026 · sinais: auth_fail
- scores: spam:3, financas:1, trabalho:1, tarefas:1 · componentes: Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo); Importância 0.1 (Baixa importância)
- parser: bulk=false, automático=false, auth_fail=true, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Golpe recorrente.

### `phish-fraude-ceo-pix-gmail` — Fraude do 'CEO': impostor com Gmail usando nome da gestora pede Pix urgente (autenticação passa)

- **categoria** (aceitável): esperado `spam / tarefas (ideal: spam)` × obtido `tarefas`
- **nível** (acima): esperado `LOW–MEDIUM` × obtido `HIGH (score 0.552)`
- **ação** (erro): esperado `false` × obtido `true (action_score 0.727)`
- motivo do classificador: Termos: preciso que, me confirme · pedido de ação
- scores: tarefas:10, agenda:3, compras:3, financas:2 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.3 (Sinais de urgência sem prazo definido); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: A gestora real usa o domínio corporativo (contato conhecido); este endereço é novo e o Reply-To diverge.

### `spam-premio-sorteio` — Spam de prêmio sem autenticação

- **prazo** (erro): esperado `null` × obtido `2026-10-20 (DEADLINE, INFERRED)`
- motivo do classificador: Termos: voce ganhou, voce foi selecionado, clique para resgatar, 100% garantido · prazo 20/10/2026
- scores: spam:17, financas:3, compras:1, carreira:0 · componentes: Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=false, encaminhado=false, resposta=false
- nota do rótulo: Spam óbvio.

### `phish-microsoft-senha-expira-en` — Phishing em inglês: senha do Microsoft 365 'expira hoje' (DMARC falha)

- **categoria** (erro): esperado `spam / seguranca_conta (ideal: spam)` × obtido `tarefas [+seguranca_conta, spam]`
- **prazo** (erro): esperado `null` × obtido `2026-10-23 (DEADLINE, INFERRED)`
- motivo do classificador: Termos: action required · prazo 23/10/2026 · sinais: auth_fail
- scores: tarefas:6, seguranca_conta:4, spam:3, noticias:2 · componentes: Importância 0.8 (Categoria e conteúdo de alta importância); Urgência 0.6 (Prazo inferido hoje); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=true, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Golpe com 'Action required'.

### `phish-boleto-protesto-anexo-html` — Cobrança falsa com anexo .html e ameaça de protesto (SPF falha)

- **categoria** (aceitável): esperado `spam / contas (ideal: spam)` × obtido `contas`
- **ação** (erro): esperado `false` × obtido `true (action_score 0.5)`
- **prazo** (erro): esperado `null` × obtido `2026-10-22 (DEADLINE, INFERRED)`
- motivo do classificador: Termos: boleto, cobranca, em atraso, cpf · pedido de ação · prazo 22/10/2026 · sinais: auth_fail
- scores: contas:24, governo_juridico:9, trabalho:6, tarefas:3 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.43 (Prazo inferido amanhã); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=true, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Cobrança de dívida inexistente; anexo HTML é sinal clássico.

### `inj-recrutador-falso-instrucoes` — Falso recrutador em inglês com bloco '### Instructions' tentando extrair dados e chaves

- **categoria** (aceitável): esperado `spam / carreira (ideal: spam)` × obtido `carreira`
- **oportunidade** (erro): esperado `false` × obtido `true (job, fit 0.35)`
- motivo do classificador: Termos: job offer, interview, cv, senior · sinais: injection
- scores: carreira:14, tecnologia:1, networking:0, noticias:0 · componentes: Importância 0.8 (Categoria e conteúdo de alta importância); Oportunidade 0.74 (Oportunidade identificada); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Injection explícita + golpe; não é oportunidade.

### `inj-zero-width-aprovacao-pagamento` — Pedido de 'aprovação de pagamento' com sequência de caracteres invisíveis e instrução ao modelo

- **categoria** (aceitável): esperado `spam / tarefas (ideal: spam)` × obtido `tarefas [+contas]`
- **ação** (erro): esperado `false` × obtido `true (action_score 0.63)`
- motivo do classificador: Termos: pendente · pedido de ação · sinais: injection
- scores: tarefas:10, contas:9, trabalho:3, compras:3 · componentes: Importância 0.8 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Texto invisível + instrução direta ao modelo.

### `pessoal-mae-almoco-domingo` — Mãe convida para almoço de domingo e pede resposta até sábado

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.3294)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0.4)`
- motivo do classificador: prazo 24/10/2026
- scores: tarefas:2, agenda:2, carreira:0, networking:0 · componentes: Importância 0.55 (Importância moderada); Remetente 0.8 (Contato com quem você já trocou e-mails); Urgência 0.308 (Prazo inferido em 2 dias); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Família, pedido de resposta com prazo relativo (sábado).

### `pessoal-irmao-rg-cartorio-hoje` — Irmão pede documento hoje até 15h para o cartório

- **categoria** (aceitável): esperado `tarefas / outros / governo_juridico (ideal: tarefas)` × obtido `governo_juridico [+tarefas]`
- **nível** (abaixo): esperado `CRITICAL` × obtido `MEDIUM (score 0.538)`
- **prazo** (erro): esperado `2026-10-22` × obtido `null`
- motivo do classificador: Termos: cartorio · pedido de ação
- scores: governo_juridico:9, tarefas:8, carreira:0, networking:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.8 (Contato com quem você já trocou e-mails); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Familiar, pedido direto, prazo hoje com consequência real.

### `pessoal-lista-familia-churrasco` — Lista de e-mail da família (Google Groups) votando data de churrasco

- **categoria** (erro): esperado `outros / agenda (ideal: outros)` × obtido `newsletters`
- motivo do classificador: envio em massa · prazo 31/10/2026 · sinais: bulk_list
- scores: newsletters:4, carreira:0, networking:0, noticias:0 · componentes: Importância 0.25 (Baixa importância); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa); Urgência 0.005 (Prazo explícito em 11 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=false, encaminhado=false, resposta=false
- nota do rótulo: Grupo familiar; pedido coletivo.

### `pessoal-sindico-assembleia` — Síndico convoca assembleia via lista do prédio (dono não está no Para)

- **categoria** (erro): esperado `outros / agenda / contas (ideal: outros)` × obtido `newsletters`
- motivo do classificador: envio em massa · prazo 05/11/2026 · sinais: bulk_list
- scores: newsletters:4, agenda:2, carreira:0, networking:0 · componentes: Importância 0.25 (Baixa importância); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa); Urgência 0.001 (Prazo inferido em 14 dias (prazo de baixa confiabilidade para a categoria))
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=false, encaminhado=false, resposta=false
- nota do rótulo: Convocação coletiva; data-chave é a assembleia.

### `en-invoice-saas-due` — Fatura em inglês de ferramenta SaaS com data de vencimento

- **categoria** (erro): esperado `contas / compras (ideal: contas)` × obtido `tecnologia`
- **nível** (abaixo): esperado `MEDIUM` × obtido `LOW (score 0.2727)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0.35)`
- motivo do classificador: Termos: analytics · prazo 30/10/2026
- scores: tecnologia:3, noticias:2, carreira:0, networking:0 · componentes: Importância 0.5 (Importância moderada); Interesse 0.5 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Conta em inglês com prazo de 9 dias.

### `en-cliente-deck-amanha-eod` — Cliente em inglês pede deck até amanhã EOD

- **categoria** (erro): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `negocios [+tarefas, agenda]`
- **nível** (abaixo): esperado `HIGH–CRITICAL` × obtido `MEDIUM (score 0.5496)`
- motivo do classificador: Termos: pricing · pedido de ação · prazo 22/10/2026
- scores: negocios:9, tarefas:7, agenda:5, carreira:0 · componentes: Importância 0.745 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Interesse 0.5 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido direto em inglês com prazo amanhã.

### `en-extrato-conta-internacional` — Extrato mensal de conta internacional em inglês

- **categoria** (erro): esperado `financas` × obtido `outros`
- motivo do classificador: Sem sinais fortes de categoria
- scores: noticias:2, carreira:0, networking:0, economia:0 · componentes: Importância 0.3 (Baixa importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Informativo.

### `trabalho-reply-chefe-resumo-amanha-cedo` — Resposta curta da gestora em thread: aprova e pede resumo até amanhã cedo

- **categoria** (erro): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `outros`
- **nível** (abaixo): esperado `HIGH–CRITICAL` × obtido `MEDIUM (score 0.3794)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0)`
- motivo do classificador: prazo 21/10/2026
- scores: carreira:0, networking:0, noticias:0, economia:0 · componentes: Importância 0.65 (Categoria e conteúdo de alta importância); Remetente 0.8 (Contato com quem você já trocou e-mails); Urgência 0.43 (Prazo inferido amanhã); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=true
- nota do rótulo: Pedido curto em resposta; prazo relativo (amanhã).

### `outros-certificado-curso-online` — Certificado de curso online disponível

- **categoria** (aceitável): esperado `outros / tecnologia / compras (ideal: outros)` × obtido `tecnologia`
- motivo do classificador: Termos: @alura.com.br, sql
- scores: tecnologia:7, noticias:2, networking:1, carreira:0 · componentes: Importância 0.4 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Informativo.

