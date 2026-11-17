'use strict';
/**
 * Regras de negócio da Fase 3 (05-regras-de-negocio.md, seções 2.7 a 2.9 e o algoritmo 4.7; 09, seções 4.1 e 6.1): o mapa
 * RN → teste e os testes das regras que não tinham caso próprio. O mapa é verificável (primeiro teste): toda RN das
 * seções 2.7 (pesagem), 2.8 (sanidade) e 2.9 (reprodução) de 05 está aqui, com os testes que a exercitam; cada teste
 * citado existe no arquivo citado; as RN que o mapa da Fase 2 deixou para a Fase 3 (tests/regras.fase2.test.js, DEPOIS)
 * estão aqui; os casos da Fase 3 de 09, seção 4.1 (056, 057, 058, 059, 072, 060, 061, 064 e 066), são passos dos cenários
 * de aceitação (TestRunner) e têm teste no nível 1.
 *
 * Testes novos deste arquivo: RN-051 em todo caminho (PESAGENS só cresce: registro, retroativo, mesmo dia, correção,
 * estorno, desmama, importação e desfazer nunca alteram nem apagam uma linha gravada); RN-053 (projeção, média calculada
 * do lote e carcaça nunca viram pesagem; a média informada do lote entra marcada como estimada, fora do GMD individual);
 * RN-058 pelos quatro critérios de 05, seção 4.7 (no rebanho e protocolo ativo, sexo, idade com nascimento conhecido,
 * categoria na data) e a aplicação vigente (o estorno devolve a pendência); RN-065 com a situação reprodutiva vinda dos
 * registros da Fase 3 (exposta, inseminada, prenha, vazia pelo diagnóstico, vazia pelo aborto). Depois de cada caso, a
 * verificação de integridade sem erro e projeção = reconstrução.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./apoio-sistema');

const { js, PASTOS } = S;
const DIR = __dirname;
const RN05 = path.join(DIR, '..', 'docs', 'fase-0', '05-regras-de-negocio.md');
const TESTRUNNER = path.join(DIR, '..', 'src', 'TestRunner.js');

/** RN da Fase 3 (05, seções 2.7 a 2.9) → [arquivo, começo do nome do teste] que a exercitam. */
const MAPA = {
  'RN-049': [['pesagem.test.js', 'faixa e formato (RN-049)'], ['regras.fase2.test.js', 'RN-049'], ['acceptance.test.js', 'aceitação das Fases 1 a 3 no fake']],
  'RN-050': [['pesagem.test.js', 'variação brusca (RN-050)'], ['jornada.fase3.test.js', 'jornada da Fase 3 pela API'], ['acceptance.test.js', 'aceitação das Fases 1 a 3 no fake']],
  'RN-051': [['regras.fase3.test.js', 'RN-051'], ['pesagem.test.js', 'registro individual e coletivo']],
  'RN-052': [['pesagem.desempenho.test.js', 'CT-05 na ficha'], ['pesagem.desempenho.test.js', 'métodos: fita'], ['pesagem.desempenho.test.js', 'animal que saiu e voltou']],
  'RN-053': [['regras.fase3.test.js', 'RN-053'], ['pesagem.desempenho.test.js', 'métodos: fita'], ['venda.test.js', 'CT-14 (a)']],
  'RN-054': [['sanidade.test.js', '03b, seção 15.2, linha a linha'], ['sanidade.test.js', 'CT-06 (09)'], ['acceptance.test.js', 'aceitação das Fases 1 a 3 no fake']],
  'RN-055': [['sanidade.test.js', 'CT-06 (09)'], ['sanidade.test.js', 'modo total, texto livre e os subtipos']],
  'RN-056': [['sanidade.test.js', 'protocolo e avisos'], ['acceptance.test.js', 'aceitação das Fases 1 a 3 no fake']],
  'RN-057': [['sanidade.test.js', 'protocolo e avisos'], ['estoque.test.js', 'regras da entrada e do acerto'], ['estoque.test.js', 'caminhos do estoque']],
  'RN-058': [['regras.fase3.test.js', 'RN-058'], ['sanidade.agenda.test.js', 'INTERVALO_DIAS (03a, 4.9)'], ['sanidade.agenda.test.js', 'CAMPANHA_MESES'], ['sanidade.agenda.test.js', 'UNICA (05, seção 4.7)'], ['jornada.fase3.test.js', 'jornada da Fase 3 pela API']],
  'RN-059': [['sanidade.agenda.test.js', 'pendência por produto sem protocolo'], ['jornada.fase3.test.js', 'jornada da Fase 3 pela API'], ['acceptance.test.js', 'aceitação das Fases 1 a 3 no fake']],
  'RN-060': [['reproducao.test.js', 'cobertura e inseminação'], ['nascimento.test.js', 'validações do parto: matriz fêmea'], ['trava.integridade.test.js', 'GENEALOGIA pela correção do cadastro de referência']],
  'RN-061': [['reproducao.test.js', 'cobertura e inseminação'], ['nascimento.test.js', 'avisos: idade reprodutiva']],
  'RN-062': [['nascimento.test.js', 'CT-01 passo 3'], ['nascimento.test.js', 'natimorto sem nenhum vivo']],
  'RN-063': [['nascimento.test.js', 'CT-01 passo 3'], ['jornada.fase3.test.js', 'jornada da Fase 3 pela API']],
  'RN-064': [['nascimento.test.js', 'avisos: idade reprodutiva']],
  'RN-065': [['regras.fase3.test.js', 'RN-065'], ['regras.fase2.test.js', 'RN-065']],
  'RN-066': [['reproducao.indicadores.test.js', '09, RN-066'], ['reproducao.indicadores.test.js', '07, seção 8.3'], ['jornada.fase3.test.js', 'jornada da Fase 3 pela API']],
};
/** O algoritmo de 05, seção 4.7 (elegibilidade do protocolo), com o exemplo dele. */
const ALGORITMO_47 = [['regras.fase3.test.js', 'RN-058'], ['sanidade.agenda.test.js', 'UNICA (05, seção 4.7)']];
/**
 * Os casos da Fase 3 de 09, seção 4.1: o passo do cenário de aceitação (TestRunner, nível 2; rodado no nível 1 por
 * tests/acceptance.test.js) e o teste do nível 1.
 */
