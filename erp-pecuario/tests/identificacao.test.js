'use strict';
/**
 * IDENTIFICACAO, MARCACAO e AJUSTE_INVENTARIO (RECLASSIFICACAO, DIVERGENCIA_CONTAGEM) — entrega E2.6 (04, seções 4.4 e
 * 4.6; 03a, seções 4.3.3, 4.3.4 e 4.4; 03b, seções 2.6, 8, 9 e 16.15; 05, seção 4.1): primeira identificação, troca e
 * retirada (IDENTIFICACOES.data_fim pela projeção), bloqueio de reuso de brinco aposentado (RN-004) com a exceção do
 * brinco lançado errado (desenho-base 16.2), marcação para descarte e "não localizado" (pendência), reclassificação
 * manual (e CATEGORIA_EM_USO em categoria.salvar) e baixa por divergência de contagem (BAIXADO_AJUSTE; reaparecimento =
 * estorno). Cada tipo com regra e falha, estorno e correção, evento posterior dependente (CONFLICT com o evento que
 * impede) e caso retroativo. Depois de CADA comando o apoio confere projeção gravada = reconstrução.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./apoio-cadastros');
const S = require('./apoio-sistema');

const { js, D0, PASTOS, bicho, entradaInicial, outraEntrada, codigos } = C;

function ident(subtipo, data, animais, campos) {
  return { tipo: 'IDENTIFICACAO', subtipo, campos: Object.assign({ event_date: data, tipo_identificacao: 'BRINCO' }, campos || {}), animais };
}
function marca(subtipo, acao, data, ids, campos) {
  return { tipo: 'MARCACAO', subtipo, campos: Object.assign({ event_date: data, acao }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) };
}
function reclass(data, itens, campos) {
  return { tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: Object.assign({ event_date: data, justificativa: 'Separado para o lote de reprodução' }, campos || {}), animais: itens };
}
function divergencia(data, itens, campos) {
  return { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos: Object.assign({ event_date: data, justificativa: 'Contagem de junho no curral' }, campos || {}), animais: itens };
}
function transferencia(data, origem, destino, ids) {
  return { tipo: 'TRANSFERENCIA', campos: { event_date: data, pasto_origem_id: origem, pasto_destino_id: destino }, animais: ids.map((animal_id) => ({ animal_id })) };
}
function falha(m, acao, dados, op) {
  const r = m.tentar(acao, dados, op);
  assert.equal(r.ok, false, 'o comando deveria ter sido recusado');
  return r.erro;
}
/** Rebanho no marco zero: 0101 (F), 0102 (M), um bezerro sem brinco e 0104 (F), todos no Pasto A. */
function rebanho(opcoes) {
  const c = C.ambienteCadastros(opcoes);
  const m = c.m;
  const r = m.run('registrar', entradaInicial([
    bicho({ brinco: '0101', data_nascimento: '2022-05-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 2 }),
    bicho({ brinco: '0102', sexo: 'M', data_nascimento: '2023-03-01', data_nascimento_confianca: 'ESTIMADA' }),
    bicho({ sexo: 'M', data_nascimento: '2025-10-01', data_nascimento_confianca: 'CONFIRMADA' }),
    bicho({ brinco: '0104', data_nascimento: '2024-02-01', data_nascimento_confianca: 'ESTIMADA' }),
  ]));
  const a = r.dados.animais;
  const ids = { f1: a[0].animal_id, m2: a[1].animal_id, bez: a[2].animal_id, f4: a[3].animal_id };
  const parceiro = (nome, tipos) => c.run('Config.comandoSalvarParceiro', { campos: { nome, tipos } }).dados.partner_id;
  const cat = (codigo) => m.linhas.CATEGORIAS.find((x) => x.codigo === codigo);
  return { c, m, G: c.G, ids, entrada: r.dados.event_id, parceiro, cat };
}
const doEvento = (m, aba, eventId) => m.tabela(aba).filter((r) => r.event_id === eventId);
const identsDe = (m, animalId) => m.tabela('IDENTIFICACOES').filter((r) => r.animal_id === animalId).map((r) => [r.tipo, r.codigo, r.data_inicio, r.data_fim, r.motivo || null]);
const alertas = (c) => c.ler(c.G.InventoryService.consultaAlertas({ backup: { ultimo_em: '2026-11-13T10:00:00.000Z' }, integridade: { verificado_em: '2026-11-13T10:00:00.000Z', erros: 0 } }));
const ficha = (c, id) => c.ler(c.G.AnimalService.consultaFicha({ animal_id: id }));

// ------------------------------------------------------------------ IDENTIFICACAO ----
test('IDENTIFICACAO: primeiro brinco no bezerro (pendência "sem brinco" some), troca com motivo fecha o anterior em data_fim, retirada deixa o animal sem brinco; identificação não é movimento', () => {
  const { c, m, ids } = rebanho();
  assert.ok(alertas(c).alertas.find((a) => a.codigo === 'SEM_BRINCO').ids.includes(ids.bez));
  const p = m.run('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: ids.bez, codigo: '0412', observacoes: 'Brincado no curral' }]));
  assert.deepEqual([p.dados.event_type, p.dados.event_subtype, p.dados.animais[0].brinco], ['IDENTIFICACAO', 'PRIMEIRA_IDENTIFICACAO', '0412']);
  assert.deepEqual([m.animal(ids.bez).brinco, m.animal(ids.bez).brinco_norm, m.animal(ids.bez).data_ultimo_movimento], ['0412', '412', D0], '03a, 4.3.5: identificação não é movimento');
  const ea = doEvento(m, 'EVENTO_ANIMAIS', p.dados.event_id);
  assert.deepEqual(ea.map((l) => [l.animal_id, l.papel, l.efeito_inventario, l.pasto_origem_id || null, l.pasto_destino_id || null, l.observacoes]), [[ids.bez, 'SUJEITO', 0, null, null, 'Brincado no curral']]);
  assert.ok(!(alertas(c).alertas.find((a) => a.codigo === 'SEM_BRINCO') || { ids: [] }).ids.includes(ids.bez), 'a pendência "sem brinco" some');
  // Troca: motivo obrigatório; o código anterior fecha na data da troca.
  assert.deepEqual(codigos(falha(m, 'registrar', ident('SUBSTITUICAO', '2026-05-02', [{ animal_id: ids.f1, codigo: '1101' }]))), ['CAMPO_OBRIGATORIO']);
  const t = m.run('registrar', ident('SUBSTITUICAO', '2026-05-02', [{ animal_id: ids.f1, codigo: '1101', motivo: 'PERDA' }]));
  assert.equal(m.animal(ids.f1).brinco, '1101');
  assert.deepEqual(identsDe(m, ids.f1), [['BRINCO', '0101', D0, '2026-05-02', null], ['BRINCO', '1101', '2026-05-02', null, 'PERDA']]);
  // Retirada sem pôr outro: a linha guarda o código tirado e o motivo e fecha a si mesma.
  const rm = m.run('registrar', ident('REMOCAO', '2026-06-01', [{ animal_id: ids.f1, motivo: 'DANIFICADO' }]));
  assert.equal(m.animal(ids.f1).brinco, null);
  assert.deepEqual(identsDe(m, ids.f1), [['BRINCO', '0101', D0, '2026-05-02', null], ['BRINCO', '1101', '2026-05-02', '2026-06-01', 'PERDA'], ['BRINCO', '1101', '2026-06-01', '2026-06-01', 'DANIFICADO']]);
  assert.ok(alertas(c).alertas.find((a) => a.codigo === 'SEM_BRINCO').ids.includes(ids.f1), 'sem brinco de novo');
  const g = ficha(c, ids.f1).geral.identificacoes;
  assert.deepEqual(g.map((x) => [x.codigo, x.data_fim, x.remocao]), [['0101', '2026-05-02', false], ['1101', '2026-06-01', false], ['1101', '2026-06-01', true]], 'a ficha marca a linha da retirada');
  // Outra identificação (chip) convive com o brinco; tipos diferentes não se fecham.
  m.run('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-06-02', [{ animal_id: ids.m2, codigo: '982000123' }], { tipo_identificacao: 'RFID' }));
  assert.deepEqual(identsDe(m, ids.m2), [['BRINCO', '0102', D0, null, null], ['RFID', '982000123', '2026-06-02', null, null]]);
  assert.equal(m.animal(ids.m2).brinco, '0102');
  // O detalhe do evento traz a linha de IDENTIFICACOES e o rótulo do subtipo; a lista filtra pelo subtipo.
  const det = m.obter(t.dados.event_id);
  assert.deepEqual([det.evento.rotulo_subtipo, det.detalhes.IDENTIFICACOES.map((x) => [x.codigo, x.motivo])], ['Trocar o brinco (perdido, danificado, renumeração)', [['1101', 'PERDA']]]);
  assert.deepEqual(m.listar({ tipo: 'IDENTIFICACAO', subtipo: 'REMOCAO' }).itens.map((e) => e.event_id), [rm.dados.event_id]);
});

test('IDENTIFICACAO: regras e falhas — primeira com código em uso, troca e retirada sem código, mesmo número, duplicado, repetido no lançamento, só números, brinco do vendedor, presença no rebanho', () => {
  const { c, m, ids, parceiro } = rebanho({ config: { brinco_somente_numerico: 'S' } });
  const e1 = falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: ids.f1, codigo: '0505' }]));
  assert.deepEqual([e1.code, codigos(e1), e1.details[0].animal_id], ['VALIDATION', ['IDENTIFICACAO_JA_EXISTE'], ids.f1]);
  assert.match(e1.details[0].mensagem, /já tinha o brinco 0101 \(desde 01\/01\/2026\)\. Para trocar, use a troca de identificação\.$/);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('SUBSTITUICAO', '2026-03-10', [{ animal_id: ids.bez, codigo: '0505', motivo: 'PERDA' }]))), ['SEM_IDENTIFICACAO']);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('REMOCAO', '2026-03-10', [{ animal_id: ids.bez, motivo: 'PERDA' }]))), ['SEM_IDENTIFICACAO']);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('SUBSTITUICAO', '2026-03-10', [{ animal_id: ids.f1, codigo: '101', motivo: 'PERDA' }]))), ['VALOR_IGUAL'], '0101 = 101 sem os zeros à esquerda');
  assert.deepEqual(codigos(falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: ids.bez, codigo: ' 0104 ' }]))), ['BRINCO_DUPLICADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('SUBSTITUICAO', '2026-03-10', [{ animal_id: ids.f1, codigo: '0700', motivo: 'PERDA' }, { animal_id: ids.f4, codigo: '700', motivo: 'PERDA' }]))), ['BRINCO_REPETIDO']);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: ids.bez, codigo: 'A-12' }]))), ['BRINCO_NAO_NUMERICO']);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: ids.bez, codigo: 'X1' }], { tipo_identificacao: 'BRINCO_ORIGEM' }))), ['TIPO_NAO_SE_APLICA']);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: ids.bez }]))), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: ids.bez, codigo: '0601' }, { animal_id: ids.bez, codigo: '0602' }]))), ['ANIMAL_REPETIDO']);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2025-12-20', [{ animal_id: ids.bez, codigo: '0601' }]))), ['ANTES_DO_MARCO_ZERO']);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: C.id(0xbeef), codigo: '0601' }]))), ['NAO_ENCONTRADO']);
  const ext = c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'Touro de sêmen', sexo: 'M' } }).dados.animal_id;
  assert.deepEqual(codigos(falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: ext, codigo: '0601' }]))), ['ANIMAL_EXTERNO']);
  // Presença: vendido em 20/06, a identificação no dia da venda vale (limite inclusivo); no dia seguinte não; morto, nunca depois.
  const comp = parceiro('Comprador', 'COMPRADOR');
  m.run('registrar', { tipo: 'VENDA', campos: { event_date: '2026-06-20', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: ids.m2 }], parcelas: [{ data_vencimento: '2026-06-20' }] });
  assert.deepEqual(codigos(falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-06-21', [{ animal_id: ids.m2, codigo: '55' }], { tipo_identificacao: 'SISBOV' }))), ['FORA_DA_PERMANENCIA']);
  m.run('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-06-20', [{ animal_id: ids.m2, codigo: '55' }], { tipo_identificacao: 'SISBOV' }));
  m.run('registrar', { tipo: 'MORTE', campos: { event_date: '2026-07-01', causa: 'DOENCA' }, animais: [{ animal_id: ids.f4 }] });
  assert.deepEqual(codigos(falha(m, 'registrar', ident('SUBSTITUICAO', '2026-07-02', [{ animal_id: ids.f4, codigo: '0801', motivo: 'PERDA' }]))), ['APOS_MORTE']);
  // Brinco do vendedor (compra) só pode ser retirado.
  const forn = parceiro('Fornecedor', 'FORNECEDOR');
  const cp = m.run('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-08-01', partner_id: forn, pasto_destino_id: PASTOS.B, modalidade: 'CABECA', preco_unitario: 250000, valor_animais: 250000 }, animais: [{ brinco: '0901', brinco_origem: 'V-77', sexo: 'F', idade_meses: 20 }], parcelas: [{ data_vencimento: '2026-08-01' }] });
  const novo = cp.dados.animais[0].animal_id;
  m.run('registrar', ident('REMOCAO', '2026-08-02', [{ animal_id: novo, motivo: 'RENUMERACAO' }], { tipo_identificacao: 'BRINCO_ORIGEM' }));
  assert.deepEqual(identsDe(m, novo), [['BRINCO', '0901', '2026-08-01', null, null], ['BRINCO_ORIGEM', 'V-77', '2026-08-01', '2026-08-02', null], ['BRINCO_ORIGEM', 'V-77', '2026-08-02', '2026-08-02', 'RENUMERACAO']]);
  assert.equal(m.animal(novo).brinco, '0901', 'tirar o brinco do vendedor não mexe no da fazenda');
});

