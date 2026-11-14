# 00 — Desenho-base (resumo canônico para quem implementa)

> Resumo compacto das decisões de desenho da Fase 0, usado como fonte única durante a redação dos documentos 01 a 13.
> Serve de guia rápido para a implementação. **Em caso de divergência entre este resumo e os documentos 01 a 13, valem os
> documentos**, que passaram por revisão posterior. As decisões tomadas depois da versão 2 estão na seção 16; as decisões
> de execução autônoma, na seção 17. As siglas INT-, MD-, P-, PEC-, FIN-, COB- e UX- remetem aos achados registrados em
> `13-revisao-adversarial.md`.

## 0. Contexto do repositório e do ambiente

- Projeto novo em `erp-pecuario/` na raiz do repositório, espelhando o projeto irmão `inbox-intelligence/` (já
  implantado pelo mesmo dono): `src/*.js` (o clasp envia como `.gs`) e `src/*.html`; `tests/*.test.js` em Node
  (`node --test`) com harness `vm` + mocks das APIs do Apps Script; `scripts/push-gas.js` (clasp); `docs/`.
- Conta Google presumida: pessoal (gmail.com) → cotas "consumer": 6 min por execução; 90 min/dia de gatilhos;
  30 execuções simultâneas por usuário; 20 gatilhos por usuário por script; Properties 9 KB/valor e 500 KB/store;
  250 planilhas criadas/dia; 200 versões por script.
- Fuso padrão `America/Porto_Velho` (o business case do repositório é de Rondônia), configurável; a validar.
- Nesta sessão NÃO há acesso ao projeto Apps Script do dono: o código vai para o repositório e é implantado por
  ele com `npm run gas:push` (clasp) ou cópia manual. Nada é declarado "implantado" ou "testado na conta" sem evidência.
- O proxy bloqueia developers.google.com; fatos de plataforma usam a convenção do projeto irmão:
  `V` (lido na fonte: tipos `@types/google-apps-script` 2.0.15, discovery docs) / `NV` (snippet/fonte secundária).
  Nenhuma API citada neste desenho é inventada: todas as assinaturas foram conferidas nos tipos (lente plataforma).

## 1. Princípios de arquitetura

- P1 **Fato é persistido; derivado é calculado.** Idade, GMD, ganho, UA, categoria automática, status "atrasado",
  valor estimado, indicadores: calculados na leitura. Exceção controlada: *projeções* (colunas `*`), sempre função
  determinística de linhas append-only vigentes, reconstruíveis e conferidas pela verificação de integridade.
- P2 **Uma única fronteira de escrita.** Toda mutação é um *comando* executado pela `UnitOfWork` em três fases:
  A anexa, B confirma (uma célula), C aplica derivados (idempotente). Consulta nunca escreve na planilha.
- P3 **Uma operação = uma célula de commit.** O commit de qualquer comando é `OPERACOES.status: INICIADA → CONFIRMADA`.
  Um evento é **vigente** se: a operação dele está CONFIRMADA; `event_type ≠ ESTORNO`; não existe evento de
  operação CONFIRMADA com `reversal_of_event_id` apontando para ele; e, se veio de importação, a importação está
  `IMPORTADO`. `EVENTOS.status` é o cache materializado desse predicado (gravado só na fase C e na recuperação).
  Linhas filhas só valem se o evento pai é vigente. O `Repository` só expõe linhas vigentes (`repo.vigentes(tabela)`);
  acesso cru fica restrito à UnitOfWork, à recuperação e à integridade.
- P4 **Domínio puro + adaptadores.** Regras não chamam serviços do Apps Script; usam portas (`Repository`, `Clock`,
  `IdGen`, `Lock`, `FileStore`). Hoje `SheetsAdapter`; amanhã SQL.
- P5 **Backend é a autoridade.** Formulários são renderizados a partir do `EventCatalog` servido pelo backend; o
  cliente só valida formato e mostra prévia aritmética rotulada "prévia". Valores definitivos vêm do servidor.
- P6 **Contrato de tipos: valor lido === valor gravado.** IDs, brincos e datas são TEXTO; datas `yyyy-MM-dd`;
  timestamps ISO-8601 UTC; dinheiro em reais com 2 casas na planilha e centavos inteiros na lógica; pesos em kg
  (1 casa); booleano como `S`/`N`; vazio canônico `''` ↔ `null`. Nunca `Date` na planilha nem em `google.script.run`.
- P7 **Nada de exclusão física de histórico confirmado.** Correção = evento substituto ou estorno ou ajuste.
- P8 **Configurável > codificado.** Categorias, listas abertas, protocolos, plano de contas, parâmetros.
- P9 **Sem dado, sem indicador.** A API devolve `{valor: null, motivo, n}` (motivos: DADOS_INSUFICIENTES,
  ANTERIOR_AO_MARCO_ZERO, FILTRO_NAO_APLICAVEL, SEM_VALOR_DE_REFERENCIA); a interface mostra "—" com explicação.
- P10 **Valor calculado pelo sistema nunca vira fato.** Projeção de peso e médias calculadas não entram em PESAGENS;
  estimativa informada pelo operador entra marcada como estimada (método/confiança) e é excluída dos indicadores
  individuais.
- P11 **Todo evento grava seus fatos completos desde a fase em que nasce.** Nenhuma fase preenche retroativamente
  evento confirmado (COMPRA/VENDA da Fase 2 já gravam financeiro, parcelas e alocações).

## 2. Arquitetura em camadas

```
Navegador (SPA no iframe do HtmlService)
  views → store (cache por dataVersion) → rascunhos (localStorage) → apiClient (Promise sobre google.script.run)
        │  google.script.run.api({rota, dados, idempotencyKey, avisosAceitos, dataVersionEsperada})
        ▼
Api: guarda de dono → roteador → envelope {ok, data|error, meta:{dataVersion, appVersion, serverTime}}
        ▼
Aplicação: Commands (mutação, UnitOfWork sob lock)      Queries (leitura otimista validada, sem lock)
        ▼
Domínio (JS puro): EventCatalog, TimelineValidator, Projector, genealogia, classificação, rateio, Money, Dates,
                   indicadores (peso, reprodução, finanças, patrimônio)
        ▼
UnitOfWork (lock, idempotência, journal OPERACOES, três fases, recuperação)  →  Repository (vigentes, índices)
        ▼
SheetsAdapter (E/S em lote, codec por tipo de coluna)            FileStore (Drive API: banco, backups, anexos, exportações)
        ▼
Google Sheets (1 aba = 1 tabela)                                 Google Drive
```

- Superfície pública fechada: `doGet`, `api`, `setup`, `runAcceptanceTests`, `verifyIntegrity`, e um handler por
  gatilho (`trgManutencaoDiaria`, `trgIntegridadeSemanal`). Cada uma começa com `assertOwner_()`. Todo o resto
  termina em `_` (privado para `google.script.run`).
- Códigos de erro: VALIDATION, NEEDS_CONFIRMATION, CONFLICT, IDEMPOTENCY_MISMATCH, LOCKED, DENIED, NOT_FOUND, CONFIG,
  INTERNAL. `error.details[]` = `{codigo, animal_id, brinco, campo, mensagem, conflito:{event_id, tipo, data}}`.
- **Avisos com aceite** (UX-03): a validação devolve `{erros[], avisos[]}`; aviso não aceito → nada é gravado e a
  resposta é NEEDS_CONFIRMATION (a chave de idempotência não é consumida); o cliente reenvia com `avisosAceitos[]`.
  Códigos estáveis (CARENCIA_ATIVA, POSSIVEL_DUPLICIDADE, BRINCO_PARECIDO, LOTACAO_ACIMA_DA_CAPACIDADE,
  PESO_IMPLAUSIVEL, IDADE_REPRODUTIVA, PERIODO_BLOQUEADO...). CONFIGURACOES define por código BLOQUEIA|AVISA|IGNORA.
  Avisos aceitos ficam em `EVENTOS.payload_json`.
- Estado por banco: `DATA_VERSION:<spreadsheetId>` e `PENDING_OP:<spreadsheetId>` em Script Properties (lidos com
  um único `getProperties()` por execução). MVP sem CacheService: cache só no cliente por `dataVersion` e
  memoização por execução.
- Publicação: `webapp.executeAs = USER_DEPLOYING`, `access = MYSELF`. `assertOwner_()` é defesa em profundidade e
  não presume `Session.getActiveUser().getEmail()` preenchido (flag de contingência, como no projeto irmão).
  Desenvolvimento pela URL `/dev` com `gas:push --no-deploy`; versão publicada só em marcos testados (limite de
  200 versões). Multiusuário futuro: tabela USUARIOS + papel; front-end externo futuro via Apps Script API
  (`scripts.run` com OAuth), não `doPost`.
- Escopos OAuth explícitos (menor privilégio): `spreadsheets`, `drive.file`, `script.scriptapp`, `userinfo.email`,
  `script.external_request`. Regra para `drive.file` funcionar: TODO arquivo nasce pela API do Drive (serviço
  avançado Drive v3: `Drive.Files.create/copy/update`), nunca por `SpreadsheetApp.create`, `Spreadsheet.copy` ou
  `DriveApp.*` (teste de lint no Node proíbe esses usos em `src/`). Contingência: escopo `drive` completo.
- Bibliotecas externas: só Chart.js (versão fixa, cdnjs, com SRI, carregado sob demanda nas telas com gráfico;
  toda série tem tabela equivalente). Contingência decidida no spike: gráficos SVG próprios (linha, barras).
  A curva de peso da ficha usa SVG inline desde o início.
- Exportação: CSV montado no cliente (`;` + BOM); XLSX/PDF gerados no servidor (`files.export` da Drive API por
  `UrlFetchApp`, teto de 10 MB; alternativa PDF por HTML→`getAs('application/pdf')`), gravados em
  `ERP Pecuário/Exportações` e entregues como link `target=_blank`. Saneamento anti-fórmula (`= + - @`) só na
  exportação, nunca na gravação.

## 3. Modelo de dados canônico (34 abas)

Convenções: aba em MAIÚSCULAS; colunas `snake_case` ASCII; PK = UUID (nunca número de linha); FKs declaradas no
Schema. Marcas: `*` projeção (derivada de linhas vigentes), `[ctl]` controle mutável, `[cad]` cadastro editável com
auditoria; sem marca = imutável após gravação. Tipos de coluna declarados no Schema: ID, TEXTO, DATA, TS, INT, DEC1,
DINHEIRO, BOOL, ENUM, JSON (JSON ≤ 40.000 caracteres, validado antes de qualquer escrita; nenhuma célula guarda
coleção por animal). Enums fechados (têm lógica) vivem no Schema; listas abertas vivem em LISTAS; tabelas de fato
gravam `codigo`, nunca rótulo. Confiança é um enum único: CONFIRMADA | ESTIMADA | DESCONHECIDA (vazio = desconhecido).

### 3.1 Cadastros (14)
- **PROPRIEDADES**: property_id, nome [cad], descricao [cad], localizacao [cad], area_total_ha [cad], status [cad],
  created_at, updated_at
- **PASTOS**: pasture_id, property_id, nome [cad], identificacao [cad], area_hectares [cad], tipo_capim [cad],
  capacidade_estimada_ua_ha [cad], capacidade_estimada_cabecas [cad], posse [cad] (PROPRIO|ARRENDADO), arrendador_id [cad]
  (→ PARCEIROS; só quando ARRENDADO), observacoes [cad], status [cad], created_at, updated_at
