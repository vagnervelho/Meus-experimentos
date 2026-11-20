'use strict';
/**
 * Revisão da Fase 3, rodada 2 (conserto), achados do motor, do custo e da integridade, cada um por caminho: a dose por peso
 * congelada na correção (a pesagem lançada depois e o peso de referência mudado depois não refazem a dose, a saída nem o
 * custo), o movimento de estoque anterior a uma contagem vigente (recusado com o caminho; a verificação confere o saldo
 * contado), a importação de sanidade com a quantidade do frasco e uma linha já lançada (QUANTIDADE_EM_PARTE), a entrada de
 * estoque apagada à mão (a fonte quebrada pelo que a compra congelou) e o produto do cadastro sem custo unitário.
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
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(brincos.map((b) => S.bicho(Object.assign({ brinco: b, sexo: 'F', data_nascimento: '2023-08-01', data_nascimento_confianca: 'CONFIRMADA' }, extra || {})))), 'rebanho-' + brincos.join('-')), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
function produto(s, campos) {
  return ok(api(s, 'produto.salvar', { campos: Object.assign({ nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', controla_estoque: true }, campos || {}) }), 'produto');
}
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
const vigentes = (s, aba, filtro) => {
  const evs = Object.fromEntries(s.tabela('EVENTOS').map((e) => [e.event_id, e]));
  return tab(s, aba, filtro).filter((r) => { const e = evs[r.event_id]; return !e || e.status === 'CONFIRMADO'; });
};
const saldo = (s, pid) => s.tabela('PRODUTOS').find((p) => p.product_id === pid).estoque_atual;
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
const pesar = (s, data, itens) => ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: itens }, null, ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE']), 'pesagem ' + data);
/** O efeito de uma aplicação: as doses (por animal), a saída (quantidade, custo) e o consumo (valor, quantidade). */
function efeito(s, eid, ids) {
  const doses = {};
  tab(s, 'SANIDADE', { event_id: eid }).forEach((r) => { doses[Object.keys(ids).find((b) => ids[b] === r.animal_id)] = r.dose; });
  return {
    doses,
    mov: tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: eid }).map((m) => [m.tipo, m.quantidade, m.custo_unitario]),
    fin: tab(s, 'FINANCEIRO', { event_id: eid }).filter((f) => f.product_id).map((f) => [f.valor, f.quantidade]),
  };
}

