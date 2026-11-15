'use strict';
/**
 * Revisão independente da Fase 2, rodada 3, lentes MOTOR e CORREÇÕES ANTERIORES: cada achado confirmado vira um teste
 * que falhava antes do conserto. Depois de cada comando a projeção gravada é a reconstrução (Timeline.conferir) e, onde
 * o achado envolve a integridade, a verificação completa fica sem erro (ou acusa a adulteração feita à mão).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const AV = ['INTERVALO_PARTO_CURTO', 'IDADE_REPRODUTIVA', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'BRINCO_PARECIDO', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO'];

/** Sistema do setup com helpers: reg (lança), tent (não lança), ambos conferem a projeção. */
function base(opcoes) {
  const s = S.sistema(opcoes || {});
  let n = 0;
  s.tent = (acao, dados, avisos) => {
    const r = s.tentar((ctx) => s.G.EventService[acao](ctx, { idempotencyKey: 'r3-' + (++n), dados, avisosAceitos: avisos || AV }));
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
const touro = (brinco, extra) => S.bicho(Object.assign({ brinco, sexo: 'M', reprodutor: true, data_nascimento: '2018-01-10', data_nascimento_confianca: 'CONFIRMADA' }, extra || {}));
const correcao = (data, itens) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: data, justificativa: 'conferência do cadastro' }, animais: itens });
const descarte = (data, id) => ({ tipo: 'DESCARTE', campos: { event_date: data, destino: 'DOACAO', motivo: 'IDADE' }, animais: [{ animal_id: id }] });
const morte = (data, id) => ({ tipo: 'MORTE', campos: { event_date: data, causa: 'DOENCA' }, animais: [{ animal_id: id }] });
const ident = (sub, data, itens) => ({ tipo: 'IDENTIFICACAO', subtipo: sub, campos: { event_date: data, tipo_identificacao: 'BRINCO' }, animais: itens });
const ajuste = (sub, data, itens) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: sub, campos: { event_date: data, justificativa: 'conferência' }, animais: itens });
const parto = (data, mae, crias, campos) => ({ tipo: 'NASCIMENTO', campos: Object.assign({ event_date: data, pasto_destino_id: PASTOS.A }, campos || {}), animais: [{ animal_id: mae }], crias });
const NATIMORTO = [{ situacao_nascimento: 'NATIMORTO' }];
const comPai = (id) => ({ pai_id: id, pai_confianca: 'CONFIRMADA' });

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
  s.conferirProjecoes('concluir');
  return c.valor.dados;
}
const linhasImp = (s, id) => s.read(s.G.ImportService.consultaLinhas({ import_id: id, por_pagina: 50 })).itens;
const desfazer = (s, id) => s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { dados: { import_id: id, justificativa: 'arquivo errado' } }));
const MAPA_COMPRA = { colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco', 'Primeiro vencimento': 'vencimento', Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento', Castrado: 'castrado', Reprodutor: 'reprodutor', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: {} };
const CAB_COMPRA = 'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Primeiro vencimento;Brinco;Sexo;Nascimento;Castrado;Reprodutor;Pasto\n';
const MAPA_TRANSF = { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} };

// ---------------------------------------------------------------- achado 1 (ALTA) ----
test('R3 achado 1: o pai de um parto só de natimorto é conferido como o da cria viva (existe, não anulado, macho, nascido antes do parto)', () => {
  const s = base();
  const [V, W, T, Jovem] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('101'), touro('900'), touro('901', { data_nascimento: '2025-12-01' })])).animais.map((a) => a.animal_id);
  const pf = s.tent('registrar', parto('2026-06-01', V, NATIMORTO, comPai(W)));
  assert.deepEqual([pf.ok, pf.erro && pf.erro.code, pf.erro && S.codigos(pf.erro)], [false, 'VALIDATION', ['SEXO_DO_PROGENITOR']]);
  assert.equal(pf.erro.details[0].campo, 'pai_id');
  assert.match(pf.erro.details[0].mensagem, /101 não pode ser pai: precisa ser macho/);
  const pi = s.tent('registrar', parto('2026-06-01', V, NATIMORTO, comPai('eeeeeeee-0000-4000-8000-00000000ffff')));
  assert.deepEqual([pi.ok, pi.erro && S.codigos(pi.erro)], [false, ['NAO_ENCONTRADO']]);
  // Parto antigo (antes do marco zero) com um pai que nasceu depois dele.
  const pn = s.tent('registrar', parto('2025-06-01', V, NATIMORTO, comPai(Jovem)));
  assert.deepEqual([pn.ok, pn.erro && S.codigos(pn.erro)], [false, ['NASCIMENTO_DO_PROGENITOR']]);
  // Pai anulado (a entrada dele foi estornada) também não serve.
  const ent = s.reg('registrar', S.entradaInicial([touro('902')]));
  s.reg('estornar', { event_id: s.tabela('EVENTOS').find((e) => e.event_id === ent.event_id).event_id, justificativa: 'lançado errado' });
  const pa = s.tent('registrar', parto('2026-06-01', V, NATIMORTO, comPai(ent.animais[0].animal_id)));
  assert.deepEqual([pa.ok, pa.erro && S.codigos(pa.erro)], [false, ['NAO_ENCONTRADO']]);
  // Com o touro certo, aceito; a correção do parto (só de natimorto) para o pai fêmea é recusada pelo mesmo caminho.
  const ok = s.reg('registrar', parto('2026-06-01', V, NATIMORTO, comPai(T)));
  const cor = s.tent('corrigir', Object.assign(parto('2026-06-01', V, NATIMORTO, comPai(W)), { event_id: ok.event_id, justificativa: 'pai' }));
  assert.deepEqual([cor.ok, cor.erro && S.codigos(cor.erro)], [false, ['SEXO_DO_PROGENITOR']]);
  assert.deepEqual(s.erros(), []);
});

