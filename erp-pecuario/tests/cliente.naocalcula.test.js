'use strict';
/**
 * Regra "o cliente não calcula" (desenho-base, seções 16 e 17; CONTRATOS, seção 51): o código do aparelho (os `<script>` de
 * `src/*.html`) não faz aritmética de data (somar dias, diferença de datas, próxima aplicação, vencimento, carência, idade) nem
 * conta com número de domínio (GMD, ganho, UA, idade, dias, centavos e totais em dinheiro, peso, dose, custo, quantidade,
 * saldo, taxa, média, cabeças). O número e a data vêm prontos do servidor, num campo ou numa rota.
 *
 * O leitor (`tests/apoio-naocalcula.js`) acusa o que parece conta; o que é só formatação ou desenho fica numa lista CURTA,
 * por arquivo e função, cada entrada com o porquê. O teste falha quando aparece conta fora da lista e quando uma entrada da
 * lista deixa de ser usada (a lista não cresce calada nem fica velha).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('./apoio-naocalcula');

/**
 * O que pode ficar: só formatação, leitura do que foi digitado, desenho do gráfico e carimbo do aparelho. {arquivo, funcao
 * (um nome da cadeia de funções), regras, porque}.
 */
const PERMITIDOS = [
  { arquivo: 'JavaScript.html', funcao: 'ajustarRelogio', regras: ['DATA'], porque: 'o desvio do relógio do aparelho para o do servidor: o "hoje" é o do servidor (08, seção 4.3), não uma data do rebanho' },
  { arquivo: 'JavaScript.html', funcao: 'partes_', regras: ['DATA'], porque: 'formatação: um instante em ano, mês, dia, hora e minuto no fuso da fazenda (Intl)' },
  { arquivo: 'JavaScript.html', funcao: 'instante', regras: ['DATA'], porque: 'formatação de um instante (dd/mm/aaaa hh:mm), com a volta para UTC quando o fuso falha' },
  { arquivo: 'JavaScript.html', funcao: 'ehData', regras: ['DATA'], porque: 'leitura do que foi digitado: a data existe no calendário (31/02 não)' },
  { arquivo: 'JavaScript.html', funcao: 'peso', regras: ['NUMERO'], porque: 'formatação: o peso em kg mostrado na unidade escolhida (kg ou @)' },
  { arquivo: 'JavaScript.html', funcao: 'dinheiro', regras: ['NUMERO'], porque: 'formatação: centavos mostrados em reais' },
  { arquivo: 'JavaScript.html', funcao: 'gravarCache_', regras: ['DATA'], porque: 'carimbo de quando o aparelho guardou a cópia local (metadado do aparelho, não dado do rebanho)' },
  { arquivo: 'JavaScript.html', funcao: 'salvar', regras: ['DATA'], porque: 'carimbo de quando o aparelho guardou o rascunho (metadado do aparelho, não dado do rebanho)' },
  { arquivo: 'Components.html', funcao: 'ordenadas', regras: ['NUMERO'], porque: 'ordenação das linhas da tabela (o sinal da direção), não um número mostrado' },
  { arquivo: 'Components.html', funcao: 'barras_', regras: ['NUMERO'], porque: 'desenho: a posição das barras e dos rótulos no SVG, pelos valores do servidor' },
  { arquivo: 'Components.html', funcao: 'curvaPeso', regras: ['DATA', 'NUMERO'], porque: 'desenho: a escala do eixo do gráfico de peso (a posição de cada pesagem e as marcas de data do eixo), pelos pontos do servidor' },
];

function permitido(a) {
  return PERMITIDOS.find((p) => p.arquivo === a.arquivo && p.regras.indexOf(a.regra) >= 0 && a.funcoes.indexOf(p.funcao) >= 0) || null;
}

