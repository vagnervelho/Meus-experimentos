# ERP Pecuário — Sistema de Gestão de Rebanho

## Especificação mestre de produto, arquitetura e implementação

> Transcrição da especificação recebida do dono do produto em 13/11/2026. É a fonte de verdade dos requisitos.
> O texto e a numeração originais foram preservados, inclusive a sequência 4.4 a 4.12 dentro da seção 6
> (lida, nos documentos de desenho, como 6.4 a 6.12). Só os separadores visuais viraram títulos Markdown.

Você atuará como um time multidisciplinar composto por:

1. Arquiteto de Software Sênior.
2. Engenheiro Full-Stack especializado em Google Apps Script.
3. Engenheiro de Dados especializado em modelagem relacional e integridade de dados.
4. Especialista em pecuária de corte, gestão de rebanho e manejo bovino.
5. Especialista em UX/UI e desenvolvimento de aplicações web.
6. Analista financeiro especializado em custos, receitas, patrimônio e indicadores gerenciais.

Sua missão é PROJETAR, DESENVOLVER, TESTAR E DOCUMENTAR um sistema web completo para gestão de uma operação de pecuária de corte.

Não quero apenas um protótipo, wireframe, demonstração visual ou conjunto de telas sem funcionalidades.

Quero uma aplicação funcional, com persistência real dos dados, regras de negócio implementadas, relacionamentos consistentes, histórico de eventos, cálculos automáticos e interface profissional.

O sistema será desenvolvido utilizando Google Apps Script como backend, Google Sheets como banco de dados inicial e HTML/CSS/JavaScript como frontend.

---

## 1. CONTEXTO DO NEGÓCIO

A aplicação será utilizada para administrar uma operação de pecuária de corte.

Características iniciais:

- Rebanho aproximado: 100 a 500 animais.
- Todos os animais possuem identificação individual.
- A identificação física será feita principalmente por brincos.
- Atividade principal: pecuária de corte.
- Existem diferentes pastos e os animais podem ser transferidos entre eles.
- É necessário controlar machos e fêmeas.
- É necessário relacionar os bezerros às respectivas mães.
- Deve existir histórico de nascimento, compra, venda, pesagem, vacinação, tratamento, transferência e demais ocorrências.
- Inicialmente, haverá apenas um usuário do sistema.
- Queremos importar informações históricas anteriores à implantação.
- O controle deverá contemplar animais nascidos na propriedade e animais adquiridos de terceiros.

O sistema deverá permitir acompanhar individualmente cada animal durante todo o seu ciclo de vida.

Exemplo:

Nascimento → Identificação → Pastagem → Pesagens → Vacinação → Transferências → Negociação → Venda.

O mesmo animal poderá permanecer vários anos no sistema, acumulando histórico.

O objetivo principal é permitir uma gestão completa do patrimônio pecuário, das operações da fazenda e do desempenho econômico do rebanho.

---

## 2. PRINCÍPIOS FUNDAMENTAIS DO SISTEMA

Estes princípios são obrigatórios e devem orientar toda a arquitetura.

### 2.1. Identificação individual

Cada animal deverá possuir um identificador interno único e imutável.

O número do brinco será um identificador externo, com validação de unicidade entre os animais ativos e históricos, salvo substituição formalmente registrada.

Não utilizar número de linha do Google Sheets como identificador.

### 2.2. Histórico permanente

O sistema deverá preservar todo o histórico dos animais.

Não apagar eventos históricos quando houver mudanças cadastrais.

Não permitir que uma transferência de pasto substitua ou elimine a localização anterior.

Não permitir que uma venda apague o histórico de pesagens, vacinação, nascimento ou movimentações.

### 2.3. Modelo orientado a eventos

O sistema será organizado em torno de eventos operacionais.

Os eventos deverão registrar o que aconteceu, quando aconteceu, quais animais foram envolvidos e quais foram os impactos operacionais e financeiros.

O cadastro atual do animal deverá refletir a situação consolidada dos eventos.

Adotar uma abordagem de Event Sourcing simplificada, com:
- Registro histórico imutável de eventos confirmados.
- Projeções de estado atual dos animais.
- Histórico individual.
- Possibilidade de reconstrução do inventário em datas passadas.
- Estornos e correções por novos registros, sem exclusão silenciosa do histórico.

Não implementar complexidade desnecessária de Event Sourcing distribuído.

### 2.4. Integridade

Toda operação deverá validar as regras de negócio antes de confirmar sua gravação.

Eventos coletivos deverão ser processados de forma consistente.

Não permitir que uma falha deixe apenas parte dos animais movimentados ou vendidos.

Como Google Sheets não oferece transações relacionais convencionais, implementar uma estratégia de gravação segura com:
- LockService.
- Validação prévia.
- Identificador único de operação.
- Registro de processamento.
- Controle de duplicidade.
- Estratégia de compensação/estorno para falhas.
- Reconciliação e auditoria.

### 2.5. Rastreabilidade

