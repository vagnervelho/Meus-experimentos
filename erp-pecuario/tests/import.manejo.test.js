'use strict';
/**
 * Importadores de manejo (Fase 3, E3.6; §14; 04, seções 6 e 8; 05, RN-088 a RN-095; 06, seção 5.3; 09, CT-12): PESAGENS,
 * SANIDADE, REPRODUCAO e OCORRENCIAS. O mesmo assistente e os mesmos passos dos eventos da Fase 2: cada lançamento passa
 * pelo planejamento do formulário (o tratador único do tipo) num ensaio em memória, com a trava de integridade no ensaio e
 * na conclusão; o animal é achado pelo brinco em uso NA DATA do lançamento; o registro anterior ao marco zero vira
 * histórico (efeito 0; na sanidade, sem baixa de estoque nem consumo); a linha repetida e o fato já registrado ficam
 * DUPLICADA; o desfazer faz as conferências do estorno. Depois de cada comando, projeção = reconstrução.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, D0, PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave, avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + String(JSON.stringify(r.error)).slice(0, 1500));
  return r.data;
}
/** Rebanho do marco zero: bois, vacas, um touro e um animal sem brinco; ids por brinco (o sem brinco em `semBrinco`). */
function preparar(config) {
  const s = S.sistema({ config: Object.assign({ importacao_lote_linhas: '2' }, config || {}) });
  const bichos = [
    S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2024-03-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '101', sexo: 'M', castrado: true, data_nascimento: '2024-04-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '102', sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA', pasto_destino_id: PASTOS.B }),
    S.bicho({ brinco: '300', sexo: 'F', data_nascimento: '2020-01-10', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '301', sexo: 'F', data_nascimento: '2019-06-10', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '302', sexo: 'F', data_nascimento: '2021-02-10', data_nascimento_confianca: 'CONFIRMADA', situacao_reprodutiva: 'VAZIA' }),
    S.bicho({ brinco: '900', sexo: 'M', reprodutor: true, data_nascimento: '2018-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ sexo: 'F', data_nascimento: '2022-01-01', data_nascimento_confianca: 'ESTIMADA', nome: 'Mansinha' }),
  ];
  const r = s.evento('registrar', S.entradaInicial(bichos), 'ev-base');
  s.ids = {};
  r.dados.animais.forEach((a) => { if (a.brinco) s.ids[a.brinco] = a.animal_id; else s.semBrinco = a.animal_id; });
  s.conferirProjecoes('rebanho inicial');
  return s;
}
function criar(s, tipo, csv, chave) {
  return s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: chave || 'criar-' + tipo, dados: { tipo, arquivo_nome: tipo.toLowerCase() + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
}
function validarTudo(s, id, mapa) {
  let estado;
  for (let b = 1; b < 100; b++) {
    estado = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + id + '-' + b + '-' + JSON.stringify(mapa).length, dados: { import_id: id, bloco: b, mapeamento: mapa } })).dados;
    s.conferirProjecoes('validação ' + b);
    if (estado.importacao.status === 'VALIDADO') return estado;
  }
  throw new Error('validação não terminou');
}
function linhas(s, id, status) {
  return s.read(s.G.ImportService.consultaLinhas({ import_id: id, status, por_pagina: 500 })).itens;
}
function importar(s, id, bloco, extra, avisos) {
  return s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: avisos || [], dados: Object.assign({ import_id: id, bloco }, extra || {}) }));
}
function importarTudo(s, id, extra, avisos) {
  let r = importar(s, id, 1, extra || { modo: 'TOTAL' }, avisos);
  assert.ok(r.ok, JSON.stringify(r.erro));
  s.conferirProjecoes('bloco 1');
  for (let b = 2; r.valor.dados.blocos.proximo !== null; b++) {
    r = importar(s, id, b, {}, avisos);
    assert.ok(r.ok, 'bloco ' + b + ': ' + JSON.stringify(r.erro));
    s.conferirProjecoes('bloco ' + b);
  }
  const fim = s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } })).dados;
  s.conferirProjecoes('concluir');
  return fim;
}
function desfazer(s, id, avisos, extra) {
  return s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { avisosAceitos: avisos || [], dados: Object.assign({ import_id: id, justificativa: 'Arquivo errado' }, extra || {}) }));
}
const animal = (s, id) => s.tabela('ANIMAIS').find((a) => a.animal_id === id);
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
const eventosDe = (s, id) => s.tabela('EVENTOS').filter((e) => e.import_id === id);
const codigosLinha = (l) => l.erros.map((e) => e.codigo);
function integra(s, msg) {
  const r = s.integridade();
  const sit = S.situacoes(r);
  if (sit.PENDENCIAS === 'ALERTA') delete sit.PENDENCIAS; // a Mansinha do rebanho inicial sem brinco é pendência esperada
  assert.deepEqual(sit, {}, (msg || '') + ' ' + JSON.stringify(r.achados.filter((a) => a.severidade === 'ERRO').slice(0, 4)));
  s.conferirProjecoes(msg);
}

// ------------------------------------------------------------------ PESAGENS ----
const MAPA_PESAGENS = { colunas: { 'Nº da pesagem': 'grupo', 'Data da pesagem': 'data', Brinco: 'brinco', 'Peso (kg)': 'peso', 'Peso total do lote (kg)': 'peso_total_lote', 'Cabeças na balança': 'cabecas_lote' }, confiancas: {}, padroes: { momento: 'ROTINA', metodo: 'BALANCA' } };

