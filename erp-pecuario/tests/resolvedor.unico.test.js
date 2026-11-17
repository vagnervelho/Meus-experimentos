'use strict';
/**
 * Conserto da Fase 3 pela garantia, etapa 2 — o resolvedor único da posição na data (CONTRATOS, seção 47). Teste tabelado:
 * para cada caso difícil (reuso do brinco, número lançado errado, código interno, sem brinco, saiu e voltou, data antes da
 * entrada, histórico de antes do marco zero, nada) e cada caminho que acha o animal pelo texto digitado numa data — o curral
 * (animal.resolver na pesagem), o tronco (no diagnóstico, só fêmeas), o seletor dos formulários (num tipo de movimento), a
 * conferência (a posição da data, inventario.elegiveis, com a mesma descrição do animal) e a importação (o arquivo de
 * pesagens validado e importado de verdade) — o MESMO resultado: o mesmo animal, ou a mesma recusa explicada.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const R = require('./apoio-resolvedor');

const { js } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };
const br = (d) => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);

function api(s, rota, dados, chave) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave || 'k-' + Math.random(), avisosAceitos: [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + String(JSON.stringify(r.error)).slice(0, 1500));
  return r.data;
}

/** O rebanho dos casos difíceis, pela api (o mesmo da tela: `tests/apoio-resolvedor.js`). */
function rebanho() {
  const s = S.sistema({ config: { brinco_permite_reuso: 'S' } });
  return R.rebanho(s, (dados, chave) => ok(api(s, 'evento.registrar', dados, chave), chave));
}
const { CASOS } = R;

/** Os três caminhos que perguntam ao resolvedor pela rota (o curral, o tronco, o seletor de um formulário de movimento). */
const ROTAS = [
  ['curral', { tipo: 'PESAGEM' }],
  ['tronco', { tipo: 'REPRODUCAO', sexo: 'F' }],
  ['seletor', { tipo: 'TRANSFERENCIA' }],
];

/** Importa (de verdade) um arquivo de pesagens com uma linha; devolve {status, erros, animal_id (o da pesagem gravada)}. */
function importarPesagem(s, chave, texto, data, peso) {
  const conteudo = ['Data;Momento;Método;Brinco;Peso', br(data) + ';rotina;balança;' + texto + ';' + (peso || '400')].join('\n');
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar-' + chave, dados: { tipo: 'PESAGENS', arquivo_nome: chave + '.csv', conteudo_base64: b64(conteudo), formato: FORMATO } })).dados;
  const mapa = { colunas: c.sugestao, confiancas: {}, padroes: {} };
  for (let b = 1; b < 10; b++) {
    const est = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + chave + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados;
    if (est.importacao.status === 'VALIDADO') break;
  }
  const linha = s.read(s.G.ImportService.consultaLinhas({ import_id: c.import_id, por_pagina: 5 })).itens[0];
  if (linha.status !== 'VALIDA') {
    s.exec((ctx) => s.G.ImportService.desfazer(ctx, { dados: { import_id: c.import_id, justificativa: 'caso conferido' } }));
    return { status: linha.status, erros: linha.erros };
  }
  const ib = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE'], dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(ib.ok, chave + ': ' + JSON.stringify(ib.erro));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  const ev = s.tabela('EVENTOS').find((e) => e.import_id === c.import_id && e.event_type === 'PESAGEM');
  return { status: 'VALIDA', animal_id: s.tabela('PESAGENS').find((p) => p.event_id === ev.event_id).animal_id };
}

