'use strict';
/**
 * Fase 4, E4.4 (CONTRATOS, seção 58): o custo por animal e por pasto e o resultado por animal (`financeiro.custosAnimal`; 07,
 * seções 2.1 "Visão 3", 6 e 10, relatórios 14 e 15) e o bloco H da ficha pela mesma conta — o CT-19 por animal (2.675,54;
 * 2.352,65; −3.074,79), o custo diário e a margem por arroba do 07, seção 6; o custo do arrendamento por pasto (R$ 9,23 por
 * animal-dia, 07, 3.3) com a posse; a passagem de cada alocação (o arrendamento de quem chegou no meio do mês; quem saiu e
 * voltou); o resultado parcial sem custo de aquisição; os filtros e as recusas; a regra de tempo (o rateio de depois, o fato
 * retroativo, o cadastro); a importação e o desfazer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');
const A = require('./apoio-ct19');

const codigos = (e) => (e.details || []).map((d) => d.codigo);
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

test('CT-19 por animal (07, 2.2 e 6): aquisição, sanitário, alimentação (o arrendamento), custo acumulado, receita, despesas de venda, resultado; custo diário de R$ 1,10 e margem de R$ 140,82 por @ de A1; a ficha (bloco H) dá o mesmo que a rota', () => {
  const c = A.caso22();
  const s = c.s;
  A.hoje(s, '2028-01-10');
  const r = s.consulta('financeiro.custosAnimal', { data: '2027-12-31' });
  const por = Object.fromEntries(r.itens.map((x) => [x.brinco, x]));
  const col = (x) => [x.aquisicao, x.sanitario, x.alimentacao, x.adicionais, x.custeio, x.custo_acumulado, x.receitas, x.despesas_venda, x.resultado.valor];
  assert.deepEqual(col(por.A1), [303334, 300, 27692, 0, 27992, 331326, 608000, 9120, 267554]);
  assert.deepEqual(col(por.A2), [313333, 300, 18462, 0, 18762, 332095, 576000, 8640, 235265]);
  assert.deepEqual(col(por.A3), [293333, 300, 13846, 0, 14146, 307479, 0, 0, -307479], 'A3 morto: −(aquisição + custeio)');
  assert.deepEqual([por.A1.dias, por.A1.custo_diario.valor, por.A1.margem_arroba.valor, por.A1.margem_arroba.arrobas, por.A1.margem_arroba.base, por.A1.margem_arroba.estimado], [255, 110, 14082, 19, 'CARCACA', false], 'A1: 255 dias, R$ 1,10 por dia, R$ 140,82 por @ (19 @)');
  assert.deepEqual([por.A3.margem_arroba.valor, por.A3.margem_arroba.motivo, por.A3.situacao, por.A3.saida.tipo], [null, 'SEM_VALOR_DE_REFERENCIA', 'MORTO', 'MORTE']);
  assert.deepEqual([por.A1.aquisicao_origem, por.A1.situacao, por.A1.entrada.data, por.A1.saida.data, por.A1.pasture_id, por.A1.pasto_nome], ['NEGOCIADO', 'VENDIDO', '2027-03-10', '2027-11-20', S.PASTOS.B, 'Pasto B'], 'quem saiu: o pasto do dia da saída');
  assert.deepEqual([r.totais.resultado, r.totais.com_resultado, r.totais.parciais, r.totais.custo_acumulado, r.custeio_nao_alocado.valor, r.parcial], [195340, 3, 0, 970900, 20000, null]);
  // A ficha (bloco H) é a mesma conta, hoje.
  ['A1', 'A2', 'A3'].forEach((b) => {
    const h = s.consulta('animal.ficha', { animal_id: c.id[b] }).financeiro;
    const x = por[b];
    assert.deepEqual([h.custo_aquisicao, h.custeio, h.custo_acumulado, h.receitas, h.despesas_venda, h.resultado.valor, h.classes.sanitario, h.classes.alimentacao, h.dias, h.custo_diario.valor, h.margem_arroba.valor],
      [x.aquisicao, x.custeio, x.custo_acumulado, x.receitas, x.despesas_venda, x.resultado.valor, x.sanitario, x.alimentacao, x.dias, x.custo_diario.valor, x.margem_arroba.valor], 'ficha × rota: ' + b);
    assert.equal(h.custo_aquisicao, s.tabela('ANIMAIS').find((a) => a.animal_id === c.id[b]).custo_aquisicao, 'o custo de aquisição é o da projeção: ' + b);
  });
  // Achado do teste aleatório (sementes 9960031 e 9960035): numa data antes da venda, o animal está no rebanho, e a margem não
  // pode trazer as arrobas da venda que ainda não aconteceu (a regra de tempo).
  const antes = Object.fromEntries(s.consulta('financeiro.custosAnimal', { data: '2027-10-31' }).itens.map((x) => [x.brinco, x]));
  assert.deepEqual([antes.A1.situacao, antes.A1.margem_arroba, antes.A1.resultado.valor], ['NO_REBANHO', { valor: null, arrobas: null, estimado: false, base: null, motivo: 'DADOS_INSUFICIENTES' }, null]);
  // O detalhe de um animal: cada alocação com o critério e a base (08, seção 3: o critério de cada valor).
  const d = s.consulta('financeiro.custosAnimal', { animal_id: c.id.A2, data: '2027-12-31' });
  assert.deepEqual(d.lancamentos.map((x) => [x.conta_codigo, x.criterio, x.base_valor, x.valor_alocado]).sort(), [
    ['ARRENDAMENTO_PASTO', 'DIAS_PERMANENCIA', 20, 18462], ['COMPRA_ANIMAIS', 'VALOR_INDIVIDUAL', 3100, 310000], ['FRETE_DESPESAS_COMPRA', 'CABECAS', 1, 3333],
    ['TAXAS_RETENCOES_VENDA', 'PESO_CARCACA', 270, 8640], ['VACINAS', 'CABECAS', 1, 300], ['VENDA_ANIMAIS', 'PESO_CARCACA', 270, 576000]].sort());
  assert.deepEqual([d.animal.resultado.valor, d.anteriores, d.lancamentos.every((x) => x.passagem_atual)], [235265, 0, true]);
});

test('custo por pasto (07, seção 10, relatório 15): o arrendamento do Pasto 2 em junho, R$ 600,00 em 65 animais-dia = R$ 9,23 por animal-dia (07, 3.3), R$ 30,00 por hectare, alocado × não alocado, por posse; o custeio sem pasto à parte; a parte da competência num período menor', () => {
  const c = A.caso22();
  const s = c.s;
  A.hoje(s, '2028-01-10');
  // Junho pedido em 30/06: o rateio de 01/07 ainda não vale, o arrendamento está todo "sem alocar".
  const jun = s.consulta('financeiro.custosAnimal', { visao: 'PASTOS', de: '2027-06-01', data: '2027-06-30' });
  const b = jun.pastos.find((p) => p.pasture_id === S.PASTOS.B);
  assert.deepEqual([b.posse, b.arrendador_nome, b.area_hectares, b.custo, b.animais_dia, b.custo_animal_dia.valor, b.custo_ha.valor, b.alocado, b.nao_alocado], ['ARRENDADO', 'Vizinho do Pasto 2', 20, 60000, 65, 923, 3000, 0, 60000]);
  assert.deepEqual(b.contas.map((x) => [x.codigo, x.valor]), [['ARRENDAMENTO_PASTO', 60000]]);
  assert.deepEqual(b.lancamentos.map((x) => [x.descricao, x.valor_lancamento, x.valor_periodo, x.criterio, x.rateio_data]), [['Arrendamento do Pasto 2 (junho)', 60000, 60000, null, null]]);
  const a = jun.pastos.find((p) => p.pasture_id === S.PASTOS.A);
  assert.deepEqual([a.posse, a.custo, a.animais_dia, a.custo_animal_dia.valor], ['PROPRIO', 0, 10, 0], 'A2 no Pasto A de 01/06 a 10/06');
  assert.deepEqual(jun.por_posse.map((x) => [x.posse, x.custo, x.animais_dia]), [['PROPRIO', 0, 10], ['ARRENDADO', 60000, 65]]);
  assert.deepEqual([jun.custeio_sem_pasto, jun.total.custo], [20000, 60000], 'a contabilidade não tem pasto');
  // Junho e julho pedidos em 31/07: o rateio de 01/07 vale, tudo alocado; os dias de julho entram nos animais-dia.
  const jj = s.consulta('financeiro.custosAnimal', { visao: 'PASTOS', de: '2027-06-01', data: '2027-07-31' });
  const bj = jj.pastos.find((p) => p.pasture_id === S.PASTOS.B);
  assert.deepEqual([bj.custo, bj.alocado, bj.nao_alocado, bj.animais_dia, bj.lancamentos[0].criterio, bj.lancamentos[0].rateio_data], [60000, 60000, 0, 65 + 62, 'DIAS_PERMANENCIA', '2027-07-01']);
  // Um gasto de pasto retroativo (a cerca do Pasto A em 20/06) entra no custo de junho do Pasto A.
  s.ok('evento.registrar', { tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2027-06-20', conta_id: s.conta('MANUTENCAO_PASTOS'), valor: 15000, pasture_id: S.PASTOS.A, descricao: 'Cerca' }, parcelas: [{ data_vencimento: '2027-06-30' }] });
  const em30 = s.consulta('financeiro.custosAnimal', { visao: 'PASTOS', de: '2027-06-01', data: '2027-06-30' });
  assert.deepEqual([em30.pastos.find((p) => p.pasture_id === S.PASTOS.A).custo, em30.por_posse[0].custo, em30.pastos.find((p) => p.pasture_id === S.PASTOS.B).custo], [15000, 15000, 60000]);
  // Meio mês: a parte da competência do arrendamento (1.1) e o não alocado na mesma proporção.
  const meio = s.consulta('financeiro.custosAnimal', { visao: 'PASTOS', de: '2027-06-01', data: '2027-06-15' });
  assert.deepEqual(meio.pastos.find((p) => p.pasture_id === S.PASTOS.B).custo, 30000);
  // Recusas.
  assert.deepEqual(codigos(s.falha('financeiro.custosAnimal', { visao: 'PASTO' })), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(codigos(s.falha('financeiro.custosAnimal', { visao: 'PASTOS', de: '2027-07-01', data: '2027-06-30' })), ['PERIODO_INVERTIDO']);
});

test('a passagem de cada alocação: o arrendamento do mês rateado pelos dias a quem foi comprado no dia 11 é do custo dele (antes ficava fora, como de passagem anterior); quem saiu e voltou tem uma linha por passagem; o resultado parcial sem custo de aquisição', () => {
  const s = A.montar('2026-06-11');
  const forn = s.ok('parceiro.salvar', { campos: { nome: 'Recriador', tipos: 'FORNECEDOR' } }).partner_id;
  const g = (b, v) => ({ brinco: b, sexo: 'M', castrado: true, reprodutor: false, idade_meses: 20, valor_individual: v });
  const cp = s.ok('evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-06-11', partner_id: forn, pasto_destino_id: S.PASTOS.B, modalidade: 'CABECA', valor_animais: 300000 }, animais: [g('C1', 300000)], parcelas: [{ data_vencimento: '2026-07-11' }] });
  const c1 = cp.animais[0].animal_id;
  const arr = s.ok('evento.registrar', { tipo: 'LANCAMENTO_FINANCEIRO', campos: { event_date: '2026-06-01', conta_id: s.conta('ARRENDAMENTO_PASTO'), valor: 60000, pasture_id: S.PASTOS.B, competencia_inicio: '2026-06-01', competencia_fim: '2026-06-30' }, parcelas: [{ data_vencimento: '2026-06-05' }] });
  A.hoje(s, '2026-07-01');
  s.ok('evento.registrar', { tipo: 'RATEIO', campos: { event_date: '2026-07-01', financial_id: s.finDo(arr.event_id)[0].financial_id } });
  const h = s.consulta('animal.ficha', { animal_id: c1 }).financeiro;
  assert.deepEqual([h.custeio, h.classes.alimentacao, h.lancamentos_anteriores, h.desde, h.lancamentos.every((x) => x.passagem_atual)], [60000, 60000, 0, '2026-06-11', true], 'competência 01/06 e o animal desde 11/06: o custo dos 20 dias é da passagem atual');
  // Vendido em julho e comprado de volta em agosto: duas linhas (a passagem que se fechou, com o resultado, e a aberta).
  const comp = s.ok('parceiro.salvar', { campos: { nome: 'Comprador', tipos: 'COMPRADOR' } }).partner_id;
  A.hoje(s, '2026-07-20');
  s.ok('evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-07-20', partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', valor_bruto: 400000 }, animais: [{ animal_id: c1, valor_individual: 400000 }], parcelas: [{ data_vencimento: '2026-08-20' }] });
  A.hoje(s, '2026-08-10');
  s.ok('evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-08-10', partner_id: forn, pasto_destino_id: S.PASTOS.A, modalidade: 'CABECA', valor_animais: 350000 }, animais: [{ animal_id: c1, valor_individual: 350000 }], parcelas: [{ data_vencimento: '2026-09-10' }] });
  const l = s.consulta('financeiro.custosAnimal', { data: '2026-08-10' });
  assert.deepEqual(l.itens.map((x) => [x.situacao, x.entrada.data, x.aquisicao, x.custeio, x.receitas, x.resultado.valor]), [['VENDIDO', '2026-06-11', 300000, 60000, 400000, 40000], ['NO_REBANHO', '2026-08-10', 350000, 0, 0, null]]);
  assert.deepEqual(s.consulta('financeiro.custosAnimal', { data: '2026-08-10', situacao: 'SAIRAM' }).itens.length, 1);
  assert.deepEqual(s.consulta('financeiro.custosAnimal', { data: '2026-08-10', situacao: 'NO_REBANHO' }).itens.map((x) => x.custo_acumulado), [350000]);
  const f2 = s.consulta('animal.ficha', { animal_id: c1 }).financeiro;
  assert.deepEqual([f2.desde, f2.custo_aquisicao, f2.custeio, f2.lancamentos_anteriores, f2.resultado.valor], ['2026-08-10', 350000, 0, 3, null], 'a ficha é da passagem atual; as três alocações da anterior ficam na lista, fora das contas');
  // Pedido na data da primeira passagem, o animal é o de lá (a regra de tempo).
  assert.deepEqual(s.consulta('financeiro.custosAnimal', { data: '2026-07-31' }).itens.map((x) => [x.situacao, x.resultado.valor]), [['VENDIDO', 40000]]);
  // Rebanho inicial sem valor de abertura que morre: sem custo de aquisição, o resultado não é calculado (o "parcial" do 07, 6).
  const ini = s.ok('evento.registrar', S.entradaInicial([S.bicho({ brinco: '777', sexo: 'F', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA' })], { event_date: S.D0 }));
  s.ok('evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-08-01', causa: 'DOENCA' }, animais: [{ animal_id: ini.animais[0].animal_id }] });
  const p = s.consulta('financeiro.custosAnimal', { data: '2026-08-10', situacao: 'SAIRAM' });
  const m = p.itens.find((x) => x.brinco === '777');
  assert.deepEqual([m.aquisicao, m.aquisicao_origem, m.resultado.valor, m.resultado.motivo, p.totais.parciais, p.parcial.cabecas], [null, 'DESCONHECIDO', null, 'DADOS_INSUFICIENTES', 1, 1]);
  assert.match(p.parcial.mensagem, /1 cabeça saiu sem custo de aquisição/);
  // O resultado gerencial do período sai rotulado "parcial" (07, seção 6), com a mesma contagem.
  const res = s.consulta('financeiro.resultado', { de: '2026-01-01', ate: '2026-08-10' });
  assert.deepEqual([res.fecha, res.parcial.cabecas], [true, 1]);
  assert.match(res.parcial.mensagem, /^Parcial: 1 cabeça saiu no período sem custo de aquisição conhecido/);
  assert.equal(s.consulta('financeiro.resultado', { de: '2026-08-02', ate: '2026-08-10' }).parcial, null, 'fora do período da saída, sem o rótulo');
});

test('regra de tempo: o custo numa data usa o rateio que valia nela e os fatos até ela; o re-rateio, a venda e a pesagem de depois não mudam a data; o retroativo muda; o nome da conta é rótulo de hoje; a posse e a área do pasto são o cadastro de hoje (sem vigência, 03a 4.2)', () => {
  const c = A.caso22('2027-07-01');
  const s = c.s;
  const D = '2027-06-20';
  const antes = s.consulta('financeiro.custosAnimal', { data: D });
  assert.deepEqual(antes.itens.map((x) => [x.brinco, x.custeio, x.resultado.valor]), [['A1', 300, null], ['A2', 300, null], ['A3', 300, -293633]], 'em 20/06 o arrendamento ainda não estava rateado (o rateio é de 01/07)');
  const pastosAntes = s.consulta('financeiro.custosAnimal', { visao: 'PASTOS', de: '2027-06-01', data: D });
  A.hoje(s, '2027-08-01');
  // Re-rateio de depois (por cabeça entre os três) e uma pesagem: a data de 20/06 não muda.
  s.ok('evento.registrar', { tipo: 'RATEIO', campos: { event_date: '2027-08-01', financial_id: c.fin.F4, criterio: 'MANUAL', escopo_tipo: 'EVENTO', justificativa_rateio: 'Dose dupla no A1' }, animais_rateio: [{ animal_id: c.id.A1, valor: 500 }, { animal_id: c.id.A2, valor: 200 }, { animal_id: c.id.A3, valor: 200 }] });
  s.ok('evento.registrar', { tipo: 'PESAGEM', campos: { event_date: '2027-08-01', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: c.id.A1, peso: 400 }] });
  assert.deepEqual(s.consulta('financeiro.custosAnimal', { data: D }), antes, 'o re-rateio e a pesagem de agosto não mudam 20/06');
  assert.deepEqual(s.consulta('financeiro.custosAnimal', { data: '2027-08-01' }).itens.map((x) => x.sanitario), [500, 200, 200], 'em 01/08 vale o re-rateio');
  // Retroativo: uma vacina de 10/06 lançada agora (custo pago no ato) entra em 20/06.
  s.ok('evento.registrar', { tipo: 'SANIDADE', subtipo: 'VACINACAO', campos: { event_date: '2027-06-10', nome_produto: 'Vacina da loja', modo_dose: 'POR_CABECA', dose_referencia: 2, unidade_dose: 'mL', custo_valor: 1000, custo_conta_id: s.conta('VACINAS'), custo_vencimento: '2027-07-10' }, animais: [{ animal_id: c.id.A1 }, { animal_id: c.id.A2 }] });
  assert.deepEqual(s.consulta('financeiro.custosAnimal', { data: D }).itens.map((x) => x.sanitario), [800, 800, 300]);
  // Cadastro: renomear a conta muda só o nome na lista do animal; mudar a posse muda o grupo do pasto (cadastro sem vigência).
  s.ok('conta.salvar', { conta_id: s.conta('VACINAS'), campos: { nome: 'Vacinas e soros' } });
  const det = s.consulta('financeiro.custosAnimal', { animal_id: c.id.A1, data: D });
  assert.ok(det.lancamentos.some((x) => x.conta_nome === 'Vacinas e soros'));
  s.ok('pasto.salvar', { pasture_id: S.PASTOS.B, campos: { posse: 'PROPRIO', arrendador_id: null }, justificativa: 'Compramos o pasto' });
  const pastosDepois = s.consulta('financeiro.custosAnimal', { visao: 'PASTOS', de: '2027-06-01', data: D });
  const sem = (r) => r.pastos.map((p) => [p.pasture_id, p.custo, p.alocado, p.nao_alocado, p.animais_dia]);
  assert.deepEqual(sem(pastosDepois).sort(), sem(pastosAntes).sort(), 'os números do pasto não mudam; só o grupo da posse');
  assert.equal(pastosDepois.pastos.find((p) => p.pasture_id === S.PASTOS.B).posse, 'PROPRIO');
});

test('filtros e recusas: situação, sexo, pasto e categoria na data (de quem saiu, os do dia da saída), busca pelo brinco; visão, situação e sexo fora da lista, pasto, categoria e animal inexistentes, data futura ou inválida; antes do marco zero, o motivo', () => {
  const c = A.caso22();
  const s = c.s;
  A.hoje(s, '2028-01-10');
  const n = (dados) => s.consulta('financeiro.custosAnimal', Object.assign({ data: '2027-12-31' }, dados)).itens.map((x) => x.brinco);
  assert.deepEqual(n({ pasture_id: S.PASTOS.B }), ['A1', 'A2', 'A3'], 'os três saíram do Pasto 2');
  assert.deepEqual(n({ pasture_id: S.PASTOS.A }), []);
  assert.deepEqual(n({ busca: 'a2' }), ['A2']);
  assert.deepEqual(n({ sexo: 'F' }), []);
  assert.deepEqual(n({ de: '2027-07-01' }), ['A1', 'A2'], 'A3 saiu antes do período');
  assert.deepEqual(s.consulta('financeiro.custosAnimal', { data: '2027-09-01', pasture_id: S.PASTOS.B }).itens.map((x) => [x.brinco, x.situacao]), [['A1', 'NO_REBANHO'], ['A2', 'NO_REBANHO'], ['A3', 'MORTO']]);
  const cat = s.consulta('financeiro.custosAnimal', { data: '2027-09-01' }).itens[0].categoria;
  assert.ok(cat && cat.category_id, 'a categoria do animal na data');
  assert.deepEqual(n({ category_id: cat.category_id }).length > 0, true);
  const recusa = (dados) => { const e = s.falha('financeiro.custosAnimal', dados); return [e.code, codigos(e)[0] || null]; };
  assert.deepEqual(recusa({ situacao: 'VENDIDOS' }), ['VALIDATION', 'VALOR_FORA_DA_LISTA']);
  assert.deepEqual(recusa({ sexo: 'X' }), ['VALIDATION', 'VALOR_FORA_DA_LISTA']);
  assert.deepEqual(recusa({ pasture_id: 'nao-existe' }), ['NOT_FOUND', null]);
  assert.deepEqual(recusa({ category_id: 'nao-existe' }), ['NOT_FOUND', null]);
  assert.deepEqual(recusa({ animal_id: 'nao-existe' }), ['NOT_FOUND', null]);
  assert.deepEqual(recusa({ data: '2028-02-01' }), ['VALIDATION', 'DATA_FUTURA']);
  assert.deepEqual(recusa({ data: '31/12/2027' }), ['VALIDATION', 'FORMATO_INVALIDO']);
  const antes = s.consulta('financeiro.custosAnimal', { data: '2025-12-31' });
  assert.deepEqual([antes.motivo, antes.itens.length], ['ANTERIOR_AO_MARCO_ZERO', 0]);
  const det = s.consulta('financeiro.custosAnimal', { animal_id: c.id.A1, data: '2027-03-09' });
  assert.deepEqual([det.animal, det.motivo], [null, 'DADOS_INSUFICIENTES'], 'antes da compra, o animal ainda não tinha entrado');
});

const MAPA = {
  colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco', 'Primeiro vencimento': 'vencimento', Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento', Castrado: 'castrado', Reprodutor: 'reprodutor', Pasto: 'pasto' },
  confiancas: { data_nascimento: 'ESTIMADA' }, padroes: {},
};
const COMPRAS = [
  'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Primeiro vencimento;Brinco;Sexo;Nascimento;Castrado;Reprodutor;Pasto',
  'C1;10/02/2026;Fazenda Vizinha;cabeça;4.000,00;2.000,00;10/03/2026;200;M;01/01/2025;N;N;Pasto A',
  'C1;;;;;;;201;M;01/02/2025;N;N;Pasto A',
].join('\n');

test('importação e desfazer: a compra importada entra no custo por animal e no resultado (o custo de aquisição na projeção); desfeita a importação, sai dos dois', () => {
  const s = A.montar('2026-03-01');
  s.ok('parceiro.salvar', { campos: { nome: 'Fazenda Vizinha', tipos: 'FORNECEDOR' } });
  const cr = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar', dados: { tipo: 'COMPRAS', arquivo_nome: 'compras.csv', conteudo_base64: b64(COMPRAS), formato: FORMATO } })).dados;
  for (let b = 1; b < 10; b++) { const v = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + b, dados: { import_id: cr.import_id, bloco: b, mapeamento: MAPA } })).dados; if (v.importacao.status === 'VALIDADO') break; }
  let r = s.exec((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: cr.import_id, bloco: 1, modo: 'TOTAL' } }));
  for (let b = 2; r.dados.blocos.proximo !== null; b++) r = s.exec((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: cr.import_id, bloco: b } }));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: cr.import_id } }));
  A.semErro(s, 'importação');
  const l = s.consulta('financeiro.custosAnimal', {});
  assert.deepEqual(l.itens.map((x) => [x.brinco, x.aquisicao, x.aquisicao_origem, x.situacao]), [['200', 200000, 'NEGOCIADO', 'NO_REBANHO'], ['201', 200000, 'NEGOCIADO', 'NO_REBANHO']]);
  const res = s.consulta('financeiro.resultado', { ano: '2026' });
  assert.deepEqual([res.fecha, res.resultado.total, res.fora_do_resultado[0].total, res.estoques.periodo.rebanho.fim], [true, 0, 400000, 400000], 'a compra fica fora do resultado e entra no estoque do rebanho');
  const des = s.tentar((ctx) => s.G.ImportService.desfazer(ctx, { avisosAceitos: [], dados: { import_id: cr.import_id, justificativa: 'arquivo errado' } }));
  assert.equal(des.ok, true, JSON.stringify(des.erro));
  A.semErro(s, 'desfazer');
  assert.deepEqual(s.consulta('financeiro.custosAnimal', {}).itens, []);
  const res2 = s.consulta('financeiro.resultado', { ano: '2026' });
  assert.deepEqual([res2.fecha, res2.fora_do_resultado[0].total, res2.estoques.periodo.rebanho.fim], [true, 0, 0]);
});

test('achado do teste aleatório (sementes 9950003 e 9950005): o re-rateio do valor de abertura não apaga a origem do custo de aquisição — a projeção, a ficha e o custo por animal continuam "valor de abertura informado"', () => {
  const s = A.montar('2026-03-01');
  const ini = s.ok('evento.registrar', S.entradaInicial([
    S.bicho({ brinco: '501', sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'CONFIRMADA', valor_abertura: 300000 }),
    S.bicho({ brinco: '502', sexo: 'M', data_nascimento: '2024-06-01', data_nascimento_confianca: 'CONFIRMADA', valor_abertura: 200000 }),
  ], { event_date: S.D0 }));
  const fin = s.finDo(ini.event_id)[0];
  const id = Object.fromEntries(ini.animais.map((a) => [a.brinco, a.animal_id]));
  s.ok('evento.registrar', { tipo: 'RATEIO', campos: { event_date: '2026-03-01', financial_id: fin.financial_id, criterio: 'MANUAL', escopo_tipo: 'EVENTO', justificativa_rateio: 'Avaliação refeita' }, animais_rateio: [{ animal_id: id['501'], valor: 250000 }, { animal_id: id['502'], valor: 250000 }] });
  const proj = s.tabela('ANIMAIS').find((a) => a.animal_id === id['501']);
  assert.deepEqual([proj.custo_aquisicao, proj.custo_aquisicao_origem], [250000, 'ABERTURA_INFORMADA']);
  assert.deepEqual(s.consulta('financeiro.custosAnimal', {}).itens.map((x) => [x.brinco, x.aquisicao, x.aquisicao_origem]), [['501', 250000, 'ABERTURA_INFORMADA'], ['502', 250000, 'ABERTURA_INFORMADA']]);
  const h = s.consulta('animal.ficha', { animal_id: id['502'] }).financeiro;
  assert.deepEqual([h.custo_aquisicao, h.custo_aquisicao_origem], [250000, 'ABERTURA_INFORMADA']);
});
