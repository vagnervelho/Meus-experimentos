'use strict';
/**
 * Sequências mínimas achadas pelo teste aleatório das Fases 1 a 3 (tests/fase2.fuzz.test.js com o gerador ampliado da
 * Fase 3: o curral e o tronco em blocos, as interações da Fase 3 com a Fase 2, o estoque ligado e desligado, os
 * protocolos), fixadas depois do conserto. Cada caso roda pela api() num sistema novo, com o MESMO oráculo do teste
 * aleatório depois de cada passo (integridade, projeção = reconstrução, financeiro, replay independente, efeito pedido,
 * avisos de transição, agenda e indicadores; recusa sem gravar nada) e confere o desfecho de cada passo. Os
 * identificadores vão por símbolo (tests/apoio-fuzz.js): "@b:8" é o animal de brinco 8 do rebanho de base, "@k.eN" o
 * evento que o passo k criou; o rebanho de base é citado cru (os identificadores dele não mudam).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./apoio-fuzz');

const AVISOS = F.AVISOS;
const passo = (k, rota, dados, extra) => Object.assign({ k, rota, dados, avisos: AVISOS, aceitar: true }, extra || {});
/** O rebanho de base (montagem do teste aleatório), como a correção "pelas linhas" o remonta. */
const ENTRADA_BASE = '00000000-0000-4000-8000-0000000000b7';
const animalBase = (brinco, sexo, pasto, nasc, extra) => Object.assign({ sexo, pasto_destino_id: pasto, origem: 'DESCONHECIDA', brinco, animal_id: '@b:' + brinco, data_nascimento: nasc, data_nascimento_confianca: 'ESTIMADA' }, extra || {});
const rebanhoComOitoCastrado = [
  animalBase('1', 'F', '@p:A', '2019-03-10', { data_entrada: '2019-05-01', data_entrada_confianca: 'ESTIMADA', partos_previos: 2 }),
  animalBase('2', 'F', '@p:A', '2020-07-01'),
  animalBase('3', 'F', '@p:B', '2021-02-15'),
  animalBase('4', 'M', '@p:B', '2018-01-01', { castrado: false, reprodutor: true }),
  animalBase('5', 'F', '@p:B', '2024-08-01', { mae_id: '@b:1', mae_confianca: 'CONFIRMADA' }),
  animalBase('6', 'M', '@p:C', '2024-02-01', { castrado: true, reprodutor: false }),
  animalBase('7', 'M', '@p:C', '2024-03-01', { castrado: true, reprodutor: false }),
  animalBase('8', 'M', '@p:A', '2025-10-20', { castrado: true, reprodutor: false, mae_id: '@b:2', mae_confianca: 'CONFIRMADA', pai_id: '@b:6', pai_confianca: 'ESTIMADA' }),
];

