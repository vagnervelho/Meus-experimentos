# 11 — Riscos técnicos, premissas a validar e inconsistências da especificação

## Em resumo

- **Não há decisão bloqueante para iniciar a Fase 1.** Todas as premissas têm valor padrão configurável. Uma delas (PR-12, gado de terceiros) convém ser respondida antes do congelamento do esquema.
- São 30 riscos mapeados. Os cinco que mais importam: a planilha alterar tipos na gravação (R-01), edição manual da planilha (R-10), perda de formulário no celular (R-23), dupla contagem financeira (R-13) e diferença entre o que se testa aqui e o ambiente real do Google (R-27).
- A especificação tem 30 pontos ambíguos ou contraditórios. Cada um recebeu uma leitura e uma solução; nenhum exigiu descartar um requisito.
- O que não pôde ser verificado nesta sessão vira item do spike da Fase 1 (SP-01 a SP-10), com critério de aprovação e plano B.

**Documentos relacionados:** `06-persistencia-e-integridade.md` (mecanismos que mitigam os riscos de dados), `12-fatos-de-plataforma.md` (fatos e fontes), `13-revisao-adversarial.md` (de onde vieram muitos destes riscos), `10-plano-de-implementacao.md` (spike e fases).

## 1. Riscos técnicos

Probabilidade e impacto: alta, média ou baixa, sempre considerando o desenho **sem** a mitigação. A coluna "Fase" indica quando a mitigação precisa estar pronta.

### 1.1 Plataforma e cotas

| ID | Risco | Prob. / Impacto | Como o desenho mitiga | Sinal de alerta | Contingência | Fase |
|---|---|---|---|---|---|---|
| R-01 | O Sheets converte o que é gravado: brinco `0012` vira 12, texto iniciado por `=` vira fórmula, data vira objeto de data | Alta / Alto. É o comportamento padrão da planilha | Contrato "valor lido = valor gravado"; gravação tipada pela Sheets API como primeira opção; corpus de ida e volta; fake de teste que reproduz a coerção; normalização na leitura | Verificação de integridade acusa "célula coercida" ou texto que chegou como número | Gravação por `SpreadsheetApp` com formato de texto aplicado antes de cada bloco (decisão no SP-01) | 1 |
| R-02 | Limite de 6 minutos por execução em importação, reconstrução de projeções ou verificação de integridade | Média / Alto | Importação em lotes comandados pelo cliente; cada comando lê só as tabelas que declara; orçamento de tempo aprovado no spike | Comando acima de 60 s no registro de operações | Fatiar a rotina em chamadas retomáveis | 1 |
| R-03 | Cota de gatilhos: 90 min por dia, somados com o projeto irmão da mesma conta | Baixa / Médio | Dois gatilhos, um diário e um semanal; tempo medido no spike | Falha de gatilho por cota no painel de execuções | Reduzir a verificação semanal às checagens baratas | 1 |
| R-04 | O escopo `drive.file` não basta para criar, copiar ou exportar os arquivos do sistema | Média / Baixo | Todo arquivo nasce pela Drive API; teste estático proíbe `DriveApp` | Erro de permissão no `setup()` ou no backup | Escopo `drive` completo, com nova autorização (SP-02) | 1 |
| R-05 | E-mail do usuário ativo vem vazio no modo de publicação escolhido | Média / Baixo | A publicação "somente eu" já restringe; a guarda de dono tem indicador de contingência e não presume o e-mail | Erro de acesso negado para o próprio dono | Ativar a contingência documentada (SP-04) | 1 |
| R-06 | O Google muda cota ou comportamento sem aviso | Baixa / Médio | Acesso à plataforma isolado no adaptador; testes de aceitação rodam no ambiente real; fatos de plataforma datados | Teste de aceitação que passava começa a falhar | Ajuste restrito ao adaptador | Todas |
| R-07 | Limite de 200 versões do script | Baixa / Baixo | Desenvolvimento pela URL de desenvolvimento, sem publicar; publicação só em marco testado | Aviso do script de envio a partir de 150 versões | Limpeza manual de versões no editor | 1 |
| R-08 | Biblioteca de gráficos por CDN não carrega dentro do iframe | Média / Baixo | Carga sob demanda, versão fixa, verificação de integridade do arquivo; toda série tem tabela equivalente | Gráfico não aparece; tabela aparece | Gráficos SVG próprios (SP-08) | 3 |

