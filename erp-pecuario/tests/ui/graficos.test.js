'use strict';
/**
 * Gráficos em SVG próprio (Fase 3, E3.7; SP-08; 08, seções 11, 14 e 15), nível 3 (Playwright), a 360 e a 1280 px, com a
 * captura de cada tela: linha (a curva de peso com a projeção tracejada e rotulada; o peso médio de cada mês), barras
 * (GMD por pasto, por categoria e de cada pesagem de lote; as taxas reprodutivas; a cobertura por protocolo) e barras
 * empilhadas (o rebanho por categoria em cada pasto; o custo sanitário por conta). Em todos: o SVG existe, tem título e
 * descrição (title/desc ligados por aria-labelledby), os números do desenho são os da tabela equivalente e os do servidor
 * (a tela não refaz conta), o estado vazio é claro, o texto sai no tamanho real a 360 px e não há rolagem horizontal.
 * Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const RELOGIO = Date.parse('2026-11-13T14:00:00Z');
function ok(s, rota, dados, chave) {
  const r = s.api({ rota, idempotencyKey: chave, dados });
  if (!r.ok) throw new Error(rota + ': ' + JSON.stringify(r.error));
  return r.data;
}
/** A captura da tela (o "print" que o dono veria), num arquivo temporário; confere que saiu uma imagem. */
async function capturar(page, nome, largura) {
  const arq = path.join(os.tmpdir(), 'erp-graficos-' + nome + '-' + largura + '.png');
  await page.screenshot({ path: arq, fullPage: true });
  assert.ok(fs.statSync(arq).size > 2000, 'captura ' + arq);
  return arq;
}
async function semProblemasDeLeiaute(page, largura, onde) {
  const r = await A.semRolagemHorizontal(page);
  assert.ok(r.sw <= r.cw, onde + ': sem rolagem horizontal a ' + largura + ' px (' + r.sw + ' > ' + r.cw + ')');
  if (largura < 900) assert.deepEqual(await A.alvosDeToque(page, '#conteudo'), [], onde + ': alvos de toque');
}
/**
 * O que um gráfico mostra: o título da figura, o title e o desc do SVG (pelo aria-labelledby), os rótulos de valor do
 * desenho, as dicas e os valores das marcas, as células da tabela equivalente e a escala do desenho na tela.
 */
