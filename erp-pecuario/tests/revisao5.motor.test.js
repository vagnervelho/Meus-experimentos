'use strict';
/**
 * Revisão final da Fase 2 (rodada 5), lentes MOTOR e CORREÇÕES ANTERIORES: cada achado confirmado vira um teste que
 * falhava antes do conserto, e o conserto vale para todos os caminhos (registro, correção, estorno, importação, desfazer,
 * correção de cadastro), apoiado na trava única de integridade. Depois de cada comando a projeção gravada é a
 * reconstrução (Timeline.conferir) e, onde o achado envolve a integridade, a verificação completa fica sem erro (ou
 * acusa a adulteração feita à mão).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const AV = ['INTERVALO_PARTO_CURTO', 'IDADE_REPRODUTIVA', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'BRINCO_PARECIDO', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO'];

function base(opcoes) {
  const s = S.sistema(opcoes || {});
  let n = 0;
  s.tent = (acao, dados, avisos) => {
    const r = s.tentar((ctx) => s.G.EventService[acao](ctx, { idempotencyKey: 'r5-' + (++n), dados, avisosAceitos: avisos || AV }));
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
const bezerro = (brinco, extra) => S.bicho(Object.assign({ brinco, sexo: 'M', castrado: false, reprodutor: false, data_nascimento: '2025-11-01', data_nascimento_confianca: 'CONFIRMADA' }, extra || {}));
const ident = (sub, data, itens) => ({ tipo: 'IDENTIFICACAO', subtipo: sub, campos: { event_date: data, tipo_identificacao: 'BRINCO' }, animais: itens });
const ajuste = (sub, data, itens) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: sub, campos: { event_date: data, justificativa: 'conferência' }, animais: itens });
const correcao = (data, itens) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: data, justificativa: 'conferência do cadastro' }, animais: itens });
const parto = (data, mae, crias, campos) => ({ tipo: 'NASCIMENTO', campos: Object.assign({ event_date: data, pasto_destino_id: PASTOS.A }, campos || {}), animais: [{ animal_id: mae }], crias });
function compra(forn, data, brinco, extra) {
  return { tipo: 'COMPRA', campos: { event_date: data, partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 200000, valor_animais: 200000 }, animais: [Object.assign({ brinco, sexo: 'F', idade_meses: 80 }, extra || {})], parcelas: [{ data_vencimento: data }] };
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
const linhasImp = (s, id) => s.read(s.G.ImportService.consultaLinhas({ import_id: id, por_pagina: 500 })).itens;
const importarBloco = (s, id, b, extra, avisos) => s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: avisos || [], dados: Object.assign({ import_id: id, bloco: b }, extra || {}) }));
const concluir = (s, id) => s.tentar((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } }));
const desfazer = (s, id) => s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { dados: { import_id: id, justificativa: 'engano' } }));
const reconciliacao = (s) => s.read(s.G.ImportService.consultaReconciliacao());
const MAPA_NASC = { colunas: { 'Data do parto': 'data', 'Brinco da mãe': 'mae', Nasceu: 'situacao', 'Sexo da cria': 'sexo', 'Brinco da cria': 'brinco' }, confiancas: {}, padroes: {} };

// ---------------------------------------------------------------- achado 3 (ALTA) ----
test('R5 achado 3: o parto antigo de um bezerro que já está na fotografia (com a mãe informada) é recusado, pela importação e pelo formulário, com a explicação', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const [V, C] = s.reg('registrar', S.entradaInicial([vaca('10')])).animais.map((a) => a.animal_id);
  const bez = s.reg('registrar', S.entradaInicial([bezerro('50', { mae_id: V, mae_confianca: 'CONFIRMADA' })], { event_date: '2026-01-01' })).animais[0].animal_id;
  assert.equal(C, undefined);
  // Importação, com e sem o brinco da cria.
  for (const brinco of ['50', '']) {
    const imp = criarImportacao(s, 'NASCIMENTOS', 'Data do parto;Brinco da mãe;Nasceu;Sexo da cria;Brinco da cria\n01/11/2025;10;vivo;M;' + brinco, 'nasc-' + (brinco || 'sem'));
    validarTudo(s, imp.import_id, MAPA_NASC);
    const ls = linhasImp(s, imp.import_id);
    assert.deepEqual(ls.map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['ERRO', ['CRIA_JA_NO_CADASTRO']]], JSON.stringify(ls));
    assert.match(ls[0].erros[0].mensagem, /a mãe já tem no cadastro um filho nascido em 01\/11\/2025 que não veio de parto registrado: A-000002 \(brinco 50\)\. A cria deste parto seria o mesmo animal duas vezes/);
    assert.ok(desfazer(s, imp.import_id).ok);
  }
  // Formulário (o parto antigo também entra pela tela).
  const f = s.tent('registrar', parto('2025-11-01', V, [{ situacao_nascimento: 'VIVO', sexo: 'M' }]));
  assert.deepEqual([f.ok, f.erro && f.erro.code, f.erro && S.codigos(f.erro)], [false, 'VALIDATION', ['CRIA_JA_NO_CADASTRO']]);
  // Só natimorto não cria animal: o parto passa (o registro reprodutivo da vaca).
  s.reg('registrar', parto('2025-11-01', V, [{ situacao_nascimento: 'NATIMORTO' }]));
  assert.equal(s.tabela('ANIMAIS').filter((a) => a.mae_id === V).length, 1);
  assert.equal(s.animal(bez).situacao_cadastral, 'ATIVO');
  assert.deepEqual(s.erros(), []);
});

test('R5 achado 3: sem a mãe informada na fotografia, o parto antigo pede confirmação; a reconciliação aponta o animal da fotografia e não manda lançar "Outra entrada"', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const [V, B] = s.reg('registrar', S.entradaInicial([vaca('10'), bezerro('50')])).animais.map((a) => a.animal_id);
  const imp = criarImportacao(s, 'NASCIMENTOS', 'Data do parto;Brinco da mãe;Nasceu;Sexo da cria;Brinco da cria\n01/11/2025;10;vivo;M;', 'nasc');
  validarTudo(s, imp.import_id, MAPA_NASC);
  const b1 = importarBloco(s, imp.import_id, 1, { modo: 'TOTAL' });
  assert.deepEqual([b1.ok, b1.erro && b1.erro.code, b1.erro && S.codigos(b1.erro)], [false, 'NEEDS_CONFIRMATION', ['POSSIVEL_DUPLICIDADE']]);
  assert.match(b1.erro.details[0].mensagem, /A-000002 \(brinco 50\) já está no cadastro, nascido em 01\/11\/2025 e sem a mãe informada\. Se ele for a cria deste parto, não lance o parto/);
  // O dono confirma (são dois animais? não: o caso do achado). A reconciliação aponta o bezerro da fotografia.
  assert.ok(importarBloco(s, imp.import_id, 1, { modo: 'TOTAL' }, ['POSSIVEL_DUPLICIDADE']).ok);
  assert.ok(concluir(s, imp.import_id).ok);
  const copia = s.tabela('ANIMAIS').find((a) => a.mae_id === V && a.situacao_cadastral === 'HISTORICO');
  const rec = reconciliacao(s);
  const d = rec.animais.find((x) => x.animal_id === copia.animal_id);
  assert.equal(d.codigo, 'FORA_DA_FOTOGRAFIA');
  assert.deepEqual(d.mesmo_animal, { animal_id: B, codigo_interno: 'A-000002', brinco: '50' });
  assert.match(d.acao, /parece ser A-000002 \(brinco 50\), da fotografia.*Não lance "Outra entrada" para ele.*estorne o parto antigo ou desfaça a importação dele/);
  // O caminho que a ação dá funciona: desfeita a importação, a cópia deixa de valer e a reconciliação fica limpa.
  assert.ok(desfazer(s, imp.import_id).ok);
  assert.equal(reconciliacao(s).resumo.divergencias, 0);
  assert.deepEqual(s.erros(), []);
});

test('R5 achado 3: pelos outros caminhos a trava recusa o bezerro em dobro (a fotografia depois do parto antigo, a correção de cadastro que dá a mesma mãe) e a integridade acusa a adulteração', () => {
  // Parto antigo primeiro: a fotografia que cadastra de novo o mesmo bezerro, com a mãe, é recusada pela trava.
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const V = s.reg('registrar', S.entradaInicial([vaca('10')])).animais[0].animal_id;
  const p = s.reg('registrar', parto('2025-11-01', V, [{ situacao_nascimento: 'VIVO', sexo: 'M' }]));
  const foto = s.tent('registrar', S.entradaInicial([bezerro('50', { mae_id: V, mae_confianca: 'CONFIRMADA' })]));
  assert.deepEqual([foto.ok, foto.erro && foto.erro.code, foto.erro && S.codigos(foto.erro)], [false, 'VALIDATION', ['INTEGRIDADE_GENEALOGIA']], JSON.stringify(foto.erro));
  assert.ok(p.event_id);
  assert.match(foto.erro.details[0].mensagem, /ficaria duas vezes no rebanho.*lance "Outra entrada" dela datada do marco zero/);
  // O caminho que funciona: a outra entrada da cria antiga datada do marco zero.
  const cria = s.tabela('ANIMAIS').find((a) => a.mae_id === V).animal_id;
  s.reg('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-01-01', description: 'estava na fazenda no marco zero' }, animais: [{ animal_id: cria, pasto_destino_id: PASTOS.A }] });
  assert.equal(reconciliacao(s).resumo.divergencias, 0);
  assert.deepEqual(s.erros(), []);
  // A fotografia sem a mãe e o parto antigo aceito com confirmação: a correção de cadastro que dá a mãe ao bezerro da
  // fotografia é recusada (seria a mesma cria duas vezes).
  const s2 = base();
  const [V2, B2] = s2.reg('registrar', S.entradaInicial([vaca('10'), bezerro('50')])).animais.map((a) => a.animal_id);
  s2.reg('registrar', parto('2025-11-01', V2, [{ situacao_nascimento: 'VIVO', sexo: 'M' }]));
  const cor = s2.tent('registrar', correcao('2026-02-01', [{ animal_id: B2, campo: 'mae_id', valor_novo: V2 }, { animal_id: B2, campo: 'mae_confianca', valor_novo: 'CONFIRMADA' }]));
  assert.deepEqual([cor.ok, cor.erro && S.codigos(cor.erro)], [false, ['INTEGRIDADE_GENEALOGIA']]);
  // Adulteração à mão: a mãe posta no bezerro da fotografia direto na planilha é acusada.
  s2.editar('ANIMAIS', B2, 'mae_id', V2);
  assert.ok(s2.erros().some(([c, m]) => c === 'GENEALOGIA' && /é o mesmo bezerro cadastrado duas vezes/.test(m)), JSON.stringify(s2.erros()));
});

// ---------------------------------------------------------------- achado 4 (ALTA) ----
test('R5 achado 4: a importação de ANIMAIS acha a mãe pelo brinco que ela usava no marco zero, não pelo de hoje (reuso ligado e desligado)', () => {
  const MAPA = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', 'Mãe': 'mae', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA', mae: 'CONFIRMADA' }, padroes: { castrado: false, reprodutor: false } };
  for (const reuso of ['S', 'N']) {
    const s = base({ config: { brinco_permite_reuso: reuso, importacao_lote_linhas: '50' } });
    const FORN = s.parceiro('Forn', ['FORNECEDOR']);
    const M = s.reg('registrar', S.entradaInicial([vaca('50')])).animais[0].animal_id;
    s.reg('registrar', ident('SUBSTITUICAO', '2026-02-01', [{ animal_id: M, codigo: '60', motivo: 'PERDA' }]));
    let N = null;
    if (reuso === 'S') N = s.reg('registrar', compra(FORN, '2026-03-01', '50')).animais[0].animal_id;
    const imp = criarImportacao(s, 'ANIMAIS', 'Brinco;Sexo;Nasc.;Mãe;Pasto\n70;F;01/10/2025;50;Pasto A', 'animais-' + reuso);
    validarTudo(s, imp.import_id, MAPA);
    assert.deepEqual(linhasImp(s, imp.import_id).map((l) => [l.status, l.erros.map((e) => e.mensagem)]), [['VALIDA', []]], 'reuso ' + reuso);
    assert.ok(importarBloco(s, imp.import_id, 1, { modo: 'TOTAL' }).ok);
    assert.ok(concluir(s, imp.import_id).ok);
    s.conferirProjecoes('fim');
    const b70 = s.tabela('ANIMAIS').find((a) => a.brinco === '70');
    assert.equal(b70.mae_id, M, 'a mãe é a vaca que tinha o brinco 50 no marco zero' + (N ? ', não a comprada depois' : ''));
    assert.deepEqual(s.erros(), []);
  }
  // O número que ninguém usou continua com a mensagem de não encontrado.
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const imp = criarImportacao(s, 'ANIMAIS', 'Brinco;Sexo;Nasc.;Mãe;Pasto\n71;F;01/10/2025;80;Pasto A', 'animais-80');
  validarTudo(s, imp.import_id, MAPA);
  const l = linhasImp(s, imp.import_id)[0];
  assert.deepEqual([l.status, l.erros.map((e) => e.codigo)], ['ERRO', ['MAE_NAO_ENCONTRADA']]);
  assert.match(l.erros[0].mensagem, /a mãe de brinco 80 não está no arquivo nem no rebanho/);
});

// ---------------------------------------------------------------- achado 6 (MÉDIA) ----
const morte = (data, id) => ({ tipo: 'MORTE', campos: { event_date: data, causa: 'DOENCA' }, animais: [{ animal_id: id }] });
test('R5 achado 6: com a linha da morte apagada à mão, o reparo não é oferecido e é recusado: a vaca continua MORTA e não recebe lançamento novo', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('101')])).animais[0].animal_id;
  const m = s.reg('registrar', morte('2026-03-01', V));
  s.apagarLinha('EVENTO_ANIMAIS', s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === m.event_id).event_animal_id);
  const r = s.integridade();
  assert.equal(r.ok, false);
  assert.equal(r.reparavel, false, 'o botão "Reparar" não aparece');
  assert.match(r.reparo_impedido, /Não dá para reparar: 2 achados mostram linhas apagadas ou mexidas à mão/);
  const rep = s.tentar((ctx) => s.G.AuditService.repararIntegridade(ctx, 'botão'));
  assert.deepEqual([rep.ok, rep.erro && rep.erro.code], [false, 'CONFLICT']);
  assert.equal(s.animal(V).situacao_cadastral, 'MORTO');
  // A transferência da vaca morta (a linha do tempo dela, sem a linha da morte, a mostra viva) refaria a situação dela a
  // partir da fonte quebrada: a trava recusa, apontando a morte.
  const t = s.tentar((ctx) => s.G.EventService.registrar(ctx, { idempotencyKey: 'tr-morta', avisosAceitos: AV, dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-11-13', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: V }] } }));
  assert.deepEqual([t.ok, t.erro && t.erro.code, t.erro && S.codigos(t.erro)[0]], [false, 'CONFLICT', 'INTEGRIDADE_COPIAS'], JSON.stringify(t.erro));
  assert.equal(t.erro.details.find((x) => x.conflito).conflito.event_id, m.event_id);
  assert.match(t.erro.message, /^Não dá para gravar: a planilha tem dados apagados ou mexidos à mão em 2 pontos \(veja cada um abaixo\), e este lançamento refaria a situação a partir deles.*Restaure o backup/);
  assert.ok(t.erro.details.some((x) => /^"Morte de 01\/03\/2026" está sem as linhas dos animais \(EVENTO_ANIMAIS\) que o lançamento grava\. Este lançamento refaria a situação a partir desses dados/.test(x.mensagem)), JSON.stringify(t.erro.details));
  assert.equal(s.animal(V).situacao_cadastral, 'MORTO');
  // Um lançamento da outra vaca, que não toca a fonte quebrada, continua aceito.
  const W = s.tabela('ANIMAIS').find((a) => a.brinco === '101').animal_id;
  const tw = s.tentar((ctx) => s.G.EventService.registrar(ctx, { idempotencyKey: 'tr-viva', avisosAceitos: AV, dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-11-13', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: W }] } }));
  assert.ok(tw.ok, JSON.stringify(tw.erro));
  // Pela rota da tela de sistema, o mesmo.
  const api = s.tentar((ctx) => s.G.Api.rotas()['sistema.integridade'](ctx, { rota: 'sistema.integridade', dados: { reparar: true } }));
  assert.equal(api.ok, false);
});

test('R5 achado 6: a tela de sistema mostra por que não dá para reparar e não oferece o botão', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Settings.html'), 'utf8');
  assert.match(html, /if \(d\.reparo_impedido\) saida\.appendChild\(UI\.nota\(d\.reparo_impedido, 'erro'\)\);/);
  assert.match(html, /if \(d\.reparavel\) saida\.appendChild\(UI\.botao\('Reparar/);
});

// ---------------------------------------------------------------- achado 5 (MÉDIA) ----
const MAPA_TRANSF = { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
const salvarPasto = (s, dados, chave) => s.tentar((ctx) => s.G.PastureService.salvarPasto(ctx, { idempotencyKey: chave, dados }));
test('R5 achado 5: a cria que nasceria no pasto desativado onde a mãe estava é recusada na própria validação (e no formulário), no campo do pasto das crias', () => {
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const V = s.reg('registrar', S.entradaInicial([vaca('10')])).animais[0].animal_id;
  s.reg('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: V }] });
  assert.ok(salvarPasto(s, { pasture_id: PASTOS.A, campos: { status: 'INATIVO' } }, 'off').ok);
  const imp = criarImportacao(s, 'NASCIMENTOS', 'Data do parto;Brinco da mãe;Nasceu;Sexo da cria\n10/02/2026;10;vivo;M', 'nasc');
  validarTudo(s, imp.import_id, { colunas: { 'Data do parto': 'data', 'Brinco da mãe': 'mae', Nasceu: 'situacao', 'Sexo da cria': 'sexo' }, confiancas: {}, padroes: {} });
  const l = linhasImp(s, imp.import_id)[0];
  assert.deepEqual([l.status, l.erros.map((e) => [e.codigo, e.campo])], ['ERRO', [['PASTO_INATIVO', 'pasto_destino_id']]]);
  assert.match(l.erros[0].mensagem, /A mãe estava no pasto Pasto A em 10\/02\/2026, e ele está desativado: escolha o pasto das crias/);
  assert.ok(desfazer(s, imp.import_id).ok);
  const f = s.tent('registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-10' }, animais: [{ animal_id: V }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M' }] });
  assert.deepEqual([f.ok, f.erro && f.erro.code, f.erro && f.erro.details.map((d) => [d.codigo, d.campo])], [false, 'VALIDATION', [['PASTO_INATIVO', 'pasto_destino_id']]]);
  // Escolhendo o pasto das crias, o parto passa.
  s.reg('registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-10', pasto_destino_id: PASTOS.B }, animais: [{ animal_id: V }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M' }] });
  assert.deepEqual(s.erros(), []);
});

test('R5 achado 5: a trava confere o ensaio da validação e do bloco: o que só ela recusa vira motivo da linha, não uma conclusão impossível', () => {
  // A fonte da morte da vaca 100 apagada à mão: o motor vê a vaca viva pelas linhas, e só a trava sabe que a transferência
  // refaria a situação dela a partir da fonte quebrada.
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const [V] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('101')])).animais.map((a) => a.animal_id);
  const m = s.reg('registrar', morte('2026-03-01', V));
  s.apagarLinha('EVENTO_ANIMAIS', s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === m.event_id).event_animal_id);
  const imp = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n05/04/2026;Pasto A;Pasto B;100\n06/04/2026;Pasto A;Pasto B;101', 'transf');
  validarTudo(s, imp.import_id, MAPA_TRANSF);
  const ls = linhasImp(s, imp.import_id);
  assert.deepEqual(ls.map((l) => [l.linha_num, l.status, l.erros.map((e) => e.codigo)[0] || null]), [[2, 'ERRO', 'INTEGRIDADE_COPIAS'], [3, 'VALIDA', null]]);
  assert.match(ls[0].erros[0].mensagem, /refaria a situação a partir desses dados.*Restaure o backup/);
  // O dono aprova só a parte válida e a importação conclui; nada fica preso em IMPORTANDO.
  assert.ok(importarBloco(s, imp.import_id, 1, { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 1, ignorar: 1 } }).ok);
  assert.ok(concluir(s, imp.import_id).ok);
  assert.equal(s.tabela('IMPORTACOES').find((x) => x.import_id === imp.import_id).status, 'IMPORTADO');
  assert.equal(s.animal(V).situacao_cadastral, 'MORTO');
});

test('R5 achado 5: a conclusão recusada pela trava diz que só o desfazer resolve (a importação em curso bloqueia os outros lançamentos)', () => {
  // A edição à mão depois dos blocos: a conclusão é a primeira a ver a transferência valendo sobre a fonte quebrada.
  const s = base({ config: { importacao_lote_linhas: '50' } });
  const inicial = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('101')]));
  const V = inicial.animais[0].animal_id;
  const imp = criarImportacao(s, 'TRANSFERENCIAS', 'Data;Pasto de origem;Pasto de destino;Brinco\n05/04/2026;Pasto A;Pasto B;100', 'transf');
  validarTudo(s, imp.import_id, MAPA_TRANSF);
  assert.ok(importarBloco(s, imp.import_id, 1, { modo: 'TOTAL' }).ok);
  s.apagarLinha('EVENTO_ANIMAIS', s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === inicial.event_id && l.animal_id === V).event_animal_id);
  const c = concluir(s, imp.import_id);
  assert.deepEqual([c.ok, c.erro && c.erro.code], [false, 'CONFLICT']);
  assert.match(c.erro.message, /A importação continua em andamento, e os outros lançamentos ficam recusados enquanto ela estiver assim: só o desfazer resolve/);
  assert.ok(desfazer(s, imp.import_id).ok, 'o caminho que a mensagem dá funciona');
});

test('R5 achado 5: a fêmea "prenhe" nascida no dia do marco zero é recusada na validação da importação de ANIMAIS e no formulário', () => {
  const s = base();
  const imp = criarImportacao(s, 'ANIMAIS', 'Brinco;Sexo;Nascimento;Situação reprodutiva;Pasto\n100;F;10/01/2019;vazia;Pasto A\n101;F;01/01/2026;prenhe;Pasto A', 'prenhe');
  validarTudo(s, imp.import_id, { colunas: { Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento', 'Situação reprodutiva': 'situacao_reprodutiva', Pasto: 'pasto' }, confiancas: { data_nascimento: 'CONFIRMADA' }, padroes: {} });
  const ls = linhasImp(s, imp.import_id);
  assert.deepEqual(ls.map((l) => [l.status, l.erros.map((e) => e.codigo)]), [['VALIDA', []], ['ERRO', ['PRENHA_SEM_IDADE']]]);
  assert.match(ls[1].erros[0].mensagem, /nasceu em 01\/01\/2026 e não pode estar prenhe no marco zero/);
  const f = s.tent('registrar', S.entradaInicial([vaca('102', { data_nascimento: '2026-01-01', situacao_reprodutiva: 'PRENHA' })]));
  assert.deepEqual([f.ok, f.erro && S.codigos(f.erro)], [false, ['PRENHA_SEM_IDADE']]);
});

// ---------------------------------------------------------------- achado 10 (MÉDIA) ----
test('R5 achado 10: com o reuso desligado, o estorno do "brinco lançado errado" não devolve um número que outro animal passou a usar (o registro e a importação já recusavam)', () => {
  const s = base();
  const FORN = s.parceiro('Forn', ['FORNECEDOR']);
  const V = s.reg('registrar', S.entradaInicial([vaca('107')])).animais[0].animal_id;
  const errado = s.reg('registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-02-20', [{ animal_id: V, brinco: '119' }]));
  s.reg('registrar', ident('SUBSTITUICAO', '2026-02-25', [{ animal_id: V, codigo: '116', motivo: 'PERDA' }]));
  const c = s.reg('registrar', compra(FORN, '2026-03-01', '107'));
  const est = s.tent('estornar', { event_id: errado.event_id, justificativa: 'o brinco não estava errado' });
  assert.deepEqual([est.ok, est.erro && est.erro.code, est.erro && S.codigos(est.erro)], [false, 'CONFLICT', ['BRINCO_APOSENTADO']]);
  assert.equal(est.erro.details[0].conflito.event_id, c.event_id);
  assert.match(est.erro.details[0].mensagem, /o estorno devolveria ao animal o brinco 107, mas desde 01\/03\/2026 ele é do animal .*o reuso de brinco está desligado/);
  assert.deepEqual(s.erros(), []);
  // Com o reuso ligado, o mesmo estorno passa (os períodos não se cruzam).
  const s2 = base({ config: { brinco_permite_reuso: 'S' } });
  const F2 = s2.parceiro('Forn', ['FORNECEDOR']);
  const V2 = s2.reg('registrar', S.entradaInicial([vaca('107')])).animais[0].animal_id;
  const e2 = s2.reg('registrar', ajuste('IDENTIFICACAO_INCORRETA', '2026-02-20', [{ animal_id: V2, brinco: '119' }]));
  s2.reg('registrar', ident('SUBSTITUICAO', '2026-02-25', [{ animal_id: V2, codigo: '116', motivo: 'PERDA' }]));
  s2.reg('registrar', compra(F2, '2026-03-01', '107'));
  assert.ok(s2.tent('estornar', { event_id: e2.event_id, justificativa: 'o brinco não estava errado' }).ok);
  assert.deepEqual(s2.erros(), []);
});

// ---------------------------------------------------------------- achado 11 (MÉDIA) ----
test('R5 achado 11: a recusa por categoria manual × sexo manda estornar (ou corrigir) a reclassificação antiga, e esse caminho funciona', () => {
  const s = base();
  const cat = (codigo) => s.tabela('CATEGORIAS').find((c) => c.codigo === codigo).category_id;
  const V = s.reg('registrar', S.entradaInicial([vaca('1', { data_nascimento: '2023-01-10' })])).animais[0].animal_id;
  const r1 = s.reg('registrar', ajuste('RECLASSIFICACAO', '2026-02-01', [{ animal_id: V, categoria_manual_id: cat('VACA') }]));
  s.reg('registrar', ajuste('RECLASSIFICACAO', '2026-03-01', [{ animal_id: V, categoria_manual_id: null }]));
  const c = s.tent('registrar', correcao('2026-04-01', [{ animal_id: V, campo: 'sexo', valor_novo: 'M' }, { animal_id: V, campo: 'castrado', valor_novo: 'N' }, { animal_id: V, campo: 'reprodutor', valor_novo: 'N' }]));
  assert.deepEqual([c.ok, c.erro && S.codigos(c.erro)], [false, ['CATEGORIA_INCOMPATIVEL']]);
  assert.equal(c.erro.details[0].conflito.event_id, r1.event_id);
  assert.match(c.erro.details[0].mensagem, /Antes de corrigir o sexo, estorne a reclassificação de 01\/02\/2026 \(ou corrija-a para uma categoria do sexo novo\): voltar à categoria automática ou reclassificar de novo não apaga a reclassificação antiga\./);
  assert.doesNotMatch(c.erro.details[0].mensagem, /Volte o animal à categoria automática/);
  // O caminho que a mensagem dá: corrigir a reclassificação antiga para uma categoria que serve aos dois sexos (ou
  // estorná-la) e então corrigir o sexo.
  const ambos = s.tabela('CATEGORIAS').find((x) => x.sexo_aplicavel === 'AMBOS' && x.ativo !== false);
  if (ambos) s.reg('corrigir', Object.assign(ajuste('RECLASSIFICACAO', '2026-02-01', [{ animal_id: V, categoria_manual_id: ambos.category_id }]), { event_id: r1.event_id, justificativa: 'categoria errada' }));
  else s.reg('estornar', { event_id: r1.event_id, justificativa: 'reclassificação errada' });
  s.reg('registrar', correcao('2026-04-02', [{ animal_id: V, campo: 'sexo', valor_novo: 'M' }, { animal_id: V, campo: 'castrado', valor_novo: 'N' }, { animal_id: V, campo: 'reprodutor', valor_novo: 'N' }]));
  assert.equal(s.animal(V).sexo, 'M');
  assert.deepEqual(s.erros(), []);
  // A verificação (e a trava) dá o mesmo conselho.
  const s2 = base();
  const cat2 = (codigo) => s2.tabela('CATEGORIAS').find((x) => x.codigo === codigo).category_id;
  const V2 = s2.reg('registrar', S.entradaInicial([vaca('2', { data_nascimento: '2023-01-10' })])).animais[0].animal_id;
  const rc2 = s2.reg('registrar', ajuste('RECLASSIFICACAO', '2026-02-01', [{ animal_id: V2, categoria_manual_id: cat2('VACA') }]));
  s2.reg('registrar', ajuste('RECLASSIFICACAO', '2026-03-01', [{ animal_id: V2, categoria_manual_id: null }]));
  s2.editar('AJUSTES', s2.tabela('AJUSTES').find((a) => a.event_id === rc2.event_id).ajuste_id, 'valor_novo', cat2('BOI'));
  assert.ok(s2.erros().some(([ch, msg]) => ch === 'LINHA_DO_TEMPO' && /Estorne essa reclassificação \(ou corrija-a para uma categoria do sexo dele\)/.test(msg)), JSON.stringify(s2.erros()));
});

// ---------------------------------------------------------------- achado 17 (BAIXA) ----
test('R5 achado 17: o pasto não é reativado dentro de uma propriedade desativada; a integridade acusa animal no rebanho em propriedade desativada', () => {
  const s = base();
  const run = (cmd) => s.tentar((ctx) => s.G.UnitOfWork.run(ctx, cmd));
  const pid = run(s.G.PastureService.comandoSalvarPropriedade({ idempotencyKey: 'p2', dados: { campos: { nome: 'Sítio Novo', status: 'ATIVO' } } })).valor.dados.property_id;
  const cid = run(s.G.PastureService.comandoSalvarPasto({ idempotencyKey: 'c', dados: { campos: { property_id: pid, nome: 'Pasto C', posse: 'PROPRIO', status: 'ATIVO' } } })).valor.dados.pasture_id;
  assert.ok(run(s.G.PastureService.comandoSalvarPasto({ idempotencyKey: 'c-off', dados: { pasture_id: cid, campos: { status: 'INATIVO' } } })).ok);
  assert.ok(run(s.G.PastureService.comandoSalvarPropriedade({ idempotencyKey: 'p-off', dados: { property_id: pid, campos: { nome: 'Sítio Novo', status: 'INATIVO' } } })).ok);
  const re = run(s.G.PastureService.comandoSalvarPasto({ idempotencyKey: 'c-on', dados: { pasture_id: cid, campos: { status: 'ATIVO' } } }));
  assert.deepEqual([re.ok, re.erro && S.codigos(re.erro)], [false, ['PROPRIEDADE_INATIVA']]);
  assert.match(re.erro.details[0].mensagem, /O pasto Pasto C fica na propriedade Sítio Novo, que está desativada: reative antes a propriedade/);
  // Reativada a propriedade, o pasto volta.
  assert.ok(run(s.G.PastureService.comandoSalvarPropriedade({ idempotencyKey: 'p-on', dados: { property_id: pid, campos: { nome: 'Sítio Novo', status: 'ATIVO' } } })).ok);
  assert.ok(run(s.G.PastureService.comandoSalvarPasto({ idempotencyKey: 'c-on2', dados: { pasture_id: cid, campos: { status: 'ATIVO' } } })).ok);
  // Adulteração à mão: animal no Pasto C com a propriedade desativada direto na planilha.
  const V = s.reg('registrar', S.entradaInicial([vaca('1')])).animais[0].animal_id;
  s.reg('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-02-01', pasto_origem_id: PASTOS.A, pasto_destino_id: cid }, animais: [{ animal_id: V }] });
  s.editar('PROPRIEDADES', pid, 'status', 'INATIVO');
  assert.ok(s.erros().some(([ch, msg]) => ch === 'LINHA_DO_TEMPO' && /no pasto Pasto C, da propriedade Sítio Novo, que está desativada/.test(msg)), JSON.stringify(s.erros()));
});
