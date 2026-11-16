'use strict';
/**
 * Revisão independente da Fase 2, rodada 4, lentes MOTOR e CORREÇÕES ANTERIORES: cada achado confirmado vira um teste
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
    const r = s.tentar((ctx) => s.G.EventService[acao](ctx, { idempotencyKey: 'r4-' + (++n), dados, avisosAceitos: avisos || AV }));
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
const ident = (sub, data, itens) => ({ tipo: 'IDENTIFICACAO', subtipo: sub, campos: { event_date: data, tipo_identificacao: 'BRINCO' }, animais: itens });
const ajuste = (sub, data, itens) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: sub, campos: { event_date: data, justificativa: 'conferência' }, animais: itens });
const parto = (data, mae, crias, campos) => ({ tipo: 'NASCIMENTO', campos: Object.assign({ event_date: data, pasto_destino_id: PASTOS.A }, campos || {}), animais: [{ animal_id: mae }], crias });
const NATIMORTO = [{ situacao_nascimento: 'NATIMORTO' }];
const comPai = (id) => ({ pai_id: id, pai_confianca: 'CONFIRMADA' });
function compra(forn, data, brinco) {
  return { tipo: 'COMPRA', campos: { event_date: data, partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 200000, valor_animais: 200000 }, animais: [{ brinco, sexo: 'F', idade_meses: 20 }], parcelas: [{ data_vencimento: data }] };
}
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
const MAPA_TRANSF = { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} };

/** O item do rebanho inicial do animal como foi gravado (para a correção de quem o criou), com `mudar` por cima. */
function itemDoRebanhoInicial(s, ev, id, brinco, mudar) {
  const l = s.tabela('EVENTO_ANIMAIS').find((x) => x.event_id === ev && x.animal_id === id);
  const at = Object.assign({}, l.atributos_iniciais_json);
  ['castrado', 'reprodutor'].forEach((k) => { if (at[k] === 'S' || at[k] === 'N') at[k] = at[k] === 'S'; });
  return Object.assign({ animal_id: id, pasto_destino_id: l.pasto_destino_id, brinco }, at, mudar || {});
}

// ---------------------------------------------------------------- achados 1 e 5 (ALTA) ----
test('R4 achados 1 e 5: o estorno de uma troca intermediária que devolveria ao animal um número de outro no período dá CONFLICT com o registro do outro (reuso ligado)', () => {
  const s = base({ config: { brinco_permite_reuso: 'S' } });
  const FORN = s.parceiro('Forn', ['FORNECEDOR']);
  const V = s.reg('registrar', S.entradaInicial([vaca('107')])).animais[0].animal_id;
  const t1 = s.reg('registrar', ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: V, codigo: '108', motivo: 'PERDA' }]));
  const c = s.reg('registrar', compra(FORN, '2026-04-01', '107'));
  s.reg('registrar', ident('SUBSTITUICAO', '2026-06-01', [{ animal_id: V, codigo: '109', motivo: 'PERDA' }]));
  assert.deepEqual(s.erros(), []);
  const est = s.tent('estornar', { event_id: t1.event_id, justificativa: 'troca lançada por engano' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['BRINCO_DUPLICADO']]);
  assert.deepEqual([est.erro.details[0].conflito.event_id, est.erro.details[0].conflito.tipo], [c.event_id, 'COMPRA']);
  assert.match(est.erro.details[0].mensagem, /107.*até 01\/06\/2026.*desde 01\/04\/2026.*A-000002/);
  // A simulação diz o mesmo, e nada foi gravado.
  assert.equal(s.tabela('EVENTOS').filter((e) => e.event_type === 'ESTORNO').length, 0);
  assert.deepEqual(s.erros(), []);
});

test('R4 achados 1 e 5: estornar o "brinco lançado errado" depois de o número ir para outro animal dá CONFLICT (reuso desligado e ligado)', () => {
  // Reuso desligado: o número lançado errado volta a valer desde a entrada e cruza o do animal comprado depois.
  const s = base();
  const FORN = s.parceiro('Forn', ['FORNECEDOR']);
  const V = s.reg('registrar', S.entradaInicial([vaca('107')])).animais[0].animal_id;
  const errado = s.reg('registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-02-20', [{ animal_id: V, brinco: '119' }]));
  const c = s.reg('registrar', compra(FORN, '2026-03-01', '107'));
  s.reg('registrar', ident('SUBSTITUICAO', '2026-04-01', [{ animal_id: V, codigo: '116', motivo: 'PERDA' }]));
  const est = s.tent('estornar', { event_id: errado.event_id, justificativa: 'o brinco não estava errado' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['BRINCO_DUPLICADO']]);
  assert.equal(est.erro.details[0].conflito.event_id, c.event_id);
  assert.deepEqual(s.erros(), []);
  // Reuso ligado, o outro animal já trocou de número: o período dele (01/04 a 01/05) cruza o que volta.
  const s2 = base({ config: { brinco_permite_reuso: 'S' } });
  const [X, Y] = s2.reg('registrar', S.entradaInicial([vaca('0801'), vaca(undefined, { data_nascimento: '2024-01-10' })])).animais.map((a) => a.animal_id);
  const inc = s2.reg('registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-03-20', [{ animal_id: X, brinco: '0901' }]));
  const prim = s2.reg('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-04-01', [{ animal_id: Y, codigo: '0801' }]));
  const troca = s2.reg('registrar', ident('SUBSTITUICAO', '2026-05-01', [{ animal_id: Y, codigo: '0802', motivo: 'PERDA' }]));
  const e2 = s2.tent('estornar', { event_id: inc.event_id, justificativa: 'engano' });
  assert.deepEqual([e2.ok, e2.erro && e2.erro.code, e2.erro && S.codigos(e2.erro)], [false, 'CONFLICT', ['BRINCO_DUPLICADO']]);
  assert.ok([prim.event_id, troca.event_id].includes(e2.erro.details[0].conflito.event_id), JSON.stringify(e2.erro.details));
  assert.equal(s2.animal(X).brinco, '0901');
  assert.deepEqual(s2.erros(), []);
});