test('achados 1 e 4 (a): corrigir uma aplicação por peso sem mexer na dose por kg, no produto nem na data mantém a dose gravada de cada animal — a pesagem lançada depois não refaz a dose, a saída, o custo nem o saldo (simulação, correção, correção do substituto); mudar a dose por kg ou a data refaz pelo peso na data', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['101', '102']);
  const p = produto(s, { nome: 'Vermífugo V', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 1 });
  const pid = p.product_id;
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-01-10', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada');
  pesar(s, '2026-01-15', [{ animal_id: ids['101'], peso: 300 }, { animal_id: ids['102'], peso: 300 }]);
  const campos = { produto_id: pid, modo_dose: 'POR_PESO', dose_referencia: 0.02, veterinario: 'Dr. A' };
  const animais = [ids['101'], ids['102']];
  const r = ok(api(s, 'evento.registrar', san('VERMIFUGACAO', '2026-03-10', animais, campos)), 'vermifugação');
  const antes = efeito(s, r.event_id, ids);
  assert.deepEqual(antes, { doses: { 101: 6, 102: 6 }, mov: [['SAIDA', 12, 1]], fin: [[1200, 12]] });
  assert.equal(saldo(s, pid), 88);
  // O caderno traz uma pesagem de 01/03, antes da aplicação: lançada agora, ela não muda o que foi aplicado em 10/03.
  pesar(s, '2026-03-01', [{ animal_id: ids['101'], peso: 400 }, { animal_id: ids['102'], peso: 350 }]);
  // A correção só do veterinário, montada como a tela monta (a dose de cada animal vazia, a quantidade igual à soma omitida).
  const pedido = (eid, extra) => Object.assign({ event_id: eid, justificativa: 'nome do veterinário' }, san('VERMIFUGACAO', '2026-03-10', animais, Object.assign({}, campos, { veterinario: 'Dr. B' }, extra || {})));
  const sim = ok(api(s, 'evento.simular', { acao: 'corrigir', dados: pedido(r.event_id) }), 'simulação');
  assert.deepEqual(sim.impactos.sanidade.animais.map((a) => [a.dose, a.dose_do_original]), [[6, true], [6, true]]);
  assert.equal(sim.impactos.sanidade.quantidade, 12);
  const c1 = ok(api(s, 'evento.corrigir', pedido(r.event_id)), 'correção');
  assert.deepEqual(efeito(s, c1.event_id, ids), antes, 'correção: as doses, a saída e o custo do original');
  assert.equal(saldo(s, pid), 88);
  const c2 = ok(api(s, 'evento.corrigir', pedido(c1.event_id, { veterinario: 'Dr. C' })), 'correção do substituto');
  assert.deepEqual(efeito(s, c2.event_id, ids), antes, 'correção do substituto');
  semErro(s, 'dose congelada');
  // Mudar a dose por kg é outro fato: refeita pelo peso na data (o de 01/03).
  const c3 = ok(api(s, 'evento.corrigir', pedido(c2.event_id, { dose_referencia: 0.03 })), 'dose por kg nova');
  assert.deepEqual(efeito(s, c3.event_id, ids), { doses: { 101: 12, 102: 10.5 }, mov: [['SAIDA', 22.5, 1]], fin: [[2250, 22.5]] });
  const sim2 = ok(api(s, 'evento.simular', { acao: 'corrigir', dados: pedido(c3.event_id, { dose_referencia: 0.02, event_date: '2026-03-11' }) }), 'data nova');
  assert.deepEqual(sim2.impactos.sanidade.animais.map((a) => [a.dose, a.dose_do_original]), [[8, false], [7, false]], 'a data nova refaz pelo peso na data');
  semErro(s, 'dose refeita');
});

test('achados 1 e 4 (b): sem pesagem, a dose saiu pelo peso de referência da categoria; mudar o peso de referência depois não refaz a dose na correção de outro campo', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['201', '202']);
  const cats = s.tabela('CATEGORIAS').filter((c) => c.ativo !== false);
  const pesoRef = (kg) => ok(api(s, 'categoria.salvar', { categorias: cats.map((c) => ({ category_id: c.category_id, campos: { peso_referencia_kg: kg } })), justificativa: 'peso de referência' }, null, ['CATEGORIAS_SEM_COBERTURA']), 'peso de referência ' + kg);
  pesoRef(300);
  const p = produto(s, { nome: 'Vermífugo V', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 1 });
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-01-10', { product_id: p.product_id, quantidade: 100, valor: 10000 })), 'entrada');
  const campos = { produto_id: p.product_id, modo_dose: 'POR_PESO', dose_referencia: 0.02, lote: 'L1', validade: '2027-01-01' };
  const animais = [ids['201'], ids['202']];
  const r = ok(api(s, 'evento.registrar', san('VERMIFUGACAO', '2026-06-01', animais, campos)), 'vermifugação');
  const antes = efeito(s, r.event_id, ids);
  assert.deepEqual(antes, { doses: { 201: 6, 202: 6 }, mov: [['SAIDA', 12, 1]], fin: [[1200, 12]] });
  pesoRef(450);
  const c1 = ok(api(s, 'evento.corrigir', Object.assign({ event_id: r.event_id, justificativa: 'lote' }, san('VERMIFUGACAO', '2026-06-01', animais, Object.assign({}, campos, { lote: 'L2' })))), 'correção do lote');
  assert.deepEqual(efeito(s, c1.event_id, ids), antes);
  assert.equal(saldo(s, p.product_id), 88);
  semErro(s, 'peso de referência mudado');
});