test('R3 achado 1: corrigir o sexo ou o nascimento do touro de um parto só de natimorto é recusado; o estorno que devolveria fêmea dá CONFLICT com o parto', () => {
  const s = base();
  const [V, T, X] = s.reg('registrar', S.entradaInicial([vaca('100'), touro('900'), vaca('902', { data_nascimento: '2018-01-10' })])).animais.map((a) => a.animal_id);
  const p = s.reg('registrar', parto('2026-06-01', V, NATIMORTO, comPai(T)));
  const cs = s.tent('registrar', correcao('2026-07-01', [{ animal_id: T, campo: 'sexo', valor_novo: 'F' }]));
  assert.deepEqual([cs.ok, cs.erro && cs.erro.code, cs.erro && S.codigos(cs.erro)], [false, 'VALIDATION', ['SEXO_DO_PROGENITOR']]);
  assert.match(cs.erro.details[0].mensagem, /pai do parto de 01\/06\/2026/);
  const cn = s.tent('registrar', correcao('2026-07-01', [{ animal_id: T, campo: 'data_nascimento', valor_novo: '2026-06-15' }]));
  assert.deepEqual([cn.ok, cn.erro && S.codigos(cn.erro)], [false, ['NASCIMENTO_DO_PROGENITOR']]);
  // X entrou como fêmea por engano, foi corrigido para macho e é o pai de outro parto só de natimorto.
  const paraM = s.reg('registrar', correcao('2026-02-01', [{ animal_id: X, campo: 'sexo', valor_novo: 'M' }]));
  const p2 = s.reg('registrar', parto('2026-08-01', V, NATIMORTO, comPai(X)));
  const est = s.tent('estornar', { event_id: paraM.event_id, justificativa: 'engano' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['REFERENCIA_TOURO']]);
  assert.deepEqual([est.erro.details[0].conflito.event_id, est.erro.details[0].conflito.tipo], [p2.event_id, 'NASCIMENTO']);
  assert.equal(p.event_id !== p2.event_id, true);
  assert.deepEqual(s.erros(), []);
});

test('R3 achado 1: a integridade (GENEALOGIA) acusa o touro de um parto que não é macho ou nasceu depois do parto', () => {
  const s = base();
  const [V, W, T] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('101'), touro('900')])).animais.map((a) => a.animal_id);
  const p = s.reg('registrar', parto('2026-06-01', V, NATIMORTO, comPai(T)));
  assert.deepEqual(s.erros(), []);
  const r = s.tabela('REPRODUCAO').find((x) => x.event_id === p.event_id);
  s.editar('REPRODUCAO', r.reproduction_id, 'touro_id', W);
  const e = s.erros().filter((x) => x[0] === 'GENEALOGIA');
  assert.equal(e.length, 1);
  assert.match(e[0][1], /parto de 01\/06\/2026.*101.*não é macho/);
});

// ---------------------------------------------------------------- achado 2 (ALTA) ----
test('R3 achado 2: desfazer a importação que criou o touro de um parto é recusado (CONFLICT com o parto); estornado o parto, passa', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  s.parceiro('Vizinho', ['FORNECEDOR']);
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const imp = criarImportacao(s, 'COMPRAS', CAB_COMPRA + 'C1;10/02/2026;Vizinho;cabeça;9.000,00;9.000,00;10/03/2026;900;M;01/01/2020;N;S;Pasto A', 'compras');
  validarTudo(s, imp.import_id, MAPA_COMPRA);
  importarTudo(s, imp.import_id);
  const T = s.tabela('ANIMAIS').find((a) => a.brinco === '900').animal_id;
  const p = s.reg('registrar', parto('2026-06-01', V, NATIMORTO, comPai(T)));
  const d = desfazer(s, imp.import_id);
  assert.deepEqual([d.ok, d.erro && d.erro.code, d.erro && S.codigos(d.erro)], [false, 'CONFLICT', ['DEPENDENTE']]);
  assert.deepEqual([d.erro.details[0].conflito.event_id, d.erro.details[0].conflito.tipo], [p.event_id, 'NASCIMENTO']);
  assert.match(d.erro.details[0].mensagem, /touro do parto de 01\/06\/2026/);
  assert.equal(s.animal(T).situacao_cadastral, 'ATIVO');
  s.reg('estornar', { event_id: p.event_id, justificativa: 'pai errado' });
  const d2 = desfazer(s, imp.import_id);
  assert.ok(d2.ok, JSON.stringify(d2.erro));
  s.conferirProjecoes('desfazer');
  assert.deepEqual(s.erros(), []);
});

