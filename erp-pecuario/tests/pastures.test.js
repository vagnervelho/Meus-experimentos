'use strict';
/**
 * PastureService: propriedade.salvar, pasto.salvar (posse e arrendador), pasto.listar e pasto.painel — peso vigente,
 * UA estimada rotulada, UA/ha e ocupação sem transformar dado ausente em zero (P9), composição em data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio-cadastros');

const { ambienteCadastros, codigos, bicho, entradaInicial, outraEntrada, PASTOS, PROP, js } = A;
const D0 = '2026-10-01';

/** Pasto A com 2 ha e 1,0 UA/ha; três animais em A (dois pesados, um só com peso de referência), um sem peso em C, um em B. */
function lotado() {
  const c = ambienteCadastros({ marcoZero: D0 });
  c.run('PastureService.comandoSalvarPasto', { pasture_id: PASTOS.A, campos: { area_hectares: 2, capacidade_estimada_ua_ha: 1.0 } });
  const n24 = c.tabela('CATEGORIAS').find((x) => x.codigo === 'NOVILHA_24_MAIS');
  c.run('Config.comandoSalvarCategoria', { category_id: n24.category_id, campos: { peso_referencia_kg: 350 } });
  const conf = 'CONFIRMADA';
  const entrada = entradaInicial([
    bicho({ brinco: '0001', data_nascimento: '2023-01-10', data_nascimento_confianca: conf, peso: 450, metodo_pesagem: 'BALANCA' }),
    bicho({ brinco: '0002', sexo: 'M', data_nascimento: '2025-03-20', data_nascimento_confianca: conf, peso: 300, metodo_pesagem: 'BALANCA' }),
    bicho({ brinco: '0003', data_nascimento: '2024-01-15', data_nascimento_confianca: conf }),
    bicho({ brinco: '0004', sexo: 'M', data_nascimento: '2026-05-01', data_nascimento_confianca: conf, pasto_destino_id: PASTOS.C }),
    bicho({ brinco: '0005', data_nascimento: '2022-01-01', data_nascimento_confianca: conf, peso: 500, metodo_pesagem: 'BALANCA', pasto_destino_id: PASTOS.B }),
  ]);
  // O Pasto A fica a 1,22 UA/ha com capacidade de 1,0: a entrada pede confirmação (RN-027 em UA/ha), com a UA do painel.
  const sem = c.m.tentar('registrar', entrada);
  assert.deepEqual([sem.erro.code, codigos(sem.erro)], ['NEEDS_CONFIRMATION', ['LOTACAO_ACIMA_DA_CAPACIDADE']]);
  assert.equal(sem.erro.details[0].mensagem, 'O pasto Pasto A fica com 1,22 UA/ha em 01/10/2026 (3 cabeças, 2,44 UA em 2 ha), acima da capacidade informada (1 UA/ha). Parte da UA é estimada pelo peso de referência da categoria.');
  c.m.run('registrar', entrada, { avisos: ['LOTACAO_ACIMA_DA_CAPACIDADE'] });
  return { c, n24 };
}
function painel(c, dados) {
  return c.ler(c.G.PastureService.consultaPainel(dados));
}
function nomesCat(p) {
  return p.por_categoria.map((x) => [x.codigo, x.cabecas]);
}