### 1.2 Integridade dos dados

| ID | Risco | Prob. / Impacto | Como o desenho mitiga | Sinal de alerta | Contingência | Fase |
|---|---|---|---|---|---|---|
| R-09 | A execução morre no meio de um comando e deixa gravação parcial | Média / Alto. Em anos de uso, acontece | Três fases: só anexa, confirma em uma célula, aplica derivados de forma repetível; recuperação automática na chamada seguinte | Operação órfã encontrada pela recuperação (fica registrada) | Reconstrução completa das projeções | 1 |
| R-10 | O dono edita a planilha diretamente e quebra regras | Alta / Alto. A planilha fica na conta dele, a um clique | Proteção de aviso em todas as abas; verificação de integridade compara projeção com replay, chaves, tipos e cabeçalhos; guia dizendo o que pode e o que não pode | Verificação semanal com erro | Reconstruir projeções; restaurar backup | 1 |
| R-11 | Evento duplicado por reenvio, duplo clique ou resposta perdida | Média / Médio | Chave de idempotência com resumo do conteúdo; consulta de estado da operação; aviso de possível duplicidade | Aviso de duplicidade frequente | Estorno do evento duplicado | 1 |
| R-12 | Erro de lógica no validador ou no projetor gera estado errado | Média / Alto | Uma única rotina calcula projeções; comparação projeção × replay; cenários de teste por regra | Divergência na verificação de integridade | Corrigir a rotina e reconstruir: os fatos não se perdem | 1–2 |
| R-13 | Dupla contagem financeira (aquisição subtraída duas vezes, insumo na compra e no consumo, frete em dois lugares) | Média / Alto. A revisão achou quatro casos na v1 | Cálculo por natureza; alocações como única fonte por animal; invariantes verificadas; teste de conciliação entre caixa e resultado | Conciliação automatizada não fecha | Corrigir a regra; os lançamentos não mudam | 2–4 |
| R-14 | Indicador enganoso por dado ausente ou estimado tratado como real | Alta / Médio | Sem dado, sem indicador; cobertura exibida ("412 de 430 valoradas"); estimativas rotuladas | Indicador exibido sem a contagem de base | — | 3–5 |
| R-15 | Estado guardado no projeto de script vaza entre a base real e a de teste ou restaurada | Média / Alto | Chaves por planilha; a verdade da recuperação fica dentro da planilha | Marcador pendente sem operação correspondente | Limpeza automática com registro | 1 |
| R-16 | Perda ou corrupção da planilha | Baixa / Alto | Backup diário com retenção de 30 dias e 12 meses; backup antes de migração e de importação; histórico de versões do Sheets; ensaio de restauração na Fase 1 | Alerta de backup atrasado | Restauração pelo comando do sistema | 1 |

### 1.3 Desempenho e crescimento

| ID | Risco | Prob. / Impacto | Como o desenho mitiga | Sinal de alerta | Contingência | Fase |
|---|---|---|---|---|---|---|
| R-17 | Cada ida ao servidor leva de 1 a 3 segundos, mais no arranque a frio | Alta / Médio | Uma carga inicial; busca e filtro no navegador; uma ida por evento simples; simulação só onde compensa | Abertura acima do orçamento medido no spike | Carga inicial em partes | 1 |
| R-18 | Com os anos, as tabelas crescem e os comandos ficam lentos | Média / Médio | Volumetria estimada por aba; leituras declaradas por evento; limiar de arquivamento (60 mil linhas) | Tempo de comando em alta no registro de operações | Arquivar fatos de animais baixados há anos | 2+ |
| R-19 | Limite de células da planilha | Baixa / Alto | Abas criadas na dimensão exata; planejamento com 10 milhões (o limite vigente seria 20 milhões, não confirmado na fonte) | Contagem de células na tela de sistema | Arquivamento em planilha anual | 2+ |

### 1.4 Segurança e acesso

