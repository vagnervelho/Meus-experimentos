'use strict';
/**
 * AnimalService: lista leve colunar, ficha (blocos A a J), árvore genealógica, categoria e idade na leitura,
 * edição em um formulário (AUDITORIA + AJUSTE_INVENTARIO/CORRECAO_CADASTRO na mesma operação, refeita pela
 * recuperação) e cadastro de animal EXTERNO.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio-cadastros');
const P = require('./apoio-persistencia');

const { ambienteCadastros, codigos, bicho, entradaInicial, ajuste, PASTOS, js } = A;

/** Rebanho de família: avó → mãe → filha; garrote, touro, novilha nova; bezerra sem brinco, filha de touro EXTERNO. */
function rebanho(opcoes) {
  const c = ambienteCadastros(opcoes);
  const ext = c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'Touro REM Bitelo (sêmen)', sexo: 'M', raca: 'NELORE', data_nascimento: '2015-06-01', data_nascimento_confianca: 'ESTIMADA' } });
  const conf = 'CONFIRMADA';
  c.m.run('registrar', entradaInicial([
    bicho({ brinco: '0102', ref: 'avo', data_nascimento: '2016-03-10', data_nascimento_confianca: conf, partos_previos: 4, raca: 'NELORE' }),
    bicho({ brinco: '0310', ref: 'mae', data_nascimento: '2020-02-01', data_nascimento_confianca: 'ESTIMADA', mae_ref: 'avo', mae_confianca: conf, partos_previos: 1 }),
    bicho({ brinco: '0457', data_nascimento: '2024-05-10', data_nascimento_confianca: conf, mae_ref: 'mae', mae_confianca: 'ESTIMADA', partos_previos: 0 }),
    bicho({ brinco: '0520', sexo: 'M', data_nascimento: '2025-03-20', data_nascimento_confianca: conf, pasto_destino_id: PASTOS.B }),
    bicho({ brinco: '0600', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'ESTIMADA' }),
    bicho({ brinco: '0700', data_nascimento: '2025-02-15', data_nascimento_confianca: conf }),
    bicho({ data_nascimento: '2025-12-20', data_nascimento_confianca: conf, mae_ref: 'mae', mae_confianca: conf, pai_id: ext.dados.animal_id, pai_confianca: 'ESTIMADA' }),
  ]));
  const por = (b) => c.m.porBrinco(b);
  const bezerra = c.tabela('ANIMAIS').find((a) => !a.brinco && a.situacao_cadastral === 'ATIVO');
  return { c, ext: ext.dados.animal_id, por, bezerra };
}
function colunas(r) {
  const out = [];
  for (let i = 0; i < r.n; i++) {
    const o = {};
    r.colunas.forEach((k) => { o[k] = r.valores[k][i]; });
    out.push(o);
  }
  return out;
}
function nomeCategoria(c, id) {
  const cat = c.tabela('CATEGORIAS').find((x) => x.category_id === id);
  return cat ? cat.codigo : null;
}

test('carga inicial colunar: ATIVOS e EXTERNOS, com idade e categoria calculadas na leitura', () => {
  const { c, ext } = rebanho();
  const r = c.ler(c.G.AnimalService.consultaCargaInicial());
  assert.equal(r.n, 8);
  assert.deepEqual(r.colunas, js(c.G.AnimalService.COLUNAS_LEVE));
  r.colunas.forEach((k) => assert.equal(r.valores[k].length, 8, 'cada coluna tem uma posição por animal: ' + k));
  const linhas = colunas(r);
  const por = {};
  linhas.forEach((l) => { por[l.brinco || (l.situacao_cadastral === 'EXTERNO' ? 'externo' : 'bezerra')] = l; });
  const cat = (k) => nomeCategoria(c, por[k].categoria_id);
  assert.deepEqual(['0102', '0310', '0457', '0520', '0600', '0700', 'bezerra'].map(cat),
    ['VACA', 'VACA', 'NOVILHA_24_MAIS', 'GARROTE', 'TOURO', 'NOVILHA_12_24', 'BEZERRA'], 'categoria por idade, sexo e condição (parida, reprodutor)');
  assert.deepEqual([por['0457'].idade_meses, por['0520'].idade_meses, por.bezerra.idade_meses], [30, 19, 10], 'meses completos em 13/11/2026');
  assert.equal(por.externo.animal_id, ext);
  assert.deepEqual([por.externo.situacao_cadastral, por.externo.categoria_id, por.externo.pasto_atual_id], ['EXTERNO', null, null], 'externo fica fora do inventário e das categorias');
  assert.equal(por['0520'].pasto_atual_id, PASTOS.B);
  assert.equal(por['0102'].categoria_manual, false);
  assert.equal(por['0457'].peso_vencido, null, 'sem pesagem, "vencido" não se aplica');

  const baixados = c.ler(c.G.AnimalService.consultaListar());
  assert.equal(baixados.n, 0, 'baixados vêm sob demanda; nesta base não há');
  assert.equal(c.ler(c.G.AnimalService.consultaListar({ situacoes: ['ATIVO'] })).n, 7);
  const r2 = c.gas.tentar(() => c.G.UnitOfWork.read(c.amb.ctx(), c.G.AnimalService.consultaListar({ situacoes: ['ANULADO'] })));
  assert.equal(r2.erro.code, 'VALIDATION', 'anulado e pendente nunca aparecem');
});

