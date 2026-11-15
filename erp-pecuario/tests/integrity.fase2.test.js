'use strict';
/**
 * Verificação de integridade completa da Fase 2 (E2.11; 06, seções 9 e 12; 03b, seção 14; 05, RN-112), num banco do
 * setup com todos os tipos da fase: rebanho inicial (com prenhez e valor de abertura), compra com frete e duas
 * parcelas, transferências (uma corrigida, outra estornada), parto gemelar com natimorto, marcações, reclassificação,
 * venda com comissão, morte com custo, descarte com receita, baixa na contagem, troca de brinco e uma compra estornada.
 * Cada checagem nova dispara quando a planilha é adulterada à mão no fake — linha do tempo, saída com evento posterior,
 * partos × reprodução × crias, brinco ativo repetido nas identificações, invariantes do financeiro (pela conferência
 * do FinancialService), 100% alocado também na morte e no descarte, custo de aquisição —, cada campo de projeção é
 * coberto pela reconstrução, o reparo só reconstrói projeções (auditado) e nunca mexe em fato, e o tempo da
 * verificação é medido sobre a base de demonstração.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { PASTOS, PROP, situacoes, js } = S;

const garrote = (brinco) => ({ brinco, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 });
const transferencia = (data, origem, destino, ids) => ({ tipo: 'TRANSFERENCIA', campos: { event_date: data, pasto_origem_id: origem, pasto_destino_id: destino }, animais: ids.map((animal_id) => ({ animal_id })) });
const ajuste = (subtipo, data, animais) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo, campos: { event_date: data, justificativa: 'Conferência no curral' }, animais });
const marcacao = (subtipo, data, id, campos) => ({ tipo: 'MARCACAO', subtipo, campos: Object.assign({ event_date: data, acao: 'MARCAR' }, campos || {}), animais: [{ animal_id: id }] });

/**
 * O banco da Fase 2 inteira, com a integridade limpa. Devolve {s, ids (por brinco), ev (event_id por nome), forn, comp}.
 * Depois de cada comando: projeção gravada = reconstrução.
 */
