'use strict';
/**
 * Verificações estáticas de segurança e de convenções do Apps Script:
 * funções de topo permitidas, nenhuma escrita no Gmail, manifesto mínimo,
 * hosts externos = whitelist, sintaxe ES2019 e nenhum segredo no código.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SRC_DIR } = require('./harness');

const jsFiles = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js'));
const src = Object.fromEntries(jsFiles.map((f) => [f, fs.readFileSync(path.join(SRC_DIR, f), 'utf8')]));
const manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'appsscript.json'), 'utf8'));

const ALLOWED_TOP = ['doGet', 'include', 'runPipeline', 'runMaintenance', 'setup', 'setupTriggers', 'uninstallTriggers', 'runBackfillNow', 'diagnose'];

test('funções de topo: só pontos de entrada permitidos (o resto vive em namespaces)', () => {
  for (const [f, code] of Object.entries(src)) {
    const tops = [...code.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]);
    for (const name of tops) {
      assert.ok(ALLOWED_TOP.includes(name) || /^api[A-Z]/.test(name), f + ': função de topo não permitida: ' + name);
    }
    if (f !== 'Code.js') assert.equal(tops.length, 0, f + ' não deve declarar funções de topo');
    const vars = [...code.matchAll(/^var\s+([A-Za-z0-9_$]+)\s*=/gm)].map((m) => m[1]);
    assert.ok(vars.length <= 1, f + ' declara mais de um namespace');
  }
});

test('somente leitura: nenhuma chamada que altere o Gmail ou envie e-mail', () => {
  const forbidden = [
    /\bGmailApp\b/, /\bMailApp\b/, /\bsendEmail\b/, /Gmail\.Users\.Messages\.(modify|trash|untrash|delete|batchModify|batchDelete|send|insert|import)\b/,
    /Gmail\.Users\.(Drafts|Settings)\b/, /Gmail\.Users\.Labels\.(create|update|patch|delete)\b/, /Gmail\.Users\.Threads\.(modify|trash|delete)\b/,
    /CalendarApp|Calendar\.Events/, /\bDriveApp\b/, /SpreadsheetApp/,
  ];
  for (const [f, code] of Object.entries(src)) {
    const noComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const re of forbidden) assert.ok(!re.test(noComments), f + ' contém chamada proibida: ' + re);
  }
});

test('manifesto: escopos mínimos, Web App privado, sem acesso anônimo', () => {
  assert.deepEqual(manifest.oauthScopes.slice().sort(), [
    'https://www.googleapis.com/auth/bigquery',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/userinfo.email',
  ]);
  assert.equal(manifest.webapp.access, 'MYSELF');
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.match(manifest.timeZone, /^America\/[A-Za-z_]+$/, 'fuso IANA do dono (rege datas, SQL e gatilhos)');
  const services = manifest.dependencies.enabledAdvancedServices.map((s) => s.serviceId).sort();
  assert.deepEqual(services, ['bigquery', 'gmail']);
});

test('gas:push: aceita o manifesto do projeto, recusa o padrão do clasp e lê o ID do script', () => {
  const { checkManifest, parseScriptId } = require('../scripts/push-gas');
  assert.deepEqual(checkManifest(manifest), []);
  // Manifesto que "clasp create"/"clasp pull" gravaria por cima do nosso.
  const fresh = { timeZone: 'America/New_York', dependencies: {}, exceptionLogging: 'STACKDRIVER', runtimeVersion: 'V8' };
  assert.ok(checkManifest(fresh).length >= 4);
  const writable = JSON.parse(JSON.stringify(manifest));
  writable.oauthScopes.push('https://www.googleapis.com/auth/gmail.modify');
  assert.ok(checkManifest(writable).some((p) => /escrita/.test(p)));
  const id = '1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789abcdefghijklmnopq';
  assert.equal(parseScriptId(id), id);
  assert.equal(parseScriptId('  ' + id + '\n'), id);
  assert.equal(parseScriptId('https://script.google.com/home/projects/' + id + '/edit'), id);
  assert.equal(parseScriptId('https://script.google.com/d/' + id + '/edit?usp=sharing'), id);
  assert.equal(parseScriptId('inbox-intelligence-512713'), null, 'ID do projeto Cloud não é ID do script');
  assert.equal(parseScriptId('abc"; rm -rf /'), null);
});

test('gas:push: publica sempre na mesma implantação do Web App, nunca na @HEAD', () => {
  const { pickDeployment, shellArgs, webAppUrl, checkManifest } = require('../scripts/push-gas');
  const head = { deploymentId: 'AKfyHEAD', description: '' };
  assert.equal(pickDeployment([]), null);
  assert.equal(pickDeployment([head]), null, '@HEAD não é atualizada: cria a primeira implantação');
  assert.equal(pickDeployment([head, { deploymentId: 'AKfyManual', versionNumber: 1, description: 'v1' }]), 'AKfyManual', 'adota a única criada à mão');
  assert.equal(pickDeployment([head, { deploymentId: 'A', versionNumber: 1, description: 'v1' }, { deploymentId: 'B', versionNumber: 2, description: 'teste' }]), null, 'várias de outra origem: não adivinha');
  assert.equal(pickDeployment([
    head,
    { deploymentId: 'Old', versionNumber: 2, description: 'Inbox Intelligence abc123 2026-10-25' },
    { deploymentId: 'Other', versionNumber: 9, description: 'teste' },
    { deploymentId: 'New', versionNumber: 5, description: 'Inbox Intelligence def456 2026-10-26' },
  ]), 'New');
  assert.equal(webAppUrl('AKfyX'), 'https://script.google.com/macros/s/AKfyX/exec');
  assert.deepEqual(shellArgs(['--description', 'Inbox Intelligence abc 2026-10-25'], 'linux'), ['--description', 'Inbox Intelligence abc 2026-10-25']);
  assert.deepEqual(shellArgs(['--description', 'Inbox Intelligence abc 2026-10-25'], 'win32'), ['--description', '"Inbox Intelligence abc 2026-10-25"']);
  const runAsVisitor = JSON.parse(JSON.stringify(manifest));
  runAsVisitor.webapp.executeAs = 'USER_ACCESSING';
  assert.ok(checkManifest(runAsVisitor).some((p) => /executa como você/.test(p)));
});

test('fuso: só o manifesto define (America/Sao_Paulo só como padrão no Util e no cliente)', () => {
  const html = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.html'));
  const files = jsFiles.concat(html);
  const withTz = files.filter((f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8').includes('America/Sao_Paulo'));
  assert.deepEqual(withTz.sort(), ['Util.js', 'client.html']);
  assert.equal((src['Util.js'].match(/America\/Sao_Paulo/g) || []).length, 1, 'Util: só o DEFAULT_TZ');
});

test('hosts externos usados no código ⊆ urlFetchWhitelist', () => {
  const allowed = manifest.urlFetchWhitelist;
  const urls = new Set();
  for (const code of Object.values(src)) {
    for (const m of code.matchAll(/['"](https:\/\/[a-z0-9.-]+\/)[^'"]*['"]/gi)) urls.add(m[1]);
  }
  const fetched = [...urls].filter((u) => !/mail\.google\.com|googleapis\.com\/auth/.test(u));
  for (const u of fetched) assert.ok(allowed.some((a) => u.startsWith(a)), 'host fora da whitelist: ' + u);
  assert.ok(src['AiClient.js'].includes('https://api.anthropic.com/'));
});

test('sintaxe ES2019 (sem ?. ?? classes privadas import/export) e sem segredos no código', () => {
  for (const [f, code] of Object.entries(src)) {
    const noStrings = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
    assert.ok(!/\?\.[A-Za-z_(\[]/.test(noStrings), f + ': optional chaining');
    assert.ok(!/\?\?/.test(noStrings), f + ': nullish coalescing');
    assert.ok(!/^\s*(import|export)\s/m.test(noStrings), f + ': módulos ES');
    assert.ok(!/(sk-ant-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[A-Za-z0-9_-]{10,})/.test(code), f + ': possível segredo no código');
  }
});

test('logs não recebem conteúdo: Monitoring.log só com campos primitivos e nunca subject/body', () => {
  for (const [f, code] of Object.entries(src)) {
    for (const m of code.matchAll(/Monitoring\.log\([^;]*\);/g)) {
      assert.ok(!/subject|body|snippet|excerpt|from_email|from_name|summary/.test(m[0]), f + ': log com possível conteúdo: ' + m[0]);
    }
    assert.ok(!/console\.(log|warn|error)\((?!JSON\.stringify\((r|report|line)\b)/.test(code.replace(/Monitoring\.js[\s\S]*/, '')) || f === 'Monitoring.js' || f === 'Code.js', f + ': console.* direto');
  }
});

test('SQL do catálogo é parametrizado: nenhuma concatenação de variáveis em consultas', () => {
  const repo = src['Repository.js'];
  const catalog = repo.slice(repo.indexOf('var QUERIES = {'), repo.indexOf('function render('));
  // Só literais e a constante TZ podem ser concatenados no catálogo.
  const concats = [...catalog.matchAll(/\+\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\+/g)].map((m) => m[1]).filter((v) => v !== 'TZ');
  assert.deepEqual(concats, []);
});