test('painel do pasto: composição, peso vivo, UA com a parte estimada rotulada, UA/ha e ocupação', () => {
  const { c } = lotado();
  const p = painel(c, { pasture_id: PASTOS.A });
  assert.deepEqual([p.nome, p.data, p.motivo, p.cabecas, p.machos, p.femeas, p.sem_categoria], ['Pasto A', A.HOJE, null, 3, 1, 2, 0]);
  assert.deepEqual(nomesCat(p), [['GARROTE', 1], ['NOVILHA_24_MAIS', 2]]);
  assert.deepEqual(p.peso_vivo_total, { valor: 1100, motivo: null, n: 3, estimado: true, unidade: 'kg' });
  assert.deepEqual([p.ua.valor, p.ua.n, p.ua.estimado, p.ua.ua_peso_kg, p.ua.sem_peso], [2.44, 3, true, 450, 0]);
  assert.deepEqual(p.ua.partes, { pesada: { cabecas: 2, peso_kg: 750, ua: 1.67 }, estimativa_visual: { cabecas: 0, peso_kg: 0, ua: 0 }, pesagem_vencida: { cabecas: 0, peso_kg: 0, ua: 0 }, sem_pesagem: { cabecas: 1, peso_kg: 350, ua: 0.78 } });
  assert.match(p.ua.rotulo, /UA estimada em parte: 1 cabeça\(s\) sem pesagem, pelo peso de referência da categoria\./);
  assert.deepEqual([p.ua_ha.valor, p.ua_ha.motivo, p.ua_ha.estimado], [1.22, null, true]);
  assert.deepEqual([p.ocupacao_pct.valor, p.ocupacao_pct.base, p.ocupacao_pct.estimado], [122.2, 'UA_HA', true]);
  assert.deepEqual(p.capacidade, { ua_ha: 1, cabecas: null });
  assert.deepEqual(p.animais.map((x) => [x.brinco, x.peso.situacao, x.peso.kg, x.peso.estimado]), [['0001', 'PESADO', 450, false], ['0002', 'PESADO', 300, false], ['0003', 'SEM_PESAGEM', 350, true]]);
  assert.deepEqual(p.parametros, { ua_peso_kg: 450, peso_validade_dias: 180 });

  // Pesagem vencida: o maior entre o último peso e o peso de referência da categoria, marcado como estimado.
  c.run('Config.comandoSalvar', { valores: { peso_validade_dias: 30 } });
  const n24 = c.tabela('CATEGORIAS').find((x) => x.codigo === 'NOVILHA_24_MAIS');
  c.run('Config.comandoSalvarCategoria', { category_id: n24.category_id, campos: { peso_referencia_kg: 480 } });
  const v = painel(c, { pasture_id: PASTOS.A });
  assert.deepEqual(v.animais.map((x) => [x.brinco, x.peso.situacao, x.peso.kg]), [['0001', 'PESAGEM_VENCIDA', 480], ['0002', 'PESAGEM_VENCIDA', 300], ['0003', 'SEM_PESAGEM', 480]]);
  assert.deepEqual([v.ua.partes.pesada.cabecas, v.ua.partes.pesagem_vencida.cabecas, v.ua.partes.pesagem_vencida.peso_kg, v.peso_vivo_total.valor], [0, 2, 780, 1260]);
  assert.match(v.ua.rotulo, /2 com pesagem vencida \(mais de 30 dias\)/);
});

test('painel: dado ausente vira null com motivo, nunca zero; pasto vazio é zero de verdade', () => {
  const { c } = lotado();
  const semPeso = painel(c, { pasture_id: PASTOS.C });
  assert.deepEqual([semPeso.cabecas, semPeso.peso_vivo_total.valor, semPeso.peso_vivo_total.motivo, semPeso.ua.valor, semPeso.ua.motivo, semPeso.ua.sem_peso], [1, null, 'DADOS_INSUFICIENTES', null, 'DADOS_INSUFICIENTES', 1]);
  assert.match(semPeso.ua.rotulo, /1 cabeça\(s\) sem peso ficaram fora da UA/);
  assert.deepEqual([semPeso.ua_ha.valor, semPeso.ua_ha.motivo, semPeso.ocupacao_pct.valor, semPeso.ocupacao_pct.motivo], [null, 'DADOS_INSUFICIENTES', null, 'SEM_VALOR_DE_REFERENCIA']);
  const semArea = painel(c, { pasture_id: PASTOS.B });
  assert.deepEqual([semArea.ua.valor, semArea.ua.estimado, semArea.ua_ha.valor, semArea.ua_ha.motivo, semArea.ocupacao_pct.motivo], [1.11, false, null, 'SEM_VALOR_DE_REFERENCIA', 'SEM_VALOR_DE_REFERENCIA'], 'sem área não há UA/ha; capacidade nunca é deduzida');
  const vazio = painel(c, { pasture_id: PASTOS.PEQUENO });
  assert.deepEqual([vazio.cabecas, vazio.peso_vivo_total.valor, vazio.ua.valor, vazio.ocupacao_pct.valor, vazio.ocupacao_pct.base], [0, 0, 0, 0, 'CABECAS'], 'pasto vazio: zero real; ocupação pela capacidade em cabeças');
});

