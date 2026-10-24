# Avaliação offline — classificador por regras + ranking

Gerado por `node eval/run-eval.js` em 2026-10-24T23:19:00.107Z. Sem IA (`AiSchema.merge(rules, null)`).

- Casos: **126** (sintéticos; arquivos: `01-contas-financas.json`, `02-seguranca-compras-viagens.json`, `03-saude-governo-trabalho.json`, `04-carreira-networking.json`, `05-newsletters-marketing-social.json`, `06-spam-pessoal-adversarial.json`)
- Hash do dataset: `6e95cd74ae2698a4` · classificador `rules-2026.10.2` · parser `parser-2026.10.2` · configVersion `8cee049994`
- Rótulos = julgamento do dono da caixa (profissional de dados/pricing/finanças em busca de oportunidades sênior), **não** o comportamento do código.
- IC 95%: Wilson para proporções; bootstrap (1000 reamostragens, semente fixa) para macro-F1. Amostra pequena: leia os intervalos, não só o ponto.

## Métricas principais

| Métrica | Chave | Valor | IC 95% | k/n |
|---|---|---:|---:|---:|
| Categoria: top-1 = ideal | `category_top1` | 79.4% | 71.5% – 85.5% | 100/126 |
| Categoria: top-1 ∈ aceitáveis | `category_acceptable` | 96.0% | 91.0% – 98.3% | 121/126 |
| Macro-F1 (verdade = ideal) | `macro_f1_strict` | 73.9% | 64.0% – 83.5% | n=126, 19 classes |
| Macro-F1 (aceitável conta como acerto) | `macro_f1_lenient` | 95.4% | 89.6% – 99.0% | n=126, 18 classes |
| Nível exato (casos com nível único esperado) | `level_exact` | 91.5% | 80.1% – 96.6% | 43/47 |
| Nível dentro de [levelMin, levelMax] | `level_in_range` | 96.0% | 91.0% – 98.3% | 121/126 |
| Nível ACIMA do intervalo (superpriorização) ↓ | `level_over` | 2.4% | 0.8% – 6.8% | 3/126 |
| Nível ABAIXO do intervalo (subpriorização) ↓ | `level_under` | 1.6% | 0.4% – 5.6% | 2/126 |
| Crítica: precisão (predita e aceitável) | `critical_precision` | 83.3% | 43.6% – 97.0% | 5/6 |
| Crítica: recall (levelMin = Crítica) | `critical_recall` | 100.0% | 51.0% – 100.0% | 4/4 |
| Alta ou crítica: precisão | `high_plus_precision` | 92.6% | 76.6% – 97.9% | 25/27 |
| Alta ou crítica: recall (levelMin ≥ Alta) | `high_plus_recall` | 95.2% | 77.3% – 99.2% | 20/21 |
| Ação: precisão | `action_precision` | 100.0% | 91.2% – 100.0% | 40/40 |
| Ação: recall | `action_recall` | 100.0% | 91.2% – 100.0% | 40/40 |
| Ação: acurácia (casos com rótulo) | `action_accuracy` | 100.0% | 96.6% – 100.0% | 109/109 |
| Prazo: acurácia (data exata ou ausência correta) | `deadline_accuracy` | 100.0% | 96.7% – 100.0% | 111/111 |
| Prazo: data certa quando há prazo | `deadline_date_recall` | 100.0% | 90.1% – 100.0% | 35/35 |
| Prazo espúrio (esperado nenhum, veio data) ↓ | `deadline_spurious` | 0.0% | 0.0% – 4.8% | 0/76 |
| Injection: precisão | `injection_precision` | 100.0% | 51.0% – 100.0% | 4/4 |
| Injection: recall | `injection_recall` | 100.0% | 51.0% – 100.0% | 4/4 |
| Taxa de oportunidades detectadas (todas as mensagens) | `opportunity_rate` | 10.3% | 6.1% – 16.9% | 13/126 |
| Oportunidade: precisão | `opportunity_precision` | 100.0% | 77.2% – 100.0% | 13/13 |
| Oportunidade: recall | `opportunity_recall` | 100.0% | 77.2% – 100.0% | 13/13 |

