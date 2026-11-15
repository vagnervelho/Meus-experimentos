'use strict';
/**
 * Regras de negócio da Fase 2 (05-regras-de-negocio.md; 09, seção 6.1): o mapa RN → teste e os testes das regras que não
 * tinham caso próprio. O mapa é verificável (primeiro teste): toda RN de 05 está aqui (Fase 2, com os testes que a
 * exercitam), no mapa da Fase 1 (tests/regras.fase1.test.js) ou na lista das fases seguintes, com o motivo; cada teste
 * citado existe no arquivo citado. É também o teste estático de 09, seção 6.1 ("falha se alguma RN de 05 não for citada").
 *
 * Testes novos deste arquivo: RN-006 em todo evento de rebanho da Fase 2; RN-037 na revisão pelo servidor (venda,
 * correção de compra, estorno); RN-049 nos pesos dos eventos da Fase 2; RN-065 (parto aceito de qualquer situação
 * reprodutiva); RN-071 (rateio MANUAL da compra); RN-075 (dinheiro dos eventos da Fase 2: uma causa, um erro, em
 * português); RN-094 na importação de nascimentos (pai não encontrado até a decisão). Depois de CADA comando o apoio
 * confere projeção = reconstrução e as invariantes do financeiro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('./apoio-cadastros');
const S = require('./apoio-sistema');

const { js, PASTOS, bicho, entradaInicial, codigos } = C;
const DIR = __dirname;
const RN05 = path.join(DIR, '..', 'docs', 'fase-0', '05-regras-de-negocio.md');

/** RN da Fase 2 → [arquivo, começo do nome do teste] que a exercitam. */
const MAPA = {
  'RN-002': [['estorno.test.js', 'CT-09 completo pela api()'], ['events.test.js', 'CT-09: brinco duplicado']],
  'RN-003': [['events.test.js', 'CT-09: brinco duplicado']],
  'RN-004': [['identificacao.test.js', 'RN-004: brinco aposentado por troca']],
  'RN-005': [['nascimento.test.js', 'CT-01 passo 1'], ['identificacao.test.js', 'IDENTIFICACAO: primeiro brinco no bezerro']],
  'RN-006': [['regras.fase2.test.js', 'RN-006'], ['movimentos.test.js', 'transferência: destino diferente da origem']],
  'RN-008': [['nascimento.test.js', 'validações do parto: matriz fêmea'], ['nascimento.test.js', 'pai opcional']],
  'RN-009': [['nascimento.test.js', 'linha do tempo: matriz fora do rebanho na data'], ['nascimento.test.js', 'pai opcional']],
  'RN-013': [['estorno.test.js', 'CT-08: inventário em qualquer data'], ['integrity.fase2.test.js', 'animal baixado sem evento posterior vigente']],
  'RN-014': [['estorno.test.js', 'CT-09 completo pela api()'], ['venda.test.js', 'validações por animal']],
  'RN-015': [['movimentos.test.js', 'morte: BAIXAS com causa'], ['estorno.test.js', 'CT-09 completo pela api()']],
  'RN-016': [['compra.test.js', 'compra de animal que já foi da fazenda'], ['movimentos.test.js', 'descarte: motivo e destino da lista'], ['identificacao.test.js', 'DIVERGENCIA_CONTAGEM: baixa']],
  'RN-017': [['estorno.test.js', 'CT-17 (b)'], ['fase2.adversarial.test.js', 'fato no dia da saída (RN-017)']],
  'RN-018': [['movimentos.test.js', 'CT-02: transferência coletiva']],
  'RN-019': [['movimentos.test.js', 'transferência: destino diferente da origem'], ['regras.fase1.test.js', 'RN-019 e RN-021']],
  'RN-020': [['movimentos.test.js', 'CT-17 (a)'], ['compra.test.js', 'compra retroativa e correção de data']],
  'RN-021': [['movimentos.test.js', 'saída coletiva é tudo ou nada'], ['regras.fase1.test.js', 'RN-019 e RN-021']],
  'RN-022': [['nascimento.test.js', 'parto antes do marco zero'], ['import.eventos.test.js', 'COMPRAS: linhas agrupadas']],
  'RN-023': [['fase2.adversarial.test.js', 'mesmo dia com as classes 0, 1 e 2'], ['movimentos.test.js', 'CT-17 (a)']],
  'RN-024': [['jornada.fase2.test.js', 'jornada da Fase 2 pela API'], ['estorno.test.js', 'CT-08: inventário em qualquer data']],
  'RN-025': [['estorno.test.js', 'CT-08: inventário em qualquer data'], ['lotacao.test.js', 'composição em data histórica']],
  'RN-027': [['lotacao.test.js', 'aviso LOTACAO_ACIMA_DA_CAPACIDADE'], ['movimentos.test.js', 'transferência: lotação acima']],
  'RN-028': [['movimentos.test.js', 'CT-02: transferência coletiva'], ['movimentos.test.js', 'saída coletiva é tudo ou nada']],
  'RN-029': [['venda.test.js', 'validações por animal'], ['identificacao.test.js', 'IDENTIFICACAO: regras e falhas']],
  'RN-032': [['import.eventos.test.js', 'TRANSFERENCIAS: ordem cronológica']],
  'RN-036': [['nascimento.test.js', 'reenvio com a mesma chave'], ['movimentos.test.js', 'CT-17 (a)']],
  'RN-037': [['regras.fase2.test.js', 'RN-037']],
  'RN-039': [['estorno.test.js', 'CT-07'], ['estorno.test.js', 'E2.7: todo tipo e subtipo ativo']],
  'RN-040': [['estorno.test.js', 'CT-07'], ['movimentos.test.js', 'transferência: estorno com transferência posterior']],
  'RN-041': [['nascimento.test.js', 'estorno de parto bloqueado quando a cria já é mãe'], ['compra.test.js', 'estorno de compra']],
  'RN-042': [['compra.test.js', 'estorno de compra'], ['venda.test.js', 'estorno de venda']],
  'RN-043': [['estorno.test.js', 'CT-07'], ['estorno.test.js', 'E2.7: todo tipo e subtipo ativo']],
  'RN-044': [['estorno.test.js', 'CT-18 na Fase 2'], ['compra.test.js', 'CT-18 na Fase 2']],
  'RN-045': [['fase2.adversarial.test.js', 'estorno de compra com venda posterior'], ['regras.fase1.test.js', 'RN-045, RN-047 e RN-048']],
  'RN-047': [['identificacao.test.js', 'DIVERGENCIA_CONTAGEM: baixa'], ['regras.fase1.test.js', 'RN-045, RN-047 e RN-048']],
  'RN-048': [['nascimento.test.js', 'CT-01 passo 2']],
  'RN-049': [['regras.fase2.test.js', 'RN-049'], ['nascimento.test.js', 'validações do parto: matriz fêmea']],
  'RN-053': [['venda.test.js', 'CT-14 (a)']],
  'RN-060': [['nascimento.test.js', 'validações do parto: matriz fêmea']],
  'RN-061': [['nascimento.test.js', 'avisos: idade reprodutiva']],
  'RN-062': [['nascimento.test.js', 'CT-01 passo 3'], ['nascimento.test.js', 'natimorto sem nenhum vivo']],
  'RN-063': [['nascimento.test.js', 'CT-01 passo 3']],
  'RN-064': [['nascimento.test.js', 'avisos: idade reprodutiva']],
  'RN-065': [['regras.fase2.test.js', 'RN-065']],
  'RN-067': [['compra.test.js', 'regras da negociação (RN-067'], ['venda.test.js', 'CT-14 (b) e (c)']],
  'RN-068': [['compra.test.js', 'regras da negociação (RN-067'], ['venda.test.js', 'regras da venda']],
  'RN-069': [['venda.test.js', 'CT-04: venda por kg vivo'], ['venda.test.js', 'CT-14 (a)']],
  'RN-070': [['compra.test.js', 'CT-03: parcelas que não somam'], ['integrity.fase2.test.js', 'alocações = 100% do lançamento']],
  'RN-071': [['regras.fase2.test.js', 'RN-071'], ['compra.test.js', '03b, 4.4']],
  'RN-072': [['venda.test.js', 'carência na venda (RN-072)']],
  'RN-073': [['venda.test.js', '07 4.3 (b)'], ['compra.test.js', '03b, 4.4']],
  'RN-074': [['movimentos.test.js', 'descarte: motivo e destino da lista']],
  'RN-075': [['regras.fase2.test.js', 'RN-075'], ['compra.test.js', 'cabeçalho, parceiros e parcelas']],
  'RN-076': [['compra.test.js', 'CT-03: parcelas que não somam'], ['fase2.adversarial.test.js', 'parcelas que diferem de 1 centavo']],
  'RN-077': [['integrity.fase2.test.js', 'alocações = 100% do lançamento'], ['integrity.fase2.test.js', 'invariantes do financeiro de 03b']],
  'RN-078': [['compra.test.js', 'CT-13 na compra'], ['financeiro.test.js', 'CT-13 (a a d)'], ['fase2.adversarial.test.js', 'rateio com centavos patológicos']],
  'RN-079': [['compra.test.js', '03b, 15.1 linha a linha']],
  'RN-080': [['compra.test.js', '03b, 15.1 linha a linha'], ['lotacao.test.js', '05, seção 4.6']],
  'RN-082': [['compra.test.js', 'período financeiro fechado (RN-082)'], ['venda.test.js', 'período financeiro fechado (RN-082)']],
  'RN-086': [['lotacao.test.js', 'peso vigente na data']],
  'RN-088': [['import.eventos.test.js', 'COMPRAS, recusas por linha']],
  'RN-089': [['import.eventos.test.js', 'TRANSFERENCIAS: origem que não confere']],
  'RN-090': [['import.eventos.test.js', 'COMPRAS: linhas agrupadas']],
  'RN-091': [['import.eventos.test.js', 'COMPRAS, recusas por linha']],
  'RN-092': [['import.eventos.test.js', 'TRANSFERENCIAS: ordem cronológica']],
  'RN-093': [['import.test.js', 'CT-12 (1)–(5)'], ['acceptance.test.js', 'aceitação das Fases 1 e 2 no fake']],
  'RN-094': [['regras.fase2.test.js', 'RN-094'], ['regras.fase1.test.js', 'RN-094']],
  'RN-095': [['import.eventos.test.js', 'TRANSFERENCIAS: ordem cronológica'], ['import.eventos.test.js', 'VENDAS e MORTES'], ['jornada.fase2.test.js', 'jornada da Fase 2 pela API']],
  'RN-105': [['anexos.test.js', 'compra: nota fiscal, GTA'], ['regras.fase1.test.js', 'RN-105, RN-108 e RN-110']],
  'RN-108': [['estorno.test.js', 'CT-07'], ['regras.fase1.test.js', 'RN-105, RN-108 e RN-110']],
  'RN-111': [['jornada.fase2.test.js', 'jornada da Fase 2 pela API'], ['compra.test.js', '03b, 15.1 linha a linha']],
  'RN-112': [['integrity.fase2.test.js', 'projeção × reconstrução cobre cada campo']],
};
/** RN que valem para todo comando ou são da Fase 1: o mapa delas está no cabeçalho de tests/regras.fase1.test.js. */
const FASE1 = ['RN-001', 'RN-007', 'RN-010', 'RN-011', 'RN-012', 'RN-026', 'RN-030', 'RN-031', 'RN-033', 'RN-034', 'RN-035', 'RN-038',
  'RN-096', 'RN-097', 'RN-098', 'RN-099', 'RN-100', 'RN-101', 'RN-102', 'RN-103', 'RN-104', 'RN-106', 'RN-107', 'RN-109', 'RN-110'];
