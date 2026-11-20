'use strict';
/**
 * Revisão independente da Fase 2, rodada 2, lente MOTOR: cada achado confirmado vira um teste que falhava antes do
 * conserto. Depois de cada comando a projeção gravada é a reconstrução (Timeline.conferir) e, onde o achado envolve a
 * integridade, a verificação completa fica sem erro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

/** Sistema do setup com helpers: reg (lança), tent (não lança), ambos conferem a projeção. */
function base(opcoes) {
  const s = S.sistema(opcoes || {});
  let n = 0;
  s.tent = (acao, dados, avisos) => {
    const r = s.tentar((ctx) => s.G.EventService[acao](ctx, { idempotencyKey: 'r2-' + (++n), dados, avisosAceitos: avisos || [] }));
    s.conferirProjecoes(acao + ' ' + (dados.tipo || ''));
    return r;
  };
  s.reg = (acao, dados, avisos) => {
    const r = s.tent(acao, dados, avisos);
    if (!r.ok) throw new Error(acao + ': ' + JSON.stringify(r.erro));
    return r.valor.dados;
  };
  s.simular = (acao, dados, avisos) => s.exec((ctx) => s.G.EventService.simular(ctx, { acao, dados, avisosAceitos: avisos || [] })).dados;
  s.animal = (id) => s.tabela('ANIMAIS').find((a) => a.animal_id === id);
  s.erros = () => (s.integridade().achados || []).filter((x) => x.severidade === 'ERRO').map((x) => [x.checagem, x.mensagem]);
  s.parceiro = (nome, tipos) => s.exec((ctx) => s.G.UnitOfWork.run(ctx, s.G.Config.comandoSalvarParceiro({ idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } }))).dados.partner_id;
  return s;
}
const vaca = (brinco, extra) => S.bicho(Object.assign({ brinco, sexo: 'F', data_nascimento: '2019-01-10', data_nascimento_confianca: 'CONFIRMADA' }, extra || {}));
const correcao = (data, itens) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: data, justificativa: 'conferência do cadastro' }, animais: itens });
const descarte = (data, id) => ({ tipo: 'DESCARTE', campos: { event_date: data, destino: 'DOACAO', motivo: 'IDADE' }, animais: [{ animal_id: id }] });
const ident = (sub, data, itens) => ({ tipo: 'IDENTIFICACAO', subtipo: sub, campos: { event_date: data, tipo_identificacao: 'BRINCO' }, animais: itens });

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

// ---------------------------------------------------------------- achado 1 (ALTA) ----
test('achado 1: desfazer a importação que devolveria a um animal um brinco que hoje é de outro é recusado (CONFLICT com a troca de brinco)', () => {
  const s = base({ config: { brinco_permite_reuso: 'S', importacao_lote_linhas: '50' } });
  s.parceiro('Vizinho', ['FORNECEDOR']);
  const [X, Y] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('200', { data_nascimento: '2020-01-10' })])).animais.map((a) => a.animal_id);
  s.reg('registrar', descarte('2026-03-01', X));
  const MAPA = { colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco', 'Primeiro vencimento': 'vencimento', Código: 'codigo', Brinco: 'brinco', Sexo: 'sexo', Pasto: 'pasto' }, confiancas: {}, padroes: {} };
  const csv = 'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Primeiro vencimento;Código;Brinco;Sexo;Pasto\n'
    + 'C1;10/05/2026;Vizinho;cabeça;2.000,00;2.000,00;10/06/2026;' + s.animal(X).codigo_interno + ';500;F;Pasto A';
  const imp = criarImportacao(s, 'COMPRAS', csv, 'compras');
  validarTudo(s, imp.import_id, MAPA);
  assert.deepEqual(linhasImp(s, imp.import_id).map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['VALIDA', []]]);
  importarTudo(s, imp.import_id);
  assert.deepEqual([s.animal(X).situacao_cadastral, s.animal(X).brinco], ['ATIVO', '500']);
  const troca = s.reg('registrar', ident('SUBSTITUICAO', '2026-06-01', [{ animal_id: Y, codigo: '100', motivo: 'PERDA' }]));
  assert.equal(s.animal(Y).brinco, '100');
  // O aplicativo recusa o estorno da volta pelo mesmo motivo.
  const compra = s.tabela('EVENTOS').find((e) => e.import_id === imp.import_id);
  const est = s.tent('estornar', { event_id: compra.event_id, justificativa: 'x' });
  assert.deepEqual([est.erro.code, S.codigos(est.erro)], ['CONFLICT', ['BRINCO_DUPLICADO']]);
  const d = desfazer(s, imp.import_id);
  assert.deepEqual([d.ok, d.erro && d.erro.code, d.erro && S.codigos(d.erro)], [false, 'CONFLICT', ['DEPENDENTE']]);
  assert.equal(d.erro.details[0].conflito.event_id, troca.event_id);
  assert.equal(d.erro.details[0].conflito.tipo, 'IDENTIFICACAO');
  assert.match(d.erro.details[0].mensagem, /o brinco 100, que hoje é do animal/);
  assert.deepEqual([s.animal(X).brinco, s.animal(Y).brinco], ['500', '100']);
  assert.equal(s.tabela('IMPORTACOES').find((i) => i.import_id === imp.import_id).status, 'IMPORTADO');
  assert.deepEqual(s.erros(), []);
  // Estornada a troca do Y, o desfazer passa e X volta a DESCARTADO com o 100.
  s.reg('estornar', { event_id: troca.event_id, justificativa: 'troca lançada errado' });
  const d2 = desfazer(s, imp.import_id);
  assert.ok(d2.ok, JSON.stringify(d2.erro));
  s.conferirProjecoes('desfazer');
  assert.deepEqual([s.animal(X).situacao_cadastral, s.animal(X).brinco, s.animal(Y).brinco], ['DESCARTADO', '100', '200']);
  assert.deepEqual(s.erros(), []);
});

