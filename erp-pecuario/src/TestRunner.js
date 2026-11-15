/**
 * TestRunner — testes de nível 2 e base de demonstração (09-plano-de-testes.md, seções 1, 7 e 8; desenho-base 9 e 17).
 *
 * runAcceptanceTests: cria pela Drive API uma planilha temporária ("ERP Pecuário — BASE DE TESTE", pasta Testes, ID em
 * TEST_SPREADSHEET_ID), roda nela o setup e os cenários de aceitação da Fase 1 com os serviços reais — sempre pela
 * Api, com `ambiente: 'TESTE'` —, grava o relatório em JSON na pasta Testes e nunca toca a base real (SPREADSHEET_ID e a
 * versão dela são conferidos no fim). É retomável: perto de 4 minutos para, guarda o cursor e continua na chamada
 * seguinte. Os MESMOS cenários rodam no Node (tests/acceptance.test.js), sobre os fakes do harness. O que só se prova
 * com duas execuções reais (lock disputado) entra por `opcoes.injetar` no Node e fica para a página de concorrência
 * na conta do dono.
 * Com TEST_PLAN = DEMO, gera a base de demonstração (cerca de 300 animais, só pelos comandos) na planilha DEMO.
 * runDiagnostics: os itens do spike (seção 17) com relatório sem dado sensível.
 */
