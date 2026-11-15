'use strict';
/**
 * Telas da Fase 2 no Node (E2.8 a E2.10 na tela), com os scripts do cliente da página montada pelo doGet real e o
 * servidor real do harness: a posição de todos os pastos numa data passada (pasto.listar com a data: o mesmo replay do
 * painel; antes do marco zero, o motivo; data futura ou inválida, recusada; o estorno muda o passado) e o "Sem dado" com
 * o motivo na linguagem do pecuarista, sobre as respostas reais (sem área, sem capacidade, sem peso, antes do marco
 * zero); na importação de eventos, as linhas de cada lançamento (`lancamento`) e o plano da confirmação com as linhas
 * deixadas de fora (`ignorar_linhas`), que o servidor aceita só com o lançamento inteiro e com a aprovação igual aos
 * números; o pedido do anexo escolhido no formulário de evento, que o servidor aceita, uma vez só pela chave do arquivo.
 * Depois de cada comando, projeção = reconstrução. Os fluxos em navegador estão em tests/ui/pastos-importacao.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const { api, cliente, storeDe } = require('./apoio-telas');

const { js, PASTOS } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');

function ok(s, pedido, msg) {
  const r = api(s, pedido);
  assert.equal(r.ok, true, (msg || pedido.rota) + ': ' + JSON.stringify(r.error));
  if (pedido.idempotencyKey || /importarBloco|concluir/.test(pedido.rota)) s.conferirProjecoes(msg || pedido.rota);
  return r.data;
}
function pasto(s, id, campos, chave) {
  return ok(s, { rota: 'pasto.salvar', idempotencyKey: chave, dados: { pasture_id: id, campos } });
}
/** Rebanho no marco zero: 3 no Pasto A (dois com peso) e 1 no B; em 01/03 dois vão do A para o B. */
function montar() {
  const s = S.sistema();
  const sem = ok(s, { rota: 'evento.registrar', idempotencyKey: 'sem', dados: S.entradaInicial([
    S.bicho({ brinco: '1', peso: 450, metodo_pesagem: 'BALANCA' }), S.bicho({ brinco: '2', peso: 360, metodo_pesagem: 'BALANCA' }), S.bicho({ brinco: '3' }),
    S.bicho({ brinco: '4', pasto_destino_id: PASTOS.B }),
  ]) });
  const id = (b) => sem.animais.find((x) => x.brinco === b).animal_id;
  const t = ok(s, { rota: 'evento.registrar', idempotencyKey: 'transf', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: id('1') }, { animal_id: id('3') }] } });
  return { s, id, transf: t.event_id };
}
const listar = (s, dados) => api(s, { rota: 'pasto.listar', dados });
const porId = (cartoes) => Object.fromEntries(cartoes.map((c) => [c.pasture_id, c]));
const INDICADORES = ['cabecas', 'machos', 'femeas', 'peso_vivo_total', 'peso_medio', 'ua', 'ua_ha', 'ocupacao_pct', 'acima_da_capacidade', 'data', 'motivo'];
const so = (o) => Object.fromEntries(INDICADORES.map((k) => [k, o[k]]));

