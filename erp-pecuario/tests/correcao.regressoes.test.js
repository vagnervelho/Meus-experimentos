'use strict';
/**
 * Conserto pela garantia: a correção e o fato congelado (CONTRATOS, seção 50). Cada teste é um defeito que o oráculo da
 * correção do teste aleatório achou (ou a mesma causa, por outro caminho que a tabela da seção 50 cobre): a correção sem
 * mudança — ou a que muda outro campo — de um evento gravado antes de uma mudança de cadastro refazia pelo cadastro de hoje (ou
 * pelo estado de hoje) o que o registro tinha congelado, ou recusava por uma regra que só o estado de hoje quebra. O ponto
 * único (Correcao.congelado) dá o valor do original enquanto as entradas de que ele depende não mudam. Cada teste falha com o
 * `src/` de antes desta etapa (commit b8c513b) e passa agora. Os testes 1 a 9 são da primeira leva do oráculo (e da mesma causa
 * por outro caminho); do 10 em diante, das falhas das sementes fixas e da leva de 1.000 sementes × 100 passos (610000 a 610999),
 * reduzidas ao cenário mínimo.
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

test('o parto só de natimorto com o pai informado: a certeza do pai fica no evento (não há cria que a leve) e a correção sem mudança pela prévia da tela é aceita, também depois de desativar o pasto em que a mãe estava no parto', () => {
  const { cliente, storeDe } = require('./apoio-telas');
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [
    S.bicho({ brinco: 'V1', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 }),
    S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA', pasto_destino_id: PASTOS.B }),
  ]);
  hoje(s, '2026-06-01');
  const p = ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-10', pai_id: ids.T1, pai_confianca: 'ESTIMADA', tipo_parto: 'ASSISTIDO' }, animais: [{ animal_id: ids.V1 }], crias: [{ situacao_nascimento: 'NATIMORTO' }] }), 'parto');
  const parto = (eid) => tab(s, 'REPRODUCAO', { event_id: eid }).map((r) => [r.animal_id, r.tipo_evento, r.touro_id, r.qtd_nascidos_vivos, r.qtd_natimortos, r.tipo_parto]);
  const antes = parto(p.event_id);
  assert.deepEqual(antes, [[ids.V1, 'PARTO', ids.T1, 0, 1, 'ASSISTIDO']]);
  // A mãe sai do pasto A depois do parto e o pasto A é desativado (o cadastro de hoje).
  ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-04-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: ids.V1 }] }), 'transferência da mãe');
  ok(api(s, 'pasto.salvar', { pasture_id: PASTOS.A, campos: { status: 'INATIVO' }, justificativa: 'Pasto em reforma' }), 'pasto desativado');
  // A correção pela tela: a prévia, convertida como o formulário converte, vai ao servidor sem mudança.
  const c = cliente(s);
  const st = storeDe(s);
  c.Store = st;
  const previa = js(c.TelaEventos.previaCorrecao(ok(api(s, 'evento.obter', { event_id: p.event_id }), 'obter')));
  const clone = (x) => JSON.parse(JSON.stringify(x || {}));
  const grupos = {};
  Object.keys(previa.grupos || {}).forEach((g) => { grupos[g] = previa.grupos[g].map((x, i) => ({ uid: g + i, valores: clone(x.valores) })); });
  const sess = { tipo: 'NASCIMENTO', def: st.tipoEvento('NASCIMENTO'), subtipo: null, campos: clone(previa.campos), grupos, justificativaAviso: '', corrige: clone(previa.corrige), justificativaCorrecao: 'Conferido de novo',
    linhas: previa.linhas.map((l, i) => ({ uid: 'l' + i, animal_id: l.animal_id, valores: clone(l.valores), erros: [] })) };
  const m = js(c.Registro.montarDados(sess));
  assert.deepEqual(m.erros, [], 'a prévia traz a certeza do pai que o parto gravou');
  const r = ok(api(s, 'evento.corrigir', m.dados), 'correção sem mudança do parto');
  assert.deepEqual(parto(r.event_id), antes);
  assert.equal((tab(s, 'EVENTOS', { event_id: r.event_id })[0].payload_json || {}).pai_confianca, 'ESTIMADA');
  semErro(s, 'parto só de natimorto');
});

test('a correção de cadastro para "não castrado" seguida de uma castração: a correção sem mudança dela não vê a castração como repetida (o castrado de origem depois do comando conta a própria correção)', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [S.bicho({ brinco: '94', sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2024-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-06-01');
  const cad = { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-03-01', justificativa: 'Ainda inteiro' }, animais: [{ animal_id: ids['94'], campo: 'castrado', valor_novo: 'N' }] };
  const c = ok(api(s, 'evento.registrar', cad), 'correção de cadastro');
  ok(api(s, 'evento.registrar', { tipo: 'CASTRACAO', campos: { event_date: '2026-04-12', metodo: 'Burdizzo' }, animais: [{ animal_id: ids['94'] }] }), 'castração');
  const ajustes = (eid) => tab(s, 'AJUSTES', { event_id: eid }).map((a) => [a.animal_id, a.campo, a.valor_anterior, a.valor_novo]);
  const antes = ajustes(c.event_id);
  const r = corrigir(s, c.event_id, cad, 'correção sem mudança da correção de cadastro');
  assert.deepEqual(ajustes(r.event_id), antes);
  semErro(s, 'castração depois da correção');
});

test('o brinco que a identificação deu quando o reuso estava ligado (ou quando o brinco podia ter letras): a correção sem mudança, depois de mudar o parâmetro, não é recusada pela regra do número novo', () => {
  const s = S.sistema({ config: { brinco_permite_reuso: 'S' } });
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [S.bicho({ brinco: '79', data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' }), S.bicho({ brinco: '30', data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' }), S.bicho({ data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  const semBrinco = Object.values(ids).find((x) => x && !['79', '30'].some((b) => ids[b] === x)) || tab(s, 'ANIMAIS').find((a) => !Object.values(ids).includes(a.animal_id)).animal_id;
  hoje(s, '2026-06-01');
  // Na mesma troca, o 79 sai de um animal e vai para outro (o reuso ligado aceita).
  const troca = { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-05-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: ids['79'], codigo: '80', motivo: 'PERDA' }, { animal_id: ids['30'], codigo: '79', motivo: 'PERDA' }] };
  const t = ok(api(s, 'evento.registrar', troca), 'troca com reuso');
  // A primeira identificação com letra (o brinco só com números desligado).
  const prim = { tipo: 'IDENTIFICACAO', subtipo: 'PRIMEIRA_IDENTIFICACAO', campos: { event_date: '2026-05-02', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: semBrinco, codigo: 'A7' }] };
  const p = ok(api(s, 'evento.registrar', prim), 'brinco com letra');
  ok(api(s, 'config.salvar', { valores: { brinco_permite_reuso: 'N', brinco_somente_numerico: 'S' } }), 'parâmetros');
  const idents = (eid) => tab(s, 'IDENTIFICACOES', { event_id: eid }).map((x) => [x.animal_id, x.tipo, x.codigo, x.data_inicio, x.motivo]).sort();
  const rt = corrigir(s, t.event_id, troca, 'correção sem mudança da troca');
  assert.deepEqual(idents(rt.event_id), idents(t.event_id));
  const rp = corrigir(s, p.event_id, prim, 'correção sem mudança da primeira identificação');
  assert.deepEqual(idents(rp.event_id), idents(p.event_id));
  // Um número novo continua passando pela regra de hoje.
  const outro = api(s, 'evento.corrigir', Object.assign({}, prim, { event_id: rp.event_id, justificativa: 'Outro número', animais: [{ animal_id: semBrinco, codigo: 'B8' }] }));
  assert.equal(outro.ok, false);
  assert.deepEqual(outro.error.details.map((d) => d.codigo), ['BRINCO_NAO_NUMERICO']);
  semErro(s, 'brinco do original');
});

test('a correção de cadastro que apagou o nascimento apagou junto a certeza dele: a correção sem mudança mantém as duas linhas, com o valor de antes que gravou, mesmo depois de o rebanho inicial deixar de ter o nascimento', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const bichos = [S.bicho({ brinco: '53', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA' })];
  const reb = rebanho(s, bichos);
  hoje(s, '2026-06-01');
  const cad = { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-05-01', justificativa: 'Nascimento desconhecido' }, animais: [{ animal_id: reb.ids['53'], campo: 'data_nascimento', valor_novo: '' }] };
  const c = ok(api(s, 'evento.registrar', cad), 'correção de cadastro');
  const ajustes = (eid) => tab(s, 'AJUSTES', { event_id: eid }).map((a) => [a.campo, a.valor_anterior, a.valor_novo]).sort();
  const antes = ajustes(c.event_id);
  assert.deepEqual(antes, [['data_nascimento', '2020-01-01', null], ['data_nascimento_confianca', 'ESTIMADA', null]]);
  // O rebanho inicial corrigido sem o nascimento (e sem a certeza dele).
  const semNasc = Object.assign({}, bichos[0], { animal_id: reb.ids['53'] });
  delete semNasc.data_nascimento;
  delete semNasc.data_nascimento_confianca;
  ok(api(s, 'evento.corrigir', Object.assign(S.entradaInicial([semNasc]), { event_id: reb.event_id, justificativa: 'Sem a data' })), 'rebanho corrigido');
  const r = corrigir(s, c.event_id, cad, 'correção sem mudança da correção de cadastro');
  assert.deepEqual(ajustes(r.event_id), antes);
  semErro(s, 'confiança apagada');
});

test('a compra com o pasto do lote que nenhum animal usou (todos com pasto próprio): desativar esse pasto depois não recusa a correção sem mudança da compra', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  rebanho(s, [S.bicho({ brinco: '1', data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-06-01');
  const vendedor = ok(api(s, 'parceiro.salvar', { campos: { nome: 'Vendedor', tipos: ['FORNECEDOR'] } }), 'vendedor').partner_id;
  const compra = { tipo: 'COMPRA', campos: { event_date: '2026-03-01', partner_id: vendedor, modalidade: 'CABECA', preco_unitario: 200000, valor_animais: 200000, pasto_destino_id: PASTOS.B }, animais: [{ brinco: '700', sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2025-01-01', data_nascimento_confianca: 'ESTIMADA', pasto_destino_id: PASTOS.A }], parcelas: [{ data_vencimento: '2026-04-01', valor: 200000 }], custos: [] };
  const cp = ok(api(s, 'evento.registrar', compra), 'compra');
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: cp.event_id }).map((l) => l.pasto_destino_id), [PASTOS.A]);
  ok(api(s, 'pasto.salvar', { pasture_id: PASTOS.B, campos: { status: 'INATIVO' }, justificativa: 'Pasto em reforma' }), 'pasto do lote desativado');
  const novo = tab(s, 'EVENTO_ANIMAIS', { event_id: cp.event_id })[0].animal_id;
  const r = corrigir(s, cp.event_id, Object.assign({}, compra, { animais: [Object.assign({ animal_id: novo }, compra.animais[0])] }), 'correção sem mudança da compra');
  assert.deepEqual(tab(s, 'EVENTO_ANIMAIS', { event_id: r.event_id }).map((l) => [l.animal_id, l.pasto_destino_id]), [[novo, PASTOS.A]]);
  // Um animal sem pasto próprio iria para o pasto desativado: recusado.
  const semPasto = Object.assign({}, compra.animais[0], { animal_id: novo });
  delete semPasto.pasto_destino_id;
  const recusa = api(s, 'evento.corrigir', Object.assign({}, compra, { event_id: r.event_id, justificativa: 'Sem pasto', animais: [semPasto] }));
  assert.equal(recusa.ok, false);
  assert.ok(recusa.error.details.some((d) => d.codigo === 'PASTO_INATIVO'), JSON.stringify(recusa.error.details));
  semErro(s, 'pasto do lote');
});

test('o brinco lançado errado acertado num dia e trocado depois: a correção sem mudança do acerto não é recusada pelo brinco de hoje (o número trocado é o que o acerto gravou)', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [S.bicho({ brinco: '10', data_nascimento: '2022-01-01', data_nascimento_confianca: 'CONFIRMADA' })]);
  hoje(s, '2026-08-01');
  const acerto = { tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: '2026-02-18', justificativa: 'Brinco digitado errado' }, animais: [{ animal_id: ids['10'], brinco: '11' }] };
  const a = ok(api(s, 'evento.registrar', acerto), 'acerto do brinco');
  ok(api(s, 'evento.registrar', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-07-09', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: ids['10'], codigo: '38', motivo: 'PERDA' }] }), 'troca depois');
  const fatos = (eid) => ({
    aj: tab(s, 'AJUSTES', { event_id: eid }).map((x) => [x.animal_id, x.campo, x.valor_anterior, x.valor_novo]),
    id: tab(s, 'IDENTIFICACOES', { event_id: eid }).map((x) => [x.animal_id, x.tipo, x.codigo, x.data_inicio]),
  });
  const antes = fatos(a.event_id);
  assert.deepEqual(antes.aj, [[ids['10'], 'brinco', '10', '11']]);
  const r = corrigir(s, a.event_id, acerto, 'correção sem mudança do acerto');
  assert.deepEqual(fatos(r.event_id), antes);
  semErro(s, 'acerto do brinco');
});

test('o touro de um lote com vários touros não vira fêmea pela correção de cadastro (a linha de touro é de um macho): a correção sem mudança da exposição mantém os touros e as fêmeas', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, [
    S.bicho({ brinco: 'F1', sexo: 'F', data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: 'T1', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: 'T2', sexo: 'M', reprodutor: true, data_nascimento: '2019-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
  ]);
  hoje(s, '2026-06-01');
  const expo = { tipo: 'REPRODUCAO', subtipo: 'EXPOSICAO', campos: { event_date: '2026-02-01' }, animais: [{ animal_id: ids.F1 }, { animal_id: ids.T1 }, { animal_id: ids.T2 }] };
  const x = ok(api(s, 'evento.registrar', expo), 'exposição com dois touros');
  const fatos = (eid) => ({
    linhas: tab(s, 'EVENTO_ANIMAIS', { event_id: eid }).map((l) => [l.animal_id, l.papel]).sort(),
    regs: tab(s, 'REPRODUCAO', { event_id: eid }).map((r) => [r.animal_id, r.tipo_evento, r.touro_id]),
  });
  const antes = fatos(x.event_id);
  assert.deepEqual(antes.regs, [[ids.F1, 'EXPOSICAO', null]], 'com dois touros, o registro da fêmea fica sem touro');
  const sexo = api(s, 'evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: '2026-05-01', justificativa: 'Era fêmea' }, animais: [{ animal_id: ids.T1, campo: 'sexo', valor_novo: 'F' }] });
  assert.equal(sexo.ok, false, 'a correção do sexo do touro do lote é recusada');
  assert.ok(JSON.stringify(sexo.error).indexOf('como touro') >= 0, JSON.stringify(sexo.error).slice(0, 800));
  const r = corrigir(s, x.event_id, expo, 'correção sem mudança da exposição');
  assert.deepEqual(fatos(r.event_id), antes);
  semErro(s, 'touros do lote');
});

test('o lançamento sem a propriedade recebe a padrão das configurações: a correção sem mudança, depois de mudar a propriedade padrão, mantém a propriedade que ele gravou', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const { ids } = rebanho(s, machos(1));
  hoje(s, '2026-06-01');
  const cat = tab(s, 'CATEGORIAS').find((c) => c.ativo !== false && (c.sexo_aplicavel === 'M' || c.sexo_aplicavel === 'AMBOS'));
  const recl = { tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: '2026-03-01', justificativa: 'Escolha do dono' }, animais: [{ animal_id: ids['100'], categoria_manual_id: cat.category_id }] };
  const r0 = ok(api(s, 'evento.registrar', recl), 'reclassificação sem propriedade');
  assert.equal(tab(s, 'EVENTOS', { event_id: r0.event_id })[0].property_id, S.PROP);
  const outra = ok(api(s, 'propriedade.salvar', { campos: { nome: 'Fazenda Nova', status: 'ATIVO' } }), 'outra propriedade').property_id;
  ok(api(s, 'config.salvar', { valores: { propriedade_padrao_id: outra } }), 'propriedade padrão');
  const r = corrigir(s, r0.event_id, recl, 'correção sem mudança');
  assert.equal(tab(s, 'EVENTOS', { event_id: r.event_id })[0].property_id, S.PROP);
  semErro(s, 'propriedade');
});
