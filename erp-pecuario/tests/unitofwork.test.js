'use strict';
/**
 * UnitOfWork e AuditService: três fases com commit numa célula, TODAS as quedas de 06, seções 5.1 e 5.2 (a
 * execução é morta antes de cada chamada de escrita, com os subconjuntos relevantes de escritas pendentes),
 * reentrância da recuperação, intercalações de 06, seção 7, tabela de idempotência de 06, seção 8, exceção tratada
 * durante a gravação, leitura otimista, simulação, ERROS_LOG fora do journal e dois bancos no mesmo projeto.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ORDENS } = require('./harness');
const A = require('./apoio-persistencia');

const { js, ambiente, cmdEvento, cmdPasto, consultaVigentes, rodarInstrumentado, recuperarInstrumentado } = A;
const PRIMITIVAS = ['SHEETS_TYPED', 'SHEETS_RAW', 'SPREADSHEET_APP'];
const SEQUENCIA_EVENTO = [
  'props.gravar:PENDING_OP', 'anexar:OPERACOES,EVENTOS,ANIMAIS,EVENTO_ANIMAIS', 'flush', 'atualizar:OPERACOES.status', 'flush',
  'atualizar:EVENTOS.status,EVENTOS.confirmed_at,ANIMAIS.situacao_cadastral', 'flush', 'atualizar:OPERACOES.aplicada_em,OPERACOES.finished_at',
  'flush', 'props.gravar:DATA_VERSION', 'props.remover:PENDING_OP', 'soltar',
];
const CASO_DA_TABELA = { 1: 'antes do marcador', 2: 'caso 1', 3: 'casos 2 e 3', 4: 'caso 4', 5: 'caso 5', 6: 'caso 6', 7: 'caso 6', 8: 'caso 6', 9: 'caso 6', 10: 'caso 7', 11: 'caso 8', 12: 'caso 9' };

function erroDe(r) {
  return r.ok ? null : r.erro && r.erro.code ? r.erro.code : 'EXCECAO';
}
function codigosErrosLog(amb) {
  return amb.tabela('ERROS_LOG').map((e) => e.codigo);
}
function opsDaChave(amb, chave) {
  return amb.tabela('OPERACOES').filter((o) => o.idempotency_key === chave);
}

/** Subconjuntos de escritas pendentes que interessam (06, seção 5.1: "qualquer subconjunto"). */
function subconjuntos(semente) {
  const rnd = A.aleatorio(semente);
  const lista = ['nenhuma', 'todas', 1, 3, 6, 9];
  lista.push((p) => p.map((x) => x.aba === 'EVENTO_ANIMAIS')); // só as filhas: caso 3 (filhas sem pai)
  lista.push((p) => p.map((x) => x.aba !== 'OPERACOES')); // tudo menos a operação
  lista.push((p) => p.map((x) => x.tipo === 'valores')); // valores sem formato nem linha inserida
  for (let i = 0; i < 4; i++) lista.push((p) => p.map(() => rnd() < 0.5));
  return lista;
}

/**
 * Confere o estado final depois da recuperação: nunca meio-termo. `confirmado` diz qual dos dois desfechos é o
 * certo (decidido pela célula de commit DURÁVEL no momento da queda).
 */
function conferirFinalEvento(amb, chave, confirmado, msg) {
  assert.equal(amb.marcador(), null, msg + ': marcador removido');
  const ops = amb.tabela('OPERACOES');
  assert.deepEqual(ops.filter((o) => o.status === 'INICIADA' || (o.status === 'CONFIRMADA' && !o.aplicada_em)), [], msg + ': nenhuma órfã');
  const v = amb.vigentes();
  const eventos = amb.tabela('EVENTOS');
  const animais = amb.tabela('ANIMAIS');
  if (confirmado) {
    assert.equal(v.eventos.length, 1, msg + ': o evento vale por inteiro');
    assert.equal(v.linhas, 2, msg + ': com as duas filhas');
    assert.equal(v.animais.length, 2, msg + ': animais ATIVOS pela projeção');
    const opOk = ops.filter((o) => o.idempotency_key === chave && o.status === 'CONFIRMADA');
    assert.equal(opOk.length, 1, msg + ': uma operação confirmada');
    assert.ok(opOk[0].aplicada_em, msg + ': aplicada_em');
    assert.equal(eventos.filter((e) => e.op_id === opOk[0].op_id)[0].status, 'CONFIRMADO', msg + ': cache EVENTOS.status');
  } else {
    assert.equal(v.eventos.length, 0, msg + ': o evento não aconteceu');
    assert.equal(v.linhas, 0, msg + ': linhas inertes fora de toda consulta');
    assert.deepEqual(v.animais, [], msg + ': nenhum animal');
    assert.ok(ops.filter((o) => o.idempotency_key === chave).every((o) => o.status === 'FALHOU'), msg + ': operação FALHOU');
    assert.ok(eventos.every((e) => e.status === 'FALHOU'), msg + ': cache EVENTOS.status = FALHOU');
    assert.ok(animais.every((a) => a.situacao_cadastral === 'ANULADO'), msg + ': animal PENDENTE vira ANULADO');
  }
}

function recuperarPor(amb, modo, chave) {
  if (modo === 'recoverAll') return amb.recoverAll();
  if (modo === 'leitura') return amb.read(consultaVigentes());
  if (modo === 'status') return amb.status(chave);
  return amb.run(cmdPasto(amb.G, { chave: 'outro-comando', dados: { campos: { nome: 'Pasto novo' } } }));
}
const MODOS = ['recoverAll', 'leitura', 'status', 'comando'];