test('RN-004: brinco aposentado por troca não volta em outro animal com o reuso desligado; o próprio animal pode retomá-lo; com o reuso ligado vale; o brinco lançado errado não conta (desenho-base 16.2)', () => {
  const { m, ids } = rebanho();
  m.run('registrar', ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: ids.f1, codigo: '1101', motivo: 'DANIFICADO' }]));
  const e = falha(m, 'registrar', outraEntrada('2026-03-05', [bicho({ brinco: '101' })]));
  assert.deepEqual(codigos(e), ['BRINCO_APOSENTADO']);
  assert.match(e.details[0].mensagem, /o brinco 101 já foi do animal A-000001 até 01\/03\/2026 e o reuso de brinco está desligado/);
  assert.deepEqual(codigos(falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-05', [{ animal_id: ids.bez, codigo: '0101' }]))), ['BRINCO_APOSENTADO'], 'também pela identificação');
  // Troca entre dois animais no mesmo lançamento: o número de um se aposenta e vai para o outro — recusado.
  assert.deepEqual(codigos(falha(m, 'registrar', ident('SUBSTITUICAO', '2026-03-06', [{ animal_id: ids.m2, codigo: '0104', motivo: 'RENUMERACAO' }, { animal_id: ids.f4, codigo: '0102', motivo: 'RENUMERACAO' }]))).sort(), ['BRINCO_APOSENTADO', 'BRINCO_APOSENTADO']);
  // O próprio animal retoma o número que já foi dele.
  m.run('registrar', ident('SUBSTITUICAO', '2026-03-07', [{ animal_id: ids.f1, codigo: '0101', motivo: 'OUTRO' }]));
  assert.equal(m.animal(ids.f1).brinco, '0101');
  // Exceção 16.2: o 0450 dado por engano ao 0102 e corrigido (IDENTIFICACAO_INCORRETA) fica livre para outro animal.
  m.run('registrar', ident('SUBSTITUICAO', '2026-03-08', [{ animal_id: ids.m2, codigo: '0450', motivo: 'RENUMERACAO' }]));
  m.run('registrar', C.ajuste('IDENTIFICACAO_INCORRETA', '2026-03-09', [{ animal_id: ids.m2, brinco: '0451' }]));
  const r = m.run('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: ids.bez, codigo: '0450' }]));
  assert.equal(r.dados.animais[0].brinco, '0450');
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-03-11', [bicho({ brinco: '0102' })]))), ['BRINCO_APOSENTADO'], 'o número trocado (não o lançado errado) segue aposentado');
  // Reuso ligado: o número aposentado volta; o que está em uso continua bloqueado.
  const lig = rebanho({ config: { brinco_permite_reuso: 'S' } });
  lig.m.run('registrar', ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: lig.ids.f1, codigo: '1101', motivo: 'DANIFICADO' }]));
  const ok = lig.m.run('registrar', outraEntrada('2026-03-05', [bicho({ brinco: '0101' })]));
  assert.equal(ok.dados.animais[0].brinco, '0101');
  assert.deepEqual(codigos(falha(lig.m, 'registrar', outraEntrada('2026-03-05', [bicho({ brinco: '1101' })]))), ['BRINCO_DUPLICADO']);
  const troca = lig.m.run('registrar', ident('SUBSTITUICAO', '2026-03-06', [{ animal_id: lig.ids.m2, codigo: '0104', motivo: 'RENUMERACAO' }, { animal_id: lig.ids.f4, codigo: '0102', motivo: 'RENUMERACAO' }]));
  assert.deepEqual(troca.dados.animais.map((a) => a.brinco).sort(), ['0102', '0104'], 'com o reuso ligado a troca entre dois animais vale');
});

