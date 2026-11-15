# ERP Pecuário — Fase 0: desenho técnico

**Status:** aprovada pelo dono em 14/11/2026, com autorização para executar as fases seguintes com autonomia total. Este conjunto é o desenho; o andamento da implementação está em [`../CHANGELOG.md`](../CHANGELOG.md).

## Resumo executivo

O que será construído: um sistema web de gestão de rebanho de corte, para 100 a 500 animais e um usuário, em Google Apps Script com Google Sheets como banco e HTML/CSS/JavaScript como interface. Cada animal é acompanhado do nascimento ou da compra até a venda, com histórico permanente de eventos, inventário reconstruível em qualquer data e resultado econômico por animal.

Seis decisões definem a solução:

1. **Gravação em três fases com commit em uma única célula.** O Sheets não tem transação. Cada operação primeiro só anexa linhas, depois confirma trocando uma célula, depois aplica o que é derivado. Uma queda no meio nunca deixa metade dos animais vendidos, e a recuperação nunca precisa desfazer nada.
2. **Eventos vigentes, com anulação e substituição.** Estornar tira o evento do cálculo; corrigir é registrar um substituto. Nada é apagado, e o estado atual do animal é sempre recalculável pelos eventos.
3. **Marco zero.** O inventário é exato da data do inventário inicial em diante. O histórico anterior entra como informação (curva de peso, vacinas, custo), sem obrigar a reconstituir cada transferência antiga.
4. **Financeiro em dois níveis, com natureza e razão único por animal.** O lançamento é separado da parcela; a natureza da conta decide o cálculo (compra de animal não é custeio); e todo valor atribuído a um animal passa por uma única tabela de alocações, com o critério de rateio registrado.
5. **Regra de negócio separada da planilha e testável fora do Google.** O domínio é JavaScript puro, exercitado em Node a cada commit; trocar o Sheets por um banco relacional é trocar um adaptador.
6. **Tipos sob controle.** A planilha converte `0012` em 12 e `=A1` em fórmula. O desenho fixa o contrato "valor lido = valor gravado" e deixa a escolha da forma de gravar para um teste real, o primeiro da Fase 1.

## Os 12 entregáveis pedidos

| # | Entregável (§23) | Documento |
|---|---|---|
| 1 | Resumo executivo | Este arquivo |
| 2 | Arquitetura técnica detalhada | [`01-arquitetura.md`](01-arquitetura.md) |
| 3 | Diagrama de entidades e relacionamentos | [`02-modelo-de-dados.md`](02-modelo-de-dados.md), seção 3 |
| 4 | Dicionário de dados | [`03a-dicionario-cadastros-suporte.md`](03a-dicionario-cadastros-suporte.md) e [`03b-dicionario-eventos-financeiro.md`](03b-dicionario-eventos-financeiro.md) |
| 5 | Diagrama do fluxo de eventos | [`04-motor-de-eventos.md`](04-motor-de-eventos.md), seções 2 e 3 |
| 6 | Matriz de regras de negócio | [`05-regras-de-negocio.md`](05-regras-de-negocio.md) |
| 7 | Estrutura de arquivos do Apps Script | [`01-arquitetura.md`](01-arquitetura.md), seção 6 |
| 8 | Estratégia de persistência e integridade | [`06-persistencia-e-integridade.md`](06-persistencia-e-integridade.md) |
| 9 | Plano de testes | [`09-plano-de-testes.md`](09-plano-de-testes.md) |
| 10 | Plano de implementação incremental | [`10-plano-de-implementacao.md`](10-plano-de-implementacao.md) |
| 11 | Riscos técnicos e soluções | [`11-riscos-e-premissas.md`](11-riscos-e-premissas.md), seções 1 a 3 |
| 12 | Premissas a validar | [`11-riscos-e-premissas.md`](11-riscos-e-premissas.md), seções 4 a 6 |

Além dos doze: modelo financeiro e indicadores ([`07`](07-financeiro-e-indicadores.md)), experiência de uso ([`08`](08-ux-ui.md)), fatos de plataforma com fonte ([`12`](12-fatos-de-plataforma.md)) e o registro da revisão adversarial ([`13`](13-revisao-adversarial.md)).

