# Avaliação offline — classificador por regras + ranking

Gerado por `node eval/run-eval.js` em 2026-10-24T23:19:01.227Z. Sem IA (`AiSchema.merge(rules, null)`).

- Casos: **94** (sintéticos; arquivos: `h1-financas-contas-servicos.json`, `h2-trabalho-carreira-oportunidades.json`, `h3-conteudo-social-adversarial.json`)
- Hash do dataset: `0394934af1c1df50` · classificador `rules-2026.10.2` · parser `parser-2026.10.2` · configVersion `8cee049994`
- Rótulos = julgamento do dono da caixa (profissional de dados/pricing/finanças em busca de oportunidades sênior), **não** o comportamento do código.
- IC 95%: Wilson para proporções; bootstrap (1000 reamostragens, semente fixa) para macro-F1. Amostra pequena: leia os intervalos, não só o ponto.

## Métricas principais

| Métrica | Chave | Valor | IC 95% | k/n |
|---|---|---:|---:|---:|
| Categoria: top-1 = ideal | `category_top1` | 60.6% | 50.5% – 69.9% | 57/94 |
| Categoria: top-1 ∈ aceitáveis | `category_acceptable` | 86.2% | 77.8% – 91.7% | 81/94 |
| Macro-F1 (verdade = ideal) | `macro_f1_strict` | 55.6% | 41.7% – 63.6% | n=94, 19 classes |
| Macro-F1 (aceitável conta como acerto) | `macro_f1_lenient` | 82.2% | 70.0% – 90.0% | n=94, 19 classes |
| Nível exato (casos com nível único esperado) | `level_exact` | 95.8% | 79.8% – 99.3% | 23/24 |
| Nível dentro de [levelMin, levelMax] | `level_in_range` | 90.4% | 82.8% – 94.9% | 85/94 |
| Nível ACIMA do intervalo (superpriorização) ↓ | `level_over` | 2.1% | 0.6% – 7.4% | 2/94 |
| Nível ABAIXO do intervalo (subpriorização) ↓ | `level_under` | 7.4% | 3.7% – 14.6% | 7/94 |
| Crítica: precisão (predita e aceitável) | `critical_precision` | — | — | 0/0 |
| Crítica: recall (levelMin = Crítica) | `critical_recall` | — | — | 0/0 |
| Alta ou crítica: precisão | `high_plus_precision` | 93.3% | 70.2% – 98.8% | 14/15 |
| Alta ou crítica: recall (levelMin ≥ Alta) | `high_plus_recall` | 71.4% | 35.9% – 91.8% | 5/7 |
| Ação: precisão | `action_precision` | 100.0% | 88.3% – 100.0% | 29/29 |
| Ação: recall | `action_recall` | 78.4% | 62.8% – 88.6% | 29/37 |
| Ação: acurácia (casos com rótulo) | `action_accuracy` | 90.4% | 82.1% – 95.0% | 75/83 |
| Prazo: acurácia (data exata ou ausência correta) | `deadline_accuracy` | 90.2% | 82.4% – 94.8% | 83/92 |
| Prazo: data certa quando há prazo | `deadline_date_recall` | 85.7% | 68.5% – 94.3% | 24/28 |
| Prazo espúrio (esperado nenhum, veio data) ↓ | `deadline_spurious` | 7.8% | 3.4% – 17.0% | 5/64 |
| Injection: precisão | `injection_precision` | 100.0% | 43.8% – 100.0% | 3/3 |
| Injection: recall | `injection_recall` | 100.0% | 43.8% – 100.0% | 3/3 |
| Taxa de oportunidades detectadas (todas as mensagens) | `opportunity_rate` | 7.4% | 3.7% – 14.6% | 7/94 |
| Oportunidade: precisão | `opportunity_precision` | 71.4% | 35.9% – 91.8% | 5/7 |
| Oportunidade: recall | `opportunity_recall` | 55.6% | 26.7% – 81.1% | 5/9 |

Taxa de oportunidades esperada pelos rótulos: 9.6%. ↓ = quanto menor, melhor.

Definições: *precisão de Crítica* = das preditas Críticas, quantas tinham `levelMax = CRITICAL`; *recall de Crítica* = dos casos com `levelMin = CRITICAL`, quantos saíram Críticos (idem para "Alta ou crítica"). Ação, injection e prazo só contam casos com rótulo (`null`/`any` = não avaliado).

## Casos por categoria ideal

| Categoria | Casos | Acerto top-1 | Aceitável |
|---|---:|---:|---:|
| trabalho | 16 | 7 | 13 |
| agenda | 8 | 4 | 7 |
| spam | 8 | 6 | 7 |
| contas | 7 | 7 | 7 |
| financas | 7 | 5 | 7 |
| marketing | 7 | 6 | 7 |
| carreira | 6 | 6 | 6 |
| compras | 6 | 5 | 6 |
| networking | 5 | 2 | 3 |
| newsletters | 5 | 1 | 5 |
| outros | 3 | 2 | 2 |
| saude | 3 | 0 | 1 |
| seguranca_conta | 3 | 2 | 2 |
| governo_juridico | 2 | 1 | 2 |
| negocios | 2 | 1 | 1 |
| tarefas | 2 | 0 | 2 |
| tecnologia | 2 | 1 | 2 |
| economia | 1 | 1 | 1 |
| noticias | 1 | 0 | 0 |