test('IDENTIFICACAO: estorno e correção — a troca estornada devolve o brinco anterior; estorno com retirada posterior dependente e brinco devolvido que já é de outro → CONFLICT com o evento; retroativo e correção mantêm a posição', () => {
  const { m, ids } = rebanho({ config: { brinco_permite_reuso: 'S' } });
  const t = m.run('registrar', ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: ids.f1, codigo: '1101', motivo: 'PERDA' }]));
  const est = m.run('estornar', { event_id: t.dados.event_id, justificativa: 'Brinco achado no pasto' });
  assert.deepEqual([est.dados.estorna, m.animal(ids.f1).brinco, m.evento(t.dados.event_id).status], [t.dados.event_id, '0101', 'ESTORNADO']);
  assert.deepEqual(identsDe(m, ids.f1), [['BRINCO', '0101', D0, null, null], ['BRINCO', '1101', '2026-03-01', null, 'PERDA']], 'data_fim volta a vazio no rebuild; a linha anulada fica');
  // Primeiro brinco do bezerro e retirada posterior: estornar a primeira deixaria a retirada sem brinco para tirar.
  const p = m.run('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-10', [{ animal_id: ids.bez, codigo: '0412' }]));
  const rm = m.run('registrar', ident('REMOCAO', '2026-04-10', [{ animal_id: ids.bez, motivo: 'PERDA' }]));
  const e = falha(m, 'estornar', { event_id: p.dados.event_id, justificativa: 'teste' });
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.animal_id, d.conflito.event_id, d.conflito.tipo, d.conflito.data]), [['SEM_IDENTIFICACAO', ids.bez, rm.dados.event_id, 'REMOCAO', '2026-04-10']]);
  // Retroativo: outra primeira identificação antes da de 10/03 deixa a de 10/03 incoerente → CONFLICT citando-a.
  const r1 = falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-05', [{ animal_id: ids.bez, codigo: '0499' }]));
  assert.deepEqual([r1.code, r1.details.map((d) => [d.codigo, d.conflito.event_id])], ['CONFLICT', [['IDENTIFICACAO_JA_EXISTE', p.dados.event_id]]]);
  // Retroativo que quebra a retirada: trocar o 0412 antes dela faz a retirada tirar um número que não estaria mais lá.
  const r2 = falha(m, 'registrar', ident('SUBSTITUICAO', '2026-04-01', [{ animal_id: ids.bez, codigo: '0413', motivo: 'DANIFICADO' }]));
  assert.deepEqual(r2.details.map((d) => [d.codigo, d.conflito.event_id]), [['REMOCAO_DE_OUTRO_CODIGO', rm.dados.event_id]]);
  assert.match(r2.details[0].mensagem, /a retirada de identificação de 10\/04\/2026 tira o brinco 0412, mas nessa data o animal estaria com o 0413/);
  // Correção da primeira (0412 → 0414): a retirada dependente impede; sem ela, a correção vale e mantém a posição.
  const corr = { tipo: 'IDENTIFICACAO', event_id: p.dados.event_id, justificativa: 'Número errado', campos: { event_date: '2026-03-10', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: ids.bez, codigo: '0414' }] };
  assert.deepEqual(codigos(falha(m, 'corrigir', corr)), ['REMOCAO_DE_OUTRO_CODIGO']);
  m.run('estornar', { event_id: rm.dados.event_id, justificativa: 'Lançado no animal errado' });
  const k = m.run('corrigir', corr);
  assert.deepEqual([m.animal(ids.bez).brinco, m.evento(p.dados.event_id).status, m.evento(k.dados.event_id).reversal_of_event_id], ['0414', 'ESTORNADO', p.dados.event_id]);
  // Estorno que devolveria um brinco hoje de outro animal (reuso ligado): CONFLICT com a identificação desse outro.
  const t2 = m.run('registrar', ident('SUBSTITUICAO', '2026-05-01', [{ animal_id: ids.f4, codigo: '1104', motivo: 'RENUMERACAO' }]));
  const outro = m.run('registrar', outraEntrada('2026-05-02', [bicho({ brinco: '0104' })]));
  const e3 = falha(m, 'estornar', { event_id: t2.dados.event_id, justificativa: 'teste' });
  assert.deepEqual([e3.code, e3.details.map((d) => [d.codigo, d.animal_id, d.conflito.event_id])], ['CONFLICT', [['BRINCO_DUPLICADO', ids.f4, outro.dados.event_id]]]);
  assert.match(e3.details[0].mensagem, /o estorno devolveria ao animal o brinco 0104, que hoje é do animal 0104/);
});