// ------------------------------------------------------------------ caminho feliz ----
for (const order of ORDENS) {
  for (const primitiva of PRIMITIVAS) {
    test('comando de evento nas três fases (' + primitiva + ', carga ' + order + '): ordem das escritas, versão, projeções e resposta', () => {
      const amb = ambiente({ primitiva, order });
      const { r, chamadas } = rodarInstrumentado(amb, cmdEvento({}), {});
      assert.equal(r.ok, true, r.erro && r.erro.message);
      assert.deepEqual(chamadas, SEQUENCIA_EVENTO);
      assert.equal(r.valor.duplicado, false);
      assert.equal(r.valor.dataVersion, 1);
      assert.equal(r.valor.dados.vigente, true, 'a resposta é montada depois da fase C');
      assert.equal(amb.versao(), 1);
      assert.equal(amb.marcador(), null);
      assert.deepEqual(amb.projecoes.chamadas.map((c) => Object.keys(c)), [['animais']], 'fase C recebe o escopo do tratador');
      const op = amb.tabela('OPERACOES')[0];
      assert.deepEqual([op.status, op.comando, op.idempotency_key, op.usuario], ['CONFIRMADA', 'evento.registrar', 'chave-evento-1', A.USUARIO]);
      assert.deepEqual(op.resumo_json, { event_id: r.valor.dados.event_id, animais: 2 });
      assert.match(op.payload_hash, /^[0-9a-f]{64}$/);
      const ev = amb.tabela('EVENTOS')[0];
      assert.deepEqual([ev.op_id, ev.status, ev.idempotency_key, ev.created_by, ev.event_seq, ev.registration_date], [op.op_id, 'CONFIRMADO', 'chave-evento-1', A.USUARIO, 1, '2026-11-13']);
      assert.ok(ev.confirmed_at);
      assert.deepEqual(amb.tabela('ANIMAIS').map((a) => [a.codigo_interno, a.situacao_cadastral]), [['A-000001', 'ATIVO'], ['A-000002', 'ATIVO']]);
      const outro = amb.run(cmdEvento({ chave: 'chave-evento-2' }));
      assert.equal(outro.dataVersion, 2);
      assert.deepEqual(amb.tabela('EVENTOS').map((e) => e.event_seq), [1, 2], 'event_seq = máximo + 1');
      assert.deepEqual(amb.tabela('ANIMAIS').map((a) => a.codigo_interno).slice(2), ['A-000003', 'A-000004']);
    });
  }
}

// ------------------------------------------------------------------ 06, seção 5.1 ----
for (const primitiva of PRIMITIVAS) {
  test('quedas do comando de evento (06, seção 5.1) — ' + primitiva + ': morte antes de cada escrita, recuperação e reenvio', () => {
    let n = 0;
    for (let k = 1; k <= SEQUENCIA_EVENTO.length; k++) {
      const pontos = primitiva === 'SPREADSHEET_APP' && [3, 5, 7, 9].indexOf(k) >= 0 ? subconjuntos(k * 7) : ['nenhuma'];
      for (const chegam of pontos) {
        const amb = ambiente({ primitiva });
        const msg = primitiva + ' k=' + k + ' (' + CASO_DA_TABELA[k] + ', ' + SEQUENCIA_EVENTO[k - 1] + ') chegam=' + (typeof chegam === 'function' ? 'subconjunto' : chegam);
        const { r } = rodarInstrumentado(amb, cmdEvento({}), { antes: k, chegam });
        assert.equal(r.morta, true, msg + ': a execução morreu');
        // O que ficou gravado decide o desfecho: a célula de commit durável.
        const opsMortas = amb.tabela('OPERACOES');
        const confirmado = opsMortas.some((o) => o.status === 'CONFIRMADA');
        const aplicada = opsMortas.some((o) => o.status === 'CONFIRMADA' && o.aplicada_em);
        if (primitiva !== 'SPREADSHEET_APP' || [3, 5].indexOf(k) < 0) assert.equal(confirmado, k >= 5, msg + ': commit');
        if (k === 3 && primitiva !== 'SPREADSHEET_APP') assert.equal(opsMortas[0].status, 'INICIADA', msg);
        assert.equal(amb.marcador() !== null, k >= 2 && k <= 11, msg + ': marcador presente até a fase C terminar');
        const versaoMorta = amb.versao();
        const modo = MODOS[n++ % MODOS.length];
        recuperarPor(amb, modo, 'chave-evento-1');
        conferirFinalEvento(amb, 'chave-evento-1', confirmado, msg + ' recuperado por ' + modo);
        if (k >= 2 && k <= 11) assert.ok(amb.versao() > versaoMorta, msg + ': versão sobe na recuperação');
        const log = codigosErrosLog(amb);
        if (confirmado && !aplicada) {
          assert.ok(log.includes('FASE_C_REFEITA'), msg + ': ERROS_LOG');
          const trilha = js(amb.gas.exec(() => amb.G.UnitOfWork.read(amb.ctx(), { reads: amb.G.AuditService.LEITURAS, tratador: (tx) => amb.G.AuditService.listar(tx, { acao: 'RECUPERACAO' }) }))).dados;
          assert.equal(trilha.length, 1, msg + ': AUDITORIA registra a fase C refeita');
          assert.ok(amb.projecoes.chamadas.some((c) => c.tudo === true), msg + ': reconstrução de TODAS as projeções');
        }
        if (!confirmado && opsMortas.length) assert.ok(log.includes('OPERACAO_INTERROMPIDA'), msg + ': ERROS_LOG');
        if ((!confirmado && !opsMortas.length && k >= 2) || (aplicada && k <= 11)) assert.ok(log.includes('MARCADOR_SEM_OPERACAO'), msg + ': ERROS_LOG');
        if (k === 1 || k === 12) assert.deepEqual(log, [], msg + ': sem recuperação, sem registro');
        // O cliente reenvia com a MESMA chave: no máximo uma operação confirmada, o evento uma vez só.
        const reenvio = amb.run(cmdEvento({}));
        assert.equal(reenvio.duplicado, confirmado, msg + ': reenvio');
        assert.equal(reenvio.dados.vigente, true);
        conferirFinalEvento(amb, 'chave-evento-1', true, msg + ' depois do reenvio');
        assert.equal(amb.status('chave-evento-1').situacao, 'CONFIRMADA');
      }
    }
  });
}

test('quedas (06, seção 5.1) — SHEETS_RAW: morte entre crescer a grade e gravar os valores deixa só linhas em branco', () => {
  const amb = ambiente({ primitiva: 'SHEETS_RAW' });
  amb.gas.falhas.matarNaEscrita(2, { chegam: 'nenhuma' }); // 1 = appendDimension; 2 = Values.batchUpdate
  const r = amb.tentarRun(cmdEvento({}));
  assert.equal(r.morta, true);
  assert.ok(amb.gas.planilhas.dimensoes(amb.banco, 'EVENTOS').linhas > 2, 'a grade cresceu');
  assert.deepEqual(amb.tabela('OPERACOES'), []);
  amb.recoverAll();
  assert.ok(codigosErrosLog(amb).includes('MARCADOR_SEM_OPERACAO'));
  conferirFinalEvento(amb, 'chave-evento-1', false, 'raw');
  assert.equal(amb.run(cmdEvento({})).duplicado, false);
  conferirFinalEvento(amb, 'chave-evento-1', true, 'raw reenviado');
});

