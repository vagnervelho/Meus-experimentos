'use strict';
/**
 * Telas da Fase 2 no Node (E2.1 a E2.7 na tela), com os scripts do cliente da página montada pelo doGet real e o
 * servidor real do harness: as peças puras da grade de animais novos e das parcelas (brincos em série, linhas coladas de
 * planilha, vencimentos), que o servidor aceita como o formulário as converte e divide em partes iguais; o campo de
 * cabeçalho do subtipo (motivo do descarte) e o tipo de identificação pelo subtipo; o pré-preenchimento da correção de
 * IDENTIFICACAO, MARCACAO e de cada subtipo de AJUSTE_INVENTARIO, que, montado como o formulário monta, não tem diferença
 * para o original, é aceito pelo servidor e reproduz o original (projeção = reconstrução depois de cada comando); o que
 * a revisão do estorno mostra do financeiro; o motivo da baixa por divergência no evento e na trilha. Os fluxos em
 * navegador estão em tests/ui/eventos.fase2.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const { api, cliente, storeDe } = require('./apoio-telas');

const { js, PASTOS } = S;
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Sistema com o rebanho do apoio de tela: 0457 e 0391 (fêmeas), 12 (macho), uma bezerra sem brinco. */
function montar() {
  const s = S.sistema();
  const sem = api(s, { rota: 'evento.registrar', idempotencyKey: 'sem', dados: S.entradaInicial([
    S.bicho({ brinco: '0457', data_nascimento: '2023-02-02', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '0391', pasto_destino_id: PASTOS.B, data_nascimento: '2022-05-10', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '12', sexo: 'M', data_nascimento: '2025-03-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ data_nascimento: '2025-09-12', data_nascimento_confianca: 'CONFIRMADA' }),
  ]) });
  assert.equal(sem.ok, true, JSON.stringify(sem.error));
  const id = (b) => sem.data.animais.find((x) => (b ? x.brinco === b : !x.brinco)).animal_id;
  return { s, id };
}
function registrar(s, dados, chave) {
  const r = api(s, { rota: 'evento.registrar', idempotencyKey: chave, dados });
  assert.equal(r.ok, true, chave + ': ' + JSON.stringify(r.error));
  s.conferirProjecoes(chave);
  return r.data;
}
/** A sessão do formulário (como Registro.abrir monta) a partir de um pré-preenchimento. */
function sessao(st, tipo, previa) {
  const def = st.tipoEvento(tipo);
  return {
    tipo, def, subtipo: previa.subtipo || null, campos: clone(previa.campos || {}), grupos: {}, justificativaAviso: '',
    linhas: (previa.linhas || []).map((l, i) => ({ uid: 'l' + i, animal_id: l.animal_id || null, criado: !!l.criado, valores: clone(l.valores || {}), erros: [] })),
    corrige: previa.corrige ? clone(previa.corrige) : null, justificativaCorrecao: previa.corrige ? 'Conferência' : '',
  };
}

test('grade de animais novos: brincos em série, linhas coladas de planilha (cabeçalho, separadores, formatos, problemas por linha) e vencimentos das parcelas', () => {
  const { s } = montar();
  const c = cliente(s);
  c.Store = storeDe(s);
  const R = c.Registro;
  assert.deepEqual(js(R.serieBrincos('0301', 20)).brincos, Array.from({ length: 20 }, (_, i) => '03' + String(i + 1).padStart(2, '0')));
  assert.deepEqual(js(R.serieBrincos('L-09', 3)).brincos, ['L-09', 'L-10', 'L-11'], 'prefixo e zeros à esquerda ficam');
  assert.deepEqual(js(R.serieBrincos('99', 2)).brincos, ['99', '100']);
  assert.deepEqual(js(R.serieBrincos('', 2)).brincos, [null, null], 'sem brinco');
  assert.match(R.serieBrincos('ABC', 2).erro, /terminar em número/);
  assert.match(R.serieBrincos('1', 0).erro, /de 1 a 1\.000/);
  assert.match(R.serieBrincos('1', 1001).erro, /de 1 a 1\.000/);
  const r = js(R.lerColagem([
    'Brinco\tSexo\tIdade ou nascimento\tPeso\tValor', '',
    '0612\tmacho\t14\t240.5\t2.600,00', '0613;Fêmea;1/2/2025;230;', '0614\tf\t\t\t',
    '612\tM\t14', '0615\tX\t31/02/2025\t0\tabc', '0616\tM\t14\t12,34\t\textra', '0617\tM\tdoze',
  ].join('\n')));
  assert.equal(r.cabecalho, true);
  assert.deepEqual(r.animais, [
    { brinco: '0612', sexo: 'M', idade_meses: '14', peso: '240.5', valor: '2.600,00' },
    { brinco: '0613', sexo: 'F', data_nascimento: '2025-02-01', peso: '230' },
    { brinco: '0614', sexo: 'F' },
  ]);
  assert.deepEqual(r.problemas.map((p) => p.linha), [6, 7, 8, 9], 'o número da linha colada');
  assert.match(r.problemas[0].mensagem, /^Linha 6: brinco 612 repetido \(linha 3\)\.$/, '612 = 0612 (zeros à esquerda)');
  assert.match(r.problemas[1].mensagem, /sexo "X" não reconhecido.*idade ou nascimento "31\/02\/2025" não reconhecido.*peso "0": precisa ser maior que zero.*valor "abc"/);
  assert.match(r.problemas[2].mensagem, /mais de 5 colunas; peso "12,34": Use no máximo 1 casa decimal/);
  assert.match(r.problemas[3].mensagem, /idade ou nascimento "doze"/);
  assert.deepEqual(js(R.lerColagem('0001\tM')).cabecalho, false, 'sem cabeçalho, a primeira linha é animal');
  assert.deepEqual(js(R.vencimentos('2026-01-31', 3, 'MES')), ['2026-01-31', '2026-02-28', '2026-03-31'], 'mesmo dia, ou o último do mês');
  assert.deepEqual(js(R.vencimentos('2026-03-05', 2, 'MES')), ['2026-03-05', '2026-04-05']);
  assert.deepEqual(js(R.vencimentos('2026-01-31', 3, 'D30')), ['2026-01-31', '2026-03-02', '2026-04-01']);
  assert.deepEqual(js(R.vencimentos('2026-12-28', 2, 'D7')), ['2026-12-28', '2027-01-04']);
  assert.deepEqual(js(R.vencimentos('31/01/2026', 2, 'MES')), [], 'data fora do formato: nada');
  // O que a grade produz, convertido como o formulário converte, o servidor aceita; parcelas sem valor = divisão igual.
  const st = storeDe(s);
  const def = st.tipoEvento('COMPRA');
  const forn = api(s, { rota: 'parceiro.salvar', idempotencyKey: 'f', dados: { campos: { nome: 'Fornecedor', tipos: ['FORNECEDOR'] } } }).data.partner_id;
  const linhas = r.animais.map((a, i) => ({ uid: 'l' + i, animal_id: null, valores: Object.assign({ brinco: a.brinco, sexo: a.sexo, peso: a.peso || null, data_nascimento: a.data_nascimento || null, idade_meses: a.idade_meses || null }, a.sexo === 'M' ? { castrado: false, reprodutor: false } : {}, a.data_nascimento ? { data_nascimento_confianca: 'CONFIRMADA' } : {}), erros: [] }));
  const sess = { tipo: 'COMPRA', def, subtipo: null, linhas, justificativaAviso: '', corrige: null,
    campos: { event_date: '2026-02-05', partner_id: forn, modalidade: 'LOTE', criterio_rateio: 'CABECAS', valor_animais: '9.400,00', pasto_destino_id: PASTOS.B },
    grupos: { parcelas: R.vencimentos('2026-03-05', 3, 'MES').map((d, i) => ({ uid: 'p' + i, valores: { data_vencimento: d } })), custos: [] } };
  const m = js(R.montarDados(sess));
  assert.deepEqual(m.erros, []);
  assert.deepEqual(m.dados.parcelas, [{ data_vencimento: '2026-03-05' }, { data_vencimento: '2026-04-05' }, { data_vencimento: '2026-05-05' }].map((p) => Object.assign(p, { valor: null, forma_pagamento: null, documento: null })));
  const sim = api(s, { rota: 'evento.simular', dados: { acao: 'registrar', dados: m.dados } });
  assert.equal(sim.ok, true, JSON.stringify(sim.error));
  assert.deepEqual(sim.data.impactos.financeiro.lancamentos[0].parcelas.map((p) => p.valor), [313334, 313333, 313333], 'o servidor divide: 9.400,00 em 3');
  assert.deepEqual(sim.data.impactos.financeiro.por_animal.map((x) => x.valor), [313334, 313333, 313333]);
  registrar(s, m.dados, 'compra-grade');
});

test('subtipo no formulário: o campo de cabeçalho do subtipo vai no pedido só no subtipo dele; o brinco do vendedor só na retirada', () => {
  const { s, id } = montar();
  const c = cliente(s);
  const st = storeDe(s);
  c.Store = st;
  const R = c.Registro;
  const marca = sessao(st, 'MARCACAO', { subtipo: 'DESCARTE', campos: { event_date: '2026-03-01', acao: 'MARCAR', motivo_descarte: 'IDADE' }, linhas: [{ animal_id: id('0457') }] });
  let m = js(R.montarDados(marca));
  assert.deepEqual([m.erros, m.dados.subtipo, m.dados.campos.motivo_descarte], [[], 'DESCARTE', 'IDADE']);
  registrar(s, m.dados, 'marca-descarte');
  // Não localizado: o subtipo não tem o motivo; o que ficou digitado não vai (o servidor recusaria CAMPO_DESCONHECIDO).
  const nao = sessao(st, 'MARCACAO', { subtipo: 'NAO_LOCALIZADO', campos: { event_date: '2026-03-02', acao: 'MARCAR', motivo_descarte: 'IDADE' }, linhas: [{ animal_id: id('0391') }] });
  m = js(R.montarDados(nao));
  assert.equal(Object.prototype.hasOwnProperty.call(m.dados.campos, 'motivo_descarte'), false);
  registrar(s, m.dados, 'marca-nao-localizado');
  // Desmarcar: o motivo some com a ação (visivel_se).
  const des = sessao(st, 'MARCACAO', { subtipo: 'DESCARTE', campos: { event_date: '2026-03-03', acao: 'DESMARCAR', motivo_descarte: 'IDADE' }, linhas: [{ animal_id: id('0457') }] });
  m = js(R.montarDados(des));
  assert.equal(m.dados.campos.motivo_descarte, undefined);
  registrar(s, m.dados, 'desmarca');
  // Sem subtipo: a pergunta é a do tipo.
  assert.match(js(R.montarDados(sessao(st, 'IDENTIFICACAO', { campos: { event_date: '2026-03-04' }, linhas: [{ animal_id: id('12') }] }))).erros[0].mensagem, /Escolha uma opção em "O que fazer"/);
  // O brinco do vendedor não é opção na primeira identificação nem na troca; na retirada é.
  const prim = js(R.montarDados(sessao(st, 'IDENTIFICACAO', { subtipo: 'PRIMEIRA_IDENTIFICACAO', campos: { event_date: '2026-03-04', tipo_identificacao: 'BRINCO_ORIGEM' }, linhas: [{ animal_id: id(null), valores: { codigo: 'V-1' } }] })));
  assert.deepEqual(prim.erros.map((e) => [e.campo, e.mensagem]), [['tipo_identificacao', 'Escolha uma das opções da lista.']]);
  const srv = api(s, { rota: 'evento.simular', dados: { acao: 'registrar', dados: { tipo: 'IDENTIFICACAO', subtipo: 'PRIMEIRA_IDENTIFICACAO', campos: { event_date: '2026-03-04', tipo_identificacao: 'BRINCO_ORIGEM' }, animais: [{ animal_id: id(null), codigo: 'V-1' }] } } });
  assert.deepEqual([srv.error.code, srv.error.details[0].codigo], ['VALIDATION', 'TIPO_NAO_SE_APLICA'], 'a mesma regra no servidor');
  const rem = js(R.montarDados(sessao(st, 'IDENTIFICACAO', { subtipo: 'REMOCAO', campos: { event_date: '2026-03-04', tipo_identificacao: 'BRINCO' }, linhas: [{ animal_id: id('12'), valores: { motivo: 'DANIFICADO' } }] })));
  assert.deepEqual(rem.erros, []);
  registrar(s, rem.dados, 'retirada');
});

test('correção de identificação, marcação e de cada ajuste: o pré-preenchimento, montado como o formulário monta, não tem diferença, é aceito e reproduz o original; com uma mudança, a diferença diz o quê', () => {
  const { s, id } = montar();
  const c = cliente(s);
  const cat = storeDe(s).b.categorias.find((x) => x.codigo === 'NOVILHA_24_MAIS').category_id;
  const casos = [
    { tipo: 'IDENTIFICACAO', subtipo: 'PRIMEIRA_IDENTIFICACAO', campos: { event_date: '2026-03-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: id(null), codigo: '0500', observacoes: 'brinco novo' }] },
    { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-03-02', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: id('0457'), codigo: '0458', motivo: 'PERDA' }] },
    { tipo: 'IDENTIFICACAO', subtipo: 'REMOCAO', campos: { event_date: '2026-03-03', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: id('12'), motivo: 'DANIFICADO' }] },
    { tipo: 'MARCACAO', subtipo: 'DESCARTE', campos: { event_date: '2026-03-04', acao: 'MARCAR', motivo_descarte: 'IDADE' }, animais: [{ animal_id: id('0457'), observacoes: 'velha' }] },
    { tipo: 'MARCACAO', subtipo: 'NAO_LOCALIZADO', campos: { event_date: '2026-03-05', acao: 'MARCAR' }, animais: [{ animal_id: id('0391') }] },
    { tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: '2026-03-06', justificativa: 'Já é novilha de sobreano' }, animais: [{ animal_id: id('0457'), categoria_manual_id: cat }] },
    { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-03-07', justificativa: 'Nascimento conferido' }, animais: [{ animal_id: id('0391'), campo: 'data_nascimento', valor_novo: '2022-06-10' }, { animal_id: id('0391'), campo: 'data_nascimento_confianca', valor_novo: 'CONFIRMADA' }] },
    { tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: '2026-03-08', justificativa: 'Número trocado' }, animais: [{ animal_id: id(null), brinco: '0501' }] },
    { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: '2026-03-09', justificativa: 'Estava no B' }, animais: [{ animal_id: id('0457'), pasto_destino_id: PASTOS.B }] },
    { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos: { event_date: '2026-03-10', justificativa: 'Contagem de março' }, animais: [{ animal_id: id('12'), observacoes: 'faltou no curral' }] },
  ];
  /** O que o lançamento gravou, sem os ids das linhas e do evento (o substituto deve repetir). */
  const fatos = (evId) => {
    const t = (aba, cols) => s.tabela(aba).filter((x) => x.event_id === evId).map((x) => cols.map((k) => x[k]));
    const ev = s.tabela('EVENTOS').find((x) => x.event_id === evId);
    const p = Object.assign({}, ev.payload_json || {});
    delete p.justificativa;
    return { sub: ev.event_subtype, data: ev.event_date, payload: p,
      ea: t('EVENTO_ANIMAIS', ['animal_id', 'efeito_inventario', 'pasto_origem_id', 'pasto_destino_id', 'observacoes']),
      id: t('IDENTIFICACOES', ['animal_id', 'tipo', 'codigo', 'motivo', 'data_inicio', 'data_fim']),
      aj: t('AJUSTES', ['animal_id', 'tipo_ajuste', 'campo', 'valor_anterior', 'valor_novo', 'justificativa']),
      bx: t('BAIXAS', ['animal_id', 'tipo', 'observacoes']) };
  };
  casos.forEach((dados, k) => {
    const nome = dados.tipo + '/' + dados.subtipo;
    const orig = registrar(s, dados, 'orig-' + k);
    const st = storeDe(s);
    c.Store = st;
    const obter = api(s, { rota: 'evento.obter', dados: { event_id: orig.event_id } }).data;
    const previa = js(c.TelaEventos.previaCorrecao(obter));
    assert.equal(previa.subtipo, dados.subtipo, nome);
    const sess = sessao(st, dados.tipo, previa);
    assert.deepEqual(js(c.Registro.diferencas(sess)), [], nome + ': sem mudança, nenhuma diferença');
    const m = js(c.Registro.montarDados(sess));
    assert.deepEqual(m.erros, [], nome);
    const sim = api(s, { rota: 'evento.simular', dados: { acao: 'corrigir', dados: m.dados } });
    assert.equal(sim.ok, true, nome + ': ' + JSON.stringify(sim.error));
    const antes = fatos(orig.event_id);
    const corr = api(s, { rota: 'evento.corrigir', idempotencyKey: 'corr-' + k, dados: m.dados });
    assert.equal(corr.ok, true, nome + ': ' + JSON.stringify(corr.error));
    assert.deepEqual(fatos(corr.data.event_id), antes, nome + ': o substituto reproduz o original');
    s.conferirProjecoes('correção ' + nome);
  });
  // Com uma mudança: a segunda correção de cadastro (um item por campo) é comparada item a item.
  const st = storeDe(s);
  c.Store = st;
  const ultimoCadastro = s.tabela('EVENTOS').filter((e) => e.event_subtype === 'CORRECAO_CADASTRO' && e.status === 'CONFIRMADO')[0];
  const previa = js(c.TelaEventos.previaCorrecao(api(s, { rota: 'evento.obter', dados: { event_id: ultimoCadastro.event_id } }).data));
  assert.deepEqual(previa.linhas.map((l) => l.valores), [{ campo: 'data_nascimento', valor_novo: '2022-06-10' }, { campo: 'data_nascimento_confianca', valor_novo: 'CONFIRMADA' }]);
  const sess = sessao(st, 'AJUSTE_INVENTARIO', previa);
  sess.linhas[1].valores.valor_novo = 'ESTIMADA';
  assert.deepEqual(js(c.Registro.diferencas(sess)), ['0391: valor correto de Confirmada para Estimada']);
  sess.linhas.pop();
  assert.deepEqual(js(c.Registro.diferencas(sess)), ['0391: 1 correção a menos']);
});

test('revisão do estorno: o financeiro que deixa de valer (lançamentos, valor, títulos em aberto); sem financeiro, nada', () => {
  const { s, id } = montar();
  const forn = api(s, { rota: 'parceiro.salvar', idempotencyKey: 'f', dados: { campos: { nome: 'F1', tipos: ['FORNECEDOR'] } } }).data.partner_id;
  const compra = registrar(s, { tipo: 'COMPRA', campos: { event_date: '2026-02-05', partner_id: forn, modalidade: 'CABECA', preco_unitario: 250000, valor_animais: 500000, pasto_destino_id: PASTOS.B },
    animais: ['0301', '0302'].map((b) => ({ brinco: b, sexo: 'M', castrado: false, reprodutor: false })), parcelas: [{ data_vencimento: '2026-03-05' }, { data_vencimento: '2026-04-05' }], custos: [{ tipo: 'FRETE', valor: 12000 }] }, 'compra');
  const e = api(s, { rota: 'evento.simular', dados: { acao: 'estornar', dados: { event_id: compra.event_id, justificativa: 'Errada' } } });
  assert.equal(e.ok, true, JSON.stringify(e.error));
  assert.deepEqual(e.data.impactos.cancelados, { lancamentos: 2, total: 512000, parcelas_abertas: 3 });
  const tr = registrar(s, { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: id('0457') }] }, 'tr');
  assert.equal(api(s, { rota: 'evento.simular', dados: { acao: 'estornar', dados: { event_id: tr.event_id, justificativa: 'x' } } }).data.impactos.cancelados, null);
  // Na tela: a revisão do estorno mostra esse resumo (e nada de financeiro quando não há).
  const c = cliente(s);
  c.Store = Object.assign(storeDe(s), { tipoEvento: (t) => ({ COMPRA: { rotulo: 'Comprar animais' } })[t] || null });
  const linhas = js(c.Registro.impactosServidor({ simulacao: e.data }));
  assert.deepEqual(linhas.map((l) => l[0]), ['Será desfeito', 'Animais do evento', 'Animais que deixam de existir', 'Financeiro cancelado']);
  assert.match(linhas[3][1], /^2 lançamentos \(R\$\s5\.120,00\), com 3 títulos em aberto deixam de valer$/);
});