Registrar:
- ID do evento.
- Tipo do evento.
- Data de ocorrência.
- Data de registro.
- Usuário responsável.
- Animais envolvidos.
- Origem e destino, quando aplicável.
- Observações.
- Status.
- Referências a documentos ou anexos.

Distinguir data de ocorrência de data de registro.

---

## 3. ARQUITETURA TECNOLÓGICA

Backend:
- Google Apps Script.
- JavaScript compatível com o runtime V8.
- Serviços organizados por domínio.
- Validação centralizada.
- Persistência em Google Sheets.

Frontend:
- HTML5.
- CSS3.
- JavaScript moderno.
- Interface responsiva.
- Componentes reutilizáveis.
- Comunicação com backend utilizando google.script.run.
- Estados de carregamento, sucesso e erro.
- Formulários dinâmicos.

Armazenamento:
- Google Sheets para dados estruturados.
- Google Drive para fotos e documentos.

Não utilizar Firebase, Supabase, servidores externos ou APIs pagas como dependências obrigatórias do MVP.

Bibliotecas externas poderão ser utilizadas quando realmente agregarem valor, mas priorizar soluções leves e confiáveis.

### 3.1. Organização do código

Separar o projeto em arquivos lógicos.

Sugestão inicial:

BACKEND
- Code.gs
- Config.gs
- Database.gs
- Schema.gs
- Validation.gs
- Utils.gs
- AnimalService.gs
- EventService.gs
- PastureService.gs
- WeightService.gs
- HealthService.gs
- ReproductionService.gs
- FinancialService.gs
- InventoryService.gs
- ReportService.gs
- ImportService.gs
- AuditService.gs

FRONTEND
- Index.html
- Styles.html
- JavaScript.html
- Components.html
- Dashboard.html
- Animals.html
- Pastures.html
- Events.html
- Health.html
- Reproduction.html
- Weights.html
- Financial.html
- Reports.html
- Settings.html

Essa estrutura é uma referência. Você poderá ajustá-la se houver justificativa técnica.

Não concentrar toda a lógica em Code.gs.

### 3.2. Banco de dados

Criar uma rotina de inicialização que:

- Crie automaticamente as abas necessárias.
- Crie os cabeçalhos.
- Configure identificadores.
- Configure tabelas auxiliares.
- Valide a estrutura.
- Não apague dados existentes durante atualizações.
- Permita executar novamente sem duplicar tabelas ou registros.

Utilizar IDs UUID ou identificadores únicos equivalentes.

Criar índices lógicos para consultas frequentes, utilizando mapas em memória quando apropriado.

Evitar leituras e escritas célula por célula.

Priorizar operações em lote com getValues() e setValues().

Considerar os limites de execução, quotas e concorrência do Apps Script.

### 3.3. Preparação para evolução

Embora Google Sheets seja o banco inicial, separar a camada de persistência das regras de negócio.

O objetivo é permitir futura migração para um banco relacional sem reescrever todo o sistema.

---

## 4. MODELAGEM DE DADOS

Desenvolver um modelo relacional lógico.

As tabelas abaixo são obrigatórias como ponto de partida.

### 4.1. PROPRIEDADES

Campos:
- property_id
- nome
- descrição
- localização
- área total
- status
- created_at
- updated_at

Mesmo que inicialmente exista apenas uma propriedade, manter essa entidade para permitir expansão.

### 4.2. PASTOS

Campos:
- pasture_id
- property_id
- nome
- identificação
- área_hectares
- tipo_capim
- capacidade_estimada_ua_ha
- capacidade_estimada_cabecas
- observações
- status
- created_at
- updated_at

Cada pasto pertence a uma propriedade.

### 4.3. ANIMAIS

Campos sugeridos:
- animal_id
- brinco
- nome
- sexo
- raça
- data_nascimento
- mãe_id
- pai_id
- origem
- evento_origem_id
- propriedade_atual_id
- pasto_atual_id
- categoria_atual
- situação_reprodutiva
- situação_cadastral
- data_entrada
- data_saida
- peso_atual
- data_ultima_pesagem
- custo_aquisicao
- valor_estimado
- observações
- foto_url
- created_at
- updated_at

Os campos de estado atual devem ser projeções atualizáveis a partir dos eventos, não substitutos do histórico.

### 4.4. EVENTOS

Campos:
- event_id
- event_type
- event_date
- registration_date
- property_id
- description
- status
- total_value
- responsible
- notes
- idempotency_key
- reversal_of_event_id
- created_at

### 4.5. EVENTO_ANIMAIS

Permitir associar vários animais a um único evento.

Campos:
- event_animal_id
- event_id
- animal_id
- peso
- valor_individual
- pasto_origem_id
- pasto_destino_id
- observações

Permitir campos adicionais específicos por tipo de evento, utilizando tabelas de detalhe quando necessário.

### 4.6. PESAGENS

Campos:
- weight_id
- animal_id
- event_id
- data_pesagem
- peso_kg
- método
- observações