test('R4 achados 1 e 5: o estorno da primeira de duas trocas (reuso ligado) também é recusado quando o outro animal recebeu o número no meio', () => {
  const s = base({ config: { brinco_permite_reuso: 'S' } });
  const [X, Y] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca(undefined, { data_nascimento: '2024-01-10' })])).animais.map((a) => a.animal_id);
  const t1 = s.reg('registrar', ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: X, codigo: '101', motivo: 'PERDA' }]));
  s.reg('registrar', ident('SUBSTITUICAO', '2026-06-01', [{ animal_id: X, codigo: '102', motivo: 'PERDA' }]));
  const prim = s.reg('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-04-01', [{ animal_id: Y, codigo: '100' }]));
  const est = s.tent('estornar', { event_id: t1.event_id, justificativa: 'engano' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['BRINCO_DUPLICADO']]);
  assert.equal(est.erro.details[0].conflito.event_id, prim.event_id);
  assert.deepEqual(s.erros(), []);
  // Estornada antes a primeira identificação do Y, o estorno da troca passa e a integridade continua limpa.
  s.reg('estornar', { event_id: prim.event_id, justificativa: 'número errado' });
  s.reg('estornar', { event_id: t1.event_id, justificativa: 'engano' });
  assert.equal(s.animal(X).brinco, '102');
  assert.deepEqual(s.erros(), []);
});

