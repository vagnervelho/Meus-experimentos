'use strict';
/**
 * Jornada de ponta a ponta da Fase 1, só pela função pública api() (e setup() do editor), como o dono faria:
 * setup → propriedade, parceiro arrendador, três pastos (um arrendado), categoria e marco zero → importação de 120
 * animais com mãe e pai, em lotes → correção de cadastro (pela ficha) → correção de localização → estorno de uma
 * entrada → substituição de outra → backup → adulteração manual da planilha, que a integridade acusa → restauração →
 * no fim, projeção gravada = reconstrução, inventário por pasto coerente em todas as consultas e auditoria completa.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');

const js = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const HOJE = '2026-11-13';
const D0 = '2026-01-01';

function semDate(v, onde) {
  if (Object.prototype.toString.call(v) === '[object Date]') assert.fail('Date na resposta em ' + onde);
  if (v && typeof v === 'object') Object.keys(v).forEach((k) => semDate(v[k], onde + '.' + k));
}

function montar() {
  const gas = createGas({ order: 'reverse' });
  const G = gas.G;
  let n = 0;
  const j = {
    gas, G,
    props: () => Object.fromEntries(gas.props.script._data),
    banco: () => j.props().SPREADSHEET_ID,
    /** Uma chamada de google.script.run.api(pedido), numa execução. */
    api: (rota, dados, extra) => {
      const env = gas.exec(() => G.api(Object.assign({ rota, dados: dados || {} }, extra || {})));
      semDate(env, rota);
      return js(env);
    },
    /** Comando que tem de passar: devolve data (falha com a mensagem do servidor). */
    cmd: (rota, dados, extra) => {
      const r = j.api(rota, dados, Object.assign({ idempotencyKey: 'j-' + (++n) }, extra || {}));
      assert.equal(r.ok, true, rota + ': ' + JSON.stringify(r.error));
      return r.data;
    },
    ok: (rota, dados) => {
      const r = j.api(rota, dados);
      assert.equal(r.ok, true, rota + ': ' + JSON.stringify(r.error));
      return r.data;
    },
    tabela: (aba) => js(gas.exec(() => G.Database.abrir(j.banco(), { primitiva: j.props().IO_PRIMITIVE }).ler([aba])[aba].registros)),
    /** Projeção gravada × reconstrução total, no banco em uso. */
    diferencas: () => js(gas.exec(() => G.UnitOfWork.read(G.Api.contexto({ usuario: 'dono@gmail.com' }), {
      rota: 'teste.projecoes', reads: G.Timeline.LEITURAS, acessoCru: true, tratador: (tx) => G.Timeline.conferir(tx),
    }).dados)),
    /** Edição à mão de uma célula (sem coerção), como o dono faria abrindo a planilha. */
    editarCelula: (aba, pk, valorPk, coluna, valor) => {
      const m = gas.planilhas.matriz(j.banco(), aba);
      const cab = m[0];
      const linha = m.findIndex((l, i) => i > 0 && l[cab.indexOf(pk)] === valorPk) + 1;
      assert.ok(linha > 1, 'linha de ' + valorPk + ' em ' + aba);
      gas.planilhas.gravar(j.banco(), aba, linha, cab.indexOf(coluna) + 1, [[valor]]);
    },
  };
  return j;
}

/** 120 animais: 4 touros, 40 vacas e 76 crias com mãe e pai (as 10 primeiras crias vêm antes das mães no arquivo). */
function arquivo() {
  const pastos = ['Sede', 'Rio', 'Arrendado do Zé'];
  const touros = [1, 2, 3, 4].map((i) => ['T0' + i, 'M', '2017-0' + i + '-15', '', '', 'Sede', 'S', 'N']);
  const vacas = [];
  for (let i = 1; i <= 40; i++) vacas.push(['V' + String(i).padStart(3, '0'), 'F', (2015 + (i % 5)) + '-03-' + String(1 + (i % 27)).padStart(2, '0'), '', '', pastos[i % 3], '', '']);
  const crias = [];
  for (let i = 1; i <= 76; i++) {
    const mae = vacas[(i - 1) % 40];
    const macho = i % 2 === 0;
    crias.push(['B' + String(i).padStart(3, '0'), macho ? 'M' : 'F', (2023 + (i % 3)) + '-0' + (1 + (i % 9)) + '-10', mae[0], 'T0' + (1 + (i % 4)), mae[5], macho ? 'N' : '', macho ? 'N' : '']);
  }
  const linhas = crias.slice(0, 10).concat(touros, vacas, crias.slice(10));
  return { texto: ['Brinco;Sexo;Nascimento;Mãe;Pai;Pasto;Reprodutor;Castrado'].concat(linhas.map((l) => l.join(';'))).join('\r\n'), crias, vacas, touros };
}