// ------------------------------------------------------------------ MARCACAO ----
test('MARCACAO: marcar para descarte (motivo no payload) e desmarcar; "não localizado" vira pendência; não mexe no inventário; marcar o marcado e desmarcar o desmarcado são recusados', () => {
  const { c, m, ids } = rebanho();
  const inv0 = m.inventario('2026-11-13');
  const d = m.run('registrar', marca('DESCARTE', 'MARCAR', '2026-04-01', [ids.f1, ids.f4], { motivo_descarte: 'IDADE' }));
  assert.deepEqual([m.animal(ids.f1).marcado_descarte, m.animal(ids.f4).marcado_descarte, m.animal(ids.m2).marcado_descarte], [true, true, false]);
  assert.deepEqual(m.evento(d.dados.event_id).payload_json, { acao: 'MARCAR', motivo_descarte: 'IDADE' });
  assert.deepEqual(m.inventario('2026-11-13'), inv0, 'marcação não altera o inventário');
  assert.deepEqual(doEvento(m, 'EVENTO_ANIMAIS', d.dados.event_id).map((l) => [l.efeito_inventario, l.pasto_destino_id || null]), [[0, null], [0, null]]);
  const e = falha(m, 'registrar', marca('DESCARTE', 'MARCAR', '2026-04-05', [ids.f1]));
  assert.deepEqual([codigos(e), e.details[0].animal_id], [['JA_MARCADO'], ids.f1]);
  assert.deepEqual(codigos(falha(m, 'registrar', marca('NAO_LOCALIZADO', 'DESMARCAR', '2026-04-05', [ids.f1]))), ['NAO_MARCADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', marca('NAO_LOCALIZADO', 'MARCAR', '2026-04-05', [ids.f1], { motivo_descarte: 'IDADE' }))), ['CAMPO_DESCONHECIDO'], 'motivo de descarte não existe na marcação de não localizado');
  assert.deepEqual(codigos(falha(m, 'registrar', marca('DESCARTE', 'DESMARCAR', '2026-04-05', [ids.f1], { motivo_descarte: 'IDADE' }))), ['CAMPO_NAO_SE_APLICA']);
  assert.deepEqual(codigos(falha(m, 'registrar', marca('DESCARTE', 'TALVEZ', '2026-04-05', [ids.f1]))), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(codigos(falha(m, 'registrar', { tipo: 'MARCACAO', campos: { event_date: '2026-04-05', acao: 'MARCAR' }, animais: [{ animal_id: ids.f1 }] })), ['CAMPO_OBRIGATORIO']);
  // Desmarcar no mesmo dia em que marcou não é "possível duplicidade" (ação diferente).
  m.run('registrar', marca('DESCARTE', 'DESMARCAR', '2026-04-01', [ids.f4]));
  assert.deepEqual([m.animal(ids.f1).marcado_descarte, m.animal(ids.f4).marcado_descarte], [true, false]);
  // Não localizado: pendência visível até a baixa ou a desmarcação.
  m.run('registrar', marca('NAO_LOCALIZADO', 'MARCAR', '2026-06-01', [ids.m2]));
  const a = alertas(c).alertas.find((x) => x.codigo === 'NAO_LOCALIZADO');
  assert.deepEqual([a.nivel, a.ids, a.entidade], ['AVISO', [ids.m2], 'ANIMAIS']);
  m.run('registrar', marca('NAO_LOCALIZADO', 'DESMARCAR', '2026-06-05', [ids.m2]));
  assert.equal(alertas(c).alertas.find((x) => x.codigo === 'NAO_LOCALIZADO'), undefined);
  assert.deepEqual([ficha(c, ids.f1).geral.marcado_descarte, ficha(c, ids.m2).geral.nao_localizado], [true, false]);
});