function base() {
  const s = S.sistema();
  const G = s.G;
  const parceiro = (nome, tipo, chave) => s.exec((ctx) => G.UnitOfWork.run(ctx, G.Config.comandoSalvarParceiro({ idempotencyKey: chave, dados: { campos: { nome, tipos: [tipo] } } }))).dados.partner_id;
  const forn = parceiro('Fornecedor', 'FORNECEDOR', 'p-forn');
  const comp = parceiro('Frigorífico', 'COMPRADOR', 'p-comp');
  const ev = {};
  const reg = (nome, dados, avisos) => {
    const r = s.evento('registrar', dados, 'f2-' + nome, avisos).dados;
    s.conferirProjecoes(nome);
    ev[nome] = r.event_id;
    return r;
  };
  const ini = reg('ini', S.entradaInicial([
    S.bicho({ brinco: '100', data_nascimento: '2019-03-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 2, situacao_reprodutiva: 'PRENHA', data_prevista_parto: '2026-03-15', valor_abertura: 350000 }),
    S.bicho({ brinco: '101', data_nascimento: '2020-03-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }),
    S.bicho({ brinco: '102', sexo: 'M', data_nascimento: '2024-05-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '103', sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '104', data_nascimento: '2016-01-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 5 }),
    S.bicho({ brinco: '105', sexo: 'M', reprodutor: true, data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '106', sexo: 'M', data_nascimento: '2024-07-01', data_nascimento_confianca: 'ESTIMADA' }),
  ]));
  const ids = {};
  ini.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  const compra = reg('compra', { tipo: 'COMPRA', campos: { event_date: '2026-02-05', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 600000 },
    animais: [garrote('200'), garrote('201')], parcelas: [{ data_vencimento: '2026-03-05' }, { data_vencimento: '2026-04-05' }], custos: [{ tipo: 'FRETE', valor: 8000 }] });
  compra.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  reg('transf200', transferencia('2026-03-01', PASTOS.A, PASTOS.B, [ids['200']]));
  const parto = reg('parto', { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-10', pai_id: ids['105'], pai_confianca: 'CONFIRMADA' }, animais: [{ animal_id: ids['100'] }],
    crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '300', peso: 30, metodo_pesagem: 'BALANCA' }, { situacao_nascimento: 'VIVO', sexo: 'M', brinco: '301' }, { situacao_nascimento: 'NATIMORTO' }] });
  parto.animais.filter((a) => a.animal_id !== ids['100']).forEach((a) => { ids[a.brinco] = a.animal_id; });
  reg('transf103', transferencia('2026-04-01', PASTOS.A, PASTOS.B, [ids['103']]));
  // Correção (substituto na mesma posição da cadeia): a transferência do 103 foi no dia seguinte.
  const corr = s.evento('corrigir', Object.assign(transferencia('2026-04-02', PASTOS.A, PASTOS.B, [ids['103']]), { event_id: ev.transf103, justificativa: 'Data errada' }), 'f2-corr').dados;
  s.conferirProjecoes('correção');
  ev.transf103 = corr.event_id;
  const cat = (codigo) => s.tabela('CATEGORIAS').find((c) => c.codigo === codigo).category_id;
  reg('marca101', marcacao('DESCARTE', '2026-05-01', ids['101'], { motivo_descarte: 'IDADE' }));
  reg('naoLoc201', marcacao('NAO_LOCALIZADO', '2026-05-02', ids['201']));
  reg('reclass', ajuste('RECLASSIFICACAO', '2026-05-03', [{ animal_id: ids['102'], categoria_manual_id: cat('BOI') }]));
  reg('venda', { tipo: 'VENDA', campos: { event_date: '2026-06-01', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 500000, valor_bruto: 500000 },
    animais: [{ animal_id: ids['102'] }], parcelas: [{ data_vencimento: '2026-07-01' }], deducoes: [{ tipo: 'COMISSAO', valor: 10000 }] });
  const custeio = s.tabela('PLANO_CONTAS').find((c) => c.natureza === 'CUSTEIO' && c.ativo !== false).conta_id;
  reg('morte', { tipo: 'MORTE', campos: { event_date: '2026-07-01', causa: 'DOENCA', custo_valor: 15000, custo_conta_id: custeio }, animais: [{ animal_id: ids['103'] }] });
  reg('descarte', { tipo: 'DESCARTE', campos: { event_date: '2026-07-02', destino: 'CONSUMO_PROPRIO', motivo: 'IDADE', receita_valor: 50000 }, animais: [{ animal_id: ids['104'] }] });
  reg('divergencia', ajuste('DIVERGENCIA_CONTAGEM', '2026-07-03', [{ animal_id: ids['106'] }]));
  reg('troca101', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-08-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: ids['101'], codigo: '1101', motivo: 'PERDA' }] });
  reg('transf201', transferencia('2026-08-05', PASTOS.A, PASTOS.B, [ids['201']]));
  s.evento('estornar', { event_id: ev.transf201, justificativa: 'Lançada no animal errado' }, 'f2-est-transf');
  const c2 = reg('compra2', { tipo: 'COMPRA', campos: { event_date: '2026-08-10', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 280000, valor_animais: 280000 },
    animais: [garrote('202')], parcelas: [{ data_vencimento: '2026-09-10' }] });
  ids['202'] = c2.animais[0].animal_id;
  s.evento('estornar', { event_id: ev.compra2, justificativa: 'Compra desfeita' }, 'f2-est-compra');
  s.conferirProjecoes('estornos');
  const r = s.integridade();
  assert.equal(r.ok, true, 'banco da Fase 2 íntegro antes da adulteração: ' + JSON.stringify(r.achados));
  assert.equal(r.alertas, 0, JSON.stringify(r.achados));
  assert.ok(r.checagens.every((c) => c.situacao === 'OK'), JSON.stringify(r.checagens.filter((c) => c.situacao !== 'OK')));
  return { s, G, ids, ev, forn, comp };
}
/** Valor cru da célula (para desfazer a edição à mão). */
function celula(s, aba, idReg, coluna) {
  const p = s.posicao(aba, idReg, coluna);
  return s.gas.planilhas.matriz(s.banco(), aba)[p.linha - 1][p.coluna - 1];
}
const achadosDe = (r, codigo) => r.achados.filter((a) => a.checagem === codigo);
const doEvento = (s, aba, eventId) => s.tabela(aba).filter((x) => x.event_id === eventId);

test('banco com todos os tipos da Fase 2: as 26 checagens executadas e OK; as novas estão no contrato, com severidade e reparo', () => {
  const { s, G } = base();
  const r = s.integridade();
  assert.equal(r.checagens.length, 26);
  const def = Object.fromEntries(G.AuditService.CHECAGENS.map((c) => [c.codigo, [c.severidade, c.reparo || null]]));
  assert.deepEqual(['FINANCEIRO', 'CUSTO_AQUISICAO', 'BAIXADO_SEM_POSTERIOR', 'PARTOS', 'IDENTIFICACOES_ATIVAS', 'GENEALOGIA'].map((c) => def[c]),
    [['ERRO', null], ['ERRO', 'RECONSTRUIR'], ['ERRO', null], ['ERRO', null], ['ERRO', null], ['ERRO', null]]);
  assert.equal(r.reparavel, false);
});

