/**
 * Classificador determinístico (sempre ativo, sem custo). Produz categorias
 * multi-rótulo, sinais, ações, prazos, oportunidades e um resumo extrativo.
 * É o fallback completo quando a IA está desativada, fora do ar ou sem quota.
 *
 * Princípios (docs/PLANO_TECNICO.md):
 *  - newsletter e marketing são FORMATO, não tema; envio em massa só reforça
 *    "newsletters" quando o conteúdo é editorial;
 *  - termos do perfil (interesses e cargos-alvo) medem INTERESSE, não categoria;
 *  - mensagem não confiável (autenticação falha, spam, marca ou nome imitado,
 *    Reply-To divergente em pedido de pagamento/dados) não gera ação, prazo nem
 *    oportunidade;
 *  - `severity` mede a gravidade de notificações sérias (segurança, saúde,
 *    governo/jurídico, retirada com prazo, tarefa atribuída) e nunca vem de
 *    mensagem não confiável, de massa editorial ou de marketing.
 */
var RulesClassifier = (function () {
  var W = { strongSubject: 6, strongBody: 3, weakSubject: 2, weakBody: 1, bodyCap: 12, domain: 4, pattern: 5, gmail: 2, negative: 3 };
  var MIN_SCORE = 3;
  var TOPICAL = ['noticias', 'economia', 'tecnologia', 'negocios', 'carreira', 'financas'];
  var EDITORIAL = ['noticias', 'economia', 'tecnologia', 'negocios'];
  // Rodapés de lista ("você está recebendo este e-mail porque…") aparecem em qualquer envio automático
  // (boleto, alerta, notificação): são formato, não indício de conteúdo editorial.
  var LIST_FOOTERS = ['voce esta recebendo este', 'you are receiving this', 'you received this email because'];
  // Categorias em que pedidos/prazos de remetentes automáticos são tarefas legítimas
  // (boleto, check-in, etapa de processo seletivo…). Envio em massa nelas não é "newsletter".
  var TRANSACTIONAL = ['contas', 'agenda', 'compras', 'tarefas', 'trabalho', 'saude', 'governo_juridico', 'carreira'];
  // Alerta de vagas em massa só é oportunidade com aderência mínima ao perfil.
  var MASS_MIN_FIT = 0.3;
  var STOP = ['vaga', 'vagas', 'oportunidade', 'para', 'de', 'da', 'do', 'em', 'na', 'no', 'a', 'o', 'e', 'job', 'opportunity', 'position', 'role', 'the', 'at', 'for', 'ltda', 'sa', 's/a', 'inc', 'brasil'];
  // Provedores de e-mail gratuito: quem escreve deles é pessoa (ou golpista), nunca "marca" ou empresa.
  var FREEMAIL = toSet_('gmail.com googlemail.com hotmail.com hotmail.com.br outlook.com outlook.com.br live.com live.com.br msn.com ' +
    'yahoo.com yahoo.com.br ymail.com icloud.com me.com mac.com aol.com uol.com.br bol.com.br terra.com.br ig.com.br globo.com ' +
    'globomail.com r7.com zipmail.com.br protonmail.com proton.me pm.me gmx.com gmx.net zoho.com yandex.com mail.com tutanota.com');
  // Notificadores de redes sociais (curtidas, aniversários, vídeos novos): sem padrão de remetente de
  // vaga/convite/mensagem, a notificação é "outros" — não newsletter, não networking.
  var SOCIAL_NOTIFIER_DOMAINS = ['facebookmail.com', 'facebook.com', 'instagram.com', 'youtube.com', 'x.com', 'twitter.com', 'tiktok.com',
    'pinterest.com', 'threads.net', 'snapchat.com', 'reddit.com', 'redditmail.com', 'linkedin.com', 'quora.com'];
  // Rótulos de segundo nível que fazem parte do sufixo público (empresa.com.br, orgao.gov.br).
  var SECOND_LEVEL_SUFFIX = /^(?:com|net|org|gov|edu|mil|art|adv|eng|ind|inf|med|blog|coop|jus|leg|mp|tv|co|ac|or|ne|go)$/;

  // ------------------------------------------------- pistas de linguagem ----
  // Pedido de credenciais/dados (golpe): imperativo + dado sensível. "Nunca pedimos senhas" não casa.
  var RE_CREDENTIAL_ASK = /(?:^|[^a-z])(?:confirme|confirmar|informe|informar|digite|digitar|atualize|atualizar|envie|enviar|valide|validar|verifique|verificar|regularize|regularizar|recadastre|desbloqueie|desbloquear|verify|confirm|update|validate|re-?enter|unlock|keep)\s+(?:(?:seus|suas|sua|seu|os|as|o|a|your|the|current|my)\s+){0,2}(?:dados|senha|senhas|token|cpf|cartao|cadastro|conta|identidade|credenciais|account|password|identity|credentials|billing|login|mailbox)(?![a-z])/;
  // Isca de download (formulário/boleto "atualizado" em arquivo): só corrobora golpe.
  var RE_DOWNLOAD_LURE = /(?:^|[^a-z])(?:baixe|baixar|abra|abrir|download|open)\s+(?:(?:o|a|seu|sua|the|attached)\s+){0,2}(?:formulario|arquivo|anexo|documento|boleto|form|file|attachment)(?![a-z])/;
  // Ameaça/pressão típica de golpe: bloqueio, cancelamento, protesto, perda de acesso, taxa para liberar.
  var RE_THREAT = /(?:sera|serao|vai ser|podera ser|poderao ser|sejam?)\s+(?:bloquead|suspens|cancelad|desativad|encerrad|excluid|apagad)|(?:evitar|evite)\s+(?:o |a )?(?:bloqueio|suspensao|cancelamento|protesto|negativacao)|bens bloqueados|perder o acesso|perdera o acesso|negativacao|protesto (?:em|no) cartorio|taxa (?:de )?(?:liberacao|importacao|desembaraco|alfandega)|pague a taxa|will be (?:suspended|locked|closed|deactivated|deleted|disabled)|(?:lose|losing) access|expires? today|account (?:will be )?(?:suspended|locked)|unusual sign-?in activity/;
  // Pedido de pagamento/transferência (o golpe do "CEO", da taxa, do boleto falso).
  var RE_PAYMENT_ASK = /(?:^|[^a-z])(?:faca|fazer|faz|realize|realizar|efetue|efetuar|mande|manda|mandar|envie|enviar|transfira|transferir|pague|pagar|paga|deposite|depositar|compre|comprar|compra|adquira|send|make|wire|pay|transfer|buy|purchase|get)\s+(?:(?:um|uma|o|a|os|as|me|the|a|this|some|alguns|algumas)\s+){0,2}(?:pix|transferencia|ted|doc|deposito|pagamento|boleto|valor|taxa|r\$|dinheiro|gift ?cards?|cart(?:ao|oes)[- ]presentes?|vales?[- ]presentes?|payment|wire|transfer|money|invoice)(?![a-z])|chave pix|gift ?cards?|cart(?:ao|oes)[- ]presentes?|vales?[- ]presentes?|linha digitavel|codigo de barras|dados bancarios|(?:segue|seguem|anexo|anexamos|em anexo)\s+(?:o |os |a |nosso |nossa )?(?:boleto|fatura|cobranca)/;
  // Troca de dados bancários/destino do pagamento (fraude de boleto/fatura).
  var RE_BANK_CHANGE = /(?:nova|novos|outra|nossa nova) (?:conta|dados bancarios|chave pix|conta bancaria)|(?:alteracao|mudanca|atualizacao|troca) (?:da|de|dos|do) (?:conta|dados bancarios|banco|chave pix)|new (?:bank )?account|(?:updated|new|changed) (?:bank|banking|payment|remittance) details|change (?:of|in) (?:bank|payment) details/;
  // Urgência ou sigilo (engenharia social).
  var RE_PRESSURE = /(?:^|[^a-z])(?:urgente|urgencia|hoje ainda|o quanto antes|imediatamente|nao consigo (?:falar|atender)|estou em reuniao|em reuniao com|confidencial|sigilo|nao comente|urgent|asap|right away|confidential|keep this between)(?![a-z])/;
  // Cargo executivo/financeiro reivindicado (golpe do "CEO" em e-mail gratuito).
  var RE_EXECUTIVE = /(?:^|[^a-z])(?:diretor|diretora|diretoria|ceo|cfo|coo|presidente|presidencia|conselho|vice-presidente|socio-diretor|gerente financeir[oa]|head de financas|board|chairman|managing director)(?![a-z])/;
  // Débito automático ATIVO (o pagamento acontece sozinho) × oferta de cadastrar ou falha do débito.
  var RE_AUTOPAY = /debito automatico (?:ativo|ativad[oa]|cadastrad[oa]|programad[oa]|agendad[oa]|habilitad[oa])|(?:sera|serao|e|esta|estao) pag[oa]s? (?:via|por|pelo|com|em|no) debito automatico|sera debitad[oa]|serao debitad[oa]s|debitad[oa]s? automaticamente|pagamento automatico (?:ativo|ativad[oa]|cadastrad[oa])|autopay (?:is )?(?:on|enabled|active)|will be automatically (?:charged|debited)|will be (?:charged|debited) automatically/;
  var RE_AUTOPAY_FAIL = /(?:nao (?:foi possivel|conseguimos)|falha (?:n[oa]|ao)|erro n[oa]) (?:realizar |efetuar |processar )?(?:o |a )?(?:debito|pagamento)|debito (?:automatico )?(?:nao (?:foi )?(?:realizado|efetuado|autorizado)|recusado)|saldo insuficiente|payment (?:failed|declined)/;
  // Declaração explícita de que não há nada a fazer (sem condicional antes: "se foi você, não precisa…" é condicional).
  var RE_NO_ACTION = /nao (?:e|sera) (?:necessari[oa]|preciso) (?:fazer|tomar) (?:nada|nenhuma (?:acao|providencia))|nenhuma (?:acao|providencia) (?:e|sera) necessaria|(?:voce )?nao precisa (?:fazer|se preocupar com) nada|nada (?:mais )?a fazer|no (?:further )?action (?:is )?(?:required|needed)|you don'?t (?:need|have) to do anything|nothing (?:else )?(?:for you )?to do/;
  var RE_CONDITIONAL_LEAD = /(?:^|[^a-z])(?:se|caso|if)\s[^.!?]{0,60}$/;
  // Ação condicional legítima de alerta de segurança: "se não foi você, …".
  var RE_SECURITY_CONDITIONAL = /(?:se|caso) (?:nao (?:foi|tenha sido|for) voce|voce nao (?:reconhec|fez|solicitou|realizou|autorizou)|nao (?:reconhec|tenha (?:feito|solicitado)))|if (?:this|it) (?:wasn'?t|was not|isn'?t) you|if you (?:did not|didn'?t|do not|don'?t) (?:recogni[sz]e|make|request|disable|enable|change|sign)/;
  // Fim de processo seletivo: não há oportunidade aberta.
  var RE_REJECTION = /(?:seguir|prosseguir|continuar|avancar) com outr[oa]s? (?:candidat|perfis|profissionais)|optamos por (?:outr[oa]|nao (?:seguir|prosseguir|avancar))|(?:voce )?nao (?:foi|ter sido) selecionad|nao seguiremos com (?:a )?sua candidatura|nao avancaremos|(?:vaga|posicao|processo) (?:foi )?(?:encerrad|preenchid|cancelad|congelad)|decided (?:to )?(?:move forward|proceed|go) with other|not (?:been )?selected|(?:position|role) (?:has been )?(?:filled|closed)|will not be moving forward|unfortunately,? (?:we|after)/;
  // Pistas de vaga em mensagem de carreira/networking.
  var RE_JOB_CUE = /(?:^|[^a-z])(?:vagas?|cargo|posicao|position|oportunidade de (?:emprego|trabalho|carreira)|processo seletivo|candidatura|entrevista|interview|carta proposta|offer letter|job offer|oferta de emprego|proposta de (?:trabalho|emprego|contratacao)|hiring|contratando|estamos buscando|buscamos)(?![a-z])/;
  // Oferta dirigida ao dono (vale em qualquer categoria): "temos uma vaga", "seu perfil", "posso te indicar".
  var RE_OFFER_CUE = /(?:temos|tenho|abrimos|abriu|surgiu|estamos com|conduzindo) (?:uma |um )?(?:vaga|posicao|oportunidade|processo)|(?:seu|teu) (?:perfil|curriculo|historico)|(?:posso )?te indic|indicar voce|interesse (?:na|em uma|pela|pela sua) (?:vaga|posicao|oportunidade)|proposta de (?:trabalho|emprego|contratacao)|carta proposta|offer letter|job offer|oferta de emprego|we(?:'re| are) hiring|would you be (?:open|interested)|your (?:profile|background|experience)|(?:great|strong|good) (?:match|fit)|processo seletivo|sua candidatura|entrevista (?:marcada|agendada|com)/;
  // Proposta de negócio/sociedade ao dono.
  var RE_BIZ_CUE = /(?:entrar|ser|virar|tornar-se|participar) (?:como )?(?:meu |nosso )?(?:socio|socia|parceiro|parceira|cofundador|co-fundador)|proposta de (?:sociedade|parceria)|propor (?:uma )?(?:sociedade|parceria)|(?:montar|montando|abrir|abrindo|fundar|fundando|criar|criando) (?:uma |um )?(?:empresa|consultoria|startup|negocio|sociedade)(?: juntos)?|sociedade (?:com voce|entre nos)|join (?:us )?as (?:a )?(?:partner|co-?founder)|partnership (?:opportunity|proposal)|co-?founder/;
  // Anexo executável/HTML: clássico de phishing.
  var RE_RISKY_ATTACHMENT = /\.(?:html?|shtml|xhtml|svg|hta|js|jse|vbs|vbe|wsf|exe|scr|bat|cmd|pif|msi|iso|img|lnk|jar)$/i;

  // Gravidade de notificações sérias (0..1). O maior valor que casar vence.
  var SEVERITY_RULES = [
    { key: 'conta_comprometida', w: 0.7, re: /novo (?:login|acesso)|new (?:sign-?in|login|device)|(?:login|acesso) (?:de|em|a partir de) (?:um )?novo dispositivo|dispositivo (?:desconhecido|nao reconhecido)|senha (?:da sua conta |de acesso )?(?:foi )?(?:alterada|redefinida|modificada)|password (?:was |has been )?(?:changed|reset)|(?:autenticacao em (?:dois|2) (?:fatores|etapas)|verificacao em (?:duas|2) etapas|two-factor authentication|2fa)[^.]{0,40}(?:desativad|desabilitad|removid|disabled|removed|turned off)|(?:compra|transacao|tentativa de compra|pagamento|login|acesso) (?:suspeit[oa]|nao reconhecid[oa])|bloqueamos (?:a|uma) (?:transacao|compra)|atividade suspeita|suspicious (?:activity|sign-?in|login|transaction)|(?:e-?mail|telefone) de recuperacao (?:foi )?alterad|recovery (?:email|phone) (?:was )?changed/ },
    { key: 'codigo_ou_redefinicao', w: 0.2, re: /codigo de (?:verificacao|seguranca|acesso)|verification code|one-time code|redefini\w* (?:de |da )?senha|password reset|reset your password/ },
    { key: 'resultado_saude', w: 0.6, re: /resultados? (?:d[eo]s? )?(?:seus? )?exames?[^.]{0,90}(?:disponive|pronto|liberad)|(?:laudo|resultado)s? (?:ja )?(?:esta|estao|disponive|liberad)|exames? (?:ja )?disponive|test results? (?:are |is )?(?:ready|available)|(?:autorizacao|guia)[^.]{0,40}(?:negada|recusada|indeferida)/ },
    { key: 'governo_juridico', w: 0.7, re: /malha (?:fina|fiscal)|declaracao[^.]{0,30}retida|pendencias? na (?:sua )?declaracao|intima(?:c|d)|citacao (?:judicial|postal)|foi citad[oa]|notificacao (?:de autuacao|extrajudicial|judicial)|autuacao|auto de infracao|infracao de transito|indicacao (?:do )?condutor|divida ativa|execucao fiscal|penhora|bloqueio judicial|audiencia (?:de |marcada|designada|judicial)|processo (?:judicial|administrativo|n[o.º]?\s*\d)|mandado de|cpf (?:suspenso|irregular|pendente de regularizacao)/ },
    { key: 'atraso_com_consequencia', w: 0.5, re: /em atraso|em aberto[^.]{0,40}vencid|vencid[oa] (?:em|desde|ha)|(?:corte|suspensao|interrupcao) (?:do|de|no) (?:fornecimento|servico|energia|abastecimento)|inscric\w* (?:do debito )?em divida/ },
    { key: 'retirada_com_prazo', w: 0.5, needsDeadline: true, re: /(?:aguardando|disponivel para|pronto para) retirada|retire (?:o |seu |sua )?(?:objeto|pedido|produto|encomenda|pacote)|sera devolvid[oa] ao remetente|tentativa de entrega/ },
    { key: 'tarefa_atribuida', w: 0.5, re: /atribuiu [^.]{0,80} a voce|assigned (?:[^.]{0,40} )?to you|requested your review|review requested|solicitou (?:a )?sua revisao|pediu (?:a )?sua revisao|aguarda (?:a )?sua (?:aprovacao|assinatura)|precisa da sua (?:aprovacao|assinatura)|(?:enviou|compartilhou) (?:um |o )?documento[^.]{0,40}assin|documento[^.]{0,40}(?:para|aguardando|pendente de) (?:sua )?assinatura/ },
    { key: 'vulnerabilidade', w: 0.5, re: /(?:critical|high) severity|severidade (?:critica|alta)|vulnerabilidade (?:critica|grave)|security advisory/ },
    { key: 'etapa_processo', w: 0.5, needsDeadline: true, re: /(?:case|teste|desafio) tecnico|proxima etapa|etapa do processo|carta proposta|offer letter|aceite (?:assinado|da proposta)/ },
    { key: 'viagem_iminente', w: 0.4, needsDeadline: true, re: /check-?in (?:do (?:seu )?voo|ja esta aberto|aberto|online)|cartao de embarque|boarding pass/ },
  ];

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

  /**
   * Termos do perfil (interesses + cargos-alvo) que NÃO contam como evidência de categoria:
   * para quem trabalha com "pricing", a palavra aparece em PR, planilha, recrutadora e
   * newsletter — ela mede interesse, não o tipo da mensagem. Palavras extras que o usuário
   * adicionou explicitamente a uma categoria continuam valendo para ela.
   */
  function profileTerms_(profile) {
    var out = {};
    var p = profile || {};
    (p.interests || []).concat(p.targetRoles || []).forEach(function (t) {
      var n = Util.normalizeText(t);
      if (n) out[n] = true;
    });
    return out;
  }

  function compile_(taxonomy, exclude) {
    var extra = {};
    try {
      extra = (Config.get().categories || {}).extraKeywords || {};
    } catch (e) {
      extra = {};
    }
    var key = Util.shortHash(JSON.stringify([taxonomy.map(function (c) { return [c.id, c.keywords, c.negative, c.senderDomains, c.senderPatterns]; }), Object.keys(exclude).sort(), extra]), 12);
    if (compiled_ && compiledFor_ === key) return compiled_;
    compiled_ = taxonomy.map(function (c) {
      var keep = {};
      (extra[c.id] || []).forEach(function (k) { keep[Util.normalizeText(k)] = true; });
      function allowed(kw) {
        var n = Util.normalizeText(kw);
        return !exclude[n] || !!keep[n];
      }
      return {
        cat: c,
        strong: (c.keywords.strong || []).filter(allowed).map(makeMatcher_).filter(Boolean),
        weak: (c.keywords.weak || []).filter(allowed).map(makeMatcher_).filter(Boolean),
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
      var d = String(list[i] || '').toLowerCase();
      if (d && (domain === d || domain.slice(-(d.length + 1)) === '.' + d)) return d;
    }
    return '';
  }

  // ---------------------------------------------------- classificação ----
  /**
   * @param {Object} parsed ParsedMessage
   * @param {{refYmd?: string, ownerEmail?: string, taxonomy?: Object[], profile?: Object, knownContacts?: Object, knownContactNames?: Object}} ctx
   *   `knownContacts`: {email: true | 'Nome'}; `knownContactNames` (opcional): {email: 'Nome'}.
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
    var all = subject + ' \n ' + body;
    var fromEmail = String(parsed.from_email || '').toLowerCase();
    var fromDomain = String(parsed.from_domain || Util.emailDomain(fromEmail)).toLowerCase();
    var matchers = compile_(taxonomy, profileTerms_(profile));
    var scores = {};
    var hits = {};
    var signals = [];
    var patternHit = false;
    var editorialCue = false;

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
        if ((a || b) && m.cat.id === 'newsletters' && LIST_FOOTERS.indexOf(x.kw) < 0) editorialCue = true;
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
        if (m.cat.id === 'newsletters') editorialCue = true;
      }
      if (m.patterns.some(function (p) { return fromEmail === p || (p.indexOf('@') < 0 && fromEmail.indexOf(p) === 0); })) {
        s += W.pattern;
        found.unshift(fromEmail);
        patternHit = true;
      }
      if (parsed.gmail_category && m.cat.gmailCategories.indexOf('CATEGORY_' + parsed.gmail_category) >= 0) s += W.gmail;
      scores[m.cat.id] = s;
      hits[m.cat.id] = found;
    });

    // Sinais estruturais. Lista de discussão (Google Groups etc.) é conversa humana distribuída:
    // não é formato de massa para fins de categoria.
    var bulk = !!parsed.is_bulk;
    var discussion = !!parsed.is_discussion_list;
    var listHeaders = !!(parsed.has_list_unsubscribe || parsed.list_id);
    var massFormat = bulk && !discussion;
    if (discussion) signals.push('discussion_list');
    // Conteúdo editorial = palavras de newsletter ou tema jornalístico/informativo. Sem isso, os
    // cabeçalhos de lista são só um detalhe técnico (boleto, alerta, notificação também os usam).
    var editorial = editorialCue || EDITORIAL.some(function (id) { return scores[id] >= MIN_SCORE; });
    if (massFormat && listHeaders && editorial) {
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
    // Proposta de sociedade/parceria vinda de uma pessoa é relação profissional (networking).
    var bizCue = RE_BIZ_CUE.test(all);
    if (bizCue && !parsed.is_automated && !bulk) add_(scores, 'networking', 3);

    // Remetente imitado, marca falsa, Reply-To divergente: decide confiança e reforça spam.
    var spoof = spoofAnalysis_(parsed, c, cfg, profile, all, bodyRaw);
    if (spoof.phishing) {
      add_(scores, 'spam', 6);
      signals.push('phishing');
    }

    // Escolha da principal e das secundárias.
    // Sem conteúdo editorial, "newsletters" (só rodapé de lista) não é categoria da mensagem.
    var ranked = Object.keys(scores).filter(function (id) {
      return id !== 'outros' && (editorial || id !== 'newsletters');
    }).sort(function (a, b) {
      if (scores[b] !== scores[a]) return scores[b] - scores[a];
      return catPrior_(taxonomy, b) - catPrior_(taxonomy, a);
    });
    var top = ranked[0];
    var primary = top && scores[top] >= MIN_SCORE ? top : 'outros';
    var maxScore = primary === 'outros' ? 0 : scores[primary];
    // Golpe claro é spam, qualquer que seja o vocabulário que ele imita.
    if (spoof.phishing && scores.spam >= MIN_SCORE) {
      primary = 'spam';
      maxScore = Math.max(maxScore, scores.spam);
    }
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
    // Notificação de rede social (curtidas, aniversários, vídeo novo) é "outros".
    var social = !!parsed.is_automated && !!domainMatches_(fromDomain, SOCIAL_NOTIFIER_DOMAINS) && !patternHit &&
      primary !== 'seguranca_conta' && primary !== 'spam' && !(scores.seguranca_conta >= MIN_SCORE);
    if (social) {
      primary = 'outros';
      signals.push('social_notifier');
    }
    var secondary = ranked.filter(function (id) {
      return id !== primary && scores[id] >= Math.max(MIN_SCORE, 0.5 * maxScore) && !(social && (id === 'newsletters' || id === 'networking'));
    }).slice(0, 3);
    if (massFormat && listHeaders && editorial && primary !== 'newsletters' && primary !== 'marketing' && primary !== 'spam' && primary !== 'outros' &&
      TRANSACTIONAL.indexOf(primary) < 0 && secondary.indexOf('newsletters') < 0) {
      secondary = ['newsletters'].concat(secondary).slice(0, 3);
    }
    var second = ranked.filter(function (id) { return id !== primary; })[0];
    var margin = maxScore > 0 ? (maxScore - (scores[second] || 0)) / maxScore : 0;
    var confidence = primary === 'outros' ? 0.3 : Util.clamp(0.3 + 0.35 * Math.min(1, maxScore / 10) + 0.35 * margin, 0.2, 0.95);

    var isMarketing = primary === 'marketing' || (parsed.gmail_category === 'PROMOTIONS' && scores.marketing >= MIN_SCORE);
    var isSpam = scores.spam >= 6 || (!!parsed.auth_fail && scores.spam >= 4) || spoof.phishing;
    // Spam confirmado (várias iscas de golpe) com evidência comparável à do tema imitado vira a principal.
    if (isSpam && primary !== 'spam' && primary !== 'seguranca_conta' && scores.spam >= 0.5 * maxScore) {
      secondary = [primary].concat(secondary.filter(function (id) { return id !== 'spam'; })).slice(0, 3);
      primary = 'spam';
      isMarketing = false;
      signals.push('spam_promoted');
    }
    // Newsletter só como formato de conteúdo editorial: boleto/alerta com List-Unsubscribe não é newsletter.
    var isNewsletter = primary === 'newsletters' || (secondary.indexOf('newsletters') >= 0 && TRANSACTIONAL.indexOf(primary) < 0);

    // Injection: texto visível OU instrução escondida no HTML (display:none, font-size:0…).
    var injection = Extractors.detectInjection((parsed.subject || '') + '\n' + bodyRaw);
    if (parsed.hidden_text) {
      var hid = Extractors.detectInjection(parsed.hidden_text, { hidden: true });
      var hiddenHit = hid.suspected || hid.signals.some(function (s) {
        return s !== 'QUOTED_EXAMPLE' && s !== 'ZERO_WIDTH' && s !== 'HIDDEN_CSS';
      });
      if (hiddenHit) injection = { suspected: true, signals: Util.uniq(injection.signals.concat(['HIDDEN_INSTRUCTION'], hid.signals)) };
    }
    if (!injection.suspected && parsed.html_text) {
      var alt = Extractors.detectInjection(parsed.html_text);
      if (alt.suspected) injection = { suspected: true, signals: Util.uniq(injection.signals.concat(['HTML_PART'], alt.signals)) };
    }
    if (injection.suspected) signals.push('injection');

    // Confiança do remetente (inclui o rótulo SPAM do próprio Gmail).
    var untrusted = !!parsed.auth_fail || !!parsed.is_spam || isSpam || spoof.untrusted;
    if (untrusted) signals.push('untrusted');

    // Ações: só de remetentes que não são envio em massa, ou de categorias transacionais;
    // nunca de mensagem não confiável, com injection, marketing ou newsletter.
    var autopay = RE_AUTOPAY.test(body) && !RE_AUTOPAY_FAIL.test(body);
    var noAction = noActionStatement_(body);
    // Alerta de segurança: só a ação condicional ("se não foi você, recupere o acesso") vale, e ela
    // conta mesmo com o peso reduzido que condicionais têm em actionSignals.
    var securityConditional = RE_SECURITY_CONDITIONAL.test(body) && action.phrases.length > 0;
    var compromise = SEVERITY_RULES[0].re.test(all);
    var actionGate = primary === 'seguranca_conta' ? securityConditional && action.score >= 0.15
      : action.score >= 0.5 || (compromise && securityConditional && action.score >= 0.15);
    var actionRequired = actionGate && !untrusted && !injection.suspected && !isMarketing && !isSpam &&
      (!isNewsletter || primary === 'tarefas') && (!massFormat || TRANSACTIONAL.indexOf(primary) >= 0);
    if (actionRequired && (autopay || noAction) && ['contas', 'financas', 'compras'].indexOf(primary) >= 0) actionRequired = false;
    // Prazo do dono: nunca de marketing, newsletter, spam ou remetente não confiável (VALIDITY nunca entra).
    var ownerDeadline = !untrusted && !isSpam && !isMarketing && !isNewsletter && !injection.suspected;
    var deadline = ownerDeadline ? pickDeadline_(deadlines, refYmd) : null;
    var actions = [];
    if (actionRequired) {
      actions = action.phrases.slice(0, 3).map(function (ph) {
        return {
          description: Util.truncate(sentenceAround_(bodyRaw, ph) || ph, 160),
          owner: parsed.user_in_to && !massFormat ? 'me' : 'unknown',
          due_date: deadline ? deadline.date : '',
          due_certainty: deadline ? deadline.certainty : 'NONE',
          evidence: Util.truncate(Extractors.redactPii(ph).text, 120),
        };
      });
    }
    // Conta com vencimento é tarefa mesmo sem frase de pedido — exceto débito automático ativo,
    // "não precisa fazer nada" e, claro, cobrança não confiável (boleto falso).
    if (primary === 'contas' && deadline && deadline.kind === 'DEADLINE' && !isMarketing && !untrusted && !injection.suspected && !autopay && !noAction) {
      actionRequired = true;
      if (!actions.length) {
        actions.push({ description: 'Pagar ou verificar: ' + Util.truncate(Extractors.redactPii(parsed.subject || 'cobrança').text, 100), owner: 'me', due_date: deadline.date, due_certainty: deadline.certainty, evidence: Util.truncate(Extractors.redactPii(deadline.evidence).text, 120) });
      }
    }
    // Mensagem enviada pelo dono: o pedido é dele para os outros, não uma tarefa nem um prazo dele.
    if (parsed.direction === 'OUTBOUND') {
      actionRequired = false;
      actions = [];
      deadline = null;
    }

    // Oportunidade (independe da categoria principal).
    var opportunity = buildOpportunity_(parsed, {
      primary: primary, secondary: secondary, all: all, bodyRaw: bodyRaw, job: job, bulk: bulk, fromEmail: fromEmail, fromDomain: fromDomain,
      blocked: isMarketing || isSpam || untrusted || injection.suspected, patternHit: patternHit, profile: profile, bizCue: bizCue,
      editorialMass: massFormat && editorial,
      actionRequired: actionRequired, actions: actions, deadline: deadline,
    });

    var interest = Extractors.interestMatch((parsed.subject || '') + ' ' + bodyRaw, profile.interests || []);
    var facts = keyFacts_(bodyRaw, untrusted ? [] : deadlines, refYmd);
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
    if (parsed.from_name && !parsed.is_automated && (!bulk || discussion)) entities.push({ name: Util.truncate(parsed.from_name, 80), type: 'person' });
    if (opportunity && opportunity.company) entities.push({ name: opportunity.company, type: 'company' });

    var severity = 0;
    var sevKey = '';
    if (!untrusted && !injection.suspected && !isMarketing && !isSpam && !isNewsletter && !(massFormat && editorial)) {
      SEVERITY_RULES.forEach(function (r) {
        if (r.w > severity && (!r.needsDeadline || deadline) && r.re.test(all)) {
          severity = r.w;
          sevKey = r.key;
        }
      });
    }
    if (sevKey) signals.push('severity:' + sevKey);

    var reasonBits = [];
    if ((hits[primary] || []).length) reasonBits.push('Termos: ' + hits[primary].slice(0, 4).join(', '));
    if (bulk) reasonBits.push(discussion ? 'lista de discussão' : 'envio em massa');
    if (untrusted) reasonBits.push('remetente não confiável' + (spoof.signals.length ? ' (' + spoof.signals.join(', ') + ')' : ''));
    if (actionRequired) reasonBits.push('pedido de ação');
    if (deadline) reasonBits.push('prazo ' + Util.formatBrDate(deadline.date));

    var aiEligible = !((cat.aiEligible === false && (!!cat.sensitive || confidence >= 0.6)) || isSpam);

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
      ai_eligible: aiEligible,
      injection: injection,
      untrusted: untrusted,
      spoof_signals: spoof.signals,
      severity: Util.round(severity, 3),
    };
  }

  function add_(scores, id, n) {
    if (scores[id] !== undefined) scores[id] += n;
  }

  function catPrior_(taxonomy, id) {
    for (var i = 0; i < taxonomy.length; i++) if (taxonomy[i].id === id) return taxonomy[i].prior;
    return 0;
  }

  /** "Não precisa fazer nada" sem condicional antes na mesma frase ("se foi você, não precisa…" é condicional). */
  function noActionStatement_(text) {
    var re = new RegExp(RE_NO_ACTION.source, 'g');
    var m;
    while ((m = re.exec(text)) !== null) {
      var start = Math.max(0, m.index - 80);
      var before = text.slice(start, m.index);
      var cut = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf(':'));
      if (cut >= 0) before = before.slice(cut + 1);
      if (!RE_CONDITIONAL_LEAD.test(before)) return true;
    }
    return false;
  }

  // ------------------------------------------------ confiança do remetente ----
  function toSet_(words) {
    var o = {};
    String(words).split(/\s+/).forEach(function (w) { if (w) o[w] = true; });
    return o;
  }

  /** Domínio registrável (empresa.com.br, orgao.gov.br, empresa.com). */
  function baseDomain_(d) {
    var parts = String(d || '').toLowerCase().split('.').filter(function (x) { return !!x; });
    if (parts.length <= 2) return parts.join('.');
    var tld = parts[parts.length - 1];
    var sld = parts[parts.length - 2];
    if (tld.length === 2 && SECOND_LEVEL_SUFFIX.test(sld)) return parts.slice(-3).join('.');
    return parts.slice(-2).join('.');
  }

  /** Texto normalizado para casar palavras inteiras: " a b c ". */
  function words_(s) {
    return ' ' + Util.normalizeText(s).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  }

  /**
   * Nome de exibição dividido em autor e plataforma: "Fulano via Plataforma" e
   * "Fulano (Plataforma)" são retransmissões — a marca reivindicada é a da plataforma.
   */
  function displayParts_(name) {
    var raw = String(name || '').replace(/\S+@\S+/g, ' ').trim();
    var via = /^(.*?\S)\s+via\s+(.+)$/i.exec(raw);
    if (via) return { raw: raw, actor: via[1], platform: via[2], relay: true };
    var par = /^(.*?\S)\s*\(([^)]+)\)\s*$/.exec(raw);
    if (par) return { raw: raw, actor: par[1], platform: par[2].replace(/^via\s+/i, ''), relay: true };
    return { raw: raw, actor: raw, platform: '', relay: false };
  }

  /**
   * Marca reivindicada pelo nome de exibição (ou por um domínio que contém o nome da
   * marca) e se o domínio do remetente é um dos legítimos dela.
   * @return {{brand: string, legit: boolean, by: string}|null}
   */
  function brandClaim_(display, fromDomain, brandDomains) {
    var map = brandDomains || {};
    var shown = words_(display.relay ? display.platform : display.raw);
    // Rótulos do domínio (sem o TLD) e seus trechos separados por hífen: a marca precisa ser um
    // trecho inteiro ("correios-entregas-br" casa "correios"; "amazonasenergia" não casa "amazon").
    var parts = String(fromDomain || '').toLowerCase().split('.');
    var segments = {};
    parts.slice(0, Math.max(1, parts.length - 1)).forEach(function (label) {
      segments[label.replace(/[^a-z0-9]/g, '')] = true;
      label.split('-').forEach(function (seg) { if (seg) segments[seg] = true; });
    });
    var claims = [];
    Object.keys(map).forEach(function (brand) {
      var key = words_(brand).trim();
      if (!key) return;
      var compact = key.replace(/ /g, '');
      var byName = shown.indexOf(' ' + key + ' ') >= 0;
      // O domínio só "reivindica" a marca quando não é um provedor gratuito (gmail.com contém "gmail").
      var byDomain = !FREEMAIL[fromDomain] && compact.length >= 5 && !!segments[compact];
      // Caixa de e-mail gratuito nunca é o domínio legítimo de uma marca ("Microsoft" em @outlook.com).
      if (byName || byDomain) claims.push({ brand: brand, legit: !FREEMAIL[fromDomain] && !!domainMatches_(fromDomain, map[brand] || []), by: byName ? 'display' : 'domain' });
    });
    if (!claims.length) return null;
    var ok = claims.filter(function (x) { return x.legit; })[0];
    return ok || claims[0];
  }

  // Palavras de setor/papel/organização: não identificam uma pessoa ("financeiro.escola" não é nome).
  var ROLE_WORDS = toSet_('financeiro financeira contato atendimento comercial vendas suporte support help ajuda secretaria ' +
    'coordenacao diretoria direcao administracao adm admin juridico rh recrutamento talentos equipe time team escola colegio ' +
    'clube associacao condominio sindico portaria recepcao agendamento clinica loja empresa grupo oficial info news noreply ' +
    'reply naoresponda contas cobranca faturas fatura boletos pagamentos compras pedidos marketing ofertas eventos');

  /** Palavras de nome próprio (≥ 3 letras) da parte local: "juliana.prado" → [juliana, prado]. */
  function localNameTokens_(email) {
    var local = String(email || '').split('@')[0].toLowerCase().split('+')[0];
    return Util.stripDiacritics(local).split(/[._\-]+|\d+/).filter(function (t) { return /^[a-z]{3,}$/.test(t) && !ROLE_WORDS[t]; });
  }

  /**
   * O nome de exibição é o de um contato conhecido (ou do dono), mas o endereço é outro,
   * de outro domínio, e não é uma retransmissão de plataforma ("Fulano via DocuSign",
   * notificações do GitHub com o nome do autor).
   */
  function nameImpersonation_(parsed, display, ctx) {
    var fromDomainRaw = String(parsed.from_domain || Util.emailDomain(parsed.from_email)).toLowerCase();
    // Retransmissão de plataforma ("Fulano via DocuSign") não imita ninguém; num e-mail gratuito, o
    // "(Diretoria)" depois do nome não é plataforma nenhuma e o nome continua sendo verificado.
    if (parsed.is_automated || (display.relay && !FREEMAIL[fromDomainRaw])) return '';
    var shown = words_(display.relay ? display.actor : display.raw).trim().split(' ').filter(function (t) { return t.length >= 3 && !ROLE_WORDS[t]; });
    if (shown.length < 2) return '';
    var shownCompact = shown.join('');
    var fromEmail = String(parsed.from_email || '').toLowerCase();
    var fromBase = baseDomain_(parsed.from_domain || Util.emailDomain(fromEmail));
    var known = ctx.knownContacts || {};
    var names = ctx.knownContactNames || {};
    if (known[fromEmail]) return '';
    var people = Object.keys(known).map(function (e) {
      return { email: String(e).toLowerCase(), name: typeof known[e] === 'string' ? known[e] : names[e] || '' };
    });
    Object.keys(names).forEach(function (e) {
      if (!known[e]) people.push({ email: String(e).toLowerCase(), name: names[e] });
    });
    if (ctx.ownerEmail) people.push({ email: String(ctx.ownerEmail).toLowerCase(), name: '' });
    for (var i = 0; i < people.length; i++) {
      var p = people[i];
      if (!p.email || p.email === fromEmail || baseDomain_(Util.emailDomain(p.email)) === fromBase) continue;
      var tokens = p.name ? words_(p.name).trim().split(' ').filter(function (t) { return t.length >= 3 && !ROLE_WORDS[t]; }) : localNameTokens_(p.email);
      if (tokens.length < 2 && !tokens.some(function (t) { return t.length >= 8; })) continue;
      var matched = tokens.filter(function (t) { return shown.indexOf(t) >= 0; }).length;
      var compactHit = tokens.some(function (t) { return t.length >= 8 && t === shownCompact; });
      if (matched >= 2 || compactHit) return p.email;
    }
    return '';
  }

  /**
   * Sinais de remetente forjado/imitado e a decisão de confiança.
   *  - AUTH_FAIL: SPF/DMARC falhou (parser).
   *  - BRAND_DOMAIN_MISMATCH: o nome (ou o domínio) reivindica uma marca de `privacy.brandDomains`,
   *    mas o domínio não é um dos legítimos dela. Torna a mensagem não confiável quando corroborado:
   *    e-mail gratuito, pedido de credenciais, ameaça de bloqueio ou falta de autenticação positiva.
   *  - DISPLAY_NAME_IMPERSONATION: nome de contato conhecido com outro endereço/domínio. Não confiável
   *    quando vem com pedido de pagamento/dados, pressão/sigilo ou Reply-To divergente (o mesmo nome
   *    num endereço pessoal novo, sem pedido arriscado, é só um alerta).
   *  - REPLY_TO_MISMATCH: Reply-To para outro domínio (ou outra caixa de e-mail gratuito) em pedido
   *    de pagamento/dados.
   *  - FREEMAIL_EXECUTIVE: e-mail gratuito que se apresenta como diretoria/CEO e pede pagamento/dados.
   *  - RISKY_ATTACHMENT: anexo HTML/executável (só corrobora).
   * `phishing` = golpe claro (sinal de identidade + isca), que vira spam.
   */
  function spoofAnalysis_(parsed, ctx, cfg, profile, all, bodyRaw) {
    var signals = [];
    var fromEmail = String(parsed.from_email || '').toLowerCase();
    var fromDomain = String(parsed.from_domain || Util.emailDomain(fromEmail)).toLowerCase();
    var freemail = !!FREEMAIL[fromDomain];
    var display = displayParts_(parsed.from_name);
    var credential = RE_CREDENTIAL_ASK.test(all);
    var threat = RE_THREAT.test(all);
    var payment = RE_PAYMENT_ASK.test(all);
    var pressure = RE_PRESSURE.test(all);
    var riskyAsk = credential || payment;
    var attachments = parsed.attachments || [];
    var riskyAttachment = attachments.some(function (a) { return RE_RISKY_ATTACHMENT.test(String((a && a.filename) || '')); });
    var authFail = !!parsed.auth_fail;
    if (authFail) signals.push('AUTH_FAIL');

    var brand = brandClaim_(display, fromDomain, ((cfg && cfg.privacy) || {}).brandDomains);
    var brandBad = !!brand && !brand.legit;
    if (brandBad) signals.push('BRAND_DOMAIN_MISMATCH');
    var attachLure = riskyAttachment || RE_DOWNLOAD_LURE.test(all);
    // Marca falsa precisa de corroboração: isca (credenciais, ameaça, pagamento, anexo) ou, fora de
    // e-mail gratuito, falta de autenticação positiva. "Fulana | Banco X" escrevendo de um Gmail sem
    // isca é só uma pessoa citando a empresa (ex.: recrutadora).
    var brandUntrusted = brandBad && (credential || threat || payment || attachLure || (!freemail && parsed.auth_pass !== true));

    var p = profile || {};
    var nameCtx = {
      knownContacts: Object.assign({}, ctx.knownContacts || {}),
      knownContactNames: ctx.knownContactNames || {},
      ownerEmail: ctx.ownerEmail || '',
    };
    (p.prioritySenders || []).forEach(function (e) {
      var k = String(e || '').toLowerCase();
      if (k && !nameCtx.knownContacts[k]) nameCtx.knownContacts[k] = true;
    });
    var impersonated = nameImpersonation_(parsed, display, nameCtx);
    if (impersonated) signals.push('DISPLAY_NAME_IMPERSONATION');

    var replyTo = String(parsed.reply_to_email || '').toLowerCase();
    var replyDomain = Util.emailDomain(replyTo);
    var brands = ((cfg && cfg.privacy) || {}).brandDomains || {};
    var sameBrand = Object.keys(brands).some(function (b) {
      return !!domainMatches_(fromDomain, brands[b] || []) && !!domainMatches_(replyDomain, brands[b] || []);
    });
    var replyDiverges = !!replyTo && replyTo !== fromEmail && !sameBrand &&
      (baseDomain_(replyDomain) !== baseDomain_(fromDomain) || (freemail && !!FREEMAIL[replyDomain]));
    var bankChange = RE_BANK_CHANGE.test(all);
    // Plataformas de cobrança legítimas usam Reply-To do cliente (escola, condomínio): divergência só
    // conta quando a resposta vai para e-mail gratuito, a autenticação não passou ou há troca de dados bancários.
    var replyMismatch = replyDiverges && riskyAsk && (!!FREEMAIL[replyDomain] || parsed.auth_pass !== true || bankChange);
    if (replyMismatch) signals.push('REPLY_TO_MISMATCH');

    // Cargo reivindicado no endereço/nome de exibição, ou no texto de remetente desconhecido sob pressão.
    var selfClaim = RE_EXECUTIVE.test(' ' + Util.normalizeText(fromEmail.split('@')[0].replace(/[._\-+]/g, ' ')) + ' ' + Util.normalizeText(display.raw) + ' ');
    var knownSender = !!(nameCtx.knownContacts[fromEmail]);
    // Associação ou clube com e-mail gratuito cobrando mensalidade não é golpe: exige pressão/sigilo.
    var executive = freemail && !knownSender && (selfClaim || RE_EXECUTIVE.test(all));
    var freemailExec = executive && riskyAsk && pressure;
    if (freemailExec) signals.push('FREEMAIL_EXECUTIVE');
    if (riskyAttachment) signals.push('RISKY_ATTACHMENT');

    var impersonationUntrusted = !!impersonated && (riskyAsk || pressure || replyDiverges);
    var download = RE_DOWNLOAD_LURE.test(all);
    var lure = credential || threat || payment || riskyAttachment || download;
    // Golpe claro (vira spam): marca falsa corroborada com isca; nome imitado com pressão ou Reply-To
    // divergente em pedido de pagamento/dados; Reply-To divergente com troca de dados bancários, pressão,
    // pedido de credenciais ou sem autenticação positiva (plataformas de cobrança legítimas também usam
    // Reply-To de outro domínio: aí a mensagem só fica "não confiável"); "CEO" em e-mail
    // gratuito; autenticação falha com pedido de credenciais, ameaça ou anexo/arquivo de isca. O nome
    // conhecido num endereço novo pedindo um Pix, sem pressão, fica só "não confiável" (verifique antes).
    var phishing = (brandUntrusted && lure) ||
      (!!impersonated && (pressure || replyDiverges) && riskyAsk) ||
      (replyMismatch && (bankChange || pressure || credential || parsed.auth_pass !== true)) || freemailExec ||
      (authFail && (credential || threat || riskyAttachment || download));
    return {
      signals: signals,
      untrusted: authFail || brandUntrusted || impersonationUntrusted || replyMismatch || freemailExec,
      phishing: phishing,
    };
  }

  // ------------------------------------------------------- oportunidade ----
  function buildOpportunity_(parsed, o) {
    if (o.blocked) return null;
    var all = o.all;
    // Newsletter editorial cujo tema não é carreira ("as vagas da semana" num boletim de tecnologia)
    // não traz oportunidade para o dono; curadoria de vagas (principal = carreira) traz.
    if (o.editorialMass && o.primary !== 'carreira') return null;
    var careerish = o.primary === 'carreira' || o.primary === 'networking' || o.secondary.indexOf('carreira') >= 0;
    var jobCue = !!o.job.role || RE_JOB_CUE.test(all);
    var offerCue = RE_OFFER_CUE.test(all);
    var bizCue = o.bizCue;
    var carreira = Config.category('carreira');
    var fromBoard = !!domainMatches_(o.fromDomain, (carreira && carreira.senderDomains) || []) || /jobs|jobalerts|vagas/.test(o.fromEmail) ||
      ((carreira && carreira.senderPatterns) || []).indexOf(o.fromEmail) >= 0;
    var person = !parsed.is_automated && !o.bulk;
    var senderOk = person || fromBoard || o.patternHit || !!parsed.is_discussion_list;
    var type = '';
    if (jobCue && (careerish || offerCue) && (senderOk || careerish)) type = 'job';
    else if (bizCue && (person || o.patternHit)) type = 'business';
    if (!type) return null;
    // Processo encerrado ("seguir com outros candidatos") não é oportunidade aberta.
    if (type === 'job' && RE_REJECTION.test(all)) return null;
    var job = o.job;
    var comp = Extractors.findCompensation(o.bodyRaw);
    var opportunity = {
      type: type,
      title: job.role ? job.role + (job.company ? ' — ' + job.company : '') : Util.truncate(parsed.subject || '', 100),
      company: job.company || '',
      role: job.role || '',
      seniority: job.seniority || '',
      location: job.location || '',
      work_mode: job.workMode || 'unknown',
      compensation: comp ? comp.raw : '',
      requirements: (job.skills || []).slice(0, 10),
      stage: '',
      next_step: o.actionRequired && o.actions[0] ? o.actions[0].description : '',
      deadline: o.deadline ? o.deadline.date : '',
      source: fromBoard ? 'job_board' : o.primary === 'networking' ? 'recruiter' : parsed.is_automated ? 'other' : 'network',
      is_mass: fromBoard || o.bulk,
      evidence: job.role ? job.role : '',
    };
    var fit = opportunityFit(opportunity, o.profile, o.bodyRaw);
    opportunity.fit = fit.fit;
    opportunity.fit_reasons = fit.reasons;
    // Alerta de vagas em massa sem aderência ao perfil não é oportunidade para o dono.
    if (opportunity.is_mass && type === 'job' && fit.fit < MASS_MIN_FIT && (o.bulk || parsed.is_automated)) return null;
    return opportunity;
  }

  /** Prazo mais relevante: DEADLINE (explícito antes) e depois EVENT próximo. VALIDITY nunca. */
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
    var norm = Util.normalizeText;
    for (var i = 0; i < sentences.length; i++) {
      if (norm(sentences[i]).indexOf(norm(phrase)) >= 0) return sentences[i].trim();
    }
    return '';
  }

  function keyFacts_(text, deadlines, refYmd) {
    var facts = [];
    deadlines.filter(function (d) {
      return d.kind === 'DEADLINE' || d.kind === 'EVENT';
    }).slice(0, 2).forEach(function (d) {
      facts.push({ fact: (d.kind === 'EVENT' ? 'Compromisso em ' : 'Prazo: ') + Util.formatBrDate(d.date) + (d.time ? ' às ' + d.time : ''), evidence: Util.truncate(Extractors.redactPii(d.evidence || '').text, 160) });
    });
    Extractors.findMoney(text).slice(0, 2).forEach(function (m) {
      facts.push({ fact: 'Valor mencionado: ' + m.raw, evidence: m.raw });
    });
    return facts.slice(0, 4);
  }

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
    MASS_MIN_FIT: MASS_MIN_FIT,
    classify: classify,
    opportunityFit: opportunityFit,
    opportunityKey: opportunityKey,
    MIN_SCORE: MIN_SCORE,
  };
})();
