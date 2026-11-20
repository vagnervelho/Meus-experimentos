'use strict';
/**
 * Revisão da Fase 3, rodada 3 (conserto), achados do motor, do custo e da integridade, cada um por caminho: a carência padrão
 * do produto do cadastro na aplicação sem os dias (importação, API e correção), a projeção da mãe mexida à mão num bezerro
 * desmamado (reparável), o brinco na data depois de uma IDENTIFICACAO_INCORRETA, a morte retroativa da mãe posta na desmama
 * (o caminho que funciona), o movimento do mesmo dia depois da contagem (aceito, na ordem do dia), a revisão da correção da
 * entrada sem movimento e da aplicação gravada sem custo, o dia do cadastro do protocolo no fuso da fazenda e o aviso de
 * lotação com a parte estimada por estimativa visual.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave || 'k-' + Math.random(), avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + String(JSON.stringify(r.error)).slice(0, 1500));
  return r.data;
}
function recusa(r, code, onde) {
  assert.equal(r.ok, false, (onde || '') + ': esperava ' + code);
  assert.equal(r.error.code, code, (onde || '') + ': ' + JSON.stringify(r.error).slice(0, 900));
  return r.error;
}
const cods = (e) => e.details.map((d) => d.codigo);
const hoje = (s, iso) => { s.gas.clock.now = Date.parse(iso + 'T15:00:00.000Z'); };
function san(subtipo, data, ids, campos) {
  return { tipo: 'SANIDADE', subtipo, campos: Object.assign({ event_date: data }, campos || {}), animais: ids.map((x) => (typeof x === 'string' ? { animal_id: x } : x)) };
}
function estoque(subtipo, data, campos) {
  return { tipo: 'ESTOQUE', subtipo, campos: Object.assign({ event_date: data }, campos || {}) };
}
function rebanho(s, brincos, extra) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(brincos.map((b) => S.bicho(Object.assign({ brinco: b, sexo: 'F', data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' }, extra || {})))), 'rebanho-' + brincos.join('-')), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
function produto(s, campos) {
  return ok(api(s, 'produto.salvar', { campos: Object.assign({ nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', controla_estoque: true }, campos || {}) }), 'produto');
}
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
const saldo = (s, pid) => s.tabela('PRODUTOS').find((p) => p.product_id === pid).estoque_atual;
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
/** Importa um CSV de manejo (modelo sugerido) até concluir; devolve as linhas validadas. */
function importar(s, tipo, chave, linhasCsv) {
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar-' + chave, dados: { tipo, arquivo_nome: chave + '.csv', conteudo_base64: b64(linhasCsv.join('\n')), formato: FORMATO } })).dados;
  const mapa = { colunas: c.sugestao, confiancas: {}, padroes: {} };
  for (let b = 1; b < 10; b++) {
    const est = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + chave + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
    if (est.importacao.status === 'VALIDADO') break;
  }
  const linhas = s.read(s.G.ImportService.consultaLinhas({ import_id: c.import_id, por_pagina: 50 })).itens;
  const ib = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(ib.ok, chave + ': ' + JSON.stringify(ib.erro));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  return linhas;
}