test('achados 2 e 5: o movimento anterior a uma contagem vigente do produto (a aplicação esquecida, a entrada retroativa, a contagem anterior, o estorno e a correção que mudam a quantidade) é recusado com a contagem que impede e o caminho; estornada a contagem, grava; depois dela, grava', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['101', '102', '103', '104']);
  const p = produto(s, { nome: 'Vacina X', custo_unitario: 1 });
  const pid = p.product_id;
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-11-01', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada');
  const v7 = ok(api(s, 'evento.registrar', san('VACINACAO', '2026-11-07', [ids['101'], ids['102']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 10 })), 'vacinação de 07/11');
  assert.equal(saldo(s, pid), 80);
  const cont = ok(api(s, 'evento.registrar', estoque('AJUSTE', '2026-11-10', { product_id: pid, motivo_ajuste: 'CONTAGEM', saldo_contado: 70 })), 'contagem');
  assert.equal(saldo(s, pid), 70);
  // A vacinação de 05/11, esquecida, lançada agora: a contagem de 10/11 já viu o armário sem essas doses.
  const esquecida = san('VACINACAO', '2026-11-05', [ids['103']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 10 });
  const sim = recusa(api(s, 'evento.simular', { acao: 'registrar', dados: esquecida }), 'CONFLICT', 'simulação');
  assert.deepEqual(cods(sim), ['CONTAGEM_POSTERIOR']);
  const e = recusa(api(s, 'evento.registrar', esquecida, null, ['ESTOQUE_INSUFICIENTE']), 'CONFLICT', 'aplicação anterior à contagem');
  assert.deepEqual(cods(e), ['CONTAGEM_POSTERIOR']);
  assert.match(e.details[0].mensagem, /Vacina X: a contagem do estoque de 10\/11\/2026 \(70 doses contados\) já acertou o saldo daquele dia, e este lançamento o mudaria \(de 70 doses para 60 doses\)\. Estorne antes a contagem de 10\/11\/2026/);
  assert.deepEqual([e.details[0].conflito.event_id, e.details[0].conflito.data], [cont.event_id, '2026-11-10']);
  // A entrada retroativa, a contagem anterior, o estorno e a correção da quantidade da aplicação de antes: o mesmo.
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', estoque('ENTRADA', '2026-11-03', { product_id: pid, quantidade: 5, valor: 500 })), 'CONFLICT', 'entrada retroativa')), ['CONTAGEM_POSTERIOR']);
  assert.deepEqual(cods(recusa(api(s, 'evento.registrar', estoque('AJUSTE', '2026-11-08', { product_id: pid, motivo_ajuste: 'PERDA', quantidade: 1 })), 'CONFLICT', 'perda anterior')), ['CONTAGEM_POSTERIOR']);
  assert.deepEqual(cods(recusa(api(s, 'evento.estornar', { event_id: v7.event_id, justificativa: 'lançada errada' }), 'CONFLICT', 'estorno da aplicação de antes')), ['CONTAGEM_POSTERIOR']);
  const corr = (extra) => Object.assign({ event_id: v7.event_id, justificativa: 'conferido' }, san('VACINACAO', '2026-11-07', [ids['101'], ids['102']], Object.assign({ produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 10 }, extra)));
  assert.deepEqual(cods(recusa(api(s, 'evento.corrigir', corr({ dose_referencia: 5 })), 'CONFLICT', 'correção da dose')), ['CONTAGEM_POSTERIOR']);
  // A correção que não muda a quantidade passa; a aplicação depois da contagem também.
  ok(api(s, 'evento.corrigir', corr({ veterinario: 'Dr. B' })), 'correção do veterinário');
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-11-12', [ids['104']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'depois da contagem');
  assert.equal(saldo(s, pid), 69);
  semErro(s, 'recusas');
  // O caminho: estornar a contagem, lançar a esquecida e contar de novo.
  ok(api(s, 'evento.estornar', { event_id: cont.event_id, justificativa: 'a diferença era a vacinação de 05/11' }), 'estorno da contagem');
  ok(api(s, 'evento.registrar', esquecida), 'esquecida depois do estorno');
  assert.equal(saldo(s, pid), 69);
  semErro(s, 'caminho');
});