### 4.7. SANIDADE

Campos:
- health_id
- animal_id
- event_id
- tipo_procedimento
- produto_id
- nome_produto
- fabricante
- lote
- dose
- unidade_dose
- via_aplicacao
- data_aplicacao
- data_proxima_aplicacao
- período_carencia
- data_fim_carencia
- custo
- veterinário
- observações

### 4.8. REPRODUÇÃO

Campos:
- reproduction_id
- animal_id
- event_id
- tipo_evento
- data
- touro_id
- método
- resultado
- data_prevista_parto
- data_parto
- observações

### 4.9. FINANCEIRO

Campos:
- financial_id
- event_id
- data_competencia
- data_pagamento
- tipo
- categoria
- descrição
- valor
- quantidade
- animal_id
- pasture_id
- partner_id
- status_pagamento
- forma_pagamento
- observações

### 4.10. PRODUTOS

Campos:
- product_id
- nome
- categoria
- fabricante
- unidade
- custo_unitario
- estoque_atual
- estoque_minimo
- validade
- lote
- observações

### 4.11. PARCEIROS

Campos:
- partner_id
- nome
- tipo
- documento
- telefone
- endereço
- observações

### 4.12. CATEGORIAS

Criar tabela configurável com:
- category_id
- nome
- sexo_aplicável
- idade_minima
- idade_maxima
- peso_referência
- descrição
- ativo

As classificações deverão ser configuráveis e não depender de regras rígidas codificadas.

### 4.13. AUDITORIA

Registrar:
- audit_id
- entidade
- entity_id
- ação
- valor_anterior
- valor_novo
- usuário
- timestamp
- justificativa

### 4.14. CONFIGURAÇÕES

Armazenar parâmetros:
- propriedade padrão
- unidade de peso
- conversão de UA
- categorias
- configurações de interface
- parâmetros de projeção
- preferências operacionais

Avaliar a necessidade de tabelas adicionais para detalhes de compras, vendas, partos, protocolos sanitários, contas e anexos.

Não colocar toda a informação em uma única tabela genérica de eventos.

Criar relacionamentos claros e documentados.

---

## 5. CADASTRO E GESTÃO DE ANIMAIS

Criar uma tela de listagem com:

- Brinco.
- ID.
- Sexo.
- Raça.
- Idade.
- Categoria.
- Peso atual.
- Pasto atual.
- Situação.
- Data de nascimento.

Permitir:
- Buscar por brinco.
- Filtrar por pasto.
- Filtrar por sexo.
- Filtrar por categoria.
- Filtrar por situação.
- Filtrar por faixa etária.
- Ordenar colunas.
- Paginar registros.
- Cadastrar animal.
- Editar dados cadastrais.
- Visualizar ficha completa.
- Exportar dados.

### 5.1. Ficha individual

Cada animal deverá possuir uma página detalhada com:

A. Informações gerais.
B. Genealogia.
C. Localização atual.
D. Histórico de pastos.
E. Evolução de peso.
F. Histórico sanitário.
G. Histórico reprodutivo.
H. Histórico financeiro.
I. Eventos associados.
J. Fotos e documentos.

Exibir linha do tempo cronológica.

Permitir consultar todos os bezerros de uma matriz.

### 5.2. Genealogia

Permitir associar mãe e pai.

Regras:
- Não permitir que o animal seja seu próprio pai ou mãe.
- Não permitir data de nascimento anterior à data de nascimento da mãe.
- Validar sexo dos progenitores.
- Evitar ciclos genealógicos.
- Permitir progenitores desconhecidos.
- Identificar parentesco confirmado e não confirmado.

Criar visualização de árvore genealógica quando houver informações suficientes.

---

## 6. MOTOR DE EVENTOS

Este é o principal módulo da aplicação.

Criar uma interface central de registro de eventos, com formulários dinâmicos.

Cada evento deverá ter:
- Tipo.
- Data.
- Animais envolvidos.
- Campos específicos.
- Observações.
- Anexos, quando necessário.
- Impactos operacionais.
- Impactos financeiros.
- Validações.
- Confirmação antes da gravação.

### 6.1. NASCIMENTO

Campos:
- Data do nascimento.
- Identificação do bezerro.
- Sexo.
- Raça.
- Mãe.
- Pai, quando conhecido.
- Peso ao nascer.
- Pasto.
- Observações.
- Situação do nascimento.

Permitir registrar partos gemelares.

O nascimento deverá:
- Criar o animal.
- Associar a mãe.
- Registrar o peso inicial, se informado.
- Registrar o pasto inicial.
- Atualizar o inventário.
- Atualizar o histórico reprodutivo da matriz.

### 6.2. COMPRA

Permitir compra de um ou vários animais.

Campos:
- Fornecedor.
- Data.
- Animais.
- Brincos.
- Sexo.
- Raça.
- Idade ou nascimento.
- Peso.
- Valor individual.
- Valor total.
- Frete.
- Outros custos.
- Pasto de destino.
- Forma e condição de pagamento.
- Documentos.

