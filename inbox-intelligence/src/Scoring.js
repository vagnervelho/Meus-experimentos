/**
 * Ranking explicável e determinístico.
 *
 * score = (Σ wᵢ·Xᵢ) × (0,6 + 0,4·confiabilidade) × ruído(categoria)
 *
 * Cada componente Xᵢ ∈ [0, 1] vem com uma justificativa em pt-BR. A IA nunca
 * define o score sozinha: ela contribui com sinais (importância, urgência sem
 * prazo, ação, oportunidade), sempre combinados com regras e limites fixos.
 *
 * Depois da soma ponderada vêm pisos e tetos explícitos (cada um vira um
 * componente com peso 0 e justificativa), sempre mantendo score e nível na
 * mesma faixa para que a ordenação por score respeite o nível:
 *  - piso Alta: pedido direto de PESSOA (não automático, você em "Para") com
 *    ação e prazo concreto (data explícita ou horário) para hoje ou amanhã;
 *    de contato conhecido/prioritário ou com consequência séria, Crítica;
 *  - pisos por gravidade (RulesClassifier.severity): séria ⇒ Média; muito
 *    grave com ação não condicional ⇒ Alta;
 *  - teto Média (score < limiar de Alta): remetente não confiável (falha de
 *    autenticação, spam, imitação) ou suspeita de injection;
 *  - teto Baixa (score < limiar de Média): marcada por você como irrelevante.
 * Ruído, newsletter e marketing nunca recebem pisos nem viram Crítica.
 */