test('categoria na data D: idade, castração e parto valem na data; sem nascimento só casa categoria sem idade', () => {
  const { c, por } = rebanho();
  const ids = { garrote: por('0520').animal_id, novilha: por('0457').animal_id, n0700: por('0700').animal_id };
  const em = (id, data) => c.lerCom(c.G.AnimalService.leituras(), (tx, G) => {
    const L = G.AnimalService.leitor(tx);
    const cat = G.AnimalService.categoriaEm(L, tx.repo.porId('ANIMAIS', id), data);
    return cat ? cat.codigo : null;
  });
  assert.deepEqual([em(ids.garrote, '2026-01-01'), em(ids.garrote, '2026-03-20'), em(ids.novilha, '2026-01-01'), em(ids.n0700, '2026-01-01')],
    ['BEZERRO', 'GARROTE', 'NOVILHA_12_24', 'BEZERRA'], 'a idade muda a categoria sem regravar nada');
  // Corrigir o nascimento para desconhecido: só categorias sem faixa de idade casam → "sem categoria" para a fêmea não parida.
  c.m.run('registrar', ajuste('CORRECAO_CADASTRO', '2026-11-13', [{ animal_id: ids.novilha, campo: 'data_nascimento', valor_novo: '' }]));
  assert.equal(em(ids.novilha, '2026-11-13'), null);
  const perfil = c.lerCom(c.G.AnimalService.leituras(), (tx, G) => G.AnimalService.perfilEm(G.AnimalService.leitor(tx), tx.repo.porId('ANIMAIS', por('0310').animal_id), '2026-11-13'));
  assert.deepEqual(perfil, { sexo: 'F', data_nascimento: '2020-02-01', castrado: null, reprodutor: null, parida: true, categoria_modo: 'AUTO', categoria_manual_id: null });
});

