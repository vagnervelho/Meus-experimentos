'use strict';
/**
 * Revisão da Fase 3 (conserto), achados de zootecnia: os indicadores numa data passada só com os fatos até ela (o último
 * diagnóstico, o aborto, o parto e a marca de descarte na data), a situação declarada na entrada valendo nos indicadores
 * como na projeção, o ganho médio diário do modo curral pela mesma conta da ficha (intervalo mínimo, só pesagens
 * individuais), a agenda sem protocolo cumprida pela aplicação do mesmo produto com protocolo, os animais da tela de
 * desempenho dentro do filtro e a explicação do GMD do período quando nenhum intervalo conta.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave || 'k-' + Math.random(), avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + String(JSON.stringify(r.error)).slice(0, 1500));
  return r.data;
}
const hoje = (s, iso) => { s.gas.clock.now = Date.parse(iso + 'T15:00:00.000Z'); };
function rebanho(s, bichos) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(bichos)), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
const vaca = (brinco, extra) => S.bicho(Object.assign({ brinco, data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }, extra || {}));
const pesar = (s, data, itens, campos) => api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: Object.assign({ event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, campos || {}), animais: itens });

test('achado 1: os indicadores da estação numa data passada usam o último diagnóstico até a data — a reconfirmação gravada depois não muda o número de antes; o aborto e o parto depois da data também não', () => {
  const s = S.sistema();
  hoje(s, '2026-11-13');
  const bichos = [];
  for (let i = 0; i < 10; i++) bichos.push(vaca('V' + i));
  bichos.push(S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' }));
  const id = rebanho(s, bichos);
  const ids = bichos.slice(0, 10).map((b) => id[b.brinco]);
  const est = ok(api(s, 'estacao.salvar', { campos: { nome: 'E26', data_inicio: '2026-01-10', data_fim: '2026-03-31', tipo: 'MONTA_NATURAL' } }), 'estação');
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-01-10', estacao_id: est.estacao_id }, animais: ids.concat([id.T1]).map((animal_id) => ({ animal_id })) }), 'exposição');
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-03-15', estacao_id: est.estacao_id }, animais: ids.map((animal_id, i) => (i < 8 ? { animal_id, resultado: 'POSITIVO', idade_gestacional_dias: 60 } : { animal_id, resultado: 'NEGATIVO' })) }), 'diagnóstico');
  const geral = (data) => ok(api(s, 'reproducao.indicadores', { estacao_id: est.estacao_id, data })).estacao.geral;
  const resumo = (g) => [g.diagnosticadas, g.cobertura_dg.valor, g.prenhez.valor, g.prenhez.numerador, g.prenhez.denominador, g.perda_gestacional.numerador, g.perda_gestacional.denominador];
  const antes = resumo(geral('2026-04-01'));
  assert.deepEqual(antes, [10, 100, 80, 8, 10, 0, 8]);
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-06-15', estacao_id: est.estacao_id }, animais: ids.slice(0, 8).map((animal_id, i) => (i < 7 ? { animal_id, resultado: 'POSITIVO', idade_gestacional_dias: 150 } : { animal_id, resultado: 'NEGATIVO' })) }), 'reconfirmação');
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'ABORTO', campos: { event_date: '2026-07-01' }, animais: [{ animal_id: ids[0], idade_gestacional_dias: 170 }] }), 'aborto');
  assert.deepEqual(resumo(geral('2026-04-01')), antes, 'em 01/04, o mesmo número de antes');
  const ind = ok(api(s, 'reproducao.indicadores', { estacao_id: est.estacao_id, data: '2026-04-01' }));
  assert.equal(ind.matrizes.prenhas, 8);
  // Depois da reconfirmação e do aborto, o número muda (o fato já aconteceu).
  const depois = geral('2026-07-15');
  assert.deepEqual([depois.prenhez.numerador, depois.perda_gestacional.numerador], [7, 1], 'a última reconfirmação (7 de 8) e o aborto como perda');
});

test('achado 2: matrizes ativas e a natalidade anual pela marca de descarte vigente na data — a marcação de dezembro não muda o 1º de janeiro nem uma data anterior a ela; depois dela, a marcada sai', () => {
  const s = S.sistema();
  hoje(s, '2026-12-20');
  const bichos = [];
  for (let i = 0; i < 10; i++) bichos.push(vaca('V' + i, { data_nascimento: '2020-01-01', partos_previos: 2 }));
  const id = rebanho(s, bichos);
  const ids = bichos.map((b) => id[b.brinco]);
  for (let i = 0; i < 6; i++) ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-09-' + String(10 + i) }, animais: [{ animal_id: ids[i] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }), 'parto ' + i);
  const anual = () => ok(api(s, 'reproducao.indicadores', { ano: '2026' })).anual;
  const a1 = anual();
  assert.deepEqual([a1.matrizes_no_inicio, a1.natalidade_anual.valor], [10, 60]);
  ok(api(s, 'evento.registrar', { tipo: 'MARCACAO', subtipo: 'DESCARTE', campos: { event_date: '2026-12-15', acao: 'MARCAR', motivo_descarte: 'IDADE' }, animais: ids.slice(5).map((animal_id) => ({ animal_id })) }), 'marcação');
  const a2 = anual();
  assert.deepEqual([a2.matrizes_no_inicio, a2.natalidade_anual.valor], [10, 60], 'o 1º de janeiro não muda');
  assert.equal(ok(api(s, 'reproducao.indicadores', { data: '2026-06-30' })).matrizes.ativas, 10, 'antes da marcação');
  assert.equal(ok(api(s, 'reproducao.indicadores', { data: '2026-12-16' })).matrizes.ativas, 5, 'depois da marcação');
  // Desmarcada depois: volta a contar dali em diante.
  ok(api(s, 'evento.registrar', { tipo: 'MARCACAO', subtipo: 'DESCARTE', campos: { event_date: '2026-12-18', acao: 'DESMARCAR' }, animais: [{ animal_id: ids[9] }] }), 'desmarcação');
  assert.equal(ok(api(s, 'reproducao.indicadores', { data: '2026-12-16' })).matrizes.ativas, 5);
  assert.equal(ok(api(s, 'reproducao.indicadores', { data: '2026-12-19' })).matrizes.ativas, 6);
});

test('achado 9: os indicadores contam as matrizes pela situação declarada na entrada, como a projeção e a lista de fêmeas — o diagnóstico histórico de antes da entrada não a desfaz', () => {
  const s = S.sistema();
  const bichos = [];
  for (let i = 0; i < 6; i++) bichos.push(vaca(String(300 + i), { data_nascimento: '2020-01-01', partos_previos: 2, situacao_reprodutiva: 'VAZIA' }));
  rebanho(s, bichos);
  const conferir = (onde) => {
    const ind = ok(api(s, 'reproducao.indicadores', {}), 'indicadores').matrizes;
    const mt = ok(api(s, 'reproducao.matrizes', {}), 'matrizes').resumo.por_situacao;
    const proj = s.tabela('ANIMAIS').filter((a) => a.sexo === 'F').map((a) => a.situacao_reprodutiva);
    assert.deepEqual([ind.ativas, ind.prenhas, ind.sem_informacao], [6, 0, 0], onde);
    assert.deepEqual(mt, { VAZIA: 6 }, onde);
    assert.deepEqual(proj, ['VAZIA', 'VAZIA', 'VAZIA', 'VAZIA', 'VAZIA', 'VAZIA'], onde);
  };
  conferir('declarada');
  // O diagnóstico positivo histórico (10/10/2025) da vaca 300, declarada vazia no marco zero.
  const csv = ['Data;Registro;Brinco;Resultado do diagnóstico;Idade da gestação (dias)', '10/10/2025;diagnóstico;300;positivo;60'].join('\n');
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar-r', dados: { tipo: 'REPRODUCAO', arquivo_nome: 'r.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
  const mapa = { colunas: c.sugestao, confiancas: {}, padroes: {} };
  for (let b = 1; b < 20; b++) {
    const est = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'vr-' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
    if (est.importacao.status === 'VALIDADO') break;
  }
  const ib = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(ib.ok, JSON.stringify(ib.erro));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  conferir('com o histórico');
  // A lista de fêmeas numa data passada usa a mesma regra.
  assert.deepEqual(ok(api(s, 'reproducao.matrizes', { data: '2026-03-01' })).resumo.por_situacao, { VAZIA: 6 });
});

test('achado 5: o ganho médio diário da resposta do registro (o modo curral) é o da ficha — intervalo menor que o mínimo e pesagem estimada dão vazio com o porquê; o ganho e os dias continuam contra a anterior', () => {
  const s = S.sistema();
  const r = rebanho(s, [S.bicho({ brinco: '0501', sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' }), S.bicho({ brinco: '0502', sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  ok(pesar(s, '2026-03-10', [{ animal_id: r['0501'], peso: 300 }]));
  const r2 = ok(pesar(s, '2026-06-09', [{ animal_id: r['0501'], peso: 372.8 }]));
  assert.deepEqual([r2.pesagem.animais[0].gmd_kg_dia, r2.pesagem.animais[0].dias], [0.8, 91]);
  const r3 = ok(pesar(s, '2026-06-19', [{ animal_id: r['0501'], peso: 380 }]));
  const a3 = r3.pesagem.animais[0];
  assert.deepEqual([a3.ganho_kg, a3.dias, a3.gmd_kg_dia, a3.gmd_motivo], [7.2, 10, null, 'DADOS_INSUFICIENTES']);
  assert.match(a3.gmd_explicacao, /Intervalo de 10 dias, menor que os 28 dias mínimos/);
  const ficha = ok(api(s, 'animal.ficha', { animal_id: r['0501'] })).peso;
  assert.equal(ficha.intervalos[ficha.intervalos.length - 1].gmd_kg_dia, null);
  // Estimativa visual e depois a balança: sem GMD (a estimada nunca entra), com o porquê.
  ok(pesar(s, '2026-03-01', [{ animal_id: r['0502'], peso: 300 }], { metodo_pesagem: 'ESTIMATIVA_VISUAL' }));
  const e2 = ok(pesar(s, '2026-04-30', [{ animal_id: r['0502'], peso: 345 }])).pesagem.animais[0];
  assert.deepEqual([e2.ganho_kg, e2.dias, e2.gmd_kg_dia], [45, 60, null]);
  assert.match(e2.gmd_explicacao, /estimad/);
  // A própria pesagem estimada também.
  const e3 = ok(pesar(s, '2026-06-30', [{ animal_id: r['0502'], peso: 380 }], { metodo_pesagem: 'ESTIMATIVA_VISUAL' })).pesagem.animais[0];
  assert.equal(e3.gmd_kg_dia, null);
  assert.match(e3.gmd_explicacao, /estimad/);
});

test('achado 10: a pendência sem protocolo (animal, produto) é cumprida pela aplicação posterior do mesmo produto com protocolo; a sem protocolo seguinte volta a valer', () => {
  const s = S.sistema();
  hoje(s, '2026-11-13');
  const id = rebanho(s, [vaca('101')])['101'];
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', controla_estoque: false } }), 'produto');
  const san = (data, campos) => ({ tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: Object.assign({ event_date: data, produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }, campos), animais: [{ animal_id: id }] });
  ok(api(s, 'evento.registrar', san('2026-03-10', { data_proxima_aplicacao: '2026-09-06' })), 'sem protocolo');
  const prot = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Aftosa', tipo_procedimento: 'VACINA', product_id: p.product_id, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }), 'protocolo');
  ok(api(s, 'evento.registrar', san('2026-09-01', { protocol_id: prot.protocol_id })), 'com protocolo');
  let ag = ok(api(s, 'sanidade.agenda', { data: '2026-11-13' }), 'agenda');
  assert.deepEqual(ag.pendencias.filter((x) => !x.protocol_id), [], 'a sem protocolo foi cumprida');
  assert.equal(ag.resumo.vencidas, 0);
  const alertas = ok(api(s, 'alerta.listar', {}), 'alertas');
  assert.equal(JSON.stringify(alertas).indexOf('SANITARIO_VENCIDO') >= 0 && (alertas.itens || alertas).some && (alertas.itens || []).some((x) => x.codigo === 'SANITARIO_VENCIDO' && x.animal_id === id), false);
  // Depois, uma sem protocolo com a próxima: ela decide de novo.
  ok(api(s, 'evento.registrar', san('2026-10-01', { data_proxima_aplicacao: '2026-11-01' })), 'sem protocolo depois');
  ag = ok(api(s, 'sanidade.agenda', { data: '2026-11-13' }), 'agenda 2');
  assert.deepEqual(ag.pendencias.filter((x) => !x.protocol_id).map((x) => [x.vencimento, x.situacao]), [['2026-11-01', 'VENCIDA']]);
});

test('achado 15: a tabela "Animais" da tela de desempenho só traz os animais do filtro de pasto ou de categoria', () => {
  const s = S.sistema();
  const boi = (b, pasto) => S.bicho({ brinco: b, sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA', pasto_destino_id: pasto });
  const id = rebanho(s, [boi('A1', PASTOS.A), boi('A2', PASTOS.A), boi('B1', PASTOS.B), boi('B2', PASTOS.B)]);
  const todos = Object.values(id);
  ok(pesar(s, '2026-03-01', todos.map((x) => ({ animal_id: x, peso: 300 }))));
  ok(pesar(s, '2026-04-30', todos.map((x) => ({ animal_id: x, peso: 345 }))));
  const d = ok(api(s, 'peso.desempenho', { pasture_id: PASTOS.B }));
  assert.deepEqual([d.geral.cabecas, d.animais.map((a) => a.brinco).sort()], [2, ['B1', 'B2']]);
  const cat = (codigo) => s.tabela('CATEGORIAS').find((c) => c.codigo === codigo).category_id;
  const c = ok(api(s, 'peso.desempenho', { category_id: cat('VACA') }));
  assert.deepEqual([c.geral.cabecas, c.animais.length], [0, 0], 'categoria sem nenhum animal');
  const g = ok(api(s, 'peso.desempenho', { category_id: cat('NOVILHO'), pasture_id: PASTOS.A }));
  assert.deepEqual([g.geral.cabecas, g.animais.map((a) => a.brinco).sort()], [2, ['A1', 'A2']], 'categoria e pasto juntos');
  const sem = ok(api(s, 'peso.desempenho', {}));
  assert.equal(sem.animais.length, 4, 'sem filtro, todos');
});

test('achado 29: o GMD do período com várias pesagens individuais mas nenhum intervalo que conta diz o porquê (histórico, fora do rebanho), não "menos de duas pesagens"', () => {
  const s = S.sistema();
  const id = rebanho(s, [S.bicho({ brinco: '1', sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' })])['1'];
  ok(pesar(s, '2026-02-01', [{ animal_id: id, peso: 300 }]));
  const parc = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Vizinho', tipos: ['COMPRADOR', 'FORNECEDOR'] } }), 'parceiro').partner_id;
  ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-03-01', partner_id: parc, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 400000 }, animais: [{ animal_id: id }], parcelas: [{ data_vencimento: '2026-03-01' }] }), 'venda');
  ok(api(s, 'evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-05-01', partner_id: parc, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 300000 }, parcelas: [{ data_vencimento: '2026-05-01' }], animais: [{ animal_id: id }] }), 'volta');
  ok(pesar(s, '2026-06-01', [{ animal_id: id, peso: 360 }]));
  const f = ok(api(s, 'animal.ficha', { animal_id: id })).peso;
  assert.equal(f.gmd_periodo.valor, null);
  assert.doesNotMatch(f.gmd_periodo.explicacao, /Menos de duas pesagens/);
  assert.match(f.gmd_periodo.explicacao, /fora do rebanho|marco zero/);
});