## F1 por categoria (verdade = ideal)

| Categoria | Suporte | Preditos | Precisão | Recall | F1 | F1 leniente |
|---|---:|---:|---:|---:|---:|---:|
| carreira | 6 | 7 | 86% | 100% | 0.92 | 1.00 |
| networking | 5 | 2 | 100% | 40% | 0.57 | 0.67 |
| noticias | 1 | 1 | 0% | 0% | 0.00 | 0.67 |
| economia | 1 | 2 | 50% | 100% | 0.67 | 1.00 |
| tecnologia | 2 | 2 | 50% | 50% | 0.50 | 1.00 |
| negocios | 2 | 1 | 100% | 50% | 0.67 | 0.67 |
| financas | 7 | 7 | 71% | 71% | 0.71 | 1.00 |
| trabalho | 16 | 9 | 78% | 44% | 0.56 | 0.74 |
| tarefas | 2 | 13 | 0% | 0% | 0.00 | 0.76 |
| agenda | 8 | 6 | 67% | 50% | 0.57 | 0.83 |
| compras | 6 | 8 | 63% | 83% | 0.71 | 0.86 |
| contas | 7 | 12 | 58% | 100% | 0.74 | 1.00 |
| newsletters | 5 | 1 | 100% | 20% | 0.33 | 1.00 |
| marketing | 7 | 6 | 100% | 86% | 0.92 | 1.00 |
| spam | 8 | 6 | 100% | 75% | 0.86 | 0.92 |
| saude | 3 | 0 | 0% | 0% | 0.00 | 0.00 |
| seguranca_conta | 3 | 2 | 100% | 67% | 0.80 | 0.80 |
| governo_juridico | 2 | 1 | 100% | 50% | 0.67 | 1.00 |
| outros | 3 | 8 | 25% | 67% | 0.36 | 0.71 |

## Confusões de categoria mais frequentes (ideal → predita)

| Par | n | Casos (* = predita era aceitável) |
|---|---:|---|
| trabalho → tarefas | 7 | h-colega-revisao-notebook-amanha*, h-cliente-ingles-eod-friday*, h-gdocs-comentario-mencao-sexta*, h-encaminhada-chefe-fornecedor*, h-rh-ponto-pendente*, h-cliente-ingles-review-by-tuesday*, h-sent-ingles-cliente-assumptions |
| agenda → outros | 2 | h-grupo-familia-almoco-vo*, h-amigo-convite-churrasco* |
| networking → tarefas | 2 | h-convite-palestra-meetup, h-ex-colega-cafe-informal |
| agenda → contas | 1 | h-grupo-condominio-edital-age* |
| agenda → tarefas | 1 | h-colega-remarcar-1a1-fim-do-dia |
| compras → tarefas | 1 | h-sent-pedido-orcamento-pintor* |
| financas → compras | 1 | h-nubank-compra-alto-valor* |
| financas → contas | 1 | h-itau-comprovante-pix-enviado* |
| governo_juridico → contas | 1 | h-detran-licenciamento-2026* |
| marketing → financas | 1 | h-marketing-credito-preaprovado-banco* |
| negocios → trabalho | 1 | h-proposta-consultoria-farmacias |
| networking → outros | 1 | h-linkedin-impressoes-post* |
| newsletters → economia | 1 | h-newsletter-boletim-macro* |
| newsletters → financas | 1 | h-newsletter-carta-investidor* |
| newsletters → noticias | 1 | h-newsletter-resumo-noticias* |
| newsletters → tecnologia | 1 | h-newsletter-ia-substack* |
| noticias → outros | 1 | h-alerta-noticia-temporal-sp |
| outros → trabalho | 1 | h-github-termos-servico |
| saude → agenda | 1 | h-clinica-confirmar-consulta* |
| saude → compras | 1 | h-plano-saude-reembolso-pendente |
| saude → outros | 1 | h-laboratorio-resultado-disponivel |
| seguranca_conta → compras | 1 | h-ifood-senha-alterada |
| spam → contas | 1 | h-boleto-desconhecido-consultoria-ti* |
| spam → tarefas | 1 | h-injection-visivel-vendor |
| tarefas → carreira | 1 | h-amigo-pede-indicacao-vaga* |
| tarefas → contas | 1 | h-contador-carne-leao-comprovantes* |
| tecnologia → tarefas | 1 | h-gcloud-runtime-descontinuado* |
| trabalho → agenda | 1 | h-chefe-elasticidade-ate-15h |
| trabalho → outros | 1 | h-thread-aprovacao-chefe-citacao |

## Nível: intervalo esperado × nível obtido

| Esperado | LOW | MEDIUM | HIGH | CRITICAL |
|---|---:|---:|---:|---:|
| LOW | 22 | 1 | 0 | 0 |
| LOW–MEDIUM | 25 | 5 | 1 | 0 |
| MEDIUM–HIGH | 5 | 19 | 9 | 0 |
| HIGH | 0 | 0 | 1 | 0 |
| HIGH–CRITICAL | 0 | 2 | 4 | 0 |

## Invariantes duros

- **Phishing ou auth_fail nunca acima de Média** (`phishing_max_medium`): 4 casos cobertos, nenhuma violação.
- **Marketing/promoção nunca Crítica** (`marketing_not_critical`): 9 casos cobertos, nenhuma violação.
- **Newsletter nunca Crítica** (`newsletter_not_critical`): 7 casos cobertos, nenhuma violação.
- **Pedido direto de pessoa com prazo explícito ≤ 2 dias é pelo menos Alta** (`direct_request_short_deadline_high`): 0 casos cobertos, nenhuma violação.