test('achados 2 e 5 (integridade e outros caminhos): a verificação confere o saldo do fim do dia contado com o saldo contado; o desfazer da importação que mudaria o saldo de uma contagem posterior é recusado (pelo motor, com CONTAGEM_POSTERIOR e o caminho do desfazer; CONTRATOS, seção 53, achado 16); a importação da aplicação anterior à contagem fica com o motivo', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['101', '102', '103']);
  const p = produto(s, { nome: 'Vacina P', custo_unitario: 1 });
  const pid = p.product_id;
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada');
  // A importação de uma aplicação de 15/03, concluída; depois a contagem de 01/04 (98 contados: 1 a menos que o sistema).
  const csvDe = (brinco) => ['Data;Procedimento;Produto do cadastro;Como foi a dose;Dose do lançamento (por cabeça ou por kg);Brinco', '15/03/2026;vacinação;Vacina P;por cabeça;1;' + brinco].join('\n');
  const importar = (chave, csv) => {
    const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar-' + chave, dados: { tipo: 'SANIDADE', arquivo_nome: 's.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
    const mapa = { colunas: c.sugestao, confiancas: {}, padroes: {} };
    for (let b = 1; b < 10; b++) {
      const est = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + chave + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
      if (est.importacao.status === 'VALIDADO') break;
    }
    return c.import_id;
  };
  const imp = importar('1', csvDe('103'));
  const ib = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: imp, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(ib.ok, JSON.stringify(ib.erro));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: imp } }));
  assert.equal(saldo(s, pid), 99);
  const cont = ok(api(s, 'evento.registrar', estoque('AJUSTE', '2026-04-01', { product_id: pid, motivo_ajuste: 'CONTAGEM', saldo_contado: 98 })), 'contagem');
  semErro(s, 'contagem');
  // O desfazer da importação devolveria a dose ao saldo de 01/04, que a contagem já acertou: recusado já pelo motor (antes, só a
  // trava recusava, com o texto dela), com a contagem no conflito e o caminho certo (estornar a contagem, desfazer, contar de novo).
  const d = s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { avisosAceitos: [], dados: { import_id: imp, justificativa: 'Arquivo errado' } }));
  assert.equal(d.ok, false, 'desfazer');
  assert.equal(d.erro.code, 'CONFLICT', JSON.stringify(d.erro).slice(0, 900));
  assert.ok(d.erro.details.some((x) => x.codigo === 'CONTAGEM_POSTERIOR' && /contagem do estoque de 01\/04\/2026 \(98 doses contados\).*de 98 doses para 99 doses.*desfaça a importação e conte de novo/.test(x.mensagem) && x.conflito && x.conflito.event_id === cont.event_id), JSON.stringify(d.erro).slice(0, 900));
  assert.equal(saldo(s, pid), 98);
  // A mesma aplicação, importada de novo com a data anterior à contagem: a linha fica com o motivo, nada entra.
  const imp2 = importar('2', csvDe('102'));
  const linhas = s.read(s.G.ImportService.consultaLinhas({ import_id: imp2, por_pagina: 50 })).itens;
  assert.equal(linhas[0].status, 'ERRO', JSON.stringify(linhas));
  assert.ok(JSON.stringify(linhas[0].erros).indexOf('CONTAGEM_POSTERIOR') >= 0, JSON.stringify(linhas[0].erros));
  // O saldo contado mexido à mão (o movimento do acerto): a verificação acusa a contagem, que não confere.
  const mv = tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: cont.event_id })[0];
  s.editar('MOVIMENTOS_ESTOQUE', mv.mov_id, 'quantidade', -5);
  const rel = s.integridade();
  assert.ok(rel.achados.some((a) => a.checagem === 'COPIAS' && /contagem de 01\/04\/2026.*98 doses.*94 doses/.test(a.mensagem)), JSON.stringify(rel.achados.map((a) => a.mensagem)));
});

/** Cria e valida uma importação de SANIDADE (CSV em texto); devolve {import_id, linhas}. */
function validarImportacao(s, chave, linhasCsv) {
  const csv = ['Data;Procedimento;Produto do cadastro;Como foi a dose;Dose do lançamento (por cabeça ou por kg);Quantidade que saiu do frasco;Brinco'].concat(linhasCsv).join('\n');
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar-' + chave, dados: { tipo: 'SANIDADE', arquivo_nome: chave + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
  const mapa = { colunas: c.sugestao, confiancas: {}, padroes: {} };
  for (let b = 1; b < 10; b++) {
    const est = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + chave + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
    if (est.importacao.status === 'VALIDADO') break;
  }
  return { import_id: c.import_id, linhas: s.read(s.G.ImportService.consultaLinhas({ import_id: c.import_id, por_pagina: 50 })).itens };
}

