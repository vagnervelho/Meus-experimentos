'use strict';
/**
 * Viagem no tempo (conserto da Fase 3 pela garantia, etapa 1; docs/CONTRATOS.md, seção 46): regressões fixas dos defeitos
 * que o oráculo de viagem no tempo do teste aleatório achou (tests/apoio-fuzz.js, `oraculoTempo`) e dos que o conserto pela
 * causa fechou no mesmo ponto (o retrato do animal numa data, Timeline.retratoEm). A propriedade: a resposta pedida numa data
 * D do passado não muda quando se acrescentam fatos com data depois de D (de qualquer tipo, estorno e correção inclusive) nem
 * quando muda um cadastro que não vale para o passado, e não depende da data de hoje.
 *
 * Duas partes: (1) cenários pela api(), um por defeito, que conferem a resposta em D antes e depois do fato posterior (e com o
 * relógio adiantado); (2) as sequências mínimas do teste aleatório, repetidas num sistema novo com o MESMO oráculo de cada
 * passo (o do tempo inclusive: o passo com `tempo` tira o retrato em D, e cada passo seguinte que grava compara).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const F = require('./apoio-fuzz');

const { js, PASTOS } = S;
const AVISOS = ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'IDADE_REPRODUTIVA', 'CARENCIA_ATIVA', 'CATEGORIAS_SEM_COBERTURA'];

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave || 'k-' + Math.random(), avisosAceitos: avisos || AVISOS })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + String(JSON.stringify(r.error)).slice(0, 1500));
  return r.data;
}
const hoje = (s, iso) => { s.gas.clock.now = Date.parse(iso + 'T15:00:00.000Z'); };
/** A mesma consulta com o relógio adiantado `dias` (a resposta pedida numa data não depende de que dia é hoje). */
function comRelogio(s, dias, f) {
  const agora = s.gas.clock.now;
  s.gas.clock.now = agora + dias * 86400000;
  try { return f(); } finally { s.gas.clock.now = agora; }
}
function rebanho(s, bichos, data) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(bichos, data ? { event_date: data } : null)), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
const daLinha = (lista, id) => (lista || []).filter((x) => x.animal_id === id);
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

test('o brinco numa data passada é o daquele dia em toda lista: painel do pasto, dias de permanência, agenda (carência), fêmeas e desempenho — a troca de brinco depois de D não muda a resposta de D, e o relógio adiantado também não', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const id = rebanho(s, [
    S.bicho({ brinco: '100', sexo: 'F', data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '300', sexo: 'M', data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
  ]);
  hoje(s, '2026-03-20');
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-02-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id['100'], peso: 400 }, { animal_id: id['300'], peso: 300 }] }), 'pesagem 1');
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-03-15', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id['100'], peso: 420 }, { animal_id: id['300'], peso: 330 }] }), 'pesagem 2');
  ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-03-10', nome_produto: 'Vermífugo de campo', modo_dose: 'POR_CABECA', dose_referencia: 5, unidade_dose: 'mL', periodo_carencia_dias: 60 }, animais: [{ animal_id: id['100'] }] }), 'vermífugo');
  hoje(s, '2026-04-10');
  const D = '2026-04-01';
  const consultas = () => ({
    painel: ok(api(s, 'pasto.painel', { pasture_id: PASTOS.A, data: D, periodo_inicio: '2026-02-01', periodo_fim: D }), 'painel'),
    agenda: ok(api(s, 'sanidade.agenda', { data: D }), 'agenda'),
    femeas: ok(api(s, 'reproducao.matrizes', { data: D }), 'fêmeas'),
    desempenho: ok(api(s, 'peso.desempenho', { ate: D }), 'desempenho'),
  });
  const brincos = (c) => ({
    painel: daLinha(c.painel.animais, id['100']).map((x) => x.brinco),
    permanencia: daLinha(c.painel.permanencia.itens, id['100']).map((x) => x.brinco),
    carencia: daLinha(c.agenda.carencia, id['100']).map((x) => x.brinco),
    femeas: daLinha(c.femeas.itens, id['100']).map((x) => x.brinco),
    desempenho: daLinha(c.desempenho.animais, id['100']).map((x) => x.brinco),
  });
  const antes = consultas();
  const esperado = { painel: ['100'], permanencia: ['100'], carencia: ['100'], femeas: ['100'], desempenho: ['100'] };
  assert.deepEqual(brincos(antes), esperado, 'o brinco de 01/04 antes da troca');
  // A troca do brinco depois de D (20/05): as listas de 01/04 continuam com o número daquele dia.
  hoje(s, '2026-06-01');
  ok(api(s, 'evento.registrar', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-05-20', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: id['100'], codigo: '150', motivo: 'PERDA' }] }), 'troca do brinco');
  semErro(s, 'troca');
  const depois = consultas();
  assert.deepEqual(brincos(depois), esperado, 'o brinco de 01/04 depois da troca de 20/05 (o número de hoje é 150)');
  assert.deepEqual(js(depois), js(antes), 'nenhuma resposta de 01/04 mudou com a troca de brinco posterior');
  // Hoje, o número novo.
  assert.deepEqual(daLinha(ok(api(s, 'pasto.painel', { pasture_id: PASTOS.A }), 'painel hoje').animais, id['100']).map((x) => x.brinco), ['150']);
  // A data de hoje não entra na resposta pedida numa data: o relógio um ano adiantado dá a mesma resposta.
  assert.deepEqual(js(comRelogio(s, 400, consultas)), js(depois), 'as consultas de 01/04 com o relógio adiantado');
});

