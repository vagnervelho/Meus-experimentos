'use strict';
/**
 * Revisão independente da Fase 2, rodada 4, lente INTERFACE E REGRAS (a parte que roda no Node, com os scripts do
 * cliente da página montada pelo doGet real e o servidor real do harness): a prévia do parto não fixa o pasto e a raça
 * que o servidor tirou da mãe; a revisão da correção não chama de anulado quem só sai do lançamento, diz que os
 * documentos do original passam ao substituto e dá o nome certo ao valor de cada animal; o seletor com data passada dá o
 * motivo pelo sexo; a ajuda das outras identificações em linguagem de campo; o limite do rascunho coerente com o
 * contrato. Os fluxos que precisam do navegador estão em tests/ui/revisao4.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./apoio-sistema');
const { api, cliente, storeDe } = require('./apoio-telas');

const { js, PASTOS } = S;
const clone = (v) => JSON.parse(JSON.stringify(v));

function montar() {
  const s = S.sistema();
  const sem = api(s, { rota: 'evento.registrar', idempotencyKey: 'sem', dados: S.entradaInicial([
    S.bicho({ brinco: '0457', raca: 'NELORE', data_nascimento: '2020-02-02', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '0391', raca: 'ANGUS', pasto_destino_id: PASTOS.B, data_nascimento: '2020-05-10', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '12', sexo: 'M', data_nascimento: '2025-03-01', data_nascimento_confianca: 'CONFIRMADA' }),
  ]) });
  assert.equal(sem.ok, true, JSON.stringify(sem.error));
  const id = (b) => sem.data.animais.find((x) => x.brinco === b).animal_id;
  return { s, id };
}
function sessaoDaPrevia(c, s, eventId) {
  const st = storeDe(s);
  c.Store = st;
  const previa = js(c.TelaEventos.previaCorrecao(api(s, { rota: 'evento.obter', dados: { event_id: eventId } }).data));
  const tipo = s.tabela('EVENTOS').find((e) => e.event_id === eventId).event_type;
  const grupos = {};
  Object.keys(previa.grupos || {}).forEach((g) => { grupos[g] = previa.grupos[g].map((x, i) => ({ uid: g + i, animal_id: x.animal_id || null, valores: clone(x.valores) })); });
  return {
    previa,
    sess: {
      tipo, def: st.tipoEvento(tipo), subtipo: previa.subtipo || null, campos: clone(previa.campos || {}), grupos, justificativaAviso: '', anexos: [],
      linhas: (previa.linhas || []).map((l, i) => ({ uid: 'l' + i, animal_id: l.animal_id || null, criado: !!l.criado, valores: clone(l.valores || {}), erros: [] })),
      corrige: clone(previa.corrige), justificativaCorrecao: 'Conferência',
    },
  };
}
function gravarPelaTela(c, s, sess, chave) {
  const m = js(c.Registro.montarDados(sess));
  assert.deepEqual(m.erros, [], chave + ': ' + JSON.stringify(m.erros));
  const r = api(s, { rota: 'evento.corrigir', idempotencyKey: chave, dados: m.dados });
  assert.equal(r.ok, true, chave + ': ' + JSON.stringify(r.error));
  s.conferirProjecoes(chave);
  return r.data;
}
const erros = (s) => (s.integridade().achados || []).filter((x) => x.severidade === 'ERRO').map((x) => [x.checagem, x.mensagem]);

// ---------------------------------------------------------------- achado 4 (ALTA) ----
test('R4 achado 4: na correção do parto, o pasto das crias e a raça que o servidor tirou da mãe ficam vazios e acompanham a mãe e a data corrigidas', () => {
  // (1) Troca da mãe: a cria vai para a raça e o pasto da mãe nova.
  const { s, id } = montar();
  const c = cliente(s);
  const p = api(s, { rota: 'evento.registrar', idempotencyKey: 'parto', dados: { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-10' }, animais: [{ animal_id: id('0457') }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] } });
  assert.equal(p.ok, true, JSON.stringify(p.error));
  const cria = s.tabela('ANIMAIS').find((a) => a.mae_id === id('0457')).animal_id;
  const animal = (x) => s.tabela('ANIMAIS').find((a) => a.animal_id === x);
  assert.deepEqual([animal(cria).raca, animal(cria).pasto_atual_id], ['NELORE', PASTOS.A]);
  const x = sessaoDaPrevia(c, s, p.data.event_id);
  assert.equal(x.previa.campos.pasto_destino_id, undefined, 'o pasto proposto pelo servidor não vira digitado');
  assert.equal(x.previa.grupos.crias[0].valores.raca, undefined, 'a raça da mãe não vira digitada');
  x.sess.linhas = [{ uid: 'l0', animal_id: id('0391'), criado: false, valores: {}, erros: [] }];
  gravarPelaTela(c, s, x.sess, 'corr-mae');
  assert.deepEqual([animal(cria).mae_id, animal(cria).raca, animal(cria).pasto_atual_id], [id('0391'), 'ANGUS', PASTOS.B]);
  assert.deepEqual(erros(s), []);
  // (2) Troca da data para antes de a mãe mudar de pasto: a cria nasce onde a mãe estava no dia.
  const r2 = montar();
  const c2 = cliente(r2.s);
  api(r2.s, { rota: 'evento.registrar', idempotencyKey: 'tr', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-15', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: r2.id('0457') }] } });
  const p2 = api(r2.s, { rota: 'evento.registrar', idempotencyKey: 'parto2', dados: { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-20' }, animais: [{ animal_id: r2.id('0457') }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] } });
  assert.equal(p2.ok, true, JSON.stringify(p2.error));
  const cria2 = r2.s.tabela('ANIMAIS').find((a) => a.mae_id === r2.id('0457')).animal_id;
  assert.equal(r2.s.tabela('ANIMAIS').find((a) => a.animal_id === cria2).pasto_atual_id, PASTOS.B);
  const y = sessaoDaPrevia(c2, r2.s, p2.data.event_id);
  assert.equal(y.previa.campos.pasto_destino_id, undefined);
  y.sess.campos.event_date = '2026-03-10';
  gravarPelaTela(c2, r2.s, y.sess, 'corr-data');
  assert.equal(r2.s.tabela('ANIMAIS').find((a) => a.animal_id === cria2).pasto_atual_id, PASTOS.A, 'em 10/03 a mãe estava no Pasto A');
  const pos = r2.s.read(r2.s.G.Timeline.consultaInventario({ data: '2026-03-12' }));
  assert.equal((pos.porPasto || {})[PASTOS.A], 3, JSON.stringify(pos));
  assert.deepEqual(erros(r2.s), []);
  // O pasto digitado continua digitado: a prévia o traz de volta.
  const p3 = api(r2.s, { rota: 'evento.registrar', idempotencyKey: 'parto3', dados: { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-21', pasto_destino_id: PASTOS.A }, animais: [{ animal_id: r2.id('0391') }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', raca: 'NELORE' }] } });
  assert.equal(p3.ok, true, JSON.stringify(p3.error));
  const z = sessaoDaPrevia(c2, r2.s, p3.data.event_id);
  assert.deepEqual([z.previa.campos.pasto_destino_id, z.previa.grupos.crias[0].valores.raca], [PASTOS.A, 'NELORE']);
});

// ---------------------------------------------------------------- achado 15 (MÉDIA) ----
test('R4 achado 15: tirar da lista um animal que já existia não o conta como anulado; a revisão diz que ele volta ao que era e não repete "Animais"', () => {
  const { s, id } = montar();
  const c = cliente(s);
  c.Store = storeDe(s);
  const t = api(s, { rota: 'evento.registrar', idempotencyKey: 't', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: id('0457') }, { animal_id: id('12') }] } });
  const dados = { tipo: 'TRANSFERENCIA', event_id: t.data.event_id, justificativa: 'o 12 não foi', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: id('0457') }] };
  const sim = api(s, { rota: 'evento.simular', dados: { acao: 'corrigir', dados } });
  assert.equal(sim.ok, true, JSON.stringify(sim.error));
  assert.deepEqual([sim.data.impactos.anulados, sim.data.impactos.voltam], [0, 1]);
  const linhas = js(c.Registro.impactosServidor({ simulacao: sim.data, corrige: { rotulo: 'Transferir de pasto de 01/03/2026' } }));
  const rotulos = linhas.map((l) => l[0]);
  assert.equal(rotulos.indexOf('Animais'), -1, 'o número de animais já está no resumo');
  assert.equal(rotulos.indexOf('Animais anulados'), -1);
  assert.equal(rotulos.indexOf('Animais que deixam de existir'), -1);
  assert.deepEqual(linhas.find((l) => l[0] === 'Tirados do lançamento'), ['Tirados do lançamento', '1 animal volta ao que era antes dele']);
  const r = api(s, { rota: 'evento.corrigir', idempotencyKey: 'corr', dados });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(s.tabela('ANIMAIS').find((a) => a.animal_id === id('12')).situacao_cadastral, 'ATIVO');
  // O parto com a mãe trocada: a cria é reaproveitada, ninguém é anulado; a mãe antiga volta ao que era.
  const p = api(s, { rota: 'evento.registrar', idempotencyKey: 'p', dados: { tipo: 'NASCIMENTO', campos: { event_date: '2026-04-10' }, animais: [{ animal_id: id('0457') }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M' }] } });
  const cria = s.tabela('ANIMAIS').find((a) => a.mae_id === id('0457')).animal_id;
  const sp = api(s, { rota: 'evento.simular', dados: { acao: 'corrigir', dados: { tipo: 'NASCIMENTO', event_id: p.data.event_id, justificativa: 'mãe', campos: { event_date: '2026-04-10' }, animais: [{ animal_id: id('0391') }], crias: [{ animal_id: cria, situacao_nascimento: 'VIVO', sexo: 'M' }] } } });
  assert.equal(sp.ok, true, JSON.stringify(sp.error));
  assert.deepEqual([sp.data.impactos.anulados, sp.data.impactos.voltam], [0, 1]);
  // Tirar da correção um animal que o original criou continua anulando só ele.
  const e = api(s, { rota: 'evento.registrar', idempotencyKey: 'e', dados: S.entradaInicial([S.bicho({ brinco: '0700' }), S.bicho({ brinco: '0701' })]) });
  const um = e.data.animais.find((a) => a.brinco === '0700');
  const st = s.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === e.data.event_id && l.animal_id === um.animal_id);
  const so = api(s, { rota: 'evento.simular', dados: { acao: 'corrigir', dados: { tipo: 'ENTRADA_INICIAL', event_id: e.data.event_id, justificativa: 'o 0701 não existe', campos: {}, animais: [Object.assign({ animal_id: um.animal_id, brinco: '0700', pasto_destino_id: st.pasto_destino_id }, st.atributos_iniciais_json)] } } });
  assert.equal(so.ok, true, JSON.stringify(so.error));
  assert.deepEqual([so.data.impactos.anulados, so.data.impactos.voltam], [1, 0]);
  assert.deepEqual(js(c.Registro.impactosServidor({ simulacao: so.data, corrige: { rotulo: 'x' } })).find((l) => l[0] === 'Animais que deixam de existir'), ['Animais que deixam de existir', '1']);
});

// ---------------------------------------------------------------- achado 23 (BAIXA) ----
test('R4 achado 23: no parto com data passada, o macho aparece como "não é fêmea", não como "fora do rebanho"', () => {
  const { s, id } = montar();
  const c = cliente(s);
  c.Store = storeDe(s);
  const filtro = c.Store.tipoEvento('NASCIMENTO').filtro_elegiveis;
  assert.equal(filtro.sexo, 'F');
  const macho = c.Store.animal(id('12'));
  const posicao = { data: '2026-03-01', mapa: {} };
  posicao.mapa[id('0457')] = { pasture_id: PASTOS.A };
  assert.equal(c.Seletor.motivoInelegivel(macho, filtro, null, posicao), 'não é fêmea');
  assert.equal(c.Seletor.motivoInelegivel(macho, filtro, null, null), 'não é fêmea', 'igual à de hoje');
  assert.equal(c.Seletor.motivoInelegivel(c.Store.animal(id('0391')), filtro, null, posicao), 'fora do rebanho em 01/03/2026', 'a fêmea fora da posição na data continua com o motivo da presença');
  assert.equal(c.Seletor.motivoInelegivel(c.Store.animal(id('0457')), filtro, null, posicao), null);
});

// ---------------------------------------------------------------- achado 25 (BAIXA) ----
test('R4 achado 25: na correção de evento com anexo, a prévia e a revisão dizem quais documentos do original passam ao substituto', () => {
  const { s, id } = montar();
  const c = cliente(s);
  const t = api(s, { rota: 'evento.registrar', idempotencyKey: 't', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: id('0457') }] } });
  const an = api(s, { rota: 'anexo.adicionar', idempotencyKey: 'an', dados: { entidade: 'EVENTOS', entity_id: t.data.event_id, tipo: 'DOCUMENTO', nome_arquivo: 'gta-123.pdf', mime_type: 'application/pdf', conteudo_base64: Buffer.from('%PDF-1.4\n% gta-123\n').toString('base64') } });
  assert.equal(an.ok, true, JSON.stringify(an.error));
  const x = sessaoDaPrevia(c, s, t.data.event_id);
  assert.deepEqual(x.previa.corrige.anexos, ['gta-123.pdf']);
  x.sess.campos.event_date = '2026-03-02';
  const m = js(c.Registro.montarDados(x.sess));
  const sim = api(s, { rota: 'evento.simular', dados: { acao: 'corrigir', dados: m.dados } });
  assert.equal(sim.ok, true, JSON.stringify(sim.error));
  assert.deepEqual([sim.data.impactos.anexos, sim.data.impactos.anexos_nomes], [1, ['gta-123.pdf']]);
  const linhas = js(c.Registro.impactosServidor({ simulacao: sim.data, corrige: x.sess.corrige }));
  assert.deepEqual(linhas.find((l) => l[0] === 'Documentos e fotos do original'), ['Documentos e fotos do original', 'gta-123.pdf (passa a esta correção)']);
});

// ---------------------------------------------------------------- achado 26 (BAIXA) ----
test('R4 achado 26: a ajuda de "Outras identificações" está em linguagem de campo, sem a notação técnica', () => {
  const s = S.sistema();
  const st = storeDe(s);
  ['COMPRA', 'ENTRADA_INICIAL', 'OUTRA_ENTRADA'].forEach((tipo) => {
    const d = (st.tipoEvento(tipo).campos_animal || []).find((x) => x.id === 'outras_identificacoes');
    assert.ok(d, tipo);
    assert.doesNotMatch(d.ajuda, /\{|\}|codigo|Lista de/, tipo + ': ' + d.ajuda);
    assert.match(d.ajuda, /escolha o tipo e digite o número/);
  });
});

// ---------------------------------------------------------------- achado 27 (BAIXA) ----
test('R4 achado 27: a revisão da morte com custo chama o rateado de "Custo do animal", não de "Valor do animal"', () => {
  const { s, id } = montar();
  const c = cliente(s);
  c.Store = storeDe(s);
  const conta = s.tabela('PLANO_CONTAS').find((x) => x.natureza === 'CUSTEIO');
  const sim = api(s, { rota: 'evento.simular', dados: { acao: 'registrar', dados: { tipo: 'MORTE', campos: { event_date: '2026-03-01', causa: 'DOENCA', custo_valor: 15000, custo_conta_id: conta.conta_id, custo_parcelas_qtd: 2 }, animais: [{ animal_id: id('12') }] } } });
  assert.equal(sim.ok, true, JSON.stringify(sim.error));
  const linhas = js(c.Registro.impactosServidor({ simulacao: sim.data }));
  const l = linhas.find((x) => /animal/.test(x[0]) && /R\$/.test(x[1]));
  assert.equal(l[0], 'Custo do animal', JSON.stringify(linhas));
  assert.match(l[1], /^R\$\s150,00$/);
  assert.equal(linhas.some((l) => l[0] === 'Valor do animal'), false);
});

// ---------------------------------------------------------------- achado 28 (BAIXA) ----
test('R4 achado 28: o contrato e o comentário do Api dizem o limite real do rascunho no servidor (96 KB em partes de 8 KB)', () => {
  const contratos = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CONTRATOS.md'), 'utf8');
  const apiJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'Api.js'), 'utf8');
  assert.match(apiJs, /maxBytes: 96000, parteBytes: 8000/);
  assert.doesNotMatch(contratos, /teto de 8 KB/);
  assert.doesNotMatch(apiJs, /abaixo dos 9 KB por valor/);
  assert.match(contratos, /teto de 96 KB em partes de 8 KB/);
});