- **ANIMAIS**: animal_id, codigo_interno (sequencial legível A-000123, derivado da planilha sob lock), brinco*,
  brinco_norm*, nome [cad], sexo* (M|F), raca [cad], data_nascimento*, data_nascimento_confianca*, mae_id*,
  mae_confianca*, pai_id*, pai_confianca*, origem* (NASCIDO|COMPRADO|DESCONHECIDA), evento_origem_id*, castrado*,
  reprodutor*, partos_previos*, propriedade_atual_id*, pasto_atual_id*, categoria_modo* (AUTO|MANUAL),
  categoria_manual_id*, situacao_reprodutiva* (NAO_APTA|SEM_INFORMACAO|VAZIA|EXPOSTA|INSEMINADA|PRENHA),
  cria_ao_pe*, marcado_descarte*, nao_localizado*, situacao_cadastral* (PENDENTE|ATIVO|VENDIDO|MORTO|DESCARTADO|
  BAIXADO_AJUSTE|HISTORICO|EXTERNO|ANULADO), data_entrada*, data_entrada_confianca*, data_saida*, peso_atual*,
  data_ultima_pesagem*, data_ultimo_movimento*, custo_aquisicao*, custo_aquisicao_origem* (NEGOCIADO|
  ABERTURA_INFORMADA|ABERTURA_ESTIMADA|NAO_SE_APLICA|DESCONHECIDO), observacoes [cad], foto_anexo_id [cad],
  created_at, updated_at
- **IDENTIFICACOES**: ident_id, animal_id, event_id, tipo (BRINCO|BRINCO_ORIGEM|RFID|SISBOV|TATUAGEM|OUTRO),
  codigo, codigo_norm, data_inicio, data_fim*, motivo, created_at
- **CATEGORIAS**: category_id, codigo (estável), nome [cad], sexo_aplicavel (M|F|AMBOS), idade_minima_meses,
  idade_maxima_meses, condicao (NENHUMA|CASTRADO|INTEIRO|REPRODUTOR|NAO_REPRODUTOR|PARIDA|NAO_PARIDA),
  peso_referencia_kg, prioridade, descricao, ativo (todas [cad])
- **PRODUTOS**: product_id, nome, categoria (VACINA|VERMIFUGO|MEDICAMENTO|SUPLEMENTO|OUTRO), fabricante, unidade
  (unidade de dose/controle: mL, dose, g), apresentacao, fator_conversao, custo_unitario (por unidade de dose),
  dose_padrao_por_cabeca, dose_padrao_por_kg, carencia_padrao_dias, controla_estoque (S|N), estoque_atual*,
  estoque_minimo, validade, lote (último lote), observacoes, ativo, created_at, updated_at (todas [cad] exceto *)
- **MOVIMENTOS_ESTOQUE**: mov_id, product_id, event_id, data, tipo (ENTRADA|SAIDA|AJUSTE), quantidade,
  custo_unitario, lote, validade, observacoes, created_at
- **PARCEIROS**: partner_id, nome, tipos (FORNECEDOR|COMPRADOR|VETERINARIO|TRANSPORTADOR|ARRENDADOR|OUTRO, multivalorado),
  documento, telefone, endereco, observacoes, ativo, created_at, updated_at (todas [cad])
- **PROTOCOLOS_SANITARIOS**: protocol_id, nome, descricao, tipo_procedimento, product_id (produto padrão, opcional),
  sexo_aplicavel, idade_min_meses, idade_max_meses, category_id, recorrencia_tipo (UNICA|INTERVALO_DIAS|
  CAMPANHA_MESES), intervalo_dias, meses_campanha, antecedencia_alerta_dias, tolerancia_dias, ativo, observacoes,
  created_at, updated_at (todas [cad]; nenhum protocolo vem ativo de fábrica)
- **ESTACOES_MONTA**: estacao_id, property_id, nome, data_inicio, data_fim, tipo (MONTA_NATURAL|IA|MISTA),
  observacoes, created_at, updated_at (todas [cad])
- **LISTAS** (listas abertas): lista_id, lista (RACA|CAUSA_MORTE|MOTIVO_DESCARTE|DESTINO_DESCARTE|FORMA_PAGAMENTO|
  VIA_APLICACAO|TIPO_OCORRENCIA|TIPO_PARTO|TIPO_DEDUCAO_VENDA|MOTIVO_IDENTIFICACAO|FINALIDADE_NEGOCIO), codigo
  (imutável, único por lista), rotulo [cad], ordem [cad], ativo [cad]
- **CONFIGURACOES**: chave, valor [cad], tipo (NUMERO|TEXTO|BOOL|JSON), grupo, descricao, updated_at
- **PLANO_CONTAS**: conta_id, codigo (imutável, único), nome [cad], grupo (RECEITA|CUSTO_DIRETO|CUSTO_OPERACIONAL|
  DESPESA_ADMINISTRATIVA|NAO_OPERACIONAL), natureza (RECEITA_VENDA_ANIMAIS|OUTRA_RECEITA|AQUISICAO_ANIMAIS|CUSTEIO|
  DESPESA_VENDA|ESTOQUE_INSUMOS|NAO_OPERACIONAL), tipo (RECEITA|DESPESA), classe_custo_animal (AQUISICAO|SANITARIO|
  ALIMENTACAO|REPRODUCAO|OUTROS|NAO_SE_APLICA), sistema (S|N), ordem [cad], ativo [cad]. Grupo e natureza ficam
  imutáveis após o primeiro lançamento.
- **TABELA_PRECOS** (valores de referência do patrimônio, com vigência): preco_id, escopo (ANIMAL|CATEGORIA|GERAL),
  animal_id, category_id, base (CABECA|KG_VIVO|ARROBA), valor, rendimento_carcaca_pct, vigencia_inicio,
  vigencia_fim, fonte, observacoes, created_at

### 3.2 Eventos e detalhes (9)
- **EVENTOS**: event_id, op_id, event_seq (inteiro monotônico, máximo+1 sob lock), event_type, event_subtype,
  event_date, registration_date, property_id, description, status* (PENDENTE|CONFIRMADO|ESTORNADO|FALHOU|CANCELADO),
  total_value (informativo, definido por tipo), responsible (quem executou em campo), created_by (usuário do
  sistema), source (APP|IMPORTACAO|SISTEMA), confiabilidade, pre_marco_zero (S|N), partner_id, notes, payload_json
  (só campos de cabeçalho do tipo + avisos aceitos), idempotency_key (cópia; a autoridade é OPERACOES),
  reversal_of_event_id, reversed_by_event_id*, import_id, created_at, confirmed_at*
- **EVENTO_ANIMAIS** (razão de animais envolvidos e de movimentação): event_animal_id, event_id, animal_id, papel
  (SUJEITO|CRIA|MATRIZ|TOURO), efeito_inventario (+1|0|-1), pasto_origem_id, pasto_destino_id, peso (peso vivo, kg),
  peso_carcaca_kg, preco_unitario, valor_individual (valor negociado do animal), motivo_saida,
  atributos_iniciais_json (só na linha que cria o animal: sexo, nascimento e confiança, mãe/pai, raça, castrado,
  reprodutor, partos_previos, situação reprodutiva inicial, previsão de parto, origem, data_entrada e confiança),
  observacoes
- **COMPRAS**: purchase_id, event_id, finalidade, modalidade (CABECA|KG_VIVO|ARROBA|LOTE), base_peso (VIVO|CARCACA),
  rendimento_carcaca_pct, rendimento_tipo (APURADO|NEGOCIADO|ESTIMADO), qtd_animais, peso_total_kg, preco_unitario,
  unidade_preco, valor_animais, frete, outros_custos, valor_total, criterio_rateio, gta_numero, nota_fiscal, observacoes
- **VENDAS**: sale_id, event_id, finalidade (ABATE|RECRIA_ENGORDA|REPRODUCAO|OUTRA), modalidade, base_peso,
  rendimento_carcaca_pct, rendimento_tipo, qtd_animais, peso_vivo_total_kg, peso_carcaca_total_kg, preco_unitario,
  unidade_preco, valor_bruto, desconto_comercial, frete, comissao, outras_deducoes, criterio_rateio, gta_numero,
  nota_fiscal, observacoes
- **PESAGENS**: weight_id, animal_id, event_id, data_pesagem, peso_kg, metodo (BALANCA|FITA|ESTIMATIVA_VISUAL|
  MEDIA_LOTE), tipo (ROTINA|NASCIMENTO|DESMAMA|COMPRA|VENDA|ENTRADA), observacoes
- **SANIDADE**: health_id, animal_id, event_id, tipo_procedimento (VACINA|VERMIFUGO|MEDICAMENTO|TRATAMENTO|EXAME|
  DOENCA), protocol_id, produto_id, nome_produto, fabricante, lote, validade, dose, unidade_dose, via_aplicacao,
  motivo, diagnostico, resultado_exame, data_aplicacao, data_proxima_aplicacao, periodo_carencia_dias,
  data_fim_carencia, custo (cópia da alocação do animal), veterinario, observacoes
- **REPRODUCAO**: reproduction_id, animal_id (matriz), event_id, tipo_evento (EXPOSICAO|COBERTURA|INSEMINACAO|
  DIAGNOSTICO_GESTACAO|PARTO|ABORTO|DESMAMA), data, data_fim (retirada, na EXPOSICAO), estacao_id, touro_id (quando
  único), semen_identificacao, metodo, resultado, idade_gestacional_dias, qtd_nascidos_vivos, qtd_natimortos,
  tipo_parto, data_prevista_parto, data_parto (só em PARTO; cópia de data), observacoes
- **BAIXAS**: baixa_id, event_id, animal_id, tipo (MORTE|DESCARTE|DIVERGENCIA_CONTAGEM), causa, diagnostico, motivo,
  destino, responsavel, observacoes
- **AJUSTES**: ajuste_id, event_id, animal_id, entidade, entity_id, tipo_ajuste (CORRECAO_CADASTRO|
  IDENTIFICACAO_INCORRETA|RECLASSIFICACAO|CORRECAO_LOCALIZACAO), campo, valor_anterior (registro do que a tela
  mostrava; nunca fonte de restauração), valor_novo, justificativa

### 3.3 Financeiro (4)
- **FINANCEIRO** (lançamento econômico; 1 linha por lançamento): financial_id, event_id (evento que criou a linha),
  ref_event_id (evento de negócio a que se refere), conta_id, natureza (cópia da conta na gravação), tipo
  (RECEITA|DESPESA), categoria (cópia do grupo, só para leitura humana), descricao, data_competencia,
  competencia_inicio, competencia_fim, valor (positivo), quantidade, product_id, animal_id* (só quando há exatamente
  uma alocação direta), pasture_id, property_id, categoria_animal_id, partner_id, retida_pelo_comprador (S|N),
  documento, observacoes, status* (ATIVO|CANCELADO), cancelado_em*, cancelado_por_event_id*, status_pagamento*
  (SEM_CAIXA|ABERTO|PARCIAL|LIQUIDADO|CANCELADO), data_pagamento* (da última parcela, quando liquidado), created_at
- **PARCELAS** (título a pagar/receber): parcela_id, financial_id, parcela_num, data_vencimento, valor (nominal,
  imutável), data_pagamento [ctl], valor_pago [ctl], juros_multa [ctl], desconto [ctl], forma_pagamento [ctl],
  status [ctl] (ABERTA|LIQUIDADA|CANCELADA), parcela_origem_id (baixa parcial = desdobramento), documento, created_at