test('pasto.listar com data: a posição de todos os pastos numa data passada é a do painel; antes do marco zero, o motivo; futura e inválida recusadas; o estorno muda o passado', () => {
  const { s, transf } = montar();
  pasto(s, PASTOS.A, { area_hectares: 2, capacidade_estimada_ua_ha: 1 }, 'pa');
  const antes = listar(s, { data: '2026-02-15' });
  assert.equal(antes.ok, true, JSON.stringify(antes.error));
  assert.deepEqual(antes.data.map((c) => [c.nome, c.cabecas, c.data]), [['Pasto A', 3, '2026-02-15'], ['Pasto B', 1, '2026-02-15']]);
  const depois = porId(listar(s, { data: '2026-03-15' }).data);
  assert.deepEqual([depois[PASTOS.A].cabecas, depois[PASTOS.B].cabecas], [1, 3], 'os dois transferidos em 01/03');
  // Cada cartão é o painel do pasto na mesma data (mesmo replay, mesma lotação), sem a lista de animais.
  ['2026-02-15', '2026-03-15'].forEach((d) => {
    listar(s, { data: d }).data.forEach((c) => {
      const p = api(s, { rota: 'pasto.painel', dados: { pasture_id: c.pasture_id, data: d } }).data;
      assert.deepEqual(so(c), so(p), c.nome + ' em ' + d);
      assert.equal(c.animais, undefined, 'o cartão não traz a lista de animais');
    });
  });
  // Em 15/02 o A tinha 810 kg pesados (1,8 UA em 2 ha = 0,9 UA/ha, 90% da capacidade de 1 UA/ha).
  const a = porId(antes.data)[PASTOS.A];
  assert.deepEqual([a.peso_vivo_total.valor, a.ua.valor, a.ua_ha.valor, a.ocupacao_pct.valor, a.ocupacao_pct.base], [810, 1.8, 0.9, 90, 'UA_HA']);
  // Sem data = hoje = a carga inicial do aparelho.
  const hoje = porId(listar(s, {}).data);
  const boot = porId(storeDe(s).b.pastos);
  assert.deepEqual(Object.keys(hoje).map((k) => so(hoje[k])), Object.keys(hoje).map((k) => so(boot[k])));
  assert.deepEqual(so(hoje[PASTOS.A]), so(porId(listar(s, { data: '2026-11-13' }).data)[PASTOS.A]));
  // Antes do marco zero: nada inventado.
  listar(s, { data: '2025-12-31' }).data.forEach((c) => {
    assert.deepEqual([c.motivo, c.cabecas, c.ua.valor, c.ua.motivo, c.ocupacao_pct.valor], ['ANTERIOR_AO_MARCO_ZERO', null, null, 'ANTERIOR_AO_MARCO_ZERO', null]);
  });
  const fut = listar(s, { data: '2026-12-01' });
  assert.deepEqual([fut.ok, fut.error.code, fut.error.details[0].codigo], [false, 'VALIDATION', 'DATA_FUTURA']);
  const inv = listar(s, { data: '15/03/2026' });
  assert.deepEqual([inv.ok, inv.error.code, inv.error.details[0].codigo], [false, 'VALIDATION', 'FORMATO_INVALIDO']);
  // O inventário de qualquer data sai das linhas que valem hoje: estornada a transferência, o passado muda.
  ok(s, { rota: 'evento.estornar', idempotencyKey: 'est', dados: { event_id: transf, justificativa: 'Os animais não saíram do A' } });
  const refeito = porId(listar(s, { data: '2026-03-15' }).data);
  assert.deepEqual([refeito[PASTOS.A].cabecas, refeito[PASTOS.B].cabecas], [3, 1]);
});

