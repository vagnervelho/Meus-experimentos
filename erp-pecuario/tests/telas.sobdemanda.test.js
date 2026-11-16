'use strict';
/**
 * Telas carregadas sob demanda (Fase 3, etapa BASE; 01-arquitetura.md, seção 6.2; 08-ux-ui.md, seções 2 e 14; risco R-31),
 * no Node: a rota `sistema.tela` (guarda de dono, lista das telas sob demanda, módulo entregue, conteúdo compactado como o
 * doGet entrega os includes, sem abrir a planilha-banco), a página inicial sem as telas sob demanda e dentro do orçamento
 * de 450 KB, o orçamento de 150 KB por módulo, o catálogo de módulos coerente com os arquivos e com o Index, e a separação
 * do include que o cliente injeta. O fluxo no navegador (abrir, falha de rede, "Tentar de novo", a volta, memória) está em
 * tests/ui/sobdemanda.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./apoio-sistema');
const T = require('./apoio-telas');
const UI = require('../scripts/ui-check');

const SRC = path.join(__dirname, '..', 'src');
const ler = (n) => fs.readFileSync(path.join(SRC, n), 'utf8');
const { js } = S;
const chamar = (s, pedido) => js(s.gas.exec(() => s.G.api(pedido)));

test('sistema.tela: a importação vem compactada como no doGet, com o módulo e os bytes, sem versão dos dados; a guarda de dono vale', () => {
  const s = S.sistema({ semCadastro: true });
  const r = chamar(s, { rota: 'sistema.tela', dados: { nome: 'Import' } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const esperado = s.G.Api.compactar(ler('Import.html'));
  assert.equal(r.data.conteudo, esperado, 'o arquivo compactado (Api.compactar), como o doGet entrega os includes');
  assert.deepEqual([r.data.nome, r.data.modulo, r.data.bytes], ['Import', 'IMPORTACAO', Buffer.byteLength(esperado, 'utf8')]);
  assert.match(r.data.conteudo, /^<script>\n'use strict';/);
  assert.match(r.data.conteudo, /Telas\.registrar\('importar'/, 'a tela registra as rotas dela na carga');
  assert.equal(r.meta.dataVersion, null, 'não abre a planilha-banco: sem versão dos dados');
  assert.equal(r.meta.appVersion, s.G.Api.APP_VERSION);
  assert.equal(s.G.Api.rotas()['sistema.tela'].tipo, 'CONSULTA');
  assert.equal(s.G.Api.rotas()['sistema.tela'].exigeChave, false);
  // Guarda de dono: outro e-mail não recebe a tela.
  s.gas.session.activeEmail = 'Intruso@gmail.com';
  const neg = chamar(s, { rota: 'sistema.tela', dados: { nome: 'Import' } });
  assert.deepEqual([neg.ok, neg.error.code, neg.data], [false, 'DENIED', undefined]);
});

test('sistema.tela não depende da planilha-banco: sem o banco do ambiente, a consulta comum dá CONFIG e a tela vem', () => {
  const s = S.sistema({ semCadastro: true });
  s.gas.props.script.deleteProperty('SPREADSHEET_ID');
  assert.equal(chamar(s, { rota: 'evento.listar', dados: {} }).error.code, 'CONFIG');
  const r = chamar(s, { rota: 'sistema.tela', dados: { nome: 'Import' } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
});

test('sistema.tela: tela fora da lista → VALIDATION (nome); módulo da Fase 3 a 5 ainda sem tela → NOT_FOUND com a fase; arquivo ausente do projeto → NOT_FOUND com a instrução; as pesagens (E3.1) e a sanidade (E3.2 e E3.3) vêm', () => {
  const s = S.sistema({ semCadastro: true });
  for (const nome of ['Dashboard', 'Styles', 'JavaScript', 'Index', '', '../Import', 'import', null, 7]) {
    const r = chamar(s, { rota: 'sistema.tela', dados: { nome } });
    assert.deepEqual([r.ok, r.error.code, r.error.details[0].campo], [false, 'VALIDATION', 'nome'], String(nome));
    assert.match(r.error.message, /^Tela desconhecida/);
  }
  // Pesagens (Fase 3, E3.1): entregue, sob demanda, com as rotas da tela de desempenho e do modo curral.
  const w = chamar(s, { rota: 'sistema.tela', dados: { nome: 'Weights' } });
  assert.deepEqual([w.ok, w.data && w.data.modulo], [true, 'PESAGENS'], JSON.stringify(w.error));
  assert.equal(w.data.conteudo, s.G.Api.compactar(ler('Weights.html')));
  assert.match(w.data.conteudo, /Telas\.registrar\('pesagens'/);
  assert.match(w.data.conteudo, /Telas\.registrar\('pesagens\/curral'/);
  // Sanidade (Fase 3, E3.2 e E3.3): entregue, sob demanda, com a agenda, as aplicações, os produtos e os protocolos.
  const hs = chamar(s, { rota: 'sistema.tela', dados: { nome: 'Health' } });
  assert.deepEqual([hs.ok, hs.data && hs.data.modulo], [true, 'SANIDADE'], JSON.stringify(hs.error));
  assert.equal(hs.data.conteudo, s.G.Api.compactar(ler('Health.html')));
  for (const r of ['sanidade/agenda', 'sanidade/aplicacoes', 'sanidade/produtos', 'sanidade/protocolos']) assert.match(hs.data.conteudo, new RegExp("Telas\\.registrar\\('" + r.replace('/', '\\/') + "'"), r);
  for (const [nome, modulo, fase] of [['Reproduction', 'Reprodução', 3], ['Financial', 'Financeiro', 4], ['Reports', 'Relatórios', 5]]) {
    const r = chamar(s, { rota: 'sistema.tela', dados: { nome } });
    assert.equal(r.error.code, 'NOT_FOUND', nome);
    assert.equal(r.error.message, 'Esta tela faz parte do módulo ' + modulo + ', que chega na fase ' + fase + ' e ainda não foi entregue.');
  }
  // O módulo entregue cujo arquivo não foi enviado ao Apps Script (cópia manual incompleta): a causa vai ao log.
  const original = s.G.HtmlService.createHtmlOutputFromFile;
  s.G.HtmlService.createHtmlOutputFromFile = (n) => { if (n === 'Import') throw new Error('No HTML file named Import was found.'); return original(n); };
  const r = chamar(s, { rota: 'sistema.tela', dados: { nome: 'Import' } });
  assert.deepEqual([r.error.code, r.error.message], ['NOT_FOUND', 'A tela de Importação não está no projeto do Apps Script. Envie o projeto de novo (npm run gas:push) e recarregue a página.']);
  assert.ok(s.gas.logs.some((l) => l[0] === 'error' && /sistema\.tela Import: No HTML file/.test(String(l[1][0]))));
});

test('página inicial: sem as telas sob demanda, com o carregador (Modulos), dentro de 450 KB; cada tela sob demanda dentro de 150 KB', () => {
  const s = S.sistema({ semCadastro: true });
  const html = s.gas.exec(() => s.G.doGet({ parameter: {} })).getContent();
  assert.doesNotMatch(html, /var TelaImportacao =/, 'a importação não vem na página inicial');
  assert.match(html, /var Modulos =/);
  const kb = Buffer.byteLength(html, 'utf8');
  assert.ok(kb <= UI.ORCAMENTO_BYTES, 'página inicial: ' + Math.round(kb / 1024) + ' KB');
  const paginas = UI.lerPaginas(SRC);
  const m = UI.conferirModulos(paginas, html);
  assert.deepEqual(m.problemas, []);
  assert.deepEqual(m.modulos.map((x) => [x.nome, x.entregue]).sort(), [['Health', true], ['Import', true], ['Weights', true]]);
  assert.doesNotMatch(html, /var TelaPesagens =/, 'as pesagens não vêm na página inicial');
  assert.doesNotMatch(html, /var TelaSanidade =/, 'a sanidade não vem na página inicial');
  assert.ok(m.modulos.every((x) => x.bytes <= UI.ORCAMENTO_MODULO_BYTES));
  // O conferidor acusa a tela sob demanda posta de volta no Index e o módulo acima do orçamento.
  const comImport = Object.assign({}, paginas, { 'Index.html': paginas['Index.html'].replace("<?!= include_('Settings') ?>", "<?!= include_('Settings') ?>\n<?!= include_('Import') ?>") });
  assert.match(UI.conferirModulos(comImport, html).problemas.join('|'), /Import\.html: é tela sob demanda e não pode entrar na página inicial/);
  const grande = Object.assign({}, paginas, { 'Import.html': '<script>\nvar x = 1;\n' + 'var y = "' + 'a'.repeat(UI.ORCAMENTO_MODULO_BYTES) + '";\n</script>' });
  assert.match(UI.conferirModulos(grande, html).problemas.join('|'), /Import\.html: a tela sob demanda soma \d+ KB; o orçamento por módulo é de 150 KB/);
});

test('catálogo de módulos × arquivos × Index: toda tela de módulo existe; sob demanda ⇔ lista da rota, fora do Index; as demais no Index', () => {
  const s = S.sistema({ semCadastro: true });
  const C = s.G.EventCatalog;
  const sob = js(s.G.Api.TELAS_SOB_DEMANDA);
  const index = ler('Index.html');
  const incluido = (n) => new RegExp("include_\\('" + n + "'\\)").test(index);
  for (const m of js(C.modulos())) {
    // Os 10 do menu e a importação: o das Fases 3 a 5 tem o arquivo da sua tela na lista sob demanda.
    const arquivo = Object.keys(sob).find((k) => sob[k] === m.id);
    if (m.fase >= 3) assert.ok(arquivo, m.id + ' (fase ' + m.fase + ') carrega sob demanda');
    if (!m.tela) { assert.ok(m.fase >= 3, m.id + ' sem tela só se for de fase futura'); continue; }
    assert.ok(fs.existsSync(path.join(SRC, m.tela + '.html')), m.tela + '.html existe');
    if (m.sob_demanda) {
      assert.equal(sob[m.tela], m.id, m.tela + ' na lista da rota sistema.tela');
      assert.ok(Array.isArray(m.rotas) && m.rotas.length, m.id + ' com as raízes de rota');
      assert.ok(!incluido(m.tela), m.tela + ' fora da página inicial');
    } else {
      assert.equal(sob[m.tela], undefined, m.tela + ' não é sob demanda');
      assert.ok(incluido(m.tela), m.tela + ' na página inicial');
    }
  }
  for (const k of Object.keys(sob)) assert.ok(C.modulo(sob[k]), k + ': módulo ' + sob[k] + ' do catálogo');
  // O bootstrap leva ao cliente o que ele precisa para pedir a tela: tela, sob_demanda e rotas.
  const b = chamar(s, { rota: 'sistema.bootstrap', dados: {} });
  const imp = b.data.modulos.find((m) => m.id === 'IMPORTACAO');
  assert.deepEqual([imp.tela, imp.sob_demanda, imp.rotas], ['Import', true, ['importar']]);
  const pes = b.data.modulos.find((m) => m.id === 'PESAGENS');
  assert.deepEqual([pes.tela, pes.sob_demanda, pes.rotas], ['Weights', true, ['pesagens']], 'as pesagens (E3.1) vão ao menu, sob demanda');
  const san = b.data.modulos.find((m) => m.id === 'SANIDADE');
  assert.deepEqual([san.tela, san.sob_demanda, san.rotas], ['Health', true, ['sanidade']], 'a sanidade (E3.2 e E3.3) vai ao menu, sob demanda');
  assert.equal(b.data.modulos.some((m) => ['REPRODUCAO'].includes(m.id)), false, 'módulo da Fase 3 sem tela não vai ao menu');
});

test('cliente: a importação, as pesagens e a sanidade injetadas pela rota (como o menu as abre) registram as rotas delas; o include se separa em estilos e scripts', () => {
  const s = S.sistema({ semCadastro: true });
  const c = T.cliente(s);
  assert.equal(typeof c.TelaImportacao.planoConfirmacao, 'function');
  assert.ok(c.Telas.resolver('importar') && c.Telas.resolver('importar/abc/validacao'));
  assert.equal(c.TelaPesagens.BLOCO, 20);
  assert.ok(c.Telas.resolver('pesagens') && c.Telas.resolver('pesagens/curral'));
  assert.deepEqual(js(c.TelaSanidade.SUBTIPO_DO_PROCEDIMENTO), { VACINA: 'VACINACAO', VERMIFUGO: 'VERMIFUGACAO', MEDICAMENTO: 'MEDICACAO', TRATAMENTO: 'TRATAMENTO', EXAME: 'EXAME' });
  for (const r of ['sanidade/agenda', 'sanidade/aplicacoes', 'sanidade/produtos', 'sanidade/protocolos']) assert.ok(c.Telas.resolver(r), r);
  const p = js(c.Modulos.partes('<style>\na{color:red}\n</style>\n<script>\nvar A = 1;\n</script>\n<script>\nvar B = "<b>";\n</script>'));
  assert.deepEqual(p, { estilos: ['\na{color:red}\n'], scripts: ['\nvar A = 1;\n', '\nvar B = "<b>";\n'] });
  assert.deepEqual(js(c.Modulos.partes('sem nada')), { estilos: [], scripts: [] });
});
