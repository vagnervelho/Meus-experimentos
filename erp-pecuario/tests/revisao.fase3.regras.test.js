'use strict';
/**
 * Revisão da Fase 3 (conserto), achados médios e baixos do motor: o controle de estoque ligado depois das compras (o aviso
 * na hora e a mensagem que não manda lançar de novo a entrada já paga), o mesmo fato no mesmo animal no mesmo dia dentro de
 * um lançamento com outros animais (aviso por animal, como na pesagem e na importação), a carência contra a venda
 * histórica igual nas duas ordens de importação, a resposta do animal.editar com a carência, a troca da mãe de um bezerro
 * desmamado com o caminho certo na mensagem e a pesagem por lote importada com uma linha já na base.
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
function rebanho(s, bichos) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(bichos)), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
const femea = (b, extra) => S.bicho(Object.assign({ brinco: b, data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }, extra || {}));
const boi = (b) => S.bicho({ brinco: b, sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' });
const san = (subtipo, data, ids, campos) => ({ tipo: 'SANIDADE', subtipo, campos: Object.assign({ event_date: data }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) });
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
function criarImportacao(s, tipo, csv, chave) {
  return s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: chave || 'criar-' + tipo, dados: { tipo, arquivo_nome: tipo.toLowerCase() + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
}
function validarTudo(s, id, mapa) {
  let e;
  for (let b = 1; b < 100; b++) {
    e = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + id + '-' + b, dados: { import_id: id, bloco: b, mapeamento: mapa } })).dados;
    if (e.importacao.status === 'VALIDADO') return e;
  }
  throw new Error('validação não terminou');
}
const linhas = (s, id) => s.read(s.G.ImportService.consultaLinhas({ import_id: id, por_pagina: 500 })).itens;
function importarTudo(s, id, avisos) {
  const r = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: avisos || [], dados: { import_id: id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  return s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } })).dados;
}

test('achado 16: ligar o controle de estoque com aplicações já gravadas e compras sem movimento pede confirmação na hora e diz para acertar pela contagem; o aviso de estoque insuficiente seguinte não manda lançar de novo a entrada já paga', () => {
  const s = S.sistema();
  hoje(s, '2026-06-20');
  const ids = Object.values(rebanho(s, [boi('1'), boi('2'), boi('3')]));
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina Y', categoria: 'VACINA', unidade: 'dose', custo_unitario: 2, controla_estoque: false } }), 'produto');
  ok(api(s, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-05-01', product_id: p.product_id, quantidade: 50, valor: 10000 } }), 'entrada');
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-05-10', ids, { produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'vacina');
  const e = recusa(api(s, 'produto.salvar', { product_id: p.product_id, campos: { controla_estoque: true } }, 'liga'), 'NEEDS_CONFIRMATION', 'liga');
  assert.deepEqual(cods(e), ['ESTOQUE_INSUFICIENTE']);
  assert.match(e.details[0].mensagem, /começa em -3 doses/);
  assert.match(e.details[0].mensagem, /acerte o estoque pela contagem/);
  assert.doesNotMatch(e.details[0].mensagem, /lance antes a entrada/);
  const pr = ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { controla_estoque: true } }, 'liga', ['ESTOQUE_INSUFICIENTE']), 'liga com aceite');
  assert.equal(pr.estoque_atual, -3);
  const v = recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-06-10', ids, { produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'NEEDS_CONFIRMATION', 'aplicação seguinte');
  const msg = v.details.find((d) => d.codigo === 'ESTOQUE_INSUFICIENTE').mensagem;
  assert.match(msg, /acerte o estoque pela contagem/);
  assert.doesNotMatch(msg, /lance antes a entrada/);
  // Acertado pela contagem, o aviso some.
  ok(api(s, 'evento.registrar', { tipo: 'ESTOQUE', subtipo: 'AJUSTE', campos: { event_date: '2026-06-01', product_id: p.product_id, motivo_ajuste: 'CONTAGEM', saldo_contado: 47 } }), 'acerto');
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-06-10', ids, { produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'aplicação depois do acerto');
  // Sem compra fora do controle, o aviso continua mandando lançar a entrada.
  const q = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina W', categoria: 'VACINA', unidade: 'dose', custo_unitario: 1, controla_estoque: true } }), 'produto W');
  const w = recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-06-10', ids, { produto_id: q.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'NEEDS_CONFIRMATION', 'W');
  assert.match(w.details.find((d) => d.codigo === 'ESTOQUE_INSUFICIENTE').mensagem, /lance antes a entrada/);
});

test('achado 17: o mesmo diagnóstico, a mesma aplicação e a mesma ocorrência no mesmo animal e no mesmo dia, num lançamento com outros animais, pedem confirmação por animal (POSSIVEL_DUPLICIDADE), com a mesma chave da importação; outro produto ou outro tipo não', () => {
  const s = S.sistema();
  const brincos = ['201', '202', '203', '204', '205', '206'];
  const ids = rebanho(s, brincos.map((b) => femea(b)));
  const dg = (itens) => ({ tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-06-01', metodo: 'PALPACAO' }, animais: itens });
  ok(api(s, 'evento.registrar', dg([{ animal_id: ids['201'], resultado: 'POSITIVO', idade_gestacional_dias: 60 }])), 'bloco 1');
  const e = recusa(api(s, 'evento.registrar', dg(brincos.map((b) => ({ animal_id: ids[b], resultado: b === '201' ? 'NEGATIVO' : 'POSITIVO', idade_gestacional_dias: b === '201' ? undefined : 60 })))), 'NEEDS_CONFIRMATION', 'bloco 2');
  assert.deepEqual(cods(e), ['POSSIVEL_DUPLICIDADE']);
  assert.equal(e.details[0].animal_id, ids['201']);
  assert.match(e.details[0].mensagem, /201.*já tem diagnóstico de gestação de 01\/06\/2026/);
  // A aplicação repetida da mesma vacina num lançamento de 6 animais.
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', custo_unitario: 2, controla_estoque: false } }), 'produto');
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-06-01', [ids['201']], { produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'vacina 1');
  const e2 = recusa(api(s, 'evento.registrar', san('VACINACAO', '2026-06-01', brincos.map((b) => ids[b]), { produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 })), 'NEEDS_CONFIRMATION', 'vacina 2');
  assert.deepEqual(cods(e2), ['POSSIVEL_DUPLICIDADE']);
  assert.equal(e2.details[0].animal_id, ids['201']);
  // Outro produto no mesmo dia não é o mesmo fato.
  ok(api(s, 'evento.registrar', san('VACINACAO', '2026-06-01', brincos.map((b) => ids[b]), { nome_produto: 'Vacina da loja', modo_dose: 'POR_CABECA', dose_referencia: 1, unidade_dose: 'dose' })), 'outro produto');
  // A ocorrência do mesmo tipo.
  const oc = (tipo) => ({ tipo: 'OCORRENCIA', campos: { event_date: '2026-06-02', tipo_ocorrencia: tipo, description: 'Mancando' }, animais: brincos.map((b) => ({ animal_id: ids[b] })) });
  ok(api(s, 'evento.registrar', { tipo: 'OCORRENCIA', campos: { event_date: '2026-06-02', tipo_ocorrencia: 'LESAO', description: 'Pata' }, animais: [{ animal_id: ids['202'] }] }), 'ocorrência 1');
  const e3 = recusa(api(s, 'evento.registrar', oc('LESAO')), 'NEEDS_CONFIRMATION', 'ocorrência 2');
  assert.deepEqual(cods(e3), ['POSSIVEL_DUPLICIDADE']);
  ok(api(s, 'evento.registrar', oc('LESAO'), null, ['POSSIVEL_DUPLICIDADE']), 'aceita');
});

test('achado 23: a carência contra a venda histórica tem o mesmo resultado nas duas ordens de importação (a venda anterior ao marco zero não confere a carência, como a sanidade não confere a venda histórica)', () => {
  const VENDA = 'Nº da venda;Data da venda;Comprador;Para que foram vendidos;Como foi o preço;Preço (R$);Valor bruto (R$);Brinco\nV0;01/05/2025;Frigorífico Boi Bom;abate;cabeça;2.500,00;2.500,00;102';
  const MAPA_V = { colunas: { 'Nº da venda': 'grupo', 'Data da venda': 'data', Comprador: 'comprador', 'Para que foram vendidos': 'finalidade', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco', 'Valor bruto (R$)': 'valor_bruto', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  const SAN = 'Data;Procedimento;Nome do produto;Como foi a dose;Dose;Unidade;Carência (dias);Brinco\n20/04/2025;vermifugação;Ivermectina 1%;por cabeça;5;mL;30;102';
  const MAPA_S = { colunas: { Data: 'data', Procedimento: 'procedimento', 'Nome do produto': 'nome_produto', 'Como foi a dose': 'modo_dose', Dose: 'dose_lancamento', Unidade: 'unidade', 'Carência (dias)': 'carencia', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
  const rodar = (ordem) => {
    const s = S.sistema({ config: { importacao_lote_linhas: '50' } });
    hoje(s, '2026-09-15');
    s.exec((ctx) => s.G.Config.salvarParceiro(ctx, { idempotencyKey: 'p-comp', dados: { campos: { nome: 'Frigorífico Boi Bom', tipos: ['COMPRADOR'] } } }));
    rebanho(s, [boi('102')]);
    return ordem.map((t) => {
      const c = criarImportacao(s, t, t === 'VENDAS' ? VENDA : SAN);
      validarTudo(s, c.import_id, t === 'VENDAS' ? MAPA_V : MAPA_S);
      const ls = linhas(s, c.import_id).map((l) => l.status);
      if (ls.every((x) => x === 'VALIDA')) importarTudo(s, c.import_id);
      return t + ':' + ls.join(',');
    });
  };
  assert.deepEqual(rodar(['SANIDADE', 'VENDAS']), ['SANIDADE:VALIDA', 'VENDAS:VALIDA']);
  assert.deepEqual(rodar(['VENDAS', 'SANIDADE']), ['VENDAS:VALIDA', 'SANIDADE:VALIDA']);
});

test('achado 24: a resposta do animal.editar traz a carência do animal (a lista do aparelho não perde o selo)', () => {
  const s = S.sistema();
  hoje(s, '2026-09-20');
  const id = rebanho(s, [boi('901')])['901'];
  ok(api(s, 'evento.registrar', san('VERMIFUGACAO', '2026-09-10', [id], { nome_produto: 'Ivermectina 1%', modo_dose: 'POR_CABECA', dose_referencia: 5, unidade_dose: 'mL', periodo_carencia_dias: 35 })), 'vermífugo');
  const lst = ok(api(s, 'animal.listar', { situacoes: ['ATIVO'] }));
  assert.equal(lst.valores.carencia_ate ? lst.valores.carencia_ate[0] : lst.valores[lst.colunas.indexOf('carencia_ate')][0], '2026-10-15');
  const ed = ok(api(s, 'animal.editar', { animal_id: id, campos: { nome: 'Pintado' } }), 'editar');
  assert.equal(ed.animal.carencia_ate, '2026-10-15');
  // A leitura sem a aba da sanidade é erro de programação, nunca "sem carência".
  const r = s.tentar((ctx) => s.G.UnitOfWork.read(ctx, { rota: 'teste', reads: ['ANIMAIS', 'EVENTO_ANIMAIS', 'EVENTOS', 'IDENTIFICACOES', 'PESAGENS', 'REPRODUCAO', 'AJUSTES', 'PASTOS', 'CONFIGURACOES', 'CATEGORIAS'], tratador: (tx) => s.G.AnimalService.linhaLeve(s.G.AnimalService.leitor(tx), tx.repo.porId('ANIMAIS', id)) }));
  assert.equal(r.ok, false);
  assert.equal(r.erro.code, 'INTERNAL');
});

test('achado 25: trocar a mãe de um bezerro já desmamado é recusado com a desmama citada e o caminho (estornar a desmama, corrigir a mãe, desmamar de novo), que funciona', () => {
  const s = S.sistema();
  hoje(s, '2026-09-15');
  const ids = rebanho(s, [femea('100', { data_nascimento: '2021-03-01', partos_previos: 2 }), femea('101', { data_nascimento: '2021-05-01' })]);
  ids['300'] = rebanho(s, [S.bicho({ brinco: '300', sexo: 'M', data_nascimento: '2025-10-01', data_nascimento_confianca: 'CONFIRMADA', mae_id: ids['100'], mae_confianca: 'CONFIRMADA' })])['300'];
  const dz = ok(api(s, 'evento.registrar', { tipo: 'DESMAMA', campos: { event_date: '2026-08-01' }, animais: [{ animal_id: ids['300'], peso: 180 }] }), 'desmama');
  const corr = { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-09-10', justificativa: 'A mãe era a 101' }, animais: [{ animal_id: ids['300'], campo: 'mae_id', valor_novo: ids['101'] }] };
  const e = recusa(api(s, 'evento.registrar', corr), 'CONFLICT', 'troca da mãe');
  const texto = e.details.map((d) => d.mensagem).join(' ');
  assert.match(texto, /Estorne antes a desmama de 01\/08\/2026/);
  assert.doesNotMatch(texto, /Confira o lançamento: as linhas dos animais/);
  assert.ok(e.details.some((d) => d.conflito && d.conflito.event_id === dz.event_id), JSON.stringify(e.details));
  // O caminho dito funciona.
  ok(api(s, 'evento.estornar', { event_id: dz.event_id, justificativa: 'mãe errada' }), 'estorno da desmama');
  ok(api(s, 'evento.registrar', corr), 'troca da mãe');
  const dz2 = ok(api(s, 'evento.registrar', { tipo: 'DESMAMA', campos: { event_date: '2026-08-01' }, animais: [{ animal_id: ids['300'], peso: 180 }] }), 'desmama de novo');
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: dz2.event_id, papel: 'MATRIZ' }).map((l) => l.animal_id), [ids['101']]);
});

test('achado 26: a pesagem por lote importada não é duplicada pela pesagem individual do mesmo peso; o lote em parte já lançado fica todo com o motivo claro', () => {
  const MAPA = { colunas: { 'Nº da pesagem': 'grupo', 'Data da pesagem': 'data', Brinco: 'brinco', 'Peso (kg)': 'peso', 'Peso total do lote (kg)': 'peso_total_lote', 'Cabeças na balança': 'cabecas_lote' }, confiancas: {}, padroes: { momento: 'ROTINA', metodo: 'BALANCA' } };
  const s = S.sistema({ config: { importacao_lote_linhas: '50' } });
  const ids = rebanho(s, [boi('100'), boi('101'), boi('102'), boi('103')]);
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-09-20', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['100'], peso: 333.3 }] }), 'pesagem do 100');
  const csv = ['Nº da pesagem;Data da pesagem;Brinco;Peso (kg);Peso total do lote (kg);Cabeças na balança',
    'L1;20/09/2026;100;;1.000,0;3', 'L1;20/09/2026;101;;;', 'L1;20/09/2026;102;;;'].join('\n');
  const c = criarImportacao(s, 'PESAGENS', csv, 'c1');
  const v = validarTudo(s, c.import_id, MAPA);
  assert.deepEqual([v.contadores.validas, v.contadores.erro, v.contadores.duplicadas], [3, 0, 0], JSON.stringify(linhas(s, c.import_id)));
  // A segunda pesagem do 100 no mesmo dia pede o aceite do motor (POSSIVEL_DUPLICIDADE), como no formulário.
  importarTudo(s, c.import_id, ['POSSIVEL_DUPLICIDADE']);
  // O mesmo lote importado de novo, mais um animal: as três linhas são do lote já lançado; a quarta não pode entrar sozinha.
  const csv2 = ['Nº da pesagem;Data da pesagem;Brinco;Peso (kg);Peso total do lote (kg);Cabeças na balança',
    'L1;20/09/2026;100;;1.333,2;4', 'L1;20/09/2026;101;;;', 'L1;20/09/2026;102;;;', 'L1;20/09/2026;103;;;'].join('\n');
  const c2 = criarImportacao(s, 'PESAGENS', csv2, 'c2');
  validarTudo(s, c2.import_id, MAPA);
  const ls = linhas(s, c2.import_id);
  assert.deepEqual(ls.map((l) => l.status), ['DUPLICADA', 'DUPLICADA', 'DUPLICADA', 'ERRO']);
  const motivo = JSON.stringify(ls[3].erros);
  assert.match(motivo, /LOTE_EM_PARTE/);
  assert.match(motivo, /já foi lançado em parte/);
  assert.doesNotMatch(motivo, /QTD_DIVERGENTE/);
});