test('R4 achados 1 e 5: a correção que tira a linha de brinco do original (sem linha de brinco no plano) confere os períodos de uso', () => {
  // A primeira de duas trocas do X é corrigida para OUTRO animal (Z): o X fica com o 100 até a segunda troca (01/06),
  // e o 100 é do Y desde 01/04. O brinco de hoje do X (102) não muda: só os períodos mostram o cruzamento.
  const s = base({ config: { brinco_permite_reuso: 'S' } });
  const [X, Y, Z] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca(undefined, { data_nascimento: '2024-01-10' }), vaca('300')])).animais.map((a) => a.animal_id);
  const t1 = s.reg('registrar', ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: X, codigo: '101', motivo: 'PERDA' }]));
  s.reg('registrar', ident('SUBSTITUICAO', '2026-06-01', [{ animal_id: X, codigo: '102', motivo: 'PERDA' }]));
  const prim = s.reg('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-04-01', [{ animal_id: Y, codigo: '100' }]));
  const cor = s.tent('corrigir', Object.assign(ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: Z, codigo: '101', motivo: 'PERDA' }]), { event_id: t1.event_id, justificativa: 'a troca foi no 300' }));
  assert.deepEqual([cor.ok, cor.erro && cor.erro.code], [false, 'CONFLICT'], JSON.stringify(cor.erro));
  assert.ok(cor.erro.details.some((d) => d.codigo === 'BRINCO_DUPLICADO' && d.conflito.event_id === prim.event_id && /100.*até 01\/06\/2026/.test(d.mensagem)), JSON.stringify(cor.erro.details));
  assert.equal(s.animal(X).brinco, '102');
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 6 (ALTA) ----
test('R4 achado 6: estornar a correção do nascimento que deixaria a chegada antes do nascimento dá CONFLICT com a correção da chegada', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('100', { data_nascimento: '2022-06-01', data_entrada: '2022-07-01', data_entrada_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  const cn = s.reg('registrar', correcao('2026-02-01', [{ animal_id: V, campo: 'data_nascimento', valor_novo: '2020-01-01' }]));
  const ce = s.reg('registrar', correcao('2026-02-02', [{ animal_id: V, campo: 'data_entrada', valor_novo: '2021-01-01' }]));
  const est = s.tent('estornar', { event_id: cn.event_id, justificativa: 'engano' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['ENTRADA_ANTES_DO_NASCIMENTO']]);
  assert.equal(est.erro.details[0].conflito.event_id, ce.event_id);
  assert.match(est.erro.details[0].mensagem, /chegada na fazenda \(01\/01\/2021\).*antes do nascimento \(01\/06\/2022\)/);
  // A correção da correção do nascimento para uma data depois da chegada é recusada pela regra do próprio comando.
  const cor = s.tent('corrigir', Object.assign(correcao('2026-02-01', [{ animal_id: V, campo: 'data_nascimento', valor_novo: '2021-06-01' }]), { event_id: cn.event_id, justificativa: 'data' }));
  assert.deepEqual([cor.ok, cor.erro && cor.erro.code, cor.erro && S.codigos(cor.erro)], [false, 'VALIDATION', ['ENTRADA_ANTES_DO_NASCIMENTO']]);
  // O estorno da correção da chegada que acomodava o nascimento corrigido depois dá CONFLICT com a correção do nascimento.
  const s2 = base();
  const W = s2.reg('registrar', S.entradaInicial([vaca('200', { data_nascimento: '2022-06-01', data_entrada: '2022-07-01', data_entrada_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  const ce2 = s2.reg('registrar', correcao('2026-02-01', [{ animal_id: W, campo: 'data_entrada', valor_novo: '2024-01-01' }]));
  const cn2 = s2.reg('registrar', correcao('2026-02-03', [{ animal_id: W, campo: 'data_nascimento', valor_novo: '2023-06-01' }]));
  const e2 = s2.tent('estornar', { event_id: ce2.event_id, justificativa: 'engano' });
  assert.deepEqual([e2.ok, e2.erro && e2.erro.code, e2.erro && S.codigos(e2.erro)], [false, 'CONFLICT', ['ENTRADA_ANTES_DO_NASCIMENTO']]);
  assert.equal(e2.erro.details[0].conflito.event_id, cn2.event_id);
  assert.equal(s2.animal(W).data_entrada, '2024-01-01');
  assert.deepEqual(s2.erros(), []);
  assert.deepEqual([s.animal(V).data_nascimento, s.animal(V).data_entrada], ['2020-01-01', '2021-01-01']);
  assert.deepEqual(s.erros(), []);
});

test('R4 achado 6: corrigir o rebanho inicial para um nascimento depois da chegada que uma correção de cadastro definiu é recusado', () => {
  const s = base();
  const ent = s.reg('registrar', S.entradaInicial([vaca('100', { data_entrada: '2023-01-01', data_entrada_confianca: 'CONFIRMADA' })]));
  const V = ent.animais[0].animal_id;
  s.reg('registrar', correcao('2026-02-01', [{ animal_id: V, campo: 'data_entrada', valor_novo: '2021-01-01' }]));
  const r = s.tent('corrigir', Object.assign(S.entradaInicial([itemDoRebanhoInicial(s, ent.event_id, V, '100', { data_nascimento: '2022-01-01' })]), { event_id: ent.event_id, justificativa: 'nascimento' }));
  assert.deepEqual([r.ok, r.erro && r.erro.code, r.erro && S.codigos(r.erro)], [false, 'VALIDATION', ['ENTRADA_ANTES_DO_NASCIMENTO']]);
  assert.match(r.erro.details[0].mensagem, /01\/01\/2021.*01\/01\/2022/);
  assert.equal(s.animal(V).data_nascimento, '2019-01-10');
  // A compra que criou o animal corrigida para antes de um nascimento corrigido depois dela também é recusada.
  const FORN = s.parceiro('Forn', ['FORNECEDOR']);
  const c = s.reg('registrar', compra(FORN, '2026-03-01', '200'));
  const W = c.animais[0].animal_id;
  s.reg('registrar', correcao('2026-03-05', [{ animal_id: W, campo: 'data_nascimento', valor_novo: '2026-02-20' }]));
  const l = s.tabela('EVENTO_ANIMAIS').find((x) => x.event_id === c.event_id);
  const item = Object.assign({ animal_id: W, brinco: '200' }, l.atributos_iniciais_json);
  delete item.origem;
  const rc = s.tent('corrigir', Object.assign(compra(FORN, '2026-02-10', '200'), { animais: [item], event_id: c.event_id, justificativa: 'data' }));
  assert.deepEqual([rc.ok, rc.erro && rc.erro.code], [false, 'VALIDATION'], JSON.stringify(rc.erro));
  assert.ok(S.codigos(rc.erro).includes('NASCIMENTO_DEPOIS_DA_ENTRADA'), JSON.stringify(rc.erro.details));
  assert.deepEqual(s.erros(), []);
});

test('R4 achado 6: a integridade acusa a chegada antes do nascimento no cadastro (adulteração à mão)', () => {
  const s = base();
  const ent = s.reg('registrar', S.entradaInicial([vaca('100', { data_entrada: '2023-01-01', data_entrada_confianca: 'CONFIRMADA' })]));
  const V = ent.animais[0].animal_id;
  const c = s.reg('registrar', correcao('2026-02-01', [{ animal_id: V, campo: 'data_entrada', valor_novo: '2021-01-01' }]));
  assert.deepEqual(s.erros(), []);
  const aj = s.tabela('AJUSTES').find((a) => a.event_id === c.event_id && a.campo === 'data_entrada');
  s.editar('AJUSTES', aj.ajuste_id, 'valor_novo', '2018-01-01');
  s.editar('ANIMAIS', V, 'data_entrada', '2018-01-01');
  const e = s.erros().filter((x) => /chegada/.test(x[1]));
  assert.equal(e.length, 1, JSON.stringify(s.erros()));
  assert.match(e[0][1], /chegada na fazenda \(01\/01\/2018\).*antes do nascimento \(10\/01\/2019\)/);
});

// ---------------------------------------------------------------- achado 18 (MÉDIA) ----
test('R4 achado 18: corrigir o lançamento que criou o filho para antes da mãe definida por correção de cadastro é recusado', () => {
  const s = base();
  const ent = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('200', { data_nascimento: '2022-01-01' })]));
  const [M, F] = ent.animais.map((a) => a.animal_id);
  s.reg('registrar', correcao('2026-02-01', [{ animal_id: F, campo: 'mae_id', valor_novo: M }, { animal_id: F, campo: 'mae_confianca', valor_novo: 'CONFIRMADA' }]));
  const itens = [itemDoRebanhoInicial(s, ent.event_id, M, '100'), itemDoRebanhoInicial(s, ent.event_id, F, '200', { data_nascimento: '2018-06-01' })];
  const r = s.tent('corrigir', Object.assign(S.entradaInicial(itens), { event_id: ent.event_id, justificativa: 'nascimento' }));
  assert.deepEqual([r.ok, r.erro && r.erro.code, r.erro && S.codigos(r.erro)], [false, 'VALIDATION', ['NASCIMENTO_DO_PROGENITOR']]);
  assert.match(r.erro.details[0].mensagem, /mãe.*100.*10\/01\/2019/);
  // O pai definido por correção também conta, e a mãe que nasce depois do filho no mesmo substituto também.
  const s2 = base();
  const e2 = s2.reg('registrar', S.entradaInicial([touro('900'), vaca('200', { data_nascimento: '2022-01-01' })]));
  const [T, G] = e2.animais.map((a) => a.animal_id);
  s2.reg('registrar', correcao('2026-02-01', [{ animal_id: G, campo: 'pai_id', valor_novo: T }, { animal_id: G, campo: 'pai_confianca', valor_novo: 'CONFIRMADA' }]));
  const r2 = s2.tent('corrigir', Object.assign(S.entradaInicial([itemDoRebanhoInicial(s2, e2.event_id, T, '900', { data_nascimento: '2023-01-01' }), itemDoRebanhoInicial(s2, e2.event_id, G, '200')]), { event_id: e2.event_id, justificativa: 'nascimento do touro' }));
  assert.equal(r2.ok, false);
  assert.ok(S.codigos(r2.erro).length && S.codigos(r2.erro).every((c) => c === 'NASCIMENTO_DO_PROGENITOR'), JSON.stringify(r2.erro.details));
  assert.deepEqual(s.erros(), []);
  assert.deepEqual(s2.erros(), []);
});

// ---------------------------------------------------------------- achado 22 (BAIXA) ----
test('R4 achado 22: a mãe de um parto só de natimorto precisa ter nascido antes do parto (registro e correção do nascimento)', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  s.reg('registrar', parto('2026-03-01', V, [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '200' }]));
  const C = s.tabela('ANIMAIS').find((a) => a.brinco === '200').animal_id;
  const nat = s.tent('registrar', parto('2026-03-01', C, NATIMORTO));
  assert.deepEqual([nat.ok, nat.erro && nat.erro.code, nat.erro && S.codigos(nat.erro)], [false, 'VALIDATION', ['NASCIMENTO_DO_PROGENITOR']]);
  assert.match(nat.erro.details[0].mensagem, /nasceu em 01\/03\/2026, não antes do parto \(01\/03\/2026\)/);
  // Parto antigo de X só de natimorto: corrigir o nascimento de X para o dia do parto é recusado.
  const X = s.reg('registrar', S.entradaInicial([vaca('400')])).animais[0].animal_id;
  const pa = s.reg('registrar', parto('2025-06-01', X, NATIMORTO));
  const cor = s.tent('registrar', correcao('2026-06-01', [{ animal_id: X, campo: 'data_nascimento', valor_novo: '2025-06-01' }]));
  assert.deepEqual([cor.ok, cor.erro && cor.erro.code], [false, 'VALIDATION'], JSON.stringify(cor.erro));
  assert.ok(S.codigos(cor.erro).includes('NASCIMENTO_DO_PROGENITOR'), JSON.stringify(cor.erro.details));
  assert.match(cor.erro.details.find((d) => d.codigo === 'NASCIMENTO_DO_PROGENITOR').mensagem, /mãe do parto de 01\/06\/2025/);
  // O estorno que devolveria esse nascimento à mãe dá CONFLICT com o parto.
  const Y = s.reg('registrar', S.entradaInicial([vaca('500', { data_nascimento: '2025-06-01' })])).animais[0].animal_id;
  const cy = s.reg('registrar', correcao('2026-02-01', [{ animal_id: Y, campo: 'data_nascimento', valor_novo: '2022-01-01' }]));
  const py = s.reg('registrar', parto('2025-06-01', Y, NATIMORTO));
  const est = s.tent('estornar', { event_id: cy.event_id, justificativa: 'engano' });
  assert.deepEqual([est.ok, est.erro && est.erro.code], [false, 'CONFLICT'], JSON.stringify(est.erro));
  assert.ok(est.erro.details.some((d) => d.conflito.event_id === py.event_id), JSON.stringify(est.erro.details));
  assert.equal(pa.event_type, 'NASCIMENTO');
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 2 (ALTA) ----
test('R4 achado 2: corrigir o parto para informar um pai diferente do que uma correção de cadastro pôs na cria dá CONFLICT com essa correção', () => {
  const s = base();
  const [V, T1, T2] = s.reg('registrar', S.entradaInicial([vaca('100'), touro('900'), touro('901')])).animais.map((a) => a.animal_id);
  const p = s.reg('registrar', parto('2026-06-01', V, [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '500' }]));
  const cria = s.tabela('ANIMAIS').find((a) => a.mae_id === V).animal_id;
  const c1 = s.reg('registrar', correcao('2026-06-10', [{ animal_id: cria, campo: 'pai_id', valor_novo: T1 }, { animal_id: cria, campo: 'pai_confianca', valor_novo: 'CONFIRMADA' }]));
  const corrParto = (pai) => ({ tipo: 'NASCIMENTO', event_id: p.event_id, justificativa: 'faltou o pai', campos: { event_date: '2026-06-01', pasto_destino_id: PASTOS.A, pai_id: pai, pai_confianca: 'CONFIRMADA' }, animais: [{ animal_id: V }], crias: [{ animal_id: cria, situacao_nascimento: 'VIVO', sexo: 'M', brinco: '500' }] });
  const r = s.tent('corrigir', corrParto(T2));
  assert.deepEqual([r.ok, r.erro && r.erro.code, r.erro && S.codigos(r.erro)], [false, 'CONFLICT', ['PAI_DA_CRIA']]);
  assert.deepEqual([r.erro.details[0].conflito.event_id, r.erro.details[0].conflito.tipo], [c1.event_id, 'AJUSTE_INVENTARIO']);
  assert.match(r.erro.details[0].mensagem, /900 como pai da cria/);
  assert.equal(s.animal(cria).pai_id, T1);
  // Informando no parto o mesmo pai da correção, a correção passa e tudo fica coerente.
  s.reg('corrigir', corrParto(T1));
  assert.equal(s.animal(cria).pai_id, T1);
  const vigente = s.tabela('EVENTOS').find((e) => e.event_type === 'NASCIMENTO' && e.status === 'CONFIRMADO');
  assert.equal(s.tabela('REPRODUCAO').find((x) => x.event_id === vigente.event_id).touro_id, T1);
  assert.deepEqual(s.erros(), []);
  // Estornada a correção de cadastro, o parto pode passar a informar outro pai.
  const s2 = base();
  const [V2, A1, A2] = s2.reg('registrar', S.entradaInicial([vaca('100'), touro('900'), touro('901')])).animais.map((a) => a.animal_id);
  const p2 = s2.reg('registrar', parto('2026-06-01', V2, [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '500' }]));
  const cria2 = s2.tabela('ANIMAIS').find((a) => a.mae_id === V2).animal_id;
  const k1 = s2.reg('registrar', correcao('2026-06-10', [{ animal_id: cria2, campo: 'pai_id', valor_novo: A1 }, { animal_id: cria2, campo: 'pai_confianca', valor_novo: 'CONFIRMADA' }]));
  s2.reg('estornar', { event_id: k1.event_id, justificativa: 'era do parto' });
  s2.reg('corrigir', { tipo: 'NASCIMENTO', event_id: p2.event_id, justificativa: 'faltou o pai', campos: { event_date: '2026-06-01', pasto_destino_id: PASTOS.A, pai_id: A2, pai_confianca: 'CONFIRMADA' }, animais: [{ animal_id: V2 }], crias: [{ animal_id: cria2, situacao_nascimento: 'VIVO', sexo: 'M', brinco: '500' }] });
  assert.equal(s2.animal(cria2).pai_id, A2);
  assert.deepEqual(s2.erros(), []);
});

// ---------------------------------------------------------------- achado 12 (MÉDIA) ----
test('R4 achado 12: corrigir o sexo de um animal reclassificado à mão numa categoria do outro sexo dá CONFLICT com a reclassificação', () => {
  const s = base();
  const cat = (codigo) => s.tabela('CATEGORIAS').find((c) => c.codigo === codigo).category_id;
  const [V, W] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('101', { data_nascimento: '2025-06-01' })])).animais.map((a) => a.animal_id);
  const rc = s.reg('registrar', ajuste('RECLASSIFICACAO', '2026-02-01', [{ animal_id: V, categoria_manual_id: cat('VACA') }]));
  const c = s.tent('registrar', correcao('2026-03-01', [{ animal_id: V, campo: 'sexo', valor_novo: 'M' }, { animal_id: V, campo: 'castrado', valor_novo: 'N' }, { animal_id: V, campo: 'reprodutor', valor_novo: 'N' }]));
  assert.deepEqual([c.ok, c.erro && c.erro.code, c.erro && S.codigos(c.erro)], [false, 'CONFLICT', ['CATEGORIA_INCOMPATIVEL']]);
  assert.equal(c.erro.details[0].conflito.event_id, rc.event_id);
  assert.match(c.erro.details[0].mensagem, /categoria Vaca, que é só de fêmeas/);
  assert.equal(s.animal(V).sexo, 'F');
  // O estorno da correção de sexo que devolveria fêmea a um animal reclassificado como Boi dá CONFLICT.
  const cs = s.reg('registrar', correcao('2026-03-01', [{ animal_id: W, campo: 'sexo', valor_novo: 'M' }, { animal_id: W, campo: 'castrado', valor_novo: 'S' }, { animal_id: W, campo: 'reprodutor', valor_novo: 'N' }]));
  const rb = s.reg('registrar', ajuste('RECLASSIFICACAO', '2026-04-01', [{ animal_id: W, categoria_manual_id: cat('BOI') }]));
  const e = s.tent('estornar', { event_id: cs.event_id, justificativa: 'era fêmea mesmo' });
  assert.deepEqual([e.ok, e.erro && e.erro.code], [false, 'CONFLICT'], JSON.stringify(e.erro));
  assert.ok(e.erro.details.some((d) => d.codigo === 'CATEGORIA_INCOMPATIVEL' && d.conflito.event_id === rb.event_id), JSON.stringify(e.erro.details));
  assert.equal(s.animal(W).sexo, 'M');
  assert.deepEqual(s.erros(), []);
  // Voltando o animal à categoria automática, o estorno passa.
  s.reg('registrar', ajuste('RECLASSIFICACAO', '2026-05-01', [{ animal_id: W, categoria_manual_id: null }]));
  s.reg('estornar', { event_id: rb.event_id, justificativa: 'não era boi' });
  s.reg('estornar', { event_id: cs.event_id, justificativa: 'era fêmea mesmo' });
  assert.equal(s.animal(W).sexo, 'F');
  assert.deepEqual(s.erros(), []);
});