test('R3 achado 2: a importação de ANIMAIS também não se desfaz com o touro dela num parto', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const MAPA_A = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', Pasto: 'pasto', Reprodutor: 'reprodutor' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: { castrado: false } };
  const imp = criarImportacao(s, 'ANIMAIS', 'Brinco;Sexo;Nasc.;Pasto;Reprodutor\n900;M;10/01/2019;Pasto A;S', 'animais');
  validarTudo(s, imp.import_id, MAPA_A);
  importarTudo(s, imp.import_id);
  const T = s.tabela('ANIMAIS').find((a) => a.brinco === '900').animal_id;
  const p = s.reg('registrar', parto('2026-06-01', V, NATIMORTO, comPai(T)));
  const d = desfazer(s, imp.import_id);
  assert.deepEqual([d.ok, d.erro && S.codigos(d.erro)], [false, ['DEPENDENTE']]);
  assert.equal(d.erro.details[0].conflito.event_id, p.event_id);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 3 (ALTA) ----
test('R3 achado 3: estornar a correção da chegada que acomodava um parto antigo dá CONFLICT com o parto', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('100', { data_entrada: '2024-06-01', data_entrada_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  const c = s.reg('registrar', correcao('2026-02-01', [{ animal_id: V, campo: 'data_entrada', valor_novo: '2023-01-01' }]));
  const p = s.reg('registrar', parto('2023-06-01', V, NATIMORTO));
  const est = s.tent('estornar', { event_id: c.event_id, justificativa: 'engano' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['ANTES_DA_ENTRADA']]);
  assert.equal(est.erro.details[0].conflito.event_id, p.event_id);
  // Corrigir a correção para uma chegada depois do parto também é recusado.
  const cor = s.tent('corrigir', Object.assign(correcao('2026-02-01', [{ animal_id: V, campo: 'data_entrada', valor_novo: '2023-09-01' }]), { event_id: c.event_id, justificativa: 'data' }));
  assert.deepEqual([cor.ok, cor.erro && cor.erro.code, cor.erro && S.codigos(cor.erro)], [false, 'CONFLICT', ['ANTES_DA_ENTRADA']]);
  assert.equal(s.animal(V).data_entrada, '2023-01-01');
  assert.deepEqual(s.erros(), []);
});

test('R3 achado 3: estornar ou corrigir a correção do nascimento que acomodava um parto antigo dá CONFLICT com o parto', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('100', { data_nascimento: '2022-01-01' })])).animais[0].animal_id;
  const c = s.reg('registrar', correcao('2026-02-01', [{ animal_id: V, campo: 'data_nascimento', valor_novo: '2019-01-01' }]));
  const p = s.reg('registrar', parto('2021-06-01', V, NATIMORTO));
  const est = s.tent('estornar', { event_id: c.event_id, justificativa: 'engano' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['ANTES_DO_NASCIMENTO']]);
  assert.equal(est.erro.details[0].conflito.event_id, p.event_id);
  const cor = s.tent('corrigir', Object.assign(correcao('2026-02-01', [{ animal_id: V, campo: 'data_nascimento', valor_novo: '2021-12-01' }]), { event_id: c.event_id, justificativa: 'era 2021' }));
  assert.deepEqual([cor.ok, cor.erro && cor.erro.code, cor.erro && S.codigos(cor.erro)], [false, 'CONFLICT', ['ANTES_DO_NASCIMENTO']]);
  // Para uma data que ainda cabe, a correção passa.
  s.reg('corrigir', Object.assign(correcao('2026-02-01', [{ animal_id: V, campo: 'data_nascimento', valor_novo: '2019-06-01' }]), { event_id: c.event_id, justificativa: 'era junho' }));
  assert.equal(s.animal(V).data_nascimento, '2019-06-01');
  assert.deepEqual(s.erros(), []);
});

test('R3 achado 3: a correção que tira o animal de uma correção de cadastro de dois animais confere a linha do tempo com o que volta', () => {
  const s = base();
  const [V, W] = s.reg('registrar', S.entradaInicial([vaca('100', { data_nascimento: '2022-01-01' }), vaca('101')])).animais.map((a) => a.animal_id);
  const c = s.reg('registrar', correcao('2026-02-01', [{ animal_id: V, campo: 'data_nascimento', valor_novo: '2019-01-01' }, { animal_id: W, campo: 'partos_previos', valor_novo: '2' }]));
  const p = s.reg('registrar', parto('2021-06-01', V, NATIMORTO));
  const cor = s.tent('corrigir', Object.assign(correcao('2026-02-01', [{ animal_id: W, campo: 'partos_previos', valor_novo: '2' }]), { event_id: c.event_id, justificativa: 'só a 101' }));
  assert.deepEqual([cor.ok, cor.erro && cor.erro.code, cor.erro && S.codigos(cor.erro)], [false, 'CONFLICT', ['ANTES_DO_NASCIMENTO']]);
  assert.equal(cor.erro.details[0].conflito.event_id, p.event_id);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 4 (ALTA) ----
test('R3 achado 4: a integridade acusa evento vigente sem o detalhe que o tipo grava (COMPRAS, VENDAS, BAIXAS)', () => {
  const s = base();
  const FORN = s.parceiro('Fornecedor', ['FORNECEDOR']);
  const COMP = s.parceiro('Comprador', ['COMPRADOR']);
  const [V, W, X, Y] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('101'), vaca('102'), vaca('103')])).animais.map((a) => a.animal_id);
  const c = s.reg('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-02-01', partner_id: FORN, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 200000, valor_animais: 200000 }, animais: [{ brinco: '500', sexo: 'F', idade_meses: 20 }], parcelas: [{ data_vencimento: '2026-03-01' }] });
  const v = s.reg('registrar', { tipo: 'VENDA', campos: { event_date: '2026-03-01', partner_id: COMP, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 250000, valor_bruto: 250000 }, animais: [{ animal_id: W }], parcelas: [{ data_vencimento: '2026-03-20' }] });
  const d = s.reg('registrar', descarte('2026-05-01', X));
  const dv = s.reg('registrar', ajuste('DIVERGENCIA_CONTAGEM', '2026-06-01', [{ animal_id: V }]));
  const mo = s.reg('registrar', morte('2026-07-01', Y));
  assert.deepEqual(s.erros(), []);
  const apagar = (aba, evId) => s.tabela(aba).filter((x) => x.event_id === evId).forEach((x) => s.apagarLinha(aba, x[s.G.Schema.pk(aba)]));
  apagar('COMPRAS', c.event_id);
  apagar('VENDAS', v.event_id);
  apagar('BAIXAS', d.event_id);
  apagar('BAIXAS', dv.event_id);
  apagar('BAIXAS', mo.event_id);
  const erros = s.erros();
  const de = (re) => erros.filter((e) => re.test(e[1]));
  assert.equal(de(/compra de 01\/02\/2026.*sem a linha de COMPRAS/).length, 1, JSON.stringify(erros));
  assert.equal(de(/venda de 01\/03\/2026.*sem a linha de VENDAS/).length, 1, JSON.stringify(erros));
  assert.equal(de(/sem a linha de BAIXAS/).length, 3, JSON.stringify(erros));
});