test('painel em data: composição ao fim do dia D; antes do marco zero tudo null com o motivo', () => {
  const { c } = lotado();
  // O bezerro sem peso nem peso de referência fica fora da UA: o pasto continua a 1,22 UA/ha (acima de 1,0), com 4 cabeças.
  const e = c.m.tentar('registrar', outraEntrada('2026-11-01', [bicho({ brinco: '0006', sexo: 'M', data_nascimento: '2026-08-01', data_nascimento_confianca: 'CONFIRMADA' })]));
  assert.match(e.erro.details[0].mensagem, /^O pasto Pasto A fica com 1,22 UA\/ha em 01\/11\/2026 \(4 cabeças, 2,44 UA em 2 ha\)/);
  c.m.run('registrar', outraEntrada('2026-11-01', [bicho({ brinco: '0006', sexo: 'M', data_nascimento: '2026-08-01', data_nascimento_confianca: 'CONFIRMADA' })]), { avisos: ['LOTACAO_ACIMA_DA_CAPACIDADE'] });
  assert.equal(painel(c, { pasture_id: PASTOS.A }).cabecas, 4);
  const antes = painel(c, { pasture_id: PASTOS.A, data: '2026-10-15' });
  assert.deepEqual([antes.cabecas, antes.data, nomesCat(antes)], [3, '2026-10-15', [['GARROTE', 1], ['NOVILHA_24_MAIS', 2]]]);
  const pre = painel(c, { pasture_id: PASTOS.A, data: '2026-09-01' });
  assert.deepEqual([pre.motivo, pre.cabecas, pre.machos, pre.por_categoria, pre.animais, pre.ua.valor, pre.ua.motivo, pre.ocupacao_pct.motivo], ['ANTERIOR_AO_MARCO_ZERO', null, null, null, null, null, 'ANTERIOR_AO_MARCO_ZERO', 'ANTERIOR_AO_MARCO_ZERO']);
  const t = (d) => c.gas.tentar(() => c.G.UnitOfWork.read(c.amb.ctx(), c.G.PastureService.consultaPainel(d)));
  assert.equal(t({ pasture_id: PASTOS.A, data: '2026-12-01' }).erro.code, 'VALIDATION');
  assert.equal(t({ pasture_id: PASTOS.A, data: '01/10/2026' }).erro.code, 'VALIDATION');
  assert.equal(t({ pasture_id: A.id(0x404) }).erro.code, 'NOT_FOUND');
});

test('lotação: os exemplos conferidos do dicionário (40 ha, 1,2 UA/ha, 23.400 kg) e a falta de capacidade', () => {
  const { c } = lotado();
  const comp = { cabecas: 60, peso_vivo_total: { valor: 23400 }, ua: { valor: 52, motivo: null, n: 60, estimado: false, ua_peso_kg: 450 } };
  const l1 = js(c.G.PastureService.lotacao({ area_hectares: 40, capacidade_estimada_ua_ha: 1.2 }, comp));
  assert.deepEqual([l1.ua_ha.valor, l1.ocupacao_pct.valor, l1.ocupacao_pct.base], [1.3, 108.3, 'UA_HA']);
  assert.deepEqual(l1.acima_da_capacidade, { ua_ha: true, cabecas: null }, '108,3%: o caso que gera o aviso numa transferência (03a, seção 4.2)');
  const l2 = js(c.G.PastureService.lotacao({ area_hectares: 40, capacidade_estimada_cabecas: 55 }, comp));
  assert.deepEqual([l2.ocupacao_pct.valor, l2.ocupacao_pct.base], [109.1, 'CABECAS']);
  assert.deepEqual(l2.acima_da_capacidade, { ua_ha: null, cabecas: true });
  assert.deepEqual(js(c.G.PastureService.lotacao({ area_hectares: 40, capacidade_estimada_ua_ha: 1.3, capacidade_estimada_cabecas: 60 }, comp)).acima_da_capacidade, { ua_ha: false, cabecas: false }, 'no limite exato não passa');
  const l3 = js(c.G.PastureService.lotacao({ area_hectares: 40 }, comp));
  assert.deepEqual([l3.ocupacao_pct.valor, l3.ocupacao_pct.motivo], [null, 'SEM_VALOR_DE_REFERENCIA']);
  const l4 = js(c.G.PastureService.lotacao({ capacidade_estimada_ua_ha: 1.2 }, comp));
  assert.deepEqual([l4.ua_ha.valor, l4.ua_ha.motivo, l4.ocupacao_pct.valor, l4.ocupacao_pct.motivo], [null, 'SEM_VALOR_DE_REFERENCIA', null, 'SEM_VALOR_DE_REFERENCIA']);
});

