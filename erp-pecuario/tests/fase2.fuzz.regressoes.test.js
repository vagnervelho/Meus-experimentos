'use strict';
/**
 * Sequências mínimas achadas pelo teste aleatório (tests/fase2.fuzz.test.js), fixadas depois do conserto. Cada caso
 * roda pela api() num sistema novo, com o MESMO oráculo do teste aleatório depois de cada passo (integridade, projeção =
 * reconstrução, financeiro, replay independente, efeito pedido; recusa sem gravar nada, com código e mensagem em
 * português), e confere o desfecho de cada passo. Os identificadores vão por símbolo: "@b:5" é o animal de brinco 5 do
 * rebanho de base, "@p:A" o Pasto A, "@f:fornecedor" um parceiro, "@k.eN"/"@k.aN"/"@k.iN" o evento, o animal e a
 * importação que o passo k criou (tests/apoio-fuzz.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./apoio-fuzz');

const BASE = { ordem: 'alpha', reuso: false, vazio: false };
const incorreta = (data, animal, brinco, extra) => Object.assign({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: data, justificativa: 'Brinco digitado errado' }, animais: [{ animal_id: animal, brinco }] }, extra || {});
const troca = (data, animal, codigo, extra) => Object.assign({ tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: data, tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: animal, codigo, motivo: 'PERDA' }] }, extra || {});
const passo = (k, rota, dados) => ({ k, rota, dados, avisos: [], aceitar: true });
const doacaoNoD = { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-06-09', description: 'Doação do vizinho' }, animais: [{ sexo: 'M', pasto_destino_id: '@p:D', origem: 'DESCONHECIDA', brinco: '84', data_nascimento: '2023-01-15', data_nascimento_confianca: 'ESTIMADA', castrado: true, reprodutor: false }] };
const desativarD = { pasture_id: '@p:D', campos: { status: 'INATIVO' }, justificativa: 'Pasto em reforma' };
const entrada45 = { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-03-10', description: 'Doação do vizinho' }, animais: [{ sexo: 'F', pasto_destino_id: '@p:C', origem: 'DESCONHECIDA', brinco: '45', mae_id: '@b:1', mae_confianca: 'CONFIRMADA', data_nascimento: '2025-06-01', data_nascimento_confianca: 'ESTIMADA' }] };
const anexoNoEvento = (ev) => ({ entidade: 'EVENTOS', entity_id: ev, tipo: 'DOCUMENTO', nome_arquivo: 'termo.pdf', mime_type: 'application/pdf', conteudo_base64: Buffer.from('%PDF-1.4 termo').toString('base64') });
const reclassificar = (data, cat, extra) => Object.assign({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: data, justificativa: 'Categoria conferida no curral' }, animais: [{ animal_id: '@b:5', categoria_manual_id: cat }] }, extra || {});

// Passada 4: a compra importada (anterior ao marco zero) e o período financeiro fechado depois do bloco.
const MAPA_COMPRAS = { colunas: { grupo: 'grupo', data: 'data', fornecedor: 'fornecedor', modalidade: 'modalidade', valor: 'valor_animais', preco: 'preco', brinco: 'brinco', sexo: 'sexo', pasto: 'pasto', peso: 'peso', frete: 'frete', parcelas: 'parcelas', vencimento: 'vencimento' }, confiancas: {}, padroes: { castrado: false, reprodutor: false } };
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const compraCsv = 'grupo;data;fornecedor;modalidade;valor;preco;brinco;sexo;pasto;peso;frete;parcelas;vencimento\nC1;19/12/2025;Fazenda Vizinha;kg;1.481,24;9,01;77;F;Pasto C;164,4;0,01;3;18/01/2026';
const criarCompras = (nome) => ({ tipo: 'COMPRAS', arquivo_nome: nome, texto: compraCsv, formato: FORMATO });
const comAvisos = (p, avisos) => Object.assign(p, { avisos });
const AVISOS = F.AVISOS;
const importadaNoPeriodo = [
  passo(0, 'importacao.criar', criarCompras('compras-6.csv')),
  comAvisos(passo(1, 'importacao.validarBloco', { import_id: '@0.i0', bloco: 1, mapeamento: MAPA_COMPRAS }), AVISOS),
  comAvisos(passo(2, 'config.salvar', { valores: { fin_bloqueio_ate: '2026-09-14' } }), AVISOS),
  comAvisos(passo(3, 'importacao.importarBloco', { import_id: '@0.i0', bloco: 1, modo: 'TOTAL' }), AVISOS),
  passo(4, 'importacao.concluir', { import_id: '@0.i0' }),
];
const desfazerImp = (k, extra) => Object.assign(comAvisos(passo(k, 'importacao.desfazer', { import_id: '@0.i0', justificativa: 'Arquivo errado' }), AVISOS), extra || {});

const CASOS = [
  {
    nome: 'brinco lançado errado corrigido para antes de uma troca do mesmo dia: o substituto fica no lugar do original e corrigiria um número que ainda não estava no animal',
    comandos: [
      passo(0, 'evento.registrar', incorreta('2026-05-31', '@b:5', '66')),
      passo(1, 'evento.registrar', troca('2026-05-31', '@b:5', '44')),
      passo(2, 'evento.corrigir', incorreta('2026-05-31', '@b:5', '55', { event_id: '@0.e0', justificativa: 'O número certo era 55' })),
    ],
    // Antes do conserto: aceito, com o brinco 44 (da troca) gravado como o número corrigido e o 44 continuando no animal.
    esperado: { 0: 'OK', 1: 'OK', 2: 'VALIDATION:ANTES_DA_IDENTIFICACAO' },
  },
  {
    nome: 'a troca de brinco levada por correção para antes do brinco lançado errado: a correção de brinco passaria a trocar um número que o animal já não tinha (outro caminho do mesmo defeito, fechado pela trava)',
    comandos: [
      passo(0, 'evento.registrar', incorreta('2026-05-31', '@b:5', '66')),
      passo(1, 'evento.registrar', troca('2026-06-10', '@b:5', '44')),
      passo(2, 'evento.corrigir', troca('2026-05-20', '@b:5', '44', { event_id: '@1.e0', justificativa: 'A data era outra' })),
      passo(3, 'evento.estornar', { event_id: '@0.e0', justificativa: 'Lançado errado' }),
      passo(4, 'evento.corrigir', troca('2026-05-20', '@b:5', '44', { event_id: '@1.e0', justificativa: 'A data era outra' })),
    ],
    esperado: { 0: 'OK', 1: 'OK', 2: 'CONFLICT:INTEGRIDADE_LINHA_DO_TEMPO', 3: 'OK', 4: 'OK' },
  },
  {
    // Passada 2 (semente 61101, encolhida à mão de 10 para 4 passos com a mesma assinatura REPLAY:PASTO_INATIVO).
    nome: 'pasto desativado depois que o animal morreu nele: o estorno da morte devolveria o animal ao rebanho dentro do pasto desativado',
    comandos: [
      passo(0, 'evento.registrar', doacaoNoD),
      passo(1, 'evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-08-30', causa: 'DOENCA' }, animais: [{ animal_id: '@0.a0' }] }),
      passo(2, 'pasto.salvar', desativarD),
      passo(3, 'evento.estornar', { event_id: '@1.e0', justificativa: 'Lançado errado' }),
    ],
    // Antes do conserto: aceito, com o animal ATIVO no Pasto D desativado (fora dos seletores, sem como tirá-lo de lá).
    esperado: { 0: 'OK', 1: 'OK', 2: 'OK', 3: 'CONFLICT:INTEGRIDADE_LINHA_DO_TEMPO' },
  },
  {
    nome: 'o mesmo pelo estorno da transferência que tirou o animal do pasto depois desativado',
    comandos: [
      passo(0, 'evento.registrar', doacaoNoD),
      passo(1, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-08-30', pasto_origem_id: '@p:D', pasto_destino_id: '@p:A' }, animais: [{ animal_id: '@0.a0' }] }),
      passo(2, 'pasto.salvar', desativarD),
      passo(3, 'evento.estornar', { event_id: '@1.e0', justificativa: 'Lançado errado' }),
    ],
    esperado: { 0: 'OK', 1: 'OK', 2: 'OK', 3: 'CONFLICT:INTEGRIDADE_LINHA_DO_TEMPO' },
  },
  {
    // Passada 2: o caminho da correção da mesma regra que o estorno já conferia (CATEGORIA_INATIVA).
    nome: 'categoria desativada e a reclassificação seguinte corrigida para antes da que usava a categoria: o animal voltaria à categoria desativada',
    comandos: [
      passo(0, 'evento.registrar', reclassificar('2026-03-01', '@c:VACA')),
      passo(1, 'evento.registrar', reclassificar('2026-06-01', '@c:NOVILHA_24_MAIS')),
      passo(2, 'categoria.salvar', { category_id: '@c:VACA', campos: { ativo: false }, justificativa: 'Categoria revista' }),
      passo(3, 'evento.corrigir', reclassificar('2026-02-01', '@c:NOVILHA_24_MAIS', { event_id: '@1.e0', justificativa: 'A data era outra' })),
      passo(4, 'evento.estornar', { event_id: '@1.e0', justificativa: 'Lançado errado' }),
    ],
    // Antes do conserto: o passo 3 era aceito, com o animal na VACA desativada; o estorno (passo 4) já era recusado.
    esperado: { 0: 'OK', 1: 'OK', 2: 'OK', 3: 'CONFLICT:INTEGRIDADE_LINHA_DO_TEMPO', 4: 'CONFLICT:CATEGORIA_INATIVA' },
  },
  {
    // Passada 3 (semente 73261, defeito do MODELO, não do sistema): o reenvio do registro refazia a especificação
    // memorizada sem os animais criados, e a "correção idêntica" seguinte saía sem o animal_id (o sistema, certo, anulava
    // o animal e criava outro). Fixa o desfecho certo: reenvio duplicado e a correção com a mesma especificação e o mesmo
    // animal, que não muda nenhum animal (oráculo da correção idêntica e do estorno imediato).
    nome: 'entrada registrada, reenviada e corrigida com a mesma especificação: o animal criado é o mesmo e nada muda; o estorno logo depois devolve tudo',
    comandos: [
      passo(0, 'evento.registrar', entrada45),
      Object.assign(passo(1, 'evento.registrar', entrada45), { chaveDe: 0, reenvio: true }),
      Object.assign(passo(2, 'evento.corrigir', Object.assign({}, entrada45, { animais: [Object.assign({ animal_id: '@0.a0' }, entrada45.animais[0])], event_id: '@0.e0', justificativa: 'Conferido de novo' })), { correcaoIdentica: true }),
      passo(3, 'evento.registrar', reclassificar('2026-04-01', '@c:VACA')),
      Object.assign(passo(4, 'evento.estornar', { event_id: '@3.e0', justificativa: 'Lançado errado' }), { estornoImediato: true }),
    ],
    esperado: { 0: 'OK', 1: 'OK', 2: 'OK', 3: 'OK', 4: 'OK' },
  },
  {
    // Passada 3 (sementes 74134, 74280, 74292, 74322, 74343, 74370 e 74406; defeito do MODELO): a "mesma chave com outro
    // conteúdo" do anexo punha uma justificativa, que o anexo.adicionar não leva (o hash é dos metadados e do resumo do
    // arquivo), e o sistema, certo, tratava como o mesmo pedido. Fixa os dois desfechos: a justificativa a mais é o mesmo
    // pedido (duplicado, nada gravado); outra descrição é outro conteúdo (IDEMPOTENCY_MISMATCH, nada gravado).
    nome: 'anexo no evento: a mesma chave com um campo que o anexo não leva é o mesmo pedido; com outra descrição, outro conteúdo',
    comandos: [
      passo(0, 'evento.registrar', doacaoNoD),
      passo(1, 'anexo.adicionar', anexoNoEvento('@0.e0')),
      Object.assign(passo(2, 'anexo.adicionar', Object.assign(anexoNoEvento('@0.e0'), { justificativa: 'Outro conteúdo com a mesma chave' })), { chaveDe: 1, reenvio: true }),
      Object.assign(passo(3, 'anexo.adicionar', Object.assign(anexoNoEvento('@0.e0'), { descricao: 'Outro conteúdo com a mesma chave' })), { chaveDe: 1, outraChave: true }),
    ],
    esperado: { 0: 'OK', 1: 'OK', 2: 'OK', 3: 'IDEMPOTENCY_MISMATCH:' },
  },
  {
    // Passada 4 (sementes 82004, 82084 e 83005, encolhidas a 6 comandos; assinatura PERIODO:SEM_AVISO): o desfazer da
    // importação cancelava os lançamentos da compra importada dentro do período financeiro fechado sem o aviso
    // PERIODO_BLOQUEADO nem a justificativa (RN-082), que o estorno e a correção pedem. Fechado pelo aviso da trava, que
    // vale para todo caminho (CONTRATOS, seção 10.5, item 6).
    nome: 'desfazer a importação de uma compra dentro do período financeiro fechado pede o aviso do período e a justificativa, como o estorno',
    opcoes: { ordem: 'alpha', reuso: true, vazio: false },
    comandos: importadaNoPeriodo.concat([
      desfazerImp(5, { aceitar: false }),
      desfazerImp(6, { semJustAviso: true }),
      desfazerImp(7),
    ]),
    // Antes do conserto: o passo 5 era aceito sem pedir nada (o passo 3, o bloco, já pedia o aviso).
    esperado: { 0: 'OK', 1: 'OK', 2: 'OK', 3: 'OK', 4: 'OK', 5: 'NEEDS_CONFIRMATION:PERIODO_BLOQUEADO', 6: 'VALIDATION:CAMPO_OBRIGATORIO', 7: 'OK' },
  },
  {
    // Passada 4: o aviso POSSIVEL_DUPLICIDADE do arquivo enviado de novo não passava pela política de avisos (cada
    // caminho aplicava a sua; a importação não aplicava). A UnitOfWork aplica a política a todo aviso de todo caminho.
    nome: 'o mesmo arquivo de importação enviado de novo segue a política de avisos: IGNORA não pergunta, BLOQUEIA recusa, AVISA pede confirmação',
    comandos: [
      passo(0, 'importacao.criar', criarCompras('compras.csv')),
      passo(1, 'config.salvar', { valores: { avisos_politica: '{"CARENCIA_ATIVA":"BLOQUEIA","POSSIVEL_DUPLICIDADE":"IGNORA"}' } }),
      passo(2, 'importacao.criar', criarCompras('de-novo.csv')),
      passo(3, 'config.salvar', { valores: { avisos_politica: '{"CARENCIA_ATIVA":"BLOQUEIA","POSSIVEL_DUPLICIDADE":"BLOQUEIA"}' } }),
      passo(4, 'importacao.criar', criarCompras('terceira.csv')),
      passo(5, 'config.salvar', { valores: { avisos_politica: '{"CARENCIA_ATIVA":"BLOQUEIA"}' } }),
      Object.assign(passo(6, 'importacao.criar', criarCompras('quarta.csv')), { aceitar: false }),
    ],
    // Antes do conserto: os passos 2 e 4 pediam a confirmação do aviso POSSIVEL_DUPLICIDADE.
    esperado: { 0: 'OK', 1: 'OK', 2: 'OK', 3: 'OK', 4: 'VALIDATION:POSSIVEL_DUPLICIDADE,POSSIVEL_DUPLICIDADE', 5: 'OK', 6: 'NEEDS_CONFIRMATION:POSSIVEL_DUPLICIDADE,POSSIVEL_DUPLICIDADE' },
  },
  {
    // Passada 4 (semente 82085; defeito do MODELO): a compra no período fechado mandada sem a justificativa do aviso
    // (de propósito) é recusada na segunda chamada; a simulação responde pela primeira, que pediu a confirmação.
    nome: 'compra no período financeiro fechado sem a justificativa do aviso: recusa CAMPO_OBRIGATORIO, nada gravado',
    opcoes: { ordem: 'reverse', reuso: false, vazio: false },
    comandos: [
      comAvisos(passo(0, 'config.salvar', { valores: { fin_bloqueio_ate: '2026-08-19' } }), AVISOS),
      Object.assign(passo(1, 'evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-01-01', partner_id: '@f:fornecedor', valor_animais: 498202, pasto_destino_id: '@p:B', modalidade: 'ARROBA', preco_unitario: 30646, base_peso: 'VIVO', rendimento_carcaca_pct: 50, rendimento_tipo: 'NEGOCIADO' }, animais: [{ sexo: 'F', pasto_destino_id: '@p:C', brinco: '74', data_nascimento: '2026-01-01', data_nascimento_confianca: 'ESTIMADA', peso: 487.7 }], parcelas: [{ data_vencimento: '2026-01-31', valor: 166068 }, { data_vencimento: '2026-03-02', valor: 166067 }, { data_vencimento: '2026-04-01', valor: 166067 }], custos: [] }), { simular: true, semJustAviso: true }),
    ],
    esperado: { 0: 'OK', 1: 'VALIDATION:CAMPO_OBRIGATORIO' },
  },
  {
    // Passada 4 (sementes 82101 e 82265; defeito do MODELO): o estorno imediato ia às vezes sem a justificativa do período
    // e o oráculo metamórfico acusava a recusa CAMPO_OBRIGATORIO, que é a certa. Fixa os dois: sem a justificativa,
    // recusado; com ela, o estorno imediato devolve tudo.
    nome: 'estorno logo depois de uma compra no período financeiro fechado: sem a justificativa, recusado; com ela, cada animal volta ao que era',
    comandos: [
      passo(0, 'config.salvar', { valores: { fin_bloqueio_ate: '2026-01-01' } }),
      passo(1, 'evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-01-01', partner_id: '@f:fornecedor', valor_animais: 971311, pasto_destino_id: '@p:B', modalidade: 'ARROBA', preco_unitario: 30827, base_peso: 'VIVO', rendimento_carcaca_pct: 51.3, rendimento_tipo: 'NEGOCIADO' }, animais: [{ sexo: 'F', pasto_destino_id: '@p:A', brinco: '95', data_nascimento: '2020-04-30', data_nascimento_confianca: 'ESTIMADA', brinco_origem: 'V13', peso: 227.5 }, { sexo: 'F', pasto_destino_id: '@p:C', brinco: '64', peso: 231.5 }, { sexo: 'F', pasto_destino_id: '@p:B', brinco: '10', data_nascimento: '2022-10-01', data_nascimento_confianca: 'ESTIMADA', situacao_reprodutiva: 'PRENHA', data_prevista_parto: '2026-01-27', outras_identificacoes: [{ tipo: 'RFID', codigo: '9820000318' }], peso: 462.3 }], parcelas: [{ data_vencimento: '2026-01-31' }, { data_vencimento: '2026-03-02' }], custos: [{ tipo: 'FRETE', valor: 12345, partner_id: '@f:transportador' }] }),
      Object.assign(comAvisos(passo(2, 'evento.estornar', { event_id: '@1.e0', justificativa: 'Lançado errado' }), AVISOS), { semJustAviso: true }),
      Object.assign(comAvisos(passo(3, 'evento.estornar', { event_id: '@1.e0', justificativa: 'Lançado errado' }), AVISOS), { estornoImediato: true }),
    ],
    esperado: { 0: 'OK', 1: 'OK', 2: 'VALIDATION:CAMPO_OBRIGATORIO', 3: 'OK' },
  },
  {
    // Passada 4 (semente 84252; defeito do MODELO): o comando pede a confirmação dos avisos antes da trava; a simulação,
    // que não confirma nada, vai até o fim e dá a recusa que o comando daria depois de confirmado (o animal voltaria ao
    // Pasto D desativado). Sem o pedido de volta, as duas respostas são compatíveis.
    nome: 'estorno no período fechado de uma morte cujo animal voltaria a um pasto desativado: o comando pede a confirmação do período; a simulação já mostra a recusa da trava',
    opcoes: { ordem: 'reverse', reuso: false, vazio: false },
    comandos: [
      {"k":70,"rota":"config.salvar","dados":{"valores":{"fin_bloqueio_ate":"2026-08-17"}},"avisos":[],"aceitar":true},
      {"k":80,"rota":"evento.corrigir","dados":{"tipo":"ENTRADA_INICIAL","campos":{"event_date":"2026-01-01"},"animais":[{"sexo":"F","pasto_destino_id":"@p:A","origem":"DESCONHECIDA","brinco":"1","animal_id":"@b:1","data_nascimento":"2019-03-10","data_nascimento_confianca":"ESTIMADA","data_entrada":"2019-05-01","data_entrada_confianca":"ESTIMADA","partos_previos":2},{"sexo":"F","pasto_destino_id":"@p:A","origem":"DESCONHECIDA","brinco":"2","animal_id":"@b:2","data_nascimento":"2020-07-01","data_nascimento_confianca":"ESTIMADA"},{"sexo":"F","pasto_destino_id":"@p:B","origem":"DESCONHECIDA","brinco":"3","animal_id":"@b:3","data_nascimento":"2021-02-15","data_nascimento_confianca":"ESTIMADA"},{"sexo":"M","pasto_destino_id":"@p:B","origem":"DESCONHECIDA","brinco":"4","animal_id":"@b:4","data_nascimento":"2018-01-01","data_nascimento_confianca":"ESTIMADA","castrado":false,"reprodutor":true},{"sexo":"F","pasto_destino_id":"@p:B","origem":"DESCONHECIDA","brinco":"5","animal_id":"@b:5","data_nascimento":"2024-08-01","data_nascimento_confianca":"ESTIMADA","mae_id":"@b:1","mae_confianca":"CONFIRMADA"},{"sexo":"M","pasto_destino_id":"@p:C","origem":"DESCONHECIDA","brinco":"6","animal_id":"@b:6","data_nascimento":"2024-02-01","data_nascimento_confianca":"ESTIMADA","castrado":true,"reprodutor":false},{"sexo":"M","pasto_destino_id":"@p:C","origem":"DESCONHECIDA","brinco":"7","animal_id":"@b:7","data_nascimento":"2024-03-01","data_nascimento_confianca":"ESTIMADA","castrado":true,"reprodutor":false},{"sexo":"M","pasto_destino_id":"@p:A","origem":"DESCONHECIDA","brinco":"8","animal_id":"@b:8","data_nascimento":"2026-01-01","data_nascimento_confianca":"ESTIMADA","castrado":false,"reprodutor":false,"mae_id":"@b:2","mae_confianca":"CONFIRMADA","pai_id":"@b:4","pai_confianca":"ESTIMADA"},{"sexo":"F","pasto_destino_id":"@p:C","origem":"DESCONHECIDA","brinco":"12","data_nascimento":"2020-02-18","data_nascimento_confianca":"ESTIMADA","situacao_reprodutiva":"PRENHA","data_prevista_parto":"2026-07-22"}],"event_id":"00000000-0000-4000-8000-0000000000b6","justificativa":"Corrigindo o lançamento"},"avisos":[],"aceitar":true},
      {"k":88,"rota":"evento.registrar","dados":{"tipo":"AJUSTE_INVENTARIO","subtipo":"CORRECAO_LOCALIZACAO","campos":{"event_date":"2026-01-01","justificativa":"Achado em outro pasto"},"animais":[{"animal_id":"@80.a0","pasto_destino_id":"@p:D"}]},"avisos":[],"aceitar":true},
      {"k":93,"rota":"evento.registrar","dados":{"tipo":"MORTE","campos":{"event_date":"2026-07-04","causa":"PICADA_COBRA"},"animais":[{"animal_id":"@b:4"},{"animal_id":"@80.a0"}]},"avisos":AVISOS,"aceitar":true,"simular":true},
      {"k":94,"rota":"evento.corrigir","dados":{"tipo":"MORTE","campos":{"event_date":"2026-07-04","causa":"PICADA_COBRA","custo_valor":1,"custo_conta_id":"@conta"},"animais":[{"animal_id":"@b:4"},{"animal_id":"@80.a0"}],"event_id":"@93.e0","justificativa":"Corrigindo o lançamento"},"avisos":AVISOS,"aceitar":true},
      {"k":104,"rota":"evento.corrigir","dados":{"tipo":"MORTE","campos":{"event_date":"2026-07-04","causa":"PICADA_COBRA","custo_valor":1,"custo_conta_id":"@conta"},"animais":[{"animal_id":"@b:4"},{"animal_id":"@80.a0"}],"event_id":"@94.e0","justificativa":"Corrigindo o lançamento"},"avisos":AVISOS,"aceitar":true,"simular":true},
      {"k":107,"rota":"pasto.salvar","dados":{"pasture_id":"@p:D","campos":{"status":"INATIVO"},"justificativa":"Pasto em reforma"},"avisos":[],"aceitar":true},
      {"k":129,"rota":"evento.estornar","dados":{"event_id":"@104.e0","justificativa":"Lançado errado"},"avisos":[],"aceitar":false,"simular":true},
    ],
    esperado: { 70: 'OK', 80: 'OK', 88: 'OK', 93: 'OK', 94: 'OK', 104: 'OK', 107: 'OK', 129: 'NEEDS_CONFIRMATION:PERIODO_BLOQUEADO' },
  },
];

CASOS.forEach((caso) => {
  test('regressão do teste aleatório: ' + caso.nome, () => {
    const fora = {};
    const falha = F.reproduzir(caso.opcoes || BASE, caso.comandos, fora);
    assert.equal(falha, null, falha ? 'passo ' + falha.k + ' [' + falha.assinatura + ']: ' + falha.mensagem : '');
    assert.deepEqual(fora.resultados, caso.esperado);
  });
});