test('ficha: blocos A a J, árvore genealógica até N gerações, crias, pastos e linha do tempo', () => {
  const { c, ext, por, bezerra } = rebanho();
  const f = c.ler(c.G.AnimalService.consultaFicha({ animal_id: bezerra.animal_id }));
  assert.deepEqual(Object.keys(f).sort(), ['anexos', 'animal_id', 'data', 'eventos', 'financeiro', 'genealogia', 'geral', 'localizacao', 'pastos', 'peso', 'reprodutivo', 'sanitario'].sort());
  for (const b of ['peso', 'sanitario', 'financeiro']) {
    assert.equal(f[b].entregue, false, b + ': módulo não entregue');
    assert.deepEqual(f[b].itens, []);
    assert.ok(f[b].fase > 1 && typeof f[b].modulo === 'string' && /próxima etapa/.test(f[b].mensagem));
  }
  for (const b of ['geral', 'genealogia', 'localizacao', 'pastos', 'eventos', 'anexos']) assert.equal(f[b].entregue, true, b);
  // G: na Fase 2 só a parte de partos; o resto chega com a reprodução (Fase 3), e a ficha diz isso.
  assert.deepEqual([f.reprodutivo.entregue, f.reprodutivo.parcial, f.reprodutivo.pendente.fase, f.reprodutivo.aplica, f.reprodutivo.partos_registrados, f.reprodutivo.n_partos], [true, true, 3, true, 0, 0]);
  assert.deepEqual([f.geral.codigo_interno, f.geral.brinco, f.geral.idade_meses, f.geral.categoria.codigo, f.geral.sem_categoria], [bezerra.codigo_interno, null, 10, 'BEZERRA', false]);
  // B: bezerra → mãe 0310 (confirmada) → avó 0102; pai externo (estimado).
  const g = f.genealogia;
  assert.equal(g.sem_genealogia, false);
  assert.deepEqual([g.mae.brinco, g.mae.confirmado, g.pai.animal_id, g.pai.confianca, g.pai.situacao_cadastral], ['0310', true, ext, 'ESTIMADA', 'EXTERNO']);
  assert.deepEqual([g.arvore.mae.mae.brinco, g.arvore.mae.mae.geracao, g.arvore.mae.mae.mae], ['0102', 2, null]);
  const curta = c.ler(c.G.AnimalService.consultaFicha({ animal_id: bezerra.animal_id, geracoes: 1 })).genealogia;
  assert.deepEqual([curta.mae.brinco, curta.mae.mae, curta.mae.tem_ancestrais], ['0310', null, true], 'com 1 geração a árvore para nos pais');
  const avo = c.ler(c.G.AnimalService.consultaFicha({ animal_id: por('0102').animal_id }));
  assert.equal(avo.genealogia.sem_genealogia, true, 'sem mãe nem pai: "sem genealogia registrada"');
  assert.deepEqual(avo.genealogia.filhos.map((x) => [x.brinco, x.papel]), [['0310', 'MAE']]);
  const mae = c.ler(c.G.AnimalService.consultaFicha({ animal_id: por('0310').animal_id })).genealogia;
  assert.deepEqual(mae.filhos.map((x) => x.brinco || x.codigo_interno), ['0457', bezerra.codigo_interno], 'todos os bezerros de uma matriz');
  const touro = c.ler(c.G.AnimalService.consultaFicha({ animal_id: ext }));
  assert.deepEqual(touro.genealogia.filhos.map((x) => [x.animal_id, x.papel]), [[bezerra.animal_id, 'PAI']]);
  assert.equal(touro.geral.categoria, null);
  // C, D, I: correção de localização gera um segundo período; a linha do tempo traz os dois lançamentos.
  c.m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-06-01', [{ animal_id: bezerra.animal_id, pasto_destino_id: PASTOS.C }]));
  const f2 = c.ler(c.G.AnimalService.consultaFicha({ animal_id: bezerra.animal_id }));
  assert.deepEqual(f2.pastos.periodos.map((p) => [p.pasto_nome, p.inicio, p.fim, p.dias, p.em_andamento]), [['Pasto A', '2026-01-01', '2026-06-01', 151, false], ['Pasto C', '2026-06-01', null, 165, true]]);
  assert.deepEqual([f2.localizacao.pasto_nome, f2.localizacao.desde, f2.localizacao.propriedade_nome], ['Pasto C', '2026-06-01', 'Fazenda Boa Vista']);
  assert.deepEqual(f2.eventos.itens.map((e) => [e.event_type, e.event_subtype, e.status]), [['ENTRADA_INICIAL', null, 'CONFIRMADO'], ['AJUSTE_INVENTARIO', 'CORRECAO_LOCALIZACAO', 'CONFIRMADO']]);
  c.m.run('estornar', { event_id: f2.eventos.itens[1].event_id, justificativa: 'Lançado no animal errado' });
  const f3 = c.ler(c.G.AnimalService.consultaFicha({ animal_id: bezerra.animal_id }));
  assert.deepEqual(f3.eventos.itens.map((e) => [e.event_type, e.vigente, !!e.anulado_por]), [['ENTRADA_INICIAL', true, false], ['AJUSTE_INVENTARIO', false, true]], 'estornado aparece riscado');
  assert.equal(f3.pastos.periodos.length, 1);
  // Erros da consulta.
  const t = (d) => c.gas.tentar(() => c.G.UnitOfWork.read(c.amb.ctx(), c.G.AnimalService.consultaFicha(d)));
  assert.equal(t({ animal_id: A.id(0xdead) }).erro.code, 'NOT_FOUND');
  assert.equal(t({ animal_id: bezerra.animal_id, geracoes: 7 }).erro.code, 'VALIDATION');
  assert.equal(t({}).erro.code, 'VALIDATION');
});