test('achado 1: sem os dias de carência, a aplicação com produto do cadastro usa a carência padrão dele — importação, API e correção; o 0 informado é "sem carência"; a venda para abate dentro dela é bloqueada (CARENCIA_ATIVA)', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['601', '602', '603', '604'], { sexo: 'M', castrado: true, data_nascimento: '2023-01-01' });
  const pid = produto(s, { nome: 'Ivermectina 1%', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 1, carencia_padrao_dias: 35, dose_padrao_por_cabeca: 5 }).product_id;
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-10-01', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada');
  const frig = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: 'COMPRADOR' } })).partner_id;
  // Importação no modelo padrão, sem a coluna opcional da carência.
  importar(s, 'SANIDADE', 'iver', ['Data;Procedimento;Produto do cadastro;Como foi a dose;Dose do lançamento (por cabeça ou por kg);Brinco', '01/11/2026;vermifugação;Ivermectina 1%;por cabeça;5;601']);
  const imp = tab(s, 'SANIDADE', { animal_id: ids['601'] })[0];
  assert.deepEqual([imp.periodo_carencia_dias, imp.data_fim_carencia], [35, '2026-12-06'], 'a carência do cadastro');
  const venda = (data, id) => ({ tipo: 'VENDA', campos: { event_date: data, partner_id: frig, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 400000 }, animais: [{ animal_id: id }], parcelas: [{ data_vencimento: data }] });
  const e = recusa(api(s, 'evento.registrar', venda('2026-11-10', ids['601'])), 'VALIDATION', 'abate dentro da carência');
  assert.ok(cods(e).includes('CARENCIA_ATIVA'), JSON.stringify(e));
  // Pela API sem o campo: a mesma regra (o servidor decide, não o formulário).
  const r = ok(api(s, 'evento.registrar', san('VERMIFUGACAO', '2026-11-02', [ids['602']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 5 })), 'API sem carência');
  const s602 = tab(s, 'SANIDADE', { event_id: r.event_id })[0];
  assert.deepEqual([s602.periodo_carencia_dias, s602.data_fim_carencia], [35, '2026-12-07']);
  const sim = ok(api(s, 'evento.simular', { acao: 'registrar', dados: san('VERMIFUGACAO', '2026-11-02', [ids['604']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 5 }) }), 'simulação');
  assert.deepEqual([sim.impactos.sanidade.carencia_dias, sim.impactos.sanidade.fim_carencia], [35, '2026-12-07'], 'a revisão mostra a carência que será gravada');
  // O 0 informado é "sem carência"; os dias informados valem.
  const r0 = ok(api(s, 'evento.registrar', san('VERMIFUGACAO', '2026-11-03', [ids['603']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 5, periodo_carencia_dias: 0 })), 'carência 0');
  assert.deepEqual([tab(s, 'SANIDADE', { event_id: r0.event_id })[0].periodo_carencia_dias, tab(s, 'SANIDADE', { event_id: r0.event_id })[0].data_fim_carencia || null], [0, null]);
  const r20 = ok(api(s, 'evento.registrar', san('VERMIFUGACAO', '2026-11-03', [ids['604']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 5, periodo_carencia_dias: 20 })), 'carência 20');
  assert.equal(tab(s, 'SANIDADE', { event_id: r20.event_id })[0].periodo_carencia_dias, 20);
  // O nome livre (sem cadastro) não tem padrão: sem os dias, sem carência.
  const rl = ok(api(s, 'evento.registrar', san('VERMIFUGACAO', '2026-11-04', [ids['603']], { nome_produto: 'Doramectina', modo_dose: 'POR_CABECA', dose_referencia: 1, unidade_dose: 'mL' })), 'nome livre');
  assert.equal(tab(s, 'SANIDADE', { event_id: rl.event_id })[0].periodo_carencia_dias || null, null);
  semErro(s, 'carência padrão');
});

test('achado 10: a projeção ANIMAIS.mae_id de um bezerro desmamado mexida à mão é achado de PROJECAO (reparável), não fonte quebrada; o reparo a refaz', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['101', '102']);
  const n1 = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-01' }, animais: [{ animal_id: ids['101'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '901' }] }), 'nascimento');
  const cria = n1.animais.find((a) => a.animal_id !== ids['101']).animal_id;
  ok(api(s, 'evento.registrar', { tipo: 'DESMAMA', campos: { event_date: '2026-09-01' }, animais: [{ animal_id: cria, peso: 180 }] }), 'desmama');
  semErro(s, 'antes');
  s.editar('ANIMAIS', cria, 'mae_id', ids['102']);
  const rel = s.integridade();
  const erros = rel.achados.filter((a) => a.severidade === 'ERRO');
  assert.deepEqual(erros.map((a) => a.checagem), ['PROJECAO'], JSON.stringify(erros.map((a) => a.mensagem)));
  assert.equal(rel.reparavel, true);
  assert.ok(!rel.reparo_impedido, rel.reparo_impedido);
  const rep = s.tentar((ctx) => s.G.AuditService.repararIntegridade(ctx, 'teste'));
  assert.ok(rep.ok, JSON.stringify(rep.erro));
  assert.equal(s.tabela('ANIMAIS').find((a) => a.animal_id === cria).mae_id, ids['101']);
  semErro(s, 'depois do reparo');
});