- **RATEIOS**: rateio_id, event_id (evento que criou o rateio: o evento de negócio ou um evento RATEIO),
  financial_id, criterio (DIRETO|VALOR_INDIVIDUAL|CABECAS|PESO_VIVO|PESO_CARCACA|DIAS_PERMANENCIA|MANUAL),
  escopo_tipo (EVENTO|REBANHO|PASTO|CATEGORIA|LISTA), escopo_ref, periodo_inicio, periodo_fim, data_base,
  base_total, total_alocado, justificativa, created_by, created_at. Rateio vigente de um lançamento = o do último
  evento vigente para aquele financial_id (re-rateio não altera linha antiga).
- **ALOCACOES_FINANCEIRAS** (razão único de valor por animal): alloc_id, rateio_id, financial_id, animal_id,
  base_valor, valor_alocado

### 3.4 Suporte (7)
- **ANEXOS**: anexo_id, entidade, entity_id, event_id, drive_file_id, thumb_drive_file_id, nome_arquivo, mime_type,
  tamanho_bytes, tipo (FOTO|DOCUMENTO|GTA|NOTA_FISCAL|OUTRO), descricao, status [ctl] (TEMPORARIO|ATIVO|REMOVIDO),
  created_by, created_at
- **AUDITORIA** (mutações fora de evento: edição [cad], colunas [ctl], configuração, recuperação, manutenção; é
  também o log de redo dos comandos sem evento): audit_id, op_id, entidade, entity_id, acao, campo, valor_anterior,
  valor_novo, usuario, timestamp, justificativa
- **OPERACOES** (journal, idempotência e célula de commit): op_id, idempotency_key, payload_hash, comando,
  status [ctl] (INICIADA|CONFIRMADA|FALHOU), aplicada_em [ctl] (fim da fase C), resumo_json, erro, usuario,
  started_at, finished_at
- **IMPORTACOES**: import_id, tipo (enum fechado: ANIMAIS|COMPRAS|VENDAS|TRANSFERENCIAS|NASCIMENTOS|MORTES|PESAGENS|
  SANIDADE|REPRODUCAO|OCORRENCIAS), arquivo_nome, arquivo_anexo_id, arquivo_hash, mapeamento_json, formato_json
  (delimitador, codificação, formato de data e decimal), total_linhas, linhas_validas, linhas_erro,
  linhas_importadas, modo (TOTAL|PARCIAL_APROVADO), status [ctl] (RASCUNHO|VALIDADO|IMPORTANDO|IMPORTADO|CANCELADO),
  relatorio_json (só contadores), created_by, created_at, finished_at
- **IMPORTACAO_LINHAS**: import_line_id, import_id, linha_num, dados_originais_json (texto exibido, sem
  interpretação), status [ctl] (VALIDA|ERRO|DUPLICADA|IMPORTADA|IGNORADA), erros_json, entity_id_gerado, event_id_gerado
- **ERROS_LOG**: error_id, timestamp, contexto, codigo, mensagem, stack_resumida, op_id, usuario
- **SCHEMA_META**: tabela, versao, colunas_json, sementes_versao, updated_at

### 3.5 Divergências em relação ao texto da especificação (com justificativa) — vira tabela "campo da §4 → coluna → motivo"
1. Colunas ASCII sem acento (mãe_id → `mae_id`); rótulos acentuados só na interface.
2. FINANCEIRO separado em lançamento (FINANCEIRO) e título (PARCELAS): §4.9 lista `data_pagamento`,
   `status_pagamento`, `forma_pagamento` no lançamento; §11.3 exige vencimento, pagamento, recebimento e status por
   título. Em FINANCEIRO ficam `status_pagamento*` e `data_pagamento*` como projeção agregada. Colunas novas:
   `conta_id`, `natureza`, `ref_event_id`, `competencia_inicio/fim`, `property_id`, `categoria_animal_id`,
   `retida_pelo_comprador` (§11 pede vínculo a categoria, período, evento e propriedade).
3. EVENTO_ANIMAIS ganha `papel`, `efeito_inventario`, `peso_carcaca_kg`, `preco_unitario`, `motivo_saida`,
   `atributos_iniciais_json`.
4. EVENTOS ganha `op_id`, `event_seq`, `event_subtype`, `created_by`, `source`, `confiabilidade`, `pre_marco_zero`,
   `partner_id`, `payload_json`, `reversed_by_event_id`, `import_id`, `confirmed_at`.
5. Brinco é opcional (§16 regra 19); unicidade sobre brincos preenchidos de todos os animais; códigos numéricos são
   comparados sem zeros à esquerda ("0012" = "12", bloqueio configurável); o brinco do vendedor vai para
   IDENTIFICACOES tipo BRINCO_ORIGEM (sem unicidade). Pôr/repor brinco é evento de rotina IDENTIFICACAO.
6. Todo animal do inventário entra por evento com efeito +1 (NASCIMENTO, COMPRA, ENTRADA_INICIAL, OUTRA_ENTRADA).
   "Cadastrar animal" na tela pergunta "como entrou?" e encaminha ao evento. Animal EXTERNO (touro de sêmen,
   progenitor fora do rebanho) é cadastro de referência por comando sem evento, fora do inventário.
7. Atributos sensíveis do animal (sexo, nascimento, mãe/pai, brinco, castrado) são projeções: valor de criação
   imutável em `atributos_iniciais_json` + eventos de ajuste vigentes. Editar na tela gera o evento de ajuste.
8. GMD, ganho, dias, variação % não são persistidos (pesagem retroativa os invalidaria).
9. `categoria_atual` (§4.3) não é persistida: é função pura (sexo, idade, castrado, reprodutor, parida) calculada na
   leitura; só a reclassificação manual é guardada (`categoria_modo`, `categoria_manual_id*`).
10. `valor_estimado` (§4.3) não é persistido: é calculado na leitura (valor manual vigente em TABELA_PRECOS escopo
    ANIMAL → preço da categoria → geral → sem referência). Não há tabela de snapshots: a série patrimonial é
    recalculada por replay × preço vigente na data.
11. `foto_url` (§4.3) vira `foto_anexo_id` (arquivo privado no Drive não carrega por URL; §17 proíbe expor dados em URL).
12. "Compra de animais" está em Custos Diretos (§11-B) mas §11.3 proíbe tratá-la como custeio: `grupo`
    (apresentação) × `natureza` (cálculo). Todo cálculo usa natureza.
13. "Lote" não é entidade no MVP: lote = animais de um evento (lote de compra, grupo de uma pesagem) ou recorte por
    pasto/categoria. "Comparação entre animais" = sobrepor curvas de 2 a 5 animais. Entidade LOTES fica para depois (aditiva).
14. Imutabilidade de EVENTOS × `status`: imutável é o conteúdo de negócio; `status`, `reversed_by_event_id` e
    `confirmed_at` são cache derivado.
15. Eventos acrescentados ao catálogo: IDENTIFICACAO, CASTRACAO, MARCACAO, OUTRA_ENTRADA, OCORRENCIA, RATEIO,
    ESTOQUE, LANCAMENTO_FINANCEIRO. NATIMORTO deixa de ser evento próprio (é parto com zero nascidos vivos).
16. `data_prevista_recebimento` (§6.3) não é coluna: é o vencimento da primeira parcela aberta da receita.
17. `unidade de peso` (§4.14): armazenamento sempre em kg; `unidade_peso_exibicao` (KG|ARROBA) afeta só a exibição.
18. §19 lista "Auditoria" e backup fora da Fase 1; a gravação de auditoria, o backup diário e a verificação básica
    de integridade foram antecipados para a Fase 1 porque a base recebe dados reais na importação inicial.
19. PRODUTOS.`unidade` é a unidade de dose/controle; `lote`/`validade` do cadastro são "último lote" (valem os da aplicação).
20. PASTOS ganha `posse` (PROPRIO|ARRENDADO) e `arrendador_id`, e o plano de contas ganha a conta "Arrendamento de pasto":
    o dono informou (14/11/2026) que não há gado de terceiros nem parceria, mas que às vezes paga para deixar o gado em
    pasto alugado. Todos os animais são do dono (não existe `proprietario_id`).

## 4. Motor de eventos

### 4.1 Catálogo (21 tipos)
| event_type (subtipos) | efeito | local | detalhes gravados | financeiro |
|---|---|---|---|---|
| ENTRADA_INICIAL (fotografia do rebanho no marco zero D0) | +1 | define pasto | ANIMAIS(novo), IDENTIFICACOES, PESAGENS(ENTRADA)?, REPRODUCAO(DG estimado)? | valor de abertura opcional: lançamento AQUISICAO_ANIMAIS na conta "Saldo de abertura do rebanho", SEM parcela, com alocação por animal |
| OUTRA_ENTRADA (doação, permuta, achado, reentrada sem compra) | +1 | define pasto | ANIMAIS(novo ou existente) | — |
| NASCIMENTO (= parto; gemelar; cria=CRIA, mãe=MATRIZ) | +1 por nascido vivo | define pasto | ANIMAIS(novo), REPRODUCAO(PARTO com vivos/natimortos/tipo_parto), PESAGENS(NASCIMENTO)? | — |
| COMPRA | +1 | define pasto | ANIMAIS(novo ou existente fora do rebanho), COMPRAS, IDENTIFICACOES (BRINCO e BRINCO_ORIGEM), PESAGENS(COMPRA)? | AQUISICAO_ANIMAIS (animais; frete e outros em lançamentos próprios) + parcelas + rateio 100% |
| VENDA | −1 | limpa pasto | VENDAS, PESAGENS(VENDA) só com peso vivo individual | RECEITA_VENDA_ANIMAIS (bruto − desconto comercial) + cada dedução como DESPESA_VENDA + parcelas + rateio 100% |
| TRANSFERENCIA | 0 | origem→destino | — | — |
| MORTE | −1 | limpa pasto | BAIXAS | custos associados opcionais (CUSTEIO) |
| DESCARTE (saída sem negociação: consumo próprio, doação, permuta, sacrifício) | −1 | limpa pasto | BAIXAS | receita simples opcional |
| PESAGEM (individual/coletiva/lote) | 0 | — | PESAGENS | — |
| SANIDADE (VACINACAO, VERMIFUGACAO, MEDICACAO, TRATAMENTO, EXAME, DOENCA) | 0 | — | SANIDADE, MOVIMENTOS_ESTOQUE(SAIDA) | consumo: CUSTEIO sem parcela (dose × custo unitário); serviço/produto pago no ato: CUSTEIO com parcela; ambos com alocação |
| REPRODUCAO (EXPOSICAO, COBERTURA, INSEMINACAO, DIAGNOSTICO_GESTACAO, ABORTO) | 0 | — | REPRODUCAO | despesa opcional |
| DESMAMA (bezerro=SUJEITO, mãe=MATRIZ) | 0 | pasto destino opcional | PESAGENS(DESMAMA)?, REPRODUCAO(DESMAMA) | — |
| CASTRACAO | 0 | — | (payload) | despesa opcional |
| IDENTIFICACAO (PRIMEIRA_IDENTIFICACAO, SUBSTITUICAO, REMOCAO) | 0 | — | IDENTIFICACOES | — |
| MARCACAO (DESCARTE, NAO_LOCALIZADO × MARCAR/DESMARCAR) | 0 | — | (payload) | — |
| AJUSTE_INVENTARIO (CORRECAO_CADASTRO, IDENTIFICACAO_INCORRETA, RECLASSIFICACAO, CORRECAO_LOCALIZACAO, DIVERGENCIA_CONTAGEM) | 0 (−1 só em DIVERGENCIA_CONTAGEM) | só CORRECAO_LOCALIZACAO | AJUSTES (+BAIXAS na divergência) | — |
| OCORRENCIA (genérica; tipo em LISTAS) | 0 | — | payload | despesa opcional |
| LANCAMENTO_FINANCEIRO (receita/despesa avulsa) | — | — | FINANCEIRO, PARCELAS | sim |
| RATEIO (ratear ou re-ratear um lançamento) | — | — | RATEIOS, ALOCACOES_FINANCEIRAS | — |
| ESTOQUE (ENTRADA, AJUSTE) | — | — | MOVIMENTOS_ESTOQUE | ENTRADA: ESTOQUE_INSUMOS com parcela (caixa, fora do resultado) |
| ESTORNO (anula o evento apontado) | 0 | — | nenhuma linha filha | — |

