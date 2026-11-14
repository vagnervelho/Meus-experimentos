'use strict';
/**
 * Fake do serviço avançado Drive v3 (Drive.Files.create, copy, update, get, list, export, remove) com árvore de
 * pastas em memória, e das rotas REST que o app chama por UrlFetchApp (alt=media e export).
 *
 * Emula o escopo drive.file: o app só enxerga arquivo que ele mesmo criou. Arquivo "plantado" pelo teste como
 * externo responde 404, como na conta real. As assinaturas seguem @types/google-apps-script (apis/drive_v3.d.ts):
 * create(resource, mediaData?, optionalArgs?), copy(resource, fileId, optionalArgs?),
 * update(resource, fileId, mediaData?, optionalArgs?), get(fileId, optionalArgs?), list(optionalArgs?),
 * export(fileId, mimeType): void.
 */

const MIME_PASTA = 'application/vnd.google-apps.folder';
const MIME_PLANILHA = 'application/vnd.google-apps.spreadsheet';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LIMITE_EXPORT = 10 * 1024 * 1024;
const CAMPOS_PADRAO = ['kind', 'id', 'name', 'mimeType'];

/**
 * @param amb {erro(msg), agora(), paraContexto(v), servico(obj), blob(buffer, contentType, name), bytesDe(blob)}
 * @param mundo mundo de planilhas (criarPlanilha, copiarPlanilha, removerPlanilha, apoio)
 */