test('editar: campos de cadastro só com AUDITORIA, sem evento; valor igual não grava', () => {
  const { c, por } = rebanho();
  const id = por('0457').animal_id;
  const eventos = c.tabela('EVENTOS').length;
  const r = c.run('AnimalService.comandoEditar', { animal_id: id, campos: { nome: '  Mimosa ', raca: 'ANGUS', observacoes: 'Mansa', sexo: 'F', data_nascimento: '2024-05-10' } });
  assert.deepEqual([r.dados.event_id, r.dados.correcoes, r.dados.cadastro.sort()], [null, [], ['nome', 'observacoes', 'raca']], 'sexo e nascimento iguais não viram correção');
  assert.deepEqual([r.dados.animal.nome, r.dados.animal.raca], ['Mimosa', 'ANGUS']);
  assert.equal(c.tabela('EVENTOS').length, eventos, 'nenhum evento');
  const aud = c.auditoria({ entidade: 'ANIMAIS', entity_id: id, acao: 'ALTERAR' });
  assert.deepEqual(aud.map((l) => [l.campo, l.valor_anterior, l.valor_novo]).sort(), [['nome', null, 'Mimosa'], ['observacoes', null, 'Mansa'], ['raca', null, 'ANGUS']]);
  const op = c.tabela('OPERACOES').find((o) => o.op_id === aud[0].op_id);
  assert.deepEqual([op.comando, op.status], ['animal.editar', 'CONFIRMADA']);
  assert.equal(c.run('AnimalService.comandoEditar', { animal_id: id, campos: { nome: 'Mimosa' } }).semAlteracao, true);
  const dup = c.run('AnimalService.comandoEditar', { animal_id: id, campos: { observacoes: 'Brava' } }, { chave: 'k-edit' });
  const de_novo = c.run('AnimalService.comandoEditar', { animal_id: id, campos: { observacoes: 'Brava' } }, { chave: 'k-edit' });
  assert.equal(de_novo.duplicado, true);
  assert.deepEqual(de_novo.dados, dup.dados, 'reenvio devolve a mesma resposta');
});

