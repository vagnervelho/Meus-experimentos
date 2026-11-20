'use strict';
/**
 * Indicadores reprodutivos (07, seção 8.3; 09, RN-066; rota `reproducao.indicadores`), número a número: a estação com o
 * exemplo de 07 (80 expostas) e o de 09 (40 expostas), por categoria, cobertura do diagnóstico abaixo do mínimo ("prenhez
 * entre diagnosticadas"), denominador zero e abaixo do mínimo (null com DADOS_INSUFICIENTES, nunca zero), a fêmea que saiu
 * no meio da estação, o rótulo "parcial", a perda gestacional (aborto e janela encerrada), a desmama e a mortalidade até a
 * desmama (com o corte da idade padrão), o IEP, a idade ao primeiro parto e a forma anual sem estação.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js } = S;

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave, avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + JSON.stringify(r.error));
  return r.data;
}
const tx = (t) => [t.valor, t.numerador, t.denominador, t.motivo];
const ESTACAO = { nome: 'Estação 25/26', data_inicio: '2026-01-10', data_fim: '2026-03-31', tipo: 'MONTA_NATURAL' };

/**
 * Uma safra inteira por lançamentos: `vacas` (paridas antes, partos_previos 1) e `novilhas` (2023, sem parto) expostas
 * ao touro na estação em 10/01/2026 (retirada em 31/03); o diagnóstico em 15/05 das primeiras `diagnosticadas` (as
 * primeiras `prenhas` positivas, com 120 dias); o parto em 25/10 das primeiras `paridas` (a primeira, gêmeos); aborto em
 * 01/07 das `abortos` seguintes; as crias: as primeiras `mortos` morrem em 01/12, as `vendidos` seguintes vão vendidas ao
 * pé em 15/01/2027 e as `desmamados` seguintes são desmamadas em 01/05/2027. Ordem das fêmeas: as vacas, depois as novilhas.
 */
function safra(o) {
  const s = S.sistema();
  s.gas.clock.now = Date.parse((o.hoje || '2027-06-01') + 'T15:00:00.000Z');
  const femeas = [];
  for (let i = 0; i < o.vacas; i++) femeas.push(S.bicho({ brinco: 'V' + String(i).padStart(3, '0'), data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }));
  for (let i = 0; i < (o.novilhas || 0); i++) femeas.push(S.bicho({ brinco: 'N' + String(i).padStart(3, '0'), data_nascimento: '2023-06-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 0 }));
  const touro = S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' });
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(femeas.concat([touro])), 'rebanho'), 'rebanho');
  const id = {};
  r.animais.forEach((a) => { id[a.brinco] = a.animal_id; });
  const ids = femeas.map((f) => id[f.brinco]);
  const est = ok(api(s, 'estacao.salvar', { campos: ESTACAO }, 'est'), 'estação');
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-01-10', estacao_id: est.estacao_id }, animais: ids.concat([id.T1]).map((animal_id) => ({ animal_id })) }, 'exp'), 'exposição');
  if (o.diagnosticadas) {
    const animais = ids.slice(0, o.diagnosticadas).map((animal_id, i) => (i < o.prenhas ? { animal_id, resultado: 'POSITIVO', idade_gestacional_dias: 120 } : { animal_id, resultado: 'NEGATIVO' }));
    ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-05-15', estacao_id: est.estacao_id }, animais }, 'dg'), 'diagnóstico');
  }
  for (let i = 0; i < (o.paridas || 0); i++) {
    const crias = i === 0 && o.gemeos ? [{ situacao_nascimento: 'VIVO', sexo: 'F' }, { situacao_nascimento: 'VIVO', sexo: 'M' }] : [{ situacao_nascimento: 'VIVO', sexo: i % 2 ? 'M' : 'F' }];
    ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: o.data_parto || '2026-10-25' }, animais: [{ animal_id: ids[i] }], crias }, 'parto-' + i), 'parto ' + i);
  }
  for (let i = 0; i < (o.abortos || 0); i++) {
    const k = o.paridas + i;
    ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'ABORTO', campos: { event_date: '2026-07-01' }, animais: [{ animal_id: ids[k], idade_gestacional_dias: 165 }] }, 'aborto-' + i), 'aborto ' + i);
  }
  const crias = s.tabela('ANIMAIS').filter((a) => ids.includes(a.mae_id)).sort((a, b) => ids.indexOf(a.mae_id) - ids.indexOf(b.mae_id) || (a.sexo < b.sexo ? -1 : 1)).map((a) => a.animal_id);
  let k = 0;
  if (o.mortos) {
    ok(api(s, 'evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-12-01', causa: 'DOENCA' }, animais: crias.slice(k, k + o.mortos).map((animal_id) => ({ animal_id })) }, 'mortes'), 'mortes');
    k += o.mortos;
  }
  if (o.vendidos) {
    const comp = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Vizinho', tipos: ['COMPRADOR'] } }, 'comp')).partner_id;
    const vend = crias.slice(k, k + o.vendidos);
    ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2027-01-15', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 150000, valor_bruto: 150000 * vend.length }, animais: vend.map((animal_id) => ({ animal_id })), parcelas: [{ data_vencimento: '2027-01-15' }] }, 'venda'), 'venda ao pé');
    k += o.vendidos;
  }
  if (o.desmamados) {
    ok(api(s, 'evento.registrar', { tipo: 'DESMAMA', campos: { event_date: '2027-05-01' }, animais: crias.slice(k, k + o.desmamados).map((animal_id) => ({ animal_id })) }, 'desmama'), 'desmama');
  }
  return { s, ids, crias, estacao: est, touro: id.T1 };
}
function indicadores(s, dados) {
  return ok(api(s, 'reproducao.indicadores', dados || {}), 'indicadores');
}