test('achado 3: na importação de sanidade com a quantidade que saiu do frasco, a linha já lançada fica DUPLICADA e as outras ficam com QUANTIDADE_EM_PARTE (por cabeça e só o total): o frasco não sai de novo; sem a quantidade, as outras entram com as doses delas', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['101', '102', '103']);
  const p = produto(s, { nome: 'Vacina P', custo_unitario: 1 });
  const pid = p.product_id;
  ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada');
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-03-10', [ids['101']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'vacinação do 101');
  assert.equal(saldo(s, pid), 99);
  [['cabeca', 'por cabeça;1'], ['total', 'só o total;']].forEach(([chave, modo]) => {
    const v = validarImportacao(s, chave, ['10/03/2026;vacinação;Vacina P;' + modo + ';3;101', '10/03/2026;vacinação;Vacina P;' + modo + ';3;102', '10/03/2026;vacinação;Vacina P;' + modo + ';3;103']);
    assert.deepEqual(v.linhas.map((l) => l.status), ['DUPLICADA', 'ERRO', 'ERRO'], chave);
    v.linhas.slice(1).forEach((l) => {
      assert.deepEqual(l.erros.map((x) => x.codigo), ['QUANTIDADE_EM_PARTE'], chave);
      assert.match(l.erros[0].mensagem, /a linha 2 já está na base\) e a quantidade que saiu do frasco \(3\) é do lançamento inteiro/);
    });
    ok(api(s, 'importacao.desfazer', { import_id: v.import_id, justificativa: 'arquivo revisto' }), 'desfazer ' + chave);
  });
  assert.equal(saldo(s, pid), 99, 'nada saiu do frasco');
  // Sem a quantidade do frasco: cada linha é a dose dela, e as que faltam entram.
  const v = validarImportacao(s, 'sem', ['10/03/2026;vacinação;Vacina P;por cabeça;1;;101', '10/03/2026;vacinação;Vacina P;por cabeça;1;;102', '10/03/2026;vacinação;Vacina P;por cabeça;1;;103']);
  assert.deepEqual(v.linhas.map((l) => l.status), ['DUPLICADA', 'VALIDA', 'VALIDA']);
  const ib = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: v.import_id, bloco: 1, modo: 'PARCIAL_APROVADO', aprovacao: { importar: 2, ignorar: 1 } } }));
  assert.ok(ib.ok, JSON.stringify(ib.erro));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: v.import_id } }));
  assert.equal(saldo(s, pid), 97);
  semErro(s, 'quantidade em parte');
});

