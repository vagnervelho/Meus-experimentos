#!/usr/bin/env node
'use strict';
/**
 * Mede o tempo dos comandos da base de demonstração (TestRunner, TEST_PLAN = DEMO: 430 comandos de três anos de rebanho na Fase 3)
 * no harness de testes, e quanto dele fica na trava de integridade da UnitOfWork (AuditService.travar).
 *
 * Uso: node scripts/medir-trava.js [raiz do projeto] [--vezes N]
 *   raiz: a pasta com src/ e tests/ (padrão: este projeto). Para a medida "sem a trava", rode com uma cópia do projeto de
 *   antes da trava (git worktree do commit anterior) e compare as somas.
 *   --vezes N: repete a base N vezes (harness novo a cada vez) e dá a mediana (o tempo no Node varia de uma execução a outra).
 * Saída: uma linha JSON por execução e o resumo {soma_comandos_ms, media_ms, p50_ms, p95_ms, trava_ms} (medianas).
 * É CPU do Node sobre a planilha falsa: a leitura das abas no Google Sheets não entra (o comando de evento já lê todas as
 * abas que a trava confere; só a correção de categoria e de parâmetro e o cadastro de animal de referência leem mais).
 */
const path = require('node:path');

const args = process.argv.slice(2);
const iVezes = args.indexOf('--vezes');
const vezes = iVezes >= 0 ? Math.max(1, Number(args[iVezes + 1]) || 1) : 1;
const posicionais = args.filter((a, i) => iVezes < 0 || (i !== iVezes && i !== iVezes + 1));
const raiz = path.resolve(posicionais[0] || path.join(__dirname, '..'));

function medirUmaVez() {
  const S = require(path.join(raiz, 'tests', 'apoio-sistema'));
  const s = S.sistema();
  const G = s.G;
  s.gas.props.script.setProperty('TEST_PLAN', 'DEMO');
  const tempos = [];
  const run = G.UnitOfWork.run;
  G.UnitOfWork.run = function (ctx, cmd) {
    const t0 = process.hrtime.bigint();
    try {
      return run.call(this, ctx, cmd);
    } finally {
      if (!cmd || cmd.modo !== 'SIMULAR') tempos.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  };
  let travaMs = 0;
  if (G.AuditService.travar) {
    const travar = G.AuditService.travar;
    G.AuditService.travar = function (t) {
      const t0 = process.hrtime.bigint();
      try { return travar.call(this, t); } finally { travaMs += Number(process.hrtime.bigint() - t0) / 1e6; }
    };
  }
  const rel = JSON.parse(JSON.stringify(s.gas.exec(() => G.runAcceptanceTests())));
  if (!rel.ok) throw new Error('a base de demonstração não fechou: ' + JSON.stringify(rel).slice(0, 400));
  const ord = tempos.slice().sort((a, b) => a - b);
  const soma = tempos.reduce((a, b) => a + b, 0);
  const pct = (p) => ord[Math.min(ord.length - 1, Math.floor(p * ord.length))];
  return {
    comandos: tempos.length, soma_comandos_ms: Math.round(soma), media_ms: +(soma / tempos.length).toFixed(1),
    p50_ms: +pct(0.5).toFixed(1), p95_ms: +pct(0.95).toFixed(1), trava_ms: Math.round(travaMs), cabecas: rel.demonstracao.cabecas,
  };
}
function mediana(lista) {
  const o = lista.slice().sort((a, b) => a - b);
  return o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
}

const execucoes = [];
for (let i = 0; i < vezes; i++) {
  // Cada execução num módulo novo do harness (o vm carrega src/ de novo).
  Object.keys(require.cache).forEach((k) => { if (k.startsWith(path.join(raiz, 'tests'))) delete require.cache[k]; });
  const r = medirUmaVez();
  execucoes.push(r);
  console.log(JSON.stringify(Object.assign({ execucao: i + 1 }, r)));
}
const resumo = { raiz, vezes, comandos: execucoes[0].comandos };
['soma_comandos_ms', 'media_ms', 'p50_ms', 'p95_ms', 'trava_ms'].forEach((k) => { resumo[k] = mediana(execucoes.map((e) => e[k])); });
console.log(JSON.stringify({ resumo }));