test('07, seção 8.3 (o exemplo): 80 expostas, 76 diagnosticadas, 64 prenhas, 60 paridas, 61 nascidos vivos (um gemelar), 4 mortos, 1 vendido ao pé e 56 desmamados → prenhez 80,0% (84,2% entre diagnosticadas), parição 75,0%, natalidade 76,3%, perda gestacional 6,3%, desmama 70,0%, mortalidade até a desmama 6,6%; por categoria (vacas × novilhas, com a cobertura das novilhas abaixo de 90%); a idade ao primeiro parto; IEP sem intervalo registrado → null', () => {
  const { s, estacao } = safra({ vacas: 50, novilhas: 30, diagnosticadas: 76, prenhas: 64, paridas: 60, gemeos: true, abortos: 2, mortos: 4, vendidos: 1, desmamados: 56 });
  const r = indicadores(s, { estacao_id: estacao.estacao_id });
  assert.equal(r.estacao.estacao.estacao_id, estacao.estacao_id);
  const g = r.estacao.geral;
  assert.deepEqual([g.expostas, g.diagnosticadas, g.prenhas, g.paridas, g.nascidos_vivos, g.mortos_antes_da_desmama, g.vendidos_ao_pe, g.desmamados, g.crias_ao_pe, g.sairam_sem_diagnostico, g.sairam_sem_desfecho],
    [80, 76, 64, 60, 61, 4, 1, 56, 0, 0, 0]);
  assert.deepEqual(tx(g.cobertura_dg), [95, 76, 80, null]);
  assert.deepEqual(tx(g.prenhez), [80, 64, 80, null]);
  assert.equal(g.prenhez.rotulo, 'Taxa de prenhez');
  assert.deepEqual(tx(g.prenhez_entre_diagnosticadas), [84.2, 64, 76, null]);
  assert.deepEqual(tx(g.paricao), [75, 60, 80, null]);
  assert.deepEqual(tx(g.natalidade), [76.3, 61, 80, null]);
  assert.deepEqual(tx(g.perda_gestacional), [6.3, 4, 64, null], 'dois abortos e duas prenhas com a janela de parto encerrada (04/02/2027) sem parto');
  assert.deepEqual(tx(g.desmama), [70, 56, 80, null]);
  assert.deepEqual(tx(g.mortalidade_ate_desmama), [6.6, 4, 61, null], 'o vendido ao pé fica à parte');
  assert.deepEqual([g.paricao.parcial, g.perda_gestacional.parcial, g.desmama.parcial, g.mortalidade_ate_desmama.parcial], [null, null, null, null], 'janela encerrada, nenhuma cria ao pé');
  assert.deepEqual(js(g.iep_dias), { valor: null, motivo: 'DADOS_INSUFICIENTES', n: 0 }, 'as vacas trouxeram o parto anterior em partos_previos: não há intervalo registrado');
  assert.deepEqual(js(g.idade_primeiro_parto_meses), { valor: 40, motivo: null, n: 10 }, 'as dez novilhas de 01/06/2023 que pariram em 25/10/2026: 40 meses');
  // Por categoria, na data da exposição: as 50 vacas e as 30 novilhas (24 meses ou mais).
  const cat = Object.fromEntries(r.estacao.por_categoria.map((c) => [c.nome, c]));
  assert.deepEqual(Object.keys(cat).sort(), ['Novilha (24 meses ou mais)', 'Vaca']);
  const v = cat.Vaca;
  assert.deepEqual([v.expostas, tx(v.prenhez), tx(v.paricao), tx(v.natalidade), tx(v.perda_gestacional)], [50, [100, 50, 50, null], [100, 50, 50, null], [102, 51, 50, null], [0, 0, 50, null]]);
  const n = cat['Novilha (24 meses ou mais)'];
  assert.deepEqual(tx(n.cobertura_dg), [86.7, 26, 30, null]);
  assert.deepEqual([tx(n.prenhez), n.prenhez.rotulo], [[53.8, 14, 26, null], 'Prenhez entre diagnosticadas'], 'cobertura abaixo de 90%: o denominador passa a ser as diagnosticadas');
  assert.deepEqual([tx(n.paricao), tx(n.perda_gestacional)], [[33.3, 10, 30, null], [28.6, 4, 14, null]]);
  assert.equal(v.expostas + n.expostas, g.expostas);
  // Matrizes ativas na data: as 80 fêmeas (as vacas e as novilhas aptas); prenhas = as 2 sem desfecho... que a projeção ainda dá como PRENHA.
  assert.deepEqual(js(r.matrizes), { ativas: 80, prenhas: 2, sem_informacao: 0, sem_historico: 0, motivo: null });
  assert.equal(r.anual, null);
  // A estação mais recente com expostas é a padrão.
  assert.equal(indicadores(s).estacao.estacao.estacao_id, estacao.estacao_id);
});