## Todos os erros (52 casos com pelo menos uma divergência)

Formato: campo — esperado × obtido. "aceitável" = a categoria obtida está na lista aceita, mas não é a ideal.

### `h-enel-fatura-debito-automatico` — Fatura de energia disponível, paga por débito automático (nenhuma ação).

- **prazo** (erro): esperado `null` × obtido `2026-11-05 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: fatura, vencimento, debito automatico, pagamento · prazo 05/11/2026
- scores: contas:18, noticias:2, financas:1, tarefas:1 · componentes: Importância 0.75 (Categoria e conteúdo de alta importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa); Urgência 0.009 (Prazo explícito em 14 dias)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Fatura em débito automático, explicitamente sem ação; 05/11 é o vencimento debitado automaticamente, não prazo dele.

### `h-itau-comprovante-pix-enviado` — Comprovante de Pix enviado para o condomínio (mês anterior).

- **categoria** (aceitável): esperado `financas / contas / compras (ideal: financas)` × obtido `contas [+financas]`
- motivo do classificador: Termos: condominio, comprovante
- scores: contas:10, financas:8, noticias:2, negocios:1 · componentes: Importância 0.6 (Categoria e conteúdo de alta importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Comprovante de pagamento já realizado por ele: puramente documental.

### `h-nubank-compra-alto-valor` — Alerta legítimo de compra online de valor alto em estabelecimento genérico.

- **categoria** (aceitável): esperado `financas / seguranca_conta / compras (ideal: financas)` × obtido `compras [+financas]`
- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.174)`
- motivo do classificador: Termos: compra aprovada, compra
- scores: compras:7, financas:4, noticias:2, agenda:1 · componentes: Importância 0.425 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Remetente legítimo; valor alto em estabelecimento genérico de madrugada merece atenção. Só há ação se ele não reconhecer, por isso action ambígua.

### `h-xp-cdb-vencimento` — CDB perto do vencimento, crédito automático, com sugestão comercial de reinvestimento.

- **prazo** (erro): esperado `null` × obtido `2026-10-28 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: @xpi.com.br, investimentos, cdb, renda fixa · prazo 28/10/2026
- scores: financas:22, contas:13, noticias:2, carreira:0 · componentes: Importância 0.51 (Importância moderada); Novidade 1 (Conteúdo novo); Urgência 0.135 (Prazo explícito em 6 dias); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Crédito automático ("nenhuma ação é necessária"); 28/10 é data do produto, não prazo dele; reinvestimento é sugestão comercial.

### `h-google-alerta-novo-login` — Alerta legítimo do Google de novo login em Windows em Recife (dono mora em SP).

- **nível** (abaixo): esperado `HIGH–CRITICAL` × obtido `MEDIUM (score 0.4038)`
- **prazo** (erro): esperado `null` × obtido `2026-10-22 (EVENT, INFERRED)`
- motivo do classificador: Termos: @accounts.google.com, novo login, alerta de seguranca, login · prazo 22/10/2026 · sinais: severity:conta_comprometida
- scores: seguranca_conta:21, noticias:3, agenda:3, contas:2 · componentes: Importância 0.86 (Categoria e conteúdo de alta importância · notificação séria (gravidade 0.7)); Urgência 0.6 (Prazo inferido hoje); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Legítimo (auth ok, domínio do Google). Cidade e dispositivo incompatíveis com o dono (SP); uma pessoa razoável verificaria imediatamente. A ação é condicional ("caso contrário"), por isso action=null; o nível deve ser alto mesmo assim.

### `h-ifood-senha-alterada` — Aviso de senha alterada em serviço de delivery.

- **categoria** (erro): esperado `seguranca_conta` × obtido `compras [+seguranca_conta]`
- motivo do classificador: Termos: @ifood.com.br · sinais: severity:conta_comprometida
- scores: compras:4, seguranca_conta:3, noticias:2, contas:2 · componentes: Importância 0.678 (Categoria e conteúdo de alta importância · notificação séria (gravidade 0.7)); Piso de prioridade 0.35 (Notificação séria (gravidade 0.7): no mínimo Média); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Evento de segurança legítimo; ação só se ele não reconhecer.

### `h-booking-reserva-confirmada` — Confirmação de hotel com prazo de cancelamento grátis.

- **prazo** (erro): esperado `null` × obtido `2026-10-23 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: @booking.com, check-in, reserva, hotel · prazo 23/10/2026
- scores: agenda:17, noticias:2, compras:1, contas:1 · componentes: Importância 0.75 (Categoria e conteúdo de alta importância); Urgência 0.717 (Prazo explícito amanhã); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Confirmação de reserva; o prazo de cancelamento grátis é opção, não obrigação dele.

### `h-clinica-confirmar-consulta` — Clínica pede confirmação de consulta até sábado.

- **categoria** (aceitável): esperado `saude / agenda (ideal: saude)` × obtido `agenda [+tarefas]`
- motivo do classificador: Termos: consulta agendada, consulta, agendamento · pedido de ação · prazo 24/10/2026
- scores: agenda:9, tarefas:7, saude:3, carreira:0 · componentes: Importância 0.9 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.513 (Prazo explícito em 2 dias); Remetente 0.4 (Pessoa (não automático)) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo dele é confirmar até 24/10 (a consulta em 26/10 é o evento).