test('MARCACAO: estorno com desmarcação posterior → CONFLICT com ela; marcação retroativa que quebra a seguinte → CONFLICT; marcação depois da saída → VALIDATION; correção mantém a posição', () => {
  const { c, m, ids, parceiro } = rebanho();
  const mk = m.run('registrar', marca('NAO_LOCALIZADO', 'MARCAR', '2026-05-01', [ids.f1]));
  const dm = m.run('registrar', marca('NAO_LOCALIZADO', 'DESMARCAR', '2026-05-20', [ids.f1]));
  const e = falha(m, 'estornar', { event_id: mk.dados.event_id, justificativa: 'teste' });
  assert.deepEqual([e.code, e.details.map((d) => [d.codigo, d.animal_id, d.conflito.event_id, d.conflito.tipo])], ['CONFLICT', [['NAO_MARCADO', ids.f1, dm.dados.event_id, 'NAO_LOCALIZADO']]]);
  const r = falha(m, 'registrar', marca('NAO_LOCALIZADO', 'MARCAR', '2026-04-20', [ids.f1]));
  assert.deepEqual([r.code, r.details.map((d) => [d.codigo, d.conflito.event_id])], ['CONFLICT', [['JA_MARCADO', mk.dados.event_id]]]);
  // Estornar a desmarcação vale: o animal volta a "não localizado".
  m.run('estornar', { event_id: dm.dados.event_id, justificativa: 'Desmarcado por engano' });
  assert.equal(m.animal(ids.f1).nao_localizado, true);
  // Correção da data da marcação (05/05): substitui no mesmo commit; a projeção segue.
  const k = m.run('corrigir', Object.assign(marca('NAO_LOCALIZADO', 'MARCAR', '2026-05-05', [ids.f1]), { event_id: mk.dados.event_id, justificativa: 'Data errada' }));
  assert.deepEqual([m.evento(mk.dados.event_id).status, m.evento(k.dados.event_id).event_date, m.animal(ids.f1).nao_localizado], ['ESTORNADO', '2026-05-05', true]);
  // Marcação de animal que já saiu: fora da permanência.
  const comp = parceiro('Comprador', 'COMPRADOR');
  m.run('registrar', { tipo: 'VENDA', campos: { event_date: '2026-06-20', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: ids.m2 }], parcelas: [{ data_vencimento: '2026-06-20' }] });
  assert.deepEqual(codigos(falha(m, 'registrar', marca('DESCARTE', 'MARCAR', '2026-06-21', [ids.m2]))), ['FORA_DA_PERMANENCIA']);
  // Venda retroativa antes da marcação de 05/05 → CONFLICT citando a marcação.
  const v = falha(m, 'registrar', { tipo: 'VENDA', campos: { event_date: '2026-04-30', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: ids.f1 }], parcelas: [{ data_vencimento: '2026-04-30' }] });
  assert.deepEqual([v.code, v.details.map((d) => [d.codigo, d.conflito.event_id])], ['CONFLICT', [['FORA_DA_PERMANENCIA', k.dados.event_id]]]);
  assert.equal(c.ler(c.G.InventoryService.consultaElegiveis({ tipo: 'MARCACAO', data: '2026-11-13' })).n, 3, 'elegíveis à marcação: os do rebanho na data');
});