test('09, RN-066: 40 expostas, 38 diagnosticadas, 32 prenhas, 30 paridas, 31 nascidos vivos → prenhez 80,0%, parição 75,0%, natalidade 77,5%; com 4 expostas, todos null com DADOS_INSUFICIENTES (nunca zero); estação sem expostas: denominador zero, null', () => {
  const a = safra({ vacas: 40, diagnosticadas: 38, prenhas: 32, paridas: 30, gemeos: true, hoje: '2027-03-01' });
  const g = indicadores(a.s, { estacao_id: a.estacao.estacao_id }).estacao.geral;
  assert.deepEqual([tx(g.prenhez), tx(g.paricao), tx(g.natalidade)], [[80, 32, 40, null], [75, 30, 40, null], [77.5, 31, 40, null]]);
  const b = safra({ vacas: 4, diagnosticadas: 4, prenhas: 3, paridas: 3, hoje: '2027-03-01' });
  const h = indicadores(b.s, { estacao_id: b.estacao.estacao_id }).estacao.geral;
  for (const k of ['cobertura_dg', 'prenhez', 'paricao', 'natalidade', 'perda_gestacional', 'desmama', 'mortalidade_ate_desmama']) {
    if (k === 'cobertura_dg') { assert.deepEqual(tx(h[k]), [100, 4, 4, null], 'a cobertura do diagnóstico não é taxa do rebanho: mostrada com qualquer n'); continue; }
    assert.equal(h[k].valor, null, k);
    assert.equal(h[k].motivo, 'DADOS_INSUFICIENTES', k);
  }
  assert.deepEqual([h.prenhez.numerador, h.prenhez.denominador, h.paricao.numerador], [3, 4, 3], 'numerador e denominador continuam à mostra');
  // Uma estação nova sem nenhuma exposta: denominador zero.
  const vazia = ok(api(b.s, 'estacao.salvar', { campos: { nome: 'Estação 26/27', data_inicio: '2026-11-01', data_fim: '2027-01-31', tipo: 'IA' } }, 'est2'));
  const ze = indicadores(b.s, { estacao_id: vazia.estacao_id }).estacao;
  const z = ze.geral;
  assert.deepEqual([z.expostas, tx(z.prenhez), tx(z.paricao), tx(z.cobertura_dg)], [0, [null, 0, 0, 'DADOS_INSUFICIENTES'], [null, 0, 0, 'DADOS_INSUFICIENTES'], [null, 0, 0, 'DADOS_INSUFICIENTES']]);
  assert.deepEqual(ze.por_categoria, []);
  // O parâmetro indicador_n_minimo: com 4, as 4 expostas já dão taxa.
  ok(api(b.s, 'config.salvar', { valores: { indicador_n_minimo: 4 } }, 'cfg'));
  assert.deepEqual(tx(indicadores(b.s, { estacao_id: b.estacao.estacao_id }).estacao.geral.prenhez), [75, 3, 4, null]);
});