test('pasto.listar: cartões dos pastos ativos (ou todos), com cabeças, UA, UA/ha e ocupação de hoje', () => {
  const { c } = lotado();
  const l = c.ler(c.G.PastureService.consultaListar());
  assert.deepEqual(l.map((p) => [p.nome, p.cabecas, p.ua.valor, p.posse]), [['Pasto A', 3, 2.44, 'PROPRIO'], ['Pasto B', 1, 1.11, 'PROPRIO'], ['Pasto C', 1, null, 'PROPRIO'], ['Piquete', 0, 0, 'PROPRIO']]);
  assert.ok(l.every((p) => p.animais === undefined), 'a lista não leva os animais');
  assert.equal(c.ler(c.G.PastureService.consultaListar({ incluir_inativos: true })).length, 5);
  assert.equal(c.ler(c.G.PastureService.consultaListar({ property_id: A.id(0x1) })).length, 0);
});

test('pasto.salvar: posse e arrendador, nome único, propriedade imutável, não desativa com animais; AUDITORIA', () => {
  const { c } = lotado();
  const parc = c.run('Config.comandoSalvarParceiro', { campos: { nome: 'João Arrendador', tipos: 'ARRENDADOR' } }).dados;
  const novo = c.run('PastureService.comandoSalvarPasto', { campos: { property_id: PROP, nome: ' Retiro do João ', area_hectares: 15.5, posse: 'ARRENDADO', arrendador_id: parc.partner_id, capacidade_estimada_cabecas: 20 } });
  assert.deepEqual([novo.dados.nome, novo.dados.posse, novo.dados.arrendador_id, novo.dados.status], ['Retiro do João', 'ARRENDADO', parc.partner_id, 'ATIVO']);
  assert.ok(c.auditoria({ entidade: 'PASTOS', entity_id: novo.dados.pasture_id, acao: 'CRIAR' }).length >= 5);
  const card = c.ler(c.G.PastureService.consultaListar()).find((p) => p.pasture_id === novo.dados.pasture_id);
  assert.deepEqual([card.arrendador_nome, card.propriedade_nome, card.cabecas], ['João Arrendador', 'Fazenda Boa Vista', 0]);
  const e1 = c.tentar('PastureService.comandoSalvarPasto', { campos: { property_id: PROP, nome: 'pasto a', posse: 'PROPRIO', arrendador_id: parc.partner_id } });
  assert.deepEqual(codigos(e1.erro).sort(), ['ARRENDADOR_SEM_ARRENDAMENTO', 'NOME_REPETIDO']);
  const e2 = c.tentar('PastureService.comandoSalvarPasto', { campos: { property_id: A.id(0x55), nome: 'Novo', posse: 'ARRENDADO', arrendador_id: A.id(0x56), area_hectares: -3 } });
  assert.deepEqual(codigos(e2.erro).sort(), ['NAO_ENCONTRADO', 'NAO_ENCONTRADO', 'VALOR_FORA_DA_FAIXA']);
  assert.deepEqual(codigos(c.tentar('PastureService.comandoSalvarPasto', { campos: { nome: 'Sem propriedade' } }).erro), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(c.tentar('PastureService.comandoSalvarPasto', { pasture_id: PASTOS.A, campos: { property_id: A.id(0x57) } }).erro), ['CAMPO_IMUTAVEL']);
  const ocupado = c.tentar('PastureService.comandoSalvarPasto', { pasture_id: PASTOS.A, campos: { status: 'INATIVO' } });
  assert.deepEqual(codigos(ocupado.erro), ['PASTO_COM_ANIMAIS']);
  assert.match(ocupado.erro.details[0].mensagem, /3 animal\(is\)/);
  c.run('PastureService.comandoSalvarPasto', { pasture_id: PASTOS.PEQUENO, campos: { status: 'INATIVO', observacoes: 'Cerca caída' } }, { chave: 'k-p' });
  const aud = c.auditoria({ entidade: 'PASTOS', entity_id: PASTOS.PEQUENO, acao: 'ALTERAR' });
  assert.deepEqual(aud.map((x) => [x.campo, x.valor_anterior, x.valor_novo]).sort(), [['observacoes', null, 'Cerca caída'], ['status', 'ATIVO', 'INATIVO']]);
  const dup = c.run('PastureService.comandoSalvarPasto', { pasture_id: PASTOS.PEQUENO, campos: { status: 'INATIVO', observacoes: 'Cerca caída' } }, { chave: 'k-p' });
  assert.equal(dup.duplicado, true);
  assert.deepEqual(codigos(c.tentar('PastureService.comandoSalvarPasto', { pasture_id: novo.dados.pasture_id, campos: { posse: 'PROPRIO' } }).erro), ['ARRENDADOR_SEM_ARRENDAMENTO'], 'mudar para próprio exige tirar o arrendador');
  c.run('PastureService.comandoSalvarPasto', { pasture_id: novo.dados.pasture_id, campos: { posse: 'PROPRIO', arrendador_id: null } });
  assert.equal(c.tabela('PASTOS').find((x) => x.pasture_id === novo.dados.pasture_id).arrendador_id, null);
});