test('linha do tempo de cada animal sobre o histórico inteiro: origem da transferência adulterada e parto antes do nascimento da mãe', () => {
  const { s, ids, ev } = base();
  const ea = doEvento(s, 'EVENTO_ANIMAIS', ev.transf200)[0];
  s.editar('EVENTO_ANIMAIS', ea.event_animal_id, 'pasto_origem_id', PASTOS.B);
  let r = s.integridade();
  assert.deepEqual(situacoes(r), { LINHA_DO_TEMPO: 'ERRO' });
  assert.match(achadosDe(r, 'LINHA_DO_TEMPO')[0].mensagem, /A-000008 \(brinco 200\): .*Pasto A.*\(evento de 01\/03\/2026\)/);
  s.editar('EVENTO_ANIMAIS', ea.event_animal_id, 'pasto_origem_id', PASTOS.A);
  assert.equal(s.integridade().ok, true);
  // A data de nascimento da mãe (atributo da criação) mexida para depois do parto: o parto cai antes do nascimento.
  const criacao = s.tabela('EVENTO_ANIMAIS').find((l) => l.animal_id === ids['100'] && l.event_id === ev.ini);
  const bruto = celula(s, 'EVENTO_ANIMAIS', criacao.event_animal_id, 'atributos_iniciais_json');
  s.editar('EVENTO_ANIMAIS', criacao.event_animal_id, 'atributos_iniciais_json', JSON.stringify(Object.assign({}, criacao.atributos_iniciais_json, { data_nascimento: '2026-03-20' })));
  r = s.integridade();
  assert.ok(achadosDe(r, 'LINHA_DO_TEMPO').some((a) => a.id === ids['100'] && /nascimento/i.test(a.mensagem)), JSON.stringify(achadosDe(r, 'LINHA_DO_TEMPO')));
  assert.ok(achadosDe(r, 'PARTOS').some((a) => /nascido em 20\/03\/2026, não antes do parto/.test(a.mensagem)), 'o parto também acusa a mãe nascida depois dele');
  assert.equal(situacoes(r).PROJECAO, 'ERRO');
  s.editar('EVENTO_ANIMAIS', criacao.event_animal_id, 'atributos_iniciais_json', bruto);
  assert.equal(s.integridade().ok, true);
});

test('cadastro desativado com animal dentro (teste aleatório, passada 2): pasto desativado com animal no rebanho e categoria desativada escolhida à mão, cada um um achado de LINHA_DO_TEMPO por animal', () => {
  const { s, ids } = base();
  // O Pasto B desativado à mão com o 200 (transferido para lá) no rebanho.
  const brutoB = celula(s, 'PASTOS', PASTOS.B, 'status');
  s.editar('PASTOS', PASTOS.B, 'status', 'INATIVO');
  let r = s.integridade();
  assert.deepEqual(situacoes(r), { LINHA_DO_TEMPO: 'ERRO' });
  const noB = s.tabela('ANIMAIS').filter((a) => a.situacao_cadastral === 'ATIVO' && a.pasto_atual_id === PASTOS.B).map((a) => a.animal_id).sort();
  assert.ok(noB.indexOf(ids['200']) >= 0);
  assert.deepEqual(achadosDe(r, 'LINHA_DO_TEMPO').map((a) => a.id).sort(), noB);
  assert.match(achadosDe(r, 'LINHA_DO_TEMPO').find((a) => a.id === ids['200']).mensagem, /brinco 200\) está no rebanho dentro do Pasto B, que está desativado/);
  s.editar('PASTOS', PASTOS.B, 'status', brutoB);
  assert.equal(s.integridade().ok, true);
  // A categoria BOI (a do 102, reclassificado à mão e vendido) desativada à mão: o vendido também conta.
  const boi = s.tabela('CATEGORIAS').find((c) => c.codigo === 'BOI');
  const brutoBoi = celula(s, 'CATEGORIAS', boi.category_id, 'ativo');
  s.editar('CATEGORIAS', boi.category_id, 'ativo', 'N');
  r = s.integridade();
  assert.deepEqual(situacoes(r), { LINHA_DO_TEMPO: 'ERRO' });
  assert.deepEqual(achadosDe(r, 'LINHA_DO_TEMPO').map((a) => [a.id, a.campo]), [[ids['102'], 'categoria_manual_id']]);
  assert.match(achadosDe(r, 'LINHA_DO_TEMPO')[0].mensagem, /na categoria Boi, escolhida à mão, que está desativada/i);
  s.editar('CATEGORIAS', boi.category_id, 'ativo', brutoBoi);
  assert.equal(s.integridade().ok, true);
});