test('quem saiu no meio da estação: vendida antes do diagnóstico sai do denominador da prenhez; prenha vendida antes do parto sai do da parição, da natalidade, da desmama e da perda; a vazia descartada continua contando; o rótulo "parcial" enquanto houver prenha com a janela de parto aberta', () => {
  const { s, ids, estacao } = safra({ vacas: 10, hoje: '2026-04-01' });
  const comp = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } }, 'comp')).partner_id;
  const venda = (data, lista, chave) => ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: data, partner_id: comp, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 400000 * lista.length }, animais: lista.map((animal_id) => ({ animal_id })), parcelas: [{ data_vencimento: data }] }, chave), chave);
  venda('2026-04-01', [ids[9]], 'v-antes-dg');
  s.gas.clock.now = Date.parse('2026-06-01T15:00:00.000Z');
  const dg = ids.slice(0, 9).map((animal_id, i) => (i < 7 ? { animal_id, resultado: 'POSITIVO', idade_gestacional_dias: 120 } : { animal_id, resultado: 'NEGATIVO' }));
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-05-15', estacao_id: estacao.estacao_id }, animais: dg }, 'dg'));
  venda('2026-05-20', [ids[6]], 'v-prenha');
  venda('2026-05-21', [ids[8]], 'v-vazia');
  let g = indicadores(s, { estacao_id: estacao.estacao_id }).estacao.geral;
  assert.deepEqual([g.expostas, g.sairam_sem_diagnostico, g.sairam_sem_desfecho], [10, 1, 2], 'sem desfecho: a vendida antes do diagnóstico e a prenha vendida');
  assert.deepEqual(tx(g.prenhez), [77.8, 7, 9, null], 'a vendida antes do diagnóstico sai; a prenha vendida depois dele conta como prenha');
  assert.deepEqual(tx(g.cobertura_dg), [100, 9, 9, null]);
  assert.deepEqual([tx(g.paricao), g.paricao.parcial], [[0, 0, 8, null], 'parcial'], 'sem a vendida antes do diagnóstico e sem a prenha vendida; a vazia vendida fica');
  assert.deepEqual([tx(g.perda_gestacional), g.perda_gestacional.parcial], [[0, 0, 6, null], 'parcial'], 'prenha sem desfecho nunca conta como perda');
  // Os partos chegam; antes do fim da janela (04/02/2027) a parição ainda é parcial; depois, não.
  s.gas.clock.now = Date.parse('2026-11-10T15:00:00.000Z');
  for (let i = 0; i < 5; i++) ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-11-0' + (i + 1) }, animais: [{ animal_id: ids[i] }], crias: [i === 4 ? { situacao_nascimento: 'NATIMORTO' } : { situacao_nascimento: 'VIVO', sexo: 'F' }] }, 'p' + i));
  g = indicadores(s, { estacao_id: estacao.estacao_id }).estacao.geral;
  assert.deepEqual([tx(g.paricao), g.paricao.parcial, tx(g.natalidade)], [[62.5, 5, 8, null], 'parcial', [50, 4, 8, null]], 'o parto natimorto conta para a parição, não para a natalidade');
  assert.deepEqual([tx(g.desmama), g.desmama.parcial, g.crias_ao_pe], [[0, 0, 8, null], 'parcial', 4]);
  s.gas.clock.now = Date.parse('2027-02-10T15:00:00.000Z');
  g = indicadores(s, { estacao_id: estacao.estacao_id }).estacao.geral;
  assert.deepEqual([tx(g.perda_gestacional), g.perda_gestacional.parcial, g.paricao.parcial], [[16.7, 1, 6, null], null, null], 'a prenha 5 sem parto com a janela encerrada: perda');
  // A data do cálculo pode ser passada: em 01/06/2026, antes dos partos.
  const passado = indicadores(s, { estacao_id: estacao.estacao_id, data: '2026-06-01' });
  assert.deepEqual([passado.data, tx(passado.estacao.geral.paricao)], ['2026-06-01', [0, 0, 8, null]]);
  assert.equal(api(s, 'reproducao.indicadores', { data: '2027-03-01' }).error.code, 'VALIDATION', 'data futura');
});