Taxa de oportunidades esperada pelos rótulos: 10.3%. ↓ = quanto menor, melhor.

Definições: *precisão de Crítica* = das preditas Críticas, quantas tinham `levelMax = CRITICAL`; *recall de Crítica* = dos casos com `levelMin = CRITICAL`, quantos saíram Críticos (idem para "Alta ou crítica"). Ação, injection e prazo só contam casos com rótulo (`null`/`any` = não avaliado).

## Casos por categoria ideal

| Categoria | Casos | Acerto top-1 | Aceitável |
|---|---:|---:|---:|
| trabalho | 14 | 6 | 13 |
| carreira | 13 | 12 | 13 |
| contas | 11 | 11 | 11 |
| marketing | 11 | 10 | 11 |
| spam | 10 | 8 | 10 |
| compras | 9 | 9 | 9 |
| outros | 9 | 7 | 9 |
| agenda | 7 | 7 | 7 |
| financas | 6 | 5 | 6 |
| seguranca_conta | 6 | 5 | 6 |
| governo_juridico | 5 | 2 | 5 |
| tarefas | 5 | 4 | 4 |
| networking | 4 | 3 | 3 |
| saude | 4 | 2 | 2 |
| tecnologia | 4 | 4 | 4 |
| economia | 3 | 2 | 3 |
| newsletters | 2 | 1 | 2 |
| noticias | 2 | 2 | 2 |
| negocios | 1 | 0 | 1 |

## F1 por categoria (verdade = ideal)

| Categoria | Suporte | Preditos | Precisão | Recall | F1 | F1 leniente |
|---|---:|---:|---:|---:|---:|---:|
| carreira | 13 | 13 | 92% | 92% | 0.92 | 1.00 |
| networking | 4 | 4 | 75% | 75% | 0.75 | 0.89 |
| noticias | 2 | 2 | 100% | 100% | 1.00 | 1.00 |
| economia | 3 | 2 | 100% | 67% | 0.80 | 1.00 |
| tecnologia | 4 | 6 | 67% | 100% | 0.80 | 1.00 |
| negocios | 1 | 0 | 0% | 0% | 0.00 | 0.00 |
| financas | 6 | 7 | 71% | 83% | 0.77 | 1.00 |
| trabalho | 14 | 8 | 75% | 43% | 0.55 | 0.80 |
| tarefas | 5 | 14 | 29% | 80% | 0.42 | 0.89 |
| agenda | 7 | 8 | 88% | 100% | 0.93 | 0.93 |
| compras | 9 | 11 | 82% | 100% | 0.90 | 1.00 |
| contas | 11 | 14 | 79% | 100% | 0.88 | 1.00 |
| newsletters | 2 | 2 | 50% | 50% | 0.50 | 1.00 |
| marketing | 11 | 10 | 100% | 91% | 0.95 | 1.00 |
| spam | 10 | 8 | 100% | 80% | 0.89 | 1.00 |
| saude | 4 | 2 | 100% | 50% | 0.67 | 0.67 |
| seguranca_conta | 6 | 5 | 100% | 83% | 0.91 | 1.00 |
| governo_juridico | 5 | 2 | 100% | 40% | 0.57 | 1.00 |
| outros | 9 | 8 | 88% | 78% | 0.82 | 1.00 |

## Confusões de categoria mais frequentes (ideal → predita)