function criarDrive(amb, mundo) {
  const arquivos = new Map();
  const chamadas = [];
  let seq = 0;
  const RAIZ = 'raiz-meu-drive';
  arquivos.set(RAIZ, { id: RAIZ, name: 'Meu Drive', mimeType: MIME_PASTA, parents: [], trashed: false, doApp: true, createdTime: iso(), modifiedTime: iso() });

  function iso() {
    return new Date(amb.agora()).toISOString();
  }
  function novoId(prefixo) {
    seq += 1;
    return prefixo + String(seq).padStart(4, '0') + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  }
  function erroApi(codigo, msg, metodo) {
    const e = amb.erro('GoogleJsonResponseException: API call to drive.files.' + metodo + ' failed with error: ' + msg);
    e.details = { code: codigo, message: msg };
    return e;
  }
  function exigir(fileId, metodo) {
    const f = arquivos.get(fileId === 'root' ? RAIZ : fileId);
    if (!f || !f.doApp) throw erroApi(404, 'File not found: ' + fileId + '.', metodo);
    return f;
  }
  function pais(lista, metodo) {
    const ids = (lista && lista.length ? lista : [RAIZ]).map((p) => (p === 'root' ? RAIZ : p));
    ids.forEach((p) => {
      const pasta = arquivos.get(p);
      if (!pasta || !pasta.doApp) throw erroApi(404, 'File not found: ' + p + '.', metodo);
      if (pasta.mimeType !== MIME_PASTA) throw erroApi(403, 'The specified parent is not a folder.', metodo);
    });
    return ids;
  }
  function recurso(f, fields) {
    const completo = {
      kind: 'drive#file', id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents.slice(), trashed: f.trashed,
      createdTime: f.createdTime, modifiedTime: f.modifiedTime, description: f.description, appProperties: f.appProperties ? Object.assign({}, f.appProperties) : undefined,
      size: f.conteudo ? String(f.conteudo.length) : undefined,
      webViewLink: f.mimeType === MIME_PLANILHA ? 'https://docs.google.com/spreadsheets/d/' + f.id + '/edit' : 'https://drive.google.com/file/d/' + f.id + '/view',
    };
    const quer = fields === undefined || fields === null ? CAMPOS_PADRAO : String(fields).trim() === '*' ? Object.keys(completo) : String(fields).split(',').map((s) => s.trim()).filter(Boolean);
    const out = {};
    quer.forEach((k) => {
      if (!(k in completo)) throw erroApi(400, 'Invalid field selection ' + k, 'get');
      if (completo[k] !== undefined) out[k] = completo[k];
    });
    return out;
  }
  function registrar(metodo, args) {
    chamadas.push(Object.assign({ metodo }, args));
  }

  // ---------------------------------------------------------------- consulta (q) ----
  function literal(s) {
    return s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  function compilarClausula(c) {
    let m = /^'((?:[^'\\]|\\.)*)' in parents$/.exec(c);
    if (m) { const id = literal(m[1]) === 'root' ? RAIZ : literal(m[1]); return (f) => f.parents.indexOf(id) >= 0; }
    m = /^(name|mimeType) (=|!=|contains) '((?:[^'\\]|\\.)*)'$/.exec(c);
    if (m) {
      const v = literal(m[3]);
      if (m[2] === '=') return (f) => f[m[1]] === v;
      if (m[2] === '!=') return (f) => f[m[1]] !== v;
      if (m[1] !== 'name') throw erroApi(400, 'Invalid Value', 'list');
      return (f) => f.name.toLowerCase().indexOf(v.toLowerCase()) >= 0;
    }
    m = /^trashed ?= ?(true|false)$/.exec(c);
    if (m) return (f) => f.trashed === (m[1] === 'true');
    m = /^appProperties has \{ ?key ?= ?'((?:[^'\\]|\\.)*)' and value ?= ?'((?:[^'\\]|\\.)*)' ?\}$/.exec(c);
    if (m) return (f) => !!f.appProperties && f.appProperties[literal(m[1])] === literal(m[2]);
    m = /^(createdTime|modifiedTime) (<|<=|>|>=) '([^']+)'$/.exec(c);
    if (m) {
      const t = Date.parse(m[3]);
      if (isNaN(t)) throw erroApi(400, 'Invalid Value', 'list');
      return (f) => { const x = Date.parse(f[m[1]]); return m[2] === '<' ? x < t : m[2] === '<=' ? x <= t : m[2] === '>' ? x > t : x >= t; };
    }
    throw erroApi(400, 'Invalid Value (fake Drive: cláusula de consulta não emulada: ' + c + ')', 'list');
  }
  function compilarConsulta(q) {
    if (q === undefined || q === null || String(q).trim() === '') return () => true;
    // Divide por " and " fora de aspas e fora de chaves.
    const partes = [];
    let atual = '';
    let aspas = false;
    let chaves = 0;
    const s = String(q);
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && aspas) { atual += ch + s[i + 1]; i++; continue; }
      if (ch === "'") aspas = !aspas;
      if (!aspas && ch === '{') chaves++;
      if (!aspas && ch === '}') chaves--;
      if (!aspas && chaves === 0 && s.startsWith(' and ', i)) { partes.push(atual.trim()); atual = ''; i += 4; continue; }
      atual += ch;
    }
    partes.push(atual.trim());
    const filtros = partes.map(compilarClausula);
    return (f) => filtros.every((fn) => fn(f));
  }

  // ---------------------------------------------------------------- exportação ----
  function csvDaPlanilha(id) {
    const nome = mundo.apoio.abas(id)[0];
    return mundo.apoio.matrizDuravel(id, nome).map((l) => l.map((v) => {
      const s = v && typeof v === 'object' ? String('data' in v ? v.data : v.valor) : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  }
  function exportar(f, mimeType) {
    if (f.mimeType !== MIME_PLANILHA) return { erro: [403, 'Export only supports Docs Editors files.'] };
    let buf;
    if (mimeType === 'text/csv') buf = Buffer.from(csvDaPlanilha(f.id), 'utf8');
    else if (mimeType === MIME_XLSX) buf = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(JSON.stringify(mundo.apoio.abas(f.id).map((n) => ({ aba: n, linhas: mundo.apoio.matrizDuravel(f.id, n) }))), 'utf8')]);
    else if (mimeType === 'application/pdf') buf = Buffer.from('%PDF-1.4\n% fake: ' + f.name + '\n' + csvDaPlanilha(f.id), 'utf8');
    else return { erro: [400, 'The requested conversion is not supported.'] };
    const limite = f.tamanhoExportado === undefined ? buf.length : f.tamanhoExportado;
    if (limite > LIMITE_EXPORT) return { erro: [403, 'This file is too large to be exported.'] };
    return { buf, mimeType };
  }

  // ---------------------------------------------------------------- Drive.Files ----
  const Files = amb.servico({
    create: (resource, mediaData, optionalArgs) => {
      const r = resource || {};
      const o = optionalArgs || {};
      if (typeof r.name !== 'string' || r.name === '') throw erroApi(400, 'Invalid value for field name.', 'create');
      const mimeType = r.mimeType || (mediaData ? mediaData.getContentType() || 'application/octet-stream' : 'application/octet-stream');
      if (mediaData && /^application\/vnd\.google-apps\./.test(mimeType)) throw erroApi(400, 'fake Drive: conversão de mídia para arquivo do Google não é emulada (' + mimeType + ').', 'create');
      const f = {
        id: novoId(mimeType === MIME_PASTA ? '1Pasta' : mimeType === MIME_PLANILHA ? '1Plan' : '1Arq'), name: r.name, mimeType, parents: pais(r.parents, 'create'), trashed: false, doApp: true,
        createdTime: iso(), modifiedTime: iso(), description: r.description, appProperties: r.appProperties ? Object.assign({}, r.appProperties) : undefined,
      };
      if (mimeType === MIME_PLANILHA) mundo.criarPlanilha(f.id, f.name);
      else if (mimeType !== MIME_PASTA) f.conteudo = mediaData ? amb.bytesDe(mediaData) : Buffer.alloc(0);
      arquivos.set(f.id, f);
      registrar('create', { id: f.id, name: f.name, mimeType });
      return amb.paraContexto(recurso(f, o.fields));
    },
    copy: (resource, fileId, optionalArgs) => {
      const origem = exigir(fileId, 'copy');
      if (origem.mimeType === MIME_PASTA) throw erroApi(403, 'This file cannot be copied by the user.', 'copy');
      const r = resource || {};
      const f = {
        id: novoId(origem.mimeType === MIME_PLANILHA ? '1Plan' : '1Arq'), name: r.name || 'Cópia de ' + origem.name, mimeType: origem.mimeType,
        parents: pais(r.parents && r.parents.length ? r.parents : origem.parents, 'copy'), trashed: false, doApp: true, createdTime: iso(), modifiedTime: iso(),
        description: r.description === undefined ? origem.description : r.description, appProperties: r.appProperties ? Object.assign({}, r.appProperties) : origem.appProperties ? Object.assign({}, origem.appProperties) : undefined,
      };
      if (origem.mimeType === MIME_PLANILHA) mundo.copiarPlanilha(origem.id, f.id, f.name);
      else f.conteudo = Buffer.from(origem.conteudo);
      arquivos.set(f.id, f);
      registrar('copy', { id: f.id, origem: origem.id, name: f.name });
      return amb.paraContexto(recurso(f, (optionalArgs || {}).fields));
    },
    update: (resource, fileId, mediaData, optionalArgs) => {
      const f = exigir(fileId, 'update');
      const r = resource || {};
      const o = optionalArgs || {};
      const add = o.addParents ? pais(String(o.addParents).split(','), 'update') : [];
      const rem = o.removeParents ? String(o.removeParents).split(',').map((p) => (p === 'root' ? RAIZ : p)) : [];
      if (r.name !== undefined) { if (typeof r.name !== 'string' || r.name === '') throw erroApi(400, 'Invalid value for field name.', 'update'); f.name = r.name; }
      if (r.trashed !== undefined) f.trashed = !!r.trashed;
      if (r.description !== undefined) f.description = r.description;
      if (r.appProperties) f.appProperties = Object.assign({}, f.appProperties || {}, r.appProperties);
      if (mediaData) {
        if (f.mimeType === MIME_PASTA || f.mimeType === MIME_PLANILHA) throw erroApi(403, 'fake Drive: troca de conteúdo de arquivo do Google não é emulada.', 'update');
        f.conteudo = amb.bytesDe(mediaData);
      }
      f.parents = f.parents.filter((p) => rem.indexOf(p) < 0).concat(add.filter((p) => f.parents.indexOf(p) < 0));
      f.modifiedTime = iso();
      registrar('update', { id: f.id, campos: Object.keys(r), addParents: o.addParents, removeParents: o.removeParents });
      return amb.paraContexto(recurso(f, o.fields));
    },
    get: (fileId, optionalArgs) => {
      const f = exigir(fileId, 'get');
      const o = optionalArgs || {};
      registrar('get', { id: f.id, alt: o.alt });
      if (o.alt === 'media') {
        if (!f.conteudo) throw erroApi(403, 'Only files with binary content can be downloaded. Use Export with Docs Editors files.', 'get');
        return f.conteudo.toString('utf8');
      }
      return amb.paraContexto(recurso(f, o.fields));
    },
    list: (optionalArgs) => {
      const o = optionalArgs || {};
      const filtro = compilarConsulta(o.q);
      let lista = Array.from(arquivos.values()).filter((f) => f.doApp && f.id !== RAIZ && filtro(f));
      const ordem = String(o.orderBy || '').split(',').map((s) => s.trim()).filter(Boolean);
      ordem.forEach((c) => { if (!/^(name|createdTime|modifiedTime)( desc)?$/.test(c)) throw erroApi(400, 'Invalid Value (fake Drive: orderBy não emulado: ' + c + ')', 'list'); });
      lista.sort((a, b) => {
        for (const c of ordem) {
          const [campo, sentido] = c.split(' ');
          if (a[campo] < b[campo]) return sentido === 'desc' ? 1 : -1;
          if (a[campo] > b[campo]) return sentido === 'desc' ? -1 : 1;
        }
        return a.id < b.id ? -1 : 1;
      });
      const tamanho = Math.min(Math.max(Number(o.pageSize) || 100, 1), 1000);
      const inicio = o.pageToken ? Number(o.pageToken) : 0;
      if (isNaN(inicio) || inicio < 0) throw erroApi(400, 'Invalid Value', 'list');
      const pagina = lista.slice(inicio, inicio + tamanho);
      let campos;
      if (o.fields !== undefined && String(o.fields).trim() !== '*') {
        const m = /files\(([^)]*)\)/.exec(String(o.fields));
        if (!m) throw erroApi(400, 'Invalid field selection ' + o.fields, 'list');
        campos = m[1];
      } else if (o.fields !== undefined) campos = '*';
      const out = { kind: 'drive#fileList', incompleteSearch: false, files: pagina.map((f) => recurso(f, campos)) };
      if (inicio + tamanho < lista.length) out.nextPageToken = String(inicio + tamanho);
      registrar('list', { q: o.q, total: pagina.length });
      return amb.paraContexto(out);
    },
    /** Pelos tipos, export() do serviço avançado devolve void: o conteúdo exportado só sai pela rota REST. */
    export: (fileId, mimeType) => {
      const f = exigir(fileId, 'export');
      const r = exportar(f, mimeType);
      if (r.erro) throw erroApi(r.erro[0], r.erro[1], 'export');
      registrar('export', { id: f.id, mimeType });
    },
    remove: (fileId) => {
      const f = exigir(fileId, 'delete');
      if (f.id === RAIZ) throw erroApi(403, 'The user does not have sufficient permissions for this file.', 'delete');
      arquivos.delete(f.id);
      if (f.mimeType === MIME_PLANILHA) mundo.removerPlanilha(f.id);
      registrar('remove', { id: f.id });
    },
  });

  // ---------------------------------------------------------------- REST por UrlFetchApp ----
  /** Handler para o fake de UrlFetchApp: devolve a resposta ou null se a URL não é da API do Drive. */
  function rest(req) {
    const m = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/?]+)(\/export)?(?:\?(.*))?$/.exec(req.url);
    if (!m) return null;
    const params = {};
    (m[3] || '').split('&').filter(Boolean).forEach((kv) => { const i = kv.indexOf('='); params[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    const erro = (code, message) => ({ code, body: { error: { code, message } } });
    const auth = req.headers.Authorization || req.headers.authorization || '';
    if (auth !== 'Bearer ' + amb.token()) return erro(401, 'Request had invalid authentication credentials.');
    if (req.method !== 'get') return erro(404, 'fake Drive: só GET é emulado nas rotas REST.');
    const f = arquivos.get(decodeURIComponent(m[1]));
    if (!f || !f.doApp) return erro(404, 'File not found: ' + decodeURIComponent(m[1]) + '.');
    registrar('rest', { id: f.id, exportar: !!m[2], params });
    if (m[2]) {
      if (!params.mimeType) return erro(400, 'Required parameter: mimeType');
      const r = exportar(f, params.mimeType);
      if (r.erro) return erro(r.erro[0], r.erro[1]);
      return { code: 200, bytes: r.buf, headers: { 'Content-Type': r.mimeType } };
    }
    if (params.alt !== 'media') return { code: 200, body: recurso(f, params.fields) };
    if (!f.conteudo) return erro(403, 'Only files with binary content can be downloaded. Use Export with Docs Editors files.');
    return { code: 200, bytes: f.conteudo, headers: { 'Content-Type': f.mimeType } };
  }

  // ---------------------------------------------------------------- apoio aos testes ----
  const apoio = {
    RAIZ, MIME_PASTA, MIME_PLANILHA, MIME_XLSX,
    chamadas,
    arquivo: (id) => { const f = arquivos.get(id); return f ? Object.assign({}, f, { parents: f.parents.slice() }) : null; },
    conteudo: (id) => { const f = arquivos.get(id); return f && f.conteudo ? Buffer.from(f.conteudo) : null; },
    /** Árvore legível a partir da raiz: ["ERP Pecuário/", "ERP Pecuário/Backups/", "ERP Pecuário/Banco"]. Lixeira fica de fora. */
    arvore: () => {
      const out = [];
      const descer = (paiId, prefixo) => {
        Array.from(arquivos.values()).filter((f) => f.parents.indexOf(paiId) >= 0 && !f.trashed).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1)).forEach((f) => {
          const pasta = f.mimeType === MIME_PASTA;
          out.push(prefixo + f.name + (pasta ? '/' : ''));
          if (pasta) descer(f.id, prefixo + f.name + '/');
        });
      };
      descer(RAIZ, '');
      return out;
    },
    /** Arquivo que existe no Drive do dono, mas NÃO foi criado pelo app: invisível sob drive.file. */
    plantarExterno: (spec) => {
      const s = spec || {};
      const f = { id: s.id || novoId('1Ext'), name: s.name || 'arquivo externo', mimeType: s.mimeType || 'text/plain', parents: [RAIZ], trashed: false, doApp: false, createdTime: iso(), modifiedTime: iso() };
      if (f.mimeType === MIME_PLANILHA) { mundo.criarPlanilha(f.id, f.name); mundo.apoio.tornarInacessivel(f.id); } else if (f.mimeType !== MIME_PASTA) f.conteudo = Buffer.from(s.conteudo || '', 'utf8');
      arquivos.set(f.id, f);
      return f.id;
    },
    /** Força o tamanho declarado da exportação (para testar o teto de 10 MB sem gerar 10 MB). */
    definirTamanhoExportado: (id, bytes) => { arquivos.get(id).tamanhoExportado = bytes; },
    definirDatas: (id, datas) => { Object.assign(arquivos.get(id), datas); },
  };

  return { Drive: { Files }, rest, apoio };
}

module.exports = { criarDrive, MIME_PASTA, MIME_PLANILHA, MIME_XLSX };