// ---------------------------------------------------------------- achado 5 (ALTA) ----
test('R3 achado 5: a importação acha o animal pelo brinco em uso NA DATA do evento (reuso ligado: vai para quem tinha o número)', () => {
  const s = base({ config: { brinco_permite_reuso: 'S', importacao_lote_linhas: '50' } });
  const [X, Y] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca(undefined, { data_nascimento: '2025-12-01' })])).animais.map((a) => a.animal_id);
  s.reg('registrar', ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: X, codigo: '101', motivo: 'PERDA' }]));
  s.reg('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-04-01', [{ animal_id: Y, codigo: '100' }]));
  const imp = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n10/02/2026;Pasto A;Pasto B;100\n20/04/2026;Pasto A;Pasto B;100', 't');
  validarTudo(s, imp.import_id, MAPA_TRANSF);
  assert.deepEqual(linhasImp(s, imp.import_id).map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['VALIDA', []], ['VALIDA', []]]);
  importarTudo(s, imp.import_id);
  const evs = s.tabela('EVENTOS').filter((e) => e.import_id === imp.import_id);
  const dono = (data) => s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === evs.find((e) => e.event_date === data).event_id).animal_id;
  assert.deepEqual([dono('2026-02-10'), dono('2026-04-20')], [X, Y]);
  assert.deepEqual([s.animal(X).pasto_atual_id, s.animal(Y).pasto_atual_id], [PASTOS.B, PASTOS.B]);
  assert.deepEqual(s.erros(), []);
});

test('R3 achado 5: com o reuso desligado, o brinco que o animal usava na data acha o animal; o número sem dono na data pede o código', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const X = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  s.reg('registrar', ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: X, codigo: '101', motivo: 'PERDA' }]));
  const imp = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n10/02/2026;Pasto A;Pasto B;100\n20/03/2026;Pasto B;Pasto A;100', 't');
  validarTudo(s, imp.import_id, MAPA_TRANSF);
  const ls = linhasImp(s, imp.import_id);
  assert.deepEqual(ls.map((l) => l.status), ['VALIDA', 'ERRO']);
  assert.equal(ls[1].erros[0].codigo, 'ANIMAL_NAO_ENCONTRADO');
  assert.match(ls[1].erros[0].mensagem, /brinco 100 não estava em uso em 20\/03\/2026.*informe o código do animal/);
});

// ---------------------------------------------------------------- achado 8 (ALTA, correção incompleta) ----
test('R3 achado 8: desfazer uma importação concluída enquanto outra está em curso é recusado (IMPORTACAO_EM_CURSO)', () => {
  const s = base({ config: { brinco_permite_reuso: 'S', importacao_lote_linhas: '50' } });
  s.parceiro('Vizinho', ['FORNECEDOR']);
  const X = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  s.reg('registrar', descarte('2026-03-01', X));
  const MAPA = { colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco', 'Primeiro vencimento': 'vencimento', Código: 'codigo', Brinco: 'brinco', Sexo: 'sexo', Pasto: 'pasto' }, confiancas: {}, padroes: {} };
  const imp1 = criarImportacao(s, 'COMPRAS', 'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Primeiro vencimento;Código;Brinco;Sexo;Pasto\nC1;10/05/2026;Vizinho;cabeça;2.000,00;2.000,00;10/06/2026;' + s.animal(X).codigo_interno + ';500;F;Pasto A', 'compras');
  validarTudo(s, imp1.import_id, MAPA);
  importarTudo(s, imp1.import_id);
  // A segunda importação compra um animal novo com o 100, livre desde que X o trocou pelo 500 (reuso ligado).
  const imp2 = criarImportacao(s, 'COMPRAS', CAB_COMPRA + 'C9;20/05/2026;Vizinho;cabeça;1.500,00;1.500,00;10/06/2026;100;F;01/01/2024;;;Pasto A', 'compras2');
  validarTudo(s, imp2.import_id, MAPA_COMPRA);
  assert.deepEqual(linhasImp(s, imp2.import_id).map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['VALIDA', []]]);
  const b1 = importarBloco(s, imp2.import_id, 1, { modo: 'TOTAL' });
  assert.ok(b1.ok, JSON.stringify(b1.erro));
  const d = desfazer(s, imp1.import_id);
  assert.deepEqual([d.ok, d.erro && d.erro.code, d.erro && S.codigos(d.erro)], [false, 'CONFLICT', ['IMPORTACAO_EM_CURSO']]);
  assert.match(d.erro.message, /compras2\.csv.*ainda está em andamento: conclua ou desfaça essa antes de desfazer outra/);
  assert.equal(s.tabela('IMPORTACOES').find((i) => i.import_id === imp1.import_id).status, 'IMPORTADO');
  // Concluída a segunda, o desfazer da primeira passa pelas conferências: o 100 agora é do animal novo.
  assert.ok(concluir(s, imp2.import_id).ok);
  const d2 = desfazer(s, imp1.import_id);
  assert.deepEqual([d2.ok, d2.erro && S.codigos(d2.erro)], [false, ['DEPENDENTE']]);
  assert.match(d2.erro.details[0].mensagem, /o brinco 100, que hoje é do animal/);
  assert.equal(s.tabela('ANIMAIS').filter((a) => a.brinco === '100' && a.situacao_cadastral !== 'ANULADO').length, 1);
  assert.deepEqual(s.erros(), []);
});