test('animal baixado sem evento posterior vigente: morte com a data trocada para antes da transferência; identificação passada para o morto; venda e volta', () => {
  const { s, ids, ev, forn } = base();
  // A morte do 103 (01/07) foi para 15/03, antes da transferência corrigida de 02/04.
  s.editar('EVENTOS', ev.morte, 'event_date', '2026-03-15');
  let r = s.integridade();
  const b = achadosDe(r, 'BAIXADO_SEM_POSTERIOR');
  assert.equal(b.length, 1, JSON.stringify(b));
  assert.equal(b[0].id, ids['103']);
  assert.match(b[0].mensagem, /^A-000004 \(brinco 103\): "Transferir de pasto de 02\/04\/2026" vale depois da saída do rebanho \("Morte de 15\/03\/2026"\)\. Estorne um dos dois\.$/);
  assert.equal(situacoes(r).LINHA_DO_TEMPO, 'ERRO', 'o validador também vê a transferência depois da morte');
  s.editar('EVENTOS', ev.morte, 'event_date', '2026-07-01');
  assert.equal(s.integridade().ok, true);
  // A troca de brinco do 101 (01/08) passada à mão para o 103, que morreu em 01/07: um detalhe do morto depois da morte,
  // num evento em que ele nem tem linha.
  const ident = doEvento(s, 'IDENTIFICACOES', ev.troca101)[0];
  s.editar('IDENTIFICACOES', ident.ident_id, 'animal_id', ids['103']);
  r = s.integridade();
  const d = achadosDe(r, 'BAIXADO_SEM_POSTERIOR');
  assert.equal(d.length, 1, JSON.stringify(d));
  assert.match(d[0].mensagem, /A-000004 \(brinco 103\): "Identificação \(brinco\) · Trocar o brinco.* de 01\/08\/2026" vale depois da saída do rebanho \("Morte de 01\/07\/2026"\) \(registro na aba IDENTIFICACOES\)/);
  s.editar('IDENTIFICACOES', ident.ident_id, 'animal_id', ids['101']);
  assert.equal(s.integridade().ok, true);
  // Venda e volta (compra do mesmo animal): o que fica entre a saída e a volta é posterior à saída; depois da volta, não.
  const volta = s.evento('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-09-01', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 450000, valor_animais: 450000 },
    animais: [{ animal_id: ids['102'] }], parcelas: [{ data_vencimento: '2026-10-01' }] }, 'f2-volta').dados;
  assert.equal(volta.animais[0].animal_id, ids['102']);
  assert.equal(s.integridade().ok, true);
  const transf = doEvento(s, 'EVENTO_ANIMAIS', ev.transf200)[0];
  s.editar('EVENTO_ANIMAIS', transf.event_animal_id, 'animal_id', ids['102']);
  s.editar('EVENTOS', ev.transf200, 'event_date', '2026-06-10');
  r = s.integridade();
  assert.deepEqual(achadosDe(r, 'BAIXADO_SEM_POSTERIOR').map((a) => [a.id, a.mensagem]), [[ids['102'], 'A-000003 (brinco 102): "Transferir de pasto de 10/06/2026" vale depois da saída do rebanho ("Vender animais de 01/06/2026"). Estorne um dos dois.']]);
  s.editar('EVENTOS', ev.transf200, 'event_date', '2026-09-15');
  r = s.integridade();
  assert.deepEqual(achadosDe(r, 'BAIXADO_SEM_POSTERIOR'), [], 'depois da volta o animal está no rebanho');
  assert.equal(situacoes(r).PROJECAO, 'ERRO', 'o 200 perdeu a transferência e o 102 ganhou uma: a reconstrução acusa');
});

test('partos coerentes com REPRODUCAO e com as crias: nascidos vivos, registro em outra vaca, mãe sumida, cria com outra mãe, registro de parto fora de um nascimento', () => {
  const { s, ids, ev } = base();
  const rep = doEvento(s, 'REPRODUCAO', ev.parto)[0];
  assert.deepEqual([rep.tipo_evento, rep.qtd_nascidos_vivos, rep.qtd_natimortos], ['PARTO', 2, 1]);
  s.editar('REPRODUCAO', rep.reproduction_id, 'qtd_nascidos_vivos', 3);
  let r = s.integridade();
  assert.deepEqual(situacoes(r), { PARTOS: 'ERRO' });
  assert.match(achadosDe(r, 'PARTOS')[0].mensagem, /^O parto de 10\/03\/2026 \(mãe A-000001 \(brinco 100\)\) registra 3 nascido\(s\) vivo\(s\) na reprodução, mas 2 cria\(s\) entraram pelo evento\.$/);
  s.editar('REPRODUCAO', rep.reproduction_id, 'qtd_nascidos_vivos', 2);
  s.editar('REPRODUCAO', rep.reproduction_id, 'qtd_natimortos', 0);
  s.editar('REPRODUCAO', rep.reproduction_id, 'data_parto', '2026-03-11');
  r = s.integridade();
  assert.deepEqual(achadosDe(r, 'PARTOS').map((a) => a.mensagem.replace(/^O parto de 10\/03\/2026 \(mãe A-000001 \(brinco 100\)\) /, '')), ['tem a data do parto registrada como 11/03/2026 na reprodução.']);
  s.editar('REPRODUCAO', rep.reproduction_id, 'qtd_natimortos', 1);
  s.editar('REPRODUCAO', rep.reproduction_id, 'data_parto', '2026-03-10');
  // O registro do parto passado para outra vaca: a situação reprodutiva das duas também muda (projeção).
  s.editar('REPRODUCAO', rep.reproduction_id, 'animal_id', ids['101']);
  r = s.integridade();
  assert.ok(achadosDe(r, 'PARTOS').some((a) => a.tabela === 'REPRODUCAO' && /está registrado na reprodução de outro animal \(A-000002 \(brinco 1101\)\)/.test(a.mensagem)), JSON.stringify(achadosDe(r, 'PARTOS')));
  assert.equal(situacoes(r).PROJECAO, 'ERRO');
  s.editar('REPRODUCAO', rep.reproduction_id, 'animal_id', ids['100']);
  assert.equal(s.integridade().ok, true);
  // A linha da mãe no evento perdeu o papel: o parto fica sem mãe.
  const mat = doEvento(s, 'EVENTO_ANIMAIS', ev.parto).find((l) => l.papel === 'MATRIZ');
  s.editar('EVENTO_ANIMAIS', mat.event_animal_id, 'papel', 'SUJEITO');
  r = s.integridade();
  assert.deepEqual(situacoes(r), { PARTOS: 'ERRO' });
  assert.match(achadosDe(r, 'PARTOS')[0].mensagem, /^O parto de 10\/03\/2026 tem 0 mães nos animais do evento; um parto é de uma vaca só\.$/);
  s.editar('EVENTO_ANIMAIS', mat.event_animal_id, 'papel', 'MATRIZ');
  // A cria registrada com outra mãe e outro pai no próprio nascimento (a projeção da mãe e do pai muda junto).
  const cria = doEvento(s, 'EVENTO_ANIMAIS', ev.parto).find((l) => l.animal_id === ids['300']);
  const bruto = celula(s, 'EVENTO_ANIMAIS', cria.event_animal_id, 'atributos_iniciais_json');
  s.editar('EVENTO_ANIMAIS', cria.event_animal_id, 'atributos_iniciais_json', JSON.stringify(Object.assign({}, cria.atributos_iniciais_json, { mae_id: ids['101'], pai_id: null })));
  r = s.integridade();
  assert.ok(achadosDe(r, 'PARTOS').some((a) => a.tabela === 'EVENTO_ANIMAIS' && /tem a cria A-000010 \(brinco 300\) registrada com outra mãe, outro pai\./.test(a.mensagem)), JSON.stringify(achadosDe(r, 'PARTOS')));
  s.editar('EVENTO_ANIMAIS', cria.event_animal_id, 'atributos_iniciais_json', bruto);
  assert.equal(s.integridade().ok, true);
  // O diagnóstico de prenhez da entrada inicial virou "parto" à mão: registro de parto fora de um nascimento.
  const dg = s.tabela('REPRODUCAO').find((x) => x.event_id === ev.ini);
  s.editar('REPRODUCAO', dg.reproduction_id, 'tipo_evento', 'PARTO');
  r = s.integridade();
  assert.ok(achadosDe(r, 'PARTOS').some((a) => a.id === dg.reproduction_id && /O registro de parto de A-000001 \(brinco 100\) em 01\/01\/2026 pertence a "Rebanho inicial.* de 01\/01\/2026", que não é um nascimento\./.test(a.mensagem)), JSON.stringify(achadosDe(r, 'PARTOS')));
});