test('achado 8: a entrada de estoque apagada à mão é fonte quebrada (COPIAS, sem reparo) pelo que a compra congelou (`com_movimento`): o produto entra na quarentena, a aplicação seguinte é recusada sem o conselho falso da compra antes do controle, e a correção da compra devolve o movimento', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['101', '102', '103']);
  const p = produto(s, { nome: 'Vacina P', custo_unitario: 1 });
  const pid = p.product_id;
  const ent = ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: pid, quantidade: 100, valor: 10000 })), 'entrada');
  assert.equal(s.tabela('EVENTOS').find((e) => e.event_id === ent.event_id).payload_json.com_movimento, true);
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-03-10', [ids['101'], ids['102']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 5 })), 'vacina');
  assert.equal(saldo(s, pid), 90);
  semErro(s, 'antes');
  s.apagarLinha('MOVIMENTOS_ESTOQUE', tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: ent.event_id })[0].mov_id);
  const rel = s.integridade();
  const copia = rel.achados.filter((a) => a.checagem === 'COPIAS');
  assert.equal(copia.length, 1, JSON.stringify(rel.achados));
  assert.match(copia[0].mensagem, /foi gravada com o movimento de entrada no estoque, que não está mais na planilha/);
  assert.deepEqual([rel.reparavel, typeof rel.reparo_impedido], [false, 'string'], 'o reparo não adota o saldo de -10');
  // A aplicação do produto noutro animal: recusada pela quarentena, e nenhum aviso diz que a compra foi "antes de ligar o controle".
  const e = recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-04-10', [ids['103']], { produto_id: pid, modo_dose: 'POR_CABECA', dose_referencia: 1 }), null, ['ESTOQUE_INSUFICIENTE']), 'CONFLICT', 'aplicação');
  assert.ok(cods(e).indexOf('INTEGRIDADE_COPIAS') >= 0, JSON.stringify(e.details));
  assert.doesNotMatch(JSON.stringify(e), /antes de ligar o controle/);
  assert.equal(saldo(s, pid), 90, 'o saldo gravado não é regravado a partir da fonte quebrada');
  const sem = s.exec((ctx) => s.G.UnitOfWork.read(ctx, { rota: 't', reads: ['FINANCEIRO', 'MOVIMENTOS_ESTOQUE', 'EVENTOS'], tratador: (tx) => s.G.HealthService.compraSemMovimento(tx.repo, pid) })).dados;
  assert.equal(sem, false, 'a compra com o movimento apagado não é a compra de antes do controle');
  // A correção da compra (o mesmo produto) grava o movimento como o original congelou.
  const c = ok(api(s, 'evento.corrigir', Object.assign({ event_id: ent.event_id, justificativa: 'refaz a entrada apagada' }, estoque('ENTRADA', '2026-02-01', { product_id: pid, quantidade: 100, valor: 10000, documento: 'NF 1' }))), 'correção da compra');
  assert.deepEqual(vigentes(s, 'MOVIMENTOS_ESTOQUE', { event_id: c.event_id }).map((m) => [m.tipo, m.quantidade]), [['ENTRADA', 100]]);
  assert.equal(saldo(s, pid), 90);
  semErro(s, 'corrigida');
  // A compra sem o controle grava `com_movimento: false`, e o movimento posto à mão nela é acusado.
  const q = produto(s, { nome: 'Vacina Q', custo_unitario: 1, controla_estoque: false });
  const e2 = ok(api(s, 'evento.registrar', estoque('ENTRADA', '2026-02-01', { product_id: q.product_id, quantidade: 10, valor: 1000 })), 'entrada sem controle');
  assert.equal(s.tabela('EVENTOS').find((x) => x.event_id === e2.event_id).payload_json.com_movimento, false);
});

test('achado 9: o produto do cadastro sem custo por unidade é avisado na revisão da entrada e na da aplicação (o que foi pago nunca vira custo); com o custo preenchido no cadastro, a aplicação seguinte vira custo', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const ids = rebanho(s, ['101', '102']);
  const p = produto(s, { nome: 'Vacina sem custo' });
  const ent = estoque('ENTRADA', '2026-04-01', { product_id: p.product_id, quantidade: 100, valor: 30000 });
  const simE = ok(api(s, 'evento.simular', { acao: 'registrar', dados: ent }), 'simulação da entrada');
  assert.deepEqual([simE.impactos.estoque.produto_sem_custo, simE.impactos.estoque.custo_unitario], [true, 3]);
  ok(api(s, 'evento.registrar', ent), 'entrada');
  const vac = san('VACINACAO', '2026-04-05', [ids['101'], ids['102']], { produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 });
  const simV = ok(api(s, 'evento.simular', { acao: 'registrar', dados: vac }), 'simulação da aplicação');
  assert.deepEqual(simV.impactos.sanidade.consumo, { custo_unitario: null, valor: 0 }, 'sem custo, dito na revisão');
  // O caminho: o custo por unidade no cadastro; a aplicação seguinte vira custo (a entrada já gravada não muda).
  ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { custo_unitario: 3 }, justificativa: 'custo da compra' }), 'custo no cadastro');
  const simE2 = ok(api(s, 'evento.simular', { acao: 'registrar', dados: estoque('ENTRADA', '2026-04-02', { product_id: p.product_id, quantidade: 10, valor: 3000 }) }));
  assert.equal(simE2.impactos.estoque.produto_sem_custo, false);
  const r = ok(api(s, 'evento.registrar', vac), 'aplicação');
  assert.deepEqual(tab(s, 'FINANCEIRO', { event_id: r.event_id }).map((f) => f.valor), [600]);
  semErro(s, 'sem custo');
});