// ------------------------------------------------------------------ 06, seção 5.2 ----
for (const primitiva of PRIMITIVAS) {
  test('quedas do comando sem evento (06, seção 5.2) — ' + primitiva + ': edição [cad] e criação de cadastro', () => {
    for (const tipo of ['ALTERAR', 'CRIAR']) {
      const base = ambiente({ primitiva });
      const prep = tipo === 'ALTERAR' ? base.run(cmdPasto(base.G, { chave: 'cria', dados: { campos: { nome: 'Rio', area_hectares: 38.5 } } })) : null;
      base.gas.clock.now += 60000; // a edição acontece um minuto depois: updated_at muda
      const dados = tipo === 'ALTERAR' ? { pasture_id: prep.dados.pasture_id, campos: { nome: 'Rio de Baixo', area_hectares: 40 } } : { campos: { nome: 'Capineira', area_hectares: 3.25 } };
      const { chamadas } = rodarInstrumentado(base, cmdPasto(base.G, { chave: 'k', dados }), {});
      assert.equal(chamadas[1], 'anexar:OPERACOES,AUDITORIA', 'a fase A anexa a operação e o registro de refazer');
      assert.equal(chamadas[5], tipo === 'ALTERAR' ? 'atualizar:PASTOS.nome,PASTOS.area_hectares,PASTOS.updated_at' : 'anexar:PASTOS', 'a fase C aplica o valor novo');
      for (let k = 1; k <= chamadas.length; k++) {
        const pontos = primitiva === 'SPREADSHEET_APP' && [3, 5, 7].indexOf(k) >= 0 ? subconjuntos(k * 13).slice(0, 7) : ['nenhuma'];
        for (const chegam of pontos) {
          const amb = ambiente({ primitiva });
          const p0 = tipo === 'ALTERAR' ? amb.run(cmdPasto(amb.G, { chave: 'cria', dados: { campos: { nome: 'Rio', area_hectares: 38.5 } } })) : null;
          amb.gas.clock.now += 60000;
          const d = tipo === 'ALTERAR' ? { pasture_id: p0.dados.pasture_id, campos: dados.campos } : dados;
          const msg = primitiva + ' ' + tipo + ' k=' + k + ' (' + chamadas[k - 1] + ') chegam=' + (typeof chegam === 'function' ? 'subconjunto' : chegam);
          const auditAntes = amb.read(consultaVigentes()).dados.auditoria;
          const { r } = rodarInstrumentado(amb, cmdPasto(amb.G, { chave: 'k', dados: d }), { antes: k, chegam });
          assert.equal(r.morta, true, msg);
          const mortas = opsDaChave(amb, 'k');
          const confirmado = mortas.some((o) => o.status === 'CONFIRMADA');
          const refaz = mortas.some((o) => o.status === 'CONFIRMADA' && !o.aplicada_em);
          if (primitiva !== 'SPREADSHEET_APP' || k !== 5) assert.equal(confirmado, k >= 5, msg + ': commit');
          recuperarPor(amb, MODOS[k % 3], 'k');
          const v = amb.vigentes();
          assert.equal(amb.marcador(), null, msg);
          const pastos = amb.tabela('PASTOS');
          if (tipo === 'ALTERAR') {
            assert.deepEqual(v.pastos.filter((p) => p.id === p0.dados.pasture_id).map((p) => [p.nome, p.area]), [confirmado ? ['Rio de Baixo', 40] : ['Rio', 38.5]], msg + ': a alteração vale por inteiro ou não vale');
          } else {
            const novos = pastos.filter((p) => p.nome === 'Capineira');
            assert.equal(novos.length, confirmado ? 1 : 0, msg + ': o cadastro nasce uma vez só, e só depois do commit');
            if (confirmado) assert.equal(novos[0].area_hectares, 3.25, msg);
          }
          assert.equal(v.auditoria - auditAntes, confirmado ? (tipo === 'ALTERAR' ? 2 : 5) + (refaz ? 1 : 0) : 0, msg + ': auditoria só de operação confirmada (+ RECUPERACAO)');
          const reenvio = amb.run(cmdPasto(amb.G, { chave: 'k', dados: d }));
          assert.equal(reenvio.duplicado, confirmado, msg + ': reenvio');
          if (tipo === 'CRIAR') assert.equal(amb.tabela('PASTOS').filter((p) => p.nome === 'Capineira').length, 1, msg + ': depois do reenvio');
        }
      }
    }
  });
}

// ------------------------------------------------------------------ reentrância ----
for (const primitiva of ['SHEETS_TYPED', 'SPREADSHEET_APP']) {
  test('recuperação reentrante (' + primitiva + '): morrer em qualquer ponto da recuperação e recuperar de novo dá o mesmo estado', () => {
    for (const [k, confirmado] of [[6, true], [8, true], [4, false]]) {
      const ref = ambiente({ primitiva });
      rodarInstrumentado(ref, cmdEvento({}), { antes: k });
      const passos = recuperarInstrumentado(ref, {}).chamadas;
      assert.ok(passos.length >= 6, 'a recuperação tem vários passos: ' + passos.join(' | '));
      conferirFinalEvento(ref, 'chave-evento-1', confirmado, 'referência');
      for (let j = 1; j <= passos.length; j++) {
        for (const chegam of primitiva === 'SPREADSHEET_APP' ? ['nenhuma', 'todas', (p) => p.map((_, i) => i % 2 === 0)] : ['nenhuma']) {
          const amb = ambiente({ primitiva });
          rodarInstrumentado(amb, cmdEvento({}), { antes: k });
          const msg = primitiva + ' queda k=' + k + ', recuperação morta antes de ' + j + ' (' + passos[j - 1] + ')';
          const morta = recuperarInstrumentado(amb, { antes: j, chegam }).r;
          assert.equal(morta.morta, true, msg);
          if (passos[j - 1] !== 'soltar') assert.notEqual(amb.marcador(), null, msg + ': o marcador fica enquanto a recuperação não termina');
          const segunda = recuperarInstrumentado(amb, { antes: j, chegam }); // pode morrer de novo no mesmo ponto
          if (segunda.r.morta) amb.recoverAll();
          conferirFinalEvento(amb, 'chave-evento-1', confirmado, msg);
        }
      }
    }
  });
}