const CASOS_09 = {
  '056': ['SANIDADE', '056-057', ['sanidade.test.js', 'protocolo e avisos']],
  '057': ['SANIDADE', '056-057', ['estoque.test.js', 'regras da entrada e do acerto']],
  '058': ['SANIDADE', '058-4.7', ['sanidade.agenda.test.js', 'UNICA (05, seção 4.7)']],
  '059': ['SANIDADE', '058-059', ['sanidade.agenda.test.js', 'pendência por produto sem protocolo']],
  '072': ['SANIDADE', '072', ['sanidade.test.js', 'carência pelo registro real (RN-072)']],
  '060': ['REPRODUCAO', '060', ['reproducao.test.js', 'cobertura e inseminação']],
  '061': ['REPRODUCAO', '061', ['nascimento.test.js', 'avisos: idade reprodutiva']],
  '064': ['REPRODUCAO', '064', ['nascimento.test.js', 'avisos: idade reprodutiva']],
  '066': ['REPRODUCAO', '066', ['reproducao.indicadores.test.js', '09, RN-066']],
};

test('mapa RN da Fase 3 → teste (09, seção 6.1): toda RN de 05, seções 2.7 a 2.9, está no mapa com testes que existem; as que a Fase 2 deixou para cá também; os casos de 09, seção 4.1, estão na aceitação e no nível 1', () => {
  const texto = fs.readFileSync(RN05, 'utf8');
  const secao = texto.slice(texto.indexOf('### 2.7 Pesagem'), texto.indexOf('### 2.10 '));
  const daFase = [...new Set(secao.match(/^\|RN-\d{3}\|/gm).map((x) => x.slice(1, 7)))];
  assert.equal(daFase.length, 18, 'RN-049 a RN-066');
  assert.deepEqual(Object.keys(MAPA).sort(), daFase.sort(), 'o mapa tem exatamente as RN das seções 2.7 a 2.9');
  assert.ok(texto.indexOf('### 4.7 Elegibilidade de protocolo sanitário (RN-058)') > 0, 'o algoritmo 4.7 é o da RN-058');
  const cache = {};
  const nomes = (arq) => {
    if (!cache[arq]) cache[arq] = (fs.readFileSync(path.join(DIR, arq), 'utf8').match(/^test\('([^']*)'/gm) || []).map((l) => l.slice(6, -1));
    return cache[arq];
  };
  const existe = (rot, [arq, prefixo]) => assert.ok(nomes(arq).some((n) => n.indexOf(prefixo) === 0), rot + ': nenhum teste começa com "' + prefixo + '" em ' + arq);
  Object.keys(MAPA).forEach((rn) => {
    assert.ok(MAPA[rn].length > 0, rn);
    MAPA[rn].forEach((t) => existe(rn, t));
  });
  ALGORITMO_47.forEach((t) => existe('05, seção 4.7', t));
  // O que o mapa da Fase 2 deixou para a Fase 3 tem lugar aqui.
  const f2 = fs.readFileSync(path.join(DIR, 'regras.fase2.test.js'), 'utf8');
  const depois = f2.slice(f2.indexOf('const DEPOIS = {'), f2.indexOf('};', f2.indexOf('const DEPOIS = {')));
  const paraFase3 = (depois.match(/'RN-\d{3}': \[3,/g) || []).map((m) => m.slice(1, 7));
  assert.ok(paraFase3.length >= 10, 'as RN que a Fase 2 deixou para a Fase 3: ' + paraFase3);
  assert.deepEqual(paraFase3.filter((rn) => !MAPA[rn]), [], 'RN da Fase 2 adiada sem lugar no mapa da Fase 3');
  // Os casos de 09, seção 4.1: o passo do cenário existe no TestRunner e o teste do nível 1 também.
  const runner = fs.readFileSync(TESTRUNNER, 'utf8');
  Object.keys(CASOS_09).forEach((k) => {
    const [cenario, passo, t] = CASOS_09[k];
    const ini = runner.indexOf("id: '" + cenario + "'");
    assert.ok(ini > 0, 'cenário ' + cenario + ' no TestRunner');
    const fim = runner.indexOf("\n    {\n      id: '", ini + 10);
    assert.ok(runner.slice(ini, fim > 0 ? fim : undefined).indexOf("t.passo('" + passo + "'") > 0, 'caso ' + k + ': passo ' + passo + ' no cenário ' + cenario);
    existe('caso ' + k + ' de 09', t);
  });
});

// ------------------------------------------------------------------ apoio ----
function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave, avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + JSON.stringify(r.error));
  return r.data;
}
const relogio = (s, data) => { s.gas.clock.now = Date.parse(data + 'T15:00:00.000Z'); };
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
function rebanho(s, bichos, chave) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(bichos.map((b) => S.bicho(Object.assign({ data_nascimento_confianca: b.data_nascimento ? 'CONFIRMADA' : undefined }, b)))), chave || 'reb'), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return ids;
}
const pes = (data, itens, campos) => ({ tipo: 'PESAGEM', campos: Object.assign({ event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, campos || {}), animais: itens });
const animal = (s, id) => s.tabela('ANIMAIS').find((a) => a.animal_id === id);

// ------------------------------------------------------------------ RN-051 ----
test('RN-051 em todo caminho: PESAGENS só cresce — registro, retroativo, mesmo dia, correção, correção do substituto, estorno, desmama, importação e o desfazer dela nunca alteram nem apagam uma linha gravada (a correção e o estorno só tiram o lançamento da vigência)', () => {
  const s = S.sistema();
  const ids = rebanho(s, ['1', '2', '3', '4'].map((b) => ({ brinco: b, sexo: 'M', castrado: true, data_nascimento: '2024-05-01' })));
  const mae = rebanho(s, [{ brinco: '50', data_nascimento: '2020-01-01', partos_previos: 1 }], 'reb-mae')['50'];
  const cria = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-02-01' }, animais: [{ animal_id: mae }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '51', peso: 31, metodo_pesagem: 'BALANCA' }] }, 'parto')).animais.find((a) => a.animal_id !== mae).animal_id;
  const vistas = {};
  const conferir = (onde, cresceu) => {
    const linhas = s.tabela('PESAGENS');
    Object.keys(vistas).forEach((w) => assert.deepEqual(linhas.find((p) => p.weight_id === w), vistas[w], onde + ': a linha ' + w + ' gravada antes ficou como estava'));
    const novas = linhas.filter((p) => !vistas[p.weight_id]);
    assert.equal(novas.length > 0, cresceu, onde + (cresceu ? ': linhas novas' : ': nenhuma linha nova'));
    novas.forEach((p) => { vistas[p.weight_id] = p; });
    semErro(s, onde);
  };
  conferir('parto', true);
  const lista = (peso) => ['1', '2', '3', '4'].map((b) => ({ animal_id: ids[b], peso }));
  ok(api(s, 'evento.registrar', pes('2026-03-01', lista(300)), 'p1'));
  conferir('registro', true);
  const p2 = ok(api(s, 'evento.registrar', pes('2026-05-01', lista(330)), 'p2'));
  conferir('segunda pesagem', true);
  ok(api(s, 'evento.registrar', pes('2026-02-01', lista(285)), 'p0'));
  conferir('retroativa', true);
  ok(api(s, 'evento.registrar', pes('2026-05-01', [{ animal_id: ids['1'], peso: 331 }]), 'p2b', ['POSSIVEL_DUPLICIDADE']));
  conferir('mesmo dia', true);
  const k = ok(api(s, 'evento.corrigir', Object.assign(pes('2026-05-01', lista(332)), { event_id: p2.event_id, justificativa: 'Balança sem tara' }), 'k', ['POSSIVEL_DUPLICIDADE']));
  conferir('correção', true);
  const k2 = ok(api(s, 'evento.corrigir', Object.assign(pes('2026-05-02', lista(332)), { event_id: k.event_id, justificativa: 'A data era 02/05' }), 'k2'));
  conferir('correção do substituto', true);
  ok(api(s, 'evento.estornar', { event_id: k2.event_id, justificativa: 'Pesagem repetida' }, 'e'));
  conferir('estorno', false);
  ok(api(s, 'evento.registrar', { tipo: 'DESMAMA', campos: { event_date: '2026-10-01', pasto_destino_id: PASTOS.B }, animais: [{ animal_id: cria, peso: 210 }] }, 'desmama'));
  conferir('desmama', true);
  // Importação da balança e o desfazer: as linhas do arquivo ficam (inertes), as anteriores não mudam.
  const texto = 'Data da pesagem;Brinco;Peso (kg)\r\n' + ['1', '2', '3', '4'].map((b) => '01/07/2026;' + b + ';36' + b + ',5').join('\r\n');
  const criado = ok(api(s, 'importacao.criar', { tipo: 'PESAGENS', arquivo_nome: 'balanca.csv', texto, formato: { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' } }, 'imp'));
  const est = ok(api(s, 'importacao.validarBloco', { import_id: criado.import_id, bloco: 1, mapeamento: { colunas: { 'Data da pesagem': 'data', Brinco: 'brinco', 'Peso (kg)': 'peso' }, confiancas: {}, padroes: { momento: 'ROTINA', metodo: 'BALANCA' } } }, 'val'));
  assert.equal(est.importacao.status, 'VALIDADO');
  ok(api(s, 'importacao.importarBloco', { import_id: criado.import_id, bloco: 1, modo: 'TOTAL' }, 'bl'));
  ok(api(s, 'importacao.concluir', { import_id: criado.import_id }, 'fim'));
  conferir('importação', true);
  assert.equal(animal(s, ids['3']).peso_atual, 363.5, 'a pesagem importada vale');
  ok(api(s, 'importacao.desfazer', { import_id: criado.import_id, justificativa: 'Arquivo de outra fazenda' }, 'desf'));
  conferir('desfazer', false);
  assert.equal(animal(s, ids['3']).peso_atual, 300, 'o peso atual volta ao da última pesagem vigente (01/03: o estorno da correção não traz de volta a de 01/05 que ela corrigiu)');
});

// ------------------------------------------------------------------ RN-053 ----
test('RN-053: projeção, média calculada e carcaça nunca entram em PESAGENS — a ficha e o desempenho (projeção, GMD de lote) não gravam nada; a venda por arroba de carcaça grava só o peso vivo informado; a média do lote informada pelo operador entra marcada como estimada (MEDIA_LOTE) e fica fora do GMD individual', () => {
  const s = S.sistema();
  const brincos = ['11', '12', '13', '14', '15'];
  const ids = rebanho(s, brincos.map((b) => ({ brinco: b, sexo: 'M', castrado: true, data_nascimento: '2024-04-01' })));
  const comp = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } }, 'frig')).partner_id;
  const lista = (peso) => brincos.map((b) => ({ animal_id: ids[b], peso }));
  ok(api(s, 'evento.registrar', pes('2026-08-01', lista(400)), 'p1'));
  ok(api(s, 'evento.registrar', pes('2026-10-01', lista(436)), 'p2'));
  const linhas0 = s.tabela('PESAGENS');
  const versao = () => s.props()['DATA_VERSION:' + s.banco()];
  const v0 = versao();
  const ficha = ok(api(s, 'animal.ficha', { animal_id: ids['11'] })).peso;
  assert.equal(ficha.projecao.rotulo, 'Estimativa', 'a ficha mostra a projeção');
  assert.ok(ficha.projecao.pontos && ficha.projecao.pontos.length > 0, 'com pontos estimados');
  const d = ok(api(s, 'peso.desempenho', { animais: [ids['11'], ids['12']] }));
  assert.deepEqual([d.geral.gmd.valor, d.pesagens.length, d.curvas.length], [0.59, 2, 2], 'o desempenho calcula o GMD, o de lote de cada pesagem e as curvas com a projeção');
  assert.ok(d.curvas.every((c) => c.projecao && c.projecao.rotulo === 'Estimativa'), 'a projeção das curvas é rotulada');
  assert.deepEqual([s.tabela('PESAGENS'), versao()], [linhas0, v0], 'consultar a projeção e as médias não grava nada');
  // A média do lote informada pelo operador: estimada, fora do GMD individual.
  const lote = ok(api(s, 'evento.registrar', pes('2026-11-01', brincos.map((b) => ({ animal_id: ids[b] })), { peso_total_lote_kg: 2250, qtd_cabecas_lote: 5 }), 'lote'));
  assert.deepEqual(s.tabela('PESAGENS').filter((p) => p.event_id === lote.event_id).map((p) => [p.peso_kg, p.metodo]), brincos.map(() => [450, 'MEDIA_LOTE']));
  const f2 = ok(api(s, 'animal.ficha', { animal_id: ids['11'] })).peso;
  assert.deepEqual(f2.intervalos.map((v) => [v.de, v.ate, v.gmd_kg_dia]), [['2026-08-01', '2026-10-01', 0.59]], 'a média do lote não abre intervalo de GMD');
  assert.equal(f2.serie.find((x) => x.data === '2026-11-01').estimado, true, 'na curva, marcada como estimada');
  // Venda por arroba de carcaça: o peso vivo de quem foi pesado vira pesagem; a carcaça nunca.
  const n0 = s.tabela('PESAGENS').length;
  const v = ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-11-10', partner_id: comp, finalidade: 'ABATE', modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor_bruto: 1184000 }, animais: [{ animal_id: ids['11'], peso: 540, peso_carcaca_kg: 285 }, { animal_id: ids['12'], peso_carcaca_kg: 270 }], parcelas: [{ data_vencimento: '2026-12-10' }] }, 'venda'));
  const daVenda = s.tabela('PESAGENS').filter((p) => p.event_id === v.event_id);
  assert.deepEqual(daVenda.map((p) => [p.animal_id, p.peso_kg, p.tipo]), [[ids['11'], 540, 'VENDA']], 'só o peso vivo informado');
  assert.equal(s.tabela('PESAGENS').length, n0 + 1);
  assert.ok(s.tabela('PESAGENS').every((p) => p.peso_kg !== 285 && p.peso_kg !== 270), 'nenhuma carcaça em PESAGENS');
  semErro(s, 'RN-053');
});

// ------------------------------------------------------------------ RN-058 (05, seção 4.7) ----
test('RN-058 (05, seção 4.7): os quatro critérios da elegibilidade — no rebanho na data e protocolo ativo, sexo, idade em meses completos com o nascimento conhecido, categoria na data — e a pendência só se cumpre com aplicação vigente (estornada, volta)', () => {
  const s = S.sistema();
  // Os protocolos são cadastrados em janeiro: a agenda de uma data só conta o protocolo que já valia nela (revisão da Fase 3,
  // rodada 2, achado 10).
  relogio(s, '2026-01-05');
  const cat = (codigo) => s.tabela('CATEGORIAS').find((c) => c.codigo === codigo).category_id;
  const comp = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Recriador', tipos: ['COMPRADOR'] } }, 'comp')).partner_id;
  const ids = rebanho(s, [
    { brinco: 'F1', sexo: 'F', data_nascimento: '2025-12-01' }, // bezerra: 6 meses em 01/06/2026
    { brinco: 'F2', sexo: 'F', data_nascimento: '2025-12-01' }, // a vendida em 01/03/2026
    { brinco: 'F3', sexo: 'F' }, // sem nascimento
    { brinco: 'M1', sexo: 'M', data_nascimento: '2025-12-01' },
  ]);
  const prot = (campos, chave) => ok(api(s, 'protocolo.salvar', { campos: Object.assign({ tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 365 }, campos) }, chave)).protocol_id;
  const faixa = prot({ nome: 'Fêmeas de 3 a 12 meses', sexo_aplicavel: 'F', idade_min_meses: 3, idade_max_meses: 12 }, 'p-faixa');
  const semFaixa = prot({ nome: 'Todo o rebanho' }, 'p-todos');
  const bezerra = prot({ nome: 'Só bezerras', category_id: cat('BEZERRA') }, 'p-cat');
  relogio(s, '2026-06-01');
  ok(api(s, 'evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-03-01', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 150000, valor_bruto: 150000 }, animais: [{ animal_id: ids.F2 }], parcelas: [{ data_vencimento: '2026-03-01' }] }, 'venda'));
  const agenda = (data) => ok(api(s, 'sanidade.agenda', { data }));
  const quem = (a, p) => a.pendencias.filter((x) => x.protocol_id === p).map((x) => x.animal_id).sort();
  const daFaixa = (a) => a.protocolos.find((x) => x.protocol_id === faixa).elegiveis;
  // 1. No rebanho na data: a F2 conta até a venda (com 3 meses em 01/03 ela é elegível na véspera) e não depois.
  assert.deepEqual(quem(agenda('2026-02-28'), faixa), [], 'em 28/02 nenhuma tem 3 meses');
  assert.deepEqual(quem(agenda('2026-03-01'), faixa), [ids.F1], 'em 01/03 a F1 fica elegível (vencida: nunca aplicada); a F2 saiu no fim do dia');
  // 2. Sexo: o macho da mesma idade nunca entra no protocolo de fêmeas; no de todo o rebanho, sim.
  const a = agenda('2026-06-01');
  assert.deepEqual(quem(a, faixa), [ids.F1], 'sexo: só a fêmea');
  // 3. Idade com nascimento conhecido: a F3 (sem nascimento) fica fora do protocolo com faixa, dentro do sem faixa.
  assert.deepEqual(quem(a, semFaixa), [ids.F1, ids.F3, ids.M1].sort(), 'sem faixa: todos os presentes, inclusive sem nascimento');
  assert.equal(daFaixa(a), 1, 'com faixa: a F3 sem nascimento não é elegível');
  // 4. Categoria na data: a F1 é bezerra até 12 meses; em 01/12/2026 vira novilha e sai do protocolo.
  assert.deepEqual(quem(a, bezerra), [ids.F1], 'bezerra em 01/06');
  relogio(s, '2026-12-15');
  const dez = agenda('2026-12-15');
  assert.deepEqual([quem(dez, bezerra), quem(dez, faixa)], [[], []], 'com 12 meses: nem bezerra nem na faixa de 3 a 12');
  // Aplicação vigente: vacinada em 10/06, cumpre (365 dias); estornada, a pendência volta.
  const vac = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-06-10', protocol_id: semFaixa, nome_produto: 'Vacina', modo_dose: 'POR_CABECA', dose_referencia: 1, unidade_dose: 'dose' }, animais: [{ animal_id: ids.F1 }] }, 'vac'));
  assert.deepEqual(quem(agenda('2026-12-15'), semFaixa), [ids.F3, ids.M1].sort(), 'a F1 em dia');
  ok(api(s, 'evento.estornar', { event_id: vac.event_id, justificativa: 'Lançada na bezerra errada' }, 'est'));
  assert.deepEqual(quem(agenda('2026-12-15'), semFaixa), [ids.F1, ids.F3, ids.M1].sort(), 'estornada, a F1 volta a dever');
  // Protocolo desativado sai da agenda.
  ok(api(s, 'protocolo.salvar', { protocol_id: semFaixa, campos: { ativo: false } }, 'des'));
  assert.deepEqual(quem(agenda('2026-12-15'), semFaixa), []);
  semErro(s, 'RN-058');
});