/** RN das fases seguintes, com o motivo: o teste delas chega com o módulo. */
const DEPOIS = {
  'RN-050': [3, 'aviso de variação de peso entre pesagens (PESAGEM)'], 'RN-051': [3, 'pesagem nova não substitui a anterior (PESAGEM)'],
  'RN-052': [3, 'GMD com intervalo mínimo e método individual (PESAGEM)'], 'RN-054': [3, 'aplicação sanitária coletiva (SANIDADE)'],
  'RN-055': [3, 'dose e quantidade consumida (SANIDADE)'], 'RN-056': [3, 'lote vencido na aplicação (SANIDADE)'],
  'RN-057': [3, 'estoque insuficiente (ESTOQUE)'], 'RN-058': [3, 'pendência de protocolo sanitário (agenda)'],
  'RN-059': [3, 'agenda e alertas de vencido e de carência (sanidade.agenda)'], 'RN-066': [3, 'indicadores reprodutivos com n mínimo (reproducao.indicadores)'],
  'RN-046': [4, 'transportar a baixa da parcela na correção: sem parcela.baixar (Fase 4) não há baixa a transportar; nesta fase a correção de evento com parcela paga é recusada (PARCELA_LIQUIDADA, venda.test "estorno de venda")'],
  'RN-081': [4, 'baixa de parcela (parcela.baixar)'], 'RN-083': [4, 'resultado gerencial por natureza (financeiro.resultado)'],
  'RN-084': [4, 'conciliação caixa × resultado × custo por animal (CT-19)'], 'RN-085': [4, 'valor do animal pela TABELA_PRECOS (patrimônio)'],
  'RN-087': [4, 'rótulos de valor estimado, custo e negociado no patrimônio e nos relatórios'],
};

