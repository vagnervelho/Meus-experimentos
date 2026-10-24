/**
 * Parser de mensagens da Gmail API (`users.messages.get`, format=full) para o
 * registro normalizado `ParsedMessage` (ver docs/CONTRATOS.md): headers com
 * RFC 2047, percurso MIME, charset, HTML→texto, remoção de citações,
 * assinaturas e rodapés, links, anexos (só metadados) e sinais de envio.
 *
 * Tudo aqui é puro e determinístico (sem relógio, sem rede): só usa
 * `Utilities` para base64/blobs e `Util`/`Config` dentro das funções.
 */
var MessageParser = (function () {
  var MAX_LINKS = 15;
  var LINK_TEXT_MAX = 80;
  var MAX_URL_CHARS = 2048;
  var MIN_KEPT_CHARS = 15;
  var SEARCH_TEXT_MAX = 8000;
  var HASH_BODY_CHARS = 5000;
  var FALLBACK_EXCERPT_CHARS = 4000;
  var FALLBACK_MAX_BODY_CHARS = 200000;
  var MAX_HIDDEN_CHARS = 2000;
  var MAX_HIDDEN_RAW = 20000;
  // Marcadores internos de quebra (bloco e parágrafo) usados no HTML→texto.
  var BLOCK = '\u0001';
  var PARA = '\u0002';

  var VOID_TAGS = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };

  var ENTITIES = {
    nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
    atilde: 'ã', otilde: 'õ', Atilde: 'Ã', Otilde: 'Õ', ccedil: 'ç', Ccedil: 'Ç',
    acirc: 'â', ecirc: 'ê', ocirc: 'ô', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô',
    agrave: 'à', Agrave: 'À', uuml: 'ü', Uuml: 'Ü', ntilde: 'ñ', Ntilde: 'Ñ',
    mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
    laquo: '«', raquo: '»', middot: '·', ordm: 'º', ordf: 'ª', deg: '°',
    bull: '•', copy: '©', reg: '®', trade: '™', euro: '€',
    zwnj: '\u200c', zwj: '\u200d', shy: '\u00ad',
  };
  // &#128;–&#159; seguem o Windows-1252, como nos navegadores.
  var CP1252 = {
    128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹', 140: 'Œ',
    142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›',
    156: 'œ', 158: 'ž', 159: 'Ÿ',
  };
  var INVISIBLE_RE = /[\u200b-\u200f\u2060-\u2064\ufeff\u034f\u00ad\u180e]/g;

  // ------------------------------------------------- padrões de limpeza ----
  var FORWARD_LINE_RE = /^\s*(?:-{2,}\s*(?:forwarded message|mensagem encaminhada|mensaje reenviado)\s*-{2,}|(?:begin forwarded message|in[ií]cio da mensagem encaminhada)\s*:)\s*$/i;
  var ORIGINAL_MSG_RE = /^\s*-{2,}\s*(?:original message|mensagem original|mensaje original)\s*-{2,}\s*$/i;
  var ATTRIBUTION_START_RE = /^\s*(?:em|on|el)\s+\S/i;
  var ATTRIBUTION_END_RE = /(?:escreveu|wrote|escribi[oó])\s*:\s*$/i;
  var OUTLOOK_FROM_RE = /^\s*\*?\s*(?:de|from)\s*:\s*\*?\s*\S/i;
  var OUTLOOK_SENT_RE = /^\s*\*?\s*(?:enviad[oa](?: em)?|sent|data|date)\s*:/i;
  var OUTLOOK_TO_RE = /^\s*\*?\s*(?:para|to)\s*:/i;
  var OUTLOOK_SUBJECT_RE = /^\s*\*?\s*(?:assunto|subject)\s*:/i;
  var SEPARATOR_LINE_RE = /^\s*[_\-=*~]{5,}\s*$/;
  var MOBILE_SIG_RE = /^\s*(?:enviad[oa] (?:do|de|pelo|via|a partir do) (?:meu |minha )?\S|sent (?:from|via) (?:my )?\S|get outlook for \S|obter o outlook para \S|baixe o outlook para \S)/i;
  // Avisos legais: termos fortes bastam; fracos precisam de dois indícios.
  var DISCLAIMER_STRONG_RE = /aviso legal|\blgpd\b|esta mensagem pode conter|esta mensagem e (?:seus|quaisquer) anexos|this e-?mail and any (?:files|attachments)|confidentiality notice|disclaimer|intended recipient|recebeu (?:esta|essa) (?:mensagem|e-?mail) por engano|received this (?:e-?mail|message) in error/;
  var DISCLAIMER_WEAK_RE = /confidencia|confidential|privileged|privilegiad|destinatario|addressee/g;
  // Aplicados sobre a linha em minúsculas e sem acentos.
  var FOOTER_RE = /cancelar (?:a |sua )?inscricao|cancele (?:a |sua )?inscricao|descadastr|unsubscribe|manage (?:your )?(?:e-?mail )?(?:preferences|subscription)|gerenciar (?:suas )?(?:preferencias|inscric)|voce esta recebendo (?:este|esse) e-?mail|voce recebeu (?:este|esse) e-?mail|you'?re receiving this|you are receiving this|this e-?mail was sent to|este e-?mail foi enviado para|all rights reserved|todos os direitos reservados|deixar de receber|nao (?:deseja|quer) mais receber/;
  var COPYRIGHT_RE = /^\s*(?:©|\(c\)|copyright\b)/i;
  var HTML_PLACEHOLDER_RE = /versao (?:em )?html|html version|versao web|view (?:this|the) (?:e-?mail|message|newsletter) (?:in|on) (?:your |a )?(?:web )?browser|visualiz\S* (?:no|em seu|no seu) navegador|nao (?:suporta|exibe|aceita) (?:mensagens? )?(?:em )?html|requires html|html-?only|abra (?:este|esse) e-?mail (?:em|no) (?:um |seu )?navegador/;

  // ------------------------------------------------- sinais de remetente ----
  // Parte local inteira que, sozinha, denuncia máquina (lista histórica).
  var AUTOMATED_LOCAL_RE = /^(?:no[-_.]?reply|nao[-_.]?responda|naoresponda|do[-_.]?not[-_.]?reply|donotreply|notifications?|notificacao|notificacoes|alerts?|alertas?|mailer[-_.]?daemon|postmaster|bounces?|news|newsletters?|info|marketing|promo|ofertas)$/;
  // Caixas de papel genéricas: automáticas, salvo quando o nome de exibição é de uma pessoa.
  var SOFT_ROLE_LOCAL_RE = /^(?:contato|support|suporte|hello|team|equipe)$/;
  // Trechos de sistema em qualquer posição da parte local compactada (sem separadores nem dígitos).
  // "fatura" sem "faturamento" (setor de pessoas: "Joana - Faturamento").
  var MACHINE_SUBSTR_RE = /noreply|donotreply|naorespond|mailerdaemon|postmaster|notific|newsletter|alert|fatura(?!mento)|comprovante|extrato|boleto|billing|invoice|receipt/;
  // Só estes valem em domínios de e-mail gratuito (lá, "info.loja@" ou "financeiro.condominio@" costumam ser pessoas).
  var FREEMAIL_MACHINE_RE = /noreply|donotreply|naorespond|mailerdaemon|postmaster/;
  // Palavras (trechos separados por . _ - + ou dígitos) da parte local que indicam sistema/transação.
  var MACHINE_TOKENS = toSet_(
    'news noticias info informativo informativos mailer bounce bounces daemon automated automatico automatica auto robot robo bot ' +
    'system sistema notify notifier notifica aviso avisos comunicados digest update updates nfe nfse notafiscal recibo recibos ' +
    'statement statements cobranca cobrancas seguranca security resultado resultados laudo laudos exames invitations invites ' +
    'convite convites rastreamento tracking confirmacao confirmation confirmar confirm verificacao verification verify otp ' +
    'oferta ofertas promo promocao promocoes promocional marketing mkt campanha campanhas jira confluence jenkins gitlab github ' +
    'bitbucket dependabot sentry'
  );
  // Caixas de papel/departamento normalmente atendidas por gente (em pequenos negócios, a recepção ou o
  // agendamento respondem): nunca viram "automático" só pela marca no nome de exibição.
  var HUMAN_ROLE_TOKENS = toSet_(
    'contato atendimento comercial vendas financeiro finance rh hr recrutamento recruiting recruiter talentos talent careers ' +
    'carreiras selecao people pessoas secretaria coordenacao diretoria direcao administracao juridico legal sindico sindica ' +
    'gerencia ouvidoria sac relacionamento parcerias partners partnerships imprensa press contabilidade contabil compras ' +
    'suporte support helpdesk help ajuda recepcao reception agendamento agendamentos marcacao reservas consultorio escritorio office ' +
    'cliente clientes customer customers ' +
    'sucesso success hello team equipe'
  );
  // Palavras de organização/serviço: um nome de exibição que as contém não é nome de pessoa.
  var ORG_WORDS = toSet_(
    'banco bank cartoes cartao card cards seguros seguro seguradora saude medicina clinica hospital laboratorio lab labs farmacia ' +
    'companhia aerea aereo drogaria odonto odontologia investimentos investments invest capital asset research corretora financeira financeiro pagamentos ' +
    'payments pay airlines airline linhas aereas viagens travel turismo hotel hoteis energia distribuicao telecom telefonia internet ' +
    'fibra prefeitura governo gov federal estadual municipal receita tribunal justica eleitoral detran ministerio secretaria correios ' +
    'policia universidade faculdade escola colegio instituto academia academy curso cursos educacao comunicacao comunicados interna ' +
    'equipe time team suporte support atendimento servicos servico services service sistema system portal conta contas account ' +
    'accounts notificacoes notificacao notifications alertas alerts alert noticias news newsletter digest daily weekly semanal diario ' +
    'mensal boletim jornal revista editora magazine loja lojas store shop shopping market mercado supermercado clube club oficial ' +
    'official brasil group grupo comunidade community associacao sindicato condominio edificio residencial ltda inc llc ltd corp ' +
    'company cia eireli holding tecnologia technologies tech software digital online app apps cloud data dados analytics solutions ' +
    'solucoes consultoria consulting advocacia advogados associados contabilidade contabil imobiliaria imoveis administradora ' +
    'administracao vendas marketing ofertas promocoes promocao pesquisa survey clima rh recursos humanos people talentos talent ' +
    'carreiras careers jobs vagas recrutamento billing receipts recibos faturas fatura cobranca juridica juridico oportunidade ' +
    'oportunidades premios premiada sorteio hub global international internacional bemestar bem-estar plano planos fundacao foundation ' +
    'centro center studio estudio agencia agency media midia network networks entregas delivery express logistica transportes the'
  );
  var NAME_CONNECTORS = toSet_('de da do das dos e del della di du van von der den la le y');
  var HONORIFICS = toSet_('dr dra sr sra srta prof profa eng mr mrs ms');
  // Domínios de e-mail gratuito: remetentes são pessoas (ou golpistas), nunca "marca".
  var FREEMAIL_DOMAINS = toSet_(
    'gmail.com googlemail.com hotmail.com hotmail.com.br outlook.com outlook.com.br live.com live.com.br msn.com yahoo.com ' +
    'yahoo.com.br ymail.com icloud.com me.com mac.com aol.com uol.com.br bol.com.br terra.com.br ig.com.br globo.com globomail.com ' +
    'r7.com zipmail.com.br protonmail.com proton.me pm.me gmx.com gmx.net zoho.com yandex.com mail.com tutanota.com'
  );
  // Rótulos de domínio que não identificam a marca (TLDs e subdomínios de envio).
  var GENERIC_LABELS = toSet_(
    'com net org gov jus edu mil co io ai app dev tech info biz news online site store top xyz me tv br us uk pt de fr es it ar mx ' +
    'cl eu ca au in jp www mail mails email emails e em m mg mkt send sg bounce bounces account accounts notifications notificacoes ' +
    'alerts alertas noreply mailer msg messages reply'
  );
  var DEFAULT_DISCUSSION_LIST_DOMAINS = ['googlegroups.com', 'groups.io', 'freelists.org', 'yahoogroups.com'];
  var ESP_RE = /sendgrid\.net|mailchimp|mcsv\.net|amazonses\.com|sparkpostmail|mandrillapp|rsgsv\.net|exacttarget|hubspot|rdstation|mailgun/i;
  // Cabeçalhos próprios de plataformas de envio (ESP) e de sistemas que pedem para não gerar autorresposta.
  var ESP_HEADER_RE = /^(?:x-sg-|x-mailgun-|x-ses-|x-mc-|x-mailchimp|x-mandrill-|x-msfbl|x-sfmc-|x-csa-complaints|x-report-abuse|x-campaign|x-auto-response-suppress$|feedback-id$)/;
  var REPLY_SUBJECT_RE = /^\s*(?:re|res)(?:\[\d+\])?\s*:/i;
  var SUBJECT_PREFIX_RE = /^\s*(re|res|fwd?|enc|encaminhad[ao])(?:\[\d+\])?\s*:\s*/i;
  var GMAIL_CATEGORIES = { PERSONAL: 1, SOCIAL: 1, PROMOTIONS: 1, UPDATES: 1, FORUMS: 1 };

  // ------------------------------------------------------------ links ----
  var TRACKING_PARAMS = { mc_cid: 1, mc_eid: 1, fbclid: 1, gclid: 1, dclid: 1, yclid: 1, _hsenc: 1, _hsmi: 1, mkt_tok: 1 };
  var UNSUB_URL_RE = /unsubscribe|unsub[\/?=&._-]|descadastr|opt-?out|opt_out|cancelar[-_]?inscricao|remove-?me/;
  var PREFS_URL_RE = /preferenc(?:es|ias|e-center)|\/prefs?(?:[\/?#]|$)|manage-?subscription/;
  var UNSUB_TEXT_RE = /descadastr|cancelar (?:a |sua )?inscricao|cancele (?:a |sua )?inscricao|unsubscribe|opt[ -]?out|sair da lista|remover (?:meu e-?mail|da lista)|nao quero (?:mais )?receber/;
  var PREFS_TEXT_RE = /preferenc(?:es|ias)|gerenciar (?:assinatura|inscric)|manage subscription/;
  var GENERIC_LINK_TEXT = {
    'clique aqui': 1, 'click here': 1, 'saiba mais': 1, 'leia mais': 1, 'ver mais': 1, 'aqui': 1, 'here': 1, 'link': 1,
    'learn more': 1, 'read more': 1, 'more': 1, 'mais': 1, 'acesse': 1, 'acessar': 1, 'clique': 1, 'click': 1,
    'ver no navegador': 1, 'view in browser': 1, 'visualizar no navegador': 1, 'abrir no navegador': 1, 'view online': 1,
  };

  // ============================================================ parse ====

  /**
   * Converte uma mensagem da Gmail API (format=full, REST ou serviço avançado)
   * em `ParsedMessage`. Nunca lança por conteúdo malformado.
   * Campos só de memória (nunca persistir): `body_text` e `hidden_text` (texto dos
   * elementos HTML ocultos, para a detecção de injection).
   * @param {Object} apiMessage
   * @param {{ownerEmail?: string, excerptChars?: number, maxDecodedBodyChars?: number, discussionListDomains?: string[]}} ctx
   *   `discussionListDomains` cai para `Config.DEFAULTS.privacy.discussionListDomains`.
   */
  function parse(apiMessage, ctx) {
    var msg = apiMessage || {};
    var c = normalizeCtx_(ctx);
    var payload = msg.payload || {};
    var hdr = headerIndex_(payload.headers);

    var labels = Array.isArray(msg.labelIds) ? msg.labelIds.map(String) : [];
    var has = {};
    labels.forEach(function (l) { has[l] = true; });

    var subject = collapseLine_(decodeMimeWords_(header_(hdr, 'subject')));
    var from = parseAddressList(header_(hdr, 'from'))[0] || { name: '', email: '' };
    var replyTo = parseAddressList(headers_(hdr, 'reply-to').join(', '))[0];
    var to = emailsOf_(headers_(hdr, 'to').join(', '));
    var cc = emailsOf_(headers_(hdr, 'cc').join(', '));
    var owner = canonicalMailbox_(c.ownerEmail);
    // Só o label SENT prova o envio pelo dono: um From forjado com o endereço dele chega como INBOUND
    // (senão viraria "contato conhecido" e ensinaria o nome do dono a quem forjou).
    var isOutbound = !!has.SENT;

    // ---- corpo
    var mime = collectParts_(payload);
    var plain = mime.plain ? normalizePlain_(decodeBody(mime.plain.data, mime.plain.charset, c.maxDecodedBodyChars)) : '';
    var htmlRaw = mime.html ? decodeBody(mime.html.data, mime.html.charset, c.maxDecodedBodyChars) : '';
    var conv = htmlRaw ? convertHtml_(htmlRaw, false, true) : { text: '', links: [], hidden: '' };
    var fromHtml = !!htmlRaw && isHtmlPlaceholder_(plain);
    var full = fromHtml && conv.text ? conv.text : plain;

    var forwardedSubject = isForwardSubject_(subject);
    var isForwarded = forwardedSubject || hasForwardMarker_(full);
    var q = forwardedSubject ? { text: full, removed: false } : stripQuotes(full);
    var sig = stripSignature(q.text);
    var foot = stripFooter(sig.text);
    var body = foot.text.length > c.maxDecodedBodyChars ? foot.text.slice(0, c.maxDecodedBodyChars) : foot.text;

    // ---- links (âncoras citadas saem quando a citação foi removida)
    var anchors = q.removed && htmlRaw ? convertHtml_(htmlRaw, true).links : conv.links;
    var lk = collectLinks_(anchors, body);
    var listUnsub = header_(hdr, 'list-unsubscribe');
    // Em texto puro, o link de descadastro mora no rodapé que acabou de ser removido.
    var footerUnsub = foot.removed && !lk.unsubscribe ? collectLinks_([], sig.text).unsubscribe : '';
    var unsubscribeUrl = listUnsubscribeUrl_(listUnsub) || lk.unsubscribe || footerUnsub;

    // ---- sinais de envio
    var precedence = header_(hdr, 'precedence');
    var precedenceBulk = /^\s*(?:bulk|list|junk)\b/i.test(precedence);
    var listId = listIdOf_(header_(hdr, 'list-id'));
    var hasListUnsub = !!listUnsub.trim();
    var auth = authResults_(headers_(hdr, 'authentication-results'));
    var autoSubmitted = header_(hdr, 'auto-submitted').trim().toLowerCase();
    var sender = senderProfile_(from, hdr);
    var isDiscussion = isDiscussionList_(hdr, from, sender, listId, c.discussionListDomains);
    var isAutomated = isAutomated_(sender, hdr, {
      autoSubmitted: autoSubmitted,
      isOutbound: isOutbound,
      isDiscussion: isDiscussion,
      massHeaders: hasListUnsub || !!listId || precedenceBulk || isEspOrCampaign_(hdr, from.email) || hasEspHeaders_(hdr),
    });

    var excerpt = c.excerptChars > 0 ? Util.truncate(body, c.excerptChars) : '';
    var snippet = cleanInline_(msg.snippet);
    var internal = timestampOf_(msg.internalDate, header_(hdr, 'date'));
    var category = '';
    labels.forEach(function (l) {
      var m = /^CATEGORY_([A-Z]+)$/.exec(l);
      if (!category && m && GMAIL_CATEGORIES[m[1]]) category = m[1];
    });

    return {
      message_id: String(msg.id == null ? '' : msg.id),
      thread_id: String(msg.threadId == null ? '' : msg.threadId),
      rfc822_message_id: header_(hdr, 'message-id').trim().replace(/^<|>$/g, '').trim(),
      history_id: msg.historyId == null ? '' : String(msg.historyId),
      internal_ts: internal.iso,
      received_date: internal.ymd,
      direction: isOutbound ? 'OUTBOUND' : 'INBOUND',
      from_email: from.email,
      from_name: from.name,
      from_domain: Util.emailDomain(from.email),
      reply_to_email: replyTo ? replyTo.email : '',
      to_emails: to,
      cc_emails: cc,
      recipient_count: to.length + cc.length,
      user_in_to: containsMailbox_(to, owner),
      user_in_cc: containsMailbox_(cc, owner),
      subject: subject,
      snippet: snippet,
      body_text: body,
      body_excerpt: excerpt,
      body_chars: body.length,
      body_truncated: body.length > c.excerptChars,
      has_html: mime.hasHtml,
      quoted_removed: q.removed,
      signature_removed: sig.removed,
      footer_removed: foot.removed,
      is_forwarded: isForwarded,
      is_reply: !!(header_(hdr, 'in-reply-to').trim() || header_(hdr, 'references').trim()) || REPLY_SUBJECT_RE.test(subject),
      links: lk.links,
      unsubscribe_url: unsubscribeUrl,
      has_list_unsubscribe: hasListUnsub,
      list_id: listId,
      precedence_bulk: precedenceBulk,
      is_bulk: hasListUnsub || !!listId || precedenceBulk || isEspOrCampaign_(hdr, from.email),
      is_automated: isAutomated,
      is_discussion_list: isDiscussion,
      hidden_text: conv.hidden || '',
      // Texto visível do HTML quando o corpo usado veio da parte text/plain (só em memória):
      // a checagem de injection olha também a versão que o leitor de fato vê.
      html_text: !fromHtml && conv.text ? Util.truncate(conv.text, 4000) : '',
      auth_pass: auth.pass,
      auth_fail: auth.fail,
      attachments: mime.attachments,
      attachment_count: mime.attachments.length,
      label_ids: labels,
      gmail_category: category,
      is_unread: !!has.UNREAD,
      is_starred: !!has.STARRED,
      is_important: !!has.IMPORTANT,
      in_inbox: !!has.INBOX,
      is_trash: !!has.TRASH,
      is_spam: !!has.SPAM,
      is_sent: !!has.SENT,
      content_hash: Util.shortHash(Util.normalizeText(subject + ' ' + body.slice(0, HASH_BODY_CHARS)), 16),
      search_text: Util.normalizeText([subject, from.name, from.email, snippet, excerpt].join(' ')).slice(0, SEARCH_TEXT_MAX),
      size_estimate: Number(msg.sizeEstimate) || 0,
      parser_version: Config.PARSER_VERSION,
    };
  }

  function normalizeCtx_(ctx) {
    var c = ctx || {};
    var d = typeof Config !== 'undefined' && Config.DEFAULTS ? Config.DEFAULTS : null;
    var excerpt = typeof c.excerptChars === 'number' && c.excerptChars >= 0 ? Math.floor(c.excerptChars)
      : d ? d.storage.excerptChars : FALLBACK_EXCERPT_CHARS;
    var maxBody = typeof c.maxDecodedBodyChars === 'number' && c.maxDecodedBodyChars > 0 ? Math.floor(c.maxDecodedBodyChars)
      : d ? d.gmail.maxDecodedBodyChars : FALLBACK_MAX_BODY_CHARS;
    var lists = Array.isArray(c.discussionListDomains) ? c.discussionListDomains
      : d && d.privacy && Array.isArray(d.privacy.discussionListDomains) ? d.privacy.discussionListDomains : DEFAULT_DISCUSSION_LIST_DOMAINS;
    return {
      ownerEmail: String(c.ownerEmail || '').trim().toLowerCase(),
      excerptChars: excerpt,
      maxDecodedBodyChars: maxBody,
      discussionListDomains: lists.map(function (x) { return String(x || '').trim().toLowerCase(); }).filter(Boolean),
    };
  }

  /** internalDate (ms) → {iso, ymd}; sem ele, cai para o header Date. */
  function timestampOf_(internalDate, dateHeader) {
    var ms = Number(internalDate);
    if (internalDate === undefined || internalDate === null || internalDate === '' || isNaN(ms)) ms = Date.parse(String(dateHeader || ''));
    if (isNaN(ms)) return { iso: '', ymd: '' };
    return { iso: Util.toIso(ms) || '', ymd: Util.ymd(ms) };
  }

  // ========================================================== headers ====

  function headerIndex_(headers) {
    /** @type {Object<string, string[]>} */
    var idx = {};
    (Array.isArray(headers) ? headers : []).forEach(function (h) {
      if (!h || h.name == null) return;
      var k = String(h.name).trim().toLowerCase();
      if (!idx[k]) idx[k] = [];
      idx[k].push(String(h.value == null ? '' : h.value));
    });
    return idx;
  }
  function header_(idx, name) {
    var v = idx[name];
    return v && v.length ? v[0] : '';
  }
  function headers_(idx, name) {
    return idx[name] || [];
  }

  /** Decodifica encoded-words RFC 2047 (=?charset?B|Q?...?=); o resto fica intacto. */
  function decodeMimeWords_(s) {
    var str = String(s == null ? '' : s);
    if (str.indexOf('=?') < 0) return str;
    str = str.replace(/(\?=)\s+(?==\?)/g, '$1');
    return str.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, function (m, cs, enc, txt) {
      try {
        var bytes = enc.toUpperCase() === 'B' ? Utilities.base64Decode(padBase64_(txt.replace(/\s+/g, ''))) : qBytes_(txt);
        return bytesToString_(bytes, cs.split('*')[0]);
      } catch (e) {
        return m;
      }
    });
  }
  function qBytes_(txt) {
    var out = [];
    for (var i = 0; i < txt.length; i++) {
      var ch = txt.charAt(i);
      var hex = txt.slice(i + 1, i + 3);
      if (ch === '_') out.push(32);
      else if (ch === '=' && /^[0-9a-fA-F]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
      } else out.push(txt.charCodeAt(i) & 0xff);
    }
    return out.map(toSignedByte_);
  }

  /**
   * Lista de endereços RFC 5322 → [{name, email}] (e-mail em minúsculas).
   * Respeita vírgulas dentro de aspas, `<...>` e comentários; ignora grupos vazios.
   * @param {string} header
   */
  function parseAddressList(header) {
    var s = String(header == null ? '' : header);
    var pieces = [];
    var cur = '';
    var inQuote = false, angle = 0, paren = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inQuote) {
        cur += ch;
        if (ch === '\\' && i + 1 < s.length) cur += s.charAt(++i);
        else if (ch === '"') inQuote = false;
        continue;
      }
      if (ch === '"') inQuote = true;
      else if (ch === '<') angle++;
      else if (ch === '>' && angle > 0) angle--;
      else if (ch === '(') paren++;
      else if (ch === ')' && paren > 0) paren--;
      else if ((ch === ',' || ch === ';') && !angle && !paren) {
        pieces.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    pieces.push(cur);
    var out = [];
    pieces.forEach(function (p) {
      var a = parseAddress_(p);
      if (a) out.push(a);
    });
    return out;
  }
  function parseAddress_(piece) {
    var p = String(piece).trim();
    // Sintaxe de grupo ("Equipe: a@x, b@y;"): descarta o rótulo.
    p = p.replace(/^[^"<@(]*:\s*/, '').trim();
    if (!p) return null;
    var email = '', name = '';
    var lt = p.lastIndexOf('<');
    var gt = p.indexOf('>', lt);
    if (lt >= 0 && gt > lt) {
      email = p.slice(lt + 1, gt);
      name = (p.slice(0, lt) + ' ' + p.slice(gt + 1)).trim();
    } else {
      var m = /[^\s<>"(),;:]+@[^\s<>"(),;:]+/.exec(p);
      if (!m) return null;
      email = m[0];
      name = (p.slice(0, m.index) + ' ' + p.slice(m.index + m[0].length)).trim();
    }
    email = email.replace(/^mailto:/i, '').trim().toLowerCase().replace(/\.+$/, '');
    if (!/^[^\s@<>"]+@[^\s@<>"]+$/.test(email)) return null;
    var comment = /\(([^)]*)\)/.exec(name);
    name = name.replace(/\([^)]*\)/g, ' ').trim();
    if (!name && comment) name = comment[1].trim();
    name = name.replace(/^"([\s\S]*)"$/, '$1').replace(/\\(.)/g, '$1').replace(/^'([\s\S]*)'$/, '$1');
    name = collapseLine_(decodeMimeWords_(name));
    return { name: name, email: email };
  }
  function emailsOf_(header) {
    return Util.uniq(parseAddressList(header).map(function (a) { return a.email; }));
  }
  /** Caixa canônica para comparar com o dono: sem +tag; no Gmail, sem pontos. */
  function canonicalMailbox_(email) {
    var e = String(email || '').trim().toLowerCase();
    var at = e.lastIndexOf('@');
    if (at <= 0) return e;
    var local = e.slice(0, at).split('+')[0];
    var domain = e.slice(at + 1);
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      local = local.replace(/\./g, '');
      domain = 'gmail.com';
    }
    return local + '@' + domain;
  }
  function containsMailbox_(emails, ownerCanonical) {
    if (!ownerCanonical) return false;
    for (var i = 0; i < emails.length; i++) if (canonicalMailbox_(emails[i]) === ownerCanonical) return true;
    return false;
  }

  function listUnsubscribeUrl_(value) {
    var v = String(value || '');
    if (!v.trim()) return '';
    var items = [];
    var re = /<([^>]*)>/g, m;
    while ((m = re.exec(v))) items.push(m[1].replace(/\s+/g, ''));
    if (!items.length) items = v.split(',').map(function (x) { return x.replace(/\s+/g, ''); });
    var https = '', http = '';
    items.forEach(function (u) {
      if (!https && /^https:\/\//i.test(u)) https = u;
      else if (!http && /^http:\/\//i.test(u)) http = u;
    });
    return https || http;
  }
  function listIdOf_(value) {
    var v = String(value || '').trim();
    if (!v) return '';
    var m = /<([^>]+)>/.exec(v);
    return (m ? m[1] : v).trim().toLowerCase();
  }
  /** Authentication-Results (pode haver vários) → {pass, fail}; null se ausente. */
  function authResults_(values) {
    if (!values.length) return { pass: null, fail: null };
    var all = values.join(';').toLowerCase();
    var res = { dkim: {}, spf: {}, dmarc: {} };
    var re = /\b(dkim|spf|dmarc)\s*=\s*([a-z]+)/g, m;
    while ((m = re.exec(all))) res[m[1]][m[2]] = true;
    var dkimPass = !!res.dkim.pass;
    var dmarcFail = !!res.dmarc.fail;
    return {
      pass: dkimPass || (!!res.spf.pass && !dmarcFail),
      fail: dmarcFail || (!!res.spf.fail && !dkimPass),
    };
  }
  function isEspOrCampaign_(hdr, fromEmail) {
    var keys = Object.keys(hdr);
    for (var i = 0; i < keys.length; i++) if (keys[i] === 'feedback-id' || keys[i].indexOf('x-campaign') === 0) return true;
    var dkim = headers_(hdr, 'dkim-signature').map(function (v) {
      var m = /\bd=([^;\s]+)/i.exec(v);
      return m ? m[1] : '';
    });
    var hay = [fromEmail, header_(hdr, 'sender'), header_(hdr, 'return-path'), header_(hdr, 'message-id'), header_(hdr, 'x-mailer')]
      .concat(dkim).join(' ');
    return ESP_RE.test(hay);
  }
  function hasEspHeaders_(hdr) {
    var keys = Object.keys(hdr);
    for (var i = 0; i < keys.length; i++) if (ESP_HEADER_RE.test(keys[i])) return true;
    return false;
  }

  /**
   * Perfil do remetente para as heurísticas de automação e de lista:
   * parte local (sem +tag, sem acentos), palavras dela, nome de exibição
   * analisado e rótulos de marca do domínio.
   */
  function senderProfile_(from, hdr) {
    var email = String(from.email || '');
    var at = email.lastIndexOf('@');
    var local = at > 0 ? Util.stripDiacritics(email.slice(0, at).toLowerCase()).split('+')[0] : '';
    var domain = at > 0 ? email.slice(at + 1).toLowerCase() : '';
    var tokens = local.split(/[._\-]+|\d+/).filter(function (t) { return !!t; });
    var compact = local.replace(/[^a-z]/g, '');
    var freemail = !!FREEMAIL_DOMAINS[domain];
    var display = displayInfo_(from.name, domain, freemail);
    var machine = freemail ? FREEMAIL_MACHINE_RE.test(compact)
      : AUTOMATED_LOCAL_RE.test(local) || /no-?reply|no_reply/.test(local) || MACHINE_SUBSTR_RE.test(compact) || tokens.some(function (t) { return !!MACHINE_TOKENS[t]; });
    return {
      email: email,
      local: local,
      domain: domain,
      tokens: tokens,
      compact: compact,
      freemail: freemail,
      display: display,
      machine: !!local && machine,
      softRole: SOFT_ROLE_LOCAL_RE.test(local),
      humanRole: tokens.some(function (t) { return !!HUMAN_ROLE_TOKENS[t]; }),
      senderHeader: (parseAddressList(header_(hdr, 'sender'))[0] || { email: '' }).email,
    };
  }

  /**
   * Analisa o nome de exibição. `person`: 2–5 palavras com cara de nome próprio
   * (maiúscula inicial, sem dígitos/pontuação, sem siglas curtas nem palavras de
   * organização), depois de tirar "(…)", " via …" e " — Empresa". `relay`: formato
   * "Fulano via Plataforma"/"Fulano (Plataforma)". `brand`: o nome contém a marca
   * do domínio (ou vice-versa).
   */
  function displayInfo_(name, domain, freemail) {
    var raw = String(name || '').trim();
    // Nome de exibição que é só um endereço ("maria@empresa.com") não diz nada (e não é marca).
    if (raw.indexOf('@') >= 0) raw = '';
    var relay = /\s+via\s+\S/i.test(raw) || /\S\s*\([^)]+\)\s*$/.test(raw);
    var base = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+via\s+[\s\S]*$/i, ' ').replace(/\s[|–—-]\s[\s\S]*$/, ' ').replace(/,/g, ' ');
    var words = Util.stripDiacritics(base).trim().split(/\s+/).filter(function (w) { return !!w; });
    var person = words.length >= 2 && words.length <= 7;
    var nameWords = 0;
    var tokens = [];
    words.forEach(function (w) {
      var lw = w.toLowerCase();
      if (HONORIFICS[lw.replace(/\.$/, '')]) return;
      if (NAME_CONNECTORS[lw] && w === lw) return;
      var key = lw.replace(/[^a-z]/g, '');
      if (!/^[A-Za-z][A-Za-z'’-]*$/.test(w)) person = false;
      else if (w === w.toUpperCase() && w.length <= 4) person = false; // sigla ("XP", "TLDR", "IA")
      else if (w.charAt(0) !== w.charAt(0).toUpperCase()) person = false;
      else if (/[a-z][A-Z]/.test(w)) person = false; // CamelCase de marca ("LinkedIn"); "D'Ávila" passa
      if (ORG_WORDS[lw] || ORG_WORDS[key]) person = false;
      else if (key.length >= 3) tokens.push(key);
      nameWords++;
    });
    var compact = Util.stripDiacritics(base).toLowerCase().replace(/[^a-z0-9]/g, '');
    var labels = freemail ? [] : brandLabels_(domain);
    var brand = compact.length >= 3 && labels.some(function (l) { return compact.indexOf(l) >= 0 || l.indexOf(compact) >= 0; });
    var shape = person && nameWords >= 2 && nameWords <= 5;
    // "Joana - Faturamento": um prenome antes do setor também é pessoa.
    var dashedFirstName = /\s[|–—-]\s/.test(raw) && words.length === 1 && /^[A-Z][a-z]{2,}$/.test(words[0]) &&
      !ORG_WORDS[words[0].toLowerCase()] && labels.indexOf(words[0].toLowerCase()) < 0;
    if (dashedFirstName) {
      person = true;
      shape = true;
    }
    // "Marina Costa Consultoria": as palavras de nome ANTES da primeira palavra de organização.
    var lead = [];
    for (var li = 0; li < words.length; li++) {
      var lwLead = words[li].toLowerCase();
      if (ORG_WORDS[lwLead] || ORG_WORDS[lwLead.replace(/[^a-z]/g, '')]) break;
      if (/^[A-Z][a-z]{2,}$/.test(words[li])) lead.push(lwLead);
      else break;
    }
    // Palavra que é (parte da) marca do domínio não é prenome ("Exemplo Airlines" <exemploair@…>).
    lead = lead.filter(function (t) { return !labels.some(function (l) { return l.indexOf(t) >= 0; }); });
    // Palavras que podem ser nome próprio (as de um nome com forma de pessoa, ou a única
    // palavra, como "Ana"), menos a que é exatamente a marca do domínio ("Nubank").
    var nameTokens = shape || nameWords === 1 ? tokens.filter(function (t) { return labels.indexOf(t) < 0; }) : [];
    // "Mercado Livre" <…@mercadolivre…>: palavras capitalizadas que são exatamente a marca não são pessoa
    // (mas "João Silva" <joao@joaosilva…> continua pessoa pela parte local).
    return { raw: raw, person: shape && labels.indexOf(compact) < 0, relay: relay, brand: brand, tokens: nameTokens, lead: lead.length >= 1 && lead.length < words.length ? lead : [] };
  }

  /** Rótulos do domínio que podem ser a marca: sem TLDs/subdomínios de envio; partes com hífen ≥ 4 letras. */
  function brandLabels_(domain) {
    var out = [];
    String(domain || '').toLowerCase().split('.').forEach(function (label) {
      if (!label || GENERIC_LABELS[label]) return;
      var whole = label.replace(/[^a-z0-9]/g, '');
      if (whole.length >= 3 && out.indexOf(whole) < 0) out.push(whole);
      label.split('-').forEach(function (p) {
        if (p.length >= 4 && !GENERIC_LABELS[p] && out.indexOf(p) < 0) out.push(p);
      });
    });
    return out;
  }

  /**
   * Parte local com cara de nome de pessoa: casa com uma palavra de nome próprio
   * (≥ 3 letras) do nome de exibição, ou tem forma "nome.sobrenome" (≥ 2 palavras
   * alfabéticas, nenhuma de sistema ou de papel).
   */
  function localLooksPersonal_(s) {
    if (!s.local || s.machine || s.humanRole || s.softRole) return false;
    var letters = s.compact;
    for (var i = 0; i < s.display.tokens.length; i++) if (letters.indexOf(s.display.tokens[i]) >= 0) return true;
    // Parte local igual ao prenome que abre o nome de exibição ("Marina Costa Consultoria" <marina@…>).
    var lead = s.display.lead || [];
    for (var j = 0; j < lead.length; j++) if (letters === lead[j] || letters.indexOf(lead[j]) === 0) return true;
    var alpha = s.tokens.filter(function (t) { return /^[a-z]+$/.test(t); });
    if (alpha.length >= 2 && alpha.length === s.tokens.length) {
      var long = alpha.filter(function (t) { return t.length >= 2; });
      return long.length >= 2 || (alpha.length === 2 && Math.max(alpha[0].length, alpha[1].length) >= 3);
    }
    return false;
  }

  /**
   * Remetente automático (sistema, marca, plataforma) × pessoa. Em ordem:
   * 1. Auto-Submitted ≠ no (vale até para OUTBOUND) e autorrespostas;
   * 2. OUTBOUND nunca (o dono é pessoa);
   * 3. lista de discussão com remetente que não é sistema → pessoa;
   * 4. parte local de sistema (noreply, notificacoes, fatura, comprovante, extrato, nfe, seguranca, resultados, jira…);
   * 5. caixas de papel genéricas (contato, suporte, team…) → automáticas, salvo nome de pessoa;
   * 6. e-mail gratuito → pessoa;
   * 7. nome de pessoa (inclusive "Fulano via Plataforma") ou parte local "nome.sobrenome" → pessoa;
   * 8. domínio corporativo com cabeçalhos de massa/ESP (List-*, Precedence, Feedback-ID, X-Auto-Response-Suppress…) → automático;
   * 9. nome de exibição da marca do domínio + parte local que não é nome nem caixa de papel humana → automático.
   */
  function isAutomated_(s, hdr, o) {
    if (o.autoSubmitted && o.autoSubmitted !== 'no') return true;
    if (o.isOutbound) return false;
    if (/^\s*auto[-_]?reply\b/i.test(header_(hdr, 'precedence')) || hdr['x-autoreply'] || hdr['x-autorespond']) return true;
    if (!s.local) return false;
    if (o.isDiscussion && !s.machine) return false;
    if (s.machine) return true;
    if (s.softRole) return !s.display.person;
    if (s.freemail) return false;
    if (s.display.person || localLooksPersonal_(s)) return false;
    if (o.massHeaders) return true;
    return s.display.brand && !s.display.relay && !s.humanRole;
  }

  /**
   * Lista de discussão (conversa humana distribuída por uma lista): From, Sender
   * ou List-Id em domínio de listas (googlegroups.com, groups.io…); cabeçalhos de
   * grupo (X-Google-Group-Id, Mailing-List, X-Mailman-Version, List-Post mailto)
   * com Sender diferente do From, "Fulano via Grupo" ou pessoa no From; ou
   * "Fulano via Grupo" com List-Id.
   */
  function isDiscussionList_(hdr, from, s, listId, lists) {
    var listHost = String(listId || '').replace(/^.*@/, '');
    if (domainIn_(s.domain, lists) || domainIn_(listHost, lists) || domainIn_(Util.emailDomain(s.senderHeader), lists)) return true;
    var groupHdr = !!(hdr['x-google-group-id'] || hdr['mailing-list'] || hdr['x-mailing-list'] || hdr['x-mailman-version']) ||
      /mailto:/i.test(header_(hdr, 'list-post'));
    var via = /\s+via\s+\S/i.test(String(from.name || ''));
    var senderDiffers = !!s.senderHeader && s.senderHeader !== s.email;
    if (groupHdr && (senderDiffers || via || (s.display.person && !s.machine))) return true;
    return via && !!listId && !s.machine;
  }
  function domainIn_(domain, list) {
    var d = String(domain || '').toLowerCase();
    if (!d) return false;
    for (var i = 0; i < (list || []).length; i++) {
      var x = list[i];
      if (d === x || d.slice(-(x.length + 1)) === '.' + x) return true;
    }
    return false;
  }
  function toSet_(words) {
    var o = {};
    String(words).split(/\s+/).forEach(function (w) { if (w) o[w] = true; });
    return o;
  }
  function isForwardSubject_(subject) {
    var s = String(subject || '');
    var m;
    var guard = 0;
    while ((m = SUBJECT_PREFIX_RE.exec(s)) && guard++ < 10) {
      if (!/^res?$/i.test(m[1])) return true;
      s = s.slice(m[0].length);
    }
    return false;
  }
  function hasForwardMarker_(text) {
    var lines = String(text || '').split('\n');
    for (var i = 0; i < lines.length; i++) if (FORWARD_LINE_RE.test(lines[i])) return true;
    return false;
  }

  // ============================================================= MIME ====

  /** Percorre o payload: primeiro text/plain e text/html de corpo, anexos com nome. */
  function collectParts_(payload) {
    var out = { plain: null, html: null, hasHtml: false, attachments: [] };
    (function walk(part, depth) {
      if (!part || typeof part !== 'object' || depth > 30) return;
      var mt = String(part.mimeType || '').toLowerCase();
      var ph = headerIndex_(part.headers);
      var disp = header_(ph, 'content-disposition');
      var filename = String(part.filename || '').trim() || dispositionFilename_(disp);
      var children = Array.isArray(part.parts) ? part.parts : [];
      if (!filename && (mt.indexOf('multipart/') === 0 || children.length)) {
        children.forEach(function (ch) { walk(ch, depth + 1); });
        return;
      }
      if (filename) {
        if (!isInlineImage_(mt, ph, disp)) {
          out.attachments.push({ filename: filename, mime_type: mt, size: Number(part.body && part.body.size) || 0 });
        }
        return;
      }
      if (/^\s*attachment/i.test(disp)) return;
      var body = part.body || {};
      var ref = { data: body.data, charset: charsetOf_(header_(ph, 'content-type')) };
      if (mt === 'text/plain' && !out.plain && body.data != null) out.plain = ref;
      else if (mt === 'text/html') {
        out.hasHtml = true;
        if (!out.html && body.data != null) out.html = ref;
      }
    })(payload, 0);
    return out;
  }
  function dispositionFilename_(disp) {
    if (!/^\s*attachment/i.test(String(disp || ''))) return '';
    var m = /filename\*?\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(disp);
    return m ? decodeMimeWords_(m[1] != null ? m[1] : m[2]).trim() : '';
  }
  /** Imagem embutida no HTML (Content-ID/cid) não conta como anexo. */
  function isInlineImage_(mt, ph, disp) {
    if (mt.indexOf('image/') !== 0) return false;
    if (/^\s*attachment/i.test(disp)) return false;
    return !!header_(ph, 'content-id').trim() || (!!header_(ph, 'x-attachment-id').trim() && /^\s*inline/i.test(disp));
  }
  function charsetOf_(contentType) {
    var m = /charset\s*=\s*["']?([^"';\s]+)/i.exec(String(contentType || ''));
    return m ? m[1] : '';
  }

  // =========================================================== charset ====

  /**
   * Decodifica `body.data` (base64url sem padding, ou array de bytes do serviço
   * avançado). Tenta UTF-8; se houver U+FFFD e o charset declarado não for
   * UTF-8/ASCII, tenta o declarado e fica com o resultado com menos U+FFFD.
   * @param {string|number[]} data
   * @param {string} [charset]
   * @param {number} [maxChars] limite de caracteres do resultado (0 = sem limite)
   */
  function decodeBody(data, charset, maxChars) {
    if (data === null || data === undefined || data === '') return '';
    var bytes;
    try {
      bytes = typeof data === 'string' ? Utilities.base64DecodeWebSafe(toWebSafe_(data)) : toByteArray_(data);
    } catch (e) {
      return '';
    }
    if (!bytes || !bytes.length) return '';
    var blob = Utilities.newBlob(bytes);
    var text = blob.getDataAsString('UTF-8');
    var bad = countReplacement_(text);
    var cs = normCharset_(charset);
    if (bad > 0 && cs !== 'utf-8' && cs !== 'us-ascii') {
      // Sem charset declarado, o legado brasileiro costuma ser Latin-1/Windows-1252.
      var candidates = cs ? charsetCandidates_(cs) : ['windows-1252', 'ISO-8859-1'];
      for (var i = 0; i < candidates.length; i++) {
        try {
          var alt = blob.getDataAsString(candidates[i]);
          if (countReplacement_(alt) < bad) text = alt;
          break;
        } catch (e) {
          // charset desconhecido pelo runtime: tenta o próximo
        }
      }
    }
    text = text.replace(/^\ufeff/, '');
    var limit = Number(maxChars) || 0;
    if (limit > 0 && text.length > limit) {
      text = text.slice(0, limit);
      if (/[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
    }
    return text;
  }
  function toWebSafe_(s) {
    var t = String(s).replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return padBase64_(t);
  }
  function padBase64_(s) {
    var t = String(s);
    while (t.length % 4) t += '=';
    return t;
  }
  function toByteArray_(data) {
    return Array.prototype.slice.call(data).map(function (b) { return toSignedByte_(Number(b) & 0xff); });
  }
  function toSignedByte_(b) {
    return b > 127 ? b - 256 : b;
  }
  function countReplacement_(s) {
    var m = s.match(/\ufffd/g);
    return m ? m.length : 0;
  }
  function normCharset_(cs) {
    var c = String(cs || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (c === 'utf8') return 'utf-8';
    if (c === 'ascii' || c === 'ansi_x3.4-1968' || c === 'us_ascii') return 'us-ascii';
    return c;
  }
  /** Nomes a tentar no runtime; Latin-1 declarado é lido como Windows-1252 (superconjunto). */
  function charsetCandidates_(cs) {
    var c = normCharset_(cs);
    if (!c || c === 'utf-8' || c === 'us-ascii') return ['UTF-8'];
    if (/^(?:iso[-_]?8859[-_]?1|latin-?1|l1|cp819)$/.test(c)) return ['windows-1252', 'ISO-8859-1'];
    if (c === 'cp1252') return ['windows-1252'];
    return [String(cs).trim().replace(/^["']|["']$/g, '')];
  }
  function bytesToString_(bytes, charset) {
    var blob = Utilities.newBlob(bytes);
    var cands = charsetCandidates_(charset);
    for (var i = 0; i < cands.length; i++) {
      try {
        return blob.getDataAsString(cands[i]);
      } catch (e) {
        // tenta o próximo
      }
    }
    return blob.getDataAsString('UTF-8');
  }

  // ======================================================== HTML→texto ====

  /** HTML de e-mail → texto legível (sem preheaders ocultos, scripts, estilos ou tags). */
  function htmlToText(html) {
    return convertHtml_(html, false).text;
  }

  /**
   * Converte HTML em {text, links, hidden}; `dropQuotes` remove blocos citados
   * (gmail_quote, blockquote); `wantHidden` devolve em `hidden` o texto dos
   * elementos removidos por estarem ocultos (≤ 2000 caracteres, normalizado).
   */
  function convertHtml_(html, dropQuotes, wantHidden) {
    var h = String(html == null ? '' : html).replace(/[\u0001\u0002]/g, '');
    h = removeComments_(h);
    h = removeBlock_(h, 'head', true);
    h = removeBlock_(h, 'script', false);
    h = removeBlock_(h, 'style', false);
    h = removeBlock_(h, 'title', false);
    h = removeBlock_(h, 'xml', true);
    var hiddenSink = wantHidden ? { chunks: [], chars: 0 } : null;
    h = removeElements_(h, isHiddenTag_, hiddenSink);
    if (dropQuotes) h = removeElements_(h, isQuoteContainer_);
    h = h.replace(/[ \t\r\n\f\v]+/g, ' ');

    var links = [];
    h = h.replace(/<a\b([^>]*)>([\s\S]{0,8000}?)<\/a\s*>/gi, function (_, attrs, inner) {
      var href = attrValue_(attrs, 'href');
      if (href) {
        var img = /<img\b[^>]*>/i.exec(inner);
        var text = inlineText_(inner) || (img ? cleanInline_(attrValue_(img[0], 'alt')) : '') || cleanInline_(attrValue_(attrs, 'title'));
        links.push({ url: href, text: text });
      }
      return inner;
    });

    h = h
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<\/?(?:p|h[1-6])\b[^>]*>/gi, PARA)
      .replace(/<li\b[^>]*>/gi, BLOCK + '• ')
      .replace(/<\/?(?:div|tr|li|table|tbody|thead|tfoot|ul|ol|dl|dt|dd|blockquote|section|article|header|footer|nav|aside|main|center|pre|address|form|fieldset|figure|figcaption|hr)\b[^>]*>/gi, BLOCK)
      .replace(/<\/?(?:td|th)\b[^>]*>/gi, ' ')
      .replace(/<\/?[a-zA-Z!?][^>]*>/g, '');
    h = decodeEntities_(h).replace(INVISIBLE_RE, '').replace(/\u00a0/g, ' ');
    return { text: tidyLines_(resolveBreaks_(h)), links: links, hidden: hiddenSink ? hiddenText_(hiddenSink.chunks) : '' };
  }

  /** Trechos HTML ocultos → texto: uma linha por elemento, sem tags/invisíveis, sem repetições, ≤ 2000 caracteres. */
  function hiddenText_(chunks) {
    var seen = {};
    var lines = [];
    for (var i = 0; i < chunks.length; i++) {
      var t = cleanInline_(chunks[i].replace(/<[^>]*$/, '').replace(/<[^>]*>/g, ' ')).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      // Preenchimento de preheader (só espaços, pontuação ou símbolos) não interessa.
      if (!/[0-9A-Za-zÀ-ÿ]/.test(t) || seen[t]) continue;
      seen[t] = true;
      lines.push(t);
    }
    var out = lines.join('\n');
    if (out.length > MAX_HIDDEN_CHARS) {
      out = out.slice(0, MAX_HIDDEN_CHARS);
      if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1);
    }
    return out;
  }

  function removeComments_(h) {
    var out = '';
    var pos = 0;
    while (true) {
      var start = h.indexOf('<!--', pos);
      if (start < 0) break;
      out += h.slice(pos, start);
      var end = h.indexOf('-->', start + 4);
      if (end < 0) return out;
      pos = end + 3;
    }
    return out + h.slice(pos);
  }
  /** Remove <tag>…</tag>; sem fechamento, remove até o fim (ou nada, se `requireClose`). */
  function removeBlock_(h, tag, requireClose) {
    var open = new RegExp('<' + tag + '\\b[^>]*>', 'gi');
    var close = new RegExp('</' + tag + '\\s*>', 'gi');
    var out = '';
    var pos = 0;
    var m;
    while ((m = open.exec(h))) {
      close.lastIndex = m.index + m[0].length;
      var c = close.exec(h);
      if (!c && requireClose) break;
      out += h.slice(pos, m.index);
      pos = c ? c.index + c[0].length : h.length;
      if (!c) break;
      open.lastIndex = pos;
    }
    return out + h.slice(pos);
  }
  /**
   * Remove elementos (com o conteúdo) cuja tag de abertura satisfaz `pred`,
   * respeitando aninhamento. Um orçamento global de tags visitadas evita custo
   * quadrático em HTML malformado (muitas aberturas sem fechamento). Com `sink`,
   * guarda o HTML de cada elemento removido (até MAX_HIDDEN_RAW caracteres no total).
   */
  function removeElements_(h, pred, sink) {
    var open = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
    var budget = { steps: 20000 };
    var out = '';
    var pos = 0;
    var m;
    while ((m = open.exec(h))) {
      var tag = m[1].toLowerCase();
      if (!pred(tag, m[2])) continue;
      var end = VOID_TAGS[tag] || /\/\s*$/.test(m[2]) ? m.index + m[0].length : closingEnd_(h, tag, m.index + m[0].length, budget);
      if (end < 0) {
        if (budget.steps <= 0) break;
        continue;
      }
      out += h.slice(pos, m.index);
      if (sink && sink.chars < MAX_HIDDEN_RAW) {
        var chunk = h.slice(m.index + m[0].length, end).slice(0, MAX_HIDDEN_RAW - sink.chars);
        sink.chunks.push(chunk);
        sink.chars += chunk.length;
      }
      pos = end;
      open.lastIndex = end;
    }
    return out + h.slice(pos);
  }
  function closingEnd_(h, tag, from, budget) {
    var re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'gi');
    re.lastIndex = from;
    var depth = 1;
    var m;
    while (budget.steps-- > 0 && (m = re.exec(h))) {
      if (m[1]) {
        if (--depth === 0) return m.index + m[0].length;
      } else if (!/\/\s*>$/.test(m[0])) depth++;
    }
    return -1;
  }
  /**
   * Preheaders e afins: display:none, visibility:hidden, font-size:0, mso-hide:all,
   * opacity:0 e caixa zerada com overflow:hidden (max-height, height, width ou max-width 0).
   */
  function isHiddenTag_(tag, attrs) {
    var style = attrValue_(attrs, 'style');
    if (!style) return false;
    var s = style.toLowerCase().replace(/\s+/g, '');
    if (/display:none|visibility:hidden|mso-hide:all/.test(s)) return true;
    var zero = '0(?:\\.0+)?(?:px|pt|em|rem|%)?(?:!important)?(?:;|$)';
    if (new RegExp('(?:^|;)font-size:' + zero).test(s)) return true;
    // Fonte de 1–2 px é ilegível: mesmo truque do font-size:0.
    if (/(?:^|;)font-size:(?:0?\.\d+|[12](?:\.\d+)?)(?:px|pt)(?:!important)?(?:;|$)/.test(s)) return true;
    if (new RegExp('(?:^|;)opacity:' + zero).test(s)) return true;
    return new RegExp('(?:^|;)(?:max-)?(?:height|width):' + zero).test(s) && /overflow:hidden/.test(s);
  }
  function isQuoteContainer_(tag, attrs) {
    if (tag === 'blockquote') return true;
    return /(?:^|\s)class\s*=\s*["']?[^"'>]*\b(?:gmail_quote|yahoo_quoted)\b/i.test(attrs);
  }
  function attrValue_(attrs, name) {
    var re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
    var m = re.exec(String(attrs || ''));
    if (!m) return '';
    return m[1] != null ? m[1] : m[2] != null ? m[2] : m[3];
  }
  function inlineText_(html) {
    return cleanInline_(String(html || '').replace(/<[^>]*>/g, ' '));
  }
  /** Texto curto de uma linha: entidades decodificadas, sem invisíveis, espaços colapsados. */
  function cleanInline_(s) {
    return decodeEntities_(String(s == null ? '' : s)).replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
  }
  function decodeEntities_(s) {
    return String(s).replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, function (m, e) {
      if (e.charAt(0) === '#') {
        var code = e.charAt(1) === 'x' || e.charAt(1) === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (CP1252[code]) return CP1252[code];
        if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
        return String.fromCodePoint(code);
      }
      var v = ENTITIES[e];
      if (v === undefined && e === e.toUpperCase()) v = ENTITIES[e.toLowerCase()];
      return v === undefined ? m : v;
    });
  }
  /**
   * Resolve os marcadores: bloco quebra a linha só se ela tiver texto; parágrafo
   * garante uma linha em branco; '\n' (de <br>) sempre quebra.
   */
  function resolveBreaks_(s) {
    var parts = s.split(/([\n\u0001\u0002])/);
    var out = [];
    var lineHasText = false;
    var trailingNl = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === '\n') {
        out.push('\n');
        trailingNl++;
        lineHasText = false;
      } else if (p === BLOCK || p === PARA) {
        if (lineHasText) {
          out.push('\n');
          trailingNl = 1;
          lineHasText = false;
        }
        if (p === PARA && trailingNl === 1) {
          out.push('\n');
          trailingNl = 2;
        }
      } else if (p) {
        if (!p.trim()) {
          if (lineHasText) out.push(p);
        } else {
          out.push(p);
          lineHasText = true;
          trailingNl = 0;
        }
      }
    }
    return out.join('');
  }
  /** Espaços colapsados por linha, no máximo uma linha em branco seguida; preserva o delimitador '-- '. */
  function tidyLines_(s) {
    return String(s)
      .split('\n')
      .map(function (l) {
        var t = l.replace(/[ \t\u00a0\f\v]+/g, ' ');
        return t === '-- ' || t === ' -- ' ? '-- ' : t.trim();
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
  }
  function normalizePlain_(s) {
    return tidyLines_(String(s || '').replace(/\r\n?/g, '\n').replace(INVISIBLE_RE, '').replace(/\u00a0/g, ' '));
  }
  function collapseLine_(s) {
    return String(s || '').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
  }
  function isHtmlPlaceholder_(plain) {
    var n = Util.normalizeText(plain);
    return n.length < MIN_KEPT_CHARS || (n.length < 400 && HTML_PLACEHOLDER_RE.test(n));
  }

  // ========================================================== limpeza ====

  /**
   * Remove o histórico citado: corta no primeiro cabeçalho de citação
   * ("Em … escreveu:", "On … wrote:", "-----Original Message-----", bloco
   * De/Enviado/Para/Assunto do Outlook) e remove blocos finais de linhas '>'.
   * Conteúdo depois de um marcador de encaminhamento nunca é cortado.
   * @param {string} text
   * @return {{text: string, removed: boolean}}
   */
  function stripQuotes(text) {
    var original = String(text == null ? '' : text);
    var lines = original.split('\n');
    var fwd = -1;
    for (var f = 0; f < lines.length; f++) {
      if (FORWARD_LINE_RE.test(lines[f])) {
        fwd = f;
        break;
      }
    }
    var limit = fwd >= 0 ? fwd : lines.length;
    var cut = -1;
    for (var i = 0; i < limit && cut < 0; i++) if (isQuoteHeaderAt_(lines, i)) cut = i;
    var kept = cut >= 0 ? lines.slice(0, cut) : lines;
    var qStart = trailingQuoteStart_(kept);
    if (qStart >= 0 && (fwd < 0 || qStart < fwd)) {
      kept = kept.slice(0, qStart);
      cut = qStart;
    }
    if (cut < 0) return { text: original, removed: false };
    var out = joinTrimmed_(kept);
    if (contentLength_(out) < MIN_KEPT_CHARS) return { text: original, removed: false };
    return { text: out, removed: true };
  }
  function isQuoteHeaderAt_(lines, i) {
    var line = lines[i];
    if (ORIGINAL_MSG_RE.test(line)) return true;
    if (ATTRIBUTION_START_RE.test(line)) {
      // O Gmail quebra "Em …, Nome <\nemail> escreveu:" em duas linhas.
      var joined = '';
      for (var k = 0; k < 3 && i + k < lines.length; k++) {
        if (k > 0 && !lines[i + k].trim()) break;
        joined += (k ? ' ' : '') + lines[i + k].trim();
        if (joined.length > 400) break;
        if (ATTRIBUTION_END_RE.test(joined)) return /\d/.test(joined);
      }
    }
    if (OUTLOOK_FROM_RE.test(line)) {
      var sent = false, to = false, subj = false;
      for (var n = 1; n <= 4 && i + n < lines.length; n++) {
        var l = lines[i + n];
        if (OUTLOOK_SENT_RE.test(l)) sent = true;
        else if (OUTLOOK_TO_RE.test(l)) to = true;
        else if (OUTLOOK_SUBJECT_RE.test(l)) subj = true;
      }
      if (sent && to && subj) return true;
    }
    return false;
  }
  /** Início do bloco final de linhas '>' (com a linha "… wrote:" logo antes, se houver); -1 se não houver. */
  function trailingQuoteStart_(lines) {
    var j = lines.length - 1;
    while (j >= 0 && !lines[j].trim()) j--;
    var start = -1;
    while (j >= 0 && (/^\s*>/.test(lines[j]) || !lines[j].trim())) {
      if (/^\s*>/.test(lines[j])) start = j;
      j--;
    }
    if (start < 0) return -1;
    var k = start - 1;
    while (k >= 0 && !lines[k].trim()) k--;
    if (k >= 0 && lines[k].length <= 300 && ATTRIBUTION_END_RE.test(lines[k])) start = k;
    return start;
  }

  /**
   * Remove a assinatura: corta no delimitador '-- ' (na segunda metade do texto,
   * ou antes dela quando o que vem depois é curto), linhas finais de celular
   * ("Enviado do meu iPhone", "Get Outlook for …") e parágrafos finais de aviso
   * legal nos últimos 40% do texto.
   * @param {string} text
   * @return {{text: string, removed: boolean}}
   */
  function stripSignature(text) {
    var original = String(text == null ? '' : text);
    var total = original.length;
    if (!total) return { text: original, removed: false };
    var lines = original.split('\n');
    var offsets = lineOffsets_(lines);
    var removed = false;
    for (var i = 1; i < lines.length; i++) {
      if (!/^--[ \t]?$/.test(lines[i])) continue;
      var tailChars = total - offsets[i] - lines[i].length - 1;
      var shortTail = lines[i] === '-- ' && tailChars <= 600 && countNonEmpty_(lines.slice(i + 1)) <= 10;
      if (offsets[i] >= total / 2 || shortTail) {
        lines = lines.slice(0, i);
        removed = true;
        break;
      }
    }
    var changed = true;
    while (changed) {
      changed = false;
      while (lines.length && (!lines[lines.length - 1].trim() || SEPARATOR_LINE_RE.test(lines[lines.length - 1]))) lines.pop();
      if (!lines.length) break;
      var last = lines[lines.length - 1];
      if (last.length <= 100 && MOBILE_SIG_RE.test(last)) {
        lines.pop();
        removed = changed = true;
        continue;
      }
      var p = lines.length - 1;
      while (p > 0 && lines[p - 1].trim() && !SEPARATOR_LINE_RE.test(lines[p - 1])) p--;
      if (p === 0) break;
      if (offsets[p] >= total * 0.6 && isDisclaimer_(Util.normalizeText(lines.slice(p).join(' ')))) {
        lines = lines.slice(0, p);
        removed = changed = true;
      }
    }
    if (!removed) return { text: original, removed: false };
    var out = joinTrimmed_(lines);
    if (!out.trim()) return { text: original, removed: false };
    return { text: out, removed: true };
  }
  function isDisclaimer_(para) {
    if (DISCLAIMER_STRONG_RE.test(para)) return true;
    var hits = para.match(DISCLAIMER_WEAK_RE);
    return !!hits && Util.uniq(hits).length >= 2;
  }

  /**
   * Remove o rodapé de newsletter: corta a partir da primeira linha nos últimos
   * 35% do texto com termos de descadastro/preferências/"você está recebendo"/
   * direitos reservados (incluindo linhas de rodapé contíguas logo antes).
   * @param {string} text
   * @return {{text: string, removed: boolean}}
   */
  function stripFooter(text) {
    var original = String(text == null ? '' : text);
    var total = original.length;
    if (!total) return { text: original, removed: false };
    var lines = original.split('\n');
    var offsets = lineOffsets_(lines);
    var threshold = total * 0.65;
    var cut = -1;
    for (var j = 0; j < lines.length && cut < 0; j++) {
      if (offsets[j] + lines[j].length < threshold) continue;
      var m = FOOTER_RE.exec(footerKey_(lines[j]));
      if (m && offsets[j] + m.index >= threshold) cut = j;
    }
    if (cut < 0) return { text: original, removed: false };
    for (var k = cut - 1; k >= 0 && offsets[k] >= total * 0.5; k--) {
      if (!lines[k].trim()) continue;
      if (FOOTER_RE.test(footerKey_(lines[k])) || COPYRIGHT_RE.test(lines[k])) cut = k;
      else break;
    }
    var out = joinTrimmed_(lines.slice(0, cut));
    if (contentLength_(out) < MIN_KEPT_CHARS) return { text: original, removed: false };
    return { text: out, removed: true };
  }
  function footerKey_(line) {
    return Util.stripDiacritics(String(line).toLowerCase()).replace(/[’`´]/g, "'");
  }
  /** Posição (em caracteres) do início de cada linha no texto original. */
  function lineOffsets_(lines) {
    var out = [];
    var off = 0;
    for (var i = 0; i < lines.length; i++) {
      out.push(off);
      off += lines[i].length + 1;
    }
    return out;
  }
  function joinTrimmed_(lines) {
    var l = lines.slice();
    while (l.length && (!l[l.length - 1].trim() || SEPARATOR_LINE_RE.test(l[l.length - 1]))) l.pop();
    return l.join('\n').replace(/\s+$/, '');
  }
  function contentLength_(s) {
    return String(s).replace(/\s+/g, ' ').trim().length;
  }
  function countNonEmpty_(lines) {
    var n = 0;
    for (var i = 0; i < lines.length; i++) if (lines[i].trim()) n++;
    return n;
  }

  // ============================================================ links ====

  /**
   * Links úteis de âncoras HTML e URLs do texto: só http(s), sem utm_*, sem
   * pixels/rastreadores, descadastro ou mailto; deduplicados; âncoras com texto
   * significativo primeiro; no máximo 15, texto ≤ 80 caracteres.
   * @param {string} html
   * @param {string} text
   * @return {Array<{url: string, text: string}>}
   */
  function extractLinks(html, text) {
    return collectLinks_(html ? convertHtml_(html, false).links : [], text).links;
  }

  function collectLinks_(anchors, text) {
    var raw = (anchors || []).slice();
    textUrls_(String(text || '')).forEach(function (u) { raw.push({ url: u, text: '' }); });
    var unsub = '', prefs = '';
    /** @type {Object<string, {url: string, text: string, order: number}>} */
    var byKey = {};
    var list = [];
    raw.forEach(function (l) {
      var url = cleanUrl_(l.url);
      if (!/^https?:\/\/[^\s\/?#]+/i.test(url) || url.length > MAX_URL_CHARS) return;
      var t = Util.truncate(cleanInline_(l.text), LINK_TEXT_MAX);
      var kind = unsubscribeKind_(url, t);
      if (kind) {
        if (kind === 'unsub' && !unsub) unsub = url;
        if (kind === 'prefs' && !prefs) prefs = url;
        return;
      }
      if (isTrackingUrl(url)) return;
      var key = urlKey_(url);
      var prev = byKey[key];
      if (prev) {
        if (linkRank_(t) < linkRank_(prev.text)) prev.text = t;
        return;
      }
      var item = { url: url, text: t, order: list.length };
      byKey[key] = item;
      list.push(item);
    });
    list.sort(function (a, b) {
      return linkRank_(a.text) - linkRank_(b.text) || a.order - b.order;
    });
    return {
      links: list.slice(0, MAX_LINKS).map(function (l) { return { url: l.url, text: l.text }; }),
      unsubscribe: unsub || prefs,
    };
  }
  /** 0 = texto significativo; 1 = sem texto (URL solta, imagem); 2 = genérico ("clique aqui"). */
  function linkRank_(text) {
    var n = Util.normalizeText(text).replace(/^[\s>»›→.:-]+|[\s>»›→.:!-]+$/g, '');
    if (!n) return 1;
    if (n.length < 3 || GENERIC_LINK_TEXT[n]) return 2;
    return 0;
  }
  function unsubscribeKind_(url, text) {
    var u = url.toLowerCase();
    var t = Util.normalizeText(text);
    if (UNSUB_URL_RE.test(u) || UNSUB_TEXT_RE.test(t)) return 'unsub';
    if (PREFS_URL_RE.test(u) || PREFS_TEXT_RE.test(t)) return 'prefs';
    return '';
  }
  function textUrls_(text) {
    var out = [];
    var re = /\bhttps?:\/\/[^\s<>"'`{}|\\^\[\]]+/gi;
    var m;
    while ((m = re.exec(text)) && out.length < 200) out.push(trimUrlTail_(m[0]));
    return out;
  }
  function trimUrlTail_(u) {
    var s = u;
    while (s.length) {
      var ch = s.charAt(s.length - 1);
      if (ch === ')') {
        var opens = s.split('(').length - 1;
        var closes = s.split(')').length - 1;
        if (opens >= closes) break;
      } else if ('.,;:!?»”’*'.indexOf(ch) < 0) break;
      s = s.slice(0, -1);
    }
    return s;
  }
  /** Decodifica entidades do href, remove espaços e parâmetros de rastreamento (utm_*, fbclid…). */
  function cleanUrl_(url) {
    var s = decodeEntities_(String(url || '')).trim().replace(/\s+/g, '');
    var hash = s.indexOf('#');
    var frag = hash >= 0 ? s.slice(hash) : '';
    var base = hash >= 0 ? s.slice(0, hash) : s;
    var q = base.indexOf('?');
    if (q < 0) return s;
    var params = base.slice(q + 1).split('&').filter(function (p) {
      if (!p) return false;
      var k = p.split('=')[0].toLowerCase();
      return k.indexOf('utm_') !== 0 && !TRACKING_PARAMS[k];
    });
    return base.slice(0, q) + (params.length ? '?' + params.join('&') : '') + frag;
  }
  function urlKey_(url) {
    return url
      .replace(/#.*$/, '')
      .replace(/^https?:\/\/[^\/?#]+/i, function (m) { return m.toLowerCase().replace(/^http:/, 'https:'); })
      .replace(/\/+(\?|$)/, '$1');
  }

  /**
   * URL de pixel/rastreamento de abertura: imagens .gif/.png, "1x1", segmentos
   * /open, /pixel, /beacon, ou host open./pixel./beacon.
   * @param {string} url
   */
  function isTrackingUrl(url) {
    var u = String(url || '').trim().toLowerCase();
    var m = /^(?:https?:)?\/\/([^\/?#]*)([^?#]*)/.exec(u);
    if (!m) return false;
    var host = m[1].replace(/:\d+$/, '');
    var path = m[2];
    if (/^open\./.test(host) && !/(?:^|\.)(?:spotify|substack)\.com$/.test(host)) return true;
    if (/(?:^|\.)(?:pixels?|beacons?)\./.test(host)) return true;
    if (/\/(?:open|pixels?|beacons?)(?:\.[a-z0-9]+)?(?:\/|$)/.test(path)) return true;
    if (/\.(?:gif|png)$/.test(path)) return true;
    return /(?:^|[\/_.=-])1x1(?:[\/_.&-]|$)/.test(u);
  }

  return {
    parse: parse,
    htmlToText: htmlToText,
    stripQuotes: stripQuotes,
    stripSignature: stripSignature,
    stripFooter: stripFooter,
    parseAddressList: parseAddressList,
    extractLinks: extractLinks,
    decodeBody: decodeBody,
    isTrackingUrl: isTrackingUrl,
  };
})();