test('IDENTIFICACOES sem dois brincos ativos iguais: código do brinco trocado à mão (com zero à esquerda) e a retirada não conta', () => {
  const { s, ids, ev } = base();
  const row = s.tabela('IDENTIFICACOES').find((x) => x.animal_id === ids['102'] && x.tipo === 'BRINCO');
  s.editar('IDENTIFICACOES', row.ident_id, 'codigo', '0100');
  s.editar('IDENTIFICACOES', row.ident_id, 'codigo_norm', '100');
  let r = s.integridade();
  const a = achadosDe(r, 'IDENTIFICACOES_ATIVAS');
  assert.equal(a.length, 1, JSON.stringify(a));
  assert.match(a[0].mensagem, /^O brinco 100 está ativo em 2 identificações: A-000001 \(brinco 100\) desde 01\/01\/2026; A-000003 \(brinco 102\) desde 01\/01\/2026\.$/);
  assert.deepEqual([a[0].tabela, a[0].campo, a[0].severidade], ['IDENTIFICACOES', 'codigo', 'ERRO']);
  assert.equal(situacoes(r).BRINCO, undefined, 'o cadastro gravado não mudou: só as identificações acusam');
  assert.equal(situacoes(r).PROJECAO, 'ERRO', 'e a reconstrução do brinco do 102');
  s.editar('IDENTIFICACOES', row.ident_id, 'codigo', '102');
  s.editar('IDENTIFICACOES', row.ident_id, 'codigo_norm', '102');
  assert.equal(s.integridade().ok, true);
  // O brinco antigo do 101 (trocado por 1101) está fechado: dar o mesmo número ao 106 na planilha não é "dois ativos",
  // mas os dois tiveram o 101 ao mesmo tempo, do marco zero até a troca (revisão 3: um número em um animal por vez).
  const antigo = s.tabela('IDENTIFICACOES').find((x) => x.animal_id === ids['101'] && x.codigo === '101');
  assert.equal(antigo.data_fim, '2026-08-01');
  const r106 = s.tabela('IDENTIFICACOES').find((x) => x.animal_id === ids['106'] && x.tipo === 'BRINCO');
  s.editar('IDENTIFICACOES', r106.ident_id, 'codigo', '101');
  r = s.integridade();
  const cruzados = achadosDe(r, 'IDENTIFICACOES_ATIVAS');
  assert.equal(cruzados.length, 1, JSON.stringify(cruzados));
  assert.match(cruzados[0].mensagem, /^O brinco 101 ficou em dois animais ao mesmo tempo: .* de 01\/01\/2026 até 01\/08\/2026; .* desde 01\/01\/2026\.$/);
  // Reaberto à mão (data_fim apagada), o antigo vira ativo e repete o do 106.
  s.editar('IDENTIFICACOES', antigo.ident_id, 'data_fim', '');
  r = s.integridade();
  assert.equal(achadosDe(r, 'IDENTIFICACOES_ATIVAS').length, 1);
  assert.ok(ev.troca101);
});