test('"Sem dado" e o motivo na linguagem do pecuarista, sobre as respostas reais: sem área, sem capacidade, só capacidade em cabeças, nenhum animal com peso, pasto vazio, antes do marco zero', () => {
  const { s } = montar();
  pasto(s, PASTOS.A, { capacidade_estimada_cabecas: 4 }, 'pa');
  pasto(s, PASTOS.B, { area_hectares: 2, capacidade_estimada_ua_ha: 1 }, 'pb');
  const novo = ok(s, { rota: 'pasto.salvar', idempotencyKey: 'pc', dados: { campos: { property_id: S.PROP, nome: 'Pasto C', posse: 'PROPRIO', area_hectares: 5, capacidade_estimada_ua_ha: 1.5 } } });
  const c = cliente(s);
  c.Store = storeDe(s);
  const P = c.TelaPastos;
  const cartoes = (d) => porId(listar(s, { data: d }).data);
  const fev = cartoes('2026-02-15');
  // A: com peso, sem área (UA/ha sem dado), capacidade só em cabeças (ocupação pelas cabeças).
  const a = fev[PASTOS.A];
  assert.equal(P.valor('ua', a.ua, a, (v) => c.Fmt.numero(v, 2)), '1,80');
  assert.equal(P.valor('ua_ha', a.ua_ha, a, String), 'Sem dado (o pasto não tem a área informada)');
  assert.deepEqual([a.ocupacao_pct.valor, a.ocupacao_pct.base], [75, 'CABECAS']);
  // B: área e capacidade, mas o animal dele não tem peso: UA, UA/ha e ocupação sem dado, pelo peso.
  const b = fev[PASTOS.B];
  ['ua', 'ua_ha', 'ocupacao'].forEach((k) => assert.equal(P.valor(k, k === 'ocupacao' ? b.ocupacao_pct : b[k], b, String), 'Sem dado (nenhum animal do pasto tem peso conhecido)', k));
  // C: área e capacidade, mas vazio: UA zero é informação; peso médio sem dado porque não há animal.
  const vazio = fev[novo.pasture_id];
  assert.deepEqual([vazio.cabecas, vazio.ua.valor, vazio.ua_ha.valor], [0, 0, 0]);
  assert.equal(P.valor('peso', vazio.peso_medio, vazio, String), 'Sem dado (nenhum animal no pasto)');
  // Sem capacidade nenhuma: a ocupação nunca é deduzida da área; a UA/ha não depende da capacidade.
  pasto(s, PASTOS.A, { area_hectares: 2, capacidade_estimada_cabecas: null }, 'pa2');
  const semCap = cartoes('2026-02-15')[PASTOS.A];
  assert.equal(semCap.ocupacao_pct.valor, null);
  assert.equal(P.valor('ocupacao', semCap.ocupacao_pct, semCap, String), 'Sem dado (o pasto não tem capacidade informada)');
  assert.equal(P.valor('ua_ha', semCap.ua_ha, semCap, (v) => c.Fmt.numero(v, 2)), '0,90');
  // Antes do marco zero.
  const velho = cartoes('2025-06-01')[PASTOS.B];
  assert.equal(P.valor('ua', velho.ua, velho, String), 'Sem dado (a data é anterior ao marco zero, 01/01/2026)');
  assert.equal(P.motivoSemDado('cabecas', velho, velho), 'a data é anterior ao marco zero, 01/01/2026');
});

const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const COMPRAS = [
  'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Preço (R$);Valor dos animais (R$);Brinco;Sexo;Idade (meses);Castrado;Reprodutor;Pasto',
  'C1;10/02/2026;Fazenda Vizinha;cabeça;2.000,00;6.000,00;200;M;14;N;N;Pasto A',
  'C1;;;;;;201;M;14;N;N;Pasto A',
  'C1;;;;;;202;F;13;;;P-B',
  'C2;20/02/2026;Fazenda Vizinha;cabeça;2.100,00;2.100,00;203;M;12;S;N;Pasto A',
  'C3;25/02/2026;Fulano de Tal;cabeça;1.000,00;1.000,00;204;M;12;S;N;Pasto A',
].join('\n');