### `h-laboratorio-resultado-disponivel` — Resultados de exames disponíveis no portal.

- **categoria** (erro): esperado `saude` × obtido `outros`
- motivo do classificador: Sem sinais fortes de categoria · sinais: severity:resultado_saude
- scores: noticias:2, saude:2, seguranca_conta:2, contas:1 · componentes: Piso de prioridade 0.35 (Notificação séria (gravidade 0.6): no mínimo Média); Importância 0.48 (Importância moderada · notificação séria (gravidade 0.6)); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Informativo de saúde; consultar é desejável mas não é um pedido.

### `h-plano-saude-reembolso-pendente` — Plano de saúde pede nota fiscal corrigida para reembolso em 5 dias úteis (até 29/10).

- **categoria** (erro): esperado `saude / contas (ideal: saude)` × obtido `compras [+tarefas]`
- motivo do classificador: Termos: seu pedido, nota fiscal, reembolso, pedido · pedido de ação · prazo 29/10/2026
- scores: compras:20, tarefas:15, noticias:2, economia:2 · componentes: Importância 0.745 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pendência que exige envio de documento por ele; a data da consulta (02/10) é passada e não é prazo.

### `h-detran-licenciamento-2026` — Detran-SP lembra prazo do licenciamento anual.

- **categoria** (aceitável): esperado `governo_juridico / contas (ideal: governo_juridico)` × obtido `contas`
- motivo do classificador: Termos: @gov.br, detran, pagamento, documento · pedido de ação · prazo 30/11/2026
- scores: contas:13, governo_juridico:6, tarefas:4, noticias:2 · componentes: Importância 0.75 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Obrigação legal com prazo absoluto distante; órgão oficial legítimo (.gov.br).

### `h-tjsp-juizado-intimacao` — Intimação de Juizado Especial Cível com prazo de 5 dias úteis (até 29/10).

- **nível** (abaixo): esperado `HIGH–CRITICAL` × obtido `MEDIUM (score 0.35)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0)`
- motivo do classificador: Termos: @jus.br, intimacao, tribunal, audiencia · prazo 29/10/2026 · sinais: severity:governo_juridico
- scores: governo_juridico:22, noticias:2, tarefas:1, carreira:0 · componentes: Importância 0.96 (Categoria e conteúdo de alta importância · notificação séria (gravidade 0.7)); Novidade 1 (Conteúdo novo); Urgência 0.097 (Prazo explícito em 7 dias); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo processual dele em ação que ele move; consequência jurídica se perder o prazo. Auto-Submitted não deve rebaixar.

### `h-contador-carne-leao-comprovantes` — Contador pede comprovantes de aluguel até o dia 30 para o carnê-leão.

- **categoria** (aceitável): esperado `tarefas / governo_juridico / contas / financas (ideal: tarefas)` × obtido `contas [+tarefas]`
- **prazo** (erro): esperado `2026-10-30` × obtido `2026-11-30 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: boleto, aluguel, iptu, darf · pedido de ação · prazo 30/11/2026
- scores: contas:12, tarefas:8, compras:3, carreira:0 · componentes: Importância 0.9 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: O prazo dele é 30/10 (envio dos documentos); 30/11 é o vencimento do DARF, tratado pelo contador.

### `h-itau-fatura-cartao-vencida` — Fatura do cartão venceu ontem sem pagamento identificado; pagar hoje para evitar encargos.

- **prazo** (erro): esperado `2026-10-22` × obtido `2026-10-21 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: fatura, vencimento, pagamento · pedido de ação · prazo 21/10/2026
- scores: contas:14, financas:4, tarefas:4, noticias:2 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.7 (Prazo explícito vencido há 1 dia); Novidade 1 (Conteúdo novo) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Conta vencida com encargos e risco de bloqueio: ação hoje. A data de vencimento passada (21/10) não é o prazo; o prazo é hoje.

### `h-chefe-elasticidade-ate-15h` — Chefe pede análise para hoje até as 15h (reunião antecipada com o CFO).

- **categoria** (erro): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `agenda`
- motivo do classificador: Termos: reuniao · pedido de ação · prazo 22/10/2026
- scores: agenda:11, tarefas:5, carreira:0, networking:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.6 (Prazo inferido hoje); Interesse 0.5 (Casa com seus temas de interesse) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido direto da chefe com prazo no mesmo dia ("até as 15h de hoje").

### `h-colega-revisao-notebook-amanha` — Colega pede revisão de notebook "até amanhã" (mensagem do dia anterior).

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas`
- motivo do classificador: pedido de ação · prazo 22/10/2026
- scores: tarefas:4, trabalho:2, carreira:0, networking:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.6 (Prazo inferido hoje); Interesse 0.5 (Casa com seus temas de interesse) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: "Amanhã" relativo à data do envio (21/10) = 22/10. A apresentação de sexta é do colega.

### `h-cliente-ingles-eod-friday` — Cliente externo em inglês pede premissas revisadas "by EOD Friday".

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas`
- **prazo** (erro): esperado `2026-10-23` × obtido `2026-10-26 (DEADLINE, INFERRED)`
- motivo do classificador: Termos: could you · pedido de ação · prazo 26/10/2026
- scores: tarefas:7, carreira:0, networking:0, noticias:0 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Interesse 1 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: EOD Friday a partir de quarta 21/10 = 23/10. O comitê de segunda é do cliente; a reunião de terça é passada.