const CASOS = [
  {
    // Semente 7106, no modelo do teste (assinatura SIMULACAO): no período financeiro fechado, a correção do rebanho de base
    // que declara castrado o macho já castrado por uma castração lançada vai, sem a justificativa do aviso, até a recusa
    // CAMPO_OBRIGATORIO depois da confirmação; a simulação, que não confirma nada, vai até a trava (CONFLICT, castração
    // repetida). As duas respostas são compatíveis: o desfecho depois da confirmação não é visto pelo pedido sem
    // justificativa (o oráculo da simulação passou a aceitar, como já aceitava sem o pedido de volta).
    nome: 'correção no período fechado sem a justificativa do aviso: a simulação chega à trava, o comando para na justificativa',
    comandos: [
      passo(27, 'config.salvar', { valores: { fin_bloqueio_ate: '2026-11-13' } }),
      passo(47, 'evento.registrar', { tipo: 'CASTRACAO', campos: { event_date: '2026-01-01' }, animais: [{ animal_id: '@b:8' }] }),
      passo(72, 'evento.corrigir', { tipo: 'ENTRADA_INICIAL', campos: { event_date: '2026-01-01' }, animais: rebanhoComOitoCastrado, event_id: ENTRADA_BASE, justificativa: 'Corrigindo o lançamento' }, { avisos: [], simular: true, semJustAviso: true }),
    ],
    esperado: { 27: 'OK', 47: 'OK', 72: 'VALIDATION:CAMPO_OBRIGATORIO' },
  },
  {
    // Passada 2, semente 1320022, no modelo do teste (assinatura CORRECAO_TARDIA:RECUSADA): o acerto de estoque pela contagem,
    // corrigido, e o controle de estoque do produto desligado depois; a correção sem mudança do acerto, mais tarde, é
    // recusada com PRODUTO_SEM_ESTOQUE. É o desenho (o acerto só existe com o saldo controlado; o estorno continua livre):
    // o oráculo da correção tardia passou a aceitar essa recusa.
    nome: 'acerto de estoque corrigido sem mudança depois de o controle do produto ser desligado: recusado por desenho (PRODUTO_SEM_ESTOQUE)',
    comandos: [
      passo(0, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'AJUSTE', campos: { event_date: '2026-02-20', product_id: '@v:antibiotico', motivo_ajuste: 'CONTAGEM', saldo_contado: 10 }, animais: [] }, { avisos: [] }),
      passo(10, 'evento.corrigir', { tipo: 'ESTOQUE', subtipo: 'AJUSTE', campos: { event_date: '2026-02-20', product_id: '@v:antibiotico', motivo_ajuste: 'CONTAGEM', saldo_contado: 100 }, animais: [], event_id: '@0.e0', justificativa: 'Corrigindo o lançamento' }),
      passo(41, 'produto.salvar', { product_id: '@v:antibiotico', campos: { controla_estoque: false }, justificativa: 'Controle de estoque revisto' }),
      passo(44, 'evento.corrigir', { tipo: 'ESTOQUE', subtipo: 'AJUSTE', campos: { event_date: '2026-02-20', product_id: '@v:antibiotico', motivo_ajuste: 'CONTAGEM', saldo_contado: 100 }, animais: [], event_id: '@10.e0', justificativa: 'Conferido de novo' }, { correcaoTardia: true }),
    ],
    esperado: { 0: 'OK', 10: 'OK', 41: 'OK', 44: 'VALIDATION:PRODUTO_SEM_ESTOQUE' },
  },
  {
    // Passada 2, semente 1210049, no modelo do teste (assinatura CORRECAO_TARDIA:RECUSADA): a "mesma chave com outro
    // conteúdo" copia o comando anterior, inclusive a marca da correção tardia; a recusa IDEMPOTENCY_MISMATCH é a que o
    // reenvio com outro conteúdo deve ter, e o oráculo da correção tardia passou a ignorar o reenvio e a outra chave.
    nome: 'pesagem corrigida sem mudança, mais tarde, e a mesma chave com outro conteúdo: IDEMPOTENCY_MISMATCH, nada gravado',
    comandos: [
      passo(44, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-04-16', tipo_pesagem: 'DESMAMA', metodo_pesagem: 'ESTIMATIVA_VISUAL', jejum: true }, animais: [{ animal_id: '@b:4', peso: 376.2 }, { animal_id: '@b:2', peso: 315.4 }, { animal_id: '@b:8', peso: 279.9 }] }),
      passo(77, 'evento.corrigir', { tipo: 'PESAGEM', campos: { event_date: '2026-04-16', tipo_pesagem: 'DESMAMA', metodo_pesagem: 'ESTIMATIVA_VISUAL', jejum: true }, animais: [{ animal_id: '@b:4', peso: 376.2 }, { animal_id: '@b:2', peso: 315.4 }, { animal_id: '@b:8', peso: 279.9 }], event_id: '@44.e0', justificativa: 'Conferido de novo' }, { correcaoTardia: true }),
      passo(78, 'evento.corrigir', { tipo: 'PESAGEM', campos: { event_date: '2026-04-16', tipo_pesagem: 'DESMAMA', metodo_pesagem: 'ESTIMATIVA_VISUAL', jejum: true, notes: 'Outro conteúdo com a mesma chave' }, animais: [{ animal_id: '@b:4', peso: 376.2 }, { animal_id: '@b:2', peso: 315.4 }, { animal_id: '@b:8', peso: 279.9 }], event_id: '@44.e0', justificativa: 'Conferido de novo' }, { correcaoTardia: true, chaveDe: 77, outraChave: true }),
    ],
    esperado: { 44: 'OK', 77: 'OK', 78: 'IDEMPOTENCY_MISMATCH:' },
  },
];

CASOS.forEach((caso) => {
  test('regressão do teste aleatório das Fases 1 a 3: ' + caso.nome, () => {
    const fora = {};
    const falha = F.reproduzir(caso.opcoes || { ordem: 'alpha', reuso: true, vazio: false }, caso.comandos, fora);
    assert.equal(falha, null, falha ? 'passo ' + falha.k + ' [' + falha.assinatura + ']: ' + falha.mensagem : '');
    assert.deepEqual(fora.resultados, caso.esperado);
  });
});
