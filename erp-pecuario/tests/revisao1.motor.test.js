'use strict';
/**
 * Revisão independente da Fase 2, rodada 1, lente MOTOR: cada achado confirmado vira um teste que falhava antes do
 * conserto. Depois de cada comando a projeção gravada é a reconstrução (Timeline.conferir) e, onde o achado envolve a
 * integridade, a verificação completa fica sem erro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

/** Sistema do setup com helpers: reg (lança), tentar (não lança), ambos conferem a projeção. */
function base(opcoes) {
  const s = S.sistema(opcoes || {});
  let n = 0;
  s.tent = (acao, dados, avisos) => {
    const r = s.tentar((ctx) => s.G.EventService[acao](ctx, { idempotencyKey: 'r1-' + (++n), dados, avisosAceitos: avisos || [] }));
    s.conferirProjecoes(acao + ' ' + (dados.tipo || ''));
    return r;
  };
  s.reg = (acao, dados, avisos) => {
    const r = s.tent(acao, dados, avisos);
    if (!r.ok) throw new Error(acao + ': ' + JSON.stringify(r.erro));
    return r.valor.dados;
  };
  s.animal = (id) => s.tabela('ANIMAIS').find((a) => a.animal_id === id);
  s.erros = () => (s.integridade().achados || []).filter((x) => x.severidade === 'ERRO').map((x) => [x.checagem, x.mensagem]);
  s.parceiro = (nome, tipos) => s.exec((ctx) => s.G.UnitOfWork.run(ctx, s.G.Config.comandoSalvarParceiro({ idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } }))).dados.partner_id;
  return s;
}
const vaca = (brinco, extra) => S.bicho(Object.assign({ brinco, sexo: 'F', data_nascimento: '2019-01-10', data_nascimento_confianca: 'CONFIRMADA' }, extra || {}));
const correcao = (data, itens) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: data, justificativa: 'conferência do cadastro' }, animais: itens });
const descarte = (data, id) => ({ tipo: 'DESCARTE', campos: { event_date: data, destino: 'DOACAO', motivo: 'IDADE' }, animais: [{ animal_id: id }] });
const volta = (data, id, extra) => ({ tipo: 'OUTRA_ENTRADA', campos: Object.assign({ event_date: data, description: 'voltou da doação' }, extra || {}), animais: [Object.assign({ animal_id: id, pasto_destino_id: PASTOS.A }, {})] });
const parto = (data, mae, crias) => ({ tipo: 'NASCIMENTO', campos: { event_date: data, pasto_destino_id: PASTOS.A }, animais: [{ animal_id: mae }], crias });
const AVISOS_PARTO = ['INTERVALO_PARTO_CURTO', 'IDADE_REPRODUTIVA', 'POSSIVEL_DUPLICIDADE'];

// ---------------------------------------------------------------- importação (apoio) ----
function criarImportacao(s, tipo, csv, chave) {
  return s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: chave, avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dados: { tipo, arquivo_nome: chave + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
}
function validarTudo(s, id, mapa) {
  for (let b = 1; b < 100; b++) {
    const e = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + id + '-' + b, dados: { import_id: id, bloco: b, mapeamento: mapa } })).dados;
    if (e.importacao.status === 'VALIDADO') return e;
  }
  throw new Error('validação não terminou');
}
const importarBloco = (s, id, b, extra) => s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: Object.assign({ import_id: id, bloco: b }, extra || {}) }));
const concluir = (s, id) => s.tentar((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } }));
function importarTudo(s, id) {
  const r = importarBloco(s, id, 1, { modo: 'TOTAL' });
  assert.ok(r.ok, JSON.stringify(r.erro));
  const c = concluir(s, id);
  assert.ok(c.ok, JSON.stringify(c.erro));
  return c.valor.dados;
}
const linhasImp = (s, id) => s.read(s.G.ImportService.consultaLinhas({ import_id: id, por_pagina: 50 })).itens;

