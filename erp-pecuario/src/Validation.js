/**
 * Validation — erro de aplicação padronizado (AppError) e validação de formato contra o Schema.
 *
 * Valida o registro na forma da LÓGICA (P6), antes de qualquer escrita: ID, TEXTO, DATA, TS e ENUM são texto;
 * INT, DEC1 e DEC4 são número; DINHEIRO é inteiro em centavos; BOOL é booleano; JSON é objeto ou lista.
 * Vazio canônico: null, undefined ou ''. Regras de negócio (linha do tempo, unicidade, FKs) não moram aqui.
 * Puro: nenhum serviço do Apps Script.
 */
var Validation = (function () {
  'use strict';

  var CODIGOS = Object.freeze(['VALIDATION', 'CONFLICT', 'NEEDS_CONFIRMATION', 'IDEMPOTENCY_MISMATCH', 'LOCKED', 'DENIED', 'NOT_FOUND', 'CONFIG', 'INTERNAL']);
  var TETO_CELULA = 40000;
  var RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var MENSAGEM_INTERNA = 'Não foi possível concluir. Tente de novo; se o problema continuar, veja a tela Sistema.';
  /** Códigos estáveis de `details[].codigo` gerados pela validação de formato. */
  var DETALHE = Object.freeze({
    CAMPO_OBRIGATORIO: 'CAMPO_OBRIGATORIO',
    CAMPO_DESCONHECIDO: 'CAMPO_DESCONHECIDO',
    TIPO_INVALIDO: 'TIPO_INVALIDO',
    FORMATO_INVALIDO: 'FORMATO_INVALIDO',
    VALOR_FORA_DA_LISTA: 'VALOR_FORA_DA_LISTA',
    VALOR_FORA_DA_FAIXA: 'VALOR_FORA_DA_FAIXA',
    TEXTO_LONGO_DEMAIS: 'TEXTO_LONGO_DEMAIS',
  });

  // ------------------------------------------------------------------ AppError ----
  function texto_(v) {
    return v === null || v === undefined || v === '' ? null : String(v);
  }
  /** Item de `error.details[]` na forma de 01, seção 3.3: o que não se aplica vem null. */
  function detalhe(d) {
    var o = d || {};
    var c = o.conflito || null;
    return {
      codigo: texto_(o.codigo),
      animal_id: texto_(o.animal_id),
      brinco: texto_(o.brinco),
      campo: texto_(o.campo),
      mensagem: texto_(o.mensagem),
      conflito: c ? { event_id: texto_(c.event_id), tipo: texto_(c.tipo), data: texto_(c.data) } : null,
    };
  }
  /**
   * Erro de aplicação. `code` é um dos nove códigos da API; `message` é escrita para o pecuarista e pode ser
   * exibida; `details` segue 01, seção 3.3. Código desconhecido é erro de programação.
   */
  function AppError(code, message, details) {
    if (!(this instanceof AppError)) return new AppError(code, message, details);
    if (CODIGOS.indexOf(code) < 0) throw new Error('AppError: código desconhecido: ' + code);
    this.name = 'AppError';
    this.code = code;
    this.message = String(message === null || message === undefined ? '' : message);
    this.details = (Array.isArray(details) ? details : []).map(detalhe);
    if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(this, AppError);
    else this.stack = new Error(this.message).stack;
  }
  AppError.prototype = Object.create(Error.prototype);
  AppError.prototype.constructor = AppError;

  /** Atalho: `throw Validation.erro('VALIDATION', 'mensagem', [detalhes])`. */
  function erro(code, message, details) {
    return new AppError(code, message, details);
  }
  /** true para AppError, mesmo vindo de outro arquivo ou serializado e reconstruído. */
  function ehAppError(e) {
    return !!e && e.name === 'AppError' && CODIGOS.indexOf(e.code) >= 0;
  }
  /** {code, message, details} para o envelope da API. Exceção que não é AppError vira INTERNAL com texto genérico. */
  function serializarErro(e) {
    if (ehAppError(e)) return { code: e.code, message: e.message, details: (e.details || []).map(detalhe) };
    return { code: 'INTERNAL', message: MENSAGEM_INTERNA, details: [] };
  }

  // ------------------------------------------------------------------ validadores por tipo ----
  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function problema_(codigo, mensagem) {
    return { codigo: codigo, mensagem: mensagem };
  }
  function ehInteiroSeguro_(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && Math.abs(v) <= 9007199254740991;
  }
  function numeroBr_(n) {
    return String(n).replace('.', ',');
  }
  /** Percorre um valor JSON e devolve o caminho do primeiro item que não é JSON simples, ou null. */
  function invalidoEmJson_(v, caminho) {
    if (v === null) return null;
    var t = typeof v;
    if (t === 'string' || t === 'boolean') return null;
    if (t === 'number') return isFinite(v) ? null : caminho;
    if (t !== 'object' || Object.prototype.toString.call(v) === '[object Date]') return caminho;
    var achado = null;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length && !achado; i++) achado = invalidoEmJson_(v[i], caminho + '[' + i + ']');
      return achado;
    }
    var chaves = Object.keys(v);
    for (var k = 0; k < chaves.length && !achado; k++) achado = invalidoEmJson_(v[chaves[k]], caminho + '.' + chaves[k]);
    return achado;
  }
  function faixa_(col, valorNaUnidade) {
    if (col.min !== null && (valorNaUnidade < col.min || (col.minExclusivo && valorNaUnidade === col.min))) {
      return problema_(DETALHE.VALOR_FORA_DA_FAIXA, 'Informe um valor ' + (col.minExclusivo ? 'maior que ' : 'a partir de ') + numeroBr_(col.min) + '.');
    }
    if (col.max !== null && (valorNaUnidade > col.max || (col.maxExclusivo && valorNaUnidade === col.max))) {
      return problema_(DETALHE.VALOR_FORA_DA_FAIXA, 'Informe um valor ' + (col.maxExclusivo ? 'menor que ' : 'de até ') + numeroBr_(col.max) + '.');
    }
    return null;
  }
  function decimal_(col, valor, casas) {
    if (typeof valor !== 'number' || !isFinite(valor)) return problema_(DETALHE.TIPO_INVALIDO, 'Informe um número.');
    if (Utils.casasDecimais(valor) > casas) return problema_(DETALHE.FORMATO_INVALIDO, 'Use no máximo ' + casas + (casas === 1 ? ' casa decimal.' : ' casas decimais.'));
    return faixa_(col, valor);
  }
  function enumerado_(col, valor, permitidos) {
    if (col.multi) {
      if (typeof valor !== 'string') return problema_(DETALHE.TIPO_INVALIDO, 'Informe um ou mais códigos separados por vírgula.');
      var partes = valor.split(',');
      for (var i = 0; i < partes.length; i++) {
        if (permitidos.indexOf(partes[i]) < 0) return problema_(DETALHE.VALOR_FORA_DA_LISTA, 'Opção desconhecida: "' + partes[i] + '".');
        if (partes.indexOf(partes[i]) !== i) return problema_(DETALHE.FORMATO_INVALIDO, 'Opção repetida: "' + partes[i] + '".');
      }
      return null;
    }
    if (permitidos.indexOf(valor) < 0) return problema_(DETALHE.VALOR_FORA_DA_LISTA, 'Opção desconhecida: ' + JSON.stringify(valor) + '.');
    return null;
  }
  /**
   * Valida um valor NÃO vazio contra a definição da coluna (Schema.coluna). Devolve null se está certo ou
   * {codigo, mensagem} com o primeiro problema. opcoes: {tetoCelula, registro, permitidos, listas}.
   */
  function validarValor(col, valor, opcoes) {
    var o = opcoes || {};
    var teto = o.tetoCelula || TETO_CELULA;
    var p = null;
    switch (col.tipo) {
      case 'ID':
        if (typeof valor !== 'string') return problema_(DETALHE.TIPO_INVALIDO, 'Identificador inválido.');
        if (!RE_UUID.test(valor)) return problema_(DETALHE.FORMATO_INVALIDO, 'Identificador inválido.');
        return null;
      case 'TEXTO':
        if (typeof valor !== 'string') return problema_(DETALHE.TIPO_INVALIDO, 'Informe um texto.');
        if (valor.length > teto) return problema_(DETALHE.TEXTO_LONGO_DEMAIS, 'Texto longo demais: ' + valor.length + ' caracteres (o limite é ' + teto + ').');
        if (col.enum) return enumerado_(col, valor, o.permitidos || Schema.enumValores(col.enum));
        if (col.lista && o.listas && Object.prototype.hasOwnProperty.call(o.listas, col.lista) && o.listas[col.lista].indexOf(valor) < 0) {
          return problema_(DETALHE.VALOR_FORA_DA_LISTA, 'Opção desconhecida: "' + valor + '".');
        }
        return null;
      case 'DATA':
        if (typeof valor !== 'string') return problema_(DETALHE.TIPO_INVALIDO, 'Informe uma data.');
        if (!Utils.dataValida(valor)) return problema_(DETALHE.FORMATO_INVALIDO, 'Data inválida.');
        return null;
      case 'TS':
        if (typeof valor !== 'string') return problema_(DETALHE.TIPO_INVALIDO, 'Informe data e hora.');
        if (!Utils.instanteValido(valor)) return problema_(DETALHE.FORMATO_INVALIDO, 'Data e hora inválidas.');
        return null;
      case 'INT':
        if (typeof valor !== 'number' || !isFinite(valor)) return problema_(DETALHE.TIPO_INVALIDO, 'Informe um número inteiro.');
        if (!ehInteiroSeguro_(valor)) return problema_(DETALHE.FORMATO_INVALIDO, 'Informe um número inteiro, sem casas decimais.');
        if (col.enum) return enumerado_(col, valor, o.permitidos || Schema.enumValores(col.enum));
        return faixa_(col, valor);
      case 'DEC1':
        return decimal_(col, valor, 1);
      case 'DEC4':
        return decimal_(col, valor, 4);
      case 'DINHEIRO':
        if (typeof valor !== 'number' || !isFinite(valor)) return problema_(DETALHE.TIPO_INVALIDO, 'Informe um valor em reais.');
        if (!ehInteiroSeguro_(valor)) return problema_(DETALHE.FORMATO_INVALIDO, 'Valor em reais com mais de duas casas decimais.');
        if (Math.abs(valor) > Utils.CENTAVOS_MAX) return problema_(DETALHE.VALOR_FORA_DA_FAIXA, 'Valor em reais grande demais: o limite é R$ 9.999.999.999.999,99.');
        p = faixa_(col, valor / 100);
        return p ? problema_(p.codigo, p.mensagem.replace('Informe um valor ', 'Informe um valor em reais ')) : null;
      case 'BOOL':
        if (typeof valor !== 'boolean') return problema_(DETALHE.TIPO_INVALIDO, 'Informe sim ou não.');
        return null;
      case 'ENUM':
        if (typeof valor !== 'string') return problema_(DETALHE.TIPO_INVALIDO, 'Escolha uma das opções.');
        return enumerado_(col, valor, o.permitidos || Schema.enumValores(col.enum));
      case 'JSON':
        if (typeof valor !== 'object') return problema_(DETALHE.TIPO_INVALIDO, 'Conteúdo estruturado inválido.');
        var ruim = invalidoEmJson_(valor, col.nome);
        if (ruim) return problema_(DETALHE.TIPO_INVALIDO, 'Conteúdo estruturado inválido em ' + ruim + '.');
        var tamanho = JSON.stringify(valor).length;
        if (tamanho > teto) return problema_(DETALHE.TEXTO_LONGO_DEMAIS, 'Conteúdo grande demais: ' + tamanho + ' caracteres (o limite é ' + teto + ').');
        return null;
      default:
        throw new Error('Validation: tipo de coluna desconhecido: ' + col.tipo);
    }
  }
  /**
   * Valida um registro (forma da lógica) contra a definição da aba. Devolve a lista de detalhes (vazia = certo).
   * opcoes:
   *   parcial        só os campos presentes no registro (edição de cadastro); o padrão exige os obrigatórios;
   *   semProjecoes   não exige coluna `*` obrigatória (linha da fase A, antes de a fase C projetar);
   *   tetoCelula     teto de caracteres por célula (padrão 40.000; CONFIGURACOES.json_celula_max_caracteres);
   *   listas         {LISTA: [códigos aceitos]} para conferir colunas ligadas a lista aberta;
   *   animal_id, brinco   copiados para cada detalhe, quando o registro é de um animal.
   * Coluna obrigatória "COND" depende de regra do tipo de evento e não é exigida aqui.
   */
  function validarRegistro(nomeTabela, registro, opcoes) {
    var o = opcoes || {};
    var def = Schema.tabela(nomeTabela);
    var detalhes = [];
    function anota(campo, prob) {
      detalhes.push(detalhe({ codigo: prob.codigo, campo: campo, mensagem: prob.mensagem, animal_id: o.animal_id, brinco: o.brinco }));
    }
    if (!registro || typeof registro !== 'object' || Array.isArray(registro)) throw new Error('Validation: registro de ' + nomeTabela + ' inválido.');
    Object.keys(registro).forEach(function (k) {
      if (!Schema.temColuna(nomeTabela, k)) anota(k, problema_(DETALHE.CAMPO_DESCONHECIDO, 'Campo desconhecido: ' + k + '.'));
    });
    def.colunas.forEach(function (col) {
      var presente = Object.prototype.hasOwnProperty.call(registro, col.nome);
      if (o.parcial && !presente) return;
      var valor = registro[col.nome];
      if (vazio_(valor)) {
        if (col.obrig === 'S' && !(o.semProjecoes && col.marca === 'PROJECAO')) anota(col.nome, problema_(DETALHE.CAMPO_OBRIGATORIO, 'Campo obrigatório.'));
        return;
      }
      var permitidos = col.enum ? Schema.valoresDaColuna(nomeTabela, col.nome, registro) : null;
      var prob = validarValor(col, valor, { tetoCelula: o.tetoCelula, permitidos: permitidos, listas: o.listas });
      if (prob) anota(col.nome, prob);
    });
    return detalhes;
  }
  /** Como validarRegistro, mas lança AppError VALIDATION com os detalhes quando há problema. */
  function exigirRegistro(nomeTabela, registro, opcoes) {
    var detalhes = validarRegistro(nomeTabela, registro, opcoes);
    if (detalhes.length) {
      throw new AppError('VALIDATION', detalhes.length === 1 ? 'Há 1 campo com problema.' : 'Há ' + detalhes.length + ' campos com problema.', detalhes);
    }
  }
  /** Confere o teto de caracteres de um texto que vai para uma célula; devolve null ou {codigo, mensagem}. */
  function validarTeto(texto, tetoCelula) {
    var teto = tetoCelula || TETO_CELULA;
    var n = vazio_(texto) ? 0 : String(texto).length;
    return n > teto ? problema_(DETALHE.TEXTO_LONGO_DEMAIS, 'Texto longo demais: ' + n + ' caracteres (o limite é ' + teto + ').') : null;
  }
  /**
   * Coletor {erros, avisos} de uma validação. erro(d) e aviso(d) recebem um detalhe; lancarSeErros(mensagem)
   * lança VALIDATION com todos os erros acumulados (erro em qualquer animal rejeita tudo).
   */
  function coletor() {
    var erros = [];
    var avisos = [];
    return {
      erros: erros,
      avisos: avisos,
      erro: function (d) { erros.push(detalhe(d)); },
      aviso: function (d) { avisos.push(detalhe(d)); },
      temErros: function () { return erros.length > 0; },
      lancarSeErros: function (mensagem) {
        if (erros.length) throw new AppError('VALIDATION', mensagem || (erros.length === 1 ? 'Há 1 problema a corrigir.' : 'Há ' + erros.length + ' problemas a corrigir.'), erros);
      },
    };
  }

  return {
    CODIGOS: CODIGOS,
    DETALHE: DETALHE,
    TETO_CELULA: TETO_CELULA,
    AppError: AppError,
    erro: erro,
    ehAppError: ehAppError,
    serializarErro: serializarErro,
    detalhe: detalhe,
    validarValor: validarValor,
    validarRegistro: validarRegistro,
    exigirRegistro: exigirRegistro,
    validarTeto: validarTeto,
    coletor: coletor,
  };
})();