// ------------------------------------------------------------------ RECLASSIFICACAO ----
test('RECLASSIFICACAO: categoria manual (AJUSTES com o valor anterior) e volta à automática; categoria na data; regras (inexistente, desativada, de outro sexo, igual, justificativa); CATEGORIA_EM_USO em categoria.salvar', () => {
  const { c, m, ids, cat } = rebanho();
  const touro = cat('TOURO');
  const boi = cat('BOI');
  const novilha = cat('NOVILHA_24_MAIS');
  const L = (data) => c.lerCom(c.G.AnimalService.leituras(), (tx, G) => { const l = G.AnimalService.leitor(tx); const a = tx.repo.porId('ANIMAIS', ids.m2); return G.AnimalService.categoriaEm(l, a, data); }, true);
  const antes = L('2026-11-13');
  assert.equal(antes.manual, false);
  const r = m.run('registrar', reclass('2026-04-01', [{ animal_id: ids.m2, categoria_manual_id: boi.category_id }]));
  assert.deepEqual([m.animal(ids.m2).categoria_modo, m.animal(ids.m2).categoria_manual_id], ['MANUAL', boi.category_id]);
  assert.deepEqual(doEvento(m, 'AJUSTES', r.dados.event_id).map((a) => [a.tipo_ajuste, a.campo, a.valor_anterior, a.valor_novo, a.justificativa]),
    [['RECLASSIFICACAO', 'categoria_manual_id', null, boi.category_id, 'Separado para o lote de reprodução']]);
  assert.deepEqual([L('2026-03-31').codigo, L('2026-03-31').manual, L('2026-04-01').codigo, L('2026-04-01').manual], [antes.codigo, false, 'BOI', true], 'categoria em D: a reclassificação vale da data dela em diante');
  assert.deepEqual(ficha(c, ids.m2).geral.categoria, { category_id: boi.category_id, codigo: 'BOI', nome: boi.nome, manual: true });
  // Regras.
  assert.deepEqual(codigos(falha(m, 'registrar', reclass('2026-04-02', [{ animal_id: ids.m2, categoria_manual_id: boi.category_id }]))), ['VALOR_IGUAL']);
  assert.deepEqual(codigos(falha(m, 'registrar', reclass('2026-04-02', [{ animal_id: ids.f1, categoria_manual_id: touro.category_id }]))), ['CATEGORIA_INCOMPATIVEL']);
  assert.deepEqual(codigos(falha(m, 'registrar', reclass('2026-04-02', [{ animal_id: ids.f1, categoria_manual_id: C.id(0xcafe) }]))), ['NAO_ENCONTRADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', reclass('2026-04-02', [{ animal_id: ids.f1 }]))), ['VALOR_IGUAL'], 'já está na automática');
  assert.deepEqual(codigos(falha(m, 'registrar', reclass('2026-04-02', [{ animal_id: ids.f1, categoria_manual_id: novilha.category_id }], { justificativa: '' }))), ['CAMPO_OBRIGATORIO']);
  // CATEGORIA_EM_USO: com um animal reclassificado à mão nela, a categoria não é desativada.
  const des = c.tentar('Config.comandoSalvarCategoria', { category_id: boi.category_id, campos: { ativo: false } }, { avisos: ['CATEGORIAS_SEM_COBERTURA'] });
  assert.equal(des.ok, false);
  assert.deepEqual([des.erro.code, codigos(des.erro)], ['VALIDATION', ['CATEGORIA_EM_USO']]);
  assert.match(des.erro.details[0].mensagem, /1 animal\(is\) foram reclassificados à mão nesta categoria/);
  // Volta à automática (valor vazio) e a desativação passa; reclassificar para categoria desativada é recusado.
  const v = m.run('registrar', reclass('2026-05-01', [{ animal_id: ids.m2, categoria_manual_id: null }]));
  assert.deepEqual([m.animal(ids.m2).categoria_modo, m.animal(ids.m2).categoria_manual_id], ['AUTO', null]);
  assert.deepEqual(doEvento(m, 'AJUSTES', v.dados.event_id).map((a) => [a.valor_anterior, a.valor_novo]), [[boi.category_id, null]]);
  c.run('Config.comandoSalvarCategoria', { category_id: boi.category_id, campos: { ativo: false } }, { avisos: ['CATEGORIAS_SEM_COBERTURA'] });
  assert.deepEqual(codigos(falha(m, 'registrar', reclass('2026-05-02', [{ animal_id: ids.m2, categoria_manual_id: boi.category_id }]))), ['CATEGORIA_INATIVA']);
  // Estornar a volta à automática devolveria o animal à categoria desativada: CONFLICT com a reclassificação que voltaria a valer.
  const e = falha(m, 'estornar', { event_id: v.dados.event_id, justificativa: 'teste' });
  assert.deepEqual([e.code, e.details.map((d) => [d.codigo, d.animal_id, d.conflito.event_id])], ['CONFLICT', [['CATEGORIA_INATIVA', ids.m2, r.dados.event_id]]]);
  c.run('Config.comandoSalvarCategoria', { category_id: boi.category_id, campos: { ativo: true } });
  m.run('estornar', { event_id: v.dados.event_id, justificativa: 'Voltou ao lote de engorda' });
  assert.deepEqual([m.animal(ids.m2).categoria_modo, m.animal(ids.m2).categoria_manual_id], ['MANUAL', boi.category_id]);
  // Correção da data da primeira reclassificação; estornada ela, a categoria volta a ser a automática.
  const k = m.run('corrigir', Object.assign(reclass('2026-03-15', [{ animal_id: ids.m2, categoria_manual_id: boi.category_id }]), { event_id: r.dados.event_id, justificativa: 'Data errada' }));
  assert.equal(L('2026-03-20').codigo, 'BOI');
  m.run('estornar', { event_id: k.dados.event_id, justificativa: 'Não era para reclassificar' });
  assert.deepEqual([m.animal(ids.m2).categoria_modo, L('2026-11-13').manual], ['AUTO', false]);
});