// ------------------------------------------------------------------ 06, seção 7 ----
test('concorrência: o segundo comando espera o lock até 25 s e recebe LOCKED sem gravar nada', () => {
  const amb = ambiente();
  amb.gas.lock.segurarPorOutra();
  const r = amb.tentarRun(cmdEvento({}));
  assert.equal(erroDe(r), 'LOCKED');
  assert.match(r.erro.message, /ocupado/);
  assert.ok(amb.gas.lock.estatisticas().tentativas.includes(25000));
  assert.deepEqual(amb.tabela('OPERACOES'), []);
  assert.equal(amb.marcador(), null);
  amb.gas.lock.soltarOutra();
  amb.gas.lock.segurarPorOutra({ liberaEmMs: 10000 });
  assert.equal(amb.run(cmdEvento({})).duplicado, false, 'a outra solta o lock dentro da espera');
});

test('concorrência: durante uma gravação, leitura, estado da operação, reenvio e gatilho não passam; depois, o reenvio é duplicado', () => {
  const amb = ambiente();
  const vistos = {};
  const { r } = rodarInstrumentado(amb, cmdEvento({}), {
    antesDe: (k, rotulo) => {
      if (rotulo !== 'atualizar:OPERACOES.status') return;
      vistos.leitura = erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.read(amb.ctx(), consultaVigentes())));
      vistos.status = js(amb.gas.tentar(() => amb.G.UnitOfWork.status(amb.ctx(), 'chave-evento-1')).valor).situacao;
      vistos.reenvio = erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.run(amb.ctx(), cmdEvento({}))));
      vistos.gatilho = erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.exclusivo(amb.ctx(), { rota: 'trgIntegridadeSemanal', tratador: () => 'ok' })));
      vistos.simulacao = erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.run(amb.ctx(), cmdEvento({ chave: 'outra', modo: 'SIMULAR' }))));
    },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(vistos, { leitura: 'LOCKED', status: 'EM_ANDAMENTO', reenvio: 'LOCKED', gatilho: 'LOCKED', simulacao: 'LOCKED' });
  const reenvio = amb.run(cmdEvento({}));
  assert.equal(reenvio.duplicado, true);
  assert.equal(reenvio.dados.event_id, r.valor.dados.event_id);
  assert.equal(amb.tabela('OPERACOES').length, 1);
});

test('leitura otimista: repete quando a versão muda entre a primeira e a segunda leitura; desiste com LOCKED depois de 3', () => {
  for (const vezes of [1, 3]) {
    const amb = ambiente();
    let leituras = 0;
    let n = 0;
    const r = amb.gas.tentar(() => {
      const ctx = amb.ctx();
      const ler = ctx.io.ler;
      ctx.io = Object.assign({}, ctx.io, {
        ler: (abas) => {
          leituras += 1;
          if (n < vezes) amb.gas.tentar(() => amb.G.UnitOfWork.run(amb.ctx(), cmdEvento({ chave: 'concorrente-' + n++ })));
          return ler(abas);
        },
      });
      return js(amb.G.UnitOfWork.read(ctx, consultaVigentes()));
    });
    if (vezes === 1) {
      assert.equal(r.ok, true);
      assert.equal(leituras, 2, 'leu, viu a versão mudar e leu de novo');
      assert.equal(r.valor.dataVersion, 1);
      assert.equal(r.valor.dados.eventos.length, 1, 'serve o estado novo, inteiro');
    } else {
      assert.equal(erroDe(r), 'LOCKED');
      assert.equal(leituras, 3);
    }
  }
});

test('leitura otimista: marcador órfão com lock livre recupera antes de servir; com lock ocupado, LOCKED em ~5 s', () => {
  const amb = ambiente();
  rodarInstrumentado(amb, cmdEvento({}), { antes: 7 });
  amb.gas.lock.segurarPorOutra();
  const t0 = amb.gas.clock.now;
  assert.equal(erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.read(amb.ctx(), consultaVigentes()))), 'LOCKED');
  assert.equal(amb.gas.clock.now - t0, 5000);
  amb.gas.lock.soltarOutra();
  const r = amb.read(consultaVigentes());
  assert.equal(r.dados.eventos.length, 1);
  assert.equal(r.dataVersion, 1);
  assert.equal(amb.marcador(), null);
});

test('entre ler o marcador e obter o lock a operação original termina: a recuperação decide pelo que RELÊ e não a marca como falha', () => {
  for (const via of ['leitura', 'status']) {
    const amb = ambiente();
    rodarInstrumentado(amb, cmdEvento({}), { antes: 4 }); // fase A completa, operação INICIADA, marcador presente
    const op = amb.tabela('OPERACOES')[0];
    const linhaStatus = 2;
    const colStatus = amb.G.Schema.colunas('OPERACOES').indexOf('status') + 1;
    amb.gas.ganchos.em('lock.tentar', () => {
      // A execução original (simulada) grava a célula de commit e morre antes da fase C.
      amb.gas.tentar(() => amb.gas.planilhas.gravar(amb.banco, 'OPERACOES', linhaStatus, colStatus, [['CONFIRMADA']], '@'));
    });
    if (via === 'leitura') amb.read(consultaVigentes()); else assert.equal(amb.status('chave-evento-1').situacao, 'CONFIRMADA');
    const depois = amb.tabela('OPERACOES')[0];
    assert.equal(depois.op_id, op.op_id);
    assert.equal(depois.status, 'CONFIRMADA', via + ': nunca FALHOU');
    conferirFinalEvento(amb, 'chave-evento-1', true, via);
  }
});

