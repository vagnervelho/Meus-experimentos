/**
 * ImportService — importação de planilha de ANIMAIS (§14; 06, seção 5.3; 08, seção 12; 05, RN-088 a RN-095).
 *
 * Pipeline: criar (arquivo original no Drive + ANEXOS, com hash) → validar em blocos (formato, regras, duplicidades no
 * arquivo e contra a base, mãe e pai em duas passadas, níveis de confiança) → pré-visualizar → confirmar e importar em
 * blocos de `importacao_lote_linhas` (cada bloco = UMA operação de chave determinística `imp:<import_id>:<n>`, com
 * UMA ENTRADA_INICIAL que passa pelas mesmas regras do formulário — RN-090) → concluir (backup antes; IMPORTADO é o
 * commit do arquivo inteiro; reconstrução total das projeções) ou desfazer (CANCELADO; nenhum evento vale).
 *
 * Enquanto houver importação IMPORTANDO, a UnitOfWork recusa os demais comandos de negócio (desenho-base 16.8); as
 * rotas importacao.* e a manutenção continuam. Nenhuma linha inconsistente entra em silêncio (RN-088); com linhas
 * reprovadas, só o modo PARCIAL_APROVADO, com aprovação explícita registrada em AUDITORIA (RN-089). O texto original
 * de cada linha fica em IMPORTACAO_LINHAS.dados_originais_json; vazio = desconhecido, sem valor padrão (RN-093):
 * valor padrão só o que o dono escolhe no mapeamento (`padroes`), que fica gravado em mapeamento_json.
 *
 * Puro: Drive e codificação de texto pela porta `ctx.files`; backup por Maintenance.backup (sobre as portas).
 */
