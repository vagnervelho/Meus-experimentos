'use strict';
/**
 * Análise estática da interface: segurança de DOM, recursos externos, scriptlets e tamanho.
 * Regras em tests/ui/static-rules.js (também executadas por `npm run ui:check`).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkFiles, selfTest, MAX_TOTAL_BYTES } = require('./ui/static-rules');

test('regras estáticas detectam os padrões proibidos (autoteste)', () => {
  assert.deepEqual(selfTest(), []);
});

test('src/index.html, styles.html e client.html não violam as regras de segurança', () => {
  const { violations } = checkFiles();
  const msg = violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.why}${v.snippet ? ' — ' + v.snippet : ''}`).join('\n');
  assert.equal(violations.length, 0, msg);
});

test('os três arquivos da interface cabem no orçamento de tamanho', () => {
  const { total, sizes } = checkFiles();
  assert.ok(total <= MAX_TOTAL_BYTES, `total ${total} > ${MAX_TOTAL_BYTES}: ${JSON.stringify(sizes)}`);
});

test('a análise acusa violações reais quando injetadas', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const real = (n) => fs.readFileSync(path.join(__dirname, '..', 'src', n), 'utf8');
  const tampered = (n) => n === 'client.html' ? real(n).replace("box.textContent = '';", "box.innerHTML = data.html;") : n === 'index.html' ? real(n).replace('</head>', '<link rel="stylesheet" href="https://cdn.example/x.css"><?= user ?></head>') : real(n);
  const rules = new Set(checkFiles(tampered).violations.map((v) => v.rule));
  for (const r of ['innerHTML-com-valor', 'stylesheet-externo', 'href-externo', 'scriptlet']) assert.ok(rules.has(r), 'esperava ' + r);
});
