'use strict';
/**
 * Conserto pela garantia: a correção e o fato congelado (CONTRATOS, seção 50). Cada teste é um defeito que o oráculo da
 * correção do teste aleatório achou (ou a mesma causa, por outro caminho que a tabela da seção 50 cobre): a correção sem
 * mudança — ou a que muda outro campo — de um evento gravado antes de uma mudança de cadastro refazia pelo cadastro de hoje (ou
 * pelo estado de hoje) o que o registro tinha congelado, ou recusava por uma regra que só o estado de hoje quebra. O ponto
 * único (Correcao.congelado) dá o valor do original enquanto as entradas de que ele depende não mudam. Cada teste falha com o
 * `src/` de antes desta etapa (commit b8c513b) e passa agora.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js, PASTOS } = S;
const TODOS = ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'ESTOQUE_INSUFICIENTE', 'PRODUTO_VENCIDO', 'CARENCIA_ATIVA', 'IDADE_REPRODUTIVA', 'CATEGORIAS_SEM_COBERTURA', 'RATEIO_SEM_PESO', 'VALOR_DIVERGENTE', 'INTERVALO_PARTO_CURTO', 'BRINCO_PARECIDO'];

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave || 'k-' + Math.random(), avisosAceitos: avisos || TODOS })));
}
function ok(r, onde) {
  assert.equal(r.ok, true, (onde || '') + ': ' + String(JSON.stringify(r.error)).slice(0, 1500));
  return r.data;
}
const hoje = (s, iso) => { s.gas.clock.now = Date.parse(iso + 'T15:00:00.000Z'); };
function rebanho(s, bichos) {
  const r = ok(api(s, 'evento.registrar', S.entradaInicial(bichos)), 'rebanho');
  const ids = {};
  r.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return { ids, event_id: r.event_id };
}
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}
const tab = (s, aba, filtro) => s.tabela(aba).filter((r) => Object.keys(filtro || {}).every((k) => r[k] === filtro[k]));
/** Corrige sem mudança: o pedido do registro de novo, com o evento e a justificativa. */
const corrigir = (s, eid, dados, onde) => ok(api(s, 'evento.corrigir', Object.assign({}, dados, { event_id: eid, justificativa: 'Conferido de novo' })), onde);
const machos = (n) => Array.from({ length: n }, (_, i) => S.bicho({ brinco: String(100 + i), sexo: 'M', castrado: true, data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' }));

test('a descrição do consumo de uma aplicação leva a categoria do produto de quando ela foi lançada: a correção sem mudança, depois de mudar a categoria no cadastro, não troca "Consumo de vacina" por "Consumo de medicamento"', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(2));
  hoje(s, '2026-04-01');
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina F', categoria: 'VACINA', unidade: 'dose', custo_unitario: 2.5 } }), 'produto');
  const dados = { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-03-01', produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1 }, animais: [{ animal_id: ids['100'] }, { animal_id: ids['101'] }] };
  const v = ok(api(s, 'evento.registrar', dados), 'aplicação');
  const antes = tab(s, 'FINANCEIRO', { event_id: v.event_id }).map((f) => [f.descricao, f.valor, f.conta_id]);
  assert.deepEqual(antes.map((x) => x[0]), ['Consumo de vacina: 2 doses']);
  ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { categoria: 'MEDICAMENTO' }, justificativa: 'Categoria revista' }), 'categoria');
  const r = corrigir(s, v.event_id, dados, 'correção sem mudança');
  assert.deepEqual(tab(s, 'FINANCEIRO', { event_id: r.event_id }).map((f) => [f.descricao, f.valor, f.conta_id]), antes);
  // A correção que muda a dose refaz a quantidade com a categoria congelada.
  const r2 = corrigir(s, r.event_id, Object.assign({}, dados, { campos: Object.assign({}, dados.campos, { dose_referencia: 2 }) }), 'outra dose');
  assert.deepEqual(tab(s, 'FINANCEIRO', { event_id: r2.event_id }).map((f) => [f.descricao, f.valor]), [['Consumo de vacina: 4 doses', 1000]]);
  semErro(s, 'consumo');
});

