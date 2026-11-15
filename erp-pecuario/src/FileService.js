/**
 * FileService — porta de arquivos (FileStore) sobre o serviço avançado Drive v3 e os comandos de anexo.
 *
 * Regra do escopo drive.file (01, seção 4.4): todo arquivo nasce pelo Drive v3 (Drive.Files.create / copy / update);
 * o app só enxerga o que ele mesmo criou. Os bytes de um arquivo são lidos pela rota REST `alt=media` (UrlFetchApp
 * com o token do script), nunca por DriveApp. Pastas: `ERP Pecuário` e, dentro dela, `Backups`, `Exportações`,
 * `Anexos` e `Testes`; os IDs ficam em Script Properties (`DRIVE_FOLDERS`) e são reencontrados ou recriados.
 *
 * Anexos (03a, seção 5.1): o arquivo vai ao Drive ANTES do comando (o Drive não participa do commit); a linha de
 * ANEXOS nasce na fase C do comando, por auditoria. Arquivo cujo comando não confirmou fica sem linha e é levado à
 * lixeira pela limpeza diária (Maintenance). Status: TEMPORARIO (aguarda o comando dono) → ATIVO → REMOVIDO.
 * Anexo de evento ou de lançamento financeiro de evento leva o event_id: vale enquanto o evento vale e, estornado ou
 * corrigido o evento, continua consultável como histórico (a correção passa os anexos ao substituto).
 */
