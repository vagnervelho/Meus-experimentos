"""Valida todo o SQL gerado pelo código (sqlglot, dialeto BigQuery).

1. Sintaxe: DDL, renovações, views e o catálogo de consultas do Repository.
2. Semântica: resolve TODAS as colunas referenciadas contra o schema das
   tabelas (src/Schema.js) e das views (colunas inferidas em ordem), sem
   executar nada — pega coluna inexistente, alias errado e CTE inconsistente.
3. Regras do projeto: sem SELECT * no catálogo de consultas.
"""
import json
import re
import subprocess
import sys

import sqlglot
from sqlglot.errors import ParseError
from sqlglot.optimizer.qualify import qualify

raw = subprocess.run(['node', 'scripts/export-sql.js', '--write-docs', '--with-schema'], capture_output=True, text=True, check=True).stdout
data = json.loads(raw)
items = data['items']
project, dataset = data['project'], data['dataset']
schema = {project: {dataset: {name: dict(cols) for name, cols in data['tables'].items()}}}
errors = []
semantic = 0


def check(expression, name):
    global semantic
    try:
        q = qualify(expression, schema=schema, dialect='bigquery', validate_qualify_columns=True, quote_identifiers=False)
        semantic += 1
        return q
    except Exception as e:  # noqa: BLE001 — qualquer falha de resolução é erro de validação
        errors.append(f'{name}: {str(e)[:300]}')
        return None


for it in items:
    name, sql = it['name'], it['sql']
    try:
        parsed = sqlglot.parse(sql, read='bigquery')
    except ParseError as e:
        errors.append(f'{name}: {str(e)[:400]}')
        continue
    if not parsed or parsed[0] is None:
        errors.append(f'{name}: vazio')
        continue
    e = parsed[0]
    if name.startswith('query/') and re.search(r'SELECT\s+\*', sql, re.I):
        errors.append(f'{name}: SELECT * proibido em consultas de produção')
    if name.startswith('view/'):
        # Views em ordem de dependência: as colunas inferidas entram no schema para as próximas.
        q = check(e.expression.copy(), name)
        view_name = e.this.name if hasattr(e.this, 'name') else name.split('/')[1]
        schema[project][dataset][view_name] = {c: 'STRING' for c in (q.named_selects if q else [])}
    elif name.startswith('query/'):
        check(e, name)
    elif name.startswith('renew/'):
        check(e.expression.copy(), name)

print(f'{len(items)} instruções SQL analisadas; {semantic} com todas as colunas resolvidas')
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print('SQL OK (dialeto BigQuery, sintaxe e colunas)')