test('editar: campo sensível vira AJUSTE_INVENTARIO/CORRECAO_CADASTRO com justificativa, no mesmo commit da auditoria', () => {
  const { c, por } = rebanho();
  const id = por('0700').animal_id;
  const semJust = c.tentar('AnimalService.comandoEditar', { animal_id: id, campos: { data_nascimento: '2025-01-15', nome: 'Estrela' } });
  assert.deepEqual(codigos(semJust.erro), ['CAMPO_OBRIGATORIO']);
  assert.equal(semJust.erro.details[0].campo, 'justificativa');
  assert.equal(c.m.animal(id).nome, null, 'nada gravado');
  const r = c.run('AnimalService.comandoEditar', { animal_id: id, campos: { data_nascimento: '2025-01-15', data_nascimento_confianca: 'ESTIMADA', nome: 'Estrela' }, justificativa: 'Conferido no caderno' });
  assert.deepEqual(r.dados.correcoes.sort(), ['data_nascimento', 'data_nascimento_confianca']);
  assert.deepEqual(r.dados.cadastro, ['nome']);
  const ev = c.m.evento(r.dados.event_id);
  assert.deepEqual([ev.event_type, ev.event_subtype, ev.event_date, ev.status], ['AJUSTE_INVENTARIO', 'CORRECAO_CADASTRO', A.HOJE, 'CONFIRMADO']);
  const ajustes = c.tabela('AJUSTES').filter((x) => x.event_id === ev.event_id);
  assert.deepEqual(ajustes.map((x) => [x.campo, x.valor_anterior, x.valor_novo, x.justificativa]).sort(), [['data_nascimento', '2025-02-15', '2025-01-15', 'Conferido no caderno'], ['data_nascimento_confianca', 'CONFIRMADA', 'ESTIMADA', 'Conferido no caderno']]);
  const aud = c.auditoria({ entidade: 'ANIMAIS', entity_id: id, campo: 'nome' });
  assert.equal(aud[0].op_id, ev.op_id, 'auditoria e evento na mesma operação (uma célula de commit)');
  const a = c.m.animal(id);
  assert.deepEqual([a.data_nascimento, a.data_nascimento_confianca, a.nome], ['2025-01-15', 'ESTIMADA', 'Estrela']);
  assert.equal(r.dados.animal.idade_meses, 21);

  // Regras do motor valem pela edição: ciclo genealógico, sexo de progenitor, campos que não se editam.
  const nasc = c.tentar('AnimalService.comandoEditar', { animal_id: por('0102').animal_id, campos: { mae_id: por('0457').animal_id, mae_confianca: 'ESTIMADA' }, justificativa: 'teste' });
  assert.deepEqual(codigos(nasc.erro), ['NASCIMENTO_DO_PROGENITOR'], 'a neta nasceu depois da avó');
  const ciclo = c.tentar('AnimalService.comandoEditar', { animal_id: por('0102').animal_id, campos: { data_nascimento: '', mae_id: por('0457').animal_id, mae_confianca: 'ESTIMADA' }, justificativa: 'teste' });
  assert.deepEqual(codigos(ciclo.erro), ['CICLO_GENEALOGICO'], 'sem a data, o ciclo avó → mãe → neta é recusado no mesmo formulário');
  assert.match(ciclo.erro.details[0].mensagem, /0102 → 0310 → 0457/);
  const sexo = c.tentar('AnimalService.comandoEditar', { animal_id: por('0310').animal_id, campos: { sexo: 'M' }, justificativa: 'teste' });
  assert.ok(codigos(sexo.erro).includes('SEXO_DO_PROGENITOR'), 'mãe de outros não troca de sexo');
  const proibidos = c.tentar('AnimalService.comandoEditar', { animal_id: id, campos: { brinco: '9999', pasto_atual_id: PASTOS.B, peso_atual: 300, cor: 'malhada', raca: 'ZEBU' } });
  assert.deepEqual(proibidos.erro.details.map((d) => [d.campo, d.codigo]).sort(), [['brinco', 'CAMPO_NAO_EDITAVEL'], ['cor', 'CAMPO_DESCONHECIDO'], ['pasto_atual_id', 'CAMPO_NAO_EDITAVEL'], ['peso_atual', 'CAMPO_NAO_EDITAVEL'], ['raca', 'VALOR_FORA_DA_LISTA']]);
  assert.match(proibidos.erro.details.find((d) => d.campo === 'brinco').mensagem, /Pôr ou trocar brinco/);
  assert.equal(c.tentar('AnimalService.comandoEditar', { animal_id: A.id(0xbad), campos: { nome: 'x' } }).erro.code, 'NOT_FOUND');
  assert.deepEqual(codigos(c.tentar('AnimalService.comandoEditar', { animal_id: id, campos: { foto_anexo_id: A.id(0xf0) } }).erro), ['ANEXO_INVALIDO']);
});

/** Executa a edição matando a execução ANTES de a fase C aplicar ANIMAIS; devolve o ambiente e a operação. */
function editarEMorrerNaFaseC(dados) {
  const ref = rebanho();
  const cmd = (c) => c.G.AnimalService.comandoEditar(c.pedido(dados(c), { chave: 'k-queda' }));
  const { chamadas } = P.rodarInstrumentado(ref.c.amb, cmd(ref.c), {});
  const k = chamadas.findIndex((ch, i) => i > 2 && /^atualizar:.*ANIMAIS\./.test(ch)) + 1;
  assert.ok(k > 0, 'a fase C atualiza ANIMAIS: ' + chamadas.join(' | '));
  const amb = rebanho();
  const { r } = P.rodarInstrumentado(amb.c.amb, cmd(amb.c), { antes: k });
  assert.equal(r.morta, true);
  const op = amb.c.tabela('OPERACOES').find((o) => o.idempotency_key === 'k-queda');
  return { amb, op, cmd };
}

