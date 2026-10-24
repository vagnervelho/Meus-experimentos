/**
 * Configuração: padrões versionados + overrides do usuário (Script Properties,
 * fatiados em chaves de até 8 KB) + segredos (Script Properties, nunca
 * devolvidos ao cliente).
 *
 * Tudo que afeta classificação ou ranking entra no hash `configVersion`, gravado
 * em cada análise para auditoria e reprocessamento seletivo.
 */
var Config = (function () {
  var APP_VERSION = '1.0.0';
  var CLASSIFIER_VERSION = 'rules-2026.10.1';
  var PARSER_VERSION = 'parser-2026.10.1';
  var SCHEMA_VERSION = 1;
  var OVERRIDES_PREFIX = 'CFG_OVR_';
  var OVERRIDES_CHUNK = 8000;

  /** Segredos e identificadores operacionais (Script Properties). */
  var SECRET_KEYS = {
    projectId: 'GCP_PROJECT_ID',
    anthropicKey: 'ANTHROPIC_API_KEY',
    geminiKey: 'GEMINI_API_KEY',
    ownerEmail: 'OWNER_EMAIL',
    allowEmptyActiveUser: 'ALLOW_EMPTY_ACTIVE_USER',
    bqLocation: 'BQ_LOCATION',
  };

  // ------------------------------------------------------------ taxonomia ----
  // Palavras-chave são normalizadas (minúsculas, sem acento) no momento do uso.
  // strong = peso 3, weak = peso 1; domínios de remetente = peso 4.
  var TAXONOMY = [
    {
      id: 'carreira', label: 'Carreira e vagas', prior: 0.7, urgencyTrust: 1, noise: 1, sensitive: false, aiEligible: true,
      subcategories: ['vaga', 'processo_seletivo', 'alerta_vagas'],
      keywords: {
        strong: ['vaga', 'vagas', 'oportunidade de emprego', 'processo seletivo', 'candidatura', 'sua candidatura', 'entrevista',
          'recrutamento', 'job opportunity', 'job offer', 'oferta de emprego', 'proposta de trabalho', 'estamos contratando',
          'we are hiring', "we're hiring", 'job alert', 'alerta de vagas', 'novas vagas', 'vagas recomendadas', 'teste tecnico',
          'case tecnico', 'desafio tecnico', 'etapa do processo', 'banco de talentos', 'application received', 'interview',
          'offer letter', 'open position', 'oportunidade de carreira'],
        weak: ['salario', 'remuneracao', 'beneficios', 'clt', 'home office', 'remoto', 'hibrido', 'curriculo', 'cv', 'position',
          'role', 'hiring', 'senioridade', 'pleno', 'senior', 'especialista', 'apply', 'candidate-se', 'inscricao'],
      },
      negative: ['vaga de estacionamento', 'vagas limitadas', 'garanta sua vaga', 'ultimas vagas'],
      senderDomains: ['gupy.io', 'gupy.com.br', 'vagas.com.br', 'catho.com.br', 'indeed.com', 'glassdoor.com', 'infojobs.com.br',
        'greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'smartrecruiters.com', 'ashbyhq.com', 'trampos.co', 'programathor.com.br',
        'geekhunter.com.br', 'revelo.com.br', 'solides.com.br', 'kenoby.com', 'recrutei.com.br'],
      senderPatterns: ['jobs-noreply@linkedin.com', 'jobalerts-noreply@linkedin.com', 'jobs-listings@linkedin.com'],
      gmailCategories: [],
    },
    {
      id: 'networking', label: 'Recrutadores e networking', prior: 0.55, urgencyTrust: 1, noise: 1, sensitive: false, aiEligible: true,
      subcategories: ['recrutador', 'convite', 'contato_profissional'],
      keywords: {
        strong: ['recrutador', 'recrutadora', 'recruiter', 'talent acquisition', 'headhunter', 'hunter', 'quer se conectar',
          'convite para se conectar', 'invitation to connect', 'would like to connect', 'gostaria de conversar', 'gostaria de te conhecer',
          'encontrei seu perfil', 'vi seu perfil', 'came across your profile', 'your profile', 'seu perfil', 'mentoria', 'networking',
          'cafe virtual', 'indicacao', 'referral'],
        weak: ['conectar', 'conexao', 'linkedin', 'bate-papo', 'conversa rapida', 'quick chat'],
      },
      negative: [],
      senderDomains: [],
      senderPatterns: ['invitations@linkedin.com', 'messages-noreply@linkedin.com', 'inmail-hit-reply@linkedin.com', 'hit-reply@linkedin.com'],
      gmailCategories: ['CATEGORY_SOCIAL'],
    },
    {
      id: 'noticias', label: 'Notícias e atualidades', prior: 0.3, urgencyTrust: 0.3, noise: 1, sensitive: false, aiEligible: true,
      subcategories: [],
      keywords: {
        strong: ['noticias', 'ultimas noticias', 'breaking news', 'manchetes', 'headlines', 'edicao de hoje', 'resumo do dia',
          'o que voce precisa saber', 'what you need to know', 'giro de noticias'],
        weak: ['politica', 'governo', 'eleicoes', 'congresso', 'stf', 'guerra', 'mundo', 'brasil', 'internacional', 'clima'],
      },
      negative: [],
      senderDomains: ['folha.uol.com.br', 'uol.com.br', 'estadao.com.br', 'oglobo.globo.com', 'g1.globo.com', 'globo.com', 'nexojornal.com.br',
        'cnnbrasil.com.br', 'poder360.com.br', 'thenewscc.com.br', 'jota.info', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'theguardian.com',
        'reuters.com', 'apnews.com', 'axios.com', 'semafor.com', 'piaui.folha.uol.com.br'],
      senderPatterns: [],
      gmailCategories: ['CATEGORY_UPDATES'],
    },
    {
      id: 'economia', label: 'Economia e mercado financeiro', prior: 0.4, urgencyTrust: 0.3, noise: 1, sensitive: false, aiEligible: true,
      subcategories: [],
      keywords: {
        strong: ['economia', 'mercado financeiro', 'ibovespa', 'bolsa de valores', 'selic', 'copom', 'inflacao', 'ipca', 'pib',
          'banco central', 'federal reserve', 'fomc', 'politica monetaria', 'juros futuros', 'cambio', 'dolar', 'recessao',
          'arcabouco fiscal', 'resultado trimestral', 'balanco trimestral', 'treasury', 's&p 500', 'nasdaq'],
        weak: ['juros', 'mercado', 'commodities', 'petroleo', 'fiscal', 'earnings', 'acoes', 'investidores', 'fed'],
      },
      negative: [],
      senderDomains: ['valor.globo.com', 'valor.com.br', 'infomoney.com.br', 'exame.com', 'moneytimes.com.br', 'bloomberg.com',
        'bloomberglinea.com.br', 'ft.com', 'wsj.com', 'economist.com', 'braziljournal.com', 'investnews.com.br', 'seudinheiro.com',
        'neofeed.com.br'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'tecnologia', label: 'Tecnologia e inteligência artificial', prior: 0.4, urgencyTrust: 0.3, noise: 1, sensitive: false, aiEligible: true,
      subcategories: ['ia', 'dados', 'software'],
      keywords: {
        strong: ['inteligencia artificial', 'artificial intelligence', 'ia generativa', 'generative ai', 'llm', 'llms', 'machine learning',
          'aprendizado de maquina', 'deep learning', 'chatgpt', 'openai', 'anthropic', 'claude', 'gemini', 'copilot', 'modelo de linguagem',
          'data science', 'ciencia de dados', 'python', 'agentes de ia', 'ai agents', 'hugging face', 'transformer', 'rag', 'mlops',
          'engenharia de dados', 'data engineering', 'analytics'],
        weak: ['tecnologia', 'tech', 'software', 'cloud', 'aws', 'gcp', 'azure', 'api', 'sql', 'dados', 'programacao', 'github', 'open source',
          'nvidia', 'chip', 'semicondutor', 'startup de tecnologia', 'cybersecurity', 'seguranca da informacao'],
      },
      negative: [],
      senderDomains: ['techcrunch.com', 'theverge.com', 'wired.com', 'arstechnica.com', 'tldrnewsletter.com', 'tldr.tech', 'therundown.ai',
        'deeplearning.ai', 'huggingface.co', 'openai.com', 'anthropic.com', 'towardsdatascience.com', 'kdnuggets.com', 'datacamp.com',
        'alura.com.br', 'rocketseat.com.br', 'dio.me', 'medium.com'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'negocios', label: 'Negócios e empreendedorismo', prior: 0.4, urgencyTrust: 0.4, noise: 1, sensitive: false, aiEligible: true,
      subcategories: [],
      keywords: {
        strong: ['empreendedorismo', 'startup', 'startups', 'venture capital', 'rodada de investimento', 'funding', 'serie a', 'aquisicao',
          'fusao', 'm&a', 'ipo', 'modelo de negocio', 'valuation', 'unicornio', 'founder', 'fundador', 'saas', 'pricing', 'precificacao',
          'go-to-market', 'estrategia de negocio'],
        weak: ['negocios', 'gestao', 'lideranca', 'estrategia', 'vendas', 'growth', 'receita', 'cliente', 'mercado', 'pitch', 'ecommerce'],
      },
      negative: [],
      senderDomains: ['startse.com', 'endeavor.org.br', 'hbr.org', 'mckinsey.com', 'bain.com', 'sebrae.com.br', 'distrito.me', 'latitud.com'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'financas', label: 'Finanças e investimentos', prior: 0.5, urgencyTrust: 1, noise: 1, sensitive: true, aiEligible: true,
      subcategories: ['banco', 'investimento', 'cartao'],
      keywords: {
        strong: ['extrato', 'saldo', 'investimento', 'investimentos', 'aplicacao', 'resgate', 'rendimento', 'tesouro direto', 'cdb', 'lci', 'lca',
          'fundo de investimento', 'fundos imobiliarios', 'fii', 'dividendos', 'corretora', 'previdencia', 'informe de rendimentos',
          'cartao de credito', 'limite do cartao', 'conta corrente', 'emprestimo', 'financiamento', 'renda fixa', 'renda variavel',
          'transferencia recebida', 'pix recebido', 'pix enviado'],
        weak: ['banco', 'pix', 'ted', 'credito', 'carteira', 'cripto', 'bitcoin', 'score', 'open finance', 'investidor'],
      },
      negative: [],
      senderDomains: ['itau.com.br', 'itau-unibanco.com.br', 'bradesco.com.br', 'santander.com.br', 'bb.com.br', 'caixa.gov.br', 'nubank.com.br',
        'inter.co', 'bancointer.com.br', 'c6bank.com.br', 'btgpactual.com', 'xpi.com.br', 'rico.com.vc', 'clear.com.br', 'avenue.us',
        'picpay.com', 'sicredi.com.br', 'sicoob.com.br', 'neon.com.br', 'warren.com.br', 'genialinvestimentos.com.br', 'binance.com',
        'mercadobitcoin.com.br', 'toroinvestimentos.com.br'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'trabalho', label: 'Trabalho e projetos', prior: 0.65, urgencyTrust: 1, noise: 1, sensitive: false, aiEligible: true,
      subcategories: [],
      keywords: {
        strong: ['projeto', 'entregavel', 'deliverable', 'sprint', 'roadmap', 'cronograma', 'status report', 'kickoff', 'milestone',
          'pull request', 'code review', 'proposta comercial', 'escopo do projeto', 'alinhamento', 'reuniao de alinhamento',
          'conforme conversado', 'segue em anexo', 'em anexo', 'documento compartilhado', 'compartilhou com voce', 'shared with you'],
        weak: ['relatorio', 'apresentacao', 'revisao', 'aprovacao', 'cliente', 'contrato', 'planilha', 'deploy', 'jira', 'entrega', 'equipe'],
      },
      negative: [],
      senderDomains: ['atlassian.net', 'notion.so', 'slack.com', 'trello.com', 'asana.com', 'figma.com', 'gitlab.com', 'github.com'],
      senderPatterns: ['drive-shares-noreply@google.com', 'drive-shares-dm-noreply@google.com', 'comments-noreply@docs.google.com'],
      gmailCategories: [],
    },
    {
      id: 'tarefas', label: 'Tarefas, solicitações e follow-ups', prior: 0.7, urgencyTrust: 1, noise: 1, sensitive: false, aiEligible: true,
      subcategories: [],
      keywords: {
        strong: ['preciso que', 'precisamos que', 'poderia enviar', 'pode me enviar', 'por favor envie', 'favor enviar', 'aguardo retorno',
          'aguardo seu retorno', 'fico no aguardo', 'me confirme', 'confirme ate', 'responder ate', 'retorno ate', 'pendencia', 'pendente',
          'lembrete', 'follow up', 'follow-up', 'action required', 'acao necessaria', 'action needed', 'please confirm', 'please review',
          'could you', 'can you please', 'let me know', 'assinatura pendente', 'documento para assinar', 'preencha o formulario'],
        weak: ['poderia', 'por favor', 'confirmar', 'enviar', 'responder', 'retorno', 'prazo', 'assinar', 'revisar'],
      },
      negative: [],
      senderDomains: ['docusign.net', 'clicksign.com', 'd4sign.com.br', 'echosign.com'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'agenda', label: 'Agenda, reservas e compromissos', prior: 0.6, urgencyTrust: 1, noise: 1, sensitive: false, aiEligible: true,
      subcategories: ['reuniao', 'viagem', 'evento', 'reserva', 'consulta'],
      keywords: {
        strong: ['convite:', 'invitation:', 'updated invitation', 'convite atualizado', 'reuniao', 'meeting', 'google meet', 'zoom', 'microsoft teams',
          'webinar', 'workshop', 'palestra', 'conferencia', 'inscricao confirmada', 'ingresso', 'reserva confirmada', 'booking confirmation',
          'check-in', 'cartao de embarque', 'voo', 'passagem', 'itinerario', 'hospedagem', 'consulta agendada', 'agendamento confirmado',
          'save the date', 'rsvp'],
        weak: ['agenda', 'evento', 'calendario', 'horario', 'reserva', 'hotel', 'embarque', 'consulta', 'agendamento', 'presencial', 'online'],
      },
      negative: [],
      senderDomains: ['booking.com', 'airbnb.com', 'airbnb.com.br', 'latam.com', 'voegol.com.br', 'voeazul.com.br', 'decolar.com', 'hoteis.com',
        'expedia.com', 'sympla.com.br', 'eventbrite.com', 'zoom.us', 'calendly.com', 'doctoralia.com.br'],
      senderPatterns: ['calendar-notification@google.com'],
      gmailCategories: [],
    },
    {
      id: 'compras', label: 'Compras, serviços e transações', prior: 0.35, urgencyTrust: 0.8, noise: 1, sensitive: false, aiEligible: true,
      subcategories: ['pedido', 'entrega', 'assinatura'],
      keywords: {
        strong: ['seu pedido', 'pedido confirmado', 'compra aprovada', 'pagamento aprovado', 'pagamento confirmado', 'nota fiscal', 'nf-e',
          'saiu para entrega', 'pedido entregue', 'foi entregue', 'codigo de rastreio', 'rastreamento', 'a caminho', 'devolucao', 'reembolso',
          'recibo', 'receipt', 'order confirmation', 'your order', 'shipped', 'delivered', 'assinatura renovada', 'renovacao da assinatura',
          'your subscription', 'sua assinatura'],
        weak: ['pedido', 'compra', 'entrega', 'frete', 'pagamento', 'plano', 'order', 'subscription'],
      },
      negative: [],
      senderDomains: ['amazon.com.br', 'amazon.com', 'mercadolivre.com.br', 'mercadopago.com', 'mercadopago.com.br', 'magazineluiza.com.br',
        'magalu.com', 'americanas.com.br', 'shopee.com.br', 'aliexpress.com', 'shein.com', 'netshoes.com.br', 'casasbahia.com.br',
        'kabum.com.br', 'ifood.com.br', 'rappi.com', 'uber.com', '99app.com', 'spotify.com', 'netflix.com', 'apple.com', 'correios.com.br',
        'loggi.com'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'contas', label: 'Contas, cobranças e documentos', prior: 0.6, urgencyTrust: 1, noise: 1, sensitive: true, aiEligible: true,
      subcategories: ['boleto', 'fatura', 'imposto', 'documento'],
      keywords: {
        strong: ['boleto', 'fatura', 'vencimento', 'vence em', 'vence hoje', 'linha digitavel', 'codigo de barras', 'segunda via', '2a via',
          'conta de luz', 'conta de agua', 'conta de energia', 'conta de telefone', 'condominio', 'aluguel', 'iptu', 'ipva', 'darf',
          'receita federal', 'imposto de renda', 'irpf', 'cobranca', 'pagamento pendente', 'em atraso', 'debito automatico', 'certidao',
          'comprovante de pagamento', 'holerite', 'contracheque', 'fgts', 'inss', 'detran', 'multa de transito'],
        weak: ['conta', 'pagamento', 'imposto', 'documento', 'contrato', 'comprovante', 'cpf', 'gov.br', 'declaracao', 'parcela'],
      },
      negative: [],
      senderDomains: ['enel.com.br', 'light.com.br', 'cemig.com.br', 'copel.com', 'cpfl.com.br', 'sabesp.com.br', 'comgas.com.br',
        'claro.com.br', 'vivo.com.br', 'tim.com.br', 'oi.com.br', 'receita.fazenda.gov.br', 'gov.br', 'quintoandar.com.br', 'serasa.com.br'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'newsletters', label: 'Newsletters', prior: 0.25, urgencyTrust: 0.2, noise: 0.85, sensitive: false, aiEligible: true,
      subcategories: [],
      keywords: {
        strong: ['newsletter', 'edicao #', 'edicao n', 'issue #', 'weekly digest', 'resumo semanal', 'curadoria', 'leia no navegador',
          'ver no navegador', 'view in browser', 'voce esta recebendo este', 'you are receiving this', 'you received this email because'],
        weak: ['edicao', 'semanal', 'weekly', 'digest', 'leitura', 'assine', 'subscribe'],
      },
      negative: [],
      senderDomains: ['substack.com', 'beehiiv.com', 'mcsv.net', 'mailchimpapp.net', 'convertkit-mail.com', 'ghost.io', 'buttondown.email'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'marketing', label: 'Marketing e promoções', prior: 0.1, urgencyTrust: 0.1, noise: 0.4, sensitive: false, aiEligible: false,
      subcategories: [],
      keywords: {
        strong: ['promocao', 'oferta', 'desconto', '% off', 'cupom', 'frete gratis', 'liquidacao', 'black friday', 'cyber monday', 'so hoje',
          'ultimas horas', 'imperdivel', 'aproveite', 'compre agora', 'garanta ja', 'oferta exclusiva', 'oferta relampago', 'outlet', 'cashback',
          'limited time', 'exclusive offer', 'sale', 'deal', 'coupon', 'nao perca'],
        weak: ['oferta', 'lancamento', 'novidades', 'colecao', 'pontos', 'milhas', 'clique aqui', 'saiba mais', 'garanta'],
      },
      negative: [],
      senderDomains: [],
      senderPatterns: [],
      gmailCategories: ['CATEGORY_PROMOTIONS'],
    },
    {
      id: 'spam', label: 'Spam provável e irrelevante', prior: 0, urgencyTrust: 0, noise: 0.1, sensitive: false, aiEligible: false,
      subcategories: [],
      keywords: {
        strong: ['voce ganhou', 'voce foi selecionado', 'parabens voce', 'premio em dinheiro', 'heranca', 'sorteado', 'renda extra garantida',
          'ganhe dinheiro rapido', 'clique para resgatar', 'sua conta sera bloqueada', 'verifique sua conta imediatamente', 'you have won',
          'claim your prize', 'lottery', 'crypto giveaway', 'dobre seu bitcoin', 'atualizacao cadastral urgente'],
        weak: ['urgente!!!', 'gratis!!!', '100% garantido', 'sem risco'],
      },
      negative: [],
      senderDomains: [],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'saude', label: 'Saúde', prior: 0.6, urgencyTrust: 1, noise: 1, sensitive: true, aiEligible: true,
      subcategories: ['exame', 'consulta', 'plano'],
      keywords: {
        strong: ['resultado de exame', 'resultados de exames', 'laudo', 'laudo disponivel', 'exame disponivel', 'consulta medica',
          'receita medica', 'prescricao', 'plano de saude', 'carteirinha do plano', 'autorizacao de exame', 'guia de autorizacao',
          'telemedicina', 'teleconsulta', 'vacinacao', 'odontologico', 'pedido medico'],
        weak: ['exame', 'exames', 'medico', 'medica', 'saude', 'paciente', 'convenio', 'hospital', 'clinica', 'dentista', 'terapia', 'vacina'],
      },
      negative: [],
      senderDomains: ['dasa.com.br', 'fleury.com.br', 'grupofleury.com.br', 'hermespardini.com.br', 'sabin.com.br', 'labi.com.br',
        'delboniauriemo.com.br', 'lavoisier.com.br', 'unimed.com.br', 'amil.com.br', 'sulamerica.com.br', 'bradescosaude.com.br',
        'hapvida.com.br', 'gndi.com.br', 'notredameintermedica.com.br', 'drconsulta.com', 'einstein.br', 'hsl.org.br', 'rededor.com.br',
        'conexasaude.com.br'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'seguranca_conta', label: 'Segurança da conta', prior: 0.55, urgencyTrust: 1, noise: 1, sensitive: true, aiEligible: false,
      subcategories: [],
      keywords: {
        strong: ['codigo de verificacao', 'codigo de seguranca', 'codigo de acesso', 'verification code', 'security code', 'one-time code',
          'redefinir senha', 'redefinicao de senha', 'reset your password', 'password reset', 'novo login', 'new sign-in', 'alerta de seguranca',
          'security alert', 'atividade suspeita', 'suspicious activity', 'confirme seu e-mail', 'verify your email', 'autenticacao em dois fatores',
          'two-factor', 'link de acesso', 'magic link', 'tentativa de login', 'login attempt', 'acesso a sua conta'],
        weak: ['senha', 'password', 'login', 'seguranca', 'verificacao', 'token'],
      },
      negative: [],
      senderDomains: ['accounts.google.com', 'id.apple.com', 'appleid.apple.com', 'accountprotection.microsoft.com'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'governo_juridico', label: 'Governo e jurídico', prior: 0.6, urgencyTrust: 1, noise: 1, sensitive: true, aiEligible: true,
      subcategories: [],
      keywords: {
        strong: ['receita federal', 'e-cac', 'malha fina', 'intimacao', 'citacao judicial', 'processo judicial', 'tribunal', 'notificacao extrajudicial',
          'cartorio', 'procuracao', 'meu inss', 'esocial', 'certidao negativa', 'audiencia', 'advogado', 'advocacia'],
        weak: ['governo', 'juridico', 'processo', 'prazo legal', 'lei', 'detran', 'inss', 'fgts'],
      },
      negative: [],
      senderDomains: ['gov.br', 'jus.br', 'mp.br', 'leg.br'],
      senderPatterns: [],
      gmailCategories: [],
    },
    {
      id: 'outros', label: 'Outros', prior: 0.3, urgencyTrust: 1, noise: 1, sensitive: false, aiEligible: true,
      subcategories: [], keywords: { strong: [], weak: [] }, negative: [], senderDomains: [], senderPatterns: [], gmailCategories: [],
    },
  ];

  // ------------------------------------------------------------- padrões ----
  var DEFAULTS = {
    gmail: {
      accountIndex: 0,
      backfillDays: 90,
      backfillWindowDays: 7,
      listQueryExtra: '-in:chats',
      includeSent: true,
      maxFetchPerRun: 300,
      fetchBatchSize: 15,
      unitsPerMinute: 4800,
      unitsPerFullGet: 60,
      maxDecodedBodyChars: 200000,
    },
    storage: {
      datasetId: 'inbox_intelligence',
      excerptChars: 4000,
      excerptRetentionDays: 30,
      maxBytesBilledPerQuery: 1073741824,
      renewAfterDays: 45,
      horizonMonths: 12,
      runsRetentionDays: 90,
      briefingsRetentionDays: 60,
      lifetimeLimitBytes: 10737418240,
      reserveFactor: 3,
      sandbox: true,
    },
    pipeline: {
      maxRuntimeMs: 270000,
      safetyMarginMs: 60000,
      triggerEveryHours: 1,
      maintenanceHour: 6,
      staleHeartbeatMs: 480000,
      dailyTriggerBudgetMin: 60,
    },
    ai: {
      provider: 'auto',
      sendPolicy: 'auto',
      batchSize: 4,
      maxBatchInputChars: 20000,
      concurrency: 3,
      maxAttempts: 2,
      excerptCharsForAi: 3000,
      maxRequestsPerRun: 12,
      maxCostUsdPerDay: 3,
      maxCostUsdPerMonth: 30,
      backfillDays: 30,
      circuitFailures: 3,
      circuitCooldownMinutes: 60,
      briefingMaxPerDay: 3,
      anthropic: {
        model: 'claude-opus-5-5',
        effort: 'low',
        batchSize: 2,
        maxTokens: 6000,
        apiVersion: '2026-10-21',
        priceInPerM: 4,
        priceOutPerM: 20,
        priceCacheReadPerM: 0.2,
      },
      gemini: {
        model: 'gemini-3.5-flash-lite',
        thinkingLevel: 'MINIMAL',
        maxOutputTokens: 8000,
        maxRequestsPerDay: 400,
        maxRequestsPerMinute: 10,
        priceInPerM: 0.3,
        priceOutPerM: 2.5,
      },
    },
    scoring: {
      weights: { importance: 0.28, urgency: 0.18, action: 0.18, opportunity: 0.12, sender: 0.1, novelty: 0.04, interest: 0.1 },
      thresholds: { critical: 0.72, high: 0.55, medium: 0.35 },
      criticalDailyCap: 3,
      criticalMinConfidence: 0.6,
      urgencyTauDays: 3,
      overdueRecentDays: 3,
      certaintyFactor: { EXPLICIT: 1, INFERRED: 0.6 },
      noDeadlineUrgencyFactor: 0.6,
      senderScores: { priority: 1, knownContact: 0.8, human: 0.4, automated: 0.15 },
      feedbackAffinityWeight: 0.2,
      noveltyScores: { normal: 1, recurringNewsletter: 0.6, duplicate: 0.3 },
      aiImportanceBlend: 0.7,
      infoWeights: { interest: 0.5, importance: 0.3, novelty: 0.2 },
      rulesImportanceBonus: { explicitDeadline: 0.15, important: 0.1, starred: 0.15, personalHuman: 0.05, promotions: -0.1, directHuman: 0.1, knownContact: 0.1 },
      noDeadlineUrgencyCap: 0.5,
      attentionMinUrgency: 0.4,
      criticalRecencyDays: 7,
    },
    tasks: { openDaysWithoutDeadline: 14, overdueAutoResolveDays: 3 },
    privacy: {
      // Domínios cujas mensagens nunca vão à IA nas políticas BROADCAST/REDACTED (além das categorias sensíveis).
      sensitiveDomains: ['gov.br', 'jus.br', 'accounts.google.com', 'id.apple.com', 'appleid.apple.com', 'accountprotection.microsoft.com'],
      sensitiveSubjectTerms: ['exame', 'laudo', 'resultado de exame', 'diagnostico', 'receita medica', 'senha', 'codigo de verificacao',
        'verification code', 'extrato', 'fatura', 'boleto', 'intimacao', 'processo judicial', 'holerite', 'contracheque'],
      // Notificadores que repassam mensagens privadas: nunca entram no BROADCAST.
      privateNotifierDomains: ['linkedin.com', 'facebookmail.com', 'instagram.com', 'mail.instagram.com', 'x.com', 'twitter.com', 'whatsapp.com',
        'slack.com', 'discord.com', 'github.com', 'gitlab.com', 'atlassian.net', 'notion.so', 'telegram.org', 'messenger.com', 'gupy.io'],
      discussionListDomains: ['googlegroups.com', 'groups.io', 'freelists.org', 'yahoogroups.com'],
    },
    profile: {
      interests: ['inteligencia artificial', 'machine learning', 'data science', 'ciencia de dados', 'python', 'pricing', 'precificacao',
        'financas', 'mercado financeiro', 'economia', 'analytics'],
      targetRoles: ['pricing', 'data scientist', 'cientista de dados', 'analytics', 'revenue management', 'financas', 'dados'],
      seniorityKeywords: ['senior', 'especialista', 'staff', 'principal', 'lead', 'lider', 'gerente', 'head', 'coordenador'],
      preferredWorkModes: ['remoto', 'hibrido'],
      prioritySenders: [],
      prioritySenderDomains: [],
      mutedSenders: [],
    },
    ui: { pageSize: 30, defaultPeriod: '7d', triageSecondsMin: 5, triageSecondsMax: 15, listCacheRows: 300 },
    categories: { disabled: [], extraKeywords: {}, extraSenderDomains: {}, custom: [] },
  };

  // ------------------------------------------------------- persistência ----
  var cache_ = null;

  function props_() {
    return PropertiesService.getScriptProperties();
  }

  function readOverrides() {
    var p = props_();
    var n = Number(p.getProperty(OVERRIDES_PREFIX + 'N') || 0);
    if (!n) return {};
    var s = '';
    for (var i = 0; i < n; i++) s += p.getProperty(OVERRIDES_PREFIX + i) || '';
    return Util.safeJsonParse(s, {});
  }

  function writeOverrides(obj) {
    var p = props_();
    var s = JSON.stringify(obj || {});
    var parts = Util.chunkString(s, OVERRIDES_CHUNK);
    var oldN = Number(p.getProperty(OVERRIDES_PREFIX + 'N') || 0);
    /** @type {Object<string, string>} */
    var map = {};
    for (var i = 0; i < parts.length; i++) map[OVERRIDES_PREFIX + i] = parts[i];
    map[OVERRIDES_PREFIX + 'N'] = String(parts.length);
    p.setProperties(map);
    for (var j = parts.length; j < oldN; j++) p.deleteProperty(OVERRIDES_PREFIX + j);
    cache_ = null;
  }

  /** Configuração efetiva (padrões + overrides), memoizada por execução. */
  function get() {
    if (cache_) return cache_;
    var merged = Util.deepMerge(DEFAULTS, readOverrides());
    cache_ = merged;
    return merged;
  }

  function reset() {
    cache_ = null;
  }

  /**
   * Valida e aplica um patch de configuração vindo da interface.
   * Somente chaves conhecidas são aceitas; números são limitados a faixas seguras.
   * @return {{ok: boolean, errors: string[]}}
   */
  function savePatch(patch) {
    var errors = validatePatch(patch);
    if (errors.length) return { ok: false, errors: errors };
    var current = readOverrides();
    writeOverrides(Util.deepMerge(current, patch));
    return { ok: true, errors: [] };
  }

  var NUMERIC_RANGES = {
    'gmail.accountIndex': [0, 9],
    'gmail.backfillDays': [1, 365],
    'storage.excerptChars': [0, 6000],
    'storage.excerptRetentionDays': [0, 365],
    'pipeline.triggerEveryHours': [1, 12],
    'pipeline.maintenanceHour': [0, 23],
    'ai.batchSize': [1, 8],
    'ai.anthropic.batchSize': [1, 5],
    'pipeline.dailyTriggerBudgetMin': [10, 85],
    'storage.horizonMonths': [3, 36],
    'ai.maxRequestsPerRun': [0, 40],
    'ai.maxCostUsdPerDay': [0, 50],
    'ai.maxCostUsdPerMonth': [0, 500],
    'ai.backfillDays': [0, 365],
    'ai.gemini.maxRequestsPerDay': [0, 10000],
    'scoring.criticalDailyCap': [0, 20],
    'scoring.thresholds.critical': [0, 1],
    'scoring.thresholds.high': [0, 1],
    'scoring.thresholds.medium': [0, 1],
    'ui.pageSize': [10, 100],
  };
  var ENUMS = {
    'ai.provider': ['auto', 'anthropic', 'gemini', 'none'],
    'ai.sendPolicy': ['auto', 'OFF', 'BROADCAST', 'REDACTED', 'FULL'],
    'ai.anthropic.effort': ['low', 'medium', 'high'],
    'ai.anthropic.model': ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    'ai.gemini.model': ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'],
    'ui.defaultPeriod': ['today', '7d', '30d'],
  };
  var STRING_LISTS = [
    'profile.interests', 'profile.targetRoles', 'profile.seniorityKeywords', 'profile.preferredWorkModes',
    'profile.prioritySenders', 'profile.prioritySenderDomains', 'profile.mutedSenders', 'categories.disabled',
    'privacy.sensitiveDomains', 'privacy.privateNotifierDomains',
  ];

  function flatten_(obj, prefix, out) {
    Object.keys(obj || {}).forEach(function (k) {
      var key = prefix ? prefix + '.' + k : k;
      var v = obj[k];
      if (Util.isPlainObject(v) && !/^(scoring\.weights|categories\.extraKeywords|categories\.extraSenderDomains)$/.test(key)) flatten_(v, key, out);
      else out[key] = v;
    });
    return out;
  }

  function validatePatch(patch) {
    var errors = [];
    if (!Util.isPlainObject(patch)) return ['Configuração inválida.'];
    var flat = flatten_(patch, '', {});
    Object.keys(flat).forEach(function (key) {
      var v = flat[key];
      if (NUMERIC_RANGES[key]) {
        var r = NUMERIC_RANGES[key];
        if (typeof v !== 'number' || isNaN(v) || v < r[0] || v > r[1]) errors.push(key + ' deve estar entre ' + r[0] + ' e ' + r[1] + '.');
      } else if (ENUMS[key]) {
        if (ENUMS[key].indexOf(v) < 0) errors.push(key + ' tem valor não permitido.');
      } else if (STRING_LISTS.indexOf(key) >= 0) {
        if (!Array.isArray(v) || v.length > 200 || v.some(function (x) { return typeof x !== 'string' || x.length > 120; })) errors.push(key + ' deve ser uma lista de textos curtos.');
      } else if (key === 'scoring.weights') {
        var sum = 0;
        var okKeys = Object.keys(DEFAULTS.scoring.weights);
        Object.keys(v || {}).forEach(function (wk) {
          if (okKeys.indexOf(wk) < 0 || typeof v[wk] !== 'number' || v[wk] < 0 || v[wk] > 1) errors.push('Peso inválido: ' + wk + '.');
        });
        okKeys.forEach(function (wk) {
          sum += typeof v[wk] === 'number' ? v[wk] : DEFAULTS.scoring.weights[wk];
        });
        if (Math.abs(sum - 1) > 0.011) errors.push('Os pesos do ranking devem somar 1 (soma atual: ' + Util.round(sum, 3) + ').');
      } else if (key === 'categories.extraKeywords' || key === 'categories.extraSenderDomains') {
        Object.keys(v || {}).forEach(function (cat) {
          var list = v[cat];
          if (!Array.isArray(list) || list.length > 200 || list.some(function (x) { return typeof x !== 'string' || x.length > 80; })) errors.push(key + '.' + cat + ' inválido.');
        });
      } else {
        errors.push('Chave de configuração não permitida: ' + key + '.');
      }
    });
    var t = (patch.scoring && patch.scoring.thresholds) || null;
    if (t) {
      var eff = Util.deepMerge(DEFAULTS.scoring.thresholds, t);
      if (!(eff.critical > eff.high && eff.high > eff.medium)) errors.push('Limiares devem obedecer crítica > alta > média.');
    }
    return errors;
  }

  // ---------------------------------------------------------- taxonomia ----
  /** Taxonomia efetiva: padrão + palavras/domínios extras − categorias desativadas. */
  function taxonomy() {
    var cfg = get();
    var disabled = cfg.categories.disabled || [];
    return TAXONOMY.filter(function (c) {
      return c.id === 'outros' || disabled.indexOf(c.id) < 0;
    }).map(function (c) {
      var copy = Util.deepClone(c);
      var extraKw = (cfg.categories.extraKeywords || {})[c.id] || [];
      var extraDom = (cfg.categories.extraSenderDomains || {})[c.id] || [];
      copy.keywords.strong = copy.keywords.strong.concat(extraKw);
      copy.senderDomains = copy.senderDomains.concat(extraDom);
      return copy;
    });
  }

  function categoryIds() {
    return taxonomy().map(function (c) {
      return c.id;
    });
  }

  function category(id) {
    var list = taxonomy();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** Hash curto de tudo o que influencia classificação e ranking. */
  function configVersion() {
    var cfg = get();
    return Util.shortHash(JSON.stringify({ c: CLASSIFIER_VERSION, s: cfg.scoring, p: cfg.profile, k: cfg.categories }), 10);
  }

  // ----------------------------------------------------------- segredos ----
  function secret(name) {
    var key = SECRET_KEYS[name];
    if (!key) throw new Error('Segredo desconhecido: ' + name);
    var v = props_().getProperty(key);
    return v ? String(v).trim() : '';
  }

  function setSecret(name, value) {
    var key = SECRET_KEYS[name];
    if (!key) throw new Error('Segredo desconhecido: ' + name);
    if (value === null || value === undefined || value === '') props_().deleteProperty(key);
    else props_().setProperty(key, String(value).trim());
  }

  function projectId() {
    return secret('projectId');
  }

  function datasetId() {
    return get().storage.datasetId;
  }

  function bqLocation() {
    return secret('bqLocation') || 'US';
  }

  return {
    APP_VERSION: APP_VERSION,
    CLASSIFIER_VERSION: CLASSIFIER_VERSION,
    PARSER_VERSION: PARSER_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULTS: DEFAULTS,
    TAXONOMY: TAXONOMY,
    get: get,
    reset: reset,
    readOverrides: readOverrides,
    savePatch: savePatch,
    validatePatch: validatePatch,
    taxonomy: taxonomy,
    categoryIds: categoryIds,
    category: category,
    configVersion: configVersion,
    secret: secret,
    setSecret: setSecret,
    projectId: projectId,
    datasetId: datasetId,
    bqLocation: bqLocation,
  };
})();
