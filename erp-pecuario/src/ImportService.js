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
  var TIPOS_SUPORTADOS = Object.freeze(['ANIMAIS', 'COMPRAS', 'VENDAS', 'TRANSFERENCIAS', 'NASCIMENTOS', 'MORTES']);
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
  function nulo_(v) {
    return vazio_(v) ? null : v;
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
    if (!linhas.length) throw recusar_('O arquivo só tem o cabeçalho: não há linhas para importar.');
    if (linhas.length > MAX_LINHAS) throw recusar_('O arquivo tem ' + linhas.length + ' linhas; o limite de uma importação é ' + MAX_LINHAS + '. Divida o arquivo.');
    return { cabecalho: cab, linhas: linhas };
  }
  /** Sugestão de mapeamento pelo nome do cabeçalho ("modelo conhecido já vem mapeado"); `tipo` padrão ANIMAIS. */
  function sugerirMapeamento(cabecalho, tipo) {
    if (TIPOS_EVENTO[tipo]) return sugerirMapeamentoEvento_(cabecalho, modeloDe_(tipo));
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
  /**
   * Descrição do importador para o assistente (rota `importacao.modelo`): tipos entregues, campos de destino com
   * rótulo e tipo de leitura, campos obrigatórios, confianças padrão aceitas por campo, valores padrão, formatos de
   * data, separadores, codificações, limite de linhas e o cabeçalho do modelo para baixar (rótulos dos campos, que o
   * próprio sugerirMapeamento reconhece).
   */
  function modelo(tipo) {
    if (!vazio_(tipo) && tipo !== 'ANIMAIS') {
      if (!TIPOS_EVENTO[tipo]) throw recusar_('Tipo de importação desconhecido ou de uma próxima fase.', [det_('tipo', 'TIPO_INDISPONIVEL', 'Sem modelo para ' + tipo + '.')]);
      return modeloEvento_(tipo);
    }
    var campos = Object.keys(CAMPOS).map(function (k) {
      return { campo: k, rotulo: CAMPOS[k].rotulo, tipo: CAMPOS[k].tipo, obrigatorio: k === 'sexo' || k === 'pasto', so_femea: SO_FEMEA.indexOf(k) >= 0, so_macho: SO_MACHO.indexOf(k) >= 0 };
    });
    return {
      tipo: 'ANIMAIS', evento: 'ENTRADA_INICIAL', rotulo: 'Animais (rebanho do marco zero)', tipos: TIPOS_SUPORTADOS.slice(), campos: campos,
      confiancas: { data_nascimento: CONFIANCAS.slice(), data_entrada: CONFIANCAS.slice(), mae: CONFIANCAS_VINCULO.slice(), pai: CONFIANCAS_VINCULO.slice() },
      padroes: Utils.clonar(PADROES), formatos_data: FORMATOS_DATA.slice(), delimitadores: [';', ',', 'TAB', '|'],
      codificacoes: ['UTF-8', 'ISO-8859-1', 'WINDOWS-1252', 'US-ASCII'], max_linhas: MAX_LINHAS,
      cabecalho_modelo: campos.map(function (c) { return c.rotulo; }),
    };
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
    return lerValor_(CAMPOS[campo], t, formato, cv);
  }
  /** Texto de uma célula → {v} ou {erro, msg}, pelo tipo de leitura da definição do campo. */
  function lerValor_(def, t, formato, cv) {
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
    // Progenitor que não tem brinco (RN-094: o dono cadastra o touro de sêmen como animal de referência): achado pelo
    // nome do EXTERNO ou pelo código interno (A-000123) de qualquer animal; nome repetido entre externos fica ambíguo.
    var externos = {};
    var codigos = {};
    tx.repo.vigentes('ANIMAIS').forEach(function (a) {
      if (a.situacao_cadastral === 'ANULADO' || a.situacao_cadastral === 'PENDENTE') return;
      if (!vazio_(a.codigo_interno)) codigos[String(a.codigo_interno).toUpperCase()] = a;
      if (a.situacao_cadastral === 'EXTERNO' && !vazio_(a.nome)) {
        var n = Utils.normalizarTexto(a.nome);
        externos[n] = externos[n] ? AMBIGUO : a;
      }
      if (vazio_(a.brinco)) return;
      base[Utils.normalizarBrinco(a.brinco, !semZeros)] = a;
    });
    // Número que outro animal usava no marco zero ou depois dele (período fechado depois de D0): o animal do rebanho
    // inicial com ele o teria em dois animais ao mesmo tempo (RN-002; RN-004: reuso só de período já encerrado). O
    // número corrigido por IDENTIFICACAO_INCORRETA não conta (desenho-base 16.2).
    var noMarco = {};
    var D0 = params.data_marco_zero;
    if (!vazio_(D0) && tx.repo.carregada('IDENTIFICACOES')) {
      var errados = {};
      (tx.repo.carregada('AJUSTES') ? tx.repo.vigentes('AJUSTES') : []).forEach(function (x) {
        if (x.tipo_ajuste === 'IDENTIFICACAO_INCORRETA' && x.campo === 'brinco' && !vazio_(x.valor_anterior)) errados[x.animal_id + '|' + Utils.normalizarBrinco(String(x.valor_anterior), !semZeros)] = true;
      });
      tx.repo.vigentes('IDENTIFICACOES').forEach(function (r) {
        if (r.tipo !== 'BRINCO' || vazio_(r.codigo) || vazio_(r.data_fim) || r.data_fim <= D0 || r.data_fim <= r.data_inicio) return;
        var a = tx.repo.porId('ANIMAIS', r.animal_id);
        var k = Utils.normalizarBrinco(String(r.codigo), !semZeros);
        if (!a || a.situacao_cadastral === 'ANULADO' || a.situacao_cadastral === 'PENDENTE' || errados[r.animal_id + '|' + k]) return;
        if (!noMarco[k] || r.data_fim > noMarco[k].ate) noMarco[k] = { animal: a, ate: r.data_fim };
      });
    }
    return { params: params, D0: params.data_marco_zero, pastos: pastos, pastosPorId: pastosPorId, racas: racas, listas: listas, base: base, noMarco: noMarco, externos: externos, codigos: codigos, semZeros: semZeros };
  }
  var AMBIGUO = Object.freeze({ ambiguo: true });
  /** Progenitor no rebanho pela referência do arquivo: brinco; senão código interno; senão nome de animal de referência. */
  function progenitorNaBase_(cv, ref, chave) {
    if (chave && cv.base[chave]) return cv.base[chave];
    var t = Utils.aparar(ref);
    return (cv.codigos && cv.codigos[t.toUpperCase()]) || (cv.externos && cv.externos[Utils.normalizarTexto(t)]) || null;
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
      var usado = cv.noMarco && cv.noMarco[r.chave];
      if (usado) { r.dup = det_('brinco', 'BRINCO_JA_CADASTRADO', 'o brinco ' + r.item.brinco + ' era do animal ' + usado.animal.codigo_interno + ' no marco zero (até ' + br_(usado.ate) + '): um número fica em um animal por vez'); return; }
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
        var naBase = noArq ? null : progenitorNaBase_(cv, b, k);
        if (naBase === AMBIGUO) {
          r.erros.push(det_(cfg[0], cfg[0] === 'mae' ? 'MAE_NAO_ENCONTRADA' : 'PAI_NAO_ENCONTRADO', 'há mais de um animal de referência chamado "' + b + '". Use o código interno dele (A-000…) nesta coluna'));
          return;
        }
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
  /** Abas dos comandos de importação: as do formulário de cada tipo importável (entrada e eventos) e as da importação. */
  function leiturasImportacao_() {
    var l = EventService.leiturasEntrada();
    Object.keys(TIPOS_EVENTO).forEach(function (t) { l = l.concat(EventService.leiturasEvento(TIPOS_EVENTO[t])); });
    return Utils.unicos(l.concat(['IMPORTACOES', 'IMPORTACAO_LINHAS', 'ANEXOS', 'PASTOS', 'LISTAS', 'CONFIGURACOES', 'PROPRIEDADES']));
  }
  var LEITURAS_VALIDACAO = Object.freeze(['IMPORTACOES', 'IMPORTACAO_LINHAS', 'ANEXOS', 'ANIMAIS', 'PASTOS', 'LISTAS', 'CONFIGURACOES', 'IDENTIFICACOES', 'AJUSTES']);
  /**
   * Uma importação em curso por vez (05, RN-032; desenho-base 16.8): a exceção das rotas `importacao.*` vale para
   * retomar, concluir e desfazer a que está em IMPORTANDO, não para começar outra (os animais e eventos PENDENTE de
   * uma não entram na unicidade da outra).
   */
  function exigirNenhumaEmCurso_(tx, imp, oque) {
    var outra = tx.repo.vigentes('IMPORTACOES').filter(function (i) { return i.import_id !== imp.import_id && i.status === 'IMPORTANDO'; })[0];
    if (!outra) return;
    throw Validation.erro('CONFLICT', 'A importação do arquivo "' + (outra.arquivo_nome || 'sem nome') + '" ainda está em andamento: conclua ou desfaça essa antes de ' + (oque || 'começar outra') + '.', [
      det_('import_id', 'IMPORTACAO_EM_CURSO', 'Importação em andamento: ' + (outra.arquivo_nome || 'sem nome') + '.'),
    ]);
  }
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
  function amostra_(arq, tipo) {
    return { cabecalho: arq.cabecalho, amostra: arq.linhas.slice(0, 5), total_linhas: arq.linhas.length, sugestao: sugerirMapeamento(arq.cabecalho, tipo) };
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
    if (TIPOS_SUPORTADOS.indexOf(d.tipo) < 0) throw recusar_('A importação de ' + d.tipo.toLowerCase() + ' chega numa próxima fase do sistema (fase 3, com o manejo). Por enquanto, importe o rebanho, as compras, as vendas, as transferências, os nascimentos e as mortes.', [det_('tipo', 'TIPO_INDISPONIVEL', 'Ainda não disponível.')]);
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
      reconstruir: function (tx, op) { var imp = tx.repo.porId('IMPORTACOES', op.resumo.import_id); var out = amostra_(arq, d.tipo); out.import_id = op.resumo.import_id; out.status = imp ? imp.status : null; return out; },
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
      var out = amostra_(arq, x.tipo);
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
    var out = amostra_(o.arquivo, o.imp.tipo);
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
    var eventos = !!TIPOS_EVENTO[orig.imp.tipo];
    return UnitOfWork.run(ctx, {
      rota: 'importacao.validarBloco', idempotencyKey: p.idempotencyKey, dados: { import_id: d.import_id, bloco: bloco, mapeamento: d.mapeamento || {} },
      // Eventos: a validação passa cada evento pelo motor (ensaio), que lê o que o formulário lê, com acesso cru.
      reads: eventos ? leiturasImportacao_() : LEITURAS_VALIDACAO, acessoCru: eventos, anexaSemPai: ['IMPORTACAO_LINHAS'], permiteDuranteImportacao: true,
      reconstruir: function (tx, op) { return estado_(tx, op.resumo.import_id); },
      tratador: function (tx) {
        var imp = exigirImportacao_(tx, d.import_id);
        if (!ESTADOS_VALIDAVEIS[imp.status]) throw Validation.erro('CONFLICT', 'Esta importação está ' + imp.status.toLowerCase() + ' e não pode mais ser validada.');
        var cv = eventos ? contextoEventos_(tx) : contextoValidacao_(tx);
        if (eventos && vazio_(cv.D0)) throw Validation.erro('CONFIG', 'Defina a data do marco zero (o dia do inventário inicial) nas configurações antes de importar eventos.');
        var map = eventos ? conferirMapeamentoEvento_(tx.dados.mapeamento, arq.cabecalho, cv, modeloDe_(imp.tipo)) : conferirMapeamento(tx.dados.mapeamento, arq.cabecalho, cv.pastosPorId);
        var formato = imp.formato_json || {};
        var tam = tamanhoLote_(cv.params);
        var total = arq.linhas.length;
        var blocos = Math.ceil(total / tam);
        if (bloco > blocos) throw recusar_('O arquivo tem só ' + blocos + ' bloco(s) de validação.', [det_('bloco', 'VALOR_FORA_DA_FAIXA', 'Bloco inexistente.')]);
        var rel = relatorio_(imp);
        var mesmoMapa = !!imp.mapeamento_json && Utils.jsonCanonico(imp.mapeamento_json) === Utils.jsonCanonico(map);
        if (bloco > 1 && !mesmoMapa) throw Validation.erro('CONFLICT', 'O mapeamento das colunas mudou: valide de novo a partir do primeiro bloco.');
        if (bloco > 1 && rel.conferidas < (bloco - 1) * tam) throw Validation.erro('CONFLICT', 'Valide os blocos em ordem: falta o bloco ' + (Math.floor(rel.conferidas / tam) + 1) + '.');
        var res = eventos ? validarEventos_(tx, imp, arq.linhas, map, cv).res : validarLinhas(arq.linhas, map, formato, cv);
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
    return UnitOfWork.run(ctx, comandoBloco(pedido));
  }
  /** O comando de importarBloco, pronto para UnitOfWork.run (a varredura de quedas o executa instrumentado). */
  function comandoBloco(pedido) {
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
    return {
      rota: 'importacao.importarBloco', idempotencyKey: chaveBloco(d.import_id, bloco), dados: dados, avisosAceitos: p.avisosAceitos,
      reads: leiturasImportacao_(), acessoCru: true, permiteDuranteImportacao: true,
      reconstruir: function (tx, op) { return estado_(tx, op.resumo.import_id); },
      tratador: function (tx) { return planejarBloco_(tx, bloco); },
    };
  }
  function confirmar_(tx, imp, gravadas, frescos, cv) {
    var d = tx.dados;
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
    var modo = modoAprovado_(d, validas, reprovadas, ignorar.length);
    if (modo.erros) return modo;
    ignorar.forEach(function (n) { AuditService.alteracao(tx, 'IMPORTACAO_LINHAS', gravadas[n].import_line_id, { status: 'IGNORADA' }, 'Deixada de fora pelo dono na pré-visualização.'); });
    var lote = tamanhoLote_(cv.params);
    var rel = relatorio_(imp);
    rel.lote_linhas = lote;
    rel.blocos = Math.ceil(validas / lote);
    rel.ignoradas = ignorar.length;
    AuditService.alteracao(tx, 'IMPORTACOES', imp.import_id, { modo: d.modo, status: 'IMPORTANDO', relatorio_json: rel, linhas_validas: validas, linhas_erro: reprovadas }, justificativaModo_(tx, d.modo, validas, reprovadas + ignorar.length));
    return { lote: lote, ignorar: ignorar };
  }
  /** O modo escolhido na confirmação diante dos números de agora (RN-089): {} ou {erros}. */
  function modoAprovado_(d, validas, reprovadas, ignoradas) {
    if (!validas) return { erros: [det_('modo', 'NADA_A_IMPORTAR', 'Nenhuma linha válida para importar. Corrija o arquivo e envie de novo.')] };
    if (d.modo === 'TOTAL') {
      if (reprovadas || ignoradas) return { erros: [det_('modo', 'IMPORTACAO_TOTAL_RECUSADA', 'Há ' + (reprovadas + ignoradas) + ' linha(s) com erro, duplicadas ou deixadas de fora: corrija o arquivo ou aprove importar só as ' + validas + ' válidas.')] };
    } else if (d.modo === 'PARCIAL_APROVADO') {
      var a = d.aprovacao || {};
      if (a.importar !== validas || a.ignorar !== reprovadas + ignoradas) {
        return { erros: [det_('aprovacao', 'APROVACAO_DIVERGENTE', 'Confirme de novo: serão importadas ' + validas + ' linha(s) e ficarão de fora ' + (reprovadas + ignoradas) + '.')] };
      }
    } else return { erros: [det_('modo', 'CAMPO_OBRIGATORIO', 'Escolha importar tudo ou só as linhas válidas.')] };
    return {};
  }
  /** Texto da aprovação que fica em AUDITORIA (quem aprovou o quê). */
  function justificativaModo_(tx, modo, validas, fora) {
    return modo === 'PARCIAL_APROVADO'
      ? 'Importação parcial aprovada por ' + tx.usuario + ': importar ' + validas + ' linha(s) válidas e deixar de fora ' + fora + '.'
      : 'Importação total confirmada por ' + tx.usuario + ': ' + validas + ' linha(s).';
  }
  function planejarBloco_(tx, bloco) {
    var d = tx.dados;
    var imp = exigirImportacao_(tx, d.import_id);
    if (bloco === 1 && imp.status !== 'VALIDADO') {
      throw Validation.erro('CONFLICT', imp.status === 'RASCUNHO' ? 'Termine a validação do arquivo antes de importar.' : 'Esta importação está ' + imp.status.toLowerCase() + '.');
    }
    if (bloco > 1 && imp.status !== 'IMPORTANDO') throw Validation.erro('CONFLICT', 'Esta importação está ' + imp.status.toLowerCase() + ': não há blocos a importar.');
    if (bloco === 1) exigirNenhumaEmCurso_(tx, imp);
    if (TIPOS_EVENTO[imp.tipo]) return planejarBlocoEventos_(tx, bloco, imp);
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
    // Propriedade: a escolhida na confirmação (bloco 1); os blocos seguintes repetem a do primeiro evento gravado.
    var propriedade = bloco === 1 ? d.property_id || null : null;
    if (bloco > 1) {
      var primeira = anteriores[0] && gravadas[anteriores[0].linha_num];
      var ev1 = primeira && tx.cru.cruPorId('EVENTOS', primeira.event_id_gerado);
      propriedade = ev1 ? ev1.property_id : null;
    }
    var r = EventService.planejarEntradaImportada(tx, {
      campos: { property_id: propriedade, notes: 'Importação de planilha: ' + imp.arquivo_nome + ' (bloco ' + bloco + ')' },
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
      // Projeção dos animais do lote: ficam PENDENTE (com os atributos declarados, inertes) até a conclusão.
      derivados: r.derivados,
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
      rota: 'importacao.concluir', idempotencyKey: chave, dados: { import_id: d.import_id }, reads: leiturasImportacao_().concat(['AUDITORIA']), acessoCru: true, permiteDuranteImportacao: true,
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
  /**
   * Evento da importação que o dono corrigiu depois: o substituto (fora da importação) ocupa o lugar dele (04, seção 1)
   * e continuaria valendo depois do desfazer. A cadeia de substituição inteira é da importação: o desfazer fica
   * bloqueado até a correção ser estornada (06, seção 5.3: os eventos dela deixam de valer de uma vez).
   */
  function correcoesDeFora_(tx, imp) {
    var out = [];
    var vistos = {};
    var fila = tx.cru.cru('EVENTOS').filter(function (e) { return e.import_id === imp.import_id; });
    while (fila.length) {
      var e = fila.shift();
      if (vistos[e.event_id]) continue;
      vistos[e.event_id] = true;
      tx.cru.cruPor('EVENTOS', 'reversal_of_event_id', e.event_id).forEach(function (x) {
        if (x.event_type === 'ESTORNO' || x.import_id === imp.import_id) return;
        if (tx.repo.eventoVigente(x.event_id)) {
          var nome = EventCatalog.nomeEvento(x.event_type, x.event_subtype);
          out.push(Validation.detalhe({
            codigo: 'DEPENDENTE',
            mensagem: 'Um lançamento desta importação (' + EventCatalog.nomeEvento(e.event_type, e.event_subtype) + ' de ' + br_(e.event_date) + ') recebeu uma correção depois, registrada em ' + br_(x.registration_date || x.event_date) + '. Estorne a correção antes de desfazer a importação.',
            conflito: { event_id: x.event_id, tipo: x.event_type, subtipo: x.event_subtype || null, data: x.event_date, nome: nome },
          }));
        }
        fila.push(x);
      });
    }
    return out;
  }
  /** Quem depende dos animais importados fora da importação (bloqueia desfazer uma importação concluída). */
  function dependentes_(tx, imp, gravadas) {
    if (TIPOS_EVENTO[imp.tipo]) return dependentesEventos_(tx, imp);
    var animais = {};
    var eventos = {};
    Object.keys(gravadas).forEach(function (k) {
      var l = gravadas[k];
      if (l.status !== 'IMPORTADA') return;
      if (!vazio_(l.entity_id_gerado)) animais[l.entity_id_gerado] = true;
      if (!vazio_(l.event_id_gerado)) eventos[l.event_id_gerado] = true;
    });
    return dependentesCriados_(tx, animais, eventos);
  }
  /** Animais criados pela importação (`animais`) com lançamento fora dos `eventos` dela, filho cadastrado fora ou anexo. */
  function dependentesCriados_(tx, animais, eventos) {
    var out = [];
    Object.keys(animais).forEach(function (id) {
      var a = tx.repo.porId('ANIMAIS', id) || {};
      var quem = (a.codigo_interno || id) + (vazio_(a.brinco) ? '' : ' (brinco ' + a.brinco + ')');
      tx.repo.por('EVENTO_ANIMAIS', 'animal_id', id).forEach(function (l) {
        if (eventos[l.event_id]) return;
        var ev = tx.repo.porId('EVENTOS', l.event_id) || {};
        var nome = ev.event_type ? EventCatalog.nomeEvento(ev.event_type, ev.event_subtype) : 'um lançamento';
        out.push(Validation.detalhe({ codigo: 'DEPENDENTE', animal_id: id, brinco: a.brinco || null, mensagem: quem + ' tem um lançamento posterior à importação: ' + nome + ' de ' + br_(ev.event_date) + '. Estorne esse lançamento antes.', conflito: { event_id: l.event_id, tipo: ev.event_type || null, subtipo: ev.event_subtype || null, data: ev.event_date || null, nome: ev.event_type ? nome : null } }));
      });
      tx.repo.por('ANIMAIS', 'mae_id', id).concat(tx.repo.por('ANIMAIS', 'pai_id', id)).forEach(function (f) {
        if (animais[f.animal_id]) return;
        out.push(Validation.detalhe({ codigo: 'DEPENDENTE', animal_id: id, brinco: a.brinco || null, mensagem: quem + ' é mãe ou pai do animal ' + f.codigo_interno + ', cadastrado fora da importação.' }));
      });
      // O touro de um registro reprodutivo de fora (o pai do parto, mesmo só de natimorto) e o valor que outro evento
      // alocou ao animal: as mesmas referências que impedem o estorno da entrada (05, RN-041).
      tx.repo.por('REPRODUCAO', 'touro_id', id).forEach(function (r) {
        if (eventos[r.event_id]) return;
        var ev = tx.repo.porId('EVENTOS', r.event_id) || {};
        var nome = ev.event_type ? EventCatalog.nomeEvento(ev.event_type, ev.event_subtype) : 'um lançamento';
        out.push(Validation.detalhe({ codigo: 'DEPENDENTE', animal_id: id, brinco: a.brinco || null, mensagem: quem + ' é o touro ' + (r.tipo_evento === 'PARTO' ? 'do parto' : 'do registro reprodutivo') + ' de ' + br_(r.data) + ', lançado fora da importação. Estorne ou corrija esse lançamento antes.', conflito: { event_id: r.event_id, tipo: ev.event_type || null, subtipo: ev.event_subtype || null, data: ev.event_date || null, nome: ev.event_type ? nome : null } }));
      });
      var porRateio = {};
      (tx.repo.carregada('ALOCACOES_FINANCEIRAS') ? tx.repo.por('ALOCACOES_FINANCEIRAS', 'animal_id', id) : []).forEach(function (al) {
        var rat = tx.repo.porId('RATEIOS', al.rateio_id);
        if (rat && !eventos[rat.event_id]) porRateio[rat.event_id] = true;
      });
      Object.keys(porRateio).forEach(function (evId) {
        if (tx.repo.por('EVENTO_ANIMAIS', 'animal_id', id).some(function (l) { return l.event_id === evId; })) return;
        var ev = tx.repo.porId('EVENTOS', evId) || {};
        var nome = ev.event_type ? EventCatalog.nomeEvento(ev.event_type, ev.event_subtype) : 'um lançamento';
        out.push(Validation.detalhe({ codigo: 'DEPENDENTE', animal_id: id, brinco: a.brinco || null, mensagem: quem + ' recebeu valor do financeiro de ' + nome + ' de ' + br_(ev.event_date) + ', lançado fora da importação. Estorne ou corrija esse lançamento antes.', conflito: { event_id: evId, tipo: ev.event_type || null, subtipo: ev.event_subtype || null, data: ev.event_date || null, nome: ev.event_type ? nome : null } }));
      });
      tx.repo.por('ANEXOS', 'entity_id', id).forEach(function (x) {
        if (x.entidade === 'ANIMAIS' && x.status !== 'REMOVIDO') out.push(Validation.detalhe({ codigo: 'DEPENDENTE', animal_id: id, brinco: a.brinco || null, mensagem: quem + ' tem o arquivo anexado "' + x.nome_arquivo + '". Remova-o antes.' }));
      });
    });
    return out;
  }
  /**
   * Dependentes de uma importação de eventos concluída: os animais que ela criou (compra, cria) com lançamento, filho ou
   * anexo fora dela; os animais que ela só tocou (venda, transferência, morte, mãe do parto) com registro de fora que a
   * linha do tempo deixaria de aceitar sem os eventos dela (CONFLICT com o registro); e parcela já paga de um
   * lançamento dela.
   */
  function dependentesEventos_(tx, imp) {
    var eventos = {};
    tx.cru.cru('EVENTOS').forEach(function (e) { if (e.import_id === imp.import_id && tx.repo.eventoVigente(e.event_id)) eventos[e.event_id] = true; });
    var ids = Object.keys(eventos);
    var criados = {};
    var tocados = {};
    ids.forEach(function (id) {
      tx.repo.por('EVENTO_ANIMAIS', 'event_id', id).forEach(function (l) { if (l.atributos_iniciais_json) criados[l.animal_id] = true; else tocados[l.animal_id] = true; });
    });
    var out = dependentesCriados_(tx, criados, eventos).concat(correcoesDeFora_(tx, imp));
    var com = Timeline.fonte(tx);
    var sem = Timeline.fonte(tx, { excluir: ids });
    var nomePasto = function (id) { var p = tx.repo.porId('PASTOS', id); return p ? p.nome : id; };
    Object.keys(tocados).forEach(function (id) {
      if (criados[id]) return;
      var a = tx.repo.porId('ANIMAIS', id) || {};
      var opcCom = { nascimento: a.data_nascimento, dataEntrada: Timeline.chegadaDeclarada(com, id).data };
      var opcSem = { nascimento: a.data_nascimento, dataEntrada: Timeline.chegadaDeclarada(sem, id).data };
      Timeline.problemasNovos(Timeline.validar(com.linhas(id), opcCom).problemas, Timeline.validar(sem.linhas(id), opcSem).problemas).forEach(function (p) {
        out.push(Validation.detalhe({
          codigo: 'DEPENDENTE', animal_id: id, brinco: a.brinco || null,
          mensagem: (a.codigo_interno || id) + (vazio_(a.brinco) ? '' : ' (brinco ' + a.brinco + ')') + ': sem os eventos desta importação, ' + Timeline.descrever(p, nomePasto) + ' Estorne esse registro antes.',
          conflito: { event_id: p.event_id, tipo: p.event_type || null, subtipo: p.event_subtype || null, data: p.event_date || null, nome: p.event_type ? EventCatalog.nomeEvento(p.event_type, p.event_subtype) : null },
        }));
      });
    });
    // O que volta aos animais tocados (o mesmo do estorno): brinco que hoje é de outro, genealogia, categoria desativada.
    EventService.conferirRestauracao(tx, ids, Object.keys(tocados).filter(function (id) { return !criados[id]; }), 'desfazer a importação').forEach(function (c) {
      out.push(Validation.detalhe({ codigo: 'DEPENDENTE', animal_id: c.animal_id, brinco: c.brinco, mensagem: c.mensagem + ' Desfaça esse registro antes de desfazer a importação.', conflito: c.conflito }));
    });
    ids.forEach(function (id) {
      tx.repo.por('FINANCEIRO', 'event_id', id).forEach(function (f) {
        if (tx.repo.por('PARCELAS', 'financial_id', f.financial_id).some(function (pc) { return pc.status === 'LIQUIDADA'; })) {
          out.push(Validation.detalhe({ codigo: 'PARCELA_LIQUIDADA', mensagem: 'O lançamento "' + (f.descricao || f.financial_id) + '" tem parcela já paga: desfaça a baixa antes.', conflito: { event_id: id, tipo: null, data: f.data_competencia || null } }));
        }
      });
    });
    return out;
  }
  /**
   * importacao.desfazer. pedido: {dados: {import_id, justificativa, justificativa_aviso?}, avisosAceitos}. Leva a
   * importação a CANCELADO: nenhum evento dela vale, sem apagar linha (as linhas e o arquivo original ficam como prova).
   * Importação concluída só se desfaz se nenhum lançamento posterior depende dos animais (CONFLICT listando-os). Cancelar
   * lançamento do período financeiro fechado pede o aviso PERIODO_BLOQUEADO com `justificativa_aviso` (o aviso da trava,
   * CONTRATOS 10.5). Chave `imp:<import_id>:desfazer`.
   */
  function desfazer(ctx, pedido) {
    var d = (pedido && pedido.dados) || {};
    var dados = { import_id: d.import_id, justificativa: d.justificativa || null };
    if (!vazio_(d.justificativa_aviso)) dados.justificativa_aviso = d.justificativa_aviso;
    return UnitOfWork.run(ctx, {
      rota: 'importacao.desfazer', idempotencyKey: chaveBloco(d.import_id, 'desfazer'), dados: dados, avisosAceitos: pedido && pedido.avisosAceitos,
      reads: leiturasImportacao_().concat(['AUDITORIA']), acessoCru: true, permiteDuranteImportacao: true,
      reconstruir: function (tx) { return relatorioFinal_(tx, d.import_id); },
      tratador: function (tx) {
        var imp = exigirImportacao_(tx, d.import_id);
        if (imp.status === 'CANCELADO') return { erros: [det_('import_id', 'JA_CANCELADA', 'Esta importação já foi desfeita.')] };
        if (vazio_(tx.dados.justificativa)) return { erros: [det_('justificativa', 'CAMPO_OBRIGATORIO', 'Diga por que a importação está sendo desfeita.')] };
        var gravadas = linhasGravadas_(tx, imp.import_id);
        if (imp.status === 'IMPORTADO') {
          // Uma importação em curso por vez (RN-032; desenho-base 16.8): os animais e eventos pendentes da outra não
          // entram nas conferências do desfazer, e a conclusão dela não confere de novo o que este desfazer devolveria.
          exigirNenhumaEmCurso_(tx, imp, 'desfazer outra');
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


  // ------------------------------------------------------------------ importação de eventos históricos (Fase 2) ----
  /**
   * COMPRAS, VENDAS, TRANSFERENCIAS, NASCIMENTOS e MORTES (§14; 04, seções 6 e 8; 08, seção 12). Uma linha por animal
   * (por cria, no nascimento); as linhas com a mesma chave de agrupamento formam UM evento, e os campos do lançamento
   * (data, parceiro, negociação, pastos) precisam concordar entre elas. Cada evento passa pelo MESMO planejamento do
   * formulário (EventService.planejarEventoImportado; RN-090), em ordem cronológica, num ensaio em memória em que os
   * eventos anteriores do arquivo já valem: é assim que a validação enxerga as dependências (a segunda transferência do
   * animal parte do destino da primeira) sem gravar nada. Evento anterior ao marco zero vira registro histórico
   * (pre_marco_zero, efeito 0, financeiro sem caixa). O animal é achado pelo brinco ou pelo código interno.
   */
  var TIPOS_EVENTO = Object.freeze({ COMPRAS: 'COMPRA', VENDAS: 'VENDA', TRANSFERENCIAS: 'TRANSFERENCIA', NASCIMENTOS: 'NASCIMENTO', MORTES: 'MORTE' });
  var OP_ENSAIO = 'ensaio-da-importacao';
  var MODALIDADES = { cabeca: 'CABECA', 'por cabeca': 'CABECA', kg: 'KG_VIVO', 'kg vivo': 'KG_VIVO', 'por kg': 'KG_VIVO', arroba: 'ARROBA', '@': 'ARROBA', lote: 'LOTE', 'lote fechado': 'LOTE' };
  var BASES_PESO = { vivo: 'VIVO', 'peso vivo': 'VIVO', carcaca: 'CARCACA', 'peso de carcaca': 'CARCACA' };
  var RENDIMENTOS = { negociado: 'NEGOCIADO', combinado: 'NEGOCIADO', estimado: 'ESTIMADO' };
  var CRITERIOS = { cabecas: 'CABECAS', cabeca: 'CABECAS', 'peso vivo': 'PESO_VIVO', peso: 'PESO_VIVO', 'peso carcaca': 'PESO_CARCACA', carcaca: 'PESO_CARCACA', 'valor individual': 'VALOR_INDIVIDUAL', valor: 'VALOR_INDIVIDUAL', manual: 'MANUAL' };
  var NASCEU = { vivo: 'VIVO', viva: 'VIVO', v: 'VIVO', natimorto: 'NATIMORTO', natimorta: 'NATIMORTO', morto: 'NATIMORTO', morta: 'NATIMORTO' };
  function ev_(rotulo, tipo, apelidos, extra) {
    var o = { rotulo: rotulo, tipo: tipo, escopo: 'EVENTO', apelidos: apelidos || [] };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  function ln_(rotulo, tipo, apelidos, extra) {
    var o = ev_(rotulo, tipo, apelidos, extra);
    o.escopo = 'LINHA';
    return o;
  }
  var C_BRINCO = ln_('Brinco', 'texto', ['brinco', 'numero', 'n', 'no', 'brinco do animal']);
  var C_CODIGO = ln_('Código do animal', 'texto', ['codigo', 'codigo interno', 'codigo do animal']);
  var C_OBS = ln_('Observações do animal', 'texto', ['observacoes', 'obs', 'observacao'], { destino: 'observacoes' });
  var C_OBS_EV = ev_('Observações do lançamento', 'texto', ['observacoes do lancamento', 'obs do lancamento'], { destino: 'notes' });
  var C_GTA = ev_('Número da GTA', 'texto', ['gta', 'numero da gta'], { destino: 'gta_numero' });
  var C_VENC = ev_('Primeiro vencimento', 'data', ['vencimento', 'primeiro vencimento', 'data de pagamento']);
  var C_NPARC = ev_('Número de parcelas', 'inteiro', ['parcelas', 'numero de parcelas', 'n parcelas']);
  var C_FORMA = ev_('Forma de pagamento', 'lista', ['forma de pagamento', 'pagamento'], { lista: 'FORMA_PAGAMENTO' });
  function negociacao_() {
    return {
      modalidade: ev_('Como foi o preço', 'opcao', ['modalidade', 'forma do preco', 'como foi o preco'], { opcoes: MODALIDADES, destino: 'modalidade' }),
      base_peso: ev_('Arroba de', 'opcao', ['base do peso', 'arroba de'], { opcoes: BASES_PESO, destino: 'base_peso' }),
      rendimento: ev_('Rendimento de carcaça (%)', 'decimal', ['rendimento', 'rendimento de carcaca'], { destino: 'rendimento_carcaca_pct' }),
      rendimento_tipo: ev_('O rendimento foi', 'opcao', ['tipo do rendimento', 'o rendimento foi'], { opcoes: RENDIMENTOS, destino: 'rendimento_tipo' }),
      preco: ev_('Preço (R$)', 'dinheiro', ['preco', 'preco unitario', 'preco por cabeca', 'preco da arroba', 'preco do kg'], { destino: 'preco_unitario' }),
      criterio_rateio: ev_('Como dividir o valor', 'opcao', ['criterio', 'criterio de rateio', 'como dividir o valor'], { opcoes: CRITERIOS, destino: 'criterio_rateio' }),
      justificativa_rateio: ev_('Por que essa divisão', 'texto', ['justificativa do rateio'], { destino: 'justificativa_rateio' }),
    };
  }
  function juntar_() {
    var out = {};
    Array.prototype.slice.call(arguments).forEach(function (o) { Object.keys(o).forEach(function (k) { out[k] = o[k]; }); });
    return out;
  }
  /**
   * Modelo de colunas de cada tipo: campos (rótulo, leitura, escopo EVENTO = do lançamento ou LINHA = do animal,
   * destino no formulário), obrigatórios (`[a, b]` = um dos dois), valores padrão aceitos e o agrupamento (campo
   * `grupo` explícito; sem ele, a chave natural ou cada linha sozinha).
   */
  var MODELOS = Object.freeze({
    COMPRAS: {
      evento: 'COMPRA', rotulo: 'Compras de animais',
      agrupar: { obrigatorio: true, natural: null, ajuda: 'Linhas com o mesmo número de compra formam uma compra só (uma nota com vários animais).' },
      campos: juntar_({
        grupo: ev_('Nº da compra', 'texto', ['numero da compra', 'n da compra', 'compra', 'lote da compra']),
        data: ev_('Data da compra', 'data', ['data', 'data da compra'], { destino: 'event_date' }),
        fornecedor: ev_('Fornecedor', 'parceiro', ['fornecedor', 'vendedor', 'quem vendeu'], { destino: 'partner_id' }),
        finalidade: ev_('Para que foram comprados', 'lista', ['finalidade'], { lista: 'FINALIDADE_NEGOCIO', destino: 'finalidade' }),
      }, negociacao_(), {
        peso_total: ev_('Peso vivo total do lote (kg)', 'decimal', ['peso total', 'peso do lote'], { destino: 'peso_total_kg' }),
        valor_animais: ev_('Valor dos animais (R$)', 'dinheiro', ['valor dos animais', 'valor da nota', 'valor total', 'total'], { destino: 'valor_animais' }),
        frete: ev_('Frete (R$)', 'dinheiro', ['frete']),
        outros_custos: ev_('Outros custos (R$)', 'dinheiro', ['outros custos', 'comissao', 'taxas']),
        vencimento: C_VENC, parcelas: C_NPARC, forma_pagamento: C_FORMA, gta: C_GTA,
        nota_fiscal: ev_('Nota fiscal', 'texto', ['nota fiscal', 'nf'], { destino: 'nota_fiscal' }),
        observacoes_lancamento: C_OBS_EV,
        brinco: C_BRINCO, codigo: C_CODIGO,
        brinco_origem: ln_('Brinco do vendedor', 'texto', ['brinco do vendedor', 'brinco de origem', 'brinco origem'], { destino: 'brinco_origem' }),
        nome: ln_('Nome', 'texto', ['nome', 'apelido'], { destino: 'nome' }),
        sexo: ln_('Sexo', 'sexo', ['sexo'], { destino: 'sexo' }),
        raca: ln_('Raça', 'raca', ['raca'], { destino: 'raca' }),
        data_nascimento: ln_('Nascimento', 'data', ['nascimento', 'data de nascimento', 'nasc', 'nasc.'], { destino: 'data_nascimento' }),
        idade_meses: ln_('Idade (meses)', 'inteiro', ['idade', 'idade meses', 'idade (meses)'], { destino: 'idade_meses' }),
        data_nascimento_confianca: ln_('Nascimento é', 'confianca', ['confianca nascimento', 'nascimento e'], { destino: 'data_nascimento_confianca' }),
        castrado: ln_('Castrado', 'bool', ['castrado', 'capado'], { destino: 'castrado' }),
        reprodutor: ln_('Reprodutor', 'bool', ['reprodutor'], { destino: 'reprodutor' }),
        pasto: ln_('Pasto', 'pasto_evento', ['pasto', 'pasto de destino', 'piquete'], { destino: 'pasto_destino_id' }),
        peso: ln_('Peso na chegada (kg)', 'decimal', ['peso', 'peso kg', 'peso vivo', 'peso na chegada'], { destino: 'peso' }),
        metodo_pesagem: ln_('Como foi pesado', 'metodo', ['metodo', 'metodo de pesagem'], { destino: 'metodo_pesagem' }),
        peso_carcaca: ln_('Peso de carcaça (kg)', 'decimal', ['peso de carcaca', 'carcaca'], { destino: 'peso_carcaca_kg' }),
        valor_individual: ln_('Valor do animal (R$)', 'dinheiro', ['valor do animal', 'valor individual'], { destino: 'valor_individual' }),
        observacoes: C_OBS,
      }),
      obrigatorios: ['grupo', 'data', 'fornecedor', 'valor_animais', 'modalidade', 'sexo', 'pasto'],
      padroes: { modalidade: 'opcao', finalidade: 'lista', pasto: 'pasto', castrado: 'bool', reprodutor: 'bool', metodo_pesagem: 'metodo', forma_pagamento: 'lista' },
      confiancas: ['data_nascimento'],
    },
    VENDAS: {
      evento: 'VENDA', rotulo: 'Vendas de animais',
      agrupar: { obrigatorio: true, natural: null, ajuda: 'Linhas com o mesmo número de venda formam uma venda só (uma nota ou um romaneio).' },
      campos: juntar_({
        grupo: ev_('Nº da venda', 'texto', ['numero da venda', 'n da venda', 'venda', 'lote da venda']),
        data: ev_('Data da venda', 'data', ['data', 'data da venda'], { destino: 'event_date' }),
        comprador: ev_('Comprador', 'parceiro', ['comprador', 'cliente', 'frigorifico', 'quem comprou'], { destino: 'partner_id' }),
        finalidade: ev_('Para que foram vendidos', 'lista', ['finalidade'], { lista: 'FINALIDADE_NEGOCIO', destino: 'finalidade' }),
        pasto_origem: ev_('Pasto de onde saem', 'pasto_evento', ['pasto', 'pasto de origem', 'pasto de onde saem'], { destino: 'pasto_origem_id' }),
      }, negociacao_(), {
        peso_vivo_total: ev_('Peso vivo total (kg)', 'decimal', ['peso total', 'peso vivo total'], { destino: 'peso_vivo_total_kg' }),
        peso_carcaca_total: ev_('Carcaça total (kg)', 'decimal', ['carcaca total', 'peso de carcaca total', 'romaneio'], { destino: 'peso_carcaca_total_kg' }),
        valor_bruto: ev_('Valor bruto (R$)', 'dinheiro', ['valor bruto', 'valor da nota', 'valor total', 'total'], { destino: 'valor_bruto' }),
        desconto: ev_('Desconto no preço (R$)', 'dinheiro', ['desconto', 'desconto comercial'], { destino: 'desconto_comercial' }),
        frete: ev_('Frete (R$)', 'dinheiro', ['frete'], { deducao: 'FRETE' }),
        comissao: ev_('Comissão (R$)', 'dinheiro', ['comissao', 'corretagem'], { deducao: 'COMISSAO' }),
        funrural: ev_('Funrural (R$)', 'dinheiro', ['funrural', 'contribuicao rural'], { deducao: 'FUNRURAL' }),
        outras_deducoes: ev_('Outras deduções (R$)', 'dinheiro', ['outras deducoes', 'taxas', 'impostos'], { deducao: 'OUTRA' }),
        // Dedução descontada pelo comprador no pagamento (03b, seção 10.2: retida_pelo_comprador), como no formulário:
        // sim = o comprador deposita já sem ela, com ele como parceiro e o título no recebimento.
        frete_retido: ev_('Frete descontado pelo comprador', 'bool', ['frete descontado pelo comprador', 'frete descontado', 'frete retido'], { retida_de: 'frete' }),
        comissao_retida: ev_('Comissão descontada pelo comprador', 'bool', ['comissao descontada pelo comprador', 'comissao descontada', 'comissao retida'], { retida_de: 'comissao' }),
        funrural_retido: ev_('Funrural descontado pelo comprador', 'bool', ['funrural descontado pelo comprador', 'funrural descontado', 'funrural retido'], { retida_de: 'funrural' }),
        outras_retidas: ev_('Outras deduções descontadas pelo comprador', 'bool', ['outras deducoes descontadas pelo comprador', 'outras deducoes descontadas', 'outras deducoes retidas'], { retida_de: 'outras_deducoes' }),
        vencimento: C_VENC, parcelas: C_NPARC, forma_pagamento: C_FORMA, gta: C_GTA,
        nota_fiscal: ev_('Nota fiscal', 'texto', ['nota fiscal', 'nf'], { destino: 'nota_fiscal' }),
        observacoes_lancamento: C_OBS_EV,
        brinco: C_BRINCO, codigo: C_CODIGO,
        peso: ln_('Peso na venda (kg)', 'decimal', ['peso', 'peso kg', 'peso vivo', 'peso na venda'], { destino: 'peso' }),
        metodo_pesagem: ln_('Como foi pesado', 'metodo', ['metodo', 'metodo de pesagem'], { destino: 'metodo_pesagem' }),
        peso_carcaca: ln_('Peso de carcaça (kg)', 'decimal', ['peso de carcaca', 'carcaca'], { destino: 'peso_carcaca_kg' }),
        valor_individual: ln_('Valor do animal (R$)', 'dinheiro', ['valor do animal', 'valor individual'], { destino: 'valor_individual' }),
        motivo_saida: ln_('Vendido como descarte por', 'lista', ['motivo do descarte', 'motivo'], { lista: 'MOTIVO_DESCARTE', destino: 'motivo_saida' }),
        observacoes: C_OBS,
      }),
      obrigatorios: ['grupo', 'data', 'comprador', 'valor_bruto', 'finalidade', 'modalidade', ['brinco', 'codigo']],
      padroes: { modalidade: 'opcao', finalidade: 'lista', metodo_pesagem: 'metodo', forma_pagamento: 'lista', frete_retido: 'bool', comissao_retida: 'bool', funrural_retido: 'bool', outras_retidas: 'bool' },
      confiancas: [],
    },
    TRANSFERENCIAS: {
      evento: 'TRANSFERENCIA', rotulo: 'Transferências entre pastos',
      agrupar: { obrigatorio: false, natural: ['data', 'pasto_origem', 'pasto_destino'], ajuda: 'Sem número de lote, as linhas com a mesma data e os mesmos pastos de origem e de destino formam uma transferência só.' },
      campos: {
        grupo: ev_('Nº do lote', 'texto', ['numero do lote', 'lote', 'n do lote']),
        data: ev_('Data', 'data', ['data', 'data da transferencia'], { destino: 'event_date' }),
        pasto_origem: ev_('Pasto de origem', 'pasto_evento', ['pasto de origem', 'origem', 'de'], { destino: 'pasto_origem_id' }),
        pasto_destino: ev_('Pasto de destino', 'pasto_evento', ['pasto de destino', 'destino', 'para'], { destino: 'pasto_destino_id' }),
        gta: C_GTA, observacoes_lancamento: C_OBS_EV,
        brinco: C_BRINCO, codigo: C_CODIGO,
      },
      obrigatorios: ['data', 'pasto_origem', 'pasto_destino', ['brinco', 'codigo']],
      padroes: {},
      confiancas: [],
    },
    NASCIMENTOS: {
      evento: 'NASCIMENTO', rotulo: 'Nascimentos (partos)',
      agrupar: { obrigatorio: false, natural: ['mae', 'data'], ajuda: 'Uma linha por cria: as linhas com a mesma mãe e a mesma data formam um parto só (gêmeos).' },
      campos: {
        grupo: ev_('Nº do parto', 'texto', ['numero do parto', 'parto']),
        data: ev_('Data do parto', 'data', ['data', 'data do parto', 'nascimento', 'data de nascimento'], { destino: 'event_date' }),
        mae: ev_('Brinco da mãe', 'texto', ['mae', 'brinco da mae', 'brinco mae', 'matriz', 'vaca']),
        pai: ev_('Pai (brinco, código ou nome)', 'texto', ['pai', 'touro', 'brinco do pai']),
        pai_confianca: ev_('Pai é', 'confianca_vinculo', ['confianca pai', 'pai e']),
        tipo_parto: ev_('Como foi o parto', 'lista', ['tipo de parto', 'como foi o parto', 'parto foi'], { lista: 'TIPO_PARTO', destino: 'tipo_parto' }),
        pasto: ev_('Pasto das crias', 'pasto_evento', ['pasto', 'pasto das crias', 'pasto da cria'], { destino: 'pasto_destino_id' }),
        observacoes_lancamento: C_OBS_EV,
        situacao: ln_('Nasceu', 'opcao', ['nasceu', 'situacao', 'vivo ou natimorto'], { opcoes: NASCEU, destino: 'situacao_nascimento' }),
        sexo: ln_('Sexo da cria', 'sexo', ['sexo', 'sexo da cria'], { destino: 'sexo' }),
        brinco: ln_('Brinco da cria', 'texto', ['brinco', 'brinco da cria'], { destino: 'brinco' }),
        nome: ln_('Nome da cria', 'texto', ['nome', 'nome da cria'], { destino: 'nome' }),
        raca: ln_('Raça da cria', 'raca', ['raca', 'raca da cria'], { destino: 'raca' }),
        peso: ln_('Peso ao nascer (kg)', 'decimal', ['peso', 'peso ao nascer'], { destino: 'peso' }),
        metodo_pesagem: ln_('Como foi pesado', 'metodo', ['metodo', 'metodo de pesagem'], { destino: 'metodo_pesagem' }),
        observacoes: ln_('Observações da cria', 'texto', ['observacoes', 'obs'], { destino: 'observacoes' }),
      },
      obrigatorios: ['data', 'mae', 'situacao'],
      padroes: { situacao: 'opcao', metodo_pesagem: 'metodo' },
      confiancas: ['pai'],
    },
    MORTES: {
      evento: 'MORTE', rotulo: 'Mortes',
      agrupar: { obrigatorio: false, natural: 'LINHA', ajuda: 'Sem número de lançamento, cada linha é uma morte; com ele, as linhas com o mesmo número formam um lançamento só (mesma data e causa).' },
      campos: {
        grupo: ev_('Nº do lançamento', 'texto', ['numero do lancamento', 'lancamento', 'lote']),
        data: ev_('Data da morte', 'data', ['data', 'data da morte'], { destino: 'event_date' }),
        causa: ev_('Causa da morte', 'lista', ['causa', 'causa da morte'], { lista: 'CAUSA_MORTE', destino: 'causa' }),
        diagnostico: ev_('Diagnóstico ou laudo', 'texto', ['diagnostico', 'laudo'], { destino: 'diagnostico' }),
        responsavel: ev_('Quem constatou', 'texto', ['responsavel', 'quem constatou'], { destino: 'responsible' }),
        observacoes_lancamento: C_OBS_EV,
        brinco: C_BRINCO, codigo: C_CODIGO, observacoes: C_OBS,
      },
      obrigatorios: ['data', 'causa', ['brinco', 'codigo']],
      padroes: { causa: 'lista' },
      confiancas: [],
    },
  });
  function modeloDe_(tipo) {
    var m = MODELOS[tipo];
    if (!m) throw interno_('Tipo de importação sem modelo de eventos: ' + tipo + '.');
    return m;
  }
  function rotuloObrigatorio_(modelo, o) {
    return Array.isArray(o) ? o.map(function (k) { return '"' + modelo.campos[k].rotulo + '"'; }).join(' ou ') : '"' + modelo.campos[o].rotulo + '"';
  }
  function maisMeses_(data, meses) {
    var a = Number(data.slice(0, 4));
    var total = a * 12 + (Number(data.slice(5, 7)) - 1) + meses;
    var na = Math.floor(total / 12);
    var nm = total - na * 12 + 1;
    var bis = (na % 4 === 0 && na % 100 !== 0) || na % 400 === 0;
    var dim = [31, bis ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][nm - 1];
    var dia = Math.min(Number(data.slice(8, 10)), dim);
    return String(na) + '-' + ('0' + nm).slice(-2) + '-' + ('0' + dia).slice(-2);
  }

  // ---- mapeamento e leitura das linhas (puro, sobre o índice de cadastros) ----
  function sugerirMapeamentoEvento_(cabecalho, modelo) {
    var out = {};
    var usados = {};
    (cabecalho || []).forEach(function (c) {
      var k = Utils.normalizarTexto(c);
      Object.keys(modelo.campos).some(function (campo) {
        if (usados[campo]) return false;
        var d = modelo.campos[campo];
        var ok = Utils.normalizarTexto(d.rotulo) === k || campo === k || d.apelidos.some(function (a) { return Utils.normalizarTexto(a) === k; });
        if (ok) { out[c] = campo; usados[campo] = true; }
        return ok;
      });
    });
    return out;
  }
  function modeloEvento_(tipo) {
    var md = modeloDe_(tipo);
    var obrig = {};
    md.obrigatorios.forEach(function (o) { if (!Array.isArray(o)) obrig[o] = true; });
    var campos = Object.keys(md.campos).map(function (k) {
      var d = md.campos[k];
      return { campo: k, rotulo: d.rotulo, tipo: d.tipo, escopo: d.escopo, obrigatorio: !!obrig[k], lista: d.lista || null, opcoes: d.opcoes ? Utils.unicos(Object.keys(d.opcoes).map(function (x) { return d.opcoes[x]; })) : null };
    });
    var conf = {};
    md.confiancas.forEach(function (k) { conf[k] = (k === 'pai' ? CONFIANCAS_VINCULO : CONFIANCAS).slice(); });
    return {
      tipo: tipo, evento: md.evento, rotulo: md.rotulo, tipos: TIPOS_SUPORTADOS.slice(), campos: campos, confiancas: conf, padroes: Utils.clonar(md.padroes),
      obrigatorios: md.obrigatorios.map(function (o) { return Array.isArray(o) ? o.slice() : [o]; }),
      agrupamento: { campo: 'grupo', obrigatorio: md.agrupar.obrigatorio, natural: md.agrupar.natural, ajuda: md.agrupar.ajuda },
      formatos_data: FORMATOS_DATA.slice(), delimitadores: [';', ',', 'TAB', '|'], codificacoes: ['UTF-8', 'ISO-8859-1', 'WINDOWS-1252', 'US-ASCII'], max_linhas: MAX_LINHAS,
      cabecalho_modelo: campos.map(function (c) { return c.rotulo; }),
    };
  }
  /** Confere o mapeamento de um tipo de evento: {colunas, confiancas, padroes}, como em conferirMapeamento. */
  function conferirMapeamentoEvento_(mapeamento, cabecalho, cv, modelo) {
    var m = mapeamento || {};
    var cols = m.colunas || {};
    var problemas = [];
    var destino = {};
    var colunas = {};
    Object.keys(cols).forEach(function (c) {
      var campo = cols[c];
      if (vazio_(campo)) return;
      if (cabecalho.indexOf(c) < 0) { problemas.push(det_('colunas', 'COLUNA_DESCONHECIDA', 'A coluna "' + c + '" não existe no arquivo.')); return; }
      if (!modelo.campos[campo]) { problemas.push(det_('colunas', 'CAMPO_DESCONHECIDO', 'O campo "' + campo + '" não existe na importação de ' + modelo.rotulo.toLowerCase() + '.')); return; }
      if (destino[campo]) { problemas.push(det_('colunas', 'CAMPO_REPETIDO', 'As colunas "' + destino[campo] + '" e "' + c + '" vão para o mesmo campo (' + modelo.campos[campo].rotulo + ').')); return; }
      destino[campo] = c;
      colunas[c] = campo;
    });
    var conf = {};
    var c0 = m.confiancas || {};
    Object.keys(c0).forEach(function (k) {
      var v = c0[k];
      if (vazio_(v)) return;
      var aceitas = k === 'pai' ? CONFIANCAS_VINCULO : CONFIANCAS;
      if (modelo.confiancas.indexOf(k) < 0) problemas.push(det_('confiancas', 'CAMPO_DESCONHECIDO', 'Não há confiança padrão para "' + k + '" nesta importação.'));
      else if (aceitas.indexOf(v) < 0) problemas.push(det_('confiancas', 'VALOR_FORA_DA_LISTA', 'Confiança padrão de ' + k + ': use ' + aceitas.join(', ') + '.'));
      else conf[k] = v;
    });
    var padroes = {};
    var p0 = m.padroes || {};
    Object.keys(p0).forEach(function (k) {
      var v = p0[k];
      if (vazio_(v)) return;
      var tipo = modelo.padroes[k];
      if (!tipo) { problemas.push(det_('padroes', 'CAMPO_DESCONHECIDO', 'Não há valor padrão para "' + k + '".')); return; }
      var d = modelo.campos[k];
      var ok = tipo === 'bool' ? typeof v === 'boolean' : tipo === 'metodo' ? ['BALANCA', 'FITA', 'ESTIMATIVA_VISUAL'].indexOf(v) >= 0
        : tipo === 'opcao' ? Object.keys(d.opcoes).some(function (x) { return d.opcoes[x] === v; })
          : tipo === 'lista' ? (cv.listas[d.lista] || []).indexOf(v) >= 0 : !!cv.pastosPorId[v];
      if (!ok) problemas.push(det_('padroes', 'VALOR_FORA_DA_LISTA', 'Valor padrão inválido para ' + d.rotulo.toLowerCase() + '.'));
      else padroes[k] = v;
    });
    modelo.obrigatorios.forEach(function (o) {
      var lista = Array.isArray(o) ? o : [o];
      if (lista.some(function (k) { return destino[k] || padroes[k] !== undefined; })) return;
      problemas.push(det_('colunas', 'CAMPO_OBRIGATORIO', 'Diga qual coluna traz ' + rotuloObrigatorio_(modelo, o) + (lista.length === 1 && modelo.padroes[o] ? ', ou escolha um valor padrão para todas as linhas.' : '.')));
    });
    if (destino.data_nascimento && !destino.data_nascimento_confianca && !conf.data_nascimento && modelo.confiancas.indexOf('data_nascimento') >= 0) problemas.push(det_('confiancas', 'CAMPO_OBRIGATORIO', 'Diga se o nascimento do arquivo é informação confirmada ou estimada.'));
    if (destino.pai && !destino.pai_confianca && !conf.pai) problemas.push(det_('confiancas', 'CAMPO_OBRIGATORIO', 'Diga se o pai do arquivo é confirmado ou estimado.'));
    if (problemas.length) throw recusar_(problemas.length === 1 ? problemas[0].mensagem : 'Há ' + problemas.length + ' problemas no mapeamento das colunas.', problemas);
    return { colunas: colunas, confiancas: conf, padroes: padroes };
  }
  /** Leitura de uma célula pelo tipo do campo do modelo de eventos. */
  function lerValorEvento_(def, t, formato, cv) {
    var n = Utils.normalizarTexto(t);
    switch (def.tipo) {
      case 'opcao': {
        var v = def.opcoes[n] || Object.keys(def.opcoes).map(function (k) { return def.opcoes[k]; }).filter(function (x) { return Utils.normalizarTexto(x) === n; })[0];
        return v ? { v: v } : { erro: 'VALOR_FORA_DA_LISTA', msg: def.rotulo.toLowerCase() + ' "' + t + '" não reconhecido' };
      }
      case 'lista': {
        var cod = (cv.listaPor[def.lista] || {})[n];
        return cod ? { v: cod } : { erro: 'VALOR_FORA_DA_LISTA', msg: def.rotulo.toLowerCase() + ' "' + t + '" não está na lista (cadastre nas configurações ou corrija o arquivo)' };
      }
      case 'parceiro': {
        var dig = String(t).replace(/\D/g, '');
        var p = (dig.length >= 11 && cv.parceirosDoc[dig]) || cv.parceiros[n];
        if (p === AMBIGUO) return { erro: 'PARCEIRO_AMBIGUO', msg: 'há mais de um parceiro chamado "' + t + '": use o CPF ou CNPJ dele nesta coluna' };
        return p ? { v: p.partner_id } : { erro: 'PARCEIRO_NAO_ENCONTRADO', msg: 'o parceiro "' + t + '" não está cadastrado. Cadastre-o nas configurações (parceiros) ou corrija o nome' };
      }
      case 'pasto_evento': {
        // Qualquer pasto cadastrado (o histórico pode citar pasto desativado depois); o motor decide se ele recebe animais.
        var pa = cv.pastos[n];
        return pa ? { v: pa.pasture_id } : { erro: 'PASTO_NAO_ENCONTRADO', msg: 'o pasto "' + t + '" não está cadastrado' };
      }
      default: return lerValor_(def, t, formato, cv);
    }
  }
  /** Uma linha de um arquivo de eventos → {lidos (por campo, com os padrões), erros}. */
  var SO_NO_MOTOR = ['sexo', 'pasto'];
  function lerLinhaEvento_(linha, modelo, map, formato, cv) {
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
      var r = lerValorEvento_(modelo.campos[campo], t, formato, cv);
      if (r.erro) erros.push(det_(campo, r.erro, r.msg + ' (coluna "' + colunaDe[campo] + '")'));
      else lidos[campo] = r.v;
    });
    Object.keys(map.padroes || {}).forEach(function (k) { if (lidos[k] === undefined && !erros.some(function (e) { return e.campo === k; })) lidos[k] = map.padroes[k]; });
    if (lidos.data_nascimento !== undefined && lidos.data_nascimento_confianca === undefined && map.confiancas.data_nascimento) lidos.data_nascimento_confianca = map.confiancas.data_nascimento;
    if (lidos.pai !== undefined && lidos.pai_confianca === undefined && map.confiancas.pai) lidos.pai_confianca = map.confiancas.pai;
    // Na linha: o número do lançamento (quando o modelo exige) e o animal. Os dados do lançamento podem vir numa linha
    // só do grupo (agruparLinhas_); sexo e pasto do animal novo são do formulário (o motor confere).
    modelo.obrigatorios.forEach(function (o) {
      var lista = Array.isArray(o) ? o : [o];
      var daLinha = lista[0] === 'grupo' || lista.every(function (k) { return modelo.campos[k].escopo === 'LINHA' && SO_NO_MOTOR.indexOf(k) < 0; });
      if (!daLinha || lista.some(function (k) { return lidos[k] !== undefined || erros.some(function (e) { return e.campo === k; }); })) return;
      erros.push(det_(lista[0], 'CAMPO_OBRIGATORIO', 'falta ' + rotuloObrigatorio_(modelo, o)));
    });
    return { lidos: lidos, erros: erros };
  }
  /** A linha traz alguma identificação do animal (brinco, código interno ou brinco do vendedor, os que o modelo tem). */
  function identificaAnimal_(modelo, lidos) {
    return ['brinco', 'codigo', 'brinco_origem'].some(function (k) { return modelo.campos[k] && !vazio_(lidos[k]); });
  }
  /** Chave do evento da linha (o agrupamento do modelo); sem chave legível, a própria linha. */
  function chaveGrupo_(modelo, r) {
    var l = r.lidos;
    if (l.grupo !== undefined) return 'G:' + Utils.normalizarTexto(l.grupo);
    var nat = modelo.agrupar.natural;
    if (!nat || nat === 'LINHA') return 'L:' + r.linha_num;
    if (nat.some(function (k) { return l[k] === undefined; })) return 'L:' + r.linha_num;
    return 'N:' + nat.map(function (k) { return k === 'mae' ? Utils.normalizarBrinco(String(l[k])) : String(l[k]); }).join('|');
  }
  /**
   * Linhas do arquivo → {res: [{linha_num, status, erros, lidos, chave}] na ordem do arquivo, grupos: [{chave, data,
   * primeira, linhas, cab}] em ordem cronológica (data, primeira linha)}. Os campos do lançamento precisam concordar
   * dentro do grupo (CONFLITO_NO_GRUPO); linha idêntica a outra do arquivo fica DUPLICADA (em NASCIMENTOS, só a que
   * traz brinco da cria: as demais iguais são gêmeos do mesmo parto).
   */
  function agruparLinhas_(linhas, modelo, map, formato, cv) {
    var res = linhas.map(function (l) {
      var r = lerLinhaEvento_(l, modelo, map, formato, cv);
      return { linha_num: l.linha_num, status: 'VALIDA', erros: r.erros, lidos: r.lidos, chave: null, original: l.valores };
    });
    var vistas = {};
    res.forEach(function (r) {
      // A repetição é o mesmo evento com o mesmo animal (RN-091): só a linha que identifica o animal (brinco, código
      // ou brinco do vendedor) pode repetir outra. Linhas iguais sem identificação são animais diferentes: gêmeos do
      // mesmo parto (dois natimortos, dois bezerros ainda sem brinco), garrotes da mesma compra ainda sem brinco. A
      // duplicidade do parto é pega pelo lançamento já registrado e pelo aviso de intervalo entre partos (RN-062,
      // RN-063); a da compra, pelo lançamento já registrado com o mesmo número. Nos tipos em que o animal precisa ser
      // achado (venda, transferência, morte), a linha sem identificação já é reprovada pelo campo obrigatório.
      if (!identificaAnimal_(modelo, r.lidos)) return;
      var k = Utils.jsonCanonico(r.original);
      if (vistas[k]) { r.status = 'DUPLICADA'; r.erros.unshift(det_(null, 'LINHA_REPETIDA_NO_ARQUIVO', 'a linha repete a linha ' + vistas[k].linha_num + ' do arquivo')); return; }
      vistas[k] = r;
    });
    var porChave = {};
    var grupos = [];
    res.forEach(function (r) {
      if (r.status === 'DUPLICADA') return;
      r.chave = chaveGrupo_(modelo, r);
      var g = porChave[r.chave];
      if (!g) { g = porChave[r.chave] = { chave: r.chave, linhas: [], cab: {}, origemCab: {}, primeira: r.linha_num }; grupos.push(g); }
      g.linhas.push(r);
      Object.keys(r.lidos).forEach(function (campo) {
        if (modelo.campos[campo].escopo !== 'EVENTO' || campo === 'grupo') return;
        var v = r.lidos[campo];
        if (!(campo in g.cab)) { g.cab[campo] = v; g.origemCab[campo] = r.linha_num; return; }
        if (Utils.jsonCanonico(g.cab[campo]) !== Utils.jsonCanonico(v)) {
          r.erros.push(det_(campo, 'CONFLITO_NO_GRUPO', modelo.campos[campo].rotulo.toLowerCase() + ' diferente da linha ' + g.origemCab[campo] + ' do mesmo lançamento: as linhas de um lançamento precisam ter os mesmos dados dele'));
        }
      });
    });
    grupos.forEach(function (g) {
      g.data = g.cab.data || null;
      modelo.obrigatorios.forEach(function (o) {
        var lista = Array.isArray(o) ? o : [o];
        if (lista[0] === 'grupo' || !lista.every(function (k) { return modelo.campos[k].escopo === 'EVENTO'; })) return;
        if (lista.some(function (k) { return g.cab[k] !== undefined || g.linhas.some(function (r) { return r.erros.some(function (e) { return e.campo === k; }); }); })) return;
        g.linhas.forEach(function (r) { r.erros.push(det_(lista[0], 'CAMPO_OBRIGATORIO', 'falta ' + rotuloObrigatorio_(modelo, o) + ' do lançamento (em pelo menos uma das linhas dele)')); });
      });
    });
    grupos.sort(function (a, b) { return ((a.data || '') < (b.data || '') ? -1 : (a.data || '') > (b.data || '') ? 1 : 0) || a.primeira - b.primeira; });
    return { res: res, grupos: grupos };
  }

  // ---- ensaio: um repositório em memória onde os eventos do arquivo valem um depois do outro ----
  /**
   * Repositório de ensaio montado das linhas cruas da unidade (as mesmas abas), em que a importação `importId` vale
   * como concluída e as linhas do ensaio pertencem a uma operação confirmada fictícia. Os animais que os lotes já
   * gravados criaram ou tocaram são reprojetados nele. Nada daqui é gravado: o plano real recebe só as linhas.
   */
  function abrirEnsaio_(tx, importId) {
    var real = tx.cru;
    if (!real) throw interno_('A importação de eventos precisa de acesso cru.');
    var carregadas = Schema.nomesTabelas().filter(function (t) { return real.carregada(t); });
    var io = {
      ler: function (lista) {
        var out = {};
        lista.forEach(function (t) {
          var regs = real.cru(t).map(function (r) { return Utils.clonar(r); });
          if (t === 'IMPORTACOES') regs.forEach(function (r) { if (r.import_id === importId) r.status = 'IMPORTADO'; });
          if (t === 'OPERACOES') regs.push({ op_id: OP_ENSAIO, idempotency_key: OP_ENSAIO, status: 'CONFIRMADA', comando: 'ensaio', aplicada_em: tx.agora });
          out[t] = { registros: regs, linhas: regs.map(function (_, i) { return i + 2; }), cabecalho: real.cabecalho(t), alertas: [] };
        });
        return out;
      },
      normalizar: tx.ctx.io.normalizar,
      normalizarValor: tx.ctx.io.normalizarValor,
    };
    var rep = Repository.abrir({ io: io });
    rep.carregar(carregadas);
    var ens = { rep: rep, tx: tx, proxima: {} };
    var evs = rep.cru('EVENTOS').filter(function (e) { return e.import_id === importId; }).map(function (e) { return e.event_id; });
    if (evs.length) {
      var ids = [];
      evs.forEach(function (id) { rep.cruPor('EVENTO_ANIMAIS', 'event_id', id).forEach(function (l) { ids.push(l.animal_id); }); });
      reprojetar_(ens, Utils.unicos(ids), evs);
    }
    return ens;
  }
  function reprojetar_(ens, animais, eventos) {
    var p = Repository.plano();
    Timeline.reconstruir({ repo: ens.rep.publico(), cru: ens.rep.leituraCrua(), plano: p, agora: ens.tx.agora, ctx: ens.tx.ctx }, { animais: animais, eventos: eventos });
    p.atualizacoes().forEach(function (u) { ens.rep.alterar(u.tabela, u.id, u.campos); });
  }
  function txDoEnsaio_(ens) {
    var tx = ens.tx;
    return {
      repo: ens.rep.publico(), cru: ens.rep.leituraCrua(), plano: Repository.plano(), rota: tx.rota, dados: tx.dados, avisosAceitos: tx.avisosAceitos,
      usuario: tx.usuario, agora: tx.agora, hoje: tx.hoje, opId: tx.opId, novoId: tx.novoId, simulacao: tx.simulacao, dataVersion: tx.dataVersion, ctx: tx.ctx,
    };
  }
  /** As linhas do evento planejado passam a valer no ensaio (carimbadas como a fase A faria) e os animais são reprojetados. */
  function aplicarNoEnsaio_(ens, plano) {
    var linhas = plano.linhas();
    var rep = ens.rep;
    Object.keys(linhas).forEach(function (t) {
      if (ens.proxima[t] === undefined) ens.proxima[t] = rep.cru(t).length + 2;
      var regs = linhas[t].map(function (r) {
        var x = Utils.clonar(r);
        if (t === 'EVENTOS') { x.op_id = OP_ENSAIO; x.status = 'PENDENTE'; x.idempotency_key = OP_ENSAIO; x.created_at = ens.tx.agora; }
        if (t === 'ANIMAIS') x.situacao_cadastral = 'PENDENTE';
        return x;
      });
      rep.incluir(t, regs, ens.proxima[t]);
      ens.proxima[t] += regs.length;
    });
    var ids = Utils.unicos((linhas.EVENTO_ANIMAIS || []).map(function (l) { return l.animal_id; }));
    reprojetar_(ens, ids, (linhas.EVENTOS || []).map(function (e) { return e.event_id; }));
  }
  /** Índice de cadastros para ler as linhas: o da validação de animais + listas por código e rótulo e parceiros. */
  function contextoEventos_(tx) {
    var cv = contextoValidacao_(tx);
    cv.listaPor = {};
    tx.repo.vigentes('LISTAS').forEach(function (l) {
      if (l.ativo === false) return;
      var x = cv.listaPor[l.lista] = cv.listaPor[l.lista] || {};
      x[Utils.normalizarTexto(l.codigo)] = l.codigo;
      if (!vazio_(l.rotulo)) x[Utils.normalizarTexto(l.rotulo)] = l.codigo;
    });
    cv.parceiros = {};
    cv.parceirosDoc = {};
    (tx.repo.carregada('PARCEIROS') ? tx.repo.vigentes('PARCEIROS') : []).forEach(function (p) {
      var n = Utils.normalizarTexto(p.nome);
      cv.parceiros[n] = cv.parceiros[n] ? AMBIGUO : p;
      var doc = String(p.documento || '').replace(/\D/g, '');
      if (doc) cv.parceirosDoc[doc] = p;
    });
    return cv;
  }
  /**
   * Animais do ensaio por brinco e por código interno (os criados pelos eventos anteriores do arquivo inclusos) e os
   * períodos de cada brinco (IDENTIFICACOES do tipo BRINCO: de data_inicio até data_fim, exclusiva), para achar o dono
   * do número NA DATA do evento (05, seção 4.1 e RN-002/RN-004: o número tem dono por período).
   */
  function indiceDoEnsaio_(ens, cv) {
    var porBrinco = {};
    var porCodigo = {};
    var porId = {};
    var externos = {};
    var periodos = {};
    ens.rep.vigentes('ANIMAIS').forEach(function (a) {
      porId[a.animal_id] = a;
      if (!vazio_(a.codigo_interno)) porCodigo[String(a.codigo_interno).toUpperCase()] = a;
      if (!vazio_(a.brinco)) porBrinco[Utils.normalizarBrinco(a.brinco, !cv.semZeros)] = a;
      if (a.situacao_cadastral === 'EXTERNO' && !vazio_(a.nome)) {
        var n = Utils.normalizarTexto(a.nome);
        externos[n] = externos[n] ? AMBIGUO : a;
      }
    });
    ens.rep.vigentes('IDENTIFICACOES').forEach(function (r) {
      if (r.tipo !== 'BRINCO' || vazio_(r.codigo) || !porId[r.animal_id] || porId[r.animal_id].situacao_cadastral === 'ANULADO') return;
      var k = Utils.normalizarBrinco(String(r.codigo), !cv.semZeros);
      (periodos[k] = periodos[k] || []).push({ animal: porId[r.animal_id], inicio: r.data_inicio, fim: nulo_(r.data_fim) });
    });
    return { porBrinco: porBrinco, porCodigo: porCodigo, externos: externos, periodos: periodos };
  }
  /**
   * Dono do brinco na data D: o animal com o número em uso em D (início ≤ D < fim); em data anterior a todo uso do
   * número (o histórico antes do marco zero, citado pelo brinco da fotografia), o primeiro animal que o recebeu; sem
   * data, quem o usa hoje. {animal} | {ambiguo} | {semUso: {animal, ate}} | {}.
   */
  function donoDoBrinco_(idx, cv, brinco, data) {
    var k = Utils.normalizarBrinco(String(brinco), !cv.semZeros);
    var ps = idx.periodos[k] || [];
    if (!Utils.dataValida(data) || !ps.length) return idx.porBrinco[k] ? { animal: idx.porBrinco[k] } : {};
    var unicos = function (lista) { var v = {}; return lista.filter(function (p) { if (v[p.animal.animal_id]) return false; v[p.animal.animal_id] = true; return true; }); };
    var em = unicos(ps.filter(function (p) { return p.inicio <= data && (p.fim === null || data < p.fim); }));
    if (em.length === 1) return { animal: em[0].animal };
    if (em.length > 1) return { ambiguo: true };
    var primeiro = ps.reduce(function (a, p) { return !a || p.inicio < a.inicio ? p : a; }, null);
    if (primeiro.inicio > data) {
      var antes = unicos(ps.filter(function (p) { return p.inicio === primeiro.inicio; }));
      return antes.length === 1 ? { animal: primeiro.animal } : { ambiguo: true };
    }
    var ultimo = ps.filter(function (p) { return p.fim !== null && p.fim <= data; }).reduce(function (a, p) { return !a || p.fim > a.fim ? p : a; }, null);
    return { semUso: ultimo ? { animal: ultimo.animal, ate: ultimo.fim } : null };
  }
  /** Animal da linha pelo brinco (em uso na data do evento) ou pelo código interno: {animal} | {nenhum: true} | {erro}. */
  function acharAnimal_(idx, cv, brinco, codigo, rotulo, data) {
    var dono = vazio_(brinco) ? {} : donoDoBrinco_(idx, cv, brinco, data);
    var b = dono.animal || null;
    var c = vazio_(codigo) ? null : idx.porCodigo[Utils.aparar(String(codigo)).toUpperCase()] || null;
    if (!vazio_(codigo) && !c) return { erro: det_('codigo', 'ANIMAL_NAO_ENCONTRADO', 'não há animal com o código ' + codigo + ' no rebanho nem no histórico') };
    if (b && c && b.animal_id !== c.animal_id) return { erro: det_('codigo', 'CONFLITO_DE_CAMPOS', 'o brinco ' + brinco + ' é do animal ' + b.codigo_interno + (Utils.dataValida(data) ? ' em ' + br_(data) : '') + ', não do ' + c.codigo_interno) };
    if (c) return { animal: c };
    if (b) return { animal: b };
    if (vazio_(brinco)) return { nenhum: true };
    if (dono.ambiguo) return { erro: det_('brinco', 'CONFLITO_DE_CAMPOS', 'o brinco ' + brinco + ' estava em mais de um animal em ' + br_(data) + ': informe o código do animal (A-000…)') };
    if (dono.semUso !== undefined) {
      var ate = dono.semUso ? ' (saiu do animal ' + dono.semUso.animal.codigo_interno + ' em ' + br_(dono.semUso.ate) + ')' : '';
      return { nenhum: true, erro: det_('brinco', 'ANIMAL_NAO_ENCONTRADO', 'o brinco ' + brinco + ' não estava em uso em ' + br_(data) + ate + ': informe o código do animal (A-000…) ou corrija o brinco') };
    }
    return { nenhum: true, erro: det_('brinco', 'ANIMAL_NAO_ENCONTRADO', (rotulo || 'o animal') + ' de brinco ' + brinco + ' não está no rebanho nem no histórico. Importe antes a entrada dele (rebanho inicial, compra ou nascimento) ou corrija o brinco') };
  }
  /** Os campos do lançamento (escopo EVENTO, com destino) do grupo, na forma do formulário. */
  function camposDoGrupo_(modelo, g) {
    var c = {};
    Object.keys(g.cab).forEach(function (k) { var d = modelo.campos[k]; if (d && d.destino) c[d.destino] = g.cab[k]; });
    return c;
  }
  function parcelasDoGrupo_(g, data) {
    var n = typeof g.cab.parcelas === 'number' ? g.cab.parcelas : 1;
    var primeiro = g.cab.vencimento || data;
    if (!(n >= 1)) n = 1;
    var out = [];
    for (var i = 0; i < Math.min(n, 120); i++) out.push({ data_vencimento: maisMeses_(primeiro, i), forma_pagamento: g.cab.forma_pagamento || null });
    return out;
  }
  /**
   * Um grupo → dados do formulário do tipo ({tipo, campos, animais, crias, parcelas, custos, deducoes}), com o animal
   * de cada linha achado no ensaio. Devolve {dados, porLinha: {linha_num: animal_id existente}, erros: {linha_num: [det]}}.
   */
  function montarEvento_(tipo, modelo, g, idx, cv, D0) {
    var evento = modelo.evento;
    var campos = camposDoGrupo_(modelo, g);
    var hist = !vazio_(g.data) && g.data < D0;
    var erros = {};
    var porLinha = {};
    var erro = function (r, d) { (erros[r.linha_num] = erros[r.linha_num] || []).push(d); };
    var dados = { tipo: evento, campos: campos, animais: [] };
    var noGrupo = {};
    var semRepetir = function (r, a) {
      if (!a) return true;
      if (noGrupo[a.animal_id]) { erro(r, det_('brinco', 'ANIMAL_REPETIDO', 'o animal ' + (a.brinco || a.codigo_interno) + ' aparece também na linha ' + noGrupo[a.animal_id] + ' do mesmo lançamento')); return false; }
      noGrupo[a.animal_id] = r.linha_num;
      return true;
    };
    if (evento === 'NASCIMENTO') {
      var mae = acharAnimal_(idx, cv, g.cab.mae, null, 'a mãe', g.data);
      if (mae.erro || !mae.animal) g.linhas.forEach(function (r) { erro(r, mae.erro || det_('mae', 'ANIMAL_NAO_ENCONTRADO', 'informe o brinco da mãe')); });
      else dados.animais.push({ animal_id: mae.animal.animal_id });
      if (!vazio_(g.cab.pai)) {
        var t = String(g.cab.pai);
        var pai = donoDoBrinco_(idx, cv, t, g.data).animal || idx.porCodigo[Utils.aparar(t).toUpperCase()] || idx.externos[Utils.normalizarTexto(t)] || null;
        if (pai === AMBIGUO) g.linhas.forEach(function (r) { erro(r, det_('pai', 'PAI_NAO_ENCONTRADO', 'há mais de um animal de referência chamado "' + t + '": use o código interno dele (A-000…)')); });
        else if (!pai) g.linhas.forEach(function (r) { erro(r, det_('pai', 'PAI_NAO_ENCONTRADO', 'o pai "' + t + '" não está no rebanho nem entre os animais de referência. Deixe em branco (desconhecido), cadastre o touro como animal de referência ou corrija')); });
        else { campos.pai_id = pai.animal_id; campos.pai_confianca = g.cab.pai_confianca || null; }
      }
      dados.crias = g.linhas.map(function (r) {
        var x = {};
        ['situacao', 'sexo', 'brinco', 'nome', 'raca', 'peso', 'metodo_pesagem', 'observacoes'].forEach(function (k) { if (r.lidos[k] !== undefined) x[modelo.campos[k].destino] = r.lidos[k]; });
        if (x.situacao_nascimento === 'NATIMORTO') ['sexo', 'brinco', 'nome', 'raca', 'peso', 'metodo_pesagem', 'observacoes'].forEach(function (k) { delete x[k]; });
        return x;
      });
      return { dados: dados, porLinha: porLinha, erros: erros };
    }
    g.linhas.forEach(function (r) {
      var l = r.lidos;
      var achado = acharAnimal_(idx, cv, l.brinco, l.codigo, null, g.data);
      var it = {};
      Object.keys(l).forEach(function (k) {
        var d = modelo.campos[k];
        if (d && d.escopo === 'LINHA' && d.destino) it[d.destino] = l[k];
      });
      if (evento === 'COMPRA') {
        if (achado.erro && !achado.nenhum) { erro(r, achado.erro); return; }
        if (!vazio_(l.brinco)) it.brinco = String(l.brinco);
        if (achado.animal) {
          var a = achado.animal;
          if (!semRepetir(r, a)) return;
          // Animal já cadastrado (volta ao rebanho ou compra histórica): os dados de cadastro do arquivo precisam bater.
          [['sexo', 'sexo'], ['data_nascimento', 'data_nascimento']].forEach(function (par) {
            if (it[par[0]] !== undefined && !vazio_(a[par[1]]) && it[par[0]] !== a[par[1]]) erro(r, det_(par[0], 'DIVERGE_DO_CADASTRO', 'o animal ' + (a.brinco || a.codigo_interno) + ' já está cadastrado com ' + (par[0] === 'sexo' ? 'sexo ' + a.sexo : 'nascimento em ' + br_(a.data_nascimento)) + '; o arquivo diz outra coisa. Corrija o arquivo ou o cadastro'));
          });
          var volta = { animal_id: a.animal_id };
          ['brinco', 'brinco_origem', 'pasto_destino_id', 'peso', 'metodo_pesagem', 'peso_carcaca_kg', 'valor_individual', 'observacoes'].forEach(function (k) { if (it[k] !== undefined) volta[k] = it[k]; });
          if (vazio_(volta.brinco) && !vazio_(a.brinco)) volta.brinco = a.brinco;
          porLinha[r.linha_num] = a.animal_id;
          dados.animais.push(volta);
          return;
        }
        if (it.sexo === 'F') { delete it.castrado; delete it.reprodutor; }
        dados.animais.push(it);
        return;
      }
      if (achado.erro || !achado.animal) { erro(r, achado.erro || det_('brinco', 'CAMPO_OBRIGATORIO', 'informe o brinco ou o código do animal')); return; }
      if (!semRepetir(r, achado.animal)) return;
      porLinha[r.linha_num] = achado.animal.animal_id;
      it.animal_id = achado.animal.animal_id;
      if (evento === 'TRANSFERENCIA') it = { animal_id: it.animal_id };
      dados.animais.push(it);
    });
    if (!dados.animais.length) return { dados: dados, porLinha: porLinha, erros: erros };
    if (evento === 'COMPRA') {
      if (!hist) dados.parcelas = parcelasDoGrupo_(g, g.data);
      // 0,00 na planilha quer dizer "não houve" (03b, seção 4.1: frete e outros custos 0,00 se não houver): sem lançamento.
      dados.custos = [];
      if (typeof g.cab.frete === 'number' && g.cab.frete > 0) dados.custos.push({ tipo: 'FRETE', valor: g.cab.frete });
      if (typeof g.cab.outros_custos === 'number' && g.cab.outros_custos > 0) dados.custos.push({ tipo: 'OUTRO', valor: g.cab.outros_custos });
      if (vazio_(campos.pasto_destino_id)) {
        var primeiro = dados.animais.filter(function (x) { return !vazio_(x.pasto_destino_id); })[0];
        if (primeiro) campos.pasto_destino_id = primeiro.pasto_destino_id;
      }
    }
    if (evento === 'VENDA') {
      if (!hist) dados.parcelas = parcelasDoGrupo_(g, g.data);
      // Uma dedução por coluna com valor; 0,00 = "não houve" (sem lançamento). A marca de descontada pelo comprador
      // vem da coluna dela (ou do valor para todas as linhas); sem ela, não descontada, como no formulário.
      dados.deducoes = [];
      Object.keys(modelo.campos).forEach(function (k) {
        var d = modelo.campos[k];
        if (!d.deducao || typeof g.cab[k] !== 'number' || g.cab[k] <= 0) return;
        var marca = Object.keys(modelo.campos).filter(function (j) { return modelo.campos[j].retida_de === k; })[0];
        dados.deducoes.push({ tipo: d.deducao, valor: g.cab[k], retida_pelo_comprador: !!marca && g.cab[marca] === true });
      });
    }
    return { dados: dados, porLinha: porLinha, erros: erros };
  }
  /** Evento igual já registrado na base (mesmo tipo, mesma data, mesmo animal): a linha fica DUPLICADA (RN-091). */
  function jaRegistrado_(tx, importId, evento, data, animalId, campos) {
    if (vazio_(animalId) || vazio_(data)) return null;
    var c = campos || {};
    var achado = null;
    tx.repo.por('EVENTO_ANIMAIS', 'animal_id', animalId).some(function (l) {
      var ev = tx.repo.porId('EVENTOS', l.event_id);
      if (!ev || ev.event_type !== evento || ev.event_date !== data || ev.import_id === importId) return false;
      if (evento === 'NASCIMENTO' && l.papel !== 'MATRIZ') return false;
      // Outra transferência do animal no mesmo dia (a volta B → A) é outro evento: a guarda POSSIVEL_DUPLICIDADE do
      // motor avisa, como no formulário (RN-090, RN-091). Só a mesma origem e o mesmo destino são o evento repetido.
      if (evento === 'TRANSFERENCIA' && (nulo_(l.pasto_origem_id) !== nulo_(c.pasto_origem_id) || nulo_(l.pasto_destino_id) !== nulo_(c.pasto_destino_id))) return false;
      achado = ev;
      return true;
    });
    return achado;
  }
  /** Linha do erro do motor: o "Linha N:" que abre a mensagem (os rótulos dos itens) ou o animal; senão, todas. */
  function linhasDoErro_(g, d, porLinha) {
    var m = /^Linha (\d+)/.exec(d.mensagem || '');
    if (m && g.linhas.some(function (r) { return r.linha_num === Number(m[1]); })) return [Number(m[1])];
    if (!vazio_(d.animal_id)) {
      var nums = Object.keys(porLinha).filter(function (n) { return porLinha[n] === d.animal_id; }).map(Number);
      if (nums.length) return nums;
    }
    return g.linhas.map(function (r) { return r.linha_num; });
  }
  /**
   * Planeja os grupos, em ordem, no ensaio (cada um com as regras do formulário, sobre os anteriores). opcoes:
   * {copiar: plano real (recebe as linhas e a auditoria), importId}. Devolve por grupo {ok, erros: {linha: [det]},
   * duplicadas: {linha: det}, resultado, plano, porLinha}; grupo com erro não entra no ensaio (os seguintes não o veem).
   */
  function ensaiarGrupos_(ens, tipo, grupos, cv, opcoes) {
    var o = opcoes || {};
    var modelo = modeloDe_(tipo);
    var out = {};
    grupos.forEach(function (g) {
      var idx = indiceDoEnsaio_(ens, cv);
      var r = { ok: false, erros: {}, duplicadas: {}, porLinha: {}, resultado: null, plano: null };
      out[g.chave] = r;
      var mont = montarEvento_(tipo, modelo, g, idx, cv, cv.D0);
      r.porLinha = mont.porLinha;
      r.erros = mont.erros;
      // Duplicidade com a base: o mesmo animal já tem esse evento nessa data (fora desta importação).
      g.linhas.forEach(function (x) {
        var alvo = modelo.evento === 'NASCIMENTO' ? (mont.dados.animais[0] || {}).animal_id : mont.porLinha[x.linha_num];
        var ev = jaRegistrado_(ens.tx, o.importId, modelo.evento, g.data, alvo, mont.dados.campos);
        if (ev) r.duplicadas[x.linha_num] = det_(null, 'EVENTO_JA_REGISTRADO', 'já existe ' + NOME_EVENTO[modelo.evento] + ' de ' + br_(ev.event_date) + ' com este animal' + (modelo.evento === 'NASCIMENTO' ? ' como mãe' : '') + ': a linha não entra de novo');
      });
      if (Object.keys(r.erros).length || Object.keys(r.duplicadas).length || !mont.dados.animais.length) return;
      var etx = txDoEnsaio_(ens);
      var rotulos = modelo.evento === 'NASCIMENTO' ? ['Linha ' + g.linhas[0].linha_num] : g.linhas.filter(function (x) { return !r.erros[x.linha_num]; }).map(function (x) { return 'Linha ' + x.linha_num; });
      var res;
      try {
        res = EventService.planejarEventoImportado(etx, mont.dados, {
          importacao: { import_id: o.importId }, rotulos: rotulos,
          rotulosCrias: modelo.evento === 'NASCIMENTO' ? g.linhas.map(function (x) { return 'Linha ' + x.linha_num; }) : null,
        });
      } catch (e) {
        // Registro já gravado que o evento quebraria (retroativo): vira motivo da linha, com o registro que impede.
        if (!Validation.ehAppError(e) || e.code !== 'CONFLICT') throw e;
        res = { erros: (e.details && e.details.length ? e.details : [{ codigo: 'CONFLITO', mensagem: e.message }]).map(function (d) {
          var c = d.conflito;
          return { codigo: d.codigo || 'CONFLITO', campo: d.campo || null, animal_id: d.animal_id || null, mensagem: d.mensagem + (c && c.event_id ? ' (registro de ' + br_(c.data) + ' já gravado)' : '') };
        }) };
      }
      if (res.erros) {
        res.erros.forEach(function (d) {
          linhasDoErro_(g, d, r.porLinha).forEach(function (n) { (r.erros[n] = r.erros[n] || []).push(det_(d.campo || null, d.codigo, String(d.mensagem || '').replace(/^Linha \d+: /, ''))); });
        });
        return;
      }
      r.ok = true;
      r.resultado = res;
      r.plano = etx.plano;
      aplicarNoEnsaio_(ens, etx.plano);
      if (o.copiar) {
        var ls = etx.plano.linhas();
        Object.keys(ls).forEach(function (t) { ls[t].forEach(function (x) { o.copiar.anexar(t, x); }); });
        etx.plano.mudancas().forEach(function (mu) { o.copiar.auditar(mu); });
      }
    });
    return out;
  }
  /** Resultado da validação por linha, a partir do agrupamento e do ensaio (VALIDA só com o evento inteiro válido). */
  function resultadoPorLinha_(ag, ensaio, modelo) {
    var porNum = {};
    ag.res.forEach(function (r) { porNum[r.linha_num] = r; });
    ag.grupos.forEach(function (g) {
      var e = ensaio ? ensaio[g.chave] : null;
      var nome = modelo.campos.grupo && g.chave.indexOf('G:') === 0 ? modelo.campos.grupo.rotulo.toLowerCase().replace(/^nº d[oa] /, '') + ' ' + g.linhas[0].lidos.grupo : 'lançamento';
      var comErro = g.linhas.filter(function (r) { return r.erros.length || (e && ((e.erros[r.linha_num] || []).length || e.duplicadas[r.linha_num])); });
      g.linhas.forEach(function (r) {
        if (e && e.duplicadas[r.linha_num]) { r.status = 'DUPLICADA'; r.erros.unshift(e.duplicadas[r.linha_num]); return; }
        if (e) (e.erros[r.linha_num] || []).forEach(function (d) { r.erros.push(d); });
        if (r.erros.length) { r.status = 'ERRO'; return; }
        if (comErro.length || (e && !e.ok)) {
          r.status = 'ERRO';
          r.erros.push(det_(null, 'LANCAMENTO_COM_ERRO', comErro.length ? 'o lançamento (' + nome + ') tem problema na linha ' + comErro.map(function (x) { return x.linha_num; }).join(', ') + ': ele só entra inteiro' : 'o lançamento (' + nome + ') não pôde ser conferido'));
          return;
        }
        r.status = 'VALIDA';
        if (e) r.animal_id = e.porLinha[r.linha_num] || null;
      });
    });
    return ag.res;
  }
  /** Validação completa de um arquivo de eventos (o ensaio inteiro). opcoes: {ignorar: {linha_num: true}}. */
  function validarEventos_(tx, imp, linhas, map, cv, opcoes) {
    var o = opcoes || {};
    var modelo = modeloDe_(imp.tipo);
    var ag = agruparLinhas_(linhas, modelo, map, imp.formato_json || {}, cv);
    var ens = abrirEnsaio_(tx, imp.import_id);
    var planejaveis = ag.grupos.filter(function (g) {
      return !g.linhas.some(function (r) { return r.erros.length; }) && !g.linhas.some(function (r) { return o.ignorar && o.ignorar[r.linha_num]; });
    });
    var ensaio = ensaiarGrupos_(ens, imp.tipo, planejaveis, cv, { importId: imp.import_id });
    var res = resultadoPorLinha_(ag, ensaio, modelo);
    return { res: res, grupos: ag.grupos };
  }
  /** Blocos de importação: os eventos inteiros, em ordem cronológica, até `lote` linhas por bloco (um evento maior vai sozinho). */
  function blocosDeEventos_(grupos, lote) {
    var blocos = [];
    var atual = null;
    grupos.forEach(function (g) {
      var n = g.linhas.length;
      if (!atual || (atual.linhas + n > lote && atual.linhas > 0)) { atual = { grupos: [], linhas: 0 }; blocos.push(atual); }
      atual.grupos.push(g);
      atual.linhas += n;
    });
    return blocos;
  }
  /** Grupos que entram (linhas VALIDA ou IMPORTADA; nenhum IGNORADA), na ordem de importação. */
  function gruposImportaveis_(tx, imp, cv) {
    var gravadas = linhasGravadas_(tx, imp.import_id);
    var ag = agruparLinhas_(linhasDoArquivo_(gravadas), modeloDe_(imp.tipo), imp.mapeamento_json, imp.formato_json || {}, cv);
    var grupos = ag.grupos.filter(function (g) {
      return g.linhas.every(function (r) { var s = gravadas[r.linha_num].status; return s === 'VALIDA' || s === 'IMPORTADA'; });
    });
    return { gravadas: gravadas, grupos: grupos, todos: ag.grupos };
  }
  function confirmarEventos_(tx, imp, cv) {
    var d = tx.dados;
    var gravadas = linhasGravadas_(tx, imp.import_id);
    var linhas = linhasDoArquivo_(gravadas);
    var v = validarEventos_(tx, imp, linhas, imp.mapeamento_json, cv);
    var divergentes = v.res.filter(function (r) { var g = gravadas[r.linha_num]; return !g || (g.status === 'VALIDA') !== (r.status === 'VALIDA'); });
    if (divergentes.length) throw Validation.erro('CONFLICT', 'O rebanho ou o cadastro mudou desde a validação (' + divergentes.length + ' linha(s) com resultado diferente, a primeira é a ' + divergentes[0].linha_num + '). Valide o arquivo de novo antes de importar.');
    var ignorar = d.ignorar_linhas || [];
    var erros = [];
    var ign = {};
    ignorar.forEach(function (n) {
      if (!gravadas[n] || gravadas[n].status !== 'VALIDA') erros.push(det_('ignorar_linhas', 'LINHA_INVALIDA', 'A linha ' + n + ' não é uma linha válida que possa ser deixada de fora.'));
      ign[n] = true;
    });
    v.grupos.forEach(function (g) {
      var fora = g.linhas.filter(function (r) { return ign[r.linha_num]; });
      if (fora.length && fora.length < g.linhas.length) erros.push(det_('ignorar_linhas', 'GRUPO_PARCIAL', 'A linha ' + fora[0].linha_num + ' é parte de um lançamento com as linhas ' + g.linhas.map(function (r) { return r.linha_num; }).join(', ') + ': deixe de fora todas ou nenhuma.'));
    });
    if (!erros.length && ignorar.length) {
      // Sem os lançamentos deixados de fora, os outros continuam válidos? (a segunda transferência depende da primeira)
      var sem = validarEventos_(tx, imp, linhas, imp.mapeamento_json, cv, { ignorar: ign });
      sem.res.forEach(function (r) {
        if (ign[r.linha_num] || gravadas[r.linha_num].status !== 'VALIDA' || r.status === 'VALIDA') return;
        erros.push(det_('ignorar_linhas', 'DEPENDE_DE_LINHA_IGNORADA', 'Sem as linhas deixadas de fora, a linha ' + r.linha_num + ' deixa de valer (' + r.erros.map(function (x) { return x.mensagem; }).join('; ') + ').'));
      });
    }
    if (erros.length) return { erros: erros };
    var total = imp.total_linhas;
    var validas = v.res.filter(function (r) { return r.status === 'VALIDA'; }).length - ignorar.length;
    var reprovadas = total - validas - ignorar.length;
    var modo = modoAprovado_(d, validas, reprovadas, ignorar.length);
    if (modo.erros) return modo;
    ignorar.forEach(function (n) { AuditService.alteracao(tx, 'IMPORTACAO_LINHAS', gravadas[n].import_line_id, { status: 'IGNORADA' }, 'Deixada de fora pelo dono na pré-visualização.'); });
    var lote = tamanhoLote_(cv.params);
    var statusDe = {};
    v.res.forEach(function (x) { statusDe[x.linha_num] = x.status; });
    var entram = v.grupos.filter(function (g) { return g.linhas.every(function (r) { return !ign[r.linha_num] && statusDe[r.linha_num] === 'VALIDA'; }); });
    var blocos = blocosDeEventos_(entram, lote);
    var rel = relatorio_(imp);
    rel.lote_linhas = lote;
    rel.blocos = blocos.length;
    rel.tamanhos_blocos = blocos.map(function (b) { return b.linhas; });
    rel.eventos = entram.length;
    rel.ignoradas = ignorar.length;
    AuditService.alteracao(tx, 'IMPORTACOES', imp.import_id, { modo: d.modo, status: 'IMPORTANDO', relatorio_json: rel, linhas_validas: validas, linhas_erro: reprovadas }, justificativaModo_(tx, d.modo, validas, reprovadas + ignorar.length));
    return { lote: lote, ignorar: ignorar };
  }
  /** Importa o bloco `bloco` de um arquivo de eventos: cada evento do bloco pelo planejamento do formulário, no ensaio. */
  function planejarBlocoEventos_(tx, bloco, imp) {
    var cv = contextoEventos_(tx);
    if (bloco === 1) {
      var c = confirmarEventos_(tx, imp, cv);
      if (c.erros) return { erros: c.erros };
    }
    var lote = bloco === 1 ? tamanhoLote_(cv.params) : relatorio_(imp).lote_linhas;
    var ignorar = {};
    (bloco === 1 ? tx.dados.ignorar_linhas || [] : []).forEach(function (n) { ignorar[n] = true; });
    var gi = gruposImportaveis_(tx, imp, cv);
    var gravadas = gi.gravadas;
    var grupos = gi.grupos.filter(function (g) { return !g.linhas.some(function (r) { return ignorar[r.linha_num]; }); });
    var blocos = blocosDeEventos_(grupos, lote);
    if (bloco > blocos.length) throw recusar_('Esta importação tem ' + blocos.length + ' bloco(s).', [det_('bloco', 'VALOR_FORA_DA_FAIXA', 'Bloco inexistente.')]);
    var anteriores = [];
    blocos.slice(0, bloco - 1).forEach(function (b) { b.grupos.forEach(function (g) { anteriores = anteriores.concat(g.linhas); }); });
    var falta = anteriores.filter(function (r) { return gravadas[r.linha_num].status !== 'IMPORTADA'; })[0];
    if (falta) throw Validation.erro('CONFLICT', 'Importe os blocos em ordem: a linha ' + falta.linha_num + ', de um bloco anterior, ainda não foi importada.');
    var doBloco = blocos[bloco - 1].grupos;
    var linhasDoBloco = [];
    doBloco.forEach(function (g) { linhasDoBloco = linhasDoBloco.concat(g.linhas); });
    if (linhasDoBloco.every(function (r) { return gravadas[r.linha_num].status === 'IMPORTADA'; })) {
      return { resposta: function (t) { return estado_(t, imp.import_id); } }; // já importado (por outra chave): nada a gravar
    }
    var ens = abrirEnsaio_(tx, imp.import_id);
    var ensaio = ensaiarGrupos_(ens, imp.tipo, doBloco, cv, { importId: imp.import_id, copiar: tx.plano });
    var avisos = [];
    var animais = [];
    var eventos = [];
    doBloco.forEach(function (g) {
      var e = ensaio[g.chave];
      if (!e.ok) {
        var motivos = [];
        Object.keys(e.duplicadas).forEach(function (n) { motivos.push(e.duplicadas[n].mensagem); });
        Object.keys(e.erros).forEach(function (n) { e.erros[n].forEach(function (x) { motivos.push(x.mensagem); }); });
        throw Validation.erro('CONFLICT', 'A linha ' + g.linhas[0].linha_num + ' deixou de ser válida (' + (motivos.join('; ') || 'o lançamento não pôde ser conferido') + '). Desfaça esta importação e valide o arquivo de novo.');
      }
      var res = e.resultado;
      (res.avisos || []).forEach(function (a) { avisos.push(a); });
      animais = animais.concat(res.derivados.animais || []);
      eventos = eventos.concat(res.derivados.eventos || []);
      var eventId = res.resumo.event_id;
      // Animal de cada linha: o achado no cadastro; na compra, a linha de EVENTO_ANIMAIS na ordem das linhas (animal novo
      // ou que volta); no nascimento, a cria viva na ordem das linhas (natimorto não cria animal).
      var evento = modeloDe_(imp.tipo).evento;
      var ea = e.plano.linhas().EVENTO_ANIMAIS || [];
      var crias = ea.filter(function (l) { return l.papel === 'CRIA'; });
      var k = 0;
      g.linhas.forEach(function (r, i) {
        var entity = e.porLinha[r.linha_num] || null;
        if (evento === 'COMPRA') entity = ea[i] ? ea[i].animal_id : null;
        if (evento === 'NASCIMENTO') entity = r.lidos.situacao === 'NATIMORTO' ? null : (crias[k++] || {}).animal_id || null;
        AuditService.alteracao(tx, 'IMPORTACAO_LINHAS', gravadas[r.linha_num].import_line_id, { status: 'IMPORTADA', entity_id_gerado: entity, event_id_gerado: eventId });
      });
    });
    var jaImportadas = Object.keys(gravadas).filter(function (n) { return gravadas[n].status === 'IMPORTADA'; }).length;
    AuditService.alteracao(tx, 'IMPORTACOES', imp.import_id, { linhas_importadas: jaImportadas + linhasDoBloco.length });
    return {
      avisos: avisos, resumo: { import_id: imp.import_id, bloco: bloco, eventos: doBloco.length, linhas: linhasDoBloco.length },
      derivados: { animais: Utils.unicos(animais), eventos: Utils.unicos(eventos) },
      resposta: function (t) { return estado_(t, imp.import_id); },
    };
  }

  // ---- reconciliação: fotografia do marco zero × histórico importado (RN-095; 04, seção 6) ----
  var SAIDAS_HIST = { VENDA: 'vendido', MORTE: 'morto', DESCARTE: 'descartado' };
  /** Classe de uma linha histórica pelo tipo do evento: entrada 0, movimento ou fato 1, saída 2. */
  function classeHist_(x) {
    var t = x.ev.event_type;
    if (SAIDAS_HIST[t]) return 2;
    if (t === 'COMPRA' || t === 'OUTRA_ENTRADA' || (t === 'NASCIMENTO' && x.l.papel === 'CRIA')) return 0;
    return 1;
  }
  var NOME_EVENTO = { COMPRA: 'compra', VENDA: 'venda', TRANSFERENCIA: 'transferência', NASCIMENTO: 'parto', MORTE: 'morte', OUTRA_ENTRADA: 'entrada', DESCARTE: 'descarte' };
  var ACOES_RECONCILIACAO = Object.freeze({
    SAIDA_HISTORICA_NA_FOTOGRAFIA: 'Se a fotografia está certa, nada a fazer: o animal fica no rebanho e a saída antiga vale só como histórico. Se a saída aconteceu, o animal não deveria estar no marco zero: corrija com "Corrigir inventário" (baixa na contagem) datado do marco zero ou estorne a saída antiga se ela foi lançada por engano.',
    PASTO_DIVERGENTE: 'Se a fotografia está certa, nada a fazer: vale o pasto do marco zero. Se o histórico está certo, corrija o pasto do marco zero com "Corrigir localização" datado do marco zero.',
    FORA_DA_FOTOGRAFIA: 'Pelo histórico o animal estava na fazenda no marco zero, mas ele não está na fotografia. Se ele estava na fazenda, lance a entrada dele por "Outra entrada" datada do marco zero. Se ele saiu antes, importe a venda ou a morte antiga (planilha de vendas ou de mortes). O descarte antigo (doação, consumo, sacrifício) ainda não tem como ser registrado: anote-o nas observações do animal; a divergência continua na lista.',
  });
  /**
   * Relatório de reconciliação da base (sem gravar nada): para cada animal com registro anterior ao marco zero, a
   * posição no marco zero recalculada pelo histórico (dentro ou fora; pasto = o último destino) × a declarada na
   * fotografia (ENTRADA_INICIAL); divergências por animal e por pasto, cada uma com a explicação e o que fazer; e os
   * brincos citados em linhas de importação de eventos sem animal na base. Não bloqueia nada (RN-095).
   */
  function reconciliacao_(tx) {
    var params = Timeline.parametros(tx.repo);
    var fonte = tx.cru ? Timeline.fonte(tx, { parametros: params }) : null;
    var posicao_ = function (ev) { return (fonte ? fonte.ordemSeq(ev.event_id) : null) || ev.event_seq || 0; };
    var D0 = params.data_marco_zero;
    var nomePasto = function (id) { var p = vazio_(id) ? null : tx.repo.porId('PASTOS', id); return p ? p.nome : null; };
    var foto = {};
    var hist = {};
    var noMarco = {};
    tx.repo.vigentes('EVENTO_ANIMAIS').forEach(function (l) {
      var ev = tx.repo.porId('EVENTOS', l.event_id);
      if (!ev) return;
      if (ev.event_type === 'ENTRADA_INICIAL' && l.efeito_inventario === 1) foto[l.animal_id] = { pasto: nulo_(l.pasto_destino_id), event_id: ev.event_id };
      else if (ev.pre_marco_zero === true) (hist[l.animal_id] = hist[l.animal_id] || []).push({ l: l, ev: ev });
      // A decisão do dono sobre a fotografia, pelos próprios lançamentos (04, seção 6; RN-095): a entrada (outra entrada)
      // do animal que faltava, a correção de localização e a baixa na contagem datadas do marco zero corrigem o que a
      // fotografia declara.
      else if (ev.event_date === D0 && ((ev.event_type === 'AJUSTE_INVENTARIO' && (ev.event_subtype === 'CORRECAO_LOCALIZACAO' || ev.event_subtype === 'DIVERGENCIA_CONTAGEM')) || (ev.event_type === 'OUTRA_ENTRADA' && l.efeito_inventario === 1))) (noMarco[l.animal_id] = noMarco[l.animal_id] || []).push({ l: l, ev: ev });
    });
    Object.keys(noMarco).forEach(function (id) {
      noMarco[id].sort(function (a, b) { return (posicao_(a.ev) - posicao_(b.ev)) || (a.ev.event_seq || 0) - (b.ev.event_seq || 0); }).forEach(function (x) {
        if (x.ev.event_type === 'OUTRA_ENTRADA') { if (!foto[id] || foto[id].fora) foto[id] = { pasto: nulo_(x.l.pasto_destino_id), event_id: x.ev.event_id, porEntrada: true }; return; }
        if (!foto[id]) return;
        if (x.ev.event_subtype === 'DIVERGENCIA_CONTAGEM') foto[id].fora = true;
        else if (!foto[id].fora) foto[id].pasto = nulo_(x.l.pasto_destino_id);
      });
    });
    var animais = [];
    var posicao = {};
    var ids = Utils.unicos(Object.keys(foto).concat(Object.keys(hist)));
    ids.forEach(function (id) {
      var declarado = foto[id] && !foto[id].fora ? { no_rebanho: true, pasture_id: foto[id].pasto } : { no_rebanho: false, pasture_id: null };
      if (!hist[id]) { posicao[id] = { declarado: declarado, recalculado: declarado }; return; }
      var dentro = null;
      var pasto = null;
      var ultimo = null;
      var mov = null;
      var fato = null;
      // Ordem canônica (desenho-base 4.3; 04, seção 5.1): data, classe pelo tipo (entrada, movimento, saída), posição
      // na cadeia de substituição e event_seq — as linhas antigas têm efeito 0 e não dizem a classe por si.
      hist[id].sort(function (a, b) {
        return (a.ev.event_date < b.ev.event_date ? -1 : a.ev.event_date > b.ev.event_date ? 1 : 0) || (classeHist_(a) - classeHist_(b)) ||
          (posicao_(a.ev) - posicao_(b.ev)) || (a.ev.event_seq || 0) - (b.ev.event_seq || 0);
      }).forEach(function (x) {
        var t = x.ev.event_type;
        if (SAIDAS_HIST[t]) { dentro = false; pasto = null; ultimo = x; return; }
        if (t === 'COMPRA' || t === 'TRANSFERENCIA' || t === 'OUTRA_ENTRADA' || (t === 'NASCIMENTO' && x.l.papel === 'CRIA')) {
          dentro = true;
          if (!vazio_(x.l.pasto_destino_id)) { pasto = x.l.pasto_destino_id; mov = x; }
          ultimo = x;
          return;
        }
        if (dentro === null) { dentro = true; fato = x; } // a mãe de um parto antigo estava na fazenda
      });
      var recalculado = { no_rebanho: dentro === null ? declarado.no_rebanho : dentro, pasture_id: dentro ? pasto : null };
      // O animal estava na fotografia e o dono o baixou na contagem do marco zero: a baixa é a decisão dele sobre o marco
      // zero, e o histórico que o põe na fazenda não é divergência (nem por animal, nem na conta do pasto).
      if (foto[id] && foto[id].fora && recalculado.no_rebanho) recalculado = declarado;
      if (recalculado.no_rebanho && !recalculado.pasture_id && declarado.no_rebanho) recalculado.pasture_id = declarado.pasture_id;
      posicao[id] = { declarado: declarado, recalculado: recalculado };
      var a = tx.repo.porId('ANIMAIS', id) || {};
      var base = {
        animal_id: id, codigo_interno: a.codigo_interno || null, brinco: nulo_(a.brinco),
        declarado: { no_rebanho: declarado.no_rebanho, pasture_id: declarado.pasture_id, pasto: nomePasto(declarado.pasture_id) },
        recalculado: { no_rebanho: recalculado.no_rebanho, pasture_id: recalculado.pasture_id, pasto: nomePasto(recalculado.pasture_id) },
      };
      var quem = a.brinco ? 'O animal de brinco ' + a.brinco : 'O animal ' + (a.codigo_interno || id);
      var dif = null;
      if (declarado.no_rebanho && !recalculado.no_rebanho) {
        dif = { codigo: 'SAIDA_HISTORICA_NA_FOTOGRAFIA', evento: ultimo, explicacao: quem + ' foi ' + SAIDAS_HIST[ultimo.ev.event_type] + ' em ' + br_(ultimo.ev.event_date) + ' pelo histórico, mas está na fotografia do marco zero (' + br_(D0) + ').' };
      } else if (!declarado.no_rebanho && recalculado.no_rebanho) {
        // O que põe o animal na fazenda: a última entrada ou movimento antigo, ou o parto antigo de que ele é a mãe.
        var porQue = ultimo || fato;
        var oque = porQue ? NOME_EVENTO[porQue.ev.event_type] + (porQue === fato && porQue.l.papel === 'MATRIZ' ? ' em que ele é a mãe' : '') + ' de ' + br_(porQue.ev.event_date) : 'registro antigo';
        dif = { codigo: 'FORA_DA_FOTOGRAFIA', evento: porQue, explicacao: quem + ' está na fazenda pelo histórico (' + oque + ') e não tem saída antes do marco zero, mas não está na fotografia de ' + br_(D0) + '.' };
      } else if (declarado.no_rebanho && recalculado.no_rebanho && mov && declarado.pasture_id && recalculado.pasture_id !== declarado.pasture_id) {
        dif = { codigo: 'PASTO_DIVERGENTE', evento: mov, explicacao: quem + ': o último pasto do histórico é ' + nomePasto(recalculado.pasture_id) + ' (' + br_(mov.ev.event_date) + '), mas a fotografia do marco zero o põe no ' + nomePasto(declarado.pasture_id) + '.' };
      }
      if (!dif) return;
      base.codigo = dif.codigo;
      base.explicacao = dif.explicacao;
      base.acao = ACOES_RECONCILIACAO[dif.codigo];
      base.evento = dif.evento ? { event_id: dif.evento.ev.event_id, tipo: dif.evento.ev.event_type, subtipo: nulo_(dif.evento.ev.event_subtype), data: dif.evento.ev.event_date, nome: EventCatalog.nomeEvento(dif.evento.ev.event_type, dif.evento.ev.event_subtype) } : null;
      animais.push(base);
    });
    var porPasto = {};
    var conta = function (id, lado) {
      var p = posicao[id][lado];
      if (!p.no_rebanho) return;
      var k = p.pasture_id || '';
      var x = porPasto[k] = porPasto[k] || { pasture_id: p.pasture_id || null, declarado: 0, recalculado: 0, animais: [] };
      x[lado] += 1;
    };
    ids.forEach(function (id) { conta(id, 'declarado'); conta(id, 'recalculado'); });
    animais.forEach(function (d) {
      [d.declarado.pasture_id, d.recalculado.pasture_id].forEach(function (p) { if (p && porPasto[p] && porPasto[p].animais.indexOf(d.codigo_interno) < 0) porPasto[p].animais.push(d.codigo_interno); });
    });
    var pastos = Object.keys(porPasto).map(function (k) { return porPasto[k]; }).filter(function (p) { return p.declarado !== p.recalculado; }).map(function (p) {
      var nome = nomePasto(p.pasture_id) || 'sem pasto';
      return {
        pasture_id: p.pasture_id, pasto: nome, declarado: p.declarado, recalculado: p.recalculado, diferenca: p.recalculado - p.declarado, animais: p.animais.sort(),
        explicacao: 'No ' + nome + ' a fotografia do marco zero tem ' + p.declarado + ' animal(is); pelo histórico seriam ' + p.recalculado + ' (veja os animais ' + p.animais.sort().join(', ') + ').',
      };
    }).sort(function (a, b) { return a.pasto < b.pasto ? -1 : a.pasto > b.pasto ? 1 : 0; });
    var semAnimal = [];
    tx.repo.vigentes('IMPORTACOES').forEach(function (imp) {
      if (!TIPOS_EVENTO[imp.tipo] || imp.status === 'CANCELADO') return;
      tx.repo.por('IMPORTACAO_LINHAS', 'import_id', imp.import_id).forEach(function (l) {
        (l.erros_json || []).forEach(function (e) {
          if (e.codigo === 'ANIMAL_NAO_ENCONTRADO') semAnimal.push({ import_id: imp.import_id, arquivo_nome: imp.arquivo_nome, tipo: imp.tipo, linha_num: l.linha_num, mensagem: e.mensagem });
        });
      });
    });
    semAnimal.sort(function (a, b) { return a.arquivo_nome < b.arquivo_nome ? -1 : a.arquivo_nome > b.arquivo_nome ? 1 : a.linha_num - b.linha_num; });
    var porCodigo = {};
    animais.forEach(function (d) { porCodigo[d.codigo] = (porCodigo[d.codigo] || 0) + 1; });
    animais.sort(function (a, b) { return String(a.codigo_interno) < String(b.codigo_interno) ? -1 : 1; });
    return {
      marco_zero: D0 || null,
      resumo: {
        na_fotografia: Object.keys(foto).length, com_historico: Object.keys(hist).length, divergencias: animais.length, por_codigo: porCodigo,
        pastos_divergentes: pastos.length, sem_animal: semAnimal.length, bloqueia: false,
      },
      animais: animais, pastos: pastos, sem_animal: semAnimal,
    };
  }
  /** Consulta (importacao.reconciliacao): o relatório de reconciliação da base. */
  function consultaReconciliacao() {
    return { rota: 'importacao.reconciliacao', reads: leiturasConsulta_(), acessoCru: true, tratador: function (tx) { return reconciliacao_(tx); } };
  }

  // ------------------------------------------------------------------ consultas ----
  function estado_(tx, importId) {
    var imp = exigirImportacao_(tx, importId);
    var gravadas = linhasGravadas_(tx, importId);
    var lista = Object.keys(gravadas).map(function (k) { return gravadas[k]; });
    var conta = function (s) { return lista.filter(function (l) { return l.status === s; }).length; };
    var rel = relatorio_(imp);
    var blocos = { tamanho: rel.lote_linhas || null, total: null, importados: 0, proximo: null };
    if (rel.lote_linhas && imp.status !== 'RASCUNHO' && imp.status !== 'VALIDADO') {
      // Os blocos são fatias da ordem de importação, gravadas estritamente em ordem: o número de linhas
      // importadas diz quantos blocos já foram.
      var importaveis = lista.filter(function (l) { return l.status === 'VALIDA' || l.status === 'IMPORTADA'; }).length;
      var feitas = conta('IMPORTADA');
      if (Array.isArray(rel.tamanhos_blocos)) {
        // Eventos: o bloco leva eventos inteiros, então os tamanhos variam (fixados na confirmação).
        blocos.total = rel.tamanhos_blocos.length;
        var soma = 0;
        blocos.importados = 0;
        rel.tamanhos_blocos.forEach(function (n) { soma += n; if (soma <= feitas) blocos.importados += 1; });
      } else {
        blocos.total = Math.ceil(importaveis / rel.lote_linhas);
        blocos.importados = feitas === importaveis ? blocos.total : Math.floor(feitas / rel.lote_linhas);
      }
      blocos.proximo = imp.status === 'IMPORTANDO' && blocos.importados < blocos.total ? blocos.importados + 1 : null;
    }
    return {
      importacao: importacaoPublica_(imp),
      contadores: {
        total: imp.total_linhas, conferidas: rel.conferidas, validas: conta('VALIDA'), erro: conta('ERRO'), duplicadas: conta('DUPLICADA'),
        ignoradas: conta('IGNORADA'), importadas: conta('IMPORTADA'), por_codigo: rel.por_codigo,
      },
      blocos: blocos,
      validacao: { conferidas: rel.conferidas, completa: rel.conferidas >= imp.total_linhas },
      pode: {
        validar: !!ESTADOS_VALIDAVEIS[imp.status], importar: imp.status === 'VALIDADO' || blocos.proximo !== null,
        concluir: imp.status === 'IMPORTANDO' && blocos.proximo === null, desfazer: imp.status !== 'CANCELADO',
      },
    };
  }
  function leiturasConsulta_() {
    return ['IMPORTACOES', 'IMPORTACAO_LINHAS', 'ANEXOS', 'ANIMAIS', 'PASTOS', 'LISTAS', 'CONFIGURACOES', 'AUDITORIA', 'EVENTOS', 'EVENTO_ANIMAIS', 'PARCEIROS'];
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
   * dados_originais, interpretado, entity_id_gerado, event_id_gerado} e, na importação de eventos, `lancamento` (as
   * linhas do arquivo que formam o mesmo lançamento, pela chave de agrupamento; null na linha repetida).
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
        var cv = !imp.mapeamento_json ? null : TIPOS_EVENTO[imp.tipo] ? contextoEventos_(tx) : contextoValidacao_(tx);
        var deEventos = !!(cv && TIPOS_EVENTO[imp.tipo]);
        var modelo = deEventos ? modeloDe_(imp.tipo) : null;
        var lidosDe = {};
        var lerEvento = function (l) {
          if (!lidosDe[l.linha_num]) lidosDe[l.linha_num] = lerLinhaEvento_({ linha_num: l.linha_num, valores: l.dados_originais_json || {} }, modelo, imp.mapeamento_json, imp.formato_json || {}, cv).lidos;
          return lidosDe[l.linha_num];
        };
        // Na importação de eventos, as linhas de cada lançamento (a chave de agrupamento da validação): deixar de fora
        // vale para o lançamento inteiro (GRUPO_PARCIAL), e a tela marca as linhas juntas.
        var chaveDe = {};
        var linhasDaChave = {};
        if (deEventos) {
          Utils.ordenarPor(Object.keys(gravadas).map(function (k) { return gravadas[k]; }), ['linha_num']).forEach(function (l) {
            if (l.status === 'DUPLICADA') return;
            var k = chaveGrupo_(modelo, { linha_num: l.linha_num, lidos: lerEvento(l) });
            chaveDe[l.linha_num] = k;
            (linhasDaChave[k] = linhasDaChave[k] || []).push(l.linha_num);
          });
        }
        var itens = lista.slice((pagina - 1) * porPagina, pagina * porPagina).map(function (l) {
          var interpretado = null;
          var linha = { linha_num: l.linha_num, valores: l.dados_originais_json || {} };
          if (deEventos) interpretado = lerEvento(l);
          else if (cv && !vazio_(cv.D0)) interpretado = lerLinha_(linha, imp.mapeamento_json, imp.formato_json || {}, cv).item;
          var item = {
            linha_num: l.linha_num, status: l.status, erros: l.erros_json || [], dados_originais: l.dados_originais_json, interpretado: interpretado,
            entity_id_gerado: l.entity_id_gerado || null, event_id_gerado: l.event_id_gerado || null,
          };
          if (deEventos) item.lancamento = chaveDe[l.linha_num] ? linhasDaChave[chaveDe[l.linha_num]].slice() : null;
          return item;
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
    // Animais criados: na importação de animais, um por linha; na de eventos, os que os eventos dela criaram (compra, cria).
    var criados = importados;
    if (TIPOS_EVENTO[imp.tipo]) {
      var novos = {};
      Utils.unicos(importados.map(function (l) { return l.event_id_gerado; })).forEach(function (id) {
        (tx.cru ? tx.cru.cruPor('EVENTO_ANIMAIS', 'event_id', id) : tx.repo.por('EVENTO_ANIMAIS', 'event_id', id)).forEach(function (x) { if (x.atributos_iniciais_json) novos[x.animal_id] = true; });
      });
      criados = importados.filter(function (l) { return novos[l.entity_id_gerado]; });
    }
    return {
      importacao: e.importacao, contadores: e.contadores, blocos: e.blocos,
      aprovacao: aprovacao ? { modo: aprovacao.valor_novo, por: aprovacao.usuario, em: aprovacao.timestamp, texto: aprovacao.justificativa } : null,
      criados: { animais: criados.length, eventos: Utils.unicos(importados.map(function (l) { return l.event_id_gerado; })).length, ativos: vigentes },
      reprovadas: lista.filter(function (l) { return l.status === 'ERRO' || l.status === 'DUPLICADA'; }).map(function (l) { return { linha_num: l.linha_num, status: l.status, erros: l.erros_json || [], dados_originais: l.dados_originais_json }; }),
      ignoradas: lista.filter(function (l) { return l.status === 'IGNORADA'; }).map(function (l) { return l.linha_num; }),
      pendencias: {
        sem_brinco: criados.filter(function (l) { var a = tx.repo.porId('ANIMAIS', l.entity_id_gerado); return a && vazio_(a.brinco); }).length,
        sem_nascimento: criados.filter(function (l) { var a = tx.repo.porId('ANIMAIS', l.entity_id_gerado); return a && vazio_(a.data_nascimento); }).length,
      },
      // Fotografia do marco zero × histórico importado (RN-095): lista as divergências, sem bloquear.
      reconciliacao: reconciliacao_(tx),
    };
  }
  /** Relatório final (importacao.relatorio): contadores, aprovação registrada, criados, reprovadas com o motivo, pendências. */
  function consultaRelatorio(dados) {
    var id = (dados || {}).import_id;
    return { rota: 'importacao.relatorio', reads: leiturasConsulta_(), acessoCru: true, tratador: function (tx) { return relatorioFinal_(tx, id); } };
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
    modelo: modelo,
    conferirMapeamento: conferirMapeamento,
    validarLinhas: validarLinhas,
    criar: criar,
    previaArquivo: previaArquivo,
    validarBloco: validarBloco,
    importarBloco: importarBloco,
    comandoBloco: comandoBloco,
    concluir: concluir,
    desfazer: desfazer,
    consultaObter: consultaObter,
    obter: obter,
    consultaLinhas: consultaLinhas,
    consultaRelatorio: consultaRelatorio,
    consultaListar: consultaListar,
    consultaReconciliacao: consultaReconciliacao,
    TIPOS_EVENTO: TIPOS_EVENTO,
    MODELOS: MODELOS,
  };
})();