test('R3 achado 8 (e 11): com eventos, desfazer a primeira importação com a segunda em curso é recusado; concluída a segunda, ela impede o desfazer', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const X = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const imp1 = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n05/02/2026;Pasto A;Pasto B;100', 't1');
  validarTudo(s, imp1.import_id, MAPA_TRANSF);
  importarTudo(s, imp1.import_id);
  const imp2 = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n01/03/2026;Pasto B;Pasto A;100', 't2');
  validarTudo(s, imp2.import_id, MAPA_TRANSF);
  assert.ok(importarBloco(s, imp2.import_id, 1, { modo: 'TOTAL' }).ok);
  const d = desfazer(s, imp1.import_id);
  assert.deepEqual([d.ok, d.erro && S.codigos(d.erro)], [false, ['IMPORTACAO_EM_CURSO']]);
  assert.ok(concluir(s, imp2.import_id).ok);
  const d2 = desfazer(s, imp1.import_id);
  assert.deepEqual([d2.ok, d2.erro && S.codigos(d2.erro)], [false, ['DEPENDENTE']]);
  assert.equal(d2.erro.details[0].conflito.tipo, 'TRANSFERENCIA');
  assert.equal(s.animal(X).pasto_atual_id, PASTOS.A);
  assert.deepEqual(s.erros(), []);
});

test('R3 achado 11: a importação do rebanho inicial não aceita o número que outro animal usava no marco zero (reuso ligado)', () => {
  const s = base({ config: { brinco_permite_reuso: 'S', importacao_lote_linhas: '50' } });
  const X = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  s.reg('registrar', ident('SUBSTITUICAO', '2026-05-10', [{ animal_id: X, codigo: '500', motivo: 'PERDA' }]));
  const MAPA_A = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: { castrado: false, reprodutor: false } };
  const imp = criarImportacao(s, 'ANIMAIS', 'Brinco;Sexo;Nasc.;Pasto\n100;F;10/01/2023;Pasto A', 'animais');
  validarTudo(s, imp.import_id, MAPA_A);
  const ls = linhasImp(s, imp.import_id);
  assert.deepEqual(ls.map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['DUPLICADA', ['BRINCO_JA_CADASTRADO']]]);
  assert.match(ls[0].erros[0].mensagem, /era do animal A-000001 no marco zero \(até 10\/05\/2026\)/);
});

test('R3 achado 8: a importação em curso ainda pode ser desfeita, e a que não gravou nada também', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  s.reg('registrar', S.entradaInicial([vaca('100')]));
  const imp1 = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n05/02/2026;Pasto A;Pasto B;100', 't1');
  validarTudo(s, imp1.import_id, MAPA_TRANSF);
  const imp2 = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n06/02/2026;Pasto A;Pasto B;100', 't2');
  validarTudo(s, imp2.import_id, MAPA_TRANSF);
  assert.ok(importarBloco(s, imp1.import_id, 1, { modo: 'TOTAL' }).ok);
  const d2 = desfazer(s, imp2.import_id);
  assert.ok(d2.ok, JSON.stringify(d2.erro));
  const d1 = desfazer(s, imp1.import_id);
  assert.ok(d1.ok, JSON.stringify(d1.erro));
  s.conferirProjecoes('desfazer');
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achados 11 e 20 (MÉDIA) ----
test('R3 achado 11: com o reuso ligado, o número só vai para outro animal depois do período de quem o tinha (primeira identificação retroativa, correção da data da troca)', () => {
  const s = base({ config: { brinco_permite_reuso: 'S' } });
  const [X, Y] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca(undefined, { data_nascimento: '2024-01-10' })])).animais.map((a) => a.animal_id);
  const troca = s.reg('registrar', ident('SUBSTITUICAO', '2026-05-01', [{ animal_id: X, codigo: '101', motivo: 'PERDA' }]));
  const cedo = s.tent('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-03-01', [{ animal_id: Y, codigo: '100' }]));
  assert.deepEqual([cedo.ok, cedo.erro && cedo.erro.code, cedo.erro && S.codigos(cedo.erro)], [false, 'CONFLICT', ['BRINCO_DUPLICADO']]);
  assert.deepEqual([cedo.erro.details[0].conflito.event_id, cedo.erro.details[0].conflito.tipo, cedo.erro.details[0].conflito.subtipo], [troca.event_id, 'IDENTIFICACAO', 'SUBSTITUICAO']);
  assert.match(cedo.erro.details[0].mensagem, /daria ao animal o brinco 100 em 01\/03\/2026, mas nessa data ele era do animal .* até 01\/05\/2026/);
  const prim = s.reg('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-05-01', [{ animal_id: Y, codigo: '100' }]));
  // Levar a troca do X para depois de o 100 ir para o Y deixaria o número nos dois.
  const cor = s.tent('corrigir', Object.assign(ident('SUBSTITUICAO', '2026-07-01', [{ animal_id: X, codigo: '101', motivo: 'PERDA' }]), { event_id: troca.event_id, justificativa: 'data' }));
  assert.deepEqual([cor.ok, cor.erro && cor.erro.code, cor.erro && S.codigos(cor.erro)], [false, 'CONFLICT', ['BRINCO_DUPLICADO']]);
  assert.equal(cor.erro.details[0].conflito.event_id, prim.event_id);
  assert.match(cor.erro.details[0].mensagem, /deixaria o brinco 100 no animal até 01\/07\/2026, mas desde 01\/05\/2026 ele é do animal/);
  assert.deepEqual(s.erros(), []);
  // A integridade acusa o número em dois animais ao mesmo tempo (edição à mão do fim do período do X).
  const linhaX = s.tabela('IDENTIFICACOES').find((r) => r.animal_id === X && r.codigo === '100');
  s.editar('IDENTIFICACOES', linhaX.ident_id, 'data_fim', '2026-07-01');
  assert.ok(s.erros().some((e) => e[0] === 'IDENTIFICACOES_ATIVAS' && /ficou em dois animais ao mesmo tempo/.test(e[1])), JSON.stringify(s.erros()));
});