test('desempenho de um período passado: a tabela "Animais" traz o pasto, a situação e o brinco do fim do período — a transferência e a venda depois do período não mudam a resposta', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const id = rebanho(s, [S.bicho({ brinco: '500', sexo: 'M', data_nascimento: '2024-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-04-01');
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-01-10', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id['500'], peso: 300 }] }), 'pesagem 1');
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-03-10', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id['500'], peso: 336 }] }), 'pesagem 2');
  const linha = () => daLinha(ok(api(s, 'peso.desempenho', { ate: '2026-03-31' }), 'desempenho').animais, id['500']).map((x) => [x.pasture_id, x.situacao_cadastral, x.brinco, x.gmd.valor]);
  const antes = linha();
  assert.deepEqual(antes, [[PASTOS.A, 'ATIVO', '500', 0.61]], '36 kg em 59 dias');
  hoje(s, '2026-07-01');
  ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-05-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: id['500'] }] }), 'transferência');
  assert.deepEqual(linha(), antes, 'depois da transferência de 01/05');
  const comprador = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } }), 'comprador').partner_id;
  ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-06-10', partner_id: comprador, finalidade: 'RECRIA_ENGORDA', valor_bruto: 300000, modalidade: 'CABECA', preco_unitario: 300000 }, animais: [{ animal_id: id['500'] }], parcelas: [{ data_vencimento: '2026-07-10', valor: 300000 }], deducoes: [] }), 'venda');
  semErro(s, 'venda');
  assert.deepEqual(linha(), antes, 'depois da venda de 10/06');
});