test('desmama e mortalidade até a desmama: a cria morta depois da idade padrão de desmama (sem DESMAMA) não é perda até a desmama nem fica em risco; "parcial" com cria ao pé; IEP com dois partos registrados', () => {
  const { s, ids, crias, estacao } = safra({ vacas: 6, diagnosticadas: 6, prenhas: 6, paridas: 6, hoje: '2027-01-10' });
  let g = indicadores(s, { estacao_id: estacao.estacao_id }).estacao.geral;
  assert.deepEqual([g.crias_ao_pe, tx(g.desmama), g.desmama.parcial, tx(g.mortalidade_ate_desmama), g.mortalidade_ate_desmama.parcial], [6, [0, 0, 6, null], 'parcial', [0, 0, 6, null], 'parcial']);
  // Em 01/09/2027 (passados os 8 meses de 25/10/2026 → 25/06/2027): uma desmamada, uma morta antes do corte, uma morta depois.
  s.gas.clock.now = Date.parse('2027-09-01T15:00:00.000Z');
  ok(api(s, 'evento.registrar', { tipo: 'DESMAMA', campos: { event_date: '2027-05-01' }, animais: [{ animal_id: crias[0], peso: 180 }] }, 'dm'));
  ok(api(s, 'evento.registrar', { tipo: 'MORTE', campos: { event_date: '2027-03-01', causa: 'DOENCA' }, animais: [{ animal_id: crias[1] }] }, 'm1'));
  ok(api(s, 'evento.registrar', { tipo: 'MORTE', campos: { event_date: '2027-07-01', causa: 'DOENCA' }, animais: [{ animal_id: crias[2] }] }, 'm2'));
  g = indicadores(s, { estacao_id: estacao.estacao_id }).estacao.geral;
  assert.deepEqual([g.desmamados, g.mortos_antes_da_desmama, g.crias_ao_pe, tx(g.mortalidade_ate_desmama), g.mortalidade_ate_desmama.parcial], [1, 1, 0, [16.7, 1, 6, null], null]);
  // IEP: uma exposição sem estação depois do parto (10/11 a 10/12/2026), com o parto seguinte para cinco das seis.
  ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-11-10', data_fim: '2026-12-10' }, animais: ids.slice(0, 5).map((animal_id) => ({ animal_id })) }, 'exp2'));
  for (let i = 0; i < 5; i++) ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2027-08-2' + i }, animais: [{ animal_id: ids[i] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M' }] }, 'p2-' + i), 'parto 2 ' + i);
  const anual = indicadores(s, { ano: '2027' }).anual;
  // Intervalos: 25/10/2026 → 20..24/08/2027 = 299..303 dias; média 301.
  assert.deepEqual(js(anual.iep_dias), { valor: 301, motivo: null, n: 5 });
  assert.deepEqual([anual.partos, anual.nascidos_vivos, anual.matrizes_no_inicio], [5, 5, 6]);
  assert.deepEqual(tx(anual.natalidade_anual), [83.3, 5, 6, null]);
  assert.equal(anual.natalidade_anual.parcial, 'parcial', 'o ano ainda não acabou');
  // O parto seguinte não entra na estação (é da exposição mais recente cuja janela o contém, a de 10/11/2026).
  assert.equal(indicadores(s, { estacao_id: estacao.estacao_id }).estacao.geral.paridas, 6);
});