// ------------------------------------------------------------------ DIVERGENCIA_CONTAGEM ----
test('DIVERGENCIA_CONTAGEM: baixa (−1) com BAIXAS e sem AJUSTES; BAIXADO_AJUSTE, fora do inventário e dos elegíveis, mas dono do brinco; reaparecimento = estorno; reentrada; estorno com reentrada posterior → CONFLICT; retroativa que quebra fato posterior → CONFLICT', () => {
  const { c, m, ids } = rebanho();
  m.run('registrar', transferencia('2026-02-01', PASTOS.A, PASTOS.B, [ids.f4]));
  m.run('registrar', marca('NAO_LOCALIZADO', 'MARCAR', '2026-06-01', [ids.f4]));
  const d = m.run('registrar', divergencia('2026-06-15', [{ animal_id: ids.f4, observacoes: 'Não apareceu na contagem do Pasto B' }, { animal_id: ids.m2 }]));
  assert.deepEqual(doEvento(m, 'BAIXAS', d.dados.event_id).map((b) => [b.animal_id, b.tipo, b.causa || null, b.observacoes]).sort(),
    [[ids.f4, 'DIVERGENCIA_CONTAGEM', null, 'Não apareceu na contagem do Pasto B'], [ids.m2, 'DIVERGENCIA_CONTAGEM', null, 'Contagem de junho no curral']].sort());
  assert.deepEqual(doEvento(m, 'AJUSTES', d.dados.event_id), [], 'a divergência não grava AJUSTES (03b, seção 9)');
  assert.deepEqual(doEvento(m, 'EVENTO_ANIMAIS', d.dados.event_id).map((l) => [l.animal_id, l.efeito_inventario, l.pasto_origem_id]).sort(), [[ids.f4, -1, PASTOS.B], [ids.m2, -1, PASTOS.A]].sort());
  const a = m.animal(ids.f4);
  assert.deepEqual([a.situacao_cadastral, a.data_saida, a.pasto_atual_id, a.brinco, a.nao_localizado], ['BAIXADO_AJUSTE', '2026-06-15', null, '0104', true]);
  assert.deepEqual([m.inventario('2026-06-14').total, m.inventario('2026-06-15').total], [4, 2]);
  assert.equal(alertas(c).alertas.find((x) => x.codigo === 'NAO_LOCALIZADO'), undefined, 'baixado não é pendência de rebanho');
  const el = c.ler(c.G.InventoryService.consultaElegiveis({ tipo: 'TRANSFERENCIA', data: '2026-11-13' }));
  assert.ok(!el.itens.some((x) => x.animal_id === ids.f4));
  assert.ok(c.ler(c.G.AnimalService.consultaListar({})).valores.animal_id.includes(ids.f4), 'na lista de baixados');
  const dup = falha(m, 'registrar', outraEntrada('2026-07-01', [bicho({ brinco: '104' })]));
  assert.deepEqual(codigos(dup), ['BRINCO_DUPLICADO']);
  assert.match(dup.details[0].mensagem, /já é do animal A-000004, baixado na contagem em 15\/06\/2026/);
  // Regras: animal fora do rebanho na data; justificativa obrigatória; data anterior ao marco zero.
  assert.deepEqual(codigos(falha(m, 'registrar', divergencia('2026-07-01', [{ animal_id: ids.f4 }]))), ['FORA_DO_REBANHO']);
  assert.deepEqual(codigos(falha(m, 'registrar', divergencia('2026-07-01', [{ animal_id: ids.f1 }], { justificativa: '' }))), ['CAMPO_OBRIGATORIO']);
  // Reaparecimento: estorno da baixa de um, por correção (tirando-o da lista); o outro volta por outra entrada.
  const k = m.run('corrigir', Object.assign(divergencia('2026-06-15', [{ animal_id: ids.f4, observacoes: 'Não apareceu na contagem do Pasto B' }]), { event_id: d.dados.event_id, justificativa: 'O 0102 apareceu no vizinho' }));
  assert.deepEqual([m.animal(ids.m2).situacao_cadastral, m.animal(ids.m2).pasto_atual_id, m.animal(ids.f4).situacao_cadastral], ['ATIVO', PASTOS.A, 'BAIXADO_AJUSTE']);
  const volta = m.run('registrar', outraEntrada('2026-08-01', [{ animal_id: ids.f4, pasto_destino_id: PASTOS.C }], { description: 'Reapareceu em agosto' }));
  assert.deepEqual([m.animal(ids.f4).situacao_cadastral, m.animal(ids.f4).pasto_atual_id], ['ATIVO', PASTOS.C]);
  const e = falha(m, 'estornar', { event_id: k.dados.event_id, justificativa: 'teste' });
  assert.deepEqual([e.code, e.details.map((x) => [x.codigo, x.animal_id, x.conflito.event_id])], ['CONFLICT', [['ENTRADA_JA_DENTRO', ids.f4, volta.dados.event_id]]]);
  // Retroativa: baixa de 0101 em 01/03 com uma marcação de 01/04 → CONFLICT citando a marcação.
  const mk = m.run('registrar', marca('DESCARTE', 'MARCAR', '2026-04-01', [ids.f1]));
  const r = falha(m, 'registrar', divergencia('2026-03-01', [{ animal_id: ids.f1 }]));
  assert.deepEqual([r.code, r.details.map((x) => [x.codigo, x.conflito.event_id])], ['CONFLICT', [['FORA_DA_PERMANENCIA', mk.dados.event_id]]]);
  assert.match(r.details[0].mensagem, /a marcação de 01\/04\/2026 cai fora do período em que o animal esteve no rebanho/);
});