test('estação de monta numa data passada: a estação padrão dos indicadores e a lista de fêmeas da estação contam só os registros até D — a exposição gravada depois de D não muda a resposta de D', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const id = rebanho(s, [
    S.bicho({ brinco: '701', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '702', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
  ]);
  const e1 = ok(api(s, 'estacao.salvar', { campos: { property_id: S.PROP, nome: 'Estação 1', data_inicio: '2026-01-10', data_fim: '2026-03-10', tipo: 'MONTA_NATURAL' } }), 'estação 1').estacao_id;
  const e2 = ok(api(s, 'estacao.salvar', { campos: { property_id: S.PROP, nome: 'Estação 2', data_inicio: '2026-04-01', data_fim: '2026-06-30', tipo: 'MONTA_NATURAL' } }), 'estação 2').estacao_id;
  hoje(s, '2026-02-01');
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-01-15', estacao_id: e1, data_fim: '2026-03-10' }, animais: [{ animal_id: id['701'] }] }), 'exposição na estação 1');
  const D = '2026-04-15';
  const naData = () => ({
    padrao: ok(api(s, 'reproducao.indicadores', { data: D }), 'indicadores').estacao.estacao.estacao_id,
    femeas: ok(api(s, 'reproducao.matrizes', { data: D, estacao_id: e2 }), 'fêmeas da estação 2').itens.map((x) => x.animal_id),
  });
  hoje(s, '2026-04-20');
  const antes = naData();
  assert.deepEqual(antes, { padrao: e1, femeas: [] }, 'em 15/04 a estação 2 ainda não tinha registro');
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-04-18', estacao_id: e2, data_fim: '2026-06-30' }, animais: [{ animal_id: id['702'] }] }), 'exposição na estação 2, depois de D');
  semErro(s, 'exposição 2');
  assert.deepEqual(naData(), antes, 'a exposição de 18/04 não muda a resposta de 15/04');
  assert.equal(ok(api(s, 'reproducao.indicadores', { data: '2026-04-20' }), 'indicadores de 20/04').estacao.estacao.estacao_id, e2, 'em 20/04 a estação padrão já é a 2');
});

test('lista de pastos numa data passada: o pasto desativado depois continua na lista da data em que tinha animal (marcado inativo), e as cabeças por pasto fecham com o rebanho daquele dia', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const id = rebanho(s, [S.bicho({ brinco: '900', pasto_destino_id: PASTOS.B, data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-04-01');
  ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.B, pasto_destino_id: PASTOS.A }, animais: [{ animal_id: id['900'] }] }), 'transferência');
  const D = '2026-02-01';
  const cartoes = () => ok(api(s, 'pasto.listar', { data: D }), 'pastos').map((c) => [c.nome, c.status, c.cabecas]);
  const antes = cartoes();
  assert.deepEqual(antes, [['Pasto A', 'ATIVO', 0], ['Pasto B', 'ATIVO', 1]]);
  ok(api(s, 'pasto.salvar', { pasture_id: PASTOS.B, campos: { status: 'INATIVO' }, justificativa: 'Pasto em reforma' }), 'desativar o Pasto B');
  semErro(s, 'desativado');
  assert.deepEqual(cartoes(), [['Pasto A', 'ATIVO', 0], ['Pasto B', 'INATIVO', 1]], 'o Pasto B, com o animal em 01/02, continua na lista dessa data, marcado inativo');
  assert.deepEqual(ok(api(s, 'pasto.listar', {}), 'pastos hoje').map((c) => c.nome), ['Pasto A'], 'hoje, sem animal, o pasto inativo sai da lista padrão');
});