test('PESAGENS: as linhas da mesma data formam a pesagem coletiva; a pesagem por lote fica com a média; a de antes do marco zero é histórico (na curva, fora do GMD, sem mexer no inventário); o brinco vale pelo dono NA DATA; integridade e projeções', () => {
  const s = preparar({ brinco_permite_reuso: 'S' });
  const { ids } = s;
  // O 101 troca de brinco (101 → 151) em 01/06; em 01/07 o número 101 vai para a Mansinha (sem brinco até então).
  s.evento('registrar', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-06-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: ids['101'], codigo: '151', motivo: 'PERDA' }] }, 'troca-101');
  s.evento('registrar', { tipo: 'IDENTIFICACAO', subtipo: 'PRIMEIRA_IDENTIFICACAO', campos: { event_date: '2026-07-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: s.semBrinco, codigo: '101' }] }, 'mansinha-101');
  const csv = [
    'Nº da pesagem;Data da pesagem;Brinco;Peso (kg);Peso total do lote (kg);Cabeças na balança',
    ';15/09/2025;100;250,5;;',
    ';10/03/2026;100;300;;',
    ';10/03/2026;101;280,4;;',
    ';10/03/2026;102;290;;',
    ';10/08/2026;101;410;;',
    'L1;20/09/2026;100;;1.000,0;3',
    'L1;20/09/2026;151;;;',
    'L1;20/09/2026;102;;;',
  ].join('\n');
  const c = criar(s, 'PESAGENS', csv);
  assert.deepEqual(c.sugestao, MAPA_PESAGENS.colunas, 'o modelo do tipo vem mapeado pelos rótulos');
  const v = validarTudo(s, c.import_id, MAPA_PESAGENS);
  assert.deepEqual([v.contadores.validas, v.contadores.erro, v.contadores.duplicadas], [8, 0, 0], JSON.stringify(linhas(s, c.import_id).filter((l) => l.status !== 'VALIDA')));
  // Lançamentos: a histórica, a coletiva de 10/03 (3 animais), a de 10/08 e o lote de 20/09 (3 animais), em blocos de eventos inteiros.
  const ls = linhas(s, c.import_id);
  assert.deepEqual(ls.map((l) => l.lancamento), [[2], [3, 4, 5], [3, 4, 5], [3, 4, 5], [6], [7, 8, 9], [7, 8, 9], [7, 8, 9]]);
  const fim = importarTudo(s, c.import_id);
  assert.equal(fim.importacao.status, 'IMPORTADO');
  assert.deepEqual([fim.criados.animais, fim.criados.eventos], [0, 4]);
  assert.deepEqual(fim.importacao.relatorio.tamanhos_blocos, [1, 3, 1, 3]);
  const evs = eventosDe(s, c.import_id);
  assert.deepEqual(evs.map((e) => [e.event_type, e.event_date, e.pre_marco_zero, e.status, e.source]).sort(), [
    ['PESAGEM', '2025-09-15', true, 'CONFIRMADO', 'IMPORTACAO'], ['PESAGEM', '2026-03-10', false, 'CONFIRMADO', 'IMPORTACAO'],
    ['PESAGEM', '2026-08-10', false, 'CONFIRMADO', 'IMPORTACAO'], ['PESAGEM', '2026-09-20', false, 'CONFIRMADO', 'IMPORTACAO'],
  ]);
  // O brinco 101 em 10/03 era do boi (hoje 151); em 10/08, da Mansinha.
  const pes = s.tabela('PESAGENS').filter((p) => evs.some((e) => e.event_id === p.event_id));
  const doAnimal = (id) => pes.filter((p) => p.animal_id === id).map((p) => [p.data_pesagem, p.peso_kg, p.metodo, p.tipo]).sort();
  assert.deepEqual(doAnimal(ids['101']), [['2026-03-10', 280.4, 'BALANCA', 'ROTINA'], ['2026-09-20', 333.3, 'MEDIA_LOTE', 'ROTINA']]);
  assert.deepEqual(doAnimal(s.semBrinco), [['2026-08-10', 410, 'BALANCA', 'ROTINA']]);
  assert.deepEqual(doAnimal(ids['100']), [['2025-09-15', 250.5, 'BALANCA', 'ROTINA'], ['2026-03-10', 300, 'BALANCA', 'ROTINA'], ['2026-09-20', 333.3, 'MEDIA_LOTE', 'ROTINA']]);
  const lote = evs.find((e) => e.event_date === '2026-09-20');
  assert.deepEqual([lote.payload_json.peso_total_lote_kg, lote.payload_json.qtd_cabecas_lote], [1000, 3]);
  // A histórica: efeito 0, sem mexer no inventário; a linha do arquivo aponta a pesagem gerada (03a, seção 5.5).
  const hist = evs.find((e) => e.pre_marco_zero);
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: hist.event_id }).map((l) => [l.efeito_inventario, l.peso]), [[0, 250.5]]);
  const l2 = linhas(s, c.import_id).find((l) => l.linha_num === 2);
  assert.equal(l2.entity_id_gerado, pes.find((p) => p.event_id === hist.event_id).weight_id);
  assert.equal(l2.event_id_gerado, hist.event_id);
  // Projeções: o peso atual é a pesagem mais recente (a do lote); o histórico entra na curva e fica fora do GMD, explicado.
  assert.deepEqual([animal(s, ids['100']).peso_atual, animal(s, ids['100']).data_ultima_pesagem], [333.3, '2026-09-20']);
  const ficha = s.read(s.G.AnimalService.consultaFicha({ animal_id: ids['100'] }));
  const bloco = ficha.peso || ficha.blocos && ficha.blocos.peso;
  assert.ok(bloco, 'a ficha traz o bloco de peso');
  assert.deepEqual(bloco.serie.map((x) => x.data), ['2025-09-15', '2026-03-10', '2026-09-20']);
  assert.equal(bloco.intervalos[0].gmd_kg_dia, null);
  assert.match(bloco.intervalos[0].explicacao, /anterior ao marco zero/);
  integra(s, 'pesagens importadas');
});

