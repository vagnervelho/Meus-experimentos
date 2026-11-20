'use strict';
/**
 * Jornada de um ano da Fase 3 (Manejo), só pela função pública api() (e setup() do editor), como o dono faria: setup →
 * cadastros (pastos da maternidade, da recria e das novilhas; fornecedor de insumos, frigorífico e veterinário; produtos
 * com e sem controle de estoque; protocolos de vacinação semestral, de brucelose e de vermifugação da recria; duas
 * estações de monta) → rebanho do marco zero (46 animais, com as crias ao pé ligadas às mães) → um ano de curral:
 * entradas de estoque, vacinações pelo protocolo, vermifugações (uma corrigida), perda de estoque, vacina lançada nas
 * vacas erradas e estornada, pesagens periódicas da recria (uma corrigida; uma variação brusca recusada sem gravar),
 * pesagem por lote das novilhas, desmama com o pasto de destino e o peso, castração com a despesa paga, ocorrências (uma
 * estornada), exposição ao touro, diagnóstico de gestação (corrigido), aborto, a ida das novilhas para a maternidade (que
 * barra o estorno da desmama), partos (gêmeos e natimorto), mortes, tratamento com carência (a venda para abate dentro dela
 * é recusada), pesagem importada da balança, venda dos bois, inseminação com sêmen de touro de fora.
 *
 * No fim, os números conferidos contra um modelo independente que o próprio teste anota (o sistema não é consultado para
 * montar o esperado): inventário por pasto em várias datas, o peso e o GMD de cada animal da recria e os intervalos de um
 * garrote, os indicadores da estação de monta, a agenda sanitária (pendências e cobertura por protocolo, carência), o
 * estoque, o custo sanitário do período por conta e o da ficha, a trilha das correções e dos estornos e a integridade sem
 * erro. Depois de CADA comando: projeção gravada = reconstrução e as invariantes do financeiro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');

const js = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const HOJE = '2026-11-13';
const D0 = '2025-11-01';
const USUARIO = 'dono@gmail.com';
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

// Datas e contas do modelo, sem o código do sistema.
const MS_DIA = 86400000;
const dias = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / MS_DIA);
const somaDias = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * MS_DIA).toISOString().slice(0, 10);
const br = (d) => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
const kgBr = (kg) => String(kg).replace('.', ',');
/** Taxa em % com uma casa, meio para cima (07, seção 8.3). */
const pct = (num, den) => Math.round((num * 1000) / den) / 10;

function semDate(v, onde) {
  if (Object.prototype.toString.call(v) === '[object Date]') assert.fail('Date na resposta em ' + onde);
  if (v && typeof v === 'object') Object.keys(v).forEach((k) => semDate(v[k], onde + '.' + k));
}

function montar() {
  const gas = createGas({ order: 'reverse' });
  const G = gas.G;
  let n = 0;
  const j = {
    gas, G,
    props: () => Object.fromEntries(gas.props.script._data),
    banco: () => j.props().SPREADSHEET_ID,
    api: (rota, dados, extra) => {
      const env = js(gas.exec(() => G.api(Object.assign({ rota, dados: dados || {} }, extra || {}))));
      semDate(env, rota);
      return env;
    },
    /** Projeção gravada × reconstrução e as invariantes do financeiro, na base em uso. */
    conferir: (onde) => {
      const r = js(gas.exec(() => G.UnitOfWork.read(G.Api.contexto({ usuario: USUARIO }), {
        rota: 'teste.projecoes', reads: G.FinancialService.leituras(), acessoCru: true, tratador: (tx) => ({ proj: G.Timeline.conferir(tx), fin: G.FinancialService.conferir(tx) }),
      }).dados));
      assert.deepEqual(r, { proj: [], fin: [] }, 'projeção = reconstrução e invariantes do financeiro depois de ' + onde);
    },
    /** Comando que tem de passar; confere a projeção e o financeiro depois dele. */
    cmd: (rota, dados, extra) => {
      const r = j.api(rota, dados, Object.assign({ idempotencyKey: 'j3-' + (++n) }, extra || {}));
      assert.equal(r.ok, true, rota + ' ' + ((dados && (dados.subtipo || dados.tipo)) || '') + ': ' + JSON.stringify(r.error));
      j.conferir(rota + ' ' + ((dados && (dados.subtipo || dados.tipo)) || ''));
      return r.data;
    },
    /** Comando que tem de ser recusado sem gravar nada (nem a operação) e sem consumir a chave. */
    recusa: (rota, dados, code) => {
      const antes = j.contagem();
      const chave = 'j3-recusa-' + (++n);
      const r = j.api(rota, dados, { idempotencyKey: chave });
      assert.deepEqual([r.ok, r.error && r.error.code], [false, code], rota + ': ' + JSON.stringify(r.error || r.data).slice(0, 400));
      assert.deepEqual(j.contagem(), antes, 'a recusa não grava nada');
      assert.equal(j.ok('operacao.status', { chave }).situacao, 'INEXISTENTE', 'a chave fica livre');
      return r.error;
    },
    ok: (rota, dados) => {
      const r = j.api(rota, dados);
      assert.equal(r.ok, true, rota + ': ' + JSON.stringify(r.error));
      return r.data;
    },
    tabela: (aba) => js(gas.exec(() => G.Database.abrir(j.banco(), { primitiva: j.props().IO_PRIMITIVE }).ler([aba])[aba].registros)),
    contagem: () => js(gas.exec(() => { const l = G.Database.abrir(j.banco(), { primitiva: j.props().IO_PRIMITIVE }).ler(G.Schema.nomesTabelas()); const o = {}; Object.keys(l).forEach((k) => { o[k] = l[k].registros.length; }); return o; })),
  };
  return j;
}