test('ficha de quem saiu do rebanho: a carência, a aptidão e a cria ao pé são as da data da saída — a desmama da cria depois da saída da mãe e o relógio adiantado não mudam a ficha', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const id = rebanho(s, [
    S.bicho({ brinco: '210', sexo: 'F', data_nascimento: '2024-06-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '220', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
  ]);
  hoje(s, '2026-03-05');
  const cria = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-01' }, animais: [{ animal_id: id['220'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '221' }] }), 'parto').animais.find((a) => a.brinco === '221').animal_id;
  ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-02-20', nome_produto: 'Vermífugo de campo', modo_dose: 'POR_CABECA', dose_referencia: 5, unidade_dose: 'mL', periodo_carencia_dias: 30 }, animais: [{ animal_id: id['210'] }] }), 'vermífugo');
  const comprador = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Vizinho', tipos: ['COMPRADOR'] } }), 'comprador').partner_id;
  ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-03-01', partner_id: comprador, finalidade: 'RECRIA_ENGORDA', valor_bruto: 400000, modalidade: 'CABECA', preco_unitario: 200000 }, animais: [{ animal_id: id['210'] }, { animal_id: id['220'] }], parcelas: [{ data_vencimento: '2026-04-01', valor: 400000 }], deducoes: [] }), 'venda das duas, a cria fica');
  semErro(s, 'venda');
  const calculos = () => {
    const nova = ok(api(s, 'animal.ficha', { animal_id: id['210'] }), 'ficha 210');
    const mae = ok(api(s, 'animal.ficha', { animal_id: id['220'] }), 'ficha 220');
    return {
      carencia: nova.sanitario.carencia && nova.sanitario.carencia.fim, apta: nova.reprodutivo.apta, idade: nova.geral.idade_meses,
      cria_ao_pe: [mae.geral.cria_ao_pe, mae.reprodutivo.cria_ao_pe], referencia: [nova.geral.data_referencia, mae.geral.data_referencia],
    };
  };
  const antes = calculos();
  assert.deepEqual(antes, { carencia: '2026-03-22', apta: false, idade: 21, cria_ao_pe: [true, true], referencia: ['2026-03-01', '2026-03-01'] }, 'na saída: em carência até 22/03, novilha de 21 meses (não apta), a vaca com a cria ao pé');
  hoje(s, '2026-11-13');
  ok(api(s, 'evento.registrar', { tipo: 'DESMAMA', campos: { event_date: '2026-09-01' }, animais: [{ animal_id: cria }] }), 'desmama da cria, depois da saída da mãe');
  semErro(s, 'desmama');
  assert.deepEqual(calculos(), antes, 'a ficha de quem saiu é a do dia da saída (hoje a novilha teria 29 meses e a carência teria acabado)');
  assert.deepEqual(comRelogio(s, 400, calculos), antes, 'e não depende de que dia é hoje');
});

test('o retrato do animal numa data (Timeline.retratoEm) é o mesmo projetor do estado de hoje sobre os fatos até a data: em hoje, a projeção gravada; antes da troca de brinco, da transferência e da venda, o estado daquele dia', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const id = rebanho(s, [S.bicho({ brinco: '40', sexo: 'M', data_nascimento: '2023-05-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-08-01');
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-02-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id['40'], peso: 380 }] }), 'pesagem');
  ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: id['40'] }] }), 'transferência');
  ok(api(s, 'evento.registrar', { tipo: 'CASTRACAO', campos: { event_date: '2026-04-01' }, animais: [{ animal_id: id['40'] }] }), 'castração');
  ok(api(s, 'evento.registrar', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-05-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: id['40'], codigo: '41', motivo: 'PERDA' }] }), 'troca do brinco');
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-06-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id['40'], peso: 450 }] }), 'pesagem 2');
  semErro(s, 'base');
  const retratos = s.read({
    rota: 'teste.retratos', reads: s.G.AnimalService.leituras(), acessoCru: true,
    tratador: (tx) => {
      const f = s.G.Timeline.fonte(tx);
      const r = (d) => { const x = s.G.Timeline.retratoEm(f, id['40'], d, []); return x ? [x.brinco, x.pasto_atual_id, x.situacao_cadastral, x.castrado, x.reprodutor, x.peso_atual, x.data_ultima_pesagem] : null; };
      return { antes: r('2025-12-31'), d0: r('2026-01-01'), fev: r('2026-02-15'), mar: r('2026-03-15'), abr: r('2026-04-15'), mai: r('2026-05-15'), hoje: r(tx.hoje), registro: tx.repo.porId('ANIMAIS', id['40']) };
    },
  });
  assert.equal(retratos.antes, null, 'antes do marco zero o animal ainda não estava no sistema');
  assert.deepEqual(retratos.d0, ['40', PASTOS.A, 'ATIVO', false, false, null, null]);
  assert.deepEqual(retratos.fev, ['40', PASTOS.A, 'ATIVO', false, false, 380, '2026-02-01']);
  assert.deepEqual(retratos.mar, ['40', PASTOS.B, 'ATIVO', false, false, 380, '2026-02-01']);
  assert.deepEqual(retratos.abr, ['40', PASTOS.B, 'ATIVO', true, false, 380, '2026-02-01']);
  assert.deepEqual(retratos.mai, ['41', PASTOS.B, 'ATIVO', true, false, 380, '2026-02-01']);
  const g = retratos.registro;
  assert.deepEqual(retratos.hoje, [g.brinco, g.pasto_atual_id, g.situacao_cadastral, g.castrado, g.reprodutor, g.peso_atual, g.data_ultima_pesagem], 'em hoje, a projeção gravada');
});