test('importação em IMPORTANDO: comandos de negócio são recusados; importacao.*, gatilhos, consultas e reenvio duplicado passam', () => {
  const amb = ambiente();
  const primeiro = amb.run(cmdEvento({ chave: 'antes' }));
  amb.gas.exec(() => amb.G.Database.abrir(amb.banco).anexar({ IMPORTACOES: [{
    import_id: 'imp-1', tipo: 'ANIMAIS', arquivo_nome: 'rebanho.csv', arquivo_hash: 'abc', total_linhas: 10, status: 'IMPORTANDO',
    created_by: A.USUARIO, created_at: '2026-11-13T14:00:00.000Z',
  }] }));
  const r = amb.tentarRun(cmdEvento({ chave: 'durante' }));
  assert.equal(erroDe(r), 'CONFLICT');
  assert.match(r.erro.message, /importação/);
  assert.equal(opsDaChave(amb, 'durante').length, 0, 'nada gravado');
  assert.equal(amb.run(cmdEvento({ chave: 'antes' })).dados.event_id, primeiro.dados.event_id, 'o reenvio do que já foi gravado continua respondendo');
  assert.equal(amb.run(Object.assign(cmdEvento({ chave: 'lote-1' }), { rota: 'importacao.importarBloco', permiteDuranteImportacao: true })).duplicado, false);
  assert.equal(js(amb.gas.exec(() => amb.G.UnitOfWork.exclusivo(amb.ctx(), { rota: 'trgManutencaoDiaria', tratador: () => 'backup' }))).dados, 'backup');
  assert.equal(amb.read(consultaVigentes()).dados.eventos.length, 2);
  assert.equal(amb.run(cmdEvento({ chave: 'sim', modo: 'SIMULAR' })).dados.simulacao, true);
});

test('gatilho (exclusivo) espera o lock e recupera antes de trabalhar; recoverAll reconstrói tudo mesmo sem marcador', () => {
  const amb = ambiente();
  rodarInstrumentado(amb, cmdEvento({}), { antes: 6 });
  const r = js(amb.gas.exec(() => amb.G.UnitOfWork.exclusivo(amb.ctx(), {
    rota: 'trgManutencaoDiaria', reads: ['EVENTOS'], acessoCru: true,
    tratador: (tx) => ({ orfas: tx.cru.operacoesOrfas().length, eventos: tx.repo.vigentes('EVENTOS').length, temMutacao: typeof tx.cru.incluir }),
  })));
  assert.deepEqual(r.dados, { orfas: 0, eventos: 1, temMutacao: 'undefined' });
  assert.equal(r.dataVersion, 1);
  const antes = amb.versao();
  const todas = amb.recoverAll();
  assert.equal(todas.recuperou, true);
  assert.deepEqual([todas.falharam, todas.refeitas], [[], []]);
  assert.equal(amb.versao(), antes + 1);
  assert.equal(amb.projecoes.chamadas[amb.projecoes.chamadas.length - 1].tudo, true);
  assert.equal(amb.marcador(), null);
});

test('estado da operação por chave: INEXISTENTE, CONFIRMADA, FALHOU e o estado final de uma órfã', () => {
  const amb = ambiente();
  assert.equal(amb.status('nunca-vista').situacao, 'INEXISTENTE');
  const ok = amb.run(cmdEvento({}));
  const s = amb.status('chave-evento-1');
  assert.deepEqual([s.situacao, s.op_id, s.resumo.event_id], ['CONFIRMADA', ok.opId, ok.dados.event_id]);
  rodarInstrumentado(amb, cmdEvento({ chave: 'morre' }), { antes: 4 });
  const f = amb.status('morre');
  assert.equal(f.situacao, 'FALHOU', 'a consulta obteve o lock: a original morreu; recupera e responde');
  assert.ok(f.erro);
  rodarInstrumentado(amb, cmdEvento({ chave: 'morre-2' }), { antes: 6 });
  assert.equal(amb.status('morre-2').situacao, 'CONFIRMADA');
  assert.equal(amb.marcador(), null);
  assert.equal(erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.status(amb.ctx(), ''))), 'VALIDATION');
});

// ------------------------------------------------------------------ 06, seção 8 ----
test('idempotência (06, seção 8): duplicado, conteúdo diferente, nova tentativa depois de falha e hash canônico', () => {
  const amb = ambiente();
  const dados = { tipo: 'OUTRA_ENTRADA', data: '2026-11-13', animais: 2, lista: [1, 2] };
  const primeira = amb.run(cmdEvento({ dados }));
  const escritas = amb.gas.falhas.escritas();
  const versao = amb.versao();
  // Mesma chave e mesmo conteúdo, com as chaves em outra ordem e um campo vazio a mais: duplicado, nada gravado.
  const dup = amb.run(cmdEvento({ dados: { lista: [1, 2], animais: 2, vazio: '', data: '2026-11-13', tipo: 'OUTRA_ENTRADA', nulo: null } }));
  assert.equal(dup.duplicado, true);
  assert.deepEqual(dup.dados, primeira.dados, 'resultado reconstruído a partir do resumo');
  assert.equal(amb.gas.falhas.escritas(), escritas, 'nenhuma escrita');
  assert.equal(amb.versao(), versao);
  // Mesma chave, conteúdo diferente: nunca "duplicado".
  const outra = amb.tentarRun(cmdEvento({ dados: Object.assign({}, dados, { animais: 3 }) }));
  assert.equal(erroDe(outra), 'IDEMPOTENCY_MISMATCH');
  assert.equal(amb.gas.falhas.escritas(), escritas);
  // Mesma chave, operação anterior falhou: nova tentativa normal, mais uma linha em OPERACOES.
  rodarInstrumentado(amb, cmdEvento({ chave: 'k2' }), { antes: 4 });
  amb.recoverAll();
  assert.deepEqual(opsDaChave(amb, 'k2').map((o) => o.status), ['FALHOU']);
  assert.equal(amb.run(cmdEvento({ chave: 'k2' })).duplicado, false);
  assert.deepEqual(opsDaChave(amb, 'k2').map((o) => o.status), ['FALHOU', 'CONFIRMADA']);
});

test('idempotência: aviso não aceito não consome a chave; o reenvio com aceite é a mesma operação', () => {
  const amb = ambiente();
  const aviso = { codigo: 'POSSIVEL_DUPLICIDADE', mensagem: 'Parece repetir um lançamento de hoje.' };
  const r = amb.tentarRun(cmdEvento({ avisos: [aviso] }));
  assert.equal(erroDe(r), 'NEEDS_CONFIRMATION');
  assert.equal(js(r.erro.details)[0].codigo, 'POSSIVEL_DUPLICIDADE');
  assert.deepEqual(amb.tabela('OPERACOES'), [], 'nada gravado');
  const ok = amb.run(cmdEvento({ avisos: [aviso], avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dataVersionEsperada: 0 }));
  assert.equal(ok.duplicado, false);
  assert.equal(amb.run(cmdEvento({ avisos: [aviso], avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dataVersionEsperada: 7 })).duplicado, true, 'aceite e versão esperada fora do hash');
});

