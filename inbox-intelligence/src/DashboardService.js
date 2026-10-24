/**
 * Monta os payloads da interface (contratos em docs/CONTRATOS.md, "Payloads v2").
 * Toda entrada do cliente é validada aqui (listas brancas); toda saída é
 * objeto simples (sem Date). Conteúdo de e-mail segue como texto: a interface
 * renderiza com textContent.
 */
var DashboardService = (function () {
  var LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  var PERIOD_DAYS = { today: 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
  var PERIOD_LABELS = { today: 'Hoje', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias' };
  var SORTS = ['priority', 'date', 'deadline', 'relevance', 'urgency'];
  var TASK_STATUS_LABELS = {
    OPEN: 'Aberta',
    RESOLVED: 'Resolvida por você',
    DISMISSED: 'Descartada por você',
    AUTO_REPLIED: 'Concluída: você respondeu na conversa',
    AUTO_ARCHIVED: 'Concluída: a mensagem foi arquivada no Gmail',
    AUTO_EXPIRED: 'Encerrada: o prazo passou há mais de 3 dias',
    AUTO_STALE: 'Encerrada: sem prazo e sem movimento há mais de 14 dias',
  };
  var USER_KEYS = { lastVisit: 'LAST_VISIT_AT' };

  // ----------------------------------------------------------- utilidades ----
  function label_(id) {
    var c = Config.category(id);
    return c ? c.label : 'Outros';
  }
  function json_(s, fallback) {
    var v = Util.safeJsonParse(s, fallback);
    return v === null || v === undefined ? fallback : v;
  }
  function num_(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  function httpUrl_(u) {
    return Util.isHttpUrl(u) ? String(u) : '';
  }
  function enumOr_(v, list, fallback) {
    return list.indexOf(v) >= 0 ? v : fallback;
  }
  function triState_(v) {
    return v === 'yes' || v === 'no' ? v : '';
  }
  function period_(p) {
    var key = PERIOD_DAYS[p] ? p : '7d';
    var days = PERIOD_DAYS[key];
    var today = Util.todayYmd();
    var start = Util.addDays(today, -(days - 1));
    var prevEnd = Util.addDays(start, -1);
    return { key: key, days: days, start: start, end: today, prevStart: Util.addDays(prevEnd, -(days - 1)), prevEnd: prevEnd, label: PERIOD_LABELS[key] || key };
  }
  function accountIndex_() {
    return Config.get().gmail.accountIndex;
  }

  // ------------------------------------------------------------ formatos ----
  function toItem(r) {
    var comps = json_(r.components_json, []);
    var top = comps.filter(function (c) {
      return c.contribution > 0;
    }).sort(function (a, b) {
      return b.contribution - a.contribution;
    }).slice(0, 3).map(function (c) {
      return { label: c.label, why: c.why };
    });
    var cat = r.primary_category || 'outros';
    return {
      id: r.message_id,
      threadId: r.thread_id || '',
      subject: r.subject || '(sem assunto)',
      from: { name: r.from_name || '', email: r.from_email || '', domain: r.from_domain || '' },
      date: r.internal_ts || '',
      receivedDate: r.received_date || '',
      category: cat,
      categoryLabel: label_(cat),
      secondary: (r.secondary_categories || []).filter(function (id) {
        return id !== cat;
      }).map(function (id) {
        return { id: id, label: label_(id) };
      }),
      summary: r.summary || '',
      summaryKind: r.summary_kind || '',
      priority: {
        score: Util.round(num_(r.score), 3),
        level: enumOr_(r.display_level || r.level, LEVELS, 'LOW'),
        top: top,
        axes: { relevance: Util.round(num_(r.relevance_axis), 3), urgency: Util.round(num_(r.urgency_axis), 3), action: Util.round(num_(r.action_axis), 3) },
        overflow: !!r.critical_overflow,
      },
      action: !!r.action_required,
      deadline: r.deadline_date ? { date: r.deadline_date, certainty: r.deadline_certainty === 'EXPLICIT' ? 'EXPLICIT' : 'INFERRED' } : null,
      unread: !!r.is_unread,
      starred: !!r.is_starred,
      confidence: Util.round(num_(r.confidence), 2),
      gmailUrl: GmailClient.webUrl(r.message_id, accountIndex_()),
      gmailSearchUrl: GmailClient.searchUrl(r.rfc822_message_id, accountIndex_()),
      userStatus: r.user_status || '',
      userRelevance: r.user_relevance || '',
      method: r.method === 'AI' ? 'AI' : 'RULES',
      injection: !!r.injection_suspected,
      authFail: !!r.auth_fail,
    };
  }

  function toTask(r) {
    var status = TASK_STATUS_LABELS[r.status] ? r.status : 'OPEN';
    return {
      id: r.action_id,
      messageId: r.message_id,
      threadId: r.thread_id || '',
      description: r.description || '',
      owner: enumOr_(r.owner, ['me', 'other', 'unknown'], 'unknown'),
      dueDate: r.due_date || '',
      dueCertainty: r.due_certainty || 'NONE',
      priorityLevel: enumOr_(r.priority_level, LEVELS, 'LOW'),
      status: status,
      statusLabel: TASK_STATUS_LABELS[status],
      subject: r.subject || '',
      from: { name: r.from_name || '', email: r.from_email || '' },
      receivedDate: r.received_date || '',
      method: r.method === 'AI' ? 'AI' : 'RULES',
      gmailUrl: GmailClient.webUrl(r.message_id, accountIndex_()),
    };
  }

  function toOpp(key, o, extra) {
    var x = extra || {};
    var ids = x.messageIds || [];
    return {
      key: key,
      type: o.type || 'job',
      title: o.title || '',
      company: o.company || '',
      role: o.role || '',
      seniority: o.seniority || '',
      location: o.location || '',
      workMode: o.work_mode || 'unknown',
      compensation: o.compensation || '',
      stage: o.stage || '',
      nextStep: o.next_step || '',
      deadline: o.deadline || '',
      fit: Util.round(num_(o.fit), 2),
      fitReasons: o.fit_reasons || [],
      isMass: !!o.is_mass,
      firstSeen: x.firstSeen || '',
      lastSeen: x.lastSeen || '',
      mentions: num_(x.mentions || 1),
      messageIds: ids,
      sources: x.sources || [],
      status: x.status || '',
      gmailUrl: ids.length ? GmailClient.webUrl(ids[0], accountIndex_()) : '',
    };
  }

  function oppFromRow_(r) {
    return toOpp(r.opp_key, json_(r.latest_json, {}), {
      firstSeen: r.first_seen, lastSeen: r.last_seen, mentions: r.mentions, messageIds: r.message_ids || [], sources: r.sources || [], status: r.user_status || '',
    });
  }

  function aiInfo() {
    var s = AiClient.status();
    var u = AiClient.usage();
    var cfg = Config.get().ai;
    return {
      provider: s.provider,
      model: s.model,
      policy: s.policy,
      requestedPolicy: s.requestedPolicy,
      allowedPolicies: s.allowedPolicies,
      consent: s.consent ? { given: true, policy: s.consent.policy, provider: s.consent.provider, at: s.consent.at } : null,
      circuitOpenUntil: s.circuitOpenUntil || '',
      configError: s.configError ? 'Falha de configuração do provedor (' + s.configError + ')' : '',
      budget: {
        today: { cost: Util.round(u.today.cost, 4), req: u.today.req },
        month: { cost: Util.round(u.month.cost, 4), req: u.month.req },
        limits: { costDay: cfg.maxCostUsdPerDay, costMonth: cfg.maxCostUsdPerMonth },
      },
    };
  }

  function syncInfo() {
    var st = Pipeline.syncState();
    var last = Monitoring.lastRun();
    return {
      lastSuccessAt: PropertiesService.getScriptProperties().getProperty('LAST_SYNC_OK_AT') || '',
      lastStatus: last ? last.status : '',
      backfill: st.backfill,
      windows: st.windows.length,
      quarantined: st.quarantined,
    };
  }

  // ------------------------------------------------------------- telas ----
  function bootstrap() {
    var missing = Triggers.missingSetup();
    var last = Monitoring.lastRun();
    var visit = PropertiesService.getUserProperties().getProperty(USER_KEYS.lastVisit) || '';
    var ui = Config.get().ui;
    return {
      user: { email: String(Session.getActiveUser().getEmail() || '') },
      app: { version: Config.APP_VERSION },
      ai: aiInfo(),
      setup: { ok: missing.length === 0, missing: missing },
      lastSync: last ? { at: last.finished_at, status: last.status } : null,
      categories: Config.taxonomy().map(function (c) {
        return { id: c.id, label: c.label };
      }),
      ui: { pageSize: ui.pageSize, defaultPeriod: ui.defaultPeriod },
      previousVisitAt: visit,
    };
  }

  function markVisit() {
    var p = PropertiesService.getUserProperties();
    var prev = p.getProperty(USER_KEYS.lastVisit) || '';
    p.setProperty(USER_KEYS.lastVisit, Util.nowIso());
    return { previousVisitAt: prev };
  }

  function radar(req) {
    var per = period_(req && req.period);
    if (per.key !== 'today' && per.key !== '7d' && per.key !== '30d') per = period_('7d');
    var visit = PropertiesService.getUserProperties().getProperty(USER_KEYS.lastVisit) || Util.toIso(Util.now() - 24 * 3600000);
    var sinceTs = visit.slice(0, 16) + ':00Z';
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(sinceTs)) sinceTs = Util.toIso(Util.now() - 24 * 3600000);
    var params = {
      start: Repository.date(per.start), end: Repository.date(per.end), prev_start: Repository.date(per.prevStart),
      min_urgency: Config.get().scoring.attentionMinUrgency, since_ts: { type: 'TIMESTAMP', value: sinceTs }, period: per.key,
    };
    var res = Repository.cached('radar', params, 300, function () {
      return Repository.query('radar', params, { maxRows: 1 }).rows;
    });
    var row = res.rows[0] || {};
    var k = row.kpis || {};
    var kp = row.kpis_prev || {};
    var attention = (row.attention || []).map(toItem);
    var tasks = (row.tasks || []).map(toTask);
    var opps = (row.opportunities || []).map(oppFromRow_);
    var news = (row.news || []).map(toItem);
    var prevCats = {};
    (row.by_category_prev || []).forEach(function (c) {
      prevCats[c.category] = num_(c.n);
    });
    var categories = (row.by_category || []).map(function (c) {
      return { id: c.category, label: label_(c.category), count: num_(c.n), countPrev: prevCats[c.category] || 0 };
    });
    var received = num_(k.received);
    var briefing = null;
    if (row.briefing && row.briefing.content_json && per.key === 'today') {
      var content = json_(row.briefing.content_json, null);
      if (content && content.headline) briefing = { headline: content.headline, bullets: content.bullets || [], method: 'AI', generatedAt: row.briefing.version_ts };
    }
    if (!briefing) briefing = rulesBriefing_(per, received, attention, tasks, opps, news);
    return {
      _cached: res.cached,
      period: { start: per.start, end: per.end, label: per.label, key: per.key },
      briefing: briefing,
      kpis: {
        received: received,
        receivedPrev: num_(kp.received),
        attention: num_(k.attention),
        attentionPrev: num_(kp.attention),
        actions: num_(k.actions),
        actionsPrev: num_(kp.actions),
        opportunities: num_(k.opportunities),
        newsletters: num_(k.newsletters),
        noisePct: received ? Math.round((100 * num_(k.noise)) / received) : 0,
        rulesOnly: num_(k.rules_only),
        triage: Scoring.triageEstimate(num_(k.triaged_unread)),
      },
      attention: attention,
      tasks: tasks,
      opportunities: opps,
      news: news,
      topics: (row.topics || []).map(function (t) {
        return { topic: t.topic, count: num_(t.n) };
      }),
      categories: categories,
      sinceLastVisit: { count: num_(row.since_last_visit), since: sinceTs },
      sync: syncInfo(),
    };
  }

  /** Briefing determinístico (sem IA): frases montadas a partir dos próprios itens. */
  function rulesBriefing_(per, received, attention, tasks, opps, news) {
    var bullets = [];
    attention.slice(0, 3).forEach(function (it) {
      var why = it.priority.top[0] ? ' — ' + it.priority.top[0].why : '';
      bullets.push({ text: it.categoryLabel + ': ' + Util.truncate(it.subject, 90) + why, refs: [it.id] });
    });
    var soon = tasks.filter(function (t) {
      return t.dueDate && Util.daysBetween(Util.todayYmd(), t.dueDate) <= 3;
    });
    soon.slice(0, 2).forEach(function (t) {
      bullets.push({ text: 'Prazo ' + Util.formatBrDate(t.dueDate) + ': ' + Util.truncate(t.description, 100), refs: [t.messageId] });
    });
    if (opps[0] && (opps[0].role || opps[0].title)) {
      var o = opps[0];
      bullets.push({ text: 'Oportunidade: ' + (o.role || o.title) + (o.company ? ' — ' + o.company : '') + ' (aderência ' + Math.round(o.fit * 100) + '%)', refs: o.messageIds.slice(0, 1) });
    }
    if (news[0]) bullets.push({ text: 'Leitura: ' + Util.truncate(news[0].subject, 100), refs: [news[0].id] });
    var parts = [];
    var when = per.key === 'today' ? 'Hoje' : per.label;
    if (!received) return { headline: when + ': nenhuma mensagem recebida no período.', bullets: [], method: 'RULES', generatedAt: Util.nowIso() };
    parts.push(received + (received === 1 ? ' mensagem' : ' mensagens'));
    parts.push(attention.length ? attention.length + ' pedindo atenção' : 'nada urgente');
    if (soon.length) parts.push(soon.length + (soon.length === 1 ? ' prazo' : ' prazos') + ' em até 3 dias');
    return { headline: when + ': ' + parts.join(', ') + '.', bullets: bullets.slice(0, 6), method: 'RULES', generatedAt: Util.nowIso() };
  }

  function listMessages(req) {
    var r = req || {};
    var f = r.filters || {};
    var cats = Config.categoryIds();
    var page = Math.max(1, Math.min(20, Math.floor(num_(r.page) || 1)));
    var pageSize = Math.max(10, Math.min(100, Math.floor(num_(r.pageSize) || Config.get().ui.pageSize)));
    var per = period_(f.period && PERIOD_DAYS[f.period] && f.period !== 'today' ? f.period : '30d');
    var params = {
      since: Repository.date(per.start),
      categories: (Array.isArray(f.categories) ? f.categories : []).filter(function (c) { return cats.indexOf(c) >= 0; }).slice(0, 19),
      levels: (Array.isArray(f.levels) ? f.levels : []).filter(function (l) { return LEVELS.indexOf(l) >= 0; }),
      action: triState_(f.action), deadline: triState_(f.deadline), unread: triState_(f.unread),
      sender: Util.normalizeText(String(f.sender || '')).slice(0, 80),
      status: enumOr_(f.status, ['', 'OPEN', 'RESOLVED', 'SAVED', 'DISMISSED'], ''),
      terms: [],
      sort: enumOr_(r.sort, SORTS, 'priority'),
      limit: page * pageSize + 1,
    };
    var res = Repository.cached('inbox_list', params, 300, function () {
      return Repository.query('inbox_list', params, { maxRows: params.limit }).rows;
    });
    var offset = (page - 1) * pageSize;
    return { _cached: res.cached, items: res.rows.slice(offset, offset + pageSize).map(toItem), page: page, pageSize: pageSize, hasMore: res.rows.length > offset + pageSize };
  }

  function getMessage(req) {
    var id = String((req && req.id) || '');
    if (!/^[0-9a-f]{6,40}$/i.test(id)) throw Util.appError('VALIDATION', 'Identificador de mensagem inválido.');
    var rows = Repository.query('message_detail', { id: id }, { maxRows: 1 }).rows;
    if (!rows.length) throw Util.appError('NOT_FOUND', 'Mensagem não encontrada (pode ter sido excluída ou ainda não sincronizada).');
    var r = rows[0];
    var item = toItem(r);
    var statuses = {};
    Repository.query('actions_for_message', { id: id }, { maxRows: 20 }).rows.forEach(function (a) {
      statuses[a.action_id] = a.status;
    });
    var actions = json_(r.actions_json, []).map(function (a) {
      return toTask({
        action_id: a.id, message_id: id, thread_id: r.thread_id, description: a.description, owner: a.owner, due_date: a.due_date,
        due_certainty: a.due_certainty, priority_level: item.priority.level, status: statuses[a.id] || 'OPEN', subject: r.subject,
        from_name: r.from_name, from_email: r.from_email, received_date: r.received_date, method: r.method,
      });
    });
    var opp = json_(r.opportunity_json, null);
    var ev = json_(r.evidence_json, {});
    var links = r.retention_expired ? [] : json_(r.links_json, []).filter(function (l) {
      return l && Util.isHttpUrl(l.url);
    }).slice(0, 15).map(function (l) {
      return { url: String(l.url), text: String(l.text || '') };
    });
    return Object.assign(item, {
      to: r.to_emails || [],
      cc: r.cc_emails || [],
      excerpt: r.retention_expired ? null : r.body_excerpt || null,
      excerptHidden: !!r.retention_expired,
      facts: json_(r.key_facts_json, []).map(function (x) {
        return { fact: x.fact || '' };
      }),
      whatsNew: r.whats_new || '',
      entities: json_(r.entities_json, []),
      topics: r.topics || [],
      evidence: { facts: ev.facts || [], actions: ev.actions || [], classification: ev.classification || [], opportunity: ev.opportunity || '' },
      reason: r.reason || '',
      components: json_(r.components_json, []),
      actions: actions,
      opportunity: opp ? toOpp(r.opportunity_key || 'msg:' + id, opp, { messageIds: [id], firstSeen: r.received_date, lastSeen: r.received_date }) : null,
      links: links,
      attachments: json_(r.attachments_json, []).slice(0, 20),
      fidelity: { total: num_(r.evidence_total), verified: num_(r.evidence_verified) },
      unsubscribeUrl: httpUrl_(r.unsubscribe_url),
      history: (r.history || []).map(function (h) {
        return { method: h.method, provider: h.provider, model: h.model, at: h.version_ts };
      }),
      parseStatus: r.parse_status || 'OK',
      sensitive: !!r.sensitive,
    });
  }

  function listTasks(req) {
    var status = enumOr_(req && req.status, ['OPEN', 'DONE', 'ALL'], 'OPEN');
    var res = Repository.cached('tasks', { status: status }, 300, function () {
      return Repository.query('tasks', { status: status }, { maxRows: 300 }).rows;
    });
    return { _cached: res.cached, items: res.rows.map(toTask) };
  }

  function listOpportunities(req) {
    var status = enumOr_(req && req.status, ['OPEN', 'SAVED', 'DISMISSED', 'ALL'], 'OPEN');
    var res = Repository.cached('opportunities', { status: status }, 300, function () {
      return Repository.query('opportunities', { status: status }, { maxRows: 200 }).rows;
    });
    return { _cached: res.cached, items: res.rows.map(oppFromRow_) };
  }

  function news(req) {
    var per = period_(req && req.period === '30d' ? '30d' : '7d');
    var params = { since: Repository.date(per.start) };
    var res = Repository.cached('news', params, 600, function () {
      return Repository.query('news', params, { maxRows: 60 }).rows;
    });
    var topics = {};
    res.rows.forEach(function (r) {
      (r.topics || []).forEach(function (t) {
        topics[t] = (topics[t] || 0) + 1;
      });
    });
    return {
      _cached: res.cached,
      items: res.rows.map(toItem),
      topics: Object.keys(topics).map(function (t) {
        return { topic: t, count: topics[t] };
      }).sort(function (a, b) {
        return b.count - a.count;
      }).slice(0, 12),
    };
  }

  /** Sugestões de remetente: só recomendações; nada é feito automaticamente. */
  function senderSuggestion_(s, profile) {
    var priority = (profile.prioritySenders || []).map(function (x) { return String(x).toLowerCase(); }).indexOf(s.email) >= 0;
    if (s.any_spam) return { s: '', why: 'Há mensagens com sinais de spam deste remetente.' };
    if (s.has_unsub && s.n >= 4 && s.unread_share >= 0.7 && s.high_share === 0 && s.mass_share >= 0.6) {
      return { s: 'UNSUBSCRIBE', why: Math.round(s.unread_share * 100) + '% ficaram sem abrir e nenhuma foi prioritária no período.' };
    }
    if (s.n >= 6 && s.mass_share >= 0.5 && s.high_share < 0.1) {
      return { s: 'FILTER', why: s.n + ' mensagens, quase todas de baixa prioridade: um filtro do Gmail pode arquivá-las direto.' };
    }
    if (!priority && s.avg_score >= 0.5 && s.high_share >= 0.4 && s.mass_share < 0.3) {
      return { s: 'PRIORITY', why: Math.round(s.high_share * 100) + '% das mensagens foram de prioridade alta.' };
    }
    return { s: '', why: '' };
  }

  function senders(req) {
    var per = period_(req && req.period === '90d' ? '90d' : '30d');
    var params = { start: Repository.date(per.start), prev_start: Repository.date(per.prevStart) };
    var res = Repository.cached('senders', params, 900, function () {
      return Repository.query('senders', params, { maxRows: 100 }).rows;
    });
    var profile = Config.get().profile;
    return {
      _cached: res.cached,
      items: res.rows.map(function (r) {
        var s = {
          email: r.email, n: num_(r.n), avg_score: num_(r.avg_score), high_share: num_(r.high_share), unread_share: num_(r.unread_share),
          mass_share: num_(r.mass_share), has_unsub: !!r.has_unsub, any_spam: !!r.any_spam,
        };
        var cats = {};
        (r.cats || []).forEach(function (c) {
          cats[c] = (cats[c] || 0) + 1;
        });
        var sug = senderSuggestion_(s, profile);
        return {
          email: r.email || '', name: r.name || '', domain: r.domain || '', count: s.n, countPrev: num_(r.n_prev),
          categories: Object.keys(cats).map(function (c) {
            return { id: c, label: label_(c), n: cats[c] };
          }).sort(function (a, b) {
            return b.n - a.n;
          }).slice(0, 4),
          avgScore: Util.round(s.avg_score, 3), highShare: Util.round(s.high_share, 3), unreadShare: Util.round(s.unread_share, 3),
          massShare: Util.round(s.mass_share, 3),
          noiseScore: Util.round(s.mass_share * (1 - s.high_share) * (0.5 + 0.5 * s.unread_share), 3),
          suggestion: sug.s, suggestionWhy: sug.why, unsubscribeUrl: httpUrl_(r.unsubscribe_url), allAuthPass: !!r.all_auth_pass,
        };
      }),
    };
  }

  function systemStatus() {
    var cfg = Config.get();
    var out = {
      runs: [], health: {}, pending: {}, quality: [], agreement: { n: 0, agree: 0, rate: null },
      quotas: {
        triggerMinutes24h: Monitoring.triggerMinutesLast24h(), triggerBudgetMin: cfg.pipeline.dailyTriggerBudgetMin,
        bqBytesWrittenLifetime: BigQueryClient.lifetimeBytes(), bqLifetimeLimit: cfg.storage.lifetimeLimitBytes,
        bqQueryBytesMonth: BigQueryClient.monthlyQueryBytes(), aiUsage: aiInfo().budget,
      },
      ai: aiInfo(), triggers: Triggers.list(), tables: [], sync: syncInfo(), errors: [],
    };
    if (!Triggers.isSetupDone()) {
      out.errors.push('Setup ainda não executado.');
      return out;
    }
    try {
      var row = Repository.query('system_status', {}, { maxRows: 1 }).rows[0] || {};
      out.runs = (row.runs || []).map(function (r) {
        return {
          runId: r.run_id, kind: r.kind, trigger: r.trigger_source, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status,
          durationMs: num_(r.duration_ms), counts: json_(r.counts_json, {}), errors: json_(r.errors_json, []).map(function (e) {
            return { code: e.code, module: e.module };
          }), aiCostUsd: num_(r.ai_cost_usd), aiRequests: num_(r.ai_requests), gmailUnits: num_(r.gmail_units),
        };
      });
      var h = row.health || {};
      out.health = {
        lastSuccessAt: h.last_success || '', lagMinutes: h.last_success ? Math.round((Util.now() - Date.parse(h.last_success)) / 60000) : null,
        fails24h: num_(h.fails_24h), runs24h: num_(h.runs_24h), avgMs: Math.round(num_(h.avg_ms)), aiCost30d: Util.round(num_(h.ai_cost_30d), 4),
        aiRequests30d: num_(h.ai_requests_30d),
      };
      var p = row.pending || {};
      out.pending = {
        total: num_(p.total), aiDone: num_(p.ai_done), aiPending: num_(p.ai_pending), aiFailed: num_(p.ai_failed), quarantined: num_(p.quarantined),
        criticalToday: num_(p.critical_today), highShare7d: Util.round(num_(p.high_share_7d), 3), oldest: p.oldest || '', newest: p.newest || '',
      };
      out.quality = (row.quality || []).map(function (q) {
        return { category: q.category, label: label_(q.category), n: num_(q.n), irrelevant: num_(q.irrelevant), corrected: num_(q.corrected), shouldBeHigher: num_(q.should_be_higher) };
      });
      var a = row.agreement || {};
      out.agreement = { n: num_(a.n), agree: num_(a.agree), rate: num_(a.n) ? Util.round(num_(a.agree) / num_(a.n), 3) : null };
    } catch (e) {
      out.errors.push('Consulta de status falhou (' + Monitoring.classify(e, 'status').code + ').');
    }
    try {
      var cached = Util.cacheGetJson('tables_status');
      out.tables = cached || Triggers.tablesStatus();
      if (!cached) Util.cachePutJson('tables_status', out.tables, 600);
    } catch (e2) {
      out.errors.push('Leitura das tabelas falhou (' + Monitoring.classify(e2, 'tables').code + ').');
    }
    return out;
  }

  function qualitySample() {
    var rows = Repository.query('blind_sample', { seed: Util.todayYmd() }, { maxRows: 10 }).rows;
    return { items: rows.map(toItem) };
  }

  // ------------------------------------------------------- configurações ----
  function getSettings() {
    var cfg = Config.get();
    var suggestions = [];
    try {
      if (Triggers.isSetupDone()) suggestions = Repository.prioritySuggestions().filter(function (s) {
        return (cfg.profile.prioritySenders || []).map(function (x) { return String(x).toLowerCase(); }).indexOf(s.email) < 0;
      }).slice(0, 10).map(function (s) {
        return { email: s.email, n: num_(s.n) };
      });
    } catch (e) {
      suggestions = [];
    }
    return {
      config: {
        profile: cfg.profile,
        ai: {
          provider: cfg.ai.provider, sendPolicy: cfg.ai.sendPolicy, maxCostUsdPerDay: cfg.ai.maxCostUsdPerDay, maxCostUsdPerMonth: cfg.ai.maxCostUsdPerMonth,
          maxRequestsPerRun: cfg.ai.maxRequestsPerRun, backfillDays: cfg.ai.backfillDays,
        },
        scoring: { criticalDailyCap: cfg.scoring.criticalDailyCap },
        storage: { excerptRetentionDays: cfg.storage.excerptRetentionDays },
        gmail: { accountIndex: cfg.gmail.accountIndex, backfillDays: cfg.gmail.backfillDays },
        ui: { pageSize: cfg.ui.pageSize, defaultPeriod: cfg.ui.defaultPeriod },
      },
      secrets: { projectId: !!Config.secret('projectId'), anthropicKey: !!Config.secret('anthropicKey'), geminiKey: !!Config.secret('geminiKey') },
      categories: Config.taxonomy().map(function (c) {
        return { id: c.id, label: c.label };
      }),
      prioritySuggestions: suggestions,
    };
  }

  var EDITABLE = {
    profile: ['interests', 'targetRoles', 'seniorityKeywords', 'preferredWorkModes', 'prioritySenders', 'prioritySenderDomains', 'mutedSenders'],
    ai: ['provider', 'sendPolicy', 'maxCostUsdPerDay', 'maxCostUsdPerMonth', 'maxRequestsPerRun', 'backfillDays'],
    scoring: ['criticalDailyCap'],
    storage: ['excerptRetentionDays'],
    gmail: ['accountIndex', 'backfillDays'],
    ui: ['pageSize', 'defaultPeriod'],
  };

  function saveSettings(req) {
    var patch = (req && req.patch) || {};
    if (!Util.isPlainObject(patch)) throw Util.appError('VALIDATION', 'Configuração inválida.');
    var clean = {};
    var errors = [];
    Object.keys(patch).forEach(function (section) {
      if (!EDITABLE[section] || !Util.isPlainObject(patch[section])) {
        errors.push('Seção não editável: ' + section + '.');
        return;
      }
      Object.keys(patch[section]).forEach(function (k) {
        if (EDITABLE[section].indexOf(k) < 0) {
          errors.push('Campo não editável: ' + section + '.' + k + '.');
          return;
        }
        var v = patch[section][k];
        if (Array.isArray(v)) v = Util.uniq(v.map(function (x) { return String(x).trim(); }).filter(Boolean));
        clean[section] = clean[section] || {};
        clean[section][k] = v;
      });
    });
    if (errors.length) return { saved: false, errors: errors };
    var before = Config.get();
    var res = Config.savePatch(clean);
    if (!res.ok) return { saved: false, errors: res.errors };
    var after = Config.get();
    // Retenção e teto de críticas estão nas views: recriadas na próxima execução (sob lock).
    if (before.storage.excerptRetentionDays !== after.storage.excerptRetentionDays || before.scoring.criticalDailyCap !== after.scoring.criticalDailyCap) {
      PropertiesService.getScriptProperties().setProperty('VIEWS_DIRTY', '1');
      Triggers.scheduleOneShot();
    }
    if (after.gmail.backfillDays > before.gmail.backfillDays) Pipeline.restartBackfill(after.gmail.backfillDays);
    Repository.bumpDataVersion();
    return { saved: true, errors: [] };
  }

  function setAiConsent(req) {
    var r = req || {};
    if (r.accept === true) {
      var pol = String(r.policy || '');
      if (pol === 'OFF') {
        AiClient.revokeConsent();
      } else {
        var c = AiClient.recordConsent(pol);
        if (!c.ok) throw Util.appError('VALIDATION', c.error);
        var saved = Config.savePatch({ ai: { sendPolicy: pol } });
        if (!saved.ok) throw Util.appError('VALIDATION', saved.errors.join(' '));
      }
    } else {
      AiClient.revokeConsent();
    }
    return aiInfo();
  }

  function aiDryRun(req) {
    var allowed = AiClient.status().allowedPolicies || ['OFF'];
    var pol = enumOr_(req && req.policy, allowed, AiClient.requestedPolicy());
    if (!Triggers.isSetupDone()) return { policy: pol, provider: AiClient.provider(), total: 0, allowed: 0, blocked: {}, byCategory: {}, sample: null };
    var rows = Repository.query('dry_run_rows', {}, { maxRows: 500 }).rows.map(function (r) {
      return {
        msg: r,
        rules: { primary_category: r.primary_category, sensitive: r.sensitive, ai_eligible: r.ai_eligible, is_probable_spam: r.is_probable_spam, injection: { suspected: !!r.injection_suspected } },
        text: r.body_excerpt || '',
      };
    });
    return AiClient.dryRun(rows, pol);
  }

  return {
    toItem: toItem,
    toTask: toTask,
    toOpp: toOpp,
    aiInfo: aiInfo,
    syncInfo: syncInfo,
    bootstrap: bootstrap,
    markVisit: markVisit,
    radar: radar,
    listMessages: listMessages,
    getMessage: getMessage,
    listTasks: listTasks,
    listOpportunities: listOpportunities,
    news: news,
    senders: senders,
    systemStatus: systemStatus,
    qualitySample: qualitySample,
    getSettings: getSettings,
    saveSettings: saveSettings,
    setAiConsent: setAiConsent,
    aiDryRun: aiDryRun,
  };
})();