test('a descrição da compra de um insumo leva o nome do produto de quando ela foi lançada: a correção sem mudança, depois de renomear o produto, não troca o nome', () => {
  const s = S.sistema();
  hoje(s, '2026-04-01');
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina X', categoria: 'VACINA', unidade: 'dose', custo_unitario: 1.85, controla_estoque: true } }), 'produto');
  const dados = { tipo: 'ESTOQUE', subtipo: 'ENTRADA', campos: { event_date: '2026-03-10', product_id: p.product_id, quantidade: 100, valor: 18500 }, animais: [] };
  const e = ok(api(s, 'evento.registrar', dados), 'entrada');
  assert.deepEqual(tab(s, 'FINANCEIRO', { event_id: e.event_id }).map((f) => f.descricao), ['Compra de Vacina X: 100 doses']);
  ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { nome: 'Vacina X (nova)' }, justificativa: 'Nome revisto' }), 'nome');
  const r = corrigir(s, e.event_id, dados, 'correção sem mudança');
  assert.deepEqual(tab(s, 'FINANCEIRO', { event_id: r.event_id }).map((f) => [f.descricao, f.quantidade, f.valor]), [['Compra de Vacina X: 100 doses', 100, 18500]]);
  semErro(s, 'compra do insumo');
});

test('a próxima aplicação proposta pelo protocolo é a da recorrência de quando a aplicação foi lançada: a correção sem mudança, depois de o protocolo deixar de ser a cada N dias, mantém a próxima (e a correção da data a refaz pelo mesmo intervalo)', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(1));
  hoje(s, '2026-04-01');
  const pr = ok(api(s, 'protocolo.salvar', { campos: { nome: 'Vermífugo a cada 90', tipo_procedimento: 'VERMIFUGO', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 90 } }), 'protocolo');
  const dados = { tipo: 'SANIDADE', subtipo: 'VERMIFUGACAO', campos: { event_date: '2026-03-01', nome_produto: 'Verm Y', modo_dose: 'POR_CABECA', dose_referencia: 10, unidade_dose: 'mL', protocol_id: pr.protocol_id }, animais: [{ animal_id: ids['100'] }] };
  const v = ok(api(s, 'evento.registrar', dados), 'aplicação');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: v.event_id }).map((x) => x.data_proxima_aplicacao), ['2026-05-30']);
  ok(api(s, 'protocolo.salvar', { protocol_id: pr.protocol_id, campos: { recorrencia_tipo: 'UNICA' }, justificativa: 'Agora é dose única' }), 'recorrência');
  const r = corrigir(s, v.event_id, dados, 'correção sem mudança');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: r.event_id }).map((x) => x.data_proxima_aplicacao), ['2026-05-30']);
  const r2 = corrigir(s, r.event_id, Object.assign({}, dados, { campos: Object.assign({}, dados.campos, { event_date: '2026-03-02' }) }), 'outra data');
  assert.deepEqual(tab(s, 'SANIDADE', { event_id: r2.event_id }).map((x) => x.data_proxima_aplicacao), ['2026-05-31']);
  semErro(s, 'próxima');
});

test('o pasto das crias que o parto tirou da mãe é o daquele dia: a transferência retroativa da mãe para antes do parto não faz a correção sem mudança do parto mudar o pasto da cria (nem ser recusada pela saída posterior da cria)', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [S.bicho({ brinco: 'V1', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 })]);
  hoje(s, '2026-06-01');
  const parto = { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-10' }, animais: [{ animal_id: ids.V1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: 'C1' }] };
  const p = ok(api(s, 'evento.registrar', parto), 'parto');
  const cria = tab(s, 'EVENTO_ANIMAIS', { event_id: p.event_id, papel: 'CRIA' })[0];
  assert.equal(cria.pasto_destino_id, PASTOS.A);
  // A cria sai do pasto A depois do parto: o fato posterior que depende de onde ela nasceu.
  ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: cria.animal_id }] }), 'transferência da cria');
  // A mãe ia para o pasto B antes do parto (lançada depois).
  ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: ids.V1 }] }), 'transferência da mãe');
  const reuso = Object.assign({}, parto, { crias: [Object.assign({ animal_id: cria.animal_id }, parto.crias[0])] });
  const r = corrigir(s, p.event_id, reuso, 'correção sem mudança do parto');
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: r.event_id, papel: 'CRIA' }).map((l) => [l.animal_id, l.pasto_destino_id]), [[cria.animal_id, PASTOS.A]]);
  semErro(s, 'parto');
});

test('a raça da cria que o parto tirou da mãe é a daquele dia: a correção da raça da mãe no cadastro não faz a correção sem mudança do parto mudar a raça da cria', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [S.bicho({ brinco: 'V1', sexo: 'F', raca: 'NELORE', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 })]);
  hoje(s, '2026-06-01');
  const parto = { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-10' }, animais: [{ animal_id: ids.V1 }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: 'C1' }] };
  const p = ok(api(s, 'evento.registrar', parto), 'parto');
  const cria = tab(s, 'EVENTO_ANIMAIS', { event_id: p.event_id, papel: 'CRIA' })[0];
  assert.equal(cria.atributos_iniciais_json.raca, 'NELORE');
  const raca = tab(s, 'LISTAS', { lista: 'RACA' }).find((l) => l.codigo !== 'NELORE' && l.ativo !== false).codigo;
  ok(api(s, 'animal.editar', { animal_id: ids.V1, campos: { raca }, justificativa: 'Raça conferida' }), 'raça da mãe');
  const r = corrigir(s, p.event_id, Object.assign({}, parto, { crias: [Object.assign({ animal_id: cria.animal_id }, parto.crias[0])] }), 'correção sem mudança do parto');
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: r.event_id, papel: 'CRIA' }).map((l) => l.atributos_iniciais_json.raca), ['NELORE']);
  assert.equal(tab(s, 'ANIMAIS', { animal_id: cria.animal_id })[0].raca, 'NELORE');
  semErro(s, 'raça');
});