| Par | n | Casos (* = predita era aceitável) |
|---|---:|---|
| trabalho → tarefas | 6 | trabalho-chefe-revisao-amanha-12h*, trabalho-colega-duvida-query*, trabalho-cliente-proposta-sexta*, trabalho-pesquisa-clima-lembrete*, en-cliente-deck-amanha-eod*, trabalho-reply-chefe-resumo-amanha-cedo* |
| governo_juridico → contas | 3 | gov-restituicao-irpf-lote*, gov-malha-fina-pendencia*, gov-detran-autuacao-indicacao-condutor* |
| carreira → networking | 1 | carreira-recrutadora-head-pricing-1a1* |
| economia → financas | 1 | news-research-carteira-recomendada* |
| financas → compras | 1 | financas-compra-aprovada-cartao* |
| marketing → compras | 1 | mkt-pesquisa-satisfacao* |
| negocios → newsletters | 1 | news-substack-pricing-letter* |
| networking → tarefas | 1 | networking-ex-colega-cafe-sociedade |
| newsletters → tecnologia | 1 | news-ultima-chance-evento* |
| outros → tarefas | 1 | pessoal-mae-almoco-domingo* |
| outros → tecnologia | 1 | outros-certificado-curso-online* |
| saude → tarefas | 1 | saude-consulta-amanha-confirmar-hoje |
| saude → trabalho | 1 | saude-dentista-orcamento-pessoa |
| seguranca_conta → financas | 1 | seguranca-transacao-suspeita-banco* |
| spam → carreira | 1 | inj-recrutador-falso-instrucoes* |
| spam → tarefas | 1 | inj-zero-width-aprovacao-pagamento* |
| tarefas → trabalho | 1 | tarefas-escola-autorizacao-amanha |
| trabalho → agenda | 1 | trabalho-ata-reuniao-em-copia |
| trabalho → outros | 1 | trabalho-reply-agradecimento-com-citacao* |

## Nível: intervalo esperado × nível obtido

| Esperado | LOW | MEDIUM | HIGH | CRITICAL |
|---|---:|---:|---:|---:|
| LOW | 30 | 0 | 0 | 0 |
| LOW–MEDIUM | 42 | 6 | 0 | 0 |
| MEDIUM | 0 | 4 | 2 | 0 |
| MEDIUM–HIGH | 1 | 15 | 5 | 0 |
| HIGH | 0 | 1 | 5 | 1 |
| HIGH–CRITICAL | 0 | 0 | 9 | 1 |
| CRITICAL | 0 | 0 | 0 | 4 |

## Invariantes duros

- **Phishing ou auth_fail nunca acima de Média** (`phishing_max_medium`): 10 casos cobertos, nenhuma violação.
- **Marketing/promoção nunca Crítica** (`marketing_not_critical`): 13 casos cobertos, nenhuma violação.
- **Newsletter nunca Crítica** (`newsletter_not_critical`): 14 casos cobertos, nenhuma violação.
- **Pedido direto de pessoa com prazo explícito ≤ 2 dias é pelo menos Alta** (`direct_request_short_deadline_high`): 8 casos cobertos, nenhuma violação.

## Todos os erros (31 casos com pelo menos uma divergência)

Formato: campo — esperado × obtido. "aceitável" = a categoria obtida está na lista aceita, mas não é a ideal.

### `gov-restituicao-irpf-lote` — Restituição do IR incluída em lote (boa notícia, sem ação)