Regras do catálogo:
- **Anulação e substituição** (INT-01, MD-01): ESTORNO não tem efeito próprio nem linhas filhas; ele ANULA o
  original, que sai do replay. "Corrigir evento" = UM evento substituto do mesmo tipo com `reversal_of_event_id` =
  original (anula e substitui no mesmo commit). Substituto de evento que cria animais reaproveita os mesmos
  `animal_id`. Estorno de estorno não existe (relança-se). `event_date` do ESTORNO = data do registro.
- **Esquema do EventCatalog** (UX-04), vocabulário fechado. Por tipo: `rotulo` (linguagem do pecuarista),
  `grupo_ui` (Movimentação|Manejo|Reprodução|Financeiro|Correções), `ordem`, `frequente`, `selecao_animais`
  (NENHUM|UM|VARIOS|NOVOS), `filtro_elegiveis`, `modo_entrada` (FORM|CURRAL), `revisao` (LOCAL|SERVIDOR), `critico`,
  `reads[]` (tabelas que o comando lê), `fase`. Por campo: `id`, `rotulo`, `tipo` (texto|inteiro|decimal|dinheiro|
  data|lista|ref:TABELA|bool|anexo), `obrigatorio`, `visivel_se`, `obrigatorio_se`, `default` (valor|HOJE|{de:...}),
  `escopo` (EVENTO|POR_ANIMAL), `unidade`, `min`/`max`, `ajuda`. `grupos_repetiveis` (crias, parcelas, deduções).
  Quatro componentes compostos escritos à mão: `seletor_animais`, `grade_novos_animais`, `bloco_negociacao`,
  `bloco_parcelas`.
- **Marco zero** (COB-01, MD-02): `CONFIGURACOES.data_marco_zero` (D0). ENTRADA_INICIAL é sempre datada de D0 com o
  pasto daquele dia. A linha do tempo é validada de D0 em diante. Histórico com data < D0 entra como registro
  informativo (`pre_marco_zero = S`, efeito 0, fora do replay), validado só contra nascimento/data de entrada
  informada. Animal que só existe antes de D0 fica `HISTORICO` (ou VENDIDO/MORTO se a saída histórica for
  conhecida), fora do inventário. Consultas com data < D0 devolvem `null` com motivo ANTERIOR_AO_MARCO_ZERO.

### 4.2 Pipeline de um comando (vale para TODO comando, com ou sem evento)
1. Cliente: formulário com rascunho persistente e `idempotency_key` (UUID) gerada na abertura; a chave só muda
   depois de sucesso confirmado; em dúvida (timeout de ~45 s), o cliente consulta `operacao.status(chave)`.
2. `api()` → `assertOwner_()` → `UnitOfWork.run(comando)`.
3. Lock de script (`waitLock` ≤ 25 s). Falhou → LOCKED; o cliente retenta sozinho (2, 5, 10 s) com a mesma chave.
4. Recuperação preventiva sob lock (§5.4): relê marcador e a cauda de OPERACOES; conclui ou anula órfãs.
5. Idempotência (autoridade: OPERACOES): chave com operação CONFIRMADA e mesmo `payload_hash` → devolve o resultado
   reconstruído a partir do `event_id`/resumo (`duplicado: true`); hash diferente → IDEMPOTENCY_MISMATCH.
6. Leitura em lote só das tabelas declaradas em `reads[]` + índices em memória.
7. Validação: esquema → regras do tipo → linha do tempo de cada animal → regras financeiras → tetos de célula.
   Erro em qualquer animal rejeita tudo (lista por animal/campo). Aviso não aceito → NEEDS_CONFIRMATION.
8. Plano de escrita (função pura): linhas novas por tabela + derivados da fase C. `modo: 'SIMULAR'` para aqui e
   devolve `{impactos, avisos, dataVersion}` usando a MESMA função (sem lock de escrita, sem gravar).
9. **Fase A (só anexa)**: marcador → OPERACOES(INICIADA, chave, hash) → EVENTOS(status PENDENTE) → filhas (inclusive
   ANIMAIS novos com situação PENDENTE) → `flush()`.
   **Fase B (commit)**: `OPERACOES.status = CONFIRMADA` → `flush()`.
   **Fase C (redo idempotente)**: `EVENTOS.status`/`confirmed_at`/`reversed_by_event_id` → projeções (ANIMAIS,
   estoque, `status`/`status_pagamento` de FINANCEIRO, `IDENTIFICACOES.data_fim`) → `OPERACOES.aplicada_em` →
   `flush()` → `DATA_VERSION++` → remove marcador → solta o lock.
   Comando sem evento (edição [cad], baixa de parcela, configuração, cadastro de externo): fase A anexa as linhas de
   AUDITORIA (log de redo: entidade, entity_id, campo, valor_anterior, valor_novo); fase C aplica `valor_novo`.
10. Resposta com o evento, as projeções alteradas e a nova `dataVersion`. Evento coletivo/crítico termina em tela
    de resultado persistente.

Revisão antes de confirmar (§6 "confirmação antes da gravação"): `revisao = LOCAL` (transferência, nascimento,
morte, pesagem, sanidade, desmama, castração, identificação, reprodução, ocorrência) monta a folha de confirmação
no cliente e faz UMA ida; `revisao = SERVIDOR` (compra, venda, descarte com receita, lançamento com rateio, estorno,
corrigir) chama `SIMULAR` e o commit envia `dataVersionEsperada` (se mudou → CONFLICT "os dados mudaram").

### 4.3 Linha do tempo por animal (um validador para tudo)
- Ordem canônica de replay: `(event_date, classe, event_seq)`; classe 0 = entradas, 1 = movimentos e demais,
  2 = saídas. Sem campo de hora. "Na data D" = estado ao fim do dia D.
- Máquina de estados: fora do rebanho → ATIVO (entrada +1) → fora (saída −1: VENDIDO|MORTO|DESCARTADO|
  BAIXADO_AJUSTE). MORTO é terminal; VENDIDO/DESCARTADO/BAIXADO_AJUSTE admitem reentrada (COMPRA ou OUTRA_ENTRADA de
  animal existente). Períodos de permanência = pares +1/−1. Continuidade de local: `pasto_origem` de cada movimento
  = `pasto_destino` do anterior. Animal sem entrada vigente = ANULADO (ou HISTORICO, se só tem registros pré-D0).
- `TimelineValidator.validate(linhas)` serve a: (a) evento novo; (b) evento RETROATIVO (insere na posição e revalida
  os POSTERIORES; quebrou a cadeia → CONFLICT listando os eventos conflitantes); (c) ESTORNO (remove e revalida o
  que sobra; inválido → bloqueia listando dependentes, inclusive referências fora da linha do tempo: `mae_id`/
  `pai_id` de outros animais, `touro_id`, alocações de rateios); (d) SUBSTITUIÇÃO (troca as linhas do original pelas
  novas e valida UMA vez o conjunto final; campos não estruturais — valores, parceiro, parcelas, observações — nunca
  são bloqueados por dependentes); (e) verificação de integridade.
- Fato independente (pesagem, sanidade, reprodução, desmama, identificação): válido se a data cai dentro de um
  período de permanência, com os dois limites inclusivos (inclui o dia da saída), sem olhar `event_seq`.
- `Projector.project(animal, linhas vigentes, pesagens, reprodução, ajustes, identificações, alocações)` é a ÚNICA
  rotina que calcula projeções; a fase C a executa (rebuild dos animais afetados; a recuperação faz rebuild de
  todos) → projeção e replay coincidem por construção.
- Inventário em D (≥ D0): Σ `efeito_inventario` dos eventos vigentes com `event_date ≤ D`; pasto em D = destino do
  último movimento até D; categoria em D = f(idade em D, castrado em D, reprodutor, parida em D, reclassificação
  vigente em D), com as regras atuais de CATEGORIAS.

### 4.4 Estorno, correção e edição
- Bloqueios do estorno: dependentes na linha do tempo ou fora dela (acima); parcela LIQUIDADA do evento (desfazer a
  baixa antes). A substituição ("corrigir") transporta as baixas quando valor e vencimento da parcela não mudam.
- Estorno puro de evento que criou animal: só se o animal não tem outro evento vigente nem referências; o animal
  fica ANULADO (fora das listas e da unicidade de brinco).
- Política de período (FIN-07): resultados são sempre recalculados dos dados vigentes (reapresentação);
  `CONFIGURACOES.fin_bloqueio_ate`: comando que cria/cancela lançamento com competência até essa data, ou mexe em
  baixa com pagamento até essa data, exige aceite do aviso PERIODO_BLOQUEADO com justificativa.
- Edição de cadastro: campos `[cad]` = comando direto + AUDITORIA; campos `*` sensíveis = evento
  AJUSTE_INVENTARIO/CORRECAO_CADASTRO com justificativa (a tela trata os dois no mesmo formulário).

## 5. Persistência e integridade no Google Sheets

### 5.1 SheetsAdapter e primitiva de E/S
- Decisão a fechar no spike (primeira tarefa da Fase 1), com critério escrito: **preferência pelo serviço avançado
  Sheets (API v4)** — leitura por `Values.batchGet` (várias abas em uma requisição, `UNFORMATTED_VALUE`) e gravação
  por `Spreadsheets.batchUpdate` com `appendCells`/`updateCells` e valores tipados (`stringValue` nunca é
  interpretado) — porque resolve a coerção de tipos por construção (P-01) e porque `batchUpdate` é atômico entre
  abas por documentação (P-05). Alternativa: `SpreadsheetApp` com primitiva única de append
  (`insertRowsAfter` → `setNumberFormats` no bloco exato → `setValues`). Não misturar as duas no mesmo comando.
- O protocolo lógico (§4.2, §5.4) não depende da primitiva. Se a atomicidade do `batchUpdate` for confirmada no
  spike, um comando simples vira UMA requisição (fases A+B+C juntas) e o caminho PENDENTE/recuperação fica para
  operações de várias requisições (importação em lotes) e para resposta perdida (resolvida pela idempotência).
- Corpus obrigatório de ida e volta (spike e testes): `=1+1`, `+55 69 99999-0000`, `-10 kg`, `@lote`, `0012`,
  `1E5`, `2026-11-13`, `13/11/2026`, `12:30`, `TRUE`, `1.234,56`, `50%`, texto com apóstrofo inicial, texto com
  espaços nas pontas. O fake de testes emula a coerção de célula "Geral" para o teste falhar quando o adaptador
  esquecer o tipo.
- Leitura normaliza pelo tipo declarado da coluna: data que chega como `Date` é reformatada no fuso da planilha e
  gera alerta "célula coercida"; texto que chega como número é erro de integridade; linha sem PK é ignorada com alerta.