test('editar: edição de cadastro gera AUDITORIA e é refeita pela recuperação depois do commit', () => {
  const { amb, op, cmd } = editarEMorrerNaFaseC((c) => ({ animal_id: c.m.porBrinco('0457').animal_id, campos: { nome: 'Mimosa', raca: 'ANGUS' } }));
  const c = amb.c;
  const id = c.m.porBrinco('0457').animal_id;
  assert.deepEqual([op.status, op.aplicada_em], ['CONFIRMADA', null], 'morreu depois do commit, antes da fase C');
  assert.equal(c.m.animal(id).nome, null, 'o valor novo ainda não chegou ao cadastro');
  const rec = c.amb.recoverAll();
  assert.deepEqual(rec.refeitas, [op.op_id]);
  assert.deepEqual([c.m.animal(id).nome, c.m.animal(id).raca], ['Mimosa', 'ANGUS'], 'a recuperação aplica o valor_novo da AUDITORIA');
  assert.equal(c.auditoria({ op_id: op.op_id, acao: 'RECUPERACAO' }).length, 1);
  c.m.conferirProjecoes('depois da recuperação');
  const reenvio = js(c.gas.exec(() => c.G.UnitOfWork.run(c.amb.ctx(), cmd(c))));
  assert.equal(reenvio.duplicado, true);
  assert.equal(reenvio.dados.animal.nome, 'Mimosa');
});

test('editar: correção sensível + cadastro, interrompida na fase C, é refeita inteira pela recuperação', () => {
  const { amb, op } = editarEMorrerNaFaseC((c) => ({ animal_id: c.m.porBrinco('0520').animal_id, campos: { castrado: true, nome: 'Pintado' }, justificativa: 'Castrado antes da compra' }));
  const c = amb.c;
  const id = c.m.porBrinco('0520').animal_id;
  assert.equal(op.status, 'CONFIRMADA');
  assert.deepEqual([c.m.animal(id).castrado, c.m.animal(id).nome], [false, null]);
  c.amb.recoverAll();
  assert.deepEqual([c.m.animal(id).castrado, c.m.animal(id).reprodutor, c.m.animal(id).nome], [true, false, 'Pintado']);
  c.m.conferirProjecoes('depois da recuperação');
  assert.equal(c.tabela('EVENTOS').find((e) => e.op_id === op.op_id).status, 'CONFIRMADO');
});

test('cadastrarExterno: referência fora do rebanho, com AUDITORIA, código sequencial e regras de cadastro', () => {
  const c = ambienteCadastros();
  const r = c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'Touro Angus (sêmen 123)', sexo: 'M', raca: 'ANGUS' } });
  const a = c.m.animal(r.dados.animal_id);
  assert.deepEqual([a.situacao_cadastral, a.codigo_interno, a.sexo, a.categoria_modo, a.marcado_descarte, a.pasto_atual_id], ['EXTERNO', 'A-000001', 'M', 'AUTO', false, null]);
  assert.ok(c.auditoria({ entidade: 'ANIMAIS', entity_id: a.animal_id, acao: 'CRIAR' }).length >= 5);
  const erros = c.tentar('AnimalService.comandoCadastrarExterno', { campos: { brinco: '77', data_nascimento: '2027-01-01', data_nascimento_confianca: 'CONFIRMADA', raca: 'ZEBU' } });
  assert.deepEqual(erros.erro.details.map((d) => [d.campo, d.codigo]).sort(), [['brinco', 'CAMPO_NAO_SE_APLICA'], ['data_nascimento', 'DATA_FUTURA'], ['nome', 'CAMPO_OBRIGATORIO'], ['raca', 'VALOR_FORA_DA_LISTA'], ['sexo', 'CAMPO_OBRIGATORIO']]);
  assert.deepEqual(codigos(c.tentar('AnimalService.comandoCadastrarExterno', { campos: { nome: 'X', sexo: 'F', data_nascimento: '2020-01-01' } }).erro), ['CAMPO_OBRIGATORIO']);
  const dup = c.tentar('AnimalService.comandoCadastrarExterno', { campos: { nome: 'touro angus (SÊMEN 123)', sexo: 'M' } });
  assert.deepEqual([dup.erro.code, codigos(dup.erro)], ['NEEDS_CONFIRMATION', ['POSSIVEL_DUPLICIDADE']]);
  const outro = c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'touro angus (SÊMEN 123)', sexo: 'M' } }, { avisos: ['POSSIVEL_DUPLICIDADE'] });
  assert.equal(outro.dados.animal.codigo_interno, 'A-000002');
  assert.equal(c.m.inventario(A.HOJE).total, 0, 'externo não entra no inventário');
  assert.deepEqual(codigos(c.m.tentar('registrar', ajuste('CORRECAO_CADASTRO', A.HOJE, [{ animal_id: a.animal_id, campo: 'sexo', valor_novo: 'F' }])).erro), ['ANIMAL_EXTERNO']);
});