test('invariantes do financeiro de 03b, seção 14, pela conferência do FinancialService: cada uma na sua checagem, sem contar duas vezes', () => {
  const { s, ids, ev } = base();
  const compra = doEvento(s, 'COMPRAS', ev.compra)[0];
  // 16: total da compra ≠ lançamentos do evento (e o valor do evento ≠ total da compra).
  s.editar('COMPRAS', compra.purchase_id, 'valor_total', 9999);
  let r = s.integridade();
  assert.deepEqual(situacoes(r), { FINANCEIRO: 'ERRO' });
  assert.ok(achadosDe(r, 'FINANCEIRO').every((a) => a.linha > 1 && a.severidade === 'ERRO'));
  assert.ok(achadosDe(r, 'FINANCEIRO').some((a) => /A compra registra R\$ 9\.999,00 no total e os lançamentos do evento somam R\$ 6\.080,00/.test(a.mensagem)));
  s.editar('COMPRAS', compra.purchase_id, 'valor_total', 6080);
  // 5: parcela em aberto com juros; 3: parcela que não fecha com o lançamento (PARCELAS).
  const [fin] = doEvento(s, 'FINANCEIRO', ev.compra);
  const parcelas = s.tabela('PARCELAS').filter((p) => p.financial_id === fin.financial_id);
  s.editar('PARCELAS', parcelas[1].parcela_id, 'juros_multa', 10);
  s.editar('PARCELAS', parcelas[0].parcela_id, 'valor', 3100);
  r = s.integridade();
  assert.deepEqual(situacoes(r), { FINANCEIRO: 'ERRO', PARCELAS: 'ERRO' });
  assert.match(achadosDe(r, 'PARCELAS')[0].mensagem, /^As parcelas somam R\$ 6\.100,00 e o lançamento vale R\$ 6\.000,00 \("Compra de .*"\)\.$/);
  assert.match(achadosDe(r, 'FINANCEIRO')[0].mensagem, /está em aberto mas tem dados de pagamento/);
  s.editar('PARCELAS', parcelas[1].parcela_id, 'juros_multa', '');
  s.editar('PARCELAS', parcelas[0].parcela_id, 'valor', 3000);
  assert.equal(s.integridade().ok, true);
  // 6 (situação de pagamento) é a projeção de FINANCEIRO: um achado só, em PROJECAO.
  s.editar('FINANCEIRO', fin.financial_id, 'status_pagamento', 'LIQUIDADO');
  r = s.integridade();
  assert.deepEqual(situacoes(r), { PROJECAO: 'ERRO' });
  assert.equal(r.erros, 1);
  s.editar('FINANCEIRO', fin.financial_id, 'status_pagamento', 'ABERTO');
  // 19: o lançamento da compra estornada com parcela paga.
  const [finEst] = doEvento(s, 'FINANCEIRO', ev.compra2);
  const pEst = s.tabela('PARCELAS').find((p) => p.financial_id === finEst.financial_id);
  s.editar('PARCELAS', pEst.parcela_id, 'status', 'LIQUIDADA');
  r = s.integridade();
  assert.ok(achadosDe(r, 'FINANCEIRO').some((a) => a.id === finEst.financial_id && /foi estornado com parcela paga/.test(a.mensagem)), JSON.stringify(r.achados));
  s.editar('PARCELAS', pEst.parcela_id, 'status', 'ABERTA');
  // 2: natureza do lançamento ≠ a da conta (e o custo de aquisição deixa de somar: CUSTO_AQUISICAO, um achado por animal).
  s.editar('FINANCEIRO', fin.financial_id, 'natureza', 'CUSTEIO');
  r = s.integridade();
  assert.deepEqual(situacoes(r), { FINANCEIRO: 'ERRO', CUSTO_AQUISICAO: 'ERRO' });
  assert.deepEqual(achadosDe(r, 'CUSTO_AQUISICAO').map((a) => a.id).sort(), [ids['200'], ids['201']].sort(), 'reconstrução e invariante 18 contam uma vez por animal');
  s.editar('FINANCEIRO', fin.financial_id, 'natureza', 'AQUISICAO_ANIMAIS');
  assert.equal(s.integridade().ok, true);
});

test('alocações = 100% do lançamento também na morte e no descarte (rateio do próprio evento); soma ≤ lançamento; animal da alocação direta', () => {
  const { s, ids, ev } = base();
  for (const [nome, valor, rotulo] of [['descarte', 400, /"Receita do descarte de 02\/07\/2026" \(descarte de 02\/07\/2026\) precisa estar 100% alocado aos animais: alocados R\$ 400,00 de R\$ 500,00\./],
    ['morte', 100, /"Custos da morte de 01\/07\/2026" \(morte de 01\/07\/2026\) precisa estar 100% alocado aos animais: alocados R\$ 100,00 de R\$ 150,00\./]]) {
    const [fin] = doEvento(s, 'FINANCEIRO', ev[nome]);
    const rat = s.tabela('RATEIOS').find((x) => x.financial_id === fin.financial_id);
    const al = s.tabela('ALOCACOES_FINANCEIRAS').find((x) => x.rateio_id === rat.rateio_id);
    assert.deepEqual([rat.criterio, al.animal_id, fin.animal_id], ['DIRETO', ids[nome === 'morte' ? '103' : '104'], al.animal_id]);
    s.editar('RATEIOS', rat.rateio_id, 'total_alocado', valor);
    s.editar('ALOCACOES_FINANCEIRAS', al.alloc_id, 'valor_alocado', valor);
    const r = s.integridade();
    assert.deepEqual(situacoes(r), { ALOCACOES: 'ERRO', ALOCACAO_DIRETA: 'ERRO' }, nome + ': ' + JSON.stringify(r.achados));
    assert.ok(achadosDe(r, 'ALOCACOES').some((a) => rotulo.test(a.mensagem)), JSON.stringify(achadosDe(r, 'ALOCACOES')));
    s.editar('RATEIOS', rat.rateio_id, 'total_alocado', fin.valor / 100);
    s.editar('ALOCACOES_FINANCEIRAS', al.alloc_id, 'valor_alocado', fin.valor / 100);
    assert.equal(s.integridade().ok, true);
  }
  // Rateio que distribui mais que o lançamento (9) e alocação que não fecha com o rateio (8), na venda.
  const [rec] = doEvento(s, 'FINANCEIRO', ev.venda);
  const ratV = s.tabela('RATEIOS').find((x) => x.financial_id === rec.financial_id);
  s.editar('RATEIOS', ratV.rateio_id, 'total_alocado', 6000);
  const r = s.integridade();
  assert.ok(achadosDe(r, 'ALOCACOES').some((a) => /distribui R\$ 6\.000,00, mais que o lançamento \(R\$ 5\.000,00\)/.test(a.mensagem)));
  assert.ok(achadosDe(r, 'ALOCACOES').some((a) => /O rateio soma R\$ 5\.000,00 nas alocações, mas registra R\$ 6\.000,00/.test(a.mensagem)));
});

