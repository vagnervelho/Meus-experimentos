'use strict';
/**
 * Verificações estáticas (lint) de src/ e da estrutura do projeto — 09-plano-de-testes.md, seção 9.
 * Cada regra é uma função (arquivo, código) → problemas[] e tem autoteste de detecção: o primeiro teste de cada
 * regra prova, com código sintético, que ela pega o que diz pegar; o segundo a aplica a todos os arquivos de src/.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGas, ORDENS, SRC_DIR, arquivosFonte } = require('./harness');

const RAIZ = path.join(__dirname, '..');
const fontes = Object.fromEntries(arquivosFonte().map((f) => [f, fs.readFileSync(path.join(SRC_DIR, f), 'utf8')]));
const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'appsscript.json'), 'utf8'));

/** Únicos arquivos em que podem aparecer globais do Apps Script (01-arquitetura.md, seção 6.1). */
const COM_PLATAFORMA = ['Code.js', 'Api.js', 'Config.js', 'Database.js', 'FileService.js', 'Maintenance.js'];
const GLOBAIS_GAS = ['SpreadsheetApp', 'Sheets', 'Drive', 'LockService', 'PropertiesService', 'Session', 'ScriptApp', 'HtmlService', 'Utilities', 'UrlFetchApp', 'CacheService'];
/** Superfície pública fechada: só estas funções de topo, e só em Code.js. Auxiliar de topo termina em _. */
const PUBLICAS = ['doGet', 'api', 'setup', 'runAcceptanceTests', 'runDiagnostics', 'verifyIntegrity', 'trgManutencaoDiaria', 'trgIntegridadeSemanal'];

// ------------------------------------------------------------------ leitor de código ----
/**
 * Troca comentários por espaços (mantendo as quebras de linha) e, com `semTextos`, esvazia o conteúdo de
 * textos e de expressões regulares — para que a palavra "Drive" num comentário ou numa mensagem não conte.
 */