test('recusas antes da fase A não gravam nada: validação, versão esperada, plano inválido e erros de programação', () => {
  const amb = ambiente();
  const casos = [
    [cmdEvento({ erros: [{ codigo: 'CAMPO_OBRIGATORIO', campo: 'data', mensagem: 'Informe a data.' }] }), 'VALIDATION'],
    [cmdEvento({ dataVersionEsperada: 3 }), 'CONFLICT'],
    [cmdEvento({ chave: '' }), 'VALIDATION'],
    [cmdEvento({ tipo: 'NAO_EXISTE' }), 'VALIDATION'],
    [Object.assign(cmdEvento({}), { tratador: (tx) => { tx.plano.anexar('OPERACOES', { op_id: 'x' }); return {}; } }), 'INTERNAL'],
    [Object.assign(cmdEvento({}), { tratador: (tx) => { tx.plano.anexar('PASTOS', { pasture_id: 'x' }); return {}; } }), 'INTERNAL'],
    [Object.assign(cmdEvento({}), { tratador: (tx) => { tx.plano.atualizar('ANIMAIS', 'a', { nome: 'x' }); return {}; } }), 'INTERNAL'],
    [Object.assign(cmdEvento({}), { tratador: (tx) => { tx.repo.vigentes('PASTOS'); return {}; } }), 'INTERNAL'],
    [Object.assign(cmdEvento({}), { tratador: () => { throw amb.G.Validation.erro('NOT_FOUND', 'Animal não encontrado.'); } }), 'NOT_FOUND'],
  ];
  for (const [cmd, codigo] of casos) assert.equal(erroDe(amb.tentarRun(cmd)), codigo, codigo);
  const v = amb.tentarRun(cmdEvento({ tipo: 'NAO_EXISTE' }));
  assert.equal(js(v.erro.details)[0].campo, 'event_type');
  assert.deepEqual(amb.tabela('OPERACOES'), []);
  assert.deepEqual(amb.tabela('EVENTOS'), []);
  assert.equal(amb.marcador(), null);
  assert.equal(amb.versao(), 0);
  const vazio = amb.run(Object.assign(cmdEvento({}), { tratador: () => ({ resposta: { nada: true } }) }));
  assert.deepEqual([vazio.semAlteracao, vazio.opId, vazio.dados.nada], [true, null, true], 'plano vazio não abre operação');
  assert.equal(erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.run(amb.ctx({ usuario: '' }), cmdEvento({})))), 'INTERNAL');
  assert.equal(erroDe(amb.gas.tentar(() => amb.G.UnitOfWork.run({ banco: amb.banco }, cmdEvento({})))), 'INTERNAL');
  assert.equal(erroDe(amb.gas.tentar(() => {
    const ctx = amb.ctx();
    return amb.G.UnitOfWork.run(ctx, Object.assign(cmdEvento({}), { tratador: () => { amb.G.UnitOfWork.read(ctx, consultaVigentes()); return {}; } }));
  })), 'INTERNAL', 'tratador não abre outra unidade');
});

// ------------------------------------------------------------------ exceção tratada ----
test('exceção tratada durante a gravação: a UnitOfWork recupera a própria operação relendo a planilha', () => {
  // (a) Falha na fase A: nada vale, OPERACOES.erro guarda o motivo e a resposta é INTERNAL retentável.
  for (const primitiva of PRIMITIVAS) {
    const amb = ambiente({ primitiva });
    amb.gas.falhas.falharNaEscrita(primitiva === 'SPREADSHEET_APP' ? 4 : 1, { mensagem: 'Service Spreadsheets timed out' });
    const r = amb.tentarRun(cmdEvento({}));
    assert.equal(erroDe(r), 'INTERNAL', primitiva);
    assert.match(r.erro.message, /nada foi alterado/);
    assert.equal(amb.marcador(), null, primitiva);
    const ops = amb.tabela('OPERACOES');
    if (ops.length) assert.deepEqual([ops[0].status, ops[0].erro], ['FALHOU', 'Service Spreadsheets timed out'], primitiva);
    const log = amb.tabela('ERROS_LOG');
    assert.ok(log.length >= 1, primitiva + ': ERROS_LOG');
    if (ops.length) assert.ok(log.some((e) => e.codigo === 'OPERACAO_INTERROMPIDA' && e.stack_resumida), primitiva + ': com a pilha');
    conferirFinalEvento(amb, 'chave-evento-1', false, primitiva + ' falha na fase A');
    assert.equal(amb.run(cmdEvento({})).duplicado, false, primitiva + ': o cliente retenta com a mesma chave');
  }
  // (b) A célula de commit foi gravada mas a resposta se perdeu: relida CONFIRMADA → fase C refeita e sucesso.
  const amb = ambiente();
  const r = amb.gas.tentar(() => {
    const ctx = amb.ctx();
    const atualizar = ctx.io.atualizar;
    ctx.io = Object.assign({}, ctx.io, {
      atualizar: (itens) => {
        const n = atualizar(itens);
        if (itens.some((i) => i.campos.status === 'CONFIRMADA')) throw amb.gas.run('new Error("Sheets API: resposta perdida")');
        return n;
      },
    });
    return js(amb.G.UnitOfWork.run(ctx, cmdEvento({})));
  });
  assert.equal(r.ok, true);
  assert.equal(r.valor.recuperada, true);
  assert.equal(r.valor.dados.vigente, true);
  conferirFinalEvento(amb, 'chave-evento-1', true, 'resposta perdida no commit');
  // (c) Falha na fase C: a recuperação refaz os derivados e o comando termina bem.
  const c = ambiente();
  c.gas.falhas.falharNaEscrita(3);
  const rc = c.tentarRun(cmdEvento({}));
  assert.equal(rc.ok, true, rc.erro && rc.erro.message);
  assert.equal(rc.valor.recuperada, true);
  conferirFinalEvento(c, 'chave-evento-1', true, 'falha na fase C');
  // (d) A própria recuperação falha: o marcador fica e a chamada seguinte recupera.
  const d = ambiente();
  d.gas.falhas.falharNaEscrita(2);
  d.gas.falhas.falharNaEscrita(3);
  const rd = d.tentarRun(cmdEvento({}));
  assert.equal(erroDe(rd), 'INTERNAL');
  assert.ok(rd.erro.recuperacao, 'o erro da recuperação acompanha');
  assert.notEqual(d.marcador(), null);
  d.gas.falhas.limpar();
  assert.equal(d.run(cmdEvento({ chave: 'seguinte' })).duplicado, false);
  assert.equal(d.marcador(), null);
  assert.deepEqual(opsDaChave(d, 'chave-evento-1').map((o) => o.status), ['FALHOU']);
});