test('custo de aquisição derivado coerente: custo mexido à mão (reconstrução e invariante 18, um achado); o reparo reconstrói, auditado, e nunca corrige fato', () => {
  const { s, G, ids, ev } = base();
  const a200 = s.tabela('ANIMAIS').find((a) => a.animal_id === ids['200']);
  assert.equal(a200.custo_aquisicao, 304000, 'R$ 3.000,00 do animal + metade do frete');
  s.editar('ANIMAIS', ids['200'], 'custo_aquisicao', 1);
  const compra = doEvento(s, 'COMPRAS', ev.compra)[0];
  s.editar('COMPRAS', compra.purchase_id, 'outros_custos', 50);
  let r = s.integridade();
  assert.deepEqual(situacoes(r), { CUSTO_AQUISICAO: 'ERRO', FINANCEIRO: 'ERRO' });
  const c = achadosDe(r, 'CUSTO_AQUISICAO');
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].id, c[0].campo, c[0].reparo], [ids['200'], 'custo_aquisicao', 'RECONSTRUIR']);
  assert.match(c[0].mensagem, /A-000008 \(brinco 200\): custo_aquisicao gravado 100, calculado 304000/);
  assert.equal(r.reparavel, true);
  const rep = s.exec((ctx) => G.AuditService.repararIntegridade(ctx, 'Custo mexido na planilha'));
  assert.deepEqual(situacoes(rep.integridade), { FINANCEIRO: 'ERRO' }, 'o reparo refaz a projeção; o fato adulterado continua acusado');
  assert.equal(s.tabela('ANIMAIS').find((a) => a.animal_id === ids['200']).custo_aquisicao, 304000);
  assert.equal(celula(s, 'COMPRAS', compra.purchase_id, 'outros_custos'), 50, 'RN-112: a verificação só relata; o fato não é corrigido em silêncio');
  assert.equal(s.tabela('AUDITORIA').filter((x) => x.acao === 'MANUTENCAO' && x.justificativa === 'Custo mexido na planilha').length, 1);
});

