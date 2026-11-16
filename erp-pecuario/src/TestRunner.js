/**
 * TestRunner — testes de nível 2 e base de demonstração (09-plano-de-testes.md, seções 1, 7 e 8; desenho-base 9 e 17).
 *
 * runAcceptanceTests: cria pela Drive API uma planilha temporária ("ERP Pecuário — BASE DE TESTE", pasta Testes, ID em
 * TEST_SPREADSHEET_ID), roda nela o setup e os cenários de aceitação das Fases 1 e 2 com os serviços reais — sempre pela
 * Api, com `ambiente: 'TESTE'` —, grava o relatório em JSON na pasta Testes e nunca toca a base real (SPREADSHEET_ID e a
 * versão dela são conferidos no fim). É retomável: perto de 4 minutos para, guarda o cursor e continua na chamada
 * seguinte. Os MESMOS cenários rodam no Node (tests/acceptance.test.js), sobre os fakes do harness. O que só se prova
 * com duas execuções reais (lock disputado) entra por `opcoes.injetar` no Node e fica para a página de concorrência
 * na conta do dono.
 * Com TEST_PLAN = DEMO, gera a base de demonstração (a composição de 09, seção 7: 304 ativos e três anos de eventos, só
 * pelos comandos, sem nenhuma recusa) na planilha DEMO.
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
  /** Pesagem individual em balança (momento rotina): itens = [{animal_id, peso}]. */
  function pesagem_(data, itens, campos) {
    var c = { event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' };
    Object.keys(campos || {}).forEach(function (k) { c[k] = campos[k]; });
    return { tipo: 'PESAGEM', campos: c, animais: itens };
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

  // ------------------------------------------------------------------ cenários de aceitação (Fases 1 e 2) ----
  /**
   * Cada CT roda só com o que as fases entregues trazem (09, seção 8, "cenário que usa peça de fase posterior"); a
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
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('CT-09'); });
      },
    },
    // ---------------------------------------------------------------- cenários da Fase 2 (09, seções 3, 4 e 8) ----
    // As datas do 09 (marco zero em 01/01/2026) viram dias contados do marco zero desta base (D0+n). Cada cenário
    // tem os seus pastos: na base compartilhada, a contagem por pasto em cada data fica exata.
    {
      id: 'CT-01', titulo: 'Nascimento: o parto cria a cria no pasto da mãe e atualiza a matriz',
      executar: function (t) {
        var P = t.pastos('CT-01', ['Pasto 1', 'Pasto 2']);
        var ids;
        var ev;
        var cria;
        t.passo('massa', 'Matriz 0102 (nascida 1.753 dias antes do marco zero, sem parto) no Pasto 1 e a vaca 0103 (dois partos) no Pasto 2', function () {
          ids = ids_(t.cmd('evento.registrar', entrada_([
            bicho_(t, { brinco: '0102', raca: 'NELORE', data_nascimento: t.dia(-1753), pasto_destino_id: P['Pasto 1'] }),
            bicho_(t, { brinco: '0103', data_nascimento: t.dia(-2500), partos_previos: 2, pasto_destino_id: P['Pasto 2'] }),
          ]), 'ct01-massa'));
        });
        t.passo('1', 'Parto em D0+254: cria macho de 32,0 kg, sem brinco; tabelas, inventário nas datas, cria e matriz', function () {
          var r = t.cmd('evento.registrar', nascimento_(t.dia(254), ids['0102'], [{ situacao_nascimento: 'VIVO', sexo: 'M', peso: 32, metodo_pesagem: 'BALANCA' }]), 'ct01-parto');
          ev = r.event_id;
          var e = t.evento(ev);
          igual_([e.event_type, e.event_date, e.registration_date, e.status], ['NASCIMENTO', t.dia(254), t.hoje(), 'CONFIRMADO'], 'EVENTOS');
          var ea = t.doEvento('EVENTO_ANIMAIS', ev);
          var linhaCria = ea.filter(function (l) { return l.papel === 'CRIA'; })[0];
          var linhaMae = ea.filter(function (l) { return l.papel === 'MATRIZ'; })[0];
          igual_([ea.length, linhaCria.efeito_inventario, linhaCria.pasto_destino_id, linhaMae.animal_id, linhaMae.efeito_inventario], [2, 1, P['Pasto 1'], ids['0102'], 0], 'EVENTO_ANIMAIS: CRIA +1 e MATRIZ 0');
          cria = linhaCria.animal_id;
          igual_(t.doEvento('PESAGENS', ev).map(function (p) { return [p.animal_id, p.tipo, p.peso_kg]; }), [[cria, 'NASCIMENTO', 32]], 'PESAGENS');
          igual_(t.doEvento('REPRODUCAO', ev).map(function (p) { return [p.animal_id, p.tipo_evento, p.qtd_nascidos_vivos, p.qtd_natimortos]; }), [[ids['0102'], 'PARTO', 1, 0]], 'REPRODUCAO');
          igual_(t.doEvento('FINANCEIRO', ev).length, 0, 'FINANCEIRO: nascido não tem custo de aquisição');
          igual_([t.noPasto(P['Pasto 1'], t.dia(253)), t.noPasto(P['Pasto 1'], t.dia(254))], [1, 2], 'Pasto 1 com 1 cabeça na véspera e 2 no dia do parto');
          var a = t.animal(cria);
          igual_([a.situacao_cadastral, a.origem, a.mae_id, a.pasto_atual_id, a.peso_atual, a.custo_aquisicao, a.brinco], ['ATIVO', 'NASCIDO', ids['0102'], P['Pasto 1'], 32, 0, null], 'cria');
          igual_(t.ficha(cria).geral.categoria.codigo, 'BEZERRO', 'categoria da cria');
          var semBrinco = t.ok(t.api('alerta.listar', {}), 'alertas').alertas.filter(function (x) { return x.codigo === 'SEM_BRINCO'; })[0];
          verificar_(semBrinco && semBrinco.ids.indexOf(cria) >= 0, 'a cria aparece na pendência "sem brinco"');
          var mae = t.animal(ids['0102']);
          igual_([mae.situacao_reprodutiva, mae.cria_ao_pe, t.ficha(ids['0102']).reprodutivo.n_partos], ['VAZIA', true, 1], 'matriz: 1 parto, vazia, com cria ao pé');
          var cat = function (d) { return t.ok(t.api('inventario.posicao', { data: d, animal_id: ids['0102'] }), 'posição do animal').categoria.codigo; };
          igual_([cat(t.dia(253)), cat(t.dia(254))], ['NOVILHA_24_MAIS', 'VACA'], 'a matriz passa de novilha a vaca no dia do parto');
        });
        t.passo('2', 'Nome da matriz pelo cadastro (AUDITORIA) e sexo da cria por correção (AJUSTES); o valor de criação segue M', function () {
          var aud0 = t.tabela('AUDITORIA').length;
          var aj0 = t.tabela('AJUSTES').length;
          t.cmd('animal.editar', { animal_id: ids['0102'], campos: { nome: 'Mimosa' } }, 'ct01-nome');
          t.cmd('animal.editar', { animal_id: cria, campos: { sexo: 'F' }, justificativa: 'Sexo conferido no curral' }, 'ct01-sexo');
          igual_(t.tabela('AUDITORIA').slice(aud0).map(function (x) { return [x.entity_id, x.campo, x.valor_novo]; }), [[ids['0102'], 'nome', 'Mimosa']], 'AUDITORIA');
          igual_(t.tabela('AJUSTES').slice(aj0).map(function (x) { return [x.animal_id, x.campo, x.valor_anterior, x.valor_novo]; }), [[cria, 'sexo', 'M', 'F']], 'AJUSTES');
          var linha = t.doEvento('EVENTO_ANIMAIS', ev).filter(function (l) { return l.papel === 'CRIA'; })[0];
          igual_([linha.atributos_iniciais_json.sexo, t.animal(cria).sexo, t.ficha(cria).geral.categoria.codigo], ['M', 'F', 'BEZERRA'], 'criação imutável, sexo corrigido, categoria refeita');
        });
        t.passo('3', 'Variante: um vivo e um natimorto → +1 cabeça; uma linha de parto com 1 vivo e 1 natimorto', function () {
          var antes = t.noPasto(P['Pasto 2']);
          var r = t.cmd('evento.registrar', nascimento_(t.dia(273), ids['0103'], [{ situacao_nascimento: 'VIVO', sexo: 'F' }, { situacao_nascimento: 'NATIMORTO' }], { tipo_parto: 'ASSISTIDO' }), 'ct01-gemelar');
          igual_(t.noPasto(P['Pasto 2']), antes + 1, 'só o vivo entra no rebanho');
          igual_(t.doEvento('REPRODUCAO', r.event_id).map(function (p) { return [p.qtd_nascidos_vivos, p.qtd_natimortos, p.tipo_parto]; }), [[1, 1, 'ASSISTIDO']], 'REPRODUCAO');
          igual_(t.doEvento('EVENTO_ANIMAIS', r.event_id).filter(function (l) { return l.papel === 'CRIA'; }).length, 1, 'natimorto não cria animal');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('CT-01'); });
      },
    },
    {
      id: 'CT-02', titulo: 'Transferência coletiva: tudo ou nada, reenvio com a mesma chave, inventário nas datas',
      executar: function (t) {
        var P = t.pastos('CT-02', ['Pasto 1', 'Pasto 2']);
        var ids;
        var brincos = ['0201', '0202', '0203', '0204', '0205', '0206', '0207', '0208', '0209', '0210'];
        var chave = t.chave('ct02-transferencia');
        var ev;
        t.passo('massa', '0201 a 0210 no Pasto 1 e 0211 no Pasto 2 em D0', function () {
          ids = ids_(t.cmd('evento.registrar', entrada_(brincos.map(function (b) { return bicho_(t, { brinco: b, pasto_destino_id: P['Pasto 1'] }); })
            .concat([bicho_(t, { brinco: '0211', pasto_destino_id: P['Pasto 2'] })])), 'ct02-massa'));
        });
        t.passo('1', 'Transferência em D0+59 do Pasto 1 para o Pasto 2 com 0211 por engano: VALIDATION com um detalhe; nada gravado, nem em OPERACOES', function () {
          var antes = t.retrato();
          var v0 = t.versao();
          var e = t.erro(t.api('evento.registrar', transf_(t.dia(59), P['Pasto 1'], P['Pasto 2'], brincos.concat(['0211']).map(function (b) { return ids[b]; })), { chave: chave }), 'VALIDATION', 'com o 0211');
          igual_(e.details.map(function (d) { return [d.codigo, d.animal_id]; }), [['ORIGEM_DIVERGENTE', ids['0211']]], 'um detalhe: o 0211 estava no Pasto 2');
          var depois = t.retrato();
          Object.keys(antes).forEach(function (aba) { verificar_(antes[aba] === depois[aba], 'a aba ' + aba + ' mudou depois da recusa'); });
          igual_(t.versao(), v0, 'a versão dos dados não muda');
          igual_(t.ok(t.api('operacao.status', { chave: chave }), 'status').situacao, 'INEXISTENTE', 'a chave não foi consumida');
        });
        t.passo('2', 'Reenvio sem o 0211 com a mesma chave: grava; hoje Pasto 1 = 0 e Pasto 2 = 11; em D0+58, 10 e 1; 10 linhas de efeito 0', function () {
          var env = t.api('evento.registrar', transf_(t.dia(59), P['Pasto 1'], P['Pasto 2'], brincos.map(function (b) { return ids[b]; })), { chave: chave });
          ev = t.ok(env, 'reenvio').event_id;
          verificar_(env.meta.duplicado === false, 'o reenvio corrigido é gravação nova (a recusa não consumiu a chave)');
          igual_([t.noPasto(P['Pasto 1']), t.noPasto(P['Pasto 2'])], [0, 11], 'hoje');
          igual_([t.noPasto(P['Pasto 1'], t.dia(58)), t.noPasto(P['Pasto 2'], t.dia(58))], [10, 1], 'na véspera');
          var ea = t.doEvento('EVENTO_ANIMAIS', ev);
          verificar_(ea.length === 10 && ea.every(function (l) { return l.efeito_inventario === 0 && l.pasto_origem_id === P['Pasto 1'] && l.pasto_destino_id === P['Pasto 2']; }), '10 linhas, efeito 0, do Pasto 1 para o Pasto 2');
        });
        t.passo('3', 'Histórico do 0201: entrada em D0 e transferência em D0+59; 59 dias no Pasto 1 (o dia da saída não conta)', function () {
          var f = t.ficha(ids['0201']);
          var per = f.pastos.periodos;
          igual_(per.map(function (p) { return [p.pasture_id, p.inicio, p.fim, p.entrada.event_type, p.saida ? p.saida.event_type : null]; }),
            [[P['Pasto 1'], t.estado.d0, t.dia(59), 'ENTRADA_INICIAL', 'TRANSFERENCIA'], [P['Pasto 2'], t.dia(59), null, 'TRANSFERENCIA', null]], 'períodos');
          igual_(f.pastos.por_pasto.filter(function (x) { return x.pasture_id === P['Pasto 1']; })[0].dias, 59, 'dias no Pasto 1');
        });
        t.passo('fim', 'Projeção = reconstrução', function () { return t.integra('CT-02'); });
      },
    },
    {
      id: 'CT-03', titulo: 'Compra: cadastro individual e o financeiro completo do evento (lançamentos, parcelas, alocações)',
      executar: function (t) {
        var P = t.pastos('CT-03', ['Pasto 2']);
        var f1 = t.parceiro('Fornecedor F1 (CT-03)', ['FORNECEDOR'], 'ct03-f1');
        var t1 = t.parceiro('Transportes T1 (CT-03)', ['TRANSPORTADOR'], 'ct03-t1');
        var animais = [];
        for (var i = 1; i <= 20; i++) animais.push(garrote_('03' + (i < 10 ? '0' : '') + i, { peso: 240 }));
        var dados = {
          tipo: 'COMPRA', campos: { event_date: t.dia(35), partner_id: f1, pasto_destino_id: P['Pasto 2'], finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 250000, valor_animais: 5000000 },
          animais: animais,
          parcelas: [{ data_vencimento: t.dia(65), valor: 2500000, forma_pagamento: 'BOLETO' }, { data_vencimento: t.dia(95), valor: 2500000, forma_pagamento: 'BOLETO' }],
          custos: [{ tipo: 'FRETE', valor: 120000, partner_id: t1, data_vencimento: t.dia(40), forma_pagamento: 'PIX' }],
        };
        var chave = 'ct03-compra';
        t.passo('1', 'Parcelas de 25.000,00 e 24.000,00 para 50.000,00: VALIDATION, nada gravado', function () {
          var errado = JSON.parse(JSON.stringify(dados));
          errado.parcelas[1].valor = 2400000;
          var e = t.recusa('evento.registrar', errado, 'VALIDATION', chave);
          igual_(e.details.map(function (d) { return d.codigo; }), ['PARCELAS_NAO_SOMAM'], 'código');
        });
        t.passo('2', 'Compra certa (mesma chave): 20 animais COMPRADO no Pasto 2, custo 2.560,00; 2 lançamentos, 3 parcelas, 40 alocações (100%); a pagar +51.200,00', function () {
          var antes = t.titulos();
          var r = t.cmd('evento.registrar', dados, chave);
          var ev = r.event_id;
          var criados = r.animais.map(function (a) { return a.animal_id; });
          var linhas = t.tabela('ANIMAIS').filter(function (a) { return criados.indexOf(a.animal_id) >= 0; });
          verificar_(linhas.length === 20 && linhas.every(function (a) { return a.situacao_cadastral === 'ATIVO' && a.origem === 'COMPRADO' && a.pasto_atual_id === P['Pasto 2'] && a.custo_aquisicao === 256000 && a.peso_atual === 240; }), '20 animais ATIVO, COMPRADO, no Pasto 2, custo 2.560,00, 240,0 kg');
          igual_([t.doEvento('IDENTIFICACOES', ev).length, t.doEvento('PESAGENS', ev).filter(function (p) { return p.tipo === 'COMPRA' && p.peso_kg === 240; }).length], [20, 20], 'IDENTIFICACOES e PESAGENS (COMPRA)');
          var cp = t.doEvento('COMPRAS', ev);
          igual_(cp.map(function (c) { return [c.qtd_animais, c.valor_animais, c.frete, c.valor_total, c.criterio_rateio]; }), [[20, 5000000, 120000, 5120000, 'CABECAS']], 'COMPRAS');
          igual_(t.evento(ev).partner_id, f1, 'fornecedor do evento');
          var fin = t.doEvento('FINANCEIRO', ev);
          igual_(fin.map(function (f) { return [f.natureza, f.valor, f.partner_id, f.status, f.status_pagamento]; }), [['AQUISICAO_ANIMAIS', 5000000, f1, 'ATIVO', 'ABERTO'], ['AQUISICAO_ANIMAIS', 120000, t1, 'ATIVO', 'ABERTO']], 'FINANCEIRO');
          var fids = fin.map(function (f) { return f.financial_id; });
          var parcelas = t.tabela('PARCELAS').filter(function (p) { return fids.indexOf(p.financial_id) >= 0; });
          igual_(parcelas.map(function (p) { return [p.valor, p.status, p.data_vencimento]; }), [[2500000, 'ABERTA', t.dia(65)], [2500000, 'ABERTA', t.dia(95)], [120000, 'ABERTA', t.dia(40)]], 'PARCELAS');
          var aloc = t.tabela('ALOCACOES_FINANCEIRAS').filter(function (x) { return fids.indexOf(x.financial_id) >= 0; });
          igual_([aloc.length, soma_(aloc.filter(function (x) { return x.financial_id === fids[0]; }), 'valor_alocado'), soma_(aloc.filter(function (x) { return x.financial_id === fids[1]; }), 'valor_alocado')], [40, 5000000, 120000], '40 alocações, 100% de cada lançamento');
          verificar_(aloc.every(function (x) { return x.valor_alocado === (x.financial_id === fids[0] ? 250000 : 6000); }), '2.500,00 e 60,00 por animal');
          var depois = t.titulos();
          igual_([depois.a_pagar - antes.a_pagar, depois.a_receber - antes.a_receber], [5120000, 0], 'a pagar +51.200,00');
        });
        t.passo('3', 'Inventário do Pasto 2: 0 em D0+34 e 20 em D0+35', function () {
          igual_([t.noPasto(P['Pasto 2'], t.dia(34)), t.noPasto(P['Pasto 2'], t.dia(35))], [0, 20], 'Pasto 2');
        });
        t.naoSeAplica('4', 'Resultado gerencial do mês da compra: 0,00 (compra não é custeio)', 'O resultado gerencial chega com o módulo Financeiro (Fase 4); a compra já grava os lançamentos com a natureza que ele usa.');
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('CT-03'); });
      },
    },
    {
      id: 'CT-04', titulo: 'Venda por kg vivo: baixa, receita e comissão rateadas pelo peso, histórico preservado',
      executar: function (t) {
        var P = t.pastos('CT-04', ['Pasto 1']);
        var c1 = t.parceiro('Comprador C1 (CT-04)', ['COMPRADOR'], 'ct04-c1');
        var brincos = ['0401', '0402', '0403', '0404', '0405'];
        var pesos = [450, 462, 438, 471, 455];
        var ids;
        t.passo('massa', '0401 a 0405 no Pasto 1 em D0, sem valor de abertura', function () {
          ids = ids_(t.cmd('evento.registrar', entrada_(brincos.map(function (b) { return bicho_(t, { brinco: b, sexo: 'M', castrado: true, data_nascimento: t.dia(-900), pasto_destino_id: P['Pasto 1'] }); })), 'ct04-massa'));
        });
        t.passo('1', 'Venda em D0+231 a R$ 10,00/kg (2.276,0 kg), comissão de 455,20, recebimento em D0+261: revisão pelo servidor e gravação', function () {
          var dados = {
            tipo: 'VENDA', campos: { event_date: t.dia(231), partner_id: c1, finalidade: 'RECRIA_ENGORDA', modalidade: 'KG_VIVO', preco_unitario: 1000, valor_bruto: 2276000 },
            animais: brincos.map(function (b, i) { return { animal_id: ids[b], peso: pesos[i] }; }),
            parcelas: [{ data_vencimento: t.dia(261), forma_pagamento: 'TRANSFERENCIA' }], deducoes: [{ tipo: 'COMISSAO', valor: 45520 }],
          };
          var sim = t.api('evento.simular', { acao: 'registrar', dados: dados });
          var v = t.ok(sim, 'revisão').impactos.venda;
          igual_([v.receita, v.comissao, v.resultado_negociacao, v.criterio], [2276000, 45520, 2230480, 'PESO_VIVO'], 'a revisão mostra receita, comissão e resultado da negociação (22.304,80)');
          var antes = t.titulos();
          var r = t.cmd('evento.registrar', dados, 'ct04-venda', { versao: sim.meta.dataVersion });
          var ev = r.event_id;
          igual_([t.noPasto(P['Pasto 1'], t.dia(230)), t.noPasto(P['Pasto 1'], t.dia(231))], [5, 0], 'Pasto 1 com 5 na véspera e 0 no dia');
          verificar_(brincos.every(function (b) { var a = t.animal(ids[b]); return a.situacao_cadastral === 'VENDIDO' && a.data_saida === t.dia(231) && a.pasto_atual_id === null; }), 'VENDIDO, com a data de saída e sem pasto');
          var vd = t.doEvento('VENDAS', ev);
          igual_(vd.map(function (x) { return [x.qtd_animais, x.peso_vivo_total_kg, x.valor_bruto, x.comissao, x.criterio_rateio]; }), [[5, 2276, 2276000, 45520, 'PESO_VIVO']], 'VENDAS');
          var ea = t.doEvento('EVENTO_ANIMAIS', ev);
          verificar_(ea.length === 5 && ea.every(function (l) { return l.efeito_inventario === -1 && l.pasto_origem_id === P['Pasto 1']; }), '5 saídas (−1) do Pasto 1');
          igual_(mapa_(t.doEvento('PESAGENS', ev), 'animal_id', function (p) { return p.tipo + ' ' + p.peso_kg; }), mapa_(brincos.map(function (b, i) { return { id: ids[b], p: 'VENDA ' + pesos[i] }; }), 'id', 'p'), 'PESAGENS (VENDA)');
          igual_(t.evento(ev).partner_id, c1, 'comprador do evento');
          var fin = t.doEvento('FINANCEIRO', ev);
          igual_(fin.map(function (f) { return [f.natureza, f.valor]; }), [['RECEITA_VENDA_ANIMAIS', 2276000], ['DESPESA_VENDA', 45520]], 'receita e comissão');
          igual_(t.tabela('PARCELAS').filter(function (p) { return p.financial_id === fin[0].financial_id; }).map(function (p) { return [p.data_vencimento, p.valor, p.status]; }), [[t.dia(261), 2276000, 'ABERTA']], 'parcela da receita');
          var porAnimal = function (f) { return mapa_(t.tabela('ALOCACOES_FINANCEIRAS').filter(function (x) { return x.financial_id === f.financial_id; }), 'animal_id', 'valor_alocado'); };
          var esperado = function (vals) { var o = {}; brincos.forEach(function (b, i) { o[ids[b]] = vals[i]; }); return o; };
          igual_(porAnimal(fin[0]), esperado([450000, 462000, 438000, 471000, 455000]), 'receita alocada pelo peso');
          igual_(porAnimal(fin[1]), esperado([9000, 9240, 8760, 9420, 9100]), 'comissão alocada pelo peso (87,60 a 94,20)');
          var depois = t.titulos();
          igual_([depois.a_receber - antes.a_receber, depois.a_pagar - antes.a_pagar], [2276000, 45520], 'a receber +22.760,00 e a pagar +455,20');
        });
        t.passo('2', 'Ficha do 0401: a entrada e a venda continuam no histórico', function () {
          var f = t.ficha(ids['0401']);
          igual_([f.geral.situacao_cadastral, f.eventos.itens.map(function (x) { return [x.event_type, x.vigente]; })], ['VENDIDO', [['ENTRADA_INICIAL', true], ['VENDA', true]]], 'ficha');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('CT-04'); });
      },
    },
    {
      id: 'CT-05', titulo: 'Pesagem: as pesagens se acumulam; ganho, GMD e variação calculados na leitura; peso 0 recusado e variação brusca com aviso',
      executar: function (t) {
        var P = t.pastos('CT-05', ['Pasto 1']);
        var id;
        var ev = [];
        // As datas do desenho (10/03, 09/06, 19/06 e 29/06) contadas do marco zero: D0+68, +159, +169 e +179 (91 e 10 dias).
        t.passo('massa', '0501 no Pasto 1 em D0', function () {
          id = ids_(t.cmd('evento.registrar', entrada_([bicho_(t, { brinco: '0501', sexo: 'M', castrado: true, data_nascimento: t.dia(-500), pasto_destino_id: P['Pasto 1'] })]), 'ct05-massa'))['0501'];
        });
        t.passo('1-3', 'Pesagens de 300,0 kg (D0+68), 372,8 kg (D0+159) e 380,0 kg (D0+169), na balança; a resposta traz o ganho contra a anterior', function () {
          ev.push(t.cmd('evento.registrar', pesagem_(t.dia(68), [{ animal_id: id, peso: 300.0 }]), 'ct05-p1'));
          ev.push(t.cmd('evento.registrar', pesagem_(t.dia(159), [{ animal_id: id, peso: 372.8 }]), 'ct05-p2'));
          ev.push(t.cmd('evento.registrar', pesagem_(t.dia(169), [{ animal_id: id, peso: 380.0 }]), 'ct05-p3'));
          var c = ev[1].pesagem.animais[0];
          igual_([c.anterior.peso_kg, c.ganho_kg, c.dias, c.gmd_kg_dia, c.variacao_pct], [300, 72.8, 91, 0.8, 24.27], 'segunda pesagem contra a primeira');
        });
        t.passo('verificacoes', 'Ficha: 91 dias, ganho 72,8 kg, GMD 0,800 kg/dia, variação 24,27%; intervalo de 10 dias com GMD vazio (DADOS_INSUFICIENTES); 3 linhas, as anteriores intactas, sem coluna de GMD; peso atual 380,0', function () {
          var b = t.ficha(id).peso;
          igual_(b.serie.map(function (x) { return [x.data, x.peso_kg]; }), [[t.dia(68), 300], [t.dia(159), 372.8], [t.dia(169), 380]], 'série com 3 pontos em ordem de data');
          igual_(b.intervalos.map(function (v) { return [v.dias, v.ganho_kg, v.gmd_kg_dia, v.variacao_pct, v.motivo]; }), [[91, 72.8, 0.8, 24.27, null], [10, 7.2, null, 1.93, 'DADOS_INSUFICIENTES']], 'intervalos');
          igual_(b.projecao.rotulo, 'Estimativa', 'a projeção é rotulada');
          var linhas = t.tabela('PESAGENS').filter(function (r) { return r.animal_id === id; });
          igual_(linhas.map(function (r) { return [r.data_pesagem, r.peso_kg, r.metodo, r.tipo]; }).sort(), [[t.dia(159), 372.8, 'BALANCA', 'ROTINA'], [t.dia(169), 380, 'BALANCA', 'ROTINA'], [t.dia(68), 300, 'BALANCA', 'ROTINA']].sort(), 'três linhas, as anteriores intactas');
          verificar_(Schema.colunas('PESAGENS').every(function (c) { return !/gmd|ganho/i.test(c); }), 'nenhuma coluna de GMD em PESAGENS');
          var a = t.animal(id);
          igual_([a.peso_atual, a.data_ultima_pesagem], [380, t.dia(169)], 'peso atual');
        });
        t.passo('4', 'Peso 0: VALIDATION; 450,0 kg em D0+179 (7,0 kg/dia): aviso PESO_IMPLAUSIVEL, gravado só com o aceite', function () {
          var e = t.recusa('evento.registrar', pesagem_(t.dia(179), [{ animal_id: id, peso: 0 }]), 'VALIDATION', 'ct05-zero');
          igual_(e.details.map(function (d) { return [d.codigo, d.campo]; }), [['VALOR_FORA_DA_FAIXA', 'peso']], 'peso 0');
          var av = t.recusa('evento.registrar', pesagem_(t.dia(179), [{ animal_id: id, peso: 450.0 }]), 'NEEDS_CONFIRMATION', 'ct05-brusca');
          igual_(av.details.map(function (d) { return [d.codigo, d.animal_id]; }), [['PESO_IMPLAUSIVEL', id]], 'aviso de variação brusca');
          verificar_(/7,00 kg por dia/.test(av.details[0].mensagem), 'a mensagem diz a variação por dia: ' + av.details[0].mensagem);
          var ok = t.cmd('evento.registrar', pesagem_(t.dia(179), [{ animal_id: id, peso: 450.0 }]), 'ct05-brusca', { avisos: ['PESO_IMPLAUSIVEL'] });
          igual_(t.evento(ok.event_id).payload.avisos_aceitos, [{ codigo: 'PESO_IMPLAUSIVEL', n: 1 }], 'o aceite fica no evento');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('CT-05'); });
      },
    },
    {
      id: 'CT-06', titulo: 'Vacinação coletiva: um registro por animal, consumo do estoque e custo; a agenda pelo protocolo (próximas e vencidas)',
      executar: function (t) {
        var P = t.pastos('CT-06', ['Pasto 1']);
        var ids = [];
        var prod;
        var prot;
        var ev;
        // As datas do desenho (05/04, 20/09 e 13/11/2026) contadas do marco zero: a aplicação em D0+94, a agenda 12 dias
        // antes do vencimento (D0+262) e 42 dias depois dele (D0+316).
        t.passo('massa', '0601 a 0630 no Pasto 1; "Vacina X" (R$ 3,00 por dose, estoque controlado); entrada de 100 doses; protocolo a cada 180 dias', function () {
          var bs = [];
          for (var i = 1; i <= 30; i++) bs.push('06' + (i < 10 ? '0' : '') + i);
          var r = t.cmd('evento.registrar', entrada_(bs.map(function (b) { return bicho_(t, { brinco: b, data_nascimento: t.dia(-200), pasto_destino_id: P['Pasto 1'] }); })), 'ct06-massa');
          var por = ids_(r);
          ids = bs.map(function (b) { return por[b]; });
          prod = t.cmd('produto.salvar', { campos: { nome: 'Vacina X (CT-06)', categoria: 'VACINA', unidade: 'dose', custo_unitario: 3, controla_estoque: true } }, 'ct06-produto');
          t.cmd('evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: t.dia(60), product_id: prod.product_id, quantidade: 100, valor: 30000 } }, 'ct06-entrada');
          prot = t.cmd('protocolo.salvar', { campos: { nome: 'Vacina X semestral (CT-06)', tipo_procedimento: 'VACINA', product_id: prod.product_id, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180, antecedencia_alerta_dias: 15 } }, 'ct06-protocolo');
        });
        var vac = function (dose) {
          return { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: t.dia(94), produto_id: prod.product_id, protocol_id: prot.protocol_id, modo_dose: 'POR_CABECA', dose_referencia: dose, quantidade_consumida_total: 30 }, animais: ids.map(function (id) { return { animal_id: id }; }) };
        };
        t.passo('1', 'Aplicação com dose 0: VALIDATION, nada gravado', function () {
          var e = t.recusa('evento.registrar', vac(0), 'VALIDATION', 'ct06-dose0');
          igual_(e.details.map(function (d) { return [d.codigo, d.campo]; }), [['VALOR_FORA_DA_FAIXA', 'dose_referencia']], 'dose 0');
        });
        t.passo('2', 'Vacinação de 30 animais, por cabeça, 1 dose, 30 consumidas, vinculada ao protocolo', function () {
          ev = t.cmd('evento.registrar', vac(1), 'ct06-vacinacao');
        });
        t.passo('verificacoes', 'SANIDADE: 30 linhas do mesmo evento, R$ 3,00 cada; 1 saída de 30 (100 → 70); 1 CUSTEIO de R$ 90,00 sem parcela; 30 alocações de R$ 3,00; caixa inalterado; próxima aplicação = D0+94 + 180 dias nas 30 linhas', function () {
          var linhas = t.doEvento('SANIDADE', ev.event_id);
          igual_([linhas.length, linhas.filter(function (r) { return r.custo === 300 && r.data_proxima_aplicacao === t.dia(274); }).length], [30, 30], 'linhas de SANIDADE');
          igual_(t.doEvento('MOVIMENTOS_ESTOQUE', ev.event_id).map(function (m) { return [m.tipo, m.quantidade]; }), [['SAIDA', 30]], 'uma saída');
          igual_(t.tabela('PRODUTOS').filter(function (p) { return p.product_id === prod.product_id; })[0].estoque_atual, 70, 'saldo');
          var fins = t.doEvento('FINANCEIRO', ev.event_id);
          igual_(fins.map(function (f) { return [f.natureza, f.valor, f.status_pagamento]; }), [['CUSTEIO', 9000, 'SEM_CAIXA']], 'consumo sem parcela');
          igual_(t.tabela('PARCELAS').filter(function (p) { return p.financial_id === fins[0].financial_id; }).length, 0, 'caixa inalterado');
          var al = t.tabela('ALOCACOES_FINANCEIRAS').filter(function (a) { return a.financial_id === fins[0].financial_id; });
          igual_([al.length, al.filter(function (a) { return a.valor_alocado === 300; }).length], [30, 30], 'alocações');
        });
        t.passo('3', 'sanidade.agenda 12 dias antes do vencimento: 30 próximas; 42 dias depois: 30 vencidas', function () {
          var antes = t.ok(t.api('sanidade.agenda', { data: t.dia(262) }), 'agenda');
          // A base é compartilhada: os animais dos outros cenários também são elegíveis a um protocolo sem faixa de idade.
          var meus = function (a) { return a.pendencias.filter(function (p) { return p.protocol_id === prot.protocol_id && ids.indexOf(p.animal_id) >= 0; }); };
          igual_([meus(antes).length, meus(antes).every(function (p) { return p.situacao === 'PROXIMA' && p.vencimento === t.dia(274); })], [30, true], 'próximas');
          var depois = t.ok(t.api('sanidade.agenda', { data: t.dia(316) }), 'agenda');
          igual_([meus(depois).length, meus(depois).every(function (p) { return p.situacao === 'VENCIDA'; })], [30, true], 'vencidas');
          // O protocolo do cenário sai da agenda dos cenários seguintes (desativar preserva o histórico de aplicações).
          t.cmd('protocolo.salvar', { protocol_id: prot.protocol_id, campos: { ativo: false } }, 'ct06-protocolo-fim');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('CT-06'); });
      },
    },
    {
      id: 'SANIDADE', titulo: 'Casos de regra da sanidade (09, seção 4.1): lote vencido, estoque insuficiente, carência na agenda e na venda para abate antes, dentro e depois do prazo (05, seção 4.8), o exemplo de 05, seção 4.7 (bezerra de 3 a 8 meses), agenda de aplicação única',
      executar: function (t) {
        var P = t.pastos('SAN', ['Pasto S']);
        var ids;
        var prod;
        var frig;
        var bezerra;
        t.passo('massa', 'Três bois e uma vaca no Pasto S, com a bezerra dela nascida em D0+40; produto com 20 doses no estoque; frigorífico', function () {
          ids = ids_(t.cmd('evento.registrar', entrada_(['S1', 'S2', 'S3'].map(function (b) { return bicho_(t, { brinco: b, sexo: 'M', castrado: true, data_nascimento: t.dia(-900), pasto_destino_id: P['Pasto S'] }); })
            .concat([bicho_(t, { brinco: 'S4', data_nascimento: t.dia(-2000), partos_previos: 1, pasto_destino_id: P['Pasto S'] })])), 'san-massa'));
          var parto = t.cmd('evento.registrar', nascimento_(t.dia(40), ids.S4, [{ situacao_nascimento: 'VIVO', sexo: 'F' }]), 'san-parto');
          bezerra = parto.animais.filter(function (a) { return a.animal_id !== ids.S4; })[0].animal_id;
          prod = t.cmd('produto.salvar', { campos: { nome: 'Vacina S (aceitação)', categoria: 'VACINA', unidade: 'dose', custo_unitario: 2, controla_estoque: true } }, 'san-produto');
          t.cmd('evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: t.dia(10), product_id: prod.product_id, quantidade: 20, valor: 4000 } }, 'san-entrada');
          frig = t.parceiro('Frigorífico (sanidade)', 'COMPRADOR', 'san-frig');
        });
        t.passo('056-057', 'Lote vencido antes da aplicação (PRODUTO_VENCIDO) e consumo de 30 com saldo de 20 (ESTOQUE_INSUFICIENTE): avisos com aceite', function () {
          var d = { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: t.dia(30), produto_id: prod.product_id, modo_dose: 'POR_CABECA', dose_referencia: 10, lote: 'V1', validade: t.dia(29) }, animais: [{ animal_id: ids.S1 }, { animal_id: ids.S2 }, { animal_id: ids.S3 }] };
          var av = t.recusa('evento.registrar', d, 'NEEDS_CONFIRMATION', 'san-avisos');
          igual_(av.details.map(function (x) { return x.codigo; }).sort(), ['ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO'], 'os dois avisos');
          t.cmd('evento.registrar', d, 'san-avisos', { avisos: ['ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO'] });
          igual_(t.tabela('PRODUTOS').filter(function (p) { return p.product_id === prod.product_id; })[0].estoque_atual, -10, 'o saldo negativo aceito fica visível');
        });
        t.passo('072', 'Vermífugo em D0+100 com 35 dias (05, seção 4.8): carência até D0+135 na aplicação e na agenda (no dia, no último dia e livre no seguinte); abate em D0+120 e no último dia bloqueado, em D0+136 livre; a recria dentro do prazo pede o aceite e, aceita, grava com ele', function () {
          var ev = t.cmd('evento.registrar', { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: t.dia(100), nome_produto: 'Ivermectina 1%', modo_dose: 'POR_CABECA', dose_referencia: 5, unidade_dose: 'mL', periodo_carencia_dias: 35 }, animais: [{ animal_id: ids.S1 }, { animal_id: ids.S2 }] }, 'san-verm');
          igual_(t.doEvento('SANIDADE', ev.event_id).map(function (l) { return l.data_fim_carencia; }), [t.dia(135), t.dia(135)], 'C = aplicação + 35 dias (o último dia de carência)');
          var emCarencia = function (d) { return t.ok(t.api('sanidade.agenda', { data: d }), 'agenda').carencia.filter(function (c) { return c.animal_id === ids.S1 || c.animal_id === ids.S2; }).map(function (c) { return [c.animal_id, c.fim]; }).sort(); };
          var ambos = [[ids.S1, t.dia(135)], [ids.S2, t.dia(135)]].sort();
          igual_([emCarencia(t.dia(100)), emCarencia(t.dia(135)), emCarencia(t.dia(136))], [ambos, ambos, []], 'agenda: em carência no dia e no último dia; livres no seguinte');
          var venda = function (data, fin, id) { return { tipo: 'VENDA', campos: { event_date: data, partner_id: frig, finalidade: fin, modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 400000 }, animais: [{ animal_id: id }], parcelas: [{ data_vencimento: data }] }; };
          igual_(t.recusa('evento.registrar', venda(t.dia(120), 'ABATE', ids.S1), 'VALIDATION', 'san-abate-dentro').details.map(function (x) { return x.codigo; }), ['CARENCIA_ATIVA'], 'dentro');
          igual_(t.recusa('evento.registrar', venda(t.dia(135), 'ABATE', ids.S1), 'VALIDATION', 'san-abate-ultimo').details.map(function (x) { return x.codigo; }), ['CARENCIA_ATIVA'], 'último dia');
          t.cmd('evento.registrar', venda(t.dia(136), 'ABATE', ids.S1), 'san-abate-livre');
          igual_(t.recusa('evento.registrar', venda(t.dia(120), 'RECRIA_ENGORDA', ids.S2), 'NEEDS_CONFIRMATION', 'san-recria').details.map(function (x) { return x.codigo; }), ['CARENCIA_ATIVA'], 'recria: aviso');
          var recria = t.cmd('evento.registrar', venda(t.dia(120), 'RECRIA_ENGORDA', ids.S2), 'san-recria', { avisos: ['CARENCIA_ATIVA'] });
          verificar_((t.evento(recria.event_id).payload.avisos_aceitos || []).some(function (a) { return a.codigo === 'CARENCIA_ATIVA'; }), 'o aceite da carência fica gravado com a venda');
        });
        t.passo('058-4.7', 'O exemplo de 05, seção 4.7 (protocolo de aplicação única para fêmeas de 3 a 8 meses), com as datas contadas do nascimento da bezerra (D0+40): antes dos 3 meses fora; dos 3 meses em diante elegível e em dia; 10 dias antes dos 8 meses, próxima com o vencimento nos 8 meses; aplicada dentro da faixa, cumprida', function () {
          var pr = t.cmd('protocolo.salvar', { campos: { nome: 'Brucelose (aceitação)', tipo_procedimento: 'VACINA', sexo_aplicavel: 'F', idade_min_meses: 3, idade_max_meses: 8, recorrencia_tipo: 'UNICA', antecedencia_alerta_dias: 15 } }, 'san-47');
          var nasc = t.dia(40);
          var tres = Utils.somaMeses(nasc, 3);
          var oito = Utils.somaMeses(nasc, 8);
          var agenda = function (d) { return t.ok(t.api('sanidade.agenda', { data: d }), 'agenda'); };
          var dela = function (a) { return a.pendencias.filter(function (p) { return p.protocol_id === pr.protocol_id && p.animal_id === bezerra; }).map(function (p) { return [p.situacao, p.vencimento]; }); };
          var elegiveis = function (a) { var x = a.protocolos.filter(function (p) { return p.protocol_id === pr.protocol_id; })[0]; return x ? x.elegiveis : 0; };
          var antes = agenda(Utils.somaDias(tres, -1));
          var aos3 = agenda(tres);
          igual_([dela(antes), dela(aos3)], [[], []], 'antes dos 3 meses fora; aos 3 meses, em dia (o vencimento é aos 8)');
          verificar_(elegiveis(aos3) === elegiveis(antes) + 1, 'aos 3 meses a bezerra entra entre as elegíveis (' + elegiveis(antes) + ' → ' + elegiveis(aos3) + ')');
          igual_(dela(agenda(Utils.somaDias(oito, -10))), [['PROXIMA', oito]], '10 dias antes dos 8 meses: próxima, vencendo aos 8 meses');
          t.cmd('evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: Utils.somaDias(oito, -5), protocol_id: pr.protocol_id, nome_produto: 'Vacina B19', modo_dose: 'POR_CABECA', dose_referencia: 2, unidade_dose: 'mL' }, animais: [{ animal_id: bezerra }] }, 'san-47-b19');
          igual_(dela(agenda(Utils.somaDias(oito, -1))), [], 'aplicada dentro da faixa: cumprida');
          t.cmd('protocolo.salvar', { protocol_id: pr.protocol_id, campos: { ativo: false } }, 'san-47-fim');
        });
        t.passo('058-059', 'Protocolo de aplicação única para machos a partir de 24 meses: antes do vencimento, em dia; a agenda e os alertas mostram a pendência vencida; aplicada, cumprida', function () {
          var pr = t.cmd('protocolo.salvar', { campos: { nome: 'Única (aceitação)', tipo_procedimento: 'VACINA', sexo_aplicavel: 'M', idade_min_meses: 24, recorrencia_tipo: 'UNICA' } }, 'san-unica');
          var minhas = function (a) { return a.pendencias.filter(function (p) { return p.protocol_id === pr.protocol_id && p.animal_id === ids.S3; }); };
          var ag = t.ok(t.api('sanidade.agenda', {}), 'agenda');
          igual_(minhas(ag).map(function (p) { return p.situacao; }), ['VENCIDA'], 'o S3 já tinha 24 meses: vencida desde então');
          verificar_(t.ok(t.api('alerta.listar', {}), 'alertas').alertas.some(function (a) { return a.codigo === 'SANITARIO_VENCIDO'; }), 'alerta de procedimento vencido');
          t.cmd('evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: t.hoje(), protocol_id: pr.protocol_id, nome_produto: 'Vacina U', modo_dose: 'POR_CABECA', dose_referencia: 1, unidade_dose: 'dose' }, animais: [{ animal_id: ids.S3 }] }, 'san-unica-aplicada');
          igual_(minhas(t.ok(t.api('sanidade.agenda', {}), 'agenda')).length, 0, 'cumprida');
          t.cmd('protocolo.salvar', { protocol_id: pr.protocol_id, campos: { ativo: false } }, 'san-unica-fim');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('SANIDADE'); });
      },
    },
    {
      id: 'ESTOQUE', titulo: 'Estoque de insumos pelo exemplo de 03a, seção 4.7: entrada por embalagem, saída na vacinação, perda, contagem e estorno da aplicação; o saldo é a soma dos movimentos e o consumo vira custo sem caixa',
      executar: function (t) {
        var P = t.pastos('EST', ['Pasto E']);
        var ids;
        var prod;
        var vac;
        var saldo = function () { return t.tabela('PRODUTOS').filter(function (p) { return p.product_id === prod; })[0].estoque_atual; };
        var movimentos = function () {
          var vig = mapa_(t.tabela('EVENTOS'), 'event_id', 'status');
          return t.tabela('MOVIMENTOS_ESTOQUE').filter(function (m) { return m.product_id === prod && vig[m.event_id] === 'CONFIRMADO'; });
        };
        t.passo('massa', '30 bezerros no Pasto E; "Vacina X (estoque)" em frascos de 50 doses, R$ 1,80 por dose, com o estoque controlado', function () {
          var bs = [];
          for (var i = 1; i <= 30; i++) bs.push('E' + (i < 10 ? '0' : '') + i);
          var por = ids_(t.cmd('evento.registrar', entrada_(bs.map(function (b) { return bicho_(t, { brinco: b, data_nascimento: t.dia(-150), pasto_destino_id: P['Pasto E'] }); })), 'est-massa'));
          ids = bs.map(function (b) { return por[b]; });
          prod = t.cmd('produto.salvar', { campos: { nome: 'Vacina X (estoque)', categoria: 'VACINA', unidade: 'dose', custo_unitario: 1.8, controla_estoque: true, fator_conversao: 50 } }, 'est-produto').product_id;
        });
        t.passo('entrada', 'Entrada de 2 frascos (R$ 180,00): 100 doses; a compra de insumo vai para o caixa (parcela) e não é custo dos animais', function () {
          var e = t.cmd('evento.registrar', { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: t.dia(60), product_id: prod, qtd_apresentacao: 2, valor: 18000, documento: 'NF 123', vencimento: t.dia(90) } }, 'est-entrada');
          igual_(t.doEvento('MOVIMENTOS_ESTOQUE', e.event_id).map(function (m) { return [m.tipo, m.quantidade, m.custo_unitario]; }), [['ENTRADA', 100, 1.8]], 'movimento de entrada');
          var fin = t.doEvento('FINANCEIRO', e.event_id);
          igual_(fin.map(function (f) { return [f.natureza, f.valor, f.quantidade, f.status_pagamento]; }), [['ESTOQUE_INSUMOS', 18000, 100, 'ABERTO']], 'compra de insumos');
          igual_(t.tabela('PARCELAS').filter(function (p) { return p.financial_id === fin[0].financial_id; }).map(function (p) { return [p.data_vencimento, p.valor]; }), [[t.dia(90), 18000]], 'caixa no vencimento');
          igual_(t.tabela('RATEIOS').filter(function (r) { return r.financial_id === fin[0].financial_id; }).length, 0, 'sem rateio aos animais');
          igual_(saldo(), 100, 'saldo');
        });
        t.passo('saida-perda', 'Vacinação dos 30 (30 doses: R$ 54,00 sem caixa, R$ 1,80 por animal) e a perda de 5 doses por frasco quebrado: 100 − 30 − 5 = 65', function () {
          vac = t.cmd('evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: t.dia(70), produto_id: prod, modo_dose: 'POR_CABECA', dose_referencia: 1 }, animais: ids.map(function (id) { return { animal_id: id }; }) }, 'est-vacina');
          var consumo = t.doEvento('FINANCEIRO', vac.event_id);
          igual_(consumo.map(function (f) { return [f.natureza, f.valor, f.quantidade, f.status_pagamento]; }), [['CUSTEIO', 5400, 30, 'SEM_CAIXA']], '30 × R$ 1,80');
          var al = t.tabela('ALOCACOES_FINANCEIRAS').filter(function (a) { return a.financial_id === consumo[0].financial_id; });
          igual_([al.length, al.every(function (a) { return a.valor_alocado === 180; })], [30, true], 'R$ 1,80 por animal');
          var perda = t.cmd('evento.registrar', { tipo: 'ESTOQUE', subtipo: 'AJUSTE', campos: { event_date: t.dia(80), product_id: prod, motivo_ajuste: 'PERDA', quantidade: 5, notes: 'Frasco quebrado' } }, 'est-perda');
          igual_([t.doEvento('MOVIMENTOS_ESTOQUE', perda.event_id).map(function (m) { return [m.tipo, m.quantidade]; }), t.doEvento('FINANCEIRO', perda.event_id).length], [[['AJUSTE', -5]], 0], 'o acerto é só movimento, sem lançamento');
          igual_(saldo(), 65, '100 − 30 − 5');
        });
        t.passo('contagem', 'Contagem em D0+90 achou 60 doses: o acerto lança a diferença (−5); saldo 60', function () {
          var c = t.cmd('evento.registrar', { tipo: 'ESTOQUE', subtipo: 'AJUSTE', campos: { event_date: t.dia(90), product_id: prod, motivo_ajuste: 'CONTAGEM', saldo_contado: 60 } }, 'est-contagem');
          igual_(t.doEvento('MOVIMENTOS_ESTOQUE', c.event_id).map(function (m) { return [m.tipo, m.quantidade]; }), [['AJUSTE', -5]], 'contado − saldo na data');
          igual_(saldo(), 60, 'saldo');
        });
        t.passo('estorno', 'Estorno da vacinação: as 30 doses voltam (90), o consumo fica cancelado e o saldo continua igual à soma dos movimentos vigentes', function () {
          t.cmd('evento.estornar', { event_id: vac.event_id, justificativa: 'Vacinação lançada no lote errado' }, 'est-estorno', { avisos: [] });
          igual_(saldo(), 90, '60 + 30');
          verificar_(t.doEvento('FINANCEIRO', vac.event_id).every(function (f) { return f.status === 'CANCELADO'; }), 'o consumo da aplicação estornada fica cancelado');
          igual_(movimentos().reduce(function (x, m) { return x + (m.tipo === 'SAIDA' ? -m.quantidade : m.quantidade); }, 0), 90, 'saldo = Σ dos movimentos vigentes');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('ESTOQUE'); });
      },
    },
    {
      id: 'REPRODUCAO', titulo: 'Casos de regra da reprodução (09, seção 4.1): macho como sujeito de diagnóstico, parto de fêmea de 20 meses, segundo parto 200 dias depois; a estação de RN-066 (40 expostas: prenhez 80,0%, parição 75,0%, natalidade 77,5%; com 4 expostas, null); desmama, castração e ocorrência; os desfechos (desmama 75,0%, mortalidade até a desmama 3,2%, perda gestacional 3,1%)',
      executar: function (t) {
        var P = t.pastos('REP', ['Pasto R']);
        var ids;
        var est;
        var vacas = [];
        var nome = function (i) { return 'R' + (i < 10 ? '0' : '') + i; };
        var repro = function (sub, data, animais, campos) {
          var c = { event_date: data };
          Object.keys(campos || {}).forEach(function (k) { c[k] = campos[k]; });
          return { tipo: 'REPRODUCAO', subtipo: sub, campos: c, animais: animais.map(function (a) { return typeof a === 'string' ? { animal_id: a } : a; }) };
        };
        var parto = function (data, mae, crias) { return { tipo: 'NASCIMENTO', campos: { event_date: data }, animais: [{ animal_id: mae }], crias: crias || [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }; };
        var codigos = function (e) { return e.details.map(function (x) { return x.codigo; }); };
        t.passo('massa', '40 vacas, uma novilha de 20 meses, o touro e um garrote no Pasto R; a estação de monta de D0+10 a D0+100', function () {
          var bs = [];
          for (var i = 0; i < 40; i++) bs.push(bicho_(t, { brinco: nome(i), data_nascimento: t.dia(-2000), partos_previos: 1, pasto_destino_id: P['Pasto R'] }));
          bs.push(bicho_(t, { brinco: 'RN', data_nascimento: t.dia(-600), partos_previos: 0, pasto_destino_id: P['Pasto R'] }));
          bs.push(bicho_(t, { brinco: 'RT', sexo: 'M', reprodutor: true, data_nascimento: t.dia(-2500), pasto_destino_id: P['Pasto R'] }));
          bs.push(bicho_(t, { brinco: 'RG', sexo: 'M', data_nascimento: t.dia(-500), pasto_destino_id: P['Pasto R'] }));
          ids = ids_(t.cmd('evento.registrar', entrada_(bs), 'rep-massa'));
          for (var j = 0; j < 40; j++) vacas.push(ids[nome(j)]);
          est = t.cmd('estacao.salvar', { campos: { nome: 'Estação (aceitação)', data_inicio: t.dia(10), data_fim: t.dia(100), tipo: 'MONTA_NATURAL' } }, 'rep-estacao');
        });
        t.passo('060', 'O touro como sujeito de um diagnóstico de gestação: VALIDATION (o registro reprodutivo é de uma fêmea)', function () {
          igual_(codigos(t.recusa('evento.registrar', repro('DIAGNOSTICO_GESTACAO', t.dia(40), [{ animal_id: ids.RT, resultado: 'POSITIVO' }]), 'VALIDATION', 'rep-060')), ['NAO_E_FEMEA'], 'macho no diagnóstico');
        });
        t.passo('061', 'Parto da novilha de 20 meses: aviso IDADE_REPRODUTIVA, nada gravado sem o aceite', function () {
          igual_(codigos(t.recusa('evento.registrar', parto(t.dia(10), ids.RN), 'NEEDS_CONFIRMATION', 'rep-061')), ['IDADE_REPRODUTIVA'], 'fêmea jovem');
        });
        t.passo('064', 'Segundo parto da R39 200 dias depois do primeiro: aviso INTERVALO_PARTO_CURTO', function () {
          t.cmd('evento.registrar', parto(t.dia(20), ids.R39), 'rep-064-primeiro');
          igual_(codigos(t.recusa('evento.registrar', parto(t.dia(220), ids.R39), 'NEEDS_CONFIRMATION', 'rep-064')), ['INTERVALO_PARTO_CURTO'], 'intervalo curto');
        });
        t.passo('066', 'Estação com 40 expostas, 38 diagnosticadas, 32 prenhas, 30 paridas e 31 nascidos vivos (um gemelar): prenhez 80,0%, parição 75,0%, natalidade 77,5%; uma estação com 4 expostas: null (DADOS_INSUFICIENTES)', function () {
          t.cmd('evento.registrar', repro('EXPOSICAO', t.dia(10), vacas.concat([ids.RT]), { estacao_id: est.estacao_id, data_fim: t.dia(100) }), 'rep-exposicao');
          t.cmd('evento.registrar', repro('DIAGNOSTICO_GESTACAO', t.dia(150), vacas.slice(0, 38).map(function (id, i) { return { animal_id: id, resultado: i < 32 ? 'POSITIVO' : 'NEGATIVO' }; }), { estacao_id: est.estacao_id, metodo: 'PALPACAO' }), 'rep-dg');
          for (var i = 0; i < 30; i++) t.cmd('evento.registrar', parto(t.dia(300), vacas[i], i === 0 ? [{ situacao_nascimento: 'VIVO', sexo: 'F' }, { situacao_nascimento: 'VIVO', sexo: 'M' }] : [{ situacao_nascimento: 'VIVO', sexo: i % 2 ? 'M' : 'F' }]), 'rep-parto-' + i);
          var g = t.ok(t.api('reproducao.indicadores', { estacao_id: est.estacao_id }), 'indicadores').estacao.geral;
          var taxa = function (x) { return [x.valor, x.numerador, x.denominador]; };
          igual_([g.expostas, g.diagnosticadas, g.prenhas, g.paridas, g.nascidos_vivos], [40, 38, 32, 30, 31], 'as contagens da estação');
          igual_([taxa(g.prenhez), taxa(g.paricao), taxa(g.natalidade)], [[80, 32, 40], [75, 30, 40], [77.5, 31, 40]], 'prenhez, parição e natalidade');
          var pequena = t.cmd('estacao.salvar', { campos: { nome: 'Estação pequena (aceitação)', data_inicio: t.dia(200), data_fim: t.dia(230), tipo: 'IA' } }, 'rep-estacao-4');
          t.cmd('evento.registrar', repro('INSEMINACAO', t.dia(200), vacas.slice(32, 36), { estacao_id: pequena.estacao_id, metodo: 'IATF' }), 'rep-ia-4');
          var h = t.ok(t.api('reproducao.indicadores', { estacao_id: pequena.estacao_id }), 'indicadores (4)').estacao.geral;
          igual_([h.expostas, h.prenhez.valor, h.prenhez.motivo, h.paricao.valor, h.natalidade.valor], [4, null, 'DADOS_INSUFICIENTES', null, null], 'com 4 expostas, null');
        });
        t.passo('manejo', 'Desmama da cria da R01 (a mãe perde a cria ao pé), castração do garrote (castrado) e uma ocorrência no touro', function () {
          var cria = t.tabela('ANIMAIS').filter(function (a) { return a.mae_id === ids.R01 && a.situacao_cadastral === 'ATIVO'; })[0];
          verificar_(cria, 'a cria da R01');
          t.cmd('evento.registrar', { tipo: 'DESMAMA', campos: { event_date: t.hoje() }, animais: [{ animal_id: cria.animal_id, peso: 95 }] }, 'rep-desmama');
          igual_(t.animal(ids.R01).cria_ao_pe, false, 'a mãe sem cria ao pé');
          t.cmd('evento.registrar', { tipo: 'CASTRACAO', campos: { event_date: t.hoje(), metodo: 'Burdizzo' }, animais: [{ animal_id: ids.RG }] }, 'rep-castracao');
          igual_([t.animal(ids.RG).castrado, t.animal(ids.RG).reprodutor], [true, false], 'o garrote castrado');
          t.cmd('evento.registrar', { tipo: 'OCORRENCIA', campos: { event_date: t.hoje(), tipo_ocorrencia: 'LESAO', description: 'Mancando da pata traseira' }, animais: [{ animal_id: ids.RT }] }, 'rep-ocorrencia');
        });
        t.passo('desfechos', 'Os desfechos da estação (07, seção 8.3): aborto de uma das duas prenhas sem parto, morte de uma cria e a desmama das outras 29 → desmama 30 ÷ 40 = 75,0%, mortalidade até a desmama 1 ÷ 31 = 3,2%, perda gestacional 1 ÷ 32 = 3,1% (parcial: a outra prenha ainda na janela)', function () {
          t.cmd('evento.registrar', repro('ABORTO', t.dia(250), [{ animal_id: vacas[30], idade_gestacional_dias: 150 }]), 'rep-aborto');
          var crias = t.tabela('ANIMAIS').filter(function (a) { return vacas.indexOf(a.mae_id) >= 0 && a.data_nascimento === t.dia(300); });
          igual_(crias.length, 31, 'as 31 crias da estação');
          var morta = crias.filter(function (a) { return a.mae_id === vacas[2]; })[0];
          t.cmd('evento.registrar', { tipo: 'MORTE', campos: { event_date: t.dia(330), causa: 'PREDADOR' }, animais: [{ animal_id: morta.animal_id }] }, 'rep-morte-cria');
          var aDesmamar = crias.filter(function (a) { return a.animal_id !== morta.animal_id && a.mae_id !== ids.R01; });
          igual_(aDesmamar.length, 29, 'as 31 menos a morta e a da R01, já desmamada');
          t.cmd('evento.registrar', { tipo: 'DESMAMA', campos: { event_date: t.hoje() }, animais: aDesmamar.map(function (a) { return { animal_id: a.animal_id }; }) }, 'rep-desmama-estacao');
          var g = t.ok(t.api('reproducao.indicadores', { estacao_id: est.estacao_id }), 'indicadores').estacao.geral;
          var taxa = function (x) { return [x.valor, x.numerador, x.denominador]; };
          igual_([g.desmamados, g.mortos_antes_da_desmama, g.crias_ao_pe], [30, 1, 0], 'contagens dos desfechos');
          igual_([taxa(g.desmama), taxa(g.mortalidade_ate_desmama), taxa(g.perda_gestacional), g.perda_gestacional.parcial], [[75, 30, 40], [3.2, 1, 31], [3.1, 1, 32], 'parcial'], 'desmama, mortalidade até a desmama e perda gestacional');
          igual_([taxa(g.prenhez), taxa(g.paricao), taxa(g.natalidade)], [[80, 32, 40], [75, 30, 40], [77.5, 31, 40]], 'as taxas de RN-066 não mudam com os desfechos');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('REPRODUCAO'); });
      },
    },
    {
      id: 'CT-07', titulo: 'Estorno anula sem apagar: original preservado, auditoria, bloqueios e anulação do animal',
      executar: function (t) {
        var P = t.pastos('CT-07', ['Pasto 1', 'Baixada', 'Pasto 3']);
        var ids;
        var e1;
        var e2;
        var antesEv;
        var antesEa;
        t.passo('massa', '0701 a 0703 no Pasto 1 em D0; transferência E1 para a Baixada em D0+99', function () {
          ids = ids_(t.cmd('evento.registrar', entrada_(['0701', '0702', '0703'].map(function (b) { return bicho_(t, { brinco: b, pasto_destino_id: P['Pasto 1'] }); })), 'ct07-massa'));
          e1 = t.cmd('evento.registrar', transf_(t.dia(99), P['Pasto 1'], P.Baixada, [ids['0701'], ids['0702'], ids['0703']]), 'ct07-e1').event_id;
          igual_(t.noPasto(P.Baixada, t.dia(104)), 3, 'Baixada com 3 em D0+104');
          antesEv = t.tabela('EVENTOS').filter(function (e) { return e.event_id === e1; })[0];
          antesEa = JSON.stringify(t.doEvento('EVENTO_ANIMAIS', e1));
        });
        t.passo('1', 'Estorno de E1 ("pasto errado"): os 3 voltam ao Pasto 1, também na posição de D0+104', function () {
          e2 = t.cmd('evento.estornar', { event_id: e1, justificativa: 'pasto errado' }, 'ct07-e2').event_id;
          verificar_(['0701', '0702', '0703'].every(function (b) { return t.animal(ids[b]).pasto_atual_id === P['Pasto 1']; }), 'os 3 de volta ao Pasto 1');
          igual_([t.noPasto(P['Pasto 1'], t.dia(104)), t.noPasto(P.Baixada, t.dia(104))], [3, 0], 'posição em D0+104');
        });
        t.passo('2', 'E1 e as 3 linhas dele idênticos, salvo os caches status e reversed_by_event_id; E2 aponta E1, datado de hoje, sem linha filha', function () {
          var depois = t.tabela('EVENTOS').filter(function (e) { return e.event_id === e1; })[0];
          Object.keys(antesEv).forEach(function (k) {
            if (k === 'status') igual_([antesEv[k], depois[k]], ['CONFIRMADO', 'ESTORNADO'], 'status');
            else if (k === 'reversed_by_event_id') igual_([antesEv[k], depois[k]], [null, e2], 'reversed_by_event_id');
            else igual_(depois[k], antesEv[k], 'EVENTOS.' + k + ' não muda');
          });
          igual_(JSON.stringify(t.doEvento('EVENTO_ANIMAIS', e1)), antesEa, 'linhas de EVENTO_ANIMAIS idênticas');
          var est = t.tabela('EVENTOS').filter(function (e) { return e.event_id === e2; })[0];
          igual_([est.event_type, est.reversal_of_event_id, est.event_date, t.doEvento('EVENTO_ANIMAIS', e2).length], ['ESTORNO', e1, t.hoje(), 0], 'o estorno');
        });
        t.passo('3', 'auditoria.listar mostra o estorno com quem, quando e o motivo', function () {
          var aud = t.ok(t.api('auditoria.listar', { entity_id: e1, por_pagina: 50 }), 'auditoria');
          var item = aud.itens.filter(function (a) { return a.event_id === e2; })[0];
          verificar_(item, 'o estorno na trilha');
          igual_([item.acao, item.usuario, item.registration_date, item.justificativa], ['ESTORNAR', t.usuario, t.hoje(), 'pasto errado'], 'trilha do estorno');
        });
        t.passo('4', 'Estornar E1 de novo e estornar o estorno: VALIDATION', function () {
          igual_(t.recusa('evento.estornar', { event_id: e1, justificativa: 'de novo' }, 'VALIDATION', 'ct07-de-novo').details.map(function (d) { return d.codigo; }), ['JA_ANULADO'], 'estornar de novo');
          igual_(t.recusa('evento.estornar', { event_id: e2, justificativa: 'estorno do estorno' }, 'VALIDATION', 'ct07-estorno-do-estorno').details.map(function (d) { return d.codigo; }), ['ESTORNO_NAO_SE_ESTORNA'], 'estorno do estorno');
        });
        t.passo('5', 'Com transferência posterior do 0701: o estorno é CONFLICT e cita a posterior', function () {
          var e1b = t.cmd('evento.registrar', transf_(t.dia(99), P['Pasto 1'], P.Baixada, [ids['0701'], ids['0702'], ids['0703']]), 'ct07-e1b').event_id;
          var posterior = t.cmd('evento.registrar', transf_(t.dia(120), P.Baixada, P['Pasto 3'], [ids['0701']]), 'ct07-posterior').event_id;
          var e = t.recusa('evento.estornar', { event_id: e1b, justificativa: 'teste' }, 'CONFLICT', 'ct07-conflito');
          igual_(e.details.map(function (d) { return [d.codigo, d.animal_id, d.conflito && d.conflito.event_id, d.conflito && d.conflito.data]; }), [['ORIGEM_DIVERGENTE', ids['0701'], posterior, t.dia(120)]], 'o evento que impede');
        });
        t.passo('6', 'Estorno da entrada de um animal sem outros eventos: ANULADO, com o brinco liberado', function () {
          var so = t.cmd('evento.registrar', outra_(t.dia(31), [bicho_(t, { brinco: '0709', pasto_destino_id: P['Pasto 1'] })]), 'ct07-so');
          t.cmd('evento.estornar', { event_id: so.event_id, justificativa: 'Lançado por engano' }, 'ct07-so-estorno');
          var a = t.animal(so.animais[0].animal_id);
          igual_([a.situacao_cadastral, a.brinco], ['ANULADO', null], 'animal anulado, sem brinco');
          igual_(t.cmd('evento.registrar', outra_(t.dia(32), [bicho_(t, { brinco: '0709', pasto_destino_id: P['Pasto 1'] })]), 'ct07-reuso').animais[0].brinco, '0709', 'o brinco serve a outro animal');
        });
        t.passo('fim', 'Projeção = reconstrução', function () { return t.integra('CT-07'); });
      },
    },
    {
      id: 'CT-08', titulo: 'Inventário em qualquer data pelo replay; estorno recalcula o passado',
      executar: function (t) {
        var P = t.pastos('CT-08', ['Pasto 1', 'Pasto 2']);
        var datas = [t.dia(30), t.dia(45), t.dia(89)];
        var base = {};
        var venda;
        var ultimo;
        t.passo('massa', 'D0 com 100 (60 no Pasto 1, 40 no Pasto 2); D0+14 dois partos no Pasto 1; D0+31 dez para o Pasto 2; D0+50 venda de 5 do Pasto 2; D0+68 uma morte no Pasto 1', function () {
          datas.forEach(function (d) { base[d] = t.posicao(d).cabecas; });
          var animais = [];
          for (var i = 1; i <= 100; i++) animais.push(bicho_(t, { brinco: String(8000 + i), sexo: i % 2 ? 'F' : 'M', data_nascimento: t.dia(-1500), pasto_destino_id: i <= 60 ? P['Pasto 1'] : P['Pasto 2'] }));
          var ent = t.cmd('evento.registrar', entrada_(animais), 'ct08-massa').animais;
          var noA = ent.filter(function (a, i) { return i < 60; }).map(function (a) { return a.animal_id; });
          var noB = ent.filter(function (a, i) { return i >= 60; }).map(function (a) { return a.animal_id; });
          t.cmd('evento.registrar', nascimento_(t.dia(14), noA[0], [{ situacao_nascimento: 'VIVO', sexo: 'F' }]), 'ct08-parto-1');
          t.cmd('evento.registrar', nascimento_(t.dia(14), noA[2], [{ situacao_nascimento: 'VIVO', sexo: 'M' }]), 'ct08-parto-2');
          t.cmd('evento.registrar', transf_(t.dia(31), P['Pasto 1'], P['Pasto 2'], noA.slice(10, 20)), 'ct08-transferencia');
          var comp = t.parceiro('Comprador (CT-08)', ['COMPRADOR'], 'ct08-comprador');
          venda = t.cmd('evento.registrar', venda_(t.dia(50), comp, noB.slice(0, 5)), 'ct08-venda').event_id;
          t.cmd('evento.registrar', { tipo: 'MORTE', campos: { event_date: t.dia(68), causa: 'DOENCA' }, animais: [{ animal_id: noA[30] }] }, 'ct08-morte');
        });
        var resumo = function (d) { return [t.posicao(d).cabecas - base[d], t.noPasto(P['Pasto 1'], d), t.noPasto(P['Pasto 2'], d)]; };
        t.passo('1', 'Véspera do marco zero: sem número, com o motivo ANTERIOR_AO_MARCO_ZERO', function () {
          var p = t.posicao(t.dia(-1));
          igual_([p.cabecas, p.motivo], [null, 'ANTERIOR_AO_MARCO_ZERO'], 'antes do marco zero');
        });
        t.passo('2', 'D0+30: 102 (62 e 40); D0+45: 102 (52 e 50); D0+89: 96 (51 e 45)', function () {
          igual_(resumo(datas[0]), [102, 62, 40], 'D0+30 (100 + 2)');
          igual_(resumo(datas[1]), [102, 52, 50], 'D0+45 (transferência não muda o total)');
          igual_(resumo(datas[2]), [96, 51, 45], 'D0+89 (100 + 2 − 5 − 1)');
        });
        t.passo('3', 'Estornada a venda, D0+89 passa a 101 (51 e 50); o resto do passado não muda', function () {
          ultimo = t.cmd('evento.estornar', { event_id: venda, justificativa: 'Venda desfeita' }, 'ct08-estorno');
          igual_(resumo(datas[2]), [101, 51, 50], 'D0+89 depois do estorno');
          igual_(resumo(datas[0]), [102, 62, 40], 'D0+30 depois do estorno');
          return ultimo.event_id ? 'estorno gravado' : null;
        });
        t.passo('fim', 'A reconstrução total produz ANIMAIS idêntico ao gravado', function () { return t.integra('CT-08'); });
      },
    },
    {
      id: 'CT-13', titulo: 'Rateio com centavos na compra: maior resto, desempate pelo código, mesma saída com a entrada embaralhada',
      executar: function (t) {
        var P = t.pastos('CT-13', ['Pasto']);
        var f = t.parceiro('Vizinho (CT-13)', ['FORNECEDOR'], 'ct13-f');
        var compra = function (data, animais, campos, frete) {
          var c = { event_date: data, partner_id: f, pasto_destino_id: P.Pasto };
          Object.keys(campos).forEach(function (k) { c[k] = campos[k]; });
          return { tipo: 'COMPRA', campos: c, animais: animais, parcelas: [{ data_vencimento: Utils.somaDias(data, 30) }], custos: [{ tipo: 'FRETE', valor: frete }] };
        };
        var freteDe = function (ev) { return t.doEvento('FINANCEIRO', ev)[1]; };
        var b;
        t.passo('a', 'R$ 100,00 de frete por CABECAS entre 3: 33,34; 33,33; 33,33 (o centavo para o menor código interno)', function () {
          var r = t.cmd('evento.registrar', compra(t.dia(59), [garrote_('1301'), garrote_('1302'), garrote_('1303')], { modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 900000 }, 10000), 'ct13-a');
          var fr = freteDe(r.event_id);
          var cod = mapa_(r.animais, 'animal_id', 'codigo_interno');
          var aloc = t.tabela('ALOCACOES_FINANCEIRAS').filter(function (x) { return x.financial_id === fr.financial_id; });
          var ordem = aloc.map(function (x) { return [cod[x.animal_id], x.valor_alocado]; }).sort(function (x, y) { return x[0] < y[0] ? -1 : 1; });
          igual_(ordem.map(function (x) { return x[1]; }), [3334, 3333, 3333], 'centavo para o menor código');
          var rat = t.tabela('RATEIOS').filter(function (x) { return x.financial_id === fr.financial_id; })[0];
          igual_([rat.criterio, rat.base_total, rat.total_alocado], ['CABECAS', 3, 10000], 'RATEIOS');
        });
        t.passo('b', 'R$ 1.500,00 de frete por PESO_VIVO com 200,0, 250,0 e 310,0 kg: 394,74; 493,42; 611,84', function () {
          b = t.cmd('evento.registrar', compra(t.dia(60), [garrote_('1304', { peso: 200 }), garrote_('1305', { peso: 250 }), garrote_('1306', { peso: 310 })], { modalidade: 'KG_VIVO', preco_unitario: 1200, valor_animais: 912000 }, 150000), 'ct13-b');
          var fr = freteDe(b.event_id);
          var br = mapa_(b.animais, 'animal_id', 'brinco');
          igual_(mapa_(t.tabela('ALOCACOES_FINANCEIRAS').filter(function (x) { return x.financial_id === fr.financial_id; }), function (x) { return br[x.animal_id]; }, 'valor_alocado'), { 1304: 39474, 1305: 49342, 1306: 61184 }, 'frete por peso');
          var rat = t.tabela('RATEIOS').filter(function (x) { return x.financial_id === fr.financial_id; })[0];
          igual_([rat.criterio, rat.base_total, rat.total_alocado], ['PESO_VIVO', 760, 150000], 'RATEIOS');
          t.doEvento('FINANCEIRO', b.event_id).forEach(function (l) {
            igual_(soma_(t.tabela('ALOCACOES_FINANCEIRAS').filter(function (x) { return x.financial_id === l.financial_id; }), 'valor_alocado'), l.valor, 'Σ alocado = valor do lançamento');
          });
        });
        t.passo('emb', 'A mesma compra com os animais em outra ordem (revisão pelo servidor) dá a cada peso o mesmo valor', function () {
          var sim = t.ok(t.api('evento.simular', { acao: 'registrar', dados: compra(t.dia(61), [garrote_('1316', { peso: 310 }), garrote_('1314', { peso: 200 }), garrote_('1315', { peso: 250 })], { modalidade: 'KG_VIVO', preco_unitario: 1200, valor_animais: 912000 }, 150000) }), 'revisão');
          var custo = mapa_(b.animais, 'brinco', function (a) { return t.animal(a.animal_id).custo_aquisicao; });
          igual_(mapa_(sim.impactos.financeiro.por_animal, 'brinco', 'valor'), { 1314: custo['1304'], 1315: custo['1305'], 1316: custo['1306'] }, 'valor por animal igual com a entrada embaralhada');
        });
        ['c', 'd', 'e', 'f'].forEach(function (k, i) {
          t.naoSeAplica(k, ['Rateio por dias de permanência', 'Rateio com base zero', 'Rateio MANUAL somando 99,99 de 100,00', 'Re-rateio por evento RATEIO'][i],
            'O rateio de custo compartilhado (evento RATEIO) chega com o módulo Financeiro (Fase 4); a regra do maior resto já é conferida no nível 1 (tests/financeiro.test.js).');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('CT-13'); });
      },
    },
    {
      id: 'CT-14', titulo: 'Venda por arroba: peso vivo e carcaça não se confundem',
      executar: function (t) {
        var P = t.pastos('CT-14', ['Pasto']);
        var frig = t.parceiro('Frigorífico (CT-14)', ['COMPRADOR'], 'ct14-frig');
        var ids;
        var boi = function (b) { return bicho_(t, { brinco: b, sexo: 'M', castrado: true, data_nascimento: t.dia(-1000), pasto_destino_id: P.Pasto }); };
        t.passo('massa', 'Bois 1401 a 1404 no pasto em D0', function () { ids = ids_(t.cmd('evento.registrar', entrada_(['1401', '1402', '1403', '1404'].map(boi)), 'ct14-massa')); });
        var vivoEstimado = function (comBase) {
          var c = { event_date: t.dia(313), partner_id: frig, finalidade: 'ABATE', modalidade: 'ARROBA', preco_unitario: 31000, valor_bruto: 1128400 };
          if (comBase) { c.base_peso = 'VIVO'; c.rendimento_carcaca_pct = 52; c.rendimento_tipo = 'ESTIMADO'; }
          return { tipo: 'VENDA', campos: c, animais: [{ animal_id: ids['1403'], peso: 540 }, { animal_id: ids['1404'], peso: 510 }], parcelas: [{ data_vencimento: t.dia(343) }] };
        };
        t.passo('c', 'ARROBA sem base de peso: VALIDATION no campo base_peso, nada gravado', function () {
          var e = t.recusa('evento.registrar', vivoEstimado(false), 'VALIDATION', 'ct14-c');
          igual_(e.details.map(function (d) { return [d.codigo, d.campo]; }), [['CAMPO_OBRIGATORIO', 'base_peso']], 'detalhe');
        });
        t.passo('a', 'Carcaça apurada (285,0 e 270,0 kg) a R$ 320,00/@: 37,00 @, bruto 11.840,00 por PESO_CARCACA, retenção 177,60, depósito 11.662,40, rendimento 52,4 apurado; pesagens só do peso vivo', function () {
          var dados = {
            tipo: 'VENDA', campos: { event_date: t.dia(313), partner_id: frig, finalidade: 'ABATE', modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor_bruto: 1184000 },
            animais: [{ animal_id: ids['1401'], peso: 540, peso_carcaca_kg: 285 }, { animal_id: ids['1402'], peso: 520, peso_carcaca_kg: 270 }],
            parcelas: [{ data_vencimento: t.dia(343) }], deducoes: [{ tipo: 'FUNRURAL', valor: 17760, retida_pelo_comprador: true }],
          };
          var sim = t.api('evento.simular', { acao: 'registrar', dados: dados });
          var v = t.ok(sim, 'revisão').impactos.venda;
          igual_([v.arrobas, v.arroba_base, v.receita, v.retidas, v.deposito_esperado, v.rendimento_pct, v.rendimento_tipo], [37, 'CARCACA', 1184000, 17760, 1166240, 52.4, 'APURADO'], 'a revisão, com a base da arroba ao lado');
          var ev = t.cmd('evento.registrar', dados, 'ct14-a', { versao: sim.meta.dataVersion }).event_id;
          var vd = t.doEvento('VENDAS', ev)[0];
          igual_([vd.base_peso, vd.rendimento_carcaca_pct, vd.rendimento_tipo, vd.peso_vivo_total_kg, vd.peso_carcaca_total_kg, vd.criterio_rateio], ['CARCACA', 52.4, 'APURADO', 1060, 555, 'PESO_CARCACA'], 'VENDAS');
          var fin = t.doEvento('FINANCEIRO', ev);
          igual_(mapa_(t.tabela('ALOCACOES_FINANCEIRAS').filter(function (x) { return x.financial_id === fin[0].financial_id; }), 'animal_id', 'valor_alocado'), mapa_([{ a: ids['1401'], v: 608000 }, { a: ids['1402'], v: 576000 }], 'a', 'v'), '6.080,00 e 5.760,00');
          igual_([fin[1].natureza, fin[1].valor, fin[1].retida_pelo_comprador], ['DESPESA_VENDA', 17760, true], 'retenção do comprador');
          igual_(mapa_(t.doEvento('PESAGENS', ev), 'animal_id', 'peso_kg'), mapa_([{ a: ids['1401'], v: 540 }, { a: ids['1402'], v: 520 }], 'a', 'v'), 'PESAGENS com o peso vivo, nenhuma com a carcaça');
        });
        t.passo('b', 'Rendimento estimado de 52% (540,0 e 510,0 kg vivos) a R$ 310,00/@: 36,40 @ estimadas, bruto 11.284,00 (5.803,20 e 5.480,80)', function () {
          var sim = t.api('evento.simular', { acao: 'registrar', dados: vivoEstimado(true) });
          var v = t.ok(sim, 'revisão').impactos.venda;
          igual_([v.arrobas, v.arroba_base], [36.4, 'ESTIMADA'], 'arrobas estimadas');
          var ev = t.cmd('evento.registrar', vivoEstimado(true), 'ct14-b', { versao: sim.meta.dataVersion }).event_id;
          var vd = t.doEvento('VENDAS', ev)[0];
          igual_([vd.rendimento_tipo, vd.peso_carcaca_total_kg, vd.criterio_rateio], ['ESTIMADO', null, 'PESO_VIVO'], 'carcaça estimada não é gravada');
          var fin = t.doEvento('FINANCEIRO', ev);
          igual_(mapa_(t.tabela('ALOCACOES_FINANCEIRAS').filter(function (x) { return x.financial_id === fin[0].financial_id; }), 'animal_id', 'valor_alocado'), mapa_([{ a: ids['1403'], v: 580320 }, { a: ids['1404'], v: 548080 }], 'a', 'v'), 'alocação pelo peso vivo');
          igual_(t.doEvento('PESAGENS', ev).length, 2, '2 PESAGENS (VENDA)');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('CT-14'); });
      },
    },
    {
      id: 'CT-17', titulo: 'Retroativo e mesmo dia: data passada não quebra a cadeia gravada (a pesagem e a identificação como fatos do dia da venda)',
      executar: function (t) {
        var P = t.pastos('CT-17', ['Pasto 1', 'Pasto 2', 'Baixada']);
        var comp = t.parceiro('Comprador (CT-17)', ['COMPRADOR'], 'ct17-comp');
        var ids;
        var venda;
        t.passo('massa', '0457, 1701 e 1702 no Pasto 1 em D0; 0457 vai para a Baixada em D0+68', function () {
          ids = ids_(t.cmd('evento.registrar', entrada_(['0457', '1701', '1702'].map(function (b) { return bicho_(t, { brinco: b, sexo: 'M', castrado: true, data_nascimento: t.dia(-800), pasto_destino_id: P['Pasto 1'] }); })), 'ct17-massa'));
          ids.t68 = t.cmd('evento.registrar', transf_(t.dia(68), P['Pasto 1'], P.Baixada, [ids['0457']]), 'ct17-t68').event_id;
        });
        t.passo('a', 'Transferência do 0457 do Pasto 1 para o Pasto 2 em D0+59: CONFLICT citando a de D0+68', function () {
          var e = t.recusa('evento.registrar', transf_(t.dia(59), P['Pasto 1'], P['Pasto 2'], [ids['0457']]), 'CONFLICT', 'ct17-retro');
          igual_(e.details.map(function (d) { return [d.codigo, d.animal_id, d.conflito.event_id, d.conflito.tipo, d.conflito.data]; }), [['ORIGEM_DIVERGENTE', ids['0457'], ids.t68, 'TRANSFERENCIA', t.dia(68)]], 'o evento que impede');
        });
        t.passo('a2', 'Mesmo dia: dois movimentos do 1701 em D0+80 valem na ordem de registro (o segundo pede confirmação de duplicidade)', function () {
          t.cmd('evento.registrar', transf_(t.dia(80), P['Pasto 1'], P['Pasto 2'], [ids['1701']]), 'ct17-m1');
          var dup = t.api('evento.registrar', transf_(t.dia(80), P['Pasto 2'], P.Baixada, [ids['1701']]), { chave: t.chave('ct17-m2') });
          igual_([t.erro(dup, 'NEEDS_CONFIRMATION', 'segundo movimento').details.map(function (d) { return d.codigo; })], [['POSSIVEL_DUPLICIDADE']], 'aviso de duplicidade');
          t.cmd('evento.registrar', transf_(t.dia(80), P['Pasto 2'], P.Baixada, [ids['1701']]), 'ct17-m2', { avisos: ['POSSIVEL_DUPLICIDADE'] });
          igual_(t.ok(t.api('inventario.posicao', { data: t.dia(80), animal_id: ids['1701'] }), 'posição').pasture_id, P.Baixada, 'no fim do dia, na Baixada');
        });
        t.passo('b', 'Lote vendido em D0+170: identificação do dia aceita, a do dia seguinte VALIDATION, transferência do dia CONFLICT com a venda', function () {
          venda = t.cmd('evento.registrar', venda_(t.dia(170), comp, [ids['1701'], ids['1702']]), 'ct17-venda').event_id;
          var ok = t.cmd('evento.registrar', ident_('PRIMEIRA_IDENTIFICACAO', t.dia(170), 'SISBOV', [{ animal_id: ids['1701'], codigo: 'SB-1701' }, { animal_id: ids['1702'], codigo: 'SB-1702' }]), 'ct17-ident');
          igual_(ok.animais.length, 2, 'identificação no dia da venda (o dia da saída conta)');
          var pes = t.cmd('evento.registrar', pesagem_(t.dia(170), [{ animal_id: ids['1701'], peso: 480.5 }, { animal_id: ids['1702'], peso: 471.0 }]), 'ct17-pesagem');
          igual_(pes.pesagem.n, 2, 'pesagem do dia da venda aceita (limite inclusivo)');
          var ep = t.recusa('evento.registrar', pesagem_(t.dia(171), [{ animal_id: ids['1702'], peso: 470.0 }]), 'VALIDATION', 'ct17-pesagem-depois');
          igual_(ep.details.map(function (d) { return [d.codigo, d.animal_id]; }), [['FORA_DA_PERMANENCIA', ids['1702']]], 'pesagem do dia seguinte, fora da permanência');
          var e = t.recusa('evento.registrar', ident_('PRIMEIRA_IDENTIFICACAO', t.dia(171), 'RFID', [{ animal_id: ids['1702'], codigo: '777' }]), 'VALIDATION', 'ct17-ident-depois');
          igual_(e.details.map(function (d) { return [d.codigo, d.animal_id]; }), [['FORA_DA_PERMANENCIA', ids['1702']]], 'fora da permanência');
          var c = t.recusa('evento.registrar', transf_(t.dia(170), P['Pasto 1'], P['Pasto 2'], [ids['1702']]), 'CONFLICT', 'ct17-transf-dia');
          igual_(c.details.map(function (d) { return [d.codigo, d.conflito.event_id, d.conflito.tipo]; }), [['ORIGEM_DIVERGENTE', venda, 'VENDA']], 'a venda do dia impede');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('CT-17'); });
      },
    },
    {
      id: 'CT-18', titulo: 'Substituição de evento que cria animais: compra com identificação e transferência (Fase 2) e entrada inicial com correção de localização (Fase 1)',
      executar: function (t) {
        var P = t.pastos('CT-18', ['Pasto 1', 'Pasto 2']);
        var forn = t.parceiro('Fornecedor (CT-18)', ['FORNECEDOR'], 'ct18-forn');
        var r;
        var ids;
        var iden;
        var tr;
        var k;
        var compra = function (brincos, animalIds, valor) {
          return {
            tipo: 'COMPRA', campos: { event_date: t.dia(35), partner_id: forn, pasto_destino_id: P['Pasto 1'], modalidade: 'CABECA', preco_unitario: 300000, valor_animais: valor },
            animais: brincos.map(function (b, i) { var a = garrote_(b); if (animalIds) a.animal_id = animalIds[i]; return a; }),
            parcelas: [{ data_vencimento: t.dia(65), valor: valor / 2 }, { data_vencimento: t.dia(95), valor: valor / 2 }], custos: [{ tipo: 'FRETE', valor: 3000, data_vencimento: t.dia(35) }],
          };
        };
        var pes;
        t.passo('massa', 'Compra de 0801 a 0803 por 9.000,00 em 2 parcelas e frete de 30,00 (D0+35); pesagem dos 3 e identificação SISBOV em D0+42; transferência para o Pasto 2 em D0+59', function () {
          r = t.cmd('evento.registrar', compra(['0801', '0802', '0803'], null, 900000), 'ct18-compra');
          ids = r.animais.map(function (a) { return a.animal_id; });
          pes = t.cmd('evento.registrar', pesagem_(t.dia(42), ids.map(function (id, i) { return { animal_id: id, peso: 280 + i * 5 }; })), 'ct18-pesagem').event_id;
          iden = t.cmd('evento.registrar', ident_('PRIMEIRA_IDENTIFICACAO', t.dia(42), 'SISBOV', ids.map(function (id, i) { return { animal_id: id, codigo: 'SB-080' + (i + 1) }; })), 'ct18-ident').event_id;
          tr = t.cmd('evento.registrar', transf_(t.dia(59), P['Pasto 1'], P['Pasto 2'], ids), 'ct18-transf').event_id;
        });
        t.passo('1', 'Corrigir trocando o brinco 0802 por 0812: um commit; mesmos animal_id e codigo_interno; origem no substituto; posteriores válidos; lançamentos antigos cancelados', function () {
          var codigos = ids.map(function (id) { return t.animal(id).codigo_interno; });
          var dados = compra(['0801', '0812', '0803'], ids, 900000);
          dados.event_id = r.event_id;
          dados.justificativa = 'Brinco 0802 digitado errado';
          var sim = t.api('evento.simular', { acao: 'corrigir', dados: dados });
          verificar_(t.ok(sim, 'revisão').simulacao === true, 'a revisão não grava');
          var ops = t.tabela('OPERACOES').length;
          k = t.cmd('evento.corrigir', dados, 'ct18-corrigir', { versao: sim.meta.dataVersion });
          igual_([t.tabela('OPERACOES').length - ops, k.substitui, t.evento(r.event_id).status], [1, r.event_id, 'ESTORNADO'], 'um só commit; original ESTORNADO');
          igual_(ids.map(function (id) { var a = t.animal(id); return [a.codigo_interno, a.evento_origem_id, a.brinco, a.pasto_atual_id]; }),
            ids.map(function (id, i) { return [codigos[i], k.event_id, ['0801', '0812', '0803'][i], P['Pasto 2']]; }), 'mesmos animais, brinco trocado, ainda no Pasto 2');
          igual_([t.evento(pes).status, t.evento(iden).status, t.evento(tr).status], ['CONFIRMADO', 'CONFIRMADO', 'CONFIRMADO'], 'pesagem, identificação e transferência seguem válidas');
          verificar_(t.doEvento('FINANCEIRO', r.event_id).every(function (f) { return f.status === 'CANCELADO'; }), 'lançamentos do original CANCELADO');
          verificar_(t.doEvento('FINANCEIRO', k.event_id).every(function (f) { return f.status === 'ATIVO'; }), 'lançamentos do substituto valendo');
        });
        t.passo('1b', 'A unicidade do brinco é conferida no estado final: trocar 0812 pelo número de outro animal do rebanho é recusado', function () {
          var dados = compra(['0801', '0703', '0803'], ids, 900000);
          dados.event_id = k.event_id;
          dados.justificativa = 'Teste de brinco repetido';
          var e = t.recusa('evento.corrigir', dados, 'VALIDATION', 'ct18-brinco-repetido');
          verificar_(e.details.some(function (d) { return d.codigo === 'BRINCO_DUPLICADO'; }), 'esperava BRINCO_DUPLICADO; veio ' + e.details.map(function (d) { return d.codigo; }).join(', '));
        });
        t.passo('2', 'Corrigir retirando o 0803 (com pesagem, identificação e transferência posteriores): CONFLICT com os três', function () {
          var dados = compra(['0801', '0812'], ids.slice(0, 2), 600000);
          dados.event_id = k.event_id;
          dados.justificativa = 'Tirar o 0803';
          var e = t.recusa('evento.corrigir', dados, 'CONFLICT', 'ct18-tirar');
          var achados = e.details.filter(function (d) { return d.animal_id === ids[2] && d.conflito; }).map(function (d) { return d.conflito.event_id; }).sort();
          igual_(Utils.unicos(achados).sort(), [pes, iden, tr].sort(), 'a pesagem, a identificação e a transferência do 0803 impedem');
        });
        // Variante da Fase 1 (09, seção 8): substituição de ENTRADA_INICIAL com correção de localização posterior.
        var orig;
        var loc;
        var sub;
        var item = function (a, brinco) { return bicho_(t, { animal_id: a.animal_id, brinco: brinco, data_nascimento: Utils.somaDias(t.estado.d0, -800) }); };
        t.passo('E-massa', '1801, 1802 e 1803 em D0 no Pasto A; correção de localização dos 3 para o Pasto B em D0+30', function () {
          orig = t.cmd('evento.registrar', entrada_(['1801', '1802', '1803'].map(function (b) { return bicho_(t, { brinco: b, data_nascimento: Utils.somaDias(t.estado.d0, -800) }); })), 'ct18-orig');
          loc = t.cmd('evento.registrar', ajuste_('CORRECAO_LOCALIZACAO', t.dia(30), orig.animais.map(function (a) { return { animal_id: a.animal_id, pasto_destino_id: t.estado.pastos.B }; })), 'ct18-loc');
        });
        t.passo('E1', 'Corrigir a entrada trocando o brinco 1802 por 1812: mesmos animal_id e codigo_interno; original ESTORNADO', function () {
          var m = porBrinco_(orig);
          var dados = { tipo: 'ENTRADA_INICIAL', campos: {}, event_id: orig.event_id, justificativa: 'Brinco 1802 lançado errado', animais: [item(m['1801'], '1801'), item(m['1802'], '1812'), item(m['1803'], '1803')] };
          var sim = t.api('evento.simular', { acao: 'corrigir', dados: dados });
          verificar_(t.ok(sim, 'prévia').simulacao === true, 'a prévia não grava');
          sub = t.cmd('evento.corrigir', dados, 'ct18-corrigir-entrada', { versao: sim.meta.dataVersion });
          igual_(sub.substitui, orig.event_id, 'o substituto aponta o original');
          igual_(sub.animais.map(function (a) { return a.animal_id; }).sort(), orig.animais.map(function (a) { return a.animal_id; }).sort(), 'mesmos animal_id');
          igual_(sub.animais.map(function (a) { return a.codigo_interno; }).sort(), orig.animais.map(function (a) { return a.codigo_interno; }).sort(), 'mesmos codigo_interno');
          igual_(t.evento(orig.event_id).status, 'ESTORNADO', 'original');
          igual_(t.evento(loc.event_id).status, 'CONFIRMADO', 'a correção de localização segue valendo');
          var animais = t.tabela('ANIMAIS').filter(function (a) { return ['1801', '1812', '1803', '1802'].indexOf(a.brinco) >= 0; });
          igual_(animais.map(function (a) { return a.brinco; }).sort(), ['1801', '1803', '1812'], 'três linhas, brinco trocado');
          verificar_(animais.every(function (a) { return a.evento_origem_id === sub.event_id && a.pasto_atual_id === t.estado.pastos.B; }), 'origem no substituto e pasto da correção posterior');
        });
        t.passo('E2', 'Corrigir a entrada retirando 1803 (que tem evento posterior): CONFLICT', function () {
          var m = porBrinco_(sub);
          t.recusa('evento.corrigir', { tipo: 'ENTRADA_INICIAL', campos: {}, event_id: sub.event_id, justificativa: 'Tirar o 1803', animais: [item(m['1801'], '1801'), item(m['1812'], '1812')] }, 'CONFLICT', 'ct18-tirar-entrada');
        });
        t.passo('fim', 'Projeção = reconstrução e financeiro sem divergência', function () { return t.integra('CT-18'); });
      },
    },
    {
      id: 'CT-10', titulo: 'Reenvio não duplica; gravações não se intercalam (OUTRA_ENTRADA nos passos 1, 2, 4 e 5; a pesagem no passo 3)',
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
        t.passo('3', 'Mesma pesagem com chave nova: aviso POSSIVEL_DUPLICIDADE; com o aceite, grava', function () {
          var animal = r1.dados.animais[0].animal_id;
          var p = pesagem_(Utils.somaDias(t.estado.d0, 20), [{ animal_id: animal, peso: 410.0 }]);
          t.cmd('evento.registrar', p, 'ct10-pesagem');
          var e = t.recusa('evento.registrar', p, 'NEEDS_CONFIRMATION', 'ct10-pesagem-2');
          igual_(e.details.map(function (d) { return d.codigo; }), ['POSSIVEL_DUPLICIDADE'], 'aviso de duplicidade');
          t.cmd('evento.registrar', p, 'ct10-pesagem-2', { avisos: ['POSSIVEL_DUPLICIDADE'] });
          igual_(t.tabela('PESAGENS').filter(function (x) { return x.animal_id === animal; }).length, 2, 'duas pesagens com o aceite');
        });
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
      id: 'CT-12', titulo: 'Importação: nada entra em silêncio nem pela metade; a reconciliação com o histórico lista sem bloquear',
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
        var idH = null;
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
          t.passo('5r', 'Reconciliação (RN-095): transferência histórica do 1210 (antes do marco zero) diverge da fotografia e um brinco sem animal; a importação conclui e a lista aparece no relatório e na rota', function () {
            var csvH = ['Data;Pasto de origem;Pasto de destino;Brinco', br_(Utils.somaDias(d0, -100)) + ';Pasto A;Pasto B;1210', br_(Utils.somaDias(d0, -90)) + ';Pasto A;Pasto B;1299'].join('\r\n');
            var mapaH = { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} };
            idH = t.cmd('importacao.criar', { tipo: 'TRANSFERENCIAS', arquivo_nome: 'aceitacao-ct12-historico.csv', texto: csvH, formato: FORMATO_CSV }, 'ct12-hist-criar').import_id;
            var est = null;
            for (var b = 1; b < 10 && (!est || est.importacao.status !== 'VALIDADO'); b++) est = t.cmd('importacao.validarBloco', { import_id: idH, bloco: b, mapeamento: mapaH }, 'ct12-hist-val-' + b);
            igual_([est.importacao.status, est.contadores.validas, est.contadores.erro], ['VALIDADO', 1, 1], 'uma linha boa e o brinco sem animal');
            var bl = t.ok(t.api('importacao.importarBloco', { import_id: idH, bloco: 1, modo: 'PARCIAL_APROVADO', aprovacao: { importar: 1, ignorar: 1 } }), 'bloco 1');
            for (var n = 2; bl.blocos.proximo !== null && n < 10; n++) bl = t.ok(t.api('importacao.importarBloco', { import_id: idH, bloco: n }), 'bloco ' + n);
            var fim = t.ok(t.api('importacao.concluir', { import_id: idH }), 'concluir');
            var rec = fim.reconciliacao;
            igual_(fim.importacao.status, 'IMPORTADO', 'a divergência não bloqueia');
            igual_(rec.animais.map(function (x) { return [x.brinco, x.codigo, x.declarado.pasto, x.recalculado.pasto]; }), [['1210', 'PASTO_DIVERGENTE', 'Pasto A', 'Pasto B']], 'o 1210 na reconciliação');
            verificar_(rec.resumo.bloqueia === false && !vazio_(rec.animais[0].explicacao) && !vazio_(rec.animais[0].acao), 'explicação e o que fazer, sem bloquear');
            verificar_(rec.sem_animal.some(function (x) { return x.import_id === idH && x.linha_num === 3; }), 'o brinco 1299 aparece como linha sem animal');
            var rota = t.ok(t.api('importacao.reconciliacao', {}), 'importacao.reconciliacao');
            igual_(rota.animais.map(function (x) { return [x.brinco, x.codigo]; }), [['1210', 'PASTO_DIVERGENTE']], 'a rota mostra a mesma divergência');
            igual_(t.animal(rec.animais[0].animal_id).pasto_atual_id, t.estado.pastos.A, 'o histórico não mexe na posição de hoje');
            igual_(t.ok(t.api('importacao.desfazer', { import_id: idH, justificativa: 'Teste de aceitação: só para conferir a reconciliação' }), 'desfazer o histórico').importacao.status, 'CANCELADO', 'histórico desfeito');
            igual_(t.ok(t.api('importacao.reconciliacao', {}), 'reconciliação depois').animais.length, 0, 'sem o histórico, nada a reconciliar');
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
          // Importação de teste em curso travaria os cenários seguintes: desfaz (a do histórico antes, porque ela usa os
          // animais da outra). Falha da limpeza também é falha.
          [idH, id].forEach(function (imp) {
            var est = imp ? t.api('importacao.obter', { import_id: imp }) : null;
            if (est && est.ok && est.data.importacao.status === 'IMPORTANDO') {
              var limpo = t.api('importacao.desfazer', { import_id: imp, justificativa: 'Limpeza do teste de aceitação' });
              t.passos.push({ passo: 'limpeza', titulo: 'Desfazer a importação de teste interrompida', situacao: limpo.ok ? SITUACAO.PASSOU : SITUACAO.FALHOU, detalhe: limpo.ok ? null : limpo.error.message });
              if (!limpo.ok && !falhou) throw falha_('Não foi possível desfazer a importação de teste: ' + limpo.error.message);
            }
          });
        }
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
    { nome: 'Pasto da Sede', area_hectares: 90, capacidade_estimada_ua_ha: 2.5 },
    { nome: 'Pasto do Córrego', area_hectares: 85, capacidade_estimada_ua_ha: 2.4 },
    { nome: 'Pasto da Baixada', area_hectares: 80, capacidade_estimada_ua_ha: 2.2 },
    { nome: 'Pasto das Novilhas', area_hectares: 90, capacidade_estimada_ua_ha: 2.5 },
    { nome: 'Pasto da Recria', area_hectares: 90, capacidade_estimada_ua_ha: 2.6 },
    { nome: 'Pasto Arrendado do Vizinho', area_hectares: 70, capacidade_estimada_ua_ha: 2.2, posse: 'ARRENDADO' },
  ];
  /** Último dia de evento da demonstração (D0 + 1090; o marco zero fica 1.095 dias antes de hoje). */
  var DEMO_FIM = 1090;
  /** A composição de 09, seção 7: 240 em D0 + 255 nascidos + 70 comprados − 240 vendidos − 15 mortos − 5 descartados − 1 baixa na contagem. */
  var DEMO_META = { d0: 240, nascimentos: 255, compras: 70, vendas: 240, mortes: 15, descartes: 5, divergencias: 1, ativos: 304 };
  /** O que 09, seção 7, pede e chega em fase posterior (o relatório da demonstração lista, com a fase). */
  var DEMO_FORA = [
    { item: 'Lançamentos avulsos com rateio (evento RATEIO)', fase: 4 },
    { item: 'Parcelas em todos os estados (baixa, baixa parcial, desfazer baixa)', fase: 4 },
  ];
  /** Início das três estações de monta da demonstração (D0+30, D0+395, D0+760; 90 dias de touro cada). */
  var DEMO_ESTACOES = [30, 395, 760];
  var DIAS_DESMAMA = 240;
  /** Menor intervalo entre dois partos da mesma vaca no plano: 285 dias de gestação e 55 de resguardo. */
  var INTERVALO_PARTOS = 340;
  var CAMPANHA_IDENT = 60;
  var CAMPANHA_DESMAMA = 90;
  var DIAS_BOIS = [180, 360, 540, 720, 900, 1080];
  /** Pesagens coletivas da recria, das novilhas e do pasto arrendado (a cada 120 dias, a partir de D0+60). */
  var DIAS_PESAGEM = [60, 180, 300, 420, 540, 660, 780, 900, 1020];
  var PASTOS_PESADOS = [3, 4, 5];
  /**
   * Manejos sanitários coletivos da demonstração (Fase 3, E3.3): a vacina com estoque controlado (a compra das doses
   * no dia da campanha, antes da aplicação) a cada 180 dias em todo o rebanho, e o vermífugo sem controle de estoque nos
   * pastos da recria, no dia seguinte a cada pesagem. Sem carência: a demonstração não fica sem vender para abate.
   */
  var DIAS_VACINA = [130, 310, 490, 670, 850, 1030];
  /** Castração dos garrotes inteiros do marco zero (Fase 3, aceitação): um mês antes da primeira pesagem da recria. */
  var DIA_CASTRACAO_GARROTES = 30;
  /**
   * Ocorrências do curral da demonstração (Fase 3, aceitação): o dia, o tipo da lista TIPO_OCORRENCIA, a descrição e quem
   * (o primeiro presente, ou os N primeiros, na ordem do plano, que casam com a condição no dia).
   */
  var OCORRENCIAS_DEMO = [
    { dia: 150, tipo: 'LESAO', descricao: 'Ferida no casco, tratada no curral', n: 1, quem: function (a) { return a.tipo === 'VACA'; } },
    { dia: 405, tipo: 'APARTACAO', descricao: 'Apartação das novilhas para a estação de monta', n: 30, quem: function (a, p) { return a.sexo === 'F' && p === 3; } },
    { dia: 615, tipo: 'OBSERVACAO', descricao: 'Touro mancando: observar antes da próxima monta', n: 1, quem: function (a) { return a.tipo === 'TOURO'; } },
    { dia: 835, tipo: 'DESCORNA', descricao: 'Descorna dos garrotes da recria', n: 20, quem: function (a, p) { return a.sexo === 'M' && p === 4; } },
    { dia: 1005, tipo: 'FERRA', descricao: 'Marcação a ferro das novilhas', n: 30, quem: function (a, p) { return a.sexo === 'F' && a.tipo === 'NASCIDO' && p === 3; } },
  ];

  /**
   * Os comandos da demonstração, sorteados com semente fixa a partir de D0 (09, seção 7, na parte que as fases entregues
   * cobrem): 240 em D0 em 6 lotes de 40 (110 vacas, 4 touros, 30 novilhas, 48 bezerros ao pé com a mãe no mesmo lote, 48
   * garrotes); 10 compras de 7 (garrotes e novilhas; por cabeça com o valor de cada um ou por kg vivo; frete e duas
   * parcelas); partos até 255 nascidos vivos (gêmeos, natimortos, intervalo de pelo menos 355 dias, novilha só depois dos
   * 27 meses), com o brinco no nascimento ou nas campanhas de identificação; desmama aos 8 meses (fêmeas para o Pasto das
   * Novilhas, machos para a Recria ou vendidos); 240 vendidos (bois por arroba de carcaça, vacas de descarte por arroba
   * de peso vivo estimada, bezerros por kg vivo, novilhas por cabeça); 15 mortes, 5 descartes, 1 baixa na contagem
   * (depois da marcação de não localizado); transferências para o pasto arrendado e de volta; uma troca de brinco; uma
   * entrada e uma transferência estornadas; uma compra e uma venda corrigidas. Fecha em 304 ativos.
   *
   * A geração simula o rebanho dia a dia, na ordem em que os comandos serão gravados (entradas, movimentos e saídas de
   * cada dia), e só planeja o que a linha do tempo aceita: o mesmo plano roda sem nenhuma recusa (09, seção 8). Os
   * comandos referem animais, pastos, parceiros e eventos por marcadores ('@a:<chave>', '@p:<i>', '@f:<papel>',
   * '@e:<chave do comando>'), resolvidos na hora de gravar: reexecutar dá o mesmo conteúdo, e a chave `seed:<n>` devolve
   * o duplicado sem gravar de novo.
   */
  function geracaoDemo_(d0) {
    var rnd = sorteio_(20261114);
    var seq = 0;
    var novoBrinco = function () { seq += 1; var s = String(seq); while (s.length < 4) s = '0' + s; return s; };
    var entre = function (a, b) { return a + Math.floor(rnd() * (b - a + 1)); };
    var dia = function (n) { return Utils.somaDias(d0, n); };
    var raca = function () { return rnd() < 0.8 ? 'NELORE' : 'GUZERA'; };
    var A = {};
    var ordem = [];
    var animal = function (k, x) {
      x.k = k;
      x.saida = null;
      A[k] = x;
      ordem.push(k);
      return x;
    };
    // 1. Fotografia do marco zero: 6 lotes de 40 (a vaca e a cria no mesmo lote, ligadas por ref).
    var lotes = [[], [], [], [], [], []];
    var vacas = [];
    var garrotes = [];
    var novilhas = [];
    var touros = [];
    var bezerrosD0 = [];
    for (var i = 0; i < 48; i++) {
      var p = i % 3;
      var vaca = animal(novoBrinco(), { tipo: 'VACA', sexo: 'F', raca: raca(), nasc: -entre(1100, 3600), pasto: p, entrada: 0, partos_previos: entre(1, 5), peso: entre(380, 520), valor: entre(4500, 6500) * 100 });
      var macho = rnd() < 0.5;
      var cria = animal(novoBrinco(), { tipo: 'BEZERRO', sexo: macho ? 'M' : 'F', raca: raca(), nasc: -entre(60, 210), pasto: p, entrada: 0, mae: vaca.k, peso: entre(80, 200), valor: entre(1500, 2500) * 100 });
      vaca.criaD0 = cria.nasc;
      lotes[Math.floor(i / 8)].push(vaca.k, cria.k);
      vacas.push(vaca.k);
      bezerrosD0.push(cria.k);
    }
    var outros = [];
    for (var v = 0; v < 62; v++) { var x = animal(novoBrinco(), { tipo: 'VACA', sexo: 'F', raca: raca(), nasc: -entre(1100, 3600), pasto: v % 3, entrada: 0, partos_previos: entre(1, 6), peso: entre(380, 520), valor: entre(4500, 6500) * 100 }); outros.push(x.k); vacas.push(x.k); }
    for (var r = 0; r < 4; r++) { var tr = animal(novoBrinco(), { tipo: 'TOURO', sexo: 'M', raca: 'NELORE', reprodutor: true, castrado: false, nasc: -entre(1500, 2500), pasto: r % 2, entrada: 0, peso: entre(700, 900), valor: 1200000 }); outros.push(tr.k); touros.push(tr.k); }
    for (var n = 0; n < 30; n++) { var nv = animal(novoBrinco(), { tipo: 'NOVILHA', sexo: 'F', raca: raca(), nasc: -entre(430, 730), pasto: 3, entrada: 0, partos_previos: 0, peso: entre(260, 360), valor: entre(2500, 3200) * 100 }); outros.push(nv.k); novilhas.push(nv.k); }
    for (var g = 0; g < 48; g++) { var ga = animal(novoBrinco(), { tipo: 'GARROTE', sexo: 'M', raca: raca(), castrado: rnd() < 0.5, reprodutor: false, nasc: -entre(370, 730), pasto: 4, entrada: 0, peso: entre(250, 380), valor: entre(2200, 3000) * 100 }); outros.push(ga.k); garrotes.push(ga.k); }
    outros.forEach(function (k, j) { lotes[j % 6].push(k); });
    // 2. Dez compras de 7: garrotes (Recria) e novilhas (Pasto das Novilhas).
    var compras = [45, 140, 230, 320, 410, 500, 590, 680, 770, 860].map(function (d, c) {
      var porKg = c % 2 === 1;
      var ks = [];
      for (var y = 0; y < 7; y++) {
        var m = y % 2 === 0;
        var b = animal(novoBrinco(), m
          ? { tipo: 'COMPRADO', sexo: 'M', raca: raca(), castrado: true, reprodutor: false, nasc: d - entre(400, 700), pasto: 4, entrada: d }
          : { tipo: 'COMPRADO', sexo: 'F', raca: raca(), partos_previos: 0, nasc: d - entre(400, 700), pasto: 3, entrada: d });
        if (porKg) b.peso = entre(230, 330);
        else b.valor = m ? 280000 : 260000;
        ks.push(b.k);
      }
      return { dia: d, porKg: porKg, animais: ks };
    });
    var estornada = animal(novoBrinco(), { tipo: 'ESTORNADA', sexo: 'F', raca: 'NELORE', partos_previos: 0, nasc: 1000 - entre(400, 600), pasto: 3, entrada: 1000 });
    // 3. Saídas dos adultos, decididas antes dos partos (a vaca que sai não pare depois).
    var sai = function (k, d, tipo) { A[k].saida = { dia: d, tipo: tipo }; };
    var vendas = [];
    var venda = function (d, tipo, ks) { if (ks.length) { vendas.push({ dia: d, tipo: tipo, animais: ks }); ks.forEach(function (k) { sai(k, d, 'VENDA'); }); } };
    sai(garrotes[47], 400, 'MORTE');
    sai(garrotes[46], 640, 'DIVERGENCIA');
    var lotesBois = DIAS_BOIS.map(function () { return []; });
    garrotes.slice(0, 46).forEach(function (k, j) { lotesBois[j < 12 ? 0 : j < 24 ? 1 : j < 36 ? 2 : 3].push(k); });
    compras.forEach(function (c) {
      var lote = DIAS_BOIS.indexOf(DIAS_BOIS.filter(function (d) { return d >= c.dia + 330; })[0]);
      if (lote >= 0) c.animais.forEach(function (k) { if (A[k].sexo === 'M') lotesBois[lote].push(k); });
    });
    lotesBois.forEach(function (ks, j) { venda(DIAS_BOIS[j], 'BOIS', ks); });
    var velhas = vacas.slice().sort(function (a, b) { return A[a].nasc - A[b].nasc || (a < b ? -1 : 1); });
    venda(300, 'VACAS', velhas.slice(0, 8));
    venda(600, 'VACAS', velhas.slice(8, 16));
    venda(780, 'VACAS', velhas.slice(16, 20));
    venda(900, 'VACAS', velhas.slice(20, 25));
    var descartes = [[250, 'CONSUMO_PROPRIO', 'IDADE'], [480, 'DOACAO', 'FALHA_REPRODUTIVA'], [700, 'CONSUMO_PROPRIO', 'IDADE'], [850, 'SACRIFICIO', 'SANITARIO'], [1000, 'PERMUTA', 'TEMPERAMENTO']].map(function (x, j) {
      sai(velhas[25 + j], x[0], 'DESCARTE');
      return { dia: x[0], animal: velhas[25 + j], destino: x[1], motivo: x[2], receita: j === 4 ? 180000 : null };
    });
    var compradas = [];
    compras.forEach(function (c) { c.animais.forEach(function (k) { if (A[k].sexo === 'F') compradas.push(k); }); });
    venda(505, 'NOVILHAS', compradas.slice(0, 8));
    venda(800, 'NOVILHAS', compradas.slice(8, 12));
    venda(950, 'NOVILHAS', compradas.slice(12, 16));
    var mortes = [];
    var morte = function (k, d, causa) { sai(k, d, 'MORTE'); mortes.push({ dia: d, animal: k, causa: causa }); };
    mortes.push({ dia: 400, animal: garrotes[47], causa: 'PICADA_COBRA' });
    morte(touros[3], 820, 'ACIDENTE');
    var livres = vacas.filter(function (k) { return !A[k].saida; });
    var causas = ['DOENCA', 'RAIO', 'PARTO', 'INTOXICACAO', 'PREDADOR', 'DESCONHECIDA', 'ACIDENTE'];
    for (var mo = 0; mo < 7; mo++) morte(livres[(mo * 11 + 5) % livres.length], 90 + mo * 140 + entre(0, 30), causas[mo]);
    // 4. Partos pela estação de monta (Fase 3): das vacas sem cria ao pé, 60% chegaram prenhes da estação anterior e parem
    // nos primeiros 60 dias; em cada estação, a fêmea exposta (25 meses ou mais, no rebanho no primeiro dia) emprenha com
    // 88% de chance, e o parto cai na janela da estação (início + 285 a + 375 dias), a pelo menos 340 dias do parto anterior
    // (a vaca que pariu tarde não emprenha na estação seguinte). Do mais cedo ao mais tarde, até 255 nascidos vivos: a última
    // estação fica com partos por vir (prenhas sem desfecho, janela aberta).
    var cand = [];
    var ultimoParto = {};
    var concebeu = DEMO_ESTACOES.map(function () { return {}; });
    var presente = function (k, d) { var a = A[k]; return a.entrada <= d && (!a.saida || a.saida.dia >= d); };
    var podeParir = function (k, d) { var a = A[k]; return a.entrada < d && (!a.saida || a.saida.dia > d) && d <= DEMO_FIM - 2; };
    vacas.forEach(function (k) {
      if (A[k].criaD0 !== undefined) { ultimoParto[k] = A[k].criaD0; return; }
      if (rnd() >= 0.6) return;
      var d = entre(5, 60);
      ultimoParto[k] = d;
      if (podeParir(k, d)) cand.push({ dia: d, mae: k });
    });
    DEMO_ESTACOES.forEach(function (ini, y) {
      ordem.forEach(function (k) {
        var a = A[k];
        if (a.sexo !== 'F' || a.tipo === 'ESTORNADA' || a.nasc > ini - 760 || !presente(k, ini)) return;
        if (rnd() >= 0.88) return;
        var c = ini + 285 + entre(0, 90);
        if (ultimoParto[k] !== undefined) c = Math.max(c, ultimoParto[k] + INTERVALO_PARTOS);
        if (c > ini + 375) return;
        concebeu[y][k] = c;
        if (!podeParir(k, c)) return;
        ultimoParto[k] = c;
        cand.push({ dia: c, mae: k });
      });
    });
    var partos = [];
    var nascidos = [];
    var vivos = 0;
    while (vivos < DEMO_META.nascimentos) {
      var mi = -1;
      cand.forEach(function (c, j) { if (mi < 0 || c.dia < cand[mi].dia || (c.dia === cand[mi].dia && c.mae < cand[mi].mae)) mi = j; });
      if (mi < 0) throw Validation.erro('INTERNAL', 'O plano da demonstração não chegou aos ' + DEMO_META.nascimentos + ' nascimentos.');
      var c = cand.splice(mi, 1)[0];
      var sorte = rnd();
      var forma = partos.length === 7 ? ['F', null] : sorte < 0.02 ? [null] : sorte < 0.035 && vivos + 2 <= DEMO_META.nascimentos ? ['M', 'F'] : [rnd() < 0.5 ? 'M' : 'F'];
      var crias = forma.map(function (sexo) {
        if (sexo === null) return { situacao_nascimento: 'NATIMORTO' };
        vivos += 1;
        var b = animal('n' + (nascidos.length + 1), { tipo: 'NASCIDO', sexo: sexo, nasc: c.dia, mae: c.mae, entrada: c.dia });
        if (rnd() < 0.25) b.brinco = novoBrinco();
        if (rnd() < 0.6) b.peso = entre(28, 38);
        if (sexo === 'M') { b.castrado = false; b.reprodutor = false; }
        nascidos.push(b.k);
        return { situacao_nascimento: 'VIVO', sexo: sexo, k: b.k };
      });
      partos.push({ dia: c.dia, mae: c.mae, crias: crias, tipo_parto: forma.length > 1 ? 'ASSISTIDO' : null });
    }
    // O limite dos 255 só corta partos da última estação (a janela dela passa do fim da demonstração): o parto cortado de
    // uma estação encerrada viraria perda gestacional sem ter havido perda.
    if (cand.some(function (c) { return c.dia < DEMO_ESTACOES[DEMO_ESTACOES.length - 1] + 285; })) throw Validation.erro('INTERNAL', 'O plano da demonstração cortou partos de uma estação encerrada.');
    // 5. As crias: 6 morrem pequenas; desmama aos 8 meses na campanha (machos vendidos até fechar os 240, os demais
    // para a Recria — no último ano, para o pasto arrendado — e as fêmeas para o Pasto das Novilhas).
    var candidatas = nascidos.filter(function (k) { return A[k].nasc < 900 && A[k].sexo === 'M'; });
    for (var cm = 0; cm < 6; cm++) {
      var kc = candidatas[(cm * 37 + 3) % candidatas.length];
      if (A[kc].saida) kc = candidatas[(cm * 37 + 4) % candidatas.length];
      morte(kc, A[kc].nasc + entre(5, 60), cm % 2 ? 'DOENCA' : 'PREDADOR');
    }
    var desmamas = {};
    bezerrosD0.concat(nascidos).forEach(function (k) {
      var a = A[k];
      var w = Math.ceil((a.nasc + DIAS_DESMAMA) / CAMPANHA_DESMAMA) * CAMPANHA_DESMAMA;
      if (w < 1) w = CAMPANHA_DESMAMA;
      if (w > DEMO_FIM || (a.saida && a.saida.dia <= w)) return;
      a.desmama = w;
      (desmamas[w] = desmamas[w] || []).push(k);
    });
    var faltam = DEMO_META.vendas - vendas.reduce(function (s, x) { return s + x.animais.length; }, 0);
    Object.keys(desmamas).map(Number).sort(function (a, b) { return a - b; }).forEach(function (w) {
      var ks = desmamas[w].slice().sort(function (a, b) { return A[a].sexo === A[b].sexo ? (ordem.indexOf(a) - ordem.indexOf(b)) : A[a].sexo === 'M' ? -1 : 1; });
      var vendidos = [];
      ks.forEach(function (k) { if (faltam > 0 && (A[k].sexo === 'M' || w >= 720)) { vendidos.push(k); faltam -= 1; } });
      venda(w, 'BEZERROS', vendidos);
      ks.forEach(function (k) { if (!A[k].saida) A[k].destinoDesmama = A[k].sexo === 'F' ? 3 : w >= 900 ? 5 : 4; });
    });
    if (faltam !== 0) throw Validation.erro('INTERNAL', 'O plano da demonstração não fecha as ' + DEMO_META.vendas + ' vendas (faltam ' + faltam + ').');
    // Campanhas de identificação (a cada 60 dias): a cria sem brinco recebe o número entre 5 e 7 meses.
    var campanhas = {};
    nascidos.forEach(function (k) {
      var a = A[k];
      if (a.brinco) return;
      var d = Math.ceil((a.nasc + entre(150, 200)) / CAMPANHA_IDENT) * CAMPANHA_IDENT;
      if (d > DEMO_FIM || (a.saida && a.saida.dia <= d)) return;
      (campanhas[d] = campanhas[d] || []).push(k);
    });
    Object.keys(campanhas).map(Number).sort(function (a, b) { return a - b; }).forEach(function (d) { campanhas[d].forEach(function (k) { A[k].brinco = novoBrinco(); A[k].identificada = d; }); });
    var trocado = nascidos.filter(function (k) { return A[k].identificada && A[k].identificada < 600 && !A[k].saida; })[0];
    var troca = trocado ? { dia: A[trocado].identificada + 45, animal: trocado, codigo: novoBrinco() } : null;
    // Pesagens coletivas (Fase 3): o último peso conhecido de cada animal (o do marco zero, o da compra por kg, o ao nascer) e
    // o ganho diário de cada um, fixo e plausível (0,40 a 0,69 kg/dia, sem sorteio: a sequência do resto do plano não muda);
    // sem peso conhecido, o primeiro vem da idade. O animal pesado no mesmo dia por outro lançamento fica de fora.
    var pesoConhecido = {};
    ordem.forEach(function (k) { var a = A[k]; if (a.peso) pesoConhecido[k] = { dia: a.tipo === 'NASCIDO' || a.tipo === 'COMPRADO' ? a.entrada : 0, kg: a.peso }; });
    var ganhoDe = function (k) { var h = 0; for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 1000; return 0.4 + (h % 30) / 100; };
    var pesoEm = function (k, d) {
      var c = pesoConhecido[k];
      var kg = c ? c.kg + ganhoDe(k) * (d - c.dia) : 30 + 0.6 * (d - A[k].nasc);
      kg = Math.round(Math.min(Math.max(kg, 30), 650) * 10) / 10;
      pesoConhecido[k] = { dia: d, kg: kg };
      return kg;
    };
    // 6. Emissão: um comando por passo, dia a dia (entradas, movimentos, saídas), com a posição de cada animal.
    var cmds = [];
    var pasto = {};
    var ativo = {};
    var emitir = function (nome, dados, extra) {
      var c = { n: cmds.length, nome: nome, rota: 'evento.registrar', dados: dados };
      Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
      cmds.push(c);
      return c;
    };
    var ref = function (k) { return '@a:' + k; };
    var itemD0 = function (a) {
      var it = { brinco: a.k, sexo: a.sexo, raca: a.raca, data_nascimento: dia(a.nasc), data_nascimento_confianca: a.tipo === 'BEZERRO' ? 'CONFIRMADA' : 'ESTIMADA', origem: 'DESCONHECIDA', pasto_destino_id: '@p:' + a.pasto, peso: a.peso, metodo_pesagem: 'BALANCA', valor_abertura: a.valor };
      if (a.sexo === 'M') { it.castrado = !!a.castrado; it.reprodutor = !!a.reprodutor; }
      if (a.partos_previos !== undefined) it.partos_previos = a.partos_previos;
      if (a.criaD0 !== undefined) it.ref = 'v' + a.k;
      if (a.mae) { it.mae_ref = 'v' + a.mae; it.mae_confianca = 'CONFIRMADA'; }
      return it;
    };
    lotes.forEach(function (l, j) {
      emitir('lote-' + (j + 1), { tipo: 'ENTRADA_INICIAL', campos: {}, animais: l.map(function (k) { return itemD0(A[k]); }) }, { criados: l.slice() });
      l.forEach(function (k) { pasto[k] = A[k].pasto; ativo[k] = true; });
    });
    var porDia = {};
    var no = function (d, classe, fn) { ((porDia[d] = porDia[d] || [[], [], []])[classe]).push(fn); };
    compras.forEach(function (c, j) {
      no(c.dia, 0, function () {
        var itens = c.animais.map(function (k) {
          var a = A[k];
          var it = { brinco: a.k, sexo: a.sexo, raca: a.raca, data_nascimento: dia(a.nasc), data_nascimento_confianca: 'ESTIMADA', pasto_destino_id: '@p:' + a.pasto };
          if (a.sexo === 'M') { it.castrado = true; it.reprodutor = false; } else it.partos_previos = 0;
          if (c.porKg) { it.peso = a.peso; it.metodo_pesagem = 'BALANCA'; } else it.valor_individual = a.valor;
          return it;
        });
        var total = c.porKg ? itens.reduce(function (s, it) { return s + it.peso * 1300; }, 0) : itens.reduce(function (s, it) { return s + it.valor_individual; }, 0);
        var campos = { event_date: dia(c.dia), partner_id: '@f:fornecedor', finalidade: 'RECRIA_ENGORDA', modalidade: c.porKg ? 'KG_VIVO' : 'CABECA', pasto_destino_id: '@p:4', valor_animais: total };
        if (c.porKg) campos.preco_unitario = 1300;
        var dados = { tipo: 'COMPRA', campos: campos, animais: itens, parcelas: [{ data_vencimento: dia(c.dia + 30) }, { data_vencimento: dia(c.dia + 60) }], custos: [{ tipo: 'FRETE', valor: 40000, data_vencimento: dia(c.dia) }] };
        var cmd = emitir('compra-' + (j + 1), dados, { criados: c.animais.slice() });
        c.animais.forEach(function (k) { pasto[k] = A[k].pasto; ativo[k] = true; });
        if (j === 2) {
          // Correção da compra: o frete da nota era 450,00 (mesmos animais, com os animal_id da compra).
          var fix = JSON.parse(JSON.stringify(dados));
          fix.animais.forEach(function (it, ii) { it.animal_id = ref(c.animais[ii]); });
          fix.custos[0].valor = 45000;
          fix.event_id = '@e:' + cmd.n;
          fix.justificativa = 'Frete conferido na nota (demonstração)';
          emitir('compra-3-corrigida', fix, { rota: 'evento.corrigir' });
        }
      });
    });
    no(estornada.entrada, 0, function () {
      var e = emitir('entrada-estornada', { tipo: 'OUTRA_ENTRADA', campos: { event_date: dia(estornada.entrada), description: 'Lançada por engano (demonstração)' }, animais: [{ brinco: estornada.k, sexo: 'F', raca: 'NELORE', partos_previos: 0, data_nascimento: dia(estornada.nasc), data_nascimento_confianca: 'ESTIMADA', origem: 'DESCONHECIDA', pasto_destino_id: '@p:3' }] }, { criados: [estornada.k] });
      emitir('entrada-estornada:estorno', { event_id: '@e:' + e.n, justificativa: 'Lançada por engano (demonstração)' }, { rota: 'evento.estornar' });
    });
    partos.forEach(function (pt, j) {
      no(pt.dia, 0, function () {
        var crias = pt.crias.map(function (c) {
          if (c.situacao_nascimento !== 'VIVO') return { situacao_nascimento: 'NATIMORTO' };
          var a = A[c.k];
          var it = { situacao_nascimento: 'VIVO', sexo: a.sexo };
          if (a.brinco && !a.identificada) it.brinco = a.brinco;
          if (a.peso) { it.peso = a.peso; it.metodo_pesagem = 'BALANCA'; }
          pasto[c.k] = pasto[pt.mae];
          ativo[c.k] = true;
          return it;
        });
        var campos = { event_date: dia(pt.dia) };
        if (pt.tipo_parto) campos.tipo_parto = pt.tipo_parto;
        emitir('parto-' + (j + 1), { tipo: 'NASCIMENTO', campos: campos, animais: [{ animal_id: ref(pt.mae) }], crias: crias }, { mae: pt.mae, crias: pt.crias.filter(function (c) { return c.k; }).map(function (c) { return c.k; }) });
      });
    });
    var transferir = function (nome, d, ks, destino) {
      var grupos = {};
      ks.forEach(function (k) { if (ativo[k] && pasto[k] !== destino) (grupos[pasto[k]] = grupos[pasto[k]] || []).push(k); });
      Object.keys(grupos).map(Number).sort().forEach(function (origem) {
        var c = emitir(nome + '-' + origem + '-' + destino, transf_(dia(d), '@p:' + origem, '@p:' + destino, grupos[origem].map(ref)));
        grupos[origem].forEach(function (k) { pasto[k] = destino; });
        return c;
      });
    };
    Object.keys(campanhas).forEach(function (d) {
      no(Number(d), 1, function () {
        var ks = campanhas[d].filter(function (k) { return ativo[k]; });
        if (ks.length) emitir('identificacao-' + d, ident_('PRIMEIRA_IDENTIFICACAO', dia(Number(d)), 'BRINCO', ks.map(function (k) { return { animal_id: ref(k), codigo: A[k].brinco }; })));
      });
    });
    if (troca) no(troca.dia, 1, function () { emitir('troca-de-brinco', ident_('SUBSTITUICAO', dia(troca.dia), 'BRINCO', [{ animal_id: ref(troca.animal), codigo: troca.codigo, motivo: 'PERDA' }])); });
    // Desmama (Fase 3, E3.4): na campanha, um lançamento DESMAMA por pasto de destino, com o peso de cada bezerro (o modelo de
    // ganho); os vendidos no mesmo dia são desmamados no pasto em que estão, sem pesar (a pesagem deles é a da venda).
    Object.keys(desmamas).forEach(function (w) {
      no(Number(w), 1, function () {
        var d = Number(w);
        var vendidosNoDia = desmamas[w].filter(function (k) { return ativo[k] && A[k].saida && A[k].saida.dia === d; });
        if (vendidosNoDia.length) emitir('desmama-' + w + '-venda', { tipo: 'DESMAMA', campos: { event_date: dia(d) }, animais: vendidosNoDia.map(function (k) { return { animal_id: ref(k) }; }) });
        [3, 4, 5].forEach(function (destino) {
          var ks = desmamas[w].filter(function (k) { return ativo[k] && A[k].destinoDesmama === destino; });
          if (!ks.length) return;
          emitir('desmama-' + w + '-' + destino, { tipo: 'DESMAMA', campos: { event_date: dia(d), pasto_destino_id: '@p:' + destino, metodo_pesagem: 'BALANCA' }, animais: ks.map(function (k) { return { animal_id: ref(k), peso: pesoEm(k, d) }; }) });
          ks.forEach(function (k) { pasto[k] = destino; });
        });
      });
      // Castração dos machos desmamados que ficam na recria, 30 dias depois da desmama.
      var dc = Number(w) + 30;
      if (dc <= DEMO_FIM) {
        no(dc, 1, function () {
          var ks = desmamas[w].filter(function (k) { return ativo[k] && A[k].sexo === 'M' && !A[k].castrado && (A[k].destinoDesmama === 4 || A[k].destinoDesmama === 5); });
          if (!ks.length) return;
          emitir('castracao-' + dc, { tipo: 'CASTRACAO', campos: { event_date: dia(dc), metodo: 'Burdizzo' }, animais: ks.map(function (k) { return { animal_id: ref(k) }; }) });
          ks.forEach(function (k) { A[k].castrado = true; });
        });
      }
    });
    // Castração dos garrotes inteiros do marco zero (com a visita paga do veterinário, rateada por cabeça).
    no(DIA_CASTRACAO_GARROTES, 1, function () {
      var ks = garrotes.filter(function (k) { return ativo[k] && !A[k].castrado; });
      if (!ks.length) return;
      emitir('castracao-garrotes', { tipo: 'CASTRACAO', campos: { event_date: dia(DIA_CASTRACAO_GARROTES), metodo: 'Cirúrgica', custo_valor: 30000, custo_conta_id: '@m:conta_veterinario', custo_partner_id: '@f:veterinario' }, animais: ks.map(function (k) { return { animal_id: ref(k) }; }) });
      ks.forEach(function (k) { A[k].castrado = true; });
    });
    // Ocorrências do curral (lista TIPO_OCORRENCIA): os animais escolhidos entre os presentes no dia, sempre na mesma ordem.
    OCORRENCIAS_DEMO.forEach(function (oc) {
      no(oc.dia, 1, function () {
        var ks = ordem.filter(function (k) { return ativo[k] && oc.quem(A[k], pasto[k]); }).slice(0, oc.n);
        if (!ks.length) return;
        emitir('ocorrencia-' + oc.dia, { tipo: 'OCORRENCIA', campos: { event_date: dia(oc.dia), tipo_ocorrencia: oc.tipo, description: oc.descricao }, animais: ks.map(function (k) { return { animal_id: ref(k) }; }) });
      });
    });
    no(200, 1, function () { transferir('arrendado', 200, garrotes.filter(function (k) { return ativo[k] && pasto[k] === 4; }).slice(0, 20), 5); });
    no(520, 1, function () { transferir('volta-do-arrendado', 520, garrotes.filter(function (k) { return ativo[k] && pasto[k] === 5; }), 4); });
    no(750, 1, function () {
      var ks = Object.keys(ativo).filter(function (k) { return ativo[k] && pasto[k] === 4; }).sort().slice(0, 3);
      if (!ks.length) return;
      var e = emitir('transferencia-estornada', transf_(dia(750), '@p:4', '@p:2', ks.map(ref)));
      emitir('transferencia-estornada:estorno', { event_id: '@e:' + e.n, justificativa: 'Lançada no pasto errado (demonstração)' }, { rota: 'evento.estornar' });
    });
    DIAS_PESAGEM.forEach(function (d) {
      no(d, 1, function () {
        PASTOS_PESADOS.forEach(function (p) {
          var ks = ordem.filter(function (k) { return ativo[k] && pasto[k] === p && !(pesoConhecido[k] && pesoConhecido[k].dia === d); });
          if (!ks.length) return;
          emitir('pesagem-' + d + '-' + p, { tipo: 'PESAGEM', campos: { event_date: dia(d), tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: ks.map(function (k) { return { animal_id: ref(k), peso: pesoEm(k, d) }; }) });
        });
      });
    });
    // Sanidade: a entrada das doses e a campanha de vacinação (pela agenda do protocolo a cada 180 dias), e a vermifugação.
    DIAS_VACINA.forEach(function (d) {
      no(d, 1, function () {
        var ks = ordem.filter(function (k) { return ativo[k]; });
        if (!ks.length) return;
        emitir('vacina-entrada-' + d, { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: dia(d), product_id: '@m:vacina', quantidade: ks.length + 10, valor: (ks.length + 10) * 150, partner_id: '@f:fornecedor', vencimento: dia(d + 30) } });
        emitir('vacina-' + d, { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: dia(d), produto_id: '@m:vacina', protocol_id: '@m:protocolo', modo_dose: 'POR_CABECA', dose_referencia: 1, via_aplicacao: 'SUBCUTANEA', lote: 'DEMO-' + d }, animais: ks.map(function (k) { return { animal_id: ref(k) }; }) });
      });
    });
    DIAS_PESAGEM.forEach(function (d) {
      no(d + 1, 1, function () {
        var ks = ordem.filter(function (k) { return ativo[k] && PASTOS_PESADOS.indexOf(pasto[k]) >= 0; });
        if (!ks.length) return;
        emitir('vermifugo-' + (d + 1), { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: dia(d + 1), produto_id: '@m:vermifugo', protocol_id: '@m:protocolo_vermifugo', modo_dose: 'POR_CABECA', dose_referencia: 5, via_aplicacao: 'SUBCUTANEA' }, animais: ks.map(function (k) { return { animal_id: ref(k) }; }) });
      });
    });
    no(610, 1, function () { emitir('nao-localizado', { tipo: 'MARCACAO', subtipo: 'NAO_LOCALIZADO', campos: { event_date: dia(610), acao: 'MARCAR' }, animais: [{ animal_id: ref(garrotes[46]) }] }); });
    no(270, 1, function () { emitir('marcar-descarte', { tipo: 'MARCACAO', subtipo: 'DESCARTE', campos: { event_date: dia(270), acao: 'MARCAR', motivo_descarte: 'IDADE' }, animais: velhas.slice(0, 8).map(function (k) { return { animal_id: ref(k) }; }) }); });
    var corrigidaVenda = false;
    vendas.forEach(function (vd, j) {
      no(vd.dia, 2, function () {
        var pesos = vd.animais.map(function (k) { return vd.tipo === 'BOIS' ? entre(480, 560) : vd.tipo === 'VACAS' ? entre(400, 480) : vd.tipo === 'BEZERROS' ? entre(170, 240) : null; });
        var campos = { event_date: dia(vd.dia), partner_id: vd.tipo === 'BOIS' || vd.tipo === 'VACAS' ? '@f:frigorifico' : '@f:comprador' };
        var animais = vd.animais.map(function (k, ii) { var it = { animal_id: ref(k) }; if (pesos[ii] !== null) it.peso = pesos[ii]; return it; });
        var deducoes = [];
        var preco;
        if (vd.tipo === 'BOIS') {
          animais.forEach(function (it) { it.peso_carcaca_kg = Math.round(it.peso * 0.52); });
          var carc = animais.reduce(function (s, it) { return s + it.peso_carcaca_kg; }, 0);
          campos.finalidade = 'ABATE'; campos.modalidade = 'ARROBA'; campos.base_peso = 'CARCACA'; campos.preco_unitario = 30000; campos.valor_bruto = Math.round(carc * 30000 / 15);
          deducoes.push({ tipo: 'FUNRURAL', valor: Math.round(campos.valor_bruto * 0.015), retida_pelo_comprador: true });
        } else if (vd.tipo === 'VACAS') {
          var vivo = animais.reduce(function (s, it) { return s + it.peso; }, 0);
          campos.finalidade = 'ABATE'; campos.modalidade = 'ARROBA'; campos.base_peso = 'VIVO'; campos.rendimento_carcaca_pct = 50; campos.rendimento_tipo = 'ESTIMADO'; campos.preco_unitario = 28000;
          campos.valor_bruto = Math.round(vivo * 0.5 / 15 * 28000);
          deducoes.push({ tipo: 'FRETE', valor: 60000 });
        } else if (vd.tipo === 'BEZERROS') {
          preco = 1200;
          campos.finalidade = 'RECRIA_ENGORDA'; campos.modalidade = 'KG_VIVO'; campos.preco_unitario = preco; campos.valor_bruto = animais.reduce(function (s, it) { return s + it.peso; }, 0) * preco;
          deducoes.push({ tipo: 'COMISSAO', valor: Math.round(campos.valor_bruto * 0.02) });
        } else {
          campos.finalidade = 'REPRODUCAO'; campos.modalidade = 'CABECA'; campos.preco_unitario = 280000; campos.valor_bruto = 280000 * animais.length;
        }
        var dados = { tipo: 'VENDA', campos: campos, animais: animais, parcelas: vd.tipo === 'BOIS' ? [{ data_vencimento: dia(vd.dia + 30) }, { data_vencimento: dia(vd.dia + 60) }] : [{ data_vencimento: dia(vd.dia + 30) }], deducoes: deducoes };
        var cmd = emitir('venda-' + (j + 1) + '-' + vd.tipo.toLowerCase(), dados);
        vd.animais.forEach(function (k) { ativo[k] = false; pasto[k] = null; });
        if (vd.tipo === 'BEZERROS' && !corrigidaVenda) {
          // Correção da venda: o preço combinado era R$ 12,50 por kg (a comissão acompanha).
          corrigidaVenda = true;
          var fix = JSON.parse(JSON.stringify(dados));
          fix.campos.preco_unitario = 1250;
          fix.campos.valor_bruto = animais.reduce(function (s, it) { return s + it.peso; }, 0) * 1250;
          fix.deducoes[0].valor = Math.round(fix.campos.valor_bruto * 0.02);
          fix.event_id = '@e:' + cmd.n;
          fix.justificativa = 'Preço por kg conferido com o comprador (demonstração)';
          emitir('venda-' + (j + 1) + '-corrigida', fix, { rota: 'evento.corrigir' });
        }
      });
    });
    mortes.forEach(function (mt, j) {
      no(mt.dia, 2, function () {
        emitir('morte-' + (j + 1), { tipo: 'MORTE', campos: { event_date: dia(mt.dia), causa: mt.causa }, animais: [{ animal_id: ref(mt.animal) }] });
        ativo[mt.animal] = false;
        pasto[mt.animal] = null;
      });
    });
    descartes.forEach(function (ds, j) {
      no(ds.dia, 2, function () {
        var campos = { event_date: dia(ds.dia), destino: ds.destino, motivo: ds.motivo };
        if (ds.receita) campos.receita_valor = ds.receita;
        emitir('descarte-' + (j + 1), { tipo: 'DESCARTE', campos: campos, animais: [{ animal_id: ref(ds.animal) }] });
        ativo[ds.animal] = false;
        pasto[ds.animal] = null;
      });
    });
    no(640, 2, function () {
      emitir('baixa-na-contagem', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos: { event_date: dia(640), justificativa: 'Não apareceu em duas contagens seguidas (demonstração)' }, animais: [{ animal_id: ref(garrotes[46]) }] });
      ativo[garrotes[46]] = false;
      pasto[garrotes[46]] = null;
    });
    // 7. Reprodução (Fase 3, E3.4): em cada estação, a exposição das fêmeas do rebanho com 25 meses ou mais, com os touros,
    // no primeiro dia, e o diagnóstico das que ficaram 150 dias depois — positivo para a que emprenhou na estação (o plano
    // dos partos, passo 4); na última estação, a prenha com o parto depois do fim da demonstração fica sem desfecho.
    DEMO_ESTACOES.forEach(function (ini, y) {
      var fim = ini + 90;
      var expostas = [];
      no(ini, 1, function () {
        expostas = ordem.filter(function (k) { return ativo[k] && A[k].sexo === 'F' && A[k].nasc <= ini - 760; });
        var lote = expostas.concat(touros.filter(function (k) { return ativo[k]; }));
        emitir('estacao-' + (y + 1) + '-exposicao', { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: dia(ini), estacao_id: '@s:' + y, data_fim: dia(fim) }, animais: lote.map(function (k) { return { animal_id: ref(k) }; }) });
      });
      no(ini + 150, 1, function () {
        var ficaram = expostas.filter(function (k) { return ativo[k]; });
        emitir('estacao-' + (y + 1) + '-diagnostico', { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: dia(ini + 150), estacao_id: '@s:' + y, metodo: 'PALPACAO' }, animais: ficaram.map(function (k) {
          return { animal_id: ref(k), resultado: concebeu[y][k] !== undefined ? 'POSITIVO' : 'NEGATIVO' };
        }) });
      });
    });
    for (var d = 1; d <= DEMO_FIM; d++) if (porDia[d]) porDia[d].forEach(function (classe) { classe.forEach(function (fn) { fn(); }); });
    // A chave de cada animal criado pelo plano, para achá-lo na base (reexecução): brinco de origem ou mãe e nascimento.
    var animais = {};
    ordem.forEach(function (k) { var a = A[k]; animais[k] = a.tipo === 'NASCIDO' ? { mae: a.mae, data_nascimento: dia(a.nasc), sexo: a.sexo } : { brinco: k }; });
    var totais = {
      d0: lotes.reduce(function (s, l) { return s + l.length; }, 0), nascimentos: vivos, partos: partos.length, natimortos: partos.reduce(function (s, p) { return s + p.crias.filter(function (c) { return !c.k; }).length; }, 0),
      compras: compras.reduce(function (s, c) { return s + c.animais.length; }, 0), vendas: vendas.reduce(function (s, v) { return s + v.animais.length; }, 0), mortes: mortes.length, descartes: descartes.length, divergencias: 1,
    };
    totais.ativos = totais.d0 + totais.nascimentos + totais.compras - totais.vendas - totais.mortes - totais.descartes - totais.divergencias;
    var porTipo = {};
    cmds.forEach(function (c) { var t = c.rota === 'evento.registrar' ? c.dados.tipo : c.rota.replace('evento.', ''); porTipo[t] = (porTipo[t] || 0) + 1; });
    return { d0: d0, comandos: cmds, animais: animais, totais: totais, comandos_por_tipo: porTipo, lotes: lotes, total_ativos: totais.ativos };
  }

  /** Resolve os marcadores do plano ('@a:', '@p:', '@f:', '@e:', '@m:' — produtos e protocolo da sanidade) no momento de gravar. */
  function resolverDemo_(t, gen, memo, valor) {
    if (typeof valor === 'string' && valor.charAt(0) === '@' && valor.charAt(2) === ':') {
      var resto = valor.slice(3);
      if (valor.charAt(1) === 'a') return idDemo_(t, gen, memo, resto);
      if (valor.charAt(1) === 'p') return t.estado.pastos[Number(resto)];
      if (valor.charAt(1) === 'f') return t.estado.parceiros[resto];
      if (valor.charAt(1) === 'm') return t.estado.sanidade[resto];
      if (valor.charAt(1) === 's') return t.estado.estacoes[Number(resto)];
      if (valor.charAt(1) === 'e') {
        var s = t.ok(t.api('operacao.status', { chave: 'seed:' + resto }), 'operacao.status');
        verificar_(s.situacao === 'CONFIRMADA' && s.resumo && s.resumo.event_id, 'o lançamento seed:' + resto + ' devia estar gravado');
        return s.resumo.event_id;
      }
    }
    if (Array.isArray(valor)) return valor.map(function (x) { return resolverDemo_(t, gen, memo, x); });
    if (valor && typeof valor === 'object') {
      var out = {};
      Object.keys(valor).forEach(function (k) { out[k] = resolverDemo_(t, gen, memo, valor[k]); });
      return out;
    }
    return valor;
  }
  /** animal_id de um animal do plano: da memória da execução, senão pela base (brinco de origem; cria pela mãe, data e sexo). */
  function idDemo_(t, gen, memo, k) {
    if (memo.ids[k]) return memo.ids[k];
    if (!memo.indice) {
      var d = t.ok(t.api('animal.listar', { situacoes: ['ATIVO', 'VENDIDO', 'MORTO', 'DESCARTADO', 'BAIXADO_AJUSTE'] }), 'animal.listar');
      var ind = { brinco: {}, cria: {} };
      d.valores.animal_id.forEach(function (id, i) {
        if (d.valores.brinco[i]) ind.brinco[d.valores.brinco[i]] = id;
        if (d.valores.mae_id[i]) ind.cria[d.valores.mae_id[i] + '|' + d.valores.data_nascimento[i] + '|' + d.valores.sexo[i]] = id;
      });
      memo.indice = ind;
    }
    var p = gen.animais[k];
    var id = p.brinco ? memo.indice.brinco[p.brinco] : memo.indice.cria[idDemo_(t, gen, memo, p.mae) + '|' + p.data_nascimento + '|' + p.sexo];
    verificar_(id, 'animal ' + k + ' da demonstração não encontrado na base');
    memo.ids[k] = id;
    return id;
  }
  /** Grava um comando do plano e guarda os animal_id que ele criou (por brinco ou, na cria, pelo sexo). */
  function gravarDemo_(t, gen, memo, c) {
    var dados = resolverDemo_(t, gen, memo, c.dados);
    var r = t.ok(t.api(c.rota, dados, { chave: 'seed:' + c.n }), c.nome);
    if (c.criados) {
      var porBrinco = {};
      r.animais.forEach(function (a) { if (a.brinco) porBrinco[a.brinco] = a.animal_id; });
      c.criados.forEach(function (k) { if (porBrinco[k]) memo.ids[k] = porBrinco[k]; });
    }
    if (c.crias) {
      var mae = memo.ids[c.mae];
      var novas = r.animais.filter(function (a) { return a.animal_id !== mae; });
      c.crias.forEach(function (k) {
        var sexo = gen.animais[k].sexo;
        var achada = novas.filter(function (a) { return a.sexo === sexo; });
        verificar_(achada.length === 1, c.nome + ': cria ' + k + ' não identificada na resposta');
        memo.ids[k] = achada[0].animal_id;
      });
    }
    return r;
  }
  /**
   * Os números da Fase 3 na base de demonstração, lidos do servidor (nada recalculado aqui) e conferidos contra a faixa
   * do plano: o GMD do rebanho entre 0,3 e 0,8 kg/dia; em cada estação, a prenhez calculada (n acima do mínimo) entre 70%
   * e 98%, e, nas encerradas (sem "parcial"), parição, natalidade e desmama calculadas; a cobertura de cada protocolo da
   * demonstração de pelo menos 80%. Vai para o relatório (`demonstracao.manejo`).
   */
  function manejoDemo_(t) {
    var gmd = t.ok(t.api('peso.desempenho', {}), 'desempenho').geral.gmd;
    verificar_(gmd.valor !== null && gmd.valor >= 0.3 && gmd.valor <= 0.8, 'GMD do rebanho fora da faixa do plano (0,3 a 0,8 kg/dia): ' + curto_(gmd, 200));
    var estacoes = t.estado.estacoes.map(function (id) {
      var r = t.ok(t.api('reproducao.indicadores', { estacao_id: id }), 'indicadores da estação').estacao;
      var x = r.geral;
      var e = { nome: r.estacao.nome, expostas: x.expostas, diagnosticadas: x.diagnosticadas, prenhez: x.prenhez.valor, paricao: x.paricao.valor, natalidade: x.natalidade.valor, desmama: x.desmama.valor, parcial: x.paricao.parcial || null };
      verificar_(e.prenhez !== null && e.prenhez >= 70 && e.prenhez <= 98, e.nome + ': prenhez fora da faixa do plano: ' + curto_(x.prenhez, 200));
      if (!e.parcial) verificar_(e.paricao !== null && e.natalidade !== null && e.desmama !== null, e.nome + ' encerrada sem parição, natalidade ou desmama: ' + curto_(e, 200));
      return e;
    });
    var protocolos = t.ok(t.api('sanidade.agenda', {}), 'agenda sanitária').protocolos.map(function (p) {
      verificar_(p.cobertura.valor !== null && p.cobertura.valor >= 80, p.nome + ': cobertura abaixo de 80%: ' + curto_(p.cobertura, 200));
      return { nome: p.nome, elegiveis: p.elegiveis, em_dia: p.em_dia, cobertura: p.cobertura.valor };
    });
    return { gmd: { valor: gmd.valor, n: gmd.n }, estacoes: estacoes, protocolos: protocolos };
  }
  /** Os passos do seed: um por comando do plano (o cursor guarda o número), e a conferência no fim. */
  function passosDemo_(gen) {
    var passos = gen.comandos.map(function (c) {
      return { nome: c.nome, executar: function (t, g, memo) { gravarDemo_(t, g, memo, c); } };
    });
    passos.push({ nome: 'conferir', executar: function (t, g) {
      var pos = t.ok(t.api('inventario.posicao', {}), 'inventário');
      igual_(pos.cabecas, g.total_ativos, 'cabeças no rebanho ao fim do seed');
      var saidas = {};
      ['VENDIDO', 'MORTO', 'DESCARTADO', 'BAIXADO_AJUSTE'].forEach(function (s) { saidas[s] = t.ok(t.api('animal.listar', { situacoes: [s] }), 'animal.listar').n; });
      igual_(saidas, { VENDIDO: g.totais.vendas, MORTO: g.totais.mortes, DESCARTADO: g.totais.descartes, BAIXADO_AJUSTE: g.totais.divergencias }, 'saídas conferidas no cadastro');
      var integ = t.ok(t.api('sistema.integridade', {}), 'integridade');
      verificar_(integ.ok === true, 'integridade da base de demonstração com erro: ' + curto_((integ.achados || []).slice(0, 2), 200));
      t.estado.resultado = { cabecas: pos.cabecas, por_pasto: pos.por_pasto.length, saidas: saidas, totais: g.totais, comandos: g.comandos.length, comandos_por_tipo: g.comandos_por_tipo, integridade: 'sem erro', fora_desta_fase: DEMO_FORA, manejo: manejoDemo_(t) };
    } });
    return passos;
  }
  /** Preparo da demonstração: banco DEMO pelo setup (se ainda não existe), propriedade, 6 pastos, marco zero e os parceiros. */
  function prepararDemo_(t) {
    var p = props_().ler();
    t.estado.producao = { banco: p.SPREADSHEET_ID || null, versao: p.SPREADSHEET_ID ? p[UnitOfWork.chaveVersao(p.SPREADSHEET_ID)] || null : null };
    if (vazio_(p.DEMO_SPREADSHEET_ID)) Maintenance.setup({ usuario: t.usuario, ambiente: 'DEMO' });
    var boot = t.ok(t.api('sistema.bootstrap', {}), 'carga inicial');
    var marco = boot.configuracoes.itens.filter(function (i) { return i.chave === 'data_marco_zero'; })[0];
    var d0 = marco && !vazio_(marco.valor) ? marco.valor : Utils.somaDias(t.hoje(), -1095);
    var prop = t.ok(t.api('propriedade.salvar', { campos: { nome: 'Fazenda Demonstração', localizacao: 'Rondônia', area_total_ha: 600, status: 'ATIVO' } }, { chave: 'seed:prop' }), 'propriedade');
    var pastos = PASTOS_DEMO.map(function (x, i) {
      var campos = { property_id: prop.property_id, nome: x.nome, area_hectares: x.area_hectares, capacidade_estimada_ua_ha: x.capacidade_estimada_ua_ha, posse: x.posse || 'PROPRIO', status: 'ATIVO' };
      return t.ok(t.api('pasto.salvar', { campos: campos }, { chave: 'seed:pasto:' + i }), 'pasto ' + x.nome).pasture_id;
    });
    t.ok(t.api('config.salvar', { valores: { data_marco_zero: d0, propriedade_padrao_id: prop.property_id } }, { chave: 'seed:config' }), 'marco zero');
    var parceiro = function (nome, tipos, chave) { return t.ok(t.api('parceiro.salvar', { campos: { nome: nome, tipos: tipos } }, { chave: chave }), nome).partner_id; };
    t.estado.parceiros = {
      fornecedor: parceiro('Fazenda Vizinha (demonstração)', ['FORNECEDOR'], 'seed:parceiro'),
      comprador: parceiro('Recriador da Região (demonstração)', ['COMPRADOR'], 'seed:comprador'),
      frigorifico: parceiro('Frigorífico da Região (demonstração)', ['COMPRADOR'], 'seed:frigorifico'),
      veterinario: parceiro('Veterinária da Região (demonstração)', ['VETERINARIO'], 'seed:veterinario'),
    };
    // Sanidade (Fase 3): a vacina com estoque controlado e o protocolo dela; o vermífugo sem controle de estoque (PR-10).
    var vacina = t.ok(t.api('produto.salvar', { campos: { nome: 'Vacina (demonstração)', categoria: 'VACINA', unidade: 'dose', custo_unitario: 1.5, controla_estoque: true } }, { chave: 'seed:produto-vacina' }), 'produto vacina').product_id;
    t.estado.sanidade = {
      vacina: vacina,
      vermifugo: t.ok(t.api('produto.salvar', { campos: { nome: 'Vermífugo (demonstração)', categoria: 'VERMIFUGO', unidade: 'mL', custo_unitario: 0.04, controla_estoque: false } }, { chave: 'seed:produto-vermifugo' }), 'produto vermífugo').product_id,
      protocolo: t.ok(t.api('protocolo.salvar', { campos: { nome: 'Vacina semestral (demonstração)', tipo_procedimento: 'VACINA', product_id: vacina, sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }, { chave: 'seed:protocolo-vacina' }), 'protocolo').protocol_id,
      // A conta da visita do veterinário (a castração dos garrotes, paga no ato).
      conta_veterinario: boot.contas.filter(function (c) { return c.codigo === 'SERVICOS_VETERINARIOS'; })[0].conta_id,
    };
    // A vermifugação da recria pelo protocolo (8 a 30 meses, a cada 120 dias: o dia seguinte a cada pesagem).
    t.estado.sanidade.protocolo_vermifugo = t.ok(t.api('protocolo.salvar', { campos: { nome: 'Vermifugação da recria (demonstração)', tipo_procedimento: 'VERMIFUGO', product_id: t.estado.sanidade.vermifugo, sexo_aplicavel: 'AMBOS', idade_min_meses: 8, idade_max_meses: 30, recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 120 } }, { chave: 'seed:protocolo-vermifugo' }), 'protocolo da vermifugação').protocol_id;
    // Reprodução (Fase 3, E3.4): as três estações de monta, de D0+30 a D0+120 de cada ano.
    t.estado.estacoes = DEMO_ESTACOES.map(function (ini, y) {
      return t.ok(t.api('estacao.salvar', { campos: { nome: 'Estação ' + (y + 1) + ' (demonstração)', data_inicio: Utils.somaDias(d0, ini), data_fim: Utils.somaDias(d0, ini + 90), tipo: 'MONTA_NATURAL' } }, { chave: 'seed:estacao:' + y }), 'estação ' + (y + 1)).estacao_id;
    });
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
      var td = novoT_(run, o);
      if (run.proximo === 0) {
        prepararDemo_(td);
        run.proximo = 1;
        gravarCursor_(run);
      }
      var gen = geracaoDemo_(run.estado.d0);
      var passos = passosDemo_(gen);
      // Memória da execução (não vai para o cursor): animal_id já conhecidos e o índice da base, lido uma vez.
      var memo = { ids: {}, indice: null };
      while (run.proximo - 1 < passos.length) {
        if (feitos > 0 && clock.agoraMs() - inicio > limite) {
          return { plano: plano, completo: false, proximo: passos[run.proximo - 1].nome, feitos: run.proximo - 1, total: passos.length, mensagem: 'Pausado perto do limite de tempo. Rode runAcceptanceTests de novo para continuar a base de demonstração.' };
        }
        try {
          passos[run.proximo - 1].executar(td, gen, memo);
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