// ---------------------------------------------------------------- achado 1 ----
test('achado 1: correção de cadastro e de brinco depois do marco zero mantém a cria antiga HISTORICO, com a correção valendo e o brinco ocupado', () => {
  const s = base();
  const mae = s.reg('registrar', S.entradaInicial([vaca('300')])).animais[0].animal_id;
  s.reg('registrar', parto('2024-08-15', mae, [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '6001' }]));
  const cria = s.tabela('ANIMAIS').find((a) => a.brinco === '6001');
  assert.equal(cria.situacao_cadastral, 'HISTORICO');
  s.reg('registrar', correcao('2026-04-01', [{ animal_id: cria.animal_id, campo: 'sexo', valor_novo: 'M' }, { animal_id: cria.animal_id, campo: 'castrado', valor_novo: 'N' }, { animal_id: cria.animal_id, campo: 'reprodutor', valor_novo: 'N' }]));
  let c = s.animal(cria.animal_id);
  assert.deepEqual([c.situacao_cadastral, c.sexo, c.brinco, c.mae_id], ['HISTORICO', 'M', '6001', mae]);
  // O brinco continua ocupado (03a, 4.3.4: HISTORICO ocupa o brinco).
  const outro = s.tent('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-05-01', description: 'doação' }, animais: [vaca('6001', { data_nascimento: '2025-01-01', data_nascimento_confianca: 'ESTIMADA' })] });
  assert.deepEqual([outro.ok, S.codigos(outro.erro)], [false, ['BRINCO_DUPLICADO']]);
  // Brinco lançado errado (IDENTIFICACAO_INCORRETA) também é fato neutro: a cria segue HISTORICO, com o brinco certo.
  s.reg('registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: '2026-05-02', justificativa: 'brinco errado' }, animais: [{ animal_id: cria.animal_id, brinco: '6002' }] });
  c = s.animal(cria.animal_id);
  assert.deepEqual([c.situacao_cadastral, c.brinco], ['HISTORICO', '6002']);
  assert.deepEqual(s.erros(), []);
});