test('PESAGENS, duplicidade e recusas por linha: a mesma linha repetida e a pesagem já gravada com o mesmo peso ficam DUPLICADA; o outro peso no mesmo dia (outro lançamento ou já gravado) pede confirmação; o mesmo animal duas vezes no lançamento, o peso fora da faixa, o animal fora do rebanho na data, o brinco sem dono e o momento desconhecido ficam em ERRO, cada um com o motivo', () => {
  const s = preparar();
  const { ids } = s;
  // Gravadas pelo formulário: 300 kg do 100 e 280 kg do 101 em 10/03; o 102 morre em 01/05.
  s.evento('registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-03-10', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['100'], peso: 300 }, { animal_id: ids['101'], peso: 280 }] }, 'pes-form');
  s.evento('registrar', { tipo: 'MORTE', campos: { event_date: '2026-05-01', causa: 'RAIO' }, animais: [{ animal_id: ids['102'] }] }, 'morte-102');
  const csv = [
    'Nº da pesagem;Data da pesagem;Momento da pesagem;Brinco;Peso (kg)',
    ';10/03/2026;rotina;100;300',
    ';10/03/2026;rotina;101;281,5',
    'P2;12/04/2026;rotina;300;450',
    'P2;12/04/2026;rotina;300;452',
    'P3;12/04/2026;rotina;301;0',
    'P4;12/04/2026;rotina;302;3.000',
    'P5;10/06/2026;rotina;102;310',
    'P6;10/06/2026;rotina;555;310',
    'P7;10/06/2026;de manhã;900;800',
    'P8;15/06/2026;rotina;900;812',
    'P8;15/06/2026;rotina;900;812',
    'P9;15/06/2026;rotina;900;812,5',
  ].join('\n');
  const mapa = { colunas: { 'Nº da pesagem': 'grupo', 'Data da pesagem': 'data', 'Momento da pesagem': 'momento', Brinco: 'brinco', 'Peso (kg)': 'peso' }, confiancas: {}, padroes: { metodo: 'BALANCA' } };
  const c = criar(s, 'PESAGENS', csv);
  validarTudo(s, c.import_id, mapa);
  const ls = linhas(s, c.import_id);
  const por = Object.fromEntries(ls.map((l) => [l.linha_num, [l.status, codigosLinha(l)[0]]]));
  assert.deepEqual(por, {
    2: ['DUPLICADA', 'EVENTO_JA_REGISTRADO'], 3: ['VALIDA', undefined],
    4: ['ERRO', 'LANCAMENTO_COM_ERRO'], 5: ['ERRO', 'ANIMAL_REPETIDO'],
    6: ['ERRO', 'VALOR_FORA_DA_FAIXA'], 7: ['ERRO', 'VALOR_FORA_DA_FAIXA'], 8: ['ERRO', 'APOS_MORTE'], 9: ['ERRO', 'ANIMAL_NAO_ENCONTRADO'],
    10: ['ERRO', 'VALOR_FORA_DA_LISTA'], 11: ['VALIDA', undefined], 12: ['DUPLICADA', 'LINHA_REPETIDA_NO_ARQUIVO'], 13: ['VALIDA', undefined],
  }, JSON.stringify(ls.filter((l) => l.status !== 'VALIDA').map((l) => [l.linha_num, l.erros])));
  const msg = (n) => ls.find((l) => l.linha_num === n).erros.map((e) => e.mensagem).join(' | ');
  assert.match(msg(2), /já tem uma pesagem de 300,0 kg em 10\/03\/2026/);
  assert.match(msg(5), /aparece também na linha 4 do mesmo lançamento \(para duas pesagens do animal no mesmo dia, use números diferentes na coluna "Nº da pesagem"\)/);
  assert.match(msg(8), /morreu em 01\/05\/2026 e não aceita a pesagem de 10\/06\/2026/);
  assert.match(msg(9), /brinco 555 não está no rebanho nem no histórico/);
  // A linha 2 (o fato já gravado) sai do lançamento de 10/03: a 3 entra sozinha, sem esperar a outra.
  assert.deepEqual(ls.find((l) => l.linha_num === 3).lancamento, [3]);
  assert.match(msg(10), /momento da pesagem "de manhã" não reconhecido/);
  assert.match(msg(12), /repete a linha 11/);
  assert.ok(!/Linha \d+:/.test(msg(6)), 'a mensagem do motor sem o "Linha N:" (a linha já é a da planilha)');
  // Importar só as válidas (3, 11 e 13): o 101 já pesado em 10/03 com outro peso e a segunda pesagem do 900 em 15/06 pedem
  // confirmação (POSSIVEL_DUPLICIDADE, a guarda do formulário); aceita, entram.
  const v = s.read(s.G.ImportService.consultaObter({ import_id: c.import_id }));
  const aprov = { modo: 'PARCIAL_APROVADO', aprovacao: { importar: v.contadores.validas, ignorar: v.contadores.erro + v.contadores.duplicadas } };
  let r = importar(s, c.import_id, 1, aprov);
  assert.equal(r.erro.code, 'NEEDS_CONFIRMATION', JSON.stringify(r.erro));
  assert.ok(r.erro.details.every((d) => d.codigo === 'POSSIVEL_DUPLICIDADE'), JSON.stringify(r.erro.details));
  const fim = importarTudo(s, c.import_id, aprov, ['POSSIVEL_DUPLICIDADE']);
  assert.equal(fim.importacao.status, 'IMPORTADO');
  assert.deepEqual(s.tabela('PESAGENS').filter((p) => p.animal_id === ids['900']).map((p) => p.peso_kg).sort(), [812, 812.5], 'duas pesagens legítimas no mesmo dia, em dois lançamentos');
  assert.deepEqual(s.tabela('PESAGENS').filter((p) => p.animal_id === ids['101']).map((p) => p.peso_kg).sort(), [280, 281.5]);
  assert.deepEqual(fim.reprovadas.map((x) => x.linha_num), [2, 4, 5, 6, 7, 8, 9, 10, 12]);
  integra(s, 'parcial');
});