test('a divisão estimada de uma venda sem o peso de cada animal (a última pesagem de cada um até a data) é a de quando ela foi lançada: a pesagem retroativa lançada depois não muda a divisão na correção sem mudança', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(2));
  hoje(s, '2026-06-01');
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-03-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['100'], peso: 300 }, { animal_id: ids['101'], peso: 200 }] }), 'pesagem');
  const comprador = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } }), 'comprador').partner_id;
  const venda = { tipo: 'VENDA', campos: { event_date: '2026-04-01', partner_id: comprador, finalidade: 'ABATE', modalidade: 'KG_VIVO', preco_unitario: 1000, peso_vivo_total_kg: 450, valor_bruto: 450000 }, animais: [{ animal_id: ids['100'] }, { animal_id: ids['101'] }], parcelas: [{ data_vencimento: '2026-05-01', valor: 450000 }], deducoes: [] };
  const v = ok(api(s, 'evento.registrar', venda), 'venda');
  const valores = (eid) => tab(s, 'EVENTO_ANIMAIS', { event_id: eid }).map((l) => [l.animal_id, l.valor_individual]).sort();
  const antes = valores(v.event_id);
  assert.deepEqual(antes.map((x) => x[1]).sort((a, b) => a - b), [180000, 270000]);
  // A pesagem de 15/03 do 100, que chegou depois da venda: a última dele até a venda passa a ser 400 kg.
  ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2026-03-15', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids['100'], peso: 400 }] }), 'pesagem retroativa');
  const r = corrigir(s, v.event_id, venda, 'correção sem mudança da venda');
  assert.deepEqual(valores(r.event_id), antes);
  semErro(s, 'venda estimada');
});

test('a descrição proposta de uma dedução da venda leva o nome do tipo de quando a venda foi lançada: renomear o item da lista não muda a dedução na correção sem mudança', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(1));
  hoje(s, '2026-06-01');
  const comprador = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Frigorífico', tipos: ['COMPRADOR'] } }), 'comprador').partner_id;
  const venda = { tipo: 'VENDA', campos: { event_date: '2026-04-01', partner_id: comprador, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: ids['100'] }], parcelas: [{ data_vencimento: '2026-05-01', valor: 300000 }], deducoes: [{ tipo: 'FUNRURAL', valor: 4500, retida_pelo_comprador: true }] };
  const v = ok(api(s, 'evento.registrar', venda), 'venda');
  const desc = (eid) => tab(s, 'FINANCEIRO', { event_id: eid }).map((f) => f.descricao).sort();
  const antes = desc(v.event_id);
  const item = tab(s, 'LISTAS', { lista: 'TIPO_DEDUCAO_VENDA', codigo: 'FUNRURAL' })[0];
  assert.ok(antes.indexOf(item.rotulo + ' da venda de 01/04/2026') >= 0, JSON.stringify(antes));
  ok(api(s, 'lista.salvar', { lista_id: item.lista_id, rotulo: item.rotulo + ' (revisto)', justificativa: 'Nome revisto' }), 'rótulo');
  const r = corrigir(s, v.event_id, venda, 'correção sem mudança da venda');
  assert.deepEqual(desc(r.event_id), antes);
  semErro(s, 'dedução');
});