## Números do desenho

| Item | Quantidade |
|---|---|
| Abas (tabelas) | 34 |
| Tipos de evento | 21 |
| Regras de negócio numeradas | 112 (50 erros, 13 avisos com aceite, 6 alertas, 43 invariantes) |
| Cenários de teste | 20 (os 10 da §18 e mais 10) |
| Riscos mapeados | 31 (o R-31, orçamento da página, entrou na Fase 2) |
| Premissas a validar | 16 (1 já respondida) |
| Itens do spike técnico | 10 |
| Fases de implementação | 5 |

## Decisões que mais importam

| Decisão | Problema que resolve | Onde |
|---|---|---|
| Commit em `OPERACOES.status`, três fases | Gravação parcial em evento coletivo (§2.4) | `06`, seção 5 |
| Um validador de linha do tempo para evento novo, retroativo, estorno e substituição | Vender duas vezes, mover animal morto, transferir de pasto errado (§16) | `04`, seção 5 |
| Estorno anula; correção substitui com os mesmos animais | Estorno em dobro; corrigir uma compra sem trocar o identificador do animal | `04`, seções 1 e 4.6 |
| Marco zero e histórico informativo | Importar histórico sem travar a validação (§14) | `04`, seção 6 |
| FINANCEIRO × PARCELAS; natureza da conta | Rateio que não fecha; compra tratada como custeio (§11.3) | `07`, seções 1 e 2 |
| Alocações como única fonte de valor por animal | Dupla contagem de custo | `07`, seção 3 |
| Insumo vira custo no consumo | Vacina contada na compra e na aplicação | `07`, seção 5 |
| Exposição à monta como fato | Taxa de prenhez sem denominador (§9) | `04`, seção 4.5; `07`, seção 8 |
| Formulário gerado de um catálogo no servidor | Regra duplicada entre tela e servidor (§20) | `04`, seção 7 |
| Rascunho persistente e modo curral | Perder 80 pesos digitados no celular | `08` |

## Onde o desenho diverge do texto da especificação

A lista completa (DV-01 a DV-20) está em `02-modelo-de-dados.md`, seção 9. As mais relevantes:

| Especificação | O que o desenho fez | Motivo |
|---|---|---|
| FINANCEIRO com pagamento e status na mesma linha (§4.9) | Lançamento separado de parcela | A §11.3 pede vencimento, pagamento e status por título |
| `categoria_atual` como campo (§4.3) | Calculada na leitura | A categoria muda com a idade, sem evento |
| `valor_estimado` como campo (§4.3) | Calculado por tabela de preços com vigência | Permite a série histórica do patrimônio |
| Brinco único e obrigatório (§2.1) | Brinco opcional; único entre os preenchidos | A regra 19 da §16 pede identificar animais sem brinco |
| "Cadastrar animal" numa tela (§5) | Cadastrar é registrar um evento de entrada | Coerência com o modelo por eventos (§2.3) |
| GMD, ganho e dias calculados automaticamente (§6) | Calculados na leitura, sem gravar o resultado | Uma pesagem com data passada invalidaria o valor gravado |
| "Lote" em pesagem e desempenho (§6, §8) | Sem entidade própria no MVP | A especificação não a define; a §22 a trata como futuro |
| Auditoria na Fase 2; backup sem fase (§19) | Antecipados para a Fase 1 | A base recebe dados reais na importação inicial |
| Natimorto como registro à parte (§6) | Parte do evento de parto | Um parto conta para os indicadores mesmo sem nascido vivo |
| PASTOS sem indicação de posse (§4.2) | `posse` e `arrendador_id`; conta de arrendamento | Informado pelo dono: às vezes o gado fica em pasto alugado |

As 30 ambiguidades e contradições encontradas na especificação, com a leitura adotada em cada uma, estão em `11-riscos-e-premissas.md`, seção 5.

## O que foi verificado e o que não foi

**Verificado nesta fase:**