var TestRunner = (function () {
  var PROP_CURSOR = 'TEST_CURSOR';
  var PROP_RESULTADO = 'TEST_RESULTADO:';
  var PROP_PLANO = 'TEST_PLAN';
  var LIMITE_MS = 240000;
  var VERSAO_CURSOR = 1;
  var SITUACAO = Object.freeze({ PASSOU: 'PASSOU', FALHOU: 'FALHOU', NAO_SE_APLICA: 'NAO_SE_APLICA', PENDENTE: 'PENDENTE_NA_CONTA_DO_DONO' });
  var CENARIOS_RESULTADO_MAX = 8000;

  function vazio_(v) {
    return v === null || v === undefined || v === '';
  }
  function texto_(e) {
    return String(e && e.message ? e.message : e);
  }
  /** Falha de verificação de um cenário (vai para o relatório; não é erro do app). */
  function falha_(mensagem) {
    var e = new Error(mensagem);
    e.name = 'FalhaDeAceitacao';
    return e;
  }
  function verificar_(condicao, mensagem) {
    if (!condicao) throw falha_(mensagem);
  }
  function curto_(v, n) {
    var s = typeof v === 'string' ? v : JSON.stringify(v);
    return s === undefined ? 'undefined' : s.length > (n || 160) ? s.slice(0, n || 160) + '…' : s;
  }
  function igual_(obtido, esperado, mensagem) {
    verificar_(JSON.stringify(obtido) === JSON.stringify(esperado), mensagem + ' (esperado ' + curto_(esperado) + '; obtido ' + curto_(obtido) + ')');
  }
  function br_(d) {
    return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
  }
  /** Sorteio determinístico (mulberry32): a base de demonstração é a mesma a cada execução. */
  function sorteio_(semente) {
    var a = semente >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ cursor ----
  function props_() {
    return Database.props();
  }
  function lerCursor_() {
    var t = props_().ler()[PROP_CURSOR];
    if (vazio_(t)) return null;
    var c = JSON.parse(t);
    return c && c.versao === VERSAO_CURSOR ? c : null;
  }
  function gravarCursor_(run) {
    var t = JSON.stringify({ versao: VERSAO_CURSOR, plano: run.plano, id: run.id, ambiente: run.ambiente, iniciado_em: run.iniciado_em, proximo: run.proximo, estado: run.estado });
    if (t.length > 8500) throw Validation.erro('INTERNAL', 'O cursor do teste de aceitação passou do tamanho que as propriedades aceitam.');
    props_().gravar(PROP_CURSOR, t);
  }
  function gravarResultado_(i, resultado) {
    var r = resultado;
    var t = JSON.stringify(r);
    if (t.length > CENARIOS_RESULTADO_MAX) {
      r = JSON.parse(t);
      r.passos = r.passos.map(function (p) { return { passo: p.passo, titulo: curto_(p.titulo, 60), situacao: p.situacao, detalhe: p.detalhe ? curto_(p.detalhe, 80) : null }; });
      t = JSON.stringify(r).slice(0, CENARIOS_RESULTADO_MAX);
    }
    props_().gravar(PROP_RESULTADO + i, t);
  }
  function limparCursor_(total) {
    var p = props_();
    p.remover(PROP_CURSOR);
    for (var i = 0; i < total; i++) p.remover(PROP_RESULTADO + i);
  }
  function lerResultados_(total) {
    var p = props_().ler();
    var out = [];
    for (var i = 0; i < total; i++) if (!vazio_(p[PROP_RESULTADO + i])) out.push(JSON.parse(p[PROP_RESULTADO + i]));
    return out;
  }

  // ------------------------------------------------------------------ contexto de teste ----
  /** O que cada cenário usa: a Api com o ambiente do plano, a base de teste crua e o registro dos passos. */
  function novoT_(run, opcoes) {
    var chaveBanco = Maintenance.chaveDoAmbiente(run.ambiente);
    var t = { run: run, estado: run.estado, usuario: run.usuario, injetar: (opcoes && opcoes.injetar) || {}, passos: [] };
    t.api = function (rota, dados, extra) {
      var e = extra || {};
      return Api.tratar({
        rota: rota, dados: dados || {}, ambiente: run.ambiente, idempotencyKey: e.chave || null, avisosAceitos: e.avisos || [],
        dataVersionEsperada: e.versao === undefined ? null : e.versao,
      }, { usuario: run.usuario });
    };
    t.ok = function (env, onde) {
      verificar_(env && env.ok === true, onde + ': esperava sucesso; veio ' + (env && env.error ? env.error.code + ' — ' + env.error.message + (env.error.details && env.error.details.length ? ' ' + curto_(env.error.details[0].mensagem, 120) : '') : curto_(env)));
      return env.data;
    };
    t.erro = function (env, code, onde) {
      verificar_(env && env.ok === false && env.error.code === code, onde + ': esperava ' + code + '; veio ' + (env.ok ? 'sucesso' : env.error.code + ' — ' + env.error.message));
      return env.error;
    };
    t.chave = function (nome) { return 'aceite:' + run.id + ':' + nome; };
    t.cmd = function (rota, dados, nome, extra) {
      return t.ok(t.api(rota, dados, Object.assign({ chave: t.chave(nome) }, extra || {})), nome);
    };
    t.banco = function () { return props_().ler()[chaveBanco]; };
    t.io = function (tabelas) {
      var p = props_().ler();
      var b = p[chaveBanco];
      return Database.abrir(b, { primitiva: Maintenance.primitivaDoBanco(p, b), tabelas: tabelas });
    };
    t.tabela = function (aba) { return t.io().ler([aba])[aba].registros; };
    t.retrato = function () {
      var nomes = Schema.nomesTabelas();
      var lido = t.io().ler(nomes);
      var out = {};
      nomes.forEach(function (n) { out[n] = JSON.stringify(lido[n].registros); });
      return out;
    };
    t.contagens = function () {
      var nomes = Schema.nomesTabelas();
      var lido = t.io().ler(nomes);
      var out = {};
      nomes.forEach(function (n) { out[n] = lido[n].registros.length; });
      return out;
    };
    t.versao = function () { return parseInt(props_().ler()[UnitOfWork.chaveVersao(t.banco())], 10) || 0; };
    t.hoje = function () { return Utils.hoje(Database.clock().agora(), t.io().fuso()); };
    t.ativos = function () {
      var d = t.ok(t.api('animal.listar', { situacoes: ['ATIVO'] }), 'animal.listar');
      var out = {};
      d.valores.brinco.forEach(function (b, i) { out[b] = { animal_id: d.valores.animal_id[i], codigo_interno: d.valores.codigo_interno[i], pasto_atual_id: d.valores.pasto_atual_id[i] }; });
      return out;
    };
    t.passo = function (id, titulo, fn) {
      try {
        var detalhe = fn();
        t.passos.push({ passo: id, titulo: titulo, situacao: SITUACAO.PASSOU, detalhe: vazio_(detalhe) ? null : curto_(String(detalhe), 200) });
      } catch (e) {
        t.passos.push({ passo: id, titulo: titulo, situacao: SITUACAO.FALHOU, detalhe: curto_(texto_(e), 300) });
        throw e;
      }
    };
    t.naoSeAplica = function (id, titulo, motivo) { t.passos.push({ passo: id, titulo: titulo, situacao: SITUACAO.NAO_SE_APLICA, detalhe: motivo }); };
    t.pendente = function (id, titulo, motivo) { t.passos.push({ passo: id, titulo: titulo, situacao: SITUACAO.PENDENTE, detalhe: motivo }); };
    // Apoio dos cenários da Fase 2: datas contadas do marco zero, pastos e parceiros próprios de cada cenário (as
    // contagens por pasto ficam exatas na base compartilhada), consultas pela Api e a integridade no fim.
    t.dia = function (n) { return Utils.somaDias(t.estado.d0, n); };
    t.pastos = function (cenario, nomes) {
      var out = {};
      nomes.forEach(function (n, i) {
        out[n] = t.cmd('pasto.salvar', { campos: { property_id: t.estado.prop, nome: n + ' (' + cenario + ')', posse: 'PROPRIO', status: 'ATIVO' } }, cenario + '-pasto-' + i).pasture_id;
      });
      return out;
    };
    t.parceiro = function (nome, tipos, nomeChave) { return t.cmd('parceiro.salvar', { campos: { nome: nome, tipos: tipos } }, nomeChave).partner_id; };
    t.posicao = function (data) { return t.ok(t.api('inventario.posicao', vazio_(data) ? {} : { data: data }), 'inventario.posicao'); };
    t.noPasto = function (pasto, data) {
      var n = 0;
      (t.posicao(data).por_pasto || []).forEach(function (x) { if (x.pasture_id === pasto) n = x.cabecas; });
      return n;
    };
    t.doEvento = function (aba, eventId) { return t.tabela(aba).filter(function (r) { return r.event_id === eventId; }); };
    t.titulos = function () { return t.ok(t.api('dashboard.obter', {}), 'dashboard.obter').titulos; };
    t.ficha = function (id) { return t.ok(t.api('animal.ficha', { animal_id: id }), 'animal.ficha'); };
    t.evento = function (id) { return t.ok(t.api('evento.obter', { event_id: id }), 'evento.obter').evento; };
    t.animal = function (id) { return t.tabela('ANIMAIS').filter(function (a) { return a.animal_id === id; })[0] || null; };
    /** Recusa que não grava nada: código esperado, abas idênticas, versão igual e chave livre. */
    t.recusa = function (rota, dados, code, nome) {
      var antes = t.contagens();
      var v0 = t.versao();
      var chave = t.chave(nome);
      var e = t.erro(t.api(rota, dados, { chave: chave }), code, nome);
      igual_(t.contagens(), antes, nome + ': nenhuma linha gravada');
      igual_(t.versao(), v0, nome + ': a versão dos dados não muda');
      igual_(t.ok(t.api('operacao.status', { chave: chave }), 'status').situacao, 'INEXISTENTE', nome + ': a chave não foi consumida');
      return e;
    };
    /** Projeção gravada = reconstrução e as invariantes do financeiro: a verificação de integridade sem erro. */
    t.integra = function (onde) {
      var rel = t.ok(t.api('sistema.integridade', {}), 'integridade');
      var erros = (rel.checagens || []).filter(function (c) { return c.situacao === 'ERRO'; }).map(function (c) { return c.codigo; });
      verificar_(rel.ok === true, 'integridade com erro depois de ' + onde + ': ' + erros.join(', ') + ' ' + curto_((rel.achados || []).slice(0, 2), 200));
      return 'integridade sem erro (projeção = reconstrução)';
    };
    return t;
  }
  function bicho_(t, extra) {
    var a = { sexo: 'F', origem: 'DESCONHECIDA', pasto_destino_id: t.estado.pastos.A };
    Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k]; });
    if (a.sexo === 'M') {
      if (a.castrado === undefined) a.castrado = false;
      if (a.reprodutor === undefined) a.reprodutor = false;
    }
    if (!vazio_(a.data_nascimento) && vazio_(a.data_nascimento_confianca)) a.data_nascimento_confianca = 'CONFIRMADA';
    if ((!vazio_(a.mae_id) || !vazio_(a.mae_ref)) && vazio_(a.mae_confianca)) a.mae_confianca = 'CONFIRMADA';
    return a;
  }
  function entrada_(animais) {
    return { tipo: 'ENTRADA_INICIAL', campos: {}, animais: animais };
  }
  function outra_(data, animais) {
    return { tipo: 'OUTRA_ENTRADA', campos: { event_date: data, description: 'Teste de aceitação' }, animais: animais };
  }
  function ajuste_(subtipo, data, itens) {
    return { tipo: 'AJUSTE_INVENTARIO', subtipo: subtipo, campos: { event_date: data, justificativa: 'Teste de aceitação' }, animais: itens };
  }
  /** Venda por cabeça (R$ 3.000,00 cada), recebimento na data. */
  function venda_(data, comprador, ids) {
    return {
      tipo: 'VENDA', campos: { event_date: data, partner_id: comprador, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 * ids.length },
      animais: ids.map(function (id) { return { animal_id: id }; }), parcelas: [{ data_vencimento: data }],
    };
  }
  /** Compra de um animal que já foi da fazenda (volta ao rebanho), por cabeça, à vista. */
  function compra_(data, fornecedor, pasto, animalId) {
    return {
      tipo: 'COMPRA', campos: { event_date: data, partner_id: fornecedor, pasto_destino_id: pasto, modalidade: 'CABECA', preco_unitario: 320000, valor_animais: 320000 },
      animais: [{ animal_id: animalId }], parcelas: [{ data_vencimento: data }],
    };
  }
  function porBrinco_(resposta) {
    var out = {};
    resposta.animais.forEach(function (a) { out[a.brinco] = a; });
    return out;
  }
  function checagens_(rel) {
    var out = {};
    rel.checagens.forEach(function (c) { out[c.codigo] = c.situacao; });
    return out;
  }
  function transf_(data, origem, destino, ids) {
    return { tipo: 'TRANSFERENCIA', campos: { event_date: data, pasto_origem_id: origem, pasto_destino_id: destino }, animais: ids.map(function (id) { return { animal_id: id }; }) };
  }
  function ident_(subtipo, data, tipoIdent, itens) {
    return { tipo: 'IDENTIFICACAO', subtipo: subtipo, campos: { event_date: data, tipo_identificacao: tipoIdent }, animais: itens };
  }
  function nascimento_(data, matriz, crias, campos) {
    var c = { event_date: data };
    Object.keys(campos || {}).forEach(function (k) { c[k] = campos[k]; });
    return { tipo: 'NASCIMENTO', campos: c, animais: [{ animal_id: matriz }], crias: crias };
  }
  /** Garrote comprado (animal novo na compra): macho inteiro de 14 meses. */
  function garrote_(brinco, extra) {
    var a = { brinco: brinco, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 };
    Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k]; });
    return a;
  }
  function ids_(resposta) {
    var out = {};
    resposta.animais.forEach(function (a) { out[a.brinco] = a.animal_id; });
    return out;
  }
  /** {chave: valor} de uma lista de linhas: o mapa compara sem depender da ordem das linhas. */
  function mapa_(linhas, chave, valor) {
    var out = {};
    linhas.forEach(function (l) { out[typeof chave === 'function' ? chave(l) : l[chave]] = typeof valor === 'function' ? valor(l) : l[valor]; });
    return out;
  }
  function soma_(linhas, campo) {
    return linhas.reduce(function (s, l) { return s + (l[campo] || 0); }, 0);
  }
  var FORMATO_CSV = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

  // ------------------------------------------------------------------ cenários de aceitação (Fase 1) ----
  /**
   * Na Fase 1, cada CT roda só com o que a fase entrega (09, seção 8, "cenário que usa peça de fase posterior"); a
   * parte que depende de fase futura fica NAO_SE_APLICA, com o motivo, e é conferida na fase que entrega a peça.
   */
  var CENARIOS = [
    {
      id: 'PREPARO', titulo: 'Base de teste nova pelo setup (Drive API) e cadastro mínimo pela Api',
      executar: function (t) {
        var p = props_().ler();
        t.passo('1', 'Retrato da base real (para conferir no fim que nada mudou)', function () {
          var prod = p.SPREADSHEET_ID || null;
          t.estado.producao = { banco: prod, versao: prod ? p[UnitOfWork.chaveVersao(prod)] || null : null, marcador: prod ? !vazio_(p[UnitOfWork.chaveMarcador(prod)]) : false, primitiva: p.IO_PRIMITIVE || null, relatorio: p.IO_PRIMITIVE_RELATORIO ? p.IO_PRIMITIVE_RELATORIO.length : 0 };
          return prod ? 'base real registrada' : 'ainda não há base real (setup não rodou)';
        });
        t.passo('2', 'Base de teste anterior para a lixeira; propriedades dela apagadas', function () {
          var antiga = p.TEST_SPREADSHEET_ID;
          if (vazio_(antiga)) return 'não havia base de teste';
          FileService.porta().lixeira(antiga);
          [Maintenance.chaveDoAmbiente('TESTE'), UnitOfWork.chaveVersao(antiga), UnitOfWork.chaveMarcador(antiga), 'IO_PRIMITIVE:' + antiga, 'INTEGRIDADE:' + antiga].forEach(function (k) { props_().remover(k); });
          return 'base anterior descartada';
        });
        t.passo('3', 'setup na base de teste (CT-11, passo 1: banco vazio)', function () {
          var rel = Maintenance.setup({ usuario: t.usuario, ambiente: 'TESTE' });
          verificar_(rel.banco_criado === true, 'o setup deveria criar a base de teste');
          verificar_(rel.banco !== t.estado.producao.banco, 'a base de teste não pode ser a base real');
          t.estado.bancos = [rel.banco];
          t.estado.setup1 = { abas: rel.abas.criadas.length, contas: rel.sementes.PLANO_CONTAS, gatilhos: rel.gatilhos.total, primitiva: rel.primitiva.primitiva, integridade: rel.integridade.ok };
          return 'forma de gravação: ' + rel.primitiva.primitiva;
        });
        t.passo('4', 'Propriedade, pastos A, B (P-B) e C (inativo), marco zero', function () {
          var hoje = t.hoje();
          var d0 = Utils.somaDias(hoje, -365);
          var prop = t.cmd('propriedade.salvar', { campos: { nome: 'Fazenda do Teste de Aceitação', status: 'ATIVO' } }, 'prop');
          var a = t.cmd('pasto.salvar', { campos: { property_id: prop.property_id, nome: 'Pasto A', posse: 'PROPRIO', status: 'ATIVO' } }, 'pasto-a');
          var b = t.cmd('pasto.salvar', { campos: { property_id: prop.property_id, nome: 'Pasto B', identificacao: 'P-B', posse: 'PROPRIO', status: 'ATIVO' } }, 'pasto-b');
          var c = t.cmd('pasto.salvar', { campos: { property_id: prop.property_id, nome: 'Pasto C', posse: 'PROPRIO', status: 'ATIVO' } }, 'pasto-c');
          t.cmd('pasto.salvar', { pasture_id: c.pasture_id, campos: { status: 'INATIVO' } }, 'pasto-c-inativo');
          t.cmd('config.salvar', { valores: { data_marco_zero: d0, propriedade_padrao_id: prop.property_id } }, 'config');
          t.estado.prop = prop.property_id;
          t.estado.pastos = { A: a.pasture_id, B: b.pasture_id, C: c.pasture_id };
          t.estado.d0 = d0;
          return 'marco zero ' + d0;
        });
      },
    },
    {
      id: 'CT-09', titulo: 'Integridade: o servidor recusa direto pela api() (saídas, brinco, mãe, pasto, data e reentrada)',
      executar: function (t) {
        var d0 = t.estado.d0;
        var ids = {};
        t.passo('massa', '0901 vendido em D0+30, 0902 morto em D0+20, 0903 fêmea jovem, 0904 macho, 0905 → 0906 → 0907 (mãe de)', function () {
          var r = t.cmd('evento.registrar', entrada_([
            bicho_(t, { brinco: '0901', sexo: 'M', castrado: true, data_nascimento: Utils.somaDias(d0, -800) }),
            bicho_(t, { brinco: '0902', data_nascimento: Utils.somaDias(d0, -900) }),
            bicho_(t, { brinco: '0903', data_nascimento: Utils.somaDias(d0, -100) }),
            bicho_(t, { brinco: '0904', sexo: 'M', data_nascimento: Utils.somaDias(d0, -700) }),
            bicho_(t, { brinco: '0905', ref: 'm5', partos_previos: 2 }),
            bicho_(t, { brinco: '0906', ref: 'm6', mae_ref: 'm5', data_nascimento: Utils.somaDias(d0, -1500) }),
            bicho_(t, { brinco: '0907', mae_ref: 'm6', data_nascimento: Utils.somaDias(d0, -400) }),
          ]), 'ct09-massa');
          var m = porBrinco_(r);
          ['0901', '0902', '0903', '0904', '0905', '0906', '0907'].forEach(function (b) { ids[b] = m[b].animal_id; });
          ids.parceiro = t.cmd('parceiro.salvar', { campos: { nome: 'Vizinho do teste de aceitação', tipos: ['COMPRADOR', 'FORNECEDOR'] } }, 'ct09-parceiro').partner_id;
          t.cmd('evento.registrar', { tipo: 'MORTE', campos: { event_date: Utils.somaDias(d0, 20), causa: 'DOENCA' }, animais: [{ animal_id: ids['0902'] }] }, 'ct09-morte');
          t.cmd('evento.registrar', venda_(Utils.somaDias(d0, 30), ids.parceiro, [ids['0901']]), 'ct09-venda');
        });
        var amanha = Utils.somaDias(t.hoje(), 1);
        var tentativas = [
          ['1', 'VENDA de 0901 (vendido em D0+30) em D0+40', venda_(Utils.somaDias(d0, 40), ids.parceiro, [ids['0901']]), 'FORA_DO_REBANHO'],
          ['2', 'TRANSFERENCIA de 0902 (morto em D0+20) em D0+40', { tipo: 'TRANSFERENCIA', campos: { event_date: Utils.somaDias(d0, 40), pasto_origem_id: t.estado.pastos.A, pasto_destino_id: t.estado.pastos.B }, animais: [{ animal_id: ids['0902'] }] }, 'APOS_MORTE'],
          ['3a', 'Novo animal com o brinco " 0901 " (do vendido: o número continua dele)', outra_(Utils.somaDias(d0, 35), [bicho_(t, { brinco: ' 0901 ' })]), 'BRINCO_DUPLICADO'],
          ['3b', 'Novo animal com o brinco "901" (o mesmo sem zeros à esquerda)', outra_(Utils.somaDias(d0, 35), [bicho_(t, { brinco: '901' })]), 'BRINCO_DUPLICADO'],
          ['3c', 'Troca do brinco do 0903 pelo número do vendido (identificação)', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: Utils.somaDias(d0, 35), tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: ids['0903'], codigo: '0901', motivo: 'PERDA' }] }, 'BRINCO_DUPLICADO'],
          ['3d', 'Identificação do 0902 depois da morte', { tipo: 'IDENTIFICACAO', subtipo: 'PRIMEIRA_IDENTIFICACAO', campos: { event_date: Utils.somaDias(d0, 40), tipo_identificacao: 'SISBOV' }, animais: [{ animal_id: ids['0902'], codigo: 'SB-0902' }] }, 'APOS_MORTE'],
          ['4', 'Mãe = 0904 (macho)', outra_(Utils.somaDias(d0, 5), [bicho_(t, { brinco: '0910', mae_id: ids['0904'] })]), null],
          ['5', 'Mãe 0903 para bezerro nascido antes dela', outra_(Utils.somaDias(d0, 5), [bicho_(t, { brinco: '0911', data_nascimento: Utils.somaDias(d0, -130), mae_id: ids['0903'] })]), null],
          ['6', '0905 como mãe de si mesma', ajuste_('CORRECAO_CADASTRO', Utils.somaDias(d0, 6), [{ animal_id: ids['0905'], campo: 'mae_id', valor_novo: ids['0905'] }, { animal_id: ids['0905'], campo: 'mae_confianca', valor_novo: 'ESTIMADA' }]), 'PROPRIO_PROGENITOR'],
          ['7', '0907 como mãe de 0905 (ciclo; a resposta traz o caminho)', ajuste_('CORRECAO_CADASTRO', Utils.somaDias(d0, 6), [{ animal_id: ids['0905'], campo: 'mae_id', valor_novo: ids['0907'] }, { animal_id: ids['0905'], campo: 'mae_confianca', valor_novo: 'ESTIMADA' }]), 'CICLO_GENEALOGICO'],
          ['8a', 'Pasto de destino inexistente', outra_(Utils.somaDias(d0, 5), [bicho_(t, { brinco: '0912', pasto_destino_id: 'ffffffff-0000-4000-8000-000000000000' })]), null],
          ['8b', 'Pasto de destino inativo', outra_(Utils.somaDias(d0, 5), [bicho_(t, { brinco: '0913', pasto_destino_id: t.estado.pastos.C })]), null],
          ['9', 'Evento datado de amanhã', outra_(amanha, [bicho_(t, { brinco: '0914' })]), null],
        ];
        tentativas.forEach(function (x) {
          t.passo(x[0], x[1], function () {
            var antes = t.retrato();
            var v0 = t.versao();
            var chave = t.chave('ct09-' + x[0]);
            var e = t.erro(t.api('evento.registrar', x[2], { chave: chave }), 'VALIDATION', x[0]);
            verificar_(e.details.length > 0, 'a recusa precisa vir com os detalhes por animal e campo');
            verificar_(e.details.every(function (d) { return !vazio_(d.codigo) && !vazio_(d.mensagem); }), 'todo detalhe tem código e mensagem');
            verificar_(e.details.some(function (d) { return !vazio_(d.campo) || !vazio_(d.brinco) || !vazio_(d.animal_id); }), 'o detalhe aponta o animal ou o campo');
            if (x[3]) verificar_(e.details.some(function (d) { return d.codigo === x[3]; }), 'esperava o código ' + x[3] + '; veio ' + e.details.map(function (d) { return d.codigo; }).join(', '));
            if (x[0] === '7') verificar_(/→/.test(JSON.stringify(e.details)), 'o ciclo vem com o caminho');
            var depois = t.retrato();
            Object.keys(antes).forEach(function (aba) { verificar_(antes[aba] === depois[aba], 'a aba ' + aba + ' mudou depois de uma recusa'); });
            igual_(t.versao(), v0, 'a versão dos dados não muda');
            igual_(t.ok(t.api('operacao.status', { chave: chave }), 'status').situacao, 'INEXISTENTE', 'a chave não foi consumida');
            return e.details.map(function (d) { return d.codigo; }).join(', ');
          });
        });
        t.passo('10', 'COMPRA de 0901 em D0+29 (antes da venda) é recusada; a mesma compra em D0+45 é reentrada com o mesmo animal_id', function () {
          var antes = t.retrato();
          var e = t.erro(t.api('evento.registrar', compra_(Utils.somaDias(d0, 29), ids.parceiro, t.estado.pastos.A, ids['0901']), { chave: t.chave('ct09-10a') }), 'VALIDATION', '10 antes da saída');
          verificar_(e.details.some(function (d) { return d.codigo === 'ENTRADA_JA_DENTRO' && d.animal_id === ids['0901']; }), 'esperava ENTRADA_JA_DENTRO no 0901; veio ' + e.details.map(function (d) { return d.codigo; }).join(', '));
          var depois = t.retrato();
          Object.keys(antes).forEach(function (aba) { verificar_(antes[aba] === depois[aba], 'a aba ' + aba + ' mudou depois de uma recusa'); });
          var r = t.cmd('evento.registrar', compra_(Utils.somaDias(d0, 45), ids.parceiro, t.estado.pastos.A, ids['0901']), 'ct09-10b');
          igual_([r.event_type, r.animais.length, r.animais[0].animal_id, r.animais[0].situacao_cadastral], ['COMPRA', 1, ids['0901'], 'ATIVO'], 'reentrada do mesmo animal');
          return 'recusada em D0+29 (ENTRADA_JA_DENTRO); aceita em D0+45 com o mesmo animal_id';
        });
      },
    },
    {
      id: 'CT-10', titulo: 'Reenvio não duplica; gravações não se intercalam (OUTRA_ENTRADA no lugar da PESAGEM, Fase 1)',
      executar: function (t) {
        var d1 = Utils.somaDias(t.estado.d0, 10);
        var k1 = t.chave('ct10-k1');
        var dados1 = outra_(d1, [bicho_(t, { brinco: '1001' })]);
        var r1 = null;
        t.passo('1', 'Duas vezes com a chave K1: a segunda é duplicado com o mesmo evento', function () {
          var e1 = t.api('evento.registrar', dados1, { chave: k1 });
          r1 = { dados: t.ok(e1, 'primeira'), opId: e1.meta.opId };
          verificar_(e1.meta.duplicado === false, 'a primeira não é duplicado');
          var e2 = t.api('evento.registrar', dados1, { chave: k1 });
          t.ok(e2, 'segunda');
          verificar_(e2.meta.duplicado === true, 'a segunda deveria vir com duplicado');
          igual_(e2.data.event_id, r1.dados.event_id, 'mesmo event_id');
          igual_(t.tabela('EVENTOS').filter(function (e) { return e.idempotency_key === k1; }).length, 1, 'uma linha em EVENTOS');
          igual_(t.tabela('ANIMAIS').filter(function (a) { return a.brinco === '1001'; }).length, 1, 'um animal 1001');
        });
        t.passo('2', 'K1 com outro conteúdo: IDEMPOTENCY_MISMATCH', function () {
          t.erro(t.api('evento.registrar', outra_(d1, [bicho_(t, { brinco: '1002' })]), { chave: k1 }), 'IDEMPOTENCY_MISMATCH', 'K1 com outro conteúdo');
        });
        t.naoSeAplica('3', 'Mesma pesagem com chave nova: aviso POSSIVEL_DUPLICIDADE', 'PESAGEM chega na Fase 3 (o passo volta a rodar como escrito).');
        t.passo('4', 'Resposta perdida: operacao.status(K1) devolve CONFIRMADA', function () {
          var s = t.ok(t.api('operacao.status', { chave: k1 }), 'status');
          igual_([s.situacao, s.op_id], ['CONFIRMADA', r1.opId], 'situação e operação');
        });
        if (typeof t.injetar.ocuparLock === 'function') {
          t.passo('5', 'Lock tomado: LOCKED; a nova tentativa com a mesma chave grava uma vez', function () {
            var k5 = t.chave('ct10-k5');
            var dados5 = outra_(d1, [bicho_(t, { brinco: '1005' })]);
            t.injetar.ocuparLock();
            var ocupado;
            try {
              ocupado = t.api('evento.registrar', dados5, { chave: k5 });
            } finally {
              t.injetar.liberarLock();
            }
            t.erro(ocupado, 'LOCKED', 'com o lock tomado');
            var e = t.api('evento.registrar', dados5, { chave: k5 });
            t.ok(e, 'depois de liberado');
            verificar_(e.meta.duplicado === false, 'LOCKED não consome a chave');
            verificar_(t.api('evento.registrar', dados5, { chave: k5 }).meta.duplicado === true, 'o reenvio seguinte é duplicado');
            igual_(t.tabela('EVENTOS').filter(function (x) { return x.idempotency_key === k5; }).length, 1, 'gravou uma vez');
          });
        } else {
          t.naoSeAplica('5', 'Lock tomado por outra execução', 'Uma execução não disputa o lock consigo mesma; coberto no nível 1 e pela página de concorrência (passo 6).');
        }
        t.pendente('6', '5 comandos paralelos com chaves diferentes + 2 com a mesma chave', 'Abra o app com ?pagina=concorrencia (usa a base de teste) e envie o resultado.');
      },
    },
    {
      id: 'CT-12', titulo: 'Importação: nada entra em silêncio nem pela metade (sem a reconciliação, que é da Fase 2)',
      executar: function (t) {
        var d0 = t.estado.d0;
        var n = function (dias) { return br_(Utils.somaDias(d0, -dias)); };
        var csv = ['Brinco;Sexo;Nasc.;Mãe;Pasto',
          '1210;F;' + n(2600) + ';;Pasto A', '1211;F;' + n(1600) + ';1210;Pasto A', '01212;F;' + n(1300) + ';;Pasto A',
          '1212;F;' + n(1250) + ';;Pasto B', '1231;F;' + n(2000) + ';;Pasto B', '1250;X;' + n(900) + ';;Pasto A',
          '1251;F;31/02/2024;;Pasto A', '1252;M;' + n(500) + ';9999;Pasto A', '1253;M;' + n(300) + ';1210;P-B',
          '1254;F;;;Pasto B', '1255;M;' + n(1700) + ';;Pasto A', '1256;F;' + n(200) + ';1211;Pasto A'].join('\r\n');
        var mapa = {
          colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', 'Mãe': 'mae', Pasto: 'pasto' },
          confiancas: { data_nascimento: 'ESTIMADA', mae: 'CONFIRMADA' }, padroes: { castrado: false, reprodutor: false },
        };
        var parcial = { modo: 'PARCIAL_APROVADO', aprovacao: { importar: 7, ignorar: 5 } };
        var lote1 = ['1210', '1211', '01212', '1253', '1254'];
        var todos = ['1210', '1211', '01212', '1253', '1254', '1255', '1256'];
        var id = null;
        var falhou = true;
        try {
          t.passo('massa', 'Brinco 1231 já no rebanho; importação em lotes de 5 linhas', function () {
            t.cmd('evento.registrar', entrada_([bicho_(t, { brinco: '1231', data_nascimento: Utils.somaDias(d0, -2100) })]), 'ct12-base');
            t.cmd('config.salvar', { valores: { importacao_lote_linhas: 5 } }, 'ct12-lote');
            id = t.cmd('importacao.criar', { tipo: 'ANIMAIS', arquivo_nome: 'aceitacao-ct12.csv', texto: csv, formato: { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' } }, 'ct12-criar').import_id;
          });
          t.passo('1', 'Validar: 7 válidas, 3 com erro e 2 duplicadas', function () {
            var est = null;
            for (var b = 1; b < 10 && (!est || est.importacao.status !== 'VALIDADO'); b++) est = t.cmd('importacao.validarBloco', { import_id: id, bloco: b, mapeamento: mapa }, 'ct12-val-' + b);
            igual_(est.importacao.status, 'VALIDADO', 'validação completa');
            igual_([est.contadores.validas, est.contadores.erro, est.contadores.duplicadas], [7, 3, 2], 'contadores');
          });
          t.passo('2', 'Modo TOTAL é recusado', function () {
            var e = t.erro(t.api('importacao.importarBloco', { import_id: id, bloco: 1, modo: 'TOTAL' }), 'VALIDATION', 'TOTAL');
            verificar_(e.details.some(function (d) { return d.codigo === 'IMPORTACAO_TOTAL_RECUSADA'; }), 'código IMPORTACAO_TOTAL_RECUSADA');
          });
          t.passo('3', 'PARCIAL_APROVADO, lote 1: IMPORTANDO e nenhum dos 5 animais visível', function () {
            t.ok(t.api('importacao.importarBloco', { import_id: id, bloco: 1, modo: parcial.modo, aprovacao: parcial.aprovacao }), 'lote 1');
            igual_(t.ok(t.api('importacao.obter', { import_id: id }), 'obter').importacao.status, 'IMPORTANDO', 'situação');
            var ativos = t.ativos();
            verificar_(lote1.every(function (b) { return !ativos[b]; }), 'animal do lote 1 visível antes de concluir');
            return 'queda depois do commit do lote 1: coberta no nível 1 (tests/import.test.js)';
          });
          t.passo('4', 'Outro lançamento é recusado (CONFLICT)', function () {
            t.erro(t.api('evento.registrar', outra_(Utils.somaDias(d0, 3), [bicho_(t, { brinco: '1290' })]), { chave: t.chave('ct12-outro') }), 'CONFLICT', 'lançamento durante a importação');
          });
          t.passo('5', 'Retomar: lote 1 de novo é duplicado; lote 2; concluir com backup antes; 7 animais ATIVOS em D0', function () {
            var dup = t.api('importacao.importarBloco', { import_id: id, bloco: 1, modo: parcial.modo, aprovacao: parcial.aprovacao });
            t.ok(dup, 'lote 1 de novo');
            verificar_(dup.meta.duplicado === true, 'o lote 1 reenviado devolve duplicado');
            t.ok(t.api('importacao.importarBloco', { import_id: id, bloco: 2 }), 'lote 2');
            var fim = t.ok(t.api('importacao.concluir', { import_id: id }), 'concluir');
            igual_([fim.importacao.status, fim.criados.animais, fim.criados.ativos], ['IMPORTADO', 7, 7], 'relatório final');
            var ativos = t.ativos();
            verificar_(todos.every(function (b) { return ativos[b]; }), 'os 7 animais ficam ATIVOS');
            var backups = t.ok(t.api('sistema.estado', {}), 'estado').backups.filter(function (b) { return b.motivo === 'IMPORTACAO'; });
            igual_(backups.length, 1, 'backup antes de concluir');
            var linhas = t.ok(t.api('importacao.linhas', { import_id: id, por_pagina: 50 }), 'linhas');
            var l = linhas.itens.filter(function (x) { return x.linha_num === 2; })[0];
            igual_(l.dados_originais, { Brinco: '1210', Sexo: 'F', 'Nasc.': n(2600), 'Mãe': '', Pasto: 'Pasto A' }, 'dados originais = texto do arquivo');
            var semNasc = t.tabela('ANIMAIS').filter(function (a) { return a.brinco === '1254'; })[0];
            igual_(semNasc.data_nascimento, null, 'nascimento vazio segue vazio');
          });
          t.passo('6', 'Desfazer: CANCELADO, nenhum animal da importação vale, linhas preservadas', function () {
            var r = t.ok(t.api('importacao.desfazer', { import_id: id, justificativa: 'Teste de aceitação: variante desfazer' }), 'desfazer');
            igual_(r.importacao.status, 'CANCELADO', 'situação');
            var ativos = t.ativos();
            verificar_(todos.every(function (b) { return !ativos[b]; }), 'animal da importação desfeita continua valendo');
            igual_(t.tabela('IMPORTACAO_LINHAS').filter(function (x) { return x.import_id === id; }).length, 12, 'linhas preservadas');
          });
          falhou = false;
        } finally {
          // Importação de teste em curso travaria os cenários seguintes: desfaz. Falha da limpeza também é falha.
          var est = id ? t.api('importacao.obter', { import_id: id }) : null;
          if (est && est.ok && est.data.importacao.status === 'IMPORTANDO') {
            var limpo = t.api('importacao.desfazer', { import_id: id, justificativa: 'Limpeza do teste de aceitação' });
            t.passos.push({ passo: 'limpeza', titulo: 'Desfazer a importação de teste interrompida', situacao: limpo.ok ? SITUACAO.PASSOU : SITUACAO.FALHOU, detalhe: limpo.ok ? null : limpo.error.message });
            if (!limpo.ok && !falhou) throw falha_('Não foi possível desfazer a importação de teste: ' + limpo.error.message);
          }
        }
      },
    },
    {
      id: 'CT-18', titulo: 'Substituição de ENTRADA_INICIAL com correção de localização posterior (Fase 1)',
      executar: function (t) {
        var d0 = t.estado.d0;
        var orig;
        var loc;
        var sub;
        var item = function (a, brinco) { return bicho_(t, { animal_id: a.animal_id, brinco: brinco, data_nascimento: Utils.somaDias(d0, -800) }); };
        t.passo('massa', '1801, 1802 e 1803 em D0 no Pasto A; correção de localização dos 3 para o Pasto B em D0+30', function () {
          orig = t.cmd('evento.registrar', entrada_(['1801', '1802', '1803'].map(function (b) { return bicho_(t, { brinco: b, data_nascimento: Utils.somaDias(d0, -800) }); })), 'ct18-orig');
          loc = t.cmd('evento.registrar', ajuste_('CORRECAO_LOCALIZACAO', Utils.somaDias(d0, 30), orig.animais.map(function (a) { return { animal_id: a.animal_id, pasto_destino_id: t.estado.pastos.B }; })), 'ct18-loc');
        });
        t.passo('1', 'Corrigir trocando o brinco 1802 por 1812: mesmos animal_id e codigo_interno; original ESTORNADO', function () {
          var m = porBrinco_(orig);
          var dados = { tipo: 'ENTRADA_INICIAL', campos: {}, event_id: orig.event_id, justificativa: 'Brinco 1802 lançado errado', animais: [item(m['1801'], '1801'), item(m['1802'], '1812'), item(m['1803'], '1803')] };
          var sim = t.api('evento.simular', { acao: 'corrigir', dados: dados });
          verificar_(t.ok(sim, 'prévia').simulacao === true, 'a prévia não grava');
          sub = t.cmd('evento.corrigir', dados, 'ct18-corrigir', { versao: sim.meta.dataVersion });
          igual_(sub.substitui, orig.event_id, 'o substituto aponta o original');
          igual_(sub.animais.map(function (a) { return a.animal_id; }).sort(), orig.animais.map(function (a) { return a.animal_id; }).sort(), 'mesmos animal_id');
          igual_(sub.animais.map(function (a) { return a.codigo_interno; }).sort(), orig.animais.map(function (a) { return a.codigo_interno; }).sort(), 'mesmos codigo_interno');
          igual_(t.ok(t.api('evento.obter', { event_id: orig.event_id }), 'original').evento.status, 'ESTORNADO', 'original');
          igual_(t.ok(t.api('evento.obter', { event_id: loc.event_id }), 'correção').evento.status, 'CONFIRMADO', 'a correção de localização segue valendo');
          var animais = t.tabela('ANIMAIS').filter(function (a) { return ['1801', '1812', '1803', '1802'].indexOf(a.brinco) >= 0; });
          igual_(animais.map(function (a) { return a.brinco; }).sort(), ['1801', '1803', '1812'], 'três linhas, brinco trocado');
          verificar_(animais.every(function (a) { return a.evento_origem_id === sub.event_id && a.pasto_atual_id === t.estado.pastos.B; }), 'origem no substituto e pasto da correção posterior');
        });
        t.passo('2', 'Corrigir retirando 1803 (que tem evento posterior): CONFLICT', function () {
          var m = porBrinco_(sub);
          t.erro(t.api('evento.corrigir', { tipo: 'ENTRADA_INICIAL', campos: {}, event_id: sub.event_id, justificativa: 'Tirar o 1803', animais: [item(m['1801'], '1801'), item(m['1812'], '1812')] }, { chave: t.chave('ct18-tirar') }), 'CONFLICT', 'retirar animal com evento posterior');
        });
      },
    },
    {
      id: 'RESTAURACAO', titulo: 'Ensaio de restauração: backup, 3 eventos, restaurar (09, seção 8)',
      executar: function (t) {
        var bk;
        var inv0;
        var v1;
        var res;
        t.passo('1', 'sistema.backup e posição do inventário', function () {
          bk = t.ok(t.api('sistema.backup', {}), 'backup').backup;
          inv0 = t.ok(t.api('inventario.posicao', {}), 'inventário').cabecas;
          return inv0 + ' cabeças no backup';
        });
        t.passo('2', 'Três eventos depois do backup', function () {
          ['2001', '2002', '2003'].forEach(function (b) { t.cmd('evento.registrar', outra_(Utils.somaDias(t.estado.d0, 40), [bicho_(t, { brinco: b })]), 'rest-' + b); });
          v1 = t.versao();
        });
        t.passo('3', 'sistema.restaurarBackup: banco trocado, eventos ausentes, inventário do backup, integridade sem erro, versão acima', function () {
          var antigo = t.banco();
          res = t.ok(t.api('sistema.restaurarBackup', { backup_id: bk.id, justificativa: 'Ensaio de restauração do teste de aceitação' }), 'restaurar');
          t.estado.bancos.push(res.banco);
          verificar_(res.banco !== antigo && t.banco() === res.banco, 'a base de teste em uso passou a ser a restaurada');
          verificar_(res.integridade.ok === true, 'integridade da base restaurada sem erro (' + res.integridade.erros + ' erro(s))');
          verificar_(res.dataVersion > v1, 'versão dos dados acima da última servida');
          igual_(t.ok(t.api('inventario.posicao', {}), 'inventário').cabecas, inv0, 'inventário igual ao do backup');
          var ativos = t.ativos();
          verificar_(['2001', '2002', '2003'].every(function (b) { return !ativos[b]; }), 'os 3 eventos posteriores ao backup não estão na base restaurada');
          var anterior = FileService.porta().obter(antigo);
          verificar_(anterior && anterior.trashed !== true, 'a base anterior continua no Drive');
          verificar_(t.estado.producao.banco === null || props_().ler().SPREADSHEET_ID === t.estado.producao.banco, 'a restauração da base de teste não troca a base real');
        });
      },
    },
    {
      id: 'CT-20', titulo: 'Corpus de tipos e edição manual detectada',
      executar: function (t) {
        t.passo('1', 'Os valores do corpus voltam idênticos nas formas de gravação', function () {
          var files = FileService.porta();
          var temp = files.criarPlanilha('ERP Pecuário — corpus do teste de aceitação (temporária)', 'testes', { erp_tipo: 'CORPUS' });
          var resultados = [];
          try {
            Database.PRIMITIVAS.forEach(function (p) {
              var r = Database.corpus(temp, p);
              resultados.push({ primitiva: p, ok: r.ok, divergencias: r.divergencias.length });
            });
          } finally {
            files.lixeira(temp);
          }
          t.estado.corpus = resultados;
          var p = props_().ler();
          var emUso = Maintenance.primitivaDoBanco(p, t.banco());
          verificar_(resultados.some(function (r) { return r.primitiva === emUso && r.ok; }), 'a forma de gravação em uso (' + emUso + ') precisa preservar o corpus');
          return resultados.map(function (r) { return r.primitiva + ': ' + (r.ok ? 'idêntico' : r.divergencias + ' divergência(s)'); }).join('; ');
        });
        t.naoSeAplica('2', 'Adaptador que omite o tipo faz o teste falhar', 'Prova sobre o fake: nível 1 (tests/database.test.js).');
        var lin = {};
        var copiaPasto = null;
        var base = Schema.tabela('ANIMAIS');
        var animaisInt = { ANIMAIS: { nome: 'ANIMAIS', pk: base.pk, colunas: base.colunas.map(function (c) { return c.nome === 'brinco' ? Object.assign({}, c, { tipo: 'INT' }) : c; }) } };
        t.passo('3', 'Edição à mão: número em coluna de texto, pasto apagado de um ATIVO, chave repetida', function () {
          t.cmd('evento.registrar', outra_(Utils.somaDias(t.estado.d0, 50), [bicho_(t, { brinco: '2010' }), bicho_(t, { brinco: '2011' })]), 'ct20-massa');
          var io = t.io();
          var lido = io.ler(['ANIMAIS', 'PASTOS']);
          lido.ANIMAIS.registros.forEach(function (a, i) { if (a.brinco === '2010' || a.brinco === '2011') lin[a.brinco] = lido.ANIMAIS.linhas[i]; });
          copiaPasto = Utils.clonar(lido.PASTOS.registros.filter(function (x) { return x.pasture_id === t.estado.pastos.A; })[0]);
          t.io(animaisInt).atualizar([{ tabela: 'ANIMAIS', linha: lin['2010'], campos: { brinco: 2010 } }]);
          io.atualizar([{ tabela: 'ANIMAIS', linha: lin['2011'], campos: { pasto_atual_id: null } }]);
          lin.dup = io.anexar({ PASTOS: [copiaPasto] }).PASTOS;
          io.flush();
          verificar_(typeof lin.dup === 'number', 'posição da linha repetida');
        });
        t.passo('4', 'sistema.integridade relata texto que virou número, ativo sem pasto, chave repetida e projeção × reconstrução, sem corrigir', function () {
          var rel = t.ok(t.api('sistema.integridade', {}), 'integridade');
          var c = checagens_(rel);
          igual_([rel.ok, c.CELULAS, c.PK, c.PROJECAO], [false, 'ERRO', 'ERRO', 'ERRO'], 'checagens');
          verificar_(rel.achados.some(function (a) { return a.checagem === 'CELULAS' && /n[úu]mero/i.test(a.mensagem); }), 'achado "texto virou número"');
          verificar_(rel.achados.some(function (a) { return a.checagem === 'PENDENCIAS' && /pasto/i.test(a.mensagem); }), 'achado "ativo sem pasto"');
          verificar_(rel.achados.some(function (a) { return a.checagem === 'PK' && a.tabela === 'PASTOS'; }), 'achado "chave repetida" em PASTOS');
          var cru = t.io(animaisInt).ler(['ANIMAIS']).ANIMAIS.registros.filter(function (a) { return a.brinco === 2010; });
          igual_(cru.length, 1, 'nada foi corrigido em silêncio: o número continua na célula');
          igual_(t.tabela('ANIMAIS').filter(function (a) { return a.animal_id === cru[0].animal_id; }).length, 1, 'o animal continua lá');
        });
        t.passo('5', 'Desfeita a edição e oferecido o reparo, a integridade volta sem erro', function () {
          var io = t.io();
          io.ler(['ANIMAIS', 'PASTOS']);
          var vazia = {};
          Schema.colunas('PASTOS').forEach(function (c) { vazia[c] = null; });
          io.atualizar([{ tabela: 'ANIMAIS', linha: lin['2010'], campos: { brinco: '2010' } }, { tabela: 'PASTOS', linha: lin.dup, campos: vazia }]);
          io.flush();
          var r = t.ok(t.api('sistema.integridade', { reparar: true, justificativa: 'Teste de aceitação: reparo depois da edição à mão' }), 'reparo');
          verificar_(r.integridade.ok === true, 'integridade depois do reparo: ' + r.integridade.erros + ' erro(s)');
        });
      },
    },
    {
      id: 'CT-11', titulo: 'setup repetido só acrescenta',
      executar: function (t) {
        t.passo('1', 'Banco vazio: 34 abas com os cabeçalhos do esquema, 29 contas, 2 gatilhos', function () {
          var s = t.estado.setup1;
          igual_([s.abas, s.contas, s.gatilhos], [Schema.nomesTabelas().length, Schema.SEMENTES.PLANO_CONTAS.length, Maintenance.GATILHOS.length], 'contagens do primeiro setup');
          var cab = t.io().lerCabecalhos(Schema.nomesTabelas());
          Schema.nomesTabelas().forEach(function (n) { igual_(cab[n].slice(0, Schema.colunas(n).length), Schema.colunas(n), 'cabeçalho de ' + n); });
        });
        var antes;
        var gatilhos;
        t.passo('2', 'Dono muda ua_peso_kg para 400 e desativa a categoria Garrote', function () {
          t.cmd('config.salvar', { valores: { ua_peso_kg: 400 } }, 'ct11-ua');
          var garrote = t.tabela('CATEGORIAS').filter(function (c) { return c.codigo === 'GARROTE'; })[0];
          verificar_(garrote, 'semente GARROTE');
          var env = t.api('categoria.salvar', { category_id: garrote.category_id, campos: { ativo: false } }, { chave: t.chave('ct11-garrote') });
          if (!env.ok && env.error.code === 'NEEDS_CONFIRMATION') env = t.api('categoria.salvar', { category_id: garrote.category_id, campos: { ativo: false } }, { chave: t.chave('ct11-garrote'), avisos: env.error.details.map(function (d) { return d.codigo; }) });
          t.ok(env, 'desativar Garrote');
          antes = t.contagens();
          gatilhos = Maintenance.listarGatilhos().length;
        });
        t.passo('3', 'setup de novo: mesmas abas, linhas e gatilhos; 400 mantido; Garrote não recriada; backup antes', function () {
          var rel = Maintenance.setup({ usuario: t.usuario, ambiente: 'TESTE' });
          igual_([rel.banco_criado, rel.banco === t.banco(), rel.abas.criadas.length], [false, true, 0], 'mesmo banco, nenhuma aba nova');
          igual_(rel.sementes, { CONFIGURACOES: 0, LISTAS: 0, PLANO_CONTAS: 0, CATEGORIAS: 0 }, 'nenhuma semente reinserida');
          igual_(t.contagens(), antes, 'mesmas contagens de linhas');
          igual_(Maintenance.listarGatilhos().length, gatilhos, 'mesmos gatilhos');
          igual_(t.tabela('CONFIGURACOES').filter(function (c) { return c.chave === 'ua_peso_kg'; })[0].valor, '400', 'valor do dono');
          igual_(t.tabela('CATEGORIAS').filter(function (c) { return c.codigo === 'GARROTE'; }).map(function (c) { return c.ativo; }), [false], 'Garrote desativada, sem cópia');
          verificar_(rel.backup && rel.backup.motivo === 'SETUP', 'backup antes do setup');
        });
        t.passo('4', 'setup com o esquema da fase seguinte: coluna nova no fim, dados intactos', function () {
          var base = Schema.tabela('PESAGENS');
          var nova = { nome: base.nome, pk: base.pk, colunas: base.colunas.concat([{ nome: 'aceite_coluna_fase_seguinte', tipo: 'DEC1' }]) };
          var antesP = JSON.stringify(t.tabela('PESAGENS'));
          var rel = Maintenance.setup({ usuario: t.usuario, ambiente: 'TESTE', tabelas: { PESAGENS: nova } });
          igual_(rel.abas.colunas_acrescentadas, { PESAGENS: ['aceite_coluna_fase_seguinte'] }, 'coluna acrescentada');
          var cab = t.io().lerCabecalhos(['PESAGENS']).PESAGENS;
          igual_(cab[cab.length - 1], 'aceite_coluna_fase_seguinte', 'no fim do cabeçalho');
          igual_(JSON.stringify(t.tabela('PESAGENS')), antesP, 'dados intactos');
        });
      },
    },
    {
      id: 'ISOLAMENTO', titulo: 'A base real não mudou durante a aceitação',
      executar: function (t) {
        t.passo('1', 'SPREADSHEET_ID, versão, marcador e forma de gravação da base real como no início', function () {
          var p = props_().ler();
          var prod = t.estado.producao;
          igual_(p.SPREADSHEET_ID || null, prod.banco, 'SPREADSHEET_ID');
          if (prod.banco) {
            igual_(p[UnitOfWork.chaveVersao(prod.banco)] || null, prod.versao, 'versão da base real');
            igual_(!vazio_(p[UnitOfWork.chaveMarcador(prod.banco)]), prod.marcador, 'marcador da base real');
          }
          igual_(p.IO_PRIMITIVE || null, prod.primitiva, 'IO_PRIMITIVE de produção');
          igual_(p.IO_PRIMITIVE_RELATORIO ? p.IO_PRIMITIVE_RELATORIO.length : 0, prod.relatorio, 'relatório da forma de gravação de produção');
          verificar_(p.TEST_SPREADSHEET_ID && p.TEST_SPREADSHEET_ID !== prod.banco, 'a base de teste é outra planilha');
        });
      },
    },
  ];

  // ------------------------------------------------------------------ base de demonstração ----
  var PASTOS_DEMO = [
    { nome: 'Pasto da Sede', area_hectares: 40, capacidade_estimada_ua_ha: 2.5 },
    { nome: 'Pasto do Córrego', area_hectares: 35, capacidade_estimada_ua_ha: 2.2 },
    { nome: 'Pasto da Baixada', area_hectares: 30, capacidade_estimada_ua_ha: 2 },
    { nome: 'Pasto das Novilhas', area_hectares: 20, capacidade_estimada_ua_ha: 2 },
    { nome: 'Pasto da Recria', area_hectares: 25, capacidade_estimada_ua_ha: 2.4 },
    { nome: 'Pasto Arrendado do Vizinho', area_hectares: 30, capacidade_estimada_ua_ha: 2, posse: 'ARRENDADO' },
  ];
  /**
   * Os animais da demonstração, sorteados com semente fixa a partir de D0 (09, seção 7, na parte que as fases
   * entregues cobrem): 240 em D0 (110 vacas, 4 touros, 30 novilhas, 48 bezerros ao pé com a mãe no mesmo lote, 48
   * garrotes) em 6 lotes de 40; 8 compras de 8 animais ao longo dos três anos (valor de cada animal, frete e duas
   * parcelas); 1 entrada estornada; 3 transferências de garrotes; 12 partos (um gemelar com natimorto); 1 morte, 1
   * descarte e 1 venda de 6 garrotes por kg vivo (com comissão). Fecha em 308 ativos.
   */
  function geracaoDemo_(d0) {
    var rnd = sorteio_(20261114);
    var seq = 0;
    var brinco = function () { seq += 1; var s = String(seq); while (s.length < 4) s = '0' + s; return s; };
    var entre = function (a, b) { return a + Math.floor(rnd() * (b - a + 1)); };
    var nasc = function (data, min, max) { return Utils.somaDias(data, -entre(min, max)); };
    var raca = function () { return rnd() < 0.8 ? 'NELORE' : 'GUZERA'; };
    var lotes = [[], [], [], [], [], []];
    var garrotes = [];
    var maes = [];
    for (var i = 0; i < 48; i++) {
      var k = Math.floor(i / 8);
      var pasto = i % 3;
      var ref = 'v' + i;
      var vaca = { brinco: brinco(), sexo: 'F', raca: raca(), data_nascimento: nasc(d0, 1100, 3600), data_nascimento_confianca: 'ESTIMADA', partos_previos: entre(1, 5), ref: ref, pasto: pasto, peso: entre(380, 520), metodo_pesagem: 'BALANCA', valor_abertura: entre(4500, 6500) * 100 };
      lotes[k].push(vaca);
      if (i < 12) maes.push(vaca.brinco);
      var macho = rnd() < 0.5;
      var cria = { brinco: brinco(), sexo: macho ? 'M' : 'F', raca: raca(), data_nascimento: nasc(d0, 60, 210), data_nascimento_confianca: 'CONFIRMADA', mae_ref: ref, mae_confianca: 'CONFIRMADA', pasto: pasto, peso: entre(80, 200), metodo_pesagem: 'BALANCA', valor_abertura: entre(1500, 2500) * 100 };
      if (macho) { cria.castrado = false; cria.reprodutor = false; }
      lotes[k].push(cria);
    }
    var outros = [];
    var primeiraVaca = seq + 1;
    for (var v = 0; v < 62; v++) outros.push({ brinco: brinco(), sexo: 'F', raca: raca(), data_nascimento: nasc(d0, 1100, 3600), data_nascimento_confianca: 'ESTIMADA', partos_previos: entre(1, 6), pasto: v % 3, peso: entre(380, 520), metodo_pesagem: 'BALANCA', valor_abertura: entre(4500, 6500) * 100 });
    for (var r = 0; r < 4; r++) outros.push({ brinco: brinco(), sexo: 'M', raca: 'NELORE', reprodutor: true, castrado: false, data_nascimento: nasc(d0, 1500, 2500), data_nascimento_confianca: 'ESTIMADA', pasto: r % 2, peso: entre(700, 900), metodo_pesagem: 'BALANCA', valor_abertura: 1200000 });
    for (var n = 0; n < 30; n++) outros.push({ brinco: brinco(), sexo: 'F', raca: raca(), data_nascimento: nasc(d0, 430, 730), data_nascimento_confianca: 'ESTIMADA', partos_previos: 0, pasto: 3, peso: entre(260, 360), metodo_pesagem: 'BALANCA', valor_abertura: entre(2500, 3200) * 100 });
    for (var g = 0; g < 48; g++) {
      var gar = { brinco: brinco(), sexo: 'M', raca: raca(), castrado: rnd() < 0.5, reprodutor: false, data_nascimento: nasc(d0, 370, 730), data_nascimento_confianca: 'ESTIMADA', pasto: 4, peso: entre(250, 380), metodo_pesagem: 'BALANCA', valor_abertura: entre(2200, 3000) * 100 };
      outros.push(gar);
      garrotes.push(gar.brinco);
    }
    outros.forEach(function (a, j) { lotes[j % 6].push(a); });
    var entradas = [];
    for (var e = 1; e <= 8; e++) {
      var data = Utils.somaDias(d0, 120 * e);
      var grupo = [];
      for (var x = 0; x < 8; x++) {
        var m = x % 2 === 0;
        grupo.push(m
          ? { brinco: brinco(), sexo: 'M', raca: raca(), castrado: true, reprodutor: false, data_nascimento: nasc(data, 400, 700), data_nascimento_confianca: 'ESTIMADA', pasto: 4 }
          : { brinco: brinco(), sexo: 'F', raca: raca(), partos_previos: 0, data_nascimento: nasc(data, 400, 700), data_nascimento_confianca: 'ESTIMADA', pasto: 3 });
      }
      entradas.push({ data: data, animais: grupo });
    }
    var estornada = { data: Utils.somaDias(d0, 1000), animais: [{ brinco: brinco(), sexo: 'F', raca: 'NELORE', partos_previos: 0, data_nascimento: nasc(Utils.somaDias(d0, 1000), 400, 600), data_nascimento_confianca: 'ESTIMADA', pasto: 3 }] };
    var descartada = String(primeiraVaca);
    while (descartada.length < 4) descartada = '0' + descartada;
    var partos = maes.map(function (b, j) { return { mae: b, data: Utils.somaDias(d0, 300 + 7 * j), crias: j === 5 ? [{ situacao_nascimento: 'VIVO', sexo: 'F' }, { situacao_nascimento: 'NATIMORTO' }] : [{ situacao_nascimento: 'VIVO', sexo: rnd() < 0.5 ? 'M' : 'F', peso: entre(28, 38), metodo_pesagem: 'BALANCA' }] }; });
    return { lotes: lotes, entradas: entradas, estornada: estornada, garrotes: garrotes, partos: partos, descartada: descartada, vendidos: garrotes.slice(30, 36), total_ativos: 240 + 64 + 12 - 2 - 6 };
  }
  /** Animal comprado da demonstração: os mesmos dados do sorteio, com o pasto dele e o valor de cada animal. */
  function itemCompraDemo_(t, a) {
    var out = { pasto_destino_id: t.estado.pastos[a.pasto], valor_individual: a.sexo === 'M' ? 280000 : 260000 };
    Object.keys(a).forEach(function (k) { if (k !== 'pasto') out[k] = a[k]; });
    return out;
  }
  function itemDemo_(t, a) {
    var out = { origem: 'DESCONHECIDA', pasto_destino_id: t.estado.pastos[a.pasto] };
    Object.keys(a).forEach(function (k) { if (k !== 'pasto') out[k] = a[k]; });
    return out;
  }
  /** Animais da demonstração por brinco, no rebanho ou já baixados (reexecutar o seed acha o mesmo animal). */
  function todosPorBrinco_(t) {
    var d = t.ok(t.api('animal.listar', { situacoes: ['ATIVO', 'MORTO', 'DESCARTADO', 'VENDIDO'] }), 'animal.listar');
    var out = {};
    d.valores.brinco.forEach(function (b, i) { if (b) out[b] = { animal_id: d.valores.animal_id[i], pasto_atual_id: d.valores.pasto_atual_id[i] }; });
    return out;
  }
  /** Os passos do seed, cada um com a chave `seed:<n>`: reexecutar devolve duplicado e não grava de novo. */
  function passosDemo_() {
    var passos = [];
    var chave = function (n) { return 'seed:' + n; };
    for (var l = 0; l < 6; l++) {
      (function (k) {
        var n = passos.length;
        passos.push({ nome: 'lote-' + (k + 1), executar: function (t, gen) {
          t.ok(t.api('evento.registrar', { tipo: 'ENTRADA_INICIAL', campos: {}, animais: gen.lotes[k].map(function (a) { return itemDemo_(t, a); }) }, { chave: chave(n) }), 'lote ' + (k + 1));
        } });
      })(l);
    }
    for (var e = 0; e < 8; e++) {
      (function (k) {
        var n = passos.length;
        passos.push({ nome: 'compra-' + (k + 1), executar: function (t, gen) {
          var g = gen.entradas[k];
          var animais = g.animais.map(function (a) { return itemCompraDemo_(t, a); });
          var dados = {
            tipo: 'COMPRA', campos: { event_date: g.data, partner_id: t.estado.fornecedor, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', pasto_destino_id: t.estado.pastos[4],
              valor_animais: animais.reduce(function (s, a) { return s + a.valor_individual; }, 0) },
            animais: animais, parcelas: [{ data_vencimento: Utils.somaDias(g.data, 30) }, { data_vencimento: Utils.somaDias(g.data, 60) }],
            custos: [{ tipo: 'FRETE', valor: 40000, data_vencimento: g.data }],
          };
          t.ok(t.api('evento.registrar', dados, { chave: chave(n) }), 'compra ' + (k + 1));
        } });
      })(e);
    }
    var nEst = passos.length;
    passos.push({ nome: 'entrada-estornada', executar: function (t, gen) {
      var g = gen.estornada;
      var r = t.ok(t.api('evento.registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: g.data, description: 'Lançada por engano (demonstração)' }, animais: g.animais.map(function (a) { return itemDemo_(t, a); }) }, { chave: chave(nEst) }), 'entrada a estornar');
      t.ok(t.api('evento.estornar', { event_id: r.event_id, justificativa: 'Lançada por engano (demonstração)' }, { chave: chave(nEst) + ':estorno' }), 'estorno');
    } });
    // [dia, garrotes de, até, pasto de origem, pasto de destino]: origem fixa no plano (reexecutar = mesmo conteúdo).
    [[200, 0, 10, 4, 5], [500, 10, 20, 4, 5], [800, 0, 10, 5, 4]].forEach(function (m, i) {
      var n = passos.length;
      passos.push({ nome: 'mover-' + (i + 1), executar: function (t, gen) {
        var todos = todosPorBrinco_(t);
        var lote = gen.garrotes.slice(m[1], m[2]).map(function (b) { return todos[b]; });
        var dados = { tipo: 'TRANSFERENCIA', campos: { event_date: Utils.somaDias(t.estado.d0, m[0]), pasto_origem_id: t.estado.pastos[m[3]], pasto_destino_id: t.estado.pastos[m[4]] }, animais: lote.map(function (a) { return { animal_id: a.animal_id }; }) };
        t.ok(t.api('evento.registrar', dados, { chave: chave(n) }), 'transferir ' + (i + 1));
      } });
    });
    var nPartos = passos.length;
    passos.push({ nome: 'partos', executar: function (t, gen) {
      var todos = todosPorBrinco_(t);
      gen.partos.forEach(function (p, j) {
        var dados = { tipo: 'NASCIMENTO', campos: { event_date: p.data }, animais: [{ animal_id: todos[p.mae].animal_id }], crias: p.crias };
        t.ok(t.api('evento.registrar', dados, { chave: chave(nPartos) + ':' + j }), 'parto ' + (j + 1));
      });
    } });
    var nSaidas = passos.length;
    passos.push({ nome: 'saidas', executar: function (t, gen) {
      var todos = todosPorBrinco_(t);
      var d0 = t.estado.d0;
      t.ok(t.api('evento.registrar', { tipo: 'MORTE', campos: { event_date: Utils.somaDias(d0, 900), causa: 'PICADA_COBRA' }, animais: [{ animal_id: todos[gen.garrotes[47]].animal_id }] }, { chave: chave(nSaidas) + ':morte' }), 'morte');
      t.ok(t.api('evento.registrar', { tipo: 'DESCARTE', campos: { event_date: Utils.somaDias(d0, 950), destino: 'CONSUMO_PROPRIO', motivo: 'IDADE' }, animais: [{ animal_id: todos[gen.descartada].animal_id }] }, { chave: chave(nSaidas) + ':descarte' }), 'descarte');
      // Venda de 6 garrotes por kg vivo (pesos fixos no plano: reexecutar = mesmo conteúdo), com a comissão do corretor.
      var pesos = gen.vendidos.map(function (b, i) { return 420 + 5 * i; });
      var kg = pesos.reduce(function (x, y) { return x + y; }, 0);
      var dataVenda = Utils.somaDias(d0, 1000);
      t.ok(t.api('evento.registrar', {
        tipo: 'VENDA', campos: { event_date: dataVenda, partner_id: t.estado.comprador, finalidade: 'RECRIA_ENGORDA', modalidade: 'KG_VIVO', preco_unitario: 1100, valor_bruto: kg * 1100 },
        animais: gen.vendidos.map(function (b, i) { return { animal_id: todos[b].animal_id, peso: pesos[i] }; }),
        parcelas: [{ data_vencimento: Utils.somaDias(dataVenda, 30) }], deducoes: [{ tipo: 'COMISSAO', valor: Math.round(kg * 1100 * 0.02) }],
      }, { chave: chave(nSaidas) + ':venda' }), 'venda');
    } });
    passos.push({ nome: 'conferir', executar: function (t, gen) {
      var pos = t.ok(t.api('inventario.posicao', {}), 'inventário');
      igual_(pos.cabecas, gen.total_ativos, 'cabeças no rebanho ao fim do seed');
      t.estado.resultado = { cabecas: pos.cabecas, por_pasto: pos.por_pasto.length };
    } });
    return passos;
  }
  /** Preparo da demonstração: banco DEMO pelo setup (se ainda não existe), propriedade, 6 pastos, marco zero, o fornecedor das compras e o comprador da venda. */
  function prepararDemo_(t) {
    var p = props_().ler();
    t.estado.producao = { banco: p.SPREADSHEET_ID || null, versao: p.SPREADSHEET_ID ? p[UnitOfWork.chaveVersao(p.SPREADSHEET_ID)] || null : null };
    if (vazio_(p.DEMO_SPREADSHEET_ID)) Maintenance.setup({ usuario: t.usuario, ambiente: 'DEMO' });
    var boot = t.ok(t.api('sistema.bootstrap', {}), 'carga inicial');
    var marco = boot.configuracoes.itens.filter(function (i) { return i.chave === 'data_marco_zero'; })[0];
    var d0 = marco && !vazio_(marco.valor) ? marco.valor : Utils.somaDias(t.hoje(), -1095);
    var prop = t.ok(t.api('propriedade.salvar', { campos: { nome: 'Fazenda Demonstração', localizacao: 'Rondônia', area_total_ha: 300, status: 'ATIVO' } }, { chave: 'seed:prop' }), 'propriedade');
    var pastos = PASTOS_DEMO.map(function (x, i) {
      var campos = { property_id: prop.property_id, nome: x.nome, area_hectares: x.area_hectares, capacidade_estimada_ua_ha: x.capacidade_estimada_ua_ha, posse: x.posse || 'PROPRIO', status: 'ATIVO' };
      return t.ok(t.api('pasto.salvar', { campos: campos }, { chave: 'seed:pasto:' + i }), 'pasto ' + x.nome).pasture_id;
    });
    t.ok(t.api('config.salvar', { valores: { data_marco_zero: d0, propriedade_padrao_id: prop.property_id } }, { chave: 'seed:config' }), 'marco zero');
    t.estado.fornecedor = t.ok(t.api('parceiro.salvar', { campos: { nome: 'Fazenda Vizinha (demonstração)', tipos: ['FORNECEDOR'] } }, { chave: 'seed:parceiro' }), 'fornecedor').partner_id;
    t.estado.comprador = t.ok(t.api('parceiro.salvar', { campos: { nome: 'Recriador da Região (demonstração)', tipos: ['COMPRADOR'] } }, { chave: 'seed:comprador' }), 'comprador').partner_id;
    t.estado.d0 = d0;
    t.estado.prop = prop.property_id;
    t.estado.pastos = pastos;
  }

  // ------------------------------------------------------------------ execução retomável ----
  function relatorioFinal_(run, cenarios) {
    var resumo = { cenarios: { PASSOU: 0, FALHOU: 0 }, passos: { PASSOU: 0, FALHOU: 0, NAO_SE_APLICA: 0, PENDENTE_NA_CONTA_DO_DONO: 0 } };
    cenarios.forEach(function (c) {
      resumo.cenarios[c.situacao] += 1;
      (c.passos || []).forEach(function (p) { resumo.passos[p.situacao] += 1; });
    });
    return {
      plano: run.plano, app_version: Api.APP_VERSION, iniciado_em: run.iniciado_em, terminado_em: Database.clock().agora(), completo: true,
      ok: resumo.cenarios.FALHOU === 0 && cenarios.length === CENARIOS.length, resumo: resumo, cenarios: cenarios, corpus: run.estado.corpus || null, demonstracao: run.estado.resultado || null,
    };
  }
  function limparArquivos_(run) {
    var files = FileService.porta();
    var p = props_().ler();
    var atual = p[Maintenance.chaveDoAmbiente(run.ambiente)];
    var bancos = run.estado.bancos || [];
    var removidos = { backups: 0, bancos: 0 };
    if (!bancos.length) return removidos;
    var ctx = Api.contexto({ ambiente: run.ambiente, usuario: run.usuario, props: p });
    Maintenance.listarBackups(ctx, { todos: true }).forEach(function (b) {
      if (bancos.indexOf(b.banco) >= 0 && files.lixeira(b.id)) removidos.backups += 1;
    });
    bancos.forEach(function (b) {
      if (b === atual) return;
      if (files.lixeira(b)) removidos.bancos += 1;
      [UnitOfWork.chaveVersao(b), UnitOfWork.chaveMarcador(b), 'IO_PRIMITIVE:' + b, 'INTEGRIDADE:' + b].forEach(function (k) { props_().remover(k); });
    });
    return removidos;
  }
  function executarPlano_(opcoes, plano) {
    var o = opcoes || {};
    if (vazio_(o.usuario)) throw Validation.erro('INTERNAL', 'runAcceptanceTests precisa do e-mail do dono.');
    var clock = Database.clock();
    var inicio = clock.agoraMs();
    var limite = typeof o.limiteMs === 'number' ? o.limiteMs : LIMITE_MS;
    var ambiente = plano === 'DEMO' ? 'DEMO' : 'TESTE';
    var etapas = plano === 'DEMO' ? null : CENARIOS;
    var cursor = o.reiniciar ? null : lerCursor_();
    if (cursor && cursor.plano !== plano) cursor = null;
    if (!cursor) limparCursor_(CENARIOS.length + 40);
    var run = cursor
      ? { plano: plano, id: cursor.id, ambiente: cursor.ambiente, iniciado_em: cursor.iniciado_em, proximo: cursor.proximo, estado: cursor.estado, usuario: o.usuario }
      : { plano: plano, id: Database.idGen().uuid().slice(0, 8), ambiente: ambiente, iniciado_em: clock.agora(), proximo: 0, estado: {}, usuario: o.usuario };
    gravarCursor_(run);
    var feitos = 0;
    if (plano === 'DEMO') {
      var passos = passosDemo_();
      var td = novoT_(run, o);
      if (run.proximo === 0) {
        prepararDemo_(td);
        run.proximo = 1;
        gravarCursor_(run);
      }
      var gen = geracaoDemo_(run.estado.d0);
      while (run.proximo - 1 < passos.length) {
        if (feitos > 0 && clock.agoraMs() - inicio > limite) {
          return { plano: plano, completo: false, proximo: passos[run.proximo - 1].nome, mensagem: 'Pausado perto do limite de tempo. Rode runAcceptanceTests de novo para continuar a base de demonstração.' };
        }
        try {
          passos[run.proximo - 1].executar(td, gen);
        } catch (e) {
          // Comando rejeitado derruba o seed (09, seção 7): o cursor fica no passo, para corrigir e rodar de novo.
          console.error('demonstração ' + passos[run.proximo - 1].nome + ': ' + texto_(e));
          return { plano: plano, completo: false, ok: false, proximo: passos[run.proximo - 1].nome, falha: curto_(texto_(e), 400), mensagem: 'A base de demonstração parou num comando recusado. Veja a falha; rode runAcceptanceTests de novo para retomar deste passo.' };
        }
        run.proximo += 1;
        feitos += 1;
        gravarCursor_(run);
      }
      var rel = { plano: plano, app_version: Api.APP_VERSION, iniciado_em: run.iniciado_em, terminado_em: clock.agora(), completo: true, ok: true, demonstracao: run.estado.resultado, faixa: Api.FAIXA_TESTE };
      rel.arquivo = salvarRelatorio_(rel, 'demonstração');
      limparCursor_(0);
      return rel;
    }
    while (run.proximo < etapas.length) {
      if (feitos > 0 && clock.agoraMs() - inicio > limite) {
        return { plano: plano, completo: false, proximo: etapas[run.proximo].id, feitos: run.proximo, total: etapas.length, mensagem: 'Pausado perto do limite de tempo. Rode runAcceptanceTests de novo para continuar do cenário ' + etapas[run.proximo].id + '.' };
      }
      var cen = etapas[run.proximo];
      var t = novoT_(run, o);
      var t0 = clock.agoraMs();
      var res = { id: cen.id, titulo: cen.titulo, situacao: SITUACAO.PASSOU, falha: null, ms: 0, passos: t.passos };
      try {
        cen.executar(t);
      } catch (e) {
        res.situacao = SITUACAO.FALHOU;
        res.falha = curto_((e && e.name === 'FalhaDeAceitacao' ? '' : 'Erro inesperado: ') + texto_(e), 400);
        console.error('aceitação ' + cen.id + ': ' + texto_(e) + (e && e.stack ? '\n' + String(e.stack).split('\n').slice(0, 5).join('\n') : ''));
      }
      res.ms = clock.agoraMs() - t0;
      gravarResultado_(run.proximo, res);
      run.proximo += 1;
      feitos += 1;
      if (cen.id === 'PREPARO' && res.situacao === SITUACAO.FALHOU) run.proximo = etapas.length;
      gravarCursor_(run);
    }
    var relatorio = relatorioFinal_(run, lerResultados_(etapas.length));
    relatorio.limpeza = limparArquivos_(run);
    relatorio.arquivo = salvarRelatorio_(relatorio, 'aceitação');
    limparCursor_(etapas.length);
    return relatorio;
  }
  function salvarRelatorio_(rel, rotulo) {
    var nome = 'ERP Pecuário — relatório de ' + rotulo + ' ' + rel.terminado_em + '.json';
    var g = FileService.porta().guardarArquivo({ nome: nome, mimeType: 'application/json', texto: JSON.stringify(rel, null, 2), pasta: 'testes', appProperties: { erp_tipo: 'RELATORIO_TESTES' } });
    return { nome: nome, id: g.id };
  }

  /**
   * Testes de aceitação (nível 2). opcoes: {usuario (obrigatório), plano ('ACEITACAO' | 'DEMO'; padrão TEST_PLAN ou
   * ACEITACAO), limiteMs (padrão 4 min), reiniciar, injetar: {ocuparLock, liberarLock} (só no Node)}. Devolve o
   * relatório (completo) ou {completo: false, proximo, mensagem} quando pausou pelo tempo.
   */
  function runAcceptanceTests(opcoes) {
    var o = opcoes || {};
    var plano = o.plano || props_().ler()[PROP_PLANO] || 'ACEITACAO';
    if (plano !== 'ACEITACAO' && plano !== 'DEMO') throw Validation.erro('VALIDATION', 'TEST_PLAN desconhecido: "' + plano + '". Use ACEITACAO ou DEMO.');
    return executarPlano_(o, plano);
  }

  // ------------------------------------------------------------------ diagnóstico (spike) ----
  /** Tira do relatório o que identifica a conta: e-mails e identificadores longos (IDs de arquivo). */
  function semSensiveis_(v) {
    if (typeof v === 'string') return v.replace(/[^\s@]+@[^\s@]+/g, '[e-mail]').replace(/[A-Za-z0-9_-]{25,}/g, '[id]');
    if (Array.isArray(v)) return v.map(semSensiveis_);
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = semSensiveis_(v[k]); });
      return out;
    }
    return v;
  }
  function medir_(fn) {
    var clock = Database.clock();
    var t0 = clock.agoraMs();
    var valor = fn();
    return { ms: clock.agoraMs() - t0, valor: valor };
  }
  /**
   * Diagnóstico do spike (desenho-base, seção 17), na conta do dono. opcoes: {usuario, linhas (massa do SP-05;
   * padrão 10000)}. Cada item: {id, titulo, situacao (OK | FALHOU | ALERTA | NAO_SE_APLICA), medidas, observacao}.
   * Tudo em planilhas temporárias na pasta Testes, que vão para a lixeira; não lê nem grava a base real.
   */
  function runDiagnostics(opcoes) {
    var o = opcoes || {};
    var files = FileService.porta();
    var clock = Database.clock();
    var itens = [];
    function item(id, titulo, fn) {
      try {
        var r = fn();
        itens.push({ id: id, titulo: titulo, situacao: r.situacao, medidas: r.medidas || null, observacao: r.observacao || null });
      } catch (e) {
        itens.push({ id: id, titulo: titulo, situacao: 'FALHOU', medidas: null, observacao: curto_(texto_(e), 300) });
      }
    }
    function temporaria(nome, fn) {
      var id = files.criarPlanilha('ERP Pecuário — diagnóstico: ' + nome + ' (temporária)', 'testes', { erp_tipo: 'DIAGNOSTICO' });
      try {
        return fn(id);
      } finally {
        files.lixeira(id);
      }
    }
    item('SP-01', 'Forma de gravação: corpus de tipos, coerção da célula Geral e atomicidade do batchUpdate', function () {
      return temporaria('gravação', function (id) {
        var corpus = Database.PRIMITIVAS.map(function (p) {
          var m = medir_(function () { return Database.corpus(id, p, { aba: 'DIAG_' + p }); });
          return { primitiva: p, ok: m.valor.ok, divergencias: m.valor.divergencias.length, ms: m.ms };
        });
        var geral = Database.diagnosticoCoercao(id);
        var atomico = Database.diagnosticoAtomicidade(id);
        var alguma = corpus.some(function (c) { return c.ok; });
        return {
          situacao: !alguma ? 'FALHOU' : corpus[0].ok && atomico.atomico ? 'OK' : 'ALERTA',
          medidas: { corpus: corpus, coercao_geral: geral, atomicidade: atomico },
          observacao: 'coercao_geral tem o formato de tests/fixtures/coercao.json: envie-o para conferir o fake. ' + (atomico.atomico ? 'batchUpdate atômico.' : 'batchUpdate NÃO foi atômico (o protocolo de três fases já presume isso).'),
        };
      });
    });
    item('SP-02', 'Escopo drive.file: criar, copiar, ler, listar, lixeira; planilha criada pelo Drive abre no SpreadsheetApp', function () {
      var sonda = files.sondar();
      var abre = temporaria('abertura', function (id) { return Object.keys(Database.abrir(id, { primitiva: 'SPREADSHEET_APP' }).meta().abas).length >= 1; });
      return { situacao: sonda.ok && abre ? 'OK' : 'FALHOU', medidas: { passos: sonda.passos, abre_no_spreadsheetapp: abre }, observacao: sonda.ok ? null : 'Contingência: escopo drive completo (guia de implantação).' };
    });
    item('SP-03', 'Lock: obter, conferir e soltar', function () {
      var lock = Database.lock();
      var m = medir_(function () { return lock.tentar(5000); });
      var tinha = lock.tem();
      lock.soltar();
      var soltou = !lock.tem();
      return { situacao: m.valor && tinha && soltou ? 'OK' : 'FALHOU', medidas: { obteve: m.valor, ms: m.ms, soltou: soltou }, observacao: 'Confere obter e soltar o lock. A disputa entre execuções paralelas se confere na página de concorrência (CT-10, passo 6); a liberação do lock quando uma execução morre por tempo não tem medida automática nesta versão.' };
    });
    item('SP-04', 'E-mail do usuário ativo', function () {
      var s = Api.diagnosticoSessao();
      return { situacao: s.email_ativo_preenchido ? 'OK' : 'ALERTA', medidas: s, observacao: 'Medido no editor. No Web App, e-mail vazio aparece como "acesso negado" com a instrução de ALLOW_EMPTY_ACTIVE_USER.' };
    });
    item('SP-05', 'Tempos de gravação e leitura com massa gerada; custo de ler as propriedades', function () {
      var n = typeof o.linhas === 'number' && o.linhas > 0 ? Math.floor(o.linhas) : 10000;
      return temporaria('desempenho', function (id) {
        var io = Database.abrir(id, { primitiva: Maintenance.primitivaDoBanco(props_().ler(), id) });
        io.criarTabelas(['EVENTO_ANIMAIS']);
        var hex = function (i) { var s = i.toString(16); while (s.length < 12) s = '0' + s; return s; };
        var linha = function (i) { return { event_animal_id: '00000000-0000-4000-8000-' + hex(i), event_id: '00000000-0000-4000-9000-' + hex(i % 997), animal_id: '00000000-0000-4000-a000-' + hex(i % 500), papel: 'SUJEITO', efeito_inventario: 0 }; };
        io.ler(['EVENTO_ANIMAIS']);
        var grava = medir_(function () {
          for (var b = 0; b < n; b += 2000) {
            var bloco = [];
            for (var i = b; i < Math.min(n, b + 2000); i++) bloco.push(linha(i));
            io.anexar({ EVENTO_ANIMAIS: bloco });
          }
          io.flush();
        });
        io.esquecer();
        var le = medir_(function () { return io.ler(['EVENTO_ANIMAIS']).EVENTO_ANIMAIS.registros.length; });
        var anexa = medir_(function () { var x = []; for (var i = n; i < n + 5; i++) x.push(linha(i)); io.anexar({ EVENTO_ANIMAIS: x }); io.flush(); });
        var props = medir_(function () { for (var i = 0; i < 5; i++) props_().ler(); });
        return {
          situacao: le.valor === n ? 'OK' : 'FALHOU',
          medidas: { linhas: n, gravacao_ms: grava.ms, leitura_ms: le.ms, lidas: le.valor, anexar_5_ms: anexa.ms, propriedades_ms_por_leitura: Math.round(props.ms / 5) },
          observacao: 'Orçamento do desenho: comando p95 ≤ 5 s com 10 mil linhas em EVENTO_ANIMAIS e ≤ 15 s com 100 mil. Pelo editor, a massa medida é a de 10 mil linhas.',
        };
      });
    });
    item('SP-06', 'Rascunho no navegador', function () {
      return { situacao: 'NAO_SE_APLICA', observacao: 'Decidido (seção 17): localStorage com try/catch e, se indisponível, rascunho.salvar no servidor. Conferir no celular com a interface.' };
    });
    item('SP-07', 'Exportação XLSX e PDF', function () {
      return { situacao: 'NAO_SE_APLICA', observacao: 'CSV no cliente na Fase 1; XLSX e PDF chegam na Fase 5.' };
    });
    item('SP-08', 'Gráficos', function () {
      return { situacao: 'NAO_SE_APLICA', observacao: 'Decidido: gráficos SVG próprios, sem biblioteca externa.' };
    });
    item('SP-09', 'Gatilhos do sistema', function () {
      var g = Maintenance.listarGatilhos();
      var funcoes = g.map(function (x) { return x.funcao; }).sort();
      var esperado = Maintenance.GATILHOS.map(function (x) { return x.funcao; }).sort();
      return { situacao: JSON.stringify(funcoes) === JSON.stringify(esperado) ? 'OK' : 'ALERTA', medidas: { total: g.length, funcoes: funcoes }, observacao: g.length ? null : 'Nenhum gatilho: rode setup.' };
    });
    item('SP-10', 'Formato de texto em linhas novas (SpreadsheetApp)', function () {
      return { situacao: 'NAO_SE_APLICA', observacao: 'Só vale com a forma SPREADSHEET_APP, que aplica o formato de texto a cada bloco gravado; o corpus do SP-01 confere.' };
    });
    item('RUNTIME', 'Fuso no runtime V8 (Intl) × Utilities.formatDate', function () {
      var agora = clock.agora();
      var r = ['America/Porto_Velho', 'America/Sao_Paulo', 'Etc/GMT'].map(function (f) { var x = Database.diagnosticoFuso(agora, f); return { fuso: f, igual: x.utils === x.utilities }; });
      return { situacao: r.every(function (x) { return x.igual; }) ? 'OK' : 'FALHOU', medidas: { fusos: r } };
    });
    // O corpus é constante do código (nada da conta): fica fora da limpeza, para ser comparado com o fixture.
    var corpusGeral = null;
    itens.forEach(function (i) { if (i.medidas && i.medidas.coercao_geral) { corpusGeral = i.medidas.coercao_geral; delete i.medidas.coercao_geral; } });
    var rel = semSensiveis_({ gerado_em: clock.agora(), app_version: Api.APP_VERSION, ok: itens.every(function (i) { return i.situacao !== 'FALHOU'; }), itens: itens });
    if (corpusGeral) rel.itens.filter(function (i) { return i.id === 'SP-01'; })[0].medidas.coercao_geral = corpusGeral;
    var nome = 'ERP Pecuário — diagnóstico ' + rel.gerado_em + '.json';
    files.guardarArquivo({ nome: nome, mimeType: 'application/json', texto: JSON.stringify(rel, null, 2), pasta: 'testes', appProperties: { erp_tipo: 'DIAGNOSTICO' } });
    rel.arquivo = nome;
    return rel;
  }

  // ------------------------------------------------------------------ página de concorrência (CT-10, passo 6) ----
  /**
   * HTML autocontido servido por doGet(?pagina=concorrencia): dispara ao mesmo tempo 5 gravações com chaves diferentes
   * e 2 com a mesma chave na BASE DE TESTE (ambiente TESTE; o servidor resolve o banco por TEST_SPREADSHEET_ID) e
   * confere: 7 respostas boas, 1 duplicada, 6 eventos com event_seq distintos.
   */
  function paginaConcorrencia() {
    return [
      '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">',
      '<style>body{font:16px/1.5 system-ui,sans-serif;margin:16px;color:#1b1b1b;background:#fff}button{min-height:48px;padding:0 20px;font-size:16px}pre{white-space:pre-wrap;background:#f4f4f4;padding:12px}.faixa{background:#ffd54f;padding:4px 8px;font-weight:700}</style></head>',
      '<body><main><p class="faixa">BASE DE TESTE</p><h1>Teste de concorrência</h1>',
      '<p>Dispara 7 gravações ao mesmo tempo na base de teste: 5 com chaves diferentes e 2 com a mesma chave. Esperado: 6 eventos com números distintos e 1 resposta repetida.</p>',
      '<button id="ir" type="button">Executar o teste</button><pre id="saida" aria-live="polite"></pre></main>',
      '<script>',
      '(function () {',
      '  var saida = document.getElementById("saida");',
      '  function log(t) { saida.textContent += t + "\\n"; }',
      '  function chamar(p) { return new Promise(function (ok) { google.script.run.withSuccessHandler(ok).withFailureHandler(function (e) { ok({ ok: false, error: { code: "TRANSPORTE", message: String(e && e.message || e) } }); }).api(p); }); }',
      '  function comRetentativa(p, n) { return chamar(p).then(function (r) { if (!r.ok && r.error.code === "LOCKED" && n > 0) { return new Promise(function (f) { setTimeout(f, 2000); }).then(function () { return comRetentativa(p, n - 1); }); } return r; }); }',
      '  document.getElementById("ir").onclick = function () {',
      '    var botao = this; botao.disabled = true; saida.textContent = "";',
      '    chamar({ rota: "sistema.bootstrap", ambiente: "TESTE", dados: {} }).then(function (b) {',
      '      if (!b.ok) { log("Base de teste indisponível: " + b.error.message); botao.disabled = false; return; }',
      '      var pasto = (b.data.pastos || []).filter(function (p) { return p.status === "ATIVO"; })[0];',
      '      var marco = (b.data.configuracoes.itens || []).filter(function (i) { return i.chave === "data_marco_zero"; })[0];',
      '      if (!pasto || !marco || !marco.valor) { log("Rode runAcceptanceTests antes: a base de teste precisa de pasto ativo e marco zero."); botao.disabled = false; return; }',
      '      var dia = new Date(Date.parse(marco.valor + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);',
      '      var rodada = String(Math.floor(Math.random() * 90000) + 10000);',
      '      function pedido(chave, brinco) { return { rota: "evento.registrar", ambiente: "TESTE", idempotencyKey: "concorrencia:" + rodada + ":" + chave, avisosAceitos: [], dados: { tipo: "OUTRA_ENTRADA", campos: { event_date: dia, description: "Teste de concorrência" }, animais: [{ brinco: "C" + rodada + brinco, sexo: "F", origem: "DESCONHECIDA", pasto_destino_id: pasto.pasture_id }] } }; }',
      '      var pedidos = [0, 1, 2, 3, 4].map(function (i) { return pedido(String(i), String(i)); }).concat([pedido("dup", "9"), pedido("dup", "9")]);',
      '      log("Enviando 7 pedidos ao mesmo tempo...");',
      '      Promise.all(pedidos.map(function (p) { return comRetentativa(p, 5); })).then(function (rs) {',
      '        var boas = rs.filter(function (r) { return r.ok; });',
      '        var dup = boas.filter(function (r) { return r.meta.duplicado; }).length;',
      '        var ids = boas.map(function (r) { return r.data.event_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });',
      '        rs.forEach(function (r, i) { log("Pedido " + (i + 1) + ": " + (r.ok ? (r.meta.duplicado ? "repetido (duplicado)" : "gravado") : r.error.code + " — " + r.error.message)); });',
      '        chamar({ rota: "evento.listar", ambiente: "TESTE", dados: { tipo: "OUTRA_ENTRADA", por_pagina: 500 } }).then(function (l) {',
      '          var seqs = l.ok ? l.data.itens.filter(function (e) { return ids.indexOf(e.event_id) >= 0; }).map(function (e) { return e.event_seq; }) : [];',
      '          var distintos = seqs.filter(function (v, i, a) { return a.indexOf(v) === i; }).length;',
      '          var aprovado = boas.length === 7 && dup === 1 && ids.length === 6 && distintos === 6;',
      '          log("");',
      '          log((aprovado ? "APROVADO" : "REPROVADO") + ": " + boas.length + " respostas boas, " + dup + " repetida(s), " + ids.length + " eventos, " + distintos + " números de evento distintos (esperado 7, 1, 6, 6).");',
      '          botao.disabled = false;',
      '        });',
      '      });',
      '    });',
      '  };',
      '})();',
      '</script></body></html>',
    ].join('\n');
  }

  return {
    SITUACAO: SITUACAO,
    LIMITE_MS: LIMITE_MS,
    CENARIOS: CENARIOS.map(function (c) { return c.id; }),
    runAcceptanceTests: runAcceptanceTests,
    runDiagnostics: runDiagnostics,
    paginaConcorrencia: paginaConcorrencia,
    geracaoDemo: geracaoDemo_,
  };
})();