test('achados 11 e 18: numa data passada, o brinco do animal é o corrigido por IDENTIFICACAO_INCORRETA desde o início do número errado (inventario.elegiveis); a troca física depois continua com a data dela', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['0457', '0500']);
  const a = ids['0457'];
  ok(api(s, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: '2026-06-01', justificativa: 'Brinco digitado errado' }, animais: [{ animal_id: a, brinco: '0475' }] }), 'identificação incorreta');
  const em = (data) => ok(api(s, 'inventario.elegiveis', { tipo: 'PESAGEM', data }), 'elegíveis ' + data).itens.find((x) => x.animal_id === a);
  assert.deepEqual([em('2026-03-15').brinco, em('2026-03-15').brinco_hoje], ['0475', '0475'], 'o número que nunca esteve na orelha não é o do dia');
  assert.equal(em('2026-01-01').brinco, '0475');
  assert.equal(em('2026-07-01').brinco, '0475');
  // A troca física em 01/09 (renumeração) continua valendo da data dela.
  ok(api(s, 'evento.registrar', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-09-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: a, codigo: '0777', motivo: 'RENUMERACAO' }] }), 'troca');
  assert.equal(em('2026-08-31').brinco, '0475');
  assert.equal(em('2026-09-02').brinco, '0777');
  // A importação na mesma data acha o mesmo animal pelo número verdadeiro (um só critério de brinco na data).
  const linhas = importar(s, 'PESAGENS', 'pes', ['Data;Momento;Método;Brinco;Peso', '15/03/2026;rotina;balança;0475;400']);
  assert.deepEqual(linhas.map((l) => l.status), ['VALIDA']);
  assert.equal(tab(s, 'PESAGENS', { data_pesagem: '2026-03-15' })[0].animal_id, a);
  semErro(s, 'brinco na data');
});

test('achado 12: a morte retroativa da mãe posta na desmama pelo servidor é recusada com o caminho que funciona (estornar a desmama, gravar a morte, desmamar de novo), e o caminho funciona', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['101', '102']);
  const c1 = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-01' }, animais: [{ animal_id: ids['101'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '901' }] }), 'nasc 1').animais.find((x) => x.animal_id !== ids['101']).animal_id;
  const c2 = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-03' }, animais: [{ animal_id: ids['102'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '902' }] }), 'nasc 2').animais.find((x) => x.animal_id !== ids['102']).animal_id;
  const desmama = { tipo: 'DESMAMA', campos: { event_date: '2026-09-01' }, animais: [{ animal_id: c1, peso: 180 }, { animal_id: c2, peso: 170 }] };
  const dz = ok(api(s, 'evento.registrar', desmama), 'desmama');
  const morte = { tipo: 'MORTE', campos: { event_date: '2026-07-10', causa: 'DOENCA' }, animais: [{ animal_id: ids['101'] }] };
  const e = recusa(api(s, 'evento.registrar', morte), 'CONFLICT', 'morte da mãe');
  const d = e.details.find((x) => x.codigo === 'APOS_MORTE');
  assert.ok(d, JSON.stringify(e.details));
  assert.match(d.mensagem, /como a mãe do bezerro.*corrigir a desmama não a tira: estorne a desmama de 01\/09\/2026, grave este lançamento e lance a desmama dos bezerros de novo/);
  assert.equal(d.conflito.event_id, dz.event_id);
  // O caminho dito funciona.
  ok(api(s, 'evento.estornar', { event_id: dz.event_id, justificativa: 'A 101 morreu antes da desmama' }), 'estorno da desmama');
  ok(api(s, 'evento.registrar', morte), 'morte');
  const dz2 = ok(api(s, 'evento.registrar', Object.assign({}, desmama, { campos: { event_date: '2026-09-01' } })), 'desmama de novo');
  const maes = tab(s, 'EVENTO_ANIMAIS', { event_id: dz2.event_id }).filter((l) => l.papel === 'MATRIZ').map((l) => l.animal_id);
  assert.deepEqual(maes, [ids['102']], 'a morta não é mais posta como mãe');
  semErro(s, 'morte da mãe');
});

