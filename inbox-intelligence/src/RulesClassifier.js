/**
 * Classificador determinístico (sempre ativo, sem custo). Produz categorias
 * multi-rótulo, sinais, ações, prazos, oportunidades e um resumo extrativo.
 * É o fallback completo quando a IA está desativada, fora do ar ou sem quota.
 */
var RulesClassifier = (function () {
  var W = { strongSubject: 6, strongBody: 3, weakSubject: 2, weakBody: 1, bodyCap: 12, domain: 4, pattern: 5, gmail: 2, negative: 3 };
  var MIN_SCORE = 3;
  var TOPICAL = ['noticias', 'economia', 'tecnologia', 'negocios', 'carreira', 'financas'];
  // Categorias em que pedidos/prazos de remetentes automáticos são tarefas legítimas.
  var TRANSACTIONAL = ['contas', 'agenda', 'compras', 'tarefas', 'trabalho', 'saude', 'governo_juridico'];
  var STOP = ['vaga', 'vagas', 'oportunidade', 'para', 'de', 'da', 'do', 'em', 'na', 'no', 'a', 'o', 'e', 'job', 'opportunity', 'position', 'role', 'the', 'at', 'for', 'ltda', 'sa', 's/a', 'inc', 'brasil'];
  var compiled_ = null;
  var compiledFor_ = '';

  // ------------------------------------------------------ casamento ----
  function makeMatcher_(kw) {
    var n = Util.normalizeText(kw);
    if (!n) return null;
    if (/^[a-z0-9 ]+$/.test(n)) {
      var re = new RegExp('(^|[^a-z0-9])' + Util.escapeRegExp(n).replace(/ /g, '\\s+') + '(?=$|[^a-z0-9])', 'g');
      return { kw: n, count: function (t) { var m = t.match(re); return m ? m.length : 0; } };
    }
    return {
      kw: n,
      count: function (t) {
        var c = 0;
        var i = t.indexOf(n);
        while (i >= 0 && c < 5) {
          c++;
          i = t.indexOf(n, i + n.length);
        }
        return c;
      },
    };
  }

  function compile_(taxonomy) {
    var key = Util.shortHash(JSON.stringify(taxonomy.map(function (c) { return [c.id, c.keywords, c.negative, c.senderDomains, c.senderPatterns]; })), 12);
    if (compiled_ && compiledFor_ === key) return compiled_;
    compiled_ = taxonomy.map(function (c) {
      return {
        cat: c,
        strong: (c.keywords.strong || []).map(makeMatcher_).filter(Boolean),
        weak: (c.keywords.weak || []).map(makeMatcher_).filter(Boolean),
        negative: (c.negative || []).map(makeMatcher_).filter(Boolean),
        domains: (c.senderDomains || []).map(function (d) { return String(d).toLowerCase(); }),
        patterns: (c.senderPatterns || []).map(function (p) { return String(p).toLowerCase(); }),
      };
    });
    compiledFor_ = key;
    return compiled_;
  }

  function domainMatches_(domain, list) {
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (domain === d || domain.slice(-(d.length + 1)) === '.' + d) return d;
    }
    return '';
  }

  // ---------------------------------------------------- classificação ----
  /**
   * @param {Object} parsed ParsedMessage
   * @param {{refYmd?: string, taxonomy?: Object[], profile?: Object, knownContacts?: Object}} ctx
   */
  function classify(parsed, ctx) {
    var c = ctx || {};
    var cfg = Config.get();
    var taxonomy = c.taxonomy || Config.taxonomy();
    var profile = c.profile || cfg.profile;
    var refYmd = c.refYmd || parsed.received_date || Util.todayYmd();
    var subject = Util.normalizeText(parsed.subject || '');
    var bodyRaw = parsed.body_text || parsed.body_excerpt || parsed.snippet || '';
    var body = Util.normalizeText(bodyRaw).slice(0, 12000);
    var fromEmail = String(parsed.from_email || '').toLowerCase();
    var fromDomain = String(parsed.from_domain || Util.emailDomain(fromEmail)).toLowerCase();
    var matchers = compile_(taxonomy);
    var scores = {};
    var hits = {};
    var signals = [];

    matchers.forEach(function (m) {
      var s = 0;
      var bodyPart = 0;
      var found = [];
      m.strong.forEach(function (x) {
        var a = x.count(subject);
        var b = Math.min(2, x.count(body));
        if (a) s += W.strongSubject;
        bodyPart += b * W.strongBody;
        if (a || b) found.push(x.kw);
      });
      m.weak.forEach(function (x) {
        var a = x.count(subject);
        var b = Math.min(2, x.count(body));
        if (a) s += W.weakSubject;
        bodyPart += b * W.weakBody;
        if ((a || b) && found.length < 8) found.push(x.kw);
      });
      s += Math.min(W.bodyCap, bodyPart);
      m.negative.forEach(function (x) {
        if (x.count(subject) || x.count(body)) s -= W.negative;
      });
      var dom = domainMatches_(fromDomain, m.domains);
      if (dom) {
        s += W.domain;
        found.unshift('@' + dom);
      }
      if (m.patterns.some(function (p) { return fromEmail === p || (p.indexOf('@') < 0 && fromEmail.indexOf(p) === 0); })) {
        s += W.pattern;
        found.unshift(fromEmail);
      }
      if (parsed.gmail_category && m.cat.gmailCategories.indexOf('CATEGORY_' + parsed.gmail_category) >= 0) s += W.gmail;
      scores[m.cat.id] = s;
      hits[m.cat.id] = found;
    });

    // Sinais estruturais.
    var bulk = !!parsed.is_bulk;
    if (bulk && (parsed.has_list_unsubscribe || parsed.list_id)) {
      add_(scores, 'newsletters', 4);
      signals.push('bulk_list');
    }
    if (parsed.gmail_category === 'PROMOTIONS') add_(scores, 'marketing', 2);
    if (parsed.auth_fail) {
      add_(scores, 'spam', 3);
      signals.push('auth_fail');
    }
    var action = Extractors.actionSignals(bodyRaw, { isAutomated: !!parsed.is_automated, isBulk: bulk, userInTo: !!parsed.user_in_to });
    if (action.score >= 0.4) add_(scores, 'tarefas', Math.round(action.score * 6));
    var deadlines = Extractors.findDeadlines((parsed.subject || '') + '\n' + bodyRaw, refYmd);
    if (deadlines.some(function (d) { return d.kind === 'EVENT'; })) add_(scores, 'agenda', 2);
    var job = Extractors.jobSignals(bodyRaw, parsed.subject || '');
    if (job.role) add_(scores, 'carreira', 3);
    if (scores.carreira > 0 && scores.networking > 0 && !job.role) add_(scores, 'networking', 1);

    // Escolha da principal e das secundárias.
    var ranked = Object.keys(scores).filter(function (id) {
      return id !== 'outros';
    }).sort(function (a, b) {
      if (scores[b] !== scores[a]) return scores[b] - scores[a];
      return catPrior_(taxonomy, b) - catPrior_(taxonomy, a);
    });
    var top = ranked[0];
    var primary = top && scores[top] >= MIN_SCORE ? top : 'outros';
    var maxScore = primary === 'outros' ? 0 : scores[primary];
    // Newsletter é formato: se houver tema forte, ele vira a principal.
    if (primary === 'newsletters') {
      var topical = ranked.filter(function (id) {
        return TOPICAL.indexOf(id) >= 0 && scores[id] >= Math.max(MIN_SCORE, 0.5 * maxScore);
      })[0];
      if (topical) {
        primary = topical;
        maxScore = scores[topical];
      }
    }
    var secondary = ranked.filter(function (id) {
      return id !== primary && scores[id] >= Math.max(MIN_SCORE, 0.5 * maxScore);
    }).slice(0, 3);
    if (bulk && primary !== 'newsletters' && primary !== 'marketing' && secondary.indexOf('newsletters') < 0 && (parsed.has_list_unsubscribe || parsed.list_id) && primary !== 'outros') {
      secondary = ['newsletters'].concat(secondary).slice(0, 3);
    }
    var second = ranked.filter(function (id) { return id !== primary; })[0];
    var margin = maxScore > 0 ? (maxScore - (scores[second] || 0)) / maxScore : 0;
    var confidence = primary === 'outros' ? 0.3 : Util.clamp(0.3 + 0.35 * Math.min(1, maxScore / 10) + 0.35 * margin, 0.2, 0.95);

    var isMarketing = primary === 'marketing' || (parsed.gmail_category === 'PROMOTIONS' && scores.marketing >= MIN_SCORE);
    var isSpam = scores.spam >= 6 || (!!parsed.auth_fail && scores.spam >= 4);
    var isNewsletter = primary === 'newsletters' || secondary.indexOf('newsletters') >= 0;

    // Ações: só de remetentes que não são envio em massa, ou de categorias transacionais.
    var actionRequired = action.score >= 0.5 && !isMarketing && !isSpam && primary !== 'seguranca_conta' &&
      (!isNewsletter || primary === 'tarefas') && (!bulk || TRANSACTIONAL.indexOf(primary) >= 0);
    var deadline = pickDeadline_(deadlines, refYmd);
    var actions = [];
    if (actionRequired) {
      actions = action.phrases.slice(0, 3).map(function (ph) {
        return {
          description: Util.truncate(sentenceAround_(bodyRaw, ph) || ph, 160),
          owner: parsed.user_in_to && !bulk ? 'me' : 'unknown',
          due_date: deadline ? deadline.date : '',
          due_certainty: deadline ? deadline.certainty : 'NONE',
          evidence: Util.truncate(Extractors.redactPii(ph).text, 120),
        };
      });
    }
    if (primary === 'contas' && deadline && deadline.kind === 'DEADLINE' && !isMarketing) {
      actionRequired = true;
      if (!actions.length) {
        actions.push({ description: 'Pagar ou verificar: ' + Util.truncate(Extractors.redactPii(parsed.subject || 'cobrança').text, 100), owner: 'me', due_date: deadline.date, due_certainty: deadline.certainty, evidence: Util.truncate(Extractors.redactPii(deadline.evidence).text, 120) });
      }
    }

    // Oportunidade.
    /** @type {any} */
    var opportunity = null;
    var careerish = primary === 'carreira' || primary === 'networking' || secondary.indexOf('carreira') >= 0;
    if (careerish && !isMarketing && !isSpam) {
      var carreira = Config.category('carreira');
      var fromBoard = !!domainMatches_(fromDomain, (carreira && carreira.senderDomains) || []) || /jobs|jobalerts|vagas/.test(fromEmail);
      var comp = Extractors.findCompensation(bodyRaw);
      opportunity = {
        type: job.role || primary === 'carreira' ? 'job' : 'networking',
        title: job.role ? job.role + (job.company ? ' — ' + job.company : '') : Util.truncate(parsed.subject || '', 100),
        company: job.company || '',
        role: job.role || '',
        seniority: job.seniority || '',
        location: job.location || '',
        work_mode: job.workMode || 'unknown',
        compensation: comp ? comp.raw : '',
        requirements: (job.skills || []).slice(0, 10),
        stage: '',
        next_step: actionRequired && actions[0] ? actions[0].description : '',
        deadline: deadline ? deadline.date : '',
        source: fromBoard ? 'job_board' : primary === 'networking' ? 'recruiter' : parsed.is_automated ? 'other' : 'network',
        is_mass: fromBoard || bulk,
        evidence: job.role ? job.role : '',
      };
      var fit = opportunityFit(opportunity, profile, bodyRaw);
      opportunity.fit = fit.fit;
      opportunity.fit_reasons = fit.reasons;
    }

    var interest = Extractors.interestMatch((parsed.subject || '') + ' ' + bodyRaw, profile.interests || []);
    var facts = keyFacts_(bodyRaw, deadlines, refYmd);
    var cat = Config.category(primary) || {};
    // Sensibilidade = OU de categorias, domínio e termos do assunto. Secundária sensível
    // só conta com evidência acima do mínimo (palavras fracas isoladas não decidem).
    var priv = cfg.privacy;
    var sensitive = [primary].concat(secondary).some(function (id) {
      var k = Config.category(id);
      return !!(k && k.sensitive) && (id === primary || scores[id] >= MIN_SCORE + 1);
    }) || !!domainMatches_(fromDomain, (priv.sensitiveDomains || []).map(function (d) { return String(d).toLowerCase(); })) ||
      (priv.sensitiveSubjectTerms || []).some(function (t) {
        return subject.indexOf(Util.normalizeText(t)) >= 0;
      });
    // Categorias sensíveis com qualquer pontuação relevante também marcam a mensagem.
    if (!sensitive) {
      sensitive = taxonomy.some(function (k) {
        return k.sensitive && scores[k.id] >= MIN_SCORE + 2;
      });
    }
    var entities = [];
    if (parsed.from_name && !parsed.is_automated && !bulk) entities.push({ name: Util.truncate(parsed.from_name, 80), type: 'person' });
    if (opportunity && opportunity.company) entities.push({ name: opportunity.company, type: 'company' });
    var injection = Extractors.detectInjection((parsed.subject || '') + '\n' + bodyRaw);
    if (injection.suspected) signals.push('injection');

    var reasonBits = [];
    if ((hits[primary] || []).length) reasonBits.push('Termos: ' + hits[primary].slice(0, 4).join(', '));
    if (bulk) reasonBits.push('envio em massa');
    if (actionRequired) reasonBits.push('pedido de ação');
    if (deadline) reasonBits.push('prazo ' + Util.formatBrDate(deadline.date));

    return {
      primary_category: primary,
      secondary_categories: secondary,
      category_scores: scores,
      confidence: Util.round(confidence, 3),
      reason: reasonBits.length ? reasonBits.join(' · ') : 'Sem sinais fortes de categoria',
      signals: signals,
      is_newsletter: isNewsletter,
      is_marketing: isMarketing,
      is_probable_spam: isSpam,
      is_automated: !!parsed.is_automated,
      is_bulk: bulk,
      action_required: actionRequired,
      action_score: Util.round(action.score, 3),
      actions: actions,
      deadline: deadline,
      opportunity: opportunity,
      summary: Extractors.extractiveSummary(bodyRaw, parsed.subject || '', 280) || Util.truncate(parsed.snippet || '', 280),
      key_facts: facts,
      topics: interest.matched.slice(0, 5),
      interest_score: interest.score,
      entities: entities,
      sensitive: sensitive,
      ai_eligible: !((cat.aiEligible === false && confidence >= 0.6) || isSpam),
      injection: injection,
    };
  }

  function add_(scores, id, n) {
    if (scores[id] !== undefined) scores[id] += n;
  }

  function catPrior_(taxonomy, id) {
    for (var i = 0; i < taxonomy.length; i++) if (taxonomy[i].id === id) return taxonomy[i].prior;
    return 0;
  }

  /** Prazo mais relevante: DEADLINE (explícito antes) e depois EVENT próximo. */
  function pickDeadline_(list, refYmd) {
    var dl = list.filter(function (d) {
      return d.kind === 'DEADLINE';
    });
    var pick = dl.filter(function (d) { return d.certainty === 'EXPLICIT'; })[0] || dl[0];
    if (!pick) {
      pick = list.filter(function (d) {
        var days = Util.daysBetween(refYmd, d.date);
        return d.kind === 'EVENT' && days >= -1 && days <= 60;
      })[0];
    }
    return pick ? { date: pick.date, time: pick.time || '', certainty: pick.certainty, kind: pick.kind, evidence: Extractors.redactPii(pick.evidence || '').text } : null;
  }

  function sentenceAround_(text, phrase) {
    var t = String(text || '');
    var idx = Util.normalizeText(t).indexOf(Util.normalizeText(phrase));
    if (idx < 0) return '';
    var sentences = t.split(/(?<=[.!?])\s+|\n+/);
    var acc = 0;
    var norm = Util.normalizeText;
    for (var i = 0; i < sentences.length; i++) {
      if (norm(sentences[i]).indexOf(norm(phrase)) >= 0) return sentences[i].trim();
      acc += sentences[i].length;
    }
    return '';
  }

  function keyFacts_(text, deadlines, refYmd) {
    var facts = [];
    deadlines.slice(0, 2).forEach(function (d) {
      facts.push({ fact: (d.kind === 'EVENT' ? 'Compromisso em ' : 'Prazo: ') + Util.formatBrDate(d.date) + (d.time ? ' às ' + d.time : ''), evidence: Util.truncate(Extractors.redactPii(d.evidence || '').text, 160) });
    });
    Extractors.findMoney(text).slice(0, 2).forEach(function (m) {
      facts.push({ fact: 'Valor mencionado: ' + m.raw, evidence: m.raw });
    });
    return facts.slice(0, 4);
  }

  // ------------------------------------------------------- oportunidade ----
  /**
   * Aderência configurável e explicável (0..1) ao perfil:
   * cargo 0,4 · senioridade 0,2 · modalidade 0,15 · temas/competências 0,25.
   */
  function opportunityFit(op, profile, text) {
    var p = profile || Config.get().profile;
    var reasons = [];
    var fit = 0;
    var role = Util.normalizeText((op.role || '') + ' ' + (op.title || ''));
    var roleHit = (p.targetRoles || []).filter(function (r) {
      var n = Util.normalizeText(r);
      return n && role.indexOf(n) >= 0;
    })[0];
    if (roleHit) {
      fit += 0.4;
      reasons.push('Cargo alinhado: ' + roleHit);
    }
    var sen = Util.normalizeText(op.seniority || '');
    var senHit = sen && (p.seniorityKeywords || []).some(function (s) {
      return sen.indexOf(Util.normalizeText(s)) >= 0;
    });
    if (senHit) {
      fit += 0.2;
      reasons.push('Senioridade compatível');
    }
    var modeMap = { remote: 'remoto', hybrid: 'hibrido', onsite: 'presencial' };
    if (op.work_mode && modeMap[op.work_mode] && (p.preferredWorkModes || []).map(Util.normalizeText).indexOf(modeMap[op.work_mode]) >= 0) {
      fit += 0.15;
      reasons.push('Modalidade preferida (' + modeMap[op.work_mode] + ')');
    }
    var blob = (op.requirements || []).join(' ') + ' ' + (op.title || '') + ' ' + String(text || '').slice(0, 4000);
    var im = Extractors.interestMatch(blob, p.interests || []);
    if (im.score > 0) {
      fit += 0.25 * im.score;
      reasons.push('Temas de interesse: ' + im.matched.slice(0, 3).join(', '));
    }
    return { fit: Util.round(Util.clamp(fit, 0, 1), 3), reasons: reasons };
  }

  /** Chave de deduplicação: empresa|cargo normalizados (vazia sem os dois). */
  function opportunityKey(op) {
    if (!op) return '';
    function norm(s) {
      return Util.normalizeText(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (w) {
        return w && STOP.indexOf(w) < 0;
      }).join(' ');
    }
    var company = norm(op.company);
    var role = norm(op.role);
    if (!company || !role) return '';
    return company + '|' + role;
  }

  return {
    TRANSACTIONAL: TRANSACTIONAL,
    classify: classify,
    opportunityFit: opportunityFit,
    opportunityKey: opportunityKey,
    MIN_SCORE: MIN_SCORE,
  };
})();
