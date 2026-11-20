'use strict';
/**
 * Gráficos (Fase 3, E3.7; SP-08; 08, seções 11, 14 e 15; 07, seção 9, G5), nível 1 (Node): os dados que os gráficos da
 * Fase 3 desenham vêm prontos do servidor — a evolução mensal do peso (G5: média das pesagens individuais do mês, com o
 * n; mês abaixo do mínimo → null com o porquê; estimadas e projeção fora; filtros de pasto e categoria pela data da
 * pesagem) e o rebanho por categoria em cada pasto (`peso.desempenho`) —; a escala "redonda" do eixo; e as regras
 * estáticas: todo gráfico passa pelo kit de Components (SVG com title e desc, tabela equivalente), cada chamada tem
 * título e a unidade do eixo, as telas da Fase 3 desenham com ele, e as cores das séries têm contraste.
 * O desenho na tela, a 360 e a 1280 px, está em tests/ui/graficos.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./apoio-sistema');
const T = require('./apoio-telas');

const { js, PASTOS } = S;
const SRC = path.join(__dirname, '..', 'src');
const ler = (n) => fs.readFileSync(path.join(SRC, n), 'utf8');

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave, avisosAceitos: avisos || [] })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + JSON.stringify(r.error));
  return r.data;
}
let n = 0;
function pesar(s, data, itens, campos, avisos) {
  return ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: Object.assign({ event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, campos || {}), animais: itens }, 'pes-' + (++n), avisos), 'pesagem de ' + data);
}
/** 6 machos no Pasto A e 5 fêmeas no Pasto B (categorias diferentes), do marco zero. */
function rebanho(s) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial([
    ...[1, 2, 3, 4, 5, 6].map((i) => S.bicho({ brinco: 'A' + i, sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' })),
    ...[1, 2, 3, 4, 5].map((i) => S.bicho({ brinco: 'B' + i, pasto_destino_id: PASTOS.B, data_nascimento: '2022-05-01', data_nascimento_confianca: 'CONFIRMADA' })),
  ]), 'reb-' + (++n)), 'rebanho');
  return r.animais.map((a) => a.animal_id);
}
const mes = (d, m) => d.evolucao.find((x) => x.mes === m);

test('G5 (peso.desempenho.evolucao): a média das pesagens individuais de cada mês com o n; abaixo de 5 → null com o porquê; o mês sem pesagem também; do marco zero até hoje', () => {
  const s = S.sistema();
  const ids = rebanho(s);
  pesar(s, '2026-08-10', ids.map((animal_id, i) => ({ animal_id, peso: 300 + i })));
  pesar(s, '2026-09-12', ids.slice(0, 2).map((animal_id) => ({ animal_id, peso: 330 })));
  pesar(s, '2026-10-09', ids.map((animal_id, i) => ({ animal_id, peso: 340 + 2 * i })));
  const d = ok(api(s, 'peso.desempenho', {}));
  assert.deepEqual([d.evolucao[0].mes, d.evolucao[d.evolucao.length - 1].mes, d.evolucao.length], ['2026-01', '2026-11', 11], 'um item por mês do período (marco zero a hoje)');
  // Agosto: (300 + 301 + … + 310) ÷ 11 = 305,0; outubro: (340 + 342 + … + 360) ÷ 11 = 350,0.
  assert.deepEqual(mes(d, '2026-08'), { valor: 305, motivo: null, n: 11, mes: '2026-08', animais: 11, explicacao: null });
  assert.deepEqual(mes(d, '2026-10'), { valor: 350, motivo: null, n: 11, mes: '2026-10', animais: 11, explicacao: null });
  assert.deepEqual(mes(d, '2026-09'), { valor: null, motivo: 'DADOS_INSUFICIENTES', n: 2, mes: '2026-09', animais: 2, explicacao: 'Só 2 pesagens no mês (mínimo 5).' }, 'nunca a média de 2 como se fosse do rebanho');
  assert.deepEqual(mes(d, '2026-07'), { valor: null, motivo: 'DADOS_INSUFICIENTES', n: 0, mes: '2026-07', animais: 0, explicacao: 'Nenhuma pesagem individual no mês.' });
  // O período manda: só setembro a outubro.
  const p = ok(api(s, 'peso.desempenho', { de: '2026-09-01', ate: '2026-10-31' }));
  assert.deepEqual(p.evolucao.map((m) => [m.mes, m.valor, m.n]), [['2026-09', null, 2], ['2026-10', 350, 11]]);
});