Permitir compra por lote e negociação individual.

O evento deverá cadastrar ou associar cada animal individualmente.

### 6.3. VENDA

Campos:
- Comprador.
- Data.
- Animais vendidos.
- Peso individual ou peso total do lote.
- Valor por kg ou arroba.
- Preço total.
- Descontos.
- Frete.
- Comissão.
- Condição de pagamento.
- Data prevista de recebimento.
- Observações.

Permitir negociação por:
- Cabeça.
- Quilograma.
- Arroba.
- Lote fechado.

Quando a venda for por lote, permitir rateio do valor entre os animais por peso, valor individual ou critério manual.

O rateio deverá ser transparente e auditável.

A venda deverá:
- Retirar os animais do inventário ativo.
- Registrar a receita.
- Preservar o histórico.
- Atualizar a situação cadastral.
- Impedir novas movimentações operacionais incompatíveis com a situação de vendido.

Não confundir peso vivo com peso de carcaça.

### 4.4. TRANSFERÊNCIA ENTRE PASTOS

Campos:
- Data.
- Pasto de origem.
- Pasto de destino.
- Animais.
- Responsável.
- Observações.

Permitir selecionar múltiplos animais.

Validar se todos os animais estão efetivamente no pasto de origem na data da movimentação.

Atualizar a localização atual.

Preservar o histórico anterior.

### 4.5. PESAGEM

Permitir:
- Pesagem individual.
- Pesagem coletiva.
- Pesagem por lote.
- Importação de pesagens.

Registrar:
- Animal.
- Data.
- Peso.
- Método.
- Observações.

Calcular automaticamente:
- Ganho absoluto.
- GMD.
- Variação percentual.
- Dias desde a pesagem anterior.

Não substituir pesagens anteriores.

### 4.6. VACINAÇÃO

Campos:
- Data.
- Produto.
- Fabricante.
- Lote.
- Validade.
- Dose.
- Via de aplicação.
- Animais.
- Responsável.
- Custo.
- Próxima aplicação.
- Observações.

Permitir aplicação coletiva.

Manter histórico individual.

Permitir protocolos sanitários configuráveis.

Não codificar calendários sanitários fixos como regras universais. Permitir parametrização conforme orientação veterinária e exigências oficiais vigentes.

### 4.7. VERMIFUGAÇÃO E TRATAMENTOS

Permitir registrar:
- Produto.
- Dose.
- Via.
- Data.
- Animal.
- Motivo.
- Custo.
- Período de carência.
- Próxima aplicação.

### 4.8. MORTE

Campos:
- Animal.
- Data.
- Causa.
- Diagnóstico.
- Responsável.
- Custos associados.
- Observações.

Retirar do inventário ativo, preservando o histórico.

### 4.9. DESCARTE

Permitir registrar animais descartados e, quando houver, receita correspondente.

### 4.10. REPRODUÇÃO

Registrar:
- Cobertura.
- Monta natural.
- Inseminação artificial.
- Diagnóstico de gestação.
- Resultado.
- Previsão de parto.
- Parto.
- Aborto.
- Natimorto.
- Desmama.

### 4.11. DESMAMA

Registrar:
- Animal.
- Data.
- Peso.
- Matriz.
- Pasto de destino.
- Observações.

### 4.12. AJUSTE DE INVENTÁRIO

Permitir correções justificadas por:
- Erro de cadastro.
- Identificação incorreta.
- Divergência de contagem.
- Reclassificação.
- Correção de localização.

Todo ajuste deverá gerar evento próprio e manter o valor anterior registrado.

---

## 7. GESTÃO DE PASTOS E LOTAÇÃO

Criar painel individual por pasto.

Exibir:
- Nome.
- Área.
- Quantidade de animais.
- Machos.
- Fêmeas.
- Categorias.
- Peso vivo total.
- UA total.
- UA/ha.
- Capacidade estimada.
- Ocupação percentual.

Permitir consultar composição do pasto em uma data histórica.

### 7.1. Unidade Animal

Utilizar como referência inicial configurável:

1 UA = 450 kg de peso vivo.

Fórmula:

UA = soma dos pesos dos animais / 450.

Lotação:

UA/ha = UA total do pasto / área em hectares.

Permitir alterar o parâmetro de conversão.

Não presumir que a capacidade de suporte seja determinada exclusivamente pela área.

---

## 8. GESTÃO DE PESO E DESEMPENHO

Criar módulo de análise de desempenho.

Indicadores:

- Peso atual.
- Peso ao nascer.
- Peso à desmama.
- Peso médio por categoria.
- Peso médio por pasto.
- Ganho acumulado.
- GMD.
- Evolução percentual.
- Comparação entre animais.
- Evolução por lote.

Fórmulas:

Ganho absoluto = peso atual - peso anterior.

GMD = (peso atual - peso anterior) / dias entre pesagens.