test('resolução do brinco numa data passada: a importação de manejo acha pelo número o mesmo animal que a posição daquela data (o número corrigido por IDENTIFICACAO_INCORRETA vale desde o início do errado, e o errado nunca esteve na orelha)', () => {
  const s = S.sistema({ config: { importacao_lote_linhas: '50', brinco_permite_reuso: 'S' } });
  hoje(s, '2026-07-01');
  const r = ok(api(s, 'evento.registrar', S.entradaInicial([S.bicho({ brinco: '55', data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' }), S.bicho({ data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' })])), 'rebanho');
  const [B, A] = r.animais.map((x) => x.animal_id);
  const ident = (sub, data, an) => ok(api(s, 'evento.registrar', { tipo: 'IDENTIFICACAO', subtipo: sub, campos: { event_date: data, tipo_identificacao: 'BRINCO' }, animais: [an] }), sub);
  ident('SUBSTITUICAO', '2026-02-01', { animal_id: B, codigo: '56', motivo: 'PERDA' });
  ident('PRIMEIRA_IDENTIFICACAO', '2026-02-15', { animal_id: A, codigo: '50' });
  ok(api(s, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: '2026-06-01', justificativa: 'Brinco digitado errado' }, animais: [{ animal_id: A, brinco: '55' }] }), 'o 50 era o 55');
  semErro(s, 'identificações');
  // A posição de 01/03 (a do curral com data passada): o 55 é de A desde 15/02.
  const eleg = ok(api(s, 'inventario.elegiveis', { tipo: 'PESAGEM', data: '2026-03-01' }), 'elegíveis').itens;
  assert.deepEqual(eleg.map((x) => [x.animal_id, x.brinco]).sort(), [[A, '55'], [B, '56']].sort());
  const mapa = { colunas: { Data: 'data', Brinco: 'brinco', Peso: 'peso', Momento: 'momento', 'Método': 'metodo' }, confiancas: {}, padroes: {} };
  const linha = (brinco) => {
    const csv = ['Data;Brinco;Peso;Momento;Método', '01/03/2026;' + brinco + ';410;rotina;balança'].join('\n');
    const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'c' + brinco, dados: { tipo: 'PESAGENS', arquivo_nome: 'p' + brinco + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
    s.tentar((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'v' + brinco, dados: { import_id: c.import_id, bloco: 1, mapeamento: mapa } }));
    const l = s.read(s.G.ImportService.consultaLinhas({ import_id: c.import_id })).itens[0];
    return { import_id: c.import_id, status: l.status, erros: l.erros.map((e) => e.codigo) };
  };
  // A linha de 01/03 com o 55 é de A (antes do conserto: "o brinco 55 não estava em uso em 01/03"); com o 50, o número que
  // nunca esteve na orelha, nenhum animal (antes: A, pelo período do número errado).
  const com55 = linha('55');
  assert.deepEqual([com55.status, com55.erros], ['VALIDA', []]);
  const com50 = linha('50');
  assert.deepEqual([com50.status, com50.erros], ['ERRO', ['ANIMAL_NAO_ENCONTRADO']]);
  // Importada, a pesagem de 01/03 vai para A.
  const imp = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE'], dados: { import_id: com55.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(imp.ok, JSON.stringify(imp.erro));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: com55.import_id } }));
  semErro(s, 'importada');
  assert.deepEqual(s.tabela('PESAGENS').filter((p) => p.data_pesagem === '2026-03-01').map((p) => [p.animal_id, p.peso_kg]), [[A, 410]]);
});

test('o brinco da mãe no marco zero, na importação de ANIMAIS, segue a mesma regra do brinco numa data: o número corrigido por IDENTIFICACAO_INCORRETA acha a vaca, e o errado (que nunca esteve na orelha) não acha', () => {
  const s = S.sistema({ config: { importacao_lote_linhas: '50' } });
  hoje(s, '2026-07-01');
  const M = ok(api(s, 'evento.registrar', S.entradaInicial([S.bicho({ brinco: '50', data_nascimento: '2019-01-10', data_nascimento_confianca: 'CONFIRMADA' })])), 'rebanho').animais[0].animal_id;
  ok(api(s, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: '2026-06-01', justificativa: 'Brinco digitado errado' }, animais: [{ animal_id: M, brinco: '55' }] }), 'o 50 era o 55');
  semErro(s, 'correção');
  // A posição do marco zero diz que a vaca tinha o 55 (desde o início do 50, que nunca esteve na orelha).
  const pos = ok(api(s, 'inventario.elegiveis', { tipo: 'PESAGEM', data: S.D0 }), 'elegíveis').itens;
  assert.deepEqual(pos.map((x) => [x.animal_id, x.brinco]), [[M, '55']]);
  const MAPA = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', 'Mãe': 'mae', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA', mae: 'CONFIRMADA' }, padroes: { castrado: false, reprodutor: false } };
  const linha = (mae) => {
    const csv = 'Brinco;Sexo;Nasc.;Mãe;Pasto\n7' + mae + ';F;01/10/2025;' + mae + ';Pasto A';
    const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'a' + mae, dados: { tipo: 'ANIMAIS', arquivo_nome: 'a' + mae + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
    s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'v' + mae, dados: { import_id: c.import_id, bloco: 1, mapeamento: MAPA } }));
    const l = s.read(s.G.ImportService.consultaLinhas({ import_id: c.import_id })).itens[0];
    return { import_id: c.import_id, status: l.status, erros: l.erros.map((e) => e.codigo) };
  };
  // Antes do conserto, o 50 (o número errado) achava a vaca no marco zero pelo período gravado dele.
  const com50 = linha('50');
  assert.deepEqual([com50.status, com50.erros], ['ERRO', ['MAE_NAO_ENCONTRADA']]);
  const com55 = linha('55');
  assert.deepEqual([com55.status, com55.erros], ['VALIDA', []]);
  const imp = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: com55.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(imp.ok, JSON.stringify(imp.erro));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: com55.import_id } }));
  semErro(s, 'importada');
  assert.equal(s.tabela('ANIMAIS').find((a) => a.brinco === '755').mae_id, M);
});