test('R4 achado 12: a integridade acusa a categoria escolhida à mão que não serve ao sexo do animal (adulteração à mão)', () => {
  const s = base();
  const cat = (codigo) => s.tabela('CATEGORIAS').find((c) => c.codigo === codigo).category_id;
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const rc = s.reg('registrar', ajuste('RECLASSIFICACAO', '2026-02-01', [{ animal_id: V, categoria_manual_id: cat('VACA') }]));
  assert.deepEqual(s.erros(), []);
  const aj = s.tabela('AJUSTES').find((a) => a.event_id === rc.event_id);
  s.editar('AJUSTES', aj.ajuste_id, 'valor_novo', cat('BOI'));
  s.editar('ANIMAIS', V, 'categoria_manual_id', cat('BOI'));
  const e = s.erros().filter((x) => /reclassificação/.test(x[1]));
  assert.equal(e.length, 1, JSON.stringify(s.erros()));
  assert.match(e[0][1], /categoria Boi, que é só de machos, mas ele é fêmea/);
});

// ---------------------------------------------------------------- achado 19 (MÉDIA) ----
test('R4 achado 19: o pasto, a propriedade e a categoria desativados depois do uso não impedem corrigir só o valor ou o texto do lançamento', () => {
  const s = base();
  const forn = s.parceiro('Leilão', ['FORNECEDOR']);
  const compraB = (preco, animal) => ({
    tipo: 'COMPRA', campos: { event_date: '2026-03-10', partner_id: forn, pasto_destino_id: PASTOS.B, modalidade: 'CABECA', preco_unitario: preco, valor_animais: preco },
    animais: [Object.assign({ brinco: '0801', sexo: 'M', castrado: false, reprodutor: false }, animal)], parcelas: [{ data_vencimento: '2026-04-10' }],
  });
  const c = s.reg('registrar', compraB(300000, { idade_meses: 14 }));
  const boi = c.animais[0].animal_id;
  s.reg('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-01', pasto_origem_id: PASTOS.B, pasto_destino_id: PASTOS.A }, animais: [{ animal_id: boi }] });
  const t1 = s.reg('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-06-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: boi }] });
  s.reg('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-07-01', pasto_origem_id: PASTOS.B, pasto_destino_id: PASTOS.A }, animais: [{ animal_id: boi }] });
  const d = s.tentar((ctx) => s.G.PastureService.salvarPasto(ctx, { idempotencyKey: 'desat', dados: { pasture_id: PASTOS.B, campos: { status: 'INATIVO' } } }));
  assert.ok(d.ok, JSON.stringify(d.erro));
  const at = s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === c.event_id).atributos_iniciais_json;
  const r = s.tent('corrigir', Object.assign(compraB(310000, { animal_id: boi, data_nascimento: at.data_nascimento, data_nascimento_confianca: at.data_nascimento_confianca }), { event_id: c.event_id, justificativa: 'preço' }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  const ct = s.tent('corrigir', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-06-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B, notes: 'pasto reformado' }, animais: [{ animal_id: boi }], event_id: t1.event_id, justificativa: 'observação' });
  assert.ok(ct.ok, JSON.stringify(ct.erro));
  // Um lançamento novo para o pasto desativado continua recusado.
  const nova = s.tent('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-08-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: boi }] });
  assert.deepEqual([nova.ok, nova.erro && S.codigos(nova.erro)], [false, ['PASTO_INATIVO']]);
  // Categoria desativada depois da reclassificação: corrigir só a justificativa passa; escolher outra desativada, não.
  const cats = s.tabela('CATEGORIAS');
  const catBoi = cats.find((x) => x.codigo === 'BOI');
  const reclass = (data, catId, just) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: data, justificativa: just || 'lote de engorda' }, animais: [{ animal_id: boi, categoria_manual_id: catId }] });
  const r1 = s.reg('registrar', reclass('2026-08-01', catBoi.category_id));
  s.reg('registrar', reclass('2026-09-01', null));
  const off = s.tentar((ctx) => s.G.Config.salvarCategoria(ctx, { idempotencyKey: 'cat-off', avisosAceitos: ['CATEGORIAS_SEM_COBERTURA'], dados: { category_id: catBoi.category_id, campos: { ativo: false } } }));
  assert.ok(off.ok, JSON.stringify(off.erro));
  const cr = s.tent('corrigir', Object.assign(reclass('2026-08-01', catBoi.category_id, 'lote de engorda (texto corrigido)'), { event_id: r1.event_id, justificativa: 'texto' }));
  assert.ok(cr.ok, JSON.stringify(cr.erro));
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 29 (BAIXA) ----
test('R4 achado 29: quando a mãe veio de uma correção de cadastro, o CONFLICT de genealogia aponta essa correção, não o lançamento que criou o filho', () => {
  const s = base();
  const eM = s.reg('registrar', S.entradaInicial([vaca('100')]));
  const eF = s.reg('registrar', S.entradaInicial([vaca('200', { data_nascimento: '2022-01-01' }), vaca('201', { data_nascimento: '2022-01-01' })]));
  const M = eM.animais[0].animal_id;
  const F = eF.animais[0].animal_id;
  const cm = s.reg('registrar', correcao('2026-02-01', [{ animal_id: F, campo: 'mae_id', valor_novo: M }, { animal_id: F, campo: 'mae_confianca', valor_novo: 'CONFIRMADA' }]));
  const est = s.tent('estornar', { event_id: eM.event_id, justificativa: 'lançada em duplicidade' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['REFERENCIA_GENEALOGICA']]);
  assert.deepEqual([est.erro.details[0].conflito.event_id, est.erro.details[0].conflito.subtipo], [cm.event_id, 'CORRECAO_CADASTRO']);
  // O mesmo no estorno de quem deixou a mãe fêmea: a correção do sexo da mãe, estornada, devolveria macho.
  const s2 = base();
  const e2 = s2.reg('registrar', S.entradaInicial([touro('100'), vaca('200', { data_nascimento: '2022-01-01' })]));
  const [M2, F2] = e2.animais.map((a) => a.animal_id);
  const cs = s2.reg('registrar', correcao('2026-02-01', [{ animal_id: M2, campo: 'sexo', valor_novo: 'F' }]));
  const cm2 = s2.reg('registrar', correcao('2026-02-02', [{ animal_id: F2, campo: 'mae_id', valor_novo: M2 }, { animal_id: F2, campo: 'mae_confianca', valor_novo: 'CONFIRMADA' }]));
  const est2 = s2.tent('estornar', { event_id: cs.event_id, justificativa: 'era macho' });
  assert.deepEqual([est2.ok, est2.erro && est2.erro.code], [false, 'CONFLICT'], JSON.stringify(est2.erro));
  assert.equal(est2.erro.details[0].conflito.event_id, cm2.event_id);
  // Sem correção, o vínculo nasceu no lançamento que criou o filho, e é ele que aparece.
  const s3 = base();
  const V3 = s3.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const p3 = s3.reg('registrar', parto('2026-03-01', V3, [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '300' }]));
  const cs3 = s3.reg('registrar', correcao('2026-03-05', [{ animal_id: V3, campo: 'data_nascimento', valor_novo: '2019-02-01' }]));
  const ent3 = s3.tabela('EVENTOS').find((e) => e.event_type === 'ENTRADA_INICIAL').event_id;
  const e3 = s3.tent('estornar', { event_id: ent3, justificativa: 'duplicada' });
  assert.equal(e3.ok, false);
  assert.ok(e3.erro.details.some((d) => d.conflito.event_id === p3.event_id), JSON.stringify(e3.erro.details));
  assert.equal(cs3.event_type, 'AJUSTE_INVENTARIO');
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 3 (ALTA) ----
const morte = (data, id) => ({ tipo: 'MORTE', campos: { event_date: data, causa: 'DOENCA' }, animais: [{ animal_id: id }] });
const descarte = (data, id) => ({ tipo: 'DESCARTE', campos: { event_date: data, destino: 'DOACAO', motivo: 'IDADE' }, animais: [{ animal_id: id }] });
function copias(s) {
  return (s.integridade().achados || []).filter((x) => x.checagem === 'COPIAS' && x.severidade === 'ERRO').map((x) => x.mensagem);
}
function reparar(s) {
  return s.tentar((ctx) => s.G.AuditService.repararIntegridade(ctx, 'teste'));
}
test('R4 achado 3: a linha de EVENTO_ANIMAIS de uma morte apagada à mão é acusada (sem reparo) e continua acusada depois do reparo', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('101')])).animais[0].animal_id;
  const m = s.reg('registrar', morte('2026-03-01', V));
  assert.deepEqual(s.erros(), []);
  s.apagarLinha('EVENTO_ANIMAIS', s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === m.event_id).event_animal_id);
  const c = copias(s);
  assert.ok(c.some((x) => /"Morte de 01\/03\/2026" está sem as linhas dos animais/.test(x)), JSON.stringify(c));
  assert.ok(c.some((x) => /a linha de BAIXAS cita A-000001 \(brinco 100\), que não tem linha no lançamento/.test(x)), JSON.stringify(c));
  // Revisão final, achado 6: o reparo não é oferecido nem aceito (refaria a situação a partir da fonte quebrada e poria a
  // vaca morta de volta no rebanho); o defeito continua acusado e a vaca continua morta.
  const rel = s.integridade();
  assert.equal(rel.reparavel, false);
  assert.equal(reparar(s).erro.code, 'CONFLICT');
  assert.equal(s.tabela('ANIMAIS').find((a) => a.animal_id === V).situacao_cadastral, 'MORTO');
  assert.ok(s.integridade().achados.some((x) => x.checagem === 'COPIAS' && /sem as linhas dos animais/.test(x.mensagem)));
});

