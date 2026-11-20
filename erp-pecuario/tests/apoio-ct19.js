'use strict';
/**
 * Apoio do CT-19 (09-plano-de-testes.md; 07-financeiro-e-indicadores.md, seção 2.2): o caso numérico inteiro do 07 — a compra de
 * A1, A2 e A3 por cabeça com o frete por cabeça (o re-rateio do frete pelo evento RATEIO), a vacina em estoque e a aplicação, as
 * duas parcelas (a segunda com R$ 45,00 de juros), a transferência para o Pasto 2 arrendado, o arrendamento de junho rateado pelos
 * dias de permanência, a morte de A3, a contabilidade sem rateio e a venda de A1 e A2 por arroba de carcaça com a taxa retida,
 * recebida em 20/12 — montado pela api(), com a integridade, a projeção e a identidade conferidas depois de cada comando.
 * Não é arquivo de teste.
 */
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const TODOS = ['POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO', 'CARENCIA_ATIVA', 'RATEIO_BASE_ZERO', 'ESTOQUE_INSUFICIENTE', 'PRODUTO_SEM_ESTOQUE'];

function hoje(s, d) { s.gas.clock.now = Date.parse(d + 'T15:00:00.000Z'); }
function semErro(s, onde) {
  const rel = s.integridade();
  assert.deepEqual(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3), [], 'integridade sem erro: ' + onde);
  s.conferirProjecoes(onde);
}
/** O sistema com a api() e os atalhos dos testes do financeiro. */
function montar(dia) {
  const s = S.sistema();
  hoje(s, dia || '2027-03-10');
  s.hoje = (d) => hoje(s, d);
  s.api = (rota, dados, av) => S.js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: 'k-' + Math.random(), avisosAceitos: av || TODOS })));
  s.ok = (rota, dados, av) => { const r = s.api(rota, dados, av); assert.equal(r.ok, true, rota + ': ' + String(JSON.stringify(r.error)).slice(0, 1500)); semErro(s, rota); return r.data; };
  s.consulta = (rota, dados) => { const r = s.api(rota, dados); assert.equal(r.ok, true, rota + ': ' + String(JSON.stringify(r.error)).slice(0, 1500)); return r.data; };
  s.falha = (rota, dados) => { const r = s.api(rota, dados); assert.equal(r.ok, false, rota + ' deveria ser recusado'); return r.error; };
  s.conta = (cod) => s.tabela('PLANO_CONTAS').find((x) => x.codigo === cod).conta_id;
  s.finDo = (eid) => s.tabela('FINANCEIRO').filter((f) => f.event_id === eid);
  s.parcelasDe = (fid) => s.tabela('PARCELAS').filter((p) => p.financial_id === fid && p.status !== 'CANCELADA').sort((a, b) => a.parcela_num - b.parcela_num);
  return s;
}
/**
 * O caso do 07, seção 2.2, em 2027 (o marco zero do apoio é 01/01/2026). `ate`: monta só até essa data (o passo de cada fato), e
 * devolve {s, id: {A1, A2, A3}, ev: {compra, venda, morte, arrend, contab}, fin: {F1 … F8}, produto}.
 */