// ------------------------------------------------------------------ simulação ----
test('modo SIMULAR: o mesmo tratador e o mesmo plano, sem lock de escrita e sem gravar', () => {
  const amb = ambiente();
  amb.run(cmdEvento({ chave: 'antes' }));
  const escritas = amb.gas.falhas.escritas();
  const aquisicoes = amb.gas.lock.estatisticas().aquisicoes;
  amb.gas.lock.segurarPorOutra();
  const aviso = { codigo: 'PESO_IMPLAUSIVEL', mensagem: 'Peso fora do esperado.' };
  const s = amb.run(cmdEvento({ chave: 'sim', modo: 'SIMULAR', avisos: [aviso] }));
  amb.gas.lock.soltarOutra();
  assert.equal(s.dados.simulacao, true);
  assert.deepEqual(s.dados.linhas, { EVENTOS: 1, ANIMAIS: 2, EVENTO_ANIMAIS: 2 });
  assert.equal(s.dados.impactos.animais, 2);
  assert.equal(s.dados.avisos[0].codigo, 'PESO_IMPLAUSIVEL', 'aviso volta na resposta, sem NEEDS_CONFIRMATION');
  assert.equal(s.dataVersion, 1);
  assert.equal(amb.gas.falhas.escritas(), escritas, 'nada gravado');
  assert.equal(amb.gas.lock.estatisticas().aquisicoes, aquisicoes, 'sem lock');
  assert.equal(erroDe(amb.tentarRun(cmdEvento({ modo: 'SIMULAR', tipo: 'NAO_EXISTE' }))), 'VALIDATION', 'erro de validação como no comando');
  assert.equal(erroDe(amb.tentarRun(cmdEvento({ modo: 'APAGAR' }))), 'INTERNAL');
  assert.equal(amb.status('sim').situacao, 'INEXISTENTE');
});

// ------------------------------------------------------------------ ERROS_LOG ----
test('ERROS_LOG fica fora do journal: célula coercida lida numa consulta vira linha sem operação e sem mudar a versão', () => {
  const amb = ambiente({ primitiva: 'SPREADSHEET_APP' });
  amb.run(cmdPasto(amb.G, { dados: { campos: { nome: 'Rio' } } }));
  amb.gas.planilhas.digitar(amb.banco, 'PASTOS', 2, amb.G.Schema.colunas('PASTOS').indexOf('created_at') + 1, '2026-11-13 10:00');
  const ops = amb.tabela('OPERACOES').length;
  const versao = amb.versao();
  amb.gas.lock.segurarPorOutra();
  assert.equal(amb.read(consultaVigentes()).dados.pastos.length, 1, 'sem lock: o registro é descartado e a consulta segue');
  amb.gas.lock.soltarOutra();
  assert.deepEqual(amb.tabela('ERROS_LOG'), []);
  amb.read(consultaVigentes());
  const log = amb.tabela('ERROS_LOG');
  assert.deepEqual(log.map((e) => [e.codigo, e.contexto, e.op_id, e.usuario]), [['CELULA_COERCIDA', 'teste.vigentes', null, A.USUARIO]]);
  assert.match(log[0].mensagem, /PASTOS/);
  assert.equal(amb.tabela('OPERACOES').length, ops);
  assert.equal(amb.versao(), versao);
  assert.equal(amb.marcador(), null);
  // Anotação explícita (a Api registra INTERNAL/CONFIG/DENIED assim) e gravação no fim da execução.
  const r = js(amb.gas.exec(() => {
    const ctx = amb.ctx();
    amb.G.UnitOfWork.anotarErro(ctx, { contexto: 'api', codigo: 'CONFIG', mensagem: 'Planilha sem a aba EVENTOS.' });
    return amb.G.UnitOfWork.descarregarErros(ctx);
  }));
  assert.deepEqual(r, { gravados: 1, descartados: 0, motivo: null });
});

// ------------------------------------------------------------------ dois bancos ----
test('dois bancos no mesmo projeto: marcador e versão de um não contaminam o outro', () => {
  const a = ambiente({ nome: 'Banco A' });
  const b = ambiente({ gas: a.gas, nome: 'Banco B' });
  assert.notEqual(a.chaveMarcador, b.chaveMarcador);
  rodarInstrumentado(a, cmdEvento({}), { antes: 6 }); // A fica com operação órfã e marcador
  assert.notEqual(a.marcador(), null);
  const rb = b.run(cmdEvento({}));
  assert.equal(rb.duplicado, false, 'mesma chave em outro banco é outra operação');
  assert.equal(rb.dataVersion, 1);
  assert.equal(b.read(consultaVigentes()).dados.eventos.length, 1);
  assert.notEqual(a.marcador(), null, 'B não recuperou nem removeu o marcador de A');
  assert.equal(a.versao(), 0);
  assert.equal(a.tabela('OPERACOES')[0].aplicada_em, null);
  assert.equal(a.read(consultaVigentes()).dataVersion, 1, 'A recupera o que é seu');
  assert.equal(a.marcador(), null);
  assert.equal(b.versao(), 1);
  assert.equal(b.run(cmdEvento({ chave: 'b2' })).dataVersion, 2);
  assert.equal(a.versao(), 1);
});

