'use strict';
/**
 * Exporta todo o SQL gerado pelo código (DDL, views, renovações e o catálogo
 * de consultas do Repository) para validação estática e para a pasta sql/
 * (documentação). Uso: node scripts/export-sql.js [--write-docs]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createGas } = require('../tests/harness');

const gas = createGas();
gas.props.script.setProperty('GCP_PROJECT_ID', 'meu-projeto');
const G = gas.G;
const out = [];
const renewOpts = { retentionDays: 30, horizonMonths: 12, runsDays: 90, briefingsDays: 60 };
const viewOpts = { retentionDays: 30, criticalCap: 3, criticalRecencyDays: 7, openDaysWithoutDeadline: 14, overdueAutoResolveDays: 3 };
for (const t of G.Schema.TABLES) {
  out.push({ name: 'ddl/' + t.name, sql: G.Schema.createTableSql(t.name, 1) });
  out.push({ name: 'renew/' + t.name, sql: G.Schema.renewSql(t.name, 1, 2, renewOpts) });
  out.push({ name: 'drop/' + t.name, sql: G.Schema.dropTableSql(t.name, 1) });
}
for (const v of G.Schema.allViewStatements(1, viewOpts)) out.push({ name: 'view/' + v.name, sql: v.sql });
if (G.Repository && G.Repository.QUERIES) {
  for (const [k, sql] of Object.entries(G.Repository.QUERIES)) out.push({ name: 'query/' + k, sql: G.Repository.render(sql) });
}
if (process.argv.includes('--write-docs')) {
  const dir = path.join(__dirname, '..', 'sql');
  fs.mkdirSync(dir, { recursive: true });
  const groups = {};
  for (const s of out) {
    const g = s.name.split('/')[0];
    (groups[g] = groups[g] || []).push(s);
  }
  const header = '-- Gerado por scripts/export-sql.js a partir de src/Schema.js e src/Repository.js.\n-- Não edite à mão: a fonte da verdade é o código. Projeto de exemplo: meu-projeto.\n\n';
  for (const [g, list] of Object.entries(groups)) {
    fs.writeFileSync(path.join(dir, g + '.sql'), header + list.map((s) => '-- ' + s.name + '\n' + s.sql + ';\n').join('\n'));
  }
}
if (process.argv.includes('--with-schema')) {
  const tables = {};
  for (const t of G.Schema.TABLES) for (const g of [1, 2]) tables[t.name + '__g' + g] = Object.fromEntries(t.columns.map((c) => [c[0], c[1]]));
  process.stdout.write(JSON.stringify({ items: out, tables, project: 'meu-projeto', dataset: G.Config.datasetId() }));
} else {
  process.stdout.write(JSON.stringify(out));
}