Variação percentual = (peso atual / peso anterior - 1) * 100.

Criar gráficos de evolução individual e agregada.

Permitir projeções de peso futuro com base no GMD histórico.

Identificar claramente projeções como estimativas, nunca como pesagens reais.

Permitir filtrar por:
- Período.
- Pasto.
- Sexo.
- Categoria.
- Raça.

---

## 9. GESTÃO REPRODUTIVA

Criar ficha reprodutiva individual das matrizes.

Registrar:
- Histórico de partos.
- Quantidade de bezerros.
- Datas de cobertura.
- Inseminações.
- Diagnósticos.
- Perdas gestacionais.
- Intervalo entre partos.
- Situação reprodutiva.

Indicadores:
- Matrizes ativas.
- Matrizes prenhas.
- Taxa de prenhez.
- Taxa de natalidade.
- Intervalo médio entre partos.
- Bezerros por matriz.
- Mortalidade de bezerros.

Documentar precisamente os denominadores utilizados nas taxas.

Não calcular indicadores quando não houver dados suficientes.

Permitir identificar matrizes sem histórico reprodutivo.

---

## 10. GESTÃO SANITÁRIA

Criar módulo específico de sanidade.

Funcionalidades:
- Histórico individual.
- Vacinas.
- Vermifugação.
- Medicamentos.
- Doenças.
- Tratamentos.
- Exames.
- Protocolos.
- Alertas.
- Controle de carência.

Criar agenda sanitária com:
- Procedimentos vencidos.
- Procedimentos próximos do vencimento.
- Animais pendentes.
- Protocolos executados.
- Custos por período.

Criar biblioteca configurável de produtos.

Controlar lote, validade, dose, quantidade consumida e custo.

Não prescrever medicamentos ou definir protocolos veterinários automaticamente.

---

## 11. GESTÃO FINANCEIRA

Criar módulo financeiro completo para a operação.

Separar:

A. RECEITAS
- Venda de animais.
- Outras receitas operacionais.
- Receitas extraordinárias.

B. CUSTOS DIRETOS
- Compra de animais.
- Alimentação.
- Vacinas.
- Medicamentos.
- Tratamentos.
- Transporte.
- Reprodução.

C. CUSTOS OPERACIONAIS
- Manutenção de pastos.
- Mão de obra.
- Equipamentos.
- Combustível.
- Energia.
- Serviços veterinários.

D. DESPESAS ADMINISTRATIVAS
- Contabilidade.
- Despesas gerais.
- Outros gastos.

Permitir vincular despesas a:
- Animal.
- Pasto.
- Categoria.
- Evento.
- Período.
- Propriedade.

### 11.1. Compras e vendas

Registrar valores individualizados e totais.

Calcular:
- Preço médio por cabeça.
- Preço médio por kg.
- Preço por arroba.
- Receita total.
- Custos adicionais.
- Resultado da negociação.

Considerar que 1 arroba corresponde a 15 kg para conversões comerciais usuais, deixando clara a distinção entre peso vivo e rendimento de carcaça.

### 11.2. Custos por animal

Permitir acompanhar:
- Custo de aquisição.
- Custos sanitários.
- Custos de alimentação.
- Custos adicionais atribuídos.
- Custo acumulado.
- Receita de venda.
- Resultado realizado.

Custos compartilhados deverão poder ser alocados por critérios configuráveis, como:
- Número de cabeças.
- Peso vivo.
- Dias de permanência.
- Percentual manual.

Exibir o critério de rateio utilizado.

Não atribuir automaticamente custos de um pasto a um animal sem apresentar o método de alocação.

### 11.3. Fluxo financeiro

Permitir registrar:
- Competência.
- Vencimento.
- Pagamento.
- Recebimento.
- Status.
- Forma de pagamento.

Distinguir fluxo de caixa de resultado econômico.

Não considerar uma compra como despesa integral de manutenção do animal.

Manter separado o custo de aquisição e o custo operacional.

### 11.4. Patrimônio pecuário

Calcular:
- Total de cabeças.
- Valor estimado.
- Valor por categoria.
- Valor por pasto.
- Evolução patrimonial.

Permitir definir valores estimados por animal ou categoria.

Distinguir valor estimado de valor efetivamente negociado.

---

## 12. DASHBOARD GERENCIAL

Criar dashboard profissional, visual e orientado à tomada de decisão.

Priorizar gráficos, indicadores, tabelas resumidas e filtros.

Indicadores principais:

- Total de cabeças.
- Machos.
- Fêmeas.
- Nascimentos no período.
- Compras no período.
- Vendas no período.
- Mortes no período.
- Total de UA.
- Peso médio.
- Peso vivo total.
- Valor estimado do rebanho.
- Receita de vendas.
- Custos operacionais.
- Resultado financeiro.
- Distribuição por pasto.
- Distribuição por categoria.

Criar filtros:
- Data inicial.
- Data final.
- Propriedade.
- Pasto.
- Sexo.
- Categoria.

