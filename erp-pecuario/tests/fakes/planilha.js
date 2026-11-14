'use strict';
/**
 * Planilha em memória com DUAS fachadas sobre o mesmo estado: SpreadsheetApp (Spreadsheet, Sheet, Range) e o
 * serviço avançado Sheets (API v4). Existe para o teste FALHAR quando o adaptador esquecer o tipo, a ordem ou
 * o flush. O que o fake emula e a fonte de cada comportamento estão em docs/CONTRATOS.md (seção do harness).
 *
 * Modelo:
 *  - Célula = valor + formato. Valor interno: '' | texto | número | booleano | {data: serial} | {formula, valor}.
 *  - Escrita por SpreadsheetApp fica PENDENTE (buffer da execução) até flush() ou o fim normal da execução; a
 *    própria execução enxerga o que escreveu. Escrita e leitura pela API do Sheets são imediatas e NÃO enxergam
 *    o buffer pendente (o buffer é suspenso durante a chamada).
 *  - Cada escrita é uma operação refazível que devolve o seu desfazer: é o que permite trocar de execução e
 *    escolher qual subconjunto das pendentes chega quando a execução morre.
 */

const LIMITE_CELULA = 50000;
const FORMATO_TEXTO = '@';
const SERIAL_1970 = 25569; // dias de 30/12/1899 a 01/01/1970
const MS_DIA = 86400000;