| ID | Risco | Prob. / Impacto | Como o desenho mitiga | Sinal de alerta | Contingência | Fase |
|---|---|---|---|---|---|---|
| R-20 | Acesso indevido ao aplicativo ou à planilha | Baixa / Alto | Publicação "somente eu"; guarda de dono em toda entrada; planilha não compartilhada; nada sensível em URL ou registro | Verificação de compartilhamento da planilha | Revogar acesso; restaurar backup | 1 |
| R-21 | Navegador com várias contas Google abre o aplicativo com a conta errada | Média / Baixo | Guia de implantação: perfil só com a conta dona no celular | Página de erro do Google antes do aplicativo | Janela anônima | 1 |
| R-22 | Script de terceiros carregado por CDN roda na página com acesso aos dados | Baixa / Alto | Um único script externo, versão fixa, com verificação de integridade | — | Gráficos próprios, sem script externo | 3 |

### 1.5 Experiência de uso

| ID | Risco | Prob. / Impacto | Como o desenho mitiga | Sinal de alerta | Contingência | Fase |
|---|---|---|---|---|---|---|
| R-23 | No curral, com sinal fraco, o celular recarrega a página e perde 80 pesos digitados | Alta / Alto | Rascunho salvo a cada linha; consulta "essa operação gravou?"; chave mantida até resposta confirmada | Rascunho recuperado com frequência | Rascunho guardado no servidor (SP-06) | 1–3 |
| R-24 | Registrar um evento dá mais trabalho que o caderno, e o sistema é abandonado | Média / Alto | Modo curral; registro a partir da ficha, do pasto e da seleção; contagem de toques como critério de aceite | Eventos registrados com dias de atraso | Revisar o fluxo com o dono em uso real | 2–3 |
| R-25 | Dados históricos sujos (brincos repetidos, datas faltando) travam a importação | Alta / Médio | Área de preparação que preserva o original; validação e pré-visualização; desfazer; marco zero; níveis de confiança | Muitas linhas com erro na validação | Importação parcial aprovada explicitamente | 1–3 |

### 1.6 Operação e entrega

| ID | Risco | Prob. / Impacto | Como o desenho mitiga | Sinal de alerta | Contingência | Fase |
|---|---|---|---|---|---|---|
| R-26 | Só o dono pode implantar e rodar os testes no ambiente real | Alta / Médio | Guia de implantação; script de envio; testes de aceitação com um clique e relatório | Fase aguardando execução do dono | Roteiro passo a passo assistido | Todas |
| R-27 | O que passa nos testes em Node se comporta diferente no Google real | Média / Alto. Nesta fase não houve acesso à conta do dono | Spike antes de construir; fakes conferidos contra o ambiente real; relatório separa "executado aqui" de "a executar na conta" | Teste de aceitação falha onde o de Node passa | Corrigir o fake e o adaptador | 1 |
| R-28 | Sessões longas de desenvolvimento são interrompidas (ocorreu nesta Fase 0, por limite de uso) | Média / Baixo | Entregas numeradas pequenas; commit a cada entrega; lista de pendências versionada | Entrega parada sem commit | Retomar pela lista de pendências | Todas |

### 1.7 Produto

| ID | Risco | Prob. / Impacto | Como o desenho mitiga | Sinal de alerta | Contingência | Fase |
|---|---|---|---|---|---|---|
| R-29 | Premissa de negócio errada (manejo reprodutivo, forma de venda, gado de terceiros) | Média / Médio | Parâmetros em tabelas; lista de premissas com o custo de cada mudança | Dono usa "observações" para o que o sistema não modela | Mudança aditiva de esquema | 1–3 |
| R-30 | Escopo grande para um MVP (financeiro completo, 17 relatórios) | Alta / Médio | Cada fase entrega algo utilizável; evento grava fatos completos na fase em que nasce; lista explícita do que fica fora | Fase crescendo além das entregas numeradas | Mover item para a fase seguinte, com registro | Todas |

## 2. Os cinco riscos que mais importam