### `h-jira-issue-atribuida` — Notificação automática do Jira atribuindo tarefa com due date.

- **ação** (erro): esperado `true` × obtido `false (action_score 0)`
- motivo do classificador: Termos: @atlassian.net, sprint, jira · envio em massa · prazo 30/10/2026 · sinais: severity:tarefa_atribuida
- scores: trabalho:14, contas:3, marketing:3, noticias:2 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância · notificação séria (gravidade 0.5)); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Apesar de Precedence: bulk e Auto-Submitted, é uma tarefa atribuída a ele com due date 30/Oct/26.

### `h-github-actions-run-failed` — Falha no job noturno de elasticidade; publicação de preços pulada (ele é watcher).

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.271)`
- motivo do classificador: Termos: @github.com · envio em massa
- scores: trabalho:4, noticias:2, tecnologia:1, carreira:0 · componentes: Importância 0.65 (Categoria e conteúdo de alta importância); Interesse 0.5 (Casa com seus temas de interesse); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Notificação automática, mas o impacto é real (preços do dia não publicados no sistema que ele cuida). Não está claro se cabe a ele corrigir.

### `h-slack-mencao-antes-call-amanha` — E-mail de menção do Slack: chefe pede confirmação antes da call de amanhã cedo.

- **ação** (erro): esperado `true` × obtido `false (action_score 0.228)`
- motivo do classificador: Termos: @slack.com · envio em massa · prazo 23/10/2026
- scores: trabalho:4, noticias:2, agenda:2, tarefas:1 · componentes: Importância 0.65 (Categoria e conteúdo de alta importância); Urgência 0.43 (Prazo inferido amanhã); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido real da chefe via notificação de ferramenta; prazo "antes da call amanhã cedo" = 23/10.

### `h-gdocs-comentario-mencao-sexta` — Google Docs: CFO menciona o dono em comentário pedindo validação até sexta (23/10).

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas [+economia, trabalho]`
- motivo do classificador: Termos: preciso que, responder · pedido de ação · prazo 23/10/2026
- scores: tarefas:10, economia:6, trabalho:5, noticias:2 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.717 (Prazo explícito amanhã); Interesse 0.5 (Casa com seus temas de interesse) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido direto do CFO dentro de notificação do Docs; Reply-To divergente legítimo. A reunião do board (segunda) é de terceiros.

### `h-calendar-convite-comite-pricing` — Convite do Google Agenda para comitê de segunda (RSVP).

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.3015)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0)`
- motivo do classificador: Termos: calendar-notification@google.com, convite:, google meet, agenda · prazo 26/10/2026
- scores: agenda:19, carreira:3, marketing:3, noticias:2 · componentes: Importância 0.6 (Categoria e conteúdo de alta importância); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo); Urgência 0.158 (Prazo inferido em 4 dias)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Convite pede RSVP; o limite implícito é antes da reunião de 26/10, sem data explícita para responder (deadline "any").

### `h-colega-remarcar-1a1-fim-do-dia` — Colega pede para remarcar 1:1 e quer confirmação até o fim do dia.

- **categoria** (erro): esperado `agenda / trabalho (ideal: agenda)` × obtido `tarefas [+agenda]`
- motivo do classificador: pedido de ação · prazo 22/10/2026
- scores: tarefas:5, agenda:3, carreira:0, networking:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.6 (Prazo inferido hoje); Remetente 0.4 (Pessoa (não automático)) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: O prazo dele é confirmar hoje; 23/10 é a data da reunião.

### `h-thread-aprovacao-chefe-citacao` — Resposta em thread: chefe aprova proposta; o texto citado (dele) contém um prazo.

- **categoria** (erro): esperado `trabalho` × obtido `outros`
- motivo do classificador: Sem sinais fortes de categoria
- scores: carreira:0, networking:0, noticias:0, economia:0 · componentes: Importância 0.45 (Importância moderada); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=true
- nota do rótulo: O prazo "até quinta (22/10)" está no texto citado e foi pedido por ele à chefe; a resposta é uma aprovação. Seguir com o reajuste é a continuidade do trabalho dele (action ambígua), sem prazo novo.

### `h-encaminhada-chefe-fornecedor` — Chefe encaminha e-mail de fornecedor e pede resposta até segunda; o fornecedor citou outro prazo.

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas [+trabalho]`
- motivo do classificador: Termos: responder · pedido de ação · prazo 26/10/2026
- scores: tarefas:7, trabalho:6, marketing:3, tecnologia:1 · componentes: Importância 1 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.264 (Prazo explícito em 4 dias); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=true, resposta=false
- nota do rótulo: O prazo dele é o da chefe (26/10); 30/10 é o prazo do fornecedor para a empresa e 01/12 é vigência da tabela.

