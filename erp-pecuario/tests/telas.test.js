'use strict';
/**
 * Telas da Fase 1 no Node (E1.9 parte 2, E1.8 e E1.10 na tela): as rotas que as telas acrescentaram
 * (importacao.modelo, sistema.diagnostico, códigos de aviso na listagem de parâmetros) e as regras puras do cliente,
 * carregadas da página montada pelo doGet real num contexto vm: exportação CSV (BOM, ponto e vírgula, aspas e
 * saneamento contra fórmula só na exportação), filtros e faixas etárias da listagem, parâmetros de faixa etária e o
 * pré-preenchimento da correção de uma entrada, que, convertido como o formulário converte, o servidor aceita e
 * reproduz o original. Os fluxos em navegador ficam em tests/ui/telas.test.js (npm run ui:check).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const S = require('./apoio-sistema');

const { js } = S;
function api(s, pedido) { return js(s.gas.exec(() => s.G.api(pedido))); }
/** Os scripts do cliente da página do doGet num contexto vm (sem o boot, que precisa do DOM). */
function cliente(s) {
  const html = s.gas.exec(() => s.G.doGet({ parameter: {} })).getContent();
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((b) => b.indexOf('DOMContentLoaded') < 0).forEach((b, i) => vm.runInContext(b, ctx, { filename: 'cliente' + i }));
  return ctx;
}
function materializar(col) {
  const out = [];
  for (let i = 0; i < col.n; i++) { const o = {}; col.colunas.forEach((c) => { o[c] = col.valores[c][i]; }); out.push(o); }
  return out;
}
/** Store mínimo do cliente sobre a carga inicial real (sistema.bootstrap). */
function storeDe(s) {
  const b = api(s, { rota: 'sistema.bootstrap', dados: {} }).data;
  const animais = materializar(b.animais);
  const params = Object.fromEntries(b.configuracoes.itens.map((i) => [i.chave, i.valor]));
  return {
    b, animais,
    tipoEvento: (t) => b.catalogo.tipos.filter((x) => x.tipo === t)[0] || null,
    animal: (id) => animais.filter((a) => a.animal_id === id)[0] || null,
    lista: (n) => b.listas.filter((l) => l.lista === n && l.ativo !== false),
    param: (k) => (params[k] === undefined ? null : params[k]),
    pasto: (id) => b.pastos.filter((p) => p.pasture_id === id)[0] || null,
    categoria: (id) => b.categorias.filter((c) => c.category_id === id)[0] || null,
    rotuloLista: (n, c) => (b.listas.filter((l) => l.lista === n && l.codigo === c)[0] || { rotulo: c }).rotulo,
    conta: (id) => b.contas.filter((x) => x.conta_id === id)[0] || null,
    parceiro: (id) => b.parceiros.filter((x) => x.partner_id === id)[0] || null,
    normalizarBrinco: (t, z) => { let v = String(t == null ? '' : t).trim().toUpperCase().replace(/\s+/g, ''); if (!z && /^\d+$/.test(v)) v = v.replace(/^0+(?=\d)/, ''); return v; },
  };
}

