'use strict';
/**
 * Conserto da Fase 3 pela garantia, etapa 2 — o resolvedor único na tela (nível 3, Playwright, backend real do harness;
 * CONTRATOS, seção 47). A tabela dos casos difíceis de `tests/apoio-resolvedor.js` (reuso, lançado errado, código interno, sem
 * brinco, saiu e voltou, antes da entrada, histórico de antes do marco zero, nada), digitada no curral, no tronco e no seletor
 * de um formulário: cada caminho da tela mostra o MESMO animal (ou a mesma recusa, com a explicação do servidor) que o
 * resolvedor dá — o aparelho não resolve brinco. Roda por `npm run ui:check`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');
const R = require('../apoio-resolvedor');

test.after(() => A.fecharBrowser());

const RELOGIO = Date.parse('2026-11-15T14:00:00Z');
const txt = async (page, sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const br = (d) => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);

function montar() {
  const s = A.sistema({ config: { brinco_permite_reuso: 'S' } });
  const r = R.rebanho(s, (dados, chave) => s.registrar(dados, chave));
  const animais = s.tabela('ANIMAIS');
  const codigo = (k) => animais.find((a) => a.animal_id === r.id[k]).codigo_interno;
  // O que o servidor responde a cada caso (a referência: os caminhos da tela mostram isto).
  const casos = R.CASOS.map(([rotulo, t, data, esp]) => {
    const texto = typeof t === 'function' ? t(r) : t;
    const d = s.api({ rota: 'animal.resolver', dados: { data, textos: [texto], tipo: 'PESAGEM' } }).data;
    return { rotulo, texto, data, esp, x: d.textos[0], codigo: esp.animal ? codigo(esp.animal) : null };
  });
  return { s, r, casos, codigo };
}
const porData = (casos) => casos.reduce((m, c) => { (m[c.data] = m[c.data] || []).push(c); return m; }, {});

test('resolvedor único na tela: o curral e o tronco mostram, para cada caso difícil, o animal (ou a recusa explicada) que o servidor dá', async () => {
  const { s, casos } = montar();
  for (const [tela, hash, prefixo, inicio] of [['curral', 'pesagens/curral', 'cur', 'Começar a pesar'], ['tronco', 'reproducao/tronco', 'tr', 'Começar']]) {
    const a = await A.abrir(s, { largura: 360, hash, relogio: RELOGIO });
    const { page } = a;
    await A.esperarTela(page, tela === 'curral' ? 'Pesagem no curral' : 'Diagnóstico no tronco');
    let primeira = true;
    for (const [data, doDia] of Object.entries(porData(casos))) {
      if (!primeira) {
        await page.click('button:has-text("Mudar data, método")');
        await page.waitForSelector('#' + prefixo + '-data');
      }
      primeira = false;
      await page.fill('#' + prefixo + '-data', data);
      await page.click('button:has-text("' + inicio + '")');
      await page.waitForSelector('#' + prefixo + '-brinco');
      await A.esperarServidor(page);
      for (const c of doDia) {
        const onde = tela + ': ' + c.rotulo + ' (' + c.texto + ' em ' + br(data) + ')';
        await page.fill('#' + prefixo + '-brinco', c.texto);
        await A.enter(page, '#' + prefixo + '-brinco');
        const sel = '#' + prefixo + '-conferencia';
        const estado = await page.getAttribute(sel + ' [data-conferencia]', 'data-conferencia');
        const mostrado = await txt(page, sel);
        if (c.x.situacao === 'RECUSADO') {
          assert.equal(estado, 'NAO_ENCONTRADO', onde);
          assert.ok(mostrado.indexOf(c.x.mensagem) >= 0, onde + ': a explicação do servidor (' + c.x.mensagem + ') × ' + mostrado);
          continue;
        }
        assert.equal(c.x.situacao, 'ACHADO', onde);
        // O tronco não aceita o macho nem quem não estava no rebanho: a mesma fêmea… ou o mesmo animal, recusado com o porquê.
        const servePesagem = c.esp.presente !== false;
        const serveTronco = servePesagem && c.esp.animal !== 'E' && c.esp.animal !== 'CRIA2';
        const serve = tela === 'curral' ? servePesagem : serveTronco;
        if (tela === 'curral') assert.equal(estado, serve ? 'OK' : 'INATIVO', onde + ': ' + mostrado);
        else assert.equal(estado, serve ? 'OK' : 'NAO_ENCONTRADO', onde + ': ' + mostrado);
        assert.ok(mostrado.indexOf(c.codigo) >= 0 || (c.x.brinco && mostrado.indexOf(c.x.brinco) >= 0), onde + ': o animal achado (' + c.codigo + ') × ' + mostrado);
      }
    }
    assert.deepEqual(a.estado.erros, []);
    await a.fechar();
  }
});

test('resolvedor único na tela: o seletor do formulário (na data do lançamento) inclui o animal que o servidor dá, ou mostra a recusa dele', async () => {
  const { s, r, casos } = montar();
  const a = await A.abrir(s, { largura: 1280, hash: 'evento/novo/TRANSFERENCIA', relogio: RELOGIO });
  const { page } = a;
  await A.esperarTela(page, 'Transferir de pasto');
  for (const c of casos) {
    const onde = 'seletor: ' + c.rotulo + ' (' + c.texto + ' em ' + br(c.data) + ')';
    await page.fill('[data-campo="event_date"] input', c.data);
    await A.esperarServidor(page);
    await page.fill('.seletor input[type=search]', c.texto);
    await A.enter(page, '.seletor input[type=search]');
    const conf = await txt(page, '.seletor .conferencia');
    if (c.x.situacao === 'RECUSADO') {
      assert.ok(conf.indexOf(c.x.mensagem) >= 0, onde + ': a explicação do servidor (' + c.x.mensagem + ') × ' + conf);
      assert.equal(await page.locator('.seletor .selecionados [data-animal]').count(), 0, onde + ': nada incluído');
      continue;
    }
    // A fêmea achada com crias sem brinco na data: o seletor lista ela primeiro e as crias depois ("crias da <brinco>").
    if (c.x.crias && c.x.crias.length) {
      assert.ok(conf.indexOf(c.codigo) >= 0, onde + ': ' + conf);
      await page.locator('.seletor .conferencia .candidato button:has-text("Incluir")').first().click();
    }
    const ids = await page.$$eval('.seletor .selecionados [data-animal]', (els) => els.map((e) => e.getAttribute('data-animal')));
    assert.deepEqual(ids, [r.id[c.esp.animal]], onde + ': o animal incluído (' + conf + ')');
    await page.click('.seletor .selecionados li button:has-text("Tirar")');
  }
  assert.deepEqual(a.estado.erros, []);
  await a.fechar();
});