function limpar(codigo, semTextos) {
  let out = '';
  let i = 0;
  let ultimoSignificativo = '';
  const n = codigo.length;
  while (i < n) {
    const c = codigo[i];
    const d = codigo[i + 1];
    if (c === '/' && d === '/') { while (i < n && codigo[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      while (i < n && !(codigo[i] === '*' && codigo[i + 1] === '/')) { out += codigo[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < n && codigo[i] !== c) {
        if (codigo[i] === '\\') { out += semTextos ? '  ' : codigo[i] + codigo[i + 1]; i += 2; continue; }
        out += semTextos ? (codigo[i] === '\n' ? '\n' : ' ') : codigo[i]; i++;
      }
      out += c; i++; ultimoSignificativo = c; continue;
    }
    if (c === '/' && (ultimoSignificativo === '' || /[(,=:[!&|?{};]/.test(ultimoSignificativo) || /\b(return|typeof|case)$/.test(out.trimEnd()))) {
      out += c; i++;
      let classe = false;
      while (i < n && (codigo[i] !== '/' || classe) && codigo[i] !== '\n') {
        if (codigo[i] === '\\') { out += semTextos ? '  ' : codigo[i] + codigo[i + 1]; i += 2; continue; }
        if (codigo[i] === '[') classe = true; else if (codigo[i] === ']') classe = false;
        out += semTextos ? ' ' : codigo[i]; i++;
      }
      out += '/'; i++; ultimoSignificativo = '/'; continue;
    }
    out += c;
    if (!/\s/.test(c)) ultimoSignificativo = c;
    i++;
  }
  return out;
}

// ------------------------------------------------------------------ regras ----
function regraNamespace(arquivo, codigo) {
  const problemas = [];
  const nome = arquivo.replace(/\.js$/, '');
  const ehCode = arquivo === 'Code.js';
  const linhas = limpar(codigo, true).split('\n');
  const topo = linhas.map((l, i) => ({ l, n: i + 1 })).filter((x) => x.l.trim() !== '' && !/^\s/.test(x.l));
  const namespaces = [];
  let fechos = 0;
  let dentroDeFuncao = false;
  topo.forEach(({ l, n }) => {
    const decl = /^(var|let|const|class|function\*?)\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (decl && decl[1] === 'var') {
      if (!/^var\s+[A-Za-z_$][\w$]*\s*=\s*\(function\s*\(\)\s*\{\s*$/.test(l)) problemas.push(arquivo + ':' + n + ': o namespace precisa ter a forma "var ' + nome + ' = (function () {"');
      namespaces.push(decl[2]);
      return;
    }
    if (decl && /^function/.test(decl[1])) {
      if (!ehCode) problemas.push(arquivo + ':' + n + ': função de topo "' + decl[2] + '" fora de Code.js');
      else if (PUBLICAS.indexOf(decl[2]) < 0 && !/_$/.test(decl[2])) problemas.push(arquivo + ':' + n + ': função de topo "' + decl[2] + '" não é pública do desenho nem termina em _');
      dentroDeFuncao = true;
      return;
    }
    if (decl) { problemas.push(arquivo + ':' + n + ': declaração de topo "' + decl[1] + ' ' + decl[2] + '" (use o namespace)'); return; }
    if (/^\}\)\(\);\s*$/.test(l)) { fechos++; return; }
    if (ehCode && dentroDeFuncao && /^\}\s*$/.test(l)) { dentroDeFuncao = false; return; }
    problemas.push(arquivo + ':' + n + ': comando de topo executado na carga: ' + l.trim().slice(0, 50));
  });
  if (!ehCode && namespaces.length !== 1) problemas.push(arquivo + ': precisa declarar exatamente um namespace (achei ' + namespaces.length + ')');
  if (ehCode && namespaces.length > 1) problemas.push(arquivo + ': mais de um namespace');
  namespaces.forEach((ns) => { if (ns !== nome) problemas.push(arquivo + ': o namespace "' + ns + '" não tem o nome do arquivo'); });
  if (fechos !== namespaces.length || (!ehCode && namespaces.length && !/\}\)\(\);$/.test(limpar(codigo, true).trimEnd()))) problemas.push(arquivo + ': o namespace precisa terminar em "})();"');
  return problemas;
}
function regraGlobais(arquivo, codigo) {
  if (COM_PLATAFORMA.indexOf(arquivo) >= 0) return [];
  const limpo = limpar(codigo, true);
  const re = new RegExp('(?<![.\\w$])(' + GLOBAIS_GAS.join('|') + ')(?![\\w$])', 'g');
  return [...limpo.matchAll(re)].map((m) => arquivo + ': usa o serviço ' + m[1] + ' (só é permitido em ' + COM_PLATAFORMA.join(', ') + ')');
}
function regraProibidos(arquivo, codigo) {
  const limpo = limpar(codigo, true);
  const problemas = [];
  if (/(?<![\w$])DriveApp(?![\w$])/.test(limpo)) problemas.push(arquivo + ': DriveApp é proibido (escopo drive.file: use o serviço avançado Drive)');
  if (/SpreadsheetApp\s*\.\s*create\s*\(/.test(limpo)) problemas.push(arquivo + ': SpreadsheetApp.create é proibido (o arquivo nasce por Drive.Files.create)');
  for (const m of limpo.matchAll(/([\w$.]*)\s*\.\s*copy\s*\(/g)) {
    if (m[1] !== 'Drive.Files') problemas.push(arquivo + ': ".copy(" que não é Drive.Files.copy (' + (m[1] || '?') + '.copy)');
  }
  return problemas;
}
function regraRelogio(arquivo, codigo) {
  if (arquivo === 'Database.js') return [];
  const limpo = limpar(codigo, true);
  const problemas = [];
  if (/new\s+Date\s*\(\s*\)/.test(limpo)) problemas.push(arquivo + ': new Date() sem argumento lê o relógio (só a porta Clock, em Database.js)');
  if (/Date\s*\.\s*now\s*\(/.test(limpo)) problemas.push(arquivo + ': Date.now() lê o relógio (só a porta Clock, em Database.js)');
  return problemas;
}
function regraModulos(arquivo, codigo) {
  const limpo = limpar(codigo, true);
  const problemas = [];
  if (/^\s*(import|export)\s/m.test(limpo)) problemas.push(arquivo + ': módulos ES não existem no Apps Script');
  if (/(?<![.\w$])require\s*\(|module\s*\.\s*exports/.test(limpo)) problemas.push(arquivo + ': require/module.exports não existem no Apps Script');
  return problemas;
}
function regraPendencias(arquivo, codigo) {
  return /\b(TODO|FIXME|XXX)\b/.test(codigo) ? [arquivo + ': marcação de pendência (TODO/FIXME/XXX) no código'] : [];
}
const REGRAS = [regraNamespace, regraGlobais, regraProibidos, regraRelogio, regraModulos, regraPendencias];
const NS = (nome, corpo) => 'var ' + nome + ' = (function () {\n' + (corpo || '  function f() { return 1; }\n  return { f: f };') + '\n})();\n';

// ------------------------------------------------------------------ autotestes de detecção ----
test('leitor de código: comentários, textos e expressões regulares não contam como código', () => {
  const codigo = "var a = 'DriveApp // não é comentário'; // DriveApp aqui é comentário\n/* SpreadsheetApp.create( */ var re = /['\"]copy\\(/; var b = x / 2; // fim";
  const limpo = limpar(codigo, true);
  assert.ok(!/DriveApp|SpreadsheetApp|copy/.test(limpo));
  assert.match(limpo, /var a = '\s+';/);
  assert.match(limpo, /var b = x \/ 2;/);
  assert.equal(limpo.split('\n').length, 2, 'as linhas são preservadas');
  assert.match(limpar(codigo, false), /DriveApp \/\/ não é comentário/, 'sem a opção, os textos ficam');
  assert.ok(!/aqui é comentário/.test(limpar(codigo, false)));
});

test('regra do namespace (autoteste): um namespace por arquivo, com o nome do arquivo, e nada executado na carga', () => {
  assert.deepEqual(regraNamespace('Utils.js', '/** doc */\n' + NS('Utils')), []);
  assert.match(regraNamespace('Utils.js', NS('Utils') + NS('Outro')).join('|'), /exatamente um namespace \(achei 2\)/);
  assert.match(regraNamespace('Utils.js', NS('Util')).join('|'), /namespace "Util" não tem o nome do arquivo/);
  assert.match(regraNamespace('Utils.js', 'function ajuda_() {}\n' + NS('Utils')).join('|'), /função de topo "ajuda_" fora de Code\.js/);
  assert.match(regraNamespace('Utils.js', NS('Utils') + 'Utils.f();\n').join('|'), /comando de topo executado na carga/);
  assert.match(regraNamespace('Utils.js', 'const X = 1;\n' + NS('Utils')).join('|'), /declaração de topo "const X"/);
  assert.match(regraNamespace('Utils.js', 'var Utils = { f: function () {} };\n').join('|'), /precisa ter a forma/);
  assert.match(regraNamespace('Utils.js', '// só comentário\n').join('|'), /exatamente um namespace \(achei 0\)/);
  assert.match(regraNamespace('Utils.js', 'var Utils = (function () {\n  return {};\n}());\n').join('|'), /precisa terminar em "\}\)\(\);"|comando de topo/);
  assert.match(regraNamespace('Utils.js', "var Utils = (function () {\n  return {};\n})();\nPropertiesService.getScriptProperties();\n").join('|'), /comando de topo/);
});

test('regra das funções de topo (autoteste): só em Code.js; públicas do desenho ou terminadas em _', () => {
  const code = PUBLICAS.map((f) => 'function ' + f + '(e) {\n  return Api.entrada_("' + f + '", e);\n}\n').join('') + 'function include_(nome) {\n  return nome;\n}\n';
  assert.deepEqual(regraNamespace('Code.js', code), []);
  assert.deepEqual(regraNamespace('Code.js', NS('Code') + code), [], 'Code.js pode ter o próprio namespace');
  assert.match(regraNamespace('Code.js', code + 'function apagarTudo() {\n}\n').join('|'), /"apagarTudo" não é pública do desenho nem termina em _/);
  assert.match(regraNamespace('Code.js', code + 'function doPost(e) {\n}\n').join('|'), /"doPost"/);
  assert.match(regraNamespace('Api.js', NS('Api') + 'function api(p) {\n}\n').join('|'), /função de topo "api" fora de Code\.js/);
  assert.match(regraNamespace('Code.js', code + 'setup();\n').join('|'), /comando de topo/);
});

test('regra das camadas (autoteste): serviço do Apps Script só nos arquivos de plataforma', () => {
  for (const g of GLOBAIS_GAS) {
    assert.match(regraGlobais('AnimalService.js', NS('AnimalService', '  function f() { return ' + g + '.x(); }\n  return { f: f };')).join('|'), new RegExp('usa o serviço ' + g));
    assert.deepEqual(regraGlobais('Database.js', NS('Database', '  function f() { return ' + g + '.x(); }\n  return { f: f };')), []);
  }
  assert.deepEqual(regraGlobais('Utils.js', NS('Utils', "  // Utilities.computeDigest é da porta\n  var msg = 'o Drive e o Sheets ficam atrás das portas';\n  function f(ctx) { return ctx.Drive + portas.Session + SheetsAdapterFalso + DriveX; }\n  return { f: f };")), [], 'comentário, texto, propriedade e nome parecido não contam');
  assert.match(regraGlobais('Utils.js', NS('Utils', '  function f() { var s = Sheets; return s; }\n  return { f: f };')).join('|'), /usa o serviço Sheets/);
  assert.deepEqual(COM_PLATAFORMA, ['Code.js', 'Api.js', 'Config.js', 'Database.js', 'FileService.js', 'Maintenance.js']);
});

test('regra do drive.file (autoteste): DriveApp, SpreadsheetApp.create e .copy( que não seja Drive.Files.copy', () => {
  const corpo = (x) => NS('FileService', '  function f(ss) { ' + x + ' }\n  return { f: f };');
  assert.match(regraProibidos('FileService.js', corpo('return DriveApp.getFileById(ss);')).join('|'), /DriveApp é proibido/);
  assert.match(regraProibidos('FileService.js', corpo("return SpreadsheetApp.create('Banco');")).join('|'), /SpreadsheetApp\.create é proibido/);
  assert.match(regraProibidos('FileService.js', corpo('return SpreadsheetApp\n      .create("Banco");')).join('|'), /SpreadsheetApp\.create é proibido/);
  assert.match(regraProibidos('FileService.js', corpo("return ss.copy('backup');")).join('|'), /"\.copy\(" que não é Drive\.Files\.copy \(ss\.copy\)/);
  assert.match(regraProibidos('FileService.js', corpo("return SpreadsheetApp.openById(ss).copy('backup');")).join('|'), /\.copy\(/);
  assert.match(regraProibidos('FileService.js', corpo('return Files.copy({}, ss);')).join('|'), /Files\.copy/);
  assert.deepEqual(regraProibidos('FileService.js', corpo("return Drive.Files.copy({ name: 'backup' }, ss);")), []);
  assert.deepEqual(regraProibidos('FileService.js', corpo("// DriveApp e ss.copy( em comentário\n    return 'SpreadsheetApp.create(' + ss;")), []);
  assert.deepEqual(regraProibidos('FileService.js', corpo('return ss.copyTo(x) + ss.copiar(x);')), [], 'só .copy( exato');
});

test('regras do relógio, de módulos e de pendências (autoteste)', () => {
  const corpo = (x) => NS('Timeline', '  function f(ms) { ' + x + ' }\n  return { f: f };');
  assert.match(regraRelogio('Timeline.js', corpo('return new Date();')).join('|'), /new Date\(\) sem argumento/);
  assert.match(regraRelogio('Timeline.js', corpo('return new Date( );')).join('|'), /new Date\(\)/);
  assert.match(regraRelogio('Timeline.js', corpo('return Date.now();')).join('|'), /Date\.now\(\)/);
  assert.deepEqual(regraRelogio('Timeline.js', corpo('return new Date(ms).toISOString() + new Date(Date.UTC(2026, 0, 1));')), [], 'construir data a partir de valor é permitido');
  assert.deepEqual(regraRelogio('Database.js', corpo('return new Date();')), [], 'a porta Clock mora em Database.js');
  assert.match(regraModulos('Utils.js', "import x from 'y';\n" + NS('Utils')).join('|'), /módulos ES/);
  assert.match(regraModulos('Utils.js', NS('Utils') + 'export default Utils;\n').join('|'), /módulos ES/);
  assert.match(regraModulos('Utils.js', NS('Utils', "  var fs = require('fs');\n  return {};")).join('|'), /require/);
  assert.match(regraModulos('Utils.js', NS('Utils') + 'module.exports = Utils;\n').join('|'), /module\.exports/);
  assert.deepEqual(regraModulos('Utils.js', NS('Utils', "  var s = 'importar e exportar são telas'; function f(o) { return o.require(1); }\n  return { f: f };")), []);
  assert.match(regraPendencias('Utils.js', NS('Utils', '  // TODO: terminar\n  return {};')).join('|'), /pendência/);
  assert.match(regraPendencias('Utils.js', NS('Utils', '  /* FIXME */\n  return {};')).join('|'), /pendência/);
  assert.deepEqual(regraPendencias('Utils.js', NS('Utils', "  var s = 'TODOS os animais; método todo-poderoso';\n  return {};")), []);
});

// ------------------------------------------------------------------ aplicação a src/ ----
test('src/: todos os arquivos passam em todas as regras', () => {
  assert.ok(Object.keys(fontes).length >= 3);
  const problemas = [];
  for (const [arquivo, codigo] of Object.entries(fontes)) REGRAS.forEach((regra) => problemas.push(...regra(arquivo, codigo)));
  assert.deepEqual(problemas, []);
});

test('src/: carga nas duas ordens dá a mesma superfície e não tem efeito colateral', () => {
  const base = Object.keys(createGas({ files: [] }).G);
  const superficies = ORDENS.map((order) => {
    const gas = createGas({ order });
    const novos = Object.keys(gas.G).filter((k) => base.indexOf(k) < 0).sort();
    const esperados = Object.keys(fontes).map((f) => f.replace(/\.js$/, '')).filter((n) => n !== 'Code' || /^var Code\b/m.test(fontes['Code.js']));
    const funcoes = novos.filter((k) => typeof gas.G[k] === 'function');
    funcoes.forEach((f) => assert.ok(PUBLICAS.indexOf(f) >= 0 || /_$/.test(f), 'global inesperado: função ' + f));
    assert.deepEqual(novos.filter((k) => typeof gas.G[k] !== 'function'), esperados.sort(), 'cada arquivo cria só o próprio namespace (ordem ' + order + ')');
    // Nada aconteceu na carga: nenhuma escrita, propriedade, lock, gatilho, arquivo, chamada HTTP ou log.
    assert.equal(gas.falhas.escritas(), 0);
    assert.deepEqual(gas.pendentes(), []);
    assert.deepEqual(Object.keys(gas.props.script.getProperties()), []);
    assert.deepEqual(Object.keys(gas.props.user.getProperties()), []);
    assert.deepEqual(gas.lock.estatisticas(), { tentativas: [], aquisicoes: 0, liberacoes: 0 });
    assert.deepEqual(gas.triggers, []);
    assert.deepEqual(gas.planilhas.ids(), []);
    assert.deepEqual(gas.drive.chamadas, []);
    assert.deepEqual(gas.http.calls, []);
    assert.deepEqual(gas.logs, []);
    return novos.map((k) => k + ':' + typeof gas.G[k] + '{' + (typeof gas.G[k] === 'object' ? Object.keys(gas.G[k]).sort().map((m) => m + ':' + typeof gas.G[k][m]).join(',') : '') + '}');
  });
  assert.deepEqual(superficies[0], superficies[1], 'mesma superfície nas duas ordens');
});

test('src/: cada arquivo carrega sozinho (nenhuma referência a outro arquivo em tempo de carga)', () => {
  for (const arquivo of Object.keys(fontes)) {
    const gas = createGas({ files: [arquivo] });
    if (arquivo !== 'Code.js') assert.equal(typeof gas.G[arquivo.replace(/\.js$/, '')], 'object', arquivo);
  }
});

// ------------------------------------------------------------------ estrutura do projeto ----
test('manifesto: escopos de menor privilégio, Web App só do dono, serviços avançados e host liberado', () => {
  assert.deepEqual(manifest.oauthScopes.slice().sort(), [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email',
  ]);
  assert.equal(manifest.webapp.access, 'MYSELF');
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.timeZone, 'America/Porto_Velho');
  assert.deepEqual(manifest.dependencies.enabledAdvancedServices.map((s) => [s.userSymbol, s.serviceId, s.version]).sort(), [['Drive', 'drive', 'v3'], ['Sheets', 'sheets', 'v4']]);
  assert.deepEqual(manifest.urlFetchWhitelist, ['https://www.googleapis.com/']);
});

test('hosts externos citados no código ⊆ urlFetchWhitelist', () => {
  const hosts = new Set();
  for (const codigo of Object.values(fontes)) {
    if (/ARQUIVO GERADO/.test(codigo.slice(0, 200))) continue; // Schema.js: só dados
    for (const m of limpar(codigo, false).matchAll(/['"`](https?:\/\/[a-z0-9.-]+\/?)[^'"`]*['"`]/gi)) hosts.add(m[1].replace(/\/?$/, '/'));
  }
  const fora = [...hosts].filter((h) => !/^https:\/\/www\.googleapis\.com\/auth\//.test(h) && !manifest.urlFetchWhitelist.some((p) => h.startsWith(p)) && !/^https:\/\/(docs|script|drive)\.google\.com\/$/.test(h));
  assert.deepEqual(fora, []);
});

test('package.json, .claspignore e .clasp.json.example', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
  assert.equal(pkg.scripts['gen:schema'], 'node scripts/gen-schema.js');
  assert.equal(pkg.scripts['ui:check'], 'node scripts/ui-check.js');
  assert.equal(pkg.scripts['gas:push'], 'node scripts/push-gas.js');
  for (const s of Object.values(pkg.scripts)) {
    const alvo = /^node (?:--test )?(scripts\/[\w-]+\.js)/.exec(s);
    if (alvo) assert.ok(fs.existsSync(path.join(RAIZ, alvo[1])), 'script inexistente: ' + alvo[1]);
  }
  assert.match(pkg.devDependencies['@types/google-apps-script'], /^\d+\.\d+\.\d+$/, 'versão fixa, sem ^ nem ~');
  assert.equal(pkg.dependencies, undefined, 'nada vai para o Apps Script além de src/');
  assert.deepEqual(fs.readFileSync(path.join(RAIZ, '.claspignore'), 'utf8').trim().split('\n'), ['**/**', '!appsscript.json', '!*.js', '!*.html']);
  const clasp = JSON.parse(fs.readFileSync(path.join(RAIZ, '.clasp.json.example'), 'utf8'));
  assert.equal(clasp.rootDir, 'src');
  assert.match(fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8'), /^\.clasp\.json$/m, 'o .clasp.json real fica fora do git');
  assert.match(clasp.scriptId, /COLE_AQUI/, 'o exemplo não traz ID de verdade');
});

test('gas:push: aceita o manifesto do projeto, recusa o padrão do clasp e escopo fora do desenho', () => {
  const { checkManifest, usesFullDriveScope, parseScriptId } = require('../scripts/push-gas');
  assert.deepEqual(checkManifest(manifest), []);
  // Manifesto que "clasp create"/"clasp pull" gravaria por cima do nosso.
  const padrao = { timeZone: 'America/New_York', dependencies: {}, exceptionLogging: 'STACKDRIVER', runtimeVersion: 'V8' };
  assert.ok(checkManifest(padrao).length >= 8);
  const copia = () => JSON.parse(JSON.stringify(manifest));
  const com = (fn) => { const m = copia(); fn(m); return checkManifest(m).join('|'); };
  assert.match(com((m) => m.oauthScopes.push('https://www.googleapis.com/auth/gmail.readonly')), /escopo fora do desenho: gmail\.readonly/);
  assert.match(com((m) => m.oauthScopes.push('https://www.googleapis.com/auth/drive.readonly')), /escopo fora do desenho: drive\.readonly/);
  assert.match(com((m) => { m.oauthScopes = m.oauthScopes.filter((s) => !/spreadsheets/.test(s)); }), /sem o escopo spreadsheets/);
  assert.match(com((m) => { m.webapp.access = 'ANYONE'; }), /Somente eu/);
  assert.match(com((m) => { m.webapp.executeAs = 'USER_ACCESSING'; }), /executa como você/);
  assert.match(com((m) => { m.runtimeVersion = 'DEPRECATED_ES5'; }), /V8/);
  assert.match(com((m) => { m.dependencies.enabledAdvancedServices = m.dependencies.enabledAdvancedServices.filter((s) => s.serviceId !== 'drive'); }), /sem o serviço avançado drive/);
  assert.match(com((m) => { m.dependencies.enabledAdvancedServices.find((s) => s.serviceId === 'drive').version = 'v2'; }), /drive na versão v2/);
  assert.match(com((m) => m.urlFetchWhitelist.push('https://exemplo.com/')), /urlFetchWhitelist/);
  assert.match(com((m) => { delete m.timeZone; }), /fuso/);
  // Contingência do SP-02: `drive` completo NO LUGAR de drive.file é aceito (com aviso); os dois juntos, não.
  const contingencia = copia();
  contingencia.oauthScopes = contingencia.oauthScopes.map((s) => s.replace(/drive\.file$/, 'drive'));
  assert.deepEqual(checkManifest(contingencia), []);
  assert.equal(usesFullDriveScope(contingencia), true);
  assert.equal(usesFullDriveScope(manifest), false);
  assert.match(com((m) => m.oauthScopes.push('https://www.googleapis.com/auth/drive')), /drive e drive\.file ao mesmo tempo/);
  const id = '1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789abcdefghijklmnopq';
  assert.equal(parseScriptId(id), id);
  assert.equal(parseScriptId('  ' + id + '\n'), id);
  assert.equal(parseScriptId('https://script.google.com/home/projects/' + id + '/edit'), id);
  assert.equal(parseScriptId('https://script.google.com/d/' + id + '/edit?usp=sharing'), id);
  assert.equal(parseScriptId('erp-pecuario-512713'), null, 'ID de projeto Cloud não é ID do script');
  assert.equal(parseScriptId('abc"; rm -rf /'), null);
});

test('gas:push: publica sempre na mesma implantação do Web App, nunca na @HEAD', () => {
  const { pickDeployment, shellArgs, webAppUrl, AVISO_VERSOES } = require('../scripts/push-gas');
  const head = { deploymentId: 'AKfyHEAD', description: '' };
  assert.equal(pickDeployment([]), null);
  assert.equal(pickDeployment([head]), null, '@HEAD não é atualizada: cria a primeira implantação');
  assert.equal(pickDeployment([head, { deploymentId: 'AKfyManual', versionNumber: 1, description: 'v1' }]), 'AKfyManual', 'adota a única criada à mão');
  assert.equal(pickDeployment([head, { deploymentId: 'A', versionNumber: 1, description: 'v1' }, { deploymentId: 'B', versionNumber: 2, description: 'teste' }]), null, 'várias de outra origem: não adivinha');
  assert.equal(pickDeployment([
    head,
    { deploymentId: 'Old', versionNumber: 2, description: 'ERP Pecuário abc123 2026-11-13' },
    { deploymentId: 'Irmao', versionNumber: 9, description: 'Inbox Intelligence def456 2026-10-26' },
    { deploymentId: 'New', versionNumber: 5, description: 'ERP Pecuário def456 2026-11-14' },
  ]), 'New');
  assert.equal(webAppUrl('AKfyX'), 'https://script.google.com/macros/s/AKfyX/exec');
  assert.deepEqual(shellArgs(['--description', 'ERP Pecuário abc 2026-11-13'], 'linux'), ['--description', 'ERP Pecuário abc 2026-11-13']);
  assert.deepEqual(shellArgs(['--description', 'ERP Pecuário abc 2026-11-13'], 'win32'), ['--description', '"ERP Pecuário abc 2026-11-13"']);
  assert.equal(AVISO_VERSOES, 150, 'aviso bem antes do limite de 200 versões');
});

test('ui:check: recusa recurso externo e página acima do orçamento', () => {
  const { conferirPaginas, ORCAMENTO_BYTES } = require('../scripts/ui-check');
  assert.deepEqual(conferirPaginas({ 'Index.html': '<html><head><style>a{color:red;background:url(data:image/png;base64,AAAA)}</style></head><body><script>var x = 1;</script><svg></svg><a href="https://exemplo.com">link</a></body></html>' }), []);
  assert.match(conferirPaginas({ 'Index.html': '<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>' }).join('|'), /Index\.html: <script src>/);
  assert.match(conferirPaginas({ 'Styles.html': '<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto">' }).join('|'), /<link> para recurso externo/);
  assert.match(conferirPaginas({ 'Styles.html': "<style>@import url('//fonts.exemplo.com/x.css');</style>" }).join('|'), /@import/);
  assert.match(conferirPaginas({ 'Styles.html': '<style>body{background:url(https://exemplo.com/fundo.png)}</style>' }).join('|'), /url\(\) externa/);
  assert.match(conferirPaginas({ 'Animals.html': '<img src="https://exemplo.com/boi.jpg">' }).join('|'), /origem externa/);
  assert.match(conferirPaginas({ 'A.html': 'x'.repeat(ORCAMENTO_BYTES), 'B.html': 'y' }).join('|'), /a página soma \d+ KB; o orçamento é de 450 KB/);
  assert.deepEqual(conferirPaginas({}), []);
});