// ------------------------------------------------------------------ rotas ----
test('rotas pela api(): identificação, marcação, reclassificação e divergência registradas, listadas, obtidas e estornadas; a primeira identificação no evento.simular não grava', () => {
  const s = S.sistema();
  const api = (rota, dados, chave, avisos) => js(s.gas.exec(() => s.G.api({ rota, dados, idempotencyKey: chave || 'k-' + rota + '-' + Math.random(), avisosAceitos: avisos || [] })));
  const r = api('evento.registrar', S.entradaInicial([S.bicho({ brinco: '1' }), S.bicho({ sexo: 'M' })]));
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const [a1, a2] = r.data.animais.map((a) => a.animal_id);
  const sim = api('evento.simular', { acao: 'registrar', dados: ident('PRIMEIRA_IDENTIFICACAO', '2026-03-01', [{ animal_id: a2, codigo: '2' }]) });
  assert.deepEqual([sim.ok, sim.data.simulacao, sim.data.impactos.identificacoes], [true, true, 1]);
  assert.equal(s.tabela('IDENTIFICACOES').length, 1, 'a simulação não grava');
  const i = api('evento.registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-01', [{ animal_id: a2, codigo: '2' }]));
  const mk = api('evento.registrar', marca('DESCARTE', 'MARCAR', '2026-03-02', [a1], { motivo_descarte: 'IDADE' }));
  const cats = s.tabela('CATEGORIAS');
  const rc = api('evento.registrar', reclass('2026-03-03', [{ animal_id: a2, categoria_manual_id: cats.find((x) => x.codigo === 'TOURO').category_id }]));
  const dv = api('evento.registrar', divergencia('2026-03-04', [{ animal_id: a1 }]));
  for (const x of [i, mk, rc, dv]) assert.equal(x.ok, true, JSON.stringify(x.error));
  const lista = api('evento.listar', { subtipo: 'DIVERGENCIA_CONTAGEM' });
  assert.deepEqual(lista.data.itens.map((e) => [e.event_id, e.rotulo, e.rotulo_subtipo]), [[dv.data.event_id, 'Corrigir dados do animal', 'Animal não encontrado na contagem']]);
  const ob = api('evento.obter', { event_id: mk.data.event_id });
  assert.deepEqual([ob.data.evento.payload.acao, ob.data.evento.payload.motivo_descarte, ob.data.linhas.length], ['MARCAR', 'IDADE', 1]);
  assert.deepEqual(api('evento.obter', { event_id: dv.data.event_id }).data.detalhes.BAIXAS.map((b) => b.tipo), ['DIVERGENCIA_CONTAGEM']);
  const est = api('evento.estornar', { event_id: dv.data.event_id, justificativa: 'Reapareceu' });
  assert.equal(est.ok, true, JSON.stringify(est.error));
  assert.equal(s.tabela('ANIMAIS').find((a) => a.animal_id === a1).situacao_cadastral, 'ATIVO');
  const est2 = api('evento.estornar', { event_id: est.data.event_id, justificativa: 'x' });
  assert.deepEqual([est2.ok, est2.error.code, est2.error.details.map((d) => d.codigo)], [false, 'VALIDATION', ['ESTORNO_NAO_SE_ESTORNA']]);
  s.conferirProjecoes('rotas');
  assert.equal(s.integridade().ok, true);
});