test('achado 1: o brinco de um animal criado pela própria importação não impede o desfazer (ele é anulado junto)', () => {
  const s = base({ config: { brinco_permite_reuso: 'S', importacao_lote_linhas: '50' } });
  s.parceiro('Vizinho', ['FORNECEDOR']);
  const X = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  s.reg('registrar', descarte('2026-03-01', X));
  const MAPA = { colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco', 'Primeiro vencimento': 'vencimento', Código: 'codigo', Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: { castrado: false, reprodutor: false } };
  const csv = 'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Primeiro vencimento;Código;Brinco;Sexo;Nascimento;Pasto\n'
    + 'C1;10/05/2026;Vizinho;cabeça;2.000,00;2.000,00;10/06/2026;' + s.animal(X).codigo_interno + ';500;F;;Pasto A\n'
    + 'C2;12/05/2026;Vizinho;cabeça;1.500,00;1.500,00;10/06/2026;;100;F;01/01/2024;Pasto A';
  const imp = criarImportacao(s, 'COMPRAS', csv, 'compras2');
  validarTudo(s, imp.import_id, MAPA);
  assert.deepEqual(linhasImp(s, imp.import_id).map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['VALIDA', []], ['VALIDA', []]]);
  importarTudo(s, imp.import_id);
  const d = desfazer(s, imp.import_id);
  assert.ok(d.ok, JSON.stringify(d.erro));
  s.conferirProjecoes('desfazer');
  assert.deepEqual([s.animal(X).situacao_cadastral, s.animal(X).brinco], ['DESCARTADO', '100']);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 2 (ALTA) ----
test('achado 2: estorno de correção de mãe que devolveria uma mãe macho é recusado (CONFLICT com a correção do sexo)', () => {
  const s = base();
  const [A, B] = s.reg('registrar', S.entradaInicial([vaca('A1'), vaca('B1')])).animais.map((a) => a.animal_id);
  const X = s.reg('registrar', S.entradaInicial([vaca('X1', { data_nascimento: '2023-05-01', mae_id: A, mae_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  const cm = s.reg('registrar', correcao('2026-02-01', [{ animal_id: X, campo: 'mae_id', valor_novo: B }]));
  const sexo = s.reg('registrar', correcao('2026-03-01', [{ animal_id: A, campo: 'sexo', valor_novo: 'M' }, { animal_id: A, campo: 'castrado', valor_novo: 'N' }, { animal_id: A, campo: 'reprodutor', valor_novo: 'N' }]));
  const est = s.tent('estornar', { event_id: cm.event_id, justificativa: 'x' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['REFERENCIA_GENEALOGICA']]);
  assert.equal(est.erro.details[0].conflito.event_id, sexo.event_id);
  assert.match(est.erro.details[0].mensagem, /voltaria a mãe do animal para A1, que é macho/);
  // A simulação mostra o mesmo bloqueio.
  assert.throws(() => s.simular('estornar', { event_id: cm.event_id, justificativa: 'x' }), (e) => e.code === 'CONFLICT');
  // Corrigir a correção mantendo a mãe B passa; corrigir para voltar à A, não (o substituto confere a genealogia).
  const r = s.tent('corrigir', Object.assign(correcao('2026-02-01', [{ animal_id: X, campo: 'mae_id', valor_novo: B }]), { event_id: cm.event_id, justificativa: 'texto' }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.equal(s.animal(X).mae_id, B);
  assert.deepEqual(s.erros(), []);
});

test('achado 2: estorno de correção de mãe que fecharia um ciclo genealógico é recusado (CONFLICT com a correção que fecha o ciclo)', () => {
  const s = base();
  const [M1, M2] = s.reg('registrar', S.entradaInicial([vaca('M1', { data_nascimento: null, data_nascimento_confianca: null }), vaca('M2')])).animais.map((a) => a.animal_id);
  const F1 = s.reg('registrar', S.entradaInicial([vaca('F1', { data_nascimento: null, data_nascimento_confianca: null, mae_id: M1, mae_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  assert.equal(s.animal(F1).mae_id, M1);
  const c1 = s.reg('registrar', correcao('2026-02-01', [{ animal_id: F1, campo: 'mae_id', valor_novo: M2 }]));
  const c2 = s.reg('registrar', correcao('2026-03-01', [{ animal_id: M1, campo: 'mae_id', valor_novo: F1 }, { animal_id: M1, campo: 'mae_confianca', valor_novo: 'ESTIMADA' }]));
  const est = s.tent('estornar', { event_id: c1.event_id, justificativa: 'x' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['REFERENCIA_GENEALOGICA']]);
  assert.equal(est.erro.details[0].conflito.event_id, c2.event_id);
  assert.match(est.erro.details[0].mensagem, /ciclo/);
  assert.deepEqual([s.animal(F1).mae_id, s.animal(M1).mae_id], [M2, F1]);
  // Estornada a correção da mãe de M1, o estorno da primeira passa.
  s.reg('estornar', { event_id: c2.event_id, justificativa: 'era engano' });
  s.reg('estornar', { event_id: c1.event_id, justificativa: 'era engano' });
  assert.deepEqual([s.animal(F1).mae_id, s.animal(M1).mae_id], [M1, null]);
  assert.deepEqual(s.erros(), []);
});

test('achado 2: a integridade acusa genealogia inválida nas projeções (mãe macho, pai fêmea, ciclo, progenitor mais novo)', () => {
  const s = base();
  const [A, B] = s.reg('registrar', S.entradaInicial([vaca('A1'), vaca('B1', { data_nascimento: '2018-01-01' })])).animais.map((a) => a.animal_id);
  const X = s.reg('registrar', S.entradaInicial([vaca('X1', { data_nascimento: '2023-05-01', mae_id: A, mae_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  assert.deepEqual(s.erros(), []);
  s.editar('ANIMAIS', A, 'sexo', 'M');
  const chk = () => (s.integridade().achados || []).filter((x) => x.checagem === 'GENEALOGIA');
  let g = chk();
  assert.ok(g.length >= 1 && g.every((x) => x.severidade === 'ERRO'), JSON.stringify(g));
  assert.ok(g.some((x) => x.entity_id === X || /X1/.test(x.mensagem)), JSON.stringify(g));
  s.editar('ANIMAIS', A, 'sexo', 'F');
  s.editar('ANIMAIS', B, 'mae_id', X);
  g = chk();
  assert.ok(g.some((x) => /ciclo|nasceu/.test(x.mensagem)), JSON.stringify(g));
});

// ---------------------------------------------------------------- achado 6 (ordem do dia na correção) ----
test('achado 6: corrigir só um valor não muda a situação reprodutiva do dia (o substituto fica no lugar do rebanho inicial)', () => {
  const s = base();
  const [V1, V2] = s.reg('registrar', S.entradaInicial([vaca('701', { situacao_reprodutiva: 'PRENHA', data_prevista_parto: '2026-01-20' }), vaca('702')])).animais.map((a) => a.animal_id);
  const entrada = s.tabela('EVENTOS').find((e) => e.event_type === 'ENTRADA_INICIAL');
  assert.equal(s.animal(V1).situacao_reprodutiva, 'PRENHA');
  s.reg('registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-01-01', pasto_destino_id: PASTOS.A }, animais: [{ animal_id: V1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '9001' }] }, ['INTERVALO_PARTO_CURTO', 'IDADE_REPRODUTIVA']);
  assert.equal(s.animal(V1).situacao_reprodutiva, 'VAZIA');
  const r = s.tent('corrigir', Object.assign(S.entradaInicial([
    vaca('701', { animal_id: V1, situacao_reprodutiva: 'PRENHA', data_prevista_parto: '2026-01-20' }),
    vaca('702', { animal_id: V2, nome: 'Mimosa' }),
  ]), { event_id: entrada.event_id, justificativa: 'nome da vaca' }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.deepEqual([s.animal(V1).situacao_reprodutiva, s.animal(V2).nome], ['VAZIA', 'Mimosa']);
  // A ficha (histórico reprodutivo) segue na mesma ordem: o parto é o último fato do dia.
  assert.deepEqual(s.erros(), []);
});

test('achado 6: corrigir só o preço da compra não troca o peso atual pelo da compra quando a venda é do mesmo dia', () => {
  const s = base();
  const forn = s.parceiro('Vizinho', ['FORNECEDOR', 'COMPRADOR']);
  const compra = (preco, animais) => ({ tipo: 'COMPRA', campos: { event_date: '2026-05-10', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: preco, valor_animais: preco }, animais, parcelas: [{ data_vencimento: '2026-06-10' }] });
  const c = s.reg('registrar', compra(200000, [{ brinco: 'G1', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 14, peso: 300, metodo_pesagem: 'BALANCA' }]));
  const id = c.animais[0].animal_id;
  s.reg('registrar', { tipo: 'VENDA', campos: { event_date: '2026-05-10', partner_id: forn, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 230000, valor_bruto: 230000 }, animais: [{ animal_id: id, peso: 320, metodo_pesagem: 'BALANCA' }], parcelas: [{ data_vencimento: '2026-06-10' }] }, ['POSSIVEL_DUPLICIDADE']);
  assert.equal(s.animal(id).peso_atual, 320);
  const leitor = () => s.read({ reads: s.G.Timeline.LEITURAS.concat(['CATEGORIAS', 'LISTAS', 'CONFIGURACOES']), acessoCru: true, tratador: (tx) => { const L = s.G.AnimalService.leitor(tx); return s.G.AnimalService.pesoVigente(L, s.animal(id), '2026-05-10', null); } });
  assert.equal(leitor().kg, 320);
  const r = s.tent('corrigir', Object.assign(compra(210000, [{ animal_id: id, brinco: 'G1', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 14, peso: 300, metodo_pesagem: 'BALANCA' }]), { event_id: c.event_id, justificativa: 'preço' }), ['POSSIVEL_DUPLICIDADE']);
  assert.ok(r.ok, JSON.stringify(r.erro));
  assert.equal(s.animal(id).peso_atual, 320);
  assert.equal(leitor().kg, 320);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 7 (origem de saída posterior) ----
test('achado 7: transferência retroativa antes de uma morte: CONFLICT com a morte (03b: a origem da saída é imutável), com o caminho que funciona — estornar, lançar e registrar de novo', () => {
  const s = base();
  const id = s.reg('registrar', S.entradaInicial([vaca('300')])).animais[0].animal_id;
  const morte = s.reg('registrar', { tipo: 'MORTE', campos: { event_date: '2026-05-10', causa: 'DOENCA' }, animais: [{ animal_id: id }] });
  const transf = { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: id }] };
  const r = s.tent('registrar', transf);
  assert.deepEqual([r.ok, r.erro.code, S.codigos(r.erro), r.erro.details[0].conflito.event_id], [false, 'CONFLICT', ['ORIGEM_DIVERGENTE'], morte.event_id]);
  assert.match(r.erro.details[0].mensagem, /Corrigir esse registro não muda a origem dele: estorne-o, lance este e depois registre-o de novo/);
  assert.doesNotMatch(r.erro.details[0].mensagem, /Estorne ou corrija/);
  // Corrigir a morte antes, de fato, não resolve (a origem continua a da linha do tempo de hoje).
  const c = s.reg('corrigir', { tipo: 'MORTE', event_id: morte.event_id, justificativa: 'conferência', campos: { event_date: '2026-05-10', causa: 'DOENCA' }, animais: [{ animal_id: id }] });
  assert.equal(s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === c.event_id).pasto_origem_id, PASTOS.A);
  assert.equal(s.tent('registrar', transf).erro.code, 'CONFLICT');
  // O caminho indicado funciona: estorna, lança a transferência e registra a morte de novo (agora saindo do Pasto B).
  s.reg('estornar', { event_id: c.event_id, justificativa: 'relançar depois da transferência' });
  s.reg('registrar', transf);
  const m2 = s.reg('registrar', { tipo: 'MORTE', campos: { event_date: '2026-05-10', causa: 'DOENCA' }, animais: [{ animal_id: id }] }, ['POSSIVEL_DUPLICIDADE']);
  assert.equal(s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === m2.event_id).pasto_origem_id, PASTOS.B);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 8 (correção de cria nascida) ----
test('achado 8: mãe, nascimento, origem e pai do parto de uma cria nascida na fazenda só se corrigem pelo parto; a integridade (PARTOS) confere o cadastro da cria', () => {
  const s = base();
  const [M1, M2] = s.reg('registrar', S.entradaInicial([vaca('M1'), vaca('M2')])).animais.map((a) => a.animal_id);
  const touro = s.reg('registrar', S.entradaInicial([S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2018-01-01', data_nascimento_confianca: 'CONFIRMADA' })])).animais[0].animal_id;
  const p = s.reg('registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-04-10', pasto_destino_id: PASTOS.A, pai_id: touro, pai_confianca: 'CONFIRMADA' }, animais: [{ animal_id: M1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '900' }] }, ['IDADE_REPRODUTIVA']);
  const cria = s.tabela('ANIMAIS').find((a) => a.brinco === '900').animal_id;
  [['mae_id', M2], ['data_nascimento', '2026-03-01'], ['origem', 'COMPRADO'], ['pai_id', ''], ['data_nascimento_confianca', 'ESTIMADA']].forEach(([campo, valor]) => {
    const r = s.tent('registrar', correcao('2026-05-01', [{ animal_id: cria, campo, valor_novo: valor }]));
    assert.deepEqual([r.ok, r.erro && r.erro.code, r.erro && S.codigos(r.erro)], [false, 'VALIDATION', ['NAO_SE_APLICA']], campo);
    assert.match(r.erro.details[0].mensagem, /Corrija o parto \(evento de nascimento\) em vez da cria/, campo);
  });
  // O que não é do parto se corrige na cria (o nome é campo de cadastro; o sexo da cria se corrige aqui).
  s.reg('registrar', correcao('2026-05-01', [{ animal_id: cria, campo: 'sexo', valor_novo: 'M' }, { animal_id: cria, campo: 'castrado', valor_novo: 'N' }, { animal_id: cria, campo: 'reprodutor', valor_novo: 'N' }]));
  // A correção do parto muda a mãe da cria junto com a reprodução e a cria ao pé.
  s.reg('corrigir', { tipo: 'NASCIMENTO', event_id: p.event_id, justificativa: 'vaca errada', campos: { event_date: '2026-04-10', pasto_destino_id: PASTOS.A, pai_id: touro, pai_confianca: 'CONFIRMADA' }, animais: [{ animal_id: M2 }], crias: [{ animal_id: cria, situacao_nascimento: 'VIVO', sexo: 'M', brinco: '900' }] }, ['IDADE_REPRODUTIVA']);
  assert.deepEqual([s.animal(cria).mae_id, s.animal(M2).cria_ao_pe, s.animal(M1).cria_ao_pe], [M2, true, false]);
  assert.deepEqual(s.erros(), []);
});

test('achado 8: correção de mãe da cria gravada antes do conserto (ou AJUSTES mexido à mão) é acusada pela checagem PARTOS', () => {
  const s = base();
  const [M1, M2] = s.reg('registrar', S.entradaInicial([vaca('M1'), vaca('M2')])).animais.map((a) => a.animal_id);
  s.reg('registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-04-10', pasto_destino_id: PASTOS.A }, animais: [{ animal_id: M1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '900' }] }, ['IDADE_REPRODUTIVA']);
  const cria = s.tabela('ANIMAIS').find((a) => a.brinco === '900').animal_id;
  const c = s.reg('registrar', correcao('2026-05-01', [{ animal_id: cria, campo: 'partos_previos', valor_novo: '1' }]));
  assert.deepEqual(s.erros(), []);
  const aj = s.tabela('AJUSTES').find((x) => x.event_id === c.event_id);
  s.editar('AJUSTES', aj.ajuste_id, 'campo', 'mae_id');
  s.editar('AJUSTES', aj.ajuste_id, 'valor_novo', M2);
  const partos = s.integridade().achados.filter((x) => x.checagem === 'PARTOS');
  assert.ok(partos.some((x) => x.tabela === 'ANIMAIS' && x.id === cria && /com outra mãe no cadastro \(o parto é a fonte desses dados\)/.test(x.mensagem)), JSON.stringify(partos));
});

// ---------------------------------------------------------------- achado 10 (TRANSFERENCIAS duplicada) ----
test('achado 10: importação de TRANSFERENCIAS: a volta no mesmo dia (B → A) é outro evento, com o aviso de possível duplicidade; a mesma origem e o mesmo destino ficam DUPLICADA', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const id = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  s.reg('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: id }] });
  const MAPA = { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  const rep = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n01/03/2026;Pasto A;Pasto B;100', 't-rep');
  validarTudo(s, rep.import_id, MAPA);
  assert.deepEqual(linhasImp(s, rep.import_id).map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['DUPLICADA', ['EVENTO_JA_REGISTRADO']]]);
  const volta = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n01/03/2026;Pasto B;Pasto A;100', 't-volta');
  validarTudo(s, volta.import_id, MAPA);
  assert.deepEqual(linhasImp(s, volta.import_id).map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['VALIDA', []]]);
  // Na importação, o aviso do motor pede confirmação, como no formulário.
  const semAceite = importarBloco(s, volta.import_id, 1, { modo: 'TOTAL' });
  assert.deepEqual([semAceite.ok, semAceite.erro.code, S.codigos(semAceite.erro)], [false, 'NEEDS_CONFIRMATION', ['POSSIVEL_DUPLICIDADE']]);
  const ok = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dados: { import_id: volta.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(ok.ok, JSON.stringify(ok.erro));
  assert.ok(concluir(s, volta.import_id).ok);
  s.conferirProjecoes('concluir');
  assert.equal(s.animal(id).pasto_atual_id, PASTOS.A);
  assert.deepEqual(s.erros(), []);
});

// ---------------------------------------------------------------- achado 11 (cópia do tipo do detalhe) ----
test('achado 11: a integridade confere o tipo da linha de detalhe com o tipo e o subtipo do evento (BAIXAS, AJUSTES, REPRODUCAO)', () => {
  const s = base();
  const [V, X] = s.reg('registrar', S.entradaInicial([vaca('300', { situacao_reprodutiva: 'PRENHA' }), vaca('301')])).animais.map((a) => a.animal_id);
  const morte = s.reg('registrar', { tipo: 'MORTE', campos: { event_date: '2026-05-10', causa: 'DOENCA' }, animais: [{ animal_id: X }] });
  const rc = s.reg('registrar', correcao('2026-05-11', [{ animal_id: V, campo: 'partos_previos', valor_novo: '2' }]));
  assert.deepEqual(s.erros(), []);
  const copias = () => s.integridade().achados.filter((a) => a.checagem === 'COPIAS');
  const baixa = s.tabela('BAIXAS').find((b) => b.event_id === morte.event_id);
  s.editar('BAIXAS', baixa.baixa_id, 'tipo', 'DESCARTE');
  let c = copias();
  assert.ok(c.some((a) => a.tabela === 'BAIXAS' && a.id === baixa.baixa_id && a.severidade === 'ERRO' && /o tipo DESCARTE não corresponde a "Morte.* \(esperado MORTE\)/.test(a.mensagem)), JSON.stringify(c));
  s.editar('BAIXAS', baixa.baixa_id, 'tipo', 'MORTE');
  const aj = s.tabela('AJUSTES').find((a) => a.event_id === rc.event_id);
  s.editar('AJUSTES', aj.ajuste_id, 'tipo_ajuste', 'RECLASSIFICACAO');
  c = copias();
  assert.ok(c.some((a) => a.tabela === 'AJUSTES' && a.id === aj.ajuste_id && /esperado CORRECAO_CADASTRO/.test(a.mensagem)), JSON.stringify(c));
  s.editar('AJUSTES', aj.ajuste_id, 'tipo_ajuste', 'CORRECAO_CADASTRO');
  const rep = s.tabela('REPRODUCAO').find((r) => r.animal_id === V);
  s.editar('REPRODUCAO', rep.reproduction_id, 'tipo_evento', 'ABORTO');
  c = copias();
  assert.ok(c.some((a) => a.tabela === 'REPRODUCAO' && /esperado DIAGNOSTICO_GESTACAO/.test(a.mensagem)), JSON.stringify(c));
  s.editar('REPRODUCAO', rep.reproduction_id, 'tipo_evento', 'DIAGNOSTICO_GESTACAO');
  assert.deepEqual(copias(), []);
});

// ---------------------------------------------------------------- achados 12 e 19 (aviso de duplicidade) ----
test('achados 12 e 19: o aviso de possível duplicidade usa o nome do lançamento e leva conflito com o tipo, o subtipo e o nome', () => {
  const s = base();
  const [X1, X2] = s.reg('registrar', S.entradaInicial([vaca('300'), vaca('301')])).animais.map((a) => a.animal_id);
  const transf = (destino) => ({ tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-01', pasto_origem_id: destino === PASTOS.B ? PASTOS.A : PASTOS.B, pasto_destino_id: destino }, animais: [{ animal_id: X1 }] });
  const t1 = s.reg('registrar', transf(PASTOS.B));
  const r = s.tent('registrar', transf(PASTOS.A));
  assert.deepEqual([r.erro.code, S.codigos(r.erro)], ['NEEDS_CONFIRMATION', ['POSSIVEL_DUPLICIDADE']]);
  assert.equal(r.erro.details[0].mensagem, 'Já existe a transferência de 01/04/2026 com este animal. Gravar mesmo assim?');
  assert.deepEqual(r.erro.details[0].conflito, { event_id: t1.event_id, tipo: 'TRANSFERENCIA', subtipo: null, data: '2026-04-01', nome: 'a transferência' });
  // Tipo com subtipo: a troca de brinco repetida.
  const troca = (codigo) => ident('SUBSTITUICAO', '2026-04-02', [{ animal_id: X2, codigo, motivo: 'PERDA' }]);
  const tr = s.reg('registrar', troca('401'));
  const r2 = s.tent('registrar', troca('402'));
  assert.equal(r2.erro.details[0].mensagem, 'Já existe a troca de brinco de 02/04/2026 com este animal. Gravar mesmo assim?');
  assert.deepEqual(r2.erro.details[0].conflito, { event_id: tr.event_id, tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', data: '2026-04-02', nome: 'a troca de brinco' });
  // Marcação de não localizado, desmarcação e marcação de novo no mesmo dia: o aviso compara a mesma ação.
  const marca = (acao) => ({ tipo: 'MARCACAO', subtipo: 'NAO_LOCALIZADO', campos: { event_date: '2026-05-10', acao }, animais: [{ animal_id: X1 }] });
  const m1 = s.reg('registrar', marca('MARCAR'));
  s.reg('registrar', marca('DESMARCAR'));
  const r3 = s.tent('registrar', marca('MARCAR'));
  assert.equal(r3.erro.details[0].mensagem, 'Já existe a marcação de não localizado de 10/05/2026 com este animal. Gravar mesmo assim?');
  assert.deepEqual([r3.erro.details[0].conflito.event_id, r3.erro.details[0].conflito.tipo, r3.erro.details[0].conflito.subtipo], [m1.event_id, 'MARCACAO', 'NAO_LOCALIZADO']);
});