async function lerGrafico(page, sel) {
  await page.waitForSelector(sel + ' svg[role=img]');
  return page.$eval(sel, (fig) => {
    const svg = fig.querySelector('svg');
    const ids = (svg.getAttribute('aria-labelledby') || '').split(' ');
    const porId = (id) => { const el = document.getElementById(id); return el ? el.textContent : null; };
    const caixa = svg.getBoundingClientRect();
    const valor = svg.querySelector('.grafico-valor, .grafico-rotulo');
    return {
      figcaption: fig.querySelector('figcaption').textContent,
      titulo: porId(ids[0]), desc: porId(ids[1]), tituloTag: svg.querySelector(':scope > title') && svg.querySelector(':scope > title').id === ids[0],
      valores: [...svg.querySelectorAll('.grafico-valor')].map((t) => t.textContent),
      semDado: svg.querySelectorAll('text').length ? [...svg.querySelectorAll('text')].filter((t) => /^— sem dado$/.test(t.textContent)).length : 0,
      marcas: [...svg.querySelectorAll('[data-valor]')].map((m) => ({ tag: m.tagName, x: m.dataset.x || null, serie: m.dataset.serie || null, valor: Number(m.dataset.valor), marcador: m.dataset.marcador || null, dica: m.querySelector('title') ? m.querySelector('title').textContent : null })),
      eixos: [...svg.querySelectorAll('.grafico-titulo-eixo')].map((t) => t.textContent),
      cabecalho: [...fig.querySelectorAll('.grafico-tabela thead th')].map((t) => t.textContent),
      linhas: [...fig.querySelectorAll('.grafico-tabela tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent)),
      escala: caixa.width / Number(svg.getAttribute('viewBox').split(' ')[2]),
      fonte: valor ? valor.getBoundingClientRect().height : null,
    };
  });
}
/** Título, descrição e escala: o mesmo título na figura e no SVG; o desc aponta a tabela; a 360 px, o texto no tamanho real. */
function conferirMoldura(g, titulo, largura) {
  assert.equal(g.figcaption, titulo);
  assert.equal(g.titulo, titulo, 'o <title> do SVG, ligado por aria-labelledby');
  assert.ok(g.tituloTag, 'o title é filho do svg');
  assert.match(g.desc, /tabela logo abaixo \(Ver tabela\)/, 'o <desc> leva à tabela equivalente');
  assert.ok(g.escala > 0.85 && g.escala < 1.15, 'o desenho na largura útil (escala ' + g.escala.toFixed(2) + ' a ' + largura + ' px)');
  if (g.fonte !== null) assert.ok(g.fonte >= 10.5, 'texto do desenho legível: ' + g.fonte.toFixed(1) + ' px de altura');
}
/** As células com número na tabela equivalente (sem o "—" de valor ausente), na ordem da tabela (item, depois série). */
const celulasComValor = (g) => g.linhas.flatMap((l) => l.slice(1)).filter((t) => !/^—/.test(t));

for (const largura of [360, 1280]) {
  test('componente (' + largura + ' px): barras agrupadas com valor ausente, empilhadas com o total do servidor, linha e estado vazio — título, descrição, números iguais aos da tabela, texto legível e redesenho quando a tela muda', async () => {
    const s = A.sistema();
    const a = await A.abrir(s, { largura, relogio: RELOGIO });
    const { page } = a;
    await A.esperarTela(page);
    await page.evaluate(() => {
      const caixa = document.createElement('div');
      caixa.id = 'teste-graficos';
      document.getElementById('conteudo').appendChild(caixa);
      const UI = window.UI, Fmt = window.Fmt;
      const gmd = (v) => Fmt.numero(v, 3) + ' kg/dia';
      caixa.appendChild(UI.grafico({ tipo: 'barras', titulo: 'Ganho médio diário por pasto', rotuloX: 'Pasto', rotuloValor: 'Ganho médio diário (kg/dia)', formatar: gmd, dado: 'b',
        series: [{ nome: 'Águas', pontos: [{ x: 'Pasto da Represa do Fundo (piquete 3)', y: 0.812 }, { x: 'Pasto B', y: -0.125 }, { x: 'Pasto C', y: null, nota: 'n = 3; mínimo 5' }] },
          { nome: 'Seca', pontos: [{ x: 'Pasto da Represa do Fundo (piquete 3)', y: 0.31 }, { x: 'Pasto B', y: 0 }, { x: 'Pasto C', y: 0.4 }] }] }));
      caixa.appendChild(UI.grafico({ tipo: 'empilhadas', titulo: 'Rebanho por categoria', rotuloX: 'Pasto', rotuloValor: 'Cabeças', dado: 'e', totais: { 'Pasto A': 42, 'Pasto B': 7 },
        series: [{ nome: 'Vacas', pontos: [{ x: 'Pasto A', y: 30 }, { x: 'Pasto B', y: 0 }] }, { nome: 'Bezerros', pontos: [{ x: 'Pasto A', y: 12 }, { x: 'Pasto B', y: 7 }] }] }));
      caixa.appendChild(UI.grafico({ tipo: 'linha', titulo: 'Peso médio por mês', rotuloX: 'Mês', rotuloValor: 'Peso médio (kg)', formatar: (v) => Fmt.peso(v), dado: 'l',
        series: [{ nome: 'Peso médio', pontos: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => ({ x: m + '/2026', y: i === 5 ? null : 300 + i * 10.5, nota: i === 5 ? 'Só 2 pesagens no mês (mínimo 5).' : null })) }] }));
      caixa.appendChild(UI.grafico({ tipo: 'barras', titulo: 'Cobertura por protocolo', rotuloX: 'Protocolo', rotuloValor: 'Animais em dia (%)', dado: 'v', vazio: 'Nenhum protocolo com animais que devem receber a dose.', series: [{ nome: 'Cobertura', pontos: [{ x: 'Aftosa', y: null, nota: 'sem animais' }] }] }));
      caixa.appendChild(UI.grafico({ tipo: 'linha', titulo: 'Sem série', dado: 'n', series: [] }));
    });
    // Barras agrupadas: um rótulo de valor por valor presente, igual à célula da tabela; o ausente fica "— sem dado".
    const b = await lerGrafico(page, '[data-grafico-id="b"]');
    conferirMoldura(b, 'Ganho médio diário por pasto', largura);
    assert.deepEqual(b.cabecalho, ['Pasto', 'Águas', 'Seca']);
    assert.deepEqual(b.linhas, [['Pasto da Represa do Fundo (piquete 3)', '0,812 kg/dia', '0,310 kg/dia'], ['Pasto B', '-0,125 kg/dia', '0,000 kg/dia'], ['Pasto C', '— (n = 3; mínimo 5)', '0,400 kg/dia']]);
    assert.deepEqual(b.valores, celulasComValor(b), 'os números do desenho são os da tabela');
    assert.equal(b.semDado, 1, 'o valor ausente, escrito no lugar da barra');
    assert.deepEqual(b.marcas.map((m) => [m.x, m.serie, m.valor]), [['Pasto da Represa do Fundo (piquete 3)', 'Águas', 0.812], ['Pasto da Represa do Fundo (piquete 3)', 'Seca', 0.31], ['Pasto B', 'Águas', -0.125], ['Pasto B', 'Seca', 0], ['Pasto C', 'Seca', 0.4]]);
    assert.equal(b.marcas[2].dica, 'Pasto B, Águas: -0,125 kg/dia', 'a dica de cada barra, com o mesmo texto');
    assert.deepEqual(b.eixos, ['Ganho médio diário (kg/dia)'], 'o eixo dos valores com a unidade');
    // Empilhadas: um trecho por série com valor, o total do servidor na ponta e na tabela.
    const e = await lerGrafico(page, '[data-grafico-id="e"]');
    conferirMoldura(e, 'Rebanho por categoria', largura);
    assert.deepEqual(e.cabecalho, ['Pasto', 'Vacas', 'Bezerros', 'Total']);
    assert.deepEqual(e.linhas, [['Pasto A', '30', '12', '42'], ['Pasto B', '0', '7', '7']]);
    assert.deepEqual(e.valores, ['42', '7'], 'os totais na ponta de cada barra');
    assert.deepEqual(e.marcas.map((m) => [m.x, m.serie, m.valor]), [['Pasto A', 'Vacas', 30], ['Pasto A', 'Bezerros', 12], ['Pasto B', 'Bezerros', 7]], 'o trecho zero não é desenhado');
    // Linha: um ponto por mês com valor (o buraco corta o traço), a dica com o valor da tabela.
    const l = await lerGrafico(page, '[data-grafico-id="l"]');
    conferirMoldura(l, 'Peso médio por mês', largura);
    assert.equal(l.marcas.length, 11);
    assert.equal(await page.locator('[data-grafico-id="l"] polyline').count(), 2, 'o mês sem dado corta a linha em dois trechos');
    const comValor = l.linhas.filter((r) => !/^—/.test(r[1]));
    assert.deepEqual(l.marcas.map((m) => m.dica), comValor.map((r) => r[0] + ': ' + r[1]), 'a dica de cada ponto = a linha da tabela');
    assert.deepEqual(l.linhas[5], ['06/2026', '— (Só 2 pesagens no mês (mínimo 5).)']);
    assert.deepEqual(l.eixos, ['Peso médio (kg)', 'Mês']);
    // Sem dado: o estado vazio, sem desenho; a tabela fica com o porquê.
    const v = page.locator('[data-grafico-id="v"]');
    assert.equal(await v.getAttribute('data-vazio'), 'true');
    assert.equal(await v.locator('svg[role=img]').count(), 0);
    assert.match(await v.locator('.grafico-sem-dados').textContent(), /Nenhum protocolo com animais que devem receber a dose\./);
    assert.deepEqual(await v.locator('.grafico-tabela tbody td').allTextContents(), ['— (sem animais)']);
    const n = page.locator('[data-grafico-id="n"]');
    assert.match(await n.textContent(), /Sem dados para desenhar este gráfico\./);
    assert.equal(await n.locator('.grafico-tabela').count(), 0);
    await semProblemasDeLeiaute(page, largura, 'componentes');
    await capturar(page, 'componentes', largura);
    // A tela muda de tamanho (o celular gira; a janela encolhe): o desenho é refeito na largura nova.
    const antes = await page.getAttribute('[data-grafico-id="b"] svg', 'viewBox');
    await page.setViewportSize({ width: largura === 360 ? 780 : 360, height: 780 });
    await page.waitForFunction((vb) => document.querySelector('[data-grafico-id="b"] svg').getAttribute('viewBox') !== vb, antes);
    const depois = await lerGrafico(page, '[data-grafico-id="b"]');
    assert.ok(depois.escala > 0.85 && depois.escala < 1.15, 'redesenhado na largura nova (escala ' + depois.escala.toFixed(2) + ')');
    assert.deepEqual(depois.valores, b.valores);
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('ficha do animal, aba Peso (' + largura + ' px): a curva tem título e descrição, a projeção tracejada rotulada "Estimativa", os pesos do desenho são os da tabela e os do servidor', async () => {
    const s = A.sistema();
    const sem = A.semear(s);
    const id = sem.animais.find((x) => x.brinco === '12').animal_id;
    [['2026-03-10', 300.0], ['2026-06-09', 372.8], ['2026-07-19', 400.4]].forEach(([d, p], i) => s.registrar({ tipo: 'PESAGEM', campos: { event_date: d, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: id, peso: p }] }, 'p' + i));
    const ficha = ok(s, 'animal.ficha', { animal_id: id }).peso;
    const a = await A.abrir(s, { largura, hash: 'animal/' + id + '/peso', relogio: RELOGIO });
    const { page } = a;
    const g = await lerGrafico(page, '[data-bloco-peso] figure.curva-peso');
    conferirMoldura(g, 'Curva de peso', largura);
    assert.match(g.desc, /Curva de peso com 3 pesagens; a linha tracejada é a projeção \(estimativa\), nunca um peso pesado\./);
    assert.deepEqual(g.eixos, ['Peso (kg)', 'Data'], 'os eixos com a unidade');
    const medidos = g.marcas.filter((m) => m.marcador === 'medido');
    assert.deepEqual(medidos.map((m) => m.valor), ficha.serie.map((x) => x.peso_kg), 'os pesos do servidor');
    const tabela = g.linhas.filter((r) => r[2] === 'Pesagem');
    assert.deepEqual(medidos.map((m) => m.dica), tabela.map((r) => r[0] + ': ' + r[1] + ' (pesagem)'), 'cada marca = a linha da tabela');
    assert.equal(g.marcas.filter((m) => m.marcador === 'projecao').length, 1);
    const proj = ficha.projecao.pontos;
    assert.match(g.marcas.find((m) => m.marcador === 'projecao').dica, new RegExp(await page.evaluate((p) => window.Fmt.peso(p), proj[proj.length - 1].peso_kg)));
    assert.ok(g.linhas.some((r) => r[2] === 'Projeção (estimativa)'), 'a projeção também na tabela, rotulada');
    assert.match(await page.textContent('[data-bloco-peso] svg'), /Estimativa/);
    await semProblemasDeLeiaute(page, largura, 'aba Peso');
    await capturar(page, 'ficha-peso', largura);
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('desempenho (' + largura + ' px): o peso médio de cada mês (linha), o GMD por pasto, por categoria e de cada pesagem de lote (barras) e o rebanho por categoria em cada pasto (empilhadas), todos com os números do servidor', async () => {
    const s = A.sistema();
    const r = s.registrar(S.entradaInicial([
      ...[1, 2, 3, 4, 5, 6].map((i) => S.bicho({ brinco: 'A' + i, sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' })),
      ...[1, 2, 3, 4, 5].map((i) => S.bicho({ brinco: 'B' + i, pasto_destino_id: S.PASTOS.B, data_nascimento: '2022-05-01', data_nascimento_confianca: 'CONFIRMADA' })),
    ]), 'rebanho');
    const ids = r.animais.map((x) => x.animal_id);
    const pesar = (data, base, ganho, quem, chave) => s.registrar({ tipo: 'PESAGEM', campos: { event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: quem.map((i) => ({ animal_id: ids[i], peso: base + i * 3 + ganho })) }, chave);
    pesar('2026-08-10', 300, 0, ids.map((x, i) => i), 'p1');
    pesar('2026-09-12', 300, 20, [0, 1], 'p2');
    pesar('2026-10-09', 300, 36, ids.map((x, i) => i), 'p3');
    const d = ok(s, 'peso.desempenho', {});
    const a = await A.abrir(s, { largura, hash: 'pesagens', relogio: RELOGIO });
    const { page } = a;
    await A.esperarTela(page, 'Pesagens');
    const fmt = (lista, como) => page.evaluate(([l, c]) => l.map((v) => (c === 'gmd' ? window.Fmt.numero(v, 3) + ' kg/dia' : c === 'kg' ? window.Fmt.peso(v) : window.Fmt.numero(v, 0))), [lista, como]);
    // Evolução (G5): agosto e outubro com as 11 pesagens; setembro com 2 (abaixo do mínimo) fica "—" com o porquê.
    const ev = await lerGrafico(page, '[data-grafico-id="evolucao-peso"]');
    conferirMoldura(ev, 'Peso médio das pesagens de cada mês', largura);
    const doServidor = d.evolucao.filter((m) => m.valor !== null);
    assert.deepEqual(doServidor.map((m) => m.mes), ['2026-08', '2026-10']);
    assert.deepEqual(ev.marcas.map((m) => m.valor), doServidor.map((m) => m.valor), 'os pontos são as médias do servidor');
    assert.deepEqual(ev.marcas.map((m) => m.dica.split(': ')[1]), await fmt(doServidor.map((m) => m.valor), 'kg'));
    assert.deepEqual(ev.linhas.find((l) => l[0] === '09/2026'), ['09/2026', '— (Só 2 pesagens no mês (mínimo 5).)']);
    // GMD por pasto e por categoria: as barras e a tabela com o GMD do servidor.
    const gp = await lerGrafico(page, '[data-grafico-id="gmd-pasto"]');
    conferirMoldura(gp, 'Ganho médio diário por pasto', largura);
    const gmdPastos = d.por_pasto.filter((p) => p.gmd.valor !== null).map((p) => p.gmd.valor);
    assert.equal(gmdPastos.length, 2, 'os dois pastos com 5 ou mais animais pesados');
    assert.deepEqual(gp.valores, await fmt(gmdPastos, 'gmd'));
    assert.deepEqual(gp.valores, celulasComValor(gp));
    const gc = await lerGrafico(page, '[data-grafico-id="gmd-categoria"]');
    assert.deepEqual(gc.valores, await fmt(d.por_categoria.filter((c) => c.gmd.valor !== null).map((c) => c.gmd.valor), 'gmd'));
    assert.deepEqual(gc.valores, celulasComValor(gc));
    // Rebanho por categoria em cada pasto: cada trecho é a contagem do servidor; o total na ponta é o do servidor.
    const rc = await lerGrafico(page, '[data-grafico-id="rebanho-categorias"]');
    conferirMoldura(rc, 'Rebanho por categoria em cada pasto em 13/11/2026', largura);
    const trechos = d.por_pasto.flatMap((p) => p.por_categoria.map((c) => [p.nome, c.nome, c.cabecas]));
    assert.deepEqual(rc.marcas.map((m) => [m.x, m.serie, m.valor]).sort(), trechos.sort());
    assert.deepEqual(rc.valores, d.por_pasto.map((p) => String(p.cabecas)), 'o total de cada pasto, do servidor');
    assert.deepEqual(rc.linhas.map((l) => l[l.length - 1]), d.por_pasto.map((p) => String(p.cabecas)));
    // GMD de cada pesagem de lote: a de outubro contra a de agosto (11 em comum, 60 dias); as outras, "—" com o porquê.
    const gl = await lerGrafico(page, '[data-grafico-id="gmd-lote"]');
    const comLote = d.pesagens.filter((p) => p.gmd_lote.valor !== null);
    assert.equal(comLote.length, 1);
    assert.deepEqual(gl.valores, await fmt([comLote[0].gmd_lote.valor], 'gmd'));
    assert.ok(gl.linhas.some((l) => /^— \(Sem pesagem anterior/.test(l[1])), 'a pesagem sem lote anterior, com o motivo do servidor');
    await semProblemasDeLeiaute(page, largura, 'desempenho com gráficos');
    await capturar(page, 'desempenho', largura);
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });

  test('reprodução e sanidade (' + largura + ' px): as taxas da estação e por categoria (barras, "—" com o motivo abaixo do mínimo), a cobertura por protocolo e o custo sanitário por conta (empilhadas), com os números do servidor', async () => {
    const s = A.sistema();
    const r = s.registrar(S.entradaInicial([
      ...[1, 2, 3, 4, 5, 6].map((i) => S.bicho({ brinco: 'V' + i, data_nascimento: '2021-03-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 })),
      S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    ]), 'rebanho');
    const ids = r.animais.map((x) => x.animal_id);
    const est = ok(s, 'estacao.salvar', { campos: { nome: 'Estação 26', data_inicio: '2026-06-01', data_fim: '2026-08-31', tipo: 'MONTA_NATURAL' } }, 'est');
    s.registrar({ tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-06-01', estacao_id: est.estacao_id }, animais: ids.map((animal_id) => ({ animal_id })) }, 'exp');
    s.registrar({ tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: '2026-10-01', estacao_id: est.estacao_id, metodo: 'PALPACAO' }, animais: ids.slice(0, 6).map((animal_id, i) => (i < 4 ? { animal_id, resultado: 'POSITIVO', idade_gestacional_dias: 100 } : { animal_id, resultado: 'NEGATIVO' })) }, 'dg');
    const vac = ok(s, 'produto.salvar', { campos: { nome: 'Vacina Aftosa', categoria: 'VACINA', unidade: 'dose', custo_unitario: 1.85, dose_padrao_por_cabeca: 2, carencia_padrao_dias: 30, controla_estoque: true } }, 'p1').product_id;
    const prot = ok(s, 'protocolo.salvar', { campos: { nome: 'Aftosa semestral', tipo_procedimento: 'VACINA', product_id: vac, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }, 'q1').protocol_id;
    s.registrar({ tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-11-01', product_id: vac, quantidade: 50, valor: 9250 }, animais: [] }, 'e1');
    s.registrar({ tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-11-10', produto_id: vac, protocol_id: prot, modo_dose: 'POR_CABECA', dose_referencia: 2, periodo_carencia_dias: 30 }, animais: ids.slice(0, 4).map((animal_id) => ({ animal_id })) }, 'v1');
    const ind = ok(s, 'reproducao.indicadores', { estacao_id: est.estacao_id }).estacao;
    const ag = ok(s, 'sanidade.agenda', {});
    const a = await A.abrir(s, { largura, hash: 'reproducao/indicadores', relogio: RELOGIO });
    const { page } = a;
    await A.esperarTela(page, 'Reprodução');
    const pct = (lista) => page.evaluate((l) => l.map((v) => window.Fmt.numero(v, 1) + '%'), lista);
    const tx = await lerGrafico(page, '[data-grafico-id="taxas-estacao"]');
    conferirMoldura(tx, 'Taxas da estação Estação 26', largura);
    const chaves = ['prenhez', 'paricao', 'natalidade', 'perda_gestacional', 'desmama', 'mortalidade_ate_desmama'];
    assert.equal(ind.geral.prenhez.valor, 66.7, '4 prenhes de 6 diagnosticadas');
    // A taxa que o servidor marca parcial leva "(parcial)" junto do valor (revisão da Fase 3, achado 19: a nota vai no valor,
    // nunca no item do gráfico); o número continua o do servidor.
    const comValor = chaves.map((k) => ind.geral[k]).filter((i) => i.valor !== null);
    const parciais = comValor.map((i) => (i.parcial ? ' (parcial)' : ''));
    assert.ok(parciais.some(Boolean), 'há taxa parcial (prenhe ainda sem parto) neste cenário');
    assert.deepEqual(tx.valores, (await pct(comValor.map((i) => i.valor))).map((t, j) => t + parciais[j]), 'as taxas do servidor');
    assert.deepEqual(tx.valores, celulasComValor(tx));
    assert.equal(tx.semDado, chaves.filter((k) => ind.geral[k].valor === null).length, 'cada taxa sem valor, escrita no lugar da barra');
    tx.linhas.filter((l) => /^—/.test(l[1])).forEach((l) => assert.match(l[1], /^— \(.+, n = \d+\)$/, 'o motivo e o n na tabela: ' + l[0]));
    assert.deepEqual(tx.eixos, ['Taxa (%)']);
    const tc = await lerGrafico(page, '[data-grafico-id="taxas-categoria"]');
    assert.deepEqual(tc.cabecalho, ['Categoria', 'Prenhez', 'Parição', 'Natalidade', 'Desmama']);
    assert.deepEqual(tc.valores, celulasComValor(tc));
    await semProblemasDeLeiaute(page, largura, 'indicadores reprodutivos');
    await capturar(page, 'reproducao', largura);
    await A.ir(page, 'sanidade/agenda', 'Sanidade');
    const cb = await lerGrafico(page, '[data-grafico-id="cobertura-protocolos"]');
    conferirMoldura(cb, 'Cobertura por protocolo em 13/11/2026', largura);
    assert.deepEqual(cb.valores, await pct(ag.protocolos.map((p) => p.cobertura.valor)), 'a cobertura do servidor');
    assert.deepEqual(cb.valores, celulasComValor(cb));
    const cs = await lerGrafico(page, '[data-grafico-id="custo-sanitario"]');
    assert.ok(ag.custos.por_conta.length >= 1, 'o consumo da vacina vira custo');
    const dinheiro = (l) => page.evaluate((x) => x.map((v) => window.Fmt.dinheiro(v)), l);
    assert.deepEqual(cs.valores, await dinheiro(ag.custos.por_conta.map((c) => c.total)), 'o total de cada conta, do servidor');
    assert.deepEqual(cs.linhas.map((l) => l[l.length - 1]), cs.valores);
    assert.deepEqual(cs.marcas.map((m) => m.valor), ag.custos.por_conta.flatMap((c) => [c.alocado, c.nao_alocado].filter((v) => v > 0)));
    assert.deepEqual(cs.eixos, ['Custo (R$)']);
    await semProblemasDeLeiaute(page, largura, 'agenda sanitária');
    await capturar(page, 'sanidade', largura);
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  });
}