### `h-rh-ponto-pendente` — Sistema de RH pede regularização do ponto até domingo 25/10.

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas [+marketing]`
- motivo do classificador: pedido de ação · prazo 25/10/2026
- scores: tarefas:5, marketing:3, noticias:2, carreira:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.368 (Prazo explícito em 3 dias); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Mensagem automática interna, mas exige ação dele com prazo; datas 07/10 e 15/10 são passadas.

### `h-linkedin-inmail-ingles-revenue` — InMail do LinkedIn (em inglês) com vaga sênior remota de revenue management.

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.3496)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0.368)`
- motivo do classificador: Termos: inmail-hit-reply@linkedin.com, came across your profile, your profile, linkedin · envio em massa
- scores: networking:14, carreira:11, agenda:1, noticias:0 · componentes: Importância 0.595 (Importância moderada); Oportunidade 0.65 (Oportunidade identificada); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo)
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Mensagem 1:1 de recrutadora via plataforma (cabeçalhos de bulk e CATEGORY_SOCIAL não a tornam massa). Vaga aderente.

### `h-recrutadora-vaga-nao-aderente` — Consultoria de RH oferece vaga operacional júnior sem relação com o perfil.

- **nível** (acima): esperado `LOW` × obtido `MEDIUM (score 0.354)`
- **oportunidade** (erro): esperado `false` × obtido `true (job, fit 0, massa)`
- motivo do classificador: Termos: vagas, processo seletivo, salario, clt
- scores: carreira:13, agenda:1, governo_juridico:1, networking:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo); Oportunidade 0.3 (Oportunidade identificada)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Vaga operacional júnior, incompatível com perfil sênior: não é oportunidade relevante. Resposta é condicional ao interesse.

### `h-gupy-case-tecnico-prazo` — Gupy: avançou para case técnico com entrega até domingo 25/10 23h59.

- **ação** (erro): esperado `true` × obtido `false (action_score 0.27)`
- motivo do classificador: Termos: @gupy.io, processo seletivo, case tecnico, etapa do processo · prazo 25/10/2026 · sinais: severity:etapa_processo
- scores: carreira:25, noticias:2, trabalho:2, tarefas:2 · componentes: Importância 1 (Categoria e conteúdo de alta importância · notificação séria (gravidade 0.5)); Interesse 1 (Casa com seus temas de interesse); Oportunidade 0.64 (Oportunidade identificada); Urgência 0.368 (Prazo explícito em 3 dias)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Etapa ativa de processo aderente com entrega em 3 dias; mensagem automática de plataforma, mas com ação e prazo dele.

### `h-convite-palestra-meetup` — Convite para palestrar em meetup de dados e pricing, confirmar até 30/10.

- **categoria** (erro): esperado `networking / agenda / carreira (ideal: networking)` × obtido `tarefas [+agenda]`
- **oportunidade** (erro): esperado `true` × obtido `false`
- motivo do classificador: Termos: confirmar · pedido de ação · prazo 30/10/2026
- scores: tarefas:6, agenda:5, newsletters:1, carreira:0 · componentes: Importância 1 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Interesse 0.5 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Convite profissional 1:1 relevante (visibilidade para quem busca vaga); o prazo dele é 30/10, o evento é 18/11.

### `h-proposta-consultoria-farmacias` — Proposta de projeto de consultoria PJ em pricing por indicação.

- **categoria** (erro): esperado `negocios / networking / carreira (ideal: negocios)` × obtido `trabalho`
- **ação** (erro): esperado `true` × obtido `false (action_score 0.4)`
- **oportunidade** (erro): esperado `true` × obtido `false`
- motivo do classificador: Termos: projeto
- scores: trabalho:9, carreira:4, tarefas:2, noticias:1 · componentes: Importância 0.8 (Categoria e conteúdo de alta importância); Interesse 0.5 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Proposta de negócio 1:1 relevante, com indicação e valores; sem prazo.

### `h-convite-advisor-startup-ia` — Fundador de startup de IA convida para advisory board com equity.

- **oportunidade** (erro): esperado `true` × obtido `false`
- motivo do classificador: Termos: startup · pedido de ação
- scores: negocios:9, tarefas:3, carreira:0, networking:0 · componentes: Ação pendente 1 (Pede uma ação sua diretamente); Importância 0.55 (Importância moderada); Interesse 0.5 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Convite de parceria/negócio 1:1 alinhado a IA + pricing.

### `h-ex-colega-cafe-informal` — Ex-colega, informal e com erros de digitação, chama para café e sugere oportunidade.

- **categoria** (erro): esperado `networking / carreira (ideal: networking)` × obtido `tarefas`
- **oportunidade** (erro): esperado `true` × obtido `false`
- motivo do classificador: pedido de ação
- scores: tarefas:3, carreira:0, networking:0, noticias:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Interesse 0.5 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Networking com sinal claro de oportunidade (montando time). Datas sugeridas para o café não são prazo.

### `h-amigo-pede-indicacao-vaga` — Amigo pede indicação interna para vaga na empresa do dono.

- **categoria** (aceitável): esperado `tarefas / networking / carreira (ideal: tarefas)` × obtido `carreira [+networking]`
- **oportunidade** (erro): esperado `false` × obtido `true (job, fit 0.525)`
- motivo do classificador: Termos: vaga, cv, pleno · pedido de ação
- scores: carreira:17, networking:10, tarefas:4, trabalho:3 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Oportunidade 0.81 (Oportunidade aderente ao seu perfil); Interesse 0.5 (Casa com seus temas de interesse)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido de favor: a oportunidade é do amigo, não dele. Prazo ambíguo ("essa semana", antes do fechamento em 28/10).

