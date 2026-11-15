/**
 * Utils — funções puras de data, dinheiro, texto, JSON canônico e coleções.
 *
 * Regras da casa (P6): data é texto `yyyy-MM-dd`; instante é texto ISO-8601 em UTC; dinheiro é inteiro em
 * centavos na lógica. Nada aqui lê o relógio nem chama serviço do Apps Script: o instante e a porta de hash
 * chegam por parâmetro. Entrada malformada é erro de quem chamou e lança exceção; nunca é "consertada" em silêncio.
 */
var Utils = (function () {
  'use strict';

  var MS_DIA = 86400000;
  var RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
  var RE_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  var LIMITE_BASE = 4503599627370496; // 2^52: teto da soma das bases do rateio, na escala inteira
  var ESCALA_BASE = 10000; // bases com até 4 casas (DEC4)
  var formatadores = {};

  function falha_(code, mensagem) {
    return Validation.erro(code, mensagem);
  }
  function vazio(v) {
    return v === null || v === undefined || v === '';
  }

  // ------------------------------------------------------------------ datas ----
  function partesData_(s) {
    if (typeof s !== 'string') return null;
    var m = RE_DATA.exec(s);
    if (!m) return null;
    var a = Number(m[1]);
    var mes = Number(m[2]);
    var d = Number(m[3]);
    if (a < 1 || mes < 1 || mes > 12 || d < 1) return null;
    var ultimo = new Date(Date.UTC(a, mes, 0)).getUTCDate();
    if (d > ultimo) return null;
    return { ano: a, mes: mes, dia: d };
  }
  /** true se `s` é uma data de calendário real no formato yyyy-MM-dd (2026-02-30 não é). */
  function dataValida(s) {
    return partesData_(s) !== null;
  }
  function exigirData_(s, nome) {
    var p = partesData_(s);
    if (!p) throw falha_('INTERNAL', 'Data inválida em ' + nome + ': ' + JSON.stringify(s) + ' (esperado yyyy-MM-dd).');
    return p;
  }
  function serial_(p) {
    var d = new Date(0);
    d.setUTCFullYear(p.ano, p.mes - 1, p.dia);
    return Math.round(d.getTime() / MS_DIA);
  }
  function dois_(n) {
    return n < 10 ? '0' + n : String(n);
  }
  function deSerial_(n) {
    var d = new Date(n * MS_DIA);
    var a = String(d.getUTCFullYear());
    while (a.length < 4) a = '0' + a;
    return a + '-' + dois_(d.getUTCMonth() + 1) + '-' + dois_(d.getUTCDate());
  }
  /** Dias de `de` até `ate` (positivo quando `ate` é posterior). */
  function diffDias(de, ate) {
    return serial_(exigirData_(ate, 'diffDias')) - serial_(exigirData_(de, 'diffDias'));
  }
  /** Data `n` dias depois (ou antes, se negativo). */
  function somaDias(data, n) {
    if (typeof n !== 'number' || Math.floor(n) !== n) throw falha_('INTERNAL', 'somaDias espera um número inteiro de dias.');
    return deSerial_(serial_(exigirData_(data, 'somaDias')) + n);
  }
  /** -1, 0 ou 1. Datas yyyy-MM-dd válidas ordenam como texto. */
  function compararDatas(a, b) {
    exigirData_(a, 'compararDatas');
    exigirData_(b, 'compararDatas');
    return a < b ? -1 : a > b ? 1 : 0;
  }
  /**
   * Idade em meses completos na data `naData` (03a, seção 4.5): (ano − ano) × 12 + (mês − mês), menos 1 se o
   * dia de `naData` for menor que o dia do nascimento. Negativa quando `naData` é anterior ao nascimento.
   */
  function idadeMeses(nascimento, naData) {
    var n = exigirData_(nascimento, 'idadeMeses');
    var d = exigirData_(naData, 'idadeMeses');
    return (d.ano - n.ano) * 12 + (d.mes - n.mes) - (d.dia < n.dia ? 1 : 0);
  }
  function instanteMs_(instante) {
    if (typeof instante === 'number' && isFinite(instante)) return instante;
    if (typeof instante === 'string' && RE_INSTANTE.test(instante)) {
      var ms = Date.parse(instante);
      if (!isNaN(ms)) return ms;
    }
    throw falha_('INTERNAL', 'Instante inválido: ' + JSON.stringify(instante) + ' (esperado ISO-8601 UTC ou milissegundos).');
  }
  /** true se `s` é um instante ISO-8601 em UTC com milissegundos e Z (2026-11-14T01:30:00.000Z). */
  function instanteValido(s) {
    return typeof s === 'string' && RE_INSTANTE.test(s) && !isNaN(Date.parse(s)) && new Date(Date.parse(s)).toISOString() === s;
  }
  /** Texto ISO-8601 UTC de um instante em milissegundos. */
  function instanteIso(ms) {
    return new Date(instanteMs_(ms)).toISOString();
  }
  /**
   * Data de calendário (yyyy-MM-dd) de um instante no fuso IANA informado. O instante vem da porta Clock:
   * às 21:30 de 13/11/2026 em Porto Velho, `hoje('2026-11-14T01:30:00.000Z', 'America/Porto_Velho')` = 2026-11-13.
   */
  function hoje(instante, fuso) {
    var ms = instanteMs_(instante);
    if (typeof fuso !== 'string' || fuso === '') throw falha_('CONFIG', 'Fuso horário não informado. Confira a configuração "fuso".');
    var f = formatadores[fuso];
    if (!f) {
      try {
        f = new Intl.DateTimeFormat('en-US', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' });
      } catch (e) {
        throw falha_('CONFIG', 'Fuso horário desconhecido: "' + fuso + '". Use um nome como America/Porto_Velho.');
      }
      formatadores[fuso] = f;
    }
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var ano = String(p.year);
    while (ano.length < 4) ano = '0' + ano;
    return ano + '-' + p.month + '-' + p.day;
  }
  /** true se `data` está em [inicio, fim], limites inclusivos; limite vazio = aberto. */
  function dentroDoIntervalo(data, inicio, fim) {
    exigirData_(data, 'dentroDoIntervalo');
    if (!vazio(inicio) && compararDatas(data, inicio) < 0) return false;
    if (!vazio(fim) && compararDatas(data, fim) > 0) return false;
    return true;
  }
  /** Dias de um intervalo fechado, contando os dois limites (01/11 a 30/11 = 30). */
  function diasNoIntervalo(inicio, fim) {
    var n = diffDias(inicio, fim) + 1;
    if (n < 1) throw falha_('INTERNAL', 'Intervalo invertido: ' + inicio + ' a ' + fim + '.');
    return n;
  }
  /**
   * Interseção de dois intervalos fechados [inicioA, fimA] e [inicioB, fimB]; limite vazio = aberto.
   * Devolve {inicio, fim, dias} (dias = null se a interseção é aberta) ou null quando não se tocam.
   */
  function intersecaoIntervalos(inicioA, fimA, inicioB, fimB) {
    [inicioA, fimA, inicioB, fimB].forEach(function (d) { if (!vazio(d)) exigirData_(d, 'intersecaoIntervalos'); });
    if (!vazio(inicioA) && !vazio(fimA) && inicioA > fimA) throw falha_('INTERNAL', 'Intervalo invertido: ' + inicioA + ' a ' + fimA + '.');
    if (!vazio(inicioB) && !vazio(fimB) && inicioB > fimB) throw falha_('INTERNAL', 'Intervalo invertido: ' + inicioB + ' a ' + fimB + '.');
    var inicio = vazio(inicioA) ? (vazio(inicioB) ? null : inicioB) : (vazio(inicioB) || inicioA >= inicioB ? inicioA : inicioB);
    var fim = vazio(fimA) ? (vazio(fimB) ? null : fimB) : (vazio(fimB) || fimA <= fimB ? fimA : fimB);
    if (inicio !== null && fim !== null && inicio > fim) return null;
    return { inicio: inicio, fim: fim, dias: inicio !== null && fim !== null ? diffDias(inicio, fim) + 1 : null };
  }

  // ------------------------------------------------------------------ números e dinheiro ----
  /** Arredonda "meio para cima" (longe do zero) sobre o valor decimal informado: 387,45 com 1 casa = 387,5. */
  function arredondar(valor, casas) {
    if (typeof valor !== 'number' || !isFinite(valor)) throw falha_('INTERNAL', 'arredondar espera um número.');
    var f = Math.pow(10, casas || 0);
    var abs = Math.abs(valor) * f;
    var r = Math.round(Number(abs.toFixed(6))) / f;
    return valor < 0 && r !== 0 ? -r : r;
  }
  /**
   * Quantas casas decimais o número realmente usa (387.5 → 1; 0.02 → 2), lido com 15 algarismos significativos
   * para o ruído binário não contar (0.1 + 0.2 → 1).
   */
  function casasDecimais(valor) {
    if (typeof valor !== 'number' || !isFinite(valor)) throw falha_('INTERNAL', 'casasDecimais espera um número.');
    var abs = Math.abs(valor);
    if (abs >= 1e15 || Math.floor(abs) === abs) return 0;
    var s = abs.toPrecision(15);
    var exp = /^(\d)(?:\.(\d+))?e-(\d+)$/.exec(s);
    if (exp) return Number(exp[3]) + (exp[2] || '').replace(/0+$/, '').length;
    s = s.replace(/0+$/, '');
    return s.length - s.indexOf('.') - 1;
  }
  /** Reais (número com até 2 casas, como na planilha) → centavos inteiros. Vazio → null. */
  function reaisParaCentavos(reais) {
    if (vazio(reais)) return null;
    if (typeof reais !== 'number' || !isFinite(reais)) throw falha_('INTERNAL', 'Valor em reais inválido: ' + JSON.stringify(reais) + '.');
    var c = arredondar(reais * 100, 0);
    if (Math.abs(c) > 9007199254740991) throw falha_('VALIDATION', 'Valor em reais grande demais para o sistema.');
    return c;
  }
  /**
   * Maior valor em centavos (em módulo) que vai à planilha e volta exato: 15 dígitos, a precisão de número da
   * planilha. Acima disso, reais com 2 casas em ponto flutuante perdem o último centavo na volta.
   */
  var CENTAVOS_MAX = 999999999999999;
  /** Centavos inteiros → reais com 2 casas (valor de célula). Vazio → null. */
  function centavosParaReais(centavos) {
    if (vazio(centavos)) return null;
    if (typeof centavos !== 'number' || Math.floor(centavos) !== centavos) throw falha_('INTERNAL', 'Valor em centavos inválido: ' + JSON.stringify(centavos) + '.');
    return centavos / 100;
  }
  /** "R$ 1.234,56" a partir de centavos, para mensagens ao usuário. */
  function formatarReais(centavos) {
    if (typeof centavos !== 'number' || Math.floor(centavos) !== centavos) throw falha_('INTERNAL', 'Valor em centavos inválido: ' + JSON.stringify(centavos) + '.');
    var abs = Math.abs(centavos);
    var inteiro = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (centavos < 0 ? '-' : '') + 'R$ ' + inteiro + ',' + dois_(abs % 100);
  }
  /**
   * Número para mensagens ao usuário, no formato brasileiro: '1.234,5' (milhar com ponto, decimal com vírgula).
   * `casas` fixa as casas (arredondando meio para cima); sem ela, as que o número realmente usa (casasDecimais).
   */
  function formatarNumero(valor, casas) {
    if (typeof valor !== 'number' || !isFinite(valor)) throw falha_('INTERNAL', 'formatarNumero espera um número.');
    var c = typeof casas === 'number' ? casas : casasDecimais(valor);
    var v = arredondar(valor, c);
    var partes = Math.abs(v).toFixed(c).split('.');
    var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (v < 0 ? '-' : '') + inteiro + (partes[1] ? ',' + partes[1] : '');
  }
  /** a × b ÷ d em inteiros exatos, sem estourar 2^53: devolve {q, r} com a × b = q × d + r. Exige d < 2^52. */
  function mulDivMod_(a, b, d) {
    var aq = Math.floor(a / d);
    var ar = a % d;
    var q = 0;
    var r = 0;
    var bits = b.toString(2);
    for (var i = 0; i < bits.length; i++) {
      q *= 2;
      r *= 2;
      if (r >= d) { r -= d; q += 1; }
      if (bits.charAt(i) === '1') {
        q += aq;
        r += ar;
        if (r >= d) { r -= d; q += 1; }
      }
    }
    return { q: q, r: r };
  }
  /**
   * Rateio pelo maior resto, em inteiros (03b, seção 13.3). `totalCentavos` é distribuído na proporção das bases.
   * itens: [{chave, base}], base ≥ 0 com até 4 casas. Sobra de centavos: maior resto; em empate, maior base;
   * persistindo, menor `chave` (ordem de texto). O resultado não depende da ordem de entrada.
   * Devolve {itens: [{chave, base, valor}], baseTotal, totalAlocado}, com `itens` na ordem recebida.
   * Base total zero: ninguém recebe (totalAlocado = 0), como manda o dicionário.
   */
  function ratear(totalCentavos, itens) {
    if (typeof totalCentavos !== 'number' || Math.floor(totalCentavos) !== totalCentavos || totalCentavos < 0 || totalCentavos > 9007199254740991) {
      throw falha_('VALIDATION', 'O valor a ratear precisa ser um número inteiro de centavos, não negativo.');
    }
    if (!Array.isArray(itens)) throw falha_('INTERNAL', 'ratear espera a lista de itens {chave, base}.');
    var vistos = {};
    var soma = 0;
    var linhas = itens.map(function (it, i) {
      var chave = it ? it.chave : null;
      if (typeof chave !== 'string' || chave === '') throw falha_('INTERNAL', 'Item ' + (i + 1) + ' do rateio sem chave.');
      if (Object.prototype.hasOwnProperty.call(vistos, chave)) throw falha_('VALIDATION', 'O mesmo item aparece duas vezes no rateio: ' + chave + '.');
      vistos[chave] = true;
      if (typeof it.base !== 'number' || !isFinite(it.base) || it.base < 0) throw falha_('VALIDATION', 'Base de rateio inválida para ' + chave + ': informe um número maior ou igual a zero.');
      if (casasDecimais(it.base) > 4) throw falha_('VALIDATION', 'Base de rateio de ' + chave + ' com mais de 4 casas decimais.');
      var b = Math.round(Number((it.base * ESCALA_BASE).toFixed(2)));
      soma += b;
      if (soma >= LIMITE_BASE) throw falha_('VALIDATION', 'As bases do rateio somam um valor grande demais para o cálculo exato. Divida o lançamento.');
      return { chave: chave, base: it.base, b: b, valor: 0, r: 0 };
    });
    if (soma === 0) {
      return { itens: linhas.map(function (l) { return { chave: l.chave, base: l.base, valor: 0 }; }), baseTotal: 0, totalAlocado: 0 };
    }
    var distribuido = 0;
    linhas.forEach(function (l) {
      var qr = mulDivMod_(totalCentavos, l.b, soma);
      l.valor = qr.q;
      l.r = qr.r;
      distribuido += qr.q;
    });
    var sobra = totalCentavos - distribuido;
    var ordem = linhas.slice().sort(function (x, y) {
      if (x.r !== y.r) return y.r - x.r;
      if (x.b !== y.b) return y.b - x.b;
      return x.chave < y.chave ? -1 : 1;
    });
    for (var k = 0; k < sobra; k++) ordem[k].valor += 1;
    return {
      itens: linhas.map(function (l) { return { chave: l.chave, base: l.base, valor: l.valor }; }),
      baseTotal: arredondar(soma / ESCALA_BASE, 4),
      totalAlocado: totalCentavos,
    };
  }

  // ------------------------------------------------------------------ texto ----
  /** Texto aparado; vazio (null, undefined) vira ''. */
  function aparar(texto) {
    return vazio(texto) ? '' : String(texto).replace(/^\s+|\s+$/g, '');
  }
  /**
   * Forma canônica de brinco e de código de identificação (03a, DL-04): apara, põe em maiúsculas, remove os
   * espaços internos e, se sobrarem só dígitos, tira os zeros à esquerda (mantendo um dígito): "␣0012␣" → "12";
   * "br 07" → "BR07"; "A-0012" → "A-0012"; "000" → "0". Com `manterZeros`, para no passo 3 ("0012" fica "0012").
   */
  function normalizarBrinco(texto, manterZeros) {
    var s = aparar(texto).toUpperCase().replace(/\s+/g, '');
    if (!manterZeros && /^\d+$/.test(s)) s = s.replace(/^0+(?=\d)/, '');
    return s;
  }
  /** Chave de busca e de comparação de nomes: sem acento, minúsculas, espaços internos reduzidos a um. */
  function normalizarTexto(texto) {
    return aparar(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
  }

  // ------------------------------------------------------------------ JSON canônico e hash ----
  function canonico_(v, caminho) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'string') return JSON.stringify(v);
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'number') {
      if (!isFinite(v)) throw falha_('VALIDATION', 'Número inválido nos dados enviados (' + caminho + ').');
      return JSON.stringify(v);
    }
    if (t !== 'object' || Object.prototype.toString.call(v) === '[object Date]') {
      throw falha_('VALIDATION', 'Tipo de dado não aceito nos dados enviados (' + caminho + '): use texto, número, sim/não, lista ou objeto.');
    }
    if (Array.isArray(v)) {
      return '[' + v.map(function (x, i) { return canonico_(x === '' ? null : x, caminho + '[' + i + ']'); }).join(',') + ']';
    }
    var partes = [];
    Object.keys(v).sort().forEach(function (k) {
      if (vazio(v[k])) return;
      partes.push(JSON.stringify(k) + ':' + canonico_(v[k], caminho + '.' + k));
    });
    return '{' + partes.join(',') + '}';
  }
  /**
   * JSON canônico (06, seção 8): chaves em ordem alfabética em todos os níveis, sem espaços, listas na ordem
   * recebida, campo vazio ('', null ou ausente) omitido, números na serialização padrão do JavaScript.
   */
  function jsonCanonico(valor) {
    return canonico_(valor, 'dados');
  }
  /** Bytes (com ou sem sinal, como os de Utilities.computeDigest) → hexadecimal minúsculo. */
  function bytesParaHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }
  /**
   * `payload_hash` de um comando: SHA-256, em hexadecimal, do JSON canônico de {rota, dados}.
   * `hash` é a porta de hash: {sha256Hex(texto) → 64 caracteres hexadecimais}. Avisos aceitos e versão
   * esperada ficam de fora, para o reenvio com aceite ser a mesma operação.
   */
  function payloadHash(rota, dados, hash) {
    if (typeof rota !== 'string' || rota === '') throw falha_('INTERNAL', 'payloadHash sem rota.');
    if (!hash || typeof hash.sha256Hex !== 'function') throw falha_('INTERNAL', 'payloadHash sem a porta de hash.');
    var hex = hash.sha256Hex(jsonCanonico({ rota: rota, dados: dados }));
    if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) throw falha_('INTERNAL', 'A porta de hash não devolveu um SHA-256 em hexadecimal.');
    return hex;
  }

  // ------------------------------------------------------------------ coleções ----
  function leitor_(campo) {
    return typeof campo === 'function' ? campo : function (x) { return x[campo]; };
  }
  /** {chave: item}. Chave repetida fica com o PRIMEIRO item; chave vazia é ignorada. */
  function indexarPor(lista, campo) {
    var le = leitor_(campo);
    var out = {};
    lista.forEach(function (x) {
      var k = le(x);
      if (!vazio(k) && !Object.prototype.hasOwnProperty.call(out, k)) out[k] = x;
    });
    return out;
  }
  /** {chave: [itens]}, na ordem de entrada; chave vazia é ignorada. */
  function agruparPor(lista, campo) {
    var le = leitor_(campo);
    var out = {};
    lista.forEach(function (x) {
      var k = le(x);
      if (vazio(k)) return;
      if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = [];
      out[k].push(x);
    });
    return out;
  }
  /** Soma de um campo numérico; vazio conta zero. Pensado para centavos e contagens (inteiros). */
  function somar(lista, campo) {
    var le = leitor_(campo);
    return lista.reduce(function (s, x) {
      var v = le(x);
      if (vazio(v)) return s;
      if (typeof v !== 'number' || !isFinite(v)) throw falha_('INTERNAL', 'somar encontrou valor não numérico.');
      return s + v;
    }, 0);
  }
  /** Maior valor numérico de um campo, ou null se não houver nenhum. Base dos contadores "máximo + 1". */
  function maximo(lista, campo) {
    var le = leitor_(campo);
    var m = null;
    lista.forEach(function (x) {
      var v = le(x);
      if (typeof v === 'number' && isFinite(v) && (m === null || v > m)) m = v;
    });
    return m;
  }
  /**
   * Cópia ordenada, estável. criterios: nomes de campo, funções ou {campo, desc: true}. Vazio vai para o fim.
   */
  function ordenarPor(lista, criterios) {
    var cs = (Array.isArray(criterios) ? criterios : [criterios]).map(function (c) {
      var obj = c && typeof c === 'object';
      return { le: leitor_(obj ? c.campo : c), sinal: obj && c.desc ? -1 : 1 };
    });
    return lista.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) {
      for (var k = 0; k < cs.length; k++) {
        var va = cs[k].le(a.x);
        var vb = cs[k].le(b.x);
        var ea = vazio(va);
        var eb = vazio(vb);
        if (ea && eb) continue;
        if (ea) return 1;
        if (eb) return -1;
        if (va < vb) return -1 * cs[k].sinal;
        if (va > vb) return 1 * cs[k].sinal;
      }
      return a.i - b.i;
    }).map(function (p) { return p.x; });
  }
  /** Valores sem repetição, na ordem da primeira ocorrência. */
  function unicos(lista) {
    var vistos = {};
    var out = [];
    lista.forEach(function (v) {
      var k = typeof v + ':' + v;
      if (!Object.prototype.hasOwnProperty.call(vistos, k)) { vistos[k] = true; out.push(v); }
    });
    return out;
  }
  /** Divide a lista em blocos de até `tamanho` itens. */
  function emBlocos(lista, tamanho) {
    if (typeof tamanho !== 'number' || Math.floor(tamanho) !== tamanho || tamanho < 1) throw falha_('INTERNAL', 'emBlocos espera um tamanho inteiro maior que zero.');
    var out = [];
    for (var i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
    return out;
  }
  /** Cópia profunda de dado JSON simples (objetos, listas, texto, número, booleano, null). */
  function clonar(valor) {
    return valor === undefined ? undefined : JSON.parse(JSON.stringify(valor));
  }

  return {
    CENTAVOS_MAX: CENTAVOS_MAX,
    vazio: vazio,
    dataValida: dataValida,
    diffDias: diffDias,
    somaDias: somaDias,
    compararDatas: compararDatas,
    idadeMeses: idadeMeses,
    hoje: hoje,
    instanteValido: instanteValido,
    instanteIso: instanteIso,
    dentroDoIntervalo: dentroDoIntervalo,
    diasNoIntervalo: diasNoIntervalo,
    intersecaoIntervalos: intersecaoIntervalos,
    arredondar: arredondar,
    casasDecimais: casasDecimais,
    reaisParaCentavos: reaisParaCentavos,
    centavosParaReais: centavosParaReais,
    formatarReais: formatarReais,
    formatarNumero: formatarNumero,
    ratear: ratear,
    aparar: aparar,
    normalizarBrinco: normalizarBrinco,
    normalizarTexto: normalizarTexto,
    jsonCanonico: jsonCanonico,
    bytesParaHex: bytesParaHex,
    payloadHash: payloadHash,
    indexarPor: indexarPor,
    agruparPor: agruparPor,
    somar: somar,
    maximo: maximo,
    ordenarPor: ordenarPor,
    unicos: unicos,
    emBlocos: emBlocos,
    clonar: clonar,
  };
})();
