'use strict';
/**
 * Verificação de integridade (06, seção 9): sobre um banco montado pelo setup e com eventos reais, cada checagem
 * dispara quando a planilha é adulterada à mão no fake — projeção alterada, linha apagada, célula coercida, referência
 * quebrada, situação de evento, chave repetida, brinco repetido, cabeçalho, fuso, alocação, cópia × fonte, contadores
 * — com a severidade certa; o reparo oferecido (reconstruir) devolve o banco ao estado íntegro e fica auditado.
 * Também: a verificação entra depois da recuperação (operação interrompida não aparece como órfã) e a trilha de
 * auditoria é listada em páginas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { PASTOS, situacoes } = S;

/** Sistema com três animais (mãe e filha; valor de abertura; pesagem; prenhez) e integridade limpa. */
function base(opcoes) {
  const s = S.sistema(opcoes);
  const ev = s.evento('registrar', S.entradaInicial([
    S.bicho({ brinco: '100', ref: 'm', data_nascimento: '2018-03-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 2, situacao_reprodutiva: 'PRENHA', data_prevista_parto: '2026-04-01', valor_abertura: 350000 }),
    S.bicho({ brinco: '101', mae_ref: 'm', mae_confianca: 'CONFIRMADA', data_nascimento: '2025-02-01', data_nascimento_confianca: 'ESTIMADA', peso: 180, metodo_pesagem: 'BALANCA', valor_abertura: 150000 }),
    S.bicho({ brinco: '102', sexo: 'M', data_nascimento: '2025-05-01', data_nascimento_confianca: 'CONFIRMADA', pasto_destino_id: PASTOS.B }),
  ]), 'ev-base');
  const ids = ev.dados.animais.map((a) => a.animal_id);
  const r = s.integridade();
  assert.equal(r.ok, true, 'banco íntegro antes da adulteração: ' + JSON.stringify(r.achados));
  assert.equal(r.alertas, 0, JSON.stringify(r.achados));
  return { s, ids, eventId: ev.dados.event_id };
}

test('integridade limpa: todas as checagens executadas, sem achados; o relatório tem a forma do contrato', () => {
  const { s } = base();
  const r = s.integridade();
  assert.deepEqual(Object.keys(r).sort(), ['abas_ausentes', 'achados', 'alertas', 'banco', 'checagens', 'data_version', 'duracao_ms', 'erros', 'gerado_em', 'ok', 'reparavel', 'truncado']);
  assert.equal(r.checagens.length, s.G.AuditService.CHECAGENS.length);
  assert.deepEqual(r.checagens.filter((c) => c.situacao !== 'OK').map((c) => c.codigo), [], 'todas executadas e OK');
  assert.equal(r.reparavel, false);
  assert.ok(Number.isInteger(r.duracao_ms) && r.duracao_ms >= 0, 'tempo da verificação pelo relógio do contexto');
});

test('projeção alterada à mão: PROJECAO (com reparo) e INVENTARIO por pasto; o reparo reconstrói, audita e limpa', () => {
  const { s, ids } = base({ order: 'reverse' });
  s.editar('ANIMAIS', ids[0], 'pasto_atual_id', PASTOS.B);
  let r = s.integridade();
  assert.deepEqual(situacoes(r), { PROJECAO: 'ERRO', INVENTARIO: 'ERRO' });
  const p = r.achados.find((a) => a.checagem === 'PROJECAO');
  assert.deepEqual([p.tabela, p.id, p.campo, p.reparo], ['ANIMAIS', ids[0], 'pasto_atual_id', 'RECONSTRUIR']);
  assert.match(p.mensagem, /A-000001 \(brinco 100\): pasto_atual_id gravado/);
  assert.equal(r.reparavel, true);
  assert.equal(r.ok, false);
  const rep = s.exec((ctx) => s.G.AuditService.repararIntegridade(ctx, 'Pasto mexido na planilha'));
  assert.equal(rep.integridade.ok, true);
  assert.equal(s.tabela('ANIMAIS')[0].pasto_atual_id, PASTOS.A);
  const trilha = s.tabela('AUDITORIA').filter((a) => a.acao === 'MANUTENCAO' && /verificação de integridade/.test(a.valor_novo));
  assert.equal(trilha.length, 1);
  assert.equal(trilha[0].justificativa, 'Pasto mexido na planilha');
  // Situação do evento adulterada: STATUS_EVENTOS com reparo.
  const ev = s.tabela('EVENTOS')[0];
  s.editar('EVENTOS', ev.event_id, 'status', 'ESTORNADO');
  r = s.integridade();
  assert.deepEqual(situacoes(r), { STATUS_EVENTOS: 'ERRO' });
  s.exec((ctx) => s.G.AuditService.repararIntegridade(ctx));
  assert.equal(s.integridade().ok, true);
  assert.equal(s.tabela('EVENTOS')[0].status, 'CONFIRMADO');
});

test('linha apagada: EVENTO_ANIMAIS some → entrada aberta, projeção e inventário; EVENTOS some → também linhas sem pai (alerta)', () => {
  const { s, ids } = base();
  const ea = s.tabela('EVENTO_ANIMAIS').find((l) => l.animal_id === ids[2]);
  s.apagarLinha('EVENTO_ANIMAIS', ea.event_animal_id);
  let r = s.integridade();
  const sit = situacoes(r);
  assert.equal(sit.ENTRADA_ABERTA, 'ERRO');
  assert.equal(sit.PROJECAO, 'ERRO');
  assert.equal(sit.INVENTARIO, 'ERRO');
  assert.match(r.achados.find((a) => a.checagem === 'ENTRADA_ABERTA').mensagem, /A-000003 \(brinco 102\) está ativo, mas os eventos somam 0/);
  assert.ok(r.achados.some((a) => a.checagem === 'INVENTARIO' && /Pasto B: os eventos dão 0 cabeças e a situação dos animais dá 1/.test(a.mensagem)));

  const s2 = base().s;
  const ev = s2.tabela('EVENTOS')[0];
  s2.apagarLinha('EVENTOS', ev.event_id);
  r = s2.integridade();
  assert.equal(situacoes(r).FILHAS_SEM_PAI, 'ALERTA');
  assert.ok(r.achados.some((a) => a.checagem === 'FILHAS_SEM_PAI' && a.tabela === 'EVENTO_ANIMAIS' && a.severidade === 'ALERTA'));
  assert.equal(situacoes(r).PROJECAO, 'ERRO', 'os animais ficaram sem a entrada que os sustenta');
});

test('célula coercida, referência quebrada, chave repetida, brinco repetido e contadores', () => {
  const { s, ids, eventId } = base();
  // Data gravada como data nativa (o dono digitou numa célula "Geral"): COERCIDA vira alerta.
  const pes = s.tabela('PESAGENS')[0];
  s.editar('PESAGENS', pes.weight_id, 'data_pesagem', { data: 46023 });
  let r = s.integridade();
  assert.equal(situacoes(r).CELULAS, 'ALERTA');
  assert.ok(r.achados.some((a) => a.checagem === 'CELULAS' && a.tabela === 'PESAGENS' && a.campo === 'data_pesagem'));
  // Texto que virou número num ID: erro.
  s.editar('EVENTO_ANIMAIS', s.tabela('EVENTO_ANIMAIS')[0].event_animal_id, 'animal_id', 12345);
  r = s.integridade();
  assert.equal(situacoes(r).CELULAS, 'ERRO');

  const b = base();
  // Referência quebrada: pasto de destino que não existe.
  const ea = b.s.tabela('EVENTO_ANIMAIS').find((l) => l.animal_id === b.ids[1]);
  b.s.editar('EVENTO_ANIMAIS', ea.event_animal_id, 'pasto_destino_id', S.id(0xdead));
  r = b.s.integridade();
  const fk = r.achados.find((a) => a.checagem === 'FK');
  assert.ok(fk, JSON.stringify(situacoes(r)));
  assert.deepEqual([fk.tabela, fk.campo, fk.severidade], ['EVENTO_ANIMAIS', 'pasto_destino_id', 'ERRO']);
  assert.match(fk.mensagem, /aponta para PASTOS .*que não existe/);

  const c = base();
  // Chave repetida e número de evento repetido (linha duplicada à mão) e brinco repetido.
  const m = c.s.gas.planilhas.matriz(c.s.banco(), 'IDENTIFICACOES');
  c.s.gas.planilhas.gravar(c.s.banco(), 'IDENTIFICACOES', m.length + 1, 1, [m[1]]);
  c.s.editar('ANIMAIS', c.ids[2], 'brinco', '100');
  r = c.s.integridade();
  const sit = situacoes(r);
  assert.equal(sit.PK, 'ERRO');
  assert.equal(sit.BRINCO, 'ERRO');
  assert.match(r.achados.find((a) => a.checagem === 'BRINCO').mensagem, /O brinco 100 está em 2 animais: A-000001, A-000003/);
  const meta = c.s.gas.planilhas.matriz(c.s.banco(), 'EVENTOS');
  const linha2 = meta[1].slice();
  linha2[0] = S.id(0xbeef);
  c.s.gas.planilhas.gravar(c.s.banco(), 'EVENTOS', meta.length + 1, 1, [linha2]);
  r = c.s.integridade();
  assert.equal(situacoes(r).CONTADORES, 'ERRO');
  assert.ok(eventId && ids.length === 3);
});

test('estrutura: cabeçalho renomeado, coluna do dono, aba apagada e localidade trocada; setup conserta o que é dele', () => {
  const { s } = base();
  const { gas, G } = s;
  const cab = gas.planilhas.matriz(s.banco(), 'BAIXAS')[0];
  gas.planilhas.gravar(s.banco(), 'BAIXAS', 1, cab.indexOf('causa') + 1, [['Causa da morte']]);
  gas.exec(() => G.SpreadsheetApp.openById(s.banco()).setSpreadsheetLocale('en_US'));
  let r = s.integridade();
  assert.equal(situacoes(r).CABECALHOS, 'ERRO');
  assert.equal(situacoes(r).FUSO_LOCALE, 'ERRO');
  assert.ok(r.achados.some((a) => a.checagem === 'CABECALHOS' && a.campo === 'causa' && a.severidade === 'ERRO'));
  assert.ok(r.achados.some((a) => a.checagem === 'CABECALHOS' && a.campo === 'Causa da morte' && a.severidade === 'ALERTA'), 'coluna desconhecida é só alerta');
  // Aba inteira apagada: só a estrutura é conferida (os dados dependem das abas), e o relatório diz qual falta.
  gas.exec(() => { const ss = G.SpreadsheetApp.openById(s.banco()); ss.deleteSheet(ss.getSheetByName('VENDAS')); });
  r = s.integridade();
  assert.deepEqual(r.abas_ausentes, ['VENDAS']);
  assert.ok(r.achados.some((a) => a.checagem === 'CABECALHOS' && /A aba VENDAS não existe/.test(a.mensagem)));
  assert.equal(r.checagens.find((c) => c.codigo === 'PROJECAO').situacao, 'NAO_EXECUTADA');
  // O setup recria a aba e a coluna (no fim) e fixa a localidade; a coluna renomeada pelo dono fica.
  const rel = S.js(gas.exec(() => G.Maintenance.setup({ usuario: S.USUARIO })));
  assert.deepEqual(rel.abas.criadas, ['VENDAS']);
  assert.deepEqual(rel.abas.colunas_acrescentadas, { BAIXAS: ['causa'] });
  r = rel.integridade;
  assert.equal(r.ok, true, JSON.stringify(r.achados));
  assert.equal(r.alertas, 1, 'só a coluna do dono, que o sistema ignora');
});

test('financeiro e cópias: alocação adulterada, parcela, data de detalhe diferente da do evento; pendências só alertam', () => {
  const { s, ids } = base();
  const al = s.tabela('ALOCACOES_FINANCEIRAS').find((a) => a.animal_id === ids[0]);
  s.editar('ALOCACOES_FINANCEIRAS', al.alloc_id, 'valor_alocado', 3600);
  let r = s.integridade();
  assert.equal(situacoes(r).ALOCACOES, 'ERRO');
  assert.ok(r.achados.some((a) => a.checagem === 'ALOCACOES' && /O rateio soma R\$ 5\.100,00 nas alocações, mas registra R\$ 5\.000,00/.test(a.mensagem)), JSON.stringify(r.achados));
  s.editar('ALOCACOES_FINANCEIRAS', al.alloc_id, 'valor_alocado', 3500);
  assert.equal(s.integridade().ok, true);
  // Base de rateio desatualizada (alerta) e parcela que não fecha com o lançamento.
  s.editar('ALOCACOES_FINANCEIRAS', al.alloc_id, 'base_valor', 3000);
  r = s.integridade();
  assert.equal(situacoes(r).BASE_RATEIO, 'ALERTA');
  s.editar('ALOCACOES_FINANCEIRAS', al.alloc_id, 'base_valor', 3500);
  const fin = s.tabela('FINANCEIRO')[0];
  const parcela = { parcela_id: S.id(0x77), financial_id: fin.financial_id, parcela_num: 1, data_vencimento: '2026-02-01', valor: 10, status: 'ABERTA', created_at: '2026-01-01T00:00:00.000Z' };
  s.gas.planilhas.gravar(s.banco(), 'PARCELAS', 2, 1, [s.G.Schema.colunas('PARCELAS').map((c) => (parcela[c] === undefined ? '' : parcela[c]))]);
  r = s.integridade();
  assert.equal(situacoes(r).PARCELAS, 'ERRO');
  assert.match(r.achados.find((a) => a.checagem === 'PARCELAS').mensagem, /As parcelas somam R\$ 10,00 e o lançamento vale R\$ 5\.000,00/);
  s.apagarLinha('PARCELAS', S.id(0x77));
  // Cópia × fonte: data da pesagem diferente da data do evento.
  const pes = s.tabela('PESAGENS')[0];
  s.editar('PESAGENS', pes.weight_id, 'data_pesagem', '2026-01-05');
  r = s.integridade();
  assert.deepEqual(situacoes(r), { COPIAS: 'ERRO', PROJECAO: 'ERRO' }, 'a data da pesagem também alimenta a projeção do peso');
  s.editar('PESAGENS', pes.weight_id, 'data_pesagem', '2026-01-01');
  // Pendências: animal ativo sem brinco → alerta; o banco continua "ok".
  s.evento('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-03-01', description: 'Doação' }, animais: [S.bicho({ data_nascimento: '2025-12-01', data_nascimento_confianca: 'ESTIMADA' })] }, 'ev-outra');
  r = s.integridade();
  assert.deepEqual(situacoes(r), { PENDENCIAS: 'ALERTA' });
  assert.equal(r.ok, true);
  assert.match(r.achados[0].mensagem, /A-000004 está sem brinco/);
});