1. **R-01, coerção de tipos.** É o único risco que corrompe dado em silêncio e de forma irrecuperável: um brinco `0012` gravado como 12 não volta. Por isso a primitiva de gravação é a primeira decisão do spike, e o teste em Node só vale se o fake reproduzir a coerção.
2. **R-10, edição manual.** Não há como impedir o dono de editar a própria planilha. O desenho aposta em detecção e reparo: como os fatos são append-only e as projeções são recalculáveis, quase toda edição indevida de estado atual é reparável; edição em fatos é detectada, e o reparo é o backup.
3. **R-23, perda de formulário no curral.** Se a pesagem de 80 animais se perder uma vez, a confiança no sistema acaba. O rascunho persistente e a consulta de estado da operação foram promovidos a requisito da Fase 1, não a refinamento.
4. **R-13, dupla contagem.** O dono vai conferir os números. A v1 do desenho tinha quatro casos de dupla contagem; a v2 fecha com natureza, razão único por animal e uma identidade de conciliação testada automaticamente.
5. **R-27, ambiente real.** Tudo o que esta fase afirma sobre o Google foi conferido em tipos e documentos de descoberta, não em execução. O spike existe para transformar suposição em fato antes de construir sobre ela.

## 3. Limitações assumidas do MVP

- Funciona só online. Sem sincronização offline (§17); o desenho apenas não a impede.
- Um usuário. Sem perfis nem permissões por papel.
- Eventos têm data, não hora. A ordem dentro do dia segue a classe do evento e a ordem de registro.
- Cada ação que grava leva alguns segundos (limite da plataforma, não do desenho).
- "Lote" não é entidade: é o grupo de animais de um evento ou um recorte por pasto e categoria.
- Presume que todos os animais são do dono e todos os pastos, da propriedade (PR-12).
- Estoque de insumos é opcional por produto, sem saldo por lote e sem custo médio.
- Financeiro sem contas bancárias, sem conciliação, sem depreciação, sem baixa parcial automática (a parcela é desdobrada) e sem transferir custo da matriz ao bezerro.
- Patrimônio só tem valor onde há preço de referência vigente; o histórico anterior ao marco zero é informativo.
- Sem peso ajustado à desmama e sem capacidade de suporte por época do ano.
- O sistema registra e alerta; não prescreve protocolo veterinário, não calcula tributo e não deduz capacidade de pasto pela área.
- PDF com layout simples; XLSX limitado a 10 MB por arquivo.
- Sem integração com balança, leitor de brinco ou RFID (a tabela de identificações já comporta os códigos).

## 4. Premissas a validar

Esforço se a premissa for falsa: **C** = muda configuração; **A** = mudança aditiva de esquema ou de tela; **D** = mudança de desenho.

| ID | Premissa (padrão adotado) | Por que é razoável | Se for falsa | Responder antes de |
|---|---|---|---|---|
| PR-01 | Conta Google pessoal; usuário único é quem implanta | É o padrão do projeto irmão do mesmo dono | C: cotas maiores numa conta Workspace; D se houver mais usuários (controle de acesso) | Primeira implantação |
| PR-02 | Fuso `America/Porto_Velho`; fazenda em Rondônia | O business case do repositório é de Rondônia | C | `setup()` |
| PR-03 | Marco zero = data do inventário inicial informado na importação | Só a partir de uma contagem confiável o inventário fecha | C: muda a data; o histórico anterior continua informativo | Importação inicial |
| PR-04 | Dados históricos em planilha (Excel ou CSV) | É o formato usual | A: outros modelos de importação; digitação se for caderno | Importadores da Fase 1 |
| PR-05 | Uso real já na Fase 1 (cadastro e importação) | A base passa a ter valor assim que o rebanho entra | C: adia backup e integridade (não recomendado) | Fase 1 |
| PR-06 | Registro em campo pelo celular, com sinal fraco | Pesagem e vacinação acontecem no curral | C: se o registro for sempre no escritório, o modo curral perde prioridade | Fase 3 |
| PR-07 | Monta natural a campo, com ou sem estação; inseminação eventual | Manejo dominante nesse porte | C: sementes e telas da reprodução | Fase 3 |
| PR-08 | Brinco colocado depois do nascimento; numeração pode ter zeros à esquerda; sem identificação oficial obrigatória | Bezerro a campo raramente é brincado no dia | C: parâmetros de identificação | Fase 1 |
| PR-09 | Vendas para frigorífico (peso de carcaça) e de reposição (cabeça ou kg vivo) | São as duas formas usuais | C: rendimento padrão e modalidades | Fase 2 |
| PR-10 | Controle de estoque de insumos opcional por produto, desligado por padrão | A §22 trata estoque como futuro; a §10 pede consumo e custo | C por produto | Fase 3 |
| PR-11 | Insumo vira custo quando é aplicado, não quando é comprado | Evita contar duas vezes; é o regime de competência | D leve: se o dono preferir custo na compra, a aplicação deixa de gerar lançamento | Fase 3 |
| PR-12 | Todos os animais são do dono; todos os pastos são da propriedade | Não há menção a parceria na especificação | A no esquema (`proprietario_id`; pasto alugado como outra propriedade), mas com efeito em patrimônio, financeiro e lotação | **Congelamento do esquema (Fase 1)** |
| PR-13 | "Lote" sem entidade própria | A especificação não a define e a §22 a deixa para depois | A: tabela e coluna de lote | Fase 3 |
| PR-14 | Categorias-semente e faixas etárias de 12, 24 e 36 meses | Nomenclatura e faixas usuais em guias e declarações | C: tabela de categorias e parâmetro de faixas | Fase 1 |
| PR-15 | Parâmetros zootécnicos: UA de 450 kg; gestação de 290 dias; pesagem válida por 180 dias; GMD com intervalo mínimo de 28 dias; idade reprodutiva mínima de 24 meses | Pontos de partida comuns; nenhum é recomendação técnica | C | Uso de cada indicador |
| PR-16 | Implantação por clasp no Cloud Shell, como no projeto irmão | O dono já fez esse fluxo | C: cópia manual dos arquivos | Primeira implantação |