- `setup()` idempotente: cria a planilha-banco (Drive API), abas na dimensão exata, cabeçalhos; adiciona colunas
  novas ao final; nunca remove nem renomeia; fixa fuso e locale (`pt_BR`) da planilha; semeia por chave natural
  ("insere se ausente": CONFIGURACOES por chave, LISTAS por lista+codigo, PLANO_CONTAS e CATEGORIAS por codigo),
  nunca sobrescreve valor do usuário nem recria item desativado; grava SCHEMA_META; garante gatilhos
  (`ensureTriggers_`, idempotente); faz backup antes de migrar. Contadores (`event_seq`, `codigo_interno`) são
  derivados da própria planilha sob lock (máximo + 1), nunca de Properties.
- Proteção "somente aviso" nas abas + verificação de integridade para detectar edição manual.

### 5.2 Volumetria (ordem de grandeza; 500 animais ativos)
EVENTO_ANIMAIS ~10 mil linhas/ano; ALOCACOES_FINANCEIRAS ~10 a 20 mil/ano (tabela que mais cresce); PESAGENS e
SANIDADE ~2 a 4 mil/ano cada. Dez anos ≈ 300 a 500 mil linhas no total ≈ 4 a 6 milhões de células, dentro do
limite (10 milhões histórico; 20 milhões desde 09/2026, NV — o planejamento usa 10). Orçamento a aprovar no spike:
comando p95 ≤ 5 s com 10 mil linhas em EVENTO_ANIMAIS e ≤ 15 s com 100 mil; abertura a frio em 3G. Limiar de
arquivamento: 60 mil linhas por tabela de fato (arquivar fatos de animais baixados há mais de N anos).

### 5.3 Idempotência e duplicidade
- Autoridade: OPERACOES (`idempotency_key` + `payload_hash`); no máximo uma operação CONFIRMADA por chave.
- Rota de leitura `operacao.status(chave)` → CONFIRMADA (event_id, resumo) | EM_ANDAMENTO | FALHOU | INEXISTENTE.
- Guarda semântica: mesmo tipo + mesma data + ~80% dos mesmos animais → aviso POSSIVEL_DUPLICIDADE (com aceite).
- Importação: chave determinística por lote (`imp:<import_id>:<n>`).

### 5.4 Falhas e recuperação
- Verdade dentro da planilha: operação órfã = linha de OPERACOES `INICIADA`, ou `CONFIRMADA` com `aplicada_em`
  vazio. O marcador `PENDING_OP:<ssId>` é só atalho para leitores.
- Algoritmo (reentrante): `tryLock`; com o lock na mão, RELER marcador e a cauda de OPERACOES (descartando
  memoização); INICIADA → `FALHOU` (nada a desfazer: a fase A só anexou linhas inertes); CONFIRMADA sem
  `aplicada_em` → reexecutar a fase C com rebuild de TODAS as projeções; incrementar DATA_VERSION nos dois casos;
  registrar em AUDITORIA e ERROS_LOG. Só a UnitOfWork externa adquire e solta o lock.
- Leitura otimista validada: (1) ler marcador e DATA_VERSION antes das abas; marcador presente → tentar o lock
  (recupera se órfã) ou aguardar até ~5 s e devolver LOCKED retentável; (2) ler as abas; (3) reler marcador e versão;
  mudou → repetir (até 3 vezes).
- Importação (INT-03, COB-05): lotes de tamanho fixo comandados pelo cliente, cada lote = uma operação com N
  eventos; os eventos só passam a vigentes quando `IMPORTACOES.status = IMPORTADO` (commit do arquivo inteiro em uma
  célula); enquanto `IMPORTANDO`, a interface mostra "importação incompleta" com Retomar | Desfazer, e os demais
  comandos de escrita são recusados. Projeções só depois do IMPORTADO (rebuild total). Backup automático antes de
  confirmar.
- Gatilhos (backup, integridade) entram pela UnitOfWork e recuperam antes de trabalhar. Restauração só por comando
  do app (`restaurarBackup`: copia o backup pela Drive API, troca `SPREADSHEET_ID`, roda `recoverAll()`).

### 5.5 Verificação de integridade (sob demanda e semanal)
PKs e brinco únicos; FKs (FK para animal ANULADO é erro); exatamente uma entrada vigente aberta por animal ATIVO;
linha do tempo de todos; projeção × replay (inclui atributos sensíveis, custo de aquisição e estoque);
`EVENTOS.status` × predicado de vigência; Σ efeito_inventario × contagem de ATIVOS; alocações (Σ ≤ valor do
lançamento; = total_alocado por rateio; = 100% nos lançamentos de COMPRA/VENDA); Σ PARCELAS.valor = FINANCEIRO.valor;
`FINANCEIRO.animal_id` ⇔ exatamente uma alocação direta; rateios com base desatualizada (alerta, nunca recálculo
silencioso); cópias × fonte (datas de detalhe = event_date; subtipo = tipo do detalhe); células coercidas; operações
órfãs; cabeçalhos × SCHEMA_META; fuso e locale; alertas (não erros): ativo sem pasto, sem brinco, sem categoria.

### 5.6 Backup e restauração
Um único gatilho diário (entre 02:00 e 04:00) executa em ordem: backup (cópia pela Drive API para
`ERP Pecuário/Backups`, retenção 30 diários + 12 mensais) → limpeza de exportações e anexos temporários. Backup
também sob demanda, antes de `setup()`/migração e antes de confirmar importação. Ensaio de restauração faz parte do
relatório de testes da Fase 1. Segunda linha de defesa: histórico de versões do Sheets.

## 6. Regras de domínio (pecuária)

- **Identificação**: brinco opcional; unicidade por `brinco_norm`; evento IDENTIFICACAO para rotina (primeiro brinco,
  reposição); AJUSTE só para identificação incorreta. Animal sem brinco aparece nos seletores como
  "A-000123 · cria da 0231 · 12/09/2026". Reuso de brinco aposentado bloqueado por padrão.
- **Genealogia**: mãe = fêmea, pai = macho; animal ≠ próprio progenitor; nascimento do filho > nascimento da mãe
  (idade mínima reprodutiva como aviso); sem ciclos; progenitor desconhecido permitido; confiança por vínculo.
  Importação resolve mãe/pai em duas passadas; progenitor não encontrado → aviso com três saídas.
- **Categorias (AUTO)**: primeira categoria ativa por `prioridade` que casa sexo + idade (meses completos; mínima
  inclusiva, máxima exclusiva) + condição. Parida = `partos_previos` + partos vigentes ≥ 1 (ou filho cadastrado).
  Sementes (configuráveis): Bezerro/Bezerra 0–12; Garrote e Novilha 12–24; Novilho/Boi magro 24–36 (macho não
  reprodutor); Boi (não reprodutor ≥ 36); Novilha (fêmea não parida ≥ 24, sem teto); Vaca (parida); Touro
  (reprodutor). `setup()` e a tela validam cobertura total; "Sem categoria" é pendência visível. Faixas etárias
  oficiais como parâmetro separado (`faixas_etarias_meses` = 12, 24, 36) com relatório por sexo × faixa.
- **Peso vigente** (UA, peso médio, patrimônio): última pesagem dentro de `peso_validade_dias` (padrão 180); vencida
  ou ausente → maior entre o último peso e o `peso_referencia_kg` da categoria, marcado como estimado; sem ambos →
  sem peso. O painel separa UA estimada em "sem pesagem" e "pesagem vencida".
- **UA**: UA = Σ peso vigente ÷ `ua_peso_kg` (padrão 450). UA/ha = UA ÷ área. Ocupação % = UA/ha ÷ capacidade
  estimada (ou cabeças ÷ capacidade em cabeças). Capacidade é informada, nunca deduzida só da área.
- **Desempenho**: ganho = P2 − P1; dias = D2 − D1; GMD = ganho ÷ dias (só se dias ≥ `gmd_intervalo_min_dias`,
  padrão 28; faixa de plausibilidade configurável gera aviso); variação % = (P2/P1 − 1) × 100. GMD individual usa
  só métodos individuais (BALANCA; FITA por parâmetro). Pesagem por lote: guarda peso total e nº de cabeças no
  evento e grava linhas MEDIA_LOTE (estimadas). GMD de lote = diferença das médias sobre os animais presentes nas
  duas pesagens. GMD por pasto: ganho do intervalo distribuído pelos pastos na proporção dos dias de permanência.
  Projeção: P(t) = último peso + GMD de referência (primeira à última pesagem válida dos últimos N dias) × dias,
  horizonte curto configurável, sempre rotulada como estimativa. Peso ajustado à desmama fica fora do MVP.
- **Arroba**: 1 @ = 15 kg. Em base CARCACA o fato é o peso de carcaça (por animal ou total) e o rendimento é
  derivado (carcaça ÷ vivo, quando há peso vivo). "Peso vivo × rendimento ÷ 15" só para estimativa ou rendimento
  negociado, com `rendimento_tipo` explícito. Todo R$/@ exibido traz a base ao lado. Carcaça nunca entra em PESAGENS.
- **Reprodução**: fato de exposição (EXPOSICAO coletiva: matrizes + touros + estação, sem data de cobertura por
  vaca). Exposta na estação E = fêmea com EXPOSICAO, COBERTURA ou INSEMINACAO vinculada a E. Situação reprodutiva é
  projeção (não validação): PARTO → VAZIA + cria ao pé; EXPOSICAO/COBERTURA → EXPOSTA; INSEMINACAO → INSEMINADA;
  DG positivo → PRENHA; DG negativo/ABORTO → VAZIA; DESMAMA/morte/venda da cria → cria ao pé = não. Previsão de
  parto em três níveis, sempre estimativa: data de IA/cobertura + `dias_gestacao` (padrão 290); DG com idade
  gestacional; só exposição → janela. Um parto = um evento NASCIMENTO = uma linha REPRODUCAO(PARTO); natimorto não
  cria animal; parto conta para IEP e "parida" mesmo com zero vivos.
- **Indicadores reprodutivos** (por estação E, exibindo n e denominador): matrizes ativas (D) = fêmeas ATIVAS aptas
  (idade ≥ mínima ou partos ≥ 1) sem marca de descarte; taxa de prenhez = prenhas no último DG ÷ expostas (com a
  cobertura do DG ao lado; abaixo da cobertura mínima o rótulo vira "prenhez entre diagnosticadas"); taxa de parição
  = expostas que pariram ÷ expostas; natalidade = nascidos vivos ÷ expostas; perda gestacional = (prenhas − paridas)
  ÷ prenhas; taxa de desmama = desmamados ÷ expostas; IEP = intervalos entre partos consecutivos (matrizes com ≥ 2);
  bezerros por matriz (ficha) = crias nascidas vivas e desmamadas; mortalidade até a desmama por safra = (mortos +
  desaparecidos antes da desmama) ÷ nascidos vivos, coorte aberta marcada como parcial. Sem estação registrada:
  natalidade anual = nascidos vivos no ano ÷ matrizes ativas no início do ano, rotulada assim. n abaixo do mínimo →
  "dados insuficientes".
- **Sanidade**: o sistema registra e alerta; não prescreve. Evento coletivo com `modo_dose` (POR_CABECA|POR_PESO|
  TOTAL) e `quantidade_consumida_total` (fato que gera o movimento de estoque e o custo). Carência: bloqueio (aviso
  configurável) só para venda com finalidade ABATE; nas demais, aviso. Agenda derivada (sem tabela): pendência por
  (animal, protocolo) ou (animal, produto); cumprida por aplicação posterior da mesma chave; vencido/próximo por
  parâmetros. Exigências oficiais (declaração de rebanho, vacinações obrigatórias, GTA) entram como protocolos e
  campos configuráveis, a validar com veterinário e órgão de defesa — nunca regra fixa.
