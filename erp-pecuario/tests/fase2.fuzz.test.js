'use strict';
/**
 * Teste aleatório de TODOS os comandos da Fase 2, baseado em modelo (o motor está em tests/apoio-fuzz.js).
 *
 * A cada passo, o gerador escolhe, pela api() (como a tela chama), um comando válido ou inválido entre os da Fase 2:
 * registrar os 10 tipos ativos e os subtipos (retroativo, mesmo dia, gêmeos, natimorto, volta ao rebanho, compra e
 * venda por cabeça, kg vivo, arroba de carcaça e valor de cada animal, frete, outros custos, parcelas, deduções
 * retidas), corrigir (também o substituto de um substituto e a correção que tira ou põe animal), estornar (também a
 * correção e o evento com dependentes), corrigir o cadastro do animal (mãe, pai, sexo, nascimento, chegada), mudar a
 * categoria, identificar com o reuso de brinco ligado e desligado (o parâmetro muda no meio), importar os 5 tipos de
 * evento e ANIMAIS (validar, importar, concluir, desfazer; também uma desfeita enquanto outra está em curso) e o marco
 * zero. Datas e animais provocam as combinações raras (mesmo dia, véspera do nascimento, depois da morte, número de
 * brinco reaproveitado).
 *
 * Oráculo depois de CADA passo: aceito → verificação de integridade sem ERRO, projeção = reconstrução, invariantes do
 * financeiro (do sistema e reescritas sobre as linhas cruas), replay independente da linha do tempo e o efeito que o
 * pedido manda; recusado → nada mudou (data_version e linhas), código e mensagem em português, chave livre.
 *
 * Em falha, o teste imprime a semente e a sequência mínima (encolhida automaticamente), pronta para virar um caso de
 * tests/fase2.fuzz.regressoes.test.js.
 *
 * npm test roda as sementes fixas. FUZZ_SEMENTES=N roda N sementes novas a partir de FUZZ_INICIO (padrão: o relógio);
 * FUZZ_PASSOS muda os passos por semente (padrão 60); FUZZ_SAIDA=<pasta> grava cada falha encolhida em JSON;
 * FUZZ_ENCOLHER=0 não encolhe (só a semente e a sequência inteira).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('./apoio-fuzz');

const FIXAS = [20261115, 11, 47, 101, 2718];
const PASSOS = Number(process.env.FUZZ_PASSOS || 60);
const N = Number(process.env.FUZZ_SEMENTES || 0);
const INICIO = process.env.FUZZ_INICIO !== undefined ? Number(process.env.FUZZ_INICIO) : Date.now() % 1000000000;
const SEMENTES = N ? Array.from({ length: N }, (_, i) => INICIO + i) : FIXAS;

function somar(total, stats) {
  Object.keys(stats.porRotulo).forEach((k) => {
    const x = (total[k] = total[k] || { ok: 0, recusa: 0 });
    x.ok += stats.porRotulo[k].ok;
    x.recusa += Object.values(stats.porRotulo[k].recusa).reduce((a, b) => a + b, 0);
  });
}

test('teste aleatório de todos os comandos da Fase 2 (' + (N ? N + ' sementes novas a partir de ' + INICIO : 'sementes fixas') + ', ' + PASSOS + ' passos): depois de cada comando, integridade sem erro, projeção = reconstrução, financeiro fechado, replay independente e o efeito pedido; recusa sem gravar nada, com código e mensagem em português', () => {
  const falhas = [];
  const total = {};
  let aceitos = 0;
  let recusados = 0;
  SEMENTES.forEach((semente) => {
    const r = F.rodar(semente, PASSOS);
    somar(total, r.stats);
    aceitos += r.stats.aceitos;
    recusados += r.stats.recusados;
    if (!r.falha) return;
    const minimo = process.env.FUZZ_ENCOLHER === '0' ? { comandos: r.comandos } : F.encolher(r.opcoes, r.comandos, r.falha.assinatura);
    const texto = F.relatorio(r, minimo.comandos);
    console.log(texto);
    if (process.env.FUZZ_SAIDA) {
      fs.mkdirSync(process.env.FUZZ_SAIDA, { recursive: true });
      fs.writeFileSync(path.join(process.env.FUZZ_SAIDA, 'falha-' + semente + '.json'), JSON.stringify({ semente, opcoes: r.opcoes, k: r.k, assinatura: r.falha.assinatura, mensagem: r.falha.mensagem, comandos: minimo.comandos, completa: r.comandos }, null, 1));
    }
    falhas.push('semente ' + semente + ' [' + r.falha.assinatura + '] ' + r.falha.mensagem.slice(0, 300));
  });
  console.log('FUZZ: ' + SEMENTES.length + ' sementes × ' + PASSOS + ' passos: ' + aceitos + ' aceitos, ' + recusados + ' recusados, ' + falhas.length + ' falhas');
  assert.deepEqual(falhas, [], 'falhas do teste aleatório (sequência mínima acima)');
  if (!N) {
    // As sementes fixas exercitam cada tipo aceito, a correção, o estorno e a importação de ponta a ponta.
    ['ENTRADA_INICIAL', 'COMPRA', 'VENDA', 'TRANSFERENCIA', 'NASCIMENTO', 'IDENTIFICACAO', 'MARCACAO', 'RECLASSIFICACAO', 'CORRECAO_LOCALIZACAO', 'concluir', 'reuso'].forEach((t) => {
      assert.ok(total[t] && total[t].ok > 0, t + ' aceito ao menos uma vez: ' + JSON.stringify(total[t]));
    });
    const corrigidos = Object.keys(total).filter((k) => k.indexOf('corrigir ') === 0).reduce((s, k) => s + total[k].ok, 0);
    const estornados = Object.keys(total).filter((k) => k.indexOf('estornar ') === 0).reduce((s, k) => s + total[k].ok, 0);
    assert.ok(corrigidos >= 10 && estornados >= 10 && recusados >= 50, JSON.stringify({ corrigidos, estornados, recusados }));
  }
});