test('G5: a estimativa visual fica fora (não é pesagem individual); no mesmo dia vale a de depois; a projeção nunca entra; os filtros de pasto, categoria e sexo valem pela data da pesagem', () => {
  const s = S.sistema();
  const ids = rebanho(s);
  pesar(s, '2026-08-10', ids.map((animal_id) => ({ animal_id, peso: 300 })));
  pesar(s, '2026-08-10', ids.slice(0, 6).map((animal_id) => ({ animal_id, peso: 312 })), {}, ['POSSIVEL_DUPLICIDADE']);
  pesar(s, '2026-08-20', ids.map((animal_id) => ({ animal_id, peso: 900 })), { metodo_pesagem: 'ESTIMATIVA_VISUAL' }, ['PESO_IMPLAUSIVEL']);
  // Mesmo dia: os 6 do Pasto A valem 312 (a de depois), os 5 do B 300 → (6 × 312 + 5 × 300) ÷ 11 = 306,5; a estimativa fica fora.
  const d = ok(api(s, 'peso.desempenho', {}));
  assert.deepEqual([mes(d, '2026-08').valor, mes(d, '2026-08').n, mes(d, '2026-08').animais], [306.5, 11, 11]);
  assert.equal(d.evolucao.filter((m) => m.valor !== null).length, 1, 'nenhum mês depois de agosto ganha valor pela projeção');
  const a = ok(api(s, 'peso.desempenho', { pasture_id: PASTOS.A }));
  assert.deepEqual([mes(a, '2026-08').valor, mes(a, '2026-08').n], [312, 6], 'só o Pasto A');
  const b = ok(api(s, 'peso.desempenho', { pasture_id: PASTOS.B }));
  assert.deepEqual([mes(b, '2026-08').valor, mes(b, '2026-08').n, mes(b, '2026-08').explicacao], [300, 5, null], 'o Pasto B tem exatamente o mínimo');
  const f = ok(api(s, 'peso.desempenho', { sexo: 'F' }));
  assert.deepEqual([mes(f, '2026-08').valor, mes(f, '2026-08').n], [300, 5]);
  const catB = d.por_categoria.find((c) => c.nome && c.cabecas === 5).category_id;
  const c = ok(api(s, 'peso.desempenho', { category_id: catB }));
  assert.deepEqual([mes(c, '2026-08').valor, mes(c, '2026-08').n], [300, 5], 'a categoria na data da pesagem');
  assert.equal(s.tabela('PESAGENS').length, 11 + 6 + 11, 'só as três pesagens gravadas: nada do gráfico vira pesagem');
});

test('rebanho por categoria em cada pasto (peso.desempenho.por_pasto[].por_categoria): as cabeças de cada categoria somam as do pasto; filtro de sexo e fim do período valem', () => {
  const s = S.sistema();
  rebanho(s);
  const d = ok(api(s, 'peso.desempenho', {}));
  assert.equal(d.por_pasto.length, 2);
  d.por_pasto.forEach((p) => {
    assert.ok(Array.isArray(p.por_categoria) && p.por_categoria.length >= 1, p.nome);
    assert.equal(p.por_categoria.reduce((t, c) => t + c.cabecas, 0) + p.sem_categoria, p.cabecas, p.nome + ': as categorias somam o pasto');
    p.por_categoria.forEach((c) => assert.deepEqual(Object.keys(c).sort(), ['cabecas', 'category_id', 'nome']));
  });
  const pA = d.por_pasto.find((p) => p.pasture_id === PASTOS.A);
  const pB = d.por_pasto.find((p) => p.pasture_id === PASTOS.B);
  assert.deepEqual([pA.cabecas, pB.cabecas], [6, 5]);
  assert.notEqual(pA.por_categoria[0].category_id, pB.por_categoria[0].category_id, 'machos castrados e fêmeas em categorias diferentes');
  const f = ok(api(s, 'peso.desempenho', { sexo: 'F' }));
  assert.deepEqual(f.por_pasto.map((p) => [p.nome, p.cabecas, p.por_categoria.map((c) => c.cabecas)]), [[pB.nome, 5, [5]]]);
  const antes = ok(api(s, 'peso.desempenho', { de: '2025-12-01', ate: '2025-12-31' }));
  assert.deepEqual(antes.por_pasto, [], 'antes do marco zero: nenhum pasto');
  assert.equal(antes.geral.motivo, 'ANTERIOR_AO_MARCO_ZERO');
});