test('importação de eventos: as linhas de cada lançamento; o plano da confirmação com linhas deixadas de fora, aceito só com o lançamento inteiro e com a aprovação igual aos números', () => {
  const s = S.sistema({ config: { importacao_lote_linhas: '2' } });
  ok(s, { rota: 'parceiro.salvar', idempotencyKey: 'forn', dados: { campos: { nome: 'Fazenda Vizinha', tipos: ['FORNECEDOR'] } } });
  ok(s, { rota: 'evento.registrar', idempotencyKey: 'sem', dados: S.entradaInicial([S.bicho({ brinco: '100' })]) });
  const cr = ok(s, { rota: 'importacao.criar', idempotencyKey: 'criar', dados: { tipo: 'COMPRAS', arquivo_nome: 'compras.csv', conteudo_base64: b64(COMPRAS), formato: FORMATO } });
  const mapa = { colunas: cr.sugestao, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: {} };
  assert.equal(Object.keys(cr.sugestao).length, 12, 'o cabeçalho do modelo vem todo mapeado');
  let e;
  for (let b = 1; b < 20; b++) {
    e = ok(s, { rota: 'importacao.validarBloco', idempotencyKey: 'val-' + b, dados: { import_id: cr.import_id, bloco: b, mapeamento: mapa } });
    if (e.importacao.status === 'VALIDADO') break;
  }
  assert.deepEqual([e.contadores.validas, e.contadores.erro, e.contadores.duplicadas], [4, 1, 0]);
  const linhas = api(s, { rota: 'importacao.linhas', dados: { import_id: cr.import_id, por_pagina: 500 } }).data.itens;
  assert.deepEqual(linhas.map((l) => [l.linha_num, l.status, l.lancamento]), [[2, 'VALIDA', [2, 3, 4]], [3, 'VALIDA', [2, 3, 4]], [4, 'VALIDA', [2, 3, 4]], [5, 'VALIDA', [5]], [6, 'ERRO', [6]]]);
  const pg = api(s, { rota: 'importacao.linhas', dados: { import_id: cr.import_id, status: 'VALIDA', pagina: 2, por_pagina: 2 } }).data;
  assert.deepEqual(pg.itens.map((l) => [l.linha_num, l.lancamento]), [[4, [2, 3, 4]], [5, [5]]], 'o lançamento inteiro mesmo noutra página');
  // O que a tela mostra do que entendeu (campo do modelo, em palavras).
  const c = cliente(s);
  c.Store = storeDe(s);
  const I = c.TelaImportacao;
  const mod = api(s, { rota: 'importacao.modelo', dados: { tipo: 'COMPRAS' } }).data;
  const campo = (k) => mod.campos.find((x) => x.campo === k);
  assert.deepEqual([I.valorLido(campo('valor_animais'), linhas[0].interpretado.valor_animais), I.valorLido(campo('data'), linhas[0].interpretado.data), I.valorLido(campo('fornecedor'), linhas[0].interpretado.fornecedor), I.valorLido(campo('pasto'), linhas[2].interpretado.pasto), I.valorLido(campo('modalidade'), linhas[0].interpretado.modalidade)].map((t) => t.replace(/\s/g, ' ')),
    ['R$ 6.000,00', '10/02/2026', 'Fazenda Vizinha', 'Pasto B', 'Por cabeça']);
  // Plano puro: nada de fora → TOTAL; repetidas e fora de ordem → uma vez, em ordem.
  assert.deepEqual(js(I.planoConfirmacao({ validas: 2, erro: 0, duplicadas: 0 }, [])), { importar: 2, fora: 0, reprovadas: 0, ignorar_linhas: [], modo: 'TOTAL', aprovacao: null });
  assert.deepEqual(js(I.planoConfirmacao(e.contadores, ['4', '2', '2'])).ignorar_linhas, [2, 4]);
  const importar = (plano, extra) => api(s, { rota: 'importacao.importarBloco', dados: Object.assign({ import_id: cr.import_id, bloco: 1, modo: plano.modo, aprovacao: plano.aprovacao, ignorar_linhas: plano.ignorar_linhas }, extra || {}) });
  // Só uma linha do lançamento de 3 animais: recusado, nada gravado.
  const parcial = importar(js(I.planoConfirmacao(e.contadores, [3])));
  assert.equal(parcial.ok, false);
  assert.deepEqual([parcial.error.code, parcial.error.details.map((d) => d.codigo)], ['VALIDATION', ['GRUPO_PARCIAL']]);
  assert.match(parcial.error.details[0].mensagem, /linhas 2, 3, 4/);
  // Aprovação diferente do que vai acontecer (a tela sempre manda os números do plano): recusado.
  const divergente = importar(js(I.planoConfirmacao(e.contadores, [])), { ignorar_linhas: [5] });
  assert.deepEqual([divergente.ok, divergente.error.details[0].codigo], [false, 'APROVACAO_DIVERGENTE']);
  assert.equal(api(s, { rota: 'importacao.obter', dados: { import_id: cr.import_id } }).data.importacao.status, 'VALIDADO');
  // O lançamento inteiro, como a tela marca pela lista `lancamento` da linha.
  const plano = js(I.planoConfirmacao(e.contadores, linhas.find((l) => l.linha_num === 3).lancamento));
  assert.deepEqual(plano, { importar: 1, fora: 4, reprovadas: 1, ignorar_linhas: [2, 3, 4], modo: 'PARCIAL_APROVADO', aprovacao: { importar: 1, ignorar: 4 } });
  let r = importar(plano);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  s.conferirProjecoes('bloco 1');
  for (let b = 2; r.data.blocos.proximo !== null; b++) r = { data: ok(s, { rota: 'importacao.importarBloco', dados: { import_id: cr.import_id, bloco: b } }, 'bloco ' + b) };
  ok(s, { rota: 'importacao.concluir', dados: { import_id: cr.import_id } }, 'concluir');
  const fim = api(s, { rota: 'importacao.relatorio', dados: { import_id: cr.import_id } }).data;
  assert.deepEqual([fim.importacao.status, fim.contadores.importadas, fim.contadores.ignoradas, fim.contadores.erro, fim.criados.eventos, fim.criados.animais], ['IMPORTADO', 1, 3, 1, 1, 1]);
  const brincos = s.tabela('ANIMAIS').filter((x) => x.situacao_cadastral === 'ATIVO').map((x) => x.brinco).sort();
  assert.deepEqual(brincos, ['100', '203'], 'a compra deixada de fora não entrou');
  const aprov = s.tabela('AUDITORIA').filter((x) => x.entidade === 'IMPORTACAO_LINHAS' && x.campo === 'status' && x.valor_novo === 'IGNORADA');
  assert.equal(aprov.length, 3);
  assert.match(aprov[0].justificativa, /Deixada de fora pelo dono/);
});