test('PESAGENS pelos caminhos: a pesagem importada é corrigida e estornada como a do formulário; a correção de fora bloqueia o desfazer até ser estornada; o desfazer tira as pesagens (o peso atual volta); a importação de ANIMAIS com pesagem importada depois só se desfaz depois de desfazer a de pesagens', () => {
  const s = S.sistema({ config: { importacao_lote_linhas: '5' } });
  const csvA = 'Brinco;Sexo;Pasto;Nascimento\n500;M;Pasto A;01/02/2024\n501;F;Pasto A;01/03/2023';
  const ca = criar(s, 'ANIMAIS', csvA, 'criar-a');
  validarTudo(s, ca.import_id, { colunas: { Brinco: 'brinco', Sexo: 'sexo', Pasto: 'pasto', Nascimento: 'data_nascimento' }, confiancas: { data_nascimento: 'CONFIRMADA' }, padroes: { castrado: false, reprodutor: false } });
  importarTudo(s, ca.import_id);
  const a500 = s.tabela('ANIMAIS').find((a) => a.brinco === '500').animal_id;
  const csv = 'Data da pesagem;Brinco;Peso (kg)\n01/04/2026;500;320\n01/04/2026;501;410\n01/08/2026;500;380';
  const c = criar(s, 'PESAGENS', csv);
  validarTudo(s, c.import_id, { colunas: { 'Data da pesagem': 'data', Brinco: 'brinco', 'Peso (kg)': 'peso' }, confiancas: {}, padroes: { momento: 'ROTINA', metodo: 'FITA' } });
  importarTudo(s, c.import_id);
  assert.equal(animal(s, a500).peso_atual, 380);
  const evs = eventosDe(s, c.import_id);
  const ago = evs.find((e) => e.event_date === '2026-08-01');
  // O desfazer da importação de ANIMAIS: a pesagem importada é lançamento posterior — desfaça antes a de pesagens.
  let r = desfazer(s, ca.import_id);
  assert.equal(r.erro.code, 'CONFLICT');
  assert.match(r.erro.details[0].mensagem, /Desfaça antes a importação do arquivo "pesagens.csv"/);
  // Correção da pesagem importada (pelo formulário): o substituto é de fora e bloqueia o desfazer.
  const corr = s.evento('corrigir', { event_id: ago.event_id, justificativa: 'peso digitado errado', campos: { event_date: '2026-08-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'FITA' }, animais: [{ animal_id: a500, peso: 385 }] }, 'corr-ago');
  assert.equal(animal(s, a500).peso_atual, 385);
  r = desfazer(s, c.import_id);
  assert.equal(r.erro.code, 'CONFLICT');
  assert.equal(r.erro.details[0].conflito.event_id, corr.dados.event_id);
  assert.match(r.erro.details[0].mensagem, /recebeu uma correção depois/);
  s.evento('estornar', { event_id: corr.dados.event_id, justificativa: 'pesagem lançada à toa' }, 'est-corr');
  // O estorno da correção anula o lançamento de vez (o importado de agosto não volta): vale a pesagem de abril.
  assert.deepEqual([animal(s, a500).peso_atual, animal(s, a500).data_ultima_pesagem], [320, '2026-04-01']);
  // O estorno da pesagem importada de abril (fato independente, sem dependente) e o desfazer do resto.
  const abr = evs.find((e) => e.event_date === '2026-04-01');
  s.evento('estornar', { event_id: abr.event_id, justificativa: 'pesagem de teste' }, 'est-abr');
  assert.equal(animal(s, a500).peso_atual || null, null);
  assert.equal(animal(s, s.tabela('ANIMAIS').find((a) => a.brinco === '501').animal_id).peso_atual || null, null, 'a pesagem de abril era coletiva: o estorno a tira dos dois');
  r = desfazer(s, c.import_id);
  assert.ok(r.ok, JSON.stringify(r.erro));
  s.conferirProjecoes('desfeita');
  assert.deepEqual([animal(s, a500).peso_atual || null, animal(s, a500).data_ultima_pesagem || null], [null, null], 'sem as pesagens da importação, o animal fica sem peso');
  assert.ok(linhas(s, c.import_id).every((l) => l.status === 'IMPORTADA'), 'as linhas ficam como prova de origem');
  r = desfazer(s, ca.import_id);
  assert.ok(r.ok, JSON.stringify(r.erro));
  integra(s, 'as duas desfeitas');
});

// ------------------------------------------------------------------ SANIDADE ----
function cadastrosSanidade(s) {
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', controla_estoque: true, custo_unitario: 1.85, fabricante: 'Lab Boi' } }, 'prod-x'), 'produto');
  ok(api(s, 'produto.salvar', { campos: { nome: 'Vermífugo Y', categoria: 'VERMIFUGO', unidade: 'mL', controla_estoque: false, custo_unitario: 0.04 } }, 'prod-y'), 'vermifugo');
  const pr = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Aftosa semestral', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }, 'prot'), 'protocolo');
  ok(api(s, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-02-01', product_id: p.product_id, quantidade: 50, valor: 9250 } }, 'entrada-50'), 'entrada');
  return { produto: p, protocolo: pr };
}
const MAPA_SANIDADE = {
  colunas: { Data: 'data', Procedimento: 'procedimento', 'Produto do cadastro': 'produto', 'Nome do produto (sem cadastro)': 'nome_produto', Protocolo: 'protocolo', 'Como foi a dose': 'modo_dose', 'Dose do lançamento (por cabeça ou por kg)': 'dose_lancamento', 'Unidade da dose (sem cadastro)': 'unidade', 'Carência (dias)': 'carencia', 'Doença ou diagnóstico': 'diagnostico', Brinco: 'brinco', 'Resultado do exame': 'resultado_exame' },
  confiancas: {}, padroes: {},
};
const CAB_SANIDADE = 'Data;Procedimento;Produto do cadastro;Nome do produto (sem cadastro);Protocolo;Como foi a dose;Dose do lançamento (por cabeça ou por kg);Unidade da dose (sem cadastro);Carência (dias);Doença ou diagnóstico;Brinco;Resultado do exame';

test('SANIDADE: a vacinação coletiva com o produto do cadastro baixa o estoque e vira o consumo sem caixa rateado, com a carência e a próxima pelo protocolo; a de antes do marco zero fica no histórico sanitário sem baixar o frasco nem gerar custo; o nome livre, a doença e o exame com o resultado de cada animal; o desfazer devolve o estoque', () => {
  const s = preparar();
  const { ids } = s;
  const cad = cadastrosSanidade(s);
  const csv = [
    CAB_SANIDADE,
    '10/03/2026;vacinação;Vacina X;;Aftosa semestral;por cabeça;1;;21;;100;',
    '10/03/2026;vacinação;Vacina X;;Aftosa semestral;por cabeça;1;;21;;101;',
    '10/03/2026;vacinação;Vacina X;;Aftosa semestral;por cabeça;1;;21;;102;',
    '15/09/2025;vacinação;Vacina X;;;por cabeça;1;;;;300;',
    '15/09/2025;vacinação;Vacina X;;;por cabeça;1;;;;301;',
    '20/04/2026;vermifugação;;Ivermectina 1%;;por cabeça;5;mL;35;;300;',
    '02/05/2026;doença;;;;;;;;Tristeza parasitária;301;',
    '03/05/2026;exame;;;;;;;;Brucelose;300;Negativo',
    '03/05/2026;exame;;;;;;;;Brucelose;301;Positivo',
  ].join('\n');
  const c = criar(s, 'SANIDADE', csv);
  assert.deepEqual(c.sugestao, MAPA_SANIDADE.colunas);
  const v = validarTudo(s, c.import_id, MAPA_SANIDADE);
  assert.deepEqual([v.contadores.validas, v.contadores.erro, v.contadores.duplicadas], [9, 0, 0], JSON.stringify(linhas(s, c.import_id).filter((l) => l.status !== 'VALIDA')));
  const fim = importarTudo(s, c.import_id);
  assert.deepEqual([fim.criados.eventos, fim.criados.animais], [5, 0]);
  const evs = eventosDe(s, c.import_id);
  const vac = evs.find((e) => e.event_date === '2026-03-10');
  const hist = evs.find((e) => e.event_date === '2025-09-15');
  assert.deepEqual([vac.event_subtype, vac.pre_marco_zero, hist.pre_marco_zero, vac.total_value], ['VACINACAO', false, true, 555]);
  // O estoque: 50 − 3 (a de março); a histórica não baixa.
  assert.equal(s.tabela('PRODUTOS').find((p) => p.product_id === cad.produto.product_id).estoque_atual, 47);
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: vac.event_id }).map((m) => [m.tipo, m.quantidade, m.custo_unitario]), [['SAIDA', 3, 1.85]]);
  assert.deepEqual([tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: hist.event_id }).length, tab(s, 'FINANCEIRO', { event_id: hist.event_id }).length], [0, 0], 'histórico: sem saída e sem consumo');
  const fin = tab(s, 'FINANCEIRO', { event_id: vac.event_id });
  assert.deepEqual(fin.map((f) => [f.valor, f.natureza, f.status_pagamento, f.quantidade]), [[555, 'CUSTEIO', 'SEM_CAIXA', 3]]);
  const sanVac = tab(s, 'SANIDADE', { event_id: vac.event_id });
  assert.deepEqual(sanVac.map((x) => [x.dose, x.unidade_dose, x.custo, x.data_fim_carencia, x.data_proxima_aplicacao, x.protocol_id]).sort(), [
    [1, 'dose', 185, '2026-03-31', '2026-09-06', cad.protocolo.protocol_id], [1, 'dose', 185, '2026-03-31', '2026-09-06', cad.protocolo.protocol_id], [1, 'dose', 185, '2026-03-31', '2026-09-06', cad.protocolo.protocol_id],
  ]);
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: hist.event_id }).map((x) => [x.nome_produto, x.dose, x.custo || null]), [['Vacina X', 1, null], ['Vacina X', 1, null]]);
  const verm = evs.find((e) => e.event_subtype === 'VERMIFUGACAO');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: verm.event_id }).map((x) => [x.produto_id || null, x.nome_produto, x.dose, x.unidade_dose, x.data_fim_carencia]), [[null, 'Ivermectina 1%', 5, 'mL', '2026-05-25']]);
  const exame = evs.find((e) => e.event_subtype === 'EXAME');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: exame.event_id }).map((x) => [x.animal_id, x.diagnostico, x.resultado_exame]).sort(), [[ids['300'], 'Brucelose', 'Negativo'], [ids['301'], 'Brucelose', 'Positivo']].sort());
  // A linha aponta a aplicação gerada.
  const l2 = linhas(s, c.import_id).find((l) => l.linha_num === 2);
  assert.equal(l2.entity_id_gerado, sanVac.find((x) => x.animal_id === ids['100']).health_id);
  integra(s, 'sanidade importada');
  // O desfazer: o estoque volta a 50 e o consumo deixa de valer.
  const r = desfazer(s, c.import_id);
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.equal(s.tabela('PRODUTOS').find((p) => p.product_id === cad.produto.product_id).estoque_atual, 50);
  assert.equal(tab(s, 'FINANCEIRO', { event_id: vac.event_id })[0].status, 'CANCELADO');
  integra(s, 'sanidade desfeita');
});

