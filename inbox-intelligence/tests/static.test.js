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
  assert.equal(manifest.timeZone, 'America/Sao_Paulo');
  const services = manifest.dependencies.enabledAdvancedServices.map((s) => s.serviceId).sort();
  assert.deepEqual(services, ['bigquery', 'gmail']);
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