test('R3 achado 20: a TROCA de brinco levada para depois de o número ir para outro animal dá CONFLICT com a entrada dele (como a retirada)', () => {
  const s = base({ config: { brinco_permite_reuso: 'S' } });
  const A = s.reg('registrar', S.entradaInicial([vaca('100', { data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' })])).animais[0].animal_id;
  const troca = s.reg('registrar', ident('SUBSTITUICAO', '2026-06-01', [{ animal_id: A, codigo: '200', motivo: 'PERDA' }]));
  const ent = s.reg('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-07-01', description: 'doação' }, animais: [vaca('100', { data_nascimento: '2024-01-01', data_nascimento_confianca: 'ESTIMADA' })] });
  const r = s.tent('corrigir', Object.assign(ident('SUBSTITUICAO', '2026-08-01', [{ animal_id: A, codigo: '200', motivo: 'PERDA' }]), { event_id: troca.event_id, justificativa: 'data errada' }));
  assert.deepEqual([r.ok, r.erro && r.erro.code, r.erro && S.codigos(r.erro)], [false, 'CONFLICT', ['BRINCO_DUPLICADO']]);
  assert.deepEqual([r.erro.details[0].conflito.event_id, r.erro.details[0].conflito.tipo], [ent.event_id, 'OUTRA_ENTRADA']);
  assert.match(r.erro.details[0].mensagem, /deixaria o brinco 100 no animal até 01\/08\/2026, mas desde 01\/07\/2026 ele é do animal/);
  // Só o motivo, na mesma data: aceito.
  s.reg('corrigir', Object.assign(ident('SUBSTITUICAO', '2026-06-01', [{ animal_id: A, codigo: '200', motivo: 'DANIFICADO' }]), { event_id: troca.event_id, justificativa: 'motivo' }));
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 15 (MÉDIA) ----
test('R3 achado 15: corrigir só o preço de uma compra cujo brinco foi acertado por "brinco lançado errado" e depois reaproveitado é aceito', () => {
  const s = base();
  const forn = s.parceiro('Leilão', ['FORNECEDOR']);
  const compra = (preco, animal) => ({
    tipo: 'COMPRA', campos: { event_date: '2026-03-10', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: preco, valor_animais: preco },
    animais: [Object.assign({ brinco: '0801', sexo: 'M', castrado: false, reprodutor: false }, animal)], parcelas: [{ data_vencimento: '2026-04-10' }],
  });
  const c = s.reg('registrar', compra(300000, { idade_meses: 14 }));
  const boi = c.animais[0].animal_id;
  s.reg('registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-03-20', [{ animal_id: boi, brinco: '0901' }]));
  const outro = s.reg('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-04-01', description: 'doação' }, animais: [vaca('0801', { data_nascimento: '2024-01-01' })] }).animais[0].animal_id;
  const at = s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === c.event_id).atributos_iniciais_json;
  const r = s.tent('corrigir', Object.assign(compra(310000, { animal_id: boi, data_nascimento: at.data_nascimento, data_nascimento_confianca: at.data_nascimento_confianca }), { event_id: c.event_id, justificativa: 'preço' }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.deepEqual([s.animal(boi).brinco, s.animal(outro).brinco], ['0901', '0801']);
  assert.deepEqual(s.erros(), []);
  // Um número que a compra não tinha e que hoje é de outro animal continua recusado (proposta nova).
  const terceiro = s.reg('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-04-02', description: 'doação' }, animais: [vaca('0555', { data_nascimento: '2024-01-01' })] }).animais[0].animal_id;
  const r2 = s.tent('corrigir', Object.assign(compra(310000, { animal_id: boi, brinco: '0555', data_nascimento: at.data_nascimento, data_nascimento_confianca: at.data_nascimento_confianca }), { event_id: r.valor.dados.event_id, justificativa: 'brinco' }));
  assert.deepEqual([r2.ok, r2.erro && r2.erro.code, r2.erro && S.codigos(r2.erro)], [false, 'VALIDATION', ['BRINCO_DUPLICADO']]);
  assert.equal(s.animal(terceiro).brinco, '0555');
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 17 (MÉDIA, correção incompleta) ----
test('R3 achado 17: corrigir o próprio rebanho inicial para uma chegada depois de um parto antigo dá CONFLICT com o parto', () => {
  const s = base();
  const e = s.reg('registrar', S.entradaInicial([vaca('300', { data_entrada: '2020-02-01', data_entrada_confianca: 'CONFIRMADA' })]));
  const id = e.animais[0].animal_id;
  const p = s.reg('registrar', parto('2024-09-01', id, [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '6001' }]));
  const r = s.tent('corrigir', Object.assign(S.entradaInicial([vaca('300', { animal_id: id, data_entrada: '2025-01-01', data_entrada_confianca: 'CONFIRMADA' })]), { event_id: e.event_id, justificativa: 'data de chegada' }));
  assert.deepEqual([r.ok, r.erro && r.erro.code, r.erro && S.codigos(r.erro)], [false, 'CONFLICT', ['ANTES_DA_ENTRADA']]);
  assert.equal(r.erro.details[0].conflito.event_id, p.event_id);
  // Uma correção de cadastro da chegada, que continua valendo, decide a chegada mesmo com o rebanho inicial corrigido.
  s.reg('registrar', correcao('2026-02-01', [{ animal_id: id, campo: 'data_entrada', valor_novo: '2019-06-01' }]));
  const r2 = s.tent('corrigir', Object.assign(S.entradaInicial([vaca('300', { animal_id: id, data_entrada: '2025-01-01', data_entrada_confianca: 'CONFIRMADA' })]), { event_id: e.event_id, justificativa: 'data de chegada' }));
  assert.ok(r2.ok, JSON.stringify(r2.erro));
  assert.equal(s.animal(id).data_entrada, '2019-06-01');
  assert.deepEqual(s.erros(), []);
});

test('R3 achado 17: corrigir a compra histórica que criou o animal para depois de um parto antigo dá CONFLICT com o parto', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const forn = s.parceiro('Vizinho', ['FORNECEDOR']);
  const imp = criarImportacao(s, 'COMPRAS', CAB_COMPRA + 'C1;10/01/2023;Vizinho;cabeça;2.000,00;2.000,00;10/02/2023;300;F;01/01/2020;;;Pasto A', 'compras');
  validarTudo(s, imp.import_id, MAPA_COMPRA);
  importarTudo(s, imp.import_id);
  const vacaId = s.tabela('ANIMAIS').find((a) => a.brinco === '300').animal_id;
  const p = s.reg('registrar', parto('2024-09-01', vacaId, NATIMORTO));
  const compra = s.tabela('EVENTOS').find((e) => e.import_id === imp.import_id);
  const dados = (data) => ({ tipo: 'COMPRA', event_id: compra.event_id, justificativa: 'data errada', campos: { event_date: data, partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 200000, valor_animais: 200000 }, animais: [{ animal_id: vacaId, brinco: '300', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA' }] });
  const r = s.tent('corrigir', dados('2025-01-10'));
  assert.deepEqual([r.ok, r.erro && r.erro.code, r.erro && S.codigos(r.erro)], [false, 'CONFLICT', ['ANTES_DA_ENTRADA']]);
  assert.equal(r.erro.details[0].conflito.event_id, p.event_id);
  assert.ok(s.tent('corrigir', dados('2023-03-10')).ok);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 18 (MÉDIA, correção incompleta) ----
test('R3 achado 18: corrigir o nascimento do filho para antes do nascimento da mãe é recusado (NASCIMENTO_DO_PROGENITOR)', () => {
  const s = base();
  const A = s.reg('registrar', S.entradaInicial([vaca('A1', { data_nascimento: '2019-01-10' })])).animais[0].animal_id;
  const X = s.reg('registrar', S.entradaInicial([vaca('X1', { data_nascimento: '2023-05-01', mae_id: A, mae_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  const r = s.tent('registrar', correcao('2026-02-01', [{ animal_id: X, campo: 'data_nascimento', valor_novo: '2018-03-01' }]));
  assert.deepEqual([r.ok, r.erro && r.erro.code, r.erro && S.codigos(r.erro)], [false, 'VALIDATION', ['NASCIMENTO_DO_PROGENITOR']]);
  assert.match(r.erro.details[0].mensagem, /a mãe dele, A1, nasceu em 10\/01\/2019/);
  assert.ok(s.tent('registrar', correcao('2026-02-01', [{ animal_id: X, campo: 'data_nascimento', valor_novo: '2022-03-01' }])).ok);
  assert.deepEqual(s.erros(), []);
});

test('R3 achado 18: o estorno que devolveria ao filho um nascimento anterior ao da mãe dá CONFLICT com a correção que pôs a mãe', () => {
  const s = base();
  const A = s.reg('registrar', S.entradaInicial([vaca('A1', { data_nascimento: '2019-01-10' })])).animais[0].animal_id;
  const X = s.reg('registrar', S.entradaInicial([vaca('X1', { data_nascimento: '2018-03-01' })])).animais[0].animal_id;
  const c1 = s.reg('registrar', correcao('2026-02-01', [{ animal_id: X, campo: 'data_nascimento', valor_novo: '2023-05-01' }]));
  const c2 = s.reg('registrar', correcao('2026-03-01', [{ animal_id: X, campo: 'mae_id', valor_novo: A }, { animal_id: X, campo: 'mae_confianca', valor_novo: 'CONFIRMADA' }]));
  const e = s.tent('estornar', { event_id: c1.event_id, justificativa: 'era engano' });
  assert.deepEqual([e.ok, e.erro && e.erro.code, e.erro && S.codigos(e.erro)], [false, 'CONFLICT', ['REFERENCIA_GENEALOGICA']]);
  assert.deepEqual([e.erro.details[0].conflito.event_id, e.erro.details[0].conflito.tipo], [c2.event_id, 'AJUSTE_INVENTARIO']);
  assert.match(e.erro.details[0].mensagem, /voltaria o nascimento do animal para 01\/03\/2018, mas a mãe dele, A1, nasceu em 10\/01\/2019/);
  assert.equal(s.animal(X).data_nascimento, '2023-05-01');
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 12 (MÉDIA) ----
test('R3 achado 12: a reconciliação para de mostrar a divergência depois que o dono segue a ação recomendada no marco zero', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const [X, Y] = s.reg('registrar', S.entradaInicial([vaca('100', { data_entrada: '2024-01-01', data_entrada_confianca: 'ESTIMADA' }), vaca('101', { data_entrada: '2024-01-01', data_entrada_confianca: 'ESTIMADA' })])).animais.map((a) => a.animal_id);
  const imp = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n10/06/2025;Pasto A;Pasto B;100', 't');
  validarTudo(s, imp.import_id, MAPA_TRANSF);
  importarTudo(s, imp.import_id);
  const MAPA_MORTES = { colunas: { 'Data da morte': 'data', 'Causa da morte': 'causa', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  const imp2 = criarImportacao(s, 'MORTES', 'Data da morte;Causa da morte;Brinco\n02/09/2025;doença;101', 'm');
  validarTudo(s, imp2.import_id, MAPA_MORTES);
  importarTudo(s, imp2.import_id);
  const rec = () => s.read(s.G.ImportService.consultaReconciliacao());
  assert.deepEqual(rec().animais.map((d) => d.codigo).sort(), ['PASTO_DIVERGENTE', 'SAIDA_HISTORICA_NA_FOTOGRAFIA']);
  assert.match(rec().animais.find((d) => d.codigo === 'PASTO_DIVERGENTE').acao, /"Corrigir localização" datado do marco zero/);
  s.reg('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-01-01', [{ animal_id: X, pasto_destino_id: PASTOS.B }]));
  s.reg('registrar', ajuste('DIVERGENCIA_CONTAGEM', '2026-01-01', [{ animal_id: Y }]));
  const r = rec();
  assert.deepEqual([r.animais, r.pastos, r.resumo.divergencias], [[], [], 0]);
  assert.deepEqual([s.animal(X).pasto_atual_id, s.animal(Y).situacao_cadastral], [PASTOS.B, 'BAIXADO_AJUSTE']);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 23 (BAIXA, correção incompleta) ----
test('R3 achado 23: nas referências de genealogia e de touro o conflito traz o tipo, a data e o nome do lançamento, uma vez por lançamento', () => {
  const s = base();
  const ev = s.reg('registrar', S.entradaInicial([vaca('300')]));
  const evT = s.reg('registrar', S.entradaInicial([touro('T1')]));
  const p = s.reg('registrar', parto('2026-03-01', ev.animais[0].animal_id, [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '9001' }], comPai(evT.animais[0].animal_id)));
  const unicoPorEvento = (det) => assert.equal(new Set(det.map((d) => d.conflito.event_id)).size, det.length, JSON.stringify(det));
  for (const e of [ev, evT]) {
    const r = s.tent('estornar', { event_id: e.event_id, justificativa: 'x' });
    assert.equal(r.erro.code, 'CONFLICT');
    unicoPorEvento(r.erro.details);
    r.erro.details.forEach((d) => assert.deepEqual([d.conflito.event_id, d.conflito.tipo, d.conflito.data, d.conflito.nome], [p.event_id, 'NASCIMENTO', '2026-03-01', s.G.EventCatalog.nomeEvento('NASCIMENTO', null)]));
  }
  // A filha que entrou por outra entrada: a data é a do lançamento dela (01/05/2026), não o nascimento.
  const boi = s.reg('registrar', S.entradaInicial([S.bicho({ brinco: '400', sexo: 'M', data_nascimento: '2019-01-10', data_nascimento_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  const fem = s.reg('registrar', correcao('2026-02-01', [{ animal_id: boi, campo: 'sexo', valor_novo: 'F' }]));
  const ent = s.reg('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-05-01', description: 'bezerra de volta' }, animais: [vaca('777', { data_nascimento: '2025-09-01', data_nascimento_confianca: 'ESTIMADA', mae_id: boi, mae_confianca: 'CONFIRMADA' })] });
  const est = s.tent('estornar', { event_id: fem.event_id, justificativa: 'x' });
  assert.deepEqual([est.erro.code, S.codigos(est.erro)], ['CONFLICT', ['REFERENCIA_GENEALOGICA']]);
  assert.deepEqual([est.erro.details[0].conflito.event_id, est.erro.details[0].conflito.tipo, est.erro.details[0].conflito.data], [ent.event_id, 'OUTRA_ENTRADA', '2026-05-01']);
  // Com uma cria de parto, o parto da matriz e a cria dele são um lançamento só.
  const boi2 = s.reg('registrar', S.entradaInicial([S.bicho({ brinco: '401', sexo: 'M', data_nascimento: '2019-01-10', data_nascimento_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  const fem2 = s.reg('registrar', correcao('2026-02-01', [{ animal_id: boi2, campo: 'sexo', valor_novo: 'F' }]));
  const p2 = s.reg('registrar', parto('2026-03-01', boi2, [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '9002' }]));
  const est2 = s.tent('estornar', { event_id: fem2.event_id, justificativa: 'x' });
  assert.deepEqual([est2.erro.code, S.codigos(est2.erro)], ['CONFLICT', ['PARTO_DA_MATRIZ']]);
  assert.deepEqual([est2.erro.details[0].conflito.event_id, est2.erro.details[0].conflito.tipo], [p2.event_id, 'NASCIMENTO']);
  assert.deepEqual(s.erros(), []);
});