var ImportService = (function () {
  var TIPOS_SUPORTADOS = Object.freeze(['ANIMAIS']);
  var MAX_LINHAS = 20000;
  var DELIMITADORES = Object.freeze({ ',': ',', ';': ';', '\t': '\t', TAB: '\t', '|': '|' });
  var FORMATOS_DATA = Object.freeze(['dd/MM/yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy', 'dd-MM-yyyy', 'dd.MM.yyyy']);
  var LOTE_MAX = 1000;
  var EXTRA = '#coluna_extra_';
  var ESTADOS_VALIDAVEIS = Object.freeze({ RASCUNHO: true, VALIDADO: true });
  var CONFIANCAS = Object.freeze(['CONFIRMADA', 'ESTIMADA', 'DESCONHECIDA']);
  var CONFIANCAS_VINCULO = Object.freeze(['CONFIRMADA', 'ESTIMADA']);
  /**
   * Campos de destino do mapeamento: tipo de leitura do texto e, quando é o caso, a coluna de confiança.
   * `mae`/`pai` recebem o BRINCO do progenitor (no arquivo ou no rebanho); `pasto` recebe nome ou identificação.
   */
  var CAMPOS = Object.freeze({
    brinco: { tipo: 'texto', rotulo: 'Brinco', apelidos: ['brinco', 'numero', 'n', 'no', 'num', 'brinco do animal', 'identificacao'] },
    nome: { tipo: 'texto', rotulo: 'Nome', apelidos: ['nome', 'apelido'] },
    sexo: { tipo: 'sexo', rotulo: 'Sexo', apelidos: ['sexo'] },
    raca: { tipo: 'raca', rotulo: 'Raça', apelidos: ['raca', 'raça'] },
    data_nascimento: { tipo: 'data', rotulo: 'Nascimento', apelidos: ['nascimento', 'data de nascimento', 'data nascimento', 'nasc', 'nasc.', 'dt nasc', 'dt. nasc.'] },
    idade_meses: { tipo: 'inteiro', rotulo: 'Idade (meses)', apelidos: ['idade', 'idade meses', 'idade (meses)'] },
    data_nascimento_confianca: { tipo: 'confianca', rotulo: 'Nascimento é', apelidos: ['confianca nascimento', 'nascimento e'] },
    mae: { tipo: 'texto', rotulo: 'Brinco da mãe', apelidos: ['mae', 'mãe', 'brinco da mae', 'brinco mae'] },
    mae_confianca: { tipo: 'confianca_vinculo', rotulo: 'Mãe é', apelidos: ['confianca mae', 'mae e'] },
    pai: { tipo: 'texto', rotulo: 'Brinco do pai', apelidos: ['pai', 'touro', 'brinco do pai', 'brinco pai'] },
    pai_confianca: { tipo: 'confianca_vinculo', rotulo: 'Pai é', apelidos: ['confianca pai', 'pai e'] },
    origem: { tipo: 'origem', rotulo: 'Origem', apelidos: ['origem'] },
    castrado: { tipo: 'bool', rotulo: 'Castrado', apelidos: ['castrado', 'capado'] },
    reprodutor: { tipo: 'bool', rotulo: 'Reprodutor', apelidos: ['reprodutor'] },
    partos_previos: { tipo: 'inteiro', rotulo: 'Partos anteriores', apelidos: ['partos', 'partos anteriores', 'numero de partos'] },
    situacao_reprodutiva: { tipo: 'situacao', rotulo: 'Situação reprodutiva', apelidos: ['situacao reprodutiva', 'situacao', 'prenhez'] },
    data_prevista_parto: { tipo: 'data', rotulo: 'Previsão de parto', apelidos: ['previsao de parto', 'previsao parto'] },
    pasto: { tipo: 'pasto', rotulo: 'Pasto', apelidos: ['pasto', 'piquete', 'local', 'pasto atual'] },
    data_entrada: { tipo: 'data', rotulo: 'Chegou na fazenda em', apelidos: ['entrada', 'data de entrada', 'chegada', 'data de chegada'] },
    data_entrada_confianca: { tipo: 'confianca', rotulo: 'Chegada é', apelidos: ['confianca entrada'] },
    peso: { tipo: 'decimal', rotulo: 'Peso (kg)', apelidos: ['peso', 'peso kg', 'peso (kg)', 'peso vivo'] },
    metodo_pesagem: { tipo: 'metodo', rotulo: 'Como foi pesado', apelidos: ['metodo', 'metodo de pesagem', 'pesagem'] },
    valor_abertura: { tipo: 'dinheiro', rotulo: 'Valor de abertura (R$)', apelidos: ['valor', 'valor de abertura', 'custo', 'valor r$'] },
    brinco_origem: { tipo: 'texto', rotulo: 'Brinco de origem', ident: 'BRINCO_ORIGEM', apelidos: ['brinco de origem', 'brinco origem'] },
    rfid: { tipo: 'texto', rotulo: 'RFID', ident: 'RFID', apelidos: ['rfid', 'chip'] },
    sisbov: { tipo: 'texto', rotulo: 'SISBOV', ident: 'SISBOV', apelidos: ['sisbov'] },
    tatuagem: { tipo: 'texto', rotulo: 'Tatuagem', ident: 'TATUAGEM', apelidos: ['tatuagem'] },
    observacoes: { tipo: 'texto', rotulo: 'Observações', apelidos: ['observacoes', 'obs', 'observacao'] },
  });
  /** Valores padrão que o dono pode escolher no mapeamento para o que o arquivo não traz. */
  var PADROES = Object.freeze({ castrado: 'bool', reprodutor: 'bool', origem: 'origem', pasto: 'pasto_id', metodo_pesagem: 'metodo' });
  var SO_FEMEA = Object.freeze(['partos_previos', 'situacao_reprodutiva', 'data_prevista_parto']);
  var SO_MACHO = Object.freeze(['castrado', 'reprodutor']);
  var FORA_DO_CATALOGO = Object.freeze({ mae_id: true, mae_ref: true, pai_id: true, pai_ref: true, ref: true, outras_identificacoes: true, animal_id: true });

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function interno_(mensagem) {
    return Validation.erro('INTERNAL', mensagem);
  }
  function texto_(e) {
    return String(e && e.message ? e.message : e);
  }
  function br_(d) {
    return Utils.dataValida(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : String(d);
  }
  function det_(campo, codigo, mensagem) {
    return Validation.detalhe({ codigo: codigo, campo: campo, mensagem: mensagem });
  }
  function recusar_(mensagem, detalhes) {
    return Validation.erro('VALIDATION', mensagem, detalhes || []);
  }
  function exigirFiles_(ctx) {
    if (!ctx || !ctx.files) throw interno_('Contexto de execução sem a porta de arquivos (files).');
    return ctx.files;
  }
  function chaveBloco(importId, n) {
    return 'imp:' + importId + ':' + n;
  }

  // ------------------------------------------------------------------ leitura do arquivo (puro) ----
  /** CSV (RFC 4180): aspas no início do campo, "" dentro de aspas, CRLF, LF ou CR. Devolve lista de registros. */
  function lerCsv(texto, delimitador) {
    var s = String(texto || '');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    var registros = [];
    var reg = [];
    var campo = '';
    var aspas = false;
    var i = 0;
    var n = s.length;
    while (i < n) {
      var c = s.charAt(i);
      if (aspas) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') { campo += '"'; i += 2; continue; }
          aspas = false; i += 1; continue;
        }
        campo += c; i += 1; continue;
      }
      if (c === '"' && campo === '') { aspas = true; i += 1; continue; }
      if (c === delimitador) { reg.push(campo); campo = ''; i += 1; continue; }
      if (c === '\r' || c === '\n') {
        reg.push(campo); registros.push(reg); reg = []; campo = '';
        i += c === '\r' && s.charAt(i + 1) === '\n' ? 2 : 1;
        continue;
      }
      campo += c; i += 1;
    }
    if (aspas) throw recusar_('O arquivo tem aspas abertas que não fecham (registro ' + (registros.length + 1) + '). Confira o delimitador escolhido ou salve o arquivo de novo como CSV.');
    if (campo !== '' || reg.length) { reg.push(campo); registros.push(reg); }
    return registros;
  }
  /**
   * Arquivo → {cabecalho: [nomes], linhas: [{linha_num, valores: {cabeçalho: texto}}]}. linha_num conta o cabeçalho
   * como 1 (o número da linha na planilha do dono); registro em branco não vira linha, mas conta na numeração.
   * Célula além do cabeçalho fica em `#coluna_extra_N` (a linha é reprovada). Erros de estrutura → VALIDATION.
   */
  function interpretarArquivo(texto, delimitador, teto) {
    var registros = lerCsv(texto, delimitador);
    var primeiro = 0;
    while (primeiro < registros.length && registros[primeiro].every(function (c) { return Utils.aparar(c) === ''; })) primeiro += 1;
    if (primeiro >= registros.length) throw recusar_('O arquivo está vazio.');
    var cab = registros[primeiro].map(function (c, i) { var t = Utils.aparar(c); return t === '' ? 'Coluna ' + (i + 1) : t; });
    while (cab.length && /^Coluna \d+$/.test(cab[cab.length - 1]) && registros[primeiro][cab.length - 1] === '') cab.pop();
    var vistos = {};
    cab.forEach(function (c) {
      var k = Utils.normalizarTexto(c);
      if (vistos[k]) throw recusar_('A coluna "' + c + '" aparece duas vezes no cabeçalho. Dê nomes diferentes às colunas e envie de novo.');
      vistos[k] = true;
    });
    var linhas = [];
    for (var r = primeiro + 1; r < registros.length; r++) {
      var reg = registros[r];
      if (reg.every(function (c) { return Utils.aparar(c) === ''; })) continue;
      var valores = {};
      cab.forEach(function (c, i) { valores[c] = i < reg.length ? reg[i] : ''; });
      for (var j = cab.length; j < reg.length; j++) if (Utils.aparar(reg[j]) !== '') valores[EXTRA + (j + 1)] = reg[j];
      if (JSON.stringify(valores).length > (teto || Validation.TETO_CELULA)) throw recusar_('A linha ' + (r - primeiro + 1) + ' do arquivo é longa demais para ser guardada. Confira o delimitador ou divida o conteúdo.');
      linhas.push({ linha_num: r - primeiro + 1, valores: valores });
    }
    if (!linhas.length) throw recusar_('O arquivo só tem o cabeçalho: não há animais para importar.');
    if (linhas.length > MAX_LINHAS) throw recusar_('O arquivo tem ' + linhas.length + ' linhas; o limite de uma importação é ' + MAX_LINHAS + '. Divida o arquivo.');
    return { cabecalho: cab, linhas: linhas };
  }
  /** Sugestão de mapeamento pelo nome do cabeçalho ("modelo conhecido já vem mapeado"). */
  function sugerirMapeamento(cabecalho) {
    var out = {};
    var usados = {};
    (cabecalho || []).forEach(function (c) {
      var k = Utils.normalizarTexto(c);
      Object.keys(CAMPOS).some(function (campo) {
        if (usados[campo]) return false;
        var ok = CAMPOS[campo].apelidos.some(function (a) { return Utils.normalizarTexto(a) === k; }) || Utils.normalizarTexto(CAMPOS[campo].rotulo) === k || campo === k;
        if (ok) { out[c] = campo; usados[campo] = true; }
        return ok;
      });
    });
    return out;
  }
  function conferirFormato_(f) {
    var x = f || {};
    var problemas = [];
    var delim = DELIMITADORES[x.delimitador];
    if (!delim) problemas.push(det_('delimitador', 'VALOR_FORA_DA_LISTA', 'Escolha o separador das colunas: vírgula, ponto e vírgula, tabulação ou barra vertical.'));
    if (FORMATOS_DATA.indexOf(x.formato_data) < 0) problemas.push(det_('formato_data', 'VALOR_FORA_DA_LISTA', 'Escolha o formato das datas: ' + FORMATOS_DATA.join(', ') + '.'));
    if (x.decimal !== ',' && x.decimal !== '.') problemas.push(det_('decimal', 'VALOR_FORA_DA_LISTA', 'Escolha o separador decimal: vírgula ou ponto.'));
    if (delim && delim === x.decimal) problemas.push(det_('decimal', 'CONFLITO_DE_CAMPOS', 'O separador decimal não pode ser o mesmo das colunas.'));
    if (problemas.length) throw recusar_(problemas.length === 1 ? problemas[0].mensagem : 'Confira o formato do arquivo.', problemas);
    return { delimitador: delim, codificacao: vazio_(x.codificacao) ? 'UTF-8' : String(x.codificacao).toUpperCase(), formato_data: x.formato_data, decimal: x.decimal };
  }

  // ------------------------------------------------------------------ leitura de valores (puro) ----
  function lerData_(t, formato) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Utils.dataValida(t) ? { v: t } : { erro: 'DATA_INVALIDA', msg: 'a data "' + t + '" não existe' };
    var sep = formato.charAt(2);
    var partes = t.split(sep);
    var ordem = formato.split(sep);
    if (partes.length !== 3 || ordem.length !== 3) return { erro: 'FORMATO_INVALIDO', msg: 'a data "' + t + '" não está no formato ' + formato.replace('yyyy', 'aaaa') };
    var d = {};
    for (var i = 0; i < 3; i++) {
      if (!/^\d+$/.test(partes[i])) return { erro: 'FORMATO_INVALIDO', msg: 'a data "' + t + '" não está no formato ' + formato.replace('yyyy', 'aaaa') };
      d[ordem[i].charAt(0)] = partes[i];
    }
    if (d.y.length !== 4 || d.M.length > 2 || d.d.length > 2) return { erro: 'FORMATO_INVALIDO', msg: 'a data "' + t + '" precisa ter o ano com 4 dígitos (' + formato.replace('yyyy', 'aaaa') + ')' };
    var iso = d.y + '-' + ('0' + d.M).slice(-2) + '-' + ('0' + d.d).slice(-2);
    return Utils.dataValida(iso) ? { v: iso } : { erro: 'DATA_INVALIDA', msg: 'a data "' + t + '" não existe' };
  }
  function lerNumero_(t, decimal) {
    var milhar = decimal === ',' ? '.' : ',';
    var s = t.replace(/\s/g, '');
    if (s.indexOf(milhar) >= 0 && !new RegExp('^-?\\d{1,3}(\\' + milhar + '\\d{3})+(\\' + decimal + '\\d+)?$').test(s)) return null;
    s = s.split(milhar).join('').replace(decimal, '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
  }
  function lerTexto_(campo, t, formato, cv) {
    var def = CAMPOS[campo];
    var n = Utils.normalizarTexto(t);
    switch (def.tipo) {
      case 'texto': return { v: t };
      case 'sexo':
        if (n === 'm' || n === 'macho') return { v: 'M' };
        if (n === 'f' || n === 'femea') return { v: 'F' };
        return { erro: 'VALOR_FORA_DA_LISTA', msg: 'sexo "' + t + '" não reconhecido (use M ou F)' };
      case 'bool':
        if (['s', 'sim', 'x', '1', 'true', 'verdadeiro'].indexOf(n) >= 0) return { v: true };
        if (['n', 'nao', '0', 'false', 'falso'].indexOf(n) >= 0) return { v: false };
        return { erro: 'VALOR_FORA_DA_LISTA', msg: def.rotulo.toLowerCase() + ' "' + t + '" não reconhecido (use S ou N)' };
      case 'inteiro':
        return /^\d+$/.test(t) ? { v: parseInt(t, 10) } : { erro: 'TIPO_INVALIDO', msg: def.rotulo.toLowerCase() + ' "' + t + '" precisa ser um número inteiro' };
      case 'decimal': {
        var x = lerNumero_(t, formato.decimal);
        return x === null ? { erro: 'TIPO_INVALIDO', msg: def.rotulo.toLowerCase() + ' "' + t + '" não é um número (separador decimal "' + formato.decimal + '")' } : { v: Number(x) };
      }
      case 'dinheiro': {
        var y = lerNumero_(t.replace(/^R\$\s*/i, ''), formato.decimal);
        if (y === null || /\.\d{3,}$/.test(y) || y.charAt(0) === '-') return { erro: 'TIPO_INVALIDO', msg: 'valor "' + t + '" não é um valor em reais (até 2 casas, separador decimal "' + formato.decimal + '")' };
        var partes = y.split('.');
        var cent = parseInt(partes[0], 10) * 100 + parseInt(((partes[1] || '') + '00').slice(0, 2), 10);
        return cent > Utils.CENTAVOS_MAX ? { erro: 'VALOR_FORA_DA_FAIXA', msg: 'valor "' + t + '" grande demais' } : { v: cent };
      }
      case 'data': return lerData_(t, formato.formato_data);
      case 'confianca':
      case 'confianca_vinculo': {
        var c = n === 'c' || n === 'confirmada' || n === 'confirmado' ? 'CONFIRMADA' : n === 'e' || n === 'estimada' || n === 'estimado' || n === 'aproximada' ? 'ESTIMADA' : n === 'd' || n === 'desconhecida' || n === 'desconhecido' ? 'DESCONHECIDA' : null;
        if (!c || (def.tipo === 'confianca_vinculo' && c === 'DESCONHECIDA')) return { erro: 'VALOR_FORA_DA_LISTA', msg: def.rotulo.toLowerCase() + ' "' + t + '" não reconhecido (use confirmada' + (def.tipo === 'confianca' ? ', estimada ou desconhecida' : ' ou estimada; mãe ou pai desconhecido fica em branco') + ')' };
        return { v: c };
      }
      case 'origem':
        if (/^nascid[oa]|^nasceu|^cria/.test(n)) return { v: 'NASCIDO' };
        if (/^comprad[oa]|^compra/.test(n)) return { v: 'COMPRADO' };
        if (/^desconhecid[oa]/.test(n)) return { v: 'DESCONHECIDA' };
        return { erro: 'VALOR_FORA_DA_LISTA', msg: 'origem "' + t + '" não reconhecida (nascido, comprado ou desconhecida)' };
      case 'situacao': {
        var sit = { vazia: 'VAZIA', exposta: 'EXPOSTA', inseminada: 'INSEMINADA', prenha: 'PRENHA', prenhe: 'PRENHA' }[n];
        return sit ? { v: sit } : { erro: 'VALOR_FORA_DA_LISTA', msg: 'situação reprodutiva "' + t + '" não reconhecida (vazia, exposta, inseminada ou prenha)' };
      }
      case 'metodo': {
        var m = n === 'balanca' ? 'BALANCA' : n === 'fita' ? 'FITA' : /^estimativa|^visual|^olho/.test(n) ? 'ESTIMATIVA_VISUAL' : null;
        return m ? { v: m } : { erro: 'VALOR_FORA_DA_LISTA', msg: 'método de pesagem "' + t + '" não reconhecido (balança, fita ou estimativa visual)' };
      }
      case 'raca': {
        var raca = cv.racas[n] || cv.racas[Utils.normalizarTexto(t.replace(/\s+/g, '_'))];
        return raca ? { v: raca } : { erro: 'VALOR_FORA_DA_LISTA', msg: 'a raça "' + t + '" não está na lista de raças (cadastre-a nas configurações ou corrija o arquivo)' };
      }
      case 'pasto': {
        var p = cv.pastos[n];
        if (!p) return { erro: 'PASTO_NAO_ENCONTRADO', msg: 'o pasto "' + t + '" não está cadastrado' };
        if (p.status !== 'ATIVO') return { erro: 'PASTO_INATIVO', msg: 'o pasto ' + p.nome + ' está desativado' };
        return { v: p.pasture_id };
      }
      default: throw interno_('Tipo de campo de importação desconhecido: ' + def.tipo + '.');
    }
  }

  // ------------------------------------------------------------------ mapeamento (puro) ----
  /**
   * Confere o mapeamento contra o cabeçalho e devolve a forma gravada em mapeamento_json:
   * {colunas: {cabeçalho: campo}, confiancas: {data_nascimento, data_entrada, mae, pai}, padroes: {castrado,
   * reprodutor, origem, pasto (pasture_id), metodo_pesagem}}. Problema → VALIDATION com detalhe por item.
   */
  function conferirMapeamento(mapeamento, cabecalho, pastosPorId) {
    var m = mapeamento || {};
    var cols = m.colunas || {};
    var problemas = [];
    var destino = {};
    var colunas = {};
    Object.keys(cols).forEach(function (c) {
      var campo = cols[c];
      if (vazio_(campo)) return;
      if (cabecalho.indexOf(c) < 0) { problemas.push(det_('colunas', 'COLUNA_DESCONHECIDA', 'A coluna "' + c + '" não existe no arquivo.')); return; }
      if (!CAMPOS[campo]) { problemas.push(det_('colunas', 'CAMPO_DESCONHECIDO', 'O campo "' + campo + '" não existe na importação de animais.')); return; }
      if (destino[campo]) { problemas.push(det_('colunas', 'CAMPO_REPETIDO', 'As colunas "' + destino[campo] + '" e "' + c + '" vão para o mesmo campo (' + CAMPOS[campo].rotulo + ').')); return; }
      destino[campo] = c;
      colunas[c] = campo;
    });
    var conf = {};
    var c0 = m.confiancas || {};
    [['data_nascimento', CONFIANCAS], ['data_entrada', CONFIANCAS], ['mae', CONFIANCAS_VINCULO], ['pai', CONFIANCAS_VINCULO]].forEach(function (par) {
      var v = c0[par[0]];
      if (vazio_(v)) return;
      if (par[1].indexOf(v) < 0) problemas.push(det_('confiancas', 'VALOR_FORA_DA_LISTA', 'Confiança padrão de ' + CAMPOS[par[0]].rotulo.toLowerCase() + ': use ' + par[1].join(', ') + '.'));
      else conf[par[0]] = v;
    });
    var padroes = {};
    var p0 = m.padroes || {};
    Object.keys(p0).forEach(function (k) {
      var v = p0[k];
      if (vazio_(v)) return;
      if (!PADROES[k]) { problemas.push(det_('padroes', 'CAMPO_DESCONHECIDO', 'Não há valor padrão para "' + k + '".')); return; }
      var ok = PADROES[k] === 'bool' ? typeof v === 'boolean' : PADROES[k] === 'origem' ? ['NASCIDO', 'COMPRADO', 'DESCONHECIDA'].indexOf(v) >= 0
        : PADROES[k] === 'metodo' ? ['BALANCA', 'FITA', 'ESTIMATIVA_VISUAL'].indexOf(v) >= 0 : !!pastosPorId[v] && pastosPorId[v].status === 'ATIVO';
      if (!ok) problemas.push(det_('padroes', 'VALOR_FORA_DA_LISTA', 'Valor padrão inválido para ' + k + '.'));
      else padroes[k] = v;
    });
    if (!destino.sexo) problemas.push(det_('colunas', 'CAMPO_OBRIGATORIO', 'Diga qual coluna traz o sexo dos animais.'));
    if (!destino.pasto && !padroes.pasto) problemas.push(det_('colunas', 'CAMPO_OBRIGATORIO', 'Diga qual coluna traz o pasto, ou escolha um pasto para todos os animais.'));
    [['data_nascimento', 'data_nascimento_confianca'], ['data_entrada', 'data_entrada_confianca'], ['mae', 'mae_confianca'], ['pai', 'pai_confianca']].forEach(function (par) {
      if (destino[par[0]] && !destino[par[1]] && !conf[par[0]]) problemas.push(det_('confiancas', 'CAMPO_OBRIGATORIO', 'Diga se ' + CAMPOS[par[0]].rotulo.toLowerCase() + ' do arquivo é informação confirmada ou estimada.'));
    });
    if (problemas.length) throw recusar_(problemas.length === 1 ? problemas[0].mensagem : 'Há ' + problemas.length + ' problemas no mapeamento das colunas.', problemas);
    return { colunas: colunas, confiancas: conf, padroes: padroes };
  }

  // ------------------------------------------------------------------ validação (puro) ----
  /** Índices de que a validação precisa, lidos da unidade: parâmetros, pastos, raças, listas e brincos da base. */
  function contextoValidacao_(tx) {
    var params = Timeline.parametros(tx.repo);
    var pastos = {};
    var pastosPorId = {};
    tx.repo.vigentes('PASTOS').forEach(function (p) {
      pastosPorId[p.pasture_id] = p;
      [p.nome, p.identificacao].forEach(function (k) { if (!vazio_(k) && !pastos[Utils.normalizarTexto(k)]) pastos[Utils.normalizarTexto(k)] = p; });
    });
    var racas = {};
    var listas = {};
    tx.repo.vigentes('LISTAS').forEach(function (l) {
      if (l.ativo === false) return;
      (listas[l.lista] = listas[l.lista] || []).push(l.codigo);
      if (l.lista === 'RACA') { racas[Utils.normalizarTexto(l.codigo)] = l.codigo; racas[Utils.normalizarTexto(l.rotulo)] = l.codigo; }
    });
    var semZeros = params.brinco_ignora_zeros_esquerda !== false;
    var base = {};
    tx.repo.vigentes('ANIMAIS').forEach(function (a) {
      if (vazio_(a.brinco) || a.situacao_cadastral === 'ANULADO' || a.situacao_cadastral === 'PENDENTE') return;
      base[Utils.normalizarBrinco(a.brinco, !semZeros)] = a;
    });
    return { params: params, D0: params.data_marco_zero, pastos: pastos, pastosPorId: pastosPorId, racas: racas, listas: listas, base: base, semZeros: semZeros };
  }
  function chaveBrinco_(cv, b) {
    return vazio_(b) ? null : Utils.normalizarBrinco(b, !cv.semZeros);
  }
  /** Uma linha do arquivo → {item (forma do EventService), lidos (valores lidos por campo), erros}. */
  function lerLinha_(linha, map, formato, cv) {
    var erros = [];
    var lidos = {};
    var colunaDe = {};
    Object.keys(map.colunas).forEach(function (c) { colunaDe[map.colunas[c]] = c; });
    Object.keys(linha.valores).forEach(function (k) {
      if (k.indexOf(EXTRA) === 0) erros.push(det_(null, 'COLUNAS_A_MAIS', 'a linha tem valor além das colunas do cabeçalho (posição ' + k.slice(EXTRA.length) + ')'));
    });
    Object.keys(colunaDe).forEach(function (campo) {
      var t = Utils.aparar(linha.valores[colunaDe[campo]]);
      if (t === '') return;
      var r = lerTexto_(campo, t, formato, cv);
      if (r.erro) erros.push(det_(campo, r.erro, r.msg + ' (coluna "' + colunaDe[campo] + '")'));
      else lidos[campo] = r.v;
    });
    var it = {};
    ['brinco', 'nome', 'sexo', 'raca', 'data_nascimento', 'idade_meses', 'origem', 'castrado', 'reprodutor', 'partos_previos', 'situacao_reprodutiva', 'data_prevista_parto', 'data_entrada', 'peso', 'metodo_pesagem', 'valor_abertura', 'observacoes'].forEach(function (k) {
      if (lidos[k] !== undefined) it[k] = lidos[k];
    });
    it.origem = it.origem || map.padroes.origem || 'DESCONHECIDA';
    it.pasto_destino_id = lidos.pasto || map.padroes.pasto || null;
    if (it.data_nascimento !== undefined) it.data_nascimento_confianca = lidos.data_nascimento_confianca || map.confiancas.data_nascimento || null;
    if (it.data_entrada !== undefined) it.data_entrada_confianca = lidos.data_entrada_confianca || map.confiancas.data_entrada || null;
    if (it.peso !== undefined && it.metodo_pesagem === undefined && map.padroes.metodo_pesagem) it.metodo_pesagem = map.padroes.metodo_pesagem;
    if (it.sexo === 'M') {
      SO_MACHO.forEach(function (k) { if (it[k] === undefined && typeof map.padroes[k] === 'boolean') it[k] = map.padroes[k]; });
      if (it.partos_previos === 0) delete it.partos_previos;
    }
    if (it.sexo === 'F') SO_MACHO.forEach(function (k) { if (it[k] === false) delete it[k]; });
    var outras = [];
    ['brinco_origem', 'rfid', 'sisbov', 'tatuagem'].forEach(function (k) { if (lidos[k] !== undefined) outras.push({ tipo: CAMPOS[k].ident, codigo: lidos[k] }); });
    if (outras.length) it.outras_identificacoes = outras;
    ['mae', 'pai'].forEach(function (k) {
      if (lidos[k] === undefined) return;
      it[k + '_confianca'] = lidos[k + '_confianca'] || map.confiancas[k] || null;
    });
    // Regras do formulário (mesmo catálogo) e as da entrada no marco zero.
    var defs = EventCatalog.camposAnimal('ENTRADA_INICIAL').filter(function (d) { return !FORA_DO_CATALOGO[d.id]; });
    var valores = {};
    Object.keys(it).forEach(function (k) { if (!FORA_DO_CATALOGO[k]) valores[k] = it[k]; });
    EventCatalog.validarCampos(defs, valores, { listas: cv.listas }).forEach(function (d) {
      if (erros.some(function (e) { return e.campo === d.campo; })) return;
      var msg = d.codigo === 'CAMPO_OBRIGATORIO' && SO_MACHO.indexOf(d.campo) >= 0 ? 'informe se o macho é ' + (d.campo === 'castrado' ? 'castrado' : 'reprodutor') + ' (coluna do arquivo ou valor padrão no mapeamento)' : d.mensagem;
      erros.push(det_(d.campo, d.codigo, msg));
    });
    ['mae', 'pai'].forEach(function (k) {
      if (lidos[k] !== undefined && vazio_(it[k + '_confianca'])) erros.push(det_(k + '_confianca', 'CAMPO_OBRIGATORIO', 'diga se ' + (k === 'mae' ? 'a mãe é confirmada ou estimada' : 'o pai é confirmado ou estimado')));
    });
    var D0 = cv.D0;
    if (!vazio_(it.data_nascimento) && it.idade_meses !== undefined) erros.push(det_('idade_meses', 'CONFLITO_DE_CAMPOS', 'informe a data de nascimento ou a idade, não as duas'));
    if (!vazio_(it.data_nascimento) && it.data_nascimento > D0) erros.push(det_('data_nascimento', 'NASCIMENTO_DEPOIS_DA_ENTRADA', 'o nascimento (' + br_(it.data_nascimento) + ') é depois do marco zero (' + br_(D0) + '): quem nasceu depois entra como nascimento, não no rebanho inicial'));
    if (!vazio_(it.data_entrada)) {
      if (it.data_entrada > D0) erros.push(det_('data_entrada', 'ENTRADA_DEPOIS_DO_MARCO_ZERO', 'a chegada na fazenda (' + br_(it.data_entrada) + ') não pode ser depois do marco zero'));
      if (!vazio_(it.data_nascimento) && it.data_entrada < it.data_nascimento) erros.push(det_('data_entrada', 'ENTRADA_ANTES_DO_NASCIMENTO', 'a chegada na fazenda (' + br_(it.data_entrada) + ') é anterior ao nascimento (' + br_(it.data_nascimento) + ')'));
    }
    if (it.situacao_reprodutiva === 'PRENHA' && !vazio_(it.data_prevista_parto) && it.data_prevista_parto <= D0) erros.push(det_('data_prevista_parto', 'PREVISAO_PASSADA', 'a previsão de parto precisa ser depois de ' + br_(D0)));
    if (!vazio_(it.data_prevista_parto) && it.situacao_reprodutiva !== 'PRENHA') delete it.data_prevista_parto;
    if (it.castrado === true && it.reprodutor === true) erros.push(det_('reprodutor', 'CASTRADO_REPRODUTOR', 'animal castrado não pode ser reprodutor'));
    if (cv.params.brinco_somente_numerico === true && !vazio_(it.brinco) && !/^\d+$/.test(String(it.brinco).replace(/\s+/g, ''))) erros.push(det_('brinco', 'BRINCO_NAO_NUMERICO', 'o brinco precisa ter só números'));
    return { item: it, lidos: lidos, erros: erros };
  }
  /**
   * Validação do arquivo inteiro (as duplicidades e a genealogia precisam de todas as linhas). linhas: [{linha_num,
   * valores}]. Devolve [{linha_num, status (VALIDA|ERRO|DUPLICADA), erros, item, lidos, chave, mae, pai}] na ordem
   * do arquivo, com mae/pai = {linha} (no arquivo) | {animal_id} (no rebanho) | null.
   */
  function validarLinhas(linhas, map, formato, cv) {
    if (vazio_(cv.D0)) throw Validation.erro('CONFIG', 'Defina a data do marco zero (o dia do inventário inicial) nas configurações antes de importar o rebanho.');
    var res = linhas.map(function (l) {
      var r = lerLinha_(l, map, formato, cv);
      return { linha_num: l.linha_num, status: 'VALIDA', erros: r.erros, item: r.item, lidos: r.lidos, chave: chaveBrinco_(cv, r.item.brinco), mae: null, pai: null, dup: null };
    });
    // Duplicidade: contra a base (brinco em uso) e dentro do arquivo (a primeira ocorrência fica; as outras não entram).
    var noArquivo = {};
    res.forEach(function (r) {
      if (!r.chave) return;
      var naBase = cv.base[r.chave];
      if (naBase) { r.dup = det_('brinco', 'BRINCO_JA_CADASTRADO', 'o brinco ' + r.item.brinco + ' já é do animal ' + naBase.codigo_interno + ' no rebanho'); return; }
      if (noArquivo[r.chave]) { r.dup = det_('brinco', 'BRINCO_REPETIDO_NO_ARQUIVO', 'o brinco ' + r.item.brinco + ' já aparece na linha ' + noArquivo[r.chave].linha_num); return; }
      noArquivo[r.chave] = r;
    });
    // Genealogia em duas passadas: (1) o índice acima; (2) resolução de mãe e pai no arquivo ou no rebanho.
    var porLinha = {};
    res.forEach(function (r) { porLinha[r.linha_num] = r; });
    res.forEach(function (r) {
      [['mae', 'F', 'mãe', 'fêmea'], ['pai', 'M', 'pai', 'macho']].forEach(function (cfg) {
        var b = r.lidos[cfg[0]];
        if (b === undefined) return;
        var k = chaveBrinco_(cv, b);
        if (k === r.chave) { r.erros.push(det_(cfg[0], 'PROPRIO_PROGENITOR', 'o animal não pode ser ' + cfg[2] + ' de si mesmo')); return; }
        var noArq = noArquivo[k];
        var naBase = cv.base[k];
        if (!noArq && !naBase) {
          r.erros.push(det_(cfg[0], cfg[0] === 'mae' ? 'MAE_NAO_ENCONTRADA' : 'PAI_NAO_ENCONTRADO', (cfg[0] === 'mae' ? 'a mãe' : 'o pai') + ' de brinco ' + b + ' não está no arquivo nem no rebanho. Deixe em branco (desconhecido), cadastre-' + (cfg[0] === 'mae' ? 'a' : 'o') + ' antes como animal de referência ou corrija o brinco'));
          return;
        }
        var sexo = noArq ? noArq.item.sexo : naBase.sexo;
        var nasc = noArq ? noArq.item.data_nascimento : naBase.data_nascimento;
        var nome = noArq ? 'linha ' + noArq.linha_num : naBase.codigo_interno;
        if (sexo !== cfg[1]) { r.erros.push(det_(cfg[0], 'SEXO_DO_PROGENITOR', 'o animal de brinco ' + b + ' (' + nome + ') não pode ser ' + cfg[2] + ': precisa ser ' + cfg[3])); return; }
        if (!vazio_(nasc) && !vazio_(r.item.data_nascimento) && nasc >= r.item.data_nascimento) {
          r.erros.push(det_(cfg[0], 'NASCIMENTO_DO_PROGENITOR', 'a ' + cfg[2] + ' (' + nome + ') nasceu em ' + br_(nasc) + ', não antes do animal (' + br_(r.item.data_nascimento) + ')'));
          return;
        }
        r[cfg[0]] = noArq ? { linha: noArq.linha_num } : { animal_id: naBase.animal_id };
      });
    });
    // Ciclos entre linhas do arquivo (com nascimentos desconhecidos a ordem de datas não os pega).
    res.forEach(function (r) {
      var vistos = {};
      var fila = [r];
      while (fila.length) {
        var x = fila.shift();
        [x.mae, x.pai].forEach(function (p) {
          if (!p || p.linha === undefined || vistos[p.linha]) return;
          if (p.linha === r.linha_num) { vistos.ciclo = true; return; }
          vistos[p.linha] = true;
          fila.push(porLinha[p.linha]);
        });
        if (vistos.ciclo) break;
      }
      if (vistos.ciclo) r.erros.push(det_('mae', 'CICLO_GENEALOGICO', 'a genealogia desta linha forma um ciclo (o animal seria ancestral de si mesmo)'));
    });
    res.forEach(function (r) { r.status = r.dup ? 'DUPLICADA' : r.erros.length ? 'ERRO' : 'VALIDA'; if (r.dup) r.erros.unshift(r.dup); });
    // Progenitor do arquivo que não entra reprova o filho (até estabilizar).
    for (var mudou = true, guarda = 0; mudou && guarda < res.length + 1; guarda++) {
      mudou = false;
      res.forEach(function (r) {
        if (r.status !== 'VALIDA') return;
        [['mae', 'a mãe', 'MAE_COM_ERRO'], ['pai', 'o pai', 'PAI_COM_ERRO']].forEach(function (cfg) {
          var p = r[cfg[0]];
          if (r.status !== 'VALIDA' || !p || p.linha === undefined || porLinha[p.linha].status === 'VALIDA') return;
          r.erros.push(det_(cfg[0], cfg[2], cfg[1] + ' (linha ' + p.linha + ') não pode ser importad' + (cfg[0] === 'mae' ? 'a' : 'o') + ': corrija a linha ' + p.linha + ' ou deixe em branco'));
          r.status = 'ERRO';
          mudou = true;
        });
      });
    }
    return res;
  }
  /** Ordem de importação: progenitor do arquivo antes do filho; empate pela linha do arquivo (determinística). */
  function ordenarParaImportar_(lista) {
    var pend = {};
    lista.forEach(function (r) { pend[r.linha_num] = r; });
    var feitos = {};
    var out = [];
    var restantes = Utils.ordenarPor(lista, ['linha_num']);
    while (restantes.length) {
      var prontos = restantes.filter(function (r) {
        return [r.mae, r.pai].every(function (p) { return !p || p.linha === undefined || !pend[p.linha] || feitos[p.linha]; });
      });
      if (!prontos.length) prontos = [restantes[0]];
      prontos.forEach(function (r) { feitos[r.linha_num] = true; out.push(r); });
      restantes = restantes.filter(function (r) { return !feitos[r.linha_num]; });
    }
    return out;
  }
  function errosParaLinha_(erros) {
    return (erros || []).map(function (e) { return { codigo: e.codigo, campo: e.campo || null, mensagem: e.mensagem }; });
  }

  // ------------------------------------------------------------------ estado gravado ----
  function leiturasImportacao_() {
    return Utils.unicos(EventService.leiturasEntrada().concat(['IMPORTACOES', 'IMPORTACAO_LINHAS', 'ANEXOS', 'PASTOS', 'LISTAS', 'CONFIGURACOES', 'PROPRIEDADES']));
  }
  var LEITURAS_VALIDACAO = Object.freeze(['IMPORTACOES', 'IMPORTACAO_LINHAS', 'ANEXOS', 'ANIMAIS', 'PASTOS', 'LISTAS', 'CONFIGURACOES']);
  function exigirImportacao_(tx, id) {
    var imp = vazio_(id) ? null : tx.repo.porId('IMPORTACOES', id);
    if (!imp) throw Validation.erro('NOT_FOUND', 'A importação não foi encontrada. Atualize a tela.');
    return imp;
  }
  /** Linhas gravadas da importação, por linha_num (a primeira de cada número; linha de lote que caiu é reaproveitada). */
  function linhasGravadas_(tx, importId) {
    var out = {};
    tx.repo.por('IMPORTACAO_LINHAS', 'import_id', importId).forEach(function (l) { if (!out[l.linha_num]) out[l.linha_num] = l; });
    return out;
  }
  function relatorio_(imp) {
    var r = imp.relatorio_json && typeof imp.relatorio_json === 'object' ? Utils.clonar(imp.relatorio_json) : {};
    if (typeof r.conferidas !== 'number') r.conferidas = 0;
    if (!r.por_codigo) r.por_codigo = {};
    return r;
  }
  function tamanhoLote_(params) {
    var n = Math.floor(Number(params.importacao_lote_linhas) || 200);
    return Math.min(LOTE_MAX, Math.max(1, n));
  }
  function porCodigo_(resultados) {
    var c = {};
    resultados.forEach(function (r) { if (r.status !== 'VALIDA') (r.erros || []).forEach(function (e) { c[e.codigo] = (c[e.codigo] || 0) + 1; }); });
    return c;
  }
  function importacaoPublica_(imp) {
    return {
      import_id: imp.import_id, tipo: imp.tipo, arquivo_nome: imp.arquivo_nome, arquivo_anexo_id: imp.arquivo_anexo_id, arquivo_hash: imp.arquivo_hash,
      mapeamento: imp.mapeamento_json || null, formato: imp.formato_json || null, total_linhas: imp.total_linhas, linhas_validas: imp.linhas_validas || 0,
      linhas_erro: imp.linhas_erro || 0, linhas_importadas: imp.linhas_importadas || 0, modo: imp.modo || null, status: imp.status,
      relatorio: relatorio_(imp), created_by: imp.created_by, created_at: imp.created_at, finished_at: imp.finished_at || null,
    };
  }
  /** Linhas do arquivo a partir do que está gravado (dados_originais_json), em ordem. */
  function linhasDoArquivo_(gravadas) {
    return Utils.ordenarPor(Object.keys(gravadas).map(function (k) { return gravadas[k]; }), ['linha_num']).map(function (l) {
      return { linha_num: l.linha_num, valores: l.dados_originais_json || {} };
    });
  }
  /** Conjunto a importar (fixado na confirmação): VALIDA e IMPORTADA, sem IGNORADA, na ordem de importação. */
  function conjuntoImportavel_(gravadas, frescos) {
    var porNum = {};
    frescos.forEach(function (r) { porNum[r.linha_num] = r; });
    var lista = Object.keys(gravadas).map(function (k) { return gravadas[k]; }).filter(function (l) { return l.status === 'VALIDA' || l.status === 'IMPORTADA'; })
      .map(function (l) { return porNum[l.linha_num]; }).filter(Boolean);
    return ordenarParaImportar_(lista);
  }
  function estadoBlocos_(imp, gravadas, frescos) {
    var rel = relatorio_(imp);
    var lote = rel.lote_linhas || null;
    if (!lote || imp.status === 'RASCUNHO' || imp.status === 'VALIDADO') return { tamanho: lote, total: null, importados: 0, proximo: null };
    var conj = conjuntoImportavel_(gravadas, frescos);
    var total = Math.ceil(conj.length / lote);
    var importados = 0;
    for (var b = 1; b <= total; b++) {
      var linhas = conj.slice((b - 1) * lote, b * lote);
      if (linhas.every(function (r) { return gravadas[r.linha_num].status === 'IMPORTADA'; })) importados = b; else break;
    }
    return { tamanho: lote, total: total, importados: importados, proximo: imp.status === 'IMPORTANDO' && importados < total ? importados + 1 : null };
  }

  // ------------------------------------------------------------------ criar ----
  /** Leva à lixeira o arquivo enviado quando o comando com certeza não vale; falha vira ERROS_LOG. */
  function descartarArquivo_(ctx, chave, fileId, rota) {
    var situacao = 'DESCONHECIDA';
    try {
      situacao = vazio_(chave) ? 'INEXISTENTE' : UnitOfWork.status(ctx, chave).situacao;
      if (situacao === 'FALHOU' || situacao === 'INEXISTENTE') ctx.files.lixeira(fileId);
    } catch (e) {
      UnitOfWork.anotarErro(ctx, { contexto: rota, codigo: 'LIXEIRA_FALHOU', mensagem: 'Arquivo ' + fileId + ' (situação ' + situacao + ') não foi para a lixeira: ' + texto_(e), erro: e });
    }
    UnitOfWork.descarregarErros(ctx);
  }
  function amostra_(arq) {
    return { cabecalho: arq.cabecalho, amostra: arq.linhas.slice(0, 5), total_linhas: arq.linhas.length, sugestao: sugerirMapeamento(arq.cabecalho) };
  }
  /**
   * importacao.criar. pedido: {idempotencyKey, avisosAceitos, dados: {tipo: 'ANIMAIS', arquivo_nome, conteudo_base64
   * (arquivo CSV) | texto (linhas coladas), formato: {delimitador, codificacao, formato_data, decimal}}}.
   * O arquivo original vai para o Drive (pasta Anexos) e para ANEXOS, com o hash do conteúdo; a importação nasce
   * RASCUNHO. Mesmo arquivo já enviado → aviso POSSIVEL_DUPLICIDADE. Recusado enquanto outra importação está em
   * andamento. Devolve {dados: {import_id, status, cabecalho, amostra, total_linhas, sugestao}, ...}.
   */
  function criar(ctx, pedido) {
    var files = exigirFiles_(ctx);
    var p = pedido || {};
    var d = p.dados || {};
    if (Schema.enumValores('TIPO_IMPORTACAO').indexOf(d.tipo) < 0) throw recusar_('Escolha o que o arquivo traz.', [det_('tipo', 'VALOR_FORA_DA_LISTA', 'Tipo de importação desconhecido.')]);
    if (TIPOS_SUPORTADOS.indexOf(d.tipo) < 0) throw recusar_('A importação de ' + d.tipo.toLowerCase() + ' chega numa próxima fase do sistema. Por enquanto, importe o rebanho (animais).', [det_('tipo', 'TIPO_INDISPONIVEL', 'Ainda não disponível.')]);
    var colado = typeof d.texto === 'string';
    if (!colado && (typeof d.conteudo_base64 !== 'string' || d.conteudo_base64 === '')) throw recusar_('Envie o arquivo ou cole as linhas da planilha.', [det_('conteudo_base64', 'CAMPO_OBRIGATORIO', 'Arquivo vazio.')]);
    var formato = conferirFormato_(Object.assign({}, d.formato || {}, colado ? { codificacao: 'UTF-8' } : {}));
    var nome = vazio_(d.arquivo_nome) ? (colado ? 'linhas-coladas.txt' : 'arquivo.csv') : String(d.arquivo_nome).slice(0, 200);
    var texto = colado ? d.texto : files.textoDeBase64(d.conteudo_base64, formato.codificacao);
    var arq = interpretarArquivo(texto, formato.delimitador);
    var hash = ctx.hash.sha256Hex(texto);
    var dados = { tipo: d.tipo, arquivo_nome: nome, formato: formato, arquivo_hash: hash, colado: colado };
    var comando = {
      rota: 'importacao.criar', idempotencyKey: p.idempotencyKey, dados: dados, avisosAceitos: p.avisosAceitos,
      reads: ['IMPORTACOES', 'ANEXOS'],
      reconstruir: function (tx, op) { var imp = tx.repo.porId('IMPORTACOES', op.resumo.import_id); var out = amostra_(arq); out.import_id = op.resumo.import_id; out.status = imp ? imp.status : null; return out; },
      tratador: null,
    };
    if (!vazio_(p.idempotencyKey) && UnitOfWork.status(ctx, p.idempotencyKey).situacao === 'CONFIRMADA') {
      comando.tratador = function () { throw interno_('Operação já confirmada: a UnitOfWork devolve o resultado gravado.'); };
      return UnitOfWork.run(ctx, comando);
    }
    var guardado = files.guardarArquivo({
      nome: nome, mimeType: colado ? 'text/plain' : 'text/csv', texto: colado ? texto : undefined, base64: colado ? undefined : d.conteudo_base64,
      pasta: 'anexos', appProperties: { erp_tipo: 'ANEXO', erp_banco: ctx.banco, erp_entidade: 'IMPORTACOES' },
    });
    comando.tratador = function (tx) {
      var x = tx.dados;
      var avisos = tx.repo.vigentes('IMPORTACOES').filter(function (i) { return i.arquivo_hash === x.arquivo_hash && i.status !== 'CANCELADO'; }).map(function (i) {
        return Validation.detalhe({ codigo: 'POSSIVEL_DUPLICIDADE', mensagem: 'Este mesmo arquivo já foi enviado em ' + br_(String(i.created_at).slice(0, 10)) + ' (' + i.arquivo_nome + ', situação ' + i.status.toLowerCase() + '). Enviar de novo mesmo assim?' });
      });
      var importId = tx.novoId();
      var anexoId = tx.novoId();
      AuditService.criacao(tx, 'ANEXOS', anexoId, {
        entidade: 'IMPORTACOES', entity_id: importId, drive_file_id: guardado.id, nome_arquivo: x.arquivo_nome, mime_type: x.colado ? 'text/plain' : 'text/csv',
        tamanho_bytes: Math.max(1, guardado.tamanho), tipo: 'DOCUMENTO', descricao: 'Arquivo original da importação', status: 'ATIVO', created_by: tx.usuario, created_at: tx.agora,
      });
      AuditService.criacao(tx, 'IMPORTACOES', importId, {
        tipo: x.tipo, arquivo_nome: x.arquivo_nome, arquivo_anexo_id: anexoId, arquivo_hash: x.arquivo_hash, formato_json: x.formato,
        total_linhas: arq.linhas.length, linhas_validas: 0, linhas_erro: 0, linhas_importadas: 0, status: 'RASCUNHO',
        relatorio_json: { conferidas: 0, por_codigo: {} }, created_by: tx.usuario, created_at: tx.agora,
      });
      var out = amostra_(arq);
      out.import_id = importId;
      out.status = 'RASCUNHO';
      return { avisos: avisos, resumo: { import_id: importId, anexo_id: anexoId }, resposta: out };
    };
    try {
      var r = UnitOfWork.run(ctx, comando);
      if (r.duplicado) descartarArquivo_(ctx, null, guardado.id, 'importacao.criar');
      return r;
    } catch (e) {
      descartarArquivo_(ctx, p.idempotencyKey, guardado.id, 'importacao.criar');
      throw e;
    }
  }

  // ------------------------------------------------------------------ validar em blocos ----
  function lerOriginal_(ctx, importId) {
    var info = UnitOfWork.read(ctx, {
      rota: 'importacao.validarBloco', reads: ['IMPORTACOES', 'ANEXOS'],
      tratador: function (tx) {
        var imp = exigirImportacao_(tx, importId);
        var anexo = vazio_(imp.arquivo_anexo_id) ? null : tx.repo.porId('ANEXOS', imp.arquivo_anexo_id);
        return { imp: Utils.clonar(imp), anexo: Utils.clonar(anexo) };
      },
    }).dados;
    if (!info.anexo) throw Validation.erro('NOT_FOUND', 'O arquivo original desta importação não foi encontrado. Envie o arquivo de novo.');
    var b = ctx.files.lerBytes(info.anexo.drive_file_id);
    var formato = info.imp.formato_json || {};
    var texto = ctx.files.textoDeBase64(b.base64, formato.codificacao || 'UTF-8');
    if (ctx.hash.sha256Hex(texto) !== info.imp.arquivo_hash) throw Validation.erro('CONFLICT', 'O arquivo original guardado no Drive foi alterado depois do envio. Comece uma importação nova com o arquivo certo.');
    return { imp: info.imp, arquivo: interpretarArquivo(texto, formato.delimitador) };
  }
  /** Cabeçalho, primeiras linhas e sugestão de mapeamento de uma importação já criada (retomar o assistente). */
  function previaArquivo(ctx, dados) {
    exigirFiles_(ctx);
    var o = lerOriginal_(ctx, (dados || {}).import_id);
    var out = amostra_(o.arquivo);
    out.import_id = o.imp.import_id;
    out.status = o.imp.status;
    out.mapeamento = o.imp.mapeamento_json || null;
    return out;
  }
  /**
   * importacao.validarBloco. pedido: {idempotencyKey, dados: {import_id, bloco (1, 2, ...), mapeamento}}. O arquivo
   * inteiro é relido e validado (duplicidades e genealogia precisam de tudo); só as linhas do bloco são gravadas
   * (IMPORTACAO_LINHAS, com o texto original, o status e os motivos). O bloco 1 recomeça a validação (grava o
   * mapeamento); os seguintes exigem o mesmo mapeamento e o bloco anterior validado. Ao validar a última linha, a
   * importação fica VALIDADO. Devolve {dados: estado da importação (obter), ...}.
   */
  function validarBloco(ctx, pedido) {
    exigirFiles_(ctx);
    var p = pedido || {};
    var d = p.dados || {};
    var bloco = Math.floor(Number(d.bloco));
    if (!(bloco >= 1)) throw recusar_('Informe o número do bloco a validar.', [det_('bloco', 'CAMPO_OBRIGATORIO', 'Bloco inválido.')]);
    var orig = lerOriginal_(ctx, d.import_id);
    var arq = orig.arquivo;
    return UnitOfWork.run(ctx, {
      rota: 'importacao.validarBloco', idempotencyKey: p.idempotencyKey, dados: { import_id: d.import_id, bloco: bloco, mapeamento: d.mapeamento || {} },
      reads: LEITURAS_VALIDACAO, anexaSemPai: ['IMPORTACAO_LINHAS'], permiteDuranteImportacao: true,
      reconstruir: function (tx, op) { return estado_(tx, op.resumo.import_id); },
      tratador: function (tx) {
        var imp = exigirImportacao_(tx, d.import_id);
        if (!ESTADOS_VALIDAVEIS[imp.status]) throw Validation.erro('CONFLICT', 'Esta importação está ' + imp.status.toLowerCase() + ' e não pode mais ser validada.');
        var cv = contextoValidacao_(tx);
        var map = conferirMapeamento(tx.dados.mapeamento, arq.cabecalho, cv.pastosPorId);
        var formato = imp.formato_json || {};
        var tam = tamanhoLote_(cv.params);
        var total = arq.linhas.length;
        var blocos = Math.ceil(total / tam);
        if (bloco > blocos) throw recusar_('O arquivo tem só ' + blocos + ' bloco(s) de validação.', [det_('bloco', 'VALOR_FORA_DA_FAIXA', 'Bloco inexistente.')]);
        var rel = relatorio_(imp);
        var mesmoMapa = JSON.stringify(Utils.jsonCanonico(imp.mapeamento_json || null)) === JSON.stringify(Utils.jsonCanonico(map));
        if (bloco > 1 && !mesmoMapa) throw Validation.erro('CONFLICT', 'O mapeamento das colunas mudou: valide de novo a partir do primeiro bloco.');
        if (bloco > 1 && rel.conferidas < (bloco - 1) * tam) throw Validation.erro('CONFLICT', 'Valide os blocos em ordem: falta o bloco ' + (Math.floor(rel.conferidas / tam) + 1) + '.');
        var res = validarLinhas(arq.linhas, map, formato, cv);
        var gravadas = linhasGravadas_(tx, imp.import_id);
        var doBloco = res.slice((bloco - 1) * tam, bloco * tam);
        doBloco.forEach(function (r) {
          var erros = r.erros.length ? errosParaLinha_(r.erros) : null;
          var g = gravadas[r.linha_num];
          if (!g) {
            var original = arq.linhas.filter(function (l) { return l.linha_num === r.linha_num; })[0];
            tx.plano.anexar('IMPORTACAO_LINHAS', { import_line_id: tx.novoId(), import_id: imp.import_id, linha_num: r.linha_num, dados_originais_json: original.valores, status: r.status, erros_json: erros });
            return;
          }
          AuditService.alteracao(tx, 'IMPORTACAO_LINHAS', g.import_line_id, { status: r.status, erros_json: erros });
        });
        var conferidas = bloco === 1 ? doBloco.length : Math.max(rel.conferidas, Math.min(total, bloco * tam));
        var validadas = res.slice(0, conferidas);
        var novoRel = { conferidas: conferidas, por_codigo: porCodigo_(validadas) };
        var campos = {
          mapeamento_json: map, relatorio_json: novoRel, status: conferidas >= total ? 'VALIDADO' : 'RASCUNHO',
          linhas_validas: validadas.filter(function (r) { return r.status === 'VALIDA'; }).length,
          linhas_erro: validadas.filter(function (r) { return r.status !== 'VALIDA'; }).length,
        };
        AuditService.alteracao(tx, 'IMPORTACOES', imp.import_id, campos);
        return { resumo: { import_id: imp.import_id, bloco: bloco, conferidas: conferidas }, resposta: function (t) { return estado_(t, imp.import_id); } };
      },
    });
  }

  // ------------------------------------------------------------------ importar em blocos ----
  /**
   * importacao.importarBloco. pedido: {dados: {import_id, bloco, modo (só no bloco 1: TOTAL | PARCIAL_APROVADO),
   * aprovacao (bloco 1, parcial: {importar: N, ignorar: M} — os números que o dono viu), ignorar_linhas (bloco 1:
   * linhas válidas que o dono tirou), property_id, justificativa_aviso}, avisosAceitos}. A chave de idempotência é
   * a do bloco (`imp:<import_id>:<n>`): reenviar um bloco que gravou devolve duplicado. Cada bloco grava UMA
   * ENTRADA_INICIAL (as regras do formulário) com import_id: os animais só valem quando a importação concluir.
   * Devolve {dados: estado da importação, ...}. Erros: VALIDATION, CONFLICT, NEEDS_CONFIRMATION, CONFIG.
   */
  function importarBloco(ctx, pedido) {
    var p = pedido || {};
    var d = p.dados || {};
    var bloco = Math.floor(Number(d.bloco));
    if (!(bloco >= 1) || vazio_(d.import_id)) throw recusar_('Informe a importação e o número do bloco.', [det_('bloco', 'CAMPO_OBRIGATORIO', 'Bloco inválido.')]);
    var dados = { import_id: d.import_id, bloco: bloco };
    if (bloco === 1) {
      dados.modo = d.modo || null;
      dados.aprovacao = d.aprovacao || null;
      dados.ignorar_linhas = Array.isArray(d.ignorar_linhas) ? d.ignorar_linhas.slice().sort(function (a, b) { return a - b; }) : [];
      dados.property_id = d.property_id || null;
    }
    if (!vazio_(d.justificativa_aviso)) dados.justificativa_aviso = d.justificativa_aviso;
    return UnitOfWork.run(ctx, {
      rota: 'importacao.importarBloco', idempotencyKey: chaveBloco(d.import_id, bloco), dados: dados, avisosAceitos: p.avisosAceitos,
      reads: leiturasImportacao_(), acessoCru: true, permiteDuranteImportacao: true,
      reconstruir: function (tx, op) { return estado_(tx, op.resumo.import_id); },
      tratador: function (tx) { return planejarBloco_(tx, bloco); },
    });
  }
  function confirmar_(tx, imp, gravadas, frescos, cv) {
    var d = tx.dados;
    var porNum = {};
    frescos.forEach(function (r) { porNum[r.linha_num] = r; });
    // O dono aprovou o que viu: a revalidação de agora tem de dar o mesmo resultado.
    var divergentes = frescos.filter(function (r) {
      var g = gravadas[r.linha_num];
      return !g || (g.status === 'VALIDA') !== (r.status === 'VALIDA');
    });
    if (divergentes.length) throw Validation.erro('CONFLICT', 'O rebanho ou o cadastro mudou desde a validação (' + divergentes.length + ' linha(s) com resultado diferente, a primeira é a ' + divergentes[0].linha_num + '). Valide o arquivo de novo antes de importar.');
    var ignorar = d.ignorar_linhas || [];
    var erros = [];
    ignorar.forEach(function (n) {
      if (!gravadas[n] || gravadas[n].status !== 'VALIDA') erros.push(det_('ignorar_linhas', 'LINHA_INVALIDA', 'A linha ' + n + ' não é uma linha válida que possa ser deixada de fora.'));
    });
    frescos.forEach(function (r) {
      if (r.status !== 'VALIDA' || ignorar.indexOf(r.linha_num) >= 0) return;
      [r.mae, r.pai].forEach(function (x) {
        if (x && x.linha !== undefined && ignorar.indexOf(x.linha) >= 0) erros.push(det_('ignorar_linhas', 'PROGENITOR_IGNORADO', 'A linha ' + x.linha + ' é mãe ou pai da linha ' + r.linha_num + ': deixe as duas de fora ou nenhuma.'));
      });
    });
    if (erros.length) return { erros: erros };
    var total = imp.total_linhas;
    var validas = frescos.filter(function (r) { return r.status === 'VALIDA'; }).length - ignorar.length;
    var reprovadas = total - validas - ignorar.length;
    if (!validas) return { erros: [det_('modo', 'NADA_A_IMPORTAR', 'Nenhuma linha válida para importar. Corrija o arquivo e envie de novo.')] };
    if (d.modo === 'TOTAL') {
      if (reprovadas || ignorar.length) return { erros: [det_('modo', 'IMPORTACAO_TOTAL_RECUSADA', 'Há ' + (reprovadas + ignorar.length) + ' linha(s) com erro, duplicadas ou deixadas de fora: corrija o arquivo ou aprove importar só as ' + validas + ' válidas.')] };
    } else if (d.modo === 'PARCIAL_APROVADO') {
      var a = d.aprovacao || {};
      if (a.importar !== validas || a.ignorar !== reprovadas + ignorar.length) {
        return { erros: [det_('aprovacao', 'APROVACAO_DIVERGENTE', 'Confirme de novo: serão importadas ' + validas + ' linha(s) e ficarão de fora ' + (reprovadas + ignorar.length) + '.')] };
      }
    } else return { erros: [det_('modo', 'CAMPO_OBRIGATORIO', 'Escolha importar tudo ou só as linhas válidas.')] };
    ignorar.forEach(function (n) { AuditService.alteracao(tx, 'IMPORTACAO_LINHAS', gravadas[n].import_line_id, { status: 'IGNORADA' }, 'Deixada de fora pelo dono na pré-visualização.'); });
    var lote = tamanhoLote_(cv.params);
    var rel = relatorio_(imp);
    rel.lote_linhas = lote;
    rel.blocos = Math.ceil(validas / lote);
    rel.ignoradas = ignorar.length;
    var justificativa = d.modo === 'PARCIAL_APROVADO'
      ? 'Importação parcial aprovada por ' + tx.usuario + ': importar ' + validas + ' linha(s) válidas e deixar de fora ' + (reprovadas + ignorar.length) + '.'
      : 'Importação total confirmada por ' + tx.usuario + ': ' + validas + ' linha(s).';
    AuditService.alteracao(tx, 'IMPORTACOES', imp.import_id, { modo: d.modo, status: 'IMPORTANDO', relatorio_json: rel, linhas_validas: validas, linhas_erro: reprovadas }, justificativa);
    return { lote: lote, imp: Object.assign({}, imp, { relatorio_json: rel }), ignorar: ignorar };
  }
  function planejarBloco_(tx, bloco) {
    var d = tx.dados;
    var imp = exigirImportacao_(tx, d.import_id);
    if (bloco === 1 && imp.status !== 'VALIDADO') {
      throw Validation.erro('CONFLICT', imp.status === 'RASCUNHO' ? 'Termine a validação do arquivo antes de importar.' : 'Esta importação está ' + imp.status.toLowerCase() + '.');
    }
    if (bloco > 1 && imp.status !== 'IMPORTANDO') throw Validation.erro('CONFLICT', 'Esta importação está ' + imp.status.toLowerCase() + ': não há blocos a importar.');
    var cv = contextoValidacao_(tx);
    var gravadas = linhasGravadas_(tx, imp.import_id);
    var map = imp.mapeamento_json;
    var frescos = validarLinhas(linhasDoArquivo_(gravadas), map, imp.formato_json || {}, cv);
    var lote;
    var ignorar = [];
    if (bloco === 1) {
      var c = confirmar_(tx, imp, gravadas, frescos, cv);
      if (c.erros) return { erros: c.erros };
      lote = c.lote;
      ignorar = c.ignorar;
    } else lote = relatorio_(imp).lote_linhas;
    var conj = conjuntoImportavel_(gravadas, frescos).filter(function (r) { return ignorar.indexOf(r.linha_num) < 0; });
    var blocos = Math.ceil(conj.length / lote);
    if (bloco > blocos) throw recusar_('Esta importação tem ' + blocos + ' bloco(s).', [det_('bloco', 'VALOR_FORA_DA_FAIXA', 'Bloco inexistente.')]);
    var anteriores = conj.slice(0, (bloco - 1) * lote);
    var falta = anteriores.filter(function (r) { return gravadas[r.linha_num].status !== 'IMPORTADA'; })[0];
    if (falta) throw Validation.erro('CONFLICT', 'Importe os blocos em ordem: a linha ' + falta.linha_num + ', de um bloco anterior, ainda não foi importada.');
    var doBloco = conj.slice((bloco - 1) * lote, bloco * lote);
    if (doBloco.every(function (r) { return gravadas[r.linha_num].status === 'IMPORTADA'; })) {
      return { resposta: function (t) { return estado_(t, imp.import_id); } }; // já importado (por outra chave): nada a gravar
    }
    var invalida = doBloco.filter(function (r) { return r.status !== 'VALIDA'; })[0];
    if (invalida) throw Validation.erro('CONFLICT', 'A linha ' + invalida.linha_num + ' deixou de ser válida (' + invalida.erros.map(function (e) { return e.mensagem; }).join('; ') + '). Desfaça esta importação e valide o arquivo de novo.');
    // Itens do bloco, com mãe e pai: no mesmo bloco por referência; em bloco anterior pelo animal pendente
    // (aceito como "conhecido"); no rebanho pelo animal_id.
    var noBloco = {};
    doBloco.forEach(function (r) { noBloco[r.linha_num] = true; });
    var porNum = {};
    frescos.forEach(function (r) { porNum[r.linha_num] = r; });
    var conhecidos = {};
    var itens = doBloco.map(function (r) {
      var it = Utils.clonar(r.item);
      it.ref = 'L' + r.linha_num;
      [['mae', 'mae_id', 'mae_ref'], ['pai', 'pai_id', 'pai_ref']].forEach(function (cfg) {
        var x = r[cfg[0]];
        if (!x) { delete it[cfg[0] + '_confianca']; return; }
        if (x.animal_id) { it[cfg[1]] = x.animal_id; return; }
        if (noBloco[x.linha]) { it[cfg[2]] = 'L' + x.linha; return; }
        var gp = gravadas[x.linha];
        it[cfg[1]] = gp.entity_id_gerado;
        var pr = porNum[x.linha];
        conhecidos[gp.entity_id_gerado] = {
          sexo: pr.item.sexo, data_nascimento: pr.item.data_nascimento || null, nome: 'linha ' + x.linha,
          mae_id: pr.mae ? (pr.mae.animal_id || (gravadas[pr.mae.linha] && gravadas[pr.mae.linha].entity_id_gerado) || null) : null,
          pai_id: pr.pai ? (pr.pai.animal_id || (gravadas[pr.pai.linha] && gravadas[pr.pai.linha].entity_id_gerado) || null) : null,
        };
      });
      return it;
    });
    var r = EventService.planejarEntradaImportada(tx, {
      campos: { property_id: d.property_id || (imp.relatorio_json && imp.relatorio_json.property_id) || null, description: 'Importação de planilha: ' + imp.arquivo_nome + ' (bloco ' + bloco + ')' },
      animais: itens,
    }, { importacao: { import_id: imp.import_id }, conhecidos: conhecidos, rotulos: doBloco.map(function (x) { return 'Linha ' + x.linha_num; }) });
    if (r.erros) return { erros: r.erros };
    var eventId = r.resumo.event_id;
    var ids = r.derivados.animais;
    if (ids.length !== doBloco.length) throw interno_('O plano do bloco não criou um animal por linha.');
    doBloco.forEach(function (x, i) {
      AuditService.alteracao(tx, 'IMPORTACAO_LINHAS', gravadas[x.linha_num].import_line_id, { status: 'IMPORTADA', entity_id_gerado: ids[i], event_id_gerado: eventId });
    });
    var jaImportadas = conj.filter(function (x) { return gravadas[x.linha_num].status === 'IMPORTADA'; }).length;
    AuditService.alteracao(tx, 'IMPORTACOES', imp.import_id, { linhas_importadas: jaImportadas + doBloco.length });
    return {
      avisos: r.avisos, resumo: { import_id: imp.import_id, bloco: bloco, event_id: eventId, linhas: doBloco.length },
      resposta: function (t) { return estado_(t, imp.import_id); },
    };
  }

  // ------------------------------------------------------------------ concluir e desfazer ----
  /**
   * importacao.concluir. pedido: {dados: {import_id}}. Exige todos os blocos importados; faz backup ANTES; troca o
   * status para IMPORTADO (o commit do arquivo inteiro: os eventos passam a valer) e reconstrói todas as projeções.
   * Chave `imp:<import_id>:concluir`. Devolve {dados: relatório final, ...}.
   */
  function concluir(ctx, pedido) {
    var d = (pedido && pedido.dados) || {};
    var chave = chaveBloco(d.import_id, 'concluir');
    var comando = {
      rota: 'importacao.concluir', idempotencyKey: chave, dados: { import_id: d.import_id }, reads: leiturasImportacao_(), acessoCru: true, permiteDuranteImportacao: true,
      reconstruir: function (tx) { return relatorioFinal_(tx, d.import_id); },
      tratador: function (tx) {
        var imp = exigirImportacao_(tx, d.import_id);
        if (imp.status !== 'IMPORTANDO') throw Validation.erro('CONFLICT', 'Esta importação está ' + imp.status.toLowerCase() + ': não há o que concluir.');
        var gravadas = linhasGravadas_(tx, imp.import_id);
        var lista = Object.keys(gravadas).map(function (k) { return gravadas[k]; });
        var pendentes = lista.filter(function (l) { return l.status === 'VALIDA'; });
        if (pendentes.length) throw Validation.erro('CONFLICT', 'Ainda faltam ' + pendentes.length + ' linha(s) a importar. Use "Retomar" para importar os blocos que faltam.');
        var importadas = lista.filter(function (l) { return l.status === 'IMPORTADA'; });
        var rel = relatorio_(imp);
        rel.criados = importadas.length;
        AuditService.alteracao(tx, 'IMPORTACOES', imp.import_id, { status: 'IMPORTADO', finished_at: tx.agora, linhas_importadas: importadas.length, relatorio_json: rel });
        return { resumo: { import_id: imp.import_id, criados: importadas.length }, derivados: { tudo: true }, resposta: function (t) { return relatorioFinal_(t, imp.import_id); } };
      },
    };
    var st = UnitOfWork.status(ctx, chave);
    if (st.situacao !== 'CONFIRMADA') {
      var atual = obter(ctx, { import_id: d.import_id }).dados;
      if (atual.importacao.status !== 'IMPORTANDO') throw Validation.erro('CONFLICT', 'Esta importação está ' + atual.importacao.status.toLowerCase() + ': não há o que concluir.');
      if (atual.blocos.proximo !== null) throw Validation.erro('CONFLICT', 'Ainda faltam blocos a importar (próximo: ' + atual.blocos.proximo + '). Use "Retomar".');
      Maintenance.backup(ctx, { motivo: 'IMPORTACAO' });
    }
    return UnitOfWork.run(ctx, comando);
  }
  /** Quem depende dos animais importados fora da importação (bloqueia desfazer uma importação concluída). */
  function dependentes_(tx, imp, gravadas) {
    var animais = {};
    var eventos = {};
    Object.keys(gravadas).forEach(function (k) {
      var l = gravadas[k];
      if (l.status !== 'IMPORTADA') return;
      if (!vazio_(l.entity_id_gerado)) animais[l.entity_id_gerado] = true;
      if (!vazio_(l.event_id_gerado)) eventos[l.event_id_gerado] = true;
    });
    var out = [];
    Object.keys(animais).forEach(function (id) {
      var a = tx.repo.porId('ANIMAIS', id) || {};
      var quem = (a.codigo_interno || id) + (vazio_(a.brinco) ? '' : ' (brinco ' + a.brinco + ')');
      tx.repo.por('EVENTO_ANIMAIS', 'animal_id', id).forEach(function (l) {
        if (eventos[l.event_id]) return;
        var ev = tx.repo.porId('EVENTOS', l.event_id) || {};
        out.push(Validation.detalhe({ codigo: 'DEPENDENTE', animal_id: id, brinco: a.brinco || null, mensagem: quem + ' tem o lançamento ' + (ev.event_type || '').toLowerCase() + ' de ' + br_(ev.event_date) + ' feito depois da importação.', conflito: { event_id: l.event_id, tipo: ev.event_subtype || ev.event_type || null, data: ev.event_date || null } }));
      });
      tx.repo.por('ANIMAIS', 'mae_id', id).concat(tx.repo.por('ANIMAIS', 'pai_id', id)).forEach(function (f) {
        if (animais[f.animal_id]) return;
        out.push(Validation.detalhe({ codigo: 'DEPENDENTE', animal_id: id, brinco: a.brinco || null, mensagem: quem + ' é mãe ou pai do animal ' + f.codigo_interno + ', cadastrado fora da importação.' }));
      });
      tx.repo.por('ANEXOS', 'entity_id', id).forEach(function (x) {
        if (x.entidade === 'ANIMAIS' && x.status !== 'REMOVIDO') out.push(Validation.detalhe({ codigo: 'DEPENDENTE', animal_id: id, brinco: a.brinco || null, mensagem: quem + ' tem o arquivo anexado "' + x.nome_arquivo + '". Remova-o antes.' }));
      });
    });
    return out;
  }
  /**
   * importacao.desfazer. pedido: {dados: {import_id, justificativa}}. Leva a importação a CANCELADO: nenhum evento dela
   * vale, sem apagar linha (as linhas e o arquivo original ficam como prova). Importação concluída só se desfaz se
   * nenhum lançamento posterior depende dos animais (CONFLICT listando-os). Chave `imp:<import_id>:desfazer`.
   */
  function desfazer(ctx, pedido) {
    var d = (pedido && pedido.dados) || {};
    return UnitOfWork.run(ctx, {
      rota: 'importacao.desfazer', idempotencyKey: chaveBloco(d.import_id, 'desfazer'), dados: { import_id: d.import_id, justificativa: d.justificativa || null },
      reads: leiturasImportacao_(), acessoCru: true, permiteDuranteImportacao: true,
      reconstruir: function (tx) { return relatorioFinal_(tx, d.import_id); },
      tratador: function (tx) {
        var imp = exigirImportacao_(tx, d.import_id);
        if (imp.status === 'CANCELADO') return { erros: [det_('import_id', 'JA_CANCELADA', 'Esta importação já foi desfeita.')] };
        if (vazio_(tx.dados.justificativa)) return { erros: [det_('justificativa', 'CAMPO_OBRIGATORIO', 'Diga por que a importação está sendo desfeita.')] };
        var gravadas = linhasGravadas_(tx, imp.import_id);
        if (imp.status === 'IMPORTADO') {
          var dep = dependentes_(tx, imp, gravadas);
          if (dep.length) throw Validation.erro('CONFLICT', 'Não dá para desfazer: ' + (dep.length === 1 ? dep[0].mensagem : dep.length + ' lançamentos ou cadastros feitos depois dependem dos animais importados. Estorne-os antes.'), dep);
        }
        var teveEventos = imp.status === 'IMPORTANDO' || imp.status === 'IMPORTADO';
        AuditService.alteracao(tx, 'IMPORTACOES', imp.import_id, { status: 'CANCELADO', finished_at: tx.agora }, tx.dados.justificativa);
        return {
          resumo: { import_id: imp.import_id, status_anterior: imp.status }, derivados: teveEventos ? { tudo: true } : null,
          resposta: function (t) { return relatorioFinal_(t, imp.import_id); },
        };
      },
    });
  }

  // ------------------------------------------------------------------ consultas ----
  function estado_(tx, importId) {
    var imp = exigirImportacao_(tx, importId);
    var gravadas = linhasGravadas_(tx, importId);
    var lista = Object.keys(gravadas).map(function (k) { return gravadas[k]; });
    var conta = function (s) { return lista.filter(function (l) { return l.status === s; }).length; };
    var rel = relatorio_(imp);
    var blocos = { tamanho: rel.lote_linhas || null, total: rel.blocos || null, importados: 0, proximo: null };
    if (imp.status === 'IMPORTANDO' || imp.status === 'IMPORTADO' || (imp.status === 'CANCELADO' && rel.lote_linhas)) {
      var importaveis = lista.filter(function (l) { return l.status === 'VALIDA' || l.status === 'IMPORTADA'; }).length;
      blocos.total = Math.ceil(importaveis / rel.lote_linhas);
      blocos.importados = Math.floor(conta('IMPORTADA') / rel.lote_linhas) + (conta('IMPORTADA') === importaveis && importaveis % rel.lote_linhas ? 1 : 0);
      blocos.proximo = imp.status === 'IMPORTANDO' && blocos.importados < blocos.total ? blocos.importados + 1 : null;
    }
    var tam = rel.lote_linhas || null;
    return {
      importacao: importacaoPublica_(imp),
      contadores: {
        total: imp.total_linhas, conferidas: rel.conferidas, validas: conta('VALIDA'), erro: conta('ERRO'), duplicadas: conta('DUPLICADA'),
        ignoradas: conta('IGNORADA'), importadas: conta('IMPORTADA'), por_codigo: rel.por_codigo,
      },
      blocos: blocos,
      validacao: { tamanho: tam, conferidas: rel.conferidas, completa: rel.conferidas >= imp.total_linhas },
      pode: {
        validar: !!ESTADOS_VALIDAVEIS[imp.status], importar: imp.status === 'VALIDADO' || blocos.proximo !== null,
        concluir: imp.status === 'IMPORTANDO' && blocos.proximo === null, desfazer: imp.status !== 'CANCELADO',
      },
    };
  }
  function leiturasConsulta_() {
    return ['IMPORTACOES', 'IMPORTACAO_LINHAS', 'ANEXOS', 'ANIMAIS', 'PASTOS', 'LISTAS', 'CONFIGURACOES', 'AUDITORIA', 'EVENTOS', 'EVENTO_ANIMAIS'];
  }
  /** Consulta (importacao.obter): {importacao, contadores, blocos: {tamanho, total, importados, proximo}, validacao, pode}. */
  function consultaObter(dados) {
    var id = (dados || {}).import_id;
    return { rota: 'importacao.obter', reads: leiturasConsulta_(), tratador: function (tx) { return estado_(tx, id); } };
  }
  function obter(ctx, dados) {
    return UnitOfWork.read(ctx, consultaObter(dados));
  }
  /**
   * Consulta das linhas (pré-visualização): filtros {import_id, status, pagina, por_pagina (até 500)}. Cada linha traz
   * o texto original ao lado do valor interpretado com o mapeamento gravado: {linha_num, status, erros,
   * dados_originais, interpretado, entity_id_gerado, event_id_gerado}.
   */
  function consultaLinhas(filtros) {
    var f = filtros || {};
    var pagina = Math.max(1, Math.floor(Number(f.pagina) || 1));
    var porPagina = Math.min(500, Math.max(1, Math.floor(Number(f.por_pagina) || 100)));
    return {
      rota: 'importacao.linhas', reads: leiturasConsulta_(),
      tratador: function (tx) {
        var imp = exigirImportacao_(tx, f.import_id);
        var gravadas = linhasGravadas_(tx, imp.import_id);
        var lista = Utils.ordenarPor(Object.keys(gravadas).map(function (k) { return gravadas[k]; }), ['linha_num']).filter(function (l) { return vazio_(f.status) || l.status === f.status; });
        var cv = imp.mapeamento_json ? contextoValidacao_(tx) : null;
        var itens = lista.slice((pagina - 1) * porPagina, pagina * porPagina).map(function (l) {
          var interpretado = null;
          if (cv && !vazio_(cv.D0)) interpretado = lerLinha_({ linha_num: l.linha_num, valores: l.dados_originais_json || {} }, imp.mapeamento_json, imp.formato_json || {}, cv).item;
          return {
            linha_num: l.linha_num, status: l.status, erros: l.erros_json || [], dados_originais: l.dados_originais_json, interpretado: interpretado,
            entity_id_gerado: l.entity_id_gerado || null, event_id_gerado: l.event_id_gerado || null,
          };
        });
        return { total: lista.length, pagina: pagina, por_pagina: porPagina, itens: itens };
      },
    };
  }
  function relatorioFinal_(tx, importId) {
    var e = estado_(tx, importId);
    var imp = exigirImportacao_(tx, importId);
    var gravadas = linhasGravadas_(tx, importId);
    var lista = Utils.ordenarPor(Object.keys(gravadas).map(function (k) { return gravadas[k]; }), ['linha_num']);
    var aprovacao = tx.repo.carregada('AUDITORIA') ? tx.repo.vigentes('AUDITORIA').filter(function (a) { return a.entidade === 'IMPORTACOES' && a.entity_id === importId && a.campo === 'modo'; })[0] : null;
    var importados = lista.filter(function (l) { return l.status === 'IMPORTADA'; });
    var vigentes = imp.status === 'IMPORTADO' ? importados.filter(function (l) { var a = tx.repo.porId('ANIMAIS', l.entity_id_gerado); return a && a.situacao_cadastral === 'ATIVO'; }).length : 0;
    return {
      importacao: e.importacao, contadores: e.contadores, blocos: e.blocos,
      aprovacao: aprovacao ? { modo: aprovacao.valor_novo, por: aprovacao.usuario, em: aprovacao.timestamp, texto: aprovacao.justificativa } : null,
      criados: { animais: importados.length, eventos: Utils.unicos(importados.map(function (l) { return l.event_id_gerado; })).length, ativos: vigentes },
      reprovadas: lista.filter(function (l) { return l.status === 'ERRO' || l.status === 'DUPLICADA'; }).map(function (l) { return { linha_num: l.linha_num, status: l.status, erros: l.erros_json || [], dados_originais: l.dados_originais_json }; }),
      ignoradas: lista.filter(function (l) { return l.status === 'IGNORADA'; }).map(function (l) { return l.linha_num; }),
      pendencias: {
        sem_brinco: importados.filter(function (l) { var a = tx.repo.porId('ANIMAIS', l.entity_id_gerado); return a && vazio_(a.brinco); }).length,
        sem_nascimento: importados.filter(function (l) { var a = tx.repo.porId('ANIMAIS', l.entity_id_gerado); return a && vazio_(a.data_nascimento); }).length,
      },
    };
  }
  /** Relatório final (importacao.relatorio): contadores, aprovação registrada, criados, reprovadas com o motivo, pendências. */
  function consultaRelatorio(dados) {
    var id = (dados || {}).import_id;
    return { rota: 'importacao.relatorio', reads: leiturasConsulta_(), tratador: function (tx) { return relatorioFinal_(tx, id); } };
  }
  /** Importações, da mais recente para a mais antiga, e a que está em andamento (para a faixa "importação incompleta"). */
  function consultaListar() {
    return {
      rota: 'importacao.listar', reads: ['IMPORTACOES'],
      tratador: function (tx) {
        var lista = Utils.ordenarPor(tx.repo.vigentes('IMPORTACOES'), [{ campo: 'created_at', desc: true }]).map(importacaoPublica_);
        return { itens: lista, em_curso: lista.filter(function (i) { return i.status === 'IMPORTANDO'; })[0] || null };
      },
    };
  }

  return {
    TIPOS_SUPORTADOS: TIPOS_SUPORTADOS,
    CAMPOS: CAMPOS,
    PADROES: PADROES,
    FORMATOS_DATA: FORMATOS_DATA,
    MAX_LINHAS: MAX_LINHAS,
    chaveBloco: chaveBloco,
    lerCsv: lerCsv,
    interpretarArquivo: interpretarArquivo,
    sugerirMapeamento: sugerirMapeamento,
    conferirMapeamento: conferirMapeamento,
    validarLinhas: validarLinhas,
    criar: criar,
    previaArquivo: previaArquivo,
    validarBloco: validarBloco,
    importarBloco: importarBloco,
    concluir: concluir,
    desfazer: desfazer,
    consultaObter: consultaObter,
    obter: obter,
    consultaLinhas: consultaLinhas,
    consultaRelatorio: consultaRelatorio,
    consultaListar: consultaListar,
  };
})();