// ------------------------------------------------------------------ utilidades ----
function tzOffsetMinutes(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const name = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName').value; // GMT-04:00
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  const v = parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10);
  return m[1] === '-' ? -v : v;
}
function ehData(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}
function serialDeYmd(a, m, d) {
  const t = new Date(0);
  t.setUTCFullYear(a, m - 1, d);
  return t.getTime() / MS_DIA + SERIAL_1970;
}
function dataValida(a, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(a, m, 0)).getUTCDate();
}
function serialParaInstante(serial, fuso) {
  const local = Math.round((serial - SERIAL_1970) * MS_DIA);
  return local - tzOffsetMinutes(new Date(local), fuso) * 60000;
}
function instanteParaSerial(ms, fuso) {
  return (ms + tzOffsetMinutes(new Date(ms), fuso) * 60000) / MS_DIA + SERIAL_1970;
}
function letraColuna(indice0) {
  let n = indice0 + 1;
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function indiceColuna(letras) {
  let n = 0;
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function nomeA1(nome) {
  return /^[A-Za-z0-9_]+$/.test(nome) ? nome : "'" + nome.replace(/'/g, "''") + "'";
}

/** Avalia só aritmética simples (o bastante para mostrar que "=1+1" deixa de ser o texto gravado). */
function avaliarFormula(expr) {
  const corpo = expr.replace(/^[=+]/, (c) => (c === '+' ? '+' : ''));
  if (/^[\d\s+\-*/().]+$/.test(corpo) && /\d/.test(corpo)) {
    try {
      const v = Function('"use strict"; return (' + corpo + ');')();
      if (typeof v === 'number' && isFinite(v)) return v;
    } catch (e) { /* cai no erro de fórmula abaixo */ }
    return '#ERROR!';
  }
  return /^[=+\-]?[A-Za-z_@][\w.]*$/.test(expr.replace(/^=/, '')) ? '#NAME?' : '#ERROR!';
}

/**
 * Coerção de uma célula de formato "Geral" quando o texto entra como digitado (setValues sem formato de texto,
 * USER_ENTERED, ou o dono editando à mão). Devolve o valor interno. A tabela esperada está em
 * tests/fixtures/coercao.json e é HIPÓTESE até o diagnóstico na conta real (SP-01) devolver o mesmo corpus.
 */
function coagirEntrada(texto, locale) {
  const br = locale === 'pt_BR';
  const s = String(texto);
  if (s === '') return '';
  if (s.charAt(0) === "'") return s.slice(1);
  if (s.charAt(0) === '=') return { formula: s, valor: avaliarFormula(s) };
  const t = s.trim();
  if (/^(TRUE|FALSE)$/i.test(t)) return /^TRUE$/i.test(t);
  if (br && /^(VERDADEIRO|FALSO)$/i.test(t)) return /^VERDADEIRO$/i.test(t);
  const num = lerNumero(t, br);
  if (num !== null) return num;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m && dataValida(+m[1], +m[2], +m[3])) return { data: serialDeYmd(+m[1], +m[2], +m[3]) + fracaoHora(m[4], m[5], m[6]) };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) {
    const dia = br ? +m[1] : +m[2];
    const mes = br ? +m[2] : +m[1];
    if (dataValida(+m[3], mes, dia)) return { data: serialDeYmd(+m[3], mes, dia) + fracaoHora(m[4], m[5], m[6]) };
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m && +m[1] < 24 && +m[2] < 60 && (m[3] === undefined || +m[3] < 60)) return { data: fracaoHora(m[1], m[2], m[3]) };
  // Sinal na frente do que não é número: a planilha tenta ler como fórmula.
  if (/^[+-]/.test(t)) return { formula: s, valor: avaliarFormula(t) };
  return s;
}
function fracaoHora(h, mi, se) {
  if (h === undefined) return 0;
  return (+h * 3600 + +mi * 60 + (se === undefined ? 0 : +se)) / 86400;
}
function lerNumero(t, br) {
  let s = t;
  let fator = 1;
  if (/%$/.test(s)) { fator = 0.01; s = s.slice(0, -1).trim(); }
  s = br ? s.replace(/^([+-]?)R\$\s?/, '$1') : s.replace(/^([+-]?)\$\s?/, '$1');
  if (/^[+-]?\d+$/.test(s)) return Number(s) * fator;
  if (/^[+-]?\d+([.,]\d+)?[eE][+-]?\d+$/.test(s)) return Number(s.replace(',', '.')) * fator;
  const milhar = br ? /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/ : /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
  const simples = br ? /^[+-]?\d+,\d+$/ : /^[+-]?\d*\.\d+$|^[+-]?\d+\.\d*$/;
  if (milhar.test(s)) return Number(br ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')) * fator;
  if (simples.test(s)) return Number(br ? s.replace(',', '.') : s) * fator;
  return null;
}

// ------------------------------------------------------------------ mundo ----
/**
 * @param amb ambiente do harness: {exec(), vivo(), erro(msg), paraContexto(v), agora(), antesDeEscrever(info),
 *            depoisDeEscrever(info), emitir(evento, info), servico(obj), opcoes}
 */
function criarMundoPlanilhas(amb) {
  const planilhas = new Map();
  const opcoes = Object.assign({ locale: 'en_US', fuso: 'Etc/GMT', nomeAbaPadrao: 'Página1', herdaFormato: true }, amb.opcoes || {});
  let seqSheetId = 1000;

  // ---------------------------------------------------------------- estado ----
  function novaAba(nome, linhas, colunas, sheetId) {
    const aba = { sheetId: sheetId === undefined ? ++seqSheetId : sheetId, nome, linhas: [], maxLinhas: linhas, maxColunas: colunas, congeladas: 0, protecoes: [] };
    for (let i = 0; i < linhas; i++) aba.linhas.push([]);
    return aba;
  }
  function criarPlanilha(id, nome) {
    if (planilhas.has(id)) throw new Error('fake Sheets: planilha já existe: ' + id);
    const ss = { id, nome, fuso: opcoes.fuso, locale: opcoes.locale, abas: [novaAba(opcoes.nomeAbaPadrao, 1000, 26, 0)], acessivel: true };
    planilhas.set(id, ss);
    return ss;
  }
  function copiarPlanilha(origemId, novoId, nome) {
    const o = exigirPlanilha(origemId);
    const copia = semPendentes(() => JSON.parse(JSON.stringify(o)));
    copia.id = novoId;
    copia.nome = nome;
    planilhas.set(novoId, copia);
    return copia;
  }
  function removerPlanilha(id) {
    planilhas.delete(id);
  }
  function exigirPlanilha(id) {
    const ss = planilhas.get(id);
    if (!ss) throw amb.erro('Requested entity was not found.');
    return ss;
  }
  function abaPorNome(ss, nome) {
    return ss.abas.find((a) => a.nome === nome) || null;
  }
  function celula(aba, r, c) {
    const linha = aba.linhas[r];
    return (linha && linha[c]) || null;
  }
  function vazia(cel) {
    return !cel || cel.v === '' || cel.v === undefined;
  }
  function ultimaLinha(aba) {
    for (let r = aba.linhas.length - 1; r >= 0; r--) {
      const l = aba.linhas[r];
      for (let c = 0; c < l.length; c++) if (!vazia(l[c])) return r + 1;
    }
    return 0;
  }
  function ultimaColuna(aba) {
    let max = 0;
    for (const l of aba.linhas) for (let c = l.length - 1; c >= max; c--) if (!vazia(l[c])) { max = c + 1; break; }
    return max;
  }

  // ---------------------------------------------------------------- operações (cada uma devolve o desfazer) ----
  /** Grava um bloco de células parciais {v?, f?} a partir de (r0, c0). Cresce a grade se precisar. */
  function opEscrever(aba, r0, c0, bloco) {
    return () => {
      const antes = { maxLinhas: aba.maxLinhas, maxColunas: aba.maxColunas, n: aba.linhas.length, cels: [] };
      const largura = bloco.reduce((m, l) => Math.max(m, l.length), 0);
      while (aba.linhas.length < r0 + bloco.length) aba.linhas.push([]);
      aba.maxLinhas = Math.max(aba.maxLinhas, aba.linhas.length);
      aba.maxColunas = Math.max(aba.maxColunas, c0 + largura);
      bloco.forEach((linha, i) => linha.forEach((parcial, j) => {
        if (!parcial) return;
        const l = aba.linhas[r0 + i];
        const velha = l[c0 + j];
        antes.cels.push([r0 + i, c0 + j, velha ? { v: velha.v, f: velha.f } : undefined]);
        const nova = velha ? { v: velha.v, f: velha.f } : { v: '', f: undefined };
        if ('f' in parcial) nova.f = parcial.f;
        if ('v' in parcial) nova.v = parcial.v;
        l[c0 + j] = nova;
      }));
      return () => {
        for (let k = antes.cels.length - 1; k >= 0; k--) {
          const [r, c, velha] = antes.cels[k];
          if (aba.linhas[r]) aba.linhas[r][c] = velha;
        }
        aba.linhas.length = antes.n;
        aba.maxLinhas = antes.maxLinhas;
        aba.maxColunas = antes.maxColunas;
      };
    };
  }
  function opInserirLinhas(aba, indice, n, herdarDe) {
    return () => {
      const novas = [];
      const modelo = herdarDe === null || herdarDe === undefined ? null : aba.linhas[herdarDe];
      for (let i = 0; i < n; i++) novas.push(modelo ? modelo.map((cel) => (cel && cel.f !== undefined ? { v: '', f: cel.f } : undefined)) : []);
      const pos = Math.min(indice, aba.linhas.length);
      aba.linhas.splice(pos, 0, ...novas);
      aba.maxLinhas += n;
      return () => { aba.linhas.splice(pos, n); aba.maxLinhas -= n; };
    };
  }
  function opRemoverLinhas(aba, indice, n) {
    return () => {
      const removidas = aba.linhas.splice(indice, n);
      aba.maxLinhas -= removidas.length;
      return () => { aba.linhas.splice(indice, 0, ...removidas); aba.maxLinhas += removidas.length; };
    };
  }
  function opInserirColunas(aba, indice, n) {
    return () => {
      aba.linhas.forEach((l) => { if (l.length > indice) l.splice(indice, 0, ...new Array(n).fill(undefined)); });
      aba.maxColunas += n;
      return () => { aba.linhas.forEach((l) => { if (l.length > indice) l.splice(indice, n); }); aba.maxColunas -= n; };
    };
  }
  function opRemoverColunas(aba, indice, n) {
    return () => {
      const removidas = aba.linhas.map((l) => (l.length > indice ? l.splice(indice, n) : null));
      const antes = aba.maxColunas;
      aba.maxColunas = Math.max(0, aba.maxColunas - n);
      return () => {
        aba.linhas.forEach((l, i) => { if (removidas[i]) l.splice(indice, 0, ...removidas[i]); });
        aba.maxColunas = antes;
      };
    };
  }
  function opAdicionarAba(ss, aba, indice) {
    return () => {
      const pos = indice === undefined || indice === null ? ss.abas.length : Math.min(indice, ss.abas.length);
      ss.abas.splice(pos, 0, aba);
      return () => { const i = ss.abas.indexOf(aba); if (i >= 0) ss.abas.splice(i, 1); };
    };
  }
  function opRemoverAba(ss, aba) {
    return () => {
      const i = ss.abas.indexOf(aba);
      if (i >= 0) ss.abas.splice(i, 1);
      return () => { if (i >= 0) ss.abas.splice(i, 0, aba); };
    };
  }
  function opAtribuir(alvo, campos) {
    return () => {
      const antes = {};
      Object.keys(campos).forEach((k) => { antes[k] = alvo[k]; alvo[k] = campos[k]; });
      return () => { Object.keys(antes).forEach((k) => { alvo[k] = antes[k]; }); };
    };
  }
  function opRedimensionar(aba, linhas, colunas) {
    return () => {
      const desfazer = [];
      if (linhas !== undefined && linhas !== aba.maxLinhas) {
        desfazer.push(linhas > aba.maxLinhas ? opInserirLinhas(aba, aba.linhas.length, linhas - aba.maxLinhas, null)() : opRemoverLinhas(aba, linhas, aba.maxLinhas - linhas)());
      }
      if (colunas !== undefined && colunas !== aba.maxColunas) {
        desfazer.push(colunas > aba.maxColunas ? opInserirColunas(aba, aba.maxColunas, colunas - aba.maxColunas)() : opRemoverColunas(aba, colunas, aba.maxColunas - colunas)());
      }
      return () => { for (let i = desfazer.length - 1; i >= 0; i--) desfazer[i](); };
    };
  }
  function opProtecao(aba, prot, adicionar) {
    return () => {
      if (adicionar) aba.protecoes.push(prot); else aba.protecoes.splice(aba.protecoes.indexOf(prot), 1);
      return () => { if (adicionar) aba.protecoes.splice(aba.protecoes.indexOf(prot), 1); else aba.protecoes.push(prot); };
    };
  }

  // ---------------------------------------------------------------- buffer ----
  function suspender(exec) {
    for (let i = exec.pendentes.length - 1; i >= 0; i--) exec.pendentes[i].desfazer();
  }
  function retomar(exec) {
    exec.pendentes.forEach((p) => { p.desfazer = p.aplicar(); });
  }
  /** Executa `fn` vendo só o estado durável (sem as escritas pendentes da execução corrente). */
  function semPendentes(fn) {
    const exec = amb.exec();
    if (!exec.pendentes.length) return fn();
    suspender(exec);
    try { return fn(); } finally { retomar(exec); }
  }
  /** Escrita por SpreadsheetApp: aplica na visão da execução e fica pendente até o flush. */
  function bufferizar(info, aplicar) {
    amb.antesDeEscrever(info);
    const exec = amb.exec();
    exec.pendentes.push({ info, aplicar, desfazer: aplicar() });
    amb.depoisDeEscrever(info);
  }
  /** Escrita pela API: imediata e durável; se uma operação do lote falhar, nada do lote fica. */
  function escreverDireto(info, ops) {
    amb.antesDeEscrever(info);
    semPendentes(() => {
      const feitos = [];
      try {
        ops.forEach((op) => feitos.push(op()));
      } catch (e) {
        for (let i = feitos.length - 1; i >= 0; i--) feitos[i]();
        throw e;
      }
    });
    amb.depoisDeEscrever(info);
  }
  function descarregar(exec) {
    exec.pendentes = [];
  }
  /** Morte da execução: desfaz todas as pendentes e reaplica só as que "chegaram" (índices na ordem original). */
  function resolverMorte(exec, indices) {
    const pend = exec.pendentes;
    exec.pendentes = [];
    for (let i = pend.length - 1; i >= 0; i--) pend[i].desfazer();
    indices.forEach((i) => { if (pend[i]) pend[i].aplicar(); });
  }

  // ---------------------------------------------------------------- conversões de valor ----
  function checarTamanho(v) {
    if (typeof v === 'string' && v.length > LIMITE_CELULA) throw amb.erro('Your input contains more than the maximum of ' + LIMITE_CELULA + ' characters in a single cell.');
  }
  /** Valor de setValues/USER_ENTERED → valor interno, conforme o formato da célula. */
  function entrarComoDigitado(ss, valor, formato) {
    if (valor === null || valor === undefined) return '';
    if (ehData(valor)) return formato === FORMATO_TEXTO ? String(valor) : { data: instanteParaSerial(valor.getTime(), ss.fuso) };
    if (typeof valor === 'string') { checarTamanho(valor); return formato === FORMATO_TEXTO ? valor : coagirEntrada(valor, ss.locale); }
    if (typeof valor === 'number') return formato === FORMATO_TEXTO ? String(valor) : valor;
    if (typeof valor === 'boolean') return formato === FORMATO_TEXTO ? (valor ? 'TRUE' : 'FALSE') : valor;
    throw amb.erro('fake SpreadsheetApp: valor não primitivo (' + Object.prototype.toString.call(valor) + ') — o adaptador precisa converter antes de gravar.');
  }
  function paraGetValues(ss, cel) {
    if (vazia(cel)) return '';
    const v = cel.v;
    if (v && typeof v === 'object') return 'data' in v ? new Date(serialParaInstante(v.data, ss.fuso)) : v.valor;
    return v;
  }
  function paraNaoFormatado(cel) {
    if (vazia(cel)) return '';
    const v = cel.v;
    if (v && typeof v === 'object') return 'data' in v ? v.data : v.valor;
    return v;
  }
  function dois(n) { return String(n).padStart(2, '0'); }
  function paraExibicao(ss, cel) {
    if (vazia(cel)) return '';
    let v = cel.v;
    if (v && typeof v === 'object' && 'formula' in v) v = v.valor;
    const br = ss.locale === 'pt_BR';
    if (v && typeof v === 'object') {
      const dias = Math.floor(v.data);
      const seg = Math.round((v.data - dias) * 86400);
      const hora = dois(Math.floor(seg / 3600)) + ':' + dois(Math.floor((seg % 3600) / 60)) + ':' + dois(seg % 60);
      if (dias === 0) return hora;
      const d = new Date((dias - SERIAL_1970) * MS_DIA);
      const dia = br ? dois(d.getUTCDate()) + '/' + dois(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() : (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
      return seg ? dia + ' ' + hora : dia;
    }
    if (typeof v === 'boolean') return br ? (v ? 'VERDADEIRO' : 'FALSO') : (v ? 'TRUE' : 'FALSE');
    if (typeof v === 'number') return br ? String(v).replace('.', ',') : String(v);
    return String(v);
  }
  function paraFormula(cel) {
    return cel && cel.v && typeof cel.v === 'object' && 'formula' in cel.v ? cel.v.formula : '';
  }

  // ---------------------------------------------------------------- fachada SpreadsheetApp ----
  function inteiro(v, msg) {
    if (typeof v !== 'number' || Math.floor(v) !== v) throw amb.erro(msg);
    return v;
  }
  function parseA1Local(aba, a1) {
    const m = /^([A-Za-z]+)?(\d+)?(?::([A-Za-z]+)?(\d+)?)?$/.exec(String(a1).replace(/\$/g, ''));
    if (!m || (m[1] === undefined && m[2] === undefined)) throw amb.erro('Range not found');
    const c0 = m[1] === undefined ? 0 : indiceColuna(m[1]);
    const r0 = m[2] === undefined ? 0 : Number(m[2]) - 1;
    const temFim = String(a1).indexOf(':') >= 0;
    const c1 = !temFim ? (m[1] === undefined ? null : c0) : (m[3] === undefined ? null : indiceColuna(m[3]));
    const r1 = !temFim ? (m[2] === undefined ? null : r0) : (m[4] === undefined ? null : Number(m[4]) - 1);
    return { r0, c0, r1, c1 };
  }
  function fazerRange(ss, aba, linha, coluna, nLinhas, nColunas) {
    inteiro(linha, 'The parameters (' + [linha, coluna, nLinhas, nColunas].join(',') + ") don't match the method signature for SpreadsheetApp.Sheet.getRange.");
    inteiro(coluna, 'The parameters don\'t match the method signature for SpreadsheetApp.Sheet.getRange.');
    if (linha < 1) throw amb.erro('The starting row of the range is too small.');
    if (coluna < 1) throw amb.erro('The starting column of the range is too small.');
    if (nLinhas < 1) throw amb.erro('The number of rows in the range must be at least 1.');
    if (nColunas < 1) throw amb.erro('The number of columns in the range must be at least 1.');
    const r0 = linha - 1;
    const c0 = coluna - 1;
    function limites() {
      if (ss.abas.indexOf(aba) < 0) throw amb.erro('Sheet ' + aba.sheetId + ' not found');
      if (r0 + nLinhas > aba.maxLinhas) throw amb.erro('Those rows are out of bounds.');
      if (c0 + nColunas > aba.maxColunas) throw amb.erro('Those columns are out of bounds.');
    }
    function ler(fn) {
      limites();
      const out = [];
      for (let i = 0; i < nLinhas; i++) {
        const l = [];
        for (let j = 0; j < nColunas; j++) l.push(fn(celula(aba, r0 + i, c0 + j)));
        out.push(l);
      }
      return amb.paraContexto(out);
    }
    function conferirMatriz(m, oQue) {
      if (!Array.isArray(m) || !m.every(Array.isArray)) throw amb.erro("The parameters (" + typeof m + ") don't match the method signature for SpreadsheetApp.Range." + oQue + '.');
      if (m.length !== nLinhas) throw amb.erro('The number of rows in the data does not match the number of rows in the range. The data has ' + m.length + ' but the range has ' + nLinhas + '.');
      m.forEach((l) => { if (l.length !== nColunas) throw amb.erro('The number of columns in the data does not match the number of columns in the range. The data has ' + l.length + ' but the range has ' + nColunas + '.'); });
    }
    function gravarValores(matriz) {
      conferirMatriz(matriz, 'setValues');
      limites();
      const copia = matriz.map((l) => l.map((v) => (ehData(v) ? new Date(v.getTime()) : v)));
      copia.forEach((l) => l.forEach((v) => { if (v !== null && typeof v === 'object' && !ehData(v)) entrarComoDigitado(ss, v); checarTamanho(v); }));
      bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'valores', intervalo: a1() }, () => {
        const bloco = copia.map((l, i) => l.map((v, j) => {
          const cel = celula(aba, r0 + i, c0 + j);
          return { v: entrarComoDigitado(ss, v, cel ? cel.f : undefined) };
        }));
        return opEscrever(aba, r0, c0, bloco)();
      });
    }
    function gravarFormatos(matriz) {
      conferirMatriz(matriz, 'setNumberFormats');
      limites();
      const bloco = matriz.map((l) => l.map((f) => ({ f: f === null || f === undefined || f === '' || f === 'General' ? undefined : String(f) })));
      bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'formato', intervalo: a1() }, opEscrever(aba, r0, c0, bloco));
    }
    function a1() {
      const ini = letraColuna(c0) + linha;
      return nLinhas === 1 && nColunas === 1 ? ini : ini + ':' + letraColuna(c0 + nColunas - 1) + (linha + nLinhas - 1);
    }
    function matrizDe(v) {
      const m = [];
      for (let i = 0; i < nLinhas; i++) m.push(new Array(nColunas).fill(v));
      return m;
    }
    const range = {
      getRow: () => linha,
      getColumn: () => coluna,
      getLastRow: () => linha + nLinhas - 1,
      getLastColumn: () => coluna + nColunas - 1,
      getNumRows: () => nLinhas,
      getNumColumns: () => nColunas,
      getA1Notation: a1,
      getSheet: () => fazerSheet(ss, aba),
      getValues: () => ler((cel) => paraGetValues(ss, cel)),
      getValue: () => ler((cel) => paraGetValues(ss, cel))[0][0],
      getDisplayValues: () => ler((cel) => paraExibicao(ss, cel)),
      getDisplayValue: () => ler((cel) => paraExibicao(ss, cel))[0][0],
      getFormulas: () => ler(paraFormula),
      getFormula: () => ler(paraFormula)[0][0],
      getNumberFormats: () => ler((cel) => (cel && cel.f !== undefined ? cel.f : '0.###############')),
      getNumberFormat: () => ler((cel) => (cel && cel.f !== undefined ? cel.f : '0.###############'))[0][0],
      setValues: (m) => { gravarValores(m); return range; },
      setValue: (v) => { gravarValores(matrizDe(v)); return range; },
      setNumberFormats: (m) => { gravarFormatos(m); return range; },
      setNumberFormat: (f) => { gravarFormatos(matrizDe(f)); return range; },
      clearContent: () => { limites(); bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'valores', intervalo: a1() }, opEscrever(aba, r0, c0, matrizDe(null).map((l) => l.map(() => ({ v: '' }))))); return range; },
    };
    return amb.servico(range);
  }
  function fazerProtecao(ss, aba, prot) {
    const p = {
      setWarningOnly: (b) => { bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'propriedades' }, opAtribuir(prot, { soAviso: !!b })); return p; },
      isWarningOnly: () => prot.soAviso,
      setDescription: (d) => { bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'propriedades' }, opAtribuir(prot, { descricao: String(d) })); return p; },
      getDescription: () => prot.descricao,
      getProtectionType: () => 'SHEET',
      remove: () => { bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'propriedades' }, opProtecao(aba, prot, false)); },
    };
    return amb.servico(p);
  }
  function fazerSheet(ss, aba) {
    const sheet = {
      getName: () => aba.nome,
      setName: (n) => {
        if (ss.abas.some((a) => a !== aba && a.nome === n)) throw amb.erro('A sheet with the name "' + n + '" already exists. Please enter another name.');
        bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'propriedades' }, opAtribuir(aba, { nome: String(n) }));
        return sheet;
      },
      getSheetId: () => aba.sheetId,
      getParent: () => fazerSpreadsheet(ss),
      getLastRow: () => ultimaLinha(aba),
      getLastColumn: () => ultimaColuna(aba),
      getMaxRows: () => aba.maxLinhas,
      getMaxColumns: () => aba.maxColunas,
      getFrozenRows: () => aba.congeladas,
      setFrozenRows: (n) => { bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'propriedades' }, opAtribuir(aba, { congeladas: inteiro(n, 'Invalid argument: rows') })); },
      getRange: (a, b, c, d) => {
        if (typeof a === 'string') {
          const p = parseA1Local(aba, a);
          const r1 = p.r1 === null ? aba.maxLinhas - 1 : p.r1;
          const c1 = p.c1 === null ? aba.maxColunas - 1 : p.c1;
          return fazerRange(ss, aba, p.r0 + 1, p.c0 + 1, r1 - p.r0 + 1, c1 - p.c0 + 1);
        }
        return fazerRange(ss, aba, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
      },
      getDataRange: () => fazerRange(ss, aba, 1, 1, Math.max(1, ultimaLinha(aba)), Math.max(1, ultimaColuna(aba))),
      insertRowsAfter: (depois, quantas) => {
        inteiro(depois, 'Invalid argument'); inteiro(quantas, 'Invalid argument');
        if (depois < 1 || depois > aba.maxLinhas) throw amb.erro('Those rows are out of bounds.');
        if (quantas < 1) throw amb.erro('The number of rows must be at least 1.');
        bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'linhas' }, opInserirLinhas(aba, depois, quantas, opcoes.herdaFormato ? depois - 1 : null));
        return sheet;
      },
      insertRowsBefore: (antes, quantas) => {
        inteiro(antes, 'Invalid argument'); inteiro(quantas, 'Invalid argument');
        if (antes < 1 || antes > aba.maxLinhas) throw amb.erro('Those rows are out of bounds.');
        bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'linhas' }, opInserirLinhas(aba, antes - 1, quantas, opcoes.herdaFormato ? antes - 1 : null));
        return sheet;
      },
      insertColumnsAfter: (depois, quantas) => {
        inteiro(depois, 'Invalid argument'); inteiro(quantas, 'Invalid argument');
        if (depois < 1 || depois > aba.maxColunas) throw amb.erro('Those columns are out of bounds.');
        bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'colunas' }, opInserirColunas(aba, depois, quantas));
        return sheet;
      },
      deleteRows: (linha, quantas) => {
        inteiro(linha, 'Invalid argument'); inteiro(quantas, 'Invalid argument');
        if (linha < 1 || quantas < 1 || linha + quantas - 1 > aba.maxLinhas) throw amb.erro('Those rows are out of bounds.');
        if (quantas >= aba.maxLinhas) throw amb.erro("Sorry, it is not possible to delete all non-frozen rows.");
        bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'linhas' }, opRemoverLinhas(aba, linha - 1, quantas));
      },
      deleteColumns: (coluna, quantas) => {
        inteiro(coluna, 'Invalid argument'); inteiro(quantas, 'Invalid argument');
        if (coluna < 1 || quantas < 1 || coluna + quantas - 1 > aba.maxColunas) throw amb.erro('Those columns are out of bounds.');
        if (quantas >= aba.maxColunas) throw amb.erro('Sorry, it is not possible to delete all non-frozen columns.');
        bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'colunas' }, opRemoverColunas(aba, coluna - 1, quantas));
      },
      appendRow: (valores) => {
        if (!Array.isArray(valores)) throw amb.erro("The parameters don't match the method signature for SpreadsheetApp.Sheet.appendRow.");
        const r = ultimaLinha(aba);
        if (r >= aba.maxLinhas) bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'linhas' }, opInserirLinhas(aba, r, 1, opcoes.herdaFormato && r > 0 ? r - 1 : null));
        if (valores.length > aba.maxColunas) bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'colunas' }, opInserirColunas(aba, aba.maxColunas, valores.length - aba.maxColunas));
        fazerRange(ss, aba, r + 1, 1, 1, valores.length).setValues([valores]);
        return sheet;
      },
      protect: () => {
        const prot = { soAviso: false, descricao: '' };
        bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'propriedades' }, opProtecao(aba, prot, true));
        return fazerProtecao(ss, aba, prot);
      },
      getProtections: () => aba.protecoes.map((p) => fazerProtecao(ss, aba, p)),
    };
    return amb.servico(sheet);
  }
  function fazerSpreadsheet(ss) {
    const s = {
      getId: () => ss.id,
      getName: () => ss.nome,
      rename: (n) => { bufferizar({ ss: ss.id, aba: null, tipo: 'propriedades' }, opAtribuir(ss, { nome: String(n) })); },
      getUrl: () => 'https://docs.google.com/spreadsheets/d/' + ss.id + '/edit',
      getSheets: () => ss.abas.map((a) => fazerSheet(ss, a)),
      getSheetByName: (n) => { const a = abaPorNome(ss, n); return a ? fazerSheet(ss, a) : null; },
      getNumSheets: () => ss.abas.length,
      insertSheet: (nome, indice) => {
        const n = nome === undefined ? 'Sheet' + (ss.abas.length + 1) : String(nome);
        if (abaPorNome(ss, n)) throw amb.erro('A sheet with the name "' + n + '" already exists. Please enter another name.');
        const aba = novaAba(n, 1000, 26);
        bufferizar({ ss: ss.id, aba: n, tipo: 'aba' }, opAdicionarAba(ss, aba, indice));
        return fazerSheet(ss, aba);
      },
      deleteSheet: (sheet) => {
        const aba = ss.abas.find((a) => a.sheetId === sheet.getSheetId());
        if (!aba) throw amb.erro('Sheet not found');
        if (ss.abas.length === 1) throw amb.erro("You can't remove all the sheets in a document.");
        bufferizar({ ss: ss.id, aba: aba.nome, tipo: 'aba' }, opRemoverAba(ss, aba));
      },
      getSpreadsheetTimeZone: () => ss.fuso,
      setSpreadsheetTimeZone: (tz) => {
        try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (e) { throw amb.erro('Invalid argument: timezone'); }
        bufferizar({ ss: ss.id, aba: null, tipo: 'propriedades' }, opAtribuir(ss, { fuso: tz }));
      },
      getSpreadsheetLocale: () => ss.locale,
      setSpreadsheetLocale: (l) => {
        if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(String(l))) throw amb.erro('Invalid argument: locale');
        bufferizar({ ss: ss.id, aba: null, tipo: 'propriedades' }, opAtribuir(ss, { locale: l }));
      },
    };
    return amb.servico(s);
  }
  const SpreadsheetApp = amb.servico({
    openById: (id) => {
      const ss = planilhas.get(id);
      if (!ss) throw amb.erro('Unexpected error while getting the method or property openById on object SpreadsheetApp.');
      if (!ss.acessivel) throw amb.erro('You do not have permission to access the requested document.');
      return fazerSpreadsheet(ss);
    },
    getActiveSpreadsheet: () => null, // script autônomo: não há planilha "ativa"
    flush: () => {
      amb.emitir('flush', {});
      descarregar(amb.exec());
    },
    ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
  });

  // ---------------------------------------------------------------- fachada Sheets (API v4) ----
  function erroApi(msg) {
    const e = amb.erro('GoogleJsonResponseException: API call to sheets failed with error: ' + msg);
    e.details = { code: 400, message: msg };
    return e;
  }
  function planilhaApi(id) {
    const ss = planilhas.get(id);
    if (!ss) { const e = amb.erro('GoogleJsonResponseException: API call to sheets.spreadsheets.get failed with error: Requested entity was not found.'); e.details = { code: 404, message: 'Requested entity was not found.' }; throw e; }
    if (!ss.acessivel) { const e = amb.erro('GoogleJsonResponseException: API call to sheets failed with error: The caller does not have permission'); e.details = { code: 403, message: 'The caller does not have permission' }; throw e; }
    return ss;
  }
  function abaPorId(ss, sheetId) {
    const aba = ss.abas.find((a) => a.sheetId === (sheetId === undefined ? 0 : sheetId));
    if (!aba) throw erroApi('Invalid requests: No grid with id: ' + sheetId);
    return aba;
  }
  function propsAba(ss, aba) {
    return { sheetId: aba.sheetId, title: aba.nome, index: ss.abas.indexOf(aba), sheetType: 'GRID', gridProperties: { rowCount: aba.maxLinhas, columnCount: aba.maxColunas, frozenRowCount: aba.congeladas } };
  }
  /** CellData → célula parcial {v?, f?} segundo a máscara `fields`. */
  function celulaDeCellData(cd, mascara, onde) {
    const parcial = {};
    const c = cd || {};
    if (mascara.valor) {
      const uev = c.userEnteredValue || {};
      const chaves = Object.keys(uev).filter((k) => uev[k] !== undefined && uev[k] !== null);
      if (chaves.length > 1) throw erroApi('Invalid ' + onde + ': oneof field \'value\' is already set. Cannot set \'' + chaves[1] + '\'');
      const k = chaves[0];
      if (k === undefined) parcial.v = '';
      else if (k === 'stringValue') { if (typeof uev[k] !== 'string') throw erroApi('Invalid value at \'' + onde + '.user_entered_value.string_value\' (TYPE_STRING)'); checarTamanho(uev[k]); parcial.v = uev[k]; }
      else if (k === 'numberValue') { if (typeof uev[k] !== 'number' || !isFinite(uev[k])) throw erroApi('Invalid value at \'' + onde + '.user_entered_value.number_value\' (TYPE_DOUBLE)'); parcial.v = uev[k]; }
      else if (k === 'boolValue') { if (typeof uev[k] !== 'boolean') throw erroApi('Invalid value at \'' + onde + '.user_entered_value.bool_value\' (TYPE_BOOL)'); parcial.v = uev[k]; }
      else if (k === 'formulaValue') parcial.v = { formula: String(uev[k]), valor: avaliarFormula(String(uev[k])) };
      else throw erroApi('Invalid JSON payload received. Unknown name "' + k + '" at \'' + onde + '.user_entered_value\': Cannot find field.');
    }
    if (mascara.formato) {
      const nf = c.userEnteredFormat && c.userEnteredFormat.numberFormat;
      parcial.f = !nf ? undefined : nf.type === 'TEXT' ? FORMATO_TEXTO : (nf.pattern || undefined);
    }
    return parcial;
  }
  function lerMascara(fields) {
    if (typeof fields !== 'string' || fields === '') throw erroApi("At least one field must be listed in 'fields'. (Use '*' to indicate all fields.)");
    const tudo = fields.trim() === '*';
    const m = { valor: tudo || /userEnteredValue/.test(fields), formato: tudo || /userEnteredFormat/.test(fields) };
    if (!m.valor && !m.formato) throw erroApi('Invalid field: ' + fields);
    return m;
  }
  function blocoDeRows(rows, mascara, onde) {
    if (!Array.isArray(rows)) throw erroApi('Invalid ' + onde + ': rows must be a list');
    return rows.map((row, i) => ((row && row.values) || []).map((cd, j) => celulaDeCellData(cd, mascara, onde + '.rows[' + i + '].values[' + j + ']')));
  }
  /** Traduz um Request do batchUpdate numa lista de operações; valida ANTES de aplicar (atomicidade). */
  function traduzirRequest(ss, req, i, abasNovas) {
    const chaves = Object.keys(req || {});
    if (chaves.length !== 1) throw erroApi('Invalid requests[' + i + ']: exactly one request kind must be set');
    const tipo = chaves[0];
    const r = req[tipo] || {};
    const onde = 'requests[' + i + '].' + tipo;
    const achaAba = (sheetId) => abasNovas.find((a) => a.sheetId === sheetId) || abaPorId(ss, sheetId);
    if (tipo === 'addSheet') {
      const p = r.properties || {};
      const g = p.gridProperties || {};
      const titulo = p.title === undefined ? 'Sheet' + (ss.abas.length + abasNovas.length + 1) : String(p.title);
      if (abaPorNome(ss, titulo) || abasNovas.some((a) => a.nome === titulo)) throw erroApi('Invalid ' + onde + ': A sheet with the name "' + titulo + '" already exists. Please enter another name.');
      if (p.sheetId !== undefined && (ss.abas.some((a) => a.sheetId === p.sheetId) || abasNovas.some((a) => a.sheetId === p.sheetId))) throw erroApi('Invalid ' + onde + ': A sheet with the ID "' + p.sheetId + '" already exists.');
      const aba = novaAba(titulo, g.rowCount === undefined ? 1000 : g.rowCount, g.columnCount === undefined ? 26 : g.columnCount, p.sheetId);
      aba.congeladas = g.frozenRowCount || 0;
      abasNovas.push(aba);
      return { ops: [opAdicionarAba(ss, aba, p.index)], resposta: () => ({ addSheet: { properties: propsAba(ss, aba) } }), abas: [titulo] };
    }
    if (tipo === 'appendCells') {
      const aba = achaAba(r.sheetId);
      const bloco = blocoDeRows(r.rows, lerMascara(r.fields), onde);
      return { ops: [() => {
        const inicio = ultimaLinha(aba);
        const largura = bloco.reduce((m, l) => Math.max(m, l.length), 0);
        if (largura > aba.maxColunas) throw erroApi('Invalid ' + onde + ': Attempting to write column: ' + largura + ', beyond the last requested column of: ' + aba.maxColunas);
        return opEscrever(aba, inicio, 0, bloco)();
      }], resposta: () => ({}), abas: [aba.nome] };
    }
    if (tipo === 'updateCells') {
      const alvo = r.start ? { sheetId: r.start.sheetId, r0: r.start.rowIndex || 0, c0: r.start.columnIndex || 0 } : r.range ? { sheetId: r.range.sheetId, r0: r.range.startRowIndex || 0, c0: r.range.startColumnIndex || 0, r1: r.range.endRowIndex, c1: r.range.endColumnIndex } : null;
      if (!alvo) throw erroApi('Invalid ' + onde + ': one of start or range must be set');
      const aba = achaAba(alvo.sheetId);
      const bloco = blocoDeRows(r.rows || [], lerMascara(r.fields), onde);
      return { ops: [() => {
        const largura = bloco.reduce((m, l) => Math.max(m, l.length), 0);
        if (alvo.r0 + bloco.length > aba.maxLinhas) throw erroApi('Invalid ' + onde + ': GridCoordinate.rowIndex[' + (alvo.r0 + bloco.length - 1) + '] is after last row in grid[' + (aba.maxLinhas - 1) + ']');
        if (alvo.c0 + largura > aba.maxColunas) throw erroApi('Invalid ' + onde + ': GridCoordinate.columnIndex[' + (alvo.c0 + largura - 1) + '] is after last column in grid[' + (aba.maxColunas - 1) + ']');
        if ((alvo.r1 !== undefined && alvo.r0 + bloco.length > alvo.r1) || (alvo.c1 !== undefined && alvo.c0 + largura > alvo.c1)) throw erroApi('Invalid ' + onde + ': Attempting to write outside the given range');
        return opEscrever(aba, alvo.r0, alvo.c0, bloco)();
      }], resposta: () => ({}), abas: [aba.nome] };
    }
    if (tipo === 'appendDimension') {
      const aba = achaAba(r.sheetId);
      if (r.dimension !== 'ROWS' && r.dimension !== 'COLUMNS') throw erroApi('Invalid ' + onde + ': dimension must be ROWS or COLUMNS');
      if (typeof r.length !== 'number' || r.length < 1 || Math.floor(r.length) !== r.length) throw erroApi('Invalid ' + onde + ': length must be positive');
      return { ops: [() => (r.dimension === 'ROWS' ? opInserirLinhas(aba, aba.linhas.length, r.length, null)() : opInserirColunas(aba, aba.maxColunas, r.length)())], resposta: () => ({}), abas: [aba.nome] };
    }
    if (tipo === 'deleteDimension') {
      const g = r.range || {};
      const aba = achaAba(g.sheetId);
      if (g.dimension !== 'ROWS' && g.dimension !== 'COLUMNS') throw erroApi('Invalid ' + onde + ': dimension must be ROWS or COLUMNS');
      return { ops: [() => {
        const max = g.dimension === 'ROWS' ? aba.maxLinhas : aba.maxColunas;
        const ini = g.startIndex || 0;
        const fim = g.endIndex === undefined ? max : g.endIndex;
        if (ini < 0 || fim > max || fim <= ini) throw erroApi('Invalid ' + onde + ': range out of bounds');
        if (fim - ini >= max) throw erroApi('Invalid ' + onde + ': Sorry, it is not possible to delete all non-frozen ' + (g.dimension === 'ROWS' ? 'rows.' : 'columns.'));
        return g.dimension === 'ROWS' ? opRemoverLinhas(aba, ini, fim - ini)() : opRemoverColunas(aba, ini, fim - ini)();
      }], resposta: () => ({}), abas: [aba.nome] };
    }
    if (tipo === 'updateSheetProperties') {
      const p = r.properties || {};
      const aba = achaAba(p.sheetId);
      if (typeof r.fields !== 'string' || r.fields === '') throw erroApi("At least one field must be listed in 'fields'. (Use '*' to indicate all fields.)");
      const tudo = r.fields.trim() === '*';
      const g = p.gridProperties || {};
      const quer = (campo) => tudo || new RegExp('\\b' + campo + '\\b').test(r.fields) || (/gridProperties(?![.(])/.test(r.fields) && campo !== 'title');
      const ops = [];
      if (quer('title') && p.title !== undefined) {
        if (ss.abas.some((a) => a !== aba && a.nome === p.title)) throw erroApi('Invalid ' + onde + ': A sheet with the name "' + p.title + '" already exists. Please enter another name.');
        ops.push(opAtribuir(aba, { nome: String(p.title) }));
      }
      if (quer('frozenRowCount') && g.frozenRowCount !== undefined) ops.push(opAtribuir(aba, { congeladas: g.frozenRowCount }));
      const linhas = quer('rowCount') ? g.rowCount : undefined;
      const colunas = quer('columnCount') ? g.columnCount : undefined;
      if ((linhas !== undefined && linhas < 1) || (colunas !== undefined && colunas < 1)) throw erroApi('Invalid ' + onde + ': grid must have at least one row and one column');
      if (linhas !== undefined || colunas !== undefined) ops.push(opRedimensionar(aba, linhas, colunas));
      if (!ops.length) throw erroApi('Invalid ' + onde + ': no known field to update in "' + r.fields + '"');
      return { ops, resposta: () => ({}), abas: [aba.nome] };
    }
    if (tipo === 'updateSpreadsheetProperties') {
      const p = r.properties || {};
      if (typeof r.fields !== 'string' || r.fields === '') throw erroApi("At least one field must be listed in 'fields'. (Use '*' to indicate all fields.)");
      const tudo = r.fields.trim() === '*';
      const campos = {};
      if ((tudo || /\btitle\b/.test(r.fields)) && p.title !== undefined) campos.nome = String(p.title);
      if ((tudo || /\blocale\b/.test(r.fields)) && p.locale !== undefined) campos.locale = p.locale;
      if ((tudo || /\btimeZone\b/.test(r.fields)) && p.timeZone !== undefined) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: p.timeZone }); } catch (e) { throw erroApi('Invalid ' + onde + ': Unsupported time zone: ' + p.timeZone); }
        campos.fuso = p.timeZone;
      }
      if (!Object.keys(campos).length) throw erroApi('Invalid ' + onde + ': no known field to update in "' + r.fields + '"');
      return { ops: [opAtribuir(ss, campos)], resposta: () => ({}), abas: [] };
    }
    throw erroApi('Invalid JSON payload received. Unknown name "' + tipo + '" at \'requests[' + i + ']\': Cannot find field.');
  }
  /** "ABA!A2:Z" → {aba, r0, c0, r1, c1} (índices 0-based; fim null = até o fim da grade). */
  function parseA1(ss, a1) {
    const s = String(a1);
    let nome = null;
    let resto = null;
    let m = /^'((?:[^']|'')+)'(?:!(.*))?$/.exec(s);
    if (m) { nome = m[1].replace(/''/g, "'"); resto = m[2]; } else {
      const i = s.indexOf('!');
      if (i >= 0) { nome = s.slice(0, i); resto = s.slice(i + 1); } else if (abaPorNome(ss, s)) nome = s; else { nome = ss.abas[0].nome; resto = s; }
    }
    const aba = abaPorNome(ss, nome);
    if (!aba) throw erroApi('Unable to parse range: ' + s);
    if (resto === undefined || resto === null || resto === '') return { aba, r0: 0, c0: 0, r1: null, c1: null };
    m = /^([A-Za-z]+)?(\d+)?(?::([A-Za-z]+)?(\d+)?)?$/.exec(resto.replace(/\$/g, ''));
    if (!m || (m[1] === undefined && m[2] === undefined)) throw erroApi('Unable to parse range: ' + s);
    const temFim = resto.indexOf(':') >= 0;
    const c0 = m[1] === undefined ? 0 : indiceColuna(m[1]);
    const r0 = m[2] === undefined ? 0 : Number(m[2]) - 1;
    return {
      aba, r0, c0,
      r1: temFim ? (m[4] === undefined ? null : Number(m[4]) - 1) : (m[2] === undefined ? null : r0),
      c1: temFim ? (m[3] === undefined ? null : indiceColuna(m[3])) : (m[1] === undefined ? null : c0),
      explicito: true,
    };
  }
  function a1Completo(p) {
    const r1 = p.r1 === null ? p.aba.maxLinhas - 1 : Math.min(p.r1, p.aba.maxLinhas - 1);
    const c1 = p.c1 === null ? p.aba.maxColunas - 1 : Math.min(p.c1, p.aba.maxColunas - 1);
    return nomeA1(p.aba.nome) + '!' + letraColuna(p.c0) + (p.r0 + 1) + ':' + letraColuna(Math.max(c1, p.c0)) + (Math.max(r1, p.r0) + 1);
  }
  function lerValores(ss, a1, render) {
    const p = parseA1(ss, a1);
    const r1 = p.r1 === null ? p.aba.maxLinhas - 1 : Math.min(p.r1, p.aba.maxLinhas - 1);
    const c1 = p.c1 === null ? p.aba.maxColunas - 1 : Math.min(p.c1, p.aba.maxColunas - 1);
    const conv = render === 'UNFORMATTED_VALUE' ? paraNaoFormatado : render === 'FORMULA' ? (cel) => paraFormula(cel) || paraNaoFormatado(cel) : (cel) => paraExibicao(ss, cel);
    const linhas = [];
    for (let r = p.r0; r <= r1; r++) {
      const l = [];
      for (let c = p.c0; c <= c1; c++) l.push(conv(celula(p.aba, r, c)));
      while (l.length && l[l.length - 1] === '') l.pop(); // a API corta os vazios do fim de cada linha
      linhas.push(l);
    }
    while (linhas.length && linhas[linhas.length - 1].length === 0) linhas.pop(); // e as linhas vazias do fim
    const vr = { range: a1Completo(p), majorDimension: 'ROWS' };
    if (linhas.length) vr.values = linhas;
    return vr;
  }
  function prepararGravacao(ss, item, opcao, i) {
    const p = parseA1(ss, item.range);
    const valores = item.values || [];
    if (!Array.isArray(valores) || !valores.every(Array.isArray)) throw erroApi('Invalid data[' + i + ']: values must be a list of lists');
    if (item.majorDimension && item.majorDimension !== 'ROWS') throw erroApi('fake Sheets: só majorDimension ROWS é emulado');
    const largura = valores.reduce((m, l) => Math.max(m, l.length), 0);
    if (p.r0 + valores.length > p.aba.maxLinhas || p.c0 + largura > p.aba.maxColunas) {
      throw erroApi('Range (' + nomeA1(p.aba.nome) + '!' + letraColuna(p.c0) + (p.r0 + 1) + ':' + letraColuna(p.c0 + Math.max(largura, 1) - 1) + (p.r0 + valores.length) + ') exceeds grid limits. Max rows: ' + p.aba.maxLinhas + ', max columns: ' + p.aba.maxColunas);
    }
    if (p.explicito && p.r1 !== null && p.r0 + valores.length - 1 > p.r1 && !(p.r1 === p.r0 && p.c1 === p.c0)) throw erroApi('Requested writing within range [' + item.range + '], but tried writing to row [' + (p.r0 + valores.length) + ']');
    if (p.explicito && p.c1 !== null && p.c0 + largura - 1 > p.c1 && !(p.r1 === p.r0 && p.c1 === p.c0)) throw erroApi('Requested writing within range [' + item.range + '], but tried writing to column [' + letraColuna(p.c0 + largura - 1) + ']');
    const bloco = valores.map((l, r) => l.map((v, c) => {
      if (v === null || v === undefined) return null; // null: a célula não é tocada
      if (typeof v === 'object') throw erroApi('Invalid values[' + r + '][' + c + ']: struct_value');
      checarTamanho(v);
      if (opcao === 'RAW') return { v };
      const cel = celula(p.aba, p.r0 + r, p.c0 + c);
      return { v: entrarComoDigitado(ss, v, cel ? cel.f : undefined) };
    }));
    return { op: opEscrever(p.aba, p.r0, p.c0, bloco), aba: p.aba.nome, linhas: valores.length, colunas: largura, celulas: bloco.reduce((n, l) => n + l.filter(Boolean).length, 0), intervalo: nomeA1(p.aba.nome) + '!' + letraColuna(p.c0) + (p.r0 + 1) + ':' + letraColuna(p.c0 + Math.max(largura, 1) - 1) + (p.r0 + Math.max(valores.length, 1)) };
  }
  const Sheets = {
    Spreadsheets: amb.servico({
      get: (spreadsheetId) => semPendentes(() => {
        const ss = planilhaApi(spreadsheetId);
        return amb.paraContexto({
          spreadsheetId: ss.id,
          properties: { title: ss.nome, locale: ss.locale, timeZone: ss.fuso },
          sheets: ss.abas.map((a) => ({ properties: propsAba(ss, a) })),
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + ss.id + '/edit',
        });
      }),
      batchUpdate: (resource, spreadsheetId) => {
        const ss = planilhaApi(spreadsheetId);
        const reqs = resource && resource.requests;
        if (!Array.isArray(reqs) || !reqs.length) throw erroApi('Must specify at least one request.');
        let respostas = [];
        const abas = [];
        escreverDireto({ ss: ss.id, aba: null, abas, tipo: 'api', metodo: 'spreadsheets.batchUpdate', pedidos: reqs.length }, [() => {
          // Traduz e aplica pedido a pedido; qualquer erro desfaz o lote inteiro (atomicidade documentada da API).
          const desfazer = [];
          const abasNovas = [];
          const pendResp = [];
          try {
            reqs.forEach((req, i) => {
              const t = traduzirRequest(ss, req, i, abasNovas);
              t.ops.forEach((op) => desfazer.push(op()));
              t.abas.forEach((n) => { if (abas.indexOf(n) < 0) abas.push(n); });
              pendResp.push(t.resposta);
            });
          } catch (e) {
            for (let i = desfazer.length - 1; i >= 0; i--) desfazer[i]();
            throw e;
          }
          respostas = pendResp.map((f) => f());
          return () => { for (let i = desfazer.length - 1; i >= 0; i--) desfazer[i](); };
        }]);
        return amb.paraContexto({ spreadsheetId: ss.id, replies: respostas });
      },
      Values: amb.servico({
        batchGet: (spreadsheetId, optionalArgs) => semPendentes(() => {
          const ss = planilhaApi(spreadsheetId);
          const o = optionalArgs || {};
          const ranges = o.ranges === undefined ? [] : Array.isArray(o.ranges) ? o.ranges : [o.ranges];
          return amb.paraContexto({ spreadsheetId: ss.id, valueRanges: ranges.map((r) => lerValores(ss, r, o.valueRenderOption || 'FORMATTED_VALUE')) });
        }),
        get: (spreadsheetId, range, optionalArgs) => semPendentes(() => {
          const ss = planilhaApi(spreadsheetId);
          return amb.paraContexto(lerValores(ss, range, (optionalArgs || {}).valueRenderOption || 'FORMATTED_VALUE'));
        }),
        batchUpdate: (resource, spreadsheetId) => {
          const ss = planilhaApi(spreadsheetId);
          const r = resource || {};
          if (r.valueInputOption !== 'RAW' && r.valueInputOption !== 'USER_ENTERED') throw erroApi("'valueInputOption' is required but not specified");
          if (!Array.isArray(r.data)) throw erroApi('Invalid data: must be a list');
          const respostas = [];
          const abas = [];
          const info = { ss: ss.id, aba: null, abas, tipo: 'api', metodo: 'spreadsheets.values.batchUpdate', pedidos: r.data.length };
          amb.antesDeEscrever(info);
          // SEM atomicidade entre intervalos (hipótese pessimista do desenho, 06 seção 2): o que veio antes do erro fica.
          semPendentes(() => {
            r.data.forEach((item, i) => {
              const g = prepararGravacao(ss, item, r.valueInputOption, i);
              g.op();
              if (abas.indexOf(g.aba) < 0) abas.push(g.aba);
              respostas.push({ spreadsheetId: ss.id, updatedRange: g.intervalo, updatedRows: g.linhas, updatedColumns: g.colunas, updatedCells: g.celulas });
            });
          });
          amb.depoisDeEscrever(info);
          return amb.paraContexto({
            spreadsheetId: ss.id,
            totalUpdatedRows: respostas.reduce((n, x) => n + x.updatedRows, 0),
            totalUpdatedColumns: respostas.reduce((n, x) => n + x.updatedColumns, 0),
            totalUpdatedCells: respostas.reduce((n, x) => n + x.updatedCells, 0),
            totalUpdatedSheets: abas.length,
            responses: respostas,
          });
        },
      }),
    }),
  };

  // ---------------------------------------------------------------- apoio aos testes ----
  function abaDe(ssId, nomeAba) {
    const ss = planilhas.get(ssId);
    if (!ss) throw new Error('fake Sheets: planilha inexistente: ' + ssId);
    const aba = abaPorNome(ss, nomeAba);
    if (!aba) throw new Error('fake Sheets: aba inexistente: ' + nomeAba);
    return { ss, aba };
  }
  function extrair(ssId, nomeAba, fn) {
    const { aba } = abaDe(ssId, nomeAba);
    const nL = ultimaLinha(aba);
    const nC = ultimaColuna(aba);
    const out = [];
    for (let r = 0; r < nL; r++) {
      const l = [];
      for (let c = 0; c < nC; c++) l.push(fn(celula(aba, r, c)));
      out.push(l);
    }
    return out;
  }
  const valorCru = (cel) => (vazia(cel) ? '' : cel.v && typeof cel.v === 'object' ? Object.assign({}, cel.v) : cel.v);
  const apoio = {
    ids: () => Array.from(planilhas.keys()),
    existe: (ssId) => planilhas.has(ssId),
    abas: (ssId) => planilhas.get(ssId).abas.map((a) => a.nome),
    propriedades: (ssId) => { const ss = planilhas.get(ssId); return { nome: ss.nome, fuso: ss.fuso, locale: ss.locale }; },
    dimensoes: (ssId, nomeAba) => { const { aba } = abaDe(ssId, nomeAba); return { linhas: aba.maxLinhas, colunas: aba.maxColunas, ultimaLinha: ultimaLinha(aba), ultimaColuna: ultimaColuna(aba), congeladas: aba.congeladas, protecoes: aba.protecoes.map((p) => ({ soAviso: p.soAviso })) }; },
    /** Valores internos como a execução corrente os vê (durável + pendentes), aparados à última linha/coluna com dado. */
    matriz: (ssId, nomeAba) => extrair(ssId, nomeAba, valorCru),
    /** Só o que já é durável: o que sobraria se a execução morresse agora sem que nenhuma pendente chegasse. */
    matrizDuravel: (ssId, nomeAba) => semPendentes(() => extrair(ssId, nomeAba, valorCru)),
    formatos: (ssId, nomeAba) => extrair(ssId, nomeAba, (cel) => (cel && cel.f !== undefined ? cel.f : null)),
    /** Linhas de dados como objetos {cabeçalho: valor interno}, usando a linha 1 como cabeçalho. */
    objetos: (ssId, nomeAba) => {
      const m = extrair(ssId, nomeAba, valorCru);
      if (!m.length) return [];
      return m.slice(1).map((l) => { const o = {}; m[0].forEach((h, i) => { o[h] = l[i] === undefined ? '' : l[i]; }); return o; });
    },
    /** Grava direto no estado durável, sem buffer nem coerção (preparação de cenário). */
    gravar: (ssId, nomeAba, linha, coluna, matriz, formato) => {
      const { aba } = abaDe(ssId, nomeAba);
      semPendentes(() => opEscrever(aba, linha - 1, coluna - 1, matriz.map((l) => l.map((v) => (formato === undefined ? { v } : { v, f: formato }))))());
    },
    /** O dono edita uma célula à mão: vale a coerção do formato da célula (Geral coage; texto preserva). */
    digitar: (ssId, nomeAba, linha, coluna, texto) => {
      const { ss, aba } = abaDe(ssId, nomeAba);
      semPendentes(() => {
        const cel = celula(aba, linha - 1, coluna - 1);
        opEscrever(aba, linha - 1, coluna - 1, [[{ v: entrarComoDigitado(ss, texto, cel ? cel.f : undefined) }]])();
      });
    },
    /** Marca a planilha como fora do alcance do escopo drive.file (não foi criada pelo app). */
    tornarInacessivel: (ssId) => { planilhas.get(ssId).acessivel = false; },
  };

  return { SpreadsheetApp, Sheets, apoio, criarPlanilha, copiarPlanilha, removerPlanilha, suspender, retomar, descarregar, resolverMorte, existe: (id) => planilhas.has(id), obter: (id) => planilhas.get(id), semPendentes };
}

module.exports = { criarMundoPlanilhas, coagirEntrada, tzOffsetMinutes, serialDeYmd, LIMITE_CELULA, FORMATO_TEXTO };