- **Revisão adversarial do desenho, antes da redação.** Sete revisores independentes atacaram o desenho-base: 110 achados (5 bloqueantes, 39 altos). Todos foram decididos um a um; os cinco bloqueantes mudaram o desenho. Detalhe em `13-revisao-adversarial.md`.
- **Diagramas.** Os 23 diagramas Mermaid dos 14 documentos foram renderizados em navegador, sem erro. Tabelas e blocos de código foram conferidos por script.
- **Consistência de nomes.** Um script confere, contra o desenho-base, as colunas das 34 abas no dicionário, toda referência `TABELA.coluna`, as rotas da API, os identificadores (regras, cenários, riscos, premissas, itens do spike) e os arquivos citados.
- **Exemplos numéricos.** Conferidos por script pelos autores e refeitos por um revisor independente, com script próprio: 291 conferências, nenhuma divergência.
- **Revisão independente dos documentos.** Três revisores (finanças e domínio, protocolo e plataforma, cobertura da especificação) devolveram 54 achados, 5 de severidade alta; todos foram aplicados. Os de severidade alta eram de regra, não de conta: dupla contagem do arrendamento num filtro do dashboard, compra de insumo sem caminho definido e três furos na análise de queda do protocolo de gravação. Detalhe em `13-revisao-adversarial.md`, seção 8.
- **Fatos de plataforma.** Cada afirmação sobre Apps Script, Sheets e Drive tem fonte e grau de verificação em `12-fatos-de-plataforma.md`. A existência dos métodos foi conferida nos tipos oficiais; nenhuma API citada é inventada.

**Não verificado, por não ser possível nesta fase:**

- **Nada foi executado no Google.** Não houve acesso à conta nem ao projeto Apps Script do dono, e a documentação oficial do Google estava inacessível nesta sessão. Comportamentos de plataforma (conversão de tipos na gravação, liberação de lock, escopo de acesso ao Drive, armazenamento local no celular) ficaram como suposição documentada.
- **O spike técnico** (10 itens, `10-plano-de-implementacao.md`, seção 3) existe para transformar essas suposições em fato antes de construir sobre elas. Cada item tem critério de aprovação e plano B.
- **Desempenho.** Os tempos são estimativas; o orçamento só é aprovado com medição real.

## Premissas a validar

Nenhuma bloqueia o início da Fase 1: todas têm valor padrão configurável. Detalhe e impacto de cada uma em `11-riscos-e-premissas.md`, seção 4.

| ID | Padrão adotado |
|---|---|
| PR-01 | Conta Google pessoal; usuário único é quem implanta |
| PR-02 | Fuso de Porto Velho; fazenda em Rondônia |
| PR-03 | Marco zero = data do inventário inicial |
| PR-04 | Dados históricos em planilha |
| PR-05 | Uso real já na Fase 1 |
| PR-06 | Registro em campo pelo celular, com sinal fraco |
| PR-07 | Monta natural a campo; inseminação eventual |
| PR-08 | Brinco colocado depois do nascimento; zeros à esquerda possíveis |
| PR-09 | Venda para frigorífico e venda de reposição |
| PR-10 | Controle de estoque de insumos opcional, desligado por padrão |
| PR-11 | Insumo vira custo na aplicação, não na compra |
| PR-12 | **Respondida:** sem gado de terceiros nem parceria; pasto arrendado incorporado ao modelo |
| PR-13 | "Lote" sem entidade própria |
| PR-14 | Categorias-semente e faixas de 12, 24 e 36 meses |
| PR-15 | UA de 450 kg; gestação de 290 dias; pesagem válida por 180 dias |
| PR-16 | Implantação por clasp, como no projeto irmão |

## Plano

| Fase | O que entrega | Como é testada |
|---|---|---|
| 1 — Fundação | Spike; banco e `setup()`; gravação em três fases; cadastro de pastos e animais; ficha e genealogia; importação do rebanho; backup e integridade | Testes em Node; testes de aceitação na conta do dono; ensaio de restauração |
| 2 — Motor de eventos | Nascimento, compra e venda com financeiro, transferência, morte, descarte, estorno e correção; inventário em data passada | Cenários 1 a 4 e 7 a 9 da §18 |
| 3 — Manejo | Pesagem com modo curral e GMD; sanidade com agenda e carência; reprodução | Cenários 5 e 6 da §18 |
| 4 — Financeiro | Lançamentos, baixas, rateios, custos por animal e por pasto, patrimônio | Conciliação entre caixa e resultado |
| 5 — Inteligência | Dashboard, 17 relatórios, exportações, alertas | Exportação conferida contra a tela |