test('baixa por divergência: o porquê do lançamento fica no evento (não há AJUSTES) e aparece na trilha; o subtipo é crítico no catálogo', () => {
  const { s, id } = montar();
  const ev = registrar(s, { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos: { event_date: '2026-03-10', justificativa: 'Contagem de março' }, animais: [{ animal_id: id('12'), observacoes: 'faltou no curral' }] }, 'div');
  const linha = s.tabela('EVENTOS').find((x) => x.event_id === ev.event_id);
  assert.deepEqual(linha.payload_json, { motivo_ajuste: 'Contagem de março' });
  assert.equal(s.tabela('BAIXAS').find((x) => x.event_id === ev.event_id).observacoes, 'faltou no curral');
  const t = api(s, { rota: 'auditoria.listar', dados: { entidade: 'EVENTOS', acao: 'REGISTRAR' } }).data;
  assert.equal(t.itens.find((x) => x.event_id === ev.event_id).justificativa, 'Contagem de março');
  // Sem observação do animal, o motivo também vai para BAIXAS (como antes) e fica no evento.
  const ev2 = registrar(s, { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos: { event_date: '2026-03-11', justificativa: 'Contagem de março, pasto B' }, animais: [{ animal_id: id('0391') }] }, 'div2');
  assert.equal(s.tabela('BAIXAS').find((x) => x.event_id === ev2.event_id).observacoes, 'Contagem de março, pasto B');
  // Outros ajustes guardam o porquê em AJUSTES: o payload não muda.
  const rc = registrar(s, { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: '2026-03-12', justificativa: 'Estava no B' }, animais: [{ animal_id: id('0457'), pasto_destino_id: PASTOS.B }] }, 'loc');
  assert.equal(s.tabela('EVENTOS').find((x) => x.event_id === rc.event_id).payload_json, null);
  const sub = js(s.G.EventCatalog.serializar()).tipos.find((x) => x.tipo === 'AJUSTE_INVENTARIO').subtipos;
  assert.deepEqual(Object.keys(sub).filter((k) => sub[k].critico), ['DIVERGENCIA_CONTAGEM'], 'a baixa por divergência é operação crítica (08, 4.6)');
});