// ------------------------------------------------------------------ RN-065 ----
test('RN-065 na Fase 3: o parto é aceito de qualquer situação vinda dos registros — exposta, inseminada, prenha, vazia pelo diagnóstico e vazia pelo aborto —, sem aviso nem recusa, e deixa a matriz vazia com cria ao pé', () => {
  const s = S.sistema();
  const ids = rebanho(s, [1, 2, 3, 4, 5].map((i) => ({ brinco: 'C' + i, data_nascimento: '2020-0' + i + '-10', partos_previos: 2 })).concat([{ brinco: 'T', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01' }]));
  const semen = ok(api(s, 'animal.cadastrarExterno', { campos: { nome: 'Touro do sêmen', sexo: 'M' } }, 'ext')).animal_id;
  const repro = (sub, data, itens, campos, chave) => ok(api(s, 'evento.registrar', { tipo: 'REPRODUCAO', subtipo: sub, campos: Object.assign({ event_date: data }, campos || {}), animais: itens }, chave));
  repro('EXPOSICAO', '2026-01-10', [{ animal_id: ids.C1 }, { animal_id: ids.T }], {}, 'expo');
  repro('INSEMINACAO', '2026-01-10', [{ animal_id: ids.C2 }], { touro_id: semen, metodo: 'IATF' }, 'ia');
  repro('DIAGNOSTICO_GESTACAO', '2026-01-15', [{ animal_id: ids.C3, resultado: 'POSITIVO' }, { animal_id: ids.C4, resultado: 'NEGATIVO' }, { animal_id: ids.C5, resultado: 'POSITIVO' }], { metodo: 'PALPACAO' }, 'dg');
  repro('ABORTO', '2026-02-01', [{ animal_id: ids.C5, idade_gestacional_dias: 120 }], {}, 'aborto');
  const situacao = (b) => animal(s, ids[b]).situacao_reprodutiva;
  assert.deepEqual(['C1', 'C2', 'C3', 'C4', 'C5'].map(situacao), ['EXPOSTA', 'INSEMINADA', 'PRENHA', 'VAZIA', 'VAZIA'], 'as situações projetadas dos registros');
  [['C1', '2026-03-01'], ['C2', '2026-03-05'], ['C3', '2026-03-10'], ['C4', '2026-03-15'], ['C5', '2026-10-20']].forEach(([b, data]) => {
    const r = api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: data }, animais: [{ animal_id: ids[b] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }, 'parto-' + b);
    assert.equal(r.ok, true, b + ' (' + situacao(b) + '): o parto não depende da situação — ' + JSON.stringify(r.error));
    const m = animal(s, ids[b]);
    assert.deepEqual([m.situacao_reprodutiva, m.cria_ao_pe], ['VAZIA', true], b + ': vazia com cria ao pé');
  });
  semErro(s, 'RN-065');
});
