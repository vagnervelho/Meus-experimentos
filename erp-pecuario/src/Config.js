/**
 * Config — parâmetros de CONFIGURACOES tipados, com o padrão do código (Schema.SEMENTES), e os comandos de
 * configuração sem evento: `config.salvar`, `lista.salvar`, `categoria.salvar` e `parceiro.salvar`
 * (03a, seções 4.5, 4.8, 4.11 e 4.12; 05, seção 2.14). Toda leitura de parâmetro passa por aqui.
 *
 * Os comandos só validam e põem mudanças no plano (AuditService); quem grava é a UnitOfWork (AUDITORIA = registro
 * de refazer). Puro: não usa serviço do Apps Script.
 */
var Config = (function () {
  /** Os 13 códigos de aviso (05, seção 1): as chaves aceitas em `avisos_politica`. */
  var CODIGOS_AVISO = ['CARENCIA_ATIVA', 'POSSIVEL_DUPLICIDADE', 'BRINCO_PARECIDO', 'LOTACAO_ACIMA_DA_CAPACIDADE',
    'PESO_IMPLAUSIVEL', 'IDADE_REPRODUTIVA', 'PERIODO_BLOQUEADO', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO',
    'INTERVALO_PARTO_CURTO', 'PRODUTO_VENCIDO', 'ESTOQUE_INSUFICIENTE', 'CATEGORIAS_SEM_COBERTURA'];
  /** Teto de caracteres de uma célula do Google Sheets. */
  var TETO_SHEETS = 50000;
  /**
   * Faixa de cada parâmetro numérico (RN-100). São limites de sentido (inteiro, positivo, percentual), não
   * recomendações técnicas: os valores zootécnicos são do dono (PR-15).
   */
  var FAIXAS = {
    itens_por_pagina: { inteiro: true, min: 1, max: 500 },
    ua_peso_kg: { minExc: 0 },
    arroba_kg: { minExc: 0 },
    rendimento_carcaca_padrao_pct: { minExc: 0, maxExc: 100 },
    dias_gestacao: { inteiro: true, min: 1 },
    idade_min_reprodutiva_meses: { inteiro: true, min: 0 },
    idade_desmama_padrao_meses: { inteiro: true, min: 0 },
    peso_validade_dias: { inteiro: true, min: 1 },
    gmd_intervalo_min_dias: { inteiro: true, min: 1 },
    gmd_plausivel_min_kg_dia: {},
    gmd_plausivel_max_kg_dia: {},
    gmd_referencia_janela_dias: { inteiro: true, min: 1 },
    projecao_peso_horizonte_dias: { inteiro: true, min: 0 },
    peso_nascer_padrao_kg_macho: { minExc: 0, max: 2000 },
    peso_nascer_padrao_kg_femea: { minExc: 0, max: 2000 },
    parto_tolerancia_dias: { inteiro: true, min: 0 },
    prenhez_cobertura_dg_min_pct: { min: 0, max: 100 },
    indicador_n_minimo: { inteiro: true, min: 1 },
    agenda_antecedencia_dias: { inteiro: true, min: 0 },
    agenda_tolerancia_dias: { inteiro: true, min: 0 },
    fin_tolerancia_conferencia_pct: { min: 0, max: 100 },
    caixa_saldo_inicial: { casas: 2 },
    patrimonio_valor_manual_validade_dias: { inteiro: true, min: 1 },
    alerta_sem_pesagem_dias: { inteiro: true, min: 1 },
    alerta_parto_previsto_dias: { inteiro: true, min: 0 },
    alerta_prenhez_vencida_dias: { inteiro: true, min: 0 },
    alerta_parcela_a_vencer_dias: { inteiro: true, min: 0 },
    alerta_backup_atrasado_dias: { inteiro: true, min: 1 },
    backup_retencao_diarios: { inteiro: true, min: 1 },
    backup_retencao_mensais: { inteiro: true, min: 1 },
    importacao_lote_linhas: { inteiro: true, min: 1, max: 1000 },
    json_celula_max_caracteres: { inteiro: true, min: 1000, max: TETO_SHEETS },
    arquivamento_limiar_linhas: { inteiro: true, min: 1000 },
  };
  /** Parâmetros que entram nas projeções de ANIMAIS: mudá-los reconstrói todas na fase C. */
  var AFETAM_PROJECOES = ['idade_desmama_padrao_meses', 'data_marco_zero'];
  var CAMPOS_LISTA = ['rotulo', 'ordem', 'ativo'];
  var CAMPOS_CATEGORIA = ['codigo', 'nome', 'sexo_aplicavel', 'idade_minima_meses', 'idade_maxima_meses', 'condicao',
    'peso_referencia_kg', 'prioridade', 'descricao', 'ativo'];
  var CONDICOES_MACHO = ['CASTRADO', 'INTEIRO', 'REPRODUTOR', 'NAO_REPRODUTOR'];
  var CONDICOES_FEMEA = ['PARIDA', 'NAO_PARIDA'];
  var CAMPOS_PARCEIRO = ['nome', 'tipos', 'documento', 'telefone', 'endereco', 'observacoes', 'ativo'];
  var sementesPorChave_ = null;

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function nulo_(v) {
    return vazio_(v) ? null : v;
  }
  function interno_(mensagem) {
    return Validation.erro('INTERNAL', mensagem);
  }
  function semente_(chave) {
    if (!sementesPorChave_) sementesPorChave_ = Utils.indexarPor(Schema.SEMENTES.CONFIGURACOES, 'chave');
    return Object.prototype.hasOwnProperty.call(sementesPorChave_, chave) ? sementesPorChave_[chave] : null;
  }
  function ehObjeto_(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }
  /** Código estável a partir de um texto: MAIÚSCULAS ASCII, dígitos e "_" ("Pé-duro" → "PE_DURO"). */
  function codigoDe_(texto) {
    return Utils.normalizarTexto(texto).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  // ------------------------------------------------------------------ leitura tipada ----
  /** Texto da célula → valor do tipo. Célula vazia = parâmetro não informado (null). Inválido → CONFIG. */
  function converter_(s, texto) {
    if (vazio_(texto)) return null;
    var t = String(texto).trim();
    if (s.tipo === 'NUMERO') {
      var n = Number(t);
      if (t === '' || !isFinite(n)) throw Validation.erro('CONFIG', 'O parâmetro "' + s.chave + '" precisa ser um número (está "' + t + '").');
      return n;
    }
    if (s.tipo === 'BOOL') {
      if (t !== 'S' && t !== 'N') throw Validation.erro('CONFIG', 'O parâmetro "' + s.chave + '" precisa ser S ou N (está "' + t + '").');
      return t === 'S';
    }
    if (s.tipo === 'JSON') {
      try {
        return JSON.parse(t);
      } catch (e) {
        throw Validation.erro('CONFIG', 'O parâmetro "' + s.chave + '" não é um JSON válido.');
      }
    }
    if (s.formato === 'DATA' && !Utils.dataValida(t)) throw Validation.erro('CONFIG', 'O parâmetro "' + s.chave + '" precisa ser uma data (aaaa-mm-dd).');
    return t;
  }
  /**
   * Todos os parâmetros tipados ({chave: valor}): NUMERO → número, BOOL → booleano, JSON → objeto, TEXTO → texto
   * (data validada). Chave ausente na aba (ou aba não lida) = padrão do código; célula vazia = null; inválido → CONFIG.
   */
  function parametros(repo) {
    var out = {};
    var carregada = !!repo && repo.carregada('CONFIGURACOES');
    Schema.SEMENTES.CONFIGURACOES.forEach(function (s) {
      var linha = carregada ? repo.porId('CONFIGURACOES', s.chave) : null;
      out[s.chave] = converter_(s, linha ? linha.valor : s.padrao);
    });
    return out;
  }
  /** Um parâmetro tipado. Chave desconhecida → INTERNAL (erro de programação). */
  function valor(repo, chave) {
    var s = semente_(chave);
    if (!s) throw interno_('Parâmetro desconhecido: ' + chave + '.');
    var linha = repo && repo.carregada('CONFIGURACOES') ? repo.porId('CONFIGURACOES', chave) : null;
    return converter_(s, linha ? linha.valor : s.padrao);
  }
  /**
   * Parâmetros para a tela de configurações, sem lançar por um valor ruim:
   * {itens: [{chave, grupo, tipo, formato, descricao, padrao, texto, valor, origem, erro, faixa}], desconhecidas}.
   * `origem` = PLANILHA ou PADRAO (chave ainda não inserida pelo setup); `desconhecidas` = chaves da aba que o
   * código não conhece (ignoradas).
   */
  function listar(repo) {
    var carregada = !!repo && repo.carregada('CONFIGURACOES');
    var itens = Schema.SEMENTES.CONFIGURACOES.map(function (s) {
      var linha = carregada ? repo.porId('CONFIGURACOES', s.chave) : null;
      var texto = linha ? nulo_(linha.valor) : nulo_(s.padrao);
      var item = {
        chave: s.chave, grupo: s.grupo, tipo: s.tipo, formato: s.formato || null, descricao: s.descricao, padrao: nulo_(s.padrao),
        texto: texto, valor: null, origem: linha ? 'PLANILHA' : 'PADRAO', erro: null, faixa: FAIXAS[s.chave] ? Utils.clonar(FAIXAS[s.chave]) : null,
      };
      try {
        item.valor = converter_(s, texto);
      } catch (e) {
        if (!Validation.ehAppError(e)) throw e;
        item.erro = e.message;
      }
      return item;
    });
    var desconhecidas = carregada ? repo.vigentes('CONFIGURACOES').filter(function (l) { return !semente_(l.chave); }).map(function (l) { return l.chave; }) : [];
    return { itens: itens, desconhecidas: desconhecidas, codigos_aviso: CODIGOS_AVISO.slice(), politicas: ['BLOQUEIA', 'AVISA', 'IGNORA'] };
  }

  // ------------------------------------------------------------------ validação de valor ----
  function erroValor_(codigo, mensagem) {
    return { erro: { codigo: codigo, mensagem: mensagem } };
  }
  function numero_(bruto) {
    if (typeof bruto === 'number') return bruto;
    var t = String(bruto).trim();
    if (t.indexOf(',') >= 0 && t.indexOf('.') < 0) t = t.replace(',', '.');
    return t === '' ? NaN : Number(t);
  }
  function conferirFaixa_(s, n) {
    var f = FAIXAS[s.chave] || {};
    var nome = '"' + s.descricao + '"';
    if (f.inteiro && Math.floor(n) !== n) return erroValor_('VALOR_FORA_DA_FAIXA', nome + ' precisa ser um número inteiro.');
    if (f.min !== undefined && n < f.min) return erroValor_('VALOR_FORA_DA_FAIXA', nome + ' não pode ser menor que ' + f.min + '.');
    if (f.minExc !== undefined && n <= f.minExc) return erroValor_('VALOR_FORA_DA_FAIXA', nome + ' precisa ser maior que ' + f.minExc + '.');
    if (f.max !== undefined && n > f.max) return erroValor_('VALOR_FORA_DA_FAIXA', nome + ' não pode passar de ' + f.max + '.');
    if (f.maxExc !== undefined && n >= f.maxExc) return erroValor_('VALOR_FORA_DA_FAIXA', nome + ' precisa ser menor que ' + f.maxExc + '.');
    if (f.casas !== undefined && Utils.casasDecimais(n) > f.casas) return erroValor_('VALOR_FORA_DA_FAIXA', nome + ' aceita até ' + f.casas + ' casas decimais.');
    return null;
  }
  function conferirJson_(s, v) {
    if (s.chave === 'faixas_etarias_meses') {
      if (!Array.isArray(v) || !v.length) return 'informe uma lista de idades em meses, por exemplo [12, 24, 36].';
      for (var i = 0; i < v.length; i++) {
        if (typeof v[i] !== 'number' || Math.floor(v[i]) !== v[i] || v[i] <= 0) return 'cada corte precisa ser um número inteiro de meses, maior que zero.';
        if (i > 0 && v[i] <= v[i - 1]) return 'os cortes precisam estar em ordem crescente, sem repetir.';
      }
      return null;
    }
    if (s.chave === 'avisos_politica') {
      if (!ehObjeto_(v)) return 'informe um mapa de código do aviso para BLOQUEIA, AVISA ou IGNORA.';
      var politicas = Schema.VOCABULARIOS.POLITICA_AVISO;
      var ruins = Object.keys(v).filter(function (k) { return CODIGOS_AVISO.indexOf(k) < 0; });
      if (ruins.length) return 'aviso desconhecido: ' + ruins.join(', ') + '.';
      var valores = Object.keys(v).filter(function (k) { return politicas.indexOf(v[k]) < 0; });
      if (valores.length) return 'use BLOQUEIA, AVISA ou IGNORA (em ' + valores.join(', ') + ').';
      return null;
    }
    return null;
  }
  /**
   * Valor recebido da tela → {texto (célula), valor (tipado)} ou {erro: {codigo, mensagem}}. Confere tipo e faixa
   * (RN-100). Vazio só é aceito em parâmetro sem padrão (opcional). Regras que dependem de outros dados (fuso,
   * propriedade padrão, marco zero) ficam no comando.
   */
  function normalizar(chave, bruto) {
    var s = semente_(chave);
    if (!s) return erroValor_('CHAVE_DESCONHECIDA', 'O parâmetro "' + chave + '" não existe.');
    var nome = '"' + s.descricao + '"';
    if (vazio_(bruto) || (typeof bruto === 'string' && bruto.trim() === '')) {
      if (!vazio_(s.padrao)) return erroValor_('CAMPO_OBRIGATORIO', nome + ' precisa de um valor (o padrão é ' + s.padrao + ').');
      return { texto: null, valor: null };
    }
    if (s.tipo === 'NUMERO') {
      var n = numero_(bruto);
      if (typeof n !== 'number' || !isFinite(n)) return erroValor_('TIPO_INVALIDO', nome + ' precisa ser um número.');
      var f = conferirFaixa_(s, n);
      return f || { texto: String(n), valor: n };
    }
    if (s.tipo === 'BOOL') {
      if (bruto === true || bruto === 'S') return { texto: 'S', valor: true };
      if (bruto === false || bruto === 'N') return { texto: 'N', valor: false };
      return erroValor_('TIPO_INVALIDO', nome + ' precisa ser Sim (S) ou Não (N).');
    }
    if (s.tipo === 'JSON') {
      var v = bruto;
      if (typeof bruto === 'string') {
        try {
          v = JSON.parse(bruto);
        } catch (e) {
          return erroValor_('FORMATO_INVALIDO', nome + ': o texto não está no formato esperado.');
        }
      }
      var problema = conferirJson_(s, v);
      if (problema) return erroValor_('FORMATO_INVALIDO', nome + ': ' + problema);
      var texto = Utils.jsonCanonico(v);
      return { texto: texto, valor: JSON.parse(texto) };
    }
    if (typeof bruto !== 'string') return erroValor_('TIPO_INVALIDO', nome + ' precisa ser um texto.');
    var t = Utils.aparar(bruto);
    if (s.formato === 'DATA' && !Utils.dataValida(t)) return erroValor_('FORMATO_INVALIDO', nome + ' precisa ser uma data válida (aaaa-mm-dd).');
    if (s.chave === 'unidade_peso_exibicao' && Schema.VOCABULARIOS.UNIDADE_PESO_EXIBICAO.indexOf(t) < 0) return erroValor_('VALOR_FORA_DA_LISTA', nome + ': use KG ou ARROBA.');
    return { texto: t, valor: t };
  }
  /**
   * Põe no plano a gravação de um parâmetro (texto de célula já normalizado): alteração auditada da linha que
   * existe ou criação da linha que ainda falta (com tipo, grupo e descrição da semente). Devolve nº de mudanças.
   */
  function planejarTexto_(tx, s, texto, justificativa) {
    var linha = tx.repo.porId('CONFIGURACOES', s.chave);
    if (linha) return AuditService.alteracao(tx, 'CONFIGURACOES', s.chave, { valor: texto }, justificativa);
    return AuditService.criacao(tx, 'CONFIGURACOES', s.chave, { valor: texto, tipo: s.tipo, grupo: s.grupo, descricao: s.descricao }, justificativa);
  }
  /**
   * Para outros comandos (ex.: a primeira propriedade vira a padrão): normaliza e põe no plano um parâmetro.
   * A aba CONFIGURACOES precisa estar nas leituras do comando. Valor inválido → VALIDATION.
   */
  function planejarParametro(tx, chave, bruto, justificativa) {
    var r = normalizar(chave, bruto);
    if (r.erro) throw Validation.erro('VALIDATION', r.erro.mensagem, [Validation.detalhe({ codigo: r.erro.codigo, campo: chave, mensagem: r.erro.mensagem })]);
    return planejarTexto_(tx, semente_(chave), r.texto, justificativa);
  }
  /** Política de avisos (`avisos_politica`): BLOQUEIA vira erro no coletor, IGNORA some, AVISA fica. */
  function aplicarPolitica(params, avisos, col) {
    var pol = (params && params.avisos_politica) || {};
    return (avisos || []).filter(function (a) {
      var p = pol[a.codigo] || 'AVISA';
      if (p === 'BLOQUEIA') col.erro(Validation.bloqueado(a));
      return p === 'AVISA';
    });
  }

  // ------------------------------------------------------------------ config.salvar ----
  function itensDe_(repo, chaves) {
    var l = listar(repo).itens;
    return l.filter(function (i) { return chaves.indexOf(i.chave) >= 0; });
  }
  /**
   * Comando `config.salvar`. dados: {valores: {chave: valor}, justificativa?}. Vários parâmetros numa operação.
   * Regras: chave conhecida, tipo e faixa (RN-100); fuso IANA válido; propriedade padrão existente e ativa; marco
   * zero não futuro e imutável enquanto houver evento vigente com efeito de inventário (RN-101, CONFLICT);
   * limite mínimo do GMD plausível menor que o máximo. Resposta: os itens alterados, na forma de `listar`.
   */
  function comandoSalvar(pedido) {
    var p = pedido || {};
    return {
      rota: 'config.salvar', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, reads: ['CONFIGURACOES', 'PROPRIEDADES', 'EVENTO_ANIMAIS', 'EVENTOS'],
      tratador: function (tx) {
        var d = tx.dados || {};
        var valores = d.valores;
        if (!ehObjeto_(valores) || !Object.keys(valores).length) {
          return { erros: [Validation.detalhe({ codigo: 'CAMPO_OBRIGATORIO', campo: 'valores', mensagem: 'Informe ao menos um parâmetro para salvar.' })] };
        }
        var col = Validation.coletor();
        var atual = parametros(tx.repo);
        var final = Utils.clonar(atual);
        var mudar = [];
        Object.keys(valores).forEach(function (chave) {
          var r = normalizar(chave, valores[chave]);
          if (r.erro) { col.erro({ codigo: r.erro.codigo, campo: chave, mensagem: r.erro.mensagem }); return; }
          var s = semente_(chave);
          if (chave === 'fuso') {
            try {
              Utils.hoje(tx.agora, r.texto);
            } catch (e) {
              if (!Validation.ehAppError(e)) throw e;
              col.erro({ codigo: 'FORMATO_INVALIDO', campo: chave, mensagem: '"' + r.texto + '" não é um fuso horário conhecido (exemplo: America/Porto_Velho).' });
              return;
            }
          }
          if (chave === 'propriedade_padrao_id' && r.texto !== null) {
            var prop = tx.repo.porId('PROPRIEDADES', r.texto);
            if (!prop) { col.erro({ codigo: 'NAO_ENCONTRADO', campo: chave, mensagem: 'A propriedade escolhida como padrão não existe.' }); return; }
            if (prop.status !== 'ATIVO') { col.erro({ codigo: 'PROPRIEDADE_INATIVA', campo: chave, mensagem: 'A propriedade ' + prop.nome + ' está desativada e não pode ser a padrão.' }); return; }
          }
          if (chave === 'data_marco_zero' && r.texto !== null && r.texto > tx.hoje) {
            col.erro({ codigo: 'DATA_FUTURA', campo: chave, mensagem: 'O marco zero é o dia do inventário inicial e não pode ser uma data que ainda não chegou.' });
            return;
          }
          var linha = tx.repo.porId('CONFIGURACOES', chave);
          if (linha && JSON.stringify(atual[chave]) === JSON.stringify(r.valor)) return;
          final[chave] = r.valor;
          mudar.push({ s: s, texto: r.texto, muda: JSON.stringify(atual[chave]) !== JSON.stringify(r.valor) });
        });
        if (typeof final.gmd_plausivel_min_kg_dia === 'number' && typeof final.gmd_plausivel_max_kg_dia === 'number' && final.gmd_plausivel_min_kg_dia >= final.gmd_plausivel_max_kg_dia) {
          col.erro({ codigo: 'FAIXA_INVALIDA', campo: 'gmd_plausivel_min_kg_dia', mensagem: 'O ganho diário mínimo plausível precisa ser menor que o máximo.' });
        }
        if (col.temErros()) return { erros: col.erros };
        var marco = mudar.filter(function (m) { return m.s.chave === 'data_marco_zero' && m.muda; })[0];
        if (marco) {
          var comEfeito = tx.repo.vigentes('EVENTO_ANIMAIS').filter(function (l) { return l.efeito_inventario === 1 || l.efeito_inventario === -1; });
          if (comEfeito.length) {
            var ev = tx.repo.porId('EVENTOS', comEfeito[0].event_id) || {};
            throw Validation.erro('CONFLICT', 'O marco zero não pode mudar: já há entradas e saídas de animais lançadas a partir dele (' + Timeline.dataBr(atual.data_marco_zero) + '). Estorne-as antes de trocar a data.', [
              Validation.detalhe({ codigo: 'MARCO_ZERO_EM_USO', campo: 'data_marco_zero', mensagem: 'Há ' + comEfeito.length + ' movimentos de inventário lançados.', conflito: { event_id: ev.event_id || null, tipo: ev.event_type || null, data: ev.event_date || null } }),
            ]);
          }
        }
        mudar.forEach(function (m) { planejarTexto_(tx, m.s, m.texto, d.justificativa); });
        var chaves = mudar.map(function (m) { return m.s.chave; });
        var projeta = chaves.some(function (c) { return AFETAM_PROJECOES.indexOf(c) >= 0; });
        return {
          resumo: { chaves: chaves },
          derivados: projeta ? { tudo: true } : null,
          resposta: function (t) { return { chaves: chaves, itens: itensDe_(t.repo, chaves) }; },
        };
      },
      reconstruir: function (tx, op) {
        var chaves = (op.resumo && op.resumo.chaves) || [];
        return { chaves: chaves, itens: itensDe_(tx.repo, chaves) };
      },
    };
  }

  // ------------------------------------------------------------------ lista.salvar ----
  function reservado_(lista, codigo) {
    var sem = Schema.LISTAS_SEMENTE[lista] || [];
    return sem.some(function (x) { return x.codigo === codigo && x.reservado === true; });
  }
  /**
   * Comando `lista.salvar`. dados: {lista_id?, lista, codigo?, rotulo, ordem?, ativo?, justificativa?}.
   * Criação: lista do enum NOME_LISTA; código em MAIÚSCULAS ASCII (derivado do rótulo se vier vazio), único na
   * lista; ordem padrão = última + 10; ativo padrão S. Edição: só rótulo, ordem e ativo (lista e código são
   * imutáveis, RN-102); código reservado não pode ser desativado. Resposta: o item gravado.
   */
  function comandoSalvarLista(pedido) {
    var p = pedido || {};
    return {
      rota: 'lista.salvar', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, reads: ['LISTAS'],
      tratador: function (tx) {
        var d = tx.dados || {};
        var col = Validation.coletor();
        var id = d.lista_id;
        var atual = vazio_(id) ? null : tx.repo.porId('LISTAS', id);
        if (!vazio_(id) && !atual) throw Validation.erro('NOT_FOUND', 'O item da lista não existe mais. Atualize a tela e tente de novo.');
        var campos = {};
        CAMPOS_LISTA.forEach(function (c) { if (d[c] !== undefined) campos[c] = d[c]; });
        if (typeof campos.rotulo === 'string') campos.rotulo = Utils.aparar(campos.rotulo);
        if (atual) {
          if (!vazio_(d.lista) && d.lista !== atual.lista) col.erro({ codigo: 'CAMPO_IMUTAVEL', campo: 'lista', mensagem: 'Um item não muda de lista; crie um item novo na outra lista.' });
          if (!vazio_(d.codigo) && d.codigo !== atual.codigo) col.erro({ codigo: 'CAMPO_IMUTAVEL', campo: 'codigo', mensagem: 'O código de um item não muda depois de criado (já pode estar gravado nos registros); mude só o nome exibido.' });
          if (campos.ativo === false && atual.ativo !== false && reservado_(atual.lista, atual.codigo)) col.erro({ codigo: 'CODIGO_RESERVADO', campo: 'ativo', mensagem: '"' + atual.rotulo + '" é usado pelo sistema e não pode ser desativado.' });
          if (campos.rotulo !== undefined && vazio_(campos.rotulo)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'rotulo', mensagem: 'Informe o nome exibido do item.' });
          Validation.validarRegistro('LISTAS', campos, { parcial: true }).forEach(function (x) { col.erro(x); });
          if (col.temErros()) return { erros: col.erros };
          AuditService.alteracao(tx, 'LISTAS', id, campos, d.justificativa);
          return resultadoLista_(id);
        }
        if (vazio_(d.lista) || Schema.enumValores('NOME_LISTA').indexOf(d.lista) < 0) col.erro({ codigo: 'VALOR_FORA_DA_LISTA', campo: 'lista', mensagem: 'Escolha a lista a que o item pertence.' });
        if (vazio_(campos.rotulo)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'rotulo', mensagem: 'Informe o nome exibido do item.' });
        var codigo = vazio_(d.codigo) ? (vazio_(campos.rotulo) ? '' : codigoDe_(campos.rotulo)) : String(d.codigo).trim();
        if (!vazio_(campos.rotulo) && !/^[A-Z0-9_]+$/.test(codigo)) col.erro({ codigo: 'FORMATO_INVALIDO', campo: 'codigo', mensagem: 'O código usa só letras maiúsculas sem acento, números e "_" (exemplo: NELORE).' });
        if (col.temErros()) return { erros: col.erros };
        var daLista = tx.repo.por('LISTAS', 'lista', d.lista);
        if (daLista.some(function (x) { return x.codigo === codigo; })) col.erro({ codigo: 'CODIGO_REPETIDO', campo: 'codigo', mensagem: 'A lista já tem um item com o código ' + codigo + '. Reative ou renomeie o que existe.' });
        var maior = Utils.maximo(daLista, 'ordem');
        var reg = { lista: d.lista, codigo: codigo, rotulo: campos.rotulo, ordem: campos.ordem === undefined || campos.ordem === null ? (maior === null ? 10 : maior + 10) : campos.ordem, ativo: campos.ativo === undefined || campos.ativo === null ? true : campos.ativo };
        Validation.validarRegistro('LISTAS', reg, { parcial: true }).forEach(function (x) { col.erro(x); });
        if (col.temErros()) return { erros: col.erros };
        var novo = tx.novoId();
        AuditService.criacao(tx, 'LISTAS', novo, reg, d.justificativa);
        return resultadoLista_(novo);
      },
      reconstruir: function (tx, op) { return Utils.clonar(tx.repo.porId('LISTAS', op.resumo.lista_id)); },
    };
  }
  function resultadoLista_(id) {
    return { resumo: { lista_id: id }, resposta: function (t) { return Utils.clonar(t.repo.porId('LISTAS', id)); } };
  }

  // ------------------------------------------------------------------ categoria.salvar ----
  function rotuloLacuna_(l) {
    return l.rotulo + ' de ' + l.idade_de + (l.idade_ate === null ? ' meses em diante' : ' a ' + l.idade_ate + ' meses');
  }
  /**
   * Comando `categoria.salvar`. dados: {categorias: [{category_id?, campos}]} (várias numa operação, para trocar
   * faixas sem passar por um estado sem cobertura) ou {category_id?, campos}; justificativa?.
   * Regras: código MAIÚSCULAS ASCII, único e imutável (RN-102; derivado do nome se vier vazio); idade máxima maior
   * que a mínima; condição compatível com o sexo; prioridade única entre as ativas; não desativa categoria com
   * reclassificação manual vigente; cobertura total de sexo × idade × condição (RN-097) — lacuna gera o aviso
   * CATEGORIAS_SEM_COBERTURA (política em `avisos_politica`). Resposta: {categorias, cobertura}.
   */
  function comandoSalvarCategoria(pedido) {
    var p = pedido || {};
    return {
      rota: 'categoria.salvar', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, reads: ['CATEGORIAS', 'ANIMAIS', 'CONFIGURACOES'],
      tratador: function (tx) {
        var d = tx.dados || {};
        var itens = Array.isArray(d.categorias) ? d.categorias : [{ category_id: d.category_id, campos: d.campos }];
        var col = Validation.coletor();
        if (!itens.length) return { erros: [Validation.detalhe({ codigo: 'CAMPO_OBRIGATORIO', campo: 'categorias', mensagem: 'Informe ao menos uma categoria.' })] };
        var todas = tx.repo.vigentes('CATEGORIAS').map(Utils.clonar);
        var porId = Utils.indexarPor(todas, 'category_id');
        var planos = [];
        itens.forEach(function (item, i) {
          var it = item || {};
          var campos = {};
          Object.keys(it.campos || {}).forEach(function (c) {
            if (CAMPOS_CATEGORIA.indexOf(c) < 0) { col.erro({ codigo: 'CAMPO_DESCONHECIDO', campo: c, mensagem: 'A categoria não tem o campo "' + c + '".' }); return; }
            campos[c] = typeof it.campos[c] === 'string' ? Utils.aparar(it.campos[c]) : it.campos[c];
          });
          var atual = vazio_(it.category_id) ? null : porId[it.category_id];
          if (!vazio_(it.category_id) && !atual) throw Validation.erro('NOT_FOUND', 'A categoria não existe mais. Atualize a tela e tente de novo.');
          var quem = atual ? atual.nome : vazio_(campos.nome) ? 'Categoria ' + (i + 1) : campos.nome;
          function erro(codigo, campo, mensagem) { col.erro({ codigo: codigo, campo: campo, mensagem: quem + ': ' + mensagem }); }
          if (atual) {
            if (campos.codigo !== undefined && campos.codigo !== atual.codigo) erro('CAMPO_IMUTAVEL', 'codigo', 'o código não muda depois de criado; mude só o nome.');
            delete campos.codigo;
          } else {
            if (vazio_(campos.codigo) && !vazio_(campos.nome)) campos.codigo = codigoDe_(campos.nome);
            if (vazio_(campos.codigo) || !/^[A-Z0-9_]+$/.test(campos.codigo)) erro('FORMATO_INVALIDO', 'codigo', 'o código usa só letras maiúsculas sem acento, números e "_" (exemplo: GARROTE).');
            if (campos.ativo === undefined || campos.ativo === null) campos.ativo = true;
            ['nome', 'sexo_aplicavel', 'condicao', 'prioridade'].forEach(function (c) { if (vazio_(campos[c])) erro('CAMPO_OBRIGATORIO', c, 'informe "' + c + '".'); });
          }
          Validation.validarRegistro('CATEGORIAS', campos, { parcial: true }).forEach(function (x) { if (!(x.codigo === 'CAMPO_OBRIGATORIO' && vazio_(campos[x.campo]))) erro(x.codigo, x.campo, x.mensagem); });
          var final = Utils.clonar(atual || {});
          Object.keys(campos).forEach(function (c) { final[c] = nulo_(campos[c]); });
          if (typeof final.idade_minima_meses === 'number' && typeof final.idade_maxima_meses === 'number' && final.idade_maxima_meses <= final.idade_minima_meses) {
            erro('FAIXA_INVALIDA', 'idade_maxima_meses', 'a idade máxima (' + final.idade_maxima_meses + ' meses) precisa ser maior que a mínima (' + final.idade_minima_meses + ').');
          } else if (typeof final.idade_maxima_meses === 'number' && final.idade_maxima_meses < 1) {
            erro('FAIXA_INVALIDA', 'idade_maxima_meses', 'a idade máxima não inclui o próprio mês: precisa ser de pelo menos 1 mês (vazio = sem teto).');
          }
          if (typeof final.prioridade === 'number' && final.prioridade < 0) erro('VALOR_FORA_DA_FAIXA', 'prioridade', 'a prioridade é um número a partir de 0 (o menor vale primeiro).');
          if (final.sexo_aplicavel === 'F' && CONDICOES_MACHO.indexOf(final.condicao) >= 0) erro('CONDICAO_INCOMPATIVEL', 'condicao', 'a condição escolhida só vale para machos.');
          if (final.sexo_aplicavel === 'M' && CONDICOES_FEMEA.indexOf(final.condicao) >= 0) erro('CONDICAO_INCOMPATIVEL', 'condicao', 'parida e não parida só valem para fêmeas.');
          if (atual && atual.ativo !== false && final.ativo === false) {
            var emUso = tx.repo.vigentes('ANIMAIS').filter(function (a) { return a.categoria_modo === 'MANUAL' && a.categoria_manual_id === atual.category_id; });
            if (emUso.length) erro('CATEGORIA_EM_USO', 'ativo', emUso.length + ' animal(is) foram reclassificados à mão nesta categoria; mude a categoria deles antes de desativá-la.');
          }
          var id = atual ? atual.category_id : tx.novoId();
          final.category_id = id;
          if (!atual && todas.some(function (c) { return c.codigo === final.codigo; })) erro('CODIGO_REPETIDO', 'codigo', 'já existe uma categoria com o código ' + final.codigo + '.');
          if (atual) todas = todas.map(function (c) { return c.category_id === id ? final : c; });
          else todas.push(final);
          planos.push({ id: id, novo: !atual, campos: campos });
        });
        var ativas = todas.filter(function (c) { return c.ativo !== false; });
        var porPrioridade = Utils.agruparPor(ativas.filter(function (c) { return typeof c.prioridade === 'number'; }), 'prioridade');
        Object.keys(porPrioridade).forEach(function (k) {
          if (porPrioridade[k].length > 1) col.erro({ codigo: 'PRIORIDADE_REPETIDA', campo: 'prioridade', mensagem: 'Duas categorias ativas com a prioridade ' + k + ' (' + porPrioridade[k].map(function (c) { return c.nome; }).join(' e ') + '): a ordem de avaliação ficaria ambígua.' });
        });
        if (col.temErros()) return { erros: col.erros };
        var cobertura = EventService.coberturaCategorias(todas);
        var avisos = [];
        if (!cobertura.completa) {
          avisos.push(Validation.detalhe({ codigo: 'CATEGORIAS_SEM_COBERTURA', campo: 'categorias', mensagem: 'Com estas regras, ' + cobertura.lacunas.length + ' grupo(s) de animais ficam sem categoria: ' + cobertura.lacunas.map(rotuloLacuna_).join('; ') + '. Salvar mesmo assim?' }));
        }
        avisos = aplicarPolitica(parametros(tx.repo), avisos, col);
        if (col.temErros()) return { erros: col.erros };
        planos.forEach(function (pl) {
          if (pl.novo) AuditService.criacao(tx, 'CATEGORIAS', pl.id, pl.campos, d.justificativa);
          else AuditService.alteracao(tx, 'CATEGORIAS', pl.id, pl.campos, d.justificativa);
        });
        var ids = planos.map(function (pl) { return pl.id; });
        return { avisos: avisos, resumo: { category_ids: ids }, resposta: function (t) { return respostaCategorias_(t.repo); } };
      },
      reconstruir: function (tx) { return respostaCategorias_(tx.repo); },
    };
  }
  function respostaCategorias_(repo) {
    var cats = Utils.ordenarPor(repo.vigentes('CATEGORIAS'), 'prioridade').map(Utils.clonar);
    return { categorias: cats, cobertura: EventService.coberturaCategorias(cats) };
  }

  // ------------------------------------------------------------------ parceiro.salvar ----
  function tiposDe_(v) {
    var lista = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
    return Utils.unicos(lista.map(function (t) { return String(t).trim().toUpperCase(); }).filter(function (t) { return t !== ''; })).join(',');
  }
  function soDigitos_(t) {
    return String(t || '').replace(/\D+/g, '');
  }
  /**
   * Comando `parceiro.salvar`. dados: {partner_id?, campos: {nome, tipos (lista ou "A,B"), documento, telefone,
   * endereco, observacoes, ativo}, justificativa?}. Criação exige nome e ao menos um tipo; ativo padrão S.
   * Documento (CPF/CNPJ) repetido em outro parceiro gera o aviso POSSIVEL_DUPLICIDADE (nunca bloqueia).
   * Resposta: o parceiro gravado.
   */
  function comandoSalvarParceiro(pedido) {
    var p = pedido || {};
    return {
      rota: 'parceiro.salvar', idempotencyKey: p.idempotencyKey, dados: p.dados, avisosAceitos: p.avisosAceitos || [],
      dataVersionEsperada: p.dataVersionEsperada, reads: ['PARCEIROS', 'CONFIGURACOES'],
      tratador: function (tx) {
        var d = tx.dados || {};
        var col = Validation.coletor();
        var id = d.partner_id;
        var atual = vazio_(id) ? null : tx.repo.porId('PARCEIROS', id);
        if (!vazio_(id) && !atual) throw Validation.erro('NOT_FOUND', 'O parceiro não existe mais. Atualize a tela e tente de novo.');
        var campos = {};
        Object.keys(d.campos || {}).forEach(function (c) {
          if (CAMPOS_PARCEIRO.indexOf(c) < 0) { col.erro({ codigo: 'CAMPO_DESCONHECIDO', campo: c, mensagem: 'O parceiro não tem o campo "' + c + '".' }); return; }
          var v = d.campos[c];
          campos[c] = c === 'tipos' ? tiposDe_(v) : typeof v === 'string' ? Utils.aparar(v) : v;
        });
        if (!atual) {
          if (campos.ativo === undefined || campos.ativo === null) campos.ativo = true;
          if (vazio_(campos.nome)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'nome', mensagem: 'Informe o nome do parceiro.' });
          if (vazio_(campos.tipos)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'tipos', mensagem: 'Diga o que o parceiro é: fornecedor, comprador, veterinário, transportador, arrendador ou outro.' });
        } else {
          if (campos.nome !== undefined && vazio_(campos.nome)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'nome', mensagem: 'O parceiro precisa de um nome.' });
          if (campos.tipos !== undefined && vazio_(campos.tipos)) col.erro({ codigo: 'CAMPO_OBRIGATORIO', campo: 'tipos', mensagem: 'O parceiro precisa de ao menos um tipo.' });
        }
        Validation.validarRegistro('PARCEIROS', campos, { parcial: true }).forEach(function (x) { if (!(x.codigo === 'CAMPO_OBRIGATORIO' && vazio_(campos[x.campo]))) col.erro(x); });
        if (col.temErros()) return { erros: col.erros };
        var avisos = [];
        var doc = soDigitos_(campos.documento);
        if (doc && (!atual || soDigitos_(atual.documento) !== doc)) {
          var outro = tx.repo.vigentes('PARCEIROS').filter(function (x) { return x.partner_id !== id && soDigitos_(x.documento) === doc; })[0];
          if (outro) avisos.push(Validation.detalhe({ codigo: 'POSSIVEL_DUPLICIDADE', campo: 'documento', mensagem: 'O documento ' + campos.documento + ' já está no cadastro de ' + outro.nome + '. Gravar mesmo assim?' }));
        }
        avisos = aplicarPolitica(parametros(tx.repo), avisos, col);
        if (col.temErros()) return { erros: col.erros };
        var novoId = atual ? id : tx.novoId();
        if (atual) AuditService.alteracao(tx, 'PARCEIROS', novoId, campos, d.justificativa);
        else AuditService.criacao(tx, 'PARCEIROS', novoId, campos, d.justificativa);
        return { avisos: avisos, resumo: { partner_id: novoId }, resposta: function (t) { return Utils.clonar(t.repo.porId('PARCEIROS', novoId)); } };
      },
      reconstruir: function (tx, op) { return Utils.clonar(tx.repo.porId('PARCEIROS', op.resumo.partner_id)); },
    };
  }

  // ------------------------------------------------------------------ cadastros do bootstrap ----
  /**
   * Cadastros pequenos que vão ao cliente na carga inicial (sistema.bootstrap): parâmetros, listas, categorias
   * (com a cobertura), parceiros e o plano de contas (os formulários escolhem a conta de um custo). Abas que a consulta
   * precisa ler: `LEITURAS_CADASTROS`.
   */
  function cadastros(repo) {
    var cats = Utils.ordenarPor(repo.vigentes('CATEGORIAS'), 'prioridade').map(Utils.clonar);
    return {
      configuracoes: listar(repo),
      listas: Utils.ordenarPor(repo.vigentes('LISTAS'), ['lista', 'ordem', 'codigo']).map(Utils.clonar),
      categorias: cats,
      cobertura: EventService.coberturaCategorias(cats),
      parceiros: Utils.ordenarPor(repo.vigentes('PARCEIROS'), 'nome').map(Utils.clonar),
      contas: Utils.ordenarPor(repo.vigentes('PLANO_CONTAS'), ['ordem', 'codigo']).map(Utils.clonar),
    };
  }

  function salvar(ctx, pedido) { return UnitOfWork.run(ctx, comandoSalvar(pedido)); }
  function salvarLista(ctx, pedido) { return UnitOfWork.run(ctx, comandoSalvarLista(pedido)); }
  function salvarCategoria(ctx, pedido) { return UnitOfWork.run(ctx, comandoSalvarCategoria(pedido)); }
  function salvarParceiro(ctx, pedido) { return UnitOfWork.run(ctx, comandoSalvarParceiro(pedido)); }

  return {
    CODIGOS_AVISO: CODIGOS_AVISO,
    FAIXAS: FAIXAS,
    LEITURAS_CADASTROS: ['CONFIGURACOES', 'LISTAS', 'CATEGORIAS', 'PARCEIROS', 'PLANO_CONTAS'],
    parametros: parametros,
    valor: valor,
    listar: listar,
    normalizar: normalizar,
    planejarParametro: planejarParametro,
    aplicarPolitica: aplicarPolitica,
    cadastros: cadastros,
    comandoSalvar: comandoSalvar,
    comandoSalvarLista: comandoSalvarLista,
    comandoSalvarCategoria: comandoSalvarCategoria,
    comandoSalvarParceiro: comandoSalvarParceiro,
    salvar: salvar,
    salvarLista: salvarLista,
    salvarCategoria: salvarCategoria,
    salvarParceiro: salvarParceiro,
  };
})();
