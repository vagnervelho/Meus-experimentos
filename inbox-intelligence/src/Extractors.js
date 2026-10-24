/**
 * Extratores heurísticos puros (pt-BR/en): datas, prazos, valores, remuneração,
 * redação de PII, sinais de prompt injection, frases de ação, resumo extrativo,
 * sinais de vaga e casamento de interesses.
 *
 * Determinismo: nada aqui consulta o relógio; datas relativas dependem só de `refYmd`.
 * Os padrões rodam sobre um texto "dobrado" (minúsculo, sem acento) com o MESMO
 * comprimento do original, de modo que índices, `raw` e `evidence` são recortados
 * do texto original e continuam verificáveis por `containsNormalized`.
 */
var Extractors = (function () {
  // ------------------------------------------------------------ texto ----
  var foldCache_ = {};

  /** Minúsculas sem acento preservando o comprimento (posição i do resultado = posição i do original). */
  function fold(s) {
    var str = String(s == null ? '' : s);
    if (!/[^\x00-\x7f]/.test(str)) return str.toLowerCase();
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var f = foldCache_[ch];
      if (f === undefined) {
        var l = ch.toLowerCase();
        var d = Util.stripDiacritics(l);
        f = d.length === 1 ? d : l.length === 1 ? l : ch;
        foldCache_[ch] = f;
      }
      out += f;
    }
    return out;
  }

  function str_(s) {
    return String(s == null ? '' : s);
  }

  function eachMatch_(re, s, fn) {
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(s)) !== null) {
      if (m[0] === '') {
        re.lastIndex++;
        continue;
      }
      fn(m);
    }
  }

  /** Trecho do original ao redor de [start, end), ajustado a fronteiras de palavra e com espaços colapsados. */
  function snippet_(orig, start, end, pad) {
    var a = Math.max(0, start - pad);
    var b = Math.min(orig.length, end + pad);
    if (a > 0) {
      var sp = orig.slice(a, start).search(/\s/);
      if (sp >= 0) a += sp + 1;
    }
    if (b < orig.length) {
      var lastSp = orig.slice(end, b).search(/\s\S*$/);
      if (lastSp >= 0) b = end + lastSp;
    }
    return orig.slice(a, b).replace(/\s+/g, ' ').trim();
  }

  /** Seleciona candidatos sem sobreposição: o que começa antes vence; no empate, o mais longo. */
  function resolveOverlaps_(cands) {
    cands.sort(function (x, y) {
      return x.start - y.start || y.end - y.start - (x.end - x.start);
    });
    var out = [];
    var lastEnd = -1;
    cands.forEach(function (c) {
      if (c.start >= lastEnd) {
        out.push(c);
        lastEnd = c.end;
      }
    });
    return out;
  }

  // ------------------------------------------------------------ datas ----
  var MONTHS = {
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10,
    novembro: 11, dezembro: 12, jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11,
    dez: 12, january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10,
    november: 11, december: 12, feb: 2, apr: 4, aug: 8, sep: 9, sept: 9, oct: 10, dec: 12,
  };
  var MONTHS_EN = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10,
    november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };
  var WEEKDAYS = {
    segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, domingo: 7,
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
  };
  var NUM_WORDS = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    quinze: 15, vinte: 20, trinta: 30, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fifteen: 15, thirty: 30,
  };

  function altOf_(obj) {
    return Object.keys(obj).sort(function (a, b) {
      return b.length - a.length;
    }).join('|');
  }
  var MONTH_ALT = altOf_(MONTHS);
  var MONTH_EN_ALT = altOf_(MONTHS_EN);
  var NUM_WORD_ALT = altOf_(NUM_WORDS);

  var ORD = '(?:º|ª|°|o|st|nd|rd|th)?';
  var DM_SEP = '(?:\\s*(?:de|of)\\s+|\\s*[-/]\\s*|\\s+)';
  var RE_ISO = /(\d{4})-(\d{2})-(\d{2})/g;
  var RE_DMY = /(\d{1,2})([\/.\-])(\d{1,2})\2(\d{4}|\d{2})/g;
  var RE_DM = /(\d{1,2})\/(\d{1,2})/g;
  var RE_DAY_MONTH_Y = new RegExp('\\b(\\d{1,2})' + ORD + DM_SEP + '(' + MONTH_ALT + ')(?![a-z])\\.?(?:\\s*(?:,|de|of)\\s*|\\s*[-/]\\s*|\\s+)(\\d{4})(?!\\d|[-/.]\\d)', 'g');
  var RE_DAY_MONTH = new RegExp('\\b(\\d{1,2})' + ORD + DM_SEP + '(' + MONTH_ALT + ')(?![a-z])', 'g');
  var RE_MONTH_DAY_Y = new RegExp('\\b(' + MONTH_EN_ALT + ')(?![a-z])\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])\\s*,?\\s*(\\d{4})(?!\\d|[-/.]\\d)', 'g');
  var RE_MONTH_DAY = new RegExp('\\b(' + MONTH_EN_ALT + ')(?![a-z])\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:a-z])', 'g');
  var RE_WEEKDAY = new RegExp(
    '(?:\\b((?:ate|by|until|till|na|no|nesta|neste|nessa|nesse|esta|este|essa|esse|desta|deste|this|on|coming|para a|para o|para|em|a partir de|a partir da|a partir do)\\s+))?' +
      '(?:\\b(proxima|proximo|next)\\s+)?\\b(' + altOf_(WEEKDAYS) + ')((?:[- ]feira)?)(?![a-z])' +
      '(\\s+(?:da\\s+)?(?:semana\\s+)?que\\s+vem|\\s+(?:of\\s+)?next\\s+week)?',
    'g'
  );
  // Ordinais pt que não são dia da semana ("segunda via", "na quinta etapa").
  var RE_ORDINAL_NOUN = /^\s+(?:via|vez|etapa|fase|parcela|opcao|edicao|chamada|tentativa|rodada|colocacao|lugar|posicao|serie|temporada|turma|geracao|instancia|mao|classe|pessoa|onda|dose|metade|parte|sessao|aula|reuniao|semana|lista|versao|feira)\b/;
  var RELATIVE = [
    { re: /\bdepois de amanha\b|\bday after tomorrow\b/g, kind: 'offset', n: 2 },
    { re: /\bamanha\b|\btomorrow\b/g, kind: 'offset', n: 1 },
    { re: /\bhoje\b|\btoday\b|\btonight\b/g, kind: 'offset', n: 0 },
    // "EOD"/"fim do dia" sozinho = hoje; colado a outro dia ("tomorrow EOD") só qualifica aquele dia.
    { re: /\beod\b|\bend of (?:the |business )?day\b|\b(?:fim|final) do dia\b/g, kind: 'offset', n: 0, eod: true },
    { re: /\b(?:fim|final) de semana\b|\b(?:this |the )?weekend\b/g, kind: 'weekend' },
    { re: /\bsemana que vem\b|\bproxima semana\b|\bnext week\b/g, kind: 'nextWeek' },
    { re: /\b(?:n?esta|n?essa|desta) semana\b|\bthis week\b|\b(?:fim|final) da semana\b|\bend of (?:the |this )?week\b/g, kind: 'thisWeek' },
    { re: /\b(?:fim|final) (?:do|deste|desse) mes\b|\bultimo dia do mes\b|\bend of (?:the |this )?month\b/g, kind: 'endMonth' },
    {
      re: new RegExp('\\b(?:em ate|em|dentro de|nos proximos|no prazo de|prazo de|in the next|over the next|within|in)\\s+(\\d{1,3}|' + NUM_WORD_ALT + ')\\s+(dias?|days?|semanas?|weeks?)\\b(?:\\s+(?:uteis|corridos|business))?', 'g'),
      kind: 'inDays',
    },
    { re: /\b(?:nas proximas|em ate|em|dentro de|in the next|within|in|next)\s+(\d{1,3})\s*(?:horas|hours|hrs?|h)\b/g, kind: 'inHours' },
  ];
  // Palavras que tornam aceitável um "dd/mm" sem zero à esquerda (até 15 caracteres antes).
  var RE_DATE_CUE = /(?:^|[^a-z])(?:ate|dia|em|de|vence|vencem|vencimento|prazo|data|para|entre|a partir de|valido|valida|from|on|until|by|due|starting|reuniao|evento|consulta|voo|entrevista|meeting|hoje|amanha|ontem|today|tomorrow|yesterday|segunda|terca|quarta|quinta|sexta|sabado|domingo|feira|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?![a-z])/;
  var RE_SCORE_BEFORE = /(?:^|[^a-z])(?:nota|notas|placar|score|rating|avaliacao|estrelas|pontuacao|resultado|jogo|partida|fracao|razao|proporcao|media)(?![a-z])/;
  var RE_SCORE_AFTER = /^\s*(?:estrelas|pontos|stars|points|votos|gols|acertos|questoes|do total|of total)\b/;

  var TIME_ALT =
    '(\\d{1,2})(?:[:h](\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)(?![a-z])' +
    '|(\\d{1,2}):(\\d{2})(?:\\s*(?:hs|hrs|h)(?![a-z]))?' +
    '|(\\d{1,2})\\s?(?:hrs|hs|h)(\\d{2})?(?![a-z\\d])' +
    '|(\\d{1,2})\\s+horas(?![a-z])';
  var RE_TIME_AFTER = new RegExp(
    '^(?:t(?=\\d)|[\\s,;\\-–]|\\([^)]{0,20}\\))*(?:(?:a partir das?|ate as|ate|por volta das?|starting at|as|das|at|from|by|until|till|@)\\s*)?(?:' + TIME_ALT + ')'
  );
  var RE_TIME_BEFORE = new RegExp('(?:^|[^\\d:])(?:' + TIME_ALT + ')\\s*[,\\-]?\\s*(?:(?:de|do|da|no|na|on|of)\\s+)?(?:dia\\s+)?$');

  function timeFromMatch_(m) {
    var h;
    var mi = 0;
    if (m[1] !== undefined) {
      h = Number(m[1]);
      mi = m[2] ? Number(m[2]) : 0;
      var pm = m[3].charAt(0) === 'p';
      if (h < 1 || h > 12) return '';
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    } else if (m[4] !== undefined) {
      h = Number(m[4]);
      mi = Number(m[5]);
    } else if (m[6] !== undefined) {
      h = Number(m[6]);
      mi = m[7] ? Number(m[7]) : 0;
    } else if (m[8] !== undefined) {
      h = Number(m[8]);
    } else {
      return '';
    }
    if (h > 23 || mi > 59) return '';
    return Util.pad2(h) + ':' + Util.pad2(mi);
  }

  /** Hora logo depois (preferida) ou logo antes de uma data. */
  function findTime_(f, start, end, prevEnd, nextStart) {
    var after = RE_TIME_AFTER.exec(f.slice(end, Math.min(nextStart, end + 40)));
    if (after) {
      var t = timeFromMatch_(after);
      if (t) return { time: t, end: end + after[0].length };
    }
    var before = RE_TIME_BEFORE.exec(f.slice(Math.max(0, prevEnd, start - 25), start));
    if (before) {
      var t2 = timeFromMatch_(before);
      if (t2) return { time: t2, end: end };
    }
    return { time: '', end: end };
  }

  function ymdOf_(y, mo, d) {
    var s = y + '-' + Util.pad2(mo) + '-' + Util.pad2(d);
    return Util.isValidYmd(s) ? s : '';
  }

  /** Ano para datas sem ano: o que coloca a data em [ref − 7, ref + 358] dias. */
  function inferYear_(mo, d, ref) {
    if (!ref) return '';
    var y = Number(ref.slice(0, 4));
    var tries = [y, y + 1, y - 1];
    for (var i = 0; i < tries.length; i++) {
      var s = ymdOf_(tries[i], mo, d);
      if (!s) continue;
      var diff = Util.daysBetween(ref, s);
      if (diff >= -7 && diff <= 358) return s;
    }
    return '';
  }

  function validYear_(y) {
    return y >= 1990 && y <= 2100;
  }

  /** Números "soltos": não fazem parte de um número maior, fração, URL ou valor. */
  function numBoundaryOk_(f, start, end) {
    var p = start > 0 ? f.charAt(start - 1) : '';
    var pp = start > 1 ? f.charAt(start - 2) : '';
    if (/[\d\/]/.test(p)) return false;
    if (/[.,\-:]/.test(p) && /\d/.test(pp)) return false;
    var n = f.charAt(end);
    var nn = f.charAt(end + 1);
    if (/[\d\/]/.test(n)) return false;
    if (/[.,\-:]/.test(n) && /\d/.test(nn)) return false;
    return true;
  }

  function weekdayDate_(ref, w, mode) {
    var rw = Util.isoWeekday(ref);
    if (mode === 'nextWeek') return Util.addDays(ref, 7 - rw + w);
    var d = (w - rw + 7) % 7;
    if (d === 0 && mode === 'strict') d = 7;
    return Util.addDays(ref, d);
  }

  // Períodos sem dia definido ("semana que vem", "fim do mês", "em 5 dias"): servem de prazo, não de agenda.
  var VAGUE_KINDS = { weekend: true, thisWeek: true, nextWeek: true, endMonth: true, inDays: true, inHours: true };

  function relativeDate_(spec, m, ref) {
    var rw = Util.isoWeekday(ref);
    switch (spec.kind) {
      case 'offset':
        return Util.addDays(ref, spec.n);
      case 'weekend':
        return weekdayDate_(ref, 6, 'incl');
      case 'thisWeek':
        return rw >= 6 ? ref : Util.addDays(ref, 5 - rw);
      case 'nextWeek':
        return Util.addDays(ref, 12 - rw);
      case 'endMonth':
        var y = Number(ref.slice(0, 4));
        var mo = Number(ref.slice(5, 7));
        return ymdOf_(y, mo, Util.daysInMonth(y, mo));
      case 'inDays':
        var n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]] || 0;
        if (/^(semana|week)/.test(m[2])) n *= 7;
        return n > 0 && n <= 400 ? Util.addDays(ref, n) : '';
      case 'inHours':
        var h = Number(m[1]);
        return h > 0 && h <= 240 ? Util.addDays(ref, Math.floor(h / 24)) : '';
    }
    return '';
  }

  // Entre um relativo e a data absoluta que o explica: pontuação curta e, no máximo, o dia da semana.
  var RE_GAP_REL_ABS = new RegExp('^[\\s,(\\-–—:]{0,4}(?:(?:' + altOf_(WEEKDAYS) + ')(?:[- ]feira)?[\\s,()\\-–—:]{0,4})?$');

  /**
   * "amanhã (22/10)", "hoje, 21/10/2026", "amanhã, sexta-feira (23/10)" e "22/10 (amanhã)": a data absoluta
   * prevalece (absolute = true) e herda o início do relativo, para que a palavra de prazo antes dele valha.
   * Só funde quando as duas leituras diferem em ≤ 1 dia (listas "hoje, 25/10 e 30/10" continuam separadas).
   */
  function mergeRelativeAbsolute_(f, list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var n = list[i + 1];
      if (n && !c.absolute && n.absolute && RE_GAP_REL_ABS.test(f.slice(c.end, n.start)) && Math.abs(Util.daysBetween(c.date, n.date)) <= 1) {
        if (f.slice(c.end, n.start).indexOf('(') >= 0 && f.charAt(n.end) === ')') n.end++;
        n.start = c.start;
        continue;
      }
      var p = out[out.length - 1];
      if (p && p.absolute && !c.absolute && /^\s*\(\s*$/.test(f.slice(p.end, c.start)) && f.charAt(c.end) === ')' && Math.abs(Util.daysBetween(p.date, c.date)) <= 1) {
        p.end = c.end + 1;
        continue;
      }
      out.push(c);
    }
    return out;
  }

  /** "tomorrow EOD", "amanhã até o fim do dia", "EOD tomorrow": o EOD só qualifica o dia ao lado. */
  function mergeEod_(f, list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var p = out[out.length - 1];
      var n = list[i + 1];
      if (c.eod && p && !p.eod && /^\s+(?:(?:no|ao|at|by|ate o|ate|o|the|in the)\s+)?$/.test(f.slice(p.end, c.start))) {
        p.end = c.end;
        continue;
      }
      if (c.eod && n && !n.eod && /^\s+(?:(?:de|on|of)\s+)?$/.test(f.slice(c.end, n.start))) {
        n.start = c.start;
        continue;
      }
      out.push(c);
    }
    return out;
  }

  /**
   * Varredura interna de datas. Cada item: {start, end (fim da data), rawEnd (inclui hora), date, time, absolute}.
   */
  function scanDates_(text, refYmd) {
    var orig = str_(text);
    var f = fold(orig);
    var ref = Util.isValidYmd(refYmd) ? refYmd : '';
    var cands = [];
    function add(start, end, date, absolute, extra) {
      if (!date) return;
      var c = { start: start, end: end, date: date, absolute: absolute, weekday: false };
      if (extra) Object.keys(extra).forEach(function (k) { c[k] = extra[k]; });
      cands.push(c);
    }

    eachMatch_(RE_ISO, f, function (m) {
      var s = m.index;
      var e = s + m[0].length;
      if (f.charAt(e) === 't' ? /[\d\/]/.test(f.charAt(s - 1)) : !numBoundaryOk_(f, s, e)) return;
      if (validYear_(Number(m[1]))) add(s, e, ymdOf_(Number(m[1]), Number(m[2]), Number(m[3])), true);
    });
    eachMatch_(RE_DMY, f, function (m) {
      var s = m.index;
      var e = s + m[0].length;
      if (!numBoundaryOk_(f, s, e)) return;
      if (m[2] !== '/' && m[4].length !== 4) return;
      var y = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
      if (validYear_(y)) add(s, e, ymdOf_(y, Number(m[3]), Number(m[1])), true);
    });
    eachMatch_(RE_DM, f, function (m) {
      var s = m.index;
      var e = s + m[0].length;
      if (!numBoundaryOk_(f, s, e)) return;
      var d = Number(m[1]);
      var mo = Number(m[2]);
      if (d < 1 || d > 31 || mo < 1 || mo > 12) return;
      if ((d === 24 && mo === 7) || (d === 7 && mo === 24)) return;
      var p = f.charAt(s - 1);
      if (p === '$' || f.charAt(e) === '%' || f.charAt(e) === 'x') return;
      var before = f.slice(Math.max(0, s - 20), s);
      var leadingZero = (m[1].length === 2 && m[1].charAt(0) === '0') || (m[2].length === 2 && m[2].charAt(0) === '0');
      // Placar/nota ("partida 2/1", "nota 4/5") não usa zero à esquerda: "partida 02/11" é data.
      if (!leadingZero && (RE_SCORE_BEFORE.test(before) || RE_SCORE_AFTER.test(f.slice(e, e + 15)))) return;
      var cued = leadingZero || RE_DATE_CUE.test(f.slice(Math.max(0, s - 15), s)) || RE_TIME_AFTER.test(f.slice(e, e + 20));
      if (!cued) return;
      add(s, e, inferYear_(mo, d, ref), true);
    });
    function monthWordOk(f2, monthEnd, token) {
      // "3 out of 5", "a set of": abreviação seguida de "of" não é mês.
      return !(/^(out|set|mar|may)$/.test(token) && /^\s+of\b/.test(f2.slice(monthEnd, monthEnd + 5)));
    }
    function prevOk(s) {
      var p = f.charAt(s - 1);
      return !(p === ':' || ((p === '.' || p === ',') && /\d/.test(f.charAt(s - 2))));
    }
    eachMatch_(RE_DAY_MONTH_Y, f, function (m) {
      var s = m.index;
      if (!prevOk(s)) return;
      var y = Number(m[3]);
      if (validYear_(y)) add(s, s + m[0].length, ymdOf_(y, MONTHS[m[2]], Number(m[1])), true);
    });
    eachMatch_(RE_DAY_MONTH, f, function (m) {
      var s = m.index;
      var e = s + m[0].length;
      if (!prevOk(s) || !monthWordOk(f, e, m[2])) return;
      // Abreviação com ponto ("20 de nov. às 19h") inclui o ponto.
      if (m[2].length <= 4 && m[2] !== 'maio' && f.charAt(e) === '.' && /^\.\s*[a-z\d(,]/.test(f.slice(e, e + 3))) e++;
      add(s, e, inferYear_(MONTHS[m[2]], Number(m[1]), ref), true);
    });
    eachMatch_(RE_MONTH_DAY_Y, f, function (m) {
      var y = Number(m[3]);
      if (validYear_(y)) add(m.index, m.index + m[0].length, ymdOf_(y, MONTHS_EN[m[1]], Number(m[2])), true);
    });
    eachMatch_(RE_MONTH_DAY, f, function (m) {
      add(m.index, m.index + m[0].length, inferYear_(MONTHS_EN[m[1]], Number(m[2]), ref), true);
    });

    if (ref) {
      eachMatch_(RE_WEEKDAY, f, function (m) {
        var s = m.index;
        var e = s + m[0].length;
        var day = m[3];
        var w = WEEKDAYS[day];
        var hasFeira = !!m[4];
        var ptAmbiguous = w <= 5 && !/day$/.test(day) && !hasFeira;
        if (ptAmbiguous) {
          if (!m[1] && !m[2] && !m[5]) return;
          if (!m[5] && RE_ORDINAL_NOUN.test(f.slice(e, e + 15))) return;
        }
        var suffix = m[5] || '';
        var mode = /semana|week/.test(suffix) ? 'nextWeek' : m[2] || suffix ? 'strict' : 'incl';
        add(s, e, weekdayDate_(ref, w, mode), false, { weekday: true });
      });
      RELATIVE.forEach(function (spec) {
        eachMatch_(spec.re, f, function (m) {
          add(m.index, m.index + m[0].length, relativeDate_(spec, m, ref), false, spec.eod ? { eod: true } : VAGUE_KINDS[spec.kind] ? { vague: true } : null);
        });
      });
    }

    var list = resolveOverlaps_(cands);
    // "sexta-feira, 25/10" ou "25/10 (sexta)": o dia da semana só repete a data absoluta.
    list = list.filter(function (c, i) {
      if (!c.weekday) return true;
      var next = list[i + 1];
      var prev = list[i - 1];
      if (next && next.absolute && /^[\s,(]{0,4}$/.test(f.slice(c.end, next.start))) return false;
      if (prev && prev.absolute && /^[\s,(]{0,4}$/.test(f.slice(prev.end, c.start))) return false;
      return true;
    });
    list = mergeEod_(f, mergeRelativeAbsolute_(f, list));
    list.forEach(function (c, i) {
      var t = findTime_(f, c.start, c.end, i > 0 ? list[i - 1].rawEnd : 0, i + 1 < list.length ? list[i + 1].start : f.length);
      c.time = t.time;
      c.rawEnd = t.end;
    });
    return { orig: orig, f: f, ref: ref, list: list };
  }

  /**
   * Datas mencionadas no texto (absolutas e relativas a `refYmd`), na ordem do texto.
   * @return {{date: string, time: string, index: number, raw: string, absolute: boolean}[]}
   */
  function findDates(text, refYmd) {
    var scan = scanDates_(text, refYmd);
    return scan.list.map(function (c) {
      return { date: c.date, time: c.time, index: c.start, raw: scan.orig.slice(c.start, c.rawEnd).trim(), absolute: c.absolute };
    });
  }

  // ----------------------------------------------------------- prazos ----
  // Palavras de prazo fortes: valem até 40 caracteres antes da data (ou dentro do núcleo data+hora).
  var RE_DL_STRONG = /(?:^|[^a-z])(prazo|vence|vencem|venceu|vencimento|data limite|data-limite|deadline|due date|due|ultimo dia|last day|no later than|expira|expiram|expiracao|expires?|encerra|encerram|encerramento|termina|terminam|acaba|acabam|closes|ends|valid until|validos?|validas?|validade|data de entrega)(?![a-z])/g;
  // Conectivos fracos ("até", "by"): só colados à data (≤ 20 caracteres antes), senão "até logo", "sent by".
  var RE_DL_NEAR = /(?:^|[^a-z])(ate|by|until|till|inscricoes)(?![a-z])/g;
  var END_VERBS = { encerra: 1, encerram: 1, encerramento: 1, termina: 1, terminam: 1, acaba: 1, acabam: 1, closes: 1, ends: 1 };
  var VALID_WORDS = { 'valid until': 1, valido: 1, validos: 1, valida: 1, validas: 1, validade: 1 };
  // "até 70% OFF", "em até 12x", "até R$ 500": "até" de quantidade, não de prazo.
  var RE_QTY_ATE = /(^|[^a-z])ate(?=\s+(?:\d+(?:[.,]\d+)?\s*(?:%|x(?![a-z])|vezes|parcelas|meses|anos|pessoas|itens|unidades|reais|mil(?![a-z]))|r\$|us\$|€|\$))/g;
  var RE_BY_AGENT = /(?:[a-z]+(?:ed|en)|powered|sent|made|run|led|built|brought|shared|written)\s+$/;
  var RE_EVENT_WORD = /(?:^|[^a-z])(?:reuniao|reunioes|meeting|call|chat|conversa|bate-papo|bate papo|evento|event|consulta|appointment|voo|flight|check-in|checkin|check in|check-out|checkout|embarque|boarding|partida|webinar|webinario|palestra|talk|workshop|live|entrevista|interview|aula|prova|apresentacao|conferencia|conference|agendad[oa]|agendamento|marcad[oa]|sessao|session|encontro|almoco|jantar|cafe|visita|vistoria|demo|kickoff|kick-off|treinamento|curso|ingresso|show|convite|convidad[oa]s?|convidou|invite|invitation|invited|assembleia|convocad[oa]s?|convocacao|meetup|town hall|all hands|all-hands|happy hour|festa|comemoracao|casamento|cerimonia|formatura|churrasco|audiencia|hearing|plantao|culto|missa|cinema|teatro|reserva|hospedagem|nos vemos|te espero|te vejo|see you|quando:|onde:|local:|when:|where:|location:)(?![a-z])/;
  var RE_SENTENCE_END = /[!?\n;]|\.(?=\s|$)/g;
  // Validade de acesso (link/código/token) — informativa, não é prazo do dono.
  var RE_ACCESS_VALIDITY = /(?:^|[^a-z])(?:link|links|codigo|codigos|code|token|otp|pin|senha temporaria|senha provisoria|sessao|session|url|botao|button|qr ?code|chave de acesso|convite|invitation|invite)(?![a-z])[^.!?\n]{0,60}(?:expira|expiram|expirara|expires?|expirar|validos?|validas?|validade|valid|deixara de funcionar|sera desativad[oa])(?![a-z])/;
  // Compromisso do REMETENTE com o dono (SLA, previsão): "será creditado em até 7 dias úteis".
  var RE_THIRD_PARTY = /(?:^|[^a-z])(?:(?:sera|serao|will be|should be|is expected to be)\s+(?:[a-z]+\s+){0,2}?(?:creditad|estornad|reembolsad|devolvid|entregue|enviad|despachad|postad|processad|analisad|respondid|liberad|disponibilizad|depositad|transferid|efetivad|refunded|credited|delivered|shipped|processed|reviewed|returned|deposited|released)|(?:voce|you)\s+(?:recebera|vai receber|will receive|should receive|ll receive)|retornaremos|responderemos|entraremos em contato|enviaremos|creditaremos|devolveremos|analisaremos|processaremos|entregaremos|we(?: will|'ll) (?:ship|send|deliver|refund|credit|process|review|respond|reply|get back|contact|notify|return)|previsao de (?:entrega|chegada|credito|pagamento|devolucao|reembolso|estorno|conclusao)|(?:entrega|chegada|credito|reembolso|estorno|devolucao) (?:prevista|previsto|estimad[oa])|prazo (?:de|para) (?:o )?(?:estorno|reembolso|analise|resposta|processamento|credito|devolucao|compensacao)|expected (?:delivery|arrival)|estimated (?:delivery|arrival))/;
  // Entrega ambígua (tarefa × encomenda): só é do remetente com vocabulário de envio por perto.
  var RE_DELIVERY_AMBIG = /(?:^|[^a-z])(?:(?:data|prazo) de entrega|entrega ate|chega|chegara|arrives?|delivery (?:date|by))(?![a-z])/;
  var RE_SHIPPING = /(?:^|[^a-z])(?:pedido|encomenda|pacote|frete|rastreio|rastreamento|transportadora|correios|entregador|order|package|shipment|shipping|tracking|courier|parcel)(?![a-z])/;
  // Linguagem de oferta/escassez: a data é validade da promoção, não obrigação do dono.
  var RE_OFFER = /(?:^|[^a-z])(?:ofertas?|promocao|promocoes|promocional|promos?|cupom|cupons|descontos?|liquidacao|saldao|queima de estoque|black friday|cyber monday|frete gratis|brindes?|cashback|premios?|sorteios?|resgat(?:e|ar) (?:seus?|suas?|os?|as?) (?:premios?|pontos|cupom|cupons|bonus|brindes?|presentes?|cashback|beneficios?)|condic(?:ao|oes) (?:especia(?:l|is)|validas?)|precos? especia(?:l|is)|aproveite|garanta|corra|nao perca|ultima chance|ultimas (?:vagas|unidades|horas)|vagas limitadas|so hoje|somente hoje|apenas hoje|so ate|somente ate|enquanto durarem|tempo limitado|pre-aprovad[oa]|deals?|discounts?|coupons?|(?:special|exclusive|limited(?:-time)?) offers?|promo codes?|last chance|limited time|only today|today only|early bird)(?![a-z])|\d+\s*% ?(?:off|de desconto)/;
  // Obrigação do dono colada à data: vence sobre a linguagem de oferta ("pague até 30/10 e ganhe desconto").
  var RE_OBLIGATION = /(?:^|[^a-z])(?:vence|vencem|venceu|vencimento|pague|pagar|fatura|boleto|mensalidade|due|invoice|pay|sign|submit|reply|respond|prazo para|deve ser|devem ser|envie|enviar|responda|responder|entregue|entregar|assine|assinar|preencha|preencher)(?![a-z])/;
  // Registro de algo que já aconteceu (transação, alerta, envio): não é compromisso.
  var RE_RECORD = /(?:^|[^a-z])(?:(?:foi|foram|was|were|has been|have been|had been)\s+(?:[a-z]+\s+)?(?:[a-z]+(?:ad[oa]s?|id[oa]s?|ed|en|eit[oa]s?|ost[oa]s?|ert[oa]s?)|entregues?|pag[oa]s?|feit[oa]s?|vist[oa]s?)|enviou|recebeu|pagou|comprou|realizou|efetuou|fez|acessou|alterou|solicitou|transferiu|emitiu|cancelou|mandei|enviei|falei|recebi|fiz|liguei|encaminhei|conversamos|falamos|identificamos|detectamos|bloqueamos|recebemos|registramos|aprovamos|processamos|realizamos|enviamos|notamos|(?:realizad|efetuad|registrad|emitid|enviad|recebid|aprovad|postad|concluid|processad|detectad|identificad|cancelad|alterad|gerad)[oa]s?|noticed|detected|received|sent|paid|completed|processed|signed in|logged in)(?![a-z])/;
  var RE_RECORD_WIDE = /(?:^|[^a-z])(?:enviou|recebeu|pix (?:enviado|recebido)|transacao|transferencia|comprovante|extrato|compra (?:aprovada|realizada)|pagamento (?:aprovado|confirmado|realizado|efetuado|recebido)|login|senha|alterad[oa]|detectad[oa]|identificamos|recibo|nota fiscal|nf-?e|estabelecimento|autenticacao)(?![a-z])/;
  var RE_DATE_LABEL_LINE = /^\s*(?:data|dia|date|horario|hora)\s*:?\s*$/;
  // Pedido na frase: torna prazo uma data relativa sem palavra de prazo ("me manda hoje", "send it tomorrow").
  var RE_REQUEST_SENT = /(?:^|[^a-z])(?:preciso que|precisamos que|preciso d[aeo]s?|preciso receber|poderia|poderiam|pode me|podem me|pode nos|voce pode|voces podem|consegue|conseguiria|conseguem|por favor|favor|gentileza|please|could you|can you|would you|need you to|i need|we need|send me|let me know|(?:me|nos) (?:manda|mande|envia|envie|avisa|avise|fala|fale|passa|passe|responde|responda|confirma|confirme|liga|ligue|retorna|retorne|diz|diga|encaminha|encaminhe)|envie|mande|encaminhe|confirme|responda|retorne|revise|aprove|assine|preencha|pague|devolva|providencie|regularize|atualize)(?![a-z])/;
  var RE_NEGATED_VERB = /(?:^|[^a-z])(?:nao|nunca|never|do not|don't|dont)\s+(?:me\s+|nos\s+|lhe\s+)?[a-z]+/g;
  var RE_OBLIGATION_VERB = /(?:^|[^a-z])(?:enviar|mandar|encaminhar|responder|confirmar|pagar|entregar|assinar|send|reply|submit|deliver|pay|sign)(?![a-z])/;
  var RE_BUSINESS_HOURS = /(?:^|[^a-z])(?:atendimento|funciona|funcionamento|aberto|aberta|abrimos|fechamos|expediente|horario de|plantao|open|hours|loja|lojas|das \d{1,2}|de segunda a|seg a sex)(?![a-z])/;
  var RE_TIME_DEADLINE = new RegExp('(?:^|[^a-z\\d])((?:ate as|ate|by|until|till)\\s*)(?:' + TIME_ALT + ')', 'g');

  function windowBefore_(f, start, limitStart, n) {
    var a = Math.max(0, limitStart, start - n);
    var w = f.slice(a, start);
    var cut = -1;
    eachMatch_(RE_SENTENCE_END, w, function (m) {
      cut = m.index;
    });
    return cut >= 0 ? w.slice(cut + 1) : w;
  }

  function windowAfter_(f, end, limitEnd, n) {
    var w = f.slice(end, Math.min(limitEnd, end + n));
    RE_SENTENCE_END.lastIndex = 0;
    var m = RE_SENTENCE_END.exec(w);
    return m ? w.slice(0, m.index) : w;
  }

  function blank_(s) {
    return s.replace(/[^\n]/g, ' ');
  }

  /** Palavras de prazo antes da data (`before`, já limitado à frase) e no núcleo data+hora. */
  function deadlineWords_(before, core) {
    var far = (before + ' ' + core).replace(RE_QTY_ATE, function (m, p) {
      return p + '   ';
    });
    var coreStart = far.length - core.length;
    var r = { strong: false, near: false, endOnly: true, validOnly: true };
    eachMatch_(RE_DL_STRONG, far, function (m) {
      var tok = m[1];
      var at = m.index + m[0].length;
      if (tok === 'due' && /^\s+to\b/.test(far.slice(at))) return;
      r.strong = true;
      if (!END_VERBS[tok]) r.endOnly = false;
      if (!VALID_WORDS[tok]) r.validOnly = false;
    });
    eachMatch_(RE_DL_NEAR, far, function (m) {
      var tokStart = m.index + m[0].length - m[1].length;
      if (tokStart < coreStart - 20) return;
      if (m[1] === 'by' && RE_BY_AGENT.test(far.slice(Math.max(0, tokStart - 25), tokStart))) return;
      r.near = true;
      r.endOnly = false;
      // "válido até" é uma expressão só: o "até" não transforma validade em obrigação.
      if (!/(?:validos?|validas?|valid)\s+$/.test(far.slice(Math.max(0, tokStart - 12), tokStart))) r.validOnly = false;
    });
    if (!r.strong) {
      r.endOnly = false;
      r.validOnly = false;
    }
    return r;
  }

  /** Frase sem verbos negados ("não responda este e-mail" não é pedido). */
  function requestIn_(s) {
    return RE_REQUEST_SENT.test(s.replace(RE_NEGATED_VERB, ' '));
  }

  /**
   * Classifica uma data: {kind: 'DEADLINE'|'EVENT'|'VALIDITY'|'', scope, viaRequest}.
   * Ordem: validade de acesso → SLA de terceiro → oferta → palavra de prazo → evento → pedido na frase.
   */
  function classifyDate_(scan, i) {
    var f = scan.f;
    var list = scan.list;
    var c = list[i];
    var prevEnd = i > 0 ? list[i - 1].rawEnd : 0;
    var nextStart = i + 1 < list.length ? list[i + 1].start : f.length;
    var before = windowBefore_(f, c.start, prevEnd, 40);
    var core = f.slice(c.start, c.rawEnd);
    var after = windowAfter_(f, c.rawEnd, nextStart, 40);
    var sentB = windowBefore_(f, c.start, 0, 160);
    var sentA = windowAfter_(f, c.rawEnd, f.length, 160);
    var sentence = sentB + ' ' + core + ' ' + sentA;
    var clause = sentB + ' ' + core;
    var wide = f.slice(Math.max(0, c.start - 150), Math.min(f.length, c.rawEnd + 150));
    var dw = deadlineWords_(before, core);
    var hasDl = dw.strong || dw.near;
    var immediate = (before + ' ' + core).replace(RE_QTY_ATE, function (m, p) {
      return p + '   ';
    });
    var eventHit = RE_EVENT_WORD.test(before + ' ' + core + ' ' + after);
    var res = { kind: '', scope: '', viaRequest: false };
    if (RE_ACCESS_VALIDITY.test(clause)) {
      res.kind = 'VALIDITY';
      res.scope = 'ACCESS';
    } else if (!eventHit && (RE_THIRD_PARTY.test(clause) || (RE_DELIVERY_AMBIG.test(clause) && RE_SHIPPING.test(wide)))) {
      res.kind = 'VALIDITY';
      res.scope = 'THIRD_PARTY';
    } else if (RE_OFFER.test(sentence) && !RE_OBLIGATION.test(immediate) && !requestIn_(immediate) && (hasDl || !eventHit)) {
      res.kind = 'VALIDITY';
      res.scope = 'OFFER';
    } else if (hasDl) {
      if (dw.endOnly && RE_EVENT_WORD.test(before)) res.kind = 'EVENT';
      else if (dw.validOnly && !RE_OBLIGATION.test(immediate)) {
        res.kind = 'VALIDITY';
        res.scope = 'OTHER';
      } else res.kind = 'DEADLINE';
    } else if (eventHit) {
      // Encontro proposto sem dia ("café semana que vem?") ainda não é compromisso.
      if (!c.vague) res.kind = 'EVENT';
    } else if (!c.vague && (c.time || RE_DATE_LABEL_LINE.test(before)) && RE_EVENT_WORD.test(wide) && !RE_RECORD_WIDE.test(wide)) {
      res.kind = 'EVENT';
    } else if (requestIn_(sentence) && !RE_EVENT_WORD.test(sentence)) {
      res.kind = 'DEADLINE';
      res.viaRequest = true;
    }
    if (res.kind === 'EVENT' || res.viaRequest) {
      var days = scan.ref ? Util.daysBetween(scan.ref, c.date) : 0;
      // Compromisso no passado, ou registro de hoje ("foi alterada hoje às 08:47"), não é agenda.
      if (days < 0 || (days === 0 && RE_RECORD.test(before) && !/(?:para|for)\s*$/.test(before))) res.kind = '';
    }
    return res;
  }

  /** "Consegue me mandar até as 15h?": hora com "até/by" sem data, em frase de pedido, ancora em refYmd. */
  function anchoredTimes_(scan) {
    var f = scan.f;
    var out = [];
    if (!scan.ref) return out;
    eachMatch_(RE_TIME_DEADLINE, f, function (m) {
      var at = m.index + m[0].search(/[a-z]/);
      var end = m.index + m[0].length;
      var covered = scan.list.some(function (c) {
        return at < c.rawEnd && end > c.start;
      });
      if (covered) return;
      var sentB = windowBefore_(f, at, 0, 160);
      var sentA = windowAfter_(f, end, f.length, 160);
      var otherDay = scan.list.some(function (c) {
        return c.start >= at - sentB.length && c.start <= end + sentA.length && c.date !== scan.ref;
      });
      if (otherDay) return;
      var sentence = sentB + ' ' + f.slice(at, end) + ' ' + sentA;
      if (RE_BUSINESS_HOURS.test(sentence)) return;
      if (!requestIn_(sentence) && !RE_OBLIGATION_VERB.test(sentence)) return;
      var groups = [m[0]].concat(Array.prototype.slice.call(m, 2));
      var t = timeFromMatch_(groups);
      if (!t) return;
      out.push({ date: scan.ref, time: t, certainty: 'INFERRED', kind: 'DEADLINE', scope: '', evidence: snippet_(scan.orig, at, end, 40), index: at });
    });
    return out;
  }

  var KIND_ORDER = { DEADLINE: 0, EVENT: 1, VALIDITY: 2 };

  /**
   * Prazos do dono, compromissos e validades, com certeza e evidência verificável.
   *
   * Contrato de `kind`:
   *  - 'DEADLINE': algo que o DONO precisa fazer até a data — palavra de prazo ("pague até", "vencimento",
   *    "prazo", "data de entrega", "due") ou data em frase de pedido ("me manda hoje", "send it tomorrow").
   *    "até as 15h"/"by 5pm" sem data, em frase de pedido, ancora em refYmd.
   *  - 'EVENT': compromisso com palavra de evento por perto (reunião, consulta, voo, convite, "Local:"…).
   *    Data com hora e sem palavra de evento NÃO é evento (é registro: "Data: 19/10 às 09:42").
   *  - 'VALIDITY': data informativa que não é prazo do dono, com `scope`:
   *    'OFFER' (validade de oferta/cupom, "só hoje", "inscrições até 31/10 com 30% de desconto"),
   *    'ACCESS' (link/código/token/convite expira), 'THIRD_PARTY' (compromisso do remetente: "será creditado
   *    em até 7 dias úteis", previsão de entrega) ou 'OTHER' ("válido até" sem obrigação do dono).
   *    Consumidores devem tratá-la como fato (key_facts), nunca como prazo nem como ação.
   * Omitidos (registros): eventos no passado, registros de hoje ("foi alterada hoje às 08:47") e
   * qualquer data a mais de 30 dias no passado. `scope` é '' fora de VALIDITY.
   * Relativo + absoluto ("amanhã (22/10)", "hoje, 21/10/2026") vira a data absoluta; "tomorrow EOD" = amanhã.
   * certainty: EXPLICIT = palavra de prazo + data absoluta; o resto (relativos, pedidos, eventos) é INFERRED.
   * Ordem: DEADLINE → EVENT → VALIDITY; dentro de cada um, futuras mais próximas antes das vencidas.
   * @return {{date: string, time: string, certainty: string, kind: string, scope: string, evidence: string, index: number}[]}
   */
  function findDeadlines(text, refYmd) {
    var scan = scanDates_(text, refYmd);
    var list = scan.list;
    var out = [];
    list.forEach(function (c, i) {
      if (scan.ref && Util.daysBetween(scan.ref, c.date) < -30) return;
      var k = classifyDate_(scan, i);
      if (!k.kind) return;
      var hasDlWord = k.kind === 'DEADLINE' && !k.viaRequest;
      out.push({
        date: c.date,
        time: c.time,
        certainty: hasDlWord && c.absolute ? 'EXPLICIT' : 'INFERRED',
        kind: k.kind,
        scope: k.scope,
        evidence: snippet_(scan.orig, c.start, c.rawEnd, 40),
        index: c.start,
      });
    });
    out = out.concat(anchoredTimes_(scan));
    var byKey = {};
    var uniq = [];
    out.forEach(function (d) {
      var key = d.kind + '|' + d.date;
      var prev = byKey[key];
      if (!prev) {
        byKey[key] = d;
        uniq.push(d);
        return;
      }
      if (d.certainty === 'EXPLICIT') prev.certainty = 'EXPLICIT';
      if (!prev.time && d.time) prev.time = d.time;
    });
    var ref = scan.ref;
    uniq.sort(function (a, b) {
      if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      var da = ref ? Util.daysBetween(ref, a.date) : 0;
      var db = ref ? Util.daysBetween(ref, b.date) : 0;
      var fa = da >= 0;
      var fb = db >= 0;
      if (fa !== fb) return fa ? -1 : 1;
      if (da !== db) return fa ? da - db : db - da;
      return a.index - b.index;
    });
    return uniq;
  }

  // ----------------------------------------------------------- valores ----
  var CUR_PREFIX = '(us\\$|u\\$s|usd|r\\$|brl|eur|€|\\$)';
  var NUM = '(\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d{1,12}(?:[.,]\\d{1,12})?)(?!\\d)';
  var MULT = '((?:\\s?(?:milhoes|milhao|mil|mi|millions|million|bilhoes|bilhao|bi|billions|billion|thousand))|k|mm|m|bn)?(?![a-z0-9])';
  var CONN = '\\s*(a|ate|-|–|—|to|~|e|and)\\s*';
  var RE_MONEY_PREFIX = new RegExp(CUR_PREFIX + '\\s*' + NUM + MULT + '(?:' + CONN + '(?:' + CUR_PREFIX + '\\s*)?' + NUM + MULT + ')?', 'g');
  var RE_MONEY_SUFFIX = new RegExp(NUM + MULT + '(?:' + CONN + NUM + MULT + ')?\\s*(reais|real|dolares|dolar|dollars?|euros?|usd|brl|eur)(?![a-z])', 'g');
  var RE_MONEY_BARE_RANGE = /(\d{1,9}(?:[.,]\d{1,3})?)\s*[-–]\s*(\d{1,9}(?:[.,]\d{1,3})?)\s?(k|mil)(?![a-z])/g;
  var RE_CURRENCY_NEAR = /us\$|u\$s|usd|r\$|brl|eur|€|\$|reais|dolares|dollars|euros/;

  function currencyOf_(token) {
    var t = str_(token).toLowerCase();
    if (/^(r\$|brl|reais|real)$/.test(t)) return 'BRL';
    if (/^(eur|€|euros?)$/.test(t)) return 'EUR';
    return 'USD';
  }

  /** Interpreta "1.234,56", "1,234.56", "1.500", "1,5", "5,000" (vírgula decimal pt-BR ou ponto en). */
  function parseAmount(numStr) {
    var s = str_(numStr).trim();
    if (!/^\d[\d.,]*$/.test(s)) return NaN;
    var hasDot = s.indexOf('.') >= 0;
    var hasComma = s.indexOf(',') >= 0;
    if (hasDot && hasComma) {
      var dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      var thou = dec === '.' ? ',' : '.';
      s = s.split(thou).join('').replace(dec, '.');
    } else if (hasDot || hasComma) {
      var sep = hasDot ? '.' : ',';
      var parts = s.split(sep);
      var grouped = parts.length > 2 || parts[parts.length - 1].length === 3;
      s = grouped ? parts.join('') : parts[0] + '.' + parts[1];
    }
    return Number(s);
  }

  function multiplier_(mult) {
    var m = str_(mult).trim();
    if (!m) return 1;
    if (/^(mil|k|thousand)$/.test(m)) return 1e3;
    if (/^(bi|bn|bilhao|bilhoes|billions?)$/.test(m)) return 1e9;
    return 1e6;
  }

  function moneyValue_(num, mult) {
    var v = parseAmount(num);
    if (isNaN(v)) return NaN;
    return Math.round(v * multiplier_(mult) * 100) / 100;
  }

  function rangeOk_(conn, f, start) {
    if (conn !== 'e' && conn !== 'and') return true;
    return /(?:^|[^a-z])(?:entre|between)\s*$/.test(f.slice(Math.max(0, start - 12), start));
  }

  /**
   * Valores monetários (BRL/USD/EUR), inclusive faixas ("R$ 10.000 a R$ 12.000", "entre R$ 8 e 10 mil", "10-12k").
   * @return {{amount: number, currency: string, raw: string, index: number, max?: number}[]}
   */
  function findMoney(text) {
    var orig = str_(text);
    var f = fold(orig);
    var cands = [];
    function push(start, end, currency, min, max) {
      if (isNaN(min)) return;
      var c = { start: start, end: end, currency: currency, amount: min };
      if (max !== undefined && !isNaN(max) && max > min) c.max = max;
      cands.push(c);
    }
    function range(minNum, minMult, maxNum, maxMult) {
      var a = parseAmount(minNum);
      var b = parseAmount(maxNum);
      // "entre R$ 8 e 10 mil": o multiplicador do segundo número vale para o primeiro.
      var multA = minMult || (maxMult && a < b ? maxMult : '');
      return [moneyValue_(minNum, multA), moneyValue_(maxNum, maxMult)];
    }
    eachMatch_(RE_MONEY_PREFIX, f, function (m) {
      var s = m.index;
      var p = f.charAt(s - 1);
      if (/[a-z0-9]/.test(p) && m[1] !== '$') return;
      if (m[1] === '$' && /[a-z0-9$]/.test(p)) return;
      var cur = currencyOf_(m[1]);
      if (m[6] !== undefined && rangeOk_(m[4], f, s)) {
        var r = range(m[2], m[3], m[6], m[7]);
        if (r[1] > r[0]) return push(s, s + m[0].length, cur, r[0], r[1]);
      }
      var single = new RegExp(CUR_PREFIX + '\\s*' + NUM + MULT, 'y');
      single.lastIndex = s;
      var sm = single.exec(f);
      if (sm) push(s, s + sm[0].length, cur, moneyValue_(sm[2], sm[3]));
    });
    eachMatch_(RE_MONEY_SUFFIX, f, function (m) {
      var s = m.index;
      if (/[\d.,$]/.test(f.charAt(s - 1))) return;
      var cur = currencyOf_(m[6]);
      if (m[4] !== undefined && rangeOk_(m[3], f, s)) {
        var r = range(m[1], m[2], m[4], m[5]);
        if (r[1] > r[0]) return push(s, s + m[0].length, cur, r[0], r[1]);
      }
      if (m[4] === undefined) push(s, s + m[0].length, cur, moneyValue_(m[1], m[2]));
    });
    eachMatch_(RE_MONEY_BARE_RANGE, f, function (m) {
      var s = m.index;
      var e = s + m[0].length;
      if (/[\d.,]/.test(f.charAt(s - 1))) return;
      var near = f.slice(Math.max(0, s - 15), s) + ' ' + f.slice(e, e + 15);
      var cm = RE_CURRENCY_NEAR.exec(near);
      if (!cm) return;
      var r = range(m[1], m[3], m[2], m[3]);
      push(s, e, currencyOf_(cm[0]), r[0], r[1]);
    });
    return resolveOverlaps_(cands).map(function (c) {
      var o = { amount: c.amount, currency: c.currency, raw: orig.slice(c.start, c.end).trim(), index: c.start };
      if (c.max !== undefined) o.max = c.max;
      return o;
    });
  }

  // ------------------------------------------------------- remuneração ----
  var RE_SALARY_TERM = /(?:^|[^a-z])(?:salario|salarios|salarial|remuneracao|faixa salarial|pretensao salarial|pretensao|bolsa[- ]auxilio|bolsa de estagio|bolsa estagio|compensation|salary|pay range|base pay|ote|clt|pj|ctc)(?![a-z])/g;
  var RE_PERIOD = [
    { period: 'MONTH', re: /\/\s?mes\b|\bmensa(?:l|is)\b|\bpor mes\b|\bao mes\b|\/\s?month\b|\bmonthly\b|\bper month\b|\ba month\b/g },
    { period: 'YEAR', re: /\/\s?ano\b|\banua(?:l|is)\b|\bpor ano\b|\bao ano\b|\bper year\b|\/\s?year\b|\/\s?yr\b|\bannual(?:ly)?\b|\byearly\b|\ba year\b|\bp\.a\./g },
    { period: 'HOUR', re: /\/\s?hora\b|\bpor hora\b|\/\s?h\b|\bhourly\b|\bper hour\b|\/\s?hr\b|\ban hour\b/g },
  ];

  /** Período mais próximo do valor (depois tem preferência sobre antes). */
  function periodNear_(f, start, end) {
    /** @type {*} */
    var best = null;
    RE_PERIOD.forEach(function (p) {
      eachMatch_(p.re, f.slice(Math.max(0, start - 40), Math.min(f.length, end + 40)), function (m) {
        var abs = Math.max(0, start - 40) + m.index;
        var dist = abs >= end ? abs - end : abs + m[0].length <= start ? 1000 + (start - abs - m[0].length) : 0;
        if (!best || dist < best.dist) best = { period: p.period, dist: dist, start: abs, end: abs + m[0].length };
      });
    });
    return best;
  }

  /**
   * Remuneração literal quando há valor a até 60 caracteres de um termo salarial; senão null.
   * @return {{raw: string, min: number, max: number, currency: string, period: string, evidence: string}|null}
   */
  function findCompensation(text) {
    var orig = str_(text);
    var f = fold(orig);
    var terms = [];
    eachMatch_(RE_SALARY_TERM, f, function (m) {
      var lead = m[0].search(/[a-z]/);
      terms.push({ start: m.index + lead, end: m.index + m[0].length });
    });
    if (!terms.length) return null;
    /** @type {*} */
    var best = null;
    findMoney(orig).forEach(function (mo) {
      var ms = mo.index;
      var me = ms + mo.raw.length;
      terms.forEach(function (t) {
        var dist = t.end <= ms ? ms - t.end : t.start >= me ? t.start - me : 0;
        if (dist <= 60 && (!best || dist < best.dist)) best = { money: mo, term: t, dist: dist, start: ms, end: me };
      });
    });
    if (!best) return null;
    var per = periodNear_(f, best.start, best.end);
    var rawEnd = best.end;
    if (per && per.start >= best.end && per.start - best.end <= 3) rawEnd = per.end;
    var mo = best.money;
    return {
      raw: orig.slice(best.start, rawEnd).trim(),
      min: mo.amount,
      max: mo.max !== undefined ? mo.max : mo.amount,
      currency: mo.currency,
      period: per ? per.period : '',
      evidence: snippet_(orig, Math.min(best.start, best.term.start), Math.max(rawEnd, best.term.end), 30),
    };
  }

  // -------------------------------------------------------------- PII ----
  function digitsOf_(s) {
    return str_(s).replace(/\D/g, '');
  }

  /** CPF com dígitos verificadores válidos (rejeita sequências repetidas). */
  function isValidCpf(s) {
    var d = digitsOf_(s);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t <= 10; t++) {
      var sum = 0;
      for (var i = 0; i < t; i++) sum += Number(d.charAt(i)) * (t + 1 - i);
      var r = (sum * 10) % 11;
      if (r === 10) r = 0;
      if (r !== Number(d.charAt(t))) return false;
    }
    return true;
  }

  /** CNPJ com dígitos verificadores válidos. */
  function isValidCnpj(s) {
    var d = digitsOf_(s);
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    var w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    var w2 = [6].concat(w1);
    function dv(len, w) {
      var sum = 0;
      for (var i = 0; i < len; i++) sum += Number(d.charAt(i)) * w[i];
      var r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    }
    return dv(12, w1) === Number(d.charAt(12)) && dv(13, w2) === Number(d.charAt(13));
  }

  /** Cartão: 13–19 dígitos com dígito verificador de Luhn (rejeita dígitos todos iguais). */
  function luhnValid(s) {
    var d = digitsOf_(s);
    if (d.length < 13 || d.length > 19 || /^(\d)\1+$/.test(d)) return false;
    var sum = 0;
    for (var i = 0; i < d.length; i++) {
      var n = Number(d.charAt(d.length - 1 - i));
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    return sum % 10 === 0;
  }

  function isYearPair_(a, b) {
    return /^(19|20)\d\d$/.test(a) && /^(19|20)\d\d$/.test(b);
  }

  var PII_KEYS = ['cpf', 'cnpj', 'card', 'bank_account', 'boleto', 'pix_key', 'otp', 'password', 'token', 'phone', 'email', 'rg', 'cnh', 'birthdate', 'address', 'cep', 'ip', 'plate'];

  // Ordem importa: rótulos e formatos mais específicos primeiro; cada passo vê o texto já redigido.
  var PII_RULES = [
    // Segredos em parâmetros de URL (links mágicos, redefinição de senha, rastreio autenticado).
    { key: 'token', re: /([?&](?:[\w-]*(?:token|key|code|reset|auth|session|signature|secret|ticket|otp)[\w-]*|sig|sid|password|pwd|hash)=)[^&\s#"'<>]{6,}/gi, keep: 1, tag: '[TOKEN]' },
    { key: 'rg', re: /(\bRG\s*(?:n[º°o]\.?\s*)?:?\s*)(\d{1,2}\.?\d{3}\.?\d{3}-?[\dxX])\b/gi, keep: 1, tag: '[RG]' },
    { key: 'cnh', re: /(\bCNH\s*(?:n[º°o]\.?\s*)?:?\s*)(\d{9,11})\b/gi, keep: 1, tag: '[CNH]' },
    { key: 'birthdate', re: /(\b(?:data de nascimento|nascid[oa] em|nascimento|date of birth|birth ?date|dob)\s*:?\s*)(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/gi, keep: 1, tag: '[NASCIMENTO]' },
    { key: 'address', re: /\b(?:rua|r\.|avenida|av\.|alameda|al\.|travessa|tv\.|estrada|rodovia|pra[cç]a)\s+[^\n,;]{2,60},?\s*(?:n[º°o]\.?\s*)?\d{1,6}\b/gi, tag: '[ENDERECO]' },
    { key: 'pix_key', re: /(\bchave\s+pix(?:\s+aleat[oó]ria)?\s*[:=]\s*|\bpix\s+key\s*[:=]\s*)([^\s,;]+(?:\s\d[\d\-]{3,}\d)?)/gi, keep: 1, tag: '[PIX]' },
    { key: 'token', re: /\b(Bearer)\s+[A-Za-z0-9\-._~+\/]{8,}=*/g, keep: 1, tag: '[TOKEN]', sep: ' ' },
    { key: 'token', re: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_\-]{16,}/g, tag: '[TOKEN]' },
    { key: 'token', re: /\bAIza[0-9A-Za-z_\-]{30,}/g, tag: '[TOKEN]' },
    { key: 'token', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, tag: '[TOKEN]' },
    { key: 'token', re: /\bxox[abprs]-[A-Za-z0-9\-]{10,}/g, tag: '[TOKEN]' },
    { key: 'token', re: /\bAKIA[0-9A-Z]{16}\b/g, tag: '[TOKEN]' },
    { key: 'token', re: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g, tag: '[TOKEN]' },
    { key: 'email', re: /[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,253}\.[A-Za-z]{2,24}/g, tag: '[EMAIL]' },
    { key: 'pix_key', re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, tag: '[PIX]' },
    {
      key: 'token',
      re: /[A-Za-z0-9+_\-]{32,}={0,2}/g,
      tag: '[TOKEN]',
      test: function (m) {
        var v = m[0].replace(/=+$/, '');
        if (/^\d+$/.test(v) || !/\d/.test(v)) return false;
        if (/^[a-fA-F0-9]+$/.test(v)) return true;
        return /[a-z]/.test(v) && /[A-Z]/.test(v);
      },
    },
    {
      key: 'otp',
      re: /(\b(?:c[oó]digo|codigo|code|token|otp|verifica[cç][aã]o|verification|senha tempor[aá]ria|pin)\b[^\d\n]{0,30}?)(\d{3}[- ]\d{3}(?![\d\-])|\d{4,8})(?![\d\/:\-]|[.,]\d)/gi,
      keep: 1,
      tag: '[CODIGO]',
      test: function (m) {
        return m[1].indexOf('$') < 0;
      },
    },
    // Código antes da palavra-chave ("482913 é o seu código") e "use 482913 para verificar".
    { key: 'otp', re: /\b(?:\d{3}[- ]\d{3}|\d{4,8})(?=\s+(?:é|e|is)\s+(?:o\s+|a\s+)?(?:seu|sua|your)\s+(?:novo\s+)?(?:c[oó]digo|code|otp|token|pin|senha)\b)/gi, tag: '[CODIGO]' },
    { key: 'otp', re: /(\b(?:use|enter|digite|informe|insira|utilize)\s+(?:o\s+c[oó]digo\s+)?)(\d{3}[- ]\d{3}|\d{4,8})\b(?=[^.\n]{0,40}\b(?:verif|confirm|log ?in|sign|entrar|acess|valid))/gi, keep: 1, tag: '[CODIGO]' },
    { key: 'password', re: /(\b(?:senha(?:\s+(?:provis[oó]ria|tempor[aá]ria|de acesso|inicial))?|password|passwd|pwd|passcode)\s*(?:[:=]|\s(?:é|e|is)\s)\s*)([^\s,.;]+)/gi, keep: 1, tag: '[SENHA]' },
    {
      key: 'boleto',
      re: /\d[\d. \-]{44,70}\d/g,
      tag: '[BOLETO]',
      test: function (m) {
        var n = digitsOf_(m[0]).length;
        return n === 47 || n === 48;
      },
    },
    { key: 'cnpj', re: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, tag: '[CNPJ]' },
    { key: 'cnpj', re: /\b\d{14}\b/g, tag: '[CNPJ]', test: function (m) { return isValidCnpj(m[0]); } },
    { key: 'cpf', re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, tag: '[CPF]' },
    { key: 'cpf', re: /\b\d{11}\b/g, tag: '[CPF]', test: function (m) { return isValidCpf(m[0]); } },
    {
      key: 'card',
      re: /\b(?:\d{4}([ \-]?)\d{4}\1\d{4}\1\d{1,7}|\d{4}[ \-]?\d{6}[ \-]?\d{4,5}|\d{13,19})\b/g,
      tag: '[CARTAO]',
      test: function (m) { return luhnValid(m[0]); },
    },
    {
      key: 'bank_account',
      re: /(\b(?:ag[eê]ncia|ag\.?|conta(?:[ \-]corrente| poupan[cç]a| salário)?|c\/c|cc|account(?: number| no\.?)?|acct\.?)\s*(?:n[º°o]\.?\s*|number\s*|#\s*)?[:\-]?\s*)(\d[\d.\-\/xX]{1,18}\d|\d{2,})/gi,
      keep: 1,
      tag: '[CONTA]',
    },
    { key: 'phone', re: /\+55\s?\(?\d{2}\)?\s?9?\d{4}[\-\s]?\d{4}\b/g, tag: '[TELEFONE]' },
    { key: 'phone', re: /\(\d{2}\)\s?9?\d{4}[\-\s]?\d{4}\b/g, tag: '[TELEFONE]' },
    { key: 'phone', re: /\b0[3589]00[\s\-]?\d{3}[\s\-]?\d{4}\b/g, tag: '[TELEFONE]' },
    { key: 'phone', re: /\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?[\s.\-]?\d{3,5}[\s.\-]?\d{4}\b/g, tag: '[TELEFONE]' },
    { key: 'phone', re: /\b\d{2}\s9\d{4}[\-\s]?\d{4}\b/g, tag: '[TELEFONE]' },
    { key: 'phone', re: /\b[1-9]{2}9\d{8}\b/g, tag: '[TELEFONE]' },
    {
      key: 'phone',
      re: /\b(9\d{4}|[2-5]\d{3})-(\d{4})\b/g,
      tag: '[TELEFONE]',
      test: function (m, s) {
        if (isYearPair_(m[1], m[2])) return false;
        return !/[$€]\s*$/.test(s.slice(Math.max(0, m.index - 4), m.index));
      },
    },
    { key: 'cep', re: /(\bCEP\s*:?\s*)?\b\d{5}-\d{3}\b/gi, tag: '[CEP]' },
    { key: 'ip', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, tag: '[IP]' },
    { key: 'plate', re: /\b[A-Z]{3}(?:\d[A-Z]\d{2}|-?\d{4})\b/g, tag: '[PLACA]' },
  ];

  /**
   * Redige dados pessoais e segredos antes de qualquer envio à IA e da gravação de trechos.
   * Inclui documentos (CPF, CNPJ, RG, CNH), contato, endereço/CEP, nascimento, IP, placa,
   * dados bancários e segredos. Preserva datas, horas, valores monetários e números curtos.
   * @return {{text: string, counts: Object<string, number>}}
   */
  function redactPii(text) {
    var s = str_(text);
    /** @type {Object<string, number>} */
    var counts = {};
    PII_KEYS.forEach(function (k) {
      counts[k] = 0;
    });
    PII_RULES.forEach(function (rule) {
      var src = s;
      s = src.replace(rule.re, function () {
        var args = Array.prototype.slice.call(arguments);
        var offset = args[args.length - 2];
        var m = args.slice(0, args.length - 2);
        m.index = offset;
        if (rule.test && !rule.test(m, src)) return m[0];
        counts[rule.key]++;
        return rule.keep ? m[rule.keep] + (rule.sep || '') + rule.tag : rule.tag;
      });
    });
    return { text: s, counts: counts };
  }

  // -------------------------------------------------------- injection ----
  var INJECTION_RULES = [
    { code: 'IGNORE_PREV', w: 1, re: /\b(?:ignor[ea]\w*|esque[cç]a\w*|forget)\s+(?:(?:as|os|todas|todos|all|the|any|previous|prior|above|anteriores|suas|your|of|my|minhas|estas|these)\s+){0,3}(?:instruc\w*|instructions?|regras|rules|prompts?|orientac\w*|comandos|directions)\b/ },
    { code: 'DISREGARD', w: 0.5, re: /\b(?:disregard|desconsidere|desconsiderar)\b/ },
    { code: 'ROLE_SWITCH', w: 1, re: /\b(?:voce agora e|a partir de agora voce e|you are now|from now on,? you are|pretend (?:to be|you are)|finja (?:ser|que voce e))\b/ },
    { code: 'ACT_AS', w: 0.5, re: /\b(?:aja como|atue como|comporte-se como|act as|roleplay as)\b/ },
    { code: 'SYSTEM_PROMPT', w: 1, re: /\b(?:system prompt|prompt (?:do|de) sistema|system message|mensagem (?:do|de) sistema|instrucoes do sistema)\b/ },
    { code: 'ROLE_LABEL', w: 0.5, re: /(?:^|\n)\s*(?:assistant|system|user)\s*:/ },
    { code: 'MD_INSTRUCTION', w: 1, re: /#{2,}\s*(?:instruction|instructions|instrucao|instrucoes|system|new instructions)\b/ },
    { code: 'CHAT_TAG', w: 1, re: /<\|im_start\|>|<\|im_end\|>|<\|system\|>|<\|endoftext\|>|\[inst\]|\[\/inst\]|<<sys>>|<\/?system>|<\/?(?:assistant|user)>/ },
    { code: 'NEW_INSTRUCTIONS', w: 1, re: /\b(?:novas? instruc\w*|new instructions?|updated instructions|novas ordens)\b/ },
    {
      code: 'REVEAL',
      w: 1,
      re: /\b(?:reveal|revele|revelar|mostre|mostrar|show|print|imprima|output|repeat|repita|envie|send|share|compartilhe|leak|vaze)\s+(?:(?:me|us|nos|your|suas|seus|sua|seu|the|as|os|o|a|all|todas|todos|full|complete|completo|completas|original)\s+){0,3}(?:system prompt|prompt|instruc\w*|instructions|api keys?|chaves?|secrets?|segredos?|credenciais|credentials|tokens?)\b/,
    },
    { code: 'RESPOND_ONLY', w: 0.5, re: /\b(?:responda apenas|responda somente|respond only with|reply only with|answer only with|only respond with|only output)\b/ },
    { code: 'OUTPUT_FOLLOWING', w: 0.5, re: /\b(?:output the following|print the following|escreva exatamente|write exactly|say exactly|diga exatamente)\b/ },
    { code: 'JAILBREAK', w: 1, re: /\b(?:jailbreak|do anything now|modo desenvolvedor|developer mode enabled)\b/ },
    { code: 'MANIPULATE', w: 0.5, re: /\b(?:(?:classifique|classificar|classifica|categorize|categorizar|marque|marcar|marca|trate|tratar)\s+(?:(?:este|esta|esse|essa|o|a)\s+)?(?:e-?mail|mensagem)\s+como|(?:classifique|classificar|marque|marcar|defina|definir|coloque|atribua)\s+(?:como\s+|a\s+|com\s+)?(?:prioridade|nivel|urgencia|importancia)\b|marque (?:este|esta|como) (?:\w+ )?(?:importante|urgente|critic[oa])|(?:mark|classify|flag|treat) (?:this|it)(?: email| message)? as|(?:classify|mark|set|rate) (?:it |this )?(?:as )?(?:priority|importance|urgency)\b|set (?:the )?(?:priority|importance|urgency)(?: to)?\s+(?:high|critical|urgent|max))\b/ },
    // Texto que se dirige ao assistente/IA ("Note to AI assistants", "Instruções para o assistente de IA").
    { code: 'ADDRESS_AI', w: 1, re: /\b(?:note|message|instructions?|notice) (?:to|for) (?:the |any |all )?(?:ai|llm|language model|assistant|chatbot)s?\b|\b(?:ai|llm) (?:assistants?|models?|agents?)(?:,|:| reading| processing)|(?:instruc\w*|nota|recado|mensagem|aviso) (?:para|ao|aos) (?:o |a |os )?(?:assistente|ia|modelo|agente|robo|chatbot)s?(?: de (?:ia|inteligencia artificial))?\b|(?:caro|cara|prezado|prezada|dear) (?:assistente|ia|modelo|ai|assistant)\b/ },
  ];

  INJECTION_RULES.forEach(function (r) {
    r.reG = new RegExp(r.re.source, 'g');
  });
  // Trechos citados: "…", “…”, «…» e '…' (aspas simples só com fronteira, para não pegar apóstrofos).
  var RE_QUOTED_SPAN = /["“«]([^"”»\n]{3,200})["”»]|(?:^|[\s(:])'([^'\n]{3,200})'(?=[\s.,;:!?)]|$)/g;
  // Vocabulário de quem DISCUTE o fenômeno (artigo, boletim de segurança, curso).
  var RE_INJECTION_META = /(?:^|[^a-z])(prompt injection|injecao de prompt|injecao de instrucoes|jailbreaks?|ataques?|attacks?|atacantes?|attackers?|exemplos?|examples?|such as|frases? como|tecnicas?|techniques?|seguranca|security|llms?|modelos? de linguagem|language models?|agentes?|agents?|chatbots?|vulnerabilidades?|vulnerabilit(?:y|ies)|defesas?|defenses?|mitigac(?:ao|oes)|mitigations?)(?![a-z])/g;

  /**
   * Sinais heurísticos de prompt injection (pt/en). Sinais fortes valem 1, fracos 0,5;
   * `suspected` quando a soma atinge 1.
   *
   * Texto que DISCUTE o fenômeno (≥ 2 termos como "prompt injection", "ataques", "LLM", "agentes"
   * fora das aspas e ≥ 20 palavras fora delas) e só cita o padrão entre aspas ("frases como
   * \"ignore previous instructions\"") não é suspeito: o padrão citado vira o sinal informativo
   * QUOTED_EXAMPLE (peso 0). Basta UM padrão fora das aspas para valer tudo de novo.
   * `opts.hidden = true` (texto oculto do HTML) desliga essa tolerância: ninguém esconde uma citação.
   * @return {{suspected: boolean, signals: string[]}}
   */
  function detectInjection(text, opts) {
    var orig = str_(text);
    var f = fold(orig);
    var signals = [];
    var score = 0;
    function hit(code, w) {
      if (signals.indexOf(code) >= 0) return;
      signals.push(code);
      score += w;
    }
    var spans = [];
    eachMatch_(RE_QUOTED_SPAN, f, function (m) {
      var inner = m[1] !== undefined ? m[1] : m[2];
      var s = m.index + m[0].length - inner.length - 2;
      spans.push({ s: s, e: s + inner.length + 2 });
    });
    function quotedOnly(a, b) {
      return spans.some(function (q) {
        return a >= q.s && b <= q.e;
      });
    }
    var discussing = false;
    if (spans.length && !(opts && opts.hidden)) {
      var outside = f;
      spans.slice().reverse().forEach(function (q) {
        outside = outside.slice(0, q.s) + ' ' + outside.slice(q.e);
      });
      var meta = {};
      eachMatch_(RE_INJECTION_META, outside, function (m) {
        meta[m[1].replace(/s$/, '')] = true;
      });
      discussing = Object.keys(meta).length >= 2 && Util.wordCount(outside) >= 20;
    }
    var cited = false;
    INJECTION_RULES.forEach(function (r) {
      var found = false;
      var free = false;
      eachMatch_(r.reG, f, function (m) {
        found = true;
        if (!discussing || !quotedOnly(m.index, m.index + m[0].length)) free = true;
      });
      if (free) hit(r.code, r.w);
      else if (found) cited = true;
    });
    if (/\bDAN\b/.test(orig)) hit('DAN', 0.5);
    if (cited) hit('QUOTED_EXAMPLE', 0);
    // Texto invisível é comum em newsletters (preheader): só agrava quando já há sinal textual.
    var textual = score;
    if (/[​-‍⁠﻿]{5,}/.test(orig)) hit('ZERO_WIDTH', textual > 0 ? 0.5 : 0);
    if (/font-size\s*:\s*0(?![.\d])|display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])/.test(f)) hit('HIDDEN_CSS', textual > 0 ? 0.5 : 0);
    return { suspected: score >= 1, signals: signals };
  }

  // ------------------------------------------------------------ ações ----
  var ACTION_STRONG = [
    'preciso que', 'precisamos que', 'poderia enviar', 'pode me enviar', 'por favor envie', 'favor enviar', 'favor confirmar',
    'favor responder', 'me confirme', 'confirme', 'confirmar ate', 'responder ate', 'responda ate', 'enviar ate', 'retorno ate',
    'aguardo retorno', 'aguardo seu retorno', 'aguardo sua resposta', 'fico no aguardo', 'ficamos no aguardo', 'aguardamos',
    'peco que', 'pedimos que', 'solicito', 'solicitamos', 'action required', 'action needed', 'acao necessaria', 'acao requerida',
    'please confirm', 'please review', 'please reply', 'please respond', 'please send', 'please let me know', 'can you please',
    'could you', 'would you', 'let me know', 'kindly', 'reply by', 'respond by', 'rsvp', 'preencha o formulario', 'preencha',
    'responda', 'assine', 'assinatura pendente', 'documento para assinar', 'pague ate', 'pagar ate', 'efetue o pagamento',
    'regularize', 'regularizar', 'evite o bloqueio', 'evite a suspensao', 'send me',
  ];
  var ACTION_MEDIUM = [
    'poderia', 'poderiam', 'voce pode', 'voces podem', 'consegue', 'conseguiria', 'por favor', 'favor', 'please', 'gentileza',
    'pendencia', 'pendencias', 'pendente', 'pendentes', 'lembrete', 'follow up', 'follow-up', 'confirmar', 'enviar', 'revisar', 'revise', 'aprovar', 'aprove',
    'retorne', 'me avise', 'avise', 'can you',
  ];
  // Verbos de TAREFA no imperativo: [formal (subjuntivo), informal (indicativo 3ª pessoa), peso].
  // Verbos de venda ("compre", "aproveite", "garanta", "confira", "clique", "acesse", "baixe", "use") ficam fora de propósito.
  var TASK_VERBS = [
    ['envie', 'envia', 0.35], ['mande', 'manda', 0.35], ['encaminhe', 'encaminha', 0.35], ['confirme', 'confirma', 0.35],
    ['responda', 'responde', 0.35], ['retorne', 'retorna', 0.35], ['avise', 'avisa', 0.35], ['revise', 'revisa', 0.35],
    ['aprove', 'aprova', 0.35], ['assine', 'assina', 0.35], ['preencha', 'preenche', 0.35], ['pague', 'paga', 0.35],
    ['regularize', 'regulariza', 0.35], ['renove', 'renova', 0.35], ['atualize', 'atualiza', 0.35], ['retire', 'retira', 0.35],
    ['entregue', 'entrega', 0.35], ['devolva', 'devolve', 0.35], ['providencie', 'providencia', 0.35], ['agende', 'agenda', 0.35],
    ['remarque', 'remarca', 0.35], ['conclua', 'conclui', 0.35], ['finalize', 'finaliza', 0.35], ['corrija', 'corrige', 0.35],
    ['informe', 'informa', 0.35], ['indique', 'indica', 0.35], ['aceite', 'aceita', 0.35], ['anexe', 'anexa', 0.35],
    ['emita', 'emite', 0.35], ['compareca', 'comparece', 0.3], ['faca', 'faz', 0.3], ['passe', 'passa', 0.3], ['fale', 'fala', 0.3],
    ['diga', 'diz', 0.3], ['ligue', 'liga', 0.3], ['separe', 'separa', 0.3], ['imprima', 'imprime', 0.3], ['decida', 'decide', 0.3],
    ['defina', 'define', 0.3], ['resolva', 'resolve', 0.3], ['ajude', 'ajuda', 0.3], ['conte', 'conta', 0.3], ['chame', 'chama', 0.2],
    ['leve', 'leva', 0.2], ['traga', 'traz', 0.2], ['apresente', 'apresenta', 0.2], ['verifique', 'verifica', 0.2],
    ['consulte', 'consulta', 0.2], ['olhe', 'olha', 0.2],
  ];
  // Formas informais sem ambiguidade com substantivo/adjetivo: valem no início da frase ("Manda o arquivo").
  var INFORMAL_START_OK = { manda: 1, envia: 1, encaminha: 1, avisa: 1, confirma: 1, revisa: 1, responde: 1 };
  var TASK_VERBS_EN = [
    ['send', 0.35], ['forward', 0.35], ['confirm', 0.35], ['reply', 0.35], ['respond', 0.35], ['review', 0.35], ['approve', 0.35],
    ['sign', 0.35], ['complete', 0.35], ['submit', 0.35], ['pay', 0.35], ['provide', 0.35], ['fill out', 0.35], ['fill in', 0.35],
    ['update', 0.3], ['schedule', 0.3], ['call', 0.3], ['upload', 0.3], ['fix', 0.3], ['finish', 0.3], ['prepare', 0.3],
    ['share', 0.2], ['check', 0.2], ['verify', 0.2],
  ];
  var RE_IMP_FORMAL = new RegExp('(?:^|[^a-z])(' + TASK_VERBS.map(function (v) { return v[0]; }).join('|') + ')(?![a-z])', 'g');
  var RE_IMP_INFORMAL = new RegExp('(?:^|[^a-z])(' + TASK_VERBS.map(function (v) { return v[1]; }).join('|') + ')(?![a-z])', 'g');
  var RE_IMP_EN = new RegExp('(?:^|[^a-z])(' + TASK_VERBS_EN.map(function (v) { return v[0]; }).join('|') + ')(?![a-z])', 'g');
  var IMP_WEIGHT = {};
  TASK_VERBS.forEach(function (v) {
    IMP_WEIGHT[v[0]] = v[2];
    IMP_WEIGHT[v[1]] = v[2];
  });
  TASK_VERBS_EN.forEach(function (v) {
    IMP_WEIGHT[v[0]] = v[1];
  });
  // O que pode vir antes de um imperativo de início de frase: marcadores, vocativo ("Rafael,"), cortesia.
  // Sem alternativas ambíguas (o vocativo aparece no máximo uma vez): nada de retrocesso exponencial.
  var RE_PRE_CLAUSE_START = /^(?:[\s\-–—•*>]|\d+[.)])*(?:[a-z]{2,20}\s*,\s*)?(?:(?:ok|okay|entao|so|tambem|depois|agora|ai|e|alem disso|ah|por favor|favor|gentileza|please|kindly|just|also|and|then|pls|pf)(?:\s*,\s*|\s+|$))*$/;
  var RE_PRE_CLITIC = /(?:^|[^a-z])(?:me|nos)\s+$/;
  var RE_PRE_COORD = /(?:^|[^a-z])(?:e|que (?:voce|vc|voces))\s+(?:me\s+|nos\s+)?$/;
  var RE_PRE_NEGATION = /(?:^|[^a-z])(?:nao|nunca|never|not|don't|dont|no)\s+(?:me\s+|nos\s+|lhe\s+|o\s+|a\s+)?$/;
  var RE_PRE_CONDITIONAL = /(?:^|[^a-z])(?:(?:se|caso|if|unless)\s+(?!(?:possivel|puder|der|preferir|possible|you can|you could)(?![a-z]))|qualquer (?:duvida|coisa|problema|questao)|em caso de duvidas?|if you have any questions|any questions)/;
  var RE_NEXT_DETERMINER = /^\s+(?:o|a|os|as|um|uma|isso|esse|essa|esses|essas|este|esta|aquele|aquela|seu|sua|seus|suas|teu|tua|todos|todas|ai|la|aqui|pra|pro|para|me|por|com|no|na|pelo|pela|ate|hoje|amanha|agora|ja|quando|assim)(?![a-z])/;
  // Formas que também são substantivo/particípio ("Entregue em 20/10", "Informe de rendimentos", "Aceite enviado")
  // e instruções fracas: só contam seguidas de artigo/possessivo/complemento ("Informe seus dados").
  var FORMAL_NEEDS_OBJECT = { entregue: 1, informe: 1, aceite: 1, indique: 1, conte: 1, passe: 1, separe: 1, fale: 1, diga: 1, chame: 1, leve: 1, traga: 1, apresente: 1, verifique: 1, consulte: 1, olhe: 1 };
  // Tarefa atribuída/revisão pedida: pedido explícito, mesmo vindo de sistema.
  var RE_TASK_ASSIGNED = /(?:^|[^a-z])(?:atribu(?:iu|ida|ido|idas|idos)(?![a-z])[^.!?\n]{0,60}(?:a|para) voce|assigned (?:to )?you|assigned you|requested your review|review requested|requested changes|solicitou (?:a )?sua (?:revisao|aprovacao|assinatura|resposta)|pediu (?:a )?sua (?:revisao|aprovacao|assinatura|resposta)|aguardando (?:a )?sua (?:aprovacao|assinatura|revisao|resposta|confirmacao|acao)|awaiting your|waiting (?:for|on) your|needs your (?:approval|review|signature|input)|precisa da sua (?:aprovacao|assinatura|revisao|resposta)|enviou (?:um|o|uns|os) documentos? para voce|sent you (?:a|the) document|mencionou voce|mentioned you|sua acao e necessaria|requer sua acao|your action is required)(?![a-z])/g;
  var RE_TASK_ASSIGNED_1 = new RegExp(RE_TASK_ASSIGNED.source);
  var RE_TASK_STAGE = /(?:^|[^a-z])(?:proxima etapa|next step|next stage|avancou para|voce avancou|you(?:'ve| have) advanced|moved (?:you )?to the next)(?![a-z])/;
  var RE_TASK_PENDING = /(?:^|[^a-z])(?:disponivel para retirada|aguardando (?:a )?retirada|ready for pick-?up|check-?in (?:do seu voo |online )?(?:ja )?(?:esta )?(?:aberto|disponivel|liberado)|check-?in is (?:now )?open|nao conseguimos processar|nao foi possivel processar|pagamento (?:recusado|nao aprovado|falhou)|payment (?:failed|declined|was declined)|pendencias?|em aberto|em atraso|overdue|past due)(?![a-z])/g;
  var RE_TASK_PENDING_1 = new RegExp(RE_TASK_PENDING.source);
  // Obrigação expressa por modal: "deve ser entregue até", "você precisa", "is required".
  var RE_OBLIGATION_ACT = /(?:^|[^a-z])(?:devem? ser (?:entregues?|enviad[oa]s?|preenchid[oa]s?|assinad[oa]s?|pag[oa]s?|respondid[oa]s?|concluid[oa]s?|realizad[oa]s?|feit[oa]s?)|voce (?:deve|precisa|tera que|tem que) (?!saber|conhecer|ver|ler|entender|experimentar|conferir|aproveitar|assistir)[a-z]{2,}(?:ar|er|ir)|e (?:necessario|obrigatorio) (?:que|(?!para|pra)[a-z]{2,}(?:ar|er|ir))|precisa ser|prazo (?:para|de) (?:o |a )?(?:indicacao|apresentacao|pagamento|envio|resposta|defesa|recurso|regularizacao|assinatura|inscricao|contestacao|manifestacao|comprovacao|cadastro|matricula|declaracao|confirmacao|retirada|devolucao)|must be|needs to be|you (?:need|must|have) to|is required|are required)(?![a-z])/g;
  var RE_NO_ACTION = /(?:^|[^a-z])(?:nao (?:e necessario|precisa) fazer nada|nao precisa fazer nada|nenhuma acao (?:e )?necessaria|nao requer (?:nenhuma )?acao|no action (?:is )?(?:needed|required)|you don't need to do anything|nothing (?:else )?to do|pode ignorar)(?![a-z])/;
  var RE_DUE_CUE = /(?:^|[^a-z])(?:ate|by|until|hoje|amanha|today|tonight|tomorrow|eod|asap|urgente|urgent|o quanto antes|assim que possivel|o mais rapido possivel|esta semana|nesta semana|this week|este mes|neste mes|prazo|deadline|due|segunda(?!\s+(?:via|vez|etapa|opcao|parte))|terca|quarta|quinta|sexta|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?![a-z])|\d{1,2}\/\d{1,2}/;
  // Prazo concreto colado a um pedido ("confirme até hoje às 18h", "send it by Friday"): pista transacional.
  var RE_DUE_CONCRETE = /(?:^|[^a-z])(?:ate|by|until|till)\s+(?:(?:o\s+)?(?:dia\s+)?(?:hoje|amanha|today|tomorrow|tonight|eod)|(?:as\s+)?\d{1,2}(?:h|:\d{2})|\d{1,2}\/\d{1,2}|segunda|terca|quarta|quinta|sexta|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?![a-z])/;
  var RE_EXPLICIT_DUE = new RegExp('(?:^|[^a-z])(?:prazo|vencimento|vence|vencem|data de entrega|data limite|due(?: date)?|deadline|ate|by|until)\\s*(?:[:\\-]\\s*)?(?:(?:o\\s+)?dia\\s+|the\\s+|on\\s+)?(?:\\d{1,2}\\/\\d{1,2}|\\d{1,2}(?:º|o)?\\s+de\\s+(?:' + MONTH_ALT + ')(?![a-z])|(?:' + MONTH_EN_ALT + ')\\s+\\d{1,2}(?!\\d))');
  var RE_BILLING = /(?:^|[^a-z])(?:pague|pagar|pagamento|efetue|regularize|regularizar|fatura|boleto|vencimento|vence|em atraso|cobranca|bloqueio|suspensao|assinatura pendente|documento para assinar|assine|assinar|renove|renovacao|invoice|payment|overdue|past due|billing)(?![a-z])/;
  var RE_DIRECT_QUESTION = /^(?:voce|voces|vc|pode|poderia|podemos|consegue|conseguiria|qual|quais|quando|como|onde|tem|teria|ha|existe|sera|seria|vamos|vem|topa|bora|que horas|que dia|da pra|combinado|fechado|could|can|would|will|do|did|are|is|what|when|how|where|which|who|should)\b/;
  // Perguntas de 1–2 palavras que ainda pedem resposta ("Qual prefere?", "Topa?").
  var RE_SHORT_QUESTION = /^(?:qual|quais|quando|onde|quanto|quantos|quantas|que horas|que dia|topa|vem|vamos|bora|pode|podemos|consegue|combinado|confirma|fechado|which|when|where|deal|available|free)\b/;
  var RE_Q_LEAD = /^(?:(?:oi|ola|hi|hey|hello|dear|bom dia|boa tarde|boa noite|fala|e ai|ok|okay|entao|ah)[\s,!]+)?(?:[a-z]{2,20},\s*)?/;
  var RE_PLEASANTRY_ONLY = /^(?:tudo (?:bem|bom|certo|tranquilo|joia|ok|em ordem)|como (?:vai|vao|esta|estao|voce esta|vai voce|voce vai)|how are you|how(?:'s| is) it going|how have you been|e ai|beleza|td bem)(?:\s+(?:com voce|contigo|por ai|ai|with you|doing|today))?\s*$/;
  // Mensagem de pessoa retransmitida por plataforma: trecho entre aspas com 1ª/2ª pessoa.
  var RE_QUOTED_HUMAN = /["“«]([^"”»\n]{25,600})["”»]/g;
  var RE_PERSON_PRONOUN = /(?:^|[^a-z])(?:eu|voce|vc|te|me|meu|minha|posso|preciso|a gente|i|you|me|my|we)(?![a-z])/;
  // Pedido modal: "Pode revisar…?", "Você consegue me mandar…?" (início de frase ou pergunta).
  var RE_MODAL_REQUEST = /(?:^|[^a-z])((?:pode|podem|poderia|poderiam|consegue|conseguiria|conseguem)\s+(?:me\s+|nos\s+)?[a-z]{2,}(?:ar|er|ir))(?![a-z])/g;
  // Pistas que não são pedido em si (substantivos de lembrete/pendência): não ganham o reforço de prazo.
  var NOT_A_REQUEST = { lembrete: 1, pendencia: 1, pendencias: 1, pendente: 1, pendentes: 1, 'follow up': 1, 'follow-up': 1, prazo: 1, retorno: 1 };
  var actionMatcherCache_ = null;

  /** Lista de frases (fixas + palavras de "tarefas" da taxonomia) compilada na primeira chamada. */
  function actionMatcher_() {
    if (actionMatcherCache_) return actionMatcherCache_;
    var weights = {};
    function addAll(list, w) {
      (list || []).forEach(function (p) {
        var k = Util.normalizeText(p);
        if (k && !(weights[k] >= w)) weights[k] = w;
      });
    }
    addAll(ACTION_MEDIUM, 0.2);
    addAll(ACTION_STRONG, 0.35);
    if (typeof Config !== 'undefined' && Config.TAXONOMY) {
      Config.TAXONOMY.forEach(function (c) {
        if (c.id !== 'tarefas') return;
        addAll(c.keywords.weak, 0.12);
        addAll(c.keywords.strong, 0.35);
      });
    }
    var keys = Object.keys(weights).sort(function (a, b) {
      return b.length - a.length;
    });
    actionMatcherCache_ = {
      weights: weights,
      re: new RegExp('(?:^|[^a-z0-9])(' + keys.map(Util.escapeRegExp).join('|') + ')(?![a-z0-9])', 'g'),
    };
    return actionMatcherCache_;
  }

  /** Frases (sentenças) do texto: {s, e, term} com o terminador ('?', '.', '\n', ...). */
  function pieces_(s) {
    var out = [];
    var last = 0;
    var re = /[!?;\n]|\.(?=\s|$)/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      out.push({ s: last, e: m.index, term: m[0] });
      last = m.index + 1;
    }
    out.push({ s: last, e: s.length, term: '' });
    return out;
  }

  /**
   * Texto da frase antes de `pos`, limitado a 120 caracteres (evita custo quadrático em frases enormes).
   * Um trecho cortado nunca é "início de frase": recebe um marcador que reprova RE_PRE_CLAUSE_START.
   */
  function preOf_(pieces, nu, pos) {
    var s = pieceAt_(pieces, pos).s;
    return s < pos - 120 ? '\u0000' + nu.slice(pos - 120, pos) : nu.slice(s, pos);
  }

  /** Frase que contém `pos` (busca binária: textos longos têm milhares de frases). */
  function pieceAt_(pieces, pos) {
    var lo = 0;
    var hi = pieces.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (pieces[mid].e < pos) lo = mid + 1;
      else hi = mid;
    }
    return pieces[lo];
  }

  /**
   * Força do pedido de ação (0..1) a partir de frases de pedido, imperativos de tarefa e perguntas diretas.
   *
   * - Frases fixas ("preciso que", "could you", "favor confirmar"), imperativos de TAREFA por forma verbal
   *   (formal no início da frase ou após "me/nos/e": "envie", "atualize", "faça o check-in"; informal com
   *   clítico: "me manda", "me avisa"; inglês no início da frase: "send me", "please pay"), tarefas
   *   atribuídas ("atribuiu … a você", "requested your review") e obrigações ("deve ser entregue até").
   * - Negados ("não responda este e-mail") não contam; condicionais ("se não foi você, …", "qualquer dúvida,
   *   me avise") valem 40%. "Não precisa fazer nada" corta o resultado pela metade.
   * - Perguntas: ≥ 3 palavras, ou curtas e diretas ("Qual prefere?"); saudações ("tudo bem?") não contam.
   * - Pedido com prazo na mesma frase ("me manda até amanhã") ou tarefa atribuída com data explícita reforça.
   * `ctx = {isAutomated, isBulk, userInTo}` modula: massa ×0,3 (×0,9 com pista transacional — tarefa
   * atribuída, etapa de processo, pendência, mensagem de pessoa retransmitida —; ×0,5 só com prazo explícito,
   * isto é, data escrita ou pedido com prazo concreto: "confirme até hoje às 18h"); automático ×0,5 (exceto
   * cobrança/assinatura, pista transacional ou prazo explícito); Para +0,15.
   * @return {{score: number, phrases: string[], asksQuestion: boolean}}
   */
  function actionSignals(text, ctx) {
    var c = ctx || {};
    var orig = str_(text);
    var f = fold(orig);
    // URLs viram espaços (mesmo comprimento): "…/confirmar" num link não é pedido.
    var nu = f.replace(/https?:\/\/\S+/g, blank_);
    var pieces = pieces_(nu);
    var matcher = actionMatcher_();
    var cands = [];
    function push(start, end, w) {
      cands.push({ start: start, end: end, key: nu.slice(start, end), w: w });
    }
    eachMatch_(matcher.re, nu, function (m) {
      var start = m.index + m[0].length - m[1].length;
      push(start, start + m[1].length, matcher.weights[m[1]]);
    });
    eachMatch_(RE_IMP_FORMAL, nu, function (m) {
      var start = m.index + m[0].length - m[1].length;
      var pre = preOf_(pieces, nu, start);
      if (RE_PRE_CLITIC.test(pre)) return push(start - pre.length + pre.search(/(?:me|nos)\s+$/), start + m[1].length, Math.max(0.35, IMP_WEIGHT[m[1]]));
      if (RE_PRE_CLAUSE_START.test(pre) || RE_PRE_COORD.test(pre) || /,\s*$/.test(pre)) {
        var end = start + m[1].length;
        if (nu.charAt(end) === ':') return; // rótulo de botão ("Responder:")
        if (FORMAL_NEEDS_OBJECT[m[1]] && !RE_NEXT_DETERMINER.test(nu.slice(end, end + 12))) return;
        push(start, end, IMP_WEIGHT[m[1]]);
      }
    });
    eachMatch_(RE_IMP_INFORMAL, nu, function (m) {
      var start = m.index + m[0].length - m[1].length;
      var end = start + m[1].length;
      var pre = preOf_(pieces, nu, start);
      if (RE_PRE_CLITIC.test(pre)) return push(start - pre.length + pre.search(/(?:me|nos)\s+$/), end, 0.35);
      if (INFORMAL_START_OK[m[1]] && RE_PRE_CLAUSE_START.test(pre) && RE_NEXT_DETERMINER.test(nu.slice(end, end + 12))) push(start, end, IMP_WEIGHT[m[1]]);
    });
    eachMatch_(RE_IMP_EN, nu, function (m) {
      var start = m.index + m[0].length - m[1].length;
      var end = start + m[1].length;
      var pre = preOf_(pieces, nu, start);
      var nx = nu.slice(end, end + 6);
      if (!RE_PRE_CLAUSE_START.test(pre) || /^\s*[:\-]/.test(nx) || (m[1] === 'check' && /^\s+out\b/.test(nx)) || (m[1] === 'sign' && /^\s+(?:up|in)\b/.test(nx))) return;
      push(start, end, IMP_WEIGHT[m[1]]);
    });
    eachMatch_(RE_MODAL_REQUEST, nu, function (m) {
      var start = m.index + m[0].length - m[1].length;
      var piece = pieceAt_(pieces, start);
      var pre = preOf_(pieces, nu, start);
      if (RE_PRE_CLAUSE_START.test(pre) || (piece.term === '?' && /(?:^|[^a-z])(?:voce|vc|voces|tu)\s+$/.test(pre))) push(start, start + m[1].length, 0.35);
    });
    eachMatch_(RE_TASK_ASSIGNED, nu, function (m) {
      var start = m.index + m[0].search(/[a-z]/);
      push(start, m.index + m[0].length, 0.5);
    });
    eachMatch_(RE_TASK_PENDING, nu, function (m) {
      if (/^(?:pendencias?|em aberto|em atraso|overdue|past due)$/.test(m[0].replace(/^[^a-z]+/, ''))) return;
      var start = m.index + m[0].search(/[a-z]/);
      push(start, m.index + m[0].length, 0.3);
    });
    eachMatch_(RE_OBLIGATION_ACT, nu, function (m) {
      var start = m.index + m[0].search(/[a-z]/);
      push(start, m.index + m[0].length, 0.35);
    });
    // Mesmo trecho achado por mais de uma regra: fica o maior peso.
    var bySpan = {};
    cands = cands.filter(function (cd) {
      var k = cd.start + ':' + cd.end;
      var prev = bySpan[k];
      if (prev) {
        prev.w = Math.max(prev.w, cd.w);
        return false;
      }
      bySpan[k] = cd;
      return true;
    });
    var quoted = [];
    eachMatch_(RE_QUOTED_HUMAN, nu, function (m) {
      if (RE_PERSON_PRONOUN.test(m[1])) quoted.push({ s: m.index, e: m.index + m[0].length });
    });
    function inQuote(pos) {
      return quoted.some(function (q) {
        return pos >= q.s && pos < q.e;
      });
    }
    var seen = {};
    var keep = 1;
    var phrases = [];
    var relayed = false;
    var dueBoost = false;
    var dueConcrete = false;
    resolveOverlaps_(cands).forEach(function (cd) {
      if (seen[cd.key]) return;
      var piece = pieceAt_(pieces, cd.start);
      var pre = preOf_(pieces, nu, cd.start);
      if (RE_PRE_NEGATION.test(pre)) return;
      // Infinitivo como rótulo/botão ("Enviar para: …", "Responder: https://…") não é pedido.
      if (/(?:ar|er|ir)$/.test(cd.key) && /^\s*(?:[^\s:]+\s+){0,2}?[^\s:]*:(?!\d)/.test(nu.slice(cd.end, Math.min(piece.e, cd.end + 40)))) return;
      seen[cd.key] = true;
      var w = cd.w;
      var conditional = RE_PRE_CONDITIONAL.test(pre);
      if (conditional) w *= 0.4;
      else if (cd.w >= 0.3 && !NOT_A_REQUEST[cd.key]) {
        var around = pre + ' ' + nu.slice(cd.end, Math.min(piece.e, cd.end + 120));
        if (RE_DUE_CUE.test(around)) dueBoost = true;
        if (RE_DUE_CONCRETE.test(around)) dueConcrete = true;
      }
      if (inQuote(cd.start)) relayed = true;
      keep *= 1 - w;
      phrases.push(orig.slice(cd.start, cd.end));
    });
    var asksQuestion = false;
    var direct = false;
    pieces.forEach(function (p) {
      if (p.term !== '?') return;
      var t = nu.slice(p.s, p.e).trim().replace(RE_Q_LEAD, '');
      if (!t || RE_PLEASANTRY_ONLY.test(t)) return;
      if (Util.wordCount(t) < 3 && !RE_SHORT_QUESTION.test(t)) return;
      asksQuestion = true;
      if (RE_DIRECT_QUESTION.test(t)) direct = true;
      if (inQuote(p.s + 1) || inQuote(p.e - 1)) relayed = true;
    });
    if (asksQuestion) keep *= direct ? 0.65 : 0.75;
    var assigned = RE_TASK_ASSIGNED_1.test(nu);
    var cue = assigned || RE_TASK_STAGE.test(nu) || RE_TASK_PENDING_1.test(nu) || relayed;
    var dueExplicit = dueConcrete || pieces.some(function (p) {
      var s = nu.slice(p.s, p.e);
      return RE_EXPLICIT_DUE.test(s) && !RE_OFFER.test(s);
    });
    if (keep < 1 && (dueBoost || ((assigned || RE_TASK_STAGE.test(nu)) && dueExplicit))) keep *= 0.75;
    var score = 1 - keep;
    if (score > 0 && pieces.some(function (p) {
      var s = nu.slice(p.s, p.e);
      var at = s.search(RE_NO_ACTION);
      return at >= 0 && !RE_PRE_CONDITIONAL.test(s.slice(0, at + 1));
    })) score *= 0.5;
    if (c.isBulk) score *= assigned ? 1 : cue ? 0.9 : dueExplicit ? 0.5 : 0.3;
    if (c.isAutomated && !RE_BILLING.test(nu) && !cue && !dueExplicit) score *= 0.5;
    if (c.userInTo && score > 0) score += 0.15;
    return { score: Util.round(Util.clamp(score, 0, 1), 3), phrases: Util.uniq(phrases).slice(0, 5), asksQuestion: asksQuestion };
  }

  // ----------------------------------------------------------- resumo ----
  var RE_GREETING = /^(?:ola|oi|prezad[oa]s?|car[oa]s?|querid[oa]s?|bom dia|boa tarde|boa noite|hello|hi|hey|dear|good (?:morning|afternoon|evening)|greetings|e ai|saudacoes)\b/;
  var RE_SIGNOFF = /^(?:atenciosamente|att\.?|abs\.?|abracos?|um abraco|grande abraco|obrigad[oa]s?|muito obrigad[oa]|agradeco|cordialmente|saudacoes|best(?: regards)?|kind regards|regards|cheers|thanks|thank you|sincerely|--|enviado do meu|sent from my)\b/;
  var RE_BOILERPLATE = /ver no navegador|ver online|visualizar no navegador|abrir no navegador|leia no navegador|view in (?:your )?browser|view (?:this email )?online|view as a web ?page|se (?:voce )?nao conseguir visualizar|having trouble viewing|clique aqui para (?:ver|visualizar)|descadastr|cancelar (?:a )?inscricao|unsubscribe|nao responda|do not reply|este e-?mail foi enviado|this email was sent|voce esta recebendo|you are receiving|politica de privacidade|privacy policy|todos os direitos reservados|all rights reserved/;
  var RE_PLEASANTRY = /^(?:tudo bem|tudo bom|espero que (?:esteja|estejam|voce esteja|voces estejam|tudo esteja) bem|como vai|hope (?:you are|you're|this (?:email|message) finds you) well|i hope you)/;

  function splitSentences_(p) {
    var out = [];
    var buf = '';
    for (var i = 0; i < p.length; i++) {
      var ch = p.charAt(i);
      buf += ch;
      if ('.!?…'.indexOf(ch) >= 0 && (i + 1 === p.length || /\s/.test(p.charAt(i + 1)))) {
        out.push(buf.trim());
        buf = '';
      }
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  /**
   * Resumo extrativo: 1–2 frases informativas (≤ maxChars), sem saudação, assinatura e boilerplate.
   */
  function extractiveSummary(text, subject, maxChars) {
    var max = maxChars || 280;
    var subjNorm = Util.normalizeText(subject).replace(/[^a-z0-9]+/g, '');
    var lines = str_(text).replace(/\r\n?/g, '\n').split('\n');
    var paragraphs = [];
    var cur = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+/g, ' ').trim();
      var fl = fold(line);
      if (!line) {
        if (cur.length) paragraphs.push(cur.join(' '));
        cur = [];
        continue;
      }
      if (fl.length < 40 && RE_SIGNOFF.test(fl)) break;
      if (RE_BOILERPLATE.test(fl) || /^(?:https?:\/\/|www\.)\S+$/.test(fl) || /^[-=_*~#]{3,}$/.test(fl)) continue;
      if (RE_GREETING.test(fl)) {
        var cut = fl.slice(0, 50).search(/[,!:.]/);
        if (cut < 0 && fl.length < 50) continue;
        if (cut >= 0) line = line.slice(cut + 1).trim();
      }
      if (line.length < 20) continue;
      cur.push(line);
    }
    if (cur.length) paragraphs.push(cur.join(' '));
    var picked = [];
    for (var p = 0; p < paragraphs.length && picked.length < 2; p++) {
      var sents = splitSentences_(paragraphs[p]);
      for (var s = 0; s < sents.length && picked.length < 2; s++) {
        var st = sents[s];
        var fs = fold(st);
        if (st.length < 20 || RE_PLEASANTRY.test(fs) || RE_BOILERPLATE.test(fs)) continue;
        if (subjNorm && Util.normalizeText(st).replace(/[^a-z0-9]+/g, '') === subjNorm) continue;
        if (picked.length === 1 && (picked[0].length > max * 0.6 || picked[0].length + 1 + st.length > max)) {
          return Util.truncate(picked[0], max);
        }
        picked.push(st);
      }
    }
    if (!picked.length) return Util.truncate(str_(subject).trim(), max);
    return Util.truncate(picked.join(' '), max);
  }

  // ------------------------------------------------------------ vagas ----
  var RE_ROLE_NOUN = /(?:^|[^a-z])(?:analista|cientista|engenheir[oa]|desenvolvedora?|programadora?|arquitet[oa]|gerente|coordenadora?|supervisora?|especialista|diretora?|head|lider|lead|consultora?|estagiari[oa]|estagio|trainee|assistente|auxiliar|tecnic[oa]|designer|product|produto|pesquisadora?|economista|estatistic[oa]|scientist|engineer|analyst|developer|manager|director|specialist|consultant|architect|intern|internship|researcher|data|dados|pricing|precificacao|software|controller|contadora?|advogad[oa]|professora?|executiv[oa]|representante|vendedora?|recruiter|recrutadora?|devops|sre|cto|cfo|ceo|coo|owner)(?![a-z])/;
  var RE_ROLE_LABEL = /(?:^|\n|[|•·;])[ \t]*(?:cargo|posicao|position|role|titulo da vaga|job title|vaga|funcao)[ \t]*:[ \t]*([^\n|;]{2,80})/g;
  var RE_ROLE_PHRASES = [
    /(?:^|[^a-z])(?:vagas?|oportunidades?|opportunity|posicao|position|processo seletivo)\s+(?:de|para|for|as|como)\s+(?:(?:a|o|um|uma|an?)\s+)?([^\n,.;:!?|()]{3,70})/g,
    /(?:^|[^a-z])(?:contratando|procuramos|buscamos|estamos buscando|hiring|looking for|seeking)\s+(?:(?:a|o|um|uma|an?)\s+)?([^\n,.;:!?|()]{3,70})/g,
  ];
  var RE_ROLE_CUT = /\s+(?:na|no|em|at|in|para|com|with|que|who|to|for|pela|pelo|-|–|—|\|)\s+/;
  var RE_ROLE_PREFIX = /^(?:(?:re|res|fw|fwd|enc)\s*:\s*|(?:nova|novas|new)\s+(?:vagas?|jobs?)\s*(?:de|para|for)?\s*[:\-]?\s*|vagas?\s*[:\-]\s*|job alert\s*[:\-]\s*|alerta de vagas?\s*[:\-]\s*|(?:sua\s+)?candidatura\s+(?:para|a)\s+(?:a\s+vaga\s+(?:de\s+)?)?|(?:your\s+)?application\s+(?:for|to)\s+(?:the\s+)?|(?:a\s+)?vaga\s+(?:de|para)\s+|oportunidade\s+(?:de|para)\s+|convite para (?:a )?entrevista (?:para|de)\s+(?:a\s+vaga\s+(?:de\s+)?)?|vagas? recomendadas?(?:\s+para voce)?\s*[:\-]\s*)/;
  var CAP_TOKEN = "[A-ZÀ-Ý0-9](?:[\\wÀ-ÿ&'\\-]|\\.(?=[A-Za-z0-9]))*";
  var CAPWORDS = CAP_TOKEN + '(?:\\s+(?:' + CAP_TOKEN + '|de|do|da|dos|das|&|e)){0,4}';
  var RE_COMPANY_AFTER = new RegExp('^\\s*,?\\s*(?:na|no|at|pela|pelo|@|-|–|\\|)\\s+(' + CAPWORDS + ')');
  var RE_COMPANY_ANY = new RegExp('\\s(?:na|no|at|@)\\s+(' + CAPWORDS + ')');
  var RE_COMPANY_LABEL = /(?:^|\n|[|•·;])[ \t]*(?:empresa|company|companhia|employer|organizacao|contratante)[ \t]*:[ \t]*([^\n|;,]{2,60})/;
  var RE_COMPANY_STOP = /^(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hoje|amanha|semana|linkedin|gupy|indeed|glassdoor|catho|infojobs|vagas|plataforma|area|equipe|time|sua|seu|nossa|nosso)\b/;
  var RE_SPLIT_ROLE_COMPANY = /\s+[-–—|]\s+|\s+@\s+|\s+(?:na|no|at)\s+(?=[A-ZÀ-Ý0-9])/;
  var RE_WORKMODE_TAIL = /\s*(?:[-–|(]\s*)?(?:100%\s*)?(?:remot[oa]|remote|h[ií]brid[oa]|hybrid|presencial|on-?site|home office)\)?\s*$/i;

  var SENIORITY = [
    { key: 'estagio', role: /\b(?:estagio|estagiari[oa]s?|intern|internship)\b/, free: /\b(?:estagiari[oa]s?|programa de estagio|vaga de estagio|internship)\b/ },
    { key: 'trainee', role: /\btrainee\b/, free: /\btrainee\b/ },
    { key: 'junior', role: /\b(?:junior|jr)\b/, free: /\bjunior\b/ },
    { key: 'pleno', role: /\b(?:pleno|pl)\b/, free: /\bpleno\b/ },
    { key: 'senior', role: /\b(?:senior|sr)\b/, free: /\bsenior\b/ },
    { key: 'especialista', role: /\b(?:especialista|specialist)\b/, free: /\bespecialista\b/ },
    { key: 'staff', role: /\bstaff\b/ },
    { key: 'principal', role: /\bprincipal\b/ },
    { key: 'lead', role: /\b(?:lead|lider|tech lead|team lead)\b/ },
    { key: 'coordenador', role: /\b(?:coordenadora?|coordinator)\b/, free: /\bcoordenadora?\b/ },
    { key: 'gerente', role: /\b(?:gerente|manager)\b/ },
    { key: 'head', role: /\bhead\b/ },
    { key: 'diretor', role: /\b(?:diretora?|director)\b/ },
  ];

  // [nome exibido, exige UF depois (nome ambíguo em pt)]
  var CITIES = [
    ['São Paulo'], ['Rio de Janeiro'], ['Belo Horizonte'], ['Curitiba'], ['Porto Alegre'], ['Brasília'], ['Recife'], ['Fortaleza'],
    ['Florianópolis'], ['Campinas'], ['Goiânia'], ['Manaus'], ['Barueri'], ['São José dos Campos'], ['Ribeirão Preto'], ['Joinville'],
    ['Blumenau'], ['Londrina'], ['Niterói'], ['Osasco'], ['Santo André'], ['São Bernardo do Campo'], ['Uberlândia'], ['Sorocaba'],
    ['João Pessoa'], ['Maceió'], ['Aracaju'], ['Teresina'], ['São Luís'], ['Cuiabá'], ['Jundiaí'], ['Alphaville'], ['São Carlos'],
    ['Maringá'], ['Juiz de Fora'], ['Caxias do Sul'], ['Campo Grande'], ['Salvador', true], ['Natal', true], ['Vitória', true],
    ['Santos', true], ['Belém', true],
  ].map(function (c) {
    return { name: c[0], key: foldStatic_(c[0]), needsUf: !!c[1] };
  }).sort(function (a, b) {
    return b.key.length - a.key.length;
  });
  var UFS = 'ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to';
  var RE_UF_AFTER = new RegExp('^\\s*(?:,|/|-|–)\\s*(' + UFS + ')(?![a-z])');
  var RE_CITY_UF = new RegExp("([A-ZÀ-Ý][a-zà-ÿ]+(?:\\s+(?:de|do|da|dos|das)\\s+[A-ZÀ-Ý][a-zà-ÿ]+|\\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,3})\\s*(?:,|/)\\s*(" + UFS.toUpperCase() + ')(?![A-Za-z])');

  /** @type {Array<Array<*>>} */
  var SKILLS = [
    ['python', /\bpython\b/], ['sql', /\bsql\b/], ['spark', /\b(?:py)?spark\b/], ['aws', /\baws\b/], ['gcp', /\bgcp\b|\bgoogle cloud\b/],
    ['azure', /\bazure\b/], ['tableau', /\btableau\b/], ['power bi', /\bpower ?bi\b/], ['excel', /\bexcel\b/], ['r', null],
    ['machine learning', /\bmachine learning\b|\baprendizado de maquina\b/], ['deep learning', /\bdeep learning\b/],
    ['pricing', /\bpricing\b|\bprecificacao\b/], ['estatística', /\bestatistica\b|\bstatistics\b/],
    ['a/b testing', /\ba\/b test(?:ing|s)?\b|\btestes? a\/b\b|\bab testing\b/], ['dbt', /\bdbt\b/], ['airflow', /\bairflow\b/],
    ['docker', /\bdocker\b/], ['kubernetes', /\bkubernetes\b|\bk8s\b/], ['bigquery', /\bbig ?query\b/], ['snowflake', /\bsnowflake\b/],
    ['pandas', /\bpandas\b/], ['scikit-learn', /\bscikit[- ]learn\b|\bsklearn\b/], ['pytorch', /\bpytorch\b/],
    ['tensorflow', /\btensorflow\b/], ['llm', /\bllms?\b/], ['nlp', /\bnlp\b|\bpln\b/],
  ];

  // Dobra usada só na montagem das tabelas acima (em tempo de carga, sem tocar em Util).
  function foldStatic_(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /** "R" como linguagem: maiúsculo, isolado e em lista ("Python, R e SQL", "R/Python"). */
  function hasRLanguage_(orig) {
    var re = /(^|[^A-Za-z0-9$])R(?![A-Za-z0-9$&])/g;
    var m;
    while ((m = re.exec(orig)) !== null) {
      var at = m.index + m[1].length;
      var before = orig.slice(Math.max(0, at - 6), at);
      var after = orig.slice(at + 1, at + 7);
      if (/(?:,|\/|\be|\bou|\band|\bor|:)\s*$/.test(before) || /^\s*(?:,|\/|e\b|ou\b|and\b|or\b)/.test(after)) return true;
    }
    return false;
  }

  function cleanRole_(s) {
    var r = str_(s).replace(/\s+/g, ' ').trim();
    for (var i = 0; i < 3; i++) {
      var m = RE_ROLE_PREFIX.exec(fold(r));
      if (!m || !m[0]) break;
      r = r.slice(m[0].length).trim();
    }
    r = r.replace(RE_WORKMODE_TAIL, '').replace(/[\s,;:.!\-–|]+$/, '').trim();
    return Util.truncate(r, 80);
  }

  function cleanCompany_(s) {
    var c = str_(s).replace(/\s+/g, ' ').trim().replace(/[\s,;:!?]+$/, '');
    c = c.replace(/\s+(?:de|do|da|dos|das|&|e)$/i, '').replace(/\.$/, '').trim();
    if (!c || RE_COMPANY_STOP.test(fold(c))) return '';
    return Util.truncate(c, 60);
  }

  function companyAfter_(orig, at) {
    var m = RE_COMPANY_AFTER.exec(orig.slice(at, at + 70));
    return m ? cleanCompany_(m[1]) : '';
  }

  /** Cargo e empresa: rótulos ("Cargo:", "Vaga:"), frases ("vaga de X na Y") e assuntos de alerta ("X na Y"). */
  function roleAndCompany_(subject, text) {
    var sources = [str_(subject), str_(text)];
    var role = '';
    var company = '';
    for (var i = 0; i < sources.length && !role; i++) {
      var orig = sources[i];
      var f = fold(orig);
      RE_ROLE_LABEL.lastIndex = 0;
      var lm = RE_ROLE_LABEL.exec(f);
      if (lm) {
        var vStart = lm.index + lm[0].length - lm[1].length;
        var value = orig.slice(vStart, vStart + lm[1].length);
        var parts = value.split(RE_SPLIT_ROLE_COMPANY);
        var cand = cleanRole_(parts[0]);
        if (cand && (RE_ROLE_NOUN.test(fold(cand)) || !/^vaga/.test(lm[0].replace(/^[^a-z]*/, '')))) {
          role = cand;
          if (parts.length > 1) company = cleanCompany_(parts[1]);
          break;
        }
      }
      for (var k = 0; k < RE_ROLE_PHRASES.length && !role; k++) {
        var re = RE_ROLE_PHRASES[k];
        re.lastIndex = 0;
        var pm;
        while ((pm = re.exec(f)) !== null) {
          var gStart = pm.index + pm[0].length - pm[1].length;
          var cut = pm[1].search(RE_ROLE_CUT);
          var rawRole = orig.slice(gStart, gStart + (cut >= 0 ? cut : pm[1].length));
          var cr = cleanRole_(rawRole);
          if (cr && RE_ROLE_NOUN.test(fold(cr))) {
            role = cr;
            company = company || companyAfter_(orig, gStart + rawRole.length);
            break;
          }
        }
      }
      if (!role && i === 0) {
        var sm = /^(.{3,80}?)\s+(?:na|no|at|@|-|–|\|)\s+([A-ZÀ-Ý0-9].{1,60})$/.exec(orig.trim());
        if (sm) {
          var ar = cleanRole_(sm[1]);
          if (ar && RE_ROLE_NOUN.test(fold(ar))) {
            role = ar;
            company = company || cleanCompany_(sm[2].split(/\s+[-–|]\s+|\s*\(/)[0]);
          }
        }
      }
    }
    if (!company) {
      var cl = RE_COMPANY_LABEL.exec(fold(sources[1]));
      if (cl) {
        var cs = cl.index + cl[0].length - cl[1].length;
        company = cleanCompany_(sources[1].slice(cs, cs + cl[1].length));
      }
    }
    if (!company && role) {
      var ca = RE_COMPANY_ANY.exec(sources[0]);
      if (ca) company = cleanCompany_(ca[1]);
    }
    return { role: role, company: company };
  }

  function seniorityOf_(role, subject, text) {
    var best = -1;
    // Abreviações ("Sr.", "Jr.") só valem em texto com cara de cargo.
    var fs = fold(subject);
    [fold(role), RE_ROLE_NOUN.test(fs) ? fs : ''].some(function (src) {
      if (!src) return false;
      SENIORITY.forEach(function (s, i) {
        if (s.role.test(src) && i > best) best = i;
      });
      return best >= 0;
    });
    if (best < 0) {
      var ft = fold(subject + '\n' + text);
      SENIORITY.forEach(function (s, i) {
        if (s.free && s.free.test(ft) && i > best) best = i;
      });
    }
    return best >= 0 ? SENIORITY[best].key : '';
  }

  function workModeOf_(f) {
    if (/\b(?:hibrid[oa]|hybrid)\b/.test(f)) return 'hybrid';
    if (/\b(?:remot[oa]|remote|home[- ]office|anywhere|teletrabalho|trabalho a distancia)\b/.test(f)) return 'remote';
    if (/\b(?:presencial|on-site|onsite|on site|in-office|in office)\b/.test(f)) return 'onsite';
    return 'unknown';
  }

  function locationOf_(orig, f, workMode) {
    /** @type {*} */
    var best = null;
    CITIES.forEach(function (c) {
      var re = new RegExp('(?:^|[^a-z])(' + Util.escapeRegExp(c.key) + ')(?![a-z])', 'g');
      var m;
      while ((m = re.exec(f)) !== null) {
        var at = m.index + m[0].length - m[1].length;
        var end = at + m[1].length;
        var uf = RE_UF_AFTER.exec(f.slice(end, end + 6));
        if (c.needsUf && !uf) continue;
        if (!best || at < best.at) best = { at: at, name: c.name + (uf ? ', ' + uf[1].toUpperCase() : '') };
        break;
      }
    });
    if (best) return best.name;
    var g = RE_CITY_UF.exec(orig);
    if (g && !RE_ROLE_NOUN.test(fold(g[1])) && !RE_COMPANY_STOP.test(fold(g[1]))) return g[1] + ', ' + g[2];
    return workMode === 'remote' ? 'Remoto' : '';
  }

  /**
   * Sinais heurísticos de vaga. Campos ausentes = '' (workMode ausente = 'unknown').
   * seniority ∈ estagio|trainee|junior|pleno|senior|especialista|staff|principal|lead|coordenador|gerente|head|diretor.
   * @return {{role: string, company: string, seniority: string, workMode: string, location: string, skills: string[]}}
   */
  function jobSignals(text, subject) {
    var body = str_(text);
    var subj = str_(subject);
    var all = subj + '\n' + body;
    var f = fold(all);
    var rc = roleAndCompany_(subj, body);
    var workMode = workModeOf_(f);
    var skills = [];
    SKILLS.forEach(function (s) {
      var ok = s[1] ? s[1].test(f) : hasRLanguage_(all);
      if (ok) skills.push(s[0]);
    });
    return {
      role: rc.role,
      company: rc.company,
      seniority: seniorityOf_(rc.role, subj, body),
      workMode: workMode,
      location: locationOf_(all, f, workMode),
      skills: skills,
    };
  }

  // ------------------------------------------------------- casamentos ----
  function significant_(s) {
    return Util.normalizeText(s).replace(/[^a-z0-9]+/g, '');
  }

  /**
   * A evidência aparece no texto? Compara só letras e dígitos (ignora acentos, caixa, aspas,
   * pontuação e espaços). Reticências separam trechos que devem aparecer em ordem.
   * Exige ≥ 12 caracteres significativos.
   */
  function containsNormalized(haystack, needle) {
    var parts = str_(needle).split(/\.{3,}|…/).map(significant_).filter(function (p) {
      return p.length >= 3;
    });
    var total = parts.reduce(function (a, p) {
      return a + p.length;
    }, 0);
    if (total < 12) return false;
    var hay = significant_(haystack);
    var pos = 0;
    for (var i = 0; i < parts.length; i++) {
      var idx = hay.indexOf(parts[i], pos);
      if (idx < 0) return false;
      pos = idx + parts[i].length;
    }
    return true;
  }

  /**
   * Interesses do perfil presentes no texto (palavras inteiras, plural simples tolerado).
   * @return {{score: number, matched: string[]}} score = min(1, casados/2)
   */
  function interestMatch(text, interests) {
    var hay = ' ' + Util.normalizeText(text).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    var matched = [];
    var seen = {};
    (interests || []).forEach(function (it) {
      var k = Util.normalizeText(it).replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k || seen[k]) return;
      if (new RegExp(' ' + Util.escapeRegExp(k) + '(?:s|es)? ').test(hay)) {
        seen[k] = true;
        matched.push(it);
      }
    });
    return { score: Math.min(1, matched.length / 2), matched: matched };
  }

  return {
    fold: fold,
    findDates: findDates,
    findDeadlines: findDeadlines,
    findMoney: findMoney,
    parseAmount: parseAmount,
    findCompensation: findCompensation,
    redactPii: redactPii,
    isValidCpf: isValidCpf,
    isValidCnpj: isValidCnpj,
    luhnValid: luhnValid,
    detectInjection: detectInjection,
    actionSignals: actionSignals,
    extractiveSummary: extractiveSummary,
    jobSignals: jobSignals,
    containsNormalized: containsNormalized,
    interestMatch: interestMatch,
  };
})();
