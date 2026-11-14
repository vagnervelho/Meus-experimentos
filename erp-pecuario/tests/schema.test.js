'use strict';
/**
 * Schema gerado × dicionários de dados × desenho-base: as 34 abas, as colunas na ordem, enums, sementes e o
 * gerador (idempotente, e que falha com mensagem clara quando o dicionário diverge).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createGas, ORDENS } = require('./harness');
const gen = require('../scripts/gen-schema');

const gas = createGas({ files: ['Schema.js'] });
const S = gas.G.Schema;
const plano = (v) => JSON.parse(JSON.stringify(v));
const fontes = gen.lerFontes();
const desenho = gen.parseDesenhoBase(fontes.base);

test('34 abas, na ordem e nos grupos do desenho-base', () => {
  const nomes = plano(S.nomesTabelas());
  assert.equal(nomes.length, 34);
  assert.deepEqual(nomes, desenho.ordem);
  const porGrupo = {};
  nomes.forEach((n) => { const g = S.tabela(n).grupo; porGrupo[g] = (porGrupo[g] || 0) + 1; });
  assert.deepEqual(porGrupo, { CADASTROS: 14, EVENTOS: 9, FINANCEIRO: 4, SUPORTE: 7 });
  assert.deepEqual(nomes.slice(0, 3), ['PROPRIEDADES', 'PASTOS', 'ANIMAIS']);
  assert.equal(nomes[33], 'SCHEMA_META');
});

test('colunas de cada aba = lista da seção 3 do desenho-base, na mesma ordem', () => {
  for (const n of desenho.ordem) {
    assert.deepEqual(plano(S.colunas(n)), desenho.colunas[n], 'colunas de ' + n);
    assert.ok(S.colunas(n).length > 0, n + ' sem colunas');
  }
  // Amostras conferidas à mão contra os dicionários.
  assert.equal(S.colunas('ANIMAIS').length, 39);
  assert.equal(S.tabela('ANIMAIS').colunas.filter((c) => c.marca === 'PROJECAO').length, 31);
  assert.deepEqual(plano(S.colunas('PROPRIEDADES')), ['property_id', 'nome', 'descricao', 'localizacao', 'area_total_ha', 'status', 'created_at', 'updated_at']);
  assert.deepEqual(plano(S.colunas('ALOCACOES_FINANCEIRAS')), ['alloc_id', 'rateio_id', 'financial_id', 'animal_id', 'base_valor', 'valor_alocado']);
  assert.ok(S.colunas('PASTOS').includes('posse') && S.colunas('PASTOS').includes('arrendador_id'), 'DV-20: pasto arrendado');
  assert.equal(S.colunas('EVENTOS').length, 25);
  assert.equal(S.colunas('OPERACOES').length, 11);
});

test('cada coluna: tipo, obrigatoriedade e marca conhecidos; uma PK na primeira coluna; ENUM com enum; FK para PK existente', () => {
  let total = 0;
  for (const n of S.nomesTabelas()) {
    const t = S.tabela(n);
    assert.equal(t.colunas[0].pk, true, n + ': PK na primeira coluna');
    assert.equal(t.pk, t.colunas[0].nome);
    assert.equal(t.colunas.filter((c) => c.pk).length, 1, n + ': exatamente uma PK');
    t.colunas.forEach((c, i) => {
      total++;
      const ref = n + '.' + c.nome;
      assert.match(c.nome, /^[a-z][a-z0-9_]*$/, ref);
      assert.ok(S.TIPOS.includes(c.tipo), ref + ': tipo ' + c.tipo);
      assert.ok(S.MARCAS.includes(c.marca), ref + ': marca ' + c.marca);
      assert.ok(['S', 'N', 'COND'].includes(c.obrig), ref + ': obrig ' + c.obrig);
      assert.equal(c.indice, i);
      assert.equal(S.coluna(n, c.nome), c);
      if (c.tipo === 'ENUM') assert.ok(c.enum && S.ENUMS[c.enum], ref + ': ENUM sem enum');
      if (c.enum) assert.ok(S.ENUMS[c.enum].length > 0, ref);
      if (c.valores) c.valores.forEach((v) => assert.ok(S.ENUMS[c.enum].includes(v), ref + ': recorte fora do enum'));
      if (c.fk) {
        assert.equal(c.tipo, 'ID', ref);
        assert.equal(S.tabela(c.fk.tabela).pk, c.fk.coluna, ref + ': FK precisa apontar para a PK');
      }
      if (c.lista) assert.ok(S.ENUMS.NOME_LISTA.includes(c.lista), ref + ': lista ' + c.lista);
      if (c.pk) assert.equal(c.obrig, 'S', ref);
    });
  }
  assert.equal(total, 468);
});

test('tipos e marcas: amostras dos dicionários', () => {
  const c = (t, n) => plano(S.coluna(t, n));
  assert.partialDeepStrictEqual(c('ANIMAIS', 'brinco'), { tipo: 'TEXTO', obrig: 'N', marca: 'PROJECAO' });
  assert.partialDeepStrictEqual(c('ANIMAIS', 'mae_id'), { tipo: 'ID', marca: 'PROJECAO', fk: { tabela: 'ANIMAIS', coluna: 'animal_id' } });
  assert.partialDeepStrictEqual(c('ANIMAIS', 'raca'), { tipo: 'TEXTO', marca: 'CAD', lista: 'RACA' });
  assert.partialDeepStrictEqual(c('ANIMAIS', 'peso_atual'), { tipo: 'DEC1', min: 0, minExclusivo: true });
  assert.partialDeepStrictEqual(c('PASTOS', 'area_hectares'), { tipo: 'DEC4', marca: 'CAD' });
  assert.partialDeepStrictEqual(c('PARCELAS', 'status'), { tipo: 'ENUM', marca: 'CTL', enum: 'STATUS_PARCELA' });
  assert.partialDeepStrictEqual(c('PARCELAS', 'valor'), { tipo: 'DINHEIRO', marca: 'IMUTAVEL', obrig: 'S' });
  assert.partialDeepStrictEqual(c('OPERACOES', 'status'), { tipo: 'ENUM', marca: 'CTL', enum: 'STATUS_OPERACAO' });
  assert.partialDeepStrictEqual(c('OPERACOES', 'resumo_json'), { tipo: 'JSON' });
  assert.partialDeepStrictEqual(c('EVENTOS', 'status'), { tipo: 'ENUM', marca: 'PROJECAO', auto: true, enum: 'STATUS_EVENTO' });
  assert.partialDeepStrictEqual(c('EVENTOS', 'event_date'), { tipo: 'DATA', obrig: 'S', auto: false });
  assert.partialDeepStrictEqual(c('EVENTOS', 'created_at'), { tipo: 'TS', obrig: 'S', auto: true });
  assert.partialDeepStrictEqual(c('EVENTOS', 'partner_id'), { obrig: 'COND', condicao: 'COMPRA, VENDA', fk: { tabela: 'PARCEIROS', coluna: 'partner_id' } });
  assert.partialDeepStrictEqual(c('EVENTOS', 'pre_marco_zero'), { tipo: 'BOOL' });
  assert.partialDeepStrictEqual(c('EVENTO_ANIMAIS', 'efeito_inventario'), { tipo: 'INT', enum: 'EFEITO_INVENTARIO' });
  assert.partialDeepStrictEqual(c('RATEIOS', 'base_total'), { tipo: 'DEC4', min: 0, minExclusivo: false });
  assert.partialDeepStrictEqual(c('COMPRAS', 'rendimento_carcaca_pct'), { tipo: 'DEC1', min: 0, minExclusivo: true, max: 100, maxExclusivo: true });
  assert.partialDeepStrictEqual(c('PLANO_CONTAS', 'grupo'), { marca: 'CAD', travaAposUso: true, enum: 'GRUPO_CONTA' });
  assert.partialDeepStrictEqual(c('PARCEIROS', 'tipos'), { tipo: 'TEXTO', enum: 'TIPO_PARCEIRO', multi: true });
  assert.partialDeepStrictEqual(c('CONFIGURACOES', 'chave'), { tipo: 'TEXTO', pk: true });
  assert.partialDeepStrictEqual(c('SCHEMA_META', 'versao'), { tipo: 'INT', min: 1 });
  // updated_at é controle (DL-02); created_at é imutável.
  assert.equal(S.coluna('PASTOS', 'updated_at').marca, 'CTL');
  assert.equal(S.coluna('PASTOS', 'created_at').marca, 'IMUTAVEL');
});

test('enums fechados: valores do catálogo e recortes por coluna', () => {
  const E = plano(S.ENUMS);
  assert.deepEqual(E.CONFIANCA, ['CONFIRMADA', 'ESTIMADA', 'DESCONHECIDA']);
  assert.deepEqual(E.SEXO, ['M', 'F']);
  assert.deepEqual(E.SITUACAO_CADASTRAL, ['PENDENTE', 'ATIVO', 'VENDIDO', 'MORTO', 'DESCARTADO', 'BAIXADO_AJUSTE', 'HISTORICO', 'EXTERNO', 'ANULADO']);
  assert.equal(E.TIPO_EVENTO.length, 21);
  assert.ok(E.TIPO_EVENTO.includes('ENTRADA_INICIAL') && E.TIPO_EVENTO.includes('ESTORNO') && !E.TIPO_EVENTO.includes('NATIMORTO'));
  assert.deepEqual(E.STATUS_OPERACAO, ['INICIADA', 'CONFIRMADA', 'FALHOU']);
  assert.deepEqual(E.STATUS_EVENTO, ['PENDENTE', 'CONFIRMADO', 'ESTORNADO', 'FALHOU', 'CANCELADO']);
  assert.deepEqual(E.EFEITO_INVENTARIO, [1, 0, -1]);
  assert.equal(E.NOME_LISTA.length, 11);
  assert.deepEqual(E.GRUPO_CONFIGURACAO, ['geral', 'identificacao', 'pecuaria', 'sanidade', 'financeiro', 'alertas', 'avisos', 'sistema']);
  assert.deepEqual(E.CRITERIO_RATEIO, ['DIRETO', 'VALOR_INDIVIDUAL', 'CABECAS', 'PESO_VIVO', 'PESO_CARCACA', 'DIAS_PERMANENCIA', 'MANUAL']);
  assert.deepEqual(E.UNIDADE_PRECO, ['CABECA', 'KG_VIVO', 'ARROBA']);
  assert.deepEqual(E.RESULTADO_DIAGNOSTICO, ['POSITIVO', 'NEGATIVO', 'INCONCLUSIVO']);
  for (const nome of Object.keys(E)) {
    assert.ok(E[nome].length > 0, nome);
    assert.equal(new Set(E[nome]).size, E[nome].length, nome + ' repete valor');
  }
  // Recortes: a compra não rateia por dias de permanência; protocolo não tem DOENCA.
  assert.ok(!S.coluna('COMPRAS', 'criterio_rateio').valores.includes('DIAS_PERMANENCIA'));
  assert.ok(S.coluna('RATEIOS', 'criterio').valores === null);
  assert.deepEqual(plano(S.coluna('PROTOCOLOS_SANITARIOS', 'tipo_procedimento').valores), ['VACINA', 'VERMIFUGO', 'MEDICAMENTO', 'TRATAMENTO', 'EXAME']);
  assert.equal(S.coluna('SANIDADE', 'tipo_procedimento').valores, null);
  // Vocabulários que não são coluna.
  assert.deepEqual(plano(S.VOCABULARIOS.CODIGO_ERRO), ['VALIDATION', 'NEEDS_CONFIRMATION', 'CONFLICT', 'IDEMPOTENCY_MISMATCH', 'LOCKED', 'DENIED', 'NOT_FOUND', 'CONFIG', 'INTERNAL']);
  assert.deepEqual(plano(S.VOCABULARIOS.POLITICA_AVISO), ['BLOQUEIA', 'AVISA', 'IGNORA']);
});

test('enums dependentes: subtipo por tipo de evento e método por fato reprodutivo', () => {
  const sub = plano(S.ENUMS_DEPENDENTES['EVENTOS.event_subtype']);
  assert.equal(sub.por, 'event_type');
  assert.deepEqual(Object.keys(sub.valores), ['SANIDADE', 'REPRODUCAO', 'IDENTIFICACAO', 'MARCACAO', 'AJUSTE_INVENTARIO', 'ESTOQUE']);
  assert.deepEqual(sub.valores.AJUSTE_INVENTARIO, ['CORRECAO_CADASTRO', 'IDENTIFICACAO_INCORRETA', 'RECLASSIFICACAO', 'CORRECAO_LOCALIZACAO', 'DIVERGENCIA_CONTAGEM']);
  assert.deepEqual(sub.valores.ESTOQUE, ['ENTRADA', 'AJUSTE']);
  assert.deepEqual(plano(S.valoresDaColuna('EVENTOS', 'event_subtype', { event_type: 'MARCACAO' })), ['DESCARTE', 'NAO_LOCALIZADO']);
  assert.deepEqual(plano(S.valoresDaColuna('EVENTOS', 'event_subtype', { event_type: 'COMPRA' })), [], 'COMPRA não tem subtipo');
  assert.deepEqual(plano(S.valoresDaColuna('REPRODUCAO', 'metodo', { tipo_evento: 'INSEMINACAO' })), ['IA', 'IATF']);
  assert.deepEqual(plano(S.valoresDaColuna('REPRODUCAO', 'metodo', {})), plano(S.ENUMS.METODO_REPRODUCAO), 'sem a coluna de referência vale o enum inteiro');
  assert.equal(S.valoresDaColuna('EVENTOS', 'notes'), null, 'coluna sem enum');
  for (const v of sub.valores.SANIDADE) assert.ok(S.ENUMS.SUBTIPO_EVENTO.includes(v));
});

test('sementes de CONFIGURACOES: 45 chaves com grupo, tipo e padrão', () => {
  const cfg = plano(S.SEMENTES.CONFIGURACOES);
  assert.equal(cfg.length, 45);
  assert.equal(new Set(cfg.map((c) => c.chave)).size, 45);
  const por = Object.fromEntries(cfg.map((c) => [c.chave, c]));
  const contagem = {};
  cfg.forEach((c) => {
    contagem[c.grupo] = (contagem[c.grupo] || 0) + 1;
    assert.ok(S.ENUMS.GRUPO_CONFIGURACAO.includes(c.grupo), c.chave);
    assert.ok(S.ENUMS.TIPO_CONFIGURACAO.includes(c.tipo), c.chave);
    assert.equal(typeof c.padrao, 'string', c.chave + ': o padrão é texto de célula');
    assert.ok(c.descricao.length > 10, c.chave);
  });
  assert.deepEqual(contagem, { geral: 5, identificacao: 3, pecuaria: 19, sanidade: 2, financeiro: 5, alertas: 5, avisos: 1, sistema: 5 });
  assert.partialDeepStrictEqual(por.fuso, { grupo: 'geral', tipo: 'TEXTO', padrao: 'America/Porto_Velho' });
  assert.partialDeepStrictEqual(por.data_marco_zero, { tipo: 'TEXTO', formato: 'DATA', padrao: '' });
  assert.partialDeepStrictEqual(por.ua_peso_kg, { grupo: 'pecuaria', tipo: 'NUMERO', padrao: '450' });
  assert.partialDeepStrictEqual(por.arroba_kg, { padrao: '15' });
  assert.partialDeepStrictEqual(por.gmd_plausivel_min_kg_dia, { tipo: 'NUMERO', padrao: '-1.0' });
  assert.partialDeepStrictEqual(por.brinco_ignora_zeros_esquerda, { tipo: 'BOOL', padrao: 'S' });
  assert.partialDeepStrictEqual(por.brinco_permite_reuso, { tipo: 'BOOL', padrao: 'N' });
  assert.deepEqual(JSON.parse(por.faixas_etarias_meses.padrao), [12, 24, 36]);
  assert.deepEqual(JSON.parse(por.avisos_politica.padrao), { CARENCIA_ATIVA: 'BLOQUEIA' });
  assert.partialDeepStrictEqual(por.json_celula_max_caracteres, { grupo: 'sistema', padrao: '40000' });
  assert.partialDeepStrictEqual(por.importacao_lote_linhas, { padrao: '200' });
  assert.partialDeepStrictEqual(por.peso_nascer_padrao_kg_macho, { tipo: 'NUMERO', padrao: '' });
});

test('sementes de CATEGORIAS (9) e de PLANO_CONTAS (29)', () => {
  const cats = plano(S.SEMENTES.CATEGORIAS);
  assert.equal(cats.length, 9);
  assert.deepEqual(cats.map((c) => c.codigo), ['TOURO', 'VACA', 'BEZERRO', 'BEZERRA', 'GARROTE', 'NOVILHA_12_24', 'NOVILHO', 'NOVILHA_24_MAIS', 'BOI']);
  assert.deepEqual(cats.map((c) => c.prioridade), [10, 20, 30, 40, 50, 60, 70, 80, 90]);
  assert.deepEqual(cats.find((c) => c.codigo === 'NOVILHO'), {
    codigo: 'NOVILHO', nome: 'Novilho', sexo_aplicavel: 'M', idade_minima_meses: 24, idade_maxima_meses: 36, condicao: 'NAO_REPRODUTOR',
    peso_referencia_kg: null, prioridade: 70, descricao: 'Macho não reprodutor de 24 a 36 meses (boi magro)', ativo: true,
  });
  assert.partialDeepStrictEqual(cats.find((c) => c.codigo === 'TOURO'), { idade_minima_meses: null, idade_maxima_meses: null, condicao: 'REPRODUTOR' });
  assert.partialDeepStrictEqual(cats.find((c) => c.codigo === 'NOVILHA_24_MAIS'), { idade_minima_meses: 24, idade_maxima_meses: null, condicao: 'NAO_PARIDA' });

  const contas = plano(S.SEMENTES.PLANO_CONTAS);
  assert.equal(contas.length, 29);
  assert.equal(new Set(contas.map((c) => c.codigo)).size, 29);
  assert.equal(contas.filter((c) => c.sistema).length, 13, '13 contas que o motor lança sozinho');
  assert.deepEqual(contas.find((c) => c.codigo === 'COMPRA_ANIMAIS'), {
    codigo: 'COMPRA_ANIMAIS', nome: 'Compra de animais', grupo: 'CUSTO_DIRETO', natureza: 'AQUISICAO_ANIMAIS', tipo: 'DESPESA', classe_custo_animal: 'AQUISICAO', sistema: true, ordem: 210, ativo: true,
  });
  assert.partialDeepStrictEqual(contas.find((c) => c.codigo === 'ARRENDAMENTO_PASTO'), { grupo: 'CUSTO_OPERACIONAL', natureza: 'CUSTEIO', ordem: 415 });
  assert.partialDeepStrictEqual(contas.find((c) => c.codigo === 'EMPRESTIMOS'), { natureza: 'NAO_OPERACIONAL', tipo: 'RECEITA' });
  contas.forEach((c) => {
    assert.ok(S.ENUMS.GRUPO_CONTA.includes(c.grupo) && S.ENUMS.NATUREZA_CONTA.includes(c.natureza), c.codigo);
    assert.ok(S.ENUMS.TIPO_LANCAMENTO.includes(c.tipo) && S.ENUMS.CLASSE_CUSTO_ANIMAL.includes(c.classe_custo_animal), c.codigo);
  });
});

test('listas abertas: 11 listas, 69 sementes, códigos reservados', () => {
  const L = plano(S.LISTAS_SEMENTE);
  assert.deepEqual(Object.keys(L), plano(S.ENUMS.NOME_LISTA));
  assert.equal(Object.values(L).reduce((n, l) => n + l.length, 0), 69);
  assert.deepEqual(L.RACA[0], { codigo: 'NELORE', rotulo: 'Nelore', ordem: 10 });
  assert.deepEqual(L.TIPO_PARTO.map((i) => i.codigo), ['NORMAL', 'ASSISTIDO', 'DISTOCICO', 'PREMATURO']);
  assert.deepEqual(L.VIA_APLICACAO.find((i) => i.codigo === 'POUR_ON'), { codigo: 'POUR_ON', rotulo: 'Pour-on (sobre o dorso)', ordem: 40 });
  const reservados = [];
  Object.keys(L).forEach((lista) => L[lista].forEach((i) => {
    assert.match(i.codigo, /^[A-Z][A-Z0-9_]*$/);
    assert.ok(!/reservado/.test(i.rotulo), 'a marca de reservado não fica no rótulo');
    if (i.reservado) reservados.push(lista + '.' + i.codigo);
  }));
  assert.deepEqual(reservados.sort(), ['FINALIDADE_NEGOCIO.ABATE', 'TIPO_DEDUCAO_VENDA.COMISSAO', 'TIPO_DEDUCAO_VENDA.FRETE']);
});

test('consultas: aba, coluna ou enum desconhecido é erro; os dados são imutáveis', () => {
  assert.throws(() => S.tabela('NAO_EXISTE'), /aba desconhecida/);
  assert.throws(() => S.colunas('NAO_EXISTE'), /aba desconhecida/);
  assert.throws(() => S.coluna('PASTOS', 'nao_existe'), /coluna desconhecida: PASTOS\.nao_existe/);
  assert.throws(() => S.enumValores('NAO_EXISTE'), /enum desconhecido/);
  assert.equal(S.temTabela('PASTOS'), true);
  assert.equal(S.temTabela('toString'), false);
  assert.equal(S.temColuna('PASTOS', 'nome'), true);
  assert.equal(S.temColuna('PASTOS', 'constructor'), false);
  assert.equal(S.pk('ANIMAIS'), 'animal_id');
  assert.equal(S.VERSAO, gen.VERSAO);
  assert.equal(typeof S.SEMENTES_VERSAO, 'string');
  assert.ok(Object.isFrozen(S.TABELAS) && Object.isFrozen(S.TABELAS.PASTOS.colunas) && Object.isFrozen(S.coluna('PASTOS', 'nome')));
  assert.ok(Object.isFrozen(S.ENUMS.SEXO) && Object.isFrozen(S.SEMENTES.CONFIGURACOES[0]) && Object.isFrozen(S.LISTAS_SEMENTE.RACA));
  const copia = S.colunas('PASTOS');
  copia.push('intrusa');
  assert.ok(!S.colunas('PASTOS').includes('intrusa'), 'colunas() devolve cópia');
  const nomes = S.nomesTabelas();
  nomes.pop();
  assert.equal(S.nomesTabelas().length, 34);
});

test('o Schema é o mesmo nas duas ordens de carga', () => {
  const [a, b] = ORDENS.map((order) => createGas({ order }).G.Schema);
  assert.equal(JSON.stringify(a.TABELAS), JSON.stringify(b.TABELAS));
  assert.equal(JSON.stringify(a.ENUMS), JSON.stringify(b.ENUMS));
  assert.equal(JSON.stringify(a.SEMENTES), JSON.stringify(b.SEMENTES));
});

test('gerador idempotente: rodar de novo não altera src/Schema.js', () => {
  const noDisco = fs.readFileSync(gen.SAIDA, 'utf8');
  const primeira = gen.gerar();
  assert.equal(primeira, noDisco, 'src/Schema.js está desatualizado: rode npm run gen:schema');
  assert.equal(gen.gerar(), primeira, 'duas gerações seguidas dão o mesmo texto');
  assert.match(noDisco, /ARQUIVO GERADO por scripts\/gen-schema\.js/);
});

test('gerador falha com mensagem clara quando o dicionário diverge', () => {
  const com = (campo, de, para) => {
    assert.ok(fontes[campo].includes(de), 'trecho não encontrado no documento: ' + de);
    return Object.assign({}, fontes, { [campo]: fontes[campo].replace(de, para) });
  };
  // Aba sem a tabela de colunas: não acha as 34.
  assert.throws(() => gen.gerar(com('a', '### 4.2 PASTOS', '### 4.2 Piquetes')), /03a-dicionario-cadastros-suporte\.md, linha \d+: tabela de colunas sem título de aba acima/);
  const semTabela = fontes.b.replace(/(## 5\. PESAGENS[\s\S]*?)\| Coluna \| Tipo \| Obrig\. \| Marca \| Domínio \/ FK \| Descrição \|/, '$1| Campo | Tipo | Obrig. | Marca | Domínio / FK | Descrição |');
  assert.notEqual(semTabela, fontes.b);
  assert.throws(() => gen.gerar(Object.assign({}, fontes, { b: semTabela })), /não achei a tabela de colunas de 1 das 34 abas nos dicionários: PESAGENS/);
  // Coluna renomeada no dicionário: diverge do desenho-base e diz qual.
  assert.throws(() => gen.gerar(com('a', '| `tipo_capim` | TEXTO |', '| `capim` | TEXTO |')), /colunas de PASTOS divergem da seção 3 do desenho-base\. Só no dicionário: capim\. Só no desenho-base: tipo_capim\./);
  // Coluna a menos.
  const linhaPosse = fontes.a.split('\n').find((l) => l.startsWith('| `posse` | ENUM |'));
  assert.throws(() => gen.gerar(com('a', linhaPosse + '\n', '')), /PASTOS divergem.*Só no desenho-base: posse/);
  // Mesmas colunas em outra ordem.
  const linhas = fontes.a.split('\n');
  const i = linhas.findIndex((l) => l.startsWith('| `descricao` | TEXTO | não | `[cad]` | — | Texto livre |'));
  assert.ok(i > 0 && linhas[i + 1].startsWith('| `localizacao`'));
  const trocado = linhas.slice();
  [trocado[i], trocado[i + 1]] = [trocado[i + 1], trocado[i]];
  assert.throws(() => gen.gerar(Object.assign({}, fontes, { a: trocado.join('\n') })), /PROPRIEDADES divergem.*outra ordem/);
  // Tipo desconhecido, marca ilegível e enum inexistente.
  assert.throws(() => gen.gerar(com('a', '| `area_total_ha` | DEC4 |', '| `area_total_ha` | DECIMAL |')), /linha \d+ \(PROPRIEDADES\): tipo de coluna desconhecido: "DECIMAL"/);
  assert.throws(() => gen.gerar(com('a', '| `tipo_capim` | TEXTO | não | `[cad]` |', '| `tipo_capim` | TEXTO | não | editável |')), /\(PASTOS\): marca ilegível: "editável"/);
  assert.throws(() => gen.gerar(com('a', '| POSSE_PASTO; padrão PROPRIO |', '| POSSE_DO_PASTO |')), /PASTOS\.posse: o domínio cita o enum POSSE_DO_PASTO, que não está no catálogo/);
  // FK para coluna que não é PK.
  assert.throws(() => gen.gerar(com('a', '| → `PARCEIROS.partner_id` | Quem cede o pasto', '| → `PARCEIROS.nome` | Quem cede o pasto')), /PASTOS\.arrendador_id: FK para PARCEIROS\.nome/);
  // Aba a mais ou a menos no desenho-base.
  assert.throws(() => gen.gerar(com('base', '- **PASTOS**: ', '- **PIQUETES**: ')), /linha \d+: tabela de colunas sem título de aba acima/);
  const semUma = fontes.base.split('\n').filter((l) => !l.startsWith('- **ERROS_LOG**')).join('\n');
  assert.throws(() => gen.gerar(Object.assign({}, fontes, { base: semUma })), /o grupo SUPORTE anuncia 7 abas e lista 6/);
  // Semente com valor fora do enum e chave de configuração fora do desenho-base.
  assert.throws(() => gen.gerar(com('a', '| 10 | TOURO | Touro | M | — | — | REPRODUTOR |', '| 10 | TOURO | Touro | M | — | — | GARANHAO |')), /semente de categoria TOURO: condicao fora do enum: GARANHAO/);
  assert.throws(() => gen.gerar(com('a', '| geral | `itens_por_pagina` | NUMERO | 50 |', '| geral | `linhas_por_pagina` | NUMERO | 50 |')), /itens_por_pagina está na seção 15\.2 do desenho-base e falta/);
  assert.throws(() => gen.gerar(com('a', '| pecuaria | `ua_peso_kg` | NUMERO | 450 |', '| pecuaria | `ua_peso_kg` | NUMERO | quatrocentos |')), /padrão não numérico na chave ua_peso_kg/);
});