test('projeção × reconstrução cobre cada campo de projeção do esquema (ANIMAIS, IDENTIFICACOES, FINANCEIRO, EVENTOS)', () => {
  const { s, G, ids, ev } = base();
  const NAO_RECONSTRUIDOS = {
    'PRODUTOS.estoque_atual': 'só a Fase 3 grava MOVIMENTOS_ESTOQUE (CONTRATOS, seção 13)',
    'EVENTOS.confirmed_at': 'instante da fase C, não derivável dos eventos',
  };
  const CHECAGEM_DO_CAMPO = { 'FINANCEIRO.animal_id': 'ALOCACAO_DIRETA', 'ANIMAIS.custo_aquisicao': 'CUSTO_AQUISICAO', 'ANIMAIS.custo_aquisicao_origem': 'CUSTO_AQUISICAO', 'EVENTOS.status': 'STATUS_EVENTOS', 'EVENTOS.reversed_by_event_id': 'STATUS_EVENTOS' };
  const outroId = { ANIMAIS: ids['101'], EVENTOS: ev.venda, PASTOS: PASTOS.B, CATEGORIAS: s.tabela('CATEGORIAS')[0].category_id, PROPRIEDADES: PROP };
  const finVenda = doEvento(s, 'FINANCEIRO', ev.venda)[0];
  const finEstornado = doEvento(s, 'FINANCEIRO', ev.compra2)[0];
  const alvos = {
    ANIMAIS: [ids['300'], ids['100'], ids['200']],
    IDENTIFICACOES: s.tabela('IDENTIFICACOES').filter((x) => x.animal_id === ids['101']).map((x) => x.ident_id),
    FINANCEIRO: [finVenda.financial_id, finEstornado.financial_id],
    EVENTOS: [ev.venda, ev.transf201],
  };
  /** Um valor de célula válido para o tipo e diferente do gravado. */
  function outro(tabela, c, atual) {
    if (c.tipo === 'ENUM') return G.Schema.enumValores(c.enum).find((v) => v !== atual);
    if (c.tipo === 'BOOL') return atual === true ? 'N' : 'S';
    if (c.tipo === 'DATA') return atual === '2026-05-05' ? '2026-05-06' : '2026-05-05';
    if (c.tipo === 'TS') return '2026-05-05T10:00:00.000Z';
    if (c.tipo === 'INT' || c.tipo === 'DEC1') return (typeof atual === 'number' ? atual : 0) + 1;
    if (c.tipo === 'DINHEIRO') return (typeof atual === 'number' ? atual / 100 : 0) + 1;
    if (c.tipo === 'ID') { const fk = c.fk ? c.fk.tabela : tabela; return atual === outroId[fk] ? (fk === 'ANIMAIS' ? ids['104'] : fk === 'EVENTOS' ? ev.morte : '') : outroId[fk]; }
    return (atual || '') + 'X';
  }
  const cobertos = [];
  G.Schema.nomesTabelas().forEach((t) => G.Schema.tabela(t).colunas.filter((c) => c.marca === 'PROJECAO').forEach((c) => {
    const nome = t + '.' + c.nome;
    if (NAO_RECONSTRUIDOS[nome]) return;
    assert.ok(alvos[t], 'há registro de ' + t + ' para adulterar (' + nome + ')');
    alvos[t].forEach((idReg) => {
      const pk = G.Schema.pk(t);
      const reg = s.tabela(t).find((x) => x[pk] === idReg);
      const bruto = celula(s, t, idReg, c.nome);
      s.editar(t, idReg, c.nome, outro(t, c, reg[c.nome]));
      const r = s.integridade();
      const codigo = CHECAGEM_DO_CAMPO[nome] || 'PROJECAO';
      assert.ok(achadosDe(r, codigo).some((a) => a.id === idReg && (codigo === 'STATUS_EVENTOS' || a.campo.split(',').indexOf(c.nome) >= 0)), nome + ' de ' + idReg + ' adulterado → ' + codigo + ': ' + JSON.stringify(r.achados.slice(0, 5)));
      assert.ok(achadosDe(r, codigo).every((a) => a.reparo === 'RECONSTRUIR'), 'reparo oferecido');
      s.editar(t, idReg, c.nome, bruto);
    });
    cobertos.push(nome);
  }));
  assert.ok(cobertos.length >= 40, cobertos.length + ' campos de projeção conferidos');
  assert.ok(['ANIMAIS.situacao_reprodutiva', 'ANIMAIS.cria_ao_pe', 'ANIMAIS.marcado_descarte', 'ANIMAIS.nao_localizado', 'ANIMAIS.data_saida', 'ANIMAIS.custo_aquisicao', 'IDENTIFICACOES.data_fim', 'FINANCEIRO.status_pagamento', 'FINANCEIRO.cancelado_por_event_id'].every((n) => cobertos.indexOf(n) >= 0));
  assert.equal(s.integridade().ok, true, 'tudo desfeito');
});

test('tempo da verificação completa no fake sobre a base de demonstração (304 ativos e três anos de eventos, só por comandos): sem erro, todas as checagens executadas', (t) => {
  const s = S.sistema();
  s.gas.props.script.setProperty('TEST_PLAN', 'DEMO');
  const demo = js(s.gas.exec(() => s.G.runAcceptanceTests()));
  assert.deepEqual([demo.ok, demo.demonstracao.cabecas], [true, 304]);
  const banco = s.props().DEMO_SPREADSHEET_ID;
  const tamanho = Object.fromEntries(['ANIMAIS', 'EVENTOS', 'EVENTO_ANIMAIS', 'FINANCEIRO', 'PARCELAS', 'ALOCACOES_FINANCEIRAS', 'IDENTIFICACOES', 'REPRODUCAO', 'BAIXAS'].map((a) => [a, s.tabela(a, banco).length]));
  const tempos = [];
  let rel = null;
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    const env = js(s.gas.exec(() => s.G.api({ rota: 'sistema.integridade', ambiente: 'DEMO', dados: {} })));
    tempos.push(Number(process.hrtime.bigint() - t0) / 1e6);
    assert.equal(env.ok, true, JSON.stringify(env.error));
    rel = env.data;
  }
  assert.equal(rel.banco, banco, 'a verificação rodou na base de demonstração');
  assert.equal(rel.ok, true, JSON.stringify(rel.achados.slice(0, 5)));
  assert.deepEqual(rel.checagens.filter((c) => c.situacao !== 'OK').map((c) => [c.codigo, c.situacao]), [['PENDENCIAS', 'ALERTA']], 'só as crias sem brinco ficam pendentes');
  assert.ok(rel.checagens.every((c) => c.situacao !== 'NAO_EXECUTADA'));
  const melhor = Math.min.apply(null, tempos);
  t.diagnostic('integridade na base de demonstração (fake, CPU do Node, sem a latência real do Sheets): ' + tempos.map((x) => x.toFixed(0) + ' ms').join(', ') + '; ' + JSON.stringify(tamanho));
  assert.ok(melhor < 120000, 'muito abaixo do limite de 6 minutos de uma execução (' + melhor.toFixed(0) + ' ms)');
});