Criar gráficos:
- Evolução do tamanho do rebanho.
- Distribuição por sexo.
- Distribuição por categoria.
- Animais por pasto.
- Evolução do peso.
- Nascimentos e mortes.
- Compras e vendas.
- Evolução de receitas e custos.
- Evolução do valor estimado do rebanho.

Não misturar dados históricos com projeções.

Exibir data de atualização dos indicadores.

Não apresentar indicadores com dados ausentes como zero quando isso puder induzir interpretação incorreta.

---

## 13. RELATÓRIOS

Criar relatórios exportáveis:

1. Inventário atual.
2. Inventário por pasto.
3. Histórico de movimentações.
4. Histórico individual.
5. Nascimentos.
6. Compras.
7. Vendas.
8. Pesagens.
9. Desempenho por categoria.
10. Desempenho por pasto.
11. Histórico sanitário.
12. Reprodução.
13. Mortalidade.
14. Custos por animal.
15. Custos por pasto.
16. Fluxo financeiro.
17. Patrimônio pecuário.

Permitir exportação para CSV e XLSX, e PDF quando tecnicamente viável.

---

## 14. IMPORTAÇÃO DO HISTÓRICO

Criar uma funcionalidade de importação inicial.

O objetivo é cadastrar o inventário existente e importar eventos anteriores.

Permitir importar:
- Animais.
- Brincos.
- Sexo.
- Raça.
- Nascimento.
- Mãe e pai.
- Pasto atual.
- Pesagens.
- Compras.
- Vendas.
- Vacinações.
- Transferências.
- Outros eventos.

Criar fluxo:

1. Upload ou seleção do arquivo.
2. Leitura dos dados.
3. Mapeamento de colunas.
4. Validação.
5. Pré-visualização.
6. Identificação de duplicidades.
7. Identificação de erros.
8. Confirmação.
9. Importação.
10. Relatório final.

Não importar silenciosamente registros inconsistentes.

Permitir importação parcial somente quando isso for explicitamente informado e aprovado.

Preservar os dados originais.

Distinguir:
- Informação confirmada.
- Informação estimada.
- Informação desconhecida.

Criar rotina de reconciliação entre o inventário importado e os eventos históricos disponíveis.

---

## 15. UX/UI E EXPERIÊNCIA DE USO

A interface deverá ter aparência de um produto SaaS profissional.

Referências conceituais:
- Sistemas modernos de gestão empresarial.
- Aplicações de gestão financeira.
- ERPs agrícolas.
- Dashboards analíticos.

Diretrizes:

- Design limpo.
- Hierarquia visual clara.
- Pouco texto desnecessário.
- Cards de indicadores.
- Tabelas organizadas.
- Filtros intuitivos.
- Gráficos objetivos.
- Formulários simples.
- Navegação rápida.
- Feedback visual.
- Responsividade.

A aplicação deverá funcionar bem em:
- Desktop.
- Notebook.
- Tablet.
- Celular.

Criar menu lateral no desktop e navegação adaptada em dispositivos móveis.

Estrutura do menu:

1. Dashboard.
2. Rebanho.
3. Pastos.
4. Eventos.
5. Pesagens.
6. Sanidade.
7. Reprodução.
8. Financeiro.
9. Relatórios.
10. Configurações.

Criar botão de ação rápida:

"REGISTRAR EVENTO"

Esse botão deverá permitir selecionar o tipo de evento e iniciar o formulário correspondente.

Não exigir navegação por várias telas para registrar uma operação simples.

Implementar:
- Loading.
- Mensagens de sucesso.
- Mensagens de erro.
- Confirmações de operações críticas.
- Validação de campos.
- Prevenção de duplo clique.
- Busca e filtros.
- Paginação.
- Ordenação.

Evitar interfaces excessivamente carregadas.

---

## 16. REGRAS DE NEGÓCIO E VALIDAÇÕES

Implementar, no mínimo:

1. Não permitir duplicidade de identificação individual.
2. Não permitir duplicidade de IDs.
3. Não permitir venda de animal já vendido.
4. Não permitir movimentação de animal morto.
5. Não permitir transferência para pasto inexistente.
6. Não permitir transferência com origem divergente da localização do animal.
7. Não permitir nascimento anterior ao nascimento da mãe.
8. Não permitir animal como próprio pai ou mãe.
9. Não permitir ciclos genealógicos.
10. Validar datas.
11. Validar pesos.
12. Validar quantidades e valores financeiros.
13. Impedir eventos duplicados por reenvio.
14. Validar consistência dos eventos coletivos.
15. Registrar ajustes e estornos.
16. Não permitir exclusão silenciosa de dados históricos.
17. Permitir alteração de dados cadastrais com auditoria.
18. Identificar animais sem pasto atual.
19. Identificar animais sem identificação física.
20. Validar coerência entre inventário e movimentações.

As validações devem existir no backend, não apenas na interface.

---

## 17. SEGURANÇA, BACKUP E CONFIABILIDADE