- **Saídas**: venda de animal de descarte = VENDA com `motivo_saida`; DESCARTE = saída sem negociação; animal não
  encontrado = MARCACAO/NAO_LOCALIZADO (pendência) e, se confirmado, AJUSTE/DIVERGENCIA_CONTAGEM (entra no relatório
  de mortalidade como causa própria; reaparecimento = estorno da baixa).
- **Pasto arrendado** (resposta do dono à PR-12): é um PASTOS com `posse = ARRENDADO` e, se desejado, o arrendador em
  `arrendador_id`. Quando fica em outra fazenda, recomenda-se cadastrá-lo sob uma PROPRIEDADES própria (a estrutura de
  múltiplas propriedades já existe). Lotação, UA/ha e inventário funcionam como em qualquer pasto; a capacidade é
  informada. O aluguel é um LANCAMENTO_FINANCEIRO na conta "Arrendamento de pasto" [CUSTEIO, classe de custo
  ALIMENTACAO], com `pasture_id`, parceiro, período em `competencia_inicio`/`competencia_fim`, `quantidade` opcional
  (cabeças × meses, quando o preço é por cabeça/mês) e parcelas; vai para os animais por rateio DIAS_PERMANENCIA com
  escopo PASTO (quem ficou no pasto, por quantos dias, no período). TRANSFERENCIA para pasto de outra propriedade
  aceita `gta_numero` e anexo, opcionais (exigência de trânsito a validar com o órgão de defesa; nunca regra fixa).
  Relatório de custos por pasto separa pastos próprios de arrendados.
- **Alertas** (lista fechada, calculados na leitura, limiares em CONFIGURACOES): sanitário vencido/próximo; animais
  em carência; parto previsto; prenhez com previsão vencida; parcela a vencer/vencida; pasto acima da capacidade;
  ativo sem pasto; sem brinco; sem categoria; sem pesagem há N dias; não localizado; backup atrasado; integridade
  com erro; importação incompleta; rateio desatualizado.

## 7. Modelo financeiro

- **Dois níveis**: FINANCEIRO = fato econômico (conta, competência, valor, vínculos; alvo dos rateios); PARCELAS =
  título (vencimento, pagamento, valor pago, juros, desconto). Σ PARCELAS.valor = FINANCEIRO.valor. Lançamento sem
  parcela é fato sem efeito de caixa (consumo de insumo, saldo de abertura). "Pago", "recebido" e "atrasado" são
  rótulos derivados.
- **Naturezas decidem o cálculo** (nunca o grupo). Sementes: RECEITA: Venda de animais [RECEITA_VENDA_ANIMAIS];
  Outras receitas operacionais, Receitas extraordinárias [OUTRA_RECEITA]. CUSTO_DIRETO: Compra de animais, Frete e
  despesas de compra, Saldo de abertura do rebanho [AQUISICAO_ANIMAIS]; Alimentação, Vacinas, Medicamentos,
  Tratamentos, Transporte interno, Reprodução [CUSTEIO]; Frete de venda, Comissão de venda, Taxas e retenções sobre
  venda [DESPESA_VENDA]; Compra de insumos [ESTOQUE_INSUMOS]. CUSTO_OPERACIONAL: Manutenção de pastos, Arrendamento de pasto,
  Mão de obra, Equipamentos, Combustível, Energia, Serviços veterinários [CUSTEIO]. DESPESA_ADMINISTRATIVA: Contabilidade,
  Despesas gerais, Outros gastos [CUSTEIO]. NAO_OPERACIONAL: Aportes, Retiradas, Empréstimos [NAO_OPERACIONAL].
- **Três visões** (só registros vigentes):
  1. Fluxo de caixa realizado em P = Σ `valor_pago` das parcelas de receita liquidadas em P − Σ `valor_pago` das de
     despesa liquidadas em P (todas as naturezas). Previsto = parcelas abertas por vencimento.
  2. Resultado gerencial de P (competência) = receita de venda de animais + outras receitas − despesas de venda −
     custo de aquisição dos animais com saída em P (vendidos/descartados; mortes; baixas por ajuste, em linhas
     separadas) − custeio de P (alocado ou não) − juros + descontos de baixa. Compras de animais e de insumos e
     itens NAO_OPERACIONAL não entram.
  3. Por animal: custo de aquisição = Σ alocações AQUISICAO_ANIMAIS; custo acumulado = aquisição + Σ alocações de
     CUSTEIO; resultado realizado (só com saída) = receita alocada − despesas de venda alocadas − aquisição −
     custeio alocado. Mostrar ao lado "custeio não alocado do período".
  Teste automatizado de conciliação entre as visões (resultado acumulado × caixa + a receber − a pagar + custo do
  rebanho ativo + insumos em estoque − abertura − não operacional).
- **Insumos**: viram custo no consumo, não na compra. Compra de insumo = desembolso [ESTOQUE_INSUMOS] (com
  quantidade e movimento de ENTRADA quando `controla_estoque = S`). Aplicação = lançamento automático de consumo
  [CUSTEIO], sem parcela, valor = quantidade × custo unitário congelado, alocado aos animais (igual por cabeça ou
  proporcional à dose). Serviço ou produto pago no ato = CUSTEIO com parcela. Custo médio/PEPS fora do MVP.
- **Razão único por animal**: ALOCACOES_FINANCEIRAS é a única fonte de leitura de valor por animal; toda alocação
  tem `rateio_id` (COMPRA e VENDA gravam RATEIOS com escopo EVENTO). Invariantes: Σ ≤ valor; 100% obrigatório nos
  lançamentos de COMPRA/VENDA; "não alocado" = valor − Σ, sempre visível. Predicado único de "alocação vigente".
  `ANIMAIS.custo_aquisicao*` = Σ alocações vigentes AQUISICAO_ANIMAIS; `SANIDADE.custo` e
  `EVENTO_ANIMAIS.valor_individual` são cópias/bases, nunca somadas em relatório.
- **Rateio**: aritmética em centavos por `base_valor ÷ base_total` em inteiros; maior resto com desempate
  determinístico (maior resto → maior base → `codigo_interno`). DIAS_PERMANENCIA: intervalos [entrada, saída) no
  escopo a partir de EVENTO_ANIMAIS (o dia da entrada conta, o da saída não), interseção com o período; base zero →
  não alocado com motivo. CABECAS/PESO_VIVO usam `data_base`. Re-rateio = novo evento RATEIO.
- **Compra**: `valor_animais` informado prevalece (quantidade × preço é conferência com tolerância); frete e outros
  = lançamentos próprios [AQUISICAO_ANIMAIS] com parceiro e vencimento próprios; rateio pelo critério escolhido.
- **Venda**: receita = bruto − desconto comercial; cada dedução (frete, comissão, taxas/retenções; tipo em LISTAS,
  sem alíquota codificada) = lançamento [DESPESA_VENDA] com `retida_pelo_comprador`; retida → liquidada
  automaticamente na baixa da receita (encontro de contas; a tela mostra "depósito esperado"). Receita e cada
  despesa são rateadas pelo mesmo critério. Peso só do lote: sem PESAGENS por padrão; rateio por peso usa a última
  pesagem individual escalada (estimado) ou cai para CABECAS com aviso.
- **Fórmulas de negociação** (calculadas na leitura, base rotulada): preço médio/cabeça = valor ÷ qtd; preço/kg vivo
  = valor ÷ peso vivo total; arrobas = carcaça ÷ 15 (ou vivo × rendimento ÷ 15, estimado); preço/@ = valor ÷ arrobas;
  resultado da negociação = bruto − desconto − despesas de venda; custo total da compra = animais + frete + outros.
- **Abertura e nascidos**: NASCIDO → custo de aquisição 0,00 ("nascido na fazenda"). Rebanho inicial → valor de
  abertura opcional por animal ou em massa pela TABELA_PRECOS de D0; sem valor → custo nulo e resultado exibido como
  "parcial: N cabeças baixadas sem custo de aquisição".
- **Patrimônio**: valor do animal em D = valor manual vigente (escopo ANIMAL, validade
  `patrimonio_valor_manual_validade_dias`) → preço da categoria vigente em D → linha geral → sem referência.
  Bases: CABECA = valor; KG_VIVO = peso vigente × R$/kg; ARROBA = peso vigente × rendimento ÷ 15 × R$/@. Exibir
  sempre a cobertura ("412 de 430 cabeças valoradas; 61 com peso estimado; 18 sem valor de referência"). Três
  rótulos distintos: estimado, custo (aquisição do rebanho ativo) e negociado (vendas).
- **Dashboard e relatórios**: cada indicador declara tipo (POSICAO na data final | FLUXO no período), fonte e
  filtros aplicáveis; filtro não aplicável → etiqueta ou "—" (FILTRO_NAO_APLICAVEL). Receita de vendas = natureza
  RECEITA_VENDA_ANIMAIS por competência; custos operacionais = CUSTEIO + DESPESA_VENDA com quebra por grupo;
  resultado financeiro = resultado gerencial, com o caixa líquido ao lado. Com filtro de pasto/sexo/categoria, os
  financeiros usam alocações e mostram a parcela "não atribuída". Fora do MVP: baixa parcial automática, contas
  bancárias/conciliação, custo médio de estoque, UA-dia, rateio recorrente, depreciação, custo da matriz no bezerro.

## 8. Frontend (SPA no HtmlService)

- `Index.html` (template) + includes por módulo (orçamento de página ≤ ~450 KB); roteador por hash
  (`google.script.history`/`google.script.url`); store em memória por `dataVersion`; lista de módulos ativos vinda
  do backend (menu e seletor de eventos só mostram o que está entregue — §20 "sem botão sem função").
- `bootstrap` condicional (envia a `dataVersion` em cache): configurações, pastos, categorias, listas, catálogo e a
  lista leve de animais ATIVOS + EXTERNOS em formato colunar; baixados sob demanda. Busca, filtro, ordenação e
  paginação do rebanho no cliente. Após comando: aplica o delta se `novaVersao == versaoLocal + 1`, senão recarrega.
- **Registrar evento**: botão global (topo no desktop; centro da barra inferior no celular) + entrada por contexto
  (ficha, painel do pasto, seleção múltipla na listagem) com pré-preenchimento. Campos de referência com "+ Novo"
  embutido. No celular o formulário é rota de tela cheia; cada etapa é entrada de histórico.
- **Modo curral** (pesagem, sanidade, desmama, identificação): cabeçalho fixo + campos Brinco e Peso; Enter
  percorre brinco → peso → nova linha; resolução do brinco no store (exato → sem zeros à esquerda → lista); estados
  por linha (não encontrado, inativo, repetido, fora do pasto, variação implausível); alternativas "todos do pasto"
  e "colar brinco;peso". Um único evento ao final, com rascunho persistente.
- **Rascunho e rede** (UX-01): rascunho + chave em `localStorage` (fallback no servidor se o spike mostrar que não é
  durável no iframe); timeout → "verificando se gravou" via `operacao.status`; `appVersion` no envelope → faixa
  "nova versão — recarregar".
- Erro em evento coletivo: resumo "3 de 80 com problema", filtro, "corrigir" ou "tirar da lista", e novo envio
  explícito dos restantes — nunca parcial em silêncio.
- Navegação: desktop com menu lateral dos 10 itens da §15; celular com Início · Rebanho · [Registrar] · Pastos ·
  Mais. Listagem em cartões abaixo de 900 px. Critérios de legibilidade: base 16 px, alvos ≥ 48 px, contraste alto,
  estado por ícone + texto, foco visível, teclado numérico para pesos.