test('escala do eixo (UI.escalaGrafico): passo de 1, 2, 2,5 ou 5 × 10^k; barras a partir do zero; valor único e negativo; as casas das marcas; contagem sem fração', () => {
  const s = S.sistema({ semCadastro: true });
  const c = T.cliente(s);
  const e = (...a) => js(c.UI.escalaGrafico(...a));
  assert.deepEqual(e(0, 7.3, 5, true), { min: 0, max: 8, casas: 0, marcas: [0, 2, 4, 6, 8] });
  assert.deepEqual(e(300, 412.5, 4), { min: 300, max: 450, casas: 0, marcas: [300, 350, 400, 450] }, 'linha de peso: sem forçar o zero');
  assert.deepEqual(e(-0.125, 0.812, 3, true), { min: -0.5, max: 1, casas: 1, marcas: [-0.5, 0, 0.5, 1] }, 'GMD negativo: o zero no meio');
  assert.deepEqual(e(0, 0, 4, true), { min: 0, max: 1, casas: 2, marcas: [0, 0.25, 0.5, 0.75, 1] }, 'tudo zero: a escala não some');
  assert.deepEqual(e(380, 380, 4), { min: 340, max: 420, casas: 0, marcas: [340, 360, 380, 400, 420] }, 'um valor só: folga dos dois lados');
  assert.deepEqual(e(0, 66.7, 3, true), { min: 0, max: 75, casas: 0, marcas: [0, 25, 50, 75] });
  assert.deepEqual(e(0, 4, 4, true).marcas, [0, 1, 2, 3, 4]);
  assert.deepEqual(e(0, 9250, 5, true), { min: 0, max: 10000, casas: 0, marcas: [0, 2000, 4000, 6000, 8000, 10000] }, 'centavos');
  assert.equal(e(0, 12.5, 5, true).casas, 1, 'passo 2,5 → uma casa');
  // Contagem (cabeças, centavos): nunca "0,5 cabeça" no eixo.
  assert.deepEqual(e(0, 0, 4, true, true), { min: 0, max: 1, casas: 0, marcas: [0, 1] }, 'tudo zero numa contagem');
  assert.deepEqual(e(4, 4, 4, false, true), { min: 3, max: 5, casas: 0, marcas: [3, 4, 5] }, 'a mesma contagem todo mês');
  assert.deepEqual(e(0, 3, 5, true, true).marcas, [0, 1, 2, 3]);
});