test('importacao.modelo: campos e rótulos do importador; o cabeçalho do modelo para baixar é reconhecido inteiro pelo mapeamento; o mesmo modelo, montado pelo cliente, é lido pelo servidor', () => {
  const s = S.sistema();
  const r = api(s, { rota: 'importacao.modelo', dados: {} });
  assert.equal(r.ok, true);
  const m = r.data;
  const CAMPOS = js(s.G.ImportService.CAMPOS);
  assert.deepEqual(m.campos.map((c) => c.campo), Object.keys(CAMPOS), 'todos os campos de destino, na ordem do serviço');
  m.campos.forEach((c) => assert.equal(c.rotulo, CAMPOS[c.campo].rotulo, c.campo));
  assert.deepEqual(m.campos.filter((c) => c.obrigatorio).map((c) => c.campo), ['sexo', 'pasto']);
  assert.deepEqual(m.campos.filter((c) => c.so_femea).map((c) => c.campo), ['partos_previos', 'situacao_reprodutiva', 'data_prevista_parto']);
  assert.deepEqual(m.tipos, ['ANIMAIS', 'COMPRAS', 'VENDAS', 'TRANSFERENCIAS', 'NASCIMENTOS', 'MORTES'], 'o rebanho do marco zero e os eventos históricos (Fase 2)');
  assert.deepEqual(m.confiancas.mae, ['CONFIRMADA', 'ESTIMADA'], 'vínculo de parentesco não aceita "desconhecida"');
  const sug = js(s.G.ImportService.sugerirMapeamento(m.cabecalho_modelo));
  assert.equal(Object.keys(sug).length, m.campos.length, 'modelo conhecido já vem mapeado');
  // O CSV que a tela baixa (Exportar.csv), enviado de volta com uma linha, é lido com a sugestão completa.
  const c = cliente(s);
  const modeloCsv = c.Exportar.csv(m.cabecalho_modelo.map((rot) => ({ rotulo: rot, valor: () => '' })), []);
  assert.equal(modeloCsv.charCodeAt(0), 0xfeff);
  const texto = modeloCsv + m.cabecalho_modelo.map((rot) => (rot === 'Sexo' ? 'F' : rot === 'Pasto' ? 'Pasto A' : '')).join(';') + '\r\n';
  const criado = api(s, { rota: 'importacao.criar', idempotencyKey: 'modelo-1', dados: { tipo: 'ANIMAIS', arquivo_nome: 'modelo.csv', conteudo_base64: Buffer.from(texto, 'utf8').toString('base64'), formato: { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' } } });
  assert.equal(criado.ok, true, JSON.stringify(criado.error));
  assert.equal(criado.data.total_linhas, 1);
  assert.equal(Object.keys(criado.data.sugestao).length, m.campos.length);
  // Os separadores oferecidos pela tela são os que o servidor aceita; outro é recusado.
  for (const d of m.delimitadores) {
    const ok = api(s, { rota: 'importacao.criar', idempotencyKey: 'delim-' + d, dados: { tipo: 'ANIMAIS', arquivo_nome: 'x' + d + '.csv', texto: 'Sexo' + (d === 'TAB' ? '\t' : d) + 'Pasto\nF' + (d === 'TAB' ? '\t' : d) + 'Pasto A ' + d, formato: { delimitador: d, codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: d === ',' ? '.' : ',' } } });
    assert.equal(ok.ok, true, d + ': ' + JSON.stringify(ok.error));
  }
  const ruim = api(s, { rota: 'importacao.criar', idempotencyKey: 'delim-ruim', dados: { tipo: 'ANIMAIS', arquivo_nome: 'y.csv', texto: 'Sexo#Pasto\nF#A', formato: { delimitador: '#', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' } } });
  assert.equal(ruim.ok, false);
  assert.equal(ruim.error.code, 'VALIDATION');
});

test('sistema.diagnostico: sessão, forma de gravação, rotinas que faltam, fusos e versão, sem dado sensível; sem banco do ambiente → CONFIG', () => {
  const s = S.sistema();
  const r = api(s, { rota: 'sistema.diagnostico', dados: {} });
  assert.equal(r.ok, true);
  const d = r.data;
  assert.deepEqual(Object.keys(d).sort(), ['app_version', 'data_version', 'editor', 'fuso', 'gatilhos', 'gravacao_em_curso', 'primitiva', 'sessao'].sort());
  assert.equal(d.sessao.email_ativo_e_do_dono, true);
  assert.deepEqual(d.gatilhos.faltando, []);
  assert.deepEqual(d.fuso, { script: S.FUSO, planilha: S.FUSO });
  assert.equal(d.gravacao_em_curso, false);
  assert.equal(d.data_version, r.meta.dataVersion);
  assert.doesNotMatch(JSON.stringify(d), /@|eeeeeeee-|SPREADSHEET/, 'nem e-mail nem id de arquivo no diagnóstico');
  const t = s.gas.exec(() => s.G.ScriptApp.getProjectTriggers().filter((x) => x.getHandlerFunction() === 'trgIntegridadeSemanal')[0]);
  s.gas.exec(() => s.G.ScriptApp.deleteTrigger(t));
  assert.deepEqual(api(s, { rota: 'sistema.diagnostico', dados: {} }).data.gatilhos.faltando, ['trgIntegridadeSemanal'], 'rotina apagada aparece como faltando');
  const teste = api(s, { rota: 'sistema.diagnostico', dados: {}, ambiente: 'TESTE' });
  assert.equal(teste.ok, false);
  assert.equal(teste.error.code, 'CONFIG');
});

test('parâmetros: a listagem traz os códigos de aviso e as políticas; a política salva pela tela é aceita e uma desconhecida é recusada', () => {
  const s = S.sistema();
  const b = api(s, { rota: 'sistema.bootstrap', dados: {} }).data;
  assert.deepEqual(b.configuracoes.codigos_aviso, js(s.G.Config.CODIGOS_AVISO));
  assert.equal(b.configuracoes.codigos_aviso.length, 13);
  assert.deepEqual(b.configuracoes.politicas, ['BLOQUEIA', 'AVISA', 'IGNORA']);
  const ok = api(s, { rota: 'config.salvar', idempotencyKey: 'pol-1', dados: { valores: { avisos_politica: { CARENCIA_ATIVA: 'BLOQUEIA', BRINCO_PARECIDO: 'IGNORA' }, faixas_etarias_meses: [12, 24, 36, 48] } } });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const ruim = api(s, { rota: 'config.salvar', idempotencyKey: 'pol-2', dados: { valores: { avisos_politica: { CARENCIA_ATIVA: 'TALVEZ' } } } });
  assert.equal(ruim.ok, false);
  assert.equal(ruim.error.code, 'VALIDATION');
  const c = cliente(s);
  assert.deepEqual(js(c.TelaConfig.valorParam({ chave: 'faixas_etarias_meses' }, '12, 24;36 48')), { valor: [12, 24, 36, 48] });
  assert.match(c.TelaConfig.valorParam({ chave: 'faixas_etarias_meses' }, '12, doze').erro, /meses inteiros/);
  assert.deepEqual(js(c.TelaConfig.valorParam({ chave: 'ua_peso_kg' }, 455)), { valor: 455 });
});

test('exportação CSV: célula como na tela; saneamento contra fórmula só no que começa com = + - @ tabulação ou retorno e não é número; aspas e ponto e vírgula; BOM e CRLF', () => {
  const s = S.sistema({ semCadastro: true });
  const E = cliente(s).Exportar;
  const casos = [
    ['=1+1', "'=1+1"], ['+55 69 99999-0000', "'+55 69 99999-0000"], ['-10 kg', "'-10 kg"], ['@lote', "'@lote"], ['\tx', "'\tx"],
    ['-1,5', '-1,5'], ['-1.234,5', '-1.234,5'], ['0012', '0012'], ['1E5', '1E5'], ['a;b', '"a;b"'], ['diz "oi"', '"diz ""oi"""'], ['linha\nnova', '"linha\nnova"'],
    ['=SOMA(A1;A2)', '"\'=SOMA(A1;A2)"'], [null, ''], [undefined, ''], [-2.5, '-2,5'], [true, 'Sim'], ['', ''],
  ];
  for (const [entrada, saida] of casos) assert.equal(E.celula(entrada), saida, JSON.stringify(entrada));
  const t = E.csv([{ rotulo: 'Brinco', valor: (l) => l.b }, { rotulo: 'Obs.', valor: (l) => l.o }], [{ b: '0457', o: '=HIPERLINK("x")' }, { b: '12', o: null }], { preambulo: ['Rebanho — 2 animais', 'Filtros: situação: Ativos'] });
  assert.equal(t, '﻿Rebanho — 2 animais\r\nFiltros: situação: Ativos\r\n\r\nBrinco;Obs.\r\n0457;"\'=HIPERLINK(""x"")"\r\n12;\r\n');
  assert.equal(E.csv([{ rotulo: 'A', valor: () => 'x' }], []), '﻿A\r\n', 'sem linhas: só o cabeçalho, sem preâmbulo');
});

test('listagem do rebanho: faixas etárias pelos cortes; filtros de texto (zeros à esquerda, código, nome sem acento), pasto, sexo, categoria, situação, faixa e atalhos', () => {
  const s = S.sistema({ semCadastro: true });
  const c = cliente(s);
  const T = c.TelaRebanho;
  c.Store = { normalizarBrinco: (t, z) => { let v = String(t == null ? '' : t).trim().toUpperCase().replace(/\s+/g, ''); if (!z && /^\d+$/.test(v)) v = v.replace(/^0+(?=\d)/, ''); return v; } };
  const fx = js(T.faixas([24, 12, 36]));
  assert.deepEqual(fx.map((f) => f.id), ['0-12', '12-24', '24-36', '36+', '__SEM__'], 'cortes ordenados; mínima inclusiva, máxima exclusiva');
  assert.deepEqual(js(T.faixas(null)).map((f) => f.id), ['0-12', '12-24', '24-36', '36+', '__SEM__'], 'sem parâmetro: os cortes padrão');
  const a = (o) => Object.assign({ animal_id: 'x' + Math.random(), situacao_cadastral: 'ATIVO', brinco: null, codigo_interno: 'A-000001', nome: null, sexo: 'F', pasto_atual_id: 'P1', categoria_id: 'C1', idade_meses: 10 }, o);
  const lista = [
    a({ animal_id: 'a1', brinco: '0457', codigo_interno: 'A-000001', nome: 'Mimosa', idade_meses: 12 }),
    a({ animal_id: 'a2', brinco: '457B', codigo_interno: 'A-000002', idade_meses: 11 }),
    a({ animal_id: 'a3', codigo_interno: 'A-000003', nome: 'Estrêla', sexo: 'M', pasto_atual_id: null, idade_meses: 40 }),
    a({ animal_id: 'a4', brinco: '12', codigo_interno: 'A-000004', categoria_id: null, idade_meses: null }),
    a({ animal_id: 'a5', brinco: '99', codigo_interno: 'A-000005', situacao_cadastral: 'VENDIDO', pasto_atual_id: null }),
    a({ animal_id: 'a6', codigo_interno: 'A-000006', situacao_cadastral: 'EXTERNO', categoria_id: null, pasto_atual_id: null, nome: 'Touro de sêmen' }),
    a({ animal_id: 'a7', brinco: '7', codigo_interno: 'A-000007', situacao_cadastral: 'ANULADO' }),
  ];
  const base = { texto: '', pasto: '', sexo: '', categoria: '', situacao: 'ATIVO', faixa: '', atalho: '' };
  const ids = (f, ctx) => js(T.filtrar(lista, Object.assign({}, base, f), Object.assign({ cortes: [12, 24, 36], ignoraZeros: true }, ctx))).map((x) => x.animal_id);
  assert.deepEqual(ids({}), ['a1', 'a2', 'a3', 'a4'], 'padrão: só ativos (anulado nunca aparece)');
  assert.deepEqual(ids({ texto: '457' }), ['a1'], '"457" acha "0457" sem os zeros à esquerda; "457B" não');
  assert.deepEqual(ids({ texto: '457' }, { ignoraZeros: false }), [], 'com o parâmetro desligado, só o exato');
  assert.deepEqual(ids({ texto: '0457' }, { ignoraZeros: false }), ['a1']);
  assert.deepEqual(ids({ texto: 'a-000003' }), ['a3'], 'código interno');
  assert.deepEqual(ids({ texto: '4' }), ['a4'], 'número do código interno');
  assert.deepEqual(ids({ texto: 'estrela' }), ['a3'], 'nome sem acento e sem caixa');
  assert.deepEqual(ids({ pasto: '__SEM__' }), ['a3']);
  assert.deepEqual(ids({ pasto: 'P1' }), ['a1', 'a2', 'a4']);
  assert.deepEqual(ids({ sexo: 'M' }), ['a3']);
  assert.deepEqual(ids({ categoria: '__SEM__' }), ['a4']);
  assert.deepEqual(ids({ categoria: '__SEM__', situacao: '' }), ['a4'], 'externo não entra em "sem categoria"');
  assert.deepEqual(ids({ faixa: '0-12' }), ['a2'], '12 meses já é da faixa 12–24');
  assert.deepEqual(ids({ faixa: '12-24' }), ['a1']);
  assert.deepEqual(ids({ faixa: '36+' }), ['a3']);
  assert.deepEqual(ids({ faixa: '__SEM__' }), ['a4']);
  assert.deepEqual(ids({ situacao: 'SAIRAM' }), ['a5']);
  assert.deepEqual(ids({ situacao: 'EXTERNO' }), ['a6']);
  assert.deepEqual(ids({ situacao: '' }), ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  assert.deepEqual(ids({ atalho: 'SEM_BRINCO' }), ['a3']);
  assert.deepEqual(ids({ atalho: 'SEM_BRINCO', situacao: '' }), ['a3'], 'atalho vale só para ativos');
  assert.deepEqual(ids({ atalho: 'SEM_PASTO', situacao: '' }), ['a3']);
  assert.deepEqual(ids({ atalho: 'SEM_CATEGORIA' }), ['a4']);
  assert.deepEqual(js(T.COLUNAS.map((x) => x.rotulo)), ['Brinco', 'ID', 'Sexo', 'Raça', 'Idade', 'Categoria', 'Peso atual', 'Pasto atual', 'Situação', 'Nascimento'], 'as 10 colunas da §5');
});

test('correção de entrada: o pré-preenchimento, convertido como o formulário converte, é aceito pelo servidor e reproduz o original; tirar um animal anula só ele', () => {
  const s = S.sistema();
  const sem = s.exec((ctx) => s.G.EventService.registrar(ctx, { idempotencyKey: 'ent-corr', dados: S.entradaInicial([
    S.bicho({ brinco: '0100', ref: 'm1', data_nascimento: '2019-05-01', data_nascimento_confianca: 'CONFIRMADA', raca: 'NELORE', partos_previos: 2, peso: 412.5, metodo_pesagem: 'BALANCA', valor_abertura: 250000, outras_identificacoes: [{ tipo: 'RFID', codigo: '982000123' }], observacoes: 'matriz boa' }),
    S.bicho({ brinco: '0101', mae_ref: 'm1', mae_confianca: 'CONFIRMADA', data_nascimento: '2025-08-01', data_nascimento_confianca: 'ESTIMADA', pasto_destino_id: S.PASTOS.B }),
    S.bicho({ brinco: '0102', sexo: 'M', castrado: true, reprodutor: false, idade_meses: 20, data_entrada: '2025-02-01', data_entrada_confianca: 'ESTIMADA' }),
  ]) })).dados;
  const st = storeDe(s);
  const c = cliente(s);
  c.Store = st;
  const obter = api(s, { rota: 'evento.obter', dados: { event_id: sem.event_id } }).data;
  const previa = js(c.TelaEventos.previaCorrecao(obter));
  assert.equal(previa.corrige.event_id, sem.event_id);
  assert.match(previa.corrige.rotulo, /de 01\/01\/2026 \(3 animais\)$/);
  assert.equal(previa.linhas.length, 3);
  assert.ok(previa.linhas.every((l) => l.criado), 'os animais criados pelo original são reaproveitados');
  const mae = previa.linhas.filter((l) => l.valores.brinco === '0100')[0];
  assert.deepEqual([mae.valores.peso, mae.valores.metodo_pesagem, mae.valores.valor_abertura, mae.valores.partos_previos, mae.valores.raca], ['412,5', 'BALANCA', '2500,00', '2', 'NELORE'], 'valores como o formulário os mostra');
  assert.deepEqual(mae.valores.outras_identificacoes, [{ tipo: 'RFID', codigo: '982000123' }]);
  const cria = previa.linhas.filter((l) => l.valores.brinco === '0101')[0];
  assert.equal(cria.valores.mae_id, mae.animal_id, 'a mãe do mesmo lançamento vira o id dela');
  const boi = previa.linhas.filter((l) => l.valores.brinco === '0102')[0];
  assert.deepEqual([boi.valores.castrado, boi.valores.reprodutor, boi.valores.data_entrada_confianca], [true, false, 'ESTIMADA']);
  const defs = st.tipoEvento('ENTRADA_INICIAL').campos_animal.filter((d) => d.id !== 'animal_id');
  const converter = (linhas) => linhas.map((l) => {
    const r = js(c.Formulario.converterValores(defs, JSON.parse(JSON.stringify(l.valores)), JSON.parse(JSON.stringify(l.valores))));
    assert.deepEqual(r.erros, [], l.valores.brinco);
    return Object.assign({ animal_id: l.animal_id }, r.valores);
  });
  const campos = js(c.Formulario.converterValores(st.tipoEvento('ENTRADA_INICIAL').campos, JSON.parse(JSON.stringify(previa.campos)))).valores;
  const dados = { tipo: 'ENTRADA_INICIAL', campos, animais: converter(previa.linhas), event_id: sem.event_id, justificativa: 'Conferência' };
  const sim = api(s, { rota: 'evento.simular', dados: { acao: 'corrigir', dados } });
  assert.equal(sim.ok, true, JSON.stringify(sim.error));
  assert.deepEqual([sim.data.impactos.animais, sim.data.impactos.novos, sim.data.impactos.anulados, sim.data.impactos.substitui], [3, 0, 0, sem.event_id]);
  const antes = s.tabela('ANIMAIS').map((a) => Object.assign({}, a, { updated_at: null }));
  const corr = api(s, { rota: 'evento.corrigir', idempotencyKey: 'corr-1', dados });
  assert.equal(corr.ok, true, JSON.stringify(corr.error));
  const depois = s.tabela('ANIMAIS').map((a) => Object.assign({}, a, { updated_at: null, evento_origem_id: antes.filter((x) => x.animal_id === a.animal_id)[0].evento_origem_id }));
  assert.deepEqual(depois, antes, 'substituto sem mudança reproduz o original (mesmos animais, mesmos atributos e custo)');
  s.conferirProjecoes('depois da correção');
  // Tirar um animal: só ele é anulado.
  const obter2 = api(s, { rota: 'evento.obter', dados: { event_id: corr.data.event_id } }).data;
  const p2 = js(c.TelaEventos.previaCorrecao(obter2));
  const sem2 = { tipo: 'ENTRADA_INICIAL', campos, animais: converter(p2.linhas.filter((l) => l.valores.brinco !== '0102')), event_id: corr.data.event_id, justificativa: 'Boi não era daqui' };
  const sim2 = api(s, { rota: 'evento.simular', dados: { acao: 'corrigir', dados: sem2 } });
  assert.equal(sim2.ok, true, JSON.stringify(sim2.error));
  assert.equal(sim2.data.impactos.anulados, 1);
  // Falha: a mãe sai e a cria fica → a cria perde a mãe? O servidor recusa (dependente).
  const sem3 = { tipo: 'ENTRADA_INICIAL', campos, animais: converter(p2.linhas.filter((l) => l.valores.brinco !== '0100')), event_id: corr.data.event_id, justificativa: 'Teste' };
  const sim3 = api(s, { rota: 'evento.simular', dados: { acao: 'corrigir', dados: sem3 } });
  assert.equal(sim3.ok, false, 'anular a mãe que é referência de outro animal é recusado');
  assert.ok(['VALIDATION', 'CONFLICT'].includes(sim3.error.code), sim3.error.code);
});

test('correção de venda: o pré-preenchimento (VENDAS, receita, deduções pelo payload, linhas de saída) convertido como o formulário converte é aceito pelo servidor e reproduz o original', () => {
  const s = S.sistema();
  const sem = s.exec((ctx) => s.G.EventService.registrar(ctx, { idempotencyKey: 'ent-venda', dados: S.entradaInicial([
    S.bicho({ brinco: '0201', sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '0202', sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' }),
  ]) })).dados;
  const comp = api(s, { rota: 'parceiro.salvar', idempotencyKey: 'pc', dados: { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } } }).data.partner_id;
  const transp = api(s, { rota: 'parceiro.salvar', idempotencyKey: 'pt', dados: { campos: { nome: 'Transportadora', tipos: ['TRANSPORTADOR'] } } }).data.partner_id;
  const ids = sem.animais.map((a) => a.animal_id);
  const venda = api(s, { rota: 'evento.registrar', idempotencyKey: 'venda-previa', dados: {
    tipo: 'VENDA', campos: { event_date: '2026-06-10', partner_id: comp, finalidade: 'ABATE', modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 32000, valor_bruto: 1184000, desconto_comercial: 4000, nota_fiscal: 'NF-9', condicoes: 'Embarque na fazenda' },
    animais: [{ animal_id: ids[0], peso: 540, peso_carcaca_kg: 285, motivo_saida: 'IDADE' }, { animal_id: ids[1], peso: 520, peso_carcaca_kg: 270, metodo_pesagem: 'FITA' }],
    parcelas: [{ data_vencimento: '2026-07-10', valor: 500000, forma_pagamento: 'TRANSFERENCIA' }, { data_vencimento: '2026-08-10' }],
    deducoes: [{ tipo: 'FRETE', valor: 30000, partner_id: transp, data_vencimento: '2026-06-15' }, { tipo: 'FUNRURAL', valor: 17760, retida_pelo_comprador: true, data_vencimento: '2026-08-10', descricao: 'Retenção da nota' }],
  } });
  assert.equal(venda.ok, true, JSON.stringify(venda.error));
  const st = storeDe(s);
  const c = cliente(s);
  c.Store = st;
  const obter = api(s, { rota: 'evento.obter', dados: { event_id: venda.data.event_id } }).data;
  const previa = js(c.TelaEventos.previaCorrecao(obter));
  assert.equal(previa.corrige.event_id, venda.data.event_id);
  assert.deepEqual([previa.campos.modalidade, previa.campos.base_peso, previa.campos.preco_unitario, previa.campos.valor_bruto, previa.campos.desconto_comercial, previa.campos.peso_carcaca_total_kg, previa.campos.condicoes],
    ['ARROBA', 'CARCACA', '320,00', '11840,00', '40,00', undefined, 'Embarque na fazenda'], 'carcaça de cada animal: o total fica vazio');
  assert.deepEqual(previa.linhas.map((l) => [l.valores.peso, l.valores.peso_carcaca_kg, l.valores.metodo_pesagem, l.valores.motivo_saida]), [['540,0', '285,0', undefined, 'IDADE'], ['520,0', '270,0', 'FITA', undefined]]);
  assert.deepEqual(previa.grupos.deducoes.map((g) => [g.valores.tipo, g.valores.retida_pelo_comprador, g.valores.descricao]), [['FRETE', false, undefined], ['FUNRURAL', true, 'Retenção da nota']], 'o tipo vem do payload; a descrição proposta pelo servidor fica vazia');
  const t = st.tipoEvento('VENDA');
  const conv = (defs, v, ctx) => { const r = js(c.Formulario.converterValores(defs, JSON.parse(JSON.stringify(v)), ctx ? JSON.parse(JSON.stringify(ctx)) : undefined)); assert.deepEqual(r.erros, []); return r.valores; };
  const campos = conv(t.campos, previa.campos);
  const dados = {
    tipo: 'VENDA', campos, event_id: venda.data.event_id, justificativa: 'Conferência',
    animais: previa.linhas.map((l) => Object.assign({ animal_id: l.animal_id }, conv(t.campos_animal, l.valores, Object.assign({}, previa.campos, l.valores)))),
    parcelas: previa.grupos.parcelas.map((g) => conv(t.grupos_repetiveis.parcelas, g.valores)),
    deducoes: previa.grupos.deducoes.map((g) => conv(t.grupos_repetiveis.deducoes, g.valores)),
  };
  const antesV = s.tabela('VENDAS')[0];
  const antesF = s.tabela('FINANCEIRO').map((f) => [f.natureza, f.valor, f.partner_id, f.retida_pelo_comprador, f.descricao]);
  const corr = api(s, { rota: 'evento.corrigir', idempotencyKey: 'corr-venda', dados });
  assert.equal(corr.ok, true, JSON.stringify(corr.error));
  const novaV = s.tabela('VENDAS').filter((v) => v.event_id === corr.data.event_id)[0];
  const sem_ = (v) => Object.assign({}, v, { sale_id: null, event_id: null });
  assert.deepEqual(sem_(novaV), sem_(antesV), 'o substituto sem mudança reproduz o cabeçalho da venda');
  const novosF = s.tabela('FINANCEIRO').filter((f) => f.event_id === corr.data.event_id).map((f) => [f.natureza, f.valor, f.partner_id, f.retida_pelo_comprador, f.descricao]);
  assert.deepEqual(novosF, antesF, 'e os lançamentos (receita, frete do transportador, retenção do comprador)');
  s.conferirProjecoes('depois da correção da venda');
});