test('resolvedor único: cada caso difícil dá o MESMO resultado no curral, no tronco, no seletor, na conferência (posição da data) e na importação', () => {
  const r = rebanho();
  const { s, id } = r;
  const norm = (t) => String(t).trim().toUpperCase().replace(/^0+(?=\d)/, '');
  CASOS.forEach(([rotulo, t, data, esp], i) => {
    const texto = typeof t === 'function' ? t(r) : t;
    const onde = rotulo + ' (' + texto + ' em ' + br(data) + ')';
    // 1. Os caminhos pela rota: o mesmo animal (ou a mesma recusa, com a mesma mensagem) em todos.
    const respostas = ROTAS.map(([nome, op]) => [nome, ok(api(s, 'animal.resolver', Object.assign({ data, textos: [texto] }, op)), onde + ' — ' + nome)]);
    const primeira = respostas[0][1].textos[0];
    respostas.forEach(([nome, d]) => {
      const x = d.textos[0];
      if (esp.animal) {
        assert.equal(x.situacao, 'ACHADO', onde + ' — ' + nome + ': ' + x.mensagem);
        assert.equal(x.animal_id, id[esp.animal], onde + ' — ' + nome);
        assert.equal(d.animais[x.animal_id].presente, esp.presente, onde + ' — ' + nome + ': presença na data');
      } else {
        assert.equal(x.situacao, 'RECUSADO', onde + ' — ' + nome);
        assert.equal(x.codigo, esp.recusa, onde + ' — ' + nome + ': ' + x.mensagem);
        assert.ok(x.mensagem && x.mensagem.length > 10, onde + ' — ' + nome + ': a recusa explica');
      }
      assert.deepEqual([x.situacao, x.codigo, x.animal_id, x.mensagem], [primeira.situacao, primeira.codigo, primeira.animal_id, primeira.mensagem], onde + ' — ' + nome + ' × curral');
    });
    // O tronco diz por que o macho não entra; o animal achado é o mesmo.
    if (esp.animal === 'E' && esp.presente) assert.equal(respostas[1][1].animais[id.E].inelegivel, 'não é fêmea', onde);
    // 2. A conferência: a posição da data (a mesma descrição do animal que o resolvedor devolve) e o número daquele dia.
    const pos = api(s, 'inventario.elegiveis', { tipo: 'PESAGEM', data });
    if (esp.animal && esp.presente) {
      const itens = ok(pos, onde + ' — posição').itens;
      const doTexto = itens.filter((x) => (x.brinco && norm(x.brinco) === norm(texto)) || x.codigo_interno === texto.toUpperCase());
      if (/^0\d{5,}$/.test(texto)) assert.equal(doTexto.length, 0, onde + ': o atalho do código não é número de brinco de ninguém');
      else assert.deepEqual(doTexto.map((x) => x.animal_id), [id[esp.animal]], onde + ' — posição: o mesmo animal pelo número do dia');
      const item = itens.find((x) => x.animal_id === id[esp.animal]);
      const est = respostas[0][1].animais[id[esp.animal]];
      assert.deepEqual(['brinco', 'brinco_hoje', 'pasture_id', 'categoria', 'ultimo_peso', 'codigo_interno', 'sexo'].map((k) => item[k]),
        ['brinco', 'brinco_hoje', 'pasture_id', 'categoria', 'ultimo_peso', 'codigo_interno', 'sexo'].map((k) => est[k]), onde + ' — a conferência descreve o animal do mesmo jeito');
    } else if (esp.animal && esp.presente === false) {
      assert.ok(!ok(pos, onde).itens.some((x) => x.animal_id === id[esp.animal]), onde + ': fora da posição da data');
    } else if (esp.recusa) {
      const itens = pos.ok && pos.data.itens ? pos.data.itens : [];
      assert.deepEqual(itens.filter((x) => x.brinco && norm(x.brinco) === norm(texto)).map((x) => x.animal_id), [], onde + ': nenhum animal da posição tem o número no dia');
    }
    // 3. A importação de verdade (o arquivo de pesagens validado e importado): o mesmo animal, ou a recusa do brinco com o porquê.
    // Um peso por caso: o mesmo animal no mesmo dia em dois casos (o 0457 e o 457) não vira pesagem repetida.
    const imp = importarPesagem(s, 'caso' + i, texto, data, String(Number(esp.peso || 400) + i));
    if (esp.animal && esp.presente !== false) {
      assert.equal(imp.status, 'VALIDA', onde + ' — importação: ' + JSON.stringify(imp.erros));
      assert.equal(imp.animal_id, id[esp.animal], onde + ' — importação: a pesagem no mesmo animal');
    } else if (esp.animal) {
      assert.equal(imp.status, 'ERRO', onde + ' — importação');
      assert.ok(!imp.erros.some((e) => e.codigo === 'ANIMAL_NAO_ENCONTRADO'), onde + ' — importação: o animal foi achado (a recusa é a presença): ' + JSON.stringify(imp.erros));
    } else {
      assert.equal(imp.status, 'ERRO', onde + ' — importação');
      const e = imp.erros.find((x) => x.codigo === 'ANIMAL_NAO_ENCONTRADO');
      assert.ok(e, onde + ' — importação: a recusa do brinco: ' + JSON.stringify(imp.erros));
      if (esp.recusa === 'LANCADO_ERRADO' || esp.recusa === 'CODIGO_DE_ANIMAL_COM_BRINCO') assert.equal(e.mensagem, primeira.mensagem, onde + ' — importação: a mesma explicação');
      if (esp.recusa === 'ANTES_DO_USO' || esp.recusa === 'SEM_USO') assert.match(e.mensagem, new RegExp('não estava em uso em ' + br(data).replace(/\//g, '\\/')), onde);
    }
  });
  const rel = s.integridade();
  assert.equal(rel.ok, true, JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
});

test('resolvedor único: a rota descreve o animal na data (o brinco daquele dia e o de hoje, a presença e o porquê de não servir) e recusa data futura e lista grande demais', () => {
  const r = rebanho();
  const { s, id } = r;
  const d = ok(api(s, 'animal.resolver', { data: '2026-11-10', textos: ['0457'], ids: [id.E] }), 'resolver');
  assert.deepEqual([d.animais[id.A].brinco, d.animais[id.A].brinco_hoje, d.animais[id.A].presente], ['0457', '1457', true]);
  assert.deepEqual([d.animais[id.E].brinco, d.animais[id.E].presente, d.animais[id.E].inelegivel], ['0700', true, null]);
  const fora = ok(api(s, 'animal.resolver', { data: '2026-05-01', ids: [id.E] }), 'fora');
  assert.deepEqual([fora.animais[id.E].presente, fora.animais[id.E].inelegivel], [false, 'não estava no rebanho em 01/05/2026']);
  // As crias sem brinco da fêmea achada vêm junto (o "crias da <brinco da mãe>" do seletor).
  const mae = ok(api(s, 'animal.resolver', { data: '2026-03-01', textos: ['0391'] }), 'mãe').textos[0];
  assert.deepEqual([mae.animal_id, mae.crias], [id.B, [id.CRIA]]);
  const futura = api(s, 'animal.resolver', { data: '2026-11-16', textos: ['0457'] });
  assert.equal(futura.ok, false);
  assert.equal(futura.error.code, 'VALIDATION');
  const muitos = api(s, 'animal.resolver', { textos: Array.from({ length: 501 }, (_, i) => String(i)) });
  assert.equal(muitos.ok, false);
  assert.equal(muitos.error.code, 'VALIDATION');
  // Antes do marco zero não há posição: a presença fica sem resposta (o servidor decide a data na gravação), com o motivo.
  const antes = ok(api(s, 'animal.resolver', { data: '2025-06-01', textos: ['0391'] }), 'antes');
  assert.deepEqual([antes.motivo, antes.textos[0].como, antes.animais[id.B].presente], ['ANTERIOR_AO_MARCO_ZERO', 'HISTORICO', null]);
});