test('SANIDADE, recusas e duplicidade: o produto ou o protocolo sem cadastro, a vacinação sem produto, o modo total sem a quantidade e a dose do animal no modo total ficam em ERRO; a mesma vacina já gravada no dia fica DUPLICADA e outra vacina no mesmo dia entra; a carência que cobre uma venda para abate já gravada é recusada pela política (BLOQUEIA); a aplicação histórica corrigida pelo formulário continua sem estoque e sem caixa', () => {
  const s = preparar();
  const { ids } = s;
  const cad = cadastrosSanidade(s);
  ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-03-10', produto_id: cad.produto.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }, animais: [{ animal_id: ids['100'] }] }, 'vac-form'), 'vacina do formulário');
  const comprador = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } }, 'parc'), 'parceiro').partner_id;
  ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-06-10', partner_id: comprador, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: ids['102'] }], parcelas: [{ data_vencimento: '2026-06-10' }] }, 'venda-102'), 'venda');
  const csv = [
    CAB_SANIDADE,
    '10/03/2026;vacinação;Vacina X;;;por cabeça;1;;;;100;',
    '10/03/2026;vacinação;;Vacina Z;;por cabeça;2;mL;;;100;',
    '11/03/2026;vacinação;Vacina Inexistente;;;por cabeça;1;;;;101;',
    '11/03/2026;vacinação;Vacina X;;Protocolo Fantasma;por cabeça;1;;;;300;',
    '12/03/2026;vacinação;;;;;;;;;301;',
    '13/03/2026;vermifugação;Vermífugo Y;;;total;;;;;302;',
    '01/06/2026;medicação;Vermífugo Y;;;por cabeça;10;;60;;102;',
  ].join('\n');
  const c = criar(s, 'SANIDADE', csv);
  validarTudo(s, c.import_id, MAPA_SANIDADE);
  const ls = linhas(s, c.import_id);
  const por = Object.fromEntries(ls.map((l) => [l.linha_num, [l.status, codigosLinha(l)[0]]]));
  assert.deepEqual(por, {
    2: ['DUPLICADA', 'EVENTO_JA_REGISTRADO'], 3: ['VALIDA', undefined], 4: ['ERRO', 'PRODUTO_NAO_ENCONTRADO'], 5: ['ERRO', 'PROTOCOLO_NAO_ENCONTRADO'],
    6: ['ERRO', 'CAMPO_OBRIGATORIO'], 7: ['ERRO', 'CAMPO_OBRIGATORIO'], 8: ['ERRO', 'CARENCIA_ATIVA'],
  }, JSON.stringify(ls.filter((l) => l.status !== 'VALIDA').map((l) => [l.linha_num, l.erros])));
  const msg = (n) => ls.find((l) => l.linha_num === n).erros.map((e) => e.mensagem).join(' | ');
  assert.match(msg(2), /já existe vacinação de 10\/03\/2026 com este animal e o mesmo produto/);
  assert.match(msg(4), /o produto "Vacina Inexistente" não está cadastrado\. Cadastre em Sanidade › Produtos, ou use a coluna do nome do produto sem cadastro/);
  assert.match(msg(8), /vendido para abate em 10\/06\/2026, dentro da carência/);
  // A linha 3 entra; a histórica entra por outro arquivo e é corrigida pelo formulário (o substituto também é histórico).
  const v = s.read(s.G.ImportService.consultaObter({ import_id: c.import_id }));
  importarTudo(s, c.import_id, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 1, ignorar: v.contadores.erro + v.contadores.duplicadas } }, ['POSSIVEL_DUPLICIDADE']);
  const c2 = criar(s, 'SANIDADE', CAB_SANIDADE + '\n20/10/2025;vacinação;Vacina X;;;por cabeça;1;;;;300;', 'criar-hist');
  validarTudo(s, c2.import_id, MAPA_SANIDADE);
  importarTudo(s, c2.import_id);
  const hist = eventosDe(s, c2.import_id)[0];
  const corr = s.evento('corrigir', { event_id: hist.event_id, justificativa: 'eram 2 doses', tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2025-10-20', produto_id: cad.produto.product_id, modo_dose: 'POR_CABECA', dose_referencia: 2, custo_valor: 5000, custo_conta_id: s.tabela('PLANO_CONTAS').find((x) => x.codigo === 'SERVICOS_VETERINARIOS').conta_id, custo_vencimento: '2025-11-20' }, animais: [{ animal_id: ids['300'] }] }, 'corr-hist');
  const novo = s.tabela('EVENTOS').find((e) => e.event_id === corr.dados.event_id);
  assert.equal(novo.pre_marco_zero, true, 'a correção do histórico continua histórica');
  assert.equal(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: novo.event_id }).length, 0);
  const fins = tab(s, 'FINANCEIRO', { event_id: novo.event_id });
  assert.deepEqual(fins.map((f) => [f.valor, f.status_pagamento, f.product_id || null]), [[5000, 'SEM_CAIXA', null]], 'só o serviço, sem caixa: o pagamento é anterior ao controle');
  assert.equal(s.tabela('PARCELAS').filter((p) => fins.some((f) => f.financial_id === p.financial_id)).length, 0);
  assert.equal(s.tabela('PRODUTOS').find((p) => p.product_id === cad.produto.product_id).estoque_atual, 49, '50 − a do formulário; a da linha 3 (sem cadastro) e a histórica corrigida não baixam');
  integra(s, 'sanidade com recusas');
});

// ------------------------------------------------------------------ REPRODUCAO ----
const CAB_REPRO = 'Nº do lançamento;Data;Registro;Estação de monta;Touro (brinco, código ou nome);Partida do sêmen;Método;Brinco;Código do animal;Resultado do diagnóstico;Idade da gestação (dias);Previsão de parto';
const MAPA_REPRO = {
  colunas: { 'Nº do lançamento': 'grupo', Data: 'data', Registro: 'registro', 'Estação de monta': 'estacao', 'Touro (brinco, código ou nome)': 'touro', 'Partida do sêmen': 'semen', 'Método': 'metodo', Brinco: 'brinco', 'Código do animal': 'codigo', 'Resultado do diagnóstico': 'resultado', 'Idade da gestação (dias)': 'idade_gestacao', 'Previsão de parto': 'previsao_parto' },
  confiancas: {}, padroes: {},
};