var Scoring = (function () {
  var LABELS = {
    importance: 'Importância',
    urgency: 'Urgência',
    action: 'Ação pendente',
    opportunity: 'Oportunidade',
    sender: 'Remetente',
    novelty: 'Novidade',
    interest: 'Interesse',
  };
  var NOISE_CATEGORIES = ['marketing', 'spam'];
  var OBLIGATION_CATEGORIES = ['trabalho', 'tarefas', 'contas', 'governo_juridico', 'saude', 'financas'];
  // Categorias em que pedidos/prazos (inclusive de remetentes automáticos) são tarefas legítimas: boleto,
  // check-in, retirada, etapa de processo seletivo… Mesma lista de RulesClassifier.TRANSACTIONAL (há teste).
  var TRANSACTIONAL = ['contas', 'agenda', 'compras', 'tarefas', 'trabalho', 'saude', 'governo_juridico', 'carreira'];
  var URGENT_WORDS = /\b(urgente|urgencia|o quanto antes|imediatamente|asap|urgent|immediately|ultimo dia|hoje ainda)\b/;
  // Ação condicional ("se não foi você, …", "caso não reconheça, …", "if this wasn't you, …"): só exige algo
  // se a premissa valer, então não sustenta o piso Alta de notificação grave.
  var RE_CONDITIONAL_ACTION = /^\W*(?:(?:por favor|please|importante|important|atencao|attention)\W+)?(?:se|caso|if|in case)\s/;

  function catOf_(id) {
    return Config.category(id) || Config.category('outros');
  }

  // --------------------------------------------------------- features ----
  /**
   * Extrai os sinais normalizados que o ranking usa.
   * @param {Object} parsed ParsedMessage (ou linha equivalente do BigQuery)
   * @param {Object} merged análise combinada (regras + IA)
   * @param {{profile: Object, knownContacts: Object, senderAffinity: Object, duplicateHashes?: Object, cfg?: Object, override?: Object}} ctx
   */
  function features(parsed, merged, ctx) {
    var cfg = (ctx && ctx.cfg) || Config.get();
    var sc = cfg.scoring;
    var profile = (ctx && ctx.profile) || cfg.profile;
    var override = (ctx && ctx.override) || {};
    // Precedência: correção do usuário > IA > regras.
    var cat = catOf_(override.category || merged.primary_category);
    var secondaryPriors = (merged.secondary_categories || []).map(function (id) {
      return catOf_(id).prior;
    });
    var prior = Math.max(cat.prior, secondaryPriors.length ? 0.85 * Math.max.apply(null, secondaryPriors) : 0);
    var fromEmail = String(parsed.from_email || '').toLowerCase();
    var fromDomain = String(parsed.from_domain || Util.emailDomain(fromEmail)).toLowerCase();
    var known = !!(ctx && ctx.knownContacts && ctx.knownContacts[fromEmail]);
    // Pessoa numa lista de discussão (grupo da família, condomínio) continua sendo pessoa.
    var automated = !!(parsed.is_automated || (parsed.is_bulk && !parsed.is_discussion_list));
    var direct = !!parsed.user_in_to && !parsed.is_bulk;
    // Confiança: autenticação, spam e imitação (merged.untrusted) ou injection limitam o nível a Média.
    var injection = !!(merged.injection && merged.injection.suspected);
    var untrusted = !!parsed.auth_fail || !!merged.is_probable_spam || !!parsed.is_spam || !!merged.untrusted || injection;
    // Gravidade nunca vale para mensagem não confiável (o classificador já zera; aqui é defesa extra).
    var severity = untrusted ? 0 : Util.clamp(Number(merged.severity) || 0, 0, 1);

    // Importância: IA ancorada no prior da categoria (reduz a variância do modelo).
    // Sem IA, sinais gratuitos e confiáveis do Gmail entram como bônus explícitos.
    var labels = parsed.label_ids || [];
    var b = sc.rulesImportanceBonus;
    var dlDeadline = merged.deadline && merged.deadline.date && merged.deadline.certainty === 'EXPLICIT';
    var bonus = 0;
    if (dlDeadline && TRANSACTIONAL.indexOf(cat.id) >= 0) bonus += b.explicitDeadline;
    if (labels.indexOf('IMPORTANT') >= 0 || parsed.is_important) bonus += b.important;
    if (labels.indexOf('STARRED') >= 0 || parsed.is_starred) bonus += b.starred;
    if (parsed.gmail_category === 'PERSONAL' && !automated) bonus += b.personalHuman;
    if (parsed.gmail_category === 'PROMOTIONS') bonus += b.promotions;
    bonus += sc.severityBonus * severity;
    var importance;
    if (merged.method === 'AI' && merged.importance) {
      importance = sc.aiImportanceBlend * ((Number(merged.importance) - 1) / 4) + (1 - sc.aiImportanceBlend) * prior + Math.min(0, bonus) + Math.max(0, bonus) * 0.5;
    } else {
      importance = prior + bonus + (direct && !automated ? b.directHuman : 0) + (known ? b.knownContact : 0);
    }

    // Urgência sem prazo: IA (1..5) ou pistas textuais, sempre atenuada.
    var noDeadline = 0;
    if (merged.method === 'AI' && merged.urgency) noDeadline = (Number(merged.urgency) - 1) / 4;
    else if (URGENT_WORDS.test(Util.normalizeText((parsed.subject || '') + ' ' + (merged.summary || '')))) noDeadline = 0.5;
    noDeadline = Math.min(sc.noDeadlineUrgencyCap, noDeadline * sc.noDeadlineUrgencyFactor);

    var action = 0;
    var actionConditional = false;
    if (merged.action_required) {
      var acts = merged.actions || [];
      var mine = acts.some(function (a) {
        return a.owner === 'me';
      });
      action = 0.6 + 0.4 * (direct || mine ? 1 : 0);
      // Em segurança da conta o classificador só aceita ação sob a condicional "se não foi você" (e a
      // categoria nunca vai à IA): ali toda ação é condicional, mesmo que a frase extraída não pareça.
      actionConditional = cat.id === 'seguranca_conta' || (acts.length > 0 && acts.every(function (a) {
        return RE_CONDITIONAL_ACTION.test(Util.normalizeText(a && a.description));
      }));
    }

    var opportunity = 0;
    var op = merged.opportunity;
    if (op && op.type) {
      var fit = Util.clamp(op.fit || 0, 0, 1);
      opportunity = op.is_mass ? 0.3 + 0.4 * fit : 0.6 + 0.4 * fit;
    }

    var isPriority = (profile.prioritySenders || []).map(lower_).indexOf(fromEmail) >= 0 ||
      (profile.prioritySenderDomains || []).map(lower_).indexOf(fromDomain) >= 0;
    var senderKind = isPriority ? 'priority' : known ? 'knownContact' : automated ? 'automated' : 'human';
    var sender = sc.senderScores[senderKind];
    var affinity = ctx && ctx.senderAffinity ? Number(ctx.senderAffinity[fromEmail] || 0) : 0;
    sender = Util.clamp(sender + sc.feedbackAffinityWeight * affinity, 0, 1);

    var novelty = sc.noveltyScores.normal;
    if (ctx && ctx.duplicateHashes && parsed.content_hash && ctx.duplicateHashes[parsed.content_hash]) novelty = sc.noveltyScores.duplicate;
    else if (parsed.is_bulk && parsed.list_id) novelty = sc.noveltyScores.recurringNewsletter;

    var reliability = 0.8;
    if (parsed.auth_fail) reliability = 0.4;
    else if (parsed.auth_pass) reliability = 1;
    // Imitação de marca/nome ou Reply-To divergente equivalem a autenticação falha.
    if (merged.untrusted) reliability = Math.min(reliability, 0.4);
    if (merged.is_probable_spam) reliability = Math.min(reliability, 0.3);

    var dl = merged.deadline && merged.deadline.date ? { date: merged.deadline.date, certainty: merged.deadline.certainty || 'INFERRED', time: merged.deadline.time || '' } : null;

    // Newsletter e marketing são formatos: ruído e confiança de urgência usam o mínimo entre tema e formato.
    // Categoria transacional (boleto, etapa de processo, check-in) mantém os próprios valores mesmo em
    // envio de lista: o formato não torna a cobrança menos real.
    var noise = cat.noise;
    var trust = cat.urgencyTrust;
    if (merged.is_newsletter && TRANSACTIONAL.indexOf(cat.id) < 0) {
      noise = Math.min(noise, catOf_('newsletters').noise);
      trust = Math.min(trust, catOf_('newsletters').urgencyTrust);
    }
    if (merged.is_marketing) {
      noise = Math.min(noise, catOf_('marketing').noise);
      trust = Math.min(trust, catOf_('marketing').urgencyTrust);
    }
    if (merged.is_probable_spam) noise = Math.min(noise, catOf_('spam').noise);
    var aiRelevance = merged.method === 'AI' && merged.relevance ? (Number(merged.relevance) - 1) / 4 : null;
    return {
      category: cat.id,
      isNoise: NOISE_CATEGORIES.indexOf(cat.id) >= 0 || !!merged.is_probable_spam || !!merged.is_marketing,
      // Formato newsletter (mesma regra do ruído acima): nunca recebe pisos nem vira Crítica.
      isNewsletter: cat.id === 'newsletters' || (!!merged.is_newsletter && TRANSACTIONAL.indexOf(cat.id) < 0),
      untrusted: untrusted,
      injection: injection,
      irrelevant: !!override.irrelevant,
      aiRelevance: aiRelevance,
      confidence: Util.clamp(merged.confidence === undefined ? 0.5 : merged.confidence, 0, 1),
      importance: Util.clamp(importance, 0, 1),
      deadline: dl,
      urgencyNoDeadline: Util.clamp(noDeadline, 0, 1),
      urgencyTrust: trust,
      action: Util.clamp(action, 0, 1),
      actionConditional: actionConditional,
      // Pessoa escrevendo diretamente a você (não automático, não massa, você em "Para") e pedindo algo.
      directRequest: !automated && direct && !!merged.action_required && !untrusted,
      severity: Util.round(severity, 3),
      opportunity: Util.clamp(opportunity, 0, 1),
      sender: sender,
      senderKind: senderKind,
      isPrioritySender: isPriority,
      novelty: novelty,
      interest: Util.clamp(merged.interest_score || 0, 0, 1),
      reliability: reliability,
      noise: noise,
      // Para reescore sem reler a mensagem (correção de categoria pelo usuário).
      prior: Util.round(prior, 4),
      method: merged.method === 'AI' ? 'AI' : 'RULES',
    };
  }

  /**
   * Aplica o feedback do usuário a features já gravadas (reescore sem reler a
   * mensagem): categoria corrigida troca prior, ruído e confiança de urgência;
   * "irrelevante" força Baixa (nível e score); "deveria ser mais alta" soma 0,2 à importância.
   * @param {Object} f Features gravadas
   * @param {{category?: string, irrelevant?: boolean, higher?: boolean}} o
   */
  function applyOverride(f, o, cfg) {
    var sc = (cfg || Config.get()).scoring;
    var out = Object.assign({}, f);
    var ov = o || {};
    if (ov.category && ov.category !== f.category && Config.category(ov.category)) {
      var cat = catOf_(ov.category);
      var share = f.method === 'AI' ? 1 - sc.aiImportanceBlend : 1;
      var oldPrior = f.prior === undefined ? catOf_(f.category).prior : f.prior;
      out.importance = Util.clamp(f.importance + share * (cat.prior - oldPrior), 0, 1);
      out.category = cat.id;
      out.prior = cat.prior;
      out.noise = cat.noise;
      out.urgencyTrust = cat.urgencyTrust;
      out.isNoise = NOISE_CATEGORIES.indexOf(cat.id) >= 0;
      out.isNewsletter = cat.id === 'newsletters' || (!!f.isNewsletter && TRANSACTIONAL.indexOf(cat.id) < 0);
    }
    if (ov.higher) out.importance = Util.clamp(out.importance + 0.2, 0, 1);
    out.irrelevant = !!ov.irrelevant;
    return out;
  }

  function lower_(s) {
    return String(s || '').toLowerCase().trim();
  }

  // ------------------------------------------------------------ cálculo ----
  /** Fator temporal do prazo: 1 no dia, decai e^(−d/τ); vencidos recentes 0,7; antigos 0,1. */
  function deadlineFactor(daysUntil, sc) {
    if (daysUntil < -sc.overdueRecentDays) return 0.1;
    if (daysUntil < 0) return 0.7;
    if (daysUntil === 0) return 1;
    return Math.exp(-daysUntil / sc.urgencyTauDays);
  }

  function describeDeadline_(days, certainty) {
    var c = certainty === 'EXPLICIT' ? 'explícito' : 'inferido';
    if (days < 0) return 'Prazo ' + c + ' vencido há ' + Math.abs(days) + (Math.abs(days) === 1 ? ' dia' : ' dias');
    if (days === 0) return 'Prazo ' + c + ' hoje';
    if (days === 1) return 'Prazo ' + c + ' amanhã';
    return 'Prazo ' + c + ' em ' + days + ' dias';
  }

  /**
   * Calcula score, nível e componentes explicados.
   * @param {Object} f Features
   * @param {Object=} cfg configuração (padrão: Config.get())
   * @param {string=} todayYmd data de referência (padrão: hoje em São Paulo)
   */
  function compute(f, cfg, todayYmd) {
    var c = cfg || Config.get();
    var sc = c.scoring;
    var w = sc.weights;
    var today = todayYmd || Util.todayYmd();

    var th = sc.thresholds;
    var lv = sc.severityLevels;
    var urgency;
    var urgencyWhy;
    var days = null;
    if (f.deadline && Util.isValidYmd(f.deadline.date)) {
      days = Util.daysBetween(today, f.deadline.date);
      var certainty = sc.certaintyFactor[f.deadline.certainty] || sc.certaintyFactor.INFERRED;
      urgency = deadlineFactor(days, sc) * certainty * f.urgencyTrust;
      urgencyWhy = describeDeadline_(days, f.deadline.certainty) + (f.urgencyTrust < 1 ? ' (prazo de baixa confiabilidade para a categoria)' : '');
    } else {
      urgency = f.urgencyNoDeadline * f.urgencyTrust;
      urgencyWhy = urgency > 0 ? 'Sinais de urgência sem prazo definido' : 'Sem prazo identificado';
    }
    urgency = Util.clamp(urgency, 0, 1);
    var severity = Util.clamp(Number(f.severity) || 0, 0, 1);
    var serious = severity >= lv.medium;

    var senderWhy = {
      priority: 'Remetente prioritário',
      knownContact: 'Contato com quem você já trocou e-mails',
      human: 'Pessoa (não automático)',
      automated: 'Envio automático ou em massa',
    }[f.senderKind] || '';

    var importanceWhy = f.importance >= 0.6 ? 'Categoria e conteúdo de alta importância' : f.importance >= 0.35 ? 'Importância moderada' : 'Baixa importância';
    if (serious) importanceWhy += ' · notificação séria (gravidade ' + Util.round(severity, 2) + ')';
    var parts = [
      ['importance', f.importance, importanceWhy],
      ['urgency', urgency, urgencyWhy],
      ['action', f.action, f.action > 0 ? (f.action >= 1 ? 'Pede uma ação sua diretamente' : 'Contém pedido ou ação') : 'Nenhuma ação pedida'],
      ['opportunity', f.opportunity, f.opportunity > 0 ? (f.opportunity >= 0.8 ? 'Oportunidade aderente ao seu perfil' : 'Oportunidade identificada') : 'Sem oportunidade'],
      ['sender', f.sender, senderWhy],
      ['novelty', f.novelty, f.novelty >= 1 ? 'Conteúdo novo' : f.novelty <= 0.3 ? 'Conteúdo repetido recentemente' : 'Envio recorrente'],
      ['interest', f.interest, f.interest > 0 ? 'Casa com seus temas de interesse' : 'Fora dos temas de interesse'],
    ];
    var raw = 0;
    var components = parts.map(function (p) {
      var weight = w[p[0]];
      var contribution = weight * p[1];
      raw += contribution;
      return { key: p[0], label: LABELS[p[0]], value: Util.round(p[1], 3), weight: weight, contribution: Util.round(contribution, 4), why: p[2] };
    });
    var multiplier = (0.6 + 0.4 * f.reliability) * f.noise;
    var score = Util.clamp(raw * multiplier, 0, 1);
    if (f.reliability < 0.8) components.push({ key: 'reliability', label: 'Confiabilidade', value: f.reliability, weight: 0, contribution: 0, why: 'Autenticação do remetente falhou, imitação ou sinais de spam' });
    if (f.noise < 1) components.push({ key: 'noise', label: 'Ruído', value: f.noise, weight: 0, contribution: 0, why: 'Categoria de baixo valor (penalidade ×' + f.noise + ')' });

    // Ruído, newsletter, não confiável e irrelevante nunca recebem piso nem viram Crítica.
    var eligible = !f.isNoise && !f.isNewsletter && !f.untrusted && !f.irrelevant;
    // Pedido direto de pessoa com prazo concreto — data explícita, ou horário ("hoje até 15h") — para hoje/amanhã.
    var concreteDeadline = !!f.deadline && (f.deadline.certainty === 'EXPLICIT' || !!f.deadline.time);
    var shortRequest = eligible && !!f.directRequest && concreteDeadline && days !== null && days >= 0 && days <= sc.directRequestMaxDays;
    var trustedContact = f.senderKind === 'priority' || f.senderKind === 'knownContact';
    var whoWhy = f.senderKind === 'priority' ? 'remetente prioritário' : trustedContact ? 'contato conhecido' : 'pessoa';
    var whenWhy = days === 0 ? 'hoje' : 'até amanhã';

    // Crítica é rara: precisa de score alto E de um gatilho concreto.
    var gate = [];
    if (f.action >= 0.6 && urgency >= 0.5) gate.push('Ação com prazo próximo');
    if (f.opportunity >= 0.8 && f.sender >= 0.8) gate.push('Oportunidade aderente de contato conhecido');
    if (f.isPrioritySender && f.action > 0) gate.push('Pedido de remetente prioritário');
    if (serious && f.action >= 0.6 && f.deadline && f.deadline.certainty === 'EXPLICIT' && days !== null && days >= 0) gate.push('Consequência séria com ação e prazo explícito');
    // Pedido direto com prazo até amanhã de contato conhecido/prioritário sobre uma OBRIGAÇÃO (trabalho,
    // tarefa, conta, governo, saúde, finanças), ou com consequência séria, é o gatilho mais concreto que
    // existe: dispensa o limiar de score, mas não a confiança mínima nem o teto diário. Convite social
    // ("confirma até amanhã se você vem?") fica no piso Alta e só vira Crítica pelo score.
    var obligation = OBLIGATION_CATEGORIES.indexOf(f.category) >= 0;
    var strongRequest = shortRequest && (serious || (trustedContact && obligation));
    if (strongRequest) gate.push('Pedido direto de ' + whoWhy + ' com prazo ' + whenWhy);
    // "CRITICAL" aqui significa elegível: o teto diário é aplicado na leitura (dia de exibição).
    var criticalOk = eligible && f.confidence >= sc.criticalMinConfidence && ((score >= th.critical && gate.length > 0) || strongRequest);

    // Pisos: score sobe até o limiar do nível garantido, para que a ordenação respeite o nível.
    var floor = 0;
    var floorWhy = '';
    if (criticalOk && strongRequest) {
      floor = th.critical;
      floorWhy = 'Pedido direto de ' + whoWhy + ' com prazo ' + whenWhy + (serious ? ' e consequência séria' : ' sobre uma obrigação') + ': elegível a Crítica';
    } else if (shortRequest) {
      floor = th.high;
      floorWhy = 'Pedido direto de ' + whoWhy + ' com prazo ' + whenWhy + ': no mínimo Alta';
    }
    if (eligible && severity >= lv.high && f.action > 0 && !f.actionConditional && th.high > floor) {
      floor = th.high;
      floorWhy = 'Notificação grave (gravidade ' + Util.round(severity, 2) + ') que pede uma ação: no mínimo Alta';
    } else if (eligible && serious && th.medium > floor) {
      floor = th.medium;
      floorWhy = 'Notificação séria (gravidade ' + Util.round(severity, 2) + '): no mínimo Média';
    }
    if (floor > score) {
      components.push({ key: 'floor', label: 'Piso de prioridade', value: floor, weight: 0, contribution: Util.round(floor - score, 4), why: floorWhy });
      score = floor;
    }

    var level = criticalOk ? 'CRITICAL' : score >= th.high ? 'HIGH' : score >= th.medium ? 'MEDIUM' : 'LOW';
    // Tetos: nível E score, para que a mensagem não ordene acima de Altas legítimas.
    if (f.untrusted) {
      criticalOk = false;
      var capHigh = th.high - 0.001;
      if (level === 'CRITICAL' || level === 'HIGH' || score > capHigh) {
        if (level === 'CRITICAL' || level === 'HIGH') level = 'MEDIUM';
        var cut = Math.max(0, score - capHigh);
        score = Math.min(score, capHigh);
        components.push({ key: 'untrusted', label: 'Confiabilidade', value: 0, weight: 0, contribution: -Util.round(cut, 4),
          why: f.injection ? 'Nível limitado a Média: o conteúdo tenta dar instruções a sistemas de IA (possível injection)' : 'Nível limitado a Média: falha de autenticação, imitação do remetente ou sinais de spam' });
      }
    }
    if (f.irrelevant) {
      level = 'LOW';
      criticalOk = false;
      var capMedium = th.medium - 0.001;
      var cut2 = Math.max(0, score - capMedium);
      score = Math.min(score, capMedium);
      components.push({ key: 'feedback', label: 'Seu feedback', value: 0, weight: 0, contribution: -Util.round(cut2, 4), why: 'Marcada por você como irrelevante' });
    }
    var relevance = Util.clamp(0.45 * f.interest + 0.35 * (f.aiRelevance === null || f.aiRelevance === undefined ? f.importance : f.aiRelevance) + 0.2 * f.sender, 0, 1);
    var iw = sc.infoWeights;
    var infoScore = Util.clamp((iw.interest * f.interest + iw.importance * f.importance + iw.novelty * f.novelty) * (f.isNoise ? f.noise : 1), 0, 1);

    return {
      score: Util.round(score, 4),
      level: level,
      components: components,
      gate: { critical: criticalOk, reasons: gate },
      info_score: Util.round(infoScore, 4),
      urgency: Util.round(urgency, 4),
      axes: { relevance: Util.round(relevance, 3), urgency: Util.round(urgency, 3), action: Util.round(f.action, 3) },
    };
  }

  /** Rótulo de um eixo (0..1) para os selos da interface. */
  function axisLabel(v) {
    return v >= 0.6 ? 'ALTA' : v >= 0.3 ? 'MEDIA' : 'BAIXA';
  }

  /** Três motivos de maior contribuição, para exibição compacta. */
  function topReasons(result, n) {
    return result.components.filter(function (c) {
      return c.contribution > 0;
    }).sort(function (a, b) {
      return b.contribution - a.contribution;
    }).slice(0, n || 3).map(function (c) {
      return { label: c.label, why: c.why };
    });
  }

  // --------------------------------------------------------- triagem ----
  /**
   * Estimativa conservadora (não medição): e-mails de prioridade baixa/ruído que
   * continuam não lidos foram "triados sem abrir"; cada triagem manual custaria
   * entre triageSecondsMin e triageSecondsMax. Devolve uma faixa em minutos.
   */
  function triageEstimate(untouchedCount, cfg) {
    var ui = (cfg || Config.get()).ui;
    var n = Math.max(0, Number(untouchedCount || 0));
    return { count: n, minMinutes: Math.round((n * ui.triageSecondsMin) / 60), maxMinutes: Math.round((n * ui.triageSecondsMax) / 60), formula: 'não lidos de prioridade baixa ou ruído × ' + ui.triageSecondsMin + '–' + ui.triageSecondsMax + ' s por triagem' };
  }

  return {
    LABELS: LABELS,
    features: features,
    applyOverride: applyOverride,
    deadlineFactor: deadlineFactor,
    compute: compute,
    topReasons: topReasons,
    axisLabel: axisLabel,
    triageEstimate: triageEstimate,
    TRANSACTIONAL: TRANSACTIONAL,
  };
})();
