/**
 * Database — adaptador de E/S da planilha-banco (SheetsAdapter), codec de tipos e portas reais da execução.
 *
 * Três primitivas de E/S atrás de uma porta única (desenho-base, seções 16.13 e 17; 06, seção 2), escolhidas por
 * configuração (IO_PRIMITIVE) e nunca misturadas no mesmo comando:
 *   SHEETS_TYPED     Sheets API: Values.batchGet + Spreadsheets.batchUpdate com appendCells/updateCells tipados;
 *   SHEETS_RAW       Sheets API: Values.batchGet + Values.batchUpdate com entrada RAW (sem atomicidade entre abas);
 *   SPREADSHEET_APP  SpreadsheetApp: insertRowsAfter → setNumberFormats no bloco exato → setValues.
 * O protocolo de três fases da UnitOfWork vale inteiro nas três: aqui não se presume atomicidade de nada.
 *
 * Codec único (06, seção 3): "valor lido === valor gravado". A forma de CÉLULA (reais com 2 casas, S/N, JSON em
 * texto) só existe neste arquivo; do lado de fora circula a forma da LÓGICA (docs/CONTRATOS.md, seção 1).
 * Único arquivo que lê o relógio (porta Clock).
 */
var Database = (function () {
  var PRIMITIVAS = Object.freeze(['SHEETS_TYPED', 'SHEETS_RAW', 'SPREADSHEET_APP']);
  var FORMATO_TEXTO = '@';
  var FORMATO_NUMERO = '0.###############';
  var CAMPOS_CELULA = 'userEnteredValue,userEnteredFormat.numberFormat';
  var TIPOS_TEXTO = Object.freeze({ ID: true, TEXTO: true, DATA: true, TS: true, ENUM: true, BOOL: true, JSON: true });
  var TIPOS_NUMERO = Object.freeze({ INT: true, DEC1: true, DEC4: true, DINHEIRO: true });
  var SERIAL_1970 = 25569; // dias de 30/12/1899 a 01/01/1970
  var MS_DIA = 86400000;
  var RE_NUMERO = /^-?\d+(?:[.,]\d+)?$/;
  /** Corpus de ida e volta (06, seção 2): os 14 valores do desenho e os formatos que o sistema grava em texto. */
  var CORPUS = Object.freeze([
    '=1+1', '+55 69 99999-0000', '-10 kg', '@lote', '0012', '1E5', '2026-11-13', '13/11/2026', '12:30', 'TRUE',
    '1.234,56', '50%', "'0012", '  texto com espaços nas pontas  ',
    'FALSE', '2026-11-14T01:30:00.000Z', '3f2b8c1e-7a4d-4e9b-9c55-0d6a1f2e8b47', 'S', 'A-000123',
  ]);

  // ------------------------------------------------------------------ codec ----
  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function ehData_(v) {
    return Object.prototype.toString.call(v) === '[object Date]';
  }
  function interno_(mensagem) {
    return Validation.erro('INTERNAL', mensagem);
  }
  function dois_(n) {
    return (n < 10 ? '0' : '') + n;
  }
  /** Número serial da planilha (dias desde 30/12/1899) → 'yyyy-MM-dd'. O serial é data de parede: não tem fuso. */
  function serialParaData_(serial) {
    var d = new Date((Math.floor(serial) - SERIAL_1970) * MS_DIA);
    return d.getUTCFullYear() + '-' + dois_(d.getUTCMonth() + 1) + '-' + dois_(d.getUTCDate());
  }
  /** Deslocamento do fuso (ms a somar ao UTC para obter a hora de parede) no instante dado. */
  function deslocamentoMs_(ms, fuso) {
    var z = Utilities.formatDate(new Date(ms), fuso, 'Z'); // "-0400"
    var sinal = z.charAt(0) === '-' ? -1 : 1;
    return sinal * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2))) * 60000;
  }
  /** Serial com hora (hora de parede no fuso da planilha) → instante ISO-8601 UTC. */
  function serialParaInstante_(serial, fuso) {
    var parede = Math.round((serial - SERIAL_1970) * MS_DIA);
    var ms = parede - deslocamentoMs_(parede, fuso);
    ms = parede - deslocamentoMs_(ms, fuso); // segunda passada: acerta a virada de horário de verão
    return new Date(ms).toISOString();
  }
  /**
   * Data nativa (objeto Date do SpreadsheetApp ou serial da Sheets API) → 'yyyy-MM-dd', ou null se a célula não
   * representa uma data do contrato (serial fora do calendário, Date inválido): aí é erro de integridade, não coerção.
   */
  function nativaParaData_(celula, fuso) {
    var s = null;
    if (ehData_(celula)) s = isNaN(celula.getTime()) ? null : Utilities.formatDate(celula, fuso(), 'yyyy-MM-dd');
    else if (isFinite(celula) && Math.abs(celula) < 3e6) s = serialParaData_(celula);
    return s !== null && Utils.dataValida(s) ? s : null;
  }
  /** Idem para instante: ISO-8601 UTC, ou null. */
  function nativaParaInstante_(celula, fuso) {
    var s = null;
    if (ehData_(celula)) s = isNaN(celula.getTime()) ? null : celula.toISOString();
    else if (isFinite(celula) && Math.abs(celula) < 3e6) s = serialParaInstante_(celula, fuso());
    return s !== null && Utils.instanteValido(s) ? s : null;
  }
  function jsonInvalido_(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return false;
    if (typeof v === 'number') return !isFinite(v);
    if (typeof v !== 'object' || ehData_(v)) return true;
    if (Array.isArray(v)) return v.some(jsonInvalido_);
    return Object.keys(v).some(function (k) { return v[k] !== undefined && jsonInvalido_(v[k]); });
  }
  /** Valor da lógica → valor de célula ('' | texto | número). Tipo errado é erro de programação (INTERNAL). */
  function codificar(col, valor) {
    if (vazio_(valor)) return '';
    if (ehData_(valor)) throw interno_('Objeto de data não pode ser gravado (' + col.nome + '): use texto yyyy-MM-dd ou instante ISO.');
    switch (col.tipo) {
      case 'ID': case 'TEXTO': case 'DATA': case 'TS': case 'ENUM':
        if (typeof valor !== 'string') throw interno_('A coluna ' + col.nome + ' (' + col.tipo + ') só aceita texto; veio ' + typeof valor + '.');
        return valor;
      case 'INT': case 'DEC1': case 'DEC4':
        if (typeof valor !== 'number' || !isFinite(valor)) throw interno_('A coluna ' + col.nome + ' (' + col.tipo + ') só aceita número.');
        return valor;
      case 'DINHEIRO':
        if (typeof valor === 'number' && Math.abs(valor) > Utils.CENTAVOS_MAX) throw interno_('A coluna ' + col.nome + ' (DINHEIRO) passa do limite de 15 dígitos: o valor não voltaria exato da planilha.');
        return Utils.centavosParaReais(valor);
      case 'BOOL':
        if (typeof valor !== 'boolean') throw interno_('A coluna ' + col.nome + ' (BOOL) só aceita verdadeiro ou falso.');
        return valor ? 'S' : 'N';
      case 'JSON':
        if (typeof valor !== 'object' || jsonInvalido_(valor)) throw interno_('A coluna ' + col.nome + ' (JSON) só aceita objeto ou lista sem datas nem funções.');
        return JSON.stringify(valor);
      default:
        throw interno_('Tipo de coluna desconhecido: ' + col.tipo + ' (' + col.nome + ').');
    }
  }
  function alerta_(nivel, codigo, mensagem) {
    return { nivel: nivel, codigo: codigo, mensagem: mensagem };
  }
  function numeroDeTexto_(s) {
    return RE_NUMERO.test(s) ? Number(s.replace(',', '.')) : null;
  }
  /**
   * Valor de célula → {valor, alerta}. `alerta` é null quando a célula está na forma do contrato; senão
   * {nivel: 'COERCIDA' | 'ERRO', codigo, mensagem}: COERCIDA = convertida sem perda (vira registro em ERROS_LOG);
   * ERRO = erro de integridade (o valor devolvido é o melhor possível, ou null).
   * `fuso` é uma função que devolve o fuso da planilha (só é chamada quando chega data nativa).
   */
  function decodificar(col, celula, fuso) {
    if (vazio_(celula)) return { valor: null, alerta: null };
    var t = ehData_(celula) ? 'data' : typeof celula;
    var n;
    switch (col.tipo) {
      case 'ID': case 'TEXTO': case 'ENUM':
        if (t === 'string') return { valor: celula, alerta: null };
        if (t === 'number') return { valor: String(celula), alerta: alerta_('ERRO', 'TEXTO_VIROU_NUMERO', 'Número onde se esperava texto: zeros à esquerda podem ter se perdido.') };
        if (t === 'boolean') return { valor: celula ? 'TRUE' : 'FALSE', alerta: alerta_('ERRO', 'TEXTO_VIROU_BOOLEANO', 'Valor lógico onde se esperava texto.') };
        n = nativaParaData_(celula, fuso);
        return { valor: n, alerta: alerta_('ERRO', 'TEXTO_VIROU_DATA', 'Data onde se esperava texto.') };
      case 'DATA':
        if (t === 'string') return { valor: celula, alerta: Utils.dataValida(celula) ? null : alerta_('ERRO', 'DATA_INVALIDA', 'Data fora do formato aaaa-mm-dd.') };
        if (t === 'data' || t === 'number') {
          n = nativaParaData_(celula, fuso);
          if (n === null) return { valor: null, alerta: alerta_('ERRO', 'DATA_INVALIDA', 'Número ou data da planilha que não corresponde a uma data válida.') };
          return { valor: n, alerta: alerta_('COERCIDA', 'DATA_NATIVA', 'Data gravada como data da planilha, e não como texto.') };
        }
        return { valor: null, alerta: alerta_('ERRO', 'DATA_INVALIDA', 'Valor lógico onde se esperava data.') };
      case 'TS':
        if (t === 'string') return { valor: celula, alerta: Utils.instanteValido(celula) ? null : alerta_('ERRO', 'INSTANTE_INVALIDO', 'Data e hora fora do formato ISO-8601 em UTC.') };
        if (t === 'data' || t === 'number') {
          n = nativaParaInstante_(celula, fuso);
          if (n === null) return { valor: null, alerta: alerta_('ERRO', 'INSTANTE_INVALIDO', 'Número ou data da planilha que não corresponde a uma data e hora válidas.') };
          return { valor: n, alerta: alerta_('COERCIDA', 'INSTANTE_NATIVO', 'Data e hora gravadas como data da planilha, e não como texto.') };
        }
        return { valor: null, alerta: alerta_('ERRO', 'INSTANTE_INVALIDO', 'Valor lógico onde se esperava data e hora.') };
      case 'INT': case 'DEC1': case 'DEC4': case 'DINHEIRO':
        n = t === 'number' ? celula : t === 'string' ? numeroDeTexto_(celula) : null;
        if (n === null || !isFinite(n)) return { valor: null, alerta: alerta_('ERRO', 'NUMERO_INVALIDO', 'Texto, data ou valor lógico onde se esperava número.') };
        // Fora do que o tipo representa: erro de integridade (a leitura da aba não pode lançar por causa de uma célula).
        if (col.tipo === 'DINHEIRO' && Math.abs(n) * 100 > Utils.CENTAVOS_MAX + 0.5) return { valor: null, alerta: alerta_('ERRO', 'NUMERO_INVALIDO', 'Valor em reais grande demais para o sistema.') };
        if (col.tipo === 'INT' && !(Math.floor(n) === n && Math.abs(n) <= 9007199254740991)) return { valor: n, alerta: alerta_('ERRO', 'NUMERO_INVALIDO', 'Número com casas decimais, ou grande demais, onde se esperava número inteiro.') };
        return {
          valor: col.tipo === 'DINHEIRO' ? Utils.reaisParaCentavos(n) : n,
          alerta: t === 'number' ? null : alerta_('COERCIDA', 'NUMERO_COMO_TEXTO', 'Número gravado como texto.'),
        };
      case 'BOOL':
        if (celula === 'S' || celula === 'N') return { valor: celula === 'S', alerta: null };
        if (t === 'boolean') return { valor: celula, alerta: alerta_('COERCIDA', 'BOOLEANO_NATIVO', 'Sim/não gravado como valor lógico da planilha, e não como S ou N.') };
        return { valor: null, alerta: alerta_('ERRO', 'BOOLEANO_INVALIDO', 'Esperava S ou N.') };
      case 'JSON':
        if (t !== 'string') return { valor: null, alerta: alerta_('ERRO', 'JSON_INVALIDO', 'Esperava texto JSON.') };
        try {
          n = JSON.parse(celula);
        } catch (e) {
          return { valor: null, alerta: alerta_('ERRO', 'JSON_INVALIDO', 'Texto JSON inválido: ' + e.message) };
        }
        if (n === null || typeof n !== 'object') return { valor: null, alerta: alerta_('ERRO', 'JSON_INVALIDO', 'Esperava objeto ou lista em JSON.') };
        return { valor: n, alerta: null };
      default:
        throw interno_('Tipo de coluna desconhecido: ' + col.tipo + ' (' + col.nome + ').');
    }
  }
  /** Valor da lógica → texto de AUDITORIA (formato de célula do tipo; dinheiro com 2 casas). Vazio → ''. */
  function paraTexto(col, valor) {
    var c = codificar(col, valor);
    if (c === '') return '';
    return col.tipo === 'DINHEIRO' ? c.toFixed(2) : String(c);
  }
  /** Texto de AUDITORIA → valor da lógica. Texto que não cabe no tipo da coluna é INTERNAL (a linha foi adulterada). */
  function deTexto(col, texto) {
    if (vazio_(texto)) return null;
    if (typeof texto !== 'string') throw interno_('deTexto espera texto (' + col.nome + ').');
    var cel = texto;
    if (TIPOS_NUMERO[col.tipo]) {
      cel = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/.test(texto) ? Number(texto) : null; // String(n) usa expoente a partir de 1e21
      if (cel === null) throw interno_('O texto "' + texto + '" não é um número (' + col.nome + ').');
    }
    var d = decodificar(col, cel, function () { throw interno_('deTexto não converte data nativa.'); });
    if (d.alerta) throw interno_('O texto "' + texto + '" não cabe na coluna ' + col.nome + ' (' + col.tipo + ').');
    return d.valor;
  }
  function normalizarValor_(col, valor) {
    return decodificar(col, codificar(col, valor), function () { throw interno_('normalizar não converte data nativa.'); }).valor;
  }

  // ------------------------------------------------------------------ apoio de planilha ----
  function letraColuna_(indice0) {
    var s = '';
    var n = indice0 + 1;
    while (n > 0) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  function nomeA1_(aba) {
    return "'" + String(aba).replace(/'/g, "''") + "'";
  }
  function intervalo_(aba, linha, coluna0, nLinhas, nColunas) {
    return nomeA1_(aba) + '!' + letraColuna_(coluna0) + linha + ':' + letraColuna_(coluna0 + nColunas - 1) + (linha + nLinhas - 1);
  }
  function aparar_(linha) {
    var n = linha.length;
    while (n > 0 && vazio_(linha[n - 1])) n--;
    return linha.slice(0, n);
  }
  function semAba_(aba) {
    return Validation.erro('CONFIG', 'A aba ' + aba + ' não existe na planilha do sistema. Execute a configuração inicial (setup) para criar o que falta.');
  }
  function celulaTipada_(v, texto) {
    var c = {};
    if (typeof v === 'number') c.userEnteredValue = { numberValue: v };
    else if (!vazio_(v)) c.userEnteredValue = { stringValue: String(v) };
    if (texto) c.userEnteredFormat = { numberFormat: { type: 'TEXT' } };
    return c;
  }
  function linhasTipadas_(valores, texto) {
    return valores.map(function (l) {
      return { values: l.map(function (v, j) { return celulaTipada_(v, texto[j]); }) };
    });
  }
  function formatos_(valores, texto) {
    return valores.map(function (l) {
      return l.map(function (_, j) { return texto[j] ? FORMATO_TEXTO : FORMATO_NUMERO; });
    });
  }

  // ------------------------------------------------------------------ primitivas: Sheets API ----
  /** SHEETS_TYPED (tipada = true) e SHEETS_RAW: leitura por Values.batchGet; gravação imediata, sem buffer. */
  function primitivaApi_(ssId, tipada) {
    function meta() {
      var r = Sheets.Spreadsheets.get(ssId, { fields: 'properties(title,locale,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))' });
      var abas = {};
      (r.sheets || []).forEach(function (s) {
        var p = s.properties;
        abas[p.title] = { sheetId: p.sheetId, linhas: p.gridProperties.rowCount, colunas: p.gridProperties.columnCount };
      });
      return { titulo: r.properties.title, fuso: r.properties.timeZone, locale: r.properties.locale, abas: abas };
    }
    function ids_(nomes) {
      var m = meta();
      nomes.forEach(function (n) { if (!m.abas[n]) throw semAba_(n); });
      return m;
    }
    function lerIntervalos_(nomes, sufixo) {
      if (!nomes.length) return {};
      var r;
      try {
        r = Sheets.Spreadsheets.Values.batchGet(ssId, {
          ranges: nomes.map(function (n) { return nomeA1_(n) + sufixo; }),
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'SERIAL_NUMBER',
          majorDimension: 'ROWS',
        });
      } catch (e) {
        ids_(nomes); // aba ausente vira CONFIG com instrução; qualquer outra falha sobe como veio
        throw e;
      }
      var out = {};
      nomes.forEach(function (n, i) { out[n] = (r.valueRanges[i] && r.valueRanges[i].values) || []; });
      return out;
    }
    function valores_(dados) {
      Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: dados }, ssId);
    }
    function pedidos_(requests) {
      return Sheets.Spreadsheets.batchUpdate({ requests: requests }, ssId);
    }
    return {
      meta: meta,
      fuso: function () { return meta().fuso; },
      lerMatrizes: function (nomes) { return lerIntervalos_(nomes, ''); },
      lerCabecalhos: function (nomes) {
        var m = lerIntervalos_(nomes, '!1:1');
        var out = {};
        nomes.forEach(function (n) { out[n] = m[n][0] || []; });
        return out;
      },
      /** celulas: [{aba, linha, coluna (base 0)}] → valores, na mesma ordem, em UMA requisição. */
      lerCelulas: function (celulas) {
        var r = Sheets.Spreadsheets.Values.batchGet(ssId, {
          ranges: celulas.map(function (c) { return intervalo_(c.aba, c.linha, c.coluna, 1, 1); }),
          valueRenderOption: 'UNFORMATTED_VALUE',
        });
        return celulas.map(function (_, i) {
          var v = r.valueRanges[i] && r.valueRanges[i].values;
          return v && v[0] && v[0].length ? v[0][0] : '';
        });
      },
      /** blocos: [{aba, valores, texto, ultima}] → {ABA: primeira linha gravada, ou null se não dá para saber}. */
      anexar: function (blocos) {
        var m = ids_(blocos.map(function (b) { return b.aba; }));
        var onde = {};
        if (tipada) {
          pedidos_(blocos.map(function (b) {
            onde[b.aba] = b.ultima === null || b.ultima === undefined ? null : b.ultima + 1;
            return { appendCells: { sheetId: m.abas[b.aba].sheetId, rows: linhasTipadas_(b.valores, b.texto), fields: CAMPOS_CELULA } };
          }));
          return onde;
        }
        // RAW não cresce a grade sozinho: acrescenta as linhas ao FIM da grade e grava nelas (nunca sobre dado).
        pedidos_(blocos.map(function (b) {
          onde[b.aba] = m.abas[b.aba].linhas + 1;
          return { appendDimension: { sheetId: m.abas[b.aba].sheetId, dimension: 'ROWS', length: b.valores.length } };
        }));
        valores_(blocos.map(function (b) {
          return { range: intervalo_(b.aba, onde[b.aba], 0, b.valores.length, b.texto.length), majorDimension: 'ROWS', values: b.valores };
        }));
        return onde;
      },
      /** blocos: [{aba, linha, coluna (base 0), valores, texto: [booleano por coluna do bloco]}]. */
      gravar: function (blocos) {
        if (!tipada) {
          valores_(blocos.map(function (b) {
            return { range: intervalo_(b.aba, b.linha, b.coluna, b.valores.length, b.valores[0].length), majorDimension: 'ROWS', values: b.valores };
          }));
          return;
        }
        var m = ids_(blocos.map(function (b) { return b.aba; }));
        pedidos_(blocos.map(function (b) {
          return { updateCells: {
            start: { sheetId: m.abas[b.aba].sheetId, rowIndex: b.linha - 1, columnIndex: b.coluna },
            rows: linhasTipadas_(b.valores, b.texto),
            fields: CAMPOS_CELULA,
          } };
        }));
      },
      /** abas: [{nome, cabecalho}] — cada aba nasce com 2 linhas (cabeçalho congelado + 1 livre) e as colunas exatas. */
      criarAbas: function (abas) {
        var m = meta();
        var proximo = Object.keys(m.abas).reduce(function (mx, k) { return Math.max(mx, m.abas[k].sheetId); }, 0) + 1;
        var criar = [];
        var cabecalhos = [];
        abas.forEach(function (a, i) {
          var id = proximo + i;
          criar.push({ addSheet: { properties: { sheetId: id, title: a.nome, gridProperties: { rowCount: 2, columnCount: a.cabecalho.length, frozenRowCount: 1 } } } });
          cabecalhos.push({ updateCells: {
            start: { sheetId: id, rowIndex: 0, columnIndex: 0 },
            rows: linhasTipadas_([a.cabecalho], a.cabecalho.map(function () { return true; })),
            fields: CAMPOS_CELULA,
          } });
        });
        if (tipada) {
          pedidos_(criar.concat(cabecalhos));
          return;
        }
        pedidos_(criar);
        valores_(abas.map(function (a) { return { range: intervalo_(a.nome, 1, 0, 1, a.cabecalho.length), majorDimension: 'ROWS', values: [a.cabecalho] }; }));
      },
      /** Grava `nomes` na linha 1 a partir da coluna `inicio` (base 0), crescendo a grade se faltar coluna. */
      acrescentarColunas: function (aba, inicio, nomes) {
        var m = ids_([aba]);
        var falta = inicio + nomes.length - m.abas[aba].colunas;
        var cresce = falta > 0 ? [{ appendDimension: { sheetId: m.abas[aba].sheetId, dimension: 'COLUMNS', length: falta } }] : [];
        if (tipada) {
          pedidos_(cresce.concat([{ updateCells: {
            start: { sheetId: m.abas[aba].sheetId, rowIndex: 0, columnIndex: inicio },
            rows: linhasTipadas_([nomes], nomes.map(function () { return true; })),
            fields: CAMPOS_CELULA,
          } }]));
          return;
        }
        if (cresce.length) pedidos_(cresce);
        valores_([{ range: intervalo_(aba, 1, inicio, 1, nomes.length), majorDimension: 'ROWS', values: [nomes] }]);
      },
      definirPropriedades: function (p) {
        var props = {};
        var campos = [];
        if (p.fuso) { props.timeZone = p.fuso; campos.push('timeZone'); }
        if (p.locale) { props.locale = p.locale; campos.push('locale'); }
        if (campos.length) pedidos_([{ updateSpreadsheetProperties: { properties: props, fields: campos.join(',') } }]);
      },
      flush: function () { /* a Sheets API grava na hora: não há buffer a descarregar */ },
    };
  }

  // ------------------------------------------------------------------ primitiva: SpreadsheetApp ----
  /** SPREADSHEET_APP: tudo por SpreadsheetApp, com formato aplicado a cada bloco ANTES do valor (SP-10). */
  function primitivaApp_(ssId) {
    var ss = null;
    function planilha() {
      if (!ss) ss = SpreadsheetApp.openById(ssId);
      return ss;
    }
    function aba_(nome) {
      var sh = planilha().getSheetByName(nome);
      if (!sh) throw semAba_(nome);
      return sh;
    }
    function bloco_(sh, linha, coluna1, valores, formatos) {
      var rg = sh.getRange(linha, coluna1, valores.length, valores[0].length);
      rg.setNumberFormats(formatos);
      rg.setValues(valores);
    }
    return {
      meta: function () {
        var abas = {};
        planilha().getSheets().forEach(function (sh) {
          abas[sh.getName()] = { sheetId: sh.getSheetId(), linhas: sh.getMaxRows(), colunas: sh.getMaxColumns() };
        });
        return { titulo: planilha().getName(), fuso: planilha().getSpreadsheetTimeZone(), locale: planilha().getSpreadsheetLocale(), abas: abas };
      },
      fuso: function () { return planilha().getSpreadsheetTimeZone(); },
      lerMatrizes: function (nomes) {
        var out = {};
        nomes.forEach(function (n) {
          var sh = aba_(n);
          out[n] = sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues();
        });
        return out;
      },
      lerCabecalhos: function (nomes) {
        var out = {};
        nomes.forEach(function (n) {
          var sh = aba_(n);
          out[n] = sh.getLastColumn() < 1 ? [] : sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        });
        return out;
      },
      lerCelulas: function (celulas) {
        return celulas.map(function (c) {
          var sh = aba_(c.aba);
          if (c.linha > sh.getMaxRows() || c.coluna + 1 > sh.getMaxColumns()) return '';
          return sh.getRange(c.linha, c.coluna + 1).getValue();
        });
      },
      anexar: function (blocos) {
        var onde = {};
        blocos.forEach(function (b) {
          var sh = aba_(b.aba);
          var ultima = sh.getLastRow();
          if (ultima < 1) throw Validation.erro('CONFIG', 'A aba ' + b.aba + ' está sem cabeçalho. Execute a configuração inicial (setup).');
          sh.insertRowsAfter(ultima, b.valores.length);
          bloco_(sh, ultima + 1, 1, b.valores, formatos_(b.valores, b.texto));
          onde[b.aba] = ultima + 1;
        });
        return onde;
      },
      gravar: function (blocos) {
        blocos.forEach(function (b) {
          bloco_(aba_(b.aba), b.linha, b.coluna + 1, b.valores, formatos_(b.valores, b.texto));
        });
      },
      criarAbas: function (abas) {
        abas.forEach(function (a) {
          var sh = planilha().insertSheet(a.nome);
          var n = a.cabecalho.length;
          if (sh.getMaxRows() > 2) sh.deleteRows(3, sh.getMaxRows() - 2);
          if (sh.getMaxColumns() > n) sh.deleteColumns(n + 1, sh.getMaxColumns() - n);
          if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
          bloco_(sh, 1, 1, [a.cabecalho], [a.cabecalho.map(function () { return FORMATO_TEXTO; })]);
          sh.setFrozenRows(1);
        });
      },
      acrescentarColunas: function (aba, inicio, nomes) {
        var sh = aba_(aba);
        var falta = inicio + nomes.length - sh.getMaxColumns();
        if (falta > 0) sh.insertColumnsAfter(sh.getMaxColumns(), falta);
        bloco_(sh, 1, inicio + 1, [nomes], [nomes.map(function () { return FORMATO_TEXTO; })]);
      },
      definirPropriedades: function (p) {
        if (p.fuso) planilha().setSpreadsheetTimeZone(p.fuso);
        if (p.locale) planilha().setSpreadsheetLocale(p.locale);
      },
      flush: function () { SpreadsheetApp.flush(); },
    };
  }

  // ------------------------------------------------------------------ porta de E/S ----
  /**
   * Abre o banco por id e devolve a porta de E/S (contrato em docs/CONTRATOS.md, seção Database).
   * opcoes: {primitiva: uma de PRIMITIVAS (padrão SHEETS_TYPED), tabelas: {NOME: definição}} — definições extras
   * (mesma forma do Schema: {nome, pk, colunas: [{nome, tipo}]}) servem ao corpus e ao diagnóstico.
   */
  function abrir(ssId, opcoes) {
    var o = opcoes || {};
    var primitiva = o.primitiva || PRIMITIVAS[0];
    if (typeof ssId !== 'string' || ssId === '') throw Validation.erro('CONFIG', 'O sistema ainda não tem planilha configurada. Execute a configuração inicial (setup).');
    if (PRIMITIVAS.indexOf(primitiva) < 0) throw Validation.erro('CONFIG', 'Forma de gravação desconhecida (IO_PRIMITIVE): ' + primitiva + '.');
    var extras = o.tabelas || {};
    var p = primitiva === 'SPREADSHEET_APP' ? primitivaApp_(ssId) : primitivaApi_(ssId, primitiva === 'SHEETS_TYPED');
    var cabecalhos = {}; // aba → cabeçalho lido (válido enquanto a execução segura o lock ou só lê)
    var ultimas = {}; // aba → última linha com dado conhecida
    var fusoLido = null;

    function definicao(nome) {
      return Object.prototype.hasOwnProperty.call(extras, nome) ? extras[nome] : Schema.tabela(nome);
    }
    function coluna_(tabela, nome) {
      var cols = definicao(tabela).colunas;
      for (var i = 0; i < cols.length; i++) if (cols[i].nome === nome) return cols[i];
      throw interno_('A coluna ' + nome + ' não existe em ' + tabela + '.');
    }
    function fuso() {
      if (!fusoLido) fusoLido = p.fuso();
      return fusoLido;
    }
    function guardarCabecalho_(nome, linha1) {
      var cab = aparar_(linha1 || []).map(function (c) { return vazio_(c) ? '' : String(c); });
      if (!cab.length) throw Validation.erro('CONFIG', 'A aba ' + nome + ' está sem cabeçalho. Execute a configuração inicial (setup).');
      cabecalhos[nome] = cab;
      return cab;
    }
    /** Posição de cada coluna da definição no cabeçalho real: o mapeamento é por NOME, nunca por posição. */
    function posicoes_(nome) {
      if (!cabecalhos[nome]) guardarCabecalho_(nome, p.lerCabecalhos([nome])[nome]);
      var pos = {};
      cabecalhos[nome].forEach(function (c, i) { if (c !== '' && pos[c] === undefined) pos[c] = i; });
      return pos;
    }
    function decodificarTabela_(nome, matriz) {
      var def = definicao(nome);
      guardarCabecalho_(nome, matriz[0]);
      var pos = posicoes_(nome);
      var alertas = [];
      var registros = [];
      var linhas = [];
      var cols = def.colunas.map(function (c) { return { col: c, i: pos[c.nome] }; });
      cols.forEach(function (c) {
        if (c.i === undefined) alertas.push({ tabela: nome, linha: 1, coluna: c.col.nome, nivel: 'ERRO', codigo: 'COLUNA_AUSENTE', mensagem: 'A coluna ' + c.col.nome + ' não existe na aba ' + nome + '. Execute a configuração (setup).' });
      });
      var iPk = pos[def.pk];
      for (var r = 1; r < matriz.length; r++) {
        var linha = matriz[r] || [];
        if (!aparar_(linha).length) continue; // linha em branco (sobra de grade ou de fase A interrompida)
        if (iPk === undefined || vazio_(linha[iPk])) {
          alertas.push({ tabela: nome, linha: r + 1, coluna: def.pk, nivel: 'ERRO', codigo: 'LINHA_SEM_PK', mensagem: 'Linha ' + (r + 1) + ' da aba ' + nome + ' sem chave: ignorada.' });
          continue;
        }
        var reg = {};
        for (var k = 0; k < cols.length; k++) {
          var c = cols[k];
          var d = decodificar(c.col, c.i === undefined || c.i >= linha.length ? '' : linha[c.i], fuso);
          reg[c.col.nome] = d.valor;
          if (d.alerta) alertas.push({ tabela: nome, linha: r + 1, coluna: c.col.nome, nivel: d.alerta.nivel, codigo: d.alerta.codigo, mensagem: d.alerta.mensagem });
        }
        registros.push(reg);
        linhas.push(r + 1);
      }
      ultimas[nome] = matriz.length;
      return { cabecalho: cabecalhos[nome].slice(), registros: registros, linhas: linhas, ultimaLinha: matriz.length, alertas: alertas };
    }
    /** Lê várias abas de uma vez: {ABA: {cabecalho, registros, linhas, ultimaLinha, alertas}}. */
    function ler(nomes) {
      var unicos = Utils.unicos(nomes || []);
      var matrizes = p.lerMatrizes(unicos);
      var out = {};
      unicos.forEach(function (n) { out[n] = decodificarTabela_(n, matrizes[n]); });
      return out;
    }
    function linhaCodificada_(nome, pos, registro) {
      var def = definicao(nome);
      var linha = cabecalhos[nome].map(function () { return ''; });
      Object.keys(registro).forEach(function (k) { coluna_(nome, k); });
      def.colunas.forEach(function (c) {
        var cel = codificar(c, registro[c.nome]);
        if (pos[c.nome] === undefined) {
          if (cel !== '') throw Validation.erro('CONFIG', 'A coluna ' + c.nome + ' não existe na aba ' + nome + '. Execute a configuração (setup) para atualizar a planilha.');
          return;
        }
        linha[pos[c.nome]] = cel;
      });
      return linha;
    }
    function textoPorColuna_(nome) {
      var def = definicao(nome);
      var tipo = {};
      def.colunas.forEach(function (c) { tipo[c.nome] = c.tipo; });
      return cabecalhos[nome].map(function (c) { return !!TIPOS_TEXTO[tipo[c]]; });
    }
    /**
     * Anexa registros (forma da lógica): {ABA: [registro...]}. Devolve {ABA: primeira linha gravada}; null quando a
     * aba não foi lida antes por esta porta e a primitiva não informa a posição.
     */
    function anexar(porTabela) {
      var blocos = [];
      Object.keys(porTabela || {}).forEach(function (nome) {
        var regs = porTabela[nome] || [];
        if (!regs.length) return;
        var pos = posicoes_(nome);
        blocos.push({
          aba: nome,
          valores: regs.map(function (r) { return linhaCodificada_(nome, pos, r); }),
          texto: textoPorColuna_(nome),
          ultima: ultimas[nome] === undefined ? null : ultimas[nome],
        });
      });
      if (!blocos.length) return {};
      var onde = p.anexar(blocos);
      blocos.forEach(function (b) {
        if (onde[b.aba] === null || onde[b.aba] === undefined) delete ultimas[b.aba];
        else ultimas[b.aba] = onde[b.aba] + b.valores.length - 1;
      });
      return onde;
    }
    /**
     * Atualiza células por índice de linha: [{tabela, linha, campos: {coluna: valor}}]. As células viram blocos
     * retangulares: colunas vizinhas da mesma linha se juntam numa faixa, e faixas iguais em linhas seguidas, num
     * bloco só (menos escritas na primitiva SPREADSHEET_APP). Devolve o número de células gravadas.
     */
    function atualizar(itens) {
      var celulas = {};
      (itens || []).forEach(function (it) {
        if (typeof it.linha !== 'number' || it.linha < 2 || Math.floor(it.linha) !== it.linha) throw interno_('Linha inválida para atualizar ' + it.tabela + ': ' + it.linha + '.');
        var pos = posicoes_(it.tabela);
        Object.keys(it.campos || {}).forEach(function (campo) {
          var col = coluna_(it.tabela, campo);
          if (pos[campo] === undefined) throw Validation.erro('CONFIG', 'A coluna ' + campo + ' não existe na aba ' + it.tabela + '. Execute a configuração (setup) para atualizar a planilha.');
          celulas[it.tabela + '\u0000' + it.linha + '\u0000' + pos[campo]] = { aba: it.tabela, coluna: pos[campo], linha: it.linha, valor: codificar(col, it.campos[campo]), texto: !!TIPOS_TEXTO[col.tipo] };
        });
      });
      var lista = Object.keys(celulas).map(function (k) { return celulas[k]; });
      if (!lista.length) return 0;
      lista.sort(function (a, b) { return a.aba < b.aba ? -1 : a.aba > b.aba ? 1 : a.linha - b.linha || a.coluna - b.coluna; });
      var faixas = [];
      var f = null;
      lista.forEach(function (c) {
        if (f && f.aba === c.aba && f.linha === c.linha && f.coluna + f.valores.length === c.coluna) {
          f.valores.push(c.valor);
          f.texto.push(c.texto);
        } else faixas.push(f = { aba: c.aba, linha: c.linha, coluna: c.coluna, valores: [c.valor], texto: [c.texto] });
      });
      var blocos = [];
      var abertos = {}; // aba + coluna + largura → bloco cuja última linha pode receber a faixa seguinte
      faixas.forEach(function (fx) {
        var k = fx.aba + '\u0000' + fx.coluna + '\u0000' + fx.valores.length;
        var b = abertos[k];
        if (b && b.linha + b.valores.length === fx.linha) {
          b.valores.push(fx.valores);
          return;
        }
        blocos.push(abertos[k] = { aba: fx.aba, linha: fx.linha, coluna: fx.coluna, valores: [fx.valores], texto: fx.texto });
      });
      p.gravar(blocos);
      return lista.length;
    }
    /** Cria as abas que faltam, na dimensão exata, com o cabeçalho da definição. Devolve as que criou. */
    function criarTabelas(nomes) {
      var existentes = p.meta().abas;
      var faltam = Utils.unicos(nomes || []).filter(function (n) { return !existentes[n]; });
      if (!faltam.length) return [];
      p.criarAbas(faltam.map(function (n) { return { nome: n, cabecalho: definicao(n).colunas.map(function (c) { return c.nome; }) }; }));
      faltam.forEach(function (n) {
        cabecalhos[n] = definicao(n).colunas.map(function (c) { return c.nome; });
        ultimas[n] = 1;
      });
      return faltam;
    }
    /** Acrescenta AO FINAL as colunas da definição que faltam no cabeçalho. Devolve {ABA: [colunas acrescentadas]}. */
    function acrescentarColunas(nomes) {
      var lista = Utils.unicos(nomes || []);
      var lidos = p.lerCabecalhos(lista);
      var out = {};
      lista.forEach(function (n) {
        var cab = guardarCabecalho_(n, lidos[n]);
        var faltam = definicao(n).colunas.map(function (c) { return c.nome; }).filter(function (c) { return cab.indexOf(c) < 0; });
        out[n] = faltam;
        if (!faltam.length) return;
        p.acrescentarColunas(n, cab.length, faltam);
        cabecalhos[n] = cab.concat(faltam);
      });
      return out;
    }
    /** Cabeçalho real de cada aba ({ABA: [...]}; null para aba que não existe). Serve ao setup e à integridade. */
    function lerCabecalhos(nomes) {
      var existentes = p.meta().abas;
      var lista = Utils.unicos(nomes || []);
      var lidos = p.lerCabecalhos(lista.filter(function (n) { return !!existentes[n]; }));
      var out = {};
      lista.forEach(function (n) {
        out[n] = existentes[n] ? aparar_(lidos[n] || []).map(function (c) { return vazio_(c) ? '' : String(c); }) : null;
      });
      return out;
    }
    /**
     * Confere, numa leitura só, que cada registro está na linha em que se supõe: [{tabela, linha, id}] → true se a
     * célula da chave de TODAS as linhas guarda exatamente o id. Posição desconhecida (linha null) ou leitura que
     * falha contam como "não conferido": quem chama relê as abas inteiras, que é o caminho seguro.
     */
    function conferirPosicoes(itens) {
      var lista = itens || [];
      if (!lista.length) return true;
      var celulas = [];
      for (var i = 0; i < lista.length; i++) {
        var pos = posicoes_(lista[i].tabela);
        var pk = definicao(lista[i].tabela).pk;
        if (pos[pk] === undefined || typeof lista[i].linha !== 'number') return false;
        celulas.push({ aba: lista[i].tabela, linha: lista[i].linha, coluna: pos[pk] });
      }
      var lidos;
      try {
        lidos = p.lerCelulas(celulas);
      } catch (e) {
        console.error('Database.conferirPosicoes: leitura das células falhou; as abas serão relidas inteiras: ' + String(e && e.message ? e.message : e));
        return false;
      }
      return lista.every(function (it, k) { return lidos[k] === it.id; });
    }
    /** Registro completo (todas as colunas da definição) como voltaria da planilha: decodificar(codificar(v)). */
    function normalizar(tabela, registro) {
      var out = {};
      Object.keys(registro).forEach(function (k) { coluna_(tabela, k); });
      definicao(tabela).colunas.forEach(function (c) { out[c.nome] = normalizarValor_(c, registro[c.nome]); });
      return out;
    }
    return {
      banco: ssId,
      primitiva: primitiva,
      definicao: definicao,
      meta: function () { return p.meta(); },
      fuso: fuso,
      ler: ler,
      lerCabecalhos: lerCabecalhos,
      anexar: anexar,
      atualizar: atualizar,
      conferirPosicoes: conferirPosicoes,
      criarTabelas: criarTabelas,
      acrescentarColunas: acrescentarColunas,
      definirPropriedades: function (props) { p.definirPropriedades(props || {}); fusoLido = null; },
      flush: function () { p.flush(); },
      /** Esquece cabeçalhos e posições memorizados: obrigatório depois de escrita que falhou ou de outra execução. */
      esquecer: function () { cabecalhos = {}; ultimas = {}; fusoLido = null; },
      normalizar: normalizar,
      normalizarValor: function (tabela, coluna, valor) { return normalizarValor_(coluna_(tabela, coluna), valor); },
      paraTexto: function (tabela, coluna, valor) { return paraTexto(coluna_(tabela, coluna), valor); },
      deTexto: function (tabela, coluna, texto) { return deTexto(coluna_(tabela, coluna), texto); },
    };
  }

  // ------------------------------------------------------------------ corpus de tipos ----
  /** Definição da aba de corpus: uma coluna por tipo do codec. */
  function corpusDefinicao(nomeAba) {
    return {
      nome: nomeAba,
      pk: 'id',
      colunas: [
        { nome: 'id', tipo: 'TEXTO' }, { nome: 'texto', tipo: 'TEXTO' }, { nome: 'reescrito', tipo: 'TEXTO' },
        { nome: 'identificador', tipo: 'ID' }, { nome: 'data', tipo: 'DATA' }, { nome: 'instante', tipo: 'TS' },
        { nome: 'inteiro', tipo: 'INT' }, { nome: 'dec1', tipo: 'DEC1' }, { nome: 'dec4', tipo: 'DEC4' },
        { nome: 'dinheiro', tipo: 'DINHEIRO' }, { nome: 'sim_nao', tipo: 'BOOL' }, { nome: 'enumerado', tipo: 'ENUM' },
        { nome: 'json', tipo: 'JSON' },
      ],
    };
  }
  /** Registros esperados do corpus (forma da lógica): um por texto do CORPUS, mais um só com a chave. */
  function corpusRegistros() {
    var dinheiro = [1, 10, 30, 123456, 99999999999, 5, 0, 1999];
    var regs = CORPUS.map(function (texto, i) {
      return {
        id: 'caso-' + dois_(i + 1), texto: texto, reescrito: texto,
        identificador: '3f2b8c1e-7a4d-4e9b-9c55-0d6a1f2e8b47', data: '2026-11-13', instante: '2026-11-14T01:30:00.000Z',
        inteiro: i - 2, dec1: 387.5 + i, dec4: i % 2 ? 0.035 : 37.4501, dinheiro: dinheiro[i % dinheiro.length],
        sim_nao: i % 2 === 0, enumerado: i % 2 ? 'ATIVO' : 'N',
        json: { delimitador: ';', n: i, lista: [1, 'a', null, true], texto: texto },
      };
    });
    regs.push({ id: 'caso-vazio', texto: null, reescrito: null, identificador: null, data: null, instante: null, inteiro: null, dec1: null, dec4: null, dinheiro: null, sim_nao: null, enumerado: null, json: null });
    return regs;
  }
  /** Relê a aba de corpus com uma porta NOVA e devolve o que divergiu do esperado. */
  function conferirCorpus(ssId, primitiva, nomeAba) {
    var tabelas = {};
    tabelas[nomeAba] = corpusDefinicao(nomeAba);
    var lido = abrir(ssId, { primitiva: primitiva, tabelas: tabelas }).ler([nomeAba])[nomeAba];
    var porId = {};
    lido.registros.forEach(function (r) { porId[r.id] = r; }); // a última gravação de cada caso é a que vale
    var divergencias = [];
    var esperados = corpusRegistros();
    esperados.forEach(function (esp) {
      var reg = porId[esp.id];
      if (!reg) {
        divergencias.push({ id: esp.id, coluna: 'id', esperado: esp.id, lido: null, tipoLido: 'ausente' });
        return;
      }
      Object.keys(esp).forEach(function (c) {
        var igual = c === 'json' ? JSON.stringify(reg[c]) === JSON.stringify(esp[c]) : reg[c] === esp[c];
        if (!igual) divergencias.push({ id: esp.id, coluna: c, esperado: esp[c], lido: reg[c], tipoLido: reg[c] === null ? 'vazio' : typeof reg[c] });
      });
    });
    return { primitiva: primitiva, aba: nomeAba, ok: divergencias.length === 0 && lido.alertas.length === 0, casos: esperados.length, divergencias: divergencias, alertas: lido.alertas };
  }
  /**
   * Grava o corpus de tipos pela primitiva (anexando e, numa coluna, atualizando), descarrega, relê e devolve
   * {primitiva, aba, ok, casos, divergencias, alertas}. O setup roda numa planilha temporária e adota a primeira
   * primitiva com ok = true, na ordem de PRIMITIVAS. Erro de serviço sobe como veio: quem chama decide.
   */
  function corpus(ssId, primitiva, opcoes) {
    var nomeAba = (opcoes && opcoes.aba) || 'CORPUS_' + primitiva;
    var tabelas = {};
    tabelas[nomeAba] = corpusDefinicao(nomeAba);
    var io = abrir(ssId, { primitiva: primitiva, tabelas: tabelas });
    io.criarTabelas([nomeAba]);
    var lido = io.ler([nomeAba]); // dá a posição das linhas novas nas três primitivas
    var regs = corpusRegistros();
    var lote = {};
    lote[nomeAba] = regs.map(function (r) { var c = Utils.clonar(r); c.reescrito = null; return c; });
    var primeira = io.anexar(lote)[nomeAba];
    if (primeira === null || primeira === undefined) primeira = lido[nomeAba].ultimaLinha + 1;
    io.flush();
    io.atualizar(regs.map(function (r, i) { return { tabela: nomeAba, linha: primeira + i, campos: { reescrito: r.reescrito } }; }));
    io.flush();
    return conferirCorpus(ssId, primitiva, nomeAba);
  }

  /**
   * Roda o corpus nas primitivas, na ordem de preferência (desenho-base, seção 16.13), e devolve
   * {primitiva, resultados}: `primitiva` é a primeira com ok = true (null se nenhuma passou); `resultados` tem uma
   * entrada por primitiva tentada — o retorno de `corpus`, ou {primitiva, ok: false, erro} se o serviço falhou.
   * Para na primeira aprovada. O setup grava o resultado e mostra na tela de sistema.
   */
  function escolherPrimitiva(ssId, opcoes) {
    var resultados = [];
    for (var i = 0; i < PRIMITIVAS.length; i++) {
      var r;
      try {
        r = corpus(ssId, PRIMITIVAS[i], opcoes && opcoes.abas ? { aba: opcoes.abas[PRIMITIVAS[i]] } : null);
      } catch (e) {
        r = { primitiva: PRIMITIVAS[i], ok: false, erro: String(e && e.message ? e.message : e) };
      }
      resultados.push(r);
      if (r.ok) return { primitiva: PRIMITIVAS[i], resultados: resultados };
    }
    return { primitiva: null, resultados: resultados };
  }

  // ------------------------------------------------------------------ portas reais ----
  /** Porta Lock: lock de script. tentar(ms) espera até ms e devolve se obteve; soltar(); tem(). */
  function lock() {
    var l = null;
    function obter() {
      if (!l) l = LockService.getScriptLock();
      return l;
    }
    return {
      tentar: function (ms) { return obter().tryLock(Math.max(0, ms || 0)); },
      soltar: function () { obter().releaseLock(); },
      tem: function () { return obter().hasLock(); },
    };
  }
  /** Porta Clock: único lugar do sistema que lê o relógio. */
  function clock() {
    return {
      agoraMs: function () { return Date.now(); },
      agora: function () { return new Date().toISOString(); },
    };
  }
  /** Porta IdGen: UUID minúsculo de 36 caracteres. */
  function idGen() {
    return { uuid: function () { return Utilities.getUuid(); } };
  }
  /** Porta Hash: SHA-256 em hexadecimal minúsculo do texto em UTF-8. */
  function hash() {
    return {
      sha256Hex: function (texto) {
        return Utils.bytesParaHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8));
      },
    };
  }
  /**
   * Porta Props (Script Properties): ler() faz UM getProperties() e devolve o retrato inteiro — nunca chave a
   * chave; quem lê guarda o retrato pelo tempo do seu ponto de leitura (01, seção 5).
   */
  function props() {
    var s = null;
    function store() {
      if (!s) s = PropertiesService.getScriptProperties();
      return s;
    }
    return {
      ler: function () { return store().getProperties(); },
      gravar: function (chave, valor) { store().setProperty(chave, String(valor)); },
      remover: function (chave) { store().deleteProperty(chave); },
    };
  }
  /**
   * Monta o contexto de execução com as portas reais (docs/CONTRATOS.md, "Portas e contexto de execução").
   * opcoes: {banco, primitiva, usuario, fuso, files, session, projecoes}.
   */
  function contexto(opcoes) {
    var o = opcoes || {};
    return {
      banco: o.banco,
      io: abrir(o.banco, { primitiva: o.primitiva }),
      lock: lock(),
      clock: clock(),
      idGen: idGen(),
      hash: hash(),
      props: props(),
      files: o.files || null,
      session: o.session || null,
      projecoes: o.projecoes || null,
      usuario: o.usuario || '',
      fuso: o.fuso || Session.getScriptTimeZone(),
      errosPendentes: [],
    };
  }

  // ------------------------------------------------------------------ diagnóstico (runDiagnostics) ----
  /** Classifica o que uma célula de formato Geral devolveu, na forma de tests/fixtures/coercao.json. */
  function classificarCelula_(valor, formula, fuso) {
    var v = valor;
    if (ehData_(v)) {
      var dia = Utilities.formatDate(v, fuso, 'yyyy-MM-dd');
      if (dia === '1899-12-30') return { tipo: formula ? 'formula' : 'hora', valor: Utilities.formatDate(v, fuso, 'HH:mm:ss') };
      return { tipo: formula ? 'formula' : 'data', valor: dia };
    }
    if (!vazio_(formula)) return { tipo: 'formula', valor: v };
    if (typeof v === 'number') return { tipo: 'numero', valor: v };
    if (typeof v === 'boolean') return { tipo: 'booleano', valor: v };
    return { tipo: 'texto', valor: v === null || v === undefined ? '' : String(v) };
  }
  /**
   * SP-01 (parte "Geral"): grava o corpus por setValues em células de formato Geral de uma aba nova da planilha
   * `banco` (temporária), em pt_BR, e relê. Devolve {locale, casos: [{entrada, geral: {tipo, valor}}]} — o formato de
   * tests/fixtures/coercao.json, para comparar a hipótese do fake com a conta real. Nunca use no banco de dados.
   */
  function diagnosticoCoercao(banco, entradas) {
    var lista = entradas || CORPUS;
    var ss = SpreadsheetApp.openById(banco);
    ss.setSpreadsheetLocale('pt_BR');
    var aba = ss.insertSheet('DIAG_GERAL');
    var faixa = aba.getRange(1, 1, lista.length, 1);
    faixa.setValues(lista.map(function (e) { return [e]; }));
    SpreadsheetApp.flush();
    var valores = faixa.getValues();
    var formulas = faixa.getFormulas();
    var fuso = ss.getSpreadsheetTimeZone();
    return {
      locale: ss.getSpreadsheetLocale(),
      casos: lista.map(function (e, i) { return { entrada: e, geral: classificarCelula_(valores[i][0], formulas[i][0], fuso) }; }),
    };
  }
  /**
   * SP-01 (atomicidade): numa aba nova da planilha temporária `banco`, grava A1 = "inicial"; depois manda UM
   * Spreadsheets.batchUpdate com uma escrita válida (A1 = "alterado") e um pedido inválido (aba inexistente). Atômico =
   * a requisição falhou e A1 continua "inicial". Devolve {atomico, recusou, lido, erro}.
   */
  function diagnosticoAtomicidade(banco) {
    var r = Sheets.Spreadsheets.batchUpdate({ requests: [{ addSheet: { properties: { title: 'DIAG_ATOMICO', gridProperties: { rowCount: 2, columnCount: 2 } } } }] }, banco);
    var sheetId = r.replies[0].addSheet.properties.sheetId;
    var escrever = function (id, texto) {
      return { updateCells: { start: { sheetId: id, rowIndex: 0, columnIndex: 0 }, rows: [{ values: [{ userEnteredValue: { stringValue: texto } }] }], fields: 'userEnteredValue' } };
    };
    Sheets.Spreadsheets.batchUpdate({ requests: [escrever(sheetId, 'inicial')] }, banco);
    var recusou = false;
    var erro = null;
    try {
      Sheets.Spreadsheets.batchUpdate({ requests: [escrever(sheetId, 'alterado'), escrever(sheetId + 7919, 'invalido')] }, banco);
    } catch (e) {
      recusou = true;
      erro = String(e && e.message ? e.message : e).slice(0, 200);
    }
    var lido = Sheets.Spreadsheets.Values.get(banco, 'DIAG_ATOMICO!A1', { valueRenderOption: 'UNFORMATTED_VALUE' });
    var valor = lido.values && lido.values[0] ? lido.values[0][0] : '';
    return { atomico: recusou && valor === 'inicial', recusou: recusou, lido: valor, erro: erro };
  }
  /** Runtime V8: `Intl` com fuso (usado por Utils.hoje) × Utilities.formatDate, no mesmo instante. */
  function diagnosticoFuso(instante, fuso) {
    return { utilities: Utilities.formatDate(new Date(Date.parse(instante)), fuso, 'yyyy-MM-dd'), utils: Utils.hoje(instante, fuso) };
  }

  return {
    PRIMITIVAS: PRIMITIVAS,
    CORPUS: CORPUS,
    abrir: abrir,
    codificar: codificar,
    decodificar: decodificar,
    paraTexto: paraTexto,
    deTexto: deTexto,
    corpus: corpus,
    escolherPrimitiva: escolherPrimitiva,
    conferirCorpus: conferirCorpus,
    corpusDefinicao: corpusDefinicao,
    corpusRegistros: corpusRegistros,
    lock: lock,
    clock: clock,
    idGen: idGen,
    hash: hash,
    props: props,
    contexto: contexto,
    diagnosticoCoercao: diagnosticoCoercao,
    diagnosticoAtomicidade: diagnosticoAtomicidade,
    diagnosticoFuso: diagnosticoFuso,
  };
})();