test('REPRODUCAO: a exposição do lote (fêmeas e o touro nas linhas), a inseminação com o touro de fora pelo nome, a cobertura com o touro do rebanho pelo brinco, o diagnóstico do lote com o resultado de cada fêmea e o aborto; o diagnóstico de antes do marco zero fica no histórico e não desfaz a situação declarada no rebanho inicial; recusas por linha; o desfazer devolve as situações', () => {
  const s = preparar();
  const { ids } = s;
  const est = ok(api(s, 'estacao.salvar', { campos: { nome: 'Estação 2026', data_inicio: '2026-02-01', data_fim: '2026-04-30', tipo: 'MISTA' } }, 'est'), 'estação');
  ok(api(s, 'animal.cadastrarExterno', { campos: { nome: 'Touro Sêmen Nelore', sexo: 'M', data_nascimento: '2017-01-01', data_nascimento_confianca: 'ESTIMADA' } }, 'ext'), 'externo');
  const mansinha = animal(s, s.semBrinco).codigo_interno;
  // O diagnóstico do 301 em 01/05 já foi lançado pelo formulário: a linha dele fica DUPLICADA e as outras do lote entram.
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-05-01', estacao_id: est.estacao_id }, animais: [{ animal_id: ids['301'], resultado: 'NEGATIVO' }] }, 'dg-form'), 'diagnóstico do formulário');
  const csv = [
    CAB_REPRO,
    'E1;01/02/2026;exposição;Estação 2026;;;;300;;;;',
    'E1;;;;;;;301;;;;',
    'E1;;;;;;;900;;;;',
    ';10/02/2026;inseminação;Estação 2026;Touro Sêmen Nelore;Partida 7;IATF;301;;;;',
    ';15/02/2026;cobertura;Estação 2026;900;;monta controlada;300;;;;',
    ';01/05/2026;diagnóstico;Estação 2026;;;ultrassom;300;;prenhe;80;',
    ';01/05/2026;diagnóstico;Estação 2026;;;ultrassom;301;;vazia;;',
    ';01/07/2026;aborto;;;;;300;;;140;',
    ';10/10/2025;diagnóstico;;;;palpação;302;;positivo;60;',
    ';10/10/2025;diagnóstico;;;;palpação;;' + mansinha + ';positivo;;',
    ';05/05/2026;diagnóstico;Estação 2026;;;;100;;positivo;;',
    ';06/05/2026;cobertura;Estação 2026;Touro Fantasma;;;301;;;;',
    ';07/05/2026;diagnóstico;Estação Fantasma;;;;300;;positivo;;',
    ';08/05/2026;parto;;;;;300;;;;',
    ';01/08/2026;exposição;Estação 2026;;;;301;;;;',
  ].join('\n');
  const c = criar(s, 'REPRODUCAO', csv);
  assert.deepEqual(c.sugestao, MAPA_REPRO.colunas);
  validarTudo(s, c.import_id, MAPA_REPRO);
  const ls = linhas(s, c.import_id);
  const por = Object.fromEntries(ls.map((l) => [l.linha_num, [l.status, codigosLinha(l)[0]]]));
  assert.deepEqual(por, {
    2: ['VALIDA', undefined], 3: ['VALIDA', undefined], 4: ['VALIDA', undefined], 5: ['VALIDA', undefined], 6: ['VALIDA', undefined], 7: ['VALIDA', undefined],
    8: ['DUPLICADA', 'EVENTO_JA_REGISTRADO'], 9: ['VALIDA', undefined], 10: ['VALIDA', undefined], 11: ['VALIDA', undefined],
    12: ['ERRO', 'NAO_E_FEMEA'], 13: ['ERRO', 'TOURO_NAO_ENCONTRADO'], 14: ['ERRO', 'ESTACAO_NAO_ENCONTRADA'], 15: ['ERRO', 'VALOR_FORA_DA_LISTA'], 16: ['ERRO', 'FORA_DA_ESTACAO'],
  }, JSON.stringify(ls.filter((l) => l.status !== 'VALIDA').map((l) => [l.linha_num, l.erros])));
  const msg = (n) => ls.find((l) => l.linha_num === n).erros.map((e) => e.mensagem).join(' | ');
  assert.match(msg(8), /já existe diagnóstico de gestação de 01\/05\/2026 com este animal/);
  assert.match(msg(13), /o touro "Touro Fantasma" não está no rebanho nem entre os animais de referência/);
  assert.match(msg(14), /a estação de monta "Estação Fantasma" não está cadastrada\. Cadastre em Reprodução › Estações/);
  assert.match(msg(15), /registro "parto" não reconhecido/);
  const v = s.read(s.G.ImportService.consultaObter({ import_id: c.import_id }));
  const fim = importarTudo(s, c.import_id, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: v.contadores.validas, ignorar: v.contadores.erro + v.contadores.duplicadas } });
  assert.equal(fim.criados.eventos, 6);
  const evs = eventosDe(s, c.import_id);
  const expo = evs.find((e) => e.event_subtype === 'EXPOSICAO');
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: expo.event_id }).map((l) => [l.animal_id, l.papel]).sort(), [[ids['300'], 'SUJEITO'], [ids['301'], 'SUJEITO'], [ids['900'], 'TOURO']].sort());
  assert.deepEqual(tab(s, 'REPRODUCAO', { event_id: expo.event_id }).map((r) => [r.touro_id, r.estacao_id]), [[ids['900'], est.estacao_id], [ids['900'], est.estacao_id]]);
  const ext = s.tabela('ANIMAIS').find((a) => a.nome === 'Touro Sêmen Nelore').animal_id;
  const ia = evs.find((e) => e.event_subtype === 'INSEMINACAO');
  assert.deepEqual(tab(s, 'REPRODUCAO', { event_id: ia.event_id }).map((r) => [r.animal_id, r.touro_id, r.semen_identificacao, r.metodo]), [[ids['301'], ext, 'Partida 7', 'IATF']]);
  const cob = evs.find((e) => e.event_subtype === 'COBERTURA');
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: cob.event_id }).map((l) => [l.animal_id, l.papel]).sort(), [[ids['300'], 'SUJEITO'], [ids['900'], 'TOURO']].sort());
  const dgs = evs.filter((e) => e.event_subtype === 'DIAGNOSTICO_GESTACAO');
  assert.deepEqual(dgs.map((e) => [e.event_date, e.pre_marco_zero]).sort(), [['2025-10-10', true], ['2026-05-01', false]]);
  const dg = dgs.find((e) => !e.pre_marco_zero);
  assert.deepEqual(tab(s, 'REPRODUCAO', { event_id: dg.event_id }).map((r) => [r.animal_id, r.resultado, r.idade_gestacional_dias, r.metodo]), [[ids['300'], 'POSITIVO', 80, 'ULTRASSOM']], 'a 301 (já diagnosticada) saiu do lote; a 300 entrou');
  // A linha do touro aponta a linha dele no evento; a da fêmea, o registro reprodutivo.
  const l4 = linhas(s, c.import_id).find((l) => l.linha_num === 4);
  assert.equal(l4.entity_id_gerado, tab(s, 'EVENTO_ANIMAIS', { event_id: expo.event_id, papel: 'TOURO' })[0].event_animal_id);
  const l2 = linhas(s, c.import_id).find((l) => l.linha_num === 2);
  assert.equal(l2.entity_id_gerado, tab(s, 'REPRODUCAO', { event_id: expo.event_id }).find((r) => r.animal_id === ids['300']).reproduction_id);
  // Situações: o aborto deixa a 300 vazia; a 301, vazia pelo diagnóstico do formulário; a 302 continua VAZIA, como foi
  // declarada no marco zero (o positivo de 2025 é histórico); a Mansinha, sem situação declarada, fica prenhe pelo histórico.
  assert.deepEqual(['300', '301', '302'].map((b) => animal(s, ids[b]).situacao_reprodutiva).concat([animal(s, s.semBrinco).situacao_reprodutiva]), ['VAZIA', 'VAZIA', 'VAZIA', 'PRENHA']);
  const ficha = s.read(s.G.AnimalService.consultaFicha({ animal_id: ids['302'] }));
  assert.deepEqual(ficha.reprodutivo.registros.map((r) => [r.tipo_evento, r.data, r.resultado, r.pre_marco_zero]), [['DIAGNOSTICO_GESTACAO', '2025-10-10', 'POSITIVO', true]], 'o histórico aparece na ficha');
  integra(s, 'reprodução importada');
  const r = desfazer(s, c.import_id);
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.deepEqual(['300', '301', '302'].map((b) => animal(s, ids[b]).situacao_reprodutiva).concat([animal(s, s.semBrinco).situacao_reprodutiva]), ['SEM_INFORMACAO', 'VAZIA', 'VAZIA', 'SEM_INFORMACAO']);
  integra(s, 'reprodução desfeita');
});