test('anexo escolhido no formulário de evento: tipo sugerido pelo evento; o pedido montado pela tela é aceito pelo servidor uma vez só (chave do arquivo); foto que não é imagem recusada também no servidor', () => {
  const { s } = montar();
  const c = cliente(s);
  c.Store = storeDe(s);
  const A = c.Anexos;
  assert.deepEqual(['COMPRA', 'VENDA', 'TRANSFERENCIA', 'MORTE', 'NASCIMENTO'].map(A.tipoPadrao), ['NOTA_FISCAL', 'NOTA_FISCAL', 'GTA', 'DOCUMENTO', 'DOCUMENTO']);
  const ev = listarEventos(s).find((x) => x.event_type === 'TRANSFERENCIA').event_id;
  const arquivo = { nome_arquivo: 'gta-123.pdf', mime_type: 'application/pdf', tamanho_bytes: 20, conteudo_base64: b64('%PDF-1.4 gta'), miniatura_base64: null };
  const pedido = js(A.pedidoEvento({ arquivo, tipo: A.tipoPadrao('TRANSFERENCIA'), descricao: 'GTA 123' }, ev));
  assert.deepEqual(pedido, { entidade: 'EVENTOS', entity_id: ev, tipo: 'GTA', descricao: 'GTA 123', nome_arquivo: 'gta-123.pdf', mime_type: 'application/pdf', conteudo_base64: arquivo.conteudo_base64, miniatura_base64: null });
  const r1 = api(s, { rota: 'anexo.adicionar', idempotencyKey: 'anx:1', dados: pedido });
  assert.equal(r1.ok, true, JSON.stringify(r1.error));
  s.conferirProjecoes('anexo');
  const r2 = api(s, { rota: 'anexo.adicionar', idempotencyKey: 'anx:1', dados: pedido });
  assert.deepEqual([r2.ok, r2.meta.duplicado], [true, true], 'o reenvio com a mesma chave não duplica');
  const det = api(s, { rota: 'evento.obter', dados: { event_id: ev } }).data;
  assert.deepEqual(det.anexos.map((x) => [x.tipo, x.nome_arquivo, x.descricao, x.vigente]), [['GTA', 'gta-123.pdf', 'GTA 123', true]]);
  const foto = api(s, { rota: 'anexo.adicionar', idempotencyKey: 'anx:2', dados: js(A.pedidoEvento({ arquivo, tipo: 'FOTO' }, ev)) });
  assert.deepEqual([foto.ok, foto.error.code], [false, 'VALIDATION']);
});
function listarEventos(s) { return api(s, { rota: 'evento.listar', dados: {} }).data.itens; }