test('R4 achado 3: efeito da linha trocado, baixa na contagem sem a linha e pre_marco_zero errado são acusados como ERRO de cópia × fonte', () => {
  // Os lançamentos primeiro; depois, as adulterações à mão.
  const s = base();
  const [V, W, X, Y] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('101'), vaca('102'), vaca('103')])).animais.map((a) => a.animal_id);
  const m = s.reg('registrar', morte('2026-03-01', V));
  const b = s.reg('registrar', ajuste('DIVERGENCIA_CONTAGEM', '2026-03-02', [{ animal_id: W }]));
  const d = s.reg('registrar', descarte('2026-03-01', X));
  const t = s.reg('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: Y }] });
  assert.deepEqual(s.erros(), []);
  // Morte com efeito -1 → 0 (vira fato).
  s.editar('EVENTO_ANIMAIS', s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === m.event_id).event_animal_id, 'efeito_inventario', 0);
  // Baixa na contagem sem a linha.
  s.apagarLinha('EVENTO_ANIMAIS', s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === b.event_id).event_animal_id);
  // Descarte e transferência de 01/03/2026 marcados como anteriores ao marco zero.
  s.editar('EVENTOS', d.event_id, 'pre_marco_zero', true);
  s.editar('EVENTOS', t.event_id, 'pre_marco_zero', true);
  const c = copias(s);
  assert.ok(c.some((x) => /Morte de 01\/03\/2026", A-000001 \(brinco 100\): a linha do animal tem efeito 0 .*no inventário, mas esse lançamento grava −1/.test(x)), JSON.stringify(c));
  assert.ok(c.some((x) => /02\/03\/2026" está sem as linhas dos animais/.test(x)), JSON.stringify(c));
  assert.ok(c.some((x) => /Descarte .* de 01\/03\/2026" está marcado como anterior ao marco zero \(01\/01\/2026\), mas a data é depois dele/.test(x)), JSON.stringify(c));
  assert.ok(c.some((x) => /Transferir de pasto de 01\/03\/2026" está marcado como anterior ao marco zero/.test(x)), JSON.stringify(c));
  // O reparo não é aceito (revisão final, achado 6) e as cópias continuam acusadas.
  assert.equal(reparar(s).erro.code, 'CONFLICT');
  const rep = s.integridade();
  assert.equal(rep.ok, false);
  assert.ok(rep.achados.filter((x) => x.checagem === 'COPIAS').length >= 4, JSON.stringify(rep.achados.map((x) => x.mensagem)));
});

test('R4 achado 3: a base de demonstração e os lançamentos de todos os tipos não acusam nada na conferência das linhas (sem falso positivo)', () => {
  const s = base();
  const forn = s.parceiro('Forn', ['FORNECEDOR']);
  const comp = s.parceiro('Comp', ['COMPRADOR']);
  const [V, T, W, Z] = s.reg('registrar', S.entradaInicial([vaca('100'), touro('900'), vaca('101'), vaca('102')])).animais.map((a) => a.animal_id);
  s.reg('registrar', parto('2025-06-01', V, NATIMORTO));
  s.reg('registrar', parto('2026-03-01', V, [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '300' }], comPai(T)));
  s.reg('registrar', compra(forn, '2026-03-05', '400'));
  s.reg('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-06', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: W }] });
  s.reg('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-03-07', [{ animal_id: W, pasto_destino_id: PASTOS.A }]));
  s.reg('registrar', ident('SUBSTITUICAO', '2026-03-08', [{ animal_id: W, codigo: '111', motivo: 'PERDA' }]));
  s.reg('registrar', { tipo: 'MARCACAO', subtipo: 'NAO_LOCALIZADO', campos: { event_date: '2026-03-09', acao: 'MARCAR' }, animais: [{ animal_id: W }] });
  s.reg('registrar', { tipo: 'VENDA', campos: { event_date: '2026-03-10', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 250000, valor_bruto: 250000 }, animais: [{ animal_id: Z }], parcelas: [{ data_vencimento: '2026-03-20' }] });
  s.reg('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-04-10', description: 'voltou' }, animais: [{ animal_id: Z, pasto_destino_id: PASTOS.A }] });
  s.reg('registrar', ajuste('DIVERGENCIA_CONTAGEM', '2026-04-11', [{ animal_id: Z }]));
  s.reg('registrar', morte('2026-04-12', W));
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achados 11, 14 e 20 (MÉDIA) ----
const reconciliacao = (s) => s.tentar((ctx) => s.G.UnitOfWork.read(ctx, s.G.ImportService.consultaReconciliacao()));
test('R4 achado 11: a vaca da fotografia com parto antigo baixada na contagem do marco zero não quebra a reconciliação nem a conclusão de outra importação', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const [V] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('101')])).animais.map((a) => a.animal_id);
  s.reg('registrar', parto('2025-06-01', V, NATIMORTO));
  s.reg('registrar', ajuste('DIVERGENCIA_CONTAGEM', '2026-01-01', [{ animal_id: V }]));
  const r = reconciliacao(s);
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.deepEqual(r.valor.dados.animais, [], 'a baixa na contagem do marco zero é a decisão do dono: sem divergência');
  const imp = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n10/02/2026;Pasto A;Pasto B;101', 't1');
  validarTudo(s, imp.import_id, MAPA_TRANSF);
  const ib = importarBloco(s, imp.import_id, 1, { modo: 'TOTAL' });
  assert.ok(ib.ok, JSON.stringify(ib.erro));
  const c = concluir(s, imp.import_id);
  assert.ok(c.ok, JSON.stringify(c.erro));
  assert.ok(c.valor.dados.reconciliacao, 'o relatório final traz a reconciliação');
  s.conferirProjecoes('concluir');
  assert.deepEqual(s.erros(), []);
});