/** Modelo independente do inventário: cada animal com a lista de [data, pasto | null]; a posição em D é o último registro com data ≤ D. */
function modelo() {
  const mov = {};
  return {
    entra: (rot, data, pasto) => { (mov[rot] = mov[rot] || []).push([data, pasto]); },
    move: (rots, data, pasto) => rots.forEach((r) => mov[r].push([data, pasto])),
    sai: (rots, data) => rots.forEach((r) => mov[r].push([data, null])),
    presentes: (data) => Object.keys(mov).filter((r) => { let p = null; mov[r].forEach((x) => { if (x[0] <= data) p = x[1]; }); return p !== null; }),
    em: (data) => {
      const por = {};
      Object.keys(mov).forEach((r) => {
        let p = null;
        mov[r].forEach((x) => { if (x[0] <= data) p = x[1]; });
        if (p) por[p] = (por[p] || 0) + 1;
      });
      return por;
    },
  };
}

/** Pesos da recria em décimos de kg (o modelo): garrote = peso no marco zero + ganho diário fixo; bezerro desmamado = peso à desmama + ganho. */
const GARROTES = Array.from({ length: 10 }, (_, i) => 'G' + String(i + 1).padStart(2, '0'));
const PESO_D0 = Object.fromEntries(GARROTES.map((g, i) => [g, 250 + 5 * i]));
const GANHO_G = Object.fromEntries(GARROTES.map((g, i) => [g, 520 + 20 * i])); // gramas por dia
const DESMAMA = '2026-03-01';
const PESO_DESMAMA = { B01: 200, B02: 195, B03: 210, B04: 190, B05: 205, B06: 198, B07: 212, B08: 202 };
const GANHO_B = { B01: 600, B03: 650, B05: 700, B07: 750 };
function decimos(rot, data) {
  if (GANHO_G[rot]) return PESO_D0[rot] * 10 + Math.round((GANHO_G[rot] * dias(D0, data)) / 100);
  return PESO_DESMAMA[rot] * 10 + Math.round((GANHO_B[rot] * dias(DESMAMA, data)) / 100);
}
const peso = (rot, data) => decimos(rot, data) / 10;

function importar(j, tipo, nome, texto, mapa) {
  const criado = j.cmd('importacao.criar', { tipo, arquivo_nome: nome, texto, formato: FORMATO });
  let est = null;
  for (let b = 1; b < 20 && (!est || est.importacao.status !== 'VALIDADO'); b++) est = j.cmd('importacao.validarBloco', { import_id: criado.import_id, bloco: b, mapeamento: mapa });
  assert.equal(est.importacao.status, 'VALIDADO');
  let bl = j.api('importacao.importarBloco', { import_id: criado.import_id, bloco: 1, modo: 'TOTAL' });
  assert.equal(bl.ok, true, JSON.stringify(bl.error));
  for (let b = 2; bl.data.blocos.proximo !== null; b++) {
    bl = j.api('importacao.importarBloco', { import_id: criado.import_id, bloco: b });
    assert.equal(bl.ok, true, JSON.stringify(bl.error));
  }
  const fim = j.ok('importacao.concluir', { import_id: criado.import_id });
  j.conferir('importação ' + tipo);
  return { criado, est, fim };
}