function caso22(ate) {
  const limite = ate || '9999-12-31';
  const s = montar('2027-03-10');
  const out = { s, id: {}, ev: {}, fin: {} };
  const passo = (d, fn) => { if (d > limite) return false; hoje(s, d); fn(); return true; };
  // Pasto 2 (o B) é arrendado; o vizinho é o arrendador.
  const viz = s.ok('parceiro.salvar', { campos: { nome: 'Vizinho do Pasto 2', tipos: 'ARRENDADOR' } }).partner_id;
  s.ok('pasto.salvar', { pasture_id: S.PASTOS.B, campos: { posse: 'ARRENDADO', arrendador_id: viz, area_hectares: 20 }, justificativa: 'Pasto arrendado do vizinho' });
  s.ok('pasto.salvar', { pasture_id: S.PASTOS.A, campos: { area_hectares: 50 }, justificativa: 'Área medida' });
  const forn = s.ok('parceiro.salvar', { campos: { nome: 'Recriador', tipos: 'FORNECEDOR' } }).partner_id;
  const frig = s.ok('parceiro.salvar', { campos: { nome: 'Frigorífico Boi Bom', tipos: 'COMPRADOR' } }).partner_id;
  out.parceiros = { viz, forn, frig };
  const g = (b, v) => ({ brinco: b, sexo: 'M', castrado: true, reprodutor: false, idade_meses: 20, valor_individual: v });
  passo('2027-03-10', () => {
    const cp = s.ok('evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2027-03-10', partner_id: forn, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', valor_animais: 900000 },
      animais: [g('A1', 300000), g('A2', 310000), g('A3', 290000)],
      parcelas: [{ data_vencimento: '2027-04-09', valor: 450000 }, { data_vencimento: '2027-05-09', valor: 450000 }], custos: [{ tipo: 'FRETE', valor: 10000 }] });
    out.ev.compra = cp.event_id;
    cp.animais.forEach((a) => { out.id[a.brinco] = a.animal_id; });
    const fins = s.finDo(cp.event_id).sort((a, b) => b.valor - a.valor);
    out.fin.F1 = fins[0].financial_id;
    out.fin.F2 = fins[1].financial_id;
    // O frete do documento é rateado por cabeça (33,34 / 33,33 / 33,33): o re-rateio do frete entre os animais da compra.
    s.ok('evento.registrar', { tipo: 'RATEIO', campos: { event_date: '2027-03-10', financial_id: out.fin.F2, criterio: 'CABECAS', escopo_tipo: 'EVENTO', justificativa_rateio: 'Frete por cabeça, como no conhecimento' } });
    s.ok('parcela.baixar', { parcela_id: s.parcelasDe(out.fin.F2)[0].parcela_id, data_pagamento: '2027-03-10', forma_pagamento: 'PIX' });
  });
  passo('2027-04-02', () => {
    out.produto = s.ok('produto.salvar', { campos: { nome: 'Vacina Aftosa', categoria: 'VACINA', unidade: 'dose', controla_estoque: true, custo_unitario: 3 } }).product_id;
    const e = s.ok('evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2027-04-02', product_id: out.produto, quantidade: 10, valor: 3000 } });
    out.fin.F3 = s.finDo(e.event_id)[0].financial_id;
    s.ok('parcela.baixar', { parcela_id: s.parcelasDe(out.fin.F3)[0].parcela_id, data_pagamento: '2027-04-02', forma_pagamento: 'PIX' });
  });
  passo('2027-04-05', () => {
    const v = s.ok('evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2027-04-05', produto_id: out.produto, modo_dose: 'POR_CABECA', dose_referencia: 1 }, animais: ['A1', 'A2', 'A3'].map((b) => ({ animal_id: out.id[b] })) });
    out.fin.F4 = s.finDo(v.event_id)[0].financial_id;
  });
  passo('2027-04-09', () => { s.ok('parcela.baixar', { parcela_id: s.parcelasDe(out.fin.F1)[0].parcela_id, data_pagamento: '2027-04-09', forma_pagamento: 'PIX' }); });
  passo('2027-05-24', () => { s.ok('parcela.baixar', { parcela_id: s.parcelasDe(out.fin.F1)[1].parcela_id, data_pagamento: '2027-05-24', juros_multa: 4500, forma_pagamento: 'PIX' }); });
  passo('2027-06-01', () => { s.ok('evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2027-06-01', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: out.id.A1 }, { animal_id: out.id.A3 }] }); });
  passo('2027-06-05', () => {
    const l = s.ok('evento.registrar', { tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2027-06-01', conta_id: s.conta('ARRENDAMENTO_PASTO'), valor: 60000, pasture_id: S.PASTOS.B, partner_id: viz, competencia_inicio: '2027-06-01', competencia_fim: '2027-06-30', descricao: 'Arrendamento do Pasto 2 (junho)' }, parcelas: [{ data_vencimento: '2027-06-05', pago_em: '2027-06-05' }] });
    out.ev.arrend = l.event_id;
    out.fin.F5 = s.finDo(l.event_id)[0].financial_id;
  });
  passo('2027-06-11', () => { s.ok('evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2027-06-11', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: out.id.A2 }] }); });
  passo('2027-06-16', () => { out.ev.morte = s.ok('evento.registrar', { tipo: 'MORTE', campos: { event_date: '2027-06-16', causa: 'DOENCA' }, animais: [{ animal_id: out.id.A3 }] }).event_id; });
  passo('2027-06-30', () => {
    const l = s.ok('evento.registrar', { tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2027-06-30', conta_id: s.conta('CONTABILIDADE'), valor: 20000, descricao: 'Contabilidade de junho' }, parcelas: [{ data_vencimento: '2027-06-30', pago_em: '2027-06-30' }] });
    out.ev.contab = l.event_id;
    out.fin.F6 = s.finDo(l.event_id)[0].financial_id;
  });
  passo('2027-07-01', () => { out.ev.rateioArrend = s.ok('evento.registrar', { tipo: 'RATEIO', campos: { event_date: '2027-07-01', financial_id: out.fin.F5 } }).event_id; });
  passo('2027-11-20', () => {
    const v = s.ok('evento.registrar', { tipo: 'VENDA', campos: { event_date: '2027-11-20', partner_id: frig, finalidade: 'ABATE', modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor_bruto: 1184000 },
      animais: [{ animal_id: out.id.A1, peso: 540, peso_carcaca_kg: 285 }, { animal_id: out.id.A2, peso: 520, peso_carcaca_kg: 270 }],
      parcelas: [{ data_vencimento: '2027-12-20' }], deducoes: [{ tipo: 'TAXA_FRIGORIFICO', valor: 17760, retida_pelo_comprador: true }] });
    out.ev.venda = v.event_id;
    const fins = s.finDo(v.event_id).sort((a, b) => b.valor - a.valor);
    out.fin.F7 = fins[0].financial_id;
    out.fin.F8 = fins[1].financial_id;
  });
  passo('2027-12-20', () => { s.ok('parcela.baixar', { parcela_id: s.parcelasDe(out.fin.F7)[0].parcela_id, data_pagamento: '2027-12-20', forma_pagamento: 'TRANSFERENCIA' }); });
  return out;
}

module.exports = { TODOS, montar, hoje, semErro, caso22 };