Considerando inicialmente um usuário:

- Implementar controle de acesso adequado.
- Restringir acesso ao proprietário autorizado.
- Não expor dados em URLs ou logs públicos.
- Não colocar credenciais no código frontend.
- Utilizar permissões do Google adequadamente.
- Documentar o modelo de publicação do Web App.
- Avaliar cuidadosamente a opção "executar como proprietário" versus "executar como usuário que acessa".
- Não afirmar que Session.getActiveUser().getEmail() sempre estará disponível.
- Implementar backup periódico do banco.
- Criar rotina de verificação de integridade.
- Registrar erros relevantes.
- Criar rotina de restauração documentada.

O sistema deverá ser projetado para operação online no MVP.

Não implementar sincronização offline como requisito inicial. Entretanto, evitar arquitetura que impeça futura evolução para PWA com operação offline.

---

## 18. TESTES E CRITÉRIOS DE ACEITAÇÃO

Não considerar o projeto concluído apenas porque as telas carregam.

Criar testes funcionais para as principais operações.

CENÁRIO 1 — NASCIMENTO

- Cadastrar uma matriz.
- Registrar nascimento de um bezerro.
- Associar mãe.
- Registrar peso.
- Definir pasto.
- Verificar aumento de uma cabeça no inventário.
- Verificar histórico da matriz.
- Verificar ficha do bezerro.

CENÁRIO 2 — TRANSFERÊNCIA

- Criar 10 animais em um pasto.
- Transferir os 10 para outro.
- Verificar quantidade nos dois pastos.
- Verificar histórico individual.
- Reconstruir inventário anterior.

CENÁRIO 3 — COMPRA

- Comprar 20 animais.
- Registrar fornecedor.
- Registrar valores.
- Definir pasto.
- Verificar cadastro individual.
- Verificar financeiro.
- Verificar inventário.

CENÁRIO 4 — VENDA

- Selecionar 5 animais.
- Registrar peso e valor.
- Registrar comprador.
- Confirmar venda.
- Verificar redução do inventário.
- Verificar receita.
- Confirmar preservação do histórico.

CENÁRIO 5 — PESAGEM

- Registrar peso inicial.
- Registrar segunda pesagem.
- Calcular GMD.
- Validar dias entre pesagens.
- Verificar histórico gráfico.

CENÁRIO 6 — VACINAÇÃO COLETIVA

- Selecionar 30 animais.
- Registrar uma aplicação.
- Verificar 30 registros individuais.
- Verificar consumo e custo do produto.
- Verificar próxima aplicação, quando configurada.

CENÁRIO 7 — ESTORNO

- Registrar uma transferência.
- Estornar a operação.
- Verificar reversão da localização.
- Verificar preservação do evento original.
- Verificar auditoria.

CENÁRIO 8 — HISTÓRICO

- Criar sequência de nascimentos, transferências e vendas.
- Consultar inventário em datas diferentes.
- Comparar com o resultado esperado.

CENÁRIO 9 — INTEGRIDADE

- Tentar vender um animal já vendido.
- Tentar transferir um animal morto.
- Tentar duplicar brinco.
- Tentar associar uma mãe inválida.
- Confirmar bloqueio das operações.

CENÁRIO 10 — CONCORRÊNCIA E DUPLICIDADE

- Simular reenvio de formulário.
- Verificar idempotência.
- Verificar prevenção de duplicidade.
- Verificar bloqueio de gravações concorrentes.

Criar massa de dados fictícia para testes, sem misturá-la com a base real.

Documentar resultados dos testes.

---

## 19. PLANO DE IMPLEMENTAÇÃO

Desenvolver em fases.

FASE 0 — DESENHO TÉCNICO

Antes de programar:

1. Apresentar arquitetura.
2. Apresentar modelo de dados.
3. Apresentar relacionamentos.
4. Apresentar fluxos de eventos.
5. Apresentar regras de negócio.
6. Apresentar estrutura de arquivos.
7. Apresentar plano de testes.
8. Identificar riscos técnicos.

Não iniciar a implementação antes de apresentar essa proposta.

FASE 1 — FUNDAÇÃO

Implementar:
- Banco de dados.
- Inicialização.
- Configurações.
- Cadastro de propriedades.
- Cadastro de pastos.
- Cadastro de animais.
- Listagem.
- Ficha individual.
- Genealogia.
- Importação inicial.

FASE 2 — MOTOR DE EVENTOS

Implementar:
- Nascimento.
- Compra.
- Venda.
- Transferência.
- Morte.
- Descarte.
- Estorno.
- Auditoria.
- Reconstrução histórica do inventário.

FASE 3 — MANEJO

Implementar:
- Pesagens.
- GMD.
- Sanidade.
- Vacinação.
- Vermifugação.
- Reprodução.
- Desmama.

FASE 4 — FINANCEIRO

Implementar:
- Receitas.
- Despesas.
- Compras.
- Vendas.
- Custos por animal.
- Custos por pasto.
- Rateios.
- Patrimônio pecuário.

