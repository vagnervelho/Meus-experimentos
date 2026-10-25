#!/usr/bin/env node
'use strict';
/**
 * Envia src/ para o projeto Apps Script com o clasp (versão fixa, via npx; não precisa de npm install).
 *
 * Uso: npm run gas:push -- <ID do script ou URL do editor>   (primeira vez)
 *      npm run gas:push                                       (depois: o ID fica em .clasp.json, fora do git)
 *      --yes pula a confirmação.
 *
 * Antes de enviar: confere a versão do Node, confere se src/appsscript.json é o manifesto do projeto
 * (escopos, serviços avançados, Web App só para você) e mostra a conta logada no clasp.
 * Não usa "clasp create" nem "clasp pull": os dois gravam o manifesto padrão por cima do nosso.
 */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLASP = '@google/clasp@3.4.1';
const CLASP_FILE = path.join(ROOT, '.clasp.json');
const MANIFEST = path.join(ROOT, 'src', 'appsscript.json');
// IDs de script são IDs do Drive (44 ou 57 caracteres). IDs de projeto do Google Cloud têm no máximo 30.
const ID_RE = /^[A-Za-z0-9_-]{40,100}$/;
const GCP_PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** Aceita o ID puro ou a URL do editor (.../d/<ID>/edit ou .../projects/<ID>/edit). */
function parseScriptId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/(?:d|projects)\/([A-Za-z0-9_-]{40,100})(?:[/?#]|$)/);
  const id = m ? m[1] : s;
  return ID_RE.test(id) ? id : null;
}

/** Lista o que falta no manifesto para ser o deste projeto (vazio = ok). */
function checkManifest(m) {
  const problems = [];
  const scopes = (m && m.oauthScopes) || [];
  if (scopes.indexOf('https://www.googleapis.com/auth/gmail.readonly') < 0) problems.push('sem o escopo gmail.readonly');
  if (scopes.some((s) => /\/auth\/gmail\.(?!readonly$)|mail\.google\.com/.test(s))) problems.push('com escopo de escrita no Gmail');
  const services = ((m && m.dependencies && m.dependencies.enabledAdvancedServices) || []).map((s) => s.serviceId);
  for (const id of ['gmail', 'bigquery']) if (services.indexOf(id) < 0) problems.push('sem o serviço avançado ' + id);
  if (!m || !m.webapp || m.webapp.access !== 'MYSELF') problems.push('Web App não restrito a "Somente eu"');
  if (!m || m.runtimeVersion !== 'V8') problems.push('runtime diferente de V8');
  return problems;
}

function fail(msg, code) {
  console.error('\n' + msg);
  process.exit(code === undefined ? 1 : code);
}

function clasp(args, capture) {
  const r = spawnSync('npx', ['--yes', CLASP].concat(args), {
    cwd: ROOT,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.error) fail('Não consegui executar o npx (' + r.error.message + '). O Node está instalado?');
  return r;
}

function authorizedUser() {
  const r = clasp(['show-authorized-user', '--json'], true);
  try { return JSON.parse(r.stdout); } catch (e) { return { loggedIn: false }; }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  // O package.json do clasp aceita Node 20, mas o README dele pede 22 ou mais novo.
  if (major < 22) fail('O clasp 3 precisa do Node 22 ou mais novo (este é o ' + process.version + ').');

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { fail('Não consegui ler src/appsscript.json: ' + e.message); }
  const problems = checkManifest(manifest);
  if (problems.length) fail('src/appsscript.json não é o manifesto do projeto (' + problems.join('; ') + ').\nRestaure com: git checkout -- src/appsscript.json');

  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  let scriptId;
  if (arg) {
    scriptId = parseScriptId(arg);
    if (!scriptId && GCP_PROJECT_RE.test(arg.trim())) fail('"' + arg.trim() + '" parece o ID do projeto do Google Cloud: ele vai na propriedade GCP_PROJECT_ID.\nAqui é o ID do script, no editor do Apps Script: Configurações do projeto → IDs → ID do script.');
    if (!scriptId) fail('ID do script inválido: ' + arg + '\nNo editor do Apps Script: Configurações do projeto → IDs → ID do script.');
    fs.writeFileSync(CLASP_FILE, JSON.stringify({ scriptId: scriptId, rootDir: 'src' }, null, 2) + '\n');
  } else {
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(CLASP_FILE, 'utf8')); } catch (e) { cfg = null; }
    if (!cfg || !ID_RE.test(String(cfg.scriptId || ''))) fail('Na primeira vez, informe o ID do script: npm run gas:push -- <ID do script>');
    if (path.resolve(ROOT, cfg.rootDir || '.') !== path.join(ROOT, 'src')) fail('.clasp.json precisa de "rootDir": "src".');
    scriptId = cfg.scriptId;
  }

  let who = authorizedUser();
  if (!who.loggedIn) {
    console.log('\nLogin no clasp. Abra o link abaixo e autorize com a conta Google cuja caixa será analisada.');
    console.log('No fim, o navegador mostra um erro de conexão em "localhost": é esperado. Copie a URL inteira da barra de endereço e cole aqui.\n');
    if (clasp(['login', '--no-localhost']).status !== 0) fail('O login não terminou.');
    who = authorizedUser();
    if (!who.loggedIn) fail('O login não terminou.');
  }

  console.log('\nConta:   ' + (who.email || '(desconhecida)'));
  console.log('Projeto: https://script.google.com/d/' + scriptId + '/edit');
  if (process.stdin.isTTY && process.argv.indexOf('--yes') < 0) {
    const answer = await ask('Enviar src/ para esse projeto, substituindo todos os arquivos dele? [s/N] ');
    if (!/^s(im)?$/i.test(answer.trim())) fail('Nada foi enviado.', 0);
  }

  if (clasp(['push', '--force']).status !== 0) {
    fail('O envio falhou. Se a mensagem fala em "Apps Script API", ative a API em https://script.google.com/home/usersettings, espere alguns minutos e rode de novo.');
  }

  console.log('\nPronto. Próximos passos no editor (link acima):');
  console.log('  1. Configurações do projeto → Propriedades do script → GCP_PROJECT_ID = ID do projeto do BigQuery');
  console.log('  2. Editor → escolha a função setup → Executar → autorize');
  console.log('  3. Implantar → Nova implantação → App da Web (Executar como: eu · Quem pode acessar: somente eu)');
  console.log('  4. Execute diagnose() e guarde o resultado');
}

if (require.main === module) main();

module.exports = { parseScriptId, checkManifest };