// ------------------------------------------------------------------ AuditService ----
test('AuditService: linhas de AUDITORIA no formato de célula, regras de marca e trilha só de operações confirmadas', () => {
  const amb = ambiente();
  const G = amb.G;
  const ctx = amb.ctx();
  const op = { op_id: 'op-1', usuario: A.USUARIO, timestamp: '2026-11-13T14:00:00.000Z' };
  const linhas = js(G.AuditService.linhas(ctx, op, [
    { entidade: 'PARCELAS', entity_id: 'p1', acao: 'CONTROLE', campo: 'valor_pago', valor_anterior: null, valor_novo: 2030000 },
    { entidade: 'PARCELAS', entity_id: 'p1', acao: 'CONTROLE', campo: 'status', valor_anterior: 'ABERTA', valor_novo: 'LIQUIDADA', justificativa: 'Pago no PIX' },
    { entidade: 'PASTOS', entity_id: 'x', acao: 'ALTERAR', campo: 'area_hectares', valor_anterior: 38.5, valor_novo: 40 },
    { entidade: 'OPERACOES', entity_id: 'op-0', acao: 'RECUPERACAO', valor_novo: 'fase C reexecutada' },
    { entidade: 'SISTEMA', acao: 'MANUTENCAO', valor_novo: 'backup diário' },
  ]));
  assert.deepEqual(linhas.map((l) => [l.entidade, l.acao, l.campo, l.valor_anterior, l.valor_novo]), [
    ['PARCELAS', 'CONTROLE', 'valor_pago', null, '20300.00'],
    ['PARCELAS', 'CONTROLE', 'status', 'ABERTA', 'LIQUIDADA'],
    ['PASTOS', 'ALTERAR', 'area_hectares', '38.5', '40'],
    ['OPERACOES', 'RECUPERACAO', null, null, 'fase C reexecutada'],
    ['SISTEMA', 'MANUTENCAO', null, null, 'backup diário'],
  ]);
  assert.equal(linhas[1].justificativa, 'Pago no PIX');
  assert.ok(linhas.every((l) => l.op_id === 'op-1' && l.usuario === A.USUARIO && l.audit_id));
  const recusa = (m) => { try { G.AuditService.linhas(ctx, op, [m]); } catch (e) { return e.code; } return null; };
  assert.equal(recusa({ entidade: 'PASTOS', entity_id: 'x', acao: 'ALTERAR', campo: 'property_id', valor_novo: 'y' }), 'INTERNAL', 'ALTERAR só em [cad]');
  assert.equal(recusa({ entidade: 'PASTOS', entity_id: 'x', acao: 'CONTROLE', campo: 'nome', valor_novo: 'y' }), 'INTERNAL', 'CONTROLE só em [ctl]');
  assert.equal(recusa({ entidade: 'PASTOS', entity_id: 'x', acao: 'ALTERAR', campo: 'pasture_id', valor_novo: 'y' }), 'INTERNAL', 'a chave não muda');
  assert.equal(recusa({ entidade: 'NADA', entity_id: 'x', acao: 'ALTERAR', campo: 'a' }), 'INTERNAL');
  assert.equal(recusa({ entidade: 'PASTOS', acao: 'ALTERAR', campo: 'nome', valor_novo: 'y' }), 'INTERNAL');
  assert.equal(recusa({ entidade: 'PASTOS', entity_id: 'x', acao: 'APAGAR' }), 'INTERNAL');

  // Trilha: a operação que falhou deixa linhas inertes que não aparecem.
  const criado = amb.run(cmdPasto(G, { chave: 'c1', dados: { campos: { nome: 'Rio', area_hectares: 38.5 } } }));
  const id = criado.dados.pasture_id;
  rodarInstrumentado(amb, cmdPasto(G, { chave: 'c2', dados: { pasture_id: id, campos: { nome: 'Nunca' } } }), { antes: 4 });
  amb.run(cmdPasto(G, { chave: 'c3', dados: { pasture_id: id, campos: { nome: 'Rio Novo', area_hectares: 38.5 }, justificativa: 'Nome oficial' } }));
  const trilha = amb.read({ reads: G.AuditService.LEITURAS, tratador: (tx) => G.AuditService.listar(tx, { entidade: 'PASTOS', entity_id: id }) }).dados;
  assert.equal(amb.tabela('AUDITORIA').filter((l) => l.valor_novo === 'Nunca').length, 1, 'a linha inerte existe na aba');
  assert.ok(trilha.every((l) => l.valor_novo !== 'Nunca'), 'mas não na trilha');
  assert.deepEqual(trilha.filter((l) => l.acao === 'ALTERAR').map((l) => [l.campo, l.valor_anterior, l.valor_novo, l.justificativa]), [['nome', 'Rio', 'Rio Novo', 'Nome oficial']], 'só o que realmente mudou');
  assert.equal(trilha.filter((l) => l.acao === 'CRIAR').length, 5);
  const vazia = amb.read({ reads: G.AuditService.LEITURAS, tratador: (tx) => G.AuditService.listar(tx, { entidade: 'PASTOS', de: '2027-01-01T00:00:00.000Z' }) }).dados;
  assert.deepEqual(vazia, []);
  assert.equal(erroDe(amb.tentarRun(cmdPasto(G, { chave: 'c4', dados: { pasture_id: 'sumiu', campos: { nome: 'x' } } }))), 'NOT_FOUND');
});

test('AuditService.refazer é idempotente: aplicar duas vezes o valor novo dá o mesmo resultado', () => {
  const amb = ambiente();
  const G = amb.G;
  const criado = amb.run(cmdPasto(G, { chave: 'c1', dados: { campos: { nome: 'Rio', area_hectares: 38.5 } } }));
  const r = js(amb.gas.exec(() => {
    const ctx = amb.ctx();
    const repo = G.Repository.abrir(ctx);
    repo.carregar(['PASTOS', 'AUDITORIA']);
    const op = repo.cruPorId('OPERACOES', criado.opId);
    const linhas = repo.cruPor('AUDITORIA', 'op_id', criado.opId);
    const um = G.AuditService.refazer(repo, ctx.io, op, linhas);
    const dois = G.AuditService.refazer(repo, ctx.io, op, linhas);
    const semAlvo = G.AuditService.refazer(repo, ctx.io, op, [{ audit_id: 'z', acao: 'ALTERAR', entidade: 'PASTOS', entity_id: 'nao-existe', campo: 'nome', valor_novo: 'x' }]);
    return { um, dois, escritas: repo.resolver(um.atualizar), semAlvo };
  }));
  assert.deepEqual(r.um, r.dois);
  assert.deepEqual(r.um.criar, {}, 'o registro já existe: os campos são regravados, nunca duplicados');
  assert.deepEqual(r.escritas, [], 'e nada difere do que está gravado');
  assert.equal(r.semAlvo.semAlvo.length, 1);
});