// ------------------------------------------------------------------ OCORRENCIAS ----
test('OCORRENCIAS: as linhas com a mesma data, o mesmo tipo e a mesma descrição formam uma ocorrência com vários animais; a de antes do marco zero é histórico; a linha repetida e a ocorrência do mesmo tipo já gravada no dia ficam DUPLICADA, a de outro tipo no mesmo dia entra; o tipo fora da lista e o animal sem brinco na data ficam em ERRO; pela api: modelo, criar, validar, importar, concluir e relatório', () => {
  const s = preparar();
  const { ids } = s;
  const apiOk = (rota, dados, chave, onde) => ok(api(s, rota, dados, chave), onde || rota);
  ok(api(s, 'evento.registrar', { tipo: 'OCORRENCIA', campos: { event_date: '2026-04-02', tipo_ocorrencia: 'LESAO', description: 'Corte no arame' }, animais: [{ animal_id: ids['102'] }] }, 'oc-form'), 'ocorrência do formulário');
  const m = apiOk('importacao.modelo', { tipo: 'OCORRENCIAS' });
  assert.deepEqual([m.tipo, m.evento, m.agrupamento.natural, m.obrigatorios], ['OCORRENCIAS', 'OCORRENCIA', ['data', 'tipo_ocorrencia', 'descricao'], [['data'], ['tipo_ocorrencia'], ['descricao'], ['brinco', 'codigo']]]);
  assert.equal(Object.keys(s.G.ImportService.sugerirMapeamento(m.cabecalho_modelo, 'OCORRENCIAS')).length, m.campos.length, 'o modelo para baixar vem mapeado inteiro');
  const csv = [
    'Data;Tipo de ocorrência;O que aconteceu;Brinco',
    '01/04/2026;Observação geral;Fugiram para o vizinho;100',
    '01/04/2026;Observação geral;Fugiram para o vizinho;101',
    '01/04/2026;Observação geral;Fugiram para o vizinho;101',
    '02/04/2026;Lesão ou ferimento;Corte no arame;102',
    '02/04/2026;Descorna;Descorna do lote;102',
    '20/11/2025;Lesão ou ferimento;Bicheira tratada;300',
    '03/04/2026;Briga;Brigaram no curral;301',
    '04/04/2026;Apartação;Separados para venda;999',
  ].join('\n');
  const c = apiOk('importacao.criar', { tipo: 'OCORRENCIAS', arquivo_nome: 'ocorrencias.csv', conteudo_base64: b64(csv), formato: FORMATO }, 'oc-criar');
  const mapa = { colunas: c.sugestao, confiancas: {}, padroes: {} };
  for (let b = 1; ; b++) { const e = apiOk('importacao.validarBloco', { import_id: c.import_id, bloco: b, mapeamento: mapa }, 'oc-val-' + b); if (e.importacao.status === 'VALIDADO') break; }
  const ls = linhas(s, c.import_id);
  assert.deepEqual(Object.fromEntries(ls.map((l) => [l.linha_num, [l.status, codigosLinha(l)[0]]])), {
    2: ['VALIDA', undefined], 3: ['VALIDA', undefined], 4: ['DUPLICADA', 'LINHA_REPETIDA_NO_ARQUIVO'], 5: ['DUPLICADA', 'EVENTO_JA_REGISTRADO'], 6: ['VALIDA', undefined],
    7: ['VALIDA', undefined], 8: ['ERRO', 'VALOR_FORA_DA_LISTA'], 9: ['ERRO', 'ANIMAL_NAO_ENCONTRADO'],
  });
  assert.match(ls.find((l) => l.linha_num === 5).erros[0].mensagem, /já existe ocorrência de 02\/04\/2026 com este animal e o mesmo tipo/);
  const v = apiOk('importacao.obter', { import_id: c.import_id });
  let r = apiOk('importacao.importarBloco', { import_id: c.import_id, bloco: 1, modo: 'PARCIAL_APROVADO', aprovacao: { importar: v.contadores.validas, ignorar: v.contadores.erro + v.contadores.duplicadas } }, 'oc-b1');
  for (let b = 2; r.blocos.proximo !== null; b++) r = apiOk('importacao.importarBloco', { import_id: c.import_id, bloco: b }, 'oc-b' + b);
  const fim = apiOk('importacao.concluir', { import_id: c.import_id });
  assert.deepEqual([fim.importacao.status, fim.criados.eventos], ['IMPORTADO', 3]);
  const rel = apiOk('importacao.relatorio', { import_id: c.import_id });
  assert.deepEqual(rel.reprovadas.map((x) => x.linha_num), [4, 5, 8, 9]);
  assert.deepEqual(rel.reconciliacao.resumo.sem_animal, 1, 'o brinco sem animal aparece na reconciliação');
  const evs = eventosDe(s, c.import_id);
  assert.deepEqual(evs.map((e) => [e.event_date, e.payload_json.tipo_ocorrencia, e.description, e.pre_marco_zero, tab(s, 'EVENTO_ANIMAIS', { event_id: e.event_id }).length]).sort(), [
    ['2025-11-20', 'LESAO', 'Bicheira tratada', true, 1], ['2026-04-01', 'OBSERVACAO', 'Fugiram para o vizinho', false, 2], ['2026-04-02', 'DESCORNA', 'Descorna do lote', false, 1],
  ]);
  integra(s, 'ocorrências importadas');
  s.conferirProjecoes('ocorrências');
});