test('a verificação entra depois da recuperação: operação interrompida é concluída antes e não aparece como órfã; auditoria em páginas', () => {
  const { s, ids } = base();
  const { gas, G } = s;
  // Correção de localização interrompida logo depois do commit (antes dos derivados).
  const alvo = { depois: null };
  const r = gas.tentar(() => {
    const ctx = s.ctx();
    require('./apoio-persistencia').instrumentar(gas, ctx, Object.assign(alvo, { antesDe: (k, rotulo) => { if (rotulo === 'atualizar:OPERACOES.status' && alvo.depois === null) alvo.depois = k; } }));
    return G.EventService.registrar(ctx, { idempotencyKey: 'ajuste-1', dados: { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: '2026-02-01', justificativa: 'Conferência' }, animais: [{ animal_id: ids[1], pasto_destino_id: PASTOS.B }] } });
  });
  assert.equal(r.morta, true);
  assert.ok(gas.props.script._data.get('PENDING_OP:' + s.banco()), 'ficou o marcador da operação interrompida');
  const rel = s.integridade();
  assert.equal(rel.ok, true, JSON.stringify(rel.achados));
  assert.equal(rel.checagens.find((c) => c.codigo === 'OPERACOES_ORFAS').situacao, 'OK');
  assert.equal(s.tabela('ANIMAIS').find((a) => a.animal_id === ids[1]).pasto_atual_id, PASTOS.B, 'a recuperação concluiu a operação confirmada');
  // auditoria.listar: só operações confirmadas, mais recente primeiro, paginada.
  const pg = s.exec((ctx) => G.AuditService.listarAuditoria(ctx, { por_pagina: 5, pagina: 2 })).dados;
  const todas = s.exec((ctx) => G.AuditService.listarAuditoria(ctx, { por_pagina: 500 })).dados;
  assert.equal(pg.total, todas.total);
  assert.deepEqual(pg.itens, todas.itens.slice(5, 10));
  assert.ok(todas.itens[0].timestamp >= todas.itens[todas.itens.length - 1].timestamp);
  const filtrada = s.exec((ctx) => G.AuditService.listarAuditoria(ctx, { entidade: 'OPERACOES', acao: 'RECUPERACAO' })).dados;
  assert.equal(filtrada.total, 1, 'a recuperação ficou na trilha');
});