## Próximo passo

Para aprovar, a leitura essencial leva pouco mais de duas horas, nesta ordem:

| Ordem | Documento | Por quê | Leitura |
|---|---|---|---|
| 1 | Este README | Visão geral | 10 min |
| 2 | [`11-riscos-e-premissas.md`](11-riscos-e-premissas.md) | O que pode dar errado e o que precisa da sua resposta | 20 min |
| 3 | [`10-plano-de-implementacao.md`](10-plano-de-implementacao.md) | O que será entregue em cada fase | 15 min |
| 4 | [`04-motor-de-eventos.md`](04-motor-de-eventos.md) | Como cada evento se comporta | 20 min |
| 5 | [`07-financeiro-e-indicadores.md`](07-financeiro-e-indicadores.md) | Fórmulas e exemplos numéricos | 35 min |
| 6 | [`08-ux-ui.md`](08-ux-ui.md) | Como será o uso no dia a dia | 35 min |

Os demais são de consulta: arquitetura (`01`), modelo e dicionário de dados (`02`, `03a`, `03b`), regras (`05`), persistência (`06`), testes (`09`), fatos de plataforma (`12`) e revisão adversarial (`13`).

Ao aprovar, a Fase 1 começa pelo spike técnico, que depende de o dono criar o projeto Apps Script e rodar um roteiro de diagnóstico na própria conta.

## Índice

| Documento | Conteúdo |
|---|---|
| [`00-desenho-base.md`](00-desenho-base.md) | Resumo canônico das decisões, com as decisões posteriores e as de execução autônoma |
| [`01-arquitetura.md`](01-arquitetura.md) | Camadas, princípios, contrato da API, publicação e acesso, estrutura de arquivos, evolução |
| [`02-modelo-de-dados.md`](02-modelo-de-dados.md) | Diagramas de entidades, relacionamentos, regra de vigência, divergências da especificação |
| [`03a-dicionario-cadastros-suporte.md`](03a-dicionario-cadastros-suporte.md) | Tipos, enums, cadastros, suporte, parâmetros e sementes |
| [`03b-dicionario-eventos-financeiro.md`](03b-dicionario-eventos-financeiro.md) | Eventos, detalhes e financeiro, coluna a coluna, com exemplos |
| [`04-motor-de-eventos.md`](04-motor-de-eventos.md) | Pipeline, máquinas de estado, catálogo de eventos, linha do tempo, marco zero |
| [`05-regras-de-negocio.md`](05-regras-de-negocio.md) | Matriz das 112 regras, algoritmos, mensagens de erro |
| [`06-persistencia-e-integridade.md`](06-persistencia-e-integridade.md) | Gravação em três fases, análise de queda, recuperação, integridade, backup |
| [`07-financeiro-e-indicadores.md`](07-financeiro-e-indicadores.md) | Modelo financeiro, rateio, compra e venda, patrimônio, indicadores, dashboard, relatórios |
| [`08-ux-ui.md`](08-ux-ui.md) | Navegação, telas, registro de evento, modo curral, estados, importação |
| [`09-plano-de-testes.md`](09-plano-de-testes.md) | Níveis de teste, 20 cenários, testes de queda, massa de dados |
| [`10-plano-de-implementacao.md`](10-plano-de-implementacao.md) | Fases, entregas, spike, requisito por fase, checklist |
| [`11-riscos-e-premissas.md`](11-riscos-e-premissas.md) | Riscos, limitações, premissas, inconsistências da especificação |
| [`12-fatos-de-plataforma.md`](12-fatos-de-plataforma.md) | Fatos de Apps Script, Sheets e Drive, com fonte e grau de verificação |
| [`13-revisao-adversarial.md`](13-revisao-adversarial.md) | Os 110 achados da revisão do desenho e a decisão em cada um |