test('propriedade.salvar: a primeira vira a padrão; nome único; não desativa a padrão nem com pastos ativos', () => {
  const c = ambienteCadastros({ config: { propriedade_padrao_id: null } });
  const p2 = c.run('PastureService.comandoSalvarPropriedade', { campos: { nome: 'Sítio Novo', area_total_ha: 120.5, localizacao: 'Ji-Paraná/RO' } });
  const padrao = () => c.lerCom(['CONFIGURACOES'], (tx, G) => G.Config.parametros(tx.repo).propriedade_padrao_id);
  assert.equal(padrao(), p2.dados.property_id, 'sem padrão, a propriedade cadastrada vira a padrão (mesma operação)');
  const p3 = c.run('PastureService.comandoSalvarPropriedade', { campos: { nome: 'Retiro' } });
  assert.equal(padrao(), p2.dados.property_id, 'a padrão não é trocada pelas seguintes');
  assert.deepEqual(codigos(c.tentar('PastureService.comandoSalvarPropriedade', { campos: { nome: 'sítio novo' } }).erro), ['NOME_REPETIDO']);
  assert.deepEqual(codigos(c.tentar('PastureService.comandoSalvarPropriedade', { campos: { descricao: 'sem nome' } }).erro), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(c.tentar('PastureService.comandoSalvarPropriedade', { property_id: p2.dados.property_id, campos: { status: 'INATIVO' } }).erro), ['PROPRIEDADE_PADRAO']);
  assert.deepEqual(codigos(c.tentar('PastureService.comandoSalvarPropriedade', { property_id: PROP, campos: { status: 'INATIVO' } }).erro), ['PROPRIEDADE_COM_PASTOS']);
  c.run('PastureService.comandoSalvarPropriedade', { property_id: p3.dados.property_id, campos: { status: 'INATIVO' } });
  assert.deepEqual(codigos(c.tentar('PastureService.comandoSalvarPasto', { campos: { property_id: p3.dados.property_id, nome: 'X' } }).erro), ['PROPRIEDADE_INATIVA']);
  assert.equal(c.tentar('PastureService.comandoSalvarPropriedade', { property_id: A.id(0x66), campos: { nome: 'x' } }).erro.code, 'NOT_FOUND');
});