- Dashboard: uma consulta `dashboard.obter(filtros)` devolve todos os cartões e séries como `{valor|null, motivo, n}`
  + `geradoEm`. Relatórios: `ReportCatalog` → uma tela e um exportador para os 17. Importação: assistente de 5 telas
  cobrindo os 10 passos da §14, em blocos com progresso, tarefa de desktop.
- Fotos: miniatura (~15 KB) e imagem (~300 KB) geradas no cliente; servidas pelo backend como data URL.
- Futuro PWA/offline: o iframe não permite service worker; comandos idempotentes + rascunhos permitem migrar o
  front para hospedagem própria com fila offline sem reescrever o backend.

## 9. Testes

- Nível 1 (Node, a cada commit, executado neste repositório): domínio puro + adaptador contra fakes fiéis (coerção
  de tipos, perda de qualquer subconjunto de escritas não descarregadas, lock com troca de execução entre "ler
  marcador" e "obter lock"), nas duas ordens de carga dos arquivos. Cobre os 10 cenários da §18 e os adicionais:
  11 `setup()` duas vezes e com o código da fase seguinte; 12 importação com erros e duplicatas (total e parcial
  aprovada) e queda no meio; 13 rateio com centavos (R$ 100,00 ÷ 3); 14 venda por arroba (carcaça apurada e
  rendimento estimado); 15 estorno bloqueado por parcela liquidada e substituição transportando baixas; 16
  exportação conferida contra a tela; 17 evento retroativo e manejos no mesmo dia; 18 substituição de evento que
  cria animais (mesmo `animal_id`); 19 conciliação caixa × resultado; 20 corpus de tipos.
- Nível 2 (dentro do Apps Script, pelo dono): `runAcceptanceTests()` em planilha temporária criada pela Drive API,
  com chaves de Properties próprias; inclui página de concorrência real (5 comandos paralelos com chaves
  diferentes + 2 com a mesma chave). Nunca toca a base real.
- Nível 3: interface com Playwright e mock de `google.script.run` (fluxos críticos, celular e desktop, acessibilidade).
- `seedDemoData_()`: ~300 animais e 3 anos de eventos gerados pelos próprios comandos, em planilha separada com
  faixa "BASE DE TESTE" (serve ao spike de desempenho e à demonstração).
- Relatório de testes por fase, distinguindo "executado aqui (Node)" de "a executar na conta do dono".

## 10. Fases (cada fase só avança com testes verdes; P11)

- **Fase 1 — Fundação**: spike técnico (§12); esquema completo + `setup()`; adaptador de E/S; UnitOfWork (três
  fases, journal, recuperação, idempotência, auditoria); EventCatalog; ENTRADA_INICIAL e OUTRA_ENTRADA; AJUSTE
  (CORRECAO_CADASTRO, IDENTIFICACAO_INCORRETA, CORRECAO_LOCALIZACAO); estorno/substituição de entradas; propriedades;
  pastos (painel básico); animais (lista, ficha, genealogia com árvore, foto/documento, exportação CSV);
  configurações (parâmetros, LISTAS, CATEGORIAS); importação de ANIMAIS (pipeline dos 10 passos, desfazer);
  backup diário e sob demanda; verificação básica de integridade; tela "Visão geral".
- **Fase 2 — Motor de eventos**: NASCIMENTO, COMPRA, VENDA (com FINANCEIRO, PARCELAS, RATEIOS, ALOCACOES),
  TRANSFERENCIA, MORTE, DESCARTE, IDENTIFICACAO, MARCACAO, AJUSTE (RECLASSIFICACAO, DIVERGENCIA_CONTAGEM),
  estorno/substituição geral, PARCEIROS, anexos de evento, inventário histórico, composição do pasto em data,
  UA/ha e ocupação, tela de auditoria, importadores de COMPRAS/VENDAS/TRANSFERENCIAS/NASCIMENTOS/MORTES e
  reconciliação.
- **Fase 3 — Manejo**: PESAGEM (modo curral, GMD, curva, projeção), SANIDADE (PRODUTOS, PROTOCOLOS, estoque
  opcional, agenda, carência), REPRODUCAO (estações, exposição, cobertura, IA, DG, aborto), DESMAMA, CASTRACAO,
  importadores de PESAGENS/SANIDADE/REPRODUCAO/OCORRENCIAS.
- **Fase 4 — Financeiro**: lançamentos avulsos, baixa de parcelas, rateios de custos compartilhados, custos por
  animal e por pasto, plano de contas, TABELA_PRECOS e patrimônio, fluxo de caixa e resultado gerencial.
- **Fase 5 — Inteligência**: dashboard completo, indicadores, 17 relatórios, XLSX/PDF, alertas consolidados.

## 11. Estrutura de arquivos (`erp-pecuario/src`)

Backend (`.js` no repositório → `.gs` no Apps Script). Os 17 nomes da §3.1 são mantidos; acréscimos justificados:
`Code` (entradas públicas), `Api` (roteador, guarda, envelope — tira lógica de `Code`), `Config`, `Schema` (tabelas,
tipos, enums, sementes — fonte única do `setup()` e do dicionário), `Database` (SheetsAdapter e codec), `Repository`
(vigentes e índices — separa regra de persistência, §3.3), `UnitOfWork` (lock, journal, fases, recuperação),
`Validation`, `Utils` (datas, dinheiro, texto, ids), `EventCatalog` (definição declarativa dos eventos), `EventService`
(pipeline, estorno, substituição, simulação), `Timeline` (validador, projetor, inventário em data), `AnimalService`,
`PastureService`, `WeightService`, `HealthService`, `ReproductionService`, `FinancialService`, `InventoryService`,
`ReportService`, `ImportService`, `AuditService` (auditoria, integridade, erros), `FileService` (Drive: banco,
backups, anexos, exportações), `Maintenance` (gatilhos, backup, limpeza), `TestRunner` (aceitação e base de
demonstração). Carga independente de ordem (testada nas duas ordens).
Frontend (`.html`): `Index`, `Styles`, `JavaScript` (apiClient, store, roteador, rascunhos), `Components` (UI kit,
renderizador de formulário, seletor de animais, modo curral, gráficos), `Dashboard`, `Animals`, `Pastures`,
`Events`, `Weights`, `Health`, `Reproduction`, `Financial`, `Reports`, `Settings`, `Import`.
Fora de `src/`: `tests/` (harness, fakes, testes por área, `ui/`), `scripts/push-gas.js`, `docs/` (fase-0, guia de
implantação, CHANGELOG, CHECKLIST e relatório de testes por fase), `package.json`, `.clasp.json.example`.

## 12. Spike técnico (primeira tarefa da Fase 1; cada item com critério de aprovação e contingência)

1. Primitiva de E/S: corpus de tipos pela Sheets API tipada × `setValues` com `@`; atomicidade do `batchUpdate`
   (request inválido no meio → nada aplicado); latência de um comando real (venda de 5 animais).
2. `drive.file` com o serviço avançado Drive v3: create, copy, export (REST), `alt=media`, list na pasta, update
   `trashed`; planilha criada pela Drive API abre com `SpreadsheetApp.openById`.
3. Lock: liberação quando a execução morre por timeout; comportamento do buffer não descarregado.
4. `Session.getActiveUser().getEmail()` no modo USER_DEPLOYING + MYSELF em conta gmail; várias contas logadas.
5. Desempenho com 10 mil, 50 mil, 100 mil e 300 mil linhas; custo de `getProperties()`.
6. Payload de `google.script.run` (importação, fotos); `localStorage` no iframe (Chrome Android, Safari iOS).
7. Download/abertura de arquivo exportado no celular; XLSX e PDF pela Drive API.
8. Chart.js por CDN com SRI dentro do iframe × SVG próprio.
9. Gatilho chamando handler; `ensureTriggers_`; horário do gatilho diário.
10. Aparar abas à dimensão exata e herança de formato em linhas novas (só se a primitiva for `SpreadsheetApp`).

## 13. Riscos principais (risco → mitigação → fase)

Coerção de tipos do Sheets (→ primitiva tipada + corpus + fake fiel; F1). Gravação parcial (→ três fases, commit em
uma célula, redo idempotente; F1). Limite de 6 min (→ lotes de importação, leituras declaradas, orçamento p95; F1).
Edição manual da planilha (→ proteção de aviso + integridade; F1). Crescimento das tabelas (→ volumetria, limiar de
arquivamento; F2+). Latência de `google.script.run` (→ bootstrap único, uma ida por evento simples, modo curral;
F1–F3). Perda de formulário no celular (→ rascunho persistente + status da operação; F1). Escopo `drive.file`
insuficiente (→ contingência `drive`; F1). CDN de gráficos (→ SRI + tabela + SVG próprio; F3). Estado em Script
Properties vazando entre bancos (→ chaves por planilha, verdade em OPERACOES; F1). Sessão/conta errada com
`MYSELF` (→ guia de implantação; F1). Dupla contagem financeira (→ naturezas, razão único, invariantes; F2–F4).
Dependência de um único dono para implantar (→ guia, `diagnose`, testes de nível 2). Limite de 200 versões
(→ `/dev` no desenvolvimento). Indicadores enganosos por dado ausente (→ P9 e cobertura explícita; F3–F5).

## 14. Premissas a validar com o dono (valor padrão adotado → impacto se mudar)

1. Conta Google pessoal (gmail) e usuário único = quem implanta → cotas e modelo de acesso.
2. Fuso `America/Porto_Velho` e fazenda em Rondônia → datas e exemplos de exigências oficiais.
3. Data do marco zero (D0) = data do inventário inicial informado na importação → tudo antes é histórico informativo.
4. Formato dos dados históricos (planilha Excel? caderno?) → esforço de mapeamento da importação.
5. Uso em produção já na Fase 1 (cadastro + importação) → backup e integridade antecipados.
6. Registro em campo pelo celular com sinal fraco → modo curral e rascunho persistente são prioridade.
7. Manejo reprodutivo: estação de monta × touro o ano todo; IA ou só monta natural → sementes e telas da Fase 3.
8. Brinco colocado no nascimento ou na desmama; numeração com zeros à esquerda; brinco oficial além do de manejo.
9. Venda principal: frigorífico (peso de carcaça/romaneio) × reposição (cabeça/kg vivo); rendimento padrão.
10. Controle de estoque de insumos no MVP: opcional por produto (padrão desligado).
11. Insumo vira custo no consumo (não na compra) → regra do resultado gerencial.
12. RESPONDIDA pelo dono em 14/11/2026: não há gado de terceiros nem parceria (todos os animais são do dono; não existe
    `proprietario_id`), mas às vezes o gado fica em pasto alugado (arrendamento) → `PASTOS.posse`/`arrendador_id`, conta
    "Arrendamento de pasto" e rateio por dias de permanência (DV-20, seção 6).
13. "Lote" sem entidade própria no MVP.
14. Categorias-semente e faixas etárias oficiais (12/24/36 meses) → a validar com o uso local.
15. Parâmetros zootécnicos padrão: UA 450 kg; gestação 290 dias; validade da pesagem 180 dias; intervalo mínimo de
    GMD 28 dias; idade mínima reprodutiva.
16. Forma de implantação: clasp pelo Cloud Shell (como no projeto irmão) × cópia manual.
Nenhuma dessas premissas bloqueia a Fase 1: todas têm valor padrão configurável. A premissa 12, a única que convinha
responder antes do congelamento do esquema, já foi respondida pelo dono e está incorporada ao desenho.

## 15. Nomes canônicos (para os documentos não divergirem entre si)

### 15.1 Identificadores de documento
- Regras de negócio: `RN-nnn`, numeradas SOMENTE em `05-regras-de-negocio.md`. Os outros documentos descrevem a
  regra em palavras ou citam a § da especificação; não inventam números RN.
- Cenários de teste: `CT-01` a `CT-10` = cenários 1 a 10 da §18, na mesma ordem; `CT-11` a `CT-20` = os adicionais
  da seção 9 deste desenho, na ordem em que aparecem (11 setup repetido; 12 importação; 13 rateio com centavos;
  14 venda por arroba; 15 estorno × parcela liquidada; 16 exportação; 17 retroativo e mesmo dia; 18 substituição de
  evento criador; 19 conciliação caixa × resultado; 20 corpus de tipos).
- Itens do spike: `SP-01` a `SP-10` = itens 1 a 10 da seção 12. Premissas: `PR-01` a `PR-16` = itens da seção 14.
  Divergências da especificação: `DV-01` a `DV-20` = itens da seção 3.5. Riscos: `R-nn`, numerados só em
  `11-riscos-e-premissas.md`.

### 15.2 Chaves de CONFIGURACOES (grupo: chave = padrão)
- geral: `propriedade_padrao_id`; `fuso` = America/Porto_Velho; `data_marco_zero`; `unidade_peso_exibicao` = KG;
  `itens_por_pagina` = 50
- identificacao: `brinco_somente_numerico` = N; `brinco_ignora_zeros_esquerda` = S; `brinco_permite_reuso` = N
- pecuaria: `ua_peso_kg` = 450; `arroba_kg` = 15; `rendimento_carcaca_padrao_pct` = 50; `dias_gestacao` = 290;
  `idade_min_reprodutiva_meses` = 24; `idade_desmama_padrao_meses` = 8; `faixas_etarias_meses` = [12,24,36];
  `peso_validade_dias` = 180; `gmd_intervalo_min_dias` = 28; `gmd_plausivel_min_kg_dia` = -1,0;
  `gmd_plausivel_max_kg_dia` = 2,0; `gmd_referencia_janela_dias` = 120; `gmd_aceita_fita` = N;
  `projecao_peso_horizonte_dias` = 90; `peso_nascer_padrao_kg_macho` e `peso_nascer_padrao_kg_femea` (vazios);
  `parto_tolerancia_dias` = 20; `prenhez_cobertura_dg_min_pct` = 90; `indicador_n_minimo` = 5
- sanidade: `agenda_antecedencia_dias` = 15; `agenda_tolerancia_dias` = 7
- financeiro: `fin_bloqueio_ate` (vazio); `fin_tolerancia_conferencia_pct` = 1; `caixa_saldo_inicial` e
  `caixa_saldo_inicial_data` (vazios); `patrimonio_valor_manual_validade_dias` = 180
- alertas: `alerta_sem_pesagem_dias` = 180; `alerta_parto_previsto_dias` = 30; `alerta_prenhez_vencida_dias` = 15;
  `alerta_parcela_a_vencer_dias` = 7; `alerta_backup_atrasado_dias` = 2
- avisos: `avisos_politica` (JSON: código do aviso → BLOQUEIA|AVISA|IGNORA; padrão CARENCIA_ATIVA em venda para
  ABATE = BLOQUEIA; demais = AVISA)
- sistema: `backup_retencao_diarios` = 30; `backup_retencao_mensais` = 12; `importacao_lote_linhas` = 200;
  `json_celula_max_caracteres` = 40000; `arquivamento_limiar_linhas` = 60000
Todos os valores zootécnicos e financeiros são pontos de partida a validar (PR-15), não recomendações técnicas.

### 15.3 Rotas da API (`dominio.acao`)
`sistema.bootstrap`, `sistema.backup`, `sistema.restaurarBackup`, `sistema.integridade`, `operacao.status`,
`evento.simular`, `evento.registrar`, `evento.corrigir`, `evento.estornar`, `evento.listar`, `evento.obter`,
`animal.listar`, `animal.ficha`, `animal.editar`, `animal.cadastrarExterno`, `inventario.posicao`,
`inventario.elegiveis`, `pasto.listar`, `pasto.painel`, `pasto.salvar`, `propriedade.salvar`, `parceiro.salvar`,
`produto.salvar`, `protocolo.salvar`, `estacao.salvar`, `categoria.salvar`, `lista.salvar`, `conta.salvar`,
`preco.salvar`, `config.salvar`, `parcela.baixar`, `parcela.desfazerBaixa`, `financeiro.fluxoCaixa`,
`financeiro.resultado`, `financeiro.custosAnimal`, `sanidade.agenda`, `reproducao.indicadores`, `peso.desempenho`,
`dashboard.obter`, `alerta.listar`, `relatorio.obter`, `relatorio.exportar`, `importacao.criar`,
`importacao.validarBloco`, `importacao.importarBloco`, `importacao.concluir`, `importacao.desfazer`,
`anexo.adicionar`, `anexo.remover`, `anexo.obter`, `auditoria.listar`.
Lançamento financeiro avulso, rateio e entrada de estoque são eventos (`evento.registrar` com o tipo correspondente).

### 15.4 Arquivos da Fase 0 (`erp-pecuario/docs/fase-0/`)
`README.md` (resumo executivo e índice) · `01-arquitetura.md` · `02-modelo-de-dados.md` (DER e relacionamentos) ·
`03a-dicionario-cadastros-suporte.md` · `03b-dicionario-eventos-financeiro.md` · `04-motor-de-eventos.md` ·
`05-regras-de-negocio.md` · `06-persistencia-e-integridade.md` · `07-financeiro-e-indicadores.md` · `08-ux-ui.md` ·
`09-plano-de-testes.md` · `10-plano-de-implementacao.md` · `11-riscos-e-premissas.md` ·
`12-fatos-de-plataforma.md` · `13-revisao-adversarial.md`


## 16. Decisões posteriores à versão 2 (valem sobre o texto acima)

1. **Posição do evento substituto.** O substituto recebe `event_seq` novo, mas na ordem canônica do replay ocupa a posição
   do evento que substitui (desempate pelo `event_seq` do primeiro evento da cadeia de substituição).
2. **Reuso de brinco.** O código lançado por engano e corrigido por AJUSTE_INVENTARIO/IDENTIFICACAO_INCORRETA não conta
   para o bloqueio de reuso.
3. **Contrato da API.** Campo opcional `ambiente` (TESTE, DEMO) no pedido: o banco é resolvido por `TEST_SPREADSHEET_ID`
   ou `DEMO_SPREADSHEET_ID`. Script Properties: `SPREADSHEET_ID`, `OWNER_EMAIL`, `ALLOW_EMPTY_ACTIVE_USER`,
   `DRIVE_FOLDERS`, `TEST_PLAN`, `DATA_VERSION:<id>`, `PENDING_OP:<id>` (`01-arquitetura.md`, seção 5).
4. **Fase C em dois passos.** Status dos eventos e projeções → `flush` → só então `OPERACOES.aplicada_em` → `flush`.
5. **Recuperação.** `INICIADA` → `FALHOU` também grava `EVENTOS.status = FALHOU` e reconstrói as projeções (animal
   PENDENTE vira ANULADO). `operacao.status` segue a regra dos leitores: com marcador presente, tenta o lock e recupera.
   Exceção tratada durante a gravação: a UnitOfWork aplica a recuperação à própria operação, com o lock, relendo a planilha.
6. **`payload_hash`.** SHA-256 do JSON canônico de `{rota, dados}`: chaves em ordem alfabética, sem espaços, vazios omitidos.
7. **ERROS_LOG** fica fora do journal: linha anexada, sem operação e sem mudar a versão dos dados.
8. **Importação em curso.** Com `IMPORTANDO`, recusam-se só os comandos que alteram dados de negócio; manutenção
   (backup, integridade) e as rotas `importacao.*` continuam.
9. **Insumos.** Compra de produto do cadastro é sempre ESTOQUE_INSUMOS, com ou sem controle de estoque; o movimento de
   ENTRADA só existe com `controla_estoque = S`. Produto com `custo_unitario` gera consumo na aplicação.
10. **Filtro de pasto no dashboard.** Lançamento com `pasture_id` conta inteiro para o seu pasto e fica fora da soma por alocações.
11. **Parcela CANCELADA** marca só a parcela substituída por desdobramento; parcelas de lançamento cancelado não são
    regravadas (deixam de valer pelo lançamento).
12. **Tipos e limites.** Tipo de coluna adicional DEC4 (até 4 casas); peso vivo de no máximo 2.000 kg; 13 códigos de aviso
    (`05-regras-de-negocio.md`, seção 1); plano de contas com os 29 códigos de `03a-dicionario-cadastros-suporte.md`, seção 4.13.
13. **Primitiva de E/S.** Ordem de preferência: Sheets API com valores tipados; Sheets API com `Values.batchUpdate` e
    entrada `RAW`; `SpreadsheetApp` com a primitiva única de append.
14. **Identidade de conciliação** inclui despesa antecipada, líquida de receita antecipada (`07-financeiro-e-indicadores.md`, seção 2.1).

## 17. Decisões de execução autônoma (14/11/2026)

O dono aprovou a Fase 0 e autorizou a execução com autonomia total. O spike técnico depende da conta Google dele, à qual
esta sessão não tem acesso. Para não parar, cada item do spike recebeu uma decisão que não depende de comportamento não
verificado, com a verificação real embutida no próprio sistema:

| Item | Decisão |
|---|---|
| SP-01 primitiva de E/S | O adaptador implementa as três primitivas atrás de uma porta única (`IO_PRIMITIVE`). O `setup()` roda o corpus de tipos numa planilha temporária e adota a primeira que passar, na ordem da seção 16.13; grava o resultado na tela de sistema. O protocolo de três fases completo vale sempre: não se presume atomicidade do `batchUpdate` |
| SP-02 escopo do Drive | `drive.file` com todos os arquivos criados pela Drive API; o `setup()` sonda cada operação e devolve erro `CONFIG` com a instrução de contingência (escopo `drive`) |
| SP-03 lock e buffer | O desenho já presume o pior caso (qualquer subconjunto das escritas não descarregadas). O diagnóstico mede a liberação do lock |
| SP-04 e-mail do dono | Guarda de dono com a contingência `ALLOW_EMPTY_ACTIVE_USER`, como no projeto irmão |
| SP-05 desempenho | Leituras declaradas por comando; o diagnóstico mede com a base de demonstração e mostra os tempos |
| SP-06 rascunho | `localStorage` com `try/catch`; se indisponível, o rascunho é guardado no servidor por `rascunho.salvar` (propriedades do usuário), fora da planilha |
| SP-07 exportação | CSV no cliente desde a Fase 1; XLSX e PDF na Fase 5 pela Drive API, entregues como link |
| SP-08 gráficos | Gráficos SVG próprios, sem biblioteca externa nem CDN (elimina os riscos R-08 e R-22) |
| SP-09 gatilhos | `ensureTriggers_` idempotente por nome de função; handlers públicos com guarda de dono |
| SP-10 abas e formato | Só se aplica à primitiva `SpreadsheetApp`: formato de texto aplicado a cada bloco gravado |

O roteiro de diagnóstico que o dono executa na própria conta (`runDiagnostics`) confere todos os itens e devolve um relatório
sem dados sensíveis. Nada é declarado "validado no ambiente real" antes desse relatório.