test('o leitor acusa a conta de data e de número de domínio no código do aparelho, e não a formatação (autoteste)', () => {
  const html = [
    '<div>texto</div>',
    '<script>',
    'var Tela = (function () {',
    '  // a próxima aplicação somada no aparelho (o caso da prévia da correção da sanidade)',
    '  function previa(p) { return Fmt.data(new Date(Date.parse(p.data_aplicacao + "T00:00:00Z") + p.intervalo_dias * 86400000).toISOString().slice(0, 10)); }',
    '  function gmd(a, b, dias) { return (b.peso_kg - a.peso_kg) / dias; }',
    '  function total(l) { return l.reduce(function (t, x) { return t + x.valor_centavos; }, 0); }',
    '  function ano(n) { return Number(n.data_nascimento.slice(0, 4)) + 1; }',
    '  var carencia = function (x) { return x.carencia_dias - 1; };',
    '  function ua(x) { return x.peso / 450; }',
    '  function regex(x) { return /a\\/b/.test(x.nome) ? x.dose_ml * 2 : 0; }',
    '  function rotulo(x) { return x.brinco + " · " + Fmt.peso(x.peso_kg) + " (" + x.dias + (x.dias === 1 ? " dia" : " dias") + ")"; }',
    '  function contagem(c) { return c.linhas.length + c.blocos.length; }',
    '  function pag(r) { return Math.ceil(r.total / r.por_pagina); }',
    '  function modelo(x) { return `${x.peso_kg} kg`; }',
    '  return { previa: previa };',
    '})();',
    '</script>',
  ].join('\n');
  const ach = N.achados('Sintetico.html', html);
  const por = (f) => ach.filter((a) => a.funcoes[a.funcoes.length - 1] === f).map((a) => a.regra);
  assert.ok(por('previa').includes('DATA'), 'a próxima aplicação somada no aparelho');
  assert.deepEqual([...new Set(por('gmd'))], ['NUMERO'], 'o GMD no aparelho');
  assert.ok(por('total').includes('NUMERO'), 'o total em dinheiro no aparelho');
  assert.ok(por('ano').includes('DATA'), 'o ano tirado do texto da data para conta');
  assert.ok(por('carencia').includes('NUMERO'), 'a carência no aparelho (função anônima com nome)');
  assert.ok(por('ua').includes('NUMERO'), 'a UA no aparelho');
  assert.ok(por('regex').includes('NUMERO'), 'a conta depois de uma expressão regular com barra');
  assert.deepEqual(por('rotulo'), [], 'a concatenação do rótulo não é conta');
  assert.deepEqual(por('contagem'), [], 'contar linhas não é número de domínio');
  assert.deepEqual(por('pag'), [], 'a paginação conta linhas');
  assert.deepEqual(por('modelo'), [], 'o modelo de texto não é conta');
  assert.equal(ach.every((a) => a.arquivo === 'Sintetico.html' && a.linha > 2), true, 'a linha do achado é a do arquivo');
});

test('o código do aparelho (src/*.html) não calcula data nem número de domínio: só a lista curta de formatação e desenho', () => {
  const lista = N.todosOsAchados();
  const fora = lista.filter((a) => !permitido(a));
  assert.deepEqual(fora.map((a) => a.regra + ' ' + a.arquivo + ':' + a.linha + ' [' + a.funcoes.join(' > ') + '] ' + a.extra + ' — ' + a.trecho), [],
    'conta no aparelho: o número ou a data devem vir do servidor (rota ou campo; CONTRATOS, seção 51)');
  const usados = new Set(lista.map((a) => PERMITIDOS.indexOf(permitido(a))));
  const velhos = PERMITIDOS.filter((p, i) => !usados.has(i));
  assert.deepEqual(velhos.map((p) => p.arquivo + ' ' + p.funcao), [], 'entrada da lista que não é mais usada: tire-a');
  assert.ok(PERMITIDOS.length <= 12, 'a lista é curta');
  PERMITIDOS.forEach((p) => assert.ok(p.porque.length > 20, 'cada entrada diz por que pode ficar: ' + p.funcao));
});

test('os casos que começaram a regra: a prévia da correção, a agenda e as parcelas não fazem conta no aparelho', () => {
  const lista = N.todosOsAchados();
  ['Events.html', 'Health.html', 'Weights.html', 'Reproduction.html', 'Animals.html', 'Pastures.html', 'Dashboard.html', 'Import.html', 'Settings.html'].forEach((arq) => {
    assert.deepEqual(lista.filter((a) => a.arquivo === arq).map((a) => a.linha + ' ' + a.extra), [], arq + ' não faz conta');
  });
  // Os vencimentos do "Dividir em parcelas" e a diferença de datas saíram do aparelho.
  assert.equal(lista.some((a) => a.funcoes.indexOf('vencimentos') >= 0 || a.funcoes.indexOf('diasEntre') >= 0), false);
});
