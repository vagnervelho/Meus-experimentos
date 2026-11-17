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
 * zero; desde a passada 2, também desativar e reativar pasto, parceiro e categoria no meio, corrigir o evento importado
 * (montado pelas linhas gravadas), corrigir para outro tipo, a mesma chave com outro conteúdo e a versão velha em qualquer
 * comando; desde a passada 3, também criar e editar no meio pasto, parceiro, categoria, item de lista e touro de
 * referência (e usá-los depois), corrigir a entrada gravada (o rebanho de base e a importada), reenviar um comando antigo e
 * mudar o tamanho do lote da importação. Datas e animais provocam as combinações raras (mesmo dia, véspera do nascimento, depois da morte, número de
 * brinco reaproveitado).
 *
 * Oráculo depois de CADA passo: aceito → verificação de integridade sem ERRO, projeção = reconstrução, invariantes do
 * financeiro (do sistema e reescritas sobre as linhas cruas), replay independente da linha do tempo e o efeito que o
 * pedido manda; recusado → nada mudou (data_version e linhas), código e mensagem em português, chave livre.
 *
 * Fuzz das Fases 1 a 3, passada 1: o gerador também manda o curral e o tronco em blocos com a chave própria (o bloco sem
 * sinal, a resposta perdida e o reenvio, a conferência da chave), as interações da Fase 3 com a Fase 2 (venda na carência,
 * aplicação retroativa sobre a venda, também pela importação; pesagem, aplicação e diagnóstico de quem saiu; saída levada
 * para antes do fato; parto da prenhe, parto corrigido depois do diagnóstico, aborto; estorno da compra de insumo já
 * consumido; desmama das crias; castração do touro; dose por kg; reprodução na estação), o controle de estoque ligado e
 * desligado e os protocolos novos; os oráculos novos conferem a dose por kg, os avisos de estoque e de carência pela
 * transição, a agenda sanitária e o GMD por modelos independentes, e os indicadores reprodutivos (tests/apoio-fuzz.js).
 * Passada 2: o preparo do que falta a cada interação e nove interações novas (venda e aplicação corrigidas para a
 * carência, consumo acima do estoque, acerto retroativo, parto da não prenhe, mãe em volta do parto, cria ao pé e desmama
 * com a venda, pesagem fora da permanência, importação de quem saiu, estação mudada), o produto novo, os parâmetros da
 * Fase 3 e o relógio do pedido; os oráculos novos conferem a campanha na agenda, a cria ao pé e a correção sem mudança de
 * um lançamento de manejo muito depois do registro.
 *
 * Em falha, o teste imprime a semente e a sequência mínima (encolhida automaticamente), pronta para virar um caso de
 * tests/fase2.fuzz.regressoes.test.js (ou de tests/fase3.fuzz.regressoes.test.js).
 *
 * npm test roda as sementes fixas. FUZZ_SEMENTES=N roda N sementes novas a partir de FUZZ_INICIO (padrão: o relógio);
 * FUZZ_PASSOS muda os passos por semente (padrão 60); FUZZ_SAIDA=<pasta> grava cada falha encolhida em JSON;
 * FUZZ_ENCOLHER=0 não encolhe (só a semente e a sequência inteira); FUZZ_COBERTURA=1 imprime quanto cada oráculo e cada
 * interação conferiu (F.COBERTURA), para relatar a leva.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('./apoio-fuzz');
const { createGas } = require('./harness');

// A semente 57 entrou com a pesagem (Fase 3, E3.1): com o tipo novo no sorteio, nenhuma das 16 anteriores chegava a aceitar
// uma primeira identificação, e o teste exige todo tipo e subtipo ativo aceito ao menos uma vez nas sementes fixas.
// As sementes 8 e 1 entraram com a reprodução, a desmama, a castração e a ocorrência (Fase 3, E3.4 e E3.5): com os tipos
// novos no sorteio, nenhuma das anteriores chegava a aceitar uma exposição ao touro nem um diagnóstico de doença.
// As sementes 31 e 56 entraram com os importadores de manejo (Fase 3, E3.6): com os quatro tipos novos no sorteio da
// importação, nenhuma das anteriores chegava a aceitar uma medicação nem uma primeira identificação (a 31 também importa
// e conclui um arquivo de ocorrências).
// A semente 262 entrou com o fuzz das Fases 1 a 3 (passada 1): com o gerador ampliado, nenhuma das anteriores chegava a
// uma venda que entrasse na carência de uma aplicação (o oráculo da transição da carência).
// Rodada 3 da revisão da Fase 3: com as interações novas do gerador, a 29 entra para a correção tardia com o cadastro mudado.
const FIXAS = [20261115, 11, 47, 101, 2718, 3001, 3107, 3213, 3318, 9001, 9055, 1009, 1111, 1234, 4242, 777, 57, 8, 1, 31, 56, 262, 29];
const PASSOS = Number(process.env.FUZZ_PASSOS || 60);
const N = Number(process.env.FUZZ_SEMENTES || 0);
const INICIO = process.env.FUZZ_INICIO !== undefined ? Number(process.env.FUZZ_INICIO) : Date.now() % 1000000000;
const SEMENTES = N ? Array.from({ length: N }, (_, i) => INICIO + i) : FIXAS;