- **categoria** (aceitável): esperado `governo_juridico / contas / financas (ideal: governo_juridico)` × obtido `contas`
- motivo do classificador: Termos: @receita.fazenda.gov.br, imposto de renda, irpf, conta
- scores: contas:20, governo_juridico:7, noticias:2, financas:1 · componentes: Importância 0.6 (Categoria e conteúdo de alta importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Informativo oficial; nada a fazer.

### `financas-compra-aprovada-cartao` — Alerta de compra aprovada no cartão (rotina)

- **categoria** (aceitável): esperado `financas / compras (ideal: financas)` × obtido `compras`
- motivo do classificador: Termos: compra aprovada, compra
- scores: compras:12, financas:4, noticias:2, carreira:0 · componentes: Importância 0.35 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Notificação transacional rotineira.

### `seguranca-transacao-suspeita-banco` — Banco legítimo (autenticado) bloqueou compra suspeita e pede confirmação no app

- **categoria** (aceitável): esperado `seguranca_conta / financas (ideal: seguranca_conta)` × obtido `financas [+compras]`
- motivo do classificador: Termos: @itau.com.br · pedido de ação · sinais: severity:conta_comprometida
- scores: financas:4, compras:3, noticias:2, agenda:1 · componentes: Importância 0.81 (Categoria e conteúdo de alta importância · notificação séria (gravidade 0.7)); Ação pendente 1 (Pede uma ação sua diretamente); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Alerta real de fraude; ação condicional.

### `agenda-voo-checkin-amanha` — Check-in aberto para voo de amanhã cedo

- **nível** (abaixo): esperado `HIGH` × obtido `MEDIUM (score 0.542)`
- motivo do classificador: Termos: @latam.com, check-in, voo, embarque · pedido de ação · prazo 22/10/2026 · sinais: severity:viagem_iminente
- scores: agenda:30, tarefas:5, noticias:2, carreira:0 · componentes: Importância 0.82 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.43 (Prazo inferido amanhã); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Voo amanhã: check-in é ação concreta e urgente.

### `agenda-convite-reuniao-calendar` — Convite do Google Agenda para reunião de trabalho em 2 dias

- **nível** (abaixo): esperado `MEDIUM–HIGH` × obtido `LOW (score 0.3284)`
- motivo do classificador: Termos: calendar-notification@google.com, convite:, google meet, evento · prazo 22/10/2026
- scores: agenda:18, trabalho:9, carreira:3, noticias:2 · componentes: Importância 0.6 (Categoria e conteúdo de alta importância); Urgência 0.308 (Prazo inferido em 2 dias); Interesse 0.5 (Casa com seus temas de interesse); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: RSVP é desejável, mas o essencial é a data.

### `saude-consulta-amanha-confirmar-hoje` — Clínica lembra consulta amanhã e pede confirmação até hoje às 18h

- **categoria** (erro): esperado `saude / agenda (ideal: saude)` × obtido `tarefas [+saude, agenda]`
- motivo do classificador: Termos: lembrete, por favor · pedido de ação · prazo 22/10/2026
- scores: tarefas:12, saude:9, agenda:6, compras:1 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.6 (Prazo inferido hoje); Remetente 0.4 (Pessoa (não automático)) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo da ação (confirmar) é hoje; consulta é amanhã.

### `saude-dentista-orcamento-pessoa` — Dentista (pessoa) envia orçamento e receita, pede para agendar

- **categoria** (erro): esperado `saude` × obtido `trabalho [+tarefas, negocios]`
- motivo do classificador: Termos: segue em anexo, em anexo · pedido de ação
- scores: trabalho:6, tarefas:4, negocios:3, agenda:1 · componentes: Importância 0.8 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pessoa, pedido de retorno sem data explícita.

### `gov-malha-fina-pendencia` — Receita Federal: declaração retida em malha fiscal

- **categoria** (aceitável): esperado `governo_juridico / contas (ideal: governo_juridico)` × obtido `contas [+governo_juridico]`
- motivo do classificador: Termos: @receita.fazenda.gov.br, receita federal, irpf, declaracao · pedido de ação · sinais: severity:governo_juridico
- scores: contas:20, governo_juridico:13, tarefas:4, financas:3 · componentes: Importância 0.91 (Categoria e conteúdo de alta importância · notificação séria (gravidade 0.7)); Ação pendente 1 (Pede uma ação sua diretamente); Piso de prioridade 0.55 (Notificação grave (gravidade 0.7) que pede uma ação: no mínimo Alta); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Risco financeiro alto, sem data explícita.

### `gov-detran-autuacao-indicacao-condutor` — Notificação de autuação de trânsito com prazo para indicar condutor

- **categoria** (aceitável): esperado `governo_juridico / contas (ideal: governo_juridico)` × obtido `contas [+tarefas, governo_juridico]`
- motivo do classificador: Termos: @gov.br, detran, gov.br · pedido de ação · prazo 10/11/2026 · sinais: severity:governo_juridico
- scores: contas:11, tarefas:6, governo_juridico:6, networking:3 · componentes: Importância 0.96 (Categoria e conteúdo de alta importância · notificação séria (gravidade 0.7)); Ação pendente 1 (Pede uma ação sua diretamente); Piso de prioridade 0.55 (Notificação grave (gravidade 0.7) que pede uma ação: no mínimo Alta); Novidade 1 (Conteúdo novo) · gatilho crítico: Consequência séria com ação e prazo explícito
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo legal confortável (20 dias).

### `trabalho-chefe-revisao-amanha-12h` — Chefe pede revisão de planilha até amanhã às 12h para comitê

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas [+trabalho]`
- motivo do classificador: Termos: preciso que · pedido de ação · prazo 22/10/2026
- scores: tarefas:9, trabalho:5, marketing:1, carreira:0 · componentes: Importância 1 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.717 (Prazo explícito amanhã); Remetente 0.8 (Contato com quem você já trocou e-mails) · gatilho crítico: Ação com prazo próximo, Pedido direto de contato conhecido com prazo até amanhã
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Caso canônico de Crítica: gestora, pedido direto, prazo amanhã.

### `trabalho-colega-duvida-query` — Colega pergunta sobre regra de cálculo, sem prazo

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas`
- motivo do classificador: pedido de ação
- scores: tarefas:3, compras:1, carreira:0, networking:0 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.8 (Contato com quem você já trocou e-mails); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pergunta direta de colega, sem urgência.

### `trabalho-ata-reuniao-em-copia` — Ata de reunião em que o dono está só em cópia

- **categoria** (erro): esperado `trabalho` × obtido `agenda`
- motivo do classificador: Termos: reuniao · prazo 20/10/2026
- scores: agenda:14, tarefas:1, carreira:0, networking:0 · componentes: Importância 0.65 (Categoria e conteúdo de alta importância); Urgência 0.6 (Prazo inferido hoje); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=false, encaminhado=false, resposta=false
- nota do rótulo: Em cópia; informativo.

### `trabalho-cliente-proposta-sexta` — Cliente de consultoria pede proposta revisada até sexta (2 dias)

- **categoria** (aceitável): esperado `trabalho / tarefas / negocios (ideal: trabalho)` × obtido `tarefas`
- motivo do classificador: Termos: poderia, enviar · pedido de ação · prazo 23/10/2026
- scores: tarefas:7, agenda:3, trabalho:1, carreira:0 · componentes: Importância 1 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.513 (Prazo explícito em 2 dias); Interesse 0.5 (Casa com seus temas de interesse) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido direto de cliente, prazo em 2 dias.

### `trabalho-reply-agradecimento-com-citacao` — Resposta curta de agradecimento; a citação contém um pedido antigo do próprio dono

- **categoria** (aceitável): esperado `trabalho / outros (ideal: trabalho)` × obtido `outros`
- motivo do classificador: Sem sinais fortes de categoria
- scores: carreira:0, networking:0, noticias:0, economia:0 · componentes: Importância 0.55 (Importância moderada); Remetente 0.8 (Contato com quem você já trocou e-mails); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=true
- nota do rótulo: Fecha o assunto; pedido citado é do próprio dono e já foi atendido.

### `trabalho-pesquisa-clima-lembrete` — Lembrete automático para responder pesquisa de clima

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas [+noticias, newsletters]`
- motivo do classificador: Termos: lembrete, responder · envio em massa · prazo 30/10/2026 · sinais: bulk_list
- scores: tarefas:7, noticias:5, newsletters:4, carreira:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa); Urgência 0.069 (Prazo explícito em 8 dias)
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
- scores: trabalho:6, tarefas:4, carreira:0, networking:0 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.717 (Prazo explícito amanhã); Remetente 0.4 (Pessoa (não automático)) · gatilho crítico: Ação com prazo próximo
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo amanhã com consequência para o filho.

### `carreira-recrutadora-head-pricing-1a1` — Recrutadora 1:1 com vaga de Head de Pricing remota e faixa salarial (fit alto)

- **categoria** (aceitável): esperado `carreira / networking (ideal: carreira)` × obtido `networking [+carreira]`
- motivo do classificador: Termos: recrutadora, talent acquisition, conversa rapida · pedido de ação · prazo 22/10/2026
- scores: networking:8, carreira:4, tarefas:3, agenda:2 · componentes: Importância 0.745 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Oportunidade 0.95 (Oportunidade aderente ao seu perfil); Urgência 0.308 (Prazo inferido em 2 dias)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Oportunidade sênior aderente, pede resposta.

### `carreira-thread-recrutadora-horarios` — Resposta em thread da recrutadora propondo dois horários

- **nível** (acima): esperado `HIGH` × obtido `CRITICAL (score 0.7228)`
- motivo do classificador: Termos: vaga · pedido de ação
- scores: carreira:6, tarefas:4, networking:0, noticias:0 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Oportunidade 0.89 (Oportunidade aderente ao seu perfil); Remetente 0.8 (Contato com quem você já trocou e-mails) · gatilho crítico: Oportunidade aderente de contato conhecido
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=true
- nota do rótulo: Processo em andamento; precisa escolher horário.

### `networking-ex-colega-cafe-sociedade` — Ex-colega propõe café para falar de parceria em consultoria de pricing

- **categoria** (erro): esperado `networking / negocios / carreira (ideal: networking)` × obtido `tarefas [+networking]`
- motivo do classificador: pedido de ação
- scores: tarefas:4, networking:3, carreira:0, noticias:0 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.8 (Contato com quem você já trocou e-mails); Oportunidade 0.65 (Oportunidade identificada)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Oportunidade de negócio de contato conhecido.

### `networking-pedido-mentoria` — Pessoa desconhecida pede mentoria de carreira

- **nível** (acima): esperado `MEDIUM` × obtido `HIGH (score 0.5686)`
- motivo do classificador: Termos: mentoria · pedido de ação
- scores: networking:6, tarefas:3, agenda:3, compras:2 · componentes: Importância 0.745 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Interesse 1 (Casa com seus temas de interesse); Remetente 0.4 (Pessoa (não automático))
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido pessoal sem urgência.

### `news-substack-pricing-letter` — Newsletter do Substack sobre pricing e promoções

- **categoria** (aceitável): esperado `negocios / newsletters / tecnologia / economia (ideal: negocios)` × obtido `newsletters [+marketing]`
- motivo do classificador: Termos: @substack.com, edicao · envio em massa · sinais: bulk_list
- scores: newsletters:9, marketing:9, noticias:2, carreira:0 · componentes: Importância 0.25 (Baixa importância); Interesse 0.5 (Casa com seus temas de interesse); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Conteúdo muito aderente, mas é leitura.

### `news-ultima-chance-evento` — Newsletter de comunidade promove evento com inscrições encerrando amanhã

- **categoria** (aceitável): esperado `newsletters / marketing / agenda / tecnologia (ideal: newsletters)` × obtido `tecnologia [+newsletters, marketing]`
- motivo do classificador: Termos: ia generativa, mlops, engenharia de dados · envio em massa · sinais: bulk_list
- scores: tecnologia:9, newsletters:6, marketing:5, carreira:3 · componentes: Importância 0.3 (Baixa importância); Interesse 0.5 (Casa com seus temas de interesse); Novidade 0.6 (Envio recorrente); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Prazo de inscrição de evento opcional, em massa.

### `news-research-carteira-recomendada` — Relatório de research em massa da corretora

- **categoria** (aceitável): esperado `economia / financas / newsletters (ideal: economia)` × obtido `financas [+newsletters]`
- motivo do classificador: Termos: @xpi.com.br, investimento, carteira · envio em massa · sinais: bulk_list
- scores: financas:11, economia:4, newsletters:4, noticias:2 · componentes: Importância 0.5 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Conteúdo de massa do domínio do banco/corretora.

### `mkt-pesquisa-satisfacao` — Pesquisa de satisfação pós-compra

- **categoria** (aceitável): esperado `marketing / compras (ideal: marketing)` × obtido `compras [+marketing]`
- motivo do classificador: Termos: @kabum.com.br, pedido, compra · envio em massa
- scores: compras:7, marketing:4, tarefas:1, carreira:0 · componentes: Importância 0.25 (Baixa importância); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=true, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido opcional de empresa, não tarefa.

### `inj-recrutador-falso-instrucoes` — Falso recrutador em inglês com bloco '### Instructions' tentando extrair dados e chaves

- **categoria** (aceitável): esperado `spam / carreira (ideal: spam)` × obtido `carreira`
- motivo do classificador: Termos: job offer, interview, cv, senior · sinais: injection
- scores: carreira:14, tecnologia:1, networking:0, noticias:0 · componentes: Importância 0.8 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Injection explícita + golpe; não é oportunidade.

### `inj-zero-width-aprovacao-pagamento` — Pedido de 'aprovação de pagamento' com sequência de caracteres invisíveis e instrução ao modelo

- **categoria** (aceitável): esperado `spam / tarefas (ideal: spam)` × obtido `tarefas [+contas]`
- motivo do classificador: Termos: pendente · sinais: injection
- scores: tarefas:11, contas:9, trabalho:3, compras:3 · componentes: Importância 0.8 (Categoria e conteúdo de alta importância); Remetente 0.4 (Pessoa (não automático)); Novidade 1 (Conteúdo novo)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Texto invisível + instrução direta ao modelo.

### `pessoal-mae-almoco-domingo` — Mãe convida para almoço de domingo e pede resposta até sábado

- **categoria** (aceitável): esperado `outros / agenda / tarefas (ideal: outros)` × obtido `tarefas`
- motivo do classificador: pedido de ação · prazo 24/10/2026
- scores: tarefas:5, agenda:2, carreira:0, networking:0 · componentes: Importância 0.95 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.8 (Contato com quem você já trocou e-mails); Urgência 0.308 (Prazo inferido em 2 dias)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Família, pedido de resposta com prazo relativo (sábado).

### `en-cliente-deck-amanha-eod` — Cliente em inglês pede deck até amanhã EOD

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas [+agenda]`
- motivo do classificador: Termos: could you · pedido de ação · prazo 22/10/2026
- scores: tarefas:9, agenda:5, carreira:0, networking:0 · componentes: Importância 0.85 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Urgência 0.43 (Prazo inferido amanhã); Interesse 0.5 (Casa com seus temas de interesse)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Pedido direto em inglês com prazo amanhã.

### `trabalho-reply-chefe-resumo-amanha-cedo` — Resposta curta da gestora em thread: aprova e pede resumo até amanhã cedo

- **categoria** (aceitável): esperado `trabalho / tarefas (ideal: trabalho)` × obtido `tarefas`
- motivo do classificador: pedido de ação · prazo 21/10/2026
- scores: tarefas:5, carreira:0, networking:0, noticias:0 · componentes: Importância 1 (Categoria e conteúdo de alta importância); Ação pendente 1 (Pede uma ação sua diretamente); Remetente 0.8 (Contato com quem você já trocou e-mails); Urgência 0.43 (Prazo inferido amanhã)
- parser: bulk=false, automático=false, auth_fail=false, user_in_to=true, encaminhado=false, resposta=true
- nota do rótulo: Pedido curto em resposta; prazo relativo (amanhã).

### `outros-certificado-curso-online` — Certificado de curso online disponível

- **categoria** (aceitável): esperado `outros / tecnologia / compras (ideal: outros)` × obtido `tecnologia`
- motivo do classificador: Termos: @alura.com.br, sql
- scores: tecnologia:7, noticias:2, networking:1, carreira:0 · componentes: Importância 0.4 (Importância moderada); Novidade 1 (Conteúdo novo); Remetente 0.15 (Envio automático ou em massa)
- parser: bulk=false, automático=true, auth_fail=false, user_in_to=true, encaminhado=false, resposta=false
- nota do rótulo: Informativo.