test('jornada da Fase 3 pela API: um ano de pesagens, sanidade, reprodução, desmama, castração e ocorrências → GMD, indicadores da estação, agenda, estoque e custo sanitário conferidos contra um modelo independente; integridade sem erro', () => {
  const j = montar();
  const { G } = j;
  const M = modelo();
  const id = {};
  const sanidade = (subtipo, data, campos, animais) => ({ tipo: 'SANIDADE', subtipo, campos: Object.assign({ event_date: data }, campos), animais: animais.map((r) => ({ animal_id: id[r] })) });
  const repro = (subtipo, data, campos, itens) => ({ tipo: 'REPRODUCAO', subtipo, campos: Object.assign({ event_date: data }, campos), animais: itens.map((x) => (typeof x === 'string' ? { animal_id: id[x] } : Object.assign({}, x, { animal_id: id[x.rot], rot: undefined }))) });
  const pesagem = (data, rots, pesoDe) => ({ tipo: 'PESAGEM', campos: { event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: rots.map((r) => ({ animal_id: id[r], peso: pesoDe ? pesoDe(r) : peso(r, data) })) });

  // 1. Setup e cadastros.
  const rel = js(j.gas.exec(() => G.setup()));
  assert.equal(rel.integridade.ok, true);
  const prop = j.cmd('propriedade.salvar', { campos: { nome: 'Fazenda São Bento', area_total_ha: 250 } });
  const pasto = {};
  [['Maternidade', 80, 2.0], ['Recria', 60, 2.5], ['Novilhas', 50, 2.0]].forEach(([nome, area, cap]) => {
    pasto[nome] = j.cmd('pasto.salvar', { campos: { property_id: prop.property_id, nome, area_hectares: area, capacidade_estimada_ua_ha: cap, posse: 'PROPRIO' } }).pasture_id;
  });
  const parceiro = (nome, tipos) => j.cmd('parceiro.salvar', { campos: { nome, tipos } }).partner_id;
  const casa = parceiro('Casa Agropecuária do Vale', ['FORNECEDOR']);
  const frig = parceiro('Frigorífico Boi Bom', ['COMPRADOR']);
  const vet = parceiro('Dra. Helena (veterinária)', ['VETERINARIO']);
  j.cmd('config.salvar', { valores: { data_marco_zero: D0, propriedade_padrao_id: prop.property_id } });
  const conta = (codigo) => j.tabela('PLANO_CONTAS').find((c) => c.codigo === codigo).conta_id;

  // 2. Rebanho do marco zero: 2 touros, 20 vacas (V01 a V08 com cria ao pé), 6 novilhas e 10 garrotes inteiros pesados.
  const animais = [];
  ['T1', 'T2'].forEach((b, i) => animais.push({ brinco: b, sexo: 'M', reprodutor: true, castrado: false, data_nascimento: ['2018-03-10', '2019-04-20'][i], data_nascimento_confianca: 'ESTIMADA', pasto_destino_id: pasto.Maternidade, origem: 'DESCONHECIDA' }));
  const vacas = Array.from({ length: 20 }, (_, i) => 'V' + String(i + 1).padStart(2, '0'));
  vacas.forEach((b, i) => animais.push({ brinco: b, sexo: 'F', data_nascimento: '20' + (17 + (i % 4)) + '-0' + (1 + (i % 9)) + '-15', data_nascimento_confianca: 'ESTIMADA', partos_previos: 2, pasto_destino_id: pasto.Maternidade, origem: 'DESCONHECIDA', ref: i < 8 ? 'm' + b : undefined }));
  const crias0 = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08'];
  crias0.forEach((b, i) => {
    const a = { brinco: b, sexo: i % 2 ? 'F' : 'M', data_nascimento: somaDias('2025-06-10', 7 * i), data_nascimento_confianca: 'CONFIRMADA', pasto_destino_id: pasto.Maternidade, origem: 'NASCIDO', mae_ref: 'mV0' + (i + 1), mae_confianca: 'CONFIRMADA' };
    if (a.sexo === 'M') Object.assign(a, { castrado: false, reprodutor: false });
    animais.push(a);
  });
  const novilhas = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'];
  novilhas.forEach((b, i) => animais.push({ brinco: b, sexo: 'F', data_nascimento: '2023-09-0' + (i + 1), data_nascimento_confianca: 'CONFIRMADA', partos_previos: 0, pasto_destino_id: pasto.Novilhas, origem: 'DESCONHECIDA', peso: 330, metodo_pesagem: 'BALANCA' }));
  GARROTES.forEach((b, i) => animais.push({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, data_nascimento: '2024-06-' + String(i + 1).padStart(2, '0'), data_nascimento_confianca: 'CONFIRMADA', pasto_destino_id: pasto.Recria, origem: 'DESCONHECIDA', peso: PESO_D0[b], metodo_pesagem: 'BALANCA' }));
  animais.forEach((a) => Object.keys(a).forEach((k) => { if (a[k] === undefined) delete a[k]; }));
  const reb = j.cmd('evento.registrar', { tipo: 'ENTRADA_INICIAL', campos: {}, animais });
  reb.animais.forEach((a) => { id[a.brinco] = a.animal_id; });
  animais.forEach((a) => M.entra(a.brinco, D0, Object.keys(pasto).find((p) => pasto[p] === a.pasto_destino_id)));
  assert.equal(reb.animais.length, 46);
  crias0.forEach((b, i) => assert.equal(j.tabela('ANIMAIS').find((a) => a.animal_id === id[b]).mae_id, id['V0' + (i + 1)], 'mãe da cria ' + b));

  // 3. Produtos, protocolos e estações.
  const aftosa = j.cmd('produto.salvar', { campos: { nome: 'Vacina Aftosa', categoria: 'VACINA', unidade: 'dose', custo_unitario: 2.5, controla_estoque: true, fator_conversao: 50 } }).product_id;
  const ivermectina = j.cmd('produto.salvar', { campos: { nome: 'Ivermectina 1%', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 0.04, controla_estoque: false } }).product_id;
  const antibiotico = j.cmd('produto.salvar', { campos: { nome: 'Antibiótico LA', categoria: 'MEDICAMENTO', unidade: 'mL', custo_unitario: 1.2, controla_estoque: true } }).product_id;
  const semestral = j.cmd('protocolo.salvar', { campos: { nome: 'Aftosa semestral', tipo_procedimento: 'VACINA', product_id: aftosa, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180, antecedencia_alerta_dias: 15 } }).protocol_id;
  const brucelose = j.cmd('protocolo.salvar', { campos: { nome: 'Brucelose (B19)', tipo_procedimento: 'VACINA', sexo_aplicavel: 'F', idade_min_meses: 3, idade_max_meses: 8, recorrencia_tipo: 'UNICA' } }).protocol_id;
  const recria = j.cmd('protocolo.salvar', { campos: { nome: 'Vermifugação da recria', tipo_procedimento: 'VERMIFUGO', product_id: ivermectina, sexo_aplicavel: 'AMBOS', idade_min_meses: 8, idade_max_meses: 30, recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 90, antecedencia_alerta_dias: 15 } }).protocol_id;
  const estacao = j.cmd('estacao.salvar', { campos: { nome: 'Estação 2025/26', data_inicio: '2025-11-15', data_fim: '2026-02-15', tipo: 'MONTA_NATURAL' } }).estacao_id;
  const estacaoIA = j.cmd('estacao.salvar', { campos: { nome: 'Estação 2026/27 (IATF)', data_inicio: '2026-11-01', data_fim: '2027-01-31', tipo: 'IA' } }).estacao_id;
  const saldo = (p) => j.tabela('PRODUTOS').find((x) => x.product_id === p).estoque_atual;

  // 4. Novembro: 2 frascos de 50 doses de aftosa (R$ 250,00) e a vacinação de todo o rebanho pelo protocolo (46 doses).
  j.cmd('evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2025-11-10', product_id: aftosa, qtd_apresentacao: 2, valor: 25000, partner_id: casa, documento: 'NF 5512', vencimento: '2025-12-10' } });
  assert.equal(saldo(aftosa), 100);
  const todos0 = M.presentes('2025-11-20');
  const vac1 = j.cmd('evento.registrar', sanidade('VACINACAO', '2025-11-20', { produto_id: aftosa, protocol_id: semestral, modo_dose: 'POR_CABECA', dose_referencia: 1, via_aplicacao: 'SUBCUTANEA', lote: 'AF-2025-11' }, todos0));
  assert.equal(saldo(aftosa), 54, '100 − 46 doses');
  const consumo1 = j.tabela('FINANCEIRO').filter((f) => f.event_id === vac1.event_id);
  assert.deepEqual(consumo1.map((f) => [f.natureza, f.valor, f.status_pagamento]), [['CUSTEIO', 46 * 250, 'SEM_CAIXA']], '46 × R$ 2,50, sem caixa');
  assert.ok(j.tabela('SANIDADE').filter((x) => x.event_id === vac1.event_id).every((x) => x.data_proxima_aplicacao === '2026-05-19'), 'próxima pelo protocolo: 20/11/2025 + 180 dias');

  // 5. Exposição da estação: 20 vacas e 6 novilhas com os dois touros (o touro único não vai ao registro).
  const expostas = vacas.concat(novilhas);
  j.cmd('evento.registrar', repro('EXPOSICAO', '2025-11-15', { estacao_id: estacao, data_fim: '2026-02-15' }, expostas.concat(['T1', 'T2'])));
  // Brucelose das bezerras de 4 a 5 meses (B19, sem cadastro de produto: sem estoque nem custo).
  j.cmd('evento.registrar', sanidade('VACINACAO', '2025-12-01', { protocol_id: brucelose, nome_produto: 'Vacina B19', modo_dose: 'POR_CABECA', dose_referencia: 2, unidade_dose: 'mL', veterinario: 'Dra. Helena' }, ['B02', 'B04', 'B06', 'B08']));
  const bru = j.ok('sanidade.agenda', { data: '2025-12-02' }).protocolos.find((p) => p.protocol_id === brucelose);
  assert.deepEqual([bru.elegiveis, bru.em_dia, bru.cobertura.valor], [4, 4, 100], 'brucelose: as 4 bezerras de 3 a 8 meses vacinadas');

  // 6. Pesagem de dezembro e a vermifugação da recria (5 mL lançados; eram 6 mL: correção), carência de 35 dias.
  j.cmd('evento.registrar', pesagem('2025-12-15', GARROTES));
  const verm = (dose) => sanidade('VERMIFUGACAO', '2025-12-16', { produto_id: ivermectina, protocol_id: recria, modo_dose: 'POR_CABECA', dose_referencia: dose, via_aplicacao: 'SUBCUTANEA', periodo_carencia_dias: 35 }, GARROTES);
  const v1 = j.cmd('evento.registrar', verm(5));
  assert.equal(j.tabela('FINANCEIRO').find((f) => f.event_id === v1.event_id).valor, 200, '50 mL × R$ 0,04');
  const v1k = j.cmd('evento.corrigir', Object.assign(verm(6), { event_id: v1.event_id, justificativa: 'Dose conferida: 6 mL por animal' }));
  assert.deepEqual(j.tabela('FINANCEIRO').filter((f) => f.event_id === v1k.event_id).map((f) => [f.valor, f.status]), [[240, 'ATIVO']], '60 mL × R$ 0,04 no substituto');
  assert.ok(j.tabela('FINANCEIRO').filter((f) => f.event_id === v1.event_id).every((f) => f.status === 'CANCELADO'), 'o consumo do original fica cancelado');
  const car = j.ok('sanidade.agenda', { data: '2026-01-10' }).carencia;
  assert.deepEqual(car.map((c) => [c.animal_id, c.fim]).sort(), GARROTES.map((g) => [id[g], '2026-01-20']).sort(), 'carência de 35 dias até 20/01/2026');
  assert.deepEqual(j.ok('sanidade.agenda', { data: '2026-01-21' }).carencia, [], 'livre no dia seguinte');

  // 7. Perda de 4 doses (frasco caiu) e a desmama de março: os machos para a Recria, as fêmeas para as Novilhas, com o peso.
  j.cmd('evento.registrar', { tipo: 'ESTOQUE', subtipo: 'AJUSTE', campos: { event_date: '2026-01-15', product_id: aftosa, motivo_ajuste: 'PERDA', quantidade: 4, notes: 'Frasco caiu no curral' } });
  assert.equal(saldo(aftosa), 50);
  const machos = ['B01', 'B03', 'B05', 'B07'];
  const femeas = ['B02', 'B04', 'B06', 'B08'];
  const desmama = (rots, destino) => ({ tipo: 'DESMAMA', campos: { event_date: DESMAMA, pasto_destino_id: pasto[destino], metodo_pesagem: 'BALANCA' }, animais: rots.map((r) => ({ animal_id: id[r], peso: PESO_DESMAMA[r] })) });
  j.cmd('evento.registrar', desmama(machos, 'Recria'));
  M.move(machos, DESMAMA, 'Recria');
  const desF = j.cmd('evento.registrar', desmama(femeas, 'Novilhas'));
  M.move(femeas, DESMAMA, 'Novilhas');
  assert.ok(crias0.every((b, i) => j.tabela('ANIMAIS').find((a) => a.animal_id === id['V0' + (i + 1)]).cria_ao_pe === false), 'as 8 mães sem cria ao pé');
  assert.deepEqual(j.tabela('PESAGENS').filter((p) => p.tipo === 'DESMAMA').map((p) => p.peso_kg).sort(), Object.values(PESO_DESMAMA).sort(), 'o peso à desmama é pesagem (DESMAMA)');
  j.cmd('evento.registrar', sanidade('VERMIFUGACAO', '2026-03-02', { produto_id: ivermectina, protocol_id: recria, modo_dose: 'POR_CABECA', dose_referencia: 3 }, crias0));

  // 8. Março: pesagem da recria; a agenda da vermifugação avisa 6 dias antes (próxima) e a dose dos garrotes sai em 17/03.
  j.cmd('evento.registrar', pesagem('2026-03-15', GARROTES));
  const pend = (a, p) => a.pendencias.filter((x) => x.protocol_id === p);
  assert.deepEqual(pend(j.ok('sanidade.agenda', { data: '2026-03-10' }), recria).map((x) => [x.animal_id, x.situacao, x.vencimento]).sort(), GARROTES.map((g) => [id[g], 'PROXIMA', '2026-03-16']).sort(), 'os garrotes vencem em 16/03 (16/12 + 90); as bezerras ainda em dia');
  j.cmd('evento.registrar', sanidade('VERMIFUGACAO', '2026-03-17', { produto_id: ivermectina, protocol_id: recria, modo_dose: 'POR_CABECA', dose_referencia: 6 }, GARROTES));
  assert.deepEqual(pend(j.ok('sanidade.agenda', { data: '2026-03-17' }), recria), [], 'cumprida no dia');

  // 9. Diagnóstico de gestação (a V19 lançada vazia; a palpação repetida a achou prenhe: correção), castração, morte e lote das novilhas.
  const positivas = vacas.slice(0, 16).concat(['V20', 'N1', 'N2', 'N3', 'N4', 'N5']);
  const dg = (comV19) => repro('DIAGNOSTICO_GESTACAO', '2026-03-20', { estacao_id: estacao, metodo: 'PALPACAO', responsible: 'Dra. Helena' }, expostas.map((r) => ({ rot: r, resultado: positivas.indexOf(r) >= 0 || (comV19 && r === 'V19') ? 'POSITIVO' : 'NEGATIVO' })));
  const dg1 = j.cmd('evento.registrar', dg(false));
  const dgK = j.cmd('evento.corrigir', Object.assign(dg(true), { event_id: dg1.event_id, justificativa: 'A V19 estava prenhe: palpação repetida' }));
  assert.equal(j.tabela('ANIMAIS').find((a) => a.animal_id === id.V19).situacao_reprodutiva, 'PRENHA');
  const cast = j.cmd('evento.registrar', { tipo: 'CASTRACAO', campos: { event_date: '2026-04-10', metodo: 'Burdizzo', custo_valor: 8000, custo_conta_id: conta('MAO_DE_OBRA'), custo_partner_id: vet }, animais: machos.map((r) => ({ animal_id: id[r] })) });
  assert.ok(machos.every((r) => j.tabela('ANIMAIS').find((a) => a.animal_id === id[r]).castrado === true), 'castrados');
  const fCast = j.tabela('FINANCEIRO').filter((f) => f.event_id === cast.event_id);
  assert.deepEqual(fCast.map((f) => [f.natureza, f.valor]), [['CUSTEIO', 8000]]);
  assert.deepEqual(j.tabela('ALOCACOES_FINANCEIRAS').filter((al) => al.financial_id === fCast[0].financial_id).map((al) => al.valor_alocado), [2000, 2000, 2000, 2000], 'R$ 80,00 por cabeça entre os 4');
  j.cmd('evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-04-10', causa: 'DOENCA' }, animais: [{ animal_id: id.V20 }] });
  M.sai(['V20'], '2026-04-10');
  const lote = j.cmd('evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-04-10', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA', peso_total_lote_kg: 2130, qtd_cabecas_lote: 6 }, animais: novilhas.map((r) => ({ animal_id: id[r] })) });
  assert.deepEqual(j.tabela('PESAGENS').filter((p) => p.event_id === lote.event_id).map((p) => [p.peso_kg, p.metodo]), novilhas.map(() => [355, 'MEDIA_LOTE']), '2.130 kg ÷ 6 = 355,0 (estimada)');
  j.cmd('evento.registrar', { tipo: 'OCORRENCIA', campos: { event_date: '2026-05-05', tipo_ocorrencia: 'LESAO', description: 'Ferida na pata traseira, tratada no curral' }, animais: [{ animal_id: id.V10 }] });

  // 10. Maio: a agenda da aftosa mostra as 45 próximas (a V20 morreu); entrada de 50 doses e a segunda campanha.
  const af = pend(j.ok('sanidade.agenda', { data: '2026-05-10' }), semestral);
  assert.deepEqual([af.length, af.every((x) => x.situacao === 'PROXIMA' && x.vencimento === '2026-05-19')], [45, true], 'a pendência da aftosa 9 dias antes');
  j.cmd('evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-05-18', product_id: aftosa, qtd_apresentacao: 1, valor: 12500, partner_id: casa } });
  const todos1 = M.presentes('2026-05-19');
  assert.equal(todos1.length, 45);
  j.cmd('evento.registrar', sanidade('VACINACAO', '2026-05-19', { produto_id: aftosa, protocol_id: semestral, modo_dose: 'POR_CABECA', dose_referencia: 1, via_aplicacao: 'SUBCUTANEA', lote: 'AF-2026-05' }, todos1));
  assert.equal(saldo(aftosa), 55, '50 + 50 − 45');
  // A vacina lançada em cinco vacas por engano baixa o estoque; estornada, o saldo e o custo voltam.
  const errada = j.cmd('evento.registrar', sanidade('VACINACAO', '2026-06-16', { produto_id: aftosa, modo_dose: 'POR_CABECA', dose_referencia: 1 }, ['V11', 'V12', 'V13', 'V14', 'V15']));
  assert.equal(saldo(aftosa), 50);
  j.cmd('evento.estornar', { event_id: errada.event_id, justificativa: 'Vacina lançada nas vacas erradas' });
  assert.equal(saldo(aftosa), 55);
  assert.ok(j.tabela('FINANCEIRO').filter((f) => f.event_id === errada.event_id).every((f) => f.status === 'CANCELADO'), 'o consumo do engano fica cancelado');

  // 11. Junho: pesagem da recria (o G04 digitado 10 kg a mais: correção), variação brusca recusada, aborto, descorna e ocorrência errada.
  const recriaJunho = GARROTES.concat(machos);
  const pj = j.cmd('evento.registrar', pesagem('2026-06-15', recriaJunho, (r) => (r === 'G04' ? peso(r, '2026-06-15') + 10 : peso(r, '2026-06-15'))));
  j.cmd('evento.corrigir', Object.assign(pesagem('2026-06-15', recriaJunho), { event_id: pj.event_id, justificativa: 'Peso do G04 digitado errado' }));
  const brusca = j.recusa('evento.registrar', pesagem('2026-06-20', ['G01'], () => 900), 'NEEDS_CONFIRMATION');
  assert.deepEqual(brusca.details.map((d) => [d.codigo, d.animal_id]), [['PESO_IMPLAUSIVEL', id.G01]]);
  j.cmd('evento.registrar', repro('ABORTO', '2026-06-10', {}, [{ rot: 'V16', idade_gestacional_dias: 150 }]));
  j.cmd('evento.registrar', { tipo: 'OCORRENCIA', campos: { event_date: '2026-07-01', tipo_ocorrencia: 'DESCORNA', description: 'Descorna dos garrotes desmamados' }, animais: machos.map((r) => ({ animal_id: id[r] })) });
  const oErrada = j.cmd('evento.registrar', { tipo: 'OCORRENCIA', campos: { event_date: '2026-07-02', tipo_ocorrencia: 'OBSERVACAO', description: 'Mancando' }, animais: [{ animal_id: id.G02 }] });
  j.cmd('evento.estornar', { event_id: oErrada.event_id, justificativa: 'Ocorrência lançada no animal errado' });

  // 12. Agosto: o lote das Novilhas inteiro vai para a Maternidade (reforma do pasto); agora a desmama das fêmeas não se estorna.
  const loteN = novilhas.concat(femeas);
  const ida = j.cmd('evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-08-01', pasto_origem_id: pasto.Novilhas, pasto_destino_id: pasto.Maternidade }, animais: loteN.map((r) => ({ animal_id: id[r] })) });
  M.move(loteN, '2026-08-01', 'Maternidade');
  const barrado = j.recusa('evento.estornar', { event_id: desF.event_id, justificativa: 'teste' }, 'CONFLICT');
  assert.ok(barrado.details.length > 0 && barrado.details.every((d) => d.conflito && d.conflito.event_id === ida.event_id), 'a transferência de 01/08 impede: ' + JSON.stringify(barrado.details.slice(0, 2)));
  j.cmd('evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-08-20', product_id: antibiotico, quantidade: 500, valor: 60000, partner_id: casa } });

  // 13. Partos de agosto a novembro (gêmeos na V05, natimorto na V09); a cria da V03 morre de predador.
  const partos = [['V01', '2026-08-25', ['M']], ['V02', '2026-08-28', ['F']], ['V03', '2026-09-02', ['M']], ['V04', '2026-09-05', ['F']], ['V05', '2026-09-08', ['M', 'F']], ['V06', '2026-09-12', ['F']], ['V07', '2026-09-15', ['M']], ['V08', '2026-09-20', ['F']], ['V09', '2026-09-25', []], ['V10', '2026-10-01', ['M']], ['V11', '2026-10-06', ['F']], ['V12', '2026-10-12', ['M']], ['N1', '2026-10-18', ['F']], ['N2', '2026-10-25', ['M']], ['N3', '2026-11-02', ['F']]];
  const crias = {};
  partos.forEach(([mae, data, sexos]) => {
    const lista = sexos.length ? sexos.map((sexo, k) => ({ situacao_nascimento: 'VIVO', sexo, peso: 30 + k, metodo_pesagem: 'BALANCA' })) : [{ situacao_nascimento: 'NATIMORTO' }];
    const r = j.cmd('evento.registrar', { tipo: 'NASCIMENTO', campos: Object.assign({ event_date: data }, sexos.length > 1 ? { tipo_parto: 'ASSISTIDO' } : {}), animais: [{ animal_id: id[mae] }], crias: lista });
    r.animais.filter((a) => a.animal_id !== id[mae]).forEach((a, k) => {
      const rot = 'cria-' + mae + '-' + k;
      crias[rot] = a.animal_id;
      id[rot] = a.animal_id;
      M.entra(rot, data, 'Maternidade');
      assert.equal(a.pasto_atual_id, pasto.Maternidade, 'a cria nasce no pasto da mãe');
    });
  });
  assert.equal(Object.keys(crias).length, 15);
  j.cmd('evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-10-05', causa: 'PREDADOR' }, animais: [{ animal_id: id['cria-V03-0'] }] });
  M.sai(['cria-V03-0'], '2026-10-05');

  // 14. Setembro: pesagem da recria; o G05 com pneumonia: antibiótico com 60 dias de carência e a visita da veterinária paga.
  j.cmd('evento.registrar', pesagem('2026-09-15', recriaJunho));
  const trat = j.cmd('evento.registrar', sanidade('TRATAMENTO', '2026-09-01', { produto_id: antibiotico, modo_dose: 'POR_CABECA', dose_referencia: 15, motivo: 'Pneumonia', periodo_carencia_dias: 60, custo_valor: 15000, custo_conta_id: conta('SERVICOS_VETERINARIOS'), custo_partner_id: vet, custo_vencimento: '2026-09-30' }, ['G05']));
  assert.equal(saldo(antibiotico), 485);
  const fTrat = j.tabela('FINANCEIRO').filter((f) => f.event_id === trat.event_id);
  assert.deepEqual(fTrat.map((f) => [f.natureza, f.valor, f.status_pagamento]).sort(), [['CUSTEIO', 1800, 'SEM_CAIXA'], ['CUSTEIO', 15000, 'ABERTO']].sort(), 'consumo sem caixa e o serviço a pagar');

  // 15. Outubro: a pesagem da balança entra pela importação; a venda dos bois para abate com o G05 em carência é recusada.
  const linhasBalanca = recriaJunho.map((r) => [br('2026-10-15'), r, kgBr(peso(r, '2026-10-15'))].join(';'));
  const imp = importar(j, 'PESAGENS', 'balanca-15-10.csv', ['Data da pesagem;Brinco;Peso (kg)'].concat(linhasBalanca).join('\r\n'), { colunas: { 'Data da pesagem': 'data', Brinco: 'brinco', 'Peso (kg)': 'peso' }, confiancas: {}, padroes: { momento: 'ROTINA', metodo: 'BALANCA' } });
  assert.deepEqual([imp.fim.importacao.status, imp.est.contadores.validas, imp.est.contadores.erro], ['IMPORTADO', 14, 0]);
  assert.deepEqual(j.ok('sanidade.agenda', { data: '2026-10-20' }).carencia.map((c) => [c.animal_id, c.fim]), [[id.G05, '2026-10-31']]);
  const venda = (rots) => {
    const kg = rots.reduce((s, r) => s + decimos(r, '2026-10-20'), 0) / 10;
    return { tipo: 'VENDA', campos: { event_date: '2026-10-20', partner_id: frig, finalidade: 'ABATE', modalidade: 'KG_VIVO', preco_unitario: 1300, valor_bruto: Math.round(kg * 1300) }, animais: rots.map((r) => ({ animal_id: id[r], peso: peso(r, '2026-10-20') })), parcelas: [{ data_vencimento: '2026-11-20' }] };
  };
  const bloq = j.recusa('evento.registrar', venda(['G01', 'G02', 'G03', 'G04', 'G05', 'G06']), 'VALIDATION');
  assert.deepEqual(bloq.details.map((d) => [d.codigo, d.animal_id]), [['CARENCIA_ATIVA', id.G05]], 'só o G05, dentro da carência (até 31/10)');
  const vendidos = ['G01', 'G02', 'G03', 'G04', 'G06'];
  j.cmd('evento.registrar', venda(vendidos));
  M.sai(vendidos, '2026-10-20');

  // 16. Novembro: inseminação das vazias com sêmen de touro de fora; vermifugação da recria atrasada (13 vencidas na agenda).
  const semen = j.cmd('animal.cadastrarExterno', { campos: { nome: 'Touro Nelore CEIP (sêmen)', sexo: 'M' } }).animal_id;
  const ia = j.cmd('evento.registrar', repro('INSEMINACAO', '2026-11-05', { estacao_id: estacaoIA, touro_id: semen, semen_identificacao: 'Partida 2211', metodo: 'IATF', responsible: 'Inseminador João' }, ['V17', 'V18', 'N6']));
  assert.deepEqual(ia.reproducao.animais.map((a) => [a.animal_id, a.previsao_parto.nivel, a.previsao_parto.data]).sort(), ['V17', 'V18', 'N6'].map((r) => [id[r], 1, somaDias('2026-11-05', 290)]).sort(), 'previsão de parto: inseminação + 290 dias (estimativa)');
  const recriaHoje = ['G05', 'G07', 'G08', 'G09', 'G10'].concat(crias0);
  const vencidas = pend(j.ok('sanidade.agenda', { data: '2026-11-09' }), recria);
  assert.deepEqual(vencidas.map((x) => [x.animal_id, x.situacao]).sort(), recriaHoje.map((r) => [id[r], 'VENCIDA']).sort(), 'os 13 de 8 a 30 meses, sem dose desde março');
  j.cmd('evento.registrar', sanidade('VERMIFUGACAO', '2026-11-10', { produto_id: ivermectina, protocol_id: recria, modo_dose: 'POR_CABECA', dose_referencia: 6 }, recriaHoje));

  // ------------------------------------------------------------ no fim: o sistema × o modelo ----
  // Inventário por pasto em várias datas (e o total), também nos cartões dos pastos.
  const nomeDe = Object.fromEntries(Object.entries(pasto).map(([n, i]) => [i, n]));
  ['2025-11-01', '2026-02-28', '2026-03-01', '2026-04-10', '2026-07-31', '2026-08-01', '2026-09-30', '2026-10-05', '2026-10-20', HOJE].forEach((data) => {
    const esperado = M.em(data);
    const pos = j.ok('inventario.posicao', { data });
    const obtido = Object.fromEntries(pos.por_pasto.filter((p) => p.cabecas > 0).map((p) => [nomeDe[p.pasture_id], p.cabecas]));
    assert.deepEqual(obtido, esperado, 'inventário por pasto em ' + data);
    assert.equal(pos.cabecas, Object.values(esperado).reduce((s, x) => s + x, 0), 'total em ' + data);
    j.ok('pasto.listar', { data }).forEach((c) => assert.equal(c.cabecas, esperado[c.nome] || 0, 'cartão ' + c.nome + ' em ' + data));
  });
  assert.deepEqual(M.em(HOJE), { Maternidade: 45, Recria: 9 }, '46 − 1 vaca − 1 cria − 5 bois + 15 crias = 54');

  // Peso e GMD: os intervalos do G07 (do marco zero à balança importada) e o peso atual e o GMD de cada animal da recria.
  const datasG = [D0, '2025-12-15', '2026-03-15', '2026-06-15', '2026-09-15', '2026-10-15'];
  const ints = j.ok('animal.ficha', { animal_id: id.G07 }).peso.intervalos.map((v) => [v.de, v.ate, v.ganho_kg, v.dias, v.gmd_kg_dia]);
  const esperadoInts = datasG.slice(1).map((d, i) => {
    const a = decimos('G07', datasG[i]);
    const b = decimos('G07', d);
    const n = dias(datasG[i], d);
    return [datasG[i], d, (b - a) / 10, n, Math.round(((b - a) * 100) / n) / 1000];
  });
  assert.deepEqual(ints, esperadoInts, 'intervalos do G07');
  const desempenho = j.ok('peso.desempenho', {});
  const porBrinco = Object.fromEntries(desempenho.animais.map((x) => [x.brinco, [x.ultima.peso_kg, x.gmd.valor]]));
  recriaHoje.filter((r) => GANHO_G[r] || GANHO_B[r]).forEach((r) => {
    const inicio = GANHO_G[r] ? D0 : DESMAMA;
    const a = decimos(r, inicio);
    const b = decimos(r, '2026-10-15');
    assert.deepEqual(porBrinco[r], [b / 10, Math.round(((b - a) * 100) / dias(inicio, '2026-10-15')) / 1000], 'peso atual e GMD do ' + r);
    assert.equal(j.tabela('ANIMAIS').find((x) => x.animal_id === id[r]).peso_atual, b / 10, 'peso atual (projeção) do ' + r);
  });
  assert.ok(desempenho.animais.filter((x) => novilhas.indexOf(x.brinco) >= 0).every((x) => x.gmd.valor === null), 'a média do lote das novilhas nunca entra no GMD individual');

  // Estação de monta 2025/26: 26 expostas, 23 prenhas (com a V19 da correção), 15 partos e 15 nascidos vivos (os gêmeos da V05
  // compensam o natimorto da V09); a V20 prenha morreu sem desfecho e sai dos denominadores do parto.
  const g = j.ok('reproducao.indicadores', { estacao_id: estacao }).estacao.geral;
  const taxa = (x) => [x.valor, x.numerador, x.denominador, x.parcial || null];
  assert.deepEqual([g.expostas, g.diagnosticadas, g.prenhas, g.paridas, g.nascidos_vivos, g.desmamados, g.mortos_antes_da_desmama, g.sairam_sem_desfecho], [26, 26, 23, 15, 15, 0, 1, 1], 'contagens da estação');
  assert.deepEqual(taxa(g.prenhez), [pct(23, 26), 23, 26, null], 'prenhez: 23 ÷ 26');
  assert.deepEqual(taxa(g.paricao), [pct(15, 25), 15, 25, 'parcial'], 'parição: a V20, prenha que morreu, sai do denominador; 6 prenhas ainda na janela');
  assert.deepEqual(taxa(g.natalidade), [pct(15, 25), 15, 25, 'parcial']);
  assert.deepEqual(taxa(g.perda_gestacional), [pct(1, 22), 1, 22, 'parcial'], 'o aborto da V16 entre as 22 prenhas que ficaram');
  assert.deepEqual(taxa(g.mortalidade_ate_desmama), [pct(1, 15), 1, 15, 'parcial'], 'a cria da V03');
  const fV05 = j.ok('animal.ficha', { animal_id: id.V05 }).reprodutivo;
  assert.deepEqual([fV05.bezerros.nascidos_vivos, fV05.situacao_reprodutiva, fV05.cria_ao_pe], [2, 'VAZIA', true], 'a V05 dos gêmeos');
  assert.equal(j.ok('animal.ficha', { animal_id: id.T1 }).reprodutivo.como_touro.length, 1, 'o T1 no lote da exposição');

  // Agenda de hoje: a aftosa vence em 15/11 para os 40 vacinados em maio e está vencida desde o nascimento para as 14 crias; a recria em dia.
  const ag = j.ok('sanidade.agenda', { data: HOJE, periodo_inicio: D0, periodo_fim: HOJE });
  const afHoje = pend(ag, semestral);
  const criasVivas = Object.keys(crias).filter((r) => r !== 'cria-V03-0');
  const nascidaEm = Object.fromEntries(partos.map(([mae, data]) => [mae, data]));
  const esperadoAf = M.presentes(HOJE).map((r) => (crias[r] ? [id[r], 'VENCIDA', nascidaEm[r.split('-')[1]]] : [id[r], 'PROXIMA', '2026-11-15']));
  assert.deepEqual(afHoje.map((x) => [x.animal_id, x.situacao, x.vencimento]).sort(), esperadoAf.sort(), 'aftosa: 40 próximas e 14 vencidas');
  assert.equal(criasVivas.length, 14);
  assert.deepEqual(pend(ag, recria), [], 'a recria vermifugada em 10/11');
  assert.deepEqual(ag.carencia, [], 'nenhum animal em carência hoje');
  // Custo sanitário do período por conta (o modelo): vacinas 46 e 45 doses × R$ 2,50; vermífugos e antibiótico (Medicamentos); a visita.
  const vermifugos = (60 + 24 + 60 + 78) * 4; // mL × R$ 0,04
  const esperadoCustos = { VACINAS: (46 + 45) * 250, MEDICAMENTOS: vermifugos + 15 * 120, SERVICOS_VETERINARIOS: 15000 };
  assert.deepEqual(Object.fromEntries(ag.custos.por_conta.map((c) => [c.codigo, c.total])), esperadoCustos);
  assert.deepEqual([ag.custos.total, ag.custos.nao_alocado], [Object.values(esperadoCustos).reduce((s, x) => s + x, 0), 0], 'tudo alocado aos animais tratados');
  // Estoque: aftosa 100 − 46 − 4 + 50 − 45 (−5 estornados) = 55; antibiótico 500 − 15 = 485.
  assert.deepEqual([saldo(aftosa), saldo(antibiotico), saldo(ivermectina)], [55, 485, null], 'o vermífugo sem controle de estoque não tem saldo');
  const movs = j.tabela('MOVIMENTOS_ESTOQUE').filter((m) => m.product_id === aftosa && j.tabela('EVENTOS').find((e) => e.event_id === m.event_id).status === 'CONFIRMADO');
  assert.equal(movs.reduce((s, m) => s + (m.tipo === 'ENTRADA' ? m.quantidade : m.tipo === 'SAIDA' ? -m.quantidade : m.quantidade), 0), 55, 'saldo = Σ dos movimentos vigentes');
  // Ficha do G05: o custo sanitário = as alocações de cada aplicação (aftosa 2 ×, 3 vermífugos, antibiótico e a visita).
  const fG05 = j.ok('animal.ficha', { animal_id: id.G05 }).sanitario;
  assert.equal(fG05.custo_total, 250 + 24 + 24 + 250 + 1800 + 15000 + 24);
  assert.deepEqual(fG05.itens.map((x) => x.event_subtype), ['VERMIFUGACAO', 'TRATAMENTO', 'VACINACAO', 'VERMIFUGACAO', 'VERMIFUGACAO', 'VACINACAO'], 'mais recente primeiro');

  // Trilha: as correções e os estornos com quem e por quê; integridade sem erro; Σ efeito = ativos.
  const aud = j.ok('auditoria.listar', { por_pagina: 500 });
  const motivos = aud.itens.filter((a) => a.origem === 'EVENTO' && (a.acao === 'ESTORNAR' || a.acao === 'CORRIGIR')).map((a) => a.justificativa).sort();
  assert.deepEqual(motivos, ['A V19 estava prenhe: palpação repetida', 'Dose conferida: 6 mL por animal', 'Ocorrência lançada no animal errado', 'Peso do G04 digitado errado', 'Vacina lançada nas vacas erradas'].sort());
  assert.ok(aud.itens.every((a) => a.usuario === USUARIO), 'quem em toda linha');
  const final = j.ok('sistema.integridade', {});
  assert.deepEqual(final.checagens.filter((c) => c.situacao === 'ERRO').map((c) => c.codigo), [], JSON.stringify(final.achados.slice(0, 5)));
  assert.equal(final.ok, true);
  const tipoDe = Object.fromEntries(j.tabela('EVENTOS').filter((e) => e.status === 'CONFIRMADO').map((e) => [e.event_id, e.event_type]));
  const efeitos = {};
  j.tabela('EVENTO_ANIMAIS').filter((l) => tipoDe[l.event_id]).forEach((l) => { efeitos[tipoDe[l.event_id]] = (efeitos[tipoDe[l.event_id]] || 0) + (l.efeito_inventario || 0); });
  assert.equal(Object.values(efeitos).reduce((s, x) => s + x, 0), 54, 'Σ efeito dos eventos vigentes = ativos: ' + JSON.stringify(efeitos));
  assert.equal(j.ok('sistema.bootstrap', {}).animais.n, 55, 'a lista leve: os 54 ativos e o touro do sêmen (animal de referência)');
  assert.ok(dgK.event_id && v1k.event_id);
});