test('forma anual sem estação (PR-07: touro o ano todo): natalidade anual = nascidos vivos no ano ÷ matrizes ativas no início do ano; ano antes do marco zero → null; sem estação cadastrada a consulta cai na forma anual', () => {
  const s = S.sistema();
  s.gas.clock.now = Date.parse('2026-12-15T15:00:00.000Z');
  const femeas = [];
  for (let i = 0; i < 8; i++) femeas.push(S.bicho({ brinco: 'A' + i, data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }));
  femeas.push(S.bicho({ brinco: 'J1', data_nascimento: '2025-06-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 0 }));
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(femeas), 'rebanho'));
  const ids = r.animais.map((a) => a.animal_id);
  for (let i = 0; i < 6; i++) ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-09-1' + i }, animais: [{ animal_id: ids[i] }], crias: i === 5 ? [{ situacao_nascimento: 'NATIMORTO' }] : [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }, 'p' + i));
  const x = indicadores(s);
  assert.equal(x.estacao, null);
  assert.deepEqual([x.anual.ano, x.anual.inicio, x.anual.fim, x.anual.matrizes_no_inicio, x.anual.partos, x.anual.nascidos_vivos], ['2026', '2026-01-01', '2026-12-15', 8, 6, 5], 'a novilha de 2025 não é apta no início do ano');
  assert.deepEqual([tx(x.anual.natalidade_anual), x.anual.natalidade_anual.rotulo], [[62.5, 5, 8, null], 'Natalidade anual']);
  assert.deepEqual(js(x.matrizes), { ativas: 8, prenhas: 0, sem_informacao: 2, sem_historico: 0, motivo: null }, 'as 6 paridas estão vazias; as outras 2, sem informação');
  const antes = indicadores(s, { ano: '2025' }).anual;
  assert.deepEqual([antes.natalidade_anual.valor, antes.natalidade_anual.motivo], [null, 'ANTERIOR_AO_MARCO_ZERO']);
  assert.equal(api(s, 'reproducao.indicadores', { ano: '26' }).error.code, 'VALIDATION');
  assert.equal(api(s, 'reproducao.indicadores', { estacao_id: S.id(0xbeef) }).error.code, 'NOT_FOUND');
});