/** Números de RN citados num texto: "RN-033", "RN-033/034/035" e "RN-007 a RN-012". */
function citadas(texto) {
  const out = new Set();
  (texto.match(/RN-\d{3}(\/\d{3})*/g) || []).forEach((m) => m.slice(3).split('/').forEach((n) => out.add('RN-' + n)));
  (texto.match(/RN-\d{3} a RN-\d{3}/g) || []).forEach((m) => {
    const [a, b] = m.match(/\d{3}/g).map(Number);
    for (let i = a; i <= b; i++) out.add('RN-' + String(i).padStart(3, '0'));
  });
  return out;
}

test('mapa RN da Fase 2 → teste (09, seção 6.1): toda RN de 05 está no mapa desta fase, no da Fase 1 ou nas fases seguintes com o motivo; cada teste citado existe', () => {
  const todas = [...new Set(fs.readFileSync(RN05, 'utf8').match(/^\|RN-\d{3}\|/gm).map((x) => x.slice(1, 7)))];
  assert.equal(todas.length, 112, 'as 112 regras de 05');
  const fase2 = Object.keys(MAPA);
  const depois = Object.keys(DEPOIS);
  const contadas = fase2.concat(FASE1, depois);
  assert.equal(new Set(contadas).size, contadas.length, 'cada RN numa lista só');
  assert.deepEqual(todas.filter((rn) => contadas.indexOf(rn) < 0), [], 'RN sem lugar no mapa');
  assert.deepEqual(contadas.filter((rn) => todas.indexOf(rn) < 0), [], 'RN que não existe em 05');
  // Cada teste citado existe (o nome começa com o texto citado) no arquivo citado.
  const cache = {};
  const nomes = (arq) => {
    if (!cache[arq]) cache[arq] = (fs.readFileSync(path.join(DIR, arq), 'utf8').match(/^test\('([^']*)'/gm) || []).map((l) => l.slice(6, -1));
    return cache[arq];
  };
  fase2.forEach((rn) => {
    assert.ok(MAPA[rn].length > 0, rn);
    MAPA[rn].forEach(([arq, prefixo]) => assert.ok(nomes(arq).some((n) => n.indexOf(prefixo) === 0), rn + ': nenhum teste começa com "' + prefixo + '" em ' + arq));
  });
  // As da Fase 1 estão no mapa de tests/regras.fase1.test.js (cabeçalho e nomes dos testes).
  const f1 = citadas(fs.readFileSync(path.join(DIR, 'regras.fase1.test.js'), 'utf8'));
  assert.deepEqual(FASE1.filter((rn) => !f1.has(rn)), [], 'RN da Fase 1 fora do mapa da Fase 1');
  // As das fases seguintes trazem a fase e o motivo.
  depois.forEach((rn) => assert.ok(DEPOIS[rn][0] >= 3 && DEPOIS[rn][1].length > 10, rn));
});

// ------------------------------------------------------------------ ambiente ----
function ambiente() {
  const c = C.ambienteCadastros();
  const m = c.m;
  const parceiro = (nome, tipos) => c.run('Config.comandoSalvarParceiro', { campos: { nome, tipos } }).dados.partner_id;
  const r = m.run('registrar', entradaInicial([
    bicho({ brinco: 'V1', data_nascimento: '2019-01-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 2, situacao_reprodutiva: 'PRENHA', data_prevista_parto: '2026-03-01' }),
    bicho({ brinco: 'V2', data_nascimento: '2019-01-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 1, situacao_reprodutiva: 'VAZIA' }),
    bicho({ brinco: 'V3', data_nascimento: '2019-01-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 1, situacao_reprodutiva: 'EXPOSTA' }),
    bicho({ brinco: 'V4', data_nascimento: '2019-01-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 0 }),
    bicho({ brinco: 'B1', sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' }),
    bicho({ brinco: 'B2', sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' }),
  ]));
  const id = Object.fromEntries(r.dados.animais.map((a) => [a.brinco, a.animal_id]));
  const ext = c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'Touro do sêmen', sexo: 'M' } }).dados.animal_id;
  return { c, m, G: c.G, id, ext, forn: parceiro('Fornecedor', 'FORNECEDOR'), comp: parceiro('Comprador', 'COMPRADOR') };
}
function falha(m, acao, dados, op) {
  const r = m.tentar(acao, dados, op);
  assert.equal(r.ok, false, 'o comando deveria ter sido recusado: ' + JSON.stringify(dados).slice(0, 160));
  return r.erro;
}
const garrote = (b, x) => Object.assign({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 }, x || {});
function compra(x, animais, campos, extra) {
  return Object.assign({ tipo: 'COMPRA', campos: Object.assign({ event_date: '2026-03-01', partner_id: x.forn, pasto_destino_id: PASTOS.A }, campos), animais, parcelas: [{ data_vencimento: '2026-04-01' }] }, extra || {});
}
function venda(x, animais, campos, extra) {
  return Object.assign({ tipo: 'VENDA', campos: Object.assign({ event_date: '2026-06-01', partner_id: x.comp, finalidade: 'RECRIA_ENGORDA' }, campos), animais, parcelas: [{ data_vencimento: '2026-07-01' }] }, extra || {});
}
const parto = (mae, data, crias, campos) => ({ tipo: 'NASCIMENTO', campos: Object.assign({ event_date: data }, campos || {}), animais: [{ animal_id: mae }], crias: crias || [{ situacao_nascimento: 'VIVO', sexo: 'F' }] });
const pares = (e) => e.details.map((d) => [d.codigo, d.campo]);

// ------------------------------------------------------------------ RN-006 ----
test('RN-006: animal de referência (EXTERNO) é recusado como sujeito de todo evento de rebanho da Fase 2 e aceito como pai; continua fora do inventário', () => {
  const x = ambiente();
  const { m, ext } = x;
  const n0 = m.contagem();
  const casos = {
    COMPRA: compra(x, [{ animal_id: ext }], { modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 100000 }),
    VENDA: venda(x, [{ animal_id: ext }], { modalidade: 'CABECA', preco_unitario: 100000, valor_bruto: 100000 }),
    TRANSFERENCIA: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: ext }] },
    MORTE: { tipo: 'MORTE', campos: { event_date: '2026-03-01', causa: 'DOENCA' }, animais: [{ animal_id: ext }] },
    DESCARTE: { tipo: 'DESCARTE', campos: { event_date: '2026-03-01', destino: 'DOACAO', motivo: 'IDADE' }, animais: [{ animal_id: ext }] },
    IDENTIFICACAO: { tipo: 'IDENTIFICACAO', subtipo: 'PRIMEIRA_IDENTIFICACAO', campos: { event_date: '2026-03-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: ext, codigo: 'X9' }] },
    MARCACAO: { tipo: 'MARCACAO', subtipo: 'NAO_LOCALIZADO', campos: { event_date: '2026-03-01', acao: 'MARCAR' }, animais: [{ animal_id: ext }] },
    DIVERGENCIA_CONTAGEM: { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos: { event_date: '2026-03-01', justificativa: 'Contagem' }, animais: [{ animal_id: ext }] },
    RECLASSIFICACAO: { tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: '2026-03-01', justificativa: 'Teste' }, animais: [{ animal_id: ext, categoria_manual_id: m.linhas.CATEGORIAS[0].category_id }] },
    NASCIMENTO: parto(ext, '2026-03-01'),
  };
  Object.keys(casos).forEach((tipo) => {
    const e = falha(m, 'registrar', casos[tipo]);
    assert.equal(e.code, 'VALIDATION', tipo);
    assert.ok(e.details.some((d) => (d.codigo === 'ANIMAL_EXTERNO' || d.codigo === 'MATRIZ_NAO_FEMEA') && d.animal_id === ext), tipo + ': ' + JSON.stringify(e.details));
  });
  assert.deepEqual(m.contagem(), n0, 'nada gravado');
  // Como pai do parto, o animal de referência é aceito; segue EXTERNO e fora do inventário.
  const r = m.run('registrar', parto(x.id.V4, '2026-03-02', [{ situacao_nascimento: 'VIVO', sexo: 'M' }], { pai_id: ext, pai_confianca: 'CONFIRMADA' }));
  const cria = r.dados.animais.find((a) => a.animal_id !== x.id.V4);
  assert.deepEqual([m.animal(cria.animal_id).pai_id, m.animal(ext).situacao_cadastral], [ext, 'EXTERNO']);
  assert.equal(m.inventario('2026-11-13').total, 7, 'os 6 da entrada e a cria; o externo não conta');
});

// ------------------------------------------------------------------ RN-037 ----
test('RN-037: revisão pelo servidor da Fase 2 — venda, correção de compra e estorno gravados com dataVersionEsperada antiga são CONFLICT sem gravar; com a versão da nova revisão, gravam', () => {
  const x = ambiente();
  const { m, id } = x;
  const v = venda(x, [{ animal_id: id.B1 }], { modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 });
  const sim = m.simular('registrar', v);
  assert.equal(sim.ok, true);
  // Outro lançamento muda os dados entre a revisão e a confirmação.
  m.run('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-05-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: id.B2 }] });
  const n0 = m.contagem();
  const e = falha(m, 'registrar', v, { dataVersion: sim.valor.dataVersion, chave: 'rn037-venda' });
  assert.equal(e.code, 'CONFLICT');
  assert.match(e.message, /mudaram|mudou/i);
  assert.deepEqual(m.contagem(), n0, 'nada gravado');
  const sim2 = m.simular('registrar', v);
  const ok = m.run('registrar', v, { dataVersion: sim2.valor.dataVersion, chave: 'rn037-venda' });
  assert.equal(ok.duplicado, false, 'a mesma chave grava depois do CONFLICT (não foi consumida)');
  // Correção de compra e estorno pela revisão, com a versão antiga e depois com a nova.
  const cp = m.run('registrar', compra(x, [garrote('C1')], { modalidade: 'CABECA', preco_unitario: 200000, valor_animais: 200000 })).dados;
  const corr = Object.assign(compra(x, [garrote('C1', { animal_id: cp.animais[0].animal_id })], { modalidade: 'CABECA', preco_unitario: 210000, valor_animais: 210000 }), { event_id: cp.event_id, justificativa: 'Valor da nota' });
  const simC = m.simular('corrigir', corr);
  m.run('registrar', { tipo: 'MARCACAO', subtipo: 'DESCARTE', campos: { event_date: '2026-05-02', acao: 'MARCAR', motivo_descarte: 'IDADE' }, animais: [{ animal_id: id.V1 }] });
  assert.equal(falha(m, 'corrigir', corr, { dataVersion: simC.valor.dataVersion }).code, 'CONFLICT');
  const k = m.run('corrigir', corr, { dataVersion: m.simular('corrigir', corr).valor.dataVersion }).dados;
  const simE = m.simular('estornar', { event_id: k.event_id, justificativa: 'Compra desfeita' });
  m.run('registrar', { tipo: 'MARCACAO', subtipo: 'DESCARTE', campos: { event_date: '2026-05-03', acao: 'DESMARCAR' }, animais: [{ animal_id: id.V1 }] });
  assert.equal(falha(m, 'estornar', { event_id: k.event_id, justificativa: 'Compra desfeita' }, { dataVersion: simE.valor.dataVersion }).code, 'CONFLICT');
  assert.equal(m.evento(k.event_id).status, 'CONFIRMADO');
});

// ------------------------------------------------------------------ RN-049 ----
test('RN-049: peso vivo nos eventos da Fase 2 (compra, venda, parto) maior que zero, com uma casa e até 2.000 kg; carcaça também maior que zero; o erro aponta o animal e não se repete no cabeçalho', () => {
  const x = ambiente();
  const { m, id } = x;
  const n0 = m.contagem();
  const kg = (peso) => compra(x, [garrote('P1', { peso, metodo_pesagem: 'BALANCA' })], { modalidade: 'KG_VIVO', preco_unitario: 1000, valor_animais: Math.round(peso * 1000) > 0 ? Math.round(peso * 1000) : 100000 });
  assert.deepEqual(pares(falha(m, 'registrar', kg(0))), [['VALOR_FORA_DA_FAIXA', 'peso']]);
  assert.deepEqual(pares(falha(m, 'registrar', kg(2000.1))), [['VALOR_FORA_DA_FAIXA', 'peso']]);
  assert.deepEqual(pares(falha(m, 'registrar', kg(250.55))), [['FORMATO_INVALIDO', 'peso']]);
  const neg = falha(m, 'registrar', venda(x, [{ animal_id: id.B1, peso: -100 }], { modalidade: 'KG_VIVO', preco_unitario: 1000, valor_bruto: 100000 }));
  assert.deepEqual([pares(neg), neg.details[0].animal_id], [[['VALOR_FORA_DA_FAIXA', 'peso']], id.B1], 'o erro aponta o animal');
  assert.match(neg.details[0].mensagem, /entre 0,1 e 2\.000 kg/);
  const carc = falha(m, 'registrar', venda(x, [{ animal_id: id.B1, peso: 500, peso_carcaca_kg: 0 }], { finalidade: 'ABATE', modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 30000, valor_bruto: 100000 }));
  assert.deepEqual([pares(carc), carc.details[0].animal_id, carc.details[0].brinco], [[['VALOR_FORA_DA_FAIXA', 'peso_carcaca_kg']], id.B1, 'B1'], 'uma causa, um erro: sem o rendimento de 0% calculado com a carcaça recusada');
  assert.deepEqual(pares(falha(m, 'registrar', parto(id.V2, '2026-03-02', [{ situacao_nascimento: 'VIVO', sexo: 'M', peso: 0, metodo_pesagem: 'BALANCA' }]))), [['VALOR_FORA_DA_FAIXA', 'peso']]);
  assert.deepEqual(m.contagem(), n0, 'nada gravado');
  // No limite: 2.000,0 kg é aceito e vai para PESAGENS com uma casa.
  const r = m.run('registrar', kg(2000));
  assert.deepEqual(m.tabela('PESAGENS').filter((p) => p.event_id === r.dados.event_id).map((p) => [p.peso_kg, p.tipo]), [[2000, 'COMPRA']]);
});

// ------------------------------------------------------------------ RN-065 ----
test('RN-065: o parto é aceito de qualquer situação reprodutiva (prenha, vazia, exposta, sem informação) e deixa a matriz vazia com cria ao pé', () => {
  const x = ambiente();
  const { m, id } = x;
  assert.deepEqual(['V1', 'V2', 'V3', 'V4'].map((b) => m.animal(id[b]).situacao_reprodutiva), ['PRENHA', 'VAZIA', 'EXPOSTA', 'SEM_INFORMACAO']);
  ['V1', 'V2', 'V3', 'V4'].forEach((b, i) => {
    const r = m.tentar('registrar', parto(id[b], '2026-0' + (4 + i) + '-10'));
    assert.equal(r.ok, true, b + ': ' + JSON.stringify(r.erro));
  });
  assert.deepEqual(['V1', 'V2', 'V3', 'V4'].map((b) => [m.animal(id[b]).situacao_reprodutiva, m.animal(id[b]).cria_ao_pe]), [['VAZIA', true], ['VAZIA', true], ['VAZIA', true], ['VAZIA', true]]);
  // A situação de antes não é pré-condição nem depois do estorno: estornado o parto da V1, ela volta ao que era (prenha).
  const ev = m.tabela('EVENTOS').find((e) => e.event_type === 'NASCIMENTO' && e.event_date === '2026-04-10').event_id;
  m.run('estornar', { event_id: ev, justificativa: 'Lançado na vaca errada' });
  assert.deepEqual([m.animal(id.V1).situacao_reprodutiva, m.animal(id.V1).cria_ao_pe], ['PRENHA', false]);
});

// ------------------------------------------------------------------ RN-071 ----
test('RN-071: rateio MANUAL da compra (lote fechado) soma exatamente o valor do lançamento; exige justificativa e o peso de cada animal, maior que zero', () => {
  const x = ambiente();
  const { m } = x;
  const lote = (animais, extra) => compra(x, animais, Object.assign({ modalidade: 'LOTE', criterio_rateio: 'MANUAL', justificativa_rateio: 'Pesos combinados com o vendedor', valor_animais: 100000 }, extra || {}));
  const semJust = falha(m, 'registrar', lote([garrote('L1', { base_manual: 60 }), garrote('L2', { base_manual: 40 })], { justificativa_rateio: null }));
  assert.deepEqual(pares(semJust), [['CAMPO_OBRIGATORIO', 'justificativa_rateio']]);
  assert.deepEqual(pares(falha(m, 'registrar', lote([garrote('L1', { base_manual: 60 }), garrote('L2')]))), [['CAMPO_OBRIGATORIO', 'base_manual']]);
  assert.deepEqual(pares(falha(m, 'registrar', lote([garrote('L1', { base_manual: 60 }), garrote('L2', { base_manual: 0 })]))), [['VALOR_FORA_DA_FAIXA', 'base_manual']]);
  // Três pesos iguais para R$ 1.000,00: 333,34 + 333,33 + 333,33 = 1.000,00 (o centavo para o menor código).
  const r = m.run('registrar', lote([garrote('L1', { base_manual: 1 }), garrote('L2', { base_manual: 1 }), garrote('L3', { base_manual: 1 })]));
  const fin = m.tabela('FINANCEIRO').filter((f) => f.event_id === r.dados.event_id);
  const aloc = m.tabela('ALOCACOES_FINANCEIRAS').filter((a) => a.financial_id === fin[0].financial_id);
  assert.deepEqual(aloc.map((a) => a.valor_alocado).sort((p, q) => q - p), [33334, 33333, 33333]);
  assert.equal(aloc.reduce((s, a) => s + a.valor_alocado, 0), fin[0].valor, 'soma exata');
  const rat = m.tabela('RATEIOS').find((t) => t.financial_id === fin[0].financial_id);
  assert.deepEqual([rat.criterio, rat.base_total, rat.total_alocado, rat.justificativa], ['MANUAL', 3, 100000, 'Pesos combinados com o vendedor']);
});

// ------------------------------------------------------------------ RN-075 ----
test('RN-075: dinheiro dos eventos da Fase 2 — zero, negativo ou fração de centavo é recusado uma vez por causa, no campo, em português (sem repetir no lançamento, nas parcelas e no rateio)', () => {
  const x = ambiente();
  const { m, id } = x;
  const n0 = m.contagem();
  const cab = (campos, extra) => compra(x, [garrote('M1')], Object.assign({ modalidade: 'CABECA', preco_unitario: 100000, valor_animais: 100000 }, campos), extra);
  const vd = (campos, extra) => venda(x, [{ animal_id: id.B1 }], Object.assign({ modalidade: 'CABECA', preco_unitario: 100000, valor_bruto: 100000 }, campos), extra);
  const casos = [
    ['valor dos animais zero', cab({ valor_animais: 0 }), [['VALOR_FORA_DA_FAIXA', 'valor_animais']]],
    ['preço e valor negativos', cab({ preco_unitario: -100000, valor_animais: -100000 }), [['VALOR_FORA_DA_FAIXA', 'preco_unitario'], ['VALOR_FORA_DA_FAIXA', 'valor_animais']]],
    ['fração de centavo', cab({ preco_unitario: 100000.5, valor_animais: 100000.5 }), [['TIPO_INVALIDO', 'preco_unitario'], ['TIPO_INVALIDO', 'valor_animais']]],
    ['frete zero', cab({}, { custos: [{ tipo: 'FRETE', valor: 0 }] }), [['VALOR_FORA_DA_FAIXA', 'custos']]],
    ['frete negativo', cab({}, { custos: [{ tipo: 'FRETE', valor: -500 }] }), [['VALOR_FORA_DA_FAIXA', 'custos']]],
    ['parcela negativa', cab({}, { parcelas: [{ data_vencimento: '2026-04-01', valor: 150000 }, { data_vencimento: '2026-05-01', valor: -50000 }] }), [['VALOR_FORA_DA_FAIXA', 'parcelas']]],
    ['bruto zero', vd({ preco_unitario: 0, valor_bruto: 0 }), [['VALOR_FORA_DA_FAIXA', 'preco_unitario'], ['VALOR_FORA_DA_FAIXA', 'valor_bruto']]],
    ['dedução negativa', vd({}, { deducoes: [{ tipo: 'COMISSAO', valor: -10 }] }), [['VALOR_FORA_DA_FAIXA', 'deducoes']]],
    ['receita do descarte zero', { tipo: 'DESCARTE', campos: { event_date: '2026-03-01', destino: 'DOACAO', motivo: 'IDADE', receita_valor: 0 }, animais: [{ animal_id: id.B1 }] }, [['VALOR_FORA_DA_FAIXA', 'receita_valor']]],
  ];
  casos.forEach(([nome, dados, esperado]) => {
    const e = falha(m, 'registrar', dados);
    assert.deepEqual([e.code, pares(e)], ['VALIDATION', esperado], nome + ': ' + JSON.stringify(e.details.map((d) => d.mensagem)));
    e.details.forEach((d) => assert.doesNotMatch(d.mensagem, /\bde (a|o) /, nome + ': português da mensagem: ' + d.mensagem));
  });
  assert.deepEqual(m.contagem(), n0, 'nada gravado');
  // Sem parcela, a mensagem concorda com o rótulo ("a compra será paga").
  const sem = falha(m, 'registrar', cab({}, { parcelas: [] }));
  assert.match(sem.details[0].mensagem, /Informe como a compra será paga/);
  // Os valores certos, ao centavo, gravam: R$ 1.000,01 e frete de R$ 0,01.
  const r = m.run('registrar', cab({ preco_unitario: 100001, valor_animais: 100001 }, { custos: [{ tipo: 'FRETE', valor: 1 }] }));
  assert.deepEqual(m.tabela('FINANCEIRO').filter((f) => f.event_id === r.dados.event_id).map((f) => f.valor), [100001, 1]);
  assert.deepEqual(m.invariantes(), []);
});

// ------------------------------------------------------------------ RN-094 na importação de eventos ----
test('RN-094 na importação de nascimentos: pai não encontrado deixa a linha em erro até a decisão; cadastrado o animal de referência, a revalidação o acha e o parto entra com o pai', () => {
  const s = S.sistema({ config: { importacao_lote_linhas: '50' } });
  const { G } = s;
  s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '300', sexo: 'F', data_nascimento: '2020-01-10', data_nascimento_confianca: 'CONFIRMADA' })]), 'rn094-base');
  const csv = ['Data do parto;Brinco da mãe;Pai;Nasceu;Sexo da cria;Brinco da cria', '12/09/2026;300;Touro Fantasma;vivo;M;400'].join('\n');
  const criado = s.exec((ctx) => G.ImportService.criar(ctx, { idempotencyKey: 'rn094-criar', dados: { tipo: 'NASCIMENTOS', arquivo_nome: 'partos.csv', conteudo_base64: Buffer.from(csv, 'utf8').toString('base64'), formato: { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' } } })).dados;
  const mapa = { colunas: { 'Data do parto': 'data', 'Brinco da mãe': 'mae', Pai: 'pai', Nasceu: 'situacao', 'Sexo da cria': 'sexo', 'Brinco da cria': 'brinco' }, confiancas: { pai: 'ESTIMADA' }, padroes: {} };
  const validar = (k) => s.exec((ctx) => G.ImportService.validarBloco(ctx, { idempotencyKey: 'rn094-val-' + k, dados: { import_id: criado.import_id, bloco: 1, mapeamento: mapa } })).dados;
  const linhas = () => s.read(G.ImportService.consultaLinhas({ import_id: criado.import_id, por_pagina: 50 })).itens;
  validar(1);
  let l = linhas()[0];
  assert.deepEqual([l.status, l.erros.map((e) => e.codigo)], ['ERRO', ['PAI_NAO_ENCONTRADO']]);
  assert.match(l.erros[0].mensagem, /Touro Fantasma/);
  s.conferirProjecoes('validação com pai desconhecido');
  // Decisão: cadastrar o animal de referência com esse nome; a revalidação acha o pai e a linha fica válida.
  const ext = s.exec((ctx) => G.AnimalService.cadastrarExterno(ctx, { idempotencyKey: 'rn094-ext', dados: { campos: { nome: 'Touro Fantasma', sexo: 'M' } } })).dados.animal_id;
  validar(2);
  l = linhas()[0];
  assert.deepEqual([l.status, l.erros], ['VALIDA', []]);
  const r = s.tentar((ctx) => G.ImportService.importarBloco(ctx, { dados: { import_id: criado.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  s.exec((ctx) => G.ImportService.concluir(ctx, { dados: { import_id: criado.import_id } }));
  s.conferirProjecoes('parto importado com o pai');
  const cria = s.tabela('ANIMAIS').find((a) => a.brinco === '400');
  assert.deepEqual([cria.situacao_cadastral, cria.pai_id, cria.pai_confianca, cria.mae_id], ['ATIVO', ext, 'ESTIMADA', s.tabela('ANIMAIS').find((a) => a.brinco === '300').animal_id]);
  assert.equal(s.integridade().ok, true);
});