test('achado 1: animal VENDIDO só por saída histórica continua VENDIDO depois de uma correção de cadastro', () => {
  const s = base();
  const mae = s.reg('registrar', S.entradaInicial([vaca('300')])).animais[0].animal_id;
  s.reg('registrar', parto('2024-08-15', mae, [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '7001' }]));
  const cria = s.tabela('ANIMAIS').find((a) => a.brinco === '7001').animal_id;
  const comp = s.parceiro('Comprador', ['COMPRADOR']);
  const csv = 'Nº da venda;Data da venda;Comprador;Para que foram vendidos;Como foi o preço;Preço (R$);Valor bruto (R$);Brinco\nV0;01/05/2025;Comprador;recria e engorda;cabeça;2.500,00;2.500,00;7001';
  const imp = criarImportacao(s, 'VENDAS', csv, 'vendas-hist');
  validarTudo(s, imp.import_id, { colunas: { 'Nº da venda': 'grupo', 'Data da venda': 'data', Comprador: 'comprador', 'Para que foram vendidos': 'finalidade', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco', 'Valor bruto (R$)': 'valor_bruto', Brinco: 'brinco' }, confiancas: {}, padroes: {} });
  importarTudo(s, imp.import_id);
  assert.ok(comp);
  assert.equal(s.animal(cria).situacao_cadastral, 'VENDIDO');
  s.reg('registrar', correcao('2026-04-01', [{ animal_id: cria, campo: 'sexo', valor_novo: 'F' }]));
  const c = s.animal(cria);
  assert.deepEqual([c.situacao_cadastral, c.sexo, c.data_saida, c.brinco], ['VENDIDO', 'F', '2025-05-01', '7001']);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 2 ----
test('achado 2: com uma importação em IMPORTANDO, o primeiro bloco de outra é recusado com CONFLICT (RN-032)', () => {
  const s = base({ config: { importacao_lote_linhas: '5' } });
  s.reg('registrar', S.entradaInicial([vaca('0231')]));
  const MAPA = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: { castrado: false, reprodutor: false } };
  const a = criarImportacao(s, 'ANIMAIS', 'Brinco;Sexo;Nasc.;Pasto\n500;F;10/01/2023;Pasto A', 'arq-a');
  const b = criarImportacao(s, 'ANIMAIS', 'Brinco;Sexo;Nasc.;Pasto\n500;M;10/01/2024;Pasto B', 'arq-b');
  validarTudo(s, a.import_id, MAPA);
  assert.ok(importarBloco(s, a.import_id, 1, { modo: 'TOTAL' }).ok);
  validarTudo(s, b.import_id, MAPA);
  const rb = importarBloco(s, b.import_id, 1, { modo: 'TOTAL' });
  assert.deepEqual([rb.ok, rb.erro.code, S.codigos(rb.erro)], [false, 'CONFLICT', ['IMPORTACAO_EM_CURSO']]);
  assert.match(rb.erro.message, /arq-a\.csv.*ainda está em andamento/);
  assert.ok(concluir(s, a.import_id).ok);
  // Concluída a primeira, a segunda revalida na confirmação: o brinco 500 agora é do animal importado.
  const rb2 = importarBloco(s, b.import_id, 1, { modo: 'TOTAL' });
  assert.equal(rb2.ok, false);
  assert.match(rb2.erro.message, /Valide o arquivo de novo/);
  assert.deepEqual(s.tabela('ANIMAIS').filter((x) => x.brinco === '500').map((x) => [x.situacao_cadastral, x.sexo]), [['ATIVO', 'F']]);
  s.conferirProjecoes('fim');
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achados 4 e 20 ----
test('achado 4: registro anterior ao marco zero se confere com a chegada declarada, não com a volta ao rebanho', () => {
  const s = base();
  const id = s.reg('registrar', S.entradaInicial([vaca('300', { data_entrada: '2020-02-01', data_entrada_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  s.reg('registrar', parto('2025-10-05', id, [{ situacao_nascimento: 'VIVO', sexo: 'M' }]), AVISOS_PARTO);
  s.reg('registrar', descarte('2026-03-01', id));
  s.reg('registrar', volta('2026-05-01', id));
  assert.equal(s.animal(id).data_entrada, '2026-05-01'); // início da permanência mais recente
  assert.deepEqual(s.erros(), []); // antes: LINHA_DO_TEMPO "anterior à chegada (01/05/2026)"
  // Parto antigo depois da chegada declarada (01/02/2020) é aceito; antes dela, recusado citando a chegada declarada.
  s.reg('registrar', parto('2024-09-01', id, [{ situacao_nascimento: 'VIVO', sexo: 'F' }]), AVISOS_PARTO);
  const cedo = s.tent('registrar', parto('2019-12-01', id, [{ situacao_nascimento: 'VIVO', sexo: 'F' }]), AVISOS_PARTO);
  assert.deepEqual([cedo.ok, S.codigos(cedo.erro)], [false, ['ANTES_DA_ENTRADA']]);
  assert.match(cedo.erro.details[0].mensagem, /01\/02\/2020/);
  // A chegada declarada ainda se corrige depois da volta (e passa a valer para os registros antigos).
  const corr = s.tent('registrar', correcao('2026-06-01', [{ animal_id: id, campo: 'data_entrada', valor_novo: '2024-10-01' }]));
  assert.deepEqual([corr.ok, S.codigos(corr.erro)], [false, ['ANTES_DA_ENTRADA']]); // o parto de 01/09/2024 ficaria antes
  s.reg('registrar', correcao('2026-06-01', [{ animal_id: id, campo: 'data_entrada', valor_novo: '2020-01-15' }]));
  assert.equal(s.animal(id).data_entrada, '2026-05-01');
  assert.deepEqual(s.erros(), []);
});

test('achado 4: cria do histórico que volta ao rebanho não acusa o próprio nascimento "antes da chegada"', () => {
  const s = base();
  const mae = s.reg('registrar', S.entradaInicial([vaca('300')])).animais[0].animal_id;
  s.reg('registrar', parto('2024-08-15', mae, [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '6001' }]));
  const cria = s.tabela('ANIMAIS').find((a) => a.brinco === '6001').animal_id;
  s.reg('registrar', volta('2026-03-01', cria));
  assert.equal(s.animal(cria).situacao_cadastral, 'ATIVO');
  assert.deepEqual(s.erros(), []);
});

test('achado 20: o número de partos não cai depois de uma volta ao rebanho', () => {
  const s = base();
  const id = s.reg('registrar', S.entradaInicial([vaca('300', { partos_previos: 2 })])).animais[0].animal_id;
  s.reg('registrar', parto('2026-03-01', id, [{ situacao_nascimento: 'VIVO', sexo: 'F' }]), AVISOS_PARTO);
  const ficha = () => s.read(s.G.AnimalService.consultaFicha({ animal_id: id })).reprodutivo;
  assert.deepEqual([ficha().partos_previos, ficha().partos_registrados, ficha().n_partos], [2, 1, 3]);
  s.reg('registrar', descarte('2026-05-01', id));
  s.reg('registrar', volta('2026-06-01', id));
  assert.deepEqual([ficha().partos_previos, ficha().partos_registrados, ficha().n_partos], [2, 1, 3]);
  // Unidade: a fronteira é a primeira entrada; partos antes dela se confundem com os declarados.
  const R = s.G.ReproductionService;
  assert.equal(R.contarPartos(2, [{ data: '2025-01-01' }, { data: '2026-03-01' }], '2026-01-01'), 3);
  assert.equal(R.contarPartos(0, [{ data: '2025-01-01' }, { data: '2026-03-01' }], '2026-01-01'), 2);
});

// ---------------------------------------------------------------- achado 5 ----
test('achado 5: corrigir só o texto de uma volta ao rebanho é aceito mesmo com morte posterior; levar a volta para depois da morte, não', () => {
  const s = base();
  const id = s.reg('registrar', S.entradaInicial([vaca('500', { data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' })])).animais[0].animal_id;
  s.reg('registrar', descarte('2026-03-01', id));
  const v = s.reg('registrar', volta('2026-04-01', id));
  s.reg('registrar', { tipo: 'MORTE', campos: { event_date: '2026-06-01', causa: 'DOENCA' }, animais: [{ animal_id: id }] });
  assert.equal(s.animal(id).situacao_cadastral, 'MORTO');
  const r = s.tent('corrigir', Object.assign(volta('2026-04-01', id, { description: 'Volta da doação, conferida' }), { event_id: v.event_id, justificativa: 'texto' }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.equal(s.animal(id).situacao_cadastral, 'MORTO');
  // A linha do tempo final decide: com a volta depois da morte, a morte fica fora do rebanho (CONFLICT com ela).
  const morte = s.tabela('EVENTOS').find((x) => x.event_type === 'MORTE').event_id;
  const tarde = s.tent('corrigir', Object.assign(volta('2026-07-01', id), { event_id: r.valor.dados.event_id, justificativa: 'data' }));
  assert.deepEqual([tarde.ok, tarde.erro.code, S.codigos(tarde.erro), tarde.erro.details[0].conflito.event_id], [false, 'CONFLICT', ['FORA_DO_REBANHO'], morte]);
  // E o estorno da volta segue bloqueado pela morte (CONFLICT com ela).
  const est = s.tent('estornar', { event_id: r.valor.dados.event_id, justificativa: 'x' });
  assert.equal(est.erro.code, 'CONFLICT');
  assert.deepEqual(s.erros(), []);
});

test('achado 5: corrigir o preço de uma recompra é aceito com morte ou nova venda posterior', () => {
  const s = base();
  const forn = s.parceiro('Vizinho', ['FORNECEDOR', 'COMPRADOR']);
  const garrote = { brinco: 'R1', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 20 };
  const compra = (data, animais, preco) => ({ tipo: 'COMPRA', campos: { event_date: data, partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: preco, valor_animais: preco }, animais, parcelas: [{ data_vencimento: '2026-12-01' }] });
  const venda = (data, id, preco) => ({ tipo: 'VENDA', campos: { event_date: data, partner_id: forn, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: preco, valor_bruto: preco }, animais: [{ animal_id: id }], parcelas: [{ data_vencimento: '2026-12-01' }] });
  const id = s.reg('registrar', compra('2026-02-01', [garrote], 100000)).animais[0].animal_id;
  s.reg('registrar', venda('2026-04-01', id, 150000));
  const rc = s.reg('registrar', compra('2026-06-01', [{ animal_id: id }], 120000));
  s.reg('registrar', venda('2026-08-01', id, 130000));
  const r = s.tent('corrigir', Object.assign(compra('2026-06-01', [{ animal_id: id }], 125000), { event_id: rc.event_id, justificativa: 'preço errado' }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.equal(s.animal(id).situacao_cadastral, 'VENDIDO');
  // Recompra de outro garrote que morreu depois: corrigir o preço não esbarra na morte (antes: ANIMAL_MORTO).
  const id2 = s.reg('registrar', compra('2026-02-02', [Object.assign({}, garrote, { brinco: 'R2' })], 100000)).animais[0].animal_id;
  s.reg('registrar', venda('2026-04-02', id2, 150000));
  const rc2 = s.reg('registrar', compra('2026-06-02', [{ animal_id: id2 }], 120000));
  s.reg('registrar', { tipo: 'MORTE', campos: { event_date: '2026-09-01', causa: 'DOENCA' }, animais: [{ animal_id: id2 }] });
  const r2 = s.tent('corrigir', Object.assign(compra('2026-06-02', [{ animal_id: id2 }], 110000), { event_id: rc2.event_id, justificativa: 'preço errado' }));
  assert.ok(r2.ok, JSON.stringify(r2.erro));
  assert.equal(s.animal(id2).situacao_cadastral, 'MORTO');
  assert.equal(s.tabela('COMPRAS').filter((c) => c.event_id === r2.valor.dados.event_id)[0].valor_animais, 110000);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 6 ----
test('achado 6: corrigir só o motivo de uma retirada de brinco não "devolve" o brinco que foi para outro animal (reuso ligado)', () => {
  const s = base({ config: { brinco_permite_reuso: 'S' } });
  const ident = (sub, data, itens) => ({ tipo: 'IDENTIFICACAO', subtipo: sub, campos: { event_date: data, tipo_identificacao: 'BRINCO' }, animais: itens });
  const A = s.reg('registrar', S.entradaInicial([vaca('100', { data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' })])).animais[0].animal_id;
  const rem = s.reg('registrar', ident('REMOCAO', '2026-06-01', [{ animal_id: A, motivo: 'PERDA' }]));
  const B = s.reg('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-07-01', description: 'doação' }, animais: [vaca('100', { data_nascimento: '2024-01-01', data_nascimento_confianca: 'ESTIMADA' })] }).animais[0].animal_id;
  const r = s.tent('corrigir', Object.assign(ident('REMOCAO', '2026-06-01', [{ animal_id: A, motivo: 'DANIFICADO', observacoes: 'caiu no brete' }]), { event_id: rem.event_id, justificativa: 'motivo errado' }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.deepEqual([s.animal(A).brinco, s.animal(B).brinco], [null, '100']);
  // Retirada levada para depois de o número ir para o B: o brinco ficaria em dois animais entre 01/07 e 01/08.
  const tarde = s.tent('corrigir', Object.assign(ident('REMOCAO', '2026-08-01', [{ animal_id: A, motivo: 'DANIFICADO' }]), { event_id: r.valor.dados.event_id, justificativa: 'data' }));
  assert.deepEqual([tarde.ok, tarde.erro.code], [false, 'CONFLICT']);
  assert.match(tarde.erro.details[0].mensagem, /até 01\/08\/2026, mas desde 01\/07\/2026 ele é do animal/);
  assert.equal(tarde.erro.details[0].conflito.tipo, 'OUTRA_ENTRADA');
  // O estorno, que devolveria o brinco, segue bloqueado (com razão).
  const est = s.tent('estornar', { event_id: r.valor.dados.event_id, justificativa: 'x' });
  assert.deepEqual([est.erro.code, S.codigos(est.erro)], ['CONFLICT', ['BRINCO_DUPLICADO']]);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 7 ----
test('achado 7: mãe de parto só de natimorto não pode deixar de ser fêmea (correção e estorno)', () => {
  const s = base();
  const id = s.reg('registrar', S.entradaInicial([vaca('300')])).animais[0].animal_id;
  const p = s.reg('registrar', parto('2026-03-01', id, [{ situacao_nascimento: 'NATIMORTO' }]));
  const macho = [{ animal_id: id, campo: 'sexo', valor_novo: 'M' }, { animal_id: id, campo: 'castrado', valor_novo: 'N' }, { animal_id: id, campo: 'reprodutor', valor_novo: 'N' }];
  const r = s.tent('registrar', correcao('2026-04-01', macho));
  assert.deepEqual([r.ok, r.erro.code, S.codigos(r.erro)], [false, 'VALIDATION', ['SEXO_DA_MATRIZ']]);
  assert.match(r.erro.details[0].mensagem, /mãe do parto de 01\/03\/2026/);
  // Com cria viva, um erro só (o do progenitor).
  const s2 = base();
  const id2 = s2.reg('registrar', S.entradaInicial([vaca('300')])).animais[0].animal_id;
  s2.reg('registrar', parto('2026-03-01', id2, [{ situacao_nascimento: 'VIVO', sexo: 'M' }]));
  const r2 = s2.tent('registrar', correcao('2026-04-01', macho.map((x) => Object.assign({}, x, { animal_id: id2 }))));
  assert.deepEqual(S.codigos(r2.erro), ['SEXO_DO_PROGENITOR']);
  // Estorno de uma correção que tinha posto o sexo F, com parto só de natimorto depois: CONFLICT com o parto.
  const s3 = base();
  const boi = s3.reg('registrar', S.entradaInicial([S.bicho({ brinco: '400', sexo: 'M', data_nascimento: '2019-01-10', data_nascimento_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  const fem = s3.reg('registrar', correcao('2026-02-01', [{ animal_id: boi, campo: 'sexo', valor_novo: 'F' }]));
  const p3 = s3.reg('registrar', parto('2026-03-01', boi, [{ situacao_nascimento: 'NATIMORTO' }]));
  const est = s3.tent('estornar', { event_id: fem.event_id, justificativa: 'x' });
  assert.deepEqual([est.erro.code, S.codigos(est.erro), est.erro.details[0].conflito.event_id, est.erro.details[0].conflito.tipo], ['CONFLICT', ['PARTO_DA_MATRIZ'], p3.event_id, 'NASCIMENTO']);
  assert.ok(p.event_id);
  assert.deepEqual(s.erros(), []);
  assert.deepEqual(s3.erros(), []);
});

// ---------------------------------------------------------------- achado 8 ----
test('achado 8: em NASCIMENTOS, linhas iguais sem brinco da cria são gêmeos; iguais com brinco são repetição', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  s.reg('registrar', S.entradaInicial([vaca('300'), vaca('301'), vaca('302')]));
  const MAPA = { colunas: { 'Data do parto': 'data', 'Brinco da mãe': 'mae', Nasceu: 'situacao', 'Sexo da cria': 'sexo', 'Brinco da cria': 'brinco' }, confiancas: {}, padroes: {} };
  const csv = ['Data do parto;Brinco da mãe;Nasceu;Sexo da cria;Brinco da cria',
    '20/10/2026;300;natimorto;;', '20/10/2026;300;natimorto;;', '21/10/2026;301;vivo;M;', '21/10/2026;301;vivo;M;',
    '22/10/2026;302;vivo;F;9001', '22/10/2026;302;vivo;F;9001'].join('\n');
  const imp = criarImportacao(s, 'NASCIMENTOS', csv, 'partos');
  validarTudo(s, imp.import_id, MAPA);
  assert.deepEqual(linhasImp(s, imp.import_id).map((l) => [l.linha_num, l.status, l.erros.map((e) => e.codigo)]), [
    [2, 'VALIDA', []], [3, 'VALIDA', []], [4, 'VALIDA', []], [5, 'VALIDA', []], [6, 'VALIDA', []], [7, 'DUPLICADA', ['LINHA_REPETIDA_NO_ARQUIVO']],
  ]);
  const r = importarBloco(s, imp.import_id, 1, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 5, ignorar: 1 } });
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.ok(concluir(s, imp.import_id).ok);
  const partos = s.tabela('REPRODUCAO').filter((x) => x.tipo_evento === 'PARTO').map((x) => [x.data, x.qtd_nascidos_vivos, x.qtd_natimortos]).sort();
  assert.deepEqual(partos, [['2026-10-20', 0, 2], ['2026-10-21', 2, 0], ['2026-10-22', 1, 0]]);
  s.conferirProjecoes('fim');
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 9 ----
test('achado 9: desfazer a importação com um evento dela corrigido depois é bloqueado até estornar a correção', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const X = s.reg('registrar', S.entradaInicial([vaca('100', { data_nascimento: '2022-01-01', data_nascimento_confianca: 'ESTIMADA' })])).animais[0].animal_id;
  const imp = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n05/02/2026;Pasto A;Pasto B;100', 't');
  validarTudo(s, imp.import_id, { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} });
  importarTudo(s, imp.import_id);
  const importado = s.tabela('EVENTOS').find((e) => e.import_id === imp.import_id);
  const corr = s.reg('corrigir', { event_id: importado.event_id, justificativa: 'era dia 06', tipo: 'TRANSFERENCIA', campos: { event_date: '2026-02-06', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: X }] });
  const desfazer = () => s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { dados: { import_id: imp.import_id, justificativa: 'arquivo errado' } }));
  const d = desfazer();
  assert.deepEqual([d.ok, d.erro.code, S.codigos(d.erro)], [false, 'CONFLICT', ['DEPENDENTE']]);
  assert.deepEqual([d.erro.details[0].conflito.event_id, d.erro.details[0].conflito.tipo, d.erro.details[0].conflito.nome], [corr.event_id, 'TRANSFERENCIA', 'a transferência']);
  assert.match(d.erro.details[0].mensagem, /a transferência de 05\/02\/2026\) recebeu uma correção depois/);
  s.reg('estornar', { event_id: corr.event_id, justificativa: 'desfazer a correção' });
  const d2 = desfazer();
  assert.ok(d2.ok, JSON.stringify(d2.erro));
  assert.equal(s.animal(X).pasto_atual_id, PASTOS.A);
  s.conferirProjecoes('fim');
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 19 ----
test('achado 19: a reconciliação ordena o histórico pela ordem canônica (transferência e venda no mesmo dia, nas duas ordens de importação)', () => {
  const MAPA_V = { colunas: { 'Nº da venda': 'grupo', 'Data da venda': 'data', Comprador: 'comprador', 'Para que foram vendidos': 'finalidade', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco', 'Valor bruto (R$)': 'valor_bruto', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  const MAPA_T = { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  const CSV_V = 'Nº da venda;Data da venda;Comprador;Para que foram vendidos;Como foi o preço;Preço (R$);Valor bruto (R$);Brinco\nV0;01/05/2025;Frigorífico;recria e engorda;cabeça;2.500,00;2.500,00;100';
  const CSV_T = 'Data;Pasto de origem;Pasto de destino;Brinco\n01/05/2025;Pasto A;Pasto B;100';
  [['VENDAS', 'TRANSFERENCIAS'], ['TRANSFERENCIAS', 'VENDAS']].forEach((ordem) => {
    const s = base({ config: { importacao_lote_linhas: '50' } });
    s.parceiro('Frigorífico', ['COMPRADOR']);
    s.reg('registrar', S.entradaInicial([S.bicho({ brinco: '100', sexo: 'M', castrado: true, data_nascimento: '2024-03-01', data_nascimento_confianca: 'CONFIRMADA' })]));
    let fim;
    ordem.forEach((tipo) => {
      const imp = criarImportacao(s, tipo, tipo === 'VENDAS' ? CSV_V : CSV_T, tipo.toLowerCase());
      validarTudo(s, imp.import_id, tipo === 'VENDAS' ? MAPA_V : MAPA_T);
      fim = importarTudo(s, imp.import_id);
    });
    assert.deepEqual(fim.reconciliacao.animais.map((d) => [d.brinco, d.codigo, d.recalculado.no_rebanho]), [['100', 'SAIDA_HISTORICA_NA_FOTOGRAFIA', false]], ordem.join(' → '));
    const r = s.read(s.G.ImportService.consultaReconciliacao());
    assert.deepEqual(r.animais.map((d) => d.codigo), ['SAIDA_HISTORICA_NA_FOTOGRAFIA']);
  });
});

// ---------------------------------------------------------------- achados 13 e 23 ----
test('achados 13 e 23: o conflito leva tipo e subtipo separados e o nome do lançamento; o desfazer cita o lançamento em palavras', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const id = s.reg('registrar', S.entradaInicial([vaca('0457')])).animais[0].animal_id;
  s.reg('registrar', descarte('2026-03-01', id));
  const v = s.reg('registrar', volta('2026-04-01', id));
  const marca = s.reg('registrar', { tipo: 'MARCACAO', subtipo: 'DESCARTE', campos: { event_date: '2026-05-01', acao: 'MARCAR', motivo_descarte: 'IDADE' }, animais: [{ animal_id: id }] });
  const e = s.tent('estornar', { event_id: v.event_id, justificativa: 'x' });
  assert.equal(e.erro.code, 'CONFLICT');
  assert.deepEqual(e.erro.details.map((d) => d.conflito), [{ event_id: marca.event_id, tipo: 'MARCACAO', subtipo: 'DESCARTE', data: '2026-05-01', nome: 'a marcação para descarte' }]);
  // Desfazer importação de animais com lançamento posterior: o texto usa o nome, não o código.
  const MAPA = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: { castrado: false, reprodutor: false } };
  const imp = criarImportacao(s, 'ANIMAIS', 'Brinco;Sexo;Nasc.;Pasto\n500;F;10/01/2023;Pasto A\n501;F;10/01/2023;Pasto A', 'animais');
  validarTudo(s, imp.import_id, MAPA);
  importarTudo(s, imp.import_id);
  const a501 = s.tabela('ANIMAIS').find((a) => a.brinco === '501').animal_id;
  s.reg('registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: '2026-11-10', justificativa: 'estava no B' }, animais: [{ animal_id: a501, pasto_destino_id: PASTOS.B }] });
  const d = s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { dados: { import_id: imp.import_id, justificativa: 'errado' } }));
  assert.equal(d.erro.code, 'CONFLICT');
  assert.deepEqual(d.erro.details.map((x) => x.mensagem), ['A-000003 (brinco 501) tem um lançamento posterior à importação: a correção de localização de 10/11/2026. Estorne esse lançamento antes.']);
  assert.deepEqual([d.erro.details[0].conflito.tipo, d.erro.details[0].conflito.subtipo], ['AJUSTE_INVENTARIO', 'CORRECAO_LOCALIZACAO']);
  // O catálogo da tela leva o nome de cada tipo e subtipo.
  const cat = s.G.EventCatalog.serializar();
  const marc = cat.tipos.find((t) => t.tipo === 'MARCACAO');
  assert.deepEqual([marc.nome, marc.subtipos.DESCARTE.nome, cat.tipos.find((t) => t.tipo === 'TRANSFERENCIA').nome], ['a marcação', 'a marcação para descarte', 'a transferência']);
});