test('jornada da Fase 1 pela API: cadastro → importação de 120 → correções → estorno → substituição → backup → adulteração → restauração', () => {
  const j = montar();
  const { G } = j;

  // 1. Setup pelo editor (função pública), banco nasce vazio e íntegro.
  const rel = js(j.gas.exec(() => G.setup()));
  assert.equal(rel.integridade.ok, true, JSON.stringify(rel.integridade.achados));
  assert.equal(j.ok('sistema.bootstrap', {}).atual, false);

  // 2. Cadastros: propriedade (vira a padrão), parceiro arrendador, três pastos (um arrendado), categoria e parâmetros.
  const prop = j.cmd('propriedade.salvar', { campos: { nome: 'Fazenda Boa Vista', area_total_ha: 500 } });
  const arr = j.cmd('parceiro.salvar', { campos: { nome: 'José Vizinho', tipos: ['ARRENDADOR'] } });
  const sede = j.cmd('pasto.salvar', { campos: { property_id: prop.property_id, nome: 'Sede', area_hectares: 40, capacidade_estimada_cabecas: 80 } });
  const rio = j.cmd('pasto.salvar', { campos: { property_id: prop.property_id, nome: 'Rio', area_hectares: 35 } });
  const arrendado = j.cmd('pasto.salvar', { campos: { property_id: prop.property_id, nome: 'Arrendado do Zé', posse: 'ARRENDADO', arrendador_id: arr.partner_id, area_hectares: 60 } });
  assert.deepEqual([arrendado.posse, arrendado.arrendador_id], ['ARRENDADO', arr.partner_id]);
  const semArr = j.api('pasto.salvar', { campos: { property_id: prop.property_id, nome: 'Outro', arrendador_id: arr.partner_id } }, { idempotencyKey: 'j-sem-arr' });
  assert.deepEqual([semArr.ok, semArr.error.code, semArr.error.details[0].codigo], [false, 'VALIDATION', 'ARRENDADOR_SEM_ARRENDAMENTO']);
  const cat = j.cmd('categoria.salvar', { campos: { codigo: 'TOURO_JOVEM', nome: 'Tourinho', sexo_aplicavel: 'M', idade_minima_meses: 12, idade_maxima_meses: 30, condicao: 'REPRODUTOR', prioridade: 5, ativo: true } });
  assert.ok(cat.categorias.some((c) => c.codigo === 'TOURO_JOVEM'));
  j.cmd('config.salvar', { valores: { data_marco_zero: D0, importacao_lote_linhas: 50 } });
  const pastoId = { Sede: sede.pasture_id, Rio: rio.pasture_id, 'Arrendado do Zé': arrendado.pasture_id };

  // 3. Importação de 120 animais com mãe e pai, em 3 lotes de 50.
  const arq = arquivo();
  const criado = j.cmd('importacao.criar', { tipo: 'ANIMAIS', arquivo_nome: 'rebanho.csv', texto: arq.texto, formato: { delimitador: ';', codificacao: 'UTF-8', formato_data: 'yyyy-MM-dd', decimal: ',' } });
  assert.equal(criado.total_linhas, 120);
  const mapa = {
    colunas: { Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento', 'Mãe': 'mae', Pai: 'pai', Pasto: 'pasto', Reprodutor: 'reprodutor', Castrado: 'castrado' },
    confiancas: { data_nascimento: 'CONFIRMADA', mae: 'CONFIRMADA', pai: 'ESTIMADA' }, padroes: {},
  };
  let est = null;
  for (let b = 1; b <= 3; b++) est = j.cmd('importacao.validarBloco', { import_id: criado.import_id, bloco: b, mapeamento: mapa });
  assert.equal(est.importacao.status, 'VALIDADO');
  assert.deepEqual([est.contadores.validas, est.contadores.erro, est.contadores.duplicadas], [120, 0, 0], JSON.stringify(est.contadores.por_codigo));
  for (let b = 1; b <= 3; b++) {
    const r = j.api('importacao.importarBloco', { import_id: criado.import_id, bloco: b, modo: 'TOTAL' });
    assert.equal(r.ok, true, 'lote ' + b + ': ' + JSON.stringify(r.error));
  }
  const fim = j.ok('importacao.concluir', { import_id: criado.import_id });
  assert.deepEqual([fim.importacao.status, fim.criados.animais, fim.criados.ativos], ['IMPORTADO', 120, 120]);
  const porBrinco = () => Object.fromEntries(j.tabela('ANIMAIS').filter((a) => a.brinco).map((a) => [a.brinco, a]));
  let A = porBrinco();
  assert.equal(Object.keys(A).length, 120);
  arq.crias.forEach((c) => {
    assert.equal(A[c[0]].mae_id, A[c[3]].animal_id, 'mãe de ' + c[0]);
    assert.equal(A[c[0]].pai_id, A[c[4]].animal_id, 'pai de ' + c[0]);
    assert.equal(A[c[0]].pasto_atual_id, pastoId[c[5]], 'pasto de ' + c[0]);
  });
  assert.deepEqual(js(j.diferencas()), [], 'projeção = reconstrução depois da importação');

  // 4. Correção de cadastro pela ficha: nome (auditoria) + nascimento (evento de correção), na mesma operação.
  const b5 = A.B005;
  const ed = j.cmd('animal.editar', { animal_id: b5.animal_id, campos: { nome: 'Pintada', data_nascimento: '2024-06-20' }, justificativa: 'Data do caderno de partos' });
  assert.ok(ed.event_id, 'nascimento corrigido por evento');
  const ficha = j.ok('animal.ficha', { animal_id: b5.animal_id });
  assert.deepEqual([ficha.geral.nome, ficha.geral.data_nascimento], ['Pintada', '2024-06-20']);
  // Corrigir o sexo de uma vaca que é mãe fere a regra mãe = fêmea (RN-012).
  const sexo = j.api('animal.editar', { animal_id: A.V001.animal_id, campos: { sexo: 'M', castrado: false, reprodutor: false }, justificativa: 'teste' }, { idempotencyKey: 'j-sexo' });
  assert.deepEqual([sexo.ok, sexo.error.code], [false, 'VALIDATION'], JSON.stringify(sexo));

  // 5. Correção de localização: duas crias estavam no Rio, não no pasto registrado.
  const mover = [A.B002, A.B003];
  mover.forEach((a) => assert.notEqual(a.pasto_atual_id, rio.pasture_id));
  const loc = j.cmd('evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO', campos: { event_date: HOJE, justificativa: 'Contagem de campo' }, animais: mover.map((a) => ({ animal_id: a.animal_id, pasto_destino_id: rio.pasture_id })) });
  assert.deepEqual(loc.animais.map((a) => a.pasto_atual_id), mover.map(() => rio.pasture_id));

  // 6. Estorno de uma entrada (doação lançada por engano): animais anulados, brincos livres.
  const doacao = j.cmd('evento.registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-03-10', description: 'Doação' }, animais: [{ brinco: 'D1', sexo: 'F', origem: 'COMPRADO', pasto_destino_id: sede.pasture_id }, { brinco: 'D2', sexo: 'M', castrado: true, reprodutor: false, origem: 'COMPRADO', pasto_destino_id: sede.pasture_id }] });
  const estorno = j.cmd('evento.estornar', { event_id: doacao.event_id, justificativa: 'Doação não aconteceu' });
  assert.deepEqual(estorno.animais.map((a) => a.situacao_cadastral), ['ANULADO', 'ANULADO']);
  const ev = (id) => j.tabela('EVENTOS').find((e) => e.event_id === id);
  assert.equal(ev(doacao.event_id).status, 'ESTORNADO');

  // 7. Substituição de outra entrada: o pasto e o brinco estavam errados; mesmos animal_id.
  const permuta = j.cmd('evento.registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-04-10', description: 'Permuta' }, animais: [{ brinco: 'P1', sexo: 'F', origem: 'COMPRADO', pasto_destino_id: sede.pasture_id }, { brinco: 'P2', sexo: 'F', origem: 'COMPRADO', pasto_destino_id: sede.pasture_id }] });
  const idsPermuta = permuta.animais.map((a) => a.animal_id);
  const sub = j.cmd('evento.corrigir', { event_id: permuta.event_id, justificativa: 'Pasto e brinco trocados', tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-04-10', description: 'Permuta' }, animais: [{ animal_id: idsPermuta[0], brinco: 'P1', sexo: 'F', origem: 'COMPRADO', pasto_destino_id: arrendado.pasture_id }, { animal_id: idsPermuta[1], brinco: 'P3', sexo: 'F', origem: 'COMPRADO', pasto_destino_id: arrendado.pasture_id }] });
  assert.deepEqual(sub.animais.map((a) => [a.animal_id, a.brinco, a.pasto_atual_id]), [[idsPermuta[0], 'P1', arrendado.pasture_id], [idsPermuta[1], 'P3', arrendado.pasture_id]]);
  assert.deepEqual([ev(permuta.event_id).status, ev(sub.event_id).reversal_of_event_id], ['ESTORNADO', permuta.event_id]);
  assert.deepEqual(js(j.diferencas()), [], 'projeção = reconstrução antes do backup');

  // 8. Backup sob demanda.
  const bk = j.ok('sistema.backup', {}).backup;
  assert.equal(bk.motivo, 'SOB_DEMANDA');
  const integra = j.ok('sistema.integridade', {});
  assert.equal(integra.ok, true, JSON.stringify(integra.achados));

  // 9. Adulteração manual: alguém troca o pasto de uma vaca e apaga o efeito de inventário de uma cria.
  const bancoAdulterado = j.banco();
  j.editarCelula('ANIMAIS', 'animal_id', A.V002.animal_id, 'pasto_atual_id', arrendado.pasture_id === A.V002.pasto_atual_id ? sede.pasture_id : arrendado.pasture_id);
  const linhaB10 = j.tabela('EVENTO_ANIMAIS').find((l) => l.animal_id === A.B010.animal_id && l.efeito_inventario === 1);
  j.editarCelula('EVENTO_ANIMAIS', 'event_animal_id', linhaB10.event_animal_id, 'efeito_inventario', 0);
  const adulterado = j.ok('sistema.integridade', {});
  assert.equal(adulterado.ok, false);
  const achadas = adulterado.checagens.filter((c) => c.situacao === 'ERRO').map((c) => c.codigo);
  ['PROJECAO', 'ENTRADA_ABERTA', 'INVENTARIO'].forEach((c) => assert.ok(achadas.includes(c), c + ' em ' + achadas));
  assert.ok(adulterado.achados.some((a) => a.id === A.V002.animal_id), 'aponta a vaca adulterada');
  assert.equal(j.tabela('ANIMAIS').find((a) => a.animal_id === A.V002.animal_id).pasto_atual_id !== A.V002.pasto_atual_id, true, 'a verificação só relata, não corrige');
  // A tela de sistema mostra o backup para restaurar.
  const estado = j.ok('sistema.estado', {});
  assert.ok(estado.backups.some((b) => b.id === bk.id));

  // 10. Restauração do backup: banco novo, versão acima, integridade limpa, o adulterado fica no Drive.
  const vAntes = j.api('sistema.bootstrap', { dataVersion: -1 }).meta.dataVersion;
  const rest = j.ok('sistema.restaurarBackup', { backup_id: bk.id, justificativa: 'Planilha editada à mão' });
  assert.deepEqual([rest.banco_anterior, rest.banco !== bancoAdulterado, rest.integridade.ok], [bancoAdulterado, true, true], JSON.stringify(rest.integridade.achados));
  assert.equal(j.banco(), rest.banco);
  assert.ok(rest.dataVersion > vAntes, 'versão do banco novo acima da última servida');
  const boot = j.ok('sistema.bootstrap', { dataVersion: vAntes });
  assert.equal(boot.atual, false, 'o cliente recarrega');
  // Depois da restauração, a tela de sistema continua mostrando os backups (inclusive o restaurado) e não acusa backup atrasado.
  const estadoDepois = j.ok('sistema.estado', {});
  assert.ok(estadoDepois.backups.some((b) => b.id === bk.id), 'o backup restaurado continua na lista');
  const alertas = j.ok('alerta.listar', {}).alertas.map((a) => a.codigo);
  assert.equal(alertas.includes('BACKUP_ATRASADO'), false, 'backup de minutos atrás não é atrasado: ' + alertas);

  // 11. Estado final: projeção = reconstrução; inventário por pasto coerente em todas as consultas; auditoria completa.
  assert.deepEqual(js(j.diferencas()), [], 'projeção = reconstrução depois da restauração');
  A = porBrinco();
  const ativos = j.tabela('ANIMAIS').filter((a) => a.situacao_cadastral === 'ATIVO');
  assert.equal(ativos.length, 122, '120 importados + 2 da permuta');
  assert.equal(A.V002.pasto_atual_id !== null, true);
  const contagem = {};
  ativos.forEach((a) => { contagem[a.pasto_atual_id] = (contagem[a.pasto_atual_id] || 0) + 1; });
  const pos = j.ok('inventario.posicao', {});
  assert.equal(pos.cabecas, 122);
  assert.equal(pos.sem_pasto, 0);
  assert.deepEqual(Object.fromEntries(pos.por_pasto.map((p) => [p.pasture_id, p.cabecas])), contagem);
  const cartoes = j.ok('pasto.listar', {});
  cartoes.forEach((c) => assert.equal(c.cabecas, contagem[c.pasture_id] || 0, 'cartão ' + c.nome));
  Object.keys(pastoId).forEach((nome) => assert.equal(j.ok('pasto.painel', { pasture_id: pastoId[nome] }).cabecas, contagem[pastoId[nome]] || 0, 'painel ' + nome));
  const dash = j.ok('dashboard.obter', {});
  assert.equal(dash.cabecas, 122);
  const efeitos = j.tabela('EVENTO_ANIMAIS').filter((l) => ['CONFIRMADO'].includes(ev(l.event_id).status)).reduce((s, l) => s + (l.efeito_inventario || 0), 0);
  assert.equal(efeitos, 122, 'Σ efeito dos eventos vigentes = ativos (RN-024)');
  const final = j.ok('sistema.integridade', {});
  assert.equal(final.ok, true, JSON.stringify(final.achados));

  const aud = j.ok('auditoria.listar', { por_pagina: 500 });
  const tem = (f) => aud.itens.some(f);
  assert.ok(tem((a) => a.entidade === 'PROPRIEDADES' && a.acao === 'CRIAR' && a.entity_id === prop.property_id), 'propriedade');
  [sede, rio, arrendado].forEach((p) => assert.ok(tem((a) => a.entidade === 'PASTOS' && a.acao === 'CRIAR' && a.entity_id === p.pasture_id), 'pasto ' + p.nome));
  assert.ok(tem((a) => a.entidade === 'PARCEIROS' && a.entity_id === arr.partner_id), 'parceiro');
  assert.ok(tem((a) => a.entidade === 'CATEGORIAS' && a.acao === 'CRIAR' && a.valor_novo === 'TOURO_JOVEM'), 'categoria');
  assert.ok(tem((a) => a.entidade === 'CONFIGURACOES' && a.entity_id === 'data_marco_zero' && a.valor_novo === D0), 'marco zero');
  assert.ok(tem((a) => a.entidade === 'ANIMAIS' && a.entity_id === b5.animal_id && a.campo === 'nome' && a.valor_novo === 'Pintada' && a.valor_anterior === null), 'nome da ficha');
  assert.ok(tem((a) => a.entidade === 'IMPORTACOES' && a.entity_id === criado.import_id), 'importação');
  assert.ok(tem((a) => a.entidade === 'SISTEMA' && a.acao === 'MANUTENCAO' && /restaurado/.test(a.valor_novo) && a.justificativa === 'Planilha editada à mão'), 'restauração');
  assert.ok(aud.itens.every((a) => a.usuario === 'dono@gmail.com' && /Z$/.test(a.timestamp)), 'quem e quando em toda linha');
  // Todo evento grava ocorrência, registro, usuário, origem e status (RN-111).
  j.tabela('EVENTOS').forEach((e) => {
    assert.ok(e.event_date && e.registration_date && e.created_by === 'dono@gmail.com' && e.source && e.status, 'evento ' + e.event_id + ' completo');
  });
  // Nenhum Date e nenhum segredo: a página de carga inicial serve os 122 ativos.
  const carga = j.ok('sistema.bootstrap', {});
  assert.equal(carga.animais.valores.animal_id.filter((id, i) => carga.animais.valores.situacao_cadastral[i] === 'ATIVO').length, 122);
});