function somar(total, stats, eventos) {
  Object.keys(stats.porEvento).forEach((k) => { eventos[k] = (eventos[k] || 0) + stats.porEvento[k]; });
  Object.keys(stats.porRotulo).forEach((k) => {
    const x = (total[k] = total[k] || { ok: 0, recusa: 0 });
    x.ok += stats.porRotulo[k].ok;
    x.recusa += Object.values(stats.porRotulo[k].recusa).reduce((a, b) => a + b, 0);
  });
}

test('teste aleatório de todos os comandos da Fase 2 (' + (N ? N + ' sementes novas a partir de ' + INICIO : 'sementes fixas') + ', ' + PASSOS + ' passos): depois de cada comando, integridade sem erro, projeção = reconstrução, financeiro fechado, replay independente e o efeito pedido; recusa sem gravar nada, com código e mensagem em português', () => {
  const falhas = [];
  const total = {};
  const eventos = {};
  let aceitos = 0;
  let recusados = 0;
  SEMENTES.forEach((semente) => {
    const r = F.rodar(semente, PASSOS);
    somar(total, r.stats, eventos);
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
  if (process.env.FUZZ_COBERTURA === '1') console.log('FUZZ-COBERTURA: ' + JSON.stringify(F.COBERTURA));
  assert.deepEqual(falhas, [], 'falhas do teste aleatório (sequência mínima acima)');
  if (!N) {
    // As sementes fixas exercitam cada tipo aceito, a correção, o estorno e a importação de ponta a ponta.
    ['ENTRADA_INICIAL', 'COMPRA', 'VENDA', 'TRANSFERENCIA', 'NASCIMENTO', 'IDENTIFICACAO', 'MARCACAO', 'RECLASSIFICACAO', 'CORRECAO_LOCALIZACAO', 'concluir', 'reuso'].forEach((t) => {
      assert.ok(total[t] && total[t].ok > 0, t + ' aceito ao menos uma vez: ' + JSON.stringify(total[t]));
    });
    const corrigidos = Object.keys(total).filter((k) => k.indexOf('corrigir ') === 0).reduce((s, k) => s + total[k].ok, 0);
    const estornados = Object.keys(total).filter((k) => k.indexOf('estornar ') === 0).reduce((s, k) => s + total[k].ok, 0);
    assert.ok(corrigidos >= 10 && estornados >= 10 && recusados >= 50, JSON.stringify({ corrigidos, estornados, recusados }));
    // Todo tipo e subtipo ativo do catálogo foi registrado (ou corrigido) e aceito ao menos uma vez nas sementes fixas: o
    // tipo que fica ativo sem a sua entrada no registro do teste aleatório (gerador e oráculo do efeito) falha aqui.
    const G = createGas({ order: 'alpha' }).G;
    const faltam = [];
    G.EventCatalog.serializar().tipos.filter((t) => t.tipo !== 'ESTORNO').forEach((t) => {
      const subs = Object.keys(t.subtipos || {});
      const chaves = !subs.length ? [t.tipo] : t.tipo === 'AJUSTE_INVENTARIO' ? subs : subs.map((s) => t.tipo + '/' + s);
      chaves.forEach((k) => { if (!eventos[k]) faltam.push(k); });
    });
    assert.deepEqual(faltam, [], 'tipos ativos sem registro aceito no teste aleatório (porEvento: ' + JSON.stringify(eventos) + ')');
    // Fuzz das Fases 1 a 3: cada oráculo novo conferiu algo de verdade nas sementes fixas (o reenvio do bloco gravado, a
    // conferência da chave gravada e da não enviada, a transição do estoque e da carência, a agenda, a dose por kg, o GMD
    // e os indicadores da estação).
    // Passada 2: também a campanha da agenda, a cria ao pé e a correção sem mudança mais tarde (aceita, e com o cadastro
    // que ela usa mudado depois).
    const semCobertura = ['bloco reenviado depois de gravado', 'chave conferida CONFIRMADA', 'chave conferida INEXISTENTE', 'estoque abaixo de zero pelo comando', 'venda que entrou na carência', 'pendências da agenda conferidas', 'carências da agenda conferidas', 'dose por kg conferida', 'intervalos de GMD conferidos', 'estação com indicadores conferidos',
      'campanha da agenda conferida', 'cria ao pé conferida', 'correção tardia aceita', 'correção tardia com o cadastro mudado',
      // Rodada 3 da revisão da Fase 3: a ficha igual à agenda, os partos da lista iguais aos da ficha, o último peso na data.
      'ficha × agenda conferida', 'partos da lista × ficha conferidos', 'último peso na data conferido', 'GMD da resposta conferido',
      // Conserto pela garantia, etapa 1 (CONTRATOS, seção 46): o oráculo de viagem no tempo tirou retratos, comparou depois de
      // fato posterior a D (também estorno e correção), de cadastro e de fato retroativo noutros animais, com o relógio
      // adiantado e pelo caminho padrão, e cruzou a ficha com as consultas da data; o retrato de hoje = a projeção.
      'viagem no tempo: retratos', 'viagem no tempo: unidades com o relógio adiantado', 'viagem no tempo: caminho padrão conferido',
      'viagem no tempo: unidades comparadas', 'viagem no tempo: comparação depois de fato posterior a D', 'viagem no tempo: comparação depois de cadastro',
      'viagem no tempo: comparação depois de fato retroativo noutros animais', 'viagem no tempo: comparação depois de estorno ou correção posterior a D',
      'viagem no tempo: retratos de hoje conferidos com a projeção', 'viagem no tempo: ficha de hoje × consultas da data',
      'viagem no tempo: ficha de quem saiu × elegíveis do dia da saída'].filter((k) => !F.COBERTURA[k]);
    assert.deepEqual(semCobertura, [], 'oráculos novos sem nada conferido nas sementes fixas (' + JSON.stringify(F.COBERTURA) + ')');
  }
});

test('registro do teste aleatório: todo tipo ativo do catálogo tem a sua entrada (gerador e oráculo do efeito), e todo tipo importável tem o seu arquivo', () => {
  const G = createGas({ order: 'alpha' }).G;
  const ativos = [];
  G.EventCatalog.serializar().tipos.filter((t) => t.tipo !== 'ESTORNO').forEach((t) => {
    if (t.tipo === 'AJUSTE_INVENTARIO') Object.keys(t.subtipos || {}).forEach((s) => ativos.push(s));
    else ativos.push(t.tipo);
  });
  assert.deepEqual(ativos.filter((k) => !F.TIPOS.has(k)), [], 'tipos ativos sem entrada no registro');
  // E nada a mais: a entrada de um tipo inativo seria recusada sempre (o gerador não conferiria o efeito dele).
  const chave = (k) => (G.EventCatalog.existe(k) ? G.EventCatalog.ativo(k) : G.EventCatalog.ativo('AJUSTE_INVENTARIO', k));
  assert.deepEqual(Array.from(F.TIPOS.keys()).filter((k) => !chave(k)), [], 'entradas de tipo inativo no registro');
  for (const [nome, T] of F.TIPOS) for (const k of ['peso', 'propor', 'montar', 'animais', 'efeito']) assert.equal(typeof T[k], 'function', nome + '.' + k);
  const importaveis = JSON.parse(JSON.stringify(G.ImportService.modelo().tipos));
  assert.deepEqual(importaveis.slice().sort(), Array.from(F.IMPORTADORES.keys()).sort(), 'tipos importáveis × registro das importações');
  assert.throws(() => F.registrarTipo('COMPRA', F.TIPOS.get('COMPRA')), /duas vezes/);
  assert.throws(() => F.registrarTipo('PESAGEM', { peso: () => 1 }), /sem propor/);
});