test('achado 16: depois da contagem do estoque, o movimento do mesmo dia gravado depois dela (a vacinação da tarde, a perda, a compra) é aceito — a ordem do dia é a de registro; o mesmo dia ANTES dela (a correção de um movimento anterior) continua recusado; a verificação e a correção da contagem usam a posição dela', () => {
  const s = S.sistema();
  hoje(s, '2026-11-10');
  const ids = rebanho(s, ['101', '102']);
  const pid = produto(s, { nome: 'Vacina X', custo_unitario: 1 }).product_id;
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-11-01', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada');
  const manha = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-11-10', [ids['101']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'vacinação da manhã');
  const cont = ok(api(s, 'evento.registrar', estoque('AJUSTE', '2026-11-10', { product_id: pid, motivo_ajuste: 'CONTAGEM', saldo_contado: 97 })), 'contagem');
  assert.equal(saldo(s, pid), 97);
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-11-10', [ids['101'], ids['102']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 10 }), null, ['POSSIVEL_DUPLICIDADE']), 'vacinação da tarde');
  ok(api(s, 'evento.registrar', estoque('AJUSTE', '2026-11-10', { product_id: pid, motivo_ajuste: 'PERDA', quantidade: 5 })), 'perda da tarde');
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-11-10', { product_id: pid, quantidade: 50, valor: 5000 })), 'compra da tarde');
  assert.equal(saldo(s, pid), 97 - 20 - 5 + 50);
  semErro(s, 'movimentos depois da contagem');
  // A correção da vacinação da manhã (antes da contagem na ordem do dia) mudaria o que foi contado: recusada.
  const pedido = Object.assign({ event_id: manha.event_id, justificativa: 'Foram 3 doses' }, san('VACINACAO', '2026-11-10', [ids['101']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 3 }));
  const e = recusa(api(s, 'evento.corrigir', pedido), 'CONFLICT', 'correção da manhã');
  assert.ok(cods(e).includes('CONTAGEM_POSTERIOR'), JSON.stringify(e));
  assert.match(e.details.find((d) => d.codigo === 'CONTAGEM_POSTERIOR').mensagem, /de 97 doses para 95 doses/);
  // A correção da contagem fica no lugar dela: o saldo do sistema naquele ponto é o de antes da tarde (99), não o do fim do dia.
  const sim = ok(api(s, 'evento.simular', { acao: 'corrigir', dados: Object.assign({ event_id: cont.event_id, justificativa: 'Eram 96' }, estoque('AJUSTE', '2026-11-10', { product_id: pid, motivo_ajuste: 'CONTAGEM', saldo_contado: 96 })) }), 'simular correção da contagem');
  assert.deepEqual([sim.impactos.estoque.saldo_na_data, sim.impactos.estoque.quantidade], [99, -3]);
  ok(api(s, 'evento.corrigir', Object.assign({ event_id: cont.event_id, justificativa: 'Eram 96' }, estoque('AJUSTE', '2026-11-10', { product_id: pid, motivo_ajuste: 'CONTAGEM', saldo_contado: 96 }))), 'correção da contagem');
  assert.equal(saldo(s, pid), 96 - 20 - 5 + 50);
  semErro(s, 'contagem corrigida');
});

test('achado 17: a revisão da correção de uma entrada gravada sem movimento (com_movimento=false) diz que a compra continua fora do saldo, mesmo com o controle ligado depois; a entrada nova de produto sem controle diz que não controla', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const pid = produto(s, { nome: 'Vacina Q', custo_unitario: 1, controla_estoque: false }).product_id;
  const nova = ok(api(s, 'evento.simular', { acao: 'registrar', dados: estoque('ENTRADA', '2026-02-01', { product_id: pid, quantidade: 100, valor: 10000 }) }), 'simular sem controle');
  assert.match(nova.impactos.estoque.fora_do_estoque, /Vacina Q não controla estoque/);
  const e = ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada sem controle');
  ok(api(s, 'produto.salvar', { product_id: pid, campos: { controla_estoque: true }, justificativa: 'liga o controle' }), 'liga');
  const pedido = Object.assign({ event_id: e.event_id, justificativa: 'nota fiscal' }, estoque('ENTRADA', '2026-02-01', { product_id: pid, quantidade: 100, valor: 10000, documento: 'NF 9' }));
  const sim = ok(api(s, 'evento.simular', { acao: 'corrigir', dados: pedido }), 'simular correção');
  assert.match(sim.impactos.estoque.fora_do_estoque, /a correção a mantém fora do saldo.*acerte o estoque pela contagem/);
  const c = ok(api(s, 'evento.corrigir', pedido), 'correção');
  assert.deepEqual(tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: c.event_id }), [], 'nada entra no estoque, como a revisão disse');
  // Com o controle ligado, a entrada nova entra (sem o texto).
  const nova2 = ok(api(s, 'evento.simular', { acao: 'registrar', dados: estoque('ENTRADA', '2026-11-01', { product_id: pid, quantidade: 10, valor: 1000 }) }), 'simular com controle');
  assert.equal(nova2.impactos.estoque.fora_do_estoque, null);
  semErro(s, 'entrada sem movimento');
});