test('R4 achados 14 e 20: em FORA_DA_FOTOGRAFIA a ação dá os caminhos que funcionam, e a outra entrada datada do marco zero resolve a divergência', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  s.reg('registrar', parto('2025-09-01', V, [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '300' }]));
  const C = s.tabela('ANIMAIS').find((a) => a.brinco === '300').animal_id;
  let r = reconciliacao(s).valor.dados;
  assert.deepEqual(r.animais.map((d) => [d.brinco, d.codigo]), [['300', 'FORA_DA_FOTOGRAFIA']]);
  const acao = r.animais[0].acao;
  assert.match(acao, /lance a entrada dele por "Outra entrada" datada do marco zero/);
  assert.match(acao, /importe a venda ou a morte antiga/);
  assert.doesNotMatch(acao, /lance a venda|falta o animal no rebanho inicial/, 'nada de caminho que o sistema recusa');
  assert.match(acao, /descarte antigo .* ainda não tem como ser registrado/);
  // Os caminhos recusados continuam recusados (por isso a ação não os oferece).
  const desc = s.tent('registrar', { tipo: 'DESCARTE', campos: { event_date: '2025-12-01', destino: 'DOACAO', motivo: 'IDADE' }, animais: [{ animal_id: C }] });
  assert.deepEqual([desc.ok, desc.erro && S.codigos(desc.erro)], [false, ['ANTES_DO_MARCO_ZERO']]);
  // A outra entrada datada do marco zero é a decisão do dono: a divergência some.
  s.reg('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-01-01', description: 'estava na fazenda' }, animais: [{ animal_id: C, pasto_destino_id: PASTOS.A }] });
  assert.equal(s.animal(C).situacao_cadastral, 'ATIVO');
  r = reconciliacao(s).valor.dados;
  assert.deepEqual(r.animais, []);
  assert.deepEqual(r.pastos, []);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 13 (MÉDIA) ----