var FileService = (function () {
  var MIME_PASTA = 'application/vnd.google-apps.folder';
  var MIME_PLANILHA = 'application/vnd.google-apps.spreadsheet';
  var PROP_PASTAS = 'DRIVE_FOLDERS';
  var URL_ARQUIVOS = 'https://www.googleapis.com/drive/v3/files/';
  var PASTAS = Object.freeze({ raiz: 'ERP Pecuário', backups: 'Backups', exportacoes: 'Exportações', anexos: 'Anexos', testes: 'Testes' });
  var SUBPASTAS = Object.freeze(['backups', 'exportacoes', 'anexos', 'testes']);
  var CAMPOS_LISTA = 'nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,appProperties,size,trashed,parents)';
  var CAMPOS_ARQUIVO = 'id,name,mimeType,createdTime,modifiedTime,appProperties,size,trashed,parents';
  /** Teto do arquivo de anexo (bytes): a foto chega reduzida no cliente (~300 KB); documento até este tamanho. */
  var TAMANHO_MAX_ANEXO = 5 * 1024 * 1024;
  /**
   * Donos de anexo por comando próprio (03a, seção 5.1: basta aceitar o nome da aba). FINANCEIRO = lançamento de um
   * evento (o boleto do frete, a nota da comissão), ligado pelo event_id do evento que o criou.
   */
  var ENTIDADES_ANEXO = Object.freeze(['ANIMAIS', 'EVENTOS', 'FINANCEIRO', 'IMPORTACOES']);
  /** Tipos de arquivo aceitos em anexo de animal, evento e lançamento: a foto chega em JPEG (reduzida no aparelho); documento em PDF. */
  var MIME_ANEXO = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
  /** Situações do evento em que o anexo ligado a ele é consultável: vale, ou já não vale mas é história. */
  var SITUACOES_HISTORICO = Object.freeze(['CONFIRMADO', 'ESTORNADO', 'CANCELADO']);
  var CODIFICACOES = Object.freeze({ 'UTF-8': 'UTF-8', UTF8: 'UTF-8', 'ISO-8859-1': 'ISO-8859-1', LATIN1: 'ISO-8859-1', 'WINDOWS-1252': 'windows-1252', CP1252: 'windows-1252', 'US-ASCII': 'US-ASCII' });
  var LEITURAS_ANEXO = Object.freeze(['ANEXOS', 'ANIMAIS', 'EVENTOS', 'FINANCEIRO', 'IMPORTACOES']);

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function interno_(mensagem) {
    return Validation.erro('INTERNAL', mensagem);
  }
  function texto_(e) {
    return String(e && e.message ? e.message : e);
  }
  /** Erro de serviço do Drive: 404 (fora do alcance do drive.file) vira null para quem pergunta "existe?". */
  function naoEncontrado_(e) {
    var m = texto_(e);
    return (e && e.details && e.details.code === 404) || /not ?found|404/i.test(m);
  }
  /** Literal de texto na consulta `q` do Drive (aspas simples e barra invertida escapadas). */
  function literal_(s) {
    return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  }
  function semDrive_(e, acao) {
    var erro = Validation.erro('CONFIG', 'O sistema não conseguiu ' + acao + ' no Google Drive. Se isso se repetir, autorize o acesso completo ao Drive (escopo "drive") conforme o guia de implantação.');
    erro.causa = texto_(e);
    return erro;
  }

  // ------------------------------------------------------------------ porta FileStore ----
  /**
   * Porta de arquivos de uma execução. Lê e grava `DRIVE_FOLDERS` em Script Properties; as pastas são conferidas
   * na primeira vez que alguém as pede e memorizadas até o fim da execução.
   */
  function porta() {
    var pastasMemo = null;

    function obter(fileId) {
      if (vazio_(fileId)) return null;
      try {
        return Drive.Files.get(fileId, { fields: CAMPOS_ARQUIVO });
      } catch (e) {
        if (naoEncontrado_(e)) return null;
        throw e;
      }
    }
    function pastaValida_(id, paiId) {
      var f = obter(id);
      return !!f && f.mimeType === MIME_PASTA && f.trashed !== true && (!paiId || (f.parents || []).indexOf(paiId) >= 0);
    }
    function acharPasta_(nome, paiId) {
      var q = 'name = ' + literal_(nome) + ' and mimeType = ' + literal_(MIME_PASTA) + ' and trashed = false and ' + literal_(paiId) + ' in parents';
      var r = Drive.Files.list({ q: q, orderBy: 'createdTime', pageSize: 10, fields: CAMPOS_LISTA });
      var f = (r.files || [])[0];
      return f ? f.id : null;
    }
    function criarPasta_(nome, paiId) {
      return Drive.Files.create({ name: nome, mimeType: MIME_PASTA, parents: [paiId], appProperties: { erp_tipo: 'PASTA' } }).id;
    }
    /**
     * Garante as cinco pastas (reencontra pelo ID guardado, depois pelo nome; senão cria). Devolve
     * {raiz, backups, exportacoes, anexos, testes, criadas: [nomes]}.
     */
    function garantirPastas() {
      var store = PropertiesService.getScriptProperties();
      var guardadas = {};
      try {
        guardadas = JSON.parse(store.getProperty(PROP_PASTAS) || '{}') || {};
      } catch (e) {
        // Propriedade ilegível: as pastas são reencontradas pelo nome (ou recriadas) e a propriedade é regravada.
        console.error('FileService: ' + PROP_PASTAS + ' ilegível, pastas reencontradas pelo nome: ' + texto_(e));
        guardadas = {};
      }
      var criadas = [];
      var ids = {};
      try {
        ids.raiz = pastaValida_(guardadas.raiz, null) ? guardadas.raiz : acharPasta_(PASTAS.raiz, 'root');
        if (!ids.raiz) { ids.raiz = criarPasta_(PASTAS.raiz, 'root'); criadas.push(PASTAS.raiz); }
        SUBPASTAS.forEach(function (k) {
          ids[k] = pastaValida_(guardadas[k], ids.raiz) ? guardadas[k] : acharPasta_(PASTAS[k], ids.raiz);
          if (!ids[k]) { ids[k] = criarPasta_(PASTAS[k], ids.raiz); criadas.push(PASTAS.raiz + '/' + PASTAS[k]); }
        });
      } catch (e) {
        if (Validation.ehAppError(e)) throw e;
        throw semDrive_(e, 'criar ou encontrar as pastas do sistema');
      }
      var json = JSON.stringify(ids);
      if (json !== JSON.stringify(guardadas)) store.setProperty(PROP_PASTAS, json);
      pastasMemo = ids;
      var out = Utils.clonar(ids);
      out.criadas = criadas;
      return out;
    }
    function pastas() {
      if (!pastasMemo) garantirPastas();
      return Utils.clonar(pastasMemo);
    }
    function pastaId_(pasta) {
      var p = pastas();
      if (vazio_(pasta)) return p.raiz;
      if (p[pasta]) return p[pasta];
      throw interno_('Pasta desconhecida: ' + pasta + '.');
    }
    /** Planilha nova pelo Drive v3 (nunca SpreadsheetApp.create). pasta: raiz | testes | ... Devolve o id. */
    function criarPlanilha(nome, pasta, appProperties) {
      return Drive.Files.create({ name: nome, mimeType: MIME_PLANILHA, parents: [pastaId_(pasta)], appProperties: appProperties || {} }).id;
    }
    /** Cópia pelo Drive v3. o: {nome, pasta, appProperties, descricao}. Devolve {id, name, createdTime, appProperties}. */
    function copiar(fileId, o) {
      var op = o || {};
      var r = { name: op.nome, parents: [pastaId_(op.pasta)] };
      if (op.appProperties) r.appProperties = op.appProperties;
      if (!vazio_(op.descricao)) r.description = op.descricao;
      var f = Drive.Files.copy(r, fileId, { fields: CAMPOS_ARQUIVO });
      return { id: f.id, name: f.name, createdTime: f.createdTime, appProperties: f.appProperties || {} };
    }
    /** Manda para a lixeira do Drive (recuperável pelo dono por 30 dias). Arquivo que já não existe: false. */
    function lixeira(fileId) {
      try {
        Drive.Files.update({ trashed: true }, fileId);
        return true;
      } catch (e) {
        if (naoEncontrado_(e)) return false;
        throw e;
      }
    }
    /**
     * Arquivos de uma pasta (fora da lixeira), todas as páginas. filtro: {appProperties: {k: v}, criadoAntesDe (ISO),
     * mimeType}. Devolve [{id, name, mimeType, createdTime, modifiedTime, appProperties, size}].
     */
    function listar(pasta, filtro) {
      var f = filtro || {};
      var partes = [literal_(pastaId_(pasta)) + ' in parents', 'trashed = false'];
      Object.keys(f.appProperties || {}).forEach(function (k) {
        partes.push('appProperties has { key=' + literal_(k) + ' and value=' + literal_(f.appProperties[k]) + ' }');
      });
      if (!vazio_(f.criadoAntesDe)) partes.push('createdTime < ' + literal_(f.criadoAntesDe));
      if (!vazio_(f.mimeType)) partes.push('mimeType = ' + literal_(f.mimeType));
      var out = [];
      var token = null;
      for (var guarda = 0; guarda < 1000; guarda++) {
        var args = { q: partes.join(' and '), orderBy: 'createdTime', pageSize: 200, fields: CAMPOS_LISTA };
        if (token) args.pageToken = token;
        var r = Drive.Files.list(args);
        (r.files || []).forEach(function (x) {
          out.push({ id: x.id, name: x.name, mimeType: x.mimeType, createdTime: x.createdTime, modifiedTime: x.modifiedTime, appProperties: x.appProperties || {}, size: vazio_(x.size) ? null : Number(x.size) });
        });
        token = r.nextPageToken || null;
        if (!token) break;
      }
      return out;
    }
    function bytesDeBase64_(base64, campo) {
      if (typeof base64 !== 'string' || base64 === '') throw Validation.erro('VALIDATION', 'O arquivo chegou vazio.', [Validation.detalhe({ codigo: 'CAMPO_OBRIGATORIO', campo: campo, mensagem: 'Envie o arquivo de novo.' })]);
      try {
        return Utilities.base64Decode(base64);
      } catch (e) {
        throw Validation.erro('VALIDATION', 'O arquivo chegou corrompido. Envie de novo.', [Validation.detalhe({ codigo: 'FORMATO_INVALIDO', campo: campo, mensagem: 'Conteúdo do arquivo ilegível.' })]);
      }
    }
    /**
     * Grava um arquivo novo. a: {nome, mimeType, base64 | texto, pasta, appProperties}. Devolve {id, tamanho}.
     */
    function guardarArquivo(a) {
      var bytes = typeof a.texto === 'string' ? Utilities.newBlob(a.texto, a.mimeType, a.nome).getBytes() : bytesDeBase64_(a.base64, 'arquivo');
      var blob = Utilities.newBlob(bytes, a.mimeType, a.nome);
      var f = Drive.Files.create({ name: a.nome, mimeType: a.mimeType, parents: [pastaId_(a.pasta)], appProperties: a.appProperties || {} }, blob, { fields: 'id' });
      return { id: f.id, tamanho: bytes.length };
    }
    /**
     * Arquivo de anexo (e a miniatura, se vier) na pasta Anexos. a: {nome, mimeType, base64, miniaturaBase64,
     * appProperties}. Devolve {drive_file_id, thumb_drive_file_id, tamanho_bytes}. Se a miniatura falhar, o
     * principal vai para a lixeira antes de o erro subir.
     */
    function guardarAnexo(a) {
      var principal = guardarArquivo({ nome: a.nome, mimeType: a.mimeType, base64: a.base64, pasta: 'anexos', appProperties: a.appProperties });
      if (principal.tamanho > TAMANHO_MAX_ANEXO) {
        lixeira(principal.id);
        throw Validation.erro('VALIDATION', 'O arquivo tem ' + Math.ceil(principal.tamanho / 1024) + ' KB; o limite é ' + TAMANHO_MAX_ANEXO / 1024 / 1024 + ' MB.');
      }
      var thumb = null;
      if (!vazio_(a.miniaturaBase64)) {
        try {
          thumb = guardarArquivo({ nome: 'miniatura-' + a.nome, mimeType: 'image/jpeg', base64: a.miniaturaBase64, pasta: 'anexos', appProperties: Utils.clonar(a.appProperties || {}) }).id;
        } catch (e) {
          lixeira(principal.id);
          throw e;
        }
      }
      return { drive_file_id: principal.id, thumb_drive_file_id: thumb, tamanho_bytes: principal.tamanho };
    }
    /**
     * Bytes de um arquivo pela rota REST alt=media. Devolve {base64, mimeType, tamanho}. Arquivo inexistente ou fora
     * do alcance do app → NOT_FOUND; outra falha do Drive → INTERNAL com a causa.
     */
    function lerBytes(fileId) {
      var resp = UrlFetchApp.fetch(URL_ARQUIVOS + encodeURIComponent(fileId) + '?alt=media', {
        method: 'get', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
      });
      var codigo = resp.getResponseCode();
      if (codigo === 404) throw Validation.erro('NOT_FOUND', 'O arquivo não foi encontrado no Google Drive (pode ter sido apagado).');
      if (codigo !== 200) {
        var e = interno_('O Google Drive não entregou o arquivo (código ' + codigo + '). Tente de novo em instantes.');
        e.causa = resp.getContentText().slice(0, 300);
        throw e;
      }
      var bytes = resp.getContent();
      var cabecalhos = resp.getHeaders() || {};
      return { base64: Utilities.base64Encode(bytes), mimeType: cabecalhos['Content-Type'] || cabecalhos['content-type'] || null, tamanho: bytes.length };
    }
    /** Texto de um arquivo enviado em base64, na codificação informada (UTF-8, ISO-8859-1, Windows-1252). */
    function textoDeBase64(base64, codificacao) {
      var cs = CODIFICACOES[String(codificacao || 'UTF-8').toUpperCase()];
      if (!cs) throw Validation.erro('VALIDATION', 'Codificação de arquivo desconhecida: ' + codificacao + '. Use UTF-8 ou ISO-8859-1 (Latin-1).', [Validation.detalhe({ codigo: 'VALOR_FORA_DA_LISTA', campo: 'codificacao', mensagem: 'Codificação desconhecida.' })]);
      var texto = Utilities.newBlob(bytesDeBase64_(base64, 'arquivo')).getDataAsString(cs);
      return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
    }
    /**
     * Sonda as operações do Drive de que o sistema depende (SP-02): cria, copia, lê os bytes, lista e manda para a
     * lixeira um arquivo de teste na pasta Testes. Devolve {ok, passos: [{passo, ok, erro}]}.
     */
    function sondar() {
      var passos = [];
      var criados = [];
      function passo(nome, fn) {
        try {
          var r = fn();
          passos.push({ passo: nome, ok: true, erro: null });
          return r;
        } catch (e) {
          passos.push({ passo: nome, ok: false, erro: texto_(e).slice(0, 300) });
          return null;
        }
      }
      var marca = { erp_tipo: 'SONDA' };
      var a = passo('criar', function () { return guardarArquivo({ nome: 'sonda-erp.txt', mimeType: 'text/plain', texto: 'sonda', pasta: 'testes', appProperties: marca }).id; });
      if (a) criados.push(a);
      var c = a ? passo('copiar', function () { return copiar(a, { nome: 'sonda-erp-copia.txt', pasta: 'testes', appProperties: marca }).id; }) : null;
      if (c) criados.push(c);
      if (a) passo('ler', function () { if (lerBytes(a).tamanho !== 5) throw new Error('conteúdo divergente'); return true; });
      if (a) passo('listar', function () { if (!listar('testes', { appProperties: marca }).some(function (f) { return f.id === a; })) throw new Error('arquivo criado não aparece na listagem'); return true; });
      criados.forEach(function (id) { passo('lixeira', function () { return lixeira(id); }); });
      return { ok: passos.every(function (p) { return p.ok; }) && !!a, passos: passos };
    }
    return {
      PASTAS: PASTAS,
      garantirPastas: garantirPastas,
      pastas: pastas,
      obter: obter,
      criarPlanilha: criarPlanilha,
      copiar: copiar,
      lixeira: lixeira,
      listar: listar,
      guardarArquivo: guardarArquivo,
      guardarAnexo: guardarAnexo,
      lerBytes: lerBytes,
      textoDeBase64: textoDeBase64,
      sondar: sondar,
    };
  }

  // ------------------------------------------------------------------ comandos de anexo ----
  function exigirFiles_(ctx) {
    if (!ctx || !ctx.files) throw interno_('Contexto de execução sem a porta de arquivos (files).');
    return ctx.files;
  }
  function erroCampo_(campo, codigo, mensagem) {
    return Validation.detalhe({ codigo: codigo, campo: campo, mensagem: mensagem });
  }
  function recusa_(campo, codigo, mensagem) {
    return Validation.erro('VALIDATION', mensagem, [erroCampo_(campo, codigo, mensagem)]);
  }
  function ehImagem_(mime) {
    return /^image\//i.test(String(mime || ''));
  }
  /** Linha de ANEXOS como está na planilha (tx com acesso cru) ou, sem ele, a vigente. */
  function linha_(tx, id) {
    if (vazio_(id)) return null;
    return tx.cru ? tx.cru.cruPorId('ANEXOS', id) : tx.repo.porId('ANEXOS', id);
  }
  /**
   * O anexo pode ser consultado: a linha existe, não foi removida e, se ligada a um evento (event_id), a operação do
   * evento foi confirmada — ele vale (CONFIRMADO) ou já não vale (ESTORNADO, CANCELADO) e é história. Linha inerte de
   * uma gravação que falhou, ou ainda pendente, não existe para ninguém. `cru`: fachada de leitura crua.
   */
  function consultavel_(cru, a) {
    if (!a || a.status === 'REMOVIDO') return false;
    return vazio_(a.event_id) || SITUACOES_HISTORICO.indexOf(cru.avaliar(a.event_id).status) >= 0;
  }
  /** O anexo vale hoje: não removido e, se ligado a evento, o evento é vigente (02, seção 5: linha filha). */
  function vigente_(cru, a) {
    return !!a && a.status !== 'REMOVIDO' && (vazio_(a.event_id) || cru.avaliar(a.event_id).vigente === true);
  }
  /**
   * Dono de um anexo enviado por comando próprio (tx com acesso cru). Devolve {event_id}: o evento (EVENTOS) ou o evento
   * que criou o lançamento (FINANCEIRO); vazio nos demais. Inexistente, de gravação que falhou ou animal anulado →
   * NOT_FOUND; evento ou lançamento que já não vale → VALIDATION `JA_ANULADO`; estorno → `ESTORNO_SEM_ANEXO`.
   */
  function donoDoAnexo_(tx, entidade, id) {
    var sumiu = function () { return Validation.erro('NOT_FOUND', 'O registro a que você quer anexar o arquivo não existe mais. Atualize a tela.'); };
    if (entidade === 'ANIMAIS') {
      var animal = tx.repo.porId('ANIMAIS', id);
      if (!animal || animal.situacao_cadastral === 'ANULADO') throw sumiu();
      return { event_id: null };
    }
    if (entidade === 'EVENTOS' || entidade === 'FINANCEIRO') {
      var fin = entidade === 'FINANCEIRO' ? tx.cru.cruPorId('FINANCEIRO', id) : null;
      var eventId = entidade === 'EVENTOS' ? id : fin ? fin.event_id : null;
      var ev = vazio_(eventId) ? null : tx.cru.cruPorId('EVENTOS', eventId);
      var av = ev ? tx.cru.avaliar(eventId) : null;
      if (!ev || av.status === 'FALHOU' || av.status === 'PENDENTE') throw sumiu();
      if (ev.event_type === 'ESTORNO') throw recusa_('entity_id', 'ESTORNO_SEM_ANEXO', 'Um estorno não recebe arquivos: anexe ao lançamento que vale.');
      if (!av.vigente) {
        throw recusa_('entity_id', 'JA_ANULADO', (entidade === 'FINANCEIRO' ? 'Este lançamento financeiro foi cancelado' : 'Este lançamento foi estornado ou corrigido') +
          ' e não vale mais: os arquivos dele ficam guardados como histórico. Anexe o arquivo ao lançamento que vale.');
      }
      return { event_id: eventId };
    }
    if (!tx.repo.porId(entidade, id)) throw sumiu();
    return { event_id: null };
  }
  /**
   * Forma pública de uma linha de ANEXOS. `vigente` (opcional): o anexo vale hoje (false: é de um evento estornado
   * ou corrigido, guardado como histórico); sem o argumento, vale o que diz o status.
   */
  function anexoPublico_(a, vigente) {
    return a ? {
      anexo_id: a.anexo_id, entidade: a.entidade, entity_id: a.entity_id, event_id: a.event_id || null,
      financial_id: a.entidade === 'FINANCEIRO' ? a.entity_id : null, nome_arquivo: a.nome_arquivo,
      mime_type: a.mime_type, tamanho_bytes: a.tamanho_bytes, tipo: a.tipo, descricao: a.descricao || null, status: a.status,
      tem_miniatura: !vazio_(a.thumb_drive_file_id), vigente: vigente === undefined ? a.status !== 'REMOVIDO' : vigente === true,
      created_by: a.created_by, created_at: a.created_at,
    } : null;
  }
  /** Leva à lixeira, sem interromper quem chama; falha vira ERROS_LOG (a limpeza diária tenta de novo). */
  function lixeiraAnotada_(ctx, ids, contexto) {
    (ids || []).forEach(function (id) {
      if (vazio_(id)) return;
      try {
        ctx.files.lixeira(id);
      } catch (e) {
        UnitOfWork.anotarErro(ctx, { contexto: contexto, codigo: 'LIXEIRA_FALHOU', mensagem: 'Arquivo ' + id + ' não foi para a lixeira: ' + texto_(e), erro: e });
      }
    });
  }
  /** Problemas de forma do envio (antes de qualquer upload): [detalhe]. */
  function problemasDoEnvio_(d) {
    var problemas = [];
    if (ENTIDADES_ANEXO.indexOf(d.entidade) < 0) problemas.push(erroCampo_('entidade', 'VALOR_FORA_DA_LISTA', 'Diga a que o arquivo pertence: animal, evento, lançamento financeiro ou importação.'));
    if (vazio_(d.entity_id)) problemas.push(erroCampo_('entity_id', 'CAMPO_OBRIGATORIO', 'Diga de qual registro é o arquivo.'));
    if (Schema.enumValores('TIPO_ANEXO').indexOf(d.tipo) < 0) problemas.push(erroCampo_('tipo', 'VALOR_FORA_DA_LISTA', 'Escolha o tipo do arquivo (foto, documento ou laudo, GTA, nota fiscal ou outro).'));
    if (vazio_(d.nome_arquivo) || typeof d.nome_arquivo !== 'string') problemas.push(erroCampo_('nome_arquivo', 'CAMPO_OBRIGATORIO', 'O arquivo chegou sem nome.'));
    var mimeLegivel = !vazio_(d.mime_type) && /^[\w.+-]+\/[\w.+-]+$/.test(String(d.mime_type));
    if (!mimeLegivel) problemas.push(erroCampo_('mime_type', 'FORMATO_INVALIDO', 'Tipo de arquivo não reconhecido.'));
    else if (d.entidade !== 'IMPORTACOES' && MIME_ANEXO.indexOf(String(d.mime_type).toLowerCase()) < 0) {
      problemas.push(erroCampo_('mime_type', 'TIPO_ARQUIVO_INVALIDO', 'Este tipo de arquivo não é aceito: envie uma foto (JPG, PNG, WEBP ou GIF) ou um documento em PDF.'));
    } else if (d.tipo === 'FOTO' && !ehImagem_(d.mime_type)) {
      problemas.push(erroCampo_('tipo', 'TIPO_ARQUIVO_INVALIDO', 'Uma foto precisa ser uma imagem. Para um PDF, escolha documento ou laudo, GTA ou nota fiscal.'));
    }
    if (typeof d.conteudo_base64 !== 'string' || d.conteudo_base64 === '') problemas.push(erroCampo_('conteudo_base64', 'CAMPO_OBRIGATORIO', 'O arquivo chegou vazio. Envie de novo.'));
    if (d.definir_como_foto === true && (d.entidade !== 'ANIMAIS' || d.tipo !== 'FOTO')) problemas.push(erroCampo_('definir_como_foto', 'CAMPO_NAO_SE_APLICA', 'Só uma foto de animal pode virar a foto da ficha.'));
    return problemas;
  }
  /**
   * anexo.adicionar. pedido: {idempotencyKey, dados: {entidade (ANIMAIS|EVENTOS|FINANCEIRO|IMPORTACOES), entity_id, tipo
   * (TIPO_ANEXO), descricao, nome_arquivo, mime_type, conteudo_base64, miniatura_base64, temporario (S: aguarda o
   * comando dono), definir_como_foto (animal)}}. Anexo de evento (nota fiscal, GTA, laudo, foto) leva o `event_id` do
   * evento; anexo de lançamento financeiro (FINANCEIRO), o do evento que o criou (compra, venda...): vale enquanto o
   * evento vale. O arquivo vai ao Drive antes do comando; se o comando não confirmar, vai para a lixeira. Reenvio com
   * a mesma chave não sobe o arquivo de novo.
   * Devolve {dados: anexo, duplicado, opId, dataVersion}. Erros: VALIDATION, NOT_FOUND, os da UnitOfWork.
   */
  function adicionarAnexo(ctx, pedido) {
    var files = exigirFiles_(ctx);
    var p = pedido || {};
    var d = p.dados || {};
    var problemas = problemasDoEnvio_(d);
    if (problemas.length) throw Validation.erro('VALIDATION', problemas.length === 1 ? problemas[0].mensagem : 'Há ' + problemas.length + ' problemas no envio do arquivo.', problemas);
    var tamanhoAprox = Math.floor(d.conteudo_base64.length * 3 / 4);
    if (tamanhoAprox > TAMANHO_MAX_ANEXO + 3) throw Validation.erro('VALIDATION', 'O arquivo passa do limite de ' + TAMANHO_MAX_ANEXO / 1024 / 1024 + ' MB. Reduza a imagem ou divida o documento.');
    // O que entra no hash de idempotência: metadados + resumo do conteúdo (o reenvio idêntico é reconhecido).
    var dados = {
      entidade: d.entidade, entity_id: String(d.entity_id), tipo: d.tipo, descricao: vazio_(d.descricao) ? null : String(d.descricao),
      nome_arquivo: d.nome_arquivo, mime_type: d.mime_type, temporario: d.temporario === true, definir_como_foto: d.definir_como_foto === true,
      conteudo_sha256: ctx.hash.sha256Hex(d.conteudo_base64), miniatura_sha256: vazio_(d.miniatura_base64) ? null : ctx.hash.sha256Hex(d.miniatura_base64),
    };
    var comando = {
      // Lê só o dono (e EVENTOS, de que a vigência do anexo depende): FINANCEIRO, por exemplo, só para anexo de lançamento.
      rota: 'anexo.adicionar', idempotencyKey: p.idempotencyKey, dados: dados, avisosAceitos: p.avisosAceitos, reads: Utils.unicos(['ANEXOS', 'EVENTOS', d.entidade]), acessoCru: true,
      reconstruir: function (tx, op) { var a = linha_(tx, op.resumo.anexo_id); return anexoPublico_(a, a ? vigente_(tx.cru, a) : undefined); },
      tratador: null,
    };
    if (!vazio_(p.idempotencyKey) && UnitOfWork.status(ctx, p.idempotencyKey).situacao === 'CONFIRMADA') {
      comando.tratador = function () { throw interno_('Operação já confirmada: a UnitOfWork devolve o resultado gravado.'); };
      return UnitOfWork.run(ctx, comando);
    }
    var arq = files.guardarAnexo({
      nome: d.nome_arquivo, mimeType: d.mime_type, base64: d.conteudo_base64, miniaturaBase64: d.miniatura_base64,
      appProperties: { erp_tipo: 'ANEXO', erp_banco: ctx.banco, erp_entidade: d.entidade, erp_entity_id: String(d.entity_id) },
    });
    comando.tratador = function (tx) {
      var x = tx.dados;
      var dono = donoDoAnexo_(tx, x.entidade, x.entity_id);
      var id = tx.novoId();
      var campos = {
        entidade: x.entidade, entity_id: x.entity_id, event_id: dono.event_id, drive_file_id: arq.drive_file_id,
        thumb_drive_file_id: arq.thumb_drive_file_id, nome_arquivo: x.nome_arquivo, mime_type: x.mime_type, tamanho_bytes: arq.tamanho_bytes,
        tipo: x.tipo, descricao: x.descricao, status: x.temporario ? 'TEMPORARIO' : 'ATIVO', created_by: tx.usuario, created_at: tx.agora,
      };
      var erros = Validation.validarRegistro('ANEXOS', Object.assign({ anexo_id: id }, campos));
      if (erros.length) return { erros: erros };
      AuditService.criacao(tx, 'ANEXOS', id, campos);
      if (x.definir_como_foto) AuditService.alteracao(tx, 'ANIMAIS', x.entity_id, { foto_anexo_id: id });
      return {
        resumo: { anexo_id: id, entidade: x.entidade, entity_id: x.entity_id, event_id: dono.event_id },
        resposta: function (t) { var a = linha_(t, id); return anexoPublico_(a, a ? vigente_(t.cru, a) : undefined); },
      };
    };
    var r;
    try {
      r = UnitOfWork.run(ctx, comando);
    } catch (e) {
      // Só vai para a lixeira o arquivo cuja operação com certeza não vale; na dúvida fica, e a limpeza diária
      // decide pela planilha (arquivo sem linha em ANEXOS).
      var situacao = 'DESCONHECIDA';
      try {
        situacao = vazio_(p.idempotencyKey) ? 'INEXISTENTE' : UnitOfWork.status(ctx, p.idempotencyKey).situacao;
      } catch (e2) {
        UnitOfWork.anotarErro(ctx, { contexto: 'anexo.adicionar', codigo: 'ESTADO_INCERTO', mensagem: 'Estado da operação do anexo não pôde ser lido: ' + texto_(e2), erro: e2 });
      }
      if (situacao === 'FALHOU' || situacao === 'INEXISTENTE') lixeiraAnotada_(ctx, [arq.drive_file_id, arq.thumb_drive_file_id], 'anexo.adicionar');
      UnitOfWork.descarregarErros(ctx);
      throw e;
    }
    if (r.duplicado) {
      lixeiraAnotada_(ctx, [arq.drive_file_id, arq.thumb_drive_file_id], 'anexo.adicionar');
      UnitOfWork.descarregarErros(ctx);
    }
    return r;
  }
  /**
   * Promove anexos TEMPORARIO a ATIVO dentro do tratador do comando dono (o anexo precisa estar em reads).
   * Devolve quantos mudaram. Anexo inexistente ou já removido → VALIDATION.
   */
  function promover(tx, anexoIds) {
    var n = 0;
    (anexoIds || []).forEach(function (id) {
      var a = tx.repo.porId('ANEXOS', id);
      if (!a || a.status === 'REMOVIDO') throw Validation.erro('VALIDATION', 'Um dos arquivos anexados não está mais disponível. Envie o arquivo de novo.');
      if (a.status === 'TEMPORARIO') n += AuditService.alteracao(tx, 'ANEXOS', id, { status: 'ATIVO' });
    });
    return n;
  }
  /** Arquivos do Drive ainda usados por alguma linha consultável de ANEXOS, fora as linhas `exceto`: {drive_file_id: true}. */
  function arquivosEmUso_(cru, exceto) {
    var usados = {};
    cru.cru('ANEXOS').forEach(function (x) {
      if ((exceto || []).indexOf(x.anexo_id) >= 0 || !consultavel_(cru, x)) return;
      [x.drive_file_id, x.thumb_drive_file_id].forEach(function (f) { if (!vazio_(f)) usados[f] = true; });
    });
    return usados;
  }
  /**
   * anexo.remover. pedido: {idempotencyKey, dados: {anexo_id, justificativa (obrigatória)}}. A linha fica (REMOVIDO,
   * com a justificativa na auditoria); o arquivo vai para a lixeira do Drive depois do commit, salvo se outra linha
   * ainda o usa (o histórico de um evento corrigido guarda o mesmo arquivo); se for a foto da ficha, a ficha fica sem
   * foto. Arquivo de evento estornado ou corrigido não se remove: é histórico (`JA_ANULADO`). Já removido →
   * `JA_REMOVIDO`; sem justificativa → `CAMPO_OBRIGATORIO`; inexistente → NOT_FOUND.
   */
  function removerAnexo(ctx, pedido) {
    exigirFiles_(ctx);
    var p = pedido || {};
    var r = UnitOfWork.run(ctx, {
      rota: 'anexo.remover', idempotencyKey: p.idempotencyKey, dados: p.dados || {}, reads: ['ANEXOS', 'ANIMAIS', 'EVENTOS'], acessoCru: true,
      tratador: function (tx) {
        var a = linha_(tx, tx.dados.anexo_id);
        if (!a || (a.status !== 'REMOVIDO' && !consultavel_(tx.cru, a))) throw Validation.erro('NOT_FOUND', 'O arquivo não foi encontrado. Atualize a tela.');
        if (a.status === 'REMOVIDO') return { erros: [erroCampo_('anexo_id', 'JA_REMOVIDO', 'Este arquivo já foi removido.')] };
        if (!vigente_(tx.cru, a)) return { erros: [erroCampo_('anexo_id', 'JA_ANULADO', 'Este arquivo é de um lançamento estornado ou corrigido: fica guardado como histórico e não pode ser removido.')] };
        if (vazio_(tx.dados.justificativa) || !String(tx.dados.justificativa).trim()) return { erros: [erroCampo_('justificativa', 'CAMPO_OBRIGATORIO', 'Diga por que o arquivo está sendo removido.')] };
        var motivo = String(tx.dados.justificativa).trim();
        AuditService.alteracao(tx, 'ANEXOS', a.anexo_id, { status: 'REMOVIDO' }, motivo);
        if (a.entidade === 'ANIMAIS') {
          var animal = tx.repo.porId('ANIMAIS', a.entity_id);
          if (animal && animal.foto_anexo_id === a.anexo_id) AuditService.alteracao(tx, 'ANIMAIS', a.entity_id, { foto_anexo_id: null }, motivo);
        }
        return { resumo: { anexo_id: a.anexo_id, event_id: a.event_id || null, arquivos: [a.drive_file_id, a.thumb_drive_file_id].filter(Boolean) }, resposta: { anexo_id: a.anexo_id, status: 'REMOVIDO' } };
      },
      reconstruir: function (tx, op) { return { anexo_id: op.resumo.anexo_id, status: 'REMOVIDO' }; },
    });
    if (!r.duplicado) {
      var lixo = UnitOfWork.read(ctx, {
        rota: 'anexo.remover', reads: ['ANEXOS'], acessoCru: true,
        tratador: function (tx) {
          var a = tx.cru.cruPorId('ANEXOS', r.dados.anexo_id);
          if (!a) return [];
          var usados = arquivosEmUso_(tx.cru, [a.anexo_id]);
          return [a.drive_file_id, a.thumb_drive_file_id].filter(function (f) { return !vazio_(f) && !usados[f]; });
        },
      }).dados;
      lixeiraAnotada_(ctx, lixo, 'anexo.remover');
      UnitOfWork.descarregarErros(ctx);
    }
    return r;
  }
  /**
   * anexo.obter. dados: {anexo_id, miniatura (true: a miniatura, se houver)}. Devolve {dados: {anexo, miniatura,
   * data_url}, dataVersion}: o conteúdo vai como data URL (o arquivo é privado no Drive; nunca se expõe URL). O anexo de
   * evento estornado ou corrigido continua consultável (`anexo.vigente = false`). Removido, inexistente ou de gravação
   * que não confirmou → NOT_FOUND.
   */
  function obterAnexo(ctx, dados) {
    var files = exigirFiles_(ctx);
    var d = dados || {};
    var lido = UnitOfWork.read(ctx, {
      rota: 'anexo.obter', reads: ['ANEXOS'], acessoCru: true,
      tratador: function (tx) {
        var a = linha_(tx, d.anexo_id);
        if (!consultavel_(tx.cru, a)) return null;
        return { linha: Utils.clonar(a), vigente: vigente_(tx.cru, a) };
      },
    });
    if (!lido.dados) throw Validation.erro('NOT_FOUND', 'O arquivo não foi encontrado ou foi removido.');
    var a = lido.dados.linha;
    var usarMiniatura = d.miniatura === true && !vazio_(a.thumb_drive_file_id);
    var b = files.lerBytes(usarMiniatura ? a.thumb_drive_file_id : a.drive_file_id);
    var mime = usarMiniatura ? 'image/jpeg' : a.mime_type;
    return { dados: { anexo: anexoPublico_(a, lido.dados.vigente), miniatura: usarMiniatura, data_url: 'data:' + mime + ';base64,' + b.base64 }, dataVersion: lido.dataVersion };
  }
  /**
   * Anexos de um evento, para `evento.obter` (cru: fachada de leitura crua com ANEXOS, EVENTOS e FINANCEIRO): os do
   * evento e os dos lançamentos financeiros dele (com `financial_id`), ativos, na ordem de envio. Os de evento
   * estornado ou corrigido vêm com `vigente = false` (histórico consultável).
   */
  function anexosDoEvento(cru, eventId) {
    if (vazio_(eventId)) return [];
    var linhas = cru.cruPor('ANEXOS', 'event_id', eventId).filter(function (a) { return a.status === 'ATIVO' && consultavel_(cru, a); });
    return Utils.ordenarPor(linhas.map(Utils.clonar), 'created_at').map(function (a) { return anexoPublico_(a, vigente_(cru, a)); });
  }
  /**
   * Correção de evento (dentro do tratador de evento.corrigir, ANEXOS nas reads): os anexos ativos do original passam
   * ao substituto, que ocupa o lugar dele. Cada um vira uma linha nova de ANEXOS, filha do substituto (gravada na
   * fase A do próprio evento: só vale se ele valer), com o MESMO arquivo do Drive; a linha do original fica como
   * história. O anexo de um lançamento vai para o lançamento correspondente do substituto; sem correspondente (custo
   * retirado na correção), fica ligado ao evento.
   * substituto: {event_id, lancamentos: {financial_id do original: financial_id do substituto}}. Devolve as linhas.
   */
  function anexosDoSubstituto(tx, originalId, substituto) {
    var s = substituto || {};
    if (vazio_(originalId) || vazio_(s.event_id)) throw interno_('anexosDoSubstituto precisa do evento original e do substituto.');
    var correspondente = s.lancamentos || {};
    var linhas = tx.repo.por('ANEXOS', 'event_id', originalId).filter(function (a) { return a.status === 'ATIVO'; });
    return Utils.ordenarPor(linhas, 'created_at').map(function (a) {
      var destino = a.entidade === 'FINANCEIRO' ? correspondente[a.entity_id] || null : null;
      return {
        anexo_id: tx.novoId(), entidade: destino ? 'FINANCEIRO' : 'EVENTOS', entity_id: destino || s.event_id, event_id: s.event_id,
        drive_file_id: a.drive_file_id, thumb_drive_file_id: a.thumb_drive_file_id || null, nome_arquivo: a.nome_arquivo, mime_type: a.mime_type,
        tamanho_bytes: a.tamanho_bytes, tipo: a.tipo, descricao: a.descricao || null, status: 'ATIVO', created_by: a.created_by, created_at: a.created_at,
      };
    });
  }

  return {
    MIME_PASTA: MIME_PASTA,
    MIME_PLANILHA: MIME_PLANILHA,
    PASTAS: PASTAS,
    TAMANHO_MAX_ANEXO: TAMANHO_MAX_ANEXO,
    MIME_ANEXO: MIME_ANEXO,
    LEITURAS_ANEXO: LEITURAS_ANEXO,
    ENTIDADES_ANEXO: ENTIDADES_ANEXO,
    porta: porta,
    adicionarAnexo: adicionarAnexo,
    promover: promover,
    removerAnexo: removerAnexo,
    obterAnexo: obterAnexo,
    anexoPublico: anexoPublico_,
    consultavel: consultavel_,
    anexosDoEvento: anexosDoEvento,
    anexosDoSubstituto: anexosDoSubstituto,
  };
})();
