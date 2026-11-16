'use strict';
/**
 * Api e pontos de entrada (E1.5): envelope, guarda de dono, roteador (rota desconhecida, rota de fase futura, pedido
 * malformado), NEEDS_CONFIRMATION de ponta a ponta, duplicado, LOCKED, carga inicial condicional, estado da operação,
 * rascunho no servidor, fuso acompanhando a configuração e ambiente TESTE isolado da produção. Tudo pela função pública
 * `api()` de Code.js, numa execução do harness, sobre um banco criado pelo próprio setup.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGas } = require('./harness');
const S = require('./apoio-sistema');

const { js, D0, PASTOS, USUARIO, bicho } = S;
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

/** Falha se algum Date (de qualquer contexto) escapar na resposta. */
function semDate(v, onde) {
  if (Object.prototype.toString.call(v) === '[object Date]') assert.fail('Date na resposta em ' + onde);
  if (v && typeof v === 'object') Object.keys(v).forEach((k) => semDate(v[k], onde + '.' + k));
}
/** Chama a função pública api() numa execução e confere a forma do envelope. */
function chamar(s, pedido) {
  const env = s.gas.exec(() => s.G.api(pedido));
  semDate(env, pedido && pedido.rota);
  const e = js(env);
  assert.deepEqual(Object.keys(e).sort(), e.ok ? ['data', 'meta', 'ok'] : ['error', 'meta', 'ok']);
  assert.equal(e.meta.appVersion, PKG.version);
  assert.match(e.meta.serverTime, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  if (!e.ok) assert.deepEqual(Object.keys(e.error).sort(), ['code', 'details', 'message']);
  return e;
}
const outra = (data, animais, campos) => ({ tipo: 'OUTRA_ENTRADA', campos: Object.assign({ event_date: data, description: 'Doação' }, campos || {}), animais });
const reg = (s, dados, chave, extra) => chamar(s, Object.assign({ rota: 'evento.registrar', dados, idempotencyKey: chave }, extra || {}));
function versaoProd(s) {
  return s.props()['DATA_VERSION:' + s.banco()];
}

test('envelope: ok com data e meta {dataVersion, appVersion, serverTime}; comando traz duplicado e opId; nada de Date', () => {
  const s = S.sistema();
  const r = reg(s, outra('2026-02-01', [bicho({ brinco: '10' })]), 'k-env');
  assert.equal(r.ok, true);
  assert.equal(r.data.event_type, 'OUTRA_ENTRADA');
  assert.equal(r.meta.dataVersion, Number(versaoProd(s)));
  assert.deepEqual([r.meta.duplicado, typeof r.meta.opId], [false, 'string']);
  const c = chamar(s, { rota: 'evento.listar', dados: {} });
  assert.equal(c.ok, true);
  assert.equal(c.meta.dataVersion, r.meta.dataVersion, 'consulta devolve a mesma versão');
  assert.equal('duplicado' in c.meta, false, 'consulta não tem duplicado');
  assert.equal(c.data.total, 1);
});

test('erro inesperado: INTERNAL com texto genérico; o detalhe vai para o log e para ERROS_LOG, nunca para o cliente', () => {
  const s = S.sistema();
  s.G.InventoryService.visaoGeral = () => { throw new Error('falha secreta 42 no banco'); };
  const r = chamar(s, { rota: 'dashboard.obter' });
  assert.deepEqual([r.ok, r.error.code], [false, 'INTERNAL']);
  assert.doesNotMatch(JSON.stringify(r), /secreta/);
  assert.ok(typeof r.meta.dataVersion === 'number', 'meta segue com a versão');
  assert.ok(s.gas.logs.some((l) => /falha secreta 42/.test(String(l[1][0]))), 'detalhe no log de execuções');
  const log = s.tabela('ERROS_LOG').filter((e) => e.codigo === 'API_INTERNAL');
  assert.equal(log.length, 1);
  assert.match(log[0].contexto, /dashboard\.obter/);
});

test('roteador: rota desconhecida e rota de fase futura → NOT_FOUND; pedido malformado e comando sem chave → VALIDATION', () => {
  const s = S.sistema();
  const v0 = versaoProd(s);
  const ops = s.tabela('OPERACOES').length;
  const nf = chamar(s, { rota: 'animal.apagar', dados: {} });
  assert.deepEqual([nf.error.code, /desconhecida/.test(nf.error.message)], ['NOT_FOUND', true]);
  const fut = chamar(s, { rota: 'parcela.baixar', dados: {}, idempotencyKey: 'k' });
  assert.equal(fut.error.code, 'NOT_FOUND');
  assert.match(fut.error.message, /Financeiro, que chega na fase 4/);
  for (const [pedido, campo] of [
    [null, null], [[1, 2], null], [{ dados: {} }, 'rota'], [{ rota: 'evento.listar', dados: [1] }, 'dados'],
    [{ rota: 'evento.listar', ambiente: 'PRODUCAO_X' }, 'ambiente'], [{ rota: 'evento.listar', avisosAceitos: 'X' }, 'avisosAceitos'],
    [{ rota: 'evento.listar', avisosAceitos: [{ animal_id: 'a' }] }, 'avisosAceitos'], [{ rota: 'evento.listar', dataVersionEsperada: 1.5 }, 'dataVersionEsperada'],
    [{ rota: 'evento.registrar', dados: outra('2026-02-01', [bicho({ brinco: '1' })]) }, 'idempotencyKey'],
    [{ rota: 'evento.listar', idempotencyKey: 'x'.repeat(201) }, 'idempotencyKey'],
  ]) {
    const r = chamar(s, pedido);
    assert.equal(r.error.code, 'VALIDATION', JSON.stringify(pedido));
    if (campo) assert.equal(r.error.details[0].campo, campo);
  }
  const sim = chamar(s, { rota: 'evento.simular', dados: { acao: 'apagar', dados: {} } });
  assert.deepEqual([sim.error.code, sim.error.details[0].campo], ['VALIDATION', 'acao']);
  assert.equal(versaoProd(s), v0, 'nenhuma recusa mudou a versão');
  assert.equal(s.tabela('OPERACOES').length, ops, 'nenhuma operação aberta');
});

test('guarda de dono: outro e-mail → DENIED; e-mail vazio só com ALLOW_EMPTY_ACTIVE_USER (e o dono assina); OWNER_EMAIL ausente usa o efetivo', () => {
  const s = S.sistema();
  const { gas, G } = s;
  gas.session.activeEmail = 'Intruso@gmail.com';
  const neg = chamar(s, { rota: 'evento.listar' });
  assert.deepEqual([neg.error.code, neg.meta.dataVersion], ['DENIED', null]);
  assert.match(neg.error.message, /exclusivo do dono/);
  const pagina = js(gas.exec(() => G.doGet({ parameter: {} })));
  assert.match(pagina._content, /Acesso negado/);
  assert.throws(() => gas.exec(() => G.setup()), (e) => e.code === 'DENIED');
  assert.throws(() => gas.exec(() => G.verifyIntegrity()), (e) => e.code === 'DENIED');
  // E-mail ativo vazio (SP-04): recusado com a instrução, até o dono ligar a contingência.
  gas.session.activeEmail = '';
  const vazio = chamar(s, { rota: 'evento.listar' });
  assert.equal(vazio.error.code, 'DENIED');
  assert.match(vazio.error.message, /ALLOW_EMPTY_ACTIVE_USER/);
  gas.props.script.setProperty('ALLOW_EMPTY_ACTIVE_USER', 'true');
  const ok = reg(s, outra('2026-02-01', [bicho({ brinco: '20' })]), 'k-vazio');
  assert.equal(ok.ok, true);
  const op = s.tabela('OPERACOES').find((o) => o.idempotency_key === 'k-vazio');
  assert.equal(op.usuario, USUARIO, 'quem assina é o dono');
  // Maiúsculas não importam; sem OWNER_EMAIL vale o usuário efetivo (quem implantou).
  gas.props.script.deleteProperty('ALLOW_EMPTY_ACTIVE_USER');
  gas.session.activeEmail = 'DONO@gmail.com';
  assert.equal(chamar(s, { rota: 'evento.listar' }).ok, true);
  gas.props.script.deleteProperty('OWNER_EMAIL');
  gas.session.effectiveEmail = 'outro-dono@gmail.com';
  assert.equal(chamar(s, { rota: 'evento.listar' }).error.code, 'DENIED');
});

test('gatilhos: o handler passa pelo triggerUid de um gatilho instalado (sem e-mail ativo); uid estranho → DENIED', () => {
  const s = S.sistema();
  const { gas, G } = s;
  gas.session.activeEmail = '';
  const semanal = gas.triggers.find((t) => t.getHandlerFunction() === 'trgIntegridadeSemanal');
  const rel = js(gas.exec(() => G.trgIntegridadeSemanal({ triggerUid: semanal.getUniqueId() })));
  assert.equal(rel.ok, true);
  assert.ok(s.props()['INTEGRIDADE:' + s.banco()], 'resumo da verificação semanal guardado');
  assert.throws(() => gas.exec(() => G.trgIntegridadeSemanal({ triggerUid: 'trigger-falso' })), (e) => e.code === 'DENIED');
  assert.throws(() => gas.exec(() => G.trgManutencaoDiaria({})), (e) => e.code === 'DENIED', 'sem uid e sem e-mail ativo');
  const diario = gas.triggers.find((t) => t.getHandlerFunction() === 'trgManutencaoDiaria');
  const man = js(gas.exec(() => G.trgManutencaoDiaria({ triggerUid: diario.getUniqueId() })));
  assert.equal(man.backup.motivo, 'DIARIO');
});

test('NEEDS_CONFIRMATION de ponta a ponta: nada gravado, chave livre; o reenvio com o aceite (código ou objeto) grava e guarda o aceite', () => {
  const s = S.sistema();
  const ped = chamar(s, { rota: 'pasto.salvar', idempotencyKey: 'k-pasto', dados: { campos: { property_id: S.PROP, nome: 'Piquete', posse: 'PROPRIO', status: 'ATIVO', capacidade_estimada_cabecas: 1 } } });
  assert.equal(ped.ok, true);
  const piquete = ped.data.pasture_id;
  const antes = { ev: s.tabela('EVENTOS').length, an: s.tabela('ANIMAIS').length, v: versaoProd(s) };
  const dados = outra('2026-02-01', [bicho({ brinco: '31', pasto_destino_id: piquete }), bicho({ brinco: '32', pasto_destino_id: piquete })]);
  const r1 = reg(s, dados, 'k-aviso');
  assert.equal(r1.error.code, 'NEEDS_CONFIRMATION');
  assert.deepEqual(r1.error.details.map((d) => d.codigo), ['LOTACAO_ACIMA_DA_CAPACIDADE']);
  assert.deepEqual([s.tabela('EVENTOS').length, s.tabela('ANIMAIS').length, versaoProd(s)], [antes.ev, antes.an, antes.v], 'nada gravado');
  assert.equal(chamar(s, { rota: 'operacao.status', dados: { chave: 'k-aviso' } }).data.situacao, 'INEXISTENTE', 'chave não consumida');
  const r2 = reg(s, dados, 'k-aviso', { avisosAceitos: [{ codigo: 'LOTACAO_ACIMA_DA_CAPACIDADE', animal_id: null, justificativa: null }] });
  assert.equal(r2.ok, true, JSON.stringify(r2.error));
  assert.equal(r2.meta.duplicado, false);
  const ev = s.tabela('EVENTOS').find((e) => e.event_id === r2.data.event_id);
  assert.deepEqual(ev.payload_json.avisos_aceitos.map((a) => a.codigo), ['LOTACAO_ACIMA_DA_CAPACIDADE']);
  assert.equal(chamar(s, { rota: 'operacao.status', dados: { chave: 'k-aviso' } }).data.situacao, 'CONFIRMADA');
});

test('duplicado e IDEMPOTENCY_MISMATCH pela api(); estado da operação por chave', () => {
  const s = S.sistema();
  const dados = outra('2026-02-01', [bicho({ brinco: '41' })]);
  const r1 = reg(s, dados, 'k-dup');
  const r2 = reg(s, dados, 'k-dup', { avisosAceitos: ['QUALQUER_AVISO'] });
  assert.deepEqual([r2.ok, r2.meta.duplicado, r2.data.event_id, r2.meta.opId], [true, true, r1.data.event_id, r1.meta.opId], 'avisos aceitos ficam fora do hash');
  assert.equal(s.tabela('EVENTOS').filter((e) => e.idempotency_key === 'k-dup').length, 1);
  const mm = reg(s, outra('2026-02-01', [bicho({ brinco: '42' })]), 'k-dup');
  assert.equal(mm.error.code, 'IDEMPOTENCY_MISMATCH');
  const st = chamar(s, { rota: 'operacao.status', dados: { chave: 'k-dup' } }).data;
  assert.deepEqual([st.situacao, st.op_id, st.comando], ['CONFIRMADA', r1.meta.opId, 'evento.registrar']);
  assert.equal(chamar(s, { rota: 'operacao.status', dados: { chave: 'nunca-usada' } }).data.situacao, 'INEXISTENTE');
  assert.equal(chamar(s, { rota: 'operacao.status', dados: {} }).error.code, 'VALIDATION');
});

test('LOCKED: com o lock de outra execução o comando espera 25 s e devolve LOCKED sem consumir a chave; depois grava uma vez', () => {
  const s = S.sistema();
  const dados = outra('2026-02-01', [bicho({ brinco: '51' })]);
  s.gas.lock.segurarPorOutra();
  const t0 = s.gas.clock.now;
  const r = reg(s, dados, 'k-lock');
  assert.equal(r.error.code, 'LOCKED');
  assert.ok(s.gas.clock.now - t0 >= 25000, 'esperou o lock');
  s.gas.lock.soltarOutra();
  const ok = reg(s, dados, 'k-lock');
  assert.deepEqual([ok.ok, ok.meta.duplicado], [true, false]);
  assert.equal(s.tabela('EVENTOS').filter((e) => e.idempotency_key === 'k-lock').length, 1);
});

test('carga inicial condicional: completa na primeira vez; {atual: true} com a versão em cache; completa de novo depois de um comando', () => {
  const s = S.sistema();
  reg(s, { tipo: 'ENTRADA_INICIAL', campos: {}, animais: [bicho({ brinco: '61', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA' })] }, 'k-ei');
  chamar(s, { rota: 'animal.cadastrarExterno', idempotencyKey: 'k-ext', dados: { campos: { nome: 'Touro do sêmen', sexo: 'M' } } });
  const b1 = chamar(s, { rota: 'sistema.bootstrap', dados: {} });
  assert.equal(b1.ok, true);
  const d = b1.data;
  assert.equal(d.atual, false);
  for (const k of ['configuracoes', 'listas', 'categorias', 'cobertura', 'parceiros', 'contas', 'propriedades', 'pastos', 'animais', 'alertas', 'catalogo', 'modulos', 'ambiente', 'sistema']) assert.ok(k in d, 'bootstrap sem ' + k);
  assert.equal(d.contas.length, 29, 'o plano de contas vai ao cliente (conta do custo da morte)');
  assert.deepEqual(d.ambiente, { codigo: 'PRODUCAO', base_de_teste: false, faixa: null });
  assert.equal(d.animais.n, 2, 'ATIVOS + EXTERNOS');
  assert.deepEqual(d.animais.valores.situacao_cadastral.sort(), ['ATIVO', 'EXTERNO']);
  assert.deepEqual(d.pastos.map((p) => p.pasture_id).sort(), [PASTOS.A, PASTOS.B].sort());
  assert.deepEqual(d.modulos.map((m) => m.id), ['DASHBOARD', 'REBANHO', 'PASTOS', 'EVENTOS', 'PESAGENS', 'SANIDADE', 'REPRODUCAO', 'CONFIGURACOES', 'IMPORTACAO'], 'só os módulos entregues (Pesagens, Sanidade e Reprodução, na Fase 3)');
  assert.deepEqual([d.produtos, d.protocolos], [[], []], 'os cadastros da sanidade vão no bootstrap (nenhum protocolo de fábrica)');
  assert.deepEqual(d.catalogo.tipos.map((t) => t.tipo), ['ENTRADA_INICIAL', 'OUTRA_ENTRADA', 'NASCIMENTO', 'COMPRA', 'VENDA', 'TRANSFERENCIA', 'MORTE', 'DESCARTE', 'PESAGEM', 'SANIDADE', 'REPRODUCAO', 'DESMAMA', 'CASTRACAO', 'IDENTIFICACAO', 'MARCACAO', 'AJUSTE_INVENTARIO', 'OCORRENCIA', 'ESTOQUE', 'ESTORNO'], 'os da Fase 2, a pesagem (Fase 3, E3.1), a sanidade e o estoque (E3.2 e E3.3), a reprodução, a desmama, a castração e a ocorrência (E3.4 e E3.5)');
  assert.equal(d.catalogo.fase, 3, 'a Fase 3 começou (EventCatalog.FASE_ATUAL), com os tipos da Fase 2 até os dela terem campos');
  assert.ok(Array.isArray(d.alertas.alertas));
  assert.equal(d.dataVersion, b1.meta.dataVersion);
  // Com a versão em cache e nada mudou: nada além da versão.
  const escritas = s.gas.falhas.escritas();
  const b2 = chamar(s, { rota: 'sistema.bootstrap', dados: { dataVersion: b1.meta.dataVersion } });
  assert.deepEqual(b2.data, { atual: true, dataVersion: b1.meta.dataVersion, appVersion: PKG.version, ambiente: d.ambiente });
  assert.equal(s.gas.falhas.escritas(), escritas);
  // Depois de um comando a versão muda e a carga volta completa.
  reg(s, outra('2026-02-01', [bicho({ brinco: '62' })]), 'k-novo');
  const b3 = chamar(s, { rota: 'sistema.bootstrap', dados: { dataVersion: b1.meta.dataVersion } });
  assert.deepEqual([b3.data.atual, b3.data.animais.n, b3.meta.dataVersion], [false, 3, b1.meta.dataVersion + 1]);
});

test('ambiente TESTE isolado da produção: banco por TEST_SPREADSHEET_ID (nunca por ID do cliente); faixa BASE DE TESTE; sem base → CONFIG', () => {
  const s = S.sistema();
  const { gas, G } = s;
  const semBase = chamar(s, { rota: 'evento.listar', ambiente: 'TESTE' });
  assert.equal(semBase.error.code, 'CONFIG');
  assert.match(semBase.error.message, /runAcceptanceTests/);
  assert.equal(chamar(s, { rota: 'evento.listar', ambiente: 'DEMO' }).error.code, 'CONFIG');
  const rel = js(gas.exec(() => G.Maintenance.setup({ usuario: USUARIO, ambiente: 'TESTE' })));
  const teste = s.props().TEST_SPREADSHEET_ID;
  assert.ok(teste && teste !== s.banco(), 'outra planilha');
  assert.equal(rel.banco, teste);
  assert.equal(gas.drive.arquivo(teste).appProperties.erp_ambiente, 'TESTE');
  assert.equal(s.props()['IO_PRIMITIVE:' + teste], rel.primitiva.primitiva, 'forma de gravação guardada só para ela');
  const prodAntes = { eventos: JSON.stringify(s.tabela('EVENTOS')), animais: JSON.stringify(s.tabela('ANIMAIS')), versao: versaoProd(s), primitiva: s.props().IO_PRIMITIVE };
  // Cadastro mínimo na base de teste pela própria Api.
  const prop = chamar(s, { rota: 'propriedade.salvar', ambiente: 'TESTE', idempotencyKey: 't-prop', dados: { campos: { nome: 'Fazenda de Teste', status: 'ATIVO' } } }).data;
  const pasto = chamar(s, { rota: 'pasto.salvar', ambiente: 'TESTE', idempotencyKey: 't-pasto', dados: { campos: { property_id: prop.property_id, nome: 'Pasto T', posse: 'PROPRIO', status: 'ATIVO' } } }).data;
  assert.equal(chamar(s, { rota: 'config.salvar', ambiente: 'TESTE', idempotencyKey: 't-cfg', dados: { valores: { data_marco_zero: D0 } } }).ok, true);
  const r = reg(s, outra('2026-02-01', [bicho({ brinco: '71', pasto_destino_id: pasto.pasture_id })]), 't-ev', { ambiente: 'TESTE', banco: s.banco() });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(s.tabela('EVENTOS', teste).filter((e) => e.event_id === r.data.event_id).length, 1, 'gravou na base de teste');
  assert.deepEqual({ eventos: JSON.stringify(s.tabela('EVENTOS')), animais: JSON.stringify(s.tabela('ANIMAIS')), versao: versaoProd(s), primitiva: s.props().IO_PRIMITIVE }, prodAntes, 'a produção não mudou (o campo "banco" do cliente é ignorado)');
  assert.equal(r.meta.dataVersion, Number(s.props()['DATA_VERSION:' + teste]), 'versão por planilha');
  const b = chamar(s, { rota: 'sistema.bootstrap', ambiente: 'TESTE', dados: {} }).data;
  assert.deepEqual(b.ambiente, { codigo: 'TESTE', base_de_teste: true, faixa: 'BASE DE TESTE' });
  assert.equal(b.animais.n, 1);
  // A mesma chave em bancos diferentes são operações diferentes.
  assert.equal(chamar(s, { rota: 'operacao.status', dados: { chave: 't-ev' } }).data.situacao, 'INEXISTENTE', 'a chave do teste não existe na produção');
});

test('rascunho no servidor: salvar, obter e remover nas propriedades do usuário, por ambiente, sem tocar a planilha nem a versão', () => {
  const s = S.sistema();
  const { gas } = s;
  const v0 = versaoProd(s);
  const escritas = gas.falhas.escritas();
  const conteudo = { tipo: 'OUTRA_ENTRADA', animais: [{ brinco: '0012', peso: 312.5 }], idempotencyKey: 'form-1' };
  const sv = chamar(s, { rota: 'rascunho.salvar', dados: { chave: 'evento:form-1', conteudo } });
  assert.equal(sv.ok, true);
  assert.equal(sv.data.salvo_em, '2026-11-13T14:00:00.000Z');
  assert.equal(sv.meta.dataVersion, null, 'rascunho não é dado do banco');
  assert.deepEqual(chamar(s, { rota: 'rascunho.obter', dados: { chave: 'evento:form-1' } }).data, { chave: 'evento:form-1', existe: true, conteudo, salvo_em: sv.data.salvo_em });
  assert.equal(chamar(s, { rota: 'rascunho.obter', ambiente: 'TESTE', dados: { chave: 'evento:form-1' } }).data.existe, false, 'cada ambiente tem os seus');
  assert.deepEqual([gas.falhas.escritas(), versaoProd(s)], [escritas, v0], 'nada na planilha, versão igual');
  assert.ok(Object.keys(gas.props.user.getProperties()).some((k) => /^RASCUNHO:PRODUCAO:evento:form-1$/.test(k)), 'nas propriedades do usuário');
  assert.equal(Object.keys(gas.props.script.getProperties()).some((k) => /RASCUNHO/.test(k)), false, 'não nas do script');
  assert.deepEqual(chamar(s, { rota: 'rascunho.remover', dados: { chave: 'evento:form-1' } }).data, { chave: 'evento:form-1', removido: true });
  assert.equal(chamar(s, { rota: 'rascunho.obter', dados: { chave: 'evento:form-1' } }).data.existe, false);
  // Recusas.
  assert.equal(chamar(s, { rota: 'rascunho.salvar', dados: { chave: '../x', conteudo: 1 } }).error.code, 'VALIDATION');
  assert.equal(chamar(s, { rota: 'rascunho.salvar', dados: { chave: 'a' } }).error.code, 'VALIDATION');
  // Acima de um valor das propriedades (9 KB), o rascunho vai em partes e volta inteiro (revisão 3: o lote de 80
  // animais do 08-ux-ui, seção 9); acima de 96 KB, recusa.
  const medio = { linhas: Array.from({ length: 80 }, (_, i) => ({ brinco: 'Bezerro ' + i, peso: '240,5', obs: 'é'.repeat(40) })) };
  const sm = chamar(s, { rota: 'rascunho.salvar', dados: { chave: 'medio', conteudo: medio } });
  assert.equal(sm.ok, true, JSON.stringify(sm.error));
  assert.ok(sm.data.bytes > 9 * 1024 && sm.data.partes > 1, JSON.stringify(sm.data));
  assert.deepEqual(chamar(s, { rota: 'rascunho.obter', dados: { chave: 'medio' } }).data.conteudo, medio);
  assert.equal(Object.keys(gas.props.user.getProperties()).filter((k) => k.indexOf('RASCUNHO:PRODUCAO:medio#') === 0).length, sm.data.partes);
  assert.equal(chamar(s, { rota: 'rascunho.salvar', dados: { chave: 'medio', conteudo: 'pequeno' } }).data.partes, 1, 'regravado menor');
  assert.equal(Object.keys(gas.props.user.getProperties()).some((k) => k.indexOf('RASCUNHO:PRODUCAO:medio#') === 0), false, 'as partes antigas saem');
  assert.equal(chamar(s, { rota: 'rascunho.obter', dados: { chave: 'medio' } }).data.conteudo, 'pequeno');
  chamar(s, { rota: 'rascunho.salvar', dados: { chave: 'medio', conteudo: medio } });
  assert.equal(chamar(s, { rota: 'rascunho.remover', dados: { chave: 'medio' } }).data.removido, true);
  assert.equal(Object.keys(gas.props.user.getProperties()).some((k) => k.indexOf('RASCUNHO:PRODUCAO:medio') === 0), false, 'remover leva as partes');
  const grande = chamar(s, { rota: 'rascunho.salvar', dados: { chave: 'grande', conteudo: 'é'.repeat(50000) } });
  assert.equal(grande.error.code, 'VALIDATION');
  assert.match(grande.error.message, /grande demais.*o limite é 96 KB/);
  // Rascunho vencido (30 dias) sai na próxima gravação; acima de 40 guardados, recusa.
  gas.props.user.setProperty('RASCUNHO:PRODUCAO:velho', JSON.stringify({ conteudo: 1, salvo_em: '2026-09-01T00:00:00.000Z' }));
  for (let i = 0; i < 40; i++) assert.equal(chamar(s, { rota: 'rascunho.salvar', dados: { chave: 'r' + i, conteudo: i } }).ok, true);
  assert.equal(gas.props.user.getProperty('RASCUNHO:PRODUCAO:velho'), null, 'o vencido foi descartado');
  const cheio = chamar(s, { rota: 'rascunho.salvar', dados: { chave: 'r40', conteudo: 40 } });
  assert.equal(cheio.error.code, 'VALIDATION');
  assert.match(cheio.error.message, /rascunhos demais/);
  assert.equal(chamar(s, { rota: 'rascunho.salvar', dados: { chave: 'r0', conteudo: 'de novo' } }).ok, true, 'regravar um que já existe passa');
  // Funciona antes do setup (não precisa de banco).
  const gas2 = createGas();
  const r = js(gas2.exec(() => gas2.G.api({ rota: 'rascunho.salvar', dados: { chave: 'x', conteudo: { a: 1 } } })));
  assert.deepEqual([r.ok, r.meta.dataVersion], [true, null]);
  assert.equal(js(gas2.exec(() => gas2.G.api({ rota: 'evento.listar' }))).error.code, 'CONFIG');
});

test('config.salvar do fuso leva a planilha-banco junto (o "hoje" do servidor é o fuso da planilha); a integridade fica sem erro', () => {
  const s = S.sistema();
  assert.equal(s.gas.planilhas.propriedades(s.banco()).fuso, 'America/Porto_Velho');
  const r = chamar(s, { rota: 'config.salvar', idempotencyKey: 'k-fuso', dados: { valores: { fuso: 'Asia/Tokyo' } } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(s.gas.planilhas.propriedades(s.banco()).fuso, 'Asia/Tokyo');
  // 13/11 10:00 em Porto Velho já é 13/11 23:00 em Tóquio; às 11:00 de Porto Velho é dia 14 lá.
  s.gas.clock.now += 3600000;
  const amanhaEmPV = reg(s, outra('2026-11-14', [bicho({ brinco: '81' })]), 'k-hoje');
  assert.equal(amanhaEmPV.ok, true, '14/11 já é hoje no fuso configurado: ' + JSON.stringify(amanhaEmPV.error));
  const integ = chamar(s, { rota: 'sistema.integridade', dados: {} }).data;
  assert.equal(integ.checagens.find((c) => c.codigo === 'FUSO_LOCALE').situacao, 'OK');
});

test('manutenção pela api: backup, estado do sistema, integridade com reparo; restauração por backup inexistente → NOT_FOUND', () => {
  const s = S.sistema();
  const bk = chamar(s, { rota: 'sistema.backup', dados: {} });
  assert.equal(bk.data.backup.motivo, 'SOB_DEMANDA');
  const est = chamar(s, { rota: 'sistema.estado', dados: {} }).data;
  assert.deepEqual([est.backups.length, est.ultimo_backup.id], [1, bk.data.backup.id]);
  const al = chamar(s, { rota: 'alerta.listar', dados: {} }).data;
  assert.equal(al.alertas.some((a) => a.codigo === 'BACKUP_ATRASADO'), false, 'backup de agora: sem alerta');
  const rep = chamar(s, { rota: 'sistema.integridade', dados: { reparar: true, justificativa: 'conferência' } }).data;
  assert.equal(rep.integridade.ok, true);
  assert.equal(chamar(s, { rota: 'sistema.restaurarBackup', dados: { backup_id: 'nao-existe' } }).error.code, 'NOT_FOUND');
  // Planilha-banco inacessível (apagada, sem permissão): CONFIG com instrução, a causa só no log.
  s.gas.planilhas.tornarInacessivel(s.banco());
  const r = chamar(s, { rota: 'evento.listar', dados: {} });
  assert.equal(r.error.code, 'CONFIG');
  assert.match(r.error.message, /restaure um backup/);
  assert.ok(s.gas.logs.some((l) => l[0] === 'error' && /planilha-banco inacessível/.test(String(l[1][0]))));
});

test('páginas: doGet sem a interface instalada mostra o aviso com título e viewport; ?pagina=concorrencia só fala com a base de TESTE; include por lista branca', () => {
  const s = S.sistema();
  const { gas, G } = s;
  const p = gas.exec(() => G.doGet({ parameter: {} }));
  assert.equal(p.getTitle(), 'ERP Pecuário');
  assert.deepEqual(p._meta, [['viewport', 'width=device-width, initial-scale=1']]);
  if (!fs.existsSync(path.join(__dirname, '..', 'src', 'Index.html'))) assert.match(p.getContent(), /interface ainda não foi instalada/);
  const c = gas.exec(() => G.doGet({ parameter: { pagina: 'concorrencia' } }));
  assert.match(c.getTitle(), /concorrência/);
  assert.deepEqual(c._meta, [['viewport', 'width=device-width, initial-scale=1']]);
  const html = c.getContent();
  assert.match(html, /BASE DE TESTE/);
  assert.equal((html.match(/rota: "[a-z.A-Z]+"/g) || []).length, (html.match(/ambiente: "TESTE"/g) || []).length, 'todo pedido da página leva ambiente TESTE');
  assert.doesNotMatch(html, /<script src|https?:\/\//, 'página autocontida');
  for (const nome of ['Index', '../appsscript', 'Code', 'styles']) {
    assert.throws(() => gas.exec(() => G.include_(nome)), (e) => e.code === 'VALIDATION', nome);
  }
  assert.ok(G.Api.INCLUDES.indexOf('Styles') >= 0);
});