test('R4 achado 13: depois de corrigir a primeira de duas transferências do mesmo dia, a ficha e a lista de eventos mantêm a ordem dos movimentos', () => {
  const s = base();
  const PC = 'eeeeeeee-0000-4000-8000-0000000000a3';
  s.exec((ctx) => s.G.UnitOfWork.run(ctx, { rota: 'teste.pasto', idempotencyKey: 'pasto-c', dados: {}, reads: ['PASTOS'], tratador: (tx) => { s.G.AuditService.criacao(tx, 'PASTOS', PC, { property_id: S.PROP, nome: 'Pasto C', posse: 'PROPRIO', status: 'ATIVO' }); return { resumo: {} }; } }));
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const transf = (de, para) => ({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: de, pasto_destino_id: para }, animais: [{ animal_id: V }] });
  const t1 = s.reg('registrar', transf(PASTOS.A, PASTOS.B));
  const t2 = s.reg('registrar', transf(PASTOS.B, PC));
  const k = s.reg('corrigir', Object.assign(transf(PASTOS.A, PASTOS.B), { campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B, notes: 'faltou a observação' }, event_id: t1.event_id, justificativa: 'observação' }));
  assert.equal(s.animal(V).pasto_atual_id, PC);
  const ficha = s.read(s.G.AnimalService.consultaFicha({ animal_id: V })).eventos.itens.filter((e) => e.vigente && e.event_type === 'TRANSFERENCIA').map((e) => e.event_id);
  assert.deepEqual(ficha, [k.event_id, t2.event_id], 'A→B (a correção) antes de B→C');
  const lista = s.read(s.G.EventService.consultaListar({})).itens.filter((e) => e.event_type === 'TRANSFERENCIA' && e.vigente).map((e) => e.event_id);
  assert.deepEqual(lista, [t2.event_id, k.event_id], 'mais recente primeiro: B→C, depois A→B');
  assert.deepEqual(s.erros(), []);
});