// ------------------------------------------------------------------ sequências mínimas do teste aleatório ----
const TODOS = F.AVISOS;
const passo = (k, rota, dados, extra) => Object.assign({ k, rota, dados, avisos: TODOS, aceitar: true }, extra || {});
const CASOS = [
  {
    // Semente 3110000 (TEMPO:painel): o painel do Pasto D em 25/04 trazia o brinco de hoje; a retirada do brinco em 26/10
    // mudava a lista de animais de 25/04 (o retrato daquele dia agora vem de Timeline.retratoEm).
    nome: 'retirada do brinco depois de D: o painel do pasto em D continua com o número daquele dia',
    opcoes: { ordem: 'reverse', reuso: false, vazio: false },
    comandos: [
      passo(0, 'evento.registrar', { tipo: 'ENTRADA_INICIAL', campos: { event_date: '2026-01-01' }, animais: [{ sexo: 'F', pasto_destino_id: '@p:D', origem: 'DESCONHECIDA', brinco: '101', data_nascimento: '2021-05-19', data_nascimento_confianca: 'ESTIMADA', situacao_reprodutiva: 'PRENHA', data_prevista_parto: '2026-07-08' }] }),
      passo(2, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: '2026-01-01', justificativa: 'Categoria conferida no curral' }, animais: [{ animal_id: '@0.a0', categoria_manual_id: null }] }, { avisos: [], aceitar: false, simular: true, tempo: { D: '2026-04-25', avanco: 1 } }),
      passo(15, 'evento.registrar', { tipo: 'IDENTIFICACAO', subtipo: 'REMOCAO', campos: { event_date: '2026-10-26', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: '@b:3', motivo: 'RENUMERACAO' }, { animal_id: '@b:1', motivo: 'RENUMERACAO' }] }, { simular: true }),
    ],
  },
  {
    // Semente 3110003 (TEMPO:matE): a lista de fêmeas da estação em 13/09 trazia a exposição gravada com data de 14/09.
    nome: 'exposição na estação depois de D e estornada: a lista de fêmeas da estação em D não muda',
    opcoes: { ordem: 'reverse', reuso: false, vazio: false },
    comandos: [
      passo(5, 'estacao.salvar', { campos: { nome: 'Estação P5', data_inicio: '2026-09-14', data_fim: '2026-11-13', tipo: 'MISTA' } }, { avisos: [] }),
      passo(7, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-09-14', estacao_id: '@5.s0', data_fim: '2026-12-13' }, animais: [{ animal_id: '@b:1' }] }, { avisos: [] }),
      passo(19, 'evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-06-19', partner_id: '@f:fornecedor', valor_animais: 978096, pasto_destino_id: '@p:A', modalidade: 'ARROBA', preco_unitario: 29296, base_peso: 'CARCACA' }, animais: [{ sexo: 'M', pasto_destino_id: '@p:B', brinco: '12', idade_meses: 83, castrado: false, reprodutor: false, brinco_origem: 'V6', peso_carcaca_kg: 261.9 }, { sexo: 'M', pasto_destino_id: '@p:B', brinco: '3', data_nascimento: '2019-10-30', data_nascimento_confianca: 'ESTIMADA', castrado: true, reprodutor: false, peso_carcaca_kg: 238.9 }], parcelas: [{ data_vencimento: '2026-07-19' }, { data_vencimento: '2026-08-18' }], custos: [] }, { avisos: [], tempo: { D: '2026-09-13', avanco: 31 } }),
      passo(24, 'evento.estornar', { event_id: '@7.e0', justificativa: 'Lançado errado' }, { avisos: [] }),
    ],
  },
  {
    // Semente 3110019 (TEMPO:desemp): a tabela do desempenho até 01/01 dizia VENDIDO pela venda de 10/09.
    nome: 'venda depois do fim do período: a tabela de animais do desempenho do período continua com o animal no rebanho',
    opcoes: { ordem: 'reverse', reuso: true, vazio: false },
    comandos: [
      passo(1, 'evento.registrar', { tipo: 'ENTRADA_INICIAL', campos: { event_date: '2026-01-01' }, animais: [{ sexo: 'M', pasto_destino_id: '@p:A', origem: 'DESCONHECIDA', brinco: 'V26', raca: 'NELORE', data_nascimento: '2018-04-01', data_nascimento_confianca: 'ESTIMADA', castrado: true, reprodutor: false, data_entrada: '2025-09-23', data_entrada_confianca: 'ESTIMADA', peso: 153.2, metodo_pesagem: 'BALANCA' }] }),
      passo(3, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-01-01', partner_id: '@f:comprador', finalidade: 'ABATE', valor_bruto: 240288, modalidade: 'KG_VIVO', preco_unitario: 1067 }, animais: [{ animal_id: '@b:1', peso: 225.2 }], parcelas: [{ data_vencimento: '2026-01-31', valor: 120144 }, { data_vencimento: '2026-03-02', valor: 120144 }], deducoes: [{ tipo: 'COMISSAO', valor: 1, partner_id: '@f:corretor' }, { tipo: 'FUNRURAL', valor: 1500, retida_pelo_comprador: true }] }, { tempo: { D: '2026-01-01', avanco: 400 } }),
      passo(4, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-09-10', partner_id: '@f:comprador', finalidade: 'RECRIA_ENGORDA', valor_bruto: 250000, modalidade: 'CABECA', preco_unitario: 250000 }, animais: [{ animal_id: '@1.a0' }], parcelas: [{ data_vencimento: '2026-10-10', valor: 250000 }], deducoes: [] }, { avisos: [] }),
    ],
  },
  {
    // Semente 3110013 (TEMPO:RELOGIO:ficha): a ficha da vaca vendida hoje calculava a carência pela data de hoje, e o relógio
    // adiantado mudava a resposta (a carência é a da data de referência da ficha, a da saída).
    nome: 'aplicação no dia da venda: a carência da ficha de quem saiu é a do dia da saída, com qualquer relógio',
    opcoes: { ordem: 'alpha', reuso: false, vazio: false },
    comandos: [
      passo(20, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-11-13', partner_id: '@f:comprador', finalidade: 'RECRIA_ENGORDA', valor_bruto: 355265, modalidade: 'LOTE', criterio_rateio: 'CABECAS' }, animais: [{ animal_id: '@b:5' }], parcelas: [{ data_vencimento: '2026-12-13', valor: 118422 }, { data_vencimento: '2027-01-12', valor: 118422 }, { data_vencimento: '2027-02-11', valor: 118421 }], deducoes: [{ tipo: 'FRETE', valor: 1, partner_id: '@f:corretor' }, { tipo: 'FUNRURAL', valor: 1500, retida_pelo_comprador: true }] }, { avisos: [] }),
      passo(25, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-11-13', produto_id: '@v:vermifugo', modo_dose: 'POR_CABECA', dose_referencia: 2, periodo_carencia_dias: 45 }, animais: [{ animal_id: '@b:5' }] }, { simular: true, tempo: { D: '2026-05-15', avanco: 400 } }),
    ],
  },
  {
    // Semente 3110016 (TEMPO:PASTO_SUMIU): desativado o Pasto D, a lista de pastos de 28/06 perdia o pasto que tinha um
    // animal nesse dia.
    nome: 'pasto desativado depois de D: continua na lista de pastos de D, com a cabeça daquele dia',
    opcoes: { ordem: 'reverse', reuso: false, vazio: false },
    comandos: [
      passo(1, 'parceiro.salvar', { campos: { nome: 'Parceiro 1', tipos: ['OUTRO'] } }, { simular: true }),
      passo(5, 'evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-01-01', partner_id: '@1.f0', valor_animais: 5, pasto_destino_id: '@p:D', modalidade: 'CABECA' }, animais: [{ sexo: 'M', pasto_destino_id: '@p:C', brinco: '82', idade_meses: 67, castrado: false, reprodutor: false, brinco_origem: 'V3', valor_individual: 2 }, { sexo: 'M', pasto_destino_id: '@p:D', brinco: '103', idade_meses: 59, castrado: false, reprodutor: true, brinco_origem: 'V3', valor_individual: 1 }, { sexo: 'M', pasto_destino_id: '@p:B', brinco: '85', data_nascimento: '2021-11-18', data_nascimento_confianca: 'ESTIMADA', castrado: false, reprodutor: false, brinco_origem: 'V13', valor_individual: 2 }], parcelas: [{ data_vencimento: '2026-01-31', valor: 2 }, { data_vencimento: '2026-03-02', valor: 2 }, { data_vencimento: '2026-04-01', valor: 1 }], custos: [] }, { tempo: { D: '2026-01-02', avanco: 400 } }),
      passo(25, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-07-13', partner_id: '@f:corretor', finalidade: 'RECRIA_ENGORDA', valor_bruto: 2, modalidade: 'LOTE', criterio_rateio: 'CABECAS' }, animais: [{ animal_id: '@b:7' }, { animal_id: '@b:5' }, { animal_id: '@5.a1' }], parcelas: [{ data_vencimento: '2026-08-12', valor: 1 }, { data_vencimento: '2026-09-11', valor: 1 }], deducoes: [] }, { simular: true }),
      passo(85, 'pasto.salvar', { pasture_id: '@p:D', campos: { status: 'INATIVO' }, justificativa: 'Pasto em reforma' }, { aceitar: false, simular: true, tempo: { D: '2026-06-28', avanco: 400 } }),
    ],
  },
  {
    // Semente 3110030 (TEMPO:ficha): a ficha da vaca morta em 01/01 dizia a cria ao pé de hoje; o descarte da cria em 14/09
    // mudava a ficha (a cria ao pé da ficha é a da data de referência, a da saída).
    nome: 'saída da cria depois da morte da mãe: a cria ao pé da ficha da mãe é a do dia em que ela saiu',
    opcoes: { ordem: 'reverse', reuso: false, vazio: false },
    comandos: [
      passo(23, 'evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-01-01', causa: 'PICADA_COBRA' }, animais: [{ animal_id: '@b:2' }, { animal_id: '@b:1' }] }, { avisos: [], simular: true }),
      passo(31, 'config.salvar', { valores: { brinco_permite_reuso: 'N' } }, { tempo: { D: '2026-11-13', avanco: 400 } }),
      passo(56, 'evento.registrar', { tipo: 'DESCARTE', campos: { event_date: '2026-09-14', destino: 'CONSUMO_PROPRIO', motivo: 'IDADE' }, animais: [{ animal_id: '@b:8' }] }, { simular: true }),
    ],
  },
  {
    // Semente 3110020, no modelo do teste (assinatura TEMPO:ficha): a volta da vaca vendida (outra entrada) muda a data de
    // referência da ficha para hoje, por desenho (a ficha de quem está no rebanho é a de hoje). O oráculo passou a incluir a
    // situação e a saída de hoje na impressão da ficha: a volta não é comparada com o retrato da saída.
    nome: 'volta ao rebanho de quem saiu (modelo do teste): a ficha passa a ser a de hoje, por desenho',
    opcoes: { ordem: 'reverse', reuso: true, vazio: false },
    comandos: [
      passo(26, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-01-01', partner_id: '@f:comprador', finalidade: 'RECRIA_ENGORDA', valor_bruto: 199999, modalidade: 'CABECA', preco_unitario: 199999 }, animais: [{ animal_id: '@b:1' }], parcelas: [{ data_vencimento: '2026-01-31', valor: 66667 }, { data_vencimento: '2026-03-02', valor: 66666 }, { data_vencimento: '2026-04-01', valor: 66666 }], deducoes: [] }, { avisos: [], simular: true }),
      passo(91, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: '2026-11-06', justificativa: 'Brinco digitado errado' }, animais: [{ animal_id: '@b:7', brinco: '76' }] }, { avisos: [], tempo: { D: '2026-10-22', avanco: 1 } }),
      passo(97, 'evento.registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-03-18', description: 'Apareceu na divisa' }, animais: [{ animal_id: '@b:1', pasto_destino_id: '@p:D' }] }, { avisos: [], aceitar: false }),
    ],
  },
];

CASOS.forEach((caso) => {
  test('regressão do oráculo de viagem no tempo: ' + caso.nome, () => {
    const fora = {};
    const falha = F.reproduzir(caso.opcoes, caso.comandos, fora);
    assert.equal(falha, null, falha ? 'passo ' + falha.k + ' [' + falha.assinatura + ']: ' + falha.mensagem : '');
    // O retrato em D foi tirado e cada passo seguinte foi executado (o desfecho de cada um é o do sistema de hoje).
    assert.deepEqual(Object.keys(fora.resultados).map(Number), caso.comandos.map((c) => c.k));
  });
});
