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
];

CASOS.forEach((caso) => {
  test('regressão do teste aleatório: ' + caso.nome, () => {
    const fora = {};
    const falha = F.reproduzir(caso.opcoes || BASE, caso.comandos, fora);
    assert.equal(falha, null, falha ? 'passo ' + falha.k + ' [' + falha.assinatura + ']: ' + falha.mensagem : '');
    assert.deepEqual(fora.resultados, caso.esperado);
  });
});
