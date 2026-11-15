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
];

CASOS.forEach((caso) => {
  test('regressão do teste aleatório: ' + caso.nome, () => {
    const fora = {};
    const falha = F.reproduzir(caso.opcoes || BASE, caso.comandos, fora);
    assert.equal(falha, null, falha ? 'passo ' + falha.k + ' [' + falha.assinatura + ']: ' + falha.mensagem : '');
    assert.deepEqual(fora.resultados, caso.esperado);
  });
});
