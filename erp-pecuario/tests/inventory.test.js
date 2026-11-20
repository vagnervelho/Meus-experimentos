'use strict';
/**
 * InventoryService: posição do rebanho hoje e na data D (a partir do marco zero; antes dele null com o motivo),
 * resumo da "Visão geral" e alertas da Fase 1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio-cadastros');

const { ambienteCadastros, bicho, entradaInicial, outraEntrada, PASTOS } = A;

function rebanho(opcoes) {
  const c = ambienteCadastros(opcoes);
  c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'Touro de sêmen', sexo: 'M' } });
  const conf = 'CONFIRMADA';
  c.m.run('registrar', entradaInicial([
    bicho({ brinco: '1', data_nascimento: '2020-01-01', data_nascimento_confianca: conf, partos_previos: 2 }),
    bicho({ brinco: '2', sexo: 'M', data_nascimento: '2025-03-20', data_nascimento_confianca: conf, pasto_destino_id: PASTOS.B }),
    bicho({ data_nascimento: '2026-01-01', data_nascimento_confianca: conf }),
    bicho({ brinco: '4', data_nascimento: '2023-01-01', data_nascimento_confianca: conf }),
  ]));
  c.m.run('registrar', outraEntrada('2026-06-01', [bicho({ brinco: '5', sexo: 'M', data_nascimento: '2024-01-01', data_nascimento_confianca: conf, pasto_destino_id: PASTOS.C })]));
  return c;
}
function posicao(c, dados) {
  return c.ler(c.G.InventoryService.consultaPosicao(dados || {}));
}
function cats(p) {
  return p.por_categoria.map((x) => [x.codigo, x.cabecas]);
}

test('posição hoje: cabeças, por sexo, por pasto, sem pasto e por categoria; igual ao Σ efeito da linha do tempo', () => {
  const c = rebanho();
  const p = posicao(c);
  assert.deepEqual([p.data, p.marco_zero, p.motivo, p.cabecas, p.por_sexo, p.sem_pasto], [A.HOJE, A.D0, null, 5, { M: 2, F: 3 }, 0]);
  assert.deepEqual(p.por_pasto.map((x) => [x.nome, x.cabecas]), [['Pasto A', 3], ['Pasto B', 1], ['Pasto C', 1]]);
  assert.deepEqual(cats(p), [['VACA', 1], ['BEZERRA', 1], ['GARROTE', 1], ['NOVILHO', 1], ['NOVILHA_24_MAIS', 1]], 'em ordem de prioridade');
  assert.equal(p.sem_categoria, 0);
  assert.equal(p.cabecas, c.m.inventario(A.HOJE).total, 'mesmo número do inventário por Σ efeito_inventario');
  assert.deepEqual([p.ua.valor, p.ua.motivo, p.peso_vivo_total.valor], [null, 'DADOS_INSUFICIENTES', null], 'ninguém pesado e sem peso de referência: sem UA, nunca zero');
});

test('posição na data D: a composição e as categorias daquele dia; antes do marco zero null com o motivo', () => {
  const c = rebanho();
  const mar = posicao(c, { data: '2026-03-01' });
  assert.deepEqual([mar.cabecas, mar.por_sexo, mar.sem_pasto, mar.por_pasto.length], [4, { M: 1, F: 3 }, 0, 2], 'o 5 só entrou em 01/06');
  assert.deepEqual(cats(mar), [['VACA', 1], ['BEZERRO', 1], ['BEZERRA', 1], ['NOVILHA_24_MAIS', 1]], 'o garrote de hoje era bezerro em março');
  const d0 = posicao(c, { data: A.D0 });
  assert.equal(d0.cabecas, 4, 'o dia do marco zero já conta o rebanho inicial');
  const antes = posicao(c, { data: '2025-12-31' });
  assert.deepEqual([antes.motivo, antes.cabecas, antes.por_sexo, antes.por_pasto, antes.por_categoria, antes.sem_pasto, antes.ua.valor, antes.ua.motivo],
    ['ANTERIOR_AO_MARCO_ZERO', null, null, null, null, null, null, 'ANTERIOR_AO_MARCO_ZERO']);
  const cinco = c.m.porBrinco('5').animal_id;
  assert.deepEqual(posicao(c, { data: '2026-03-01', animal_id: cinco }), {
    data: '2026-03-01', animal_id: cinco, presente: false, pasture_id: null, situacao: 'AINDA_NAO_ENTROU', no_rebanho_desde: null, no_pasto_desde: null,
    entrada: null, saida: null, sexo: 'M', idade_meses: null, categoria: null, peso: null, motivo: null,
  }, 'o 5 só entrou em 01/06: em março ainda não estava no rebanho');
  assert.deepEqual(posicao(c, { animal_id: cinco }).pasture_id, PASTOS.C);
  const t = (d) => c.gas.tentar(() => c.G.UnitOfWork.read(c.amb.ctx(), c.G.InventoryService.consultaPosicao(d)));
  assert.equal(t({ data: '2026-11-14' }).erro.code, 'VALIDATION', 'data futura');
  assert.equal(t({ data: '2026-02-30' }).erro.code, 'VALIDATION');
  assert.equal(t({ animal_id: A.id(0x404) }).erro.code, 'NOT_FOUND');
  const sem = ambienteCadastros({ marcoZero: null });
  const s = posicao(sem);
  assert.deepEqual([s.motivo, s.cabecas, s.marco_zero], ['DADOS_INSUFICIENTES', null, null], 'sem marco zero não há inventário');
});

test('visão geral: posição de hoje com as pendências do cadastro', () => {
  const c = rebanho();
  const v = c.ler(c.G.InventoryService.consultaVisaoGeral());
  assert.deepEqual([v.cabecas, v.geradoEm, v.pendencias], [5, '2026-11-13T14:00:00.000Z', { sem_pasto: 0, sem_brinco: 1, sem_categoria: 0 }]);
});

test('alertas da Fase 1: sem pasto, sem brinco, sem categoria, backup, integridade e importação incompleta', () => {
  const c = rebanho();
  const alertas = (estado) => c.ler(c.G.InventoryService.consultaAlertas(estado));
  const a0 = alertas(undefined);
  assert.deepEqual(a0.alertas.map((x) => [x.codigo, x.n]), [['SEM_BRINCO', 1]]);
  assert.deepEqual(a0.alertas[0].ids, [c.tabela('ANIMAIS').find((x) => x.situacao_cadastral === 'ATIVO' && !x.brinco).animal_id]);
  assert.deepEqual(a0.nao_avaliados.map((x) => [x.codigo, x.motivo]), [['BACKUP_ATRASADO', 'DADOS_INSUFICIENTES'], ['INTEGRIDADE_COM_ERRO', 'DADOS_INSUFICIENTES']], 'o que não foi informado não é presumido');

  const n24 = c.tabela('CATEGORIAS').find((x) => x.codigo === 'NOVILHA_24_MAIS');
  c.run('Config.comandoSalvarCategoria', { category_id: n24.category_id, campos: { ativo: false } }, { avisos: ['CATEGORIAS_SEM_COBERTURA'] });
  const a1 = alertas({ backup: { ultimo_em: null }, integridade: null });
  assert.deepEqual(a1.alertas.map((x) => [x.codigo, x.nivel]), [['SEM_BRINCO', 'AVISO'], ['SEM_CATEGORIA', 'AVISO'], ['BACKUP_ATRASADO', 'ERRO']]);
  assert.deepEqual(a1.alertas[1].ids, [c.m.porBrinco('4').animal_id], 'a novilha de 24 meses ou mais ficou sem categoria');
  assert.match(a1.alertas[2].mensagem, /Ainda não há nenhuma cópia de segurança/);
  assert.deepEqual(a1.nao_avaliados.map((x) => x.codigo), ['INTEGRIDADE_COM_ERRO']);

  const recente = alertas({ backup: { ultimo_em: '2026-11-12T14:00:00.000Z' }, integridade: { verificado_em: '2026-11-10T06:00:00.000Z', erros: 0 } });
  assert.deepEqual([recente.alertas.some((x) => x.codigo === 'BACKUP_ATRASADO'), recente.alertas.some((x) => x.codigo === 'INTEGRIDADE_COM_ERRO'), recente.nao_avaliados], [false, false, []]);
  const atrasado = alertas({ backup: { ultimo_em: '2026-11-08T14:00:00.000Z' }, integridade: { verificado_em: '2026-11-10T06:00:00.000Z', erros: 3 } });
  const porCodigo = {};
  atrasado.alertas.forEach((x) => { porCodigo[x.codigo] = x; });
  assert.match(porCodigo.BACKUP_ATRASADO.mensagem, /há 5 dias \(o limite é 2\)/);
  assert.match(porCodigo.INTEGRIDADE_COM_ERRO.mensagem, /\(10\/11\/2026\) encontrou 3 problema/);

  c.gas.exec(() => c.G.Database.abrir(c.amb.banco, { primitiva: c.amb.primitiva }).anexar({ IMPORTACOES: [
    { import_id: A.id(0x1a), tipo: 'ANIMAIS', arquivo_nome: 'rebanho.csv', arquivo_hash: 'h1', status: 'IMPORTANDO', modo: 'TOTAL', created_by: 'dono@gmail.com', created_at: '2026-11-13T12:00:00.000Z' },
    { import_id: A.id(0x1b), tipo: 'ANIMAIS', arquivo_nome: 'velho.csv', arquivo_hash: 'h2', status: 'IMPORTADO', modo: 'TOTAL', created_by: 'dono@gmail.com', created_at: '2026-11-01T12:00:00.000Z' },
  ] }));
  const imp = alertas({ backup: { ultimo_em: '2026-11-13T02:00:00.000Z' }, integridade: { erros: 0 } }).alertas.find((x) => x.codigo === 'IMPORTACAO_INCOMPLETA');
  assert.deepEqual([imp.nivel, imp.ids, imp.entidade], ['ERRO', [A.id(0x1a)], 'IMPORTACOES']);
  assert.match(imp.mensagem, /rebanho\.csv\. Retome ou desfaça/);

  // Ativo sem pasto: o catálogo exige pasto na entrada; a pendência aparece quando a planilha é editada à mão (a
  // verificação de integridade acusa a divergência; o alerta mostra a pendência a quem usa).
  const quatro = c.m.porBrinco('4').animal_id;
  c.gas.exec(() => {
    const io = c.G.Database.abrir(c.amb.banco, { primitiva: c.amb.primitiva });
    const lido = io.ler(['ANIMAIS']).ANIMAIS;
    const i = lido.registros.findIndex((x) => x.animal_id === quatro);
    io.atualizar([{ tabela: 'ANIMAIS', linha: lido.linhas[i], campos: { pasto_atual_id: null } }]);
  });
  const semPasto = alertas(undefined).alertas.find((x) => x.codigo === 'ATIVO_SEM_PASTO');
  assert.deepEqual([semPasto.n, semPasto.ids, semPasto.nivel], [1, [quatro], 'AVISO']);
});