### `h-cliente-ingles-review-by-tuesday` — Contato externo em inglês pede revisão de apêndice "by Tuesday".

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas`
- motivo do classificador: Termos: could you · pedido de ação · prazo 27/10/2026
- scores: tarefas:9, carreira:1, networking:0, noticias:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Interesse 0.5 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo relativo em inglês: "by Tuesday" enviado na quinta 22/10 = terça 27/10.

### `h-newsletter-ia-substack` — Newsletter de IA aplicada (Substack) com HTML.

- **categoria** (aceitável): esperado `newsletters / tecnologia (ideal: newsletters)` × obtido `tecnologia [+newsletters]`
- motivo do classificador: Termos: llms, rag · envio em massa · sinais: bulk_list
- scores: tecnologia:18, newsletters:16, noticias:2, carreira:0 · componentes: Importância 0.4 (Importância moderada); Interesse 0.5 (Casa com seus temas de interesse); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Newsletter assinada, alinhada aos interesses (IA/Python), mas sem ação.

### `h-newsletter-boletim-macro` — Boletim semanal de macroeconomia de casa de research.

- **categoria** (aceitável): esperado `newsletters / economia (ideal: newsletters)` × obtido `economia [+newsletters]`
- motivo do classificador: Termos: selic, copom, ipca, cambio · envio em massa · sinais: bulk_list
- scores: economia:26, newsletters:8, financas:3, noticias:2 · componentes: Importância 0.4 (Importância moderada); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Newsletter de economia, interesse do dono; as datas são de agenda macro, não prazos.

### `h-newsletter-resumo-noticias` — Resumo diário de notícias de jornal.

- **categoria** (aceitável): esperado `newsletters / noticias (ideal: newsletters)` × obtido `noticias [+newsletters]`
- motivo do classificador: Termos: noticias, resumo do dia · envio em massa · sinais: bulk_list
- scores: noticias:17, newsletters:4, agenda:2, carreira:0 · componentes: Importância 0.3 (Baixa importância); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Resumo genérico de notícias; ruído informativo.

### `h-newsletter-carta-investidor` — Newsletter de finanças pessoais/renda fixa.

- **categoria** (aceitável): esperado `newsletters / financas / economia (ideal: newsletters)` × obtido `financas [+newsletters, economia]`
- motivo do classificador: Termos: investimento, fundos imobiliarios, renda fixa, carteira · envio em massa · sinais: bulk_list
- scores: financas:14, economia:12, newsletters:4, marketing:4 · componentes: Importância 0.4 (Importância moderada); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Newsletter de investimentos; informativa.

### `h-marketing-credito-preaprovado-banco` — Banco legítimo oferece crédito pré-aprovado.

- **categoria** (aceitável): esperado `marketing / financas (ideal: marketing)` × obtido `financas [+marketing]`
- motivo do classificador: Termos: @itau.com.br, credito · envio em massa
- scores: financas:8, marketing:4, carreira:0, networking:0 · componentes: Importância 0.4 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Oferta comercial de banco real; domínio legítimo não a torna importante.

### `h-linkedin-impressoes-post` — Notificação do LinkedIn sobre visualizações de publicação.

- **categoria** (aceitável): esperado `networking / outros (ideal: networking)` × obtido `outros`
- motivo do classificador: envio em massa · sinais: social_notifier
- scores: networking:2, carreira:0, noticias:0, economia:0 · componentes: Importância 0.3 (Baixa importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Métrica de rede social, sem ação.

### `h-grupo-familia-almoco-vo` — Google Group da família: mãe pede confirmação de presença até sexta.

- **categoria** (aceitável): esperado `agenda / outros / tarefas (ideal: agenda)` × obtido `outros`
- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.2254)`
- **ação** (erro): esperado `true` × obtido `false (action_score 0.183)`
- motivo do classificador: lista de discussão · prazo 23/10/2026 · sinais: discussion_list
- scores: agenda:2, tarefas:1, carreira:0, networking:0 · componentes: Importância 0.3 (Baixa importância); Urgência 0.43 (Prazo inferido amanhã); Remetente 0.4 (Pessoa (não automático)); Novidade 0.6 (Envio recorrente)
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=false, encaminhado=false, resposta=false
- nota do rótulo: Cabeçalhos de lista (List-Id, Precedence: list) não o tornam massa: a mãe pede resposta e cita "Rafa e Ju". "Até sexta" a partir de 21/10 = 23/10; o almoço (25/10) é o evento.

### `h-grupo-condominio-edital-age` — Google Group do condomínio: edital de assembleia extraordinária sobre obras e rateio.

- **categoria** (aceitável): esperado `agenda / outros / contas (ideal: agenda)` × obtido `contas [+governo_juridico]`
- **prazo** (erro): esperado `null` × obtido `2026-11-05 (EVENT, INFERRED)`
- motivo do classificador: Termos: condominio · lista de discussão · prazo 05/11/2026 · sinais: discussion_list
- scores: contas:3, governo_juridico:3, agenda:2, trabalho:1 · componentes: Importância 0.6 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 0.6 (Envio recorrente); Urgência 0.004 (Prazo inferido em 15 dias)
- parser: bulk=true, automático=false, auth_fail=false, user_in_to=false, encaminhado=false, resposta=false
- nota do rótulo: Convocação coletiva; comparecer é opcional mas afeta o bolso (rateio extra). A data da assembleia é evento, não prazo.