test('todo gráfico passa pelo kit de Components: SVG com title e desc, tabela equivalente e estado vazio; cada chamada traz título e a unidade do eixo; as telas da Fase 3 desenham com ele', () => {
  const comp = ler('Components.html');
  const htmls = fs.readdirSync(SRC).filter((f) => f.endsWith('.html'));
  // Só dois lugares criam um <svg>: o ícone (decorativo, aria-hidden) e o quadro dos gráficos (role=img com title e desc).
  for (const f of htmls) {
    const t = ler(f);
    const svgs = [...t.matchAll(/s\('svg'/g)].length + [...t.matchAll(/createElementNS\(SVG, 'svg'\)|<svg/g)].length;
    if (f === 'Components.html') assert.equal(svgs, 2, 'Components: o ícone e o gráfico');
    else assert.equal(svgs, 0, f + ' desenha gráfico só pelo kit (UI.grafico, UI.curvaPeso)');
  }
  const svgGrafico = comp.slice(comp.indexOf('function svg_('), comp.indexOf('function area_('));
  assert.match(svgGrafico, /role: 'img', 'aria-labelledby'/);
  assert.match(svgGrafico, /s\('title'/);
  assert.match(svgGrafico, /s\('desc'/);
  const kit = comp.slice(comp.indexOf('function grafico(o)'), comp.indexOf('// ------------------------------------------------------- abas'));
  assert.equal([...kit.matchAll(/tabelaGrafico_\(o\.titulo/g)].length, 2, 'grafico e curvaPeso com a tabela equivalente');
  assert.equal([...kit.matchAll(/figura_\(/g)].length, 2, 'grafico e curvaPeso com o estado vazio');
  // Cada chamada nas telas: título, rótulo do eixo dos valores (a unidade) e, nos de barras, o eixo dos itens.
  let chamadas = 0;
  for (const f of htmls) {
    const t = ler(f);
    for (const m of t.matchAll(/UI\.grafico\(\{/g)) {
      const trecho = t.slice(m.index, m.index + 400);
      chamadas++;
      assert.match(trecho, /titulo:/, f + ': gráfico sem título');
      assert.match(trecho, /rotuloValor:/, f + ': gráfico sem a unidade do eixo dos valores');
      assert.match(trecho, /rotuloX:/, f + ': gráfico sem o nome do eixo dos itens');
    }
  }
  assert.ok(chamadas >= 13, 'gráficos nas telas: ' + chamadas);
  for (const [f, n] of [['Weights.html', 4], ['Reproduction.html', 2], ['Health.html', 2], ['Dashboard.html', 5]]) {
    assert.equal([...ler(f).matchAll(/UI\.grafico\(\{/g)].length, n, f + ': gráficos com dados do servidor');
  }
  assert.match(ler('Animals.html'), /UI\.curvaPeso\(/, 'a ficha com a curva de peso');
  assert.match(ler('Weights.html'), /UI\.curvaPeso\(/, 'o desempenho com as curvas comparadas');
  // A tela não refaz conta: nenhum gráfico das telas da Fase 3 soma, divide ou tira média.
  for (const f of ['Weights.html', 'Reproduction.html', 'Health.html']) {
    const t = ler(f);
    const blocos = t.split(/\n  function /).filter((b) => /^grafico\w*\(/.test(b));
    assert.ok(blocos.length >= 2, f);
    blocos.forEach((b) => assert.doesNotMatch(b, /reduce\(|\/ \w+\.length|Math\.(round|floor)/, f + ': ' + b.slice(0, 40)));
  }
});

test('cores das séries: 8 cores com contraste ≥ 4,5:1 com o branco (rótulo dentro da barra) e com a superfície; a legenda pinta a amostra com a cor da série', () => {
  const css = ler('Styles.html');
  const cores = [...css.matchAll(/\.grafico-serie-(\d) \{ --serie: (#[0-9a-f]{6}); \}/g)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(cores.map((c) => c[0]), [0, 1, 2, 3, 4, 5, 6, 7]);
  const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, k) => k - m); return (x + 0.05) / (y + 0.05); };
  for (const [i, cor] of cores) assert.ok(contraste(cor, '#ffffff') >= 4.5, 'série ' + i + ' (' + cor + '): ' + contraste(cor, '#ffffff').toFixed(2) + ':1');
  assert.equal(new Set(cores.map((c) => c[1])).size, 8, 'cores distintas');
  assert.match(css, /\[class\*="grafico-serie-"\] \{ stroke: var\(--serie\); fill: var\(--serie\); color: var\(--serie\); \}/);
  assert.match(css, /\.grafico-legenda \.amostra \{[^}]*background: currentColor/);
  assert.match(css, /\.grafico-area svg \{[^}]*width: 100%/, 'o desenho ocupa a largura útil (o ícone do estado vazio não)');
});