**Nenhuma premissa bloqueia o início da Fase 1.** A PR-12 é a única cuja resposta muda regras de patrimônio e de financeiro; por isso convém tê-la antes de congelar o esquema. Se ficar sem resposta, vale o padrão, e a mudança posterior é aditiva.

## 5. Inconsistências e ambiguidades da especificação

| # | Trecho | O problema | Solução adotada | Referência |
|---|---|---|---|---|
| 1 | §6 | Os eventos depois de 6.3 estão numerados de 4.4 a 4.12 | Lidos como 6.4 a 6.12 | — |
| 2 | §4.9 × §11.3 | FINANCEIRO não tem vencimento; §11.3 exige vencimento, pagamento, recebimento e status | Lançamento (FINANCEIRO) separado de título (PARCELAS) | DV-02 |
| 3 | §11-B × §11.3 | "Compra de animais" está em custos diretos, mas não pode ser tratada como despesa de manutenção | Grupo (apresentação) separado de natureza (cálculo) | DV-12 |
| 4 | §2.3 × §4.4 | Eventos imutáveis, mas com campo `status` e estorno | Imutável é o conteúdo; `status` é cache derivado | DV-14 |
| 5 | §2.1 × §16 regra 19 | Brinco único e obrigatório × "identificar animais sem identificação física" | Brinco opcional; unicidade entre os preenchidos | DV-05 |
| 6 | §5 × §2.3 | "Cadastrar animal" numa tela × modelo em que tudo é evento | Cadastrar = registrar um evento de entrada | DV-06 |
| 7 | §4.3 | `categoria_atual` como campo, mas a categoria muda com a idade, sem evento | Calculada na leitura; só a reclassificação manual é guardada | DV-09 |
| 8 | §4.3 × §11.4 | `valor_estimado` como campo × evolução patrimonial no tempo | Calculado na leitura, com tabela de preços vigentes | DV-10 |
| 9 | §4.3 × §17 | `foto_url` × não expor dados em URL | Referência a anexo privado | DV-11 |
| 10 | §6 (pesagem), §8 × §22 | "Pesagem por lote" e "evolução por lote" sem definir lote; comparação entre lotes é futuro | Lote = grupo do evento ou recorte por pasto e categoria | DV-13 |
| 11 | §4.10, §10 × §22 | Estoque atual e consumo no modelo × controle de estoque como futuro | Estoque opcional por produto; consumo e custo sempre | PR-10 |
| 12 | §19 Fase 1 × §14 | "Importação inicial" na Fase 1, mas ela inclui eventos das Fases 2 e 3 | Importadores entregues junto com os eventos de cada fase | `10` |
| 13 | §15 × §19 × §20 | Menu com Dashboard desde o início × dashboard na Fase 5 × "sem botão sem função" | Menu mostra só módulos entregues; "Visão geral" com números reais desde a Fase 1 | `08` |
| 14 | §19 | Compras e vendas aparecem nas Fases 2 e 4 | O evento grava o financeiro completo na Fase 2; a Fase 4 entrega o módulo financeiro | P11 |
| 15 | §19 × §17 | Auditoria na Fase 2 e backup sem fase, com dados reais na Fase 1 | Antecipados para a Fase 1 | DV-18 |
| 16 | §6 (descarte) | Descarte "com receita" se confunde com venda | Venda de animal de descarte é VENDA; DESCARTE é saída sem negociação | `04` |
| 17 | §6.1 × §6 (reprodução) | "Situação do nascimento" × "Natimorto" como registro à parte | Um parto, com nascidos vivos e natimortos | DV-15 |
| 18 | §6 (reprodução) | "Cobertura" e "Monta natural" como itens distintos, sem definição | Cobertura datada × exposição a campo | `04` |
| 19 | §4.14 × modelo | "Unidade de peso" configurável | Armazenamento em kg; a configuração afeta só a exibição | DV-17 |
| 20 | §6.3 | "Data prevista de recebimento" única × pagamento em parcelas | É o vencimento da primeira parcela aberta | DV-16 |
| 21 | §6.3, §11.1 | "Valor por kg ou arroba" sem dizer se é peso vivo ou carcaça, e "não confundir" os dois | Base de peso e tipo de rendimento explícitos | `07` |
| 22 | §2.4 | "Compensação/estorno para falhas" pressupõe desfazer gravação | A primeira fase só anexa linhas inertes: não há o que desfazer | `06` |
| 23 | §4.5 | EVENTO_ANIMAIS não distingue mãe e cria no mesmo evento | Coluna de papel | DV-03 |
| 24 | §14 × §2.4 | Importação parcial "quando aprovada" × tudo ou nada | Total por padrão; parcial só com aprovação registrada | `06` |
| 25 | §13 | PDF "quando tecnicamente viável" | Viável pela exportação do Drive, a confirmar no spike | SP-07 |
| 26 | §17 | "Executar como proprietário" × "usuário que acessa" a avaliar | Comparação e escolha justificadas | `01` |
| 27 | §9 | Taxas pedidas sem definir denominadores | Dicionário de indicadores com numerador, denominador e janela | `07` |
| 28 | §12 | Seis filtros para todos os indicadores, mas alguns não se aplicam (finanças por sexo) | Cada indicador declara os filtros aplicáveis; o resto é rotulado | `07` |
| 29 | §8 | "Peso ao nascer" como indicador, mas bezerro a campo raramente é pesado | Parâmetro de peso padrão por sexo, marcado como estimado | `07` |
| 30 | §22 × §6 | Projeção de peso é futuro na §22 e requisito na §8 | Projeção simples no MVP, sempre rotulada; projeção de idade de abate fica fora | `07` |

## 6. Decisões bloqueantes

Não há. O que existe são decisões recomendadas antes de marcos específicos:

| Decisão | Antes de | Impacto de adiar |
|---|---|---|
| PR-12 — há gado de terceiros, parceria ou pasto alugado? | Congelar o esquema, no início da Fase 1 | Vale o padrão. Mudar depois é aditivo no esquema, mas obriga a rever filtros de patrimônio e financeiro já entregues |
| PR-03 — data do marco zero | Importação inicial | Sem a data não há fotografia do rebanho; o cadastro manual continua possível |
| PR-04 — formato dos dados históricos | Construir os importadores | Importador genérico por mapeamento de colunas cobre a maior parte; o resto vira digitação |
| PR-16 — forma de implantação | Primeira implantação | Nenhum: os dois caminhos são suportados |
| PR-09 — forma de venda predominante | Formulário de venda, na Fase 2 | Todas as modalidades existem; muda só o padrão sugerido |
| PR-07, PR-10, PR-11 — reprodução, estoque e regra de custo de insumo | Fase 3 | Valem os padrões; PR-11 muda uma regra do resultado gerencial |