### `h-injection-visivel-vendor` — Prospecção comercial com prompt injection visível pedindo para a IA reclassificar e exfiltrar e-mails.

- **categoria** (erro): esperado `spam / marketing / negocios (ideal: spam)` × obtido `tarefas`
- motivo do classificador: Termos: responder · sinais: injection
- scores: tarefas:6, carreira:0, networking:0, noticias:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Injection explícita ("ignore todas as instruções anteriores", exfiltração). Fora isso é prospecção fria irrelevante; não deve virar CRITICAL nem oportunidade.

### `h-sent-pedido-orcamento-pintor` — E-mail enviado pelo dono pedindo orçamento a um prestador até sexta.

- **categoria** (aceitável): esperado `compras / tarefas / outros (ideal: compras)` × obtido `tarefas [+networking]`
- motivo do classificador: Sem sinais fortes de categoria
- scores: tarefas:4, networking:3, agenda:2, carreira:0 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=false, encaminhado=false, resposta=false
- nota do rótulo: Enviado por ele: o pedido e o prazo ("até sexta") são para o prestador, não para ele.

### `h-sent-ingles-cliente-assumptions` — E-mail enviado pelo dono, em inglês, entregando premissas ao cliente.

- **categoria** (erro): esperado `trabalho` × obtido `tarefas`
- motivo do classificador: Termos: let me know
- scores: tarefas:6, carreira:0, networking:0, noticias:0 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Interesse 0.5 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=false, encaminhado=false, resposta=true
- nota do rótulo: SENT; entrega concluída. "before Monday" é oferta de ajuda, não prazo dele.

### `h-esposa-encaminha-reuniao-escola` — Esposa encaminha convocação da escola e pede resposta até amanhã; a escola tem outro prazo.

- **prazo** (erro): esperado `2026-10-23` × obtido `2026-10-27 (DEADLINE, EXPLICIT)`
- motivo do classificador: Termos: reuniao · pedido de ação · prazo 27/10/2026
- scores: agenda:14, tarefas:5, carreira:0, networking:0 · componentes: Importância 0.9 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=true, resposta=false
- nota do rótulo: Mensagem encaminhada: o prazo dele é o da esposa ("até amanhã" = 23/10); 27/10 é o prazo da escola e 29/10 é o evento.

### `h-amigo-convite-churrasco` — Amigo convida informalmente para churrasco no sábado 31.

- **categoria** (aceitável): esperado `agenda / outros (ideal: agenda)` × obtido `outros`
- motivo do classificador: Sem sinais fortes de categoria
- scores: carreira:0, networking:0, noticias:0, economia:0 · componentes: Importância 0.45 (Importância moderada); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Convite social informal; resposta implícita mas não pedida com prazo. 31/10 é o evento.

### `h-boleto-desconhecido-consultoria-ti` — Cobrança B2B de serviço que pessoa física não contratou, com ameaça de negativação e Reply-To divergente.

- **categoria** (aceitável): esperado `spam / contas (ideal: spam)` × obtido `contas`
- motivo do classificador: Termos: boleto, fatura, vencimento, linha digitavel · remetente não confiável (REPLY_TO_MISMATCH) · sinais: untrusted
- scores: contas:24, governo_juridico:3, noticias:2, compras:2 · componentes: Importância 0.7 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Caso ambíguo resolvido pelo julgamento do dono: empresa desconhecida, serviço B2B que ele nunca contratou, Reply-To em Gmail, linha digitável genérica e ameaça de negativação = boleto falso provável. Auth passa (domínio próprio do golpista).

### `h-github-termos-servico` — Aviso de atualização de termos de serviço (em inglês), sem ação.

- **categoria** (erro): esperado `outros / tecnologia / governo_juridico (ideal: outros)` × obtido `trabalho`
- motivo do classificador: Termos: @github.com
- scores: trabalho:4, noticias:2, tecnologia:2, carreira:0 · componentes: Importância 0.65 (Categoria e conteúdo de alta importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Data de vigência dos termos não é prazo; "you don't need to take any action".

### `h-alerta-noticia-temporal-sp` — Alerta de notícia de última hora (não é resumo/newsletter) sobre temporal em SP.

- **categoria** (erro): esperado `noticias / newsletters (ideal: noticias)` × obtido `outros`
- motivo do classificador: envio em massa
- scores: noticias:2, carreira:0, networking:0, economia:0 · componentes: Importância 0.3 (Baixa importância); Urgência 0.3 (Sinais de urgência sem prazo definido); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Notícia de alerta (não digest); útil para quem voa sábado, mas não pede ação e as datas são do evento climático.

### `h-gcloud-runtime-descontinuado` — Aviso técnico legítimo: runtime Python 3.9 do projeto pessoal será descontinuado em 30/01/2027.

- **categoria** (aceitável): esperado `tecnologia / outros / tarefas (ideal: tecnologia)` × obtido `tarefas [+trabalho]`
- **nível** (acima): esperado `LOW–MEDIUM` × obtido `HIGH (score 0.573)`
- motivo do classificador: Termos: acao necessaria · pedido de ação · prazo 30/01/2027
- scores: tarefas:11, trabalho:7, noticias:5, tecnologia:4 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Interesse 1 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Aviso obrigatório de serviço com ação real dele no projeto pessoal e prazo absoluto distante (3 meses), por isso nível baixo-médio.