test('editar externo: sexo e nascimento pelo cadastro de referência (AUDITORIA), conferidos contra as crias', () => {
  const { c, ext, bezerra } = rebanho();
  const r = c.run('AnimalService.comandoEditar', { animal_id: ext, campos: { data_nascimento: '2014-05-01', nome: 'Bitelo' } });
  assert.equal(r.dados.event_id, null);
  assert.deepEqual([c.m.animal(ext).data_nascimento, c.m.animal(ext).nome, c.m.animal(ext).situacao_cadastral], ['2014-05-01', 'Bitelo', 'EXTERNO']);
  const aud = c.auditoria({ entidade: 'ANIMAIS', entity_id: ext, acao: 'ALTERAR', campo: 'data_nascimento' });
  assert.deepEqual([aud.length, aud[0].valor_anterior, aud[0].valor_novo], [1, '2015-06-01', '2014-05-01']);
  const erros = c.tentar('AnimalService.comandoEditar', { animal_id: ext, campos: { sexo: 'F', data_nascimento: '2026-01-01', castrado: true } });
  assert.deepEqual(codigos(erros.erro).sort(), ['CAMPO_NAO_SE_APLICA', 'NASCIMENTO_DO_PROGENITOR', 'SEXO_DO_PROGENITOR']);
  c.run('AnimalService.comandoEditar', { animal_id: ext, campos: { data_nascimento: null } });
  assert.deepEqual([c.m.animal(ext).data_nascimento, c.m.animal(ext).data_nascimento_confianca], [null, null], 'apagar o nascimento apaga a confiança');
  // A exceção do EXTERNO não abre a porta para editar atributo de projeção de animal do rebanho.
  const direto = (opcoes) => c.amb.tentarRun({ rota: 'teste.direto', idempotencyKey: 'k-direto-' + (opcoes ? 'x' : 'y'), dados: {}, reads: ['ANIMAIS'],
    tratador: (tx) => { c.G.AuditService.alteracao(tx, 'ANIMAIS', bezerra.animal_id, { sexo: 'M' }, null, opcoes); return {}; } });
  assert.equal(direto({ externo: true }).erro.code, 'INTERNAL', 'bezerra do rebanho não é EXTERNO');
  assert.equal(direto(undefined).erro.code, 'INTERNAL', 'sem a marca, sexo não se altera por AUDITORIA');
  assert.equal(c.m.animal(bezerra.animal_id).sexo, 'F');
});

test('ordem de carga inversa e primitiva SPREADSHEET_APP: carga inicial, ficha, edição e painel funcionam igual', () => {
  const { c, bezerra } = rebanho({ order: 'reverse', primitiva: 'SPREADSHEET_APP' });
  assert.equal(c.ler(c.G.AnimalService.consultaCargaInicial()).n, 8);
  assert.equal(c.ler(c.G.AnimalService.consultaFicha({ animal_id: bezerra.animal_id })).genealogia.mae.brinco, '0310');
  c.run('AnimalService.comandoEditar', { animal_id: bezerra.animal_id, campos: { nome: 'Pintada', sexo: 'F' } });
  assert.equal(c.m.animal(bezerra.animal_id).nome, 'Pintada');
  assert.equal(c.ler(c.G.PastureService.consultaPainel({ pasture_id: PASTOS.A })).cabecas, 6);
  assert.equal(c.ler(c.G.InventoryService.consultaPosicao({})).cabecas, 7);
});