FASE 5 — INTELIGÊNCIA GERENCIAL

Implementar:
- Dashboard.
- Indicadores.
- Relatórios.
- Gráficos.
- Exportações.
- Alertas.

Cada fase deverá ser testada antes de avançar.

---

## 20. FORMA DE TRABALHO E ENTREGA DO CÓDIGO

Quero que você trabalhe como um engenheiro responsável pela entrega de um produto real.

REGRAS:

1. Não gerar código superficial apenas para demonstrar a interface.
2. Não utilizar dados estáticos como substitutos da persistência real.
3. Não criar botões sem funcionalidade.
4. Não deixar funcionalidades essenciais como TODO.
5. Não inventar APIs ou métodos inexistentes.
6. Não omitir arquivos necessários.
7. Não simplificar regras de negócio sem justificar.
8. Não duplicar lógica entre frontend e backend.
9. Não esconder erros.
10. Não afirmar que algo foi testado se não foi executado.
11. Documentar premissas e limitações.
12. Priorizar código legível, modular e sustentável.

Quando gerar código:

- Informar o nome do arquivo.
- Entregar seu conteúdo completo.
- Explicar dependências.
- Informar onde inserir cada arquivo no Apps Script.
- Informar como executar.
- Informar como testar.
- Garantir compatibilidade entre arquivos.

Se estiver trabalhando em um ambiente com acesso ao projeto Google Apps Script, utilize as ferramentas disponíveis para criar e editar os arquivos diretamente, quando autorizado.

Se não houver acesso ao projeto, entregar todos os arquivos em blocos identificados, sem alegar que foram publicados ou implantados.

Não substituir código existente sem avaliar os impactos.

Manter um registro das alterações realizadas.

Não interromper a entrega apenas porque a resposta ficou longa. Dividir a implementação em entregas numeradas e manter um checklist do que foi concluído e do que falta.

---

## 21. PREMISSAS OPERACIONAIS CONFIGURÁVEIS

Algumas características operacionais ainda não foram definitivamente especificadas.

Por isso, não as codifique como limitações estruturais.

Adotar as seguintes decisões iniciais:

- Estrutura de dados preparada para múltiplas propriedades, mesmo que inicialmente seja utilizada uma única.
- Permitir compras e vendas individuais ou por lote.
- Desenvolver o módulo financeiro completo, mas priorizar as funcionalidades essenciais na primeira versão.
- Operação online no MVP.
- Um usuário inicialmente, com possibilidade de expansão futura.
- Configurar parâmetros pecuários em tabelas auxiliares.
- Não fixar protocolos veterinários ou regras sanitárias universais.
- Permitir importação histórica com diferentes níveis de confiabilidade.

Criar uma tela de configurações que permita ajustar parâmetros sem precisar alterar o código.

---

## 22. VISÃO DE FUTURO

A arquitetura deverá permitir futuras funcionalidades:

- Aplicativo mobile.
- Operação offline.
- Leitura de brincos por QR Code ou RFID.
- Integração com balanças eletrônicas.
- Integração com dispositivos de identificação.
- Controle de estoque de insumos.
- Planejamento de compra e venda.
- Projeção de peso e idade para abate.
- Comparação de desempenho entre lotes.
- Análises de rentabilidade.
- Inteligência artificial para análise de desempenho.
- Previsão de custos.
- Identificação de animais com desempenho abaixo do esperado.
- Gestão de múltiplas propriedades.
- Módulo de indicadores zootécnicos avançados.

Não implementar essas funcionalidades futuras antes de consolidar o MVP.

---

## 23. PRIMEIRA TAREFA: INICIAR O PROJETO

Agora, execute a FASE 0.

Quero receber inicialmente:

1. Resumo executivo da solução proposta.
2. Arquitetura técnica detalhada.
3. Diagrama de entidades e relacionamentos.
4. Dicionário de dados.
5. Diagrama do fluxo de eventos.
6. Matriz de regras de negócio.
7. Estrutura de arquivos do Apps Script.
8. Estratégia de persistência e integridade.
9. Plano de testes.
10. Plano de implementação incremental.
11. Riscos técnicos e respectivas soluções.
12. Premissas que ainda precisam de validação.

Se identificar inconsistências na especificação, proponha soluções antes de implementar.

Não faça perguntas sobre informações que podem ser resolvidas com premissas configuráveis.

Se houver uma decisão realmente bloqueante, apresente-a de maneira objetiva e explique seu impacto.

Após apresentar a FASE 0, aguarde minha aprovação para iniciar a FASE 1.

IMPORTANTE:

O objetivo não é construir uma planilha sofisticada.

O objetivo é desenvolver um sistema de gestão pecuária robusto, confiável, intuitivo e economicamente útil, com rastreabilidade individual dos animais e controle completo da operação.

Priorize integridade dos dados, consistência do inventário, facilidade de utilização e qualidade da informação gerencial.

Comece pela FASE 0.
