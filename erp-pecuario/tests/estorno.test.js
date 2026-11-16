'use strict';
/**
 * Estorno e substituição de QUALQUER evento ativo (E2.7; desenho-base 4.4 e 16.1; 03b, seção 2.7; 04, seções 3.2, 4.6 e
 * 5; 05, seções 2.6 e 4.3) e os cenários de 09 que dependem dele: CT-07 (estorno anula sem apagar), CT-08 (inventário
 * em qualquer data pelo replay), CT-09 completo pela api(), CT-17 (b) (fato independente no dia da saída =
 * IDENTIFICACAO, na Fase 2) e CT-18 na versão da Fase 2 (compra com a identificação e a transferência). Também a ordem
 * da cadeia de substituição, a trilha de auditoria (auditoria.listar = EVENTOS + AJUSTES + AUDITORIA) e o histórico
 * (evento.listar e evento.obter). Depois de CADA comando o apoio confere projeção gravada = reconstrução e as
 * invariantes financeiras.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./apoio-cadastros');
const S = require('./apoio-sistema');

const { js, D0, PASTOS, bicho, entradaInicial, outraEntrada, ajuste, codigos } = C;

function falha(m, acao, dados, op) {
  const r = m.tentar(acao, dados, op);
  assert.equal(r.ok, false, 'o comando deveria ter sido recusado: ' + JSON.stringify(dados).slice(0, 120));
  return r.erro;
}
function transferencia(data, origem, destino, ids, campos) {
  return { tipo: 'TRANSFERENCIA', campos: Object.assign({ event_date: data, pasto_origem_id: origem, pasto_destino_id: destino }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) };
}
function ident(subtipo, data, animais, campos) {
  return { tipo: 'IDENTIFICACAO', subtipo, campos: Object.assign({ event_date: data, tipo_identificacao: 'BRINCO' }, campos || {}), animais };
}
function marca(subtipo, acao, data, ids, campos) {
  return { tipo: 'MARCACAO', subtipo, campos: Object.assign({ event_date: data, acao }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) };
}
function venda(data, comprador, ids, preco) {
  return { tipo: 'VENDA', campos: { event_date: data, partner_id: comprador, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: preco, valor_bruto: preco * ids.length }, animais: ids.map((animal_id) => ({ animal_id })), parcelas: [{ data_vencimento: data }] };
}
function compra(data, fornecedor, animais, valor, pasto) {
  return { tipo: 'COMPRA', campos: { event_date: data, partner_id: fornecedor, pasto_destino_id: pasto || PASTOS.A, modalidade: 'CABECA', preco_unitario: valor / animais.length, valor_animais: valor }, animais, parcelas: [{ data_vencimento: data }] };
}
/** Rebanho no marco zero (Pasto A): 0101 e 0102 fêmeas adultas, 0103, 0104 e 0105 machos, um bezerro sem brinco; dois parceiros. */
function base() {
  const c = C.ambienteCadastros();
  const m = c.m;
  const r = m.run('registrar', entradaInicial([
    bicho({ brinco: '0101', data_nascimento: '2021-03-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 2 }),
    bicho({ brinco: '0102', data_nascimento: '2021-04-01', data_nascimento_confianca: 'ESTIMADA', partos_previos: 1 }),
    bicho({ brinco: '0103', sexo: 'M', data_nascimento: '2022-01-01', data_nascimento_confianca: 'ESTIMADA' }),
    bicho({ brinco: '0104', sexo: 'M', data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' }),
    bicho({ brinco: '0105', sexo: 'M', data_nascimento: '2023-02-01', data_nascimento_confianca: 'ESTIMADA' }),
    bicho({ sexo: 'M', data_nascimento: '2025-09-01', data_nascimento_confianca: 'CONFIRMADA' }),
  ]));
  const a = r.dados.animais;
  const ids = { f1: a[0].animal_id, f2: a[1].animal_id, m3: a[2].animal_id, m4: a[3].animal_id, m5: a[4].animal_id, bez: a[5].animal_id };
  const parceiro = (nome, tipos) => c.run('Config.comandoSalvarParceiro', { campos: { nome, tipos } }).dados.partner_id;
  const cat = (codigo) => m.linhas.CATEGORIAS.find((x) => x.codigo === codigo).category_id;
  return { c, m, G: c.G, ids, forn: parceiro('Fornecedor', 'FORNECEDOR'), comp: parceiro('Comprador', 'COMPRADOR'), cat };
}
const semCarimbo = (a) => { const o = Object.assign({}, a); delete o.updated_at; return o; };
/** Sanidade e estoque (Fase 3, E3.2 e E3.3): o produto do cadastro (criado uma vez por base) e os lançamentos. */
function produto(x, campos) {
  const k = JSON.stringify(campos || {});
  x.produtos = x.produtos || {};
  if (!x.produtos[k]) x.produtos[k] = x.c.run('HealthService.comandoSalvarProduto', { campos: Object.assign({ nome: 'Vacina ' + (Object.keys(x.produtos).length + 1), categoria: 'VACINA', unidade: 'dose', custo_unitario: 1.85, controla_estoque: false }, campos || {}) }).dados.product_id;
  return x.produtos[k];
}
function san(subtipo, data, animais, campos) {
  return { tipo: 'SANIDADE', subtipo, campos: Object.assign({ event_date: data }, campos || {}), animais };
}
function estoque(subtipo, data, campos) {
  return { tipo: 'ESTOQUE', subtipo, campos: Object.assign({ event_date: data }, campos || {}) };
}
const conta = (x, codigo) => x.m.linhas.PLANO_CONTAS.find((c) => c.codigo === codigo).conta_id;

/**
 * Um caso por tipo e subtipo ativos: o registro, a correção (substituto do mesmo tipo) e, quando há, um evento
 * POSTERIOR que depende dele (o estorno do original é CONFLICT com esse evento e o código esperado). `criados` diz
 * se o evento cria animal (estornado o substituto, o animal fica ANULADO).
 */
const CASOS = [
  { tipo: 'ENTRADA_INICIAL', criados: true,
    registrar: (x) => entradaInicial([bicho({ brinco: '0901' })]),
    corrigir: (x, r) => entradaInicial([bicho({ brinco: '0902', animal_id: r.animais[0].animal_id })]),
    dependente: (x, r) => [transferencia('2026-03-01', PASTOS.A, PASTOS.B, [r.animais[0].animal_id]), 'EVENTO_DEPENDENTE'] },
  { tipo: 'OUTRA_ENTRADA', criados: true,
    registrar: (x) => outraEntrada('2026-02-01', [bicho({ brinco: '0911' })]),
    corrigir: (x, r) => outraEntrada('2026-02-01', [bicho({ brinco: '0912', animal_id: r.animais[0].animal_id })], { description: 'Permuta' }),
    dependente: (x, r) => [marca('DESCARTE', 'MARCAR', '2026-03-01', [r.animais[0].animal_id]), 'EVENTO_DEPENDENTE'] },
  { tipo: 'NASCIMENTO', criados: true,
    registrar: (x) => ({ tipo: 'NASCIMENTO', campos: { event_date: '2026-03-01' }, animais: [{ animal_id: x.ids.f1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }),
    corrigir: (x, r) => ({ tipo: 'NASCIMENTO', campos: { event_date: '2026-03-01' }, animais: [{ animal_id: x.ids.f1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', animal_id: r.animais.find((a) => a.animal_id !== x.ids.f1).animal_id }] }),
    dependente: (x, r) => [ident('PRIMEIRA_IDENTIFICACAO', '2026-04-01', [{ animal_id: r.animais.find((a) => a.animal_id !== x.ids.f1).animal_id, codigo: '0921' }]), 'EVENTO_DEPENDENTE'] },
  { tipo: 'COMPRA', criados: true, financeiro: true,
    registrar: (x) => compra('2026-02-05', x.forn, [{ brinco: '0931', sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 }], 300000),
    corrigir: (x, r) => compra('2026-02-05', x.forn, [{ animal_id: r.animais[0].animal_id, brinco: '0931', sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 }], 310000),
    dependente: (x, r) => [transferencia('2026-03-01', PASTOS.A, PASTOS.B, [r.animais[0].animal_id]), 'EVENTO_DEPENDENTE'] },
  { tipo: 'VENDA', financeiro: true,
    registrar: (x) => venda('2026-06-01', x.comp, [x.ids.m3], 500000),
    corrigir: (x) => venda('2026-06-01', x.comp, [x.ids.m3], 520000),
    dependente: (x) => [compra('2026-07-01', x.forn, [{ animal_id: x.ids.m3 }], 450000), 'ENTRADA_JA_DENTRO'] },
  { tipo: 'TRANSFERENCIA',
    registrar: (x) => transferencia('2026-03-01', PASTOS.A, PASTOS.B, [x.ids.m4]),
    corrigir: (x) => transferencia('2026-03-02', PASTOS.A, PASTOS.B, [x.ids.m4]),
    dependente: (x) => [transferencia('2026-04-01', PASTOS.B, PASTOS.C, [x.ids.m4]), 'ORIGEM_DIVERGENTE'] },
  { tipo: 'MORTE',
    registrar: (x) => ({ tipo: 'MORTE', campos: { event_date: '2026-07-01', causa: 'DOENCA' }, animais: [{ animal_id: x.ids.m5 }] }),
    corrigir: (x) => ({ tipo: 'MORTE', campos: { event_date: '2026-07-01', causa: 'RAIO' }, animais: [{ animal_id: x.ids.m5 }] }),
    // Morte é terminal: nada depois dela depende dela (a morte retroativa com fatos posteriores é CONFLICT; movimentos.test).
    dependente: null },
  { tipo: 'DESCARTE', financeiro: true,
    registrar: (x) => ({ tipo: 'DESCARTE', campos: { event_date: '2026-07-01', destino: 'CONSUMO_PROPRIO', motivo: 'IDADE', receita_valor: 50000 }, animais: [{ animal_id: x.ids.m5 }] }),
    corrigir: (x) => ({ tipo: 'DESCARTE', campos: { event_date: '2026-07-01', destino: 'DOACAO', motivo: 'IDADE' }, animais: [{ animal_id: x.ids.m5 }] }),
    dependente: (x) => [outraEntrada('2026-08-01', [{ animal_id: x.ids.m5, pasto_destino_id: PASTOS.A }], { description: 'Voltou da doação' }), 'ENTRADA_JA_DENTRO'] },
  { tipo: 'PESAGEM',
    registrar: (x) => ({ tipo: 'PESAGEM', campos: { event_date: '2026-03-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: x.ids.f1, peso: 412.5 }, { animal_id: x.ids.m4, peso: 380 }] }),
    corrigir: (x) => ({ tipo: 'PESAGEM', campos: { event_date: '2026-03-02', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: x.ids.f1, peso: 421.5 }, { animal_id: x.ids.m4, peso: 380 }] }),
    // A pesagem é um fato independente: nenhum evento depende dela (a pesagem seguinte é comparada com a anterior que
    // houver, e a do estorno de uma entrada é que impede; pesagem.test).
    dependente: null },
  { tipo: 'IDENTIFICACAO', subtipo: 'PRIMEIRA_IDENTIFICACAO',
    registrar: (x) => ident('PRIMEIRA_IDENTIFICACAO', '2026-03-01', [{ animal_id: x.ids.bez, codigo: '0601' }]),
    corrigir: (x) => ident('PRIMEIRA_IDENTIFICACAO', '2026-03-01', [{ animal_id: x.ids.bez, codigo: '0602' }]),
    dependente: (x) => [ident('REMOCAO', '2026-04-01', [{ animal_id: x.ids.bez, motivo: 'PERDA' }]), 'SEM_IDENTIFICACAO'] },
  { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO',
    registrar: (x) => ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: x.ids.f1, codigo: '1101', motivo: 'PERDA' }]),
    corrigir: (x) => ident('SUBSTITUICAO', '2026-03-01', [{ animal_id: x.ids.f1, codigo: '1102', motivo: 'DANIFICADO' }]),
    dependente: (x) => [ident('REMOCAO', '2026-04-01', [{ animal_id: x.ids.f1, motivo: 'PERDA' }]), 'REMOCAO_DE_OUTRO_CODIGO'] },
  { tipo: 'IDENTIFICACAO', subtipo: 'REMOCAO',
    registrar: (x) => ident('REMOCAO', '2026-03-01', [{ animal_id: x.ids.f1, motivo: 'PERDA' }]),
    corrigir: (x) => ident('REMOCAO', '2026-03-01', [{ animal_id: x.ids.f1, motivo: 'DANIFICADO' }]),
    dependente: (x) => [ident('PRIMEIRA_IDENTIFICACAO', '2026-04-01', [{ animal_id: x.ids.f1, codigo: '1201' }]), 'IDENTIFICACAO_JA_EXISTE'] },
  { tipo: 'MARCACAO', subtipo: 'DESCARTE',
    registrar: (x) => marca('DESCARTE', 'MARCAR', '2026-03-01', [x.ids.f1], { motivo_descarte: 'IDADE' }),
    corrigir: (x) => marca('DESCARTE', 'MARCAR', '2026-03-01', [x.ids.f1], { motivo_descarte: 'DEFEITO' }),
    dependente: (x) => [marca('DESCARTE', 'DESMARCAR', '2026-04-01', [x.ids.f1]), 'NAO_MARCADO'] },
  { tipo: 'MARCACAO', subtipo: 'NAO_LOCALIZADO',
    registrar: (x) => marca('NAO_LOCALIZADO', 'MARCAR', '2026-03-01', [x.ids.f2]),
    corrigir: (x) => marca('NAO_LOCALIZADO', 'MARCAR', '2026-03-03', [x.ids.f2]),
    dependente: (x) => [marca('NAO_LOCALIZADO', 'DESMARCAR', '2026-04-01', [x.ids.f2]), 'NAO_MARCADO'] },
  { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO',
    registrar: (x) => ajuste('CORRECAO_CADASTRO', '2026-03-01', [{ animal_id: x.ids.m3, campo: 'sexo', valor_novo: 'F' }]),
    corrigir: (x) => ajuste('CORRECAO_CADASTRO', '2026-03-01', [{ animal_id: x.ids.f1, campo: 'partos_previos', valor_novo: '4' }]),
    // A correção de sexo fez do 0103 uma fêmea que pariu: estorná-la deixaria um "macho" mãe (RN-012). O parto entra uma
    // vez só, como o parto da matriz (a cria dele é o mesmo lançamento; CONTRATOS, seção 30).
    dependente: (x) => [{ tipo: 'NASCIMENTO', campos: { event_date: '2026-04-01' }, animais: [{ animal_id: x.ids.m3 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }, 'PARTO_DA_MATRIZ'] },
  { tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA',
    registrar: (x) => ajuste('IDENTIFICACAO_INCORRETA', '2026-03-01', [{ animal_id: x.ids.f1, brinco: '0111' }]),
    corrigir: (x) => ajuste('IDENTIFICACAO_INCORRETA', '2026-03-01', [{ animal_id: x.ids.f1, brinco: '0112' }]),
    dependente: (x) => [ident('REMOCAO', '2026-04-01', [{ animal_id: x.ids.f1, motivo: 'PERDA' }]), 'REMOCAO_DE_OUTRO_CODIGO'] },
  { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_LOCALIZACAO',
    registrar: (x) => ajuste('CORRECAO_LOCALIZACAO', '2026-03-01', [{ animal_id: x.ids.m4, pasto_destino_id: PASTOS.B }]),
    corrigir: (x) => ajuste('CORRECAO_LOCALIZACAO', '2026-03-01', [{ animal_id: x.ids.m4, pasto_destino_id: PASTOS.C }]),
    dependente: (x) => [transferencia('2026-04-01', PASTOS.B, PASTOS.A, [x.ids.m4]), 'ORIGEM_DIVERGENTE'] },
  { tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO',
    registrar: (x) => ajuste('RECLASSIFICACAO', '2026-03-01', [{ animal_id: x.ids.m3, categoria_manual_id: x.cat('BOI') }]),
    corrigir: (x) => ajuste('RECLASSIFICACAO', '2026-03-01', [{ animal_id: x.ids.m3, categoria_manual_id: x.cat('TOURO') }]),
    // A categoria manual não é pré-condição de outro evento; o que o estorno dela pode impedir (categoria desativada que
    // voltaria) está em identificacao.test.
    dependente: null },
  // Sanidade: fato independente (nenhum evento depende da aplicação; o que o estorno de uma entrada impede está em
  // sanidade.test). Com produto do cadastro e custo, o consumo é um lançamento CUSTEIO sem parcela, cancelado no estorno.
  { tipo: 'SANIDADE', subtipo: 'VACINACAO', financeiro: true,
    registrar: (x) => san('VACINACAO', '2026-03-01', [{ animal_id: x.ids.f1 }, { animal_id: x.ids.m4 }], { produto_id: produto(x), modo_dose: 'POR_CABECA', dose_referencia: 1, periodo_carencia_dias: 21 }),
    corrigir: (x) => san('VACINACAO', '2026-03-02', [{ animal_id: x.ids.f1 }, { animal_id: x.ids.m4 }], { produto_id: produto(x), modo_dose: 'POR_CABECA', dose_referencia: 2, quantidade_consumida_total: 5, periodo_carencia_dias: 21 }),
    dependente: null },
  { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO',
    registrar: (x) => san('VERMIFUGACAO', '2026-03-01', [{ animal_id: x.ids.m3 }], { nome_produto: 'Ivermectina 1%', modo_dose: 'POR_CABECA', dose_referencia: 5, unidade_dose: 'mL', periodo_carencia_dias: 35 }),
    corrigir: (x) => san('VERMIFUGACAO', '2026-03-01', [{ animal_id: x.ids.m3 }], { nome_produto: 'Ivermectina 1%', modo_dose: 'POR_CABECA', dose_referencia: 6, unidade_dose: 'mL', periodo_carencia_dias: 28 }),
    dependente: null },
  { tipo: 'SANIDADE', subtipo: 'MEDICACAO', financeiro: true,
    registrar: (x) => san('MEDICACAO', '2026-04-01', [{ animal_id: x.ids.f2 }], { produto_id: produto(x, { nome: 'Antibiótico', categoria: 'MEDICAMENTO', unidade: 'mL', custo_unitario: 0.5 }), modo_dose: 'TOTAL', quantidade_consumida_total: 10, custo_valor: 8000, custo_conta_id: conta(x, 'SERVICOS_VETERINARIOS') }),
    corrigir: (x) => san('MEDICACAO', '2026-04-01', [{ animal_id: x.ids.f2 }], { produto_id: produto(x, { nome: 'Antibiótico', categoria: 'MEDICAMENTO', unidade: 'mL', custo_unitario: 0.5 }), modo_dose: 'TOTAL', quantidade_consumida_total: 12, motivo: 'Pneumonia' }),
    dependente: null },
  { tipo: 'SANIDADE', subtipo: 'TRATAMENTO',
    registrar: (x) => san('TRATAMENTO', '2026-04-01', [{ animal_id: x.ids.m5 }], { motivo: 'Casqueamento' }),
    corrigir: (x) => san('TRATAMENTO', '2026-04-02', [{ animal_id: x.ids.m5 }], { motivo: 'Curativo' }),
    dependente: null },
  { tipo: 'SANIDADE', subtipo: 'EXAME',
    registrar: (x) => san('EXAME', '2026-04-01', [{ animal_id: x.ids.f1 }, { animal_id: x.ids.f2 }], { diagnostico: 'Brucelose' }),
    corrigir: (x) => san('EXAME', '2026-04-01', [{ animal_id: x.ids.f1, resultado_exame: 'Negativo' }, { animal_id: x.ids.f2, resultado_exame: 'Negativo' }], { diagnostico: 'Brucelose' }),
    dependente: null },
  { tipo: 'SANIDADE', subtipo: 'DOENCA',
    registrar: (x) => san('DOENCA', '2026-05-01', [{ animal_id: x.ids.m4 }], { diagnostico: 'Tristeza parasitária' }),
    corrigir: (x) => san('DOENCA', '2026-05-01', [{ animal_id: x.ids.m4 }], { diagnostico: 'Tristeza parasitária bovina' }),
    dependente: null },
  // Estoque: sem animais. O estorno da entrada que deixaria o saldo negativo pede confirmação (aviso, não dependente).
  { tipo: 'ESTOQUE', subtipo: 'ENTRADA', financeiro: true,
    registrar: (x) => estoque('ENTRADA', '2026-02-01', { product_id: produto(x, { controla_estoque: true }), quantidade: 100, valor: 18500 }),
    corrigir: (x) => estoque('ENTRADA', '2026-02-01', { product_id: produto(x, { controla_estoque: true }), quantidade: 120, valor: 22200 }),
    dependente: null },
  { tipo: 'ESTOQUE', subtipo: 'AJUSTE',
    registrar: (x) => estoque('AJUSTE', '2026-02-01', { product_id: produto(x, { controla_estoque: true }), motivo_ajuste: 'CONTAGEM', saldo_contado: 10 }),
    corrigir: (x) => estoque('AJUSTE', '2026-02-01', { product_id: produto(x, { controla_estoque: true }), motivo_ajuste: 'CONTAGEM', saldo_contado: 12 }),
    dependente: null },
  { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM',
    registrar: (x) => ajuste('DIVERGENCIA_CONTAGEM', '2026-06-15', [{ animal_id: x.ids.m5 }]),
    corrigir: (x) => ajuste('DIVERGENCIA_CONTAGEM', '2026-06-16', [{ animal_id: x.ids.m5, observacoes: 'Contagem refeita' }]),
    dependente: (x) => [outraEntrada('2026-08-01', [{ animal_id: x.ids.m5, pasto_destino_id: PASTOS.A }], { description: 'Reapareceu' }), 'ENTRADA_JA_DENTRO'] },
];

test('E2.7: todo tipo e subtipo ativo da fase tem caso de estorno e correção (o mecanismo é o mesmo para todos)', () => {
  const G = C.ambienteCadastros().G;
  const ativos = [];
  G.EventCatalog.tiposAtivos().forEach((t) => {
    if (t === 'ESTORNO') return;
    const subs = G.EventCatalog.subtipos(t).filter((s) => G.EventCatalog.ativo(t, s));
    if (!subs.length) ativos.push(t);
    subs.forEach((s) => ativos.push(t + '/' + s));
  });
  assert.deepEqual(CASOS.map((x) => x.tipo + (x.subtipo ? '/' + x.subtipo : '')).sort(), ativos.sort());
});

for (const caso of CASOS) {
  const nome = caso.tipo + (caso.subtipo ? '/' + caso.subtipo : '');
  test('E2.7 ' + nome + ': estorno com evento posterior dependente → CONFLICT com ele; correção anula e substitui num commit; estorno do substituto não ressuscita o original; estorno de estorno e estorno repetido recusados; lançamentos cancelados', () => {
    const x = base();
    const { m } = x;
    const animais0 = m.tabela('ANIMAIS').map(semCarimbo);
    const r = m.run('registrar', caso.registrar(x)).dados;
    const original = r.event_id;
    if (caso.dependente) {
      const [dados, codigo] = caso.dependente(x, r);
      const dep = m.run('registrar', dados).dados;
      const e = falha(m, 'estornar', { event_id: original, justificativa: 'teste de dependente' });
      assert.equal(e.code, 'CONFLICT', nome + ': ' + JSON.stringify(e.details));
      assert.ok(e.details.some((d) => d.codigo === codigo && d.conflito && d.conflito.event_id === dep.event_id), nome + ': esperava ' + codigo + ' com o evento dependente; veio ' + JSON.stringify(e.details.map((d) => [d.codigo, d.conflito && d.conflito.event_id])));
      assert.equal(m.evento(original).status, 'CONFIRMADO', 'nada mudou');
      m.run('estornar', { event_id: dep.event_id, justificativa: 'tirar o dependente' });
    }
    const ops0 = m.tabela('OPERACOES').length;
    const k = m.run('corrigir', Object.assign(caso.corrigir(x, r), { event_id: original, justificativa: 'Lançado com erro' })).dados;
    assert.equal(m.tabela('OPERACOES').length, ops0 + 1, 'um só commit');
    assert.deepEqual([m.evento(original).status, m.evento(original).reversed_by_event_id, m.evento(k.event_id).status, m.evento(k.event_id).reversal_of_event_id, k.substitui],
      ['ESTORNADO', k.event_id, 'CONFIRMADO', original, original]);
    assert.deepEqual([m.evento(k.event_id).event_type, m.evento(k.event_id).event_subtype || null], [caso.tipo, caso.subtipo || null], 'substituto do mesmo tipo');
    if (caso.criados) assert.deepEqual(k.animais.map((a) => a.animal_id).filter((id) => r.animais.some((o) => o.animal_id === id)).length, r.animais.length, 'mesmos animal_id');
    const est = m.run('estornar', { event_id: k.event_id, justificativa: 'Não aconteceu' }).dados;
    assert.deepEqual([m.evento(k.event_id).status, m.evento(original).status, m.evento(est.event_id).event_type, m.evento(est.event_id).event_date], ['ESTORNADO', 'ESTORNADO', 'ESTORNO', '2026-11-13'], 'estornar o substituto não ressuscita o original');
    // De volta ao estado de antes: os animais que já existiam, iguais; os que o evento criou, ANULADOS.
    const depois = m.tabela('ANIMAIS').map(semCarimbo);
    animais0.forEach((a) => assert.deepEqual(depois.find((b) => b.animal_id === a.animal_id), a, nome + ': ' + a.codigo_interno + ' volta ao que era'));
    depois.filter((a) => !animais0.some((b) => b.animal_id === a.animal_id)).forEach((a) => assert.equal(a.situacao_cadastral, 'ANULADO'));
    if (caso.financeiro) {
      const fins = m.tabela('FINANCEIRO').filter((f) => f.event_id === original || f.event_id === k.event_id);
      // 03b, seção 10.4: o lançamento sem parcela (o consumo de insumo) fica SEM_CAIXA mesmo cancelado; com parcela, CANCELADO.
      const comParcela = (f) => m.tabela('PARCELAS').some((p) => p.financial_id === f.financial_id);
      assert.ok(fins.length > 0 && fins.every((f) => f.status === 'CANCELADO' && f.status_pagamento === (comParcela(f) ? 'CANCELADO' : 'SEM_CAIXA')), nome + ': lançamentos do original e do substituto cancelados');
    }
    assert.deepEqual(codigos(falha(m, 'estornar', { event_id: k.event_id, justificativa: 'de novo' })), ['JA_ANULADO']);
    assert.deepEqual(codigos(falha(m, 'estornar', { event_id: original, justificativa: 'de novo' })), ['JA_ANULADO']);
    assert.deepEqual(codigos(falha(m, 'estornar', { event_id: est.event_id, justificativa: 'estorno do estorno' })), ['ESTORNO_NAO_SE_ESTORNA']);
    assert.deepEqual(codigos(falha(m, 'corrigir', Object.assign(caso.corrigir(x, r), { event_id: k.event_id, justificativa: 'x' }))), ['JA_ANULADO']);
  });
}

// ------------------------------------------------------------------ CT-07 ----
test('CT-07: estorno da transferência anula sem apagar (linhas idênticas, salvo os caches), devolve os 3 ao Pasto 1; estornar de novo e estornar o estorno → VALIDATION; com transferência posterior → CONFLICT; estorno de entrada sem outros eventos → ANULADO, brinco liberado; a auditoria mostra o estorno', () => {
  const c = C.ambienteCadastros();
  const m = c.m;
  const ent = m.run('registrar', entradaInicial(['0701', '0702', '0703'].map((b) => bicho({ brinco: b }))));
  const ids = ent.dados.animais.map((a) => a.animal_id);
  const e1 = m.run('registrar', transferencia('2026-04-10', PASTOS.A, PASTOS.B, ids)).dados.event_id;
  assert.equal(m.inventario('2026-04-15').porPasto[PASTOS.B], 3);
  const mat = (aba) => js(m.gas.planilhas.matriz(m.amb.banco, aba));
  const cab = mat('EVENTOS')[0];
  const linhaEv = (id) => mat('EVENTOS').find((l) => l[cab.indexOf('event_id')] === id);
  const linhasEA = () => mat('EVENTO_ANIMAIS').filter((l) => l.includes(e1));
  const evAntes = linhaEv(e1);
  const eaAntes = linhasEA();
  assert.equal(eaAntes.length, 3);
  const e2 = m.run('estornar', { event_id: e1, justificativa: 'pasto errado' }).dados;
  // Localização: os 3 voltam ao Pasto 1; a posição de 15/04 passa a Pasto 1 = 3.
  assert.deepEqual(ids.map((id) => m.animal(id).pasto_atual_id), [PASTOS.A, PASTOS.A, PASTOS.A]);
  const pos = c.ler(c.G.InventoryService.consultaPosicao({ data: '2026-04-15' }));
  assert.deepEqual(pos.por_pasto.map((p) => [p.pasture_id, p.cabecas]), [[PASTOS.A, 3]]);
  // Original preservado célula a célula, salvo status e reversed_by_event_id (caches).
  const evDepois = linhaEv(e1);
  cab.forEach((col, i) => {
    if (col === 'status') assert.deepEqual([evAntes[i], evDepois[i]], ['CONFIRMADO', 'ESTORNADO']);
    else if (col === 'reversed_by_event_id') assert.deepEqual([evAntes[i], evDepois[i]], ['', e2.event_id]);
    else assert.deepEqual(evDepois[i], evAntes[i], 'EVENTOS.' + col + ' não muda');
  });
  assert.deepEqual(linhasEA(), eaAntes, 'as 3 linhas de EVENTO_ANIMAIS idênticas');
  const est = m.evento(e2.event_id);
  assert.deepEqual([est.event_type, est.reversal_of_event_id, est.event_date, est.registration_date, est.total_value || null, est.payload_json.justificativa],
    ['ESTORNO', e1, '2026-11-13', '2026-11-13', null, 'pasto errado']);
  assert.deepEqual(m.tabela('EVENTO_ANIMAIS').filter((l) => l.event_id === e2.event_id), [], 'ESTORNO sem linha filha (efeito 0)');
  // Auditoria: o estorno aparece com quem, quando e o motivo.
  const aud = c.ler(c.G.AuditService.consultaListar({ entity_id: e1 }));
  const item = aud.itens.find((a) => a.event_id === e2.event_id);
  assert.deepEqual([item.origem, item.acao, item.usuario, item.registration_date, item.justificativa, item.reversal_of_event_id, item.descricao],
    ['EVENTO', 'ESTORNAR', 'dono@gmail.com', '2026-11-13', 'pasto errado', e1, 'Estorno de: Transferir de pasto de 10/04/2026']);
  assert.ok(aud.itens.some((a) => a.event_id === e1 && a.acao === 'REGISTRAR' && a.status === 'ESTORNADO' && a.vigente === false), 'o original continua na trilha');
  // Passo 3: estornar E1 de novo; estornar E2.
  const p3a = falha(m, 'estornar', { event_id: e1, justificativa: 'de novo' });
  const p3b = falha(m, 'estornar', { event_id: e2.event_id, justificativa: 'estorno do estorno' });
  assert.deepEqual([p3a.code, codigos(p3a), p3b.code, codigos(p3b)], ['VALIDATION', ['JA_ANULADO'], 'VALIDATION', ['ESTORNO_NAO_SE_ESTORNA']]);
  // Passo 4a: E1' com transferência posterior do 0701 → CONFLICT listando a posterior.
  const e1b = m.run('registrar', transferencia('2026-04-10', PASTOS.A, PASTOS.B, ids)).dados.event_id;
  const posterior = m.run('registrar', transferencia('2026-05-01', PASTOS.B, PASTOS.C, [ids[0]])).dados.event_id;
  const p4 = falha(m, 'estornar', { event_id: e1b, justificativa: 'teste' });
  assert.deepEqual([p4.code, p4.details.map((d) => [d.codigo, d.brinco, d.conflito.event_id, d.conflito.data])], ['CONFLICT', [['ORIGEM_DIVERGENTE', '0701', posterior, '2026-05-01']]]);
  // A simulação do estorno (revisão pelo servidor) lista o mesmo bloqueio, sem gravar.
  const sim = m.simular('estornar', { event_id: e1b, justificativa: 'teste' });
  assert.deepEqual([sim.ok, sim.erro.code, sim.erro.details], [false, 'CONFLICT', p4.details]);
  // Passo 4b: entrada de animal sem outros eventos → ANULADO, com o brinco liberado.
  const so = m.run('registrar', outraEntrada('2026-02-01', [bicho({ brinco: '0709' })])).dados;
  m.run('estornar', { event_id: so.event_id, justificativa: 'Lançado por engano' });
  assert.deepEqual([m.animal(so.animais[0].animal_id).situacao_cadastral, m.animal(so.animais[0].animal_id).brinco || null], ['ANULADO', null]);
  assert.equal(m.run('registrar', outraEntrada('2026-02-02', [bicho({ brinco: '0709' })])).dados.animais[0].brinco, '0709');
});

// ------------------------------------------------------------------ CT-08 ----
test('CT-08: inventário em qualquer data pelo replay (D0 com 100: 60 + 40; 2 nascimentos; 10 transferidos; 5 vendidos; 1 morte); venda estornada recalcula o passado; reconstrução = gravado', () => {
  const c = C.ambienteCadastros();
  const m = c.m;
  const animais = [];
  for (let i = 1; i <= 100; i++) animais.push(bicho({ brinco: String(800 + i), sexo: i % 2 ? 'F' : 'M', pasto_destino_id: i <= 60 ? PASTOS.A : PASTOS.B, data_nascimento: '2022-01-01', data_nascimento_confianca: 'ESTIMADA' }));
  const ent = m.run('registrar', entradaInicial(animais)).dados.animais;
  const noA = ent.filter((a, i) => i < 60).map((a) => a.animal_id);
  const noB = ent.filter((a, i) => i >= 60).map((a) => a.animal_id);
  const femeasA = ent.filter((a, i) => i < 60 && a.sexo === 'F').map((a) => a.animal_id);
  m.run('registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-01-15' }, animais: [{ animal_id: femeasA[0] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] });
  m.run('registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-01-15' }, animais: [{ animal_id: femeasA[1] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M' }] });
  const transf = noA.slice(10, 20);
  m.run('registrar', transferencia('2026-02-01', PASTOS.A, PASTOS.B, transf));
  const comp = c.run('Config.comandoSalvarParceiro', { campos: { nome: 'Comprador', tipos: 'COMPRADOR' } }).dados.partner_id;
  const v = m.run('registrar', venda('2026-02-20', comp, noB.slice(0, 5), 400000)).dados.event_id;
  m.run('registrar', { tipo: 'MORTE', campos: { event_date: '2026-03-10', causa: 'DOENCA' }, animais: [{ animal_id: noA[30] }] });
  const posicao = (data) => c.ler(c.G.InventoryService.consultaPosicao({ data }));
  const resumo = (data) => { const p = posicao(data); const por = Object.fromEntries((p.por_pasto || []).map((x) => [x.pasture_id, x.cabecas])); return [p.cabecas, por[PASTOS.A] || 0, por[PASTOS.B] || 0, p.motivo]; };
  const antes = posicao('2025-12-31');
  assert.deepEqual([antes.cabecas, antes.motivo], [null, 'ANTERIOR_AO_MARCO_ZERO']);
  assert.deepEqual(resumo('2026-01-31'), [102, 62, 40, null]);
  assert.deepEqual(resumo('2026-02-15'), [102, 52, 50, null], 'transferência não muda o total');
  assert.deepEqual(resumo('2026-03-31'), [96, 51, 45, null], '100 + 2 − 5 − 1');
  m.run('estornar', { event_id: v, justificativa: 'Venda desfeita' });
  assert.deepEqual(resumo('2026-03-31'), [101, 51, 50, null], 'estornada a venda, o passado é recalculado');
  assert.deepEqual(resumo('2026-01-31'), [102, 62, 40, null]);
  // A reconstrução total produz ANIMAIS idêntico ao gravado (o apoio confere depois de cada comando; aqui, por uma
  // recuperação completa, que reconstrói tudo).
  const gravado = m.tabela('ANIMAIS').map(semCarimbo);
  m.amb.recoverAll();
  assert.deepEqual(m.tabela('ANIMAIS').map(semCarimbo), gravado);
  m.conferirProjecoes('CT-08');
});

// ------------------------------------------------------------------ CT-09 (pela api) ----
test('CT-09 completo pela api(): saídas, brinco do vendido (" 0901 " e "901"), mãe, pasto, data e reentrada; cada recusa sem gravar nada e sem consumir a chave', () => {
  const s = S.sistema({ config: { data_marco_zero: '2025-01-01' } });
  const G = s.G;
  const api = (rota, dados, chave) => js(s.gas.exec(() => G.api({ rota, dados, idempotencyKey: chave, avisosAceitos: [] })));
  const ok = (rota, dados, chave) => { const r = api(rota, dados, chave); assert.equal(r.ok, true, rota + ': ' + JSON.stringify(r.error)); return r.data; };
  const ent = ok('evento.registrar', S.entradaInicial([
    S.bicho({ brinco: '0901', sexo: 'M', castrado: true, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '0902', data_nascimento: '2022-05-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '0903', data_nascimento: '2024-12-20', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '0904', sexo: 'M', data_nascimento: '2022-05-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '0905', ref: 'm5', partos_previos: 2 }),
    S.bicho({ brinco: '0906', ref: 'm6', mae_ref: 'm5', mae_confianca: 'CONFIRMADA', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA' }),
    S.bicho({ brinco: '0907', mae_ref: 'm6', mae_confianca: 'CONFIRMADA', data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' }),
  ]), 'ct09-massa');
  const id = Object.fromEntries(ent.animais.map((a) => [a.brinco, a.animal_id]));
  const comp = ok('parceiro.salvar', { campos: { nome: 'Comprador do CT-09', tipos: ['COMPRADOR', 'FORNECEDOR'] } }, 'ct09-p').partner_id;
  ok('evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-09-05', causa: 'DOENCA' }, animais: [{ animal_id: id['0902'] }] }, 'ct09-morte');
  ok('evento.registrar', venda('2026-10-02', comp, [id['0901']], 400000), 'ct09-venda');
  const outra = (data, a) => ({ tipo: 'OUTRA_ENTRADA', campos: { event_date: data, description: 'Teste CT-09' }, animais: [a] });
  const corr = (campo, valor) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-11-13', justificativa: 'CT-09' }, animais: [{ animal_id: id['0905'], campo, valor_novo: valor }, { animal_id: id['0905'], campo: 'mae_confianca', valor_novo: 'ESTIMADA' }] });
  const tentativas = [
    ['1', venda('2026-11-13', comp, [id['0901']], 400000), 'FORA_DO_REBANHO', id['0901']],
    ['2', transferencia('2026-11-13', S.PASTOS.A, S.PASTOS.B, [id['0902']]), 'APOS_MORTE', id['0902']],
    ['3a', outra('2026-11-13', S.bicho({ brinco: ' 0901 ' })), 'BRINCO_DUPLICADO', null],
    ['3b', outra('2026-11-13', S.bicho({ brinco: '901' })), 'BRINCO_DUPLICADO', null],
    ['3c', ident('SUBSTITUICAO', '2026-11-13', [{ animal_id: id['0903'], codigo: '0901', motivo: 'PERDA' }]), 'BRINCO_DUPLICADO', id['0903']],
    ['4', outra('2026-11-13', S.bicho({ brinco: '0910', mae_id: id['0904'], mae_confianca: 'CONFIRMADA' })), 'SEXO_DO_PROGENITOR', null],
    ['5', outra('2026-11-13', S.bicho({ brinco: '0911', mae_id: id['0903'], mae_confianca: 'CONFIRMADA', data_nascimento: '2024-09-12', data_nascimento_confianca: 'CONFIRMADA' })), 'NASCIMENTO_DO_PROGENITOR', null],
    ['6', corr('mae_id', id['0905']), 'PROPRIO_PROGENITOR', id['0905']],
    ['7', corr('mae_id', id['0907']), 'CICLO_GENEALOGICO', id['0905']],
    ['8a', outra('2026-11-13', S.bicho({ brinco: '0912', pasto_destino_id: S.id(0xdead) })), 'NAO_ENCONTRADO', null],
    ['9', outra('2026-11-14', S.bicho({ brinco: '0914' })), 'DATA_FUTURA', null],
    ['10a', compra('2026-10-01', comp, [{ animal_id: id['0901'] }], 400000, S.PASTOS.A), 'ENTRADA_JA_DENTRO', id['0901']],
  ];
  for (const [n, dados, codigo, animal] of tentativas) {
    const antes = Object.fromEntries(G.Schema.nomesTabelas().map((t) => [t, JSON.stringify(s.tabela(t))]));
    const v0 = s.props()['DATA_VERSION:' + s.banco()];
    const chave = 'ct09-' + n;
    const r = api('evento.registrar', dados, chave);
    assert.equal(r.ok, false, n);
    assert.equal(r.error.code, 'VALIDATION', n + ': ' + JSON.stringify(r.error));
    assert.ok(r.error.details.some((d) => d.codigo === codigo), n + ': esperava ' + codigo + '; veio ' + r.error.details.map((d) => d.codigo).join(', '));
    assert.ok(r.error.details.every((d) => d.codigo && d.mensagem && (d.campo || d.brinco || d.animal_id)), n + ': detalhe por animal e campo');
    if (animal) assert.ok(r.error.details.some((d) => d.animal_id === animal), n + ': detalhe aponta o animal');
    if (n === '7') assert.match(JSON.stringify(r.error.details), /→/, 'o ciclo vem com o caminho');
    Object.keys(antes).forEach((t) => assert.equal(JSON.stringify(s.tabela(t)), antes[t], n + ': a aba ' + t + ' não muda'));
    assert.equal(s.props()['DATA_VERSION:' + s.banco()], v0, n + ': a versão não muda');
    assert.equal(api('operacao.status', { chave }, 'st-' + n).data.situacao, 'INEXISTENTE', n + ': a chave não foi consumida');
  }
  // 3c: o brinco do vendido pela identificação, no animal sem brinco: o 0901 vendido continua dono do número.
  const semBrinco = ok('evento.registrar', S.entradaInicial([S.bicho({ data_nascimento: '2024-01-01', data_nascimento_confianca: 'ESTIMADA' })]), 'ct09-sem-brinco').animais[0].animal_id;
  const r3 = api('evento.registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-11-13', [{ animal_id: semBrinco, codigo: '0901' }]), 'ct09-3d');
  assert.deepEqual([r3.ok, r3.error.details.map((d) => d.codigo)], [false, ['BRINCO_DUPLICADO']]);
  assert.match(r3.error.details[0].mensagem, /vendido em 02\/10\/2026/);
  // 10b: a mesma compra datada de 13/11/2026 é reentrada, com o mesmo animal_id.
  const volta = ok('evento.registrar', compra('2026-11-13', comp, [{ animal_id: id['0901'] }], 400000, S.PASTOS.A), 'ct09-10b');
  assert.deepEqual([volta.animais[0].animal_id, volta.animais[0].situacao_cadastral, volta.animais[0].brinco], [id['0901'], 'ATIVO', '0901']);
  s.conferirProjecoes('CT-09');
});

// ------------------------------------------------------------------ CT-17 (b) ----
test('CT-17 (b): lote vendido em 20/06 — a identificação de 20/06 é aceita (o dia da saída conta), a de 21/06 é VALIDATION, a transferência de 20/06 é CONFLICT com a venda', () => {
  const x = base();
  const { m, ids, comp } = x;
  const v = m.run('registrar', venda('2026-06-20', comp, [ids.m3, ids.m4], 500000)).dados.event_id;
  const ok = m.run('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-06-20', [{ animal_id: ids.m3, codigo: 'BR-1' }, { animal_id: ids.m4, codigo: 'BR-2' }], { tipo_identificacao: 'SISBOV' }));
  assert.equal(ok.dados.animais.length, 2);
  const e = falha(m, 'registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-06-21', [{ animal_id: ids.m3, codigo: '777' }], { tipo_identificacao: 'RFID' }));
  assert.deepEqual([e.code, codigos(e), e.details[0].animal_id], ['VALIDATION', ['FORA_DA_PERMANENCIA'], ids.m3]);
  const t = falha(m, 'registrar', transferencia('2026-06-20', PASTOS.A, PASTOS.B, [ids.m3]));
  assert.equal(t.code, 'CONFLICT');
  assert.deepEqual(t.details.map((d) => [d.codigo, d.conflito.event_id, d.conflito.tipo]), [['ORIGEM_DIVERGENTE', v, 'VENDA']]);
  // E a venda estornada com a identificação do dia dela: a identificação não depende da saída (segue dentro da permanência).
  m.run('estornar', { event_id: v, justificativa: 'Venda desfeita' });
  assert.deepEqual([m.animal(ids.m3).situacao_cadastral, m.evento(ok.dados.event_id).status], ['ATIVO', 'CONFIRMADO']);
});

// ------------------------------------------------------------------ CT-18 (Fase 2) ----
test('CT-18 na Fase 2: compra de 3 com identificação (SISBOV) em 12/02 e transferência em 01/03; corrigir o brinco 0802 → 0812 mantém os animal_id e os eventos posteriores; tirar o 0803 → CONFLICT com a identificação e a transferência', () => {
  const x = base();
  const { m, forn } = x;
  const garrote = (b) => ({ brinco: b, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 });
  const dados = compra('2026-02-05', forn, ['0801', '0802', '0803'].map(garrote), 900000);
  const r = m.run('registrar', dados).dados;
  const ids = r.animais.map((a) => a.animal_id);
  const codigosInt = ids.map((id) => m.animal(id).codigo_interno);
  const iden = m.run('registrar', ident('PRIMEIRA_IDENTIFICACAO', '2026-02-12', ids.map((animal_id, i) => ({ animal_id, codigo: 'SB-' + (i + 1) })), { tipo_identificacao: 'SISBOV' })).dados.event_id;
  const tr = m.run('registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, ids)).dados.event_id;
  const ops0 = m.tabela('OPERACOES').length;
  const k = m.run('corrigir', Object.assign(compra('2026-02-05', forn, ids.map((animal_id, i) => Object.assign(garrote(['0801', '0812', '0803'][i]), { animal_id })), 900000), { event_id: r.event_id, justificativa: 'Brinco digitado errado' })).dados;
  assert.equal(m.tabela('OPERACOES').length, ops0 + 1, 'um só commit');
  assert.equal(m.evento(r.event_id).status, 'ESTORNADO');
  assert.deepEqual(ids.map((id) => [m.animal(id).codigo_interno, m.animal(id).evento_origem_id, m.animal(id).brinco, m.animal(id).pasto_atual_id]),
    ids.map((id, i) => [codigosInt[i], k.event_id, ['0801', '0812', '0803'][i], PASTOS.B]));
  assert.deepEqual([m.evento(iden).status, m.evento(tr).status], ['CONFIRMADO', 'CONFIRMADO'], 'identificação e transferência seguem válidas');
  assert.ok(m.tabela('FINANCEIRO').filter((f) => f.event_id === r.event_id).every((f) => f.status === 'CANCELADO'), 'lançamentos antigos CANCELADO');
  const sem = falha(m, 'corrigir', Object.assign(compra('2026-02-05', forn, ids.slice(0, 2).map((animal_id, i) => Object.assign(garrote(['0801', '0812'][i]), { animal_id })), 600000), { event_id: k.event_id, justificativa: 'Tirar o 0803' }));
  assert.equal(sem.code, 'CONFLICT');
  assert.deepEqual(sem.details.map((d) => [d.codigo, d.animal_id, d.conflito.event_id]).sort(), [['EVENTO_DEPENDENTE', ids[2], iden], ['EVENTO_DEPENDENTE', ids[2], tr]].sort());
});

// ------------------------------------------------------------------ cadeia de substituição ----
test('desenho-base 16.1: o substituto ocupa a posição do original no dia (desempate pelo primeiro da cadeia); corrigir duas vezes a primeira de duas transferências do mesmo dia mantém a ordem', () => {
  const x = base();
  const { m, ids } = x;
  const t1 = m.run('registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, [ids.m4])).dados.event_id;
  // Duas transferências do mesmo animal no mesmo dia: a guarda semântica pede confirmação (POSSIVEL_DUPLICIDADE).
  const dup = { avisos: ['POSSIVEL_DUPLICIDADE'] };
  const t2 = m.run('registrar', transferencia('2026-03-01', PASTOS.B, PASTOS.C, [ids.m4]), dup).dados.event_id;
  const k1 = m.run('corrigir', Object.assign(transferencia('2026-03-01', PASTOS.A, PASTOS.B, [ids.m4], { notes: 'Pela porteira de cima' }), { event_id: t1, justificativa: 'Observação' }), dup).dados.event_id;
  const k2 = m.run('corrigir', Object.assign(transferencia('2026-03-01', PASTOS.A, PASTOS.B, [ids.m4], { notes: 'Pela porteira de baixo', responsible: 'Zé' }), { event_id: k1, justificativa: 'Observação de novo' }), dup).dados.event_id;
  assert.ok(m.evento(k2).event_seq > m.evento(t2).event_seq, 'o substituto tem event_seq novo');
  assert.deepEqual([m.animal(ids.m4).pasto_atual_id, m.evento(t2).status, m.evento(k2).status], [PASTOS.C, 'CONFIRMADO', 'CONFIRMADO'], 'a de A→B continua antes da de B→C');
  const linhas = c_linhas(x, ids.m4);
  assert.deepEqual(linhas, [['ENTRADA_INICIAL', null], ['TRANSFERENCIA', k2], ['TRANSFERENCIA', t2]]);
  // Mudar a origem do substituto para quebrar a de B→C: CONFLICT com ela.
  const e = falha(m, 'corrigir', Object.assign(transferencia('2026-03-01', PASTOS.A, PASTOS.C, [ids.m4]), { event_id: k2, justificativa: 'Destino errado' }), dup);
  assert.deepEqual(e.details.map((d) => [d.codigo, d.conflito.event_id]), [['ORIGEM_DIVERGENTE', t2]]);
});
function c_linhas(x, animalId) {
  return x.c.lerCom(x.G.Timeline.LEITURAS, (tx, G) => G.Timeline.ordenar(G.Timeline.fonte(tx).linhas(animalId)).map((l) => [l.event_type, l.event_type === 'TRANSFERENCIA' ? l.event_id : null]), true);
}

// ------------------------------------------------------------------ histórico e auditoria ----
test('histórico: evento.listar do animal inclui os estornos dos eventos dele; evento.obter traz detalhes, financeiro, parcelas, alocações e o anulado; auditoria.listar une EVENTOS, AJUSTES e AUDITORIA com filtros por entidade, registro, período e operação', () => {
  const x = base();
  const { c, m, ids, comp } = x;
  // Um minuto entre os comandos: a trilha vem da mais recente para a mais antiga pelo instante de cada operação.
  const passa = () => { m.gas.clock.now += 60000; };
  passa();
  const v = m.run('registrar', venda('2026-06-01', comp, [ids.m3], 500000)).dados.event_id;
  passa();
  const aj = m.run('registrar', ajuste('CORRECAO_LOCALIZACAO', '2026-03-01', [{ animal_id: ids.m4, pasto_destino_id: PASTOS.B }], { justificativa: 'Estava no B' })).dados.event_id;
  passa();
  c.run('AnimalService.comandoEditar', { animal_id: ids.m4, campos: { nome: 'Bandido' } });
  passa();
  const est = m.run('estornar', { event_id: v, justificativa: 'Comprador desistiu' }).dados.event_id;
  // evento.listar do animal: a venda (anulada) e o estorno dela.
  const doAnimal = m.listar({ animal_id: ids.m3 });
  assert.deepEqual(doAnimal.itens.map((e) => [e.event_type, e.status]), [['ESTORNO', 'CONFIRMADO'], ['VENDA', 'ESTORNADO'], ['ENTRADA_INICIAL', 'CONFIRMADO']]);
  assert.deepEqual(m.listar({ animal_id: ids.m3, vigentes: true }).itens.map((e) => e.event_type), ['ENTRADA_INICIAL']);
  // evento.obter da venda anulada: detalhes, lançamentos, parcelas, rateio e alocações.
  const ob = m.obter(v);
  assert.deepEqual([ob.evento.status, ob.evento.vigente, ob.evento.anulado_por], ['ESTORNADO', false, est]);
  assert.deepEqual([ob.detalhes.VENDAS.length, ob.detalhes.FINANCEIRO.length, ob.detalhes.PARCELAS.length, ob.detalhes.RATEIOS.length, ob.detalhes.ALOCACOES_FINANCEIRAS.length], [1, 1, 1, 1, 1]);
  assert.deepEqual(ob.detalhes.FINANCEIRO.map((f) => [f.status, f.cancelado_por_event_id]), [['CANCELADO', est]]);
  const obEst = m.obter(est);
  assert.deepEqual([obEst.evento.event_type, obEst.anula.event_id, obEst.linhas], ['ESTORNO', v, []]);
  assert.deepEqual(m.obter(aj).detalhes.AJUSTES.map((a) => [a.campo, a.valor_anterior, a.valor_novo]), [['pasto_atual_id', PASTOS.A, PASTOS.B]]);
  assert.throws(() => m.obter(C.id(0x404)), (e) => /Evento não encontrado/.test(e.message));
  // auditoria.listar: a trilha completa de um animal (evento, ajuste e edição de cadastro).
  const trilha = (f) => c.ler(c.G.AuditService.consultaListar(Object.assign({ por_pagina: 500 }, f || {})));
  const doM4 = trilha({ entity_id: ids.m4 });
  assert.deepEqual(doM4.itens.map((a) => [a.origem, a.acao, a.campo || null]), [['AUDITORIA', 'ALTERAR', 'nome'], ['EVENTO', 'REGISTRAR', null], ['AJUSTE', 'AJUSTAR', 'pasto_atual_id'], ['EVENTO', 'REGISTRAR', null]]);
  assert.deepEqual(doM4.itens.filter((a) => a.origem === 'EVENTO').map((a) => a.event_type), ['AJUSTE_INVENTARIO', 'ENTRADA_INICIAL']);
  assert.equal(doM4.itens.find((a) => a.origem === 'AJUSTE').justificativa, 'Estava no B');
  const doM3 = trilha({ entidade: 'ANIMAIS', entity_id: ids.m3 });
  assert.deepEqual(doM3.itens.filter((a) => a.origem === 'EVENTO').map((a) => a.acao), ['ESTORNAR', 'REGISTRAR', 'REGISTRAR'], 'o estorno da venda entra na trilha do animal');
  // Filtros: entidade, operação, ação, origem, período (data na fazenda ou instante).
  assert.ok(trilha({ entidade: 'EVENTOS' }).itens.every((a) => a.origem === 'EVENTO'));
  assert.ok(trilha({ entidade: 'PARCEIROS' }).itens.every((a) => a.origem === 'AUDITORIA' && a.entidade === 'PARCEIROS'));
  const opEst = m.evento(est).op_id;
  assert.deepEqual(trilha({ op_id: opEst }).itens.map((a) => [a.origem, a.event_id]), [['EVENTO', est]]);
  assert.deepEqual(trilha({ acao: 'ESTORNAR' }).itens.map((a) => a.event_id), [est]);
  assert.ok(trilha({ origem: 'AJUSTE' }).itens.every((a) => a.origem === 'AJUSTE'));
  assert.equal(trilha({ de: '2026-11-13', ate: '2026-11-13' }).total, trilha().total, 'tudo foi registrado hoje');
  assert.equal(trilha({ ate: '2026-11-12' }).total, 0);
  assert.equal(trilha({ de: '2026-11-13T14:00:00.000Z' }).total, trilha().total);
  const pg = c.ler(c.G.AuditService.consultaListar({ por_pagina: 2, pagina: 2 }));
  assert.deepEqual(pg.itens, trilha().itens.slice(2, 4), 'paginação estável');
  // Falhas: período inválido e origem desconhecida.
  assert.throws(() => trilha({ de: '13/11/2026' }), (e) => /Período inválido/.test(e.message));
  assert.throws(() => trilha({ origem: 'OUTRA' }), (e) => /Origem desconhecida/.test(e.message));
});

test('auditoria.listar pela api(): filtros e envelope; período inválido → VALIDATION; operação que falhou não aparece', () => {
  const s = S.sistema();
  const api = (rota, dados, chave) => js(s.gas.exec(() => s.G.api({ rota, dados, idempotencyKey: chave || 'k-' + Math.random(), avisosAceitos: [] })));
  const passa = () => { s.gas.clock.now += 60000; };
  const r = api('evento.registrar', S.entradaInicial([S.bicho({ brinco: '1' })]));
  passa();
  const t = api('evento.registrar', transferencia('2026-04-10', S.PASTOS.A, S.PASTOS.B, [r.data.animais[0].animal_id]));
  passa();
  const e = api('evento.estornar', { event_id: t.data.event_id, justificativa: 'pasto errado' });
  assert.equal(e.ok, true);
  const falhou = api('evento.registrar', transferencia('2026-04-10', S.PASTOS.A, S.PASTOS.A, [r.data.animais[0].animal_id]));
  assert.equal(falhou.ok, false);
  const a = api('auditoria.listar', { entidade: 'EVENTOS', por_pagina: 10 });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  assert.deepEqual(a.data.itens.map((x) => [x.acao, x.event_type]), [['ESTORNAR', 'ESTORNO'], ['REGISTRAR', 'TRANSFERENCIA'], ['REGISTRAR', 'ENTRADA_INICIAL']]);
  assert.equal(a.data.itens[0].justificativa, 'pasto errado');
  const inv = api('auditoria.listar', { de: 'ontem' });
  assert.deepEqual([inv.ok, inv.error.code, inv.error.details[0].campo], [false, 'VALIDATION', 'de']);
});