test('rotas pela api(): importacao.modelo de PESAGENS, SANIDADE e REPRODUCAO (campos, obrigatórios, valores para todas as linhas e o agrupamento com os campos opcionais); o tipo desconhecido é recusado', () => {
  const s = preparar();
  const modelo = (tipo) => api(s, 'importacao.modelo', { tipo });
  const p = ok(modelo('PESAGENS'));
  assert.deepEqual([p.evento, p.agrupamento.natural, p.agrupamento.opcionais, p.padroes], ['PESAGEM', ['data', 'momento', 'metodo'], ['jejum', 'peso_total_lote'], { momento: 'opcao', metodo: 'metodo', jejum: 'bool' }]);
  assert.deepEqual(p.campos.find((x) => x.campo === 'momento').opcoes, ['ROTINA', 'ENTRADA', 'DESMAMA', 'VENDA']);
  const san = ok(modelo('SANIDADE'));
  assert.deepEqual([san.evento, san.obrigatorios, san.agrupamento.opcionais], ['SANIDADE', [['data'], ['procedimento'], ['brinco', 'codigo']], ['produto', 'nome_produto', 'diagnostico']]);
  assert.deepEqual(san.campos.find((x) => x.campo === 'procedimento').opcoes, ['VACINACAO', 'VERMIFUGACAO', 'MEDICACAO', 'TRATAMENTO', 'EXAME', 'DOENCA']);
  const rep = ok(modelo('REPRODUCAO'));
  assert.deepEqual(rep.campos.find((x) => x.campo === 'resultado').opcoes, ['POSITIVO', 'NEGATIVO', 'INCONCLUSIVO']);
  assert.ok(['PESAGENS', 'SANIDADE', 'REPRODUCAO', 'OCORRENCIAS'].every((t) => p.tipos.indexOf(t) >= 0), 'os dez tipos do assistente');
  for (const t of ['PESAGENS', 'SANIDADE', 'REPRODUCAO', 'OCORRENCIAS']) {
    const m = ok(modelo(t));
    assert.equal(Object.keys(s.G.ImportService.sugerirMapeamento(m.cabecalho_modelo, t)).length, m.campos.length, t + ': o modelo para baixar vem mapeado inteiro');
  }
  assert.equal(modelo('DESMAMAS').error.code, 'VALIDATION');
});

test('integridade do histórico sanitário: a aplicação de antes do marco zero com saída de estoque (edição à mão) é acusada pela verificação (COPIAS), e a trava recusa o lançamento que regravaria esse produto', () => {
  const s = preparar();
  const { ids } = s;
  const cad = cadastrosSanidade(s);
  const csv = [CAB_SANIDADE, '10/03/2026;vacinação;Vacina X;;;por cabeça;1;;;;100;', '15/09/2025;vacinação;Vacina X;;;por cabeça;1;;;;300;'].join('\n');
  const c = criar(s, 'SANIDADE', csv);
  validarTudo(s, c.import_id, MAPA_SANIDADE);
  importarTudo(s, c.import_id);
  integra(s, 'antes da edição');
  const evs = eventosDe(s, c.import_id);
  const hist = evs.find((e) => e.pre_marco_zero);
  const atual = evs.find((e) => !e.pre_marco_zero);
  // À mão: a saída da aplicação de março passa a apontar a aplicação histórica.
  const mov = tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: atual.event_id })[0];
  s.editar('MOVIMENTOS_ESTOQUE', mov.mov_id, 'event_id', hist.event_id);
  const rel = s.integridade();
  const copias = rel.achados.filter((a) => a.checagem === 'COPIAS').map((a) => a.mensagem);
  assert.ok(copias.some((m) => /anterior ao marco zero e tem saída de estoque, que o registro histórico não grava/.test(m)), JSON.stringify(copias));
  assert.ok(copias.some((m) => /a saída do estoque não confere com o consumo do lançamento/.test(m)), 'a de março ficou sem a saída dela');
  // A trava (a mesma função): lançar para o animal da aplicação histórica quebrada regravaria a projeção dele a partir da
  // fonte quebrada — recusado; o animal de fora das aplicações quebradas segue.
  const pes = (id, chave) => api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-04-10', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id, peso: 300 }] }, chave);
  const r = pes(ids['300'], 'p-300');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'CONFLICT', JSON.stringify(r.error).slice(0, 500));
  assert.ok(r.error.details.length && r.error.details.every((d) => d.codigo === 'INTEGRIDADE_COPIAS'), JSON.stringify(r.error.details));
  assert.ok(r.error.details.some((d) => /anterior ao marco zero e tem saída de estoque/.test(d.mensagem)), 'a fonte quebrada do histórico é citada');
  assert.match(r.error.message, /dados apagados ou mexidos à mão/);
  ok(pes(ids['101'], 'p-101'), 'o animal de fora não é alcançado');
});

test('a ocorrência e o registro reprodutivo de antes do marco zero, importados e corrigidos pelo formulário com a despesa paga no ato: a correção continua histórica e a despesa nasce sem caixa (sem parcela, mesmo pedindo três vezes), rateada aos animais', () => {
  const s = preparar();
  const { ids } = s;
  const conta = s.tabela('PLANO_CONTAS').find((x) => x.codigo === 'SERVICOS_VETERINARIOS').conta_id;
  const c = criar(s, 'OCORRENCIAS', 'Data;Tipo de ocorrência;O que aconteceu;Brinco\n09/08/2025;Descorna;Descorna do lote;300\n09/08/2025;Descorna;Descorna do lote;301');
  validarTudo(s, c.import_id, { colunas: c.sugestao, confiancas: {}, padroes: {} });
  importarTudo(s, c.import_id);
  const oc = eventosDe(s, c.import_id)[0];
  assert.equal(oc.pre_marco_zero, true);
  const corr = s.evento('corrigir', { event_id: oc.event_id, justificativa: 'faltou a despesa', tipo: 'OCORRENCIA', campos: { event_date: '2025-08-09', tipo_ocorrencia: 'DESCORNA', description: 'Descorna do lote', custo_valor: 3001, custo_conta_id: conta, custo_parcelas_qtd: 3, custo_vencimento: '2025-09-09' }, animais: [{ animal_id: ids['300'] }, { animal_id: ids['301'] }] }, 'corr-oc');
  const novo = s.tabela('EVENTOS').find((e) => e.event_id === corr.dados.event_id);
  assert.deepEqual([novo.pre_marco_zero, novo.total_value], [true, 3001]);
  const fin = tab(s, 'FINANCEIRO', { event_id: novo.event_id });
  assert.deepEqual(fin.map((f) => [f.valor, f.natureza, f.status_pagamento]), [[3001, 'CUSTEIO', 'SEM_CAIXA']]);
  assert.equal(s.tabela('PARCELAS').filter((p) => p.financial_id === fin[0].financial_id).length, 0);
  assert.deepEqual(s.tabela('ALOCACOES_FINANCEIRAS').filter((a) => a.financial_id === fin[0].financial_id).map((a) => a.valor_alocado).sort(), [1500, 1501]);
  // O mesmo caminho na reprodução (o tratador da despesa é um só): o diagnóstico antigo corrigido com a despesa.
  const c2 = criar(s, 'REPRODUCAO', CAB_REPRO + '\n;10/10/2025;diagnóstico;;;;palpação;300;;positivo;;', 'criar-repro-hist');
  validarTudo(s, c2.import_id, MAPA_REPRO);
  importarTudo(s, c2.import_id);
  const dg = eventosDe(s, c2.import_id)[0];
  const corr2 = s.evento('corrigir', { event_id: dg.event_id, justificativa: 'despesa do veterinário', tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2025-10-10', metodo: 'PALPACAO', custo_valor: 8000, custo_conta_id: conta }, animais: [{ animal_id: ids['300'], resultado: 'POSITIVO' }] }, 'corr-dg');
  const fin2 = tab(s, 'FINANCEIRO', { event_id: corr2.dados.event_id });
  assert.deepEqual(fin2.map((f) => [f.valor, f.status_pagamento]), [[8000, 'SEM_CAIXA']]);
  assert.equal(s.tabela('PARCELAS').filter((p) => p.financial_id === fin2[0].financial_id).length, 0);
  integra(s, 'histórico corrigido com despesa');
});