test('a correção de cadastro que o estado de hoje torna igual ao cadastro (a entrada do animal corrigida depois para o mesmo valor) continua aceita na correção sem mudança, com o valor de antes que ela gravou', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const bichos = [S.bicho({ brinco: '53', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA' })];
  const reb = rebanho(s, bichos);
  hoje(s, '2026-06-01');
  const cad = { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-05-01', justificativa: 'Nascimento conferido' }, animais: [{ animal_id: reb.ids['53'], campo: 'data_nascimento', valor_novo: '2019-06-01' }] };
  const c = ok(api(s, 'evento.registrar', cad), 'correção de cadastro');
  assert.deepEqual(tab(s, 'AJUSTES', { event_id: c.event_id }).map((a) => [a.valor_anterior, a.valor_novo]), [['2020-01-01', '2019-06-01']]);
  // O rebanho inicial corrigido para a mesma data: a correção de cadastro passa a não mudar nada no estado de hoje.
  ok(api(s, 'evento.corrigir', Object.assign(S.entradaInicial([Object.assign({}, bichos[0], { animal_id: reb.ids['53'], data_nascimento: '2019-06-01' })]), { event_id: reb.event_id, justificativa: 'Data da ficha' })), 'rebanho corrigido');
  const r = corrigir(s, c.event_id, cad, 'correção sem mudança da correção de cadastro');
  assert.deepEqual(tab(s, 'AJUSTES', { event_id: r.event_id }).map((a) => [a.valor_anterior, a.valor_novo]), [['2020-01-01', '2019-06-01']]);
  semErro(s, 'correção de cadastro');
});

test('a entrada sem mudança que o servidor dá para a correção (evento.obter: correcao) e a correção só com a mudança (dados.mudanca): a anotação muda só a anotação; a dose muda a quantidade e o valor com o custo, a conta e o nome congelados', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(2));
  hoje(s, '2026-04-01');
  const p = ok(api(s, 'produto.salvar', { campos: { nome: 'Vacina F', categoria: 'VACINA', unidade: 'dose', custo_unitario: 2.5, fabricante: 'Lab A', carencia_padrao_dias: 21 } }), 'produto');
  const v = ok(api(s, 'evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2026-03-01', produto_id: p.product_id, modo_dose: 'POR_CABECA', dose_referencia: 1, lote: 'L1' }, animais: [{ animal_id: ids['100'] }, { animal_id: ids['101'] }] }), 'aplicação');
  const fatos = (eid) => ({
    san: tab(s, 'SANIDADE', { event_id: eid }).map((x) => [x.animal_id, x.nome_produto, x.fabricante, x.lote, x.dose, x.periodo_carencia_dias, x.data_fim_carencia, x.custo]).sort(),
    mov: tab(s, 'MOVIMENTOS_ESTOQUE', { event_id: eid }).map((x) => [x.tipo, x.quantidade, x.custo_unitario, x.lote]),
    fin: tab(s, 'FINANCEIRO', { event_id: eid }).map((x) => [x.descricao, x.valor, x.conta_id, x.quantidade]),
  });
  const antes = fatos(v.event_id);
  // O cadastro muda depois (custo, categoria, nome, fabricante, carência padrão).
  ok(api(s, 'produto.salvar', { product_id: p.product_id, campos: { custo_unitario: 7.25, categoria: 'MEDICAMENTO', nome: 'Vacina F (revisto)', fabricante: 'Lab B', carencia_padrao_dias: 60 }, justificativa: 'Cadastro revisto' }), 'cadastro');
  const ob = ok(api(s, 'evento.obter', { event_id: v.event_id }), 'obter');
  assert.deepEqual(ob.correcao.campos, { event_date: '2026-03-01', property_id: S.PROP, produto_id: p.product_id, lote: 'L1', modo_dose: 'POR_CABECA', dose_referencia: 1, periodo_carencia_dias: 21 });
  assert.deepEqual(ob.correcao.animais, [{ animal_id: ids['100'] }, { animal_id: ids['101'] }].sort((a, b) => (a.animal_id < b.animal_id ? -1 : 1)).map((x) => ob.correcao.animais.find((y) => y.animal_id === x.animal_id)));
  const r0 = ok(api(s, 'evento.corrigir', Object.assign({}, ob.correcao, { event_id: v.event_id, justificativa: 'Sem mudança' })), 'pela entrada do servidor');
  assert.deepEqual(fatos(r0.event_id), antes);
  const r1 = ok(api(s, 'evento.corrigir', { event_id: r0.event_id, justificativa: 'Anotação', mudanca: { campos: { notes: 'Conferido no curral' } } }), 'só a anotação');
  assert.deepEqual(fatos(r1.event_id), antes);
  assert.equal(tab(s, 'EVENTOS', { event_id: r1.event_id })[0].notes, 'Conferido no curral');
  const r2 = ok(api(s, 'evento.corrigir', { event_id: r1.event_id, justificativa: 'Dose', mudanca: { campos: { dose_referencia: 2 } } }), 'outra dose');
  const depois = fatos(r2.event_id);
  assert.deepEqual(depois.mov, [['SAIDA', 4, 2.5, 'L1']]);
  assert.deepEqual(depois.fin.map((x) => x.slice(0, 2)), [['Consumo de vacina: 4 doses', 1000]]);
  assert.deepEqual(depois.san.map((x) => x.slice(1, 7)), antes.san.map((x) => [x[1], x[2], x[3], 2, x[5], x[6]]));
  semErro(s, 'mudança');
});