test('achado 19: na correção de uma aplicação gravada sem custo, a revisão diz que a correção mantém o custo daquele dia (e não manda preencher o cadastro já preenchido); a aplicação nova usa o custo do cadastro', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['101', '102']);
  const pid = produto(s, { nome: 'Vacina sem custo' }).product_id;
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-04-01', { product_id: pid, quantidade: 100, valor: 30000 })), 'entrada');
  const vac = san('VACINACAO', '2026-04-05', [ids['101'], ids['102']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 1 });
  const r = ok(api(s, 'evento.registrar', vac), 'aplicação sem custo');
  ok(api(s, 'produto.salvar', { product_id: pid, campos: { custo_unitario: 3 }, justificativa: 'custo da compra' }), 'custo no cadastro');
  const pedido = Object.assign({ event_id: r.event_id, justificativa: 'veterinário' }, vac, { campos: Object.assign({}, vac.campos, { veterinario: 'Dr. B' }) });
  const sim = ok(api(s, 'evento.simular', { acao: 'corrigir', dados: pedido }), 'simular correção');
  assert.equal(sim.impactos.sanidade.consumo.valor, 0);
  assert.match(sim.impactos.sanidade.consumo.porque_sem_custo, /foi gravada sem custo.*a correção mantém o custo daquele dia/);
  const nova = ok(api(s, 'evento.simular', { acao: 'registrar', dados: san('VACINACAO', '2026-11-01', [ids['101']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 1 }) }), 'aplicação nova');
  assert.equal(nova.impactos.sanidade.consumo.valor, 300);
  assert.equal(nova.impactos.sanidade.consumo.porque_sem_custo, undefined);
});

test('achados 21 e 23: o protocolo cadastrado à noite (hora da fazenda) vale no dia do cadastro, hoje e numa data passada; a mensagem de arquivo repetido na importação também usa o dia da fazenda', () => {
  const s = S.sistema();
  hoje(s, '2026-11-10');
  rebanho(s, ['101', '102']);
  s.gas.clock.now = Date.parse('2026-11-11T02:30:00.000Z'); // 22:30 de 10/11 em Porto Velho
  ok(api(s, 'protocolo.salvar', { campos: { nome: 'Raiva', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 365 } }), 'protocolo');
  const agHoje = ok(api(s, 'sanidade.agenda', { data: '2026-11-10' }), 'agenda de hoje à noite');
  assert.deepEqual(agHoje.protocolos.map((p) => p.nome), ['Raiva']);
  assert.equal(agHoje.pendencias.length, 2);
  hoje(s, '2026-11-12');
  const agPassada = ok(api(s, 'sanidade.agenda', { data: '2026-11-10' }), 'agenda de 10/11 depois');
  assert.deepEqual(agPassada.protocolos.map((p) => p.nome), ['Raiva']);
  assert.equal(ok(api(s, 'sanidade.agenda', { data: '2026-11-09' }), 'véspera').protocolos.length, 0);
  // O mesmo arquivo de importação mandado às 22h de 10/11 e de novo depois: "já foi enviado em 10/11/2026".
  s.gas.clock.now = Date.parse('2026-11-11T02:00:00.000Z');
  const csv = b64(['Data;Momento;Método;Brinco;Peso', '01/11/2026;rotina;balança;101;400'].join('\n'));
  s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'arq-1', dados: { tipo: 'PESAGENS', arquivo_nome: 'p.csv', conteudo_base64: csv, formato: FORMATO } }));
  hoje(s, '2026-11-12');
  const de = s.tentar((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'arq-2', dados: { tipo: 'PESAGENS', arquivo_nome: 'p.csv', conteudo_base64: csv, formato: FORMATO } }));
  assert.equal(de.ok, false);
  assert.match(JSON.stringify(de.erro.details), /já foi enviado em 10\/11\/2026/);
});

test('achado 24: o aviso de lotação acima da capacidade diz de onde vem a parte estimada da UA (estimativa visual), não "peso de referência"', () => {
  const s = S.sistema();
  hoje(s, '2026-10-15');
  const ids = rebanho(s, ['B0', 'B1', 'B2', 'B3'], { sexo: 'M', castrado: true, pasto_destino_id: S.PASTOS.B, data_nascimento: '2024-05-01' });
  const lista = Object.values(ids);
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-10-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'ESTIMATIVA_VISUAL' }, animais: lista.map((animal_id) => ({ animal_id, peso: 450 })) }, null, ['PESO_IMPLAUSIVEL']), 'estimativa visual');
  ok(api(s, 'pasto.salvar', { pasture_id: S.PASTOS.A, campos: { area_hectares: 1, capacidade_estimada_ua_ha: 1 }, justificativa: 'área' }), 'pasto');
  const r = api(s, 'evento.simular', { acao: 'registrar', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-10-10', pasto_origem_id: S.PASTOS.B, pasto_destino_id: S.PASTOS.A }, animais: lista.map((animal_id) => ({ animal_id })) } });
  const avisos = r.ok ? r.data.avisos : r.error.details;
  const lot = avisos.find((a) => a.codigo === 'LOTACAO_ACIMA_DA_CAPACIDADE');
  assert.ok(lot, JSON.stringify(avisos));
  assert.match(lot.mensagem, /UA estimada em parte: 4 cabeça\(s\) por estimativa visual/);
  assert.doesNotMatch(lot.mensagem, /peso de referência/);
});
