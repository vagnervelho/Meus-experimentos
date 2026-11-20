'use strict';
/**
 * Config: parâmetros tipados com o padrão do código, config.salvar (tipo, faixa, RN-100, RN-101), lista.salvar,
 * categoria.salvar (cobertura total, RN-097) e parceiro.salvar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio-cadastros');

const { ambienteCadastros, codigos, bicho, entradaInicial, PASTOS, D0 } = A;

function parametros(c) {
  return c.lerCom(['CONFIGURACOES'], (tx, G) => G.Config.parametros(tx.repo));
}

test('parâmetros: tipados, padrão do código sem a aba, célula vazia = null e valor ruim = CONFIG', () => {
  const c = ambienteCadastros({ config: { peso_nascer_padrao_kg_macho: '32.5', fin_bloqueio_ate: '' } });
  const p = parametros(c);
  assert.equal(p.ua_peso_kg, 450);
  assert.equal(p.gmd_plausivel_min_kg_dia, -1);
  assert.equal(p.brinco_ignora_zeros_esquerda, true);
  assert.deepEqual(p.faixas_etarias_meses, [12, 24, 36]);
  assert.equal(p.data_marco_zero, D0);
  assert.equal(p.peso_nascer_padrao_kg_macho, 32.5);
  assert.equal(p.fin_bloqueio_ate, null, 'célula vazia = não informado');
  const semAba = A.js(c.G.Config.parametros(null));
  assert.equal(semAba.ua_peso_kg, 450, 'sem a aba, vale o padrão do código');
  assert.equal(semAba.data_marco_zero, null);
  assert.deepEqual(A.js(c.lerCom(['CONFIGURACOES'], (tx, G) => G.Timeline.parametros(tx.repo))), A.js(p), 'Timeline lê pelo Config');

  const ruim = ambienteCadastros({ config: { ua_peso_kg: 'quatrocentos' } });
  const r = ruim.gas.tentar(() => ruim.G.UnitOfWork.read(ruim.amb.ctx(), { rota: 't', reads: ['CONFIGURACOES'], tratador: (tx) => ruim.G.Config.parametros(tx.repo) }));
  assert.equal(r.ok, false);
  assert.equal(r.erro.code, 'CONFIG');
  const lista = ruim.lerCom(['CONFIGURACOES'], (tx, G) => G.Config.listar(tx.repo));
  const item = lista.itens.find((i) => i.chave === 'ua_peso_kg');
  assert.equal(item.valor, null);
  assert.match(item.erro, /precisa ser um número/, 'a tela de configurações mostra o valor ruim sem quebrar');
  assert.equal(lista.itens.length, 45);
});

test('config.salvar: vários parâmetros numa operação, com AUDITORIA, e o tipo e a faixa conferidos (RN-100)', () => {
  const c = ambienteCadastros();
  const r = c.run('Config.comandoSalvar', { valores: { ua_peso_kg: 400, gmd_aceita_fita: true, faixas_etarias_meses: [12, 24, 36, 48], unidade_peso_exibicao: 'ARROBA', caixa_saldo_inicial: '1500,25' }, justificativa: 'Ajuste do dono' });
  assert.deepEqual(r.dados.chaves.sort(), ['caixa_saldo_inicial', 'faixas_etarias_meses', 'gmd_aceita_fita', 'ua_peso_kg', 'unidade_peso_exibicao']);
  const p = parametros(c);
  assert.deepEqual([p.ua_peso_kg, p.gmd_aceita_fita, p.faixas_etarias_meses, p.unidade_peso_exibicao, p.caixa_saldo_inicial], [400, true, [12, 24, 36, 48], 'ARROBA', 1500.25]);
  const linhas = c.auditoria({ entidade: 'CONFIGURACOES', entity_id: 'ua_peso_kg' });
  assert.equal(linhas.length, 1);
  assert.deepEqual([linhas[0].acao, linhas[0].campo, linhas[0].valor_anterior, linhas[0].valor_novo, linhas[0].justificativa], ['ALTERAR', 'valor', '450', '400', 'Ajuste do dono']);
  const igual = c.run('Config.comandoSalvar', { valores: { ua_peso_kg: '400' } });
  assert.equal(igual.semAlteracao, true, 'valor igual ao atual não grava nada');

  const e = c.tentar('Config.comandoSalvar', {
    valores: {
      ua_peso_kg: 0, itens_por_pagina: 12.5, rendimento_carcaca_padrao_pct: 100, gmd_aceita_fita: 'talvez', chave_inventada: 1,
      faixas_etarias_meses: [24, 12], avisos_politica: { NAO_EXISTE: 'BLOQUEIA' }, peso_validade_dias: '', fin_bloqueio_ate: '31/12/2026',
      unidade_peso_exibicao: 'TONELADA', fuso: 'America/Lugar_Nenhum', propriedade_padrao_id: A.id(0x999),
    },
  });
  assert.equal(e.erro.code, 'VALIDATION');
  const porCampo = {};
  e.erro.details.forEach((d) => { porCampo[d.campo] = d.codigo; });
  assert.deepEqual(porCampo, {
    ua_peso_kg: 'VALOR_FORA_DA_FAIXA', itens_por_pagina: 'VALOR_FORA_DA_FAIXA', rendimento_carcaca_padrao_pct: 'VALOR_FORA_DA_FAIXA',
    gmd_aceita_fita: 'TIPO_INVALIDO', chave_inventada: 'CHAVE_DESCONHECIDA', faixas_etarias_meses: 'FORMATO_INVALIDO',
    avisos_politica: 'FORMATO_INVALIDO', peso_validade_dias: 'CAMPO_OBRIGATORIO', fin_bloqueio_ate: 'FORMATO_INVALIDO',
    unidade_peso_exibicao: 'VALOR_FORA_DA_LISTA', fuso: 'FORMATO_INVALIDO', propriedade_padrao_id: 'NAO_ENCONTRADO',
  });
  assert.equal(parametros(c).ua_peso_kg, 400, 'erro em qualquer parâmetro não grava nenhum');
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvar', { valores: { gmd_plausivel_min_kg_dia: 2.5 } }).erro), ['FAIXA_INVALIDA']);
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvar', { valores: {} }).erro), ['CAMPO_OBRIGATORIO']);
  c.run('Config.comandoSalvar', { valores: { fin_bloqueio_ate: '2026-06-30', avisos_politica: '{"CATEGORIAS_SEM_COBERTURA":"BLOQUEIA"}' } });
  c.run('Config.comandoSalvar', { valores: { fin_bloqueio_ate: null } });
  assert.equal(parametros(c).fin_bloqueio_ate, null, 'parâmetro opcional pode ser apagado');
  assert.deepEqual(parametros(c).avisos_politica, { CATEGORIAS_SEM_COBERTURA: 'BLOQUEIA' });
});

test('config.salvar: marco zero só muda sem movimento de inventário (RN-101) e nunca para o futuro', () => {
  const sem = ambienteCadastros({ marcoZero: null });
  assert.deepEqual(codigos(sem.tentar('Config.comandoSalvar', { valores: { data_marco_zero: '2026-12-01' } }).erro), ['DATA_FUTURA']);
  sem.run('Config.comandoSalvar', { valores: { data_marco_zero: '2026-02-01' } });
  assert.equal(parametros(sem).data_marco_zero, '2026-02-01');
  sem.m.run('registrar', entradaInicial([bicho({ brinco: '1' })]));
  const bloq = sem.tentar('Config.comandoSalvar', { valores: { data_marco_zero: '2026-01-15' } });
  assert.equal(bloq.erro.code, 'CONFLICT');
  assert.equal(bloq.erro.details[0].codigo, 'MARCO_ZERO_EM_USO');
  assert.equal(bloq.erro.details[0].conflito.tipo, 'ENTRADA_INICIAL');
  assert.equal(parametros(sem).data_marco_zero, '2026-02-01');
});

test('config.salvar: parâmetro que entra na projeção reconstrói os animais na mesma operação', () => {
  const c = ambienteCadastros();
  c.m.run('registrar', entradaInicial([
    bicho({ brinco: '10', ref: 'mae', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 2 }),
    bicho({ brinco: '11', sexo: 'M', data_nascimento: '2025-07-01', data_nascimento_confianca: 'CONFIRMADA', mae_ref: 'mae', mae_confianca: 'CONFIRMADA' }),
  ]));
  assert.equal(c.m.porBrinco('10').cria_ao_pe, true, 'cria de 6 meses na entrada, abaixo da desmama padrão (8)');
  c.run('Config.comandoSalvar', { valores: { idade_desmama_padrao_meses: 5 } });
  assert.equal(c.m.porBrinco('10').cria_ao_pe, false, 'com desmama aos 5 meses a cria já entrou desmamada');
});

test('lista.salvar: código derivado e único, edição auditada, código imutável e reservado não desativa', () => {
  const c = ambienteCadastros();
  const novo = c.run('Config.comandoSalvarLista', { lista: 'RACA', rotulo: 'Pé-duro' });
  assert.deepEqual([novo.dados.codigo, novo.dados.rotulo, novo.dados.ativo, typeof novo.dados.ordem], ['PE_DURO', 'Pé-duro', true, 'number']);
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvarLista', { lista: 'RACA', rotulo: 'Pe duro' }).erro), ['CODIGO_REPETIDO']);
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvarLista', { lista: 'RACA', rotulo: 'X', codigo: 'minúsculo' }).erro), ['FORMATO_INVALIDO']);
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvarLista', { lista: 'COR', rotulo: 'Amarelo' }).erro), ['VALOR_FORA_DA_LISTA']);
  const id = novo.dados.lista_id;
  c.run('Config.comandoSalvarLista', { lista_id: id, rotulo: 'Pé-duro (crioulo)', ordem: 5 });
  const aud = c.auditoria({ entidade: 'LISTAS', entity_id: id, acao: 'ALTERAR' });
  assert.deepEqual(aud.map((l) => l.campo).sort(), ['ordem', 'rotulo']);
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvarLista', { lista_id: id, codigo: 'OUTRO', rotulo: 'Y' }).erro), ['CAMPO_IMUTAVEL']);
  const abate = c.tabela('LISTAS').find((l) => l.lista === 'FINALIDADE_NEGOCIO' && l.codigo === 'ABATE');
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvarLista', { lista_id: abate.lista_id, ativo: false }).erro), ['CODIGO_RESERVADO']);
  const nelore = c.tabela('LISTAS').find((l) => l.lista === 'RACA' && l.codigo === 'NELORE');
  c.run('Config.comandoSalvarLista', { lista_id: nelore.lista_id, ativo: false });
  assert.deepEqual(codigos(c.m.tentar('registrar', entradaInicial([bicho({ raca: 'NELORE' })])).erro), ['VALOR_FORA_DA_LISTA'], 'item desativado sai das escolhas');
  assert.equal(c.tentar('Config.comandoSalvarLista', { lista_id: A.id(0x777), rotulo: 'x' }).erro.code, 'NOT_FOUND');
});

test('categoria.salvar: cobertura total com aviso, prioridade única, faixa e condição coerentes, código imutável', () => {
  const c = ambienteCadastros();
  const cats = () => c.tabela('CATEGORIAS');
  const n24 = cats().find((x) => x.codigo === 'NOVILHA_24_MAIS');
  const r = c.tentar('Config.comandoSalvarCategoria', { category_id: n24.category_id, campos: { ativo: false } });
  assert.equal(r.erro.code, 'NEEDS_CONFIRMATION');
  assert.equal(r.erro.details[0].codigo, 'CATEGORIAS_SEM_COBERTURA');
  assert.match(r.erro.details[0].mensagem, /fêmea não parida de 24 a 36 meses; fêmea não parida de 36 meses em diante/);
  assert.equal(cats().find((x) => x.codigo === 'NOVILHA_24_MAIS').ativo, true, 'sem aceite nada é gravado');
  c.run('Config.comandoSalvarCategoria', { category_id: n24.category_id, campos: { ativo: false } }, { avisos: ['CATEGORIAS_SEM_COBERTURA'] });
  assert.equal(cats().find((x) => x.codigo === 'NOVILHA_24_MAIS').ativo, false);
  const resp = c.run('Config.comandoSalvarCategoria', { category_id: n24.category_id, campos: { ativo: true, peso_referencia_kg: 350 } });
  assert.equal(resp.dados.cobertura.completa, true);
  assert.equal(cats().find((x) => x.codigo === 'NOVILHA_24_MAIS').peso_referencia_kg, 350);

  // Trocar faixas de duas categorias juntas, sem passar por um estado sem cobertura.
  const bez = cats().find((x) => x.codigo === 'BEZERRO');
  const gar = cats().find((x) => x.codigo === 'GARROTE');
  const junto = c.tentar('Config.comandoSalvarCategoria', { categorias: [{ category_id: bez.category_id, campos: { idade_maxima_meses: 10 } }, { category_id: gar.category_id, campos: { idade_minima_meses: 10 } }] });
  assert.equal(junto.ok, true, JSON.stringify(junto.erro));
  assert.deepEqual(junto.valor.dados.cobertura.lacunas, []);

  const nova = c.run('Config.comandoSalvarCategoria', { campos: { nome: 'Boi gordo', sexo_aplicavel: 'M', idade_minima_meses: 48, condicao: 'CASTRADO', prioridade: 85 } });
  const criada = nova.dados.categorias.find((x) => x.nome === 'Boi gordo');
  assert.deepEqual([criada.codigo, criada.ativo], ['BOI_GORDO', true]);
  const falhas = c.tentar('Config.comandoSalvarCategoria', { categorias: [
    { category_id: criada.category_id, campos: { codigo: 'OUTRO', prioridade: 10 } },
    { campos: { nome: 'Errada', sexo_aplicavel: 'F', condicao: 'REPRODUTOR', idade_minima_meses: 20, idade_maxima_meses: 12, prioridade: 95 } },
    { campos: { nome: 'Sem dados' } },
  ] });
  assert.deepEqual(codigos(falhas.erro).sort(), ['CAMPO_IMUTAVEL', 'CAMPO_OBRIGATORIO', 'CAMPO_OBRIGATORIO', 'CAMPO_OBRIGATORIO', 'CONDICAO_INCOMPATIVEL', 'FAIXA_INVALIDA', 'PRIORIDADE_REPETIDA'].sort(), 'todos os problemas voltam juntos (a prioridade 10 já é do Touro)');
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvarCategoria', { category_id: criada.category_id, campos: { prioridade: 10 } }).erro), ['PRIORIDADE_REPETIDA']);
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvarCategoria', { campos: { nome: 'Garrote', codigo: 'GARROTE', sexo_aplicavel: 'M', condicao: 'NENHUMA', prioridade: 99 } }).erro), ['CODIGO_REPETIDO']);
});

test('categoria.salvar: política BLOQUEIA transforma a falta de cobertura em erro', () => {
  const c = ambienteCadastros({ config: { avisos_politica: '{"CATEGORIAS_SEM_COBERTURA":"BLOQUEIA"}' } });
  const vaca = c.tabela('CATEGORIAS').find((x) => x.codigo === 'VACA');
  const r = c.tentar('Config.comandoSalvarCategoria', { category_id: vaca.category_id, campos: { ativo: false } }, { avisos: ['CATEGORIAS_SEM_COBERTURA'] });
  assert.equal(r.erro.code, 'VALIDATION');
  assert.deepEqual(codigos(r.erro), ['CATEGORIAS_SEM_COBERTURA']);
});

test('parceiro.salvar: tipos múltiplos, telefone preservado e documento repetido com aviso', () => {
  const c = ambienteCadastros();
  const p = c.run('Config.comandoSalvarParceiro', { campos: { nome: 'Sítio do Arrendador', tipos: ['arrendador', 'FORNECEDOR', 'ARRENDADOR'], telefone: '+55 69 99999-0000', documento: '123.456.789-09' } });
  assert.deepEqual([p.dados.tipos, p.dados.telefone, p.dados.ativo], ['ARRENDADOR,FORNECEDOR', '+55 69 99999-0000', true]);
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvarParceiro', { campos: { nome: 'Sem tipo' } }).erro), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvarParceiro', { campos: { nome: 'X', tipos: 'VIZINHO' } }).erro), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(codigos(c.tentar('Config.comandoSalvarParceiro', { campos: { nome: 'X', tipos: 'OUTRO', cor: 'azul' } }).erro), ['CAMPO_DESCONHECIDO']);
  const dup = c.tentar('Config.comandoSalvarParceiro', { campos: { nome: 'Outro nome', tipos: 'COMPRADOR', documento: '12345678909' } });
  assert.equal(dup.erro.code, 'NEEDS_CONFIRMATION');
  assert.deepEqual(codigos(dup.erro), ['POSSIVEL_DUPLICIDADE']);
  c.run('Config.comandoSalvarParceiro', { campos: { nome: 'Outro nome', tipos: 'COMPRADOR', documento: '12345678909' } }, { avisos: ['POSSIVEL_DUPLICIDADE'] });
  c.run('Config.comandoSalvarParceiro', { partner_id: p.dados.partner_id, campos: { ativo: false } });
  assert.equal(c.tabela('PARCEIROS').find((x) => x.partner_id === p.dados.partner_id).ativo, false);
  const cad = c.lerCom(c.G.Config.LEITURAS_CADASTROS, (tx, G) => G.Config.cadastros(tx.repo));
  assert.deepEqual([cad.parceiros.length, cad.cobertura.completa, cad.configuracoes.itens.length > 40, cad.listas.length > 60, cad.categorias.length], [2, true, true, true, 9]);
  assert.ok(PASTOS.A);
});
