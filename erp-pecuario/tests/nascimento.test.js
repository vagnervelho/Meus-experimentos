'use strict';
/**
 * NASCIMENTO (E2.1): parto simples, gemelar, natimorto, peso ao nascer, cria sem brinco, pai opcional (touro do
 * rebanho ou animal externo de referência), REPRODUCAO (PARTO) e o histórico reprodutivo da matriz (situação, cria ao
 * pé, número de partos, categoria). CT-01 completo (09, seção 3), regras de 05 (RN-060 a RN-065, RN-017) e de 04
 * (seção 6: parto antes do marco zero), estorno e correção, inclusive com evento posterior dependente.
 * Depois de CADA comando o apoio confere projeção gravada = reconstrução (Timeline.conferir vazio).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./apoio-cadastros');

const { js, D0, PASTOS, bicho, entradaInicial, outraEntrada, codigos } = C;

function nascimento(data, matrizId, crias, campos) {
  return { tipo: 'NASCIMENTO', campos: Object.assign({ event_date: data }, campos || {}), animais: [{ animal_id: matrizId }], crias };
}
function viva(extra) {
  return Object.assign({ situacao_nascimento: 'VIVO', sexo: 'M' }, extra || {});
}
const natimorto = () => ({ situacao_nascimento: 'NATIMORTO' });
function transferencia(data, origem, destino, ids, campos) {
  return { tipo: 'TRANSFERENCIA', campos: Object.assign({ event_date: data, pasto_origem_id: origem, pasto_destino_id: destino }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) };
}
function falha(m, acao, dados, op) {
  const r = m.tentar(acao, dados, op);
  assert.equal(r.ok, false, 'o comando deveria ter sido recusado');
  return r.erro;
}
/** Rebanho do CT-01: matriz 0102 (15/03/2021) no Pasto 1 em D0, uma vaca jovem, um touro e um touro externo. */
function rebanho(opcoes) {
  const c = C.ambienteCadastros(opcoes);
  const m = c.m;
  const r = m.run('registrar', entradaInicial([
    bicho({ brinco: '0102', data_nascimento: '2021-03-15', data_nascimento_confianca: 'CONFIRMADA', raca: 'NELORE' }),
    bicho({ brinco: '0150', data_nascimento: '2025-02-01', data_nascimento_confianca: 'CONFIRMADA', pasto_destino_id: PASTOS.B }),
    bicho({ brinco: '0900', sexo: 'M', reprodutor: true, data_nascimento: '2020-01-10', data_nascimento_confianca: 'ESTIMADA' }),
    bicho({ brinco: '0300', data_nascimento: '2019-05-05', data_nascimento_confianca: 'ESTIMADA', partos_previos: 2 }),
  ]));
  const [matriz, novilha, touro, vaca] = r.dados.animais.map((a) => a.animal_id);
  const ext = c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'Touro do sêmen', sexo: 'M' } }).dados.animal_id;
  return { c, m, G: c.G, matriz, novilha, touro, vaca, ext, D0E: r.dados.event_id };
}
const ficha = (c, id) => c.ler(c.G.AnimalService.consultaFicha({ animal_id: id }));
const categoriaEm = (c, id, data) => c.lerCom(c.G.AnimalService.leituras(), (tx, G) => {
  const cat = G.AnimalService.categoriaEm(G.AnimalService.leitor(tx), tx.repo.porId('ANIMAIS', id), data);
  return cat ? cat.codigo : null;
});

// ------------------------------------------------------------------ CT-01 ----
test('CT-01 passo 1: parto cria a bezerra… o bezerro com a mãe, no pasto da mãe; tabelas, inventário nas datas, ficha e histórico da matriz', () => {
  const { c, m, G, matriz } = rebanho();
  const antes = m.contagem();
  const fin0 = m.tabela('FINANCEIRO').length;
  assert.equal(categoriaEm(c, matriz, '2026-09-11'), 'NOVILHA_24_MAIS', 'antes do parto: novilha (fêmea não parida com 24 meses ou mais)');
  const r = m.run('registrar', nascimento('2026-09-12', matriz, [viva({ peso: 32, metodo_pesagem: 'BALANCA' })]));
  const ev = m.evento(r.dados.event_id);
  // Tabelas
  const depois = m.contagem();
  assert.equal(depois.EVENTOS - antes.EVENTOS, 1);
  assert.deepEqual([ev.event_type, ev.event_subtype, ev.event_date, ev.registration_date, ev.status, ev.pre_marco_zero, ev.total_value], ['NASCIMENTO', null, '2026-09-12', '2026-11-13', 'CONFIRMADO', false, null]);
  const ea = m.tabela('EVENTO_ANIMAIS').filter((l) => l.event_id === ev.event_id);
  assert.equal(ea.length, 2);
  const linhaCria = ea.find((l) => l.papel === 'CRIA');
  const linhaMae = ea.find((l) => l.papel === 'MATRIZ');
  assert.deepEqual([linhaCria.efeito_inventario, linhaCria.pasto_destino_id, linhaCria.peso], [1, PASTOS.A, 32]);
  assert.deepEqual([linhaMae.animal_id, linhaMae.efeito_inventario, linhaMae.pasto_origem_id, linhaMae.pasto_destino_id, linhaMae.atributos_iniciais_json], [matriz, 0, null, null, null]);
  assert.deepEqual(js(linhaCria.atributos_iniciais_json), { sexo: 'M', data_nascimento: '2026-09-12', data_nascimento_confianca: 'CONFIRMADA', origem: 'NASCIDO', raca: 'NELORE', castrado: 'N', reprodutor: 'N', mae_id: matriz, mae_confianca: 'CONFIRMADA' });
  const pes = m.tabela('PESAGENS').filter((p) => p.event_id === ev.event_id);
  assert.deepEqual(pes.map((p) => [p.animal_id, p.tipo, p.peso_kg, p.metodo, p.data_pesagem]), [[linhaCria.animal_id, 'NASCIMENTO', 32, 'BALANCA', '2026-09-12']]);
  const rep = m.tabela('REPRODUCAO').filter((p) => p.event_id === ev.event_id);
  assert.deepEqual(rep.map((p) => [p.animal_id, p.tipo_evento, p.data, p.data_parto, p.qtd_nascidos_vivos, p.qtd_natimortos, p.touro_id]), [[matriz, 'PARTO', '2026-09-12', '2026-09-12', 1, 0, null]]);
  assert.equal(m.tabela('FINANCEIRO').length, fin0, 'FINANCEIRO 0: nascido não tem custo de aquisição');
  assert.equal(m.tabela('IDENTIFICACOES').filter((i) => i.event_id === ev.event_id).length, 0, 'cria sem brinco');
  // Inventário: 4 cabeças do rebanho; a cria só conta a partir de 12/09 (fim do dia).
  assert.deepEqual([m.inventario('2026-09-11').total, m.inventario('2026-09-12').total], [4, 5]);
  assert.deepEqual([m.inventario('2026-09-11').porPasto[PASTOS.A], m.inventario('2026-09-12').porPasto[PASTOS.A]], [3, 4]);
  // Ficha da cria
  const cria = m.animal(linhaCria.animal_id);
  assert.deepEqual([cria.situacao_cadastral, cria.origem, cria.mae_id, cria.mae_confianca, cria.pasto_atual_id, cria.peso_atual, cria.data_ultima_pesagem, cria.custo_aquisicao, cria.custo_aquisicao_origem, cria.brinco, cria.data_entrada, cria.evento_origem_id, cria.raca],
    ['ATIVO', 'NASCIDO', matriz, 'CONFIRMADA', PASTOS.A, 32, '2026-09-12', 0, 'NAO_SE_APLICA', null, '2026-09-12', ev.event_id, 'NELORE']);
  const fc = ficha(c, cria.animal_id);
  assert.equal(fc.geral.categoria.codigo, 'BEZERRO');
  assert.equal(fc.genealogia.mae.animal_id, matriz);
  assert.equal(fc.localizacao.pasture_id, PASTOS.A);
  const alertas = c.ler(G.InventoryService.consultaAlertas({ backup: { ultimo_em: '2026-11-13T00:00:00.000Z' }, integridade: null }));
  assert.ok(alertas.alertas.find((a) => a.codigo === 'SEM_BRINCO').ids.includes(cria.animal_id), 'pendência "sem brinco" (§16.19)');
  // Histórico da matriz: 1 parto, VAZIA, cria ao pé; Novilha → Vaca.
  const mae = m.animal(matriz);
  assert.deepEqual([mae.situacao_reprodutiva, mae.cria_ao_pe, mae.pasto_atual_id, mae.data_ultimo_movimento], ['VAZIA', true, PASTOS.A, D0], 'parto não é movimento da mãe');
  const g = ficha(c, matriz).reprodutivo;
  assert.deepEqual([g.entregue, g.parcial, g.aplica, g.n_partos, g.partos_registrados, g.ultimo_parto, g.crias_nascidas_vivas, g.natimortos, g.situacao_reprodutiva, g.cria_ao_pe], [true, false, true, 1, 1, '2026-09-12', 1, 0, 'VAZIA', true], 'bloco G inteiro desde a reprodução (Fase 3)');
  assert.deepEqual(g.partos.map((p) => [p.data, p.nascidos_vivos, p.natimortos, p.intervalo_dias, p.crias.map((x) => x.animal_id)]), [['2026-09-12', 1, 0, null, [cria.animal_id]]]);
  assert.deepEqual(js(g.intervalo_medio_dias), { valor: null, motivo: 'DADOS_INSUFICIENTES', n: 0 });
  assert.deepEqual([categoriaEm(c, matriz, '2026-09-11'), categoriaEm(c, matriz, '2026-09-12'), categoriaEm(c, matriz, '2026-11-13')], ['NOVILHA_24_MAIS', 'VACA', 'VACA']);
  assert.ok(ficha(c, matriz).eventos.itens.some((e) => e.event_id === ev.event_id && e.papel === 'MATRIZ'), 'o parto aparece na linha do tempo da mãe');
});

test('CT-01 passo 2: nome da matriz pelo cadastro (AUDITORIA) e sexo da cria por ajuste (AJUSTES); o valor de criação segue M', () => {
  const { c, m, matriz } = rebanho();
  const r = m.run('registrar', nascimento('2026-09-12', matriz, [viva({ peso: 32, metodo_pesagem: 'BALANCA' })]));
  const cria = r.dados.animais.find((a) => a.animal_id !== matriz).animal_id;
  const aud0 = c.tabela('AUDITORIA').length;
  const aj0 = c.tabela('AJUSTES').length;
  c.run('AnimalService.comandoEditar', { animal_id: matriz, campos: { nome: 'Mimosa' } });
  c.run('AnimalService.comandoEditar', { animal_id: cria, campos: { sexo: 'F' }, justificativa: 'Sexo conferido no curral' });
  const aud = c.tabela('AUDITORIA').slice(aud0);
  assert.deepEqual(aud.map((a) => [a.entity_id, a.campo, a.valor_novo]), [[matriz, 'nome', 'Mimosa']]);
  const aj = c.tabela('AJUSTES').slice(aj0);
  assert.deepEqual(aj.map((a) => [a.animal_id, a.campo, a.valor_anterior, a.valor_novo, a.justificativa]), [[cria, 'sexo', 'M', 'F', 'Sexo conferido no curral']]);
  assert.equal(m.animal(matriz).nome, 'Mimosa');
  assert.equal(m.animal(cria).sexo, 'F');
  const linha = m.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === r.dados.event_id && l.papel === 'CRIA');
  assert.equal(linha.atributos_iniciais_json.sexo, 'M', 'o atributo de criação é imutável');
  assert.equal(ficha(c, cria).geral.categoria.codigo, 'BEZERRA');
});

test('CT-01 passo 3: gemelar com um vivo e um natimorto → +1 cabeça; REPRODUCAO com 1 vivo e 1 natimorto; gêmeos vivos → +2 numa linha de parto só', () => {
  const { c, m, matriz, vaca } = rebanho();
  const t0 = m.inventario('2026-11-13').total;
  const r = m.run('registrar', nascimento('2026-09-12', matriz, [viva({ sexo: 'F' }), natimorto()], { tipo_parto: 'ASSISTIDO' }));
  assert.equal(m.inventario('2026-11-13').total, t0 + 1);
  assert.equal(r.dados.animais.length, 2, 'a mãe e a única cria viva');
  const rep = m.tabela('REPRODUCAO').filter((p) => p.event_id === r.dados.event_id);
  assert.deepEqual(rep.map((p) => [p.qtd_nascidos_vivos, p.qtd_natimortos, p.tipo_parto]), [[1, 1, 'ASSISTIDO']]);
  assert.equal(m.tabela('EVENTO_ANIMAIS').filter((l) => l.event_id === r.dados.event_id && l.papel === 'CRIA').length, 1, 'natimorto não cria animal');
  const g = m.run('registrar', nascimento('2026-10-01', vaca, [viva({ brinco: '7001' }), viva({ brinco: '7002', sexo: 'F', peso: 28.5, metodo_pesagem: 'FITA' })]));
  assert.equal(m.inventario('2026-11-13').total, t0 + 3);
  const repG = m.tabela('REPRODUCAO').filter((p) => p.event_id === g.dados.event_id);
  assert.deepEqual(repG.map((p) => [p.qtd_nascidos_vivos, p.qtd_natimortos]), [[2, 0]], 'parto gemelar: uma linha PARTO');
  assert.deepEqual(['7001', '7002'].map((b) => m.porBrinco(b).mae_id), [vaca, vaca]);
  assert.deepEqual(m.tabela('PESAGENS').filter((p) => p.event_id === g.dados.event_id).map((p) => [p.peso_kg, p.metodo]), [[28.5, 'FITA']], 'peso só da cria pesada');
  const hv = ficha(c, vaca).reprodutivo;
  assert.deepEqual([hv.partos_previos, hv.partos_registrados, hv.n_partos, hv.partos[0].gemelar], [2, 1, 3, true], 'partos prévios declarados + o registrado depois da entrada');
});

test('natimorto sem nenhum vivo: nenhum animal, parto conta para "parida" e intervalo, sem cria ao pé', () => {
  const { c, m, novilha } = rebanho();
  const t0 = m.inventario('2026-11-13').total;
  const r = m.run('registrar', nascimento('2026-06-01', novilha, [natimorto()]), { avisos: ['IDADE_REPRODUTIVA'] });
  assert.equal(m.inventario('2026-11-13').total, t0);
  assert.deepEqual(r.dados.animais.map((a) => a.animal_id), [novilha]);
  const mae = m.animal(novilha);
  assert.deepEqual([mae.situacao_reprodutiva, mae.cria_ao_pe], ['VAZIA', false]);
  assert.equal(categoriaEm(c, novilha, '2026-06-01'), 'VACA', 'parida mesmo com zero vivos (DV-15)');
  assert.deepEqual(m.tabela('REPRODUCAO').filter((p) => p.event_id === r.dados.event_id).map((p) => [p.qtd_nascidos_vivos, p.qtd_natimortos]), [[0, 1]]);
});

// ------------------------------------------------------------------ regras ----
test('validações do parto: matriz fêmea, no rebanho e nascida antes; crias com sexo, até 4, peso na faixa; pasto ativo; tudo ou nada', () => {
  const { m, matriz, touro, novilha, ext } = rebanho();
  const n0 = m.contagem();
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', touro, [viva()]))), ['MATRIZ_NAO_FEMEA']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', ext, [viva()]))), ['ANIMAL_EXTERNO']);
  assert.deepEqual(codigos(falha(m, 'registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-09-12' }, animais: [{ animal_id: matriz }, { animal_id: novilha }], crias: [viva()] })), ['UMA_MATRIZ']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, []))), ['SEM_CRIAS']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva(), viva(), viva(), viva(), viva()]))), ['CRIAS_DEMAIS']);
  const e = falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva({ sexo: null }), viva({ peso: 2000.5, metodo_pesagem: 'BALANCA' }), viva({ peso: 30 }), { situacao_nascimento: 'OUTRA' }]));
  assert.equal(e.code, 'VALIDATION');
  assert.deepEqual(e.details.map((d) => d.campo + ':' + d.codigo).sort(), ['metodo_pesagem:CAMPO_OBRIGATORIO', 'peso:VALOR_FORA_DA_FAIXA', 'sexo:CAMPO_OBRIGATORIO', 'situacao_nascimento:VALOR_FORA_DA_LISTA'].sort());
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [{ situacao_nascimento: 'NATIMORTO', sexo: 'M' }]))), ['CAMPO_NAO_SE_APLICA'], 'natimorto não tem sexo gravado');
  assert.ok(e.details.every((d) => /^Cria \d/.test(d.mensagem)), 'cada erro diz qual cria');
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva()], { pasto_destino_id: PASTOS.INATIVO }))), ['PASTO_INATIVO']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva()], { pasto_destino_id: 'nao-existe' }))), ['NAO_ENCONTRADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-12-01', matriz, [viva()]))), ['DATA_FUTURA']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva({ brinco: '0102' })]))), ['BRINCO_DUPLICADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva({ brinco: '55' }), viva({ brinco: '055' })]))), ['BRINCO_REPETIDO']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva({ raca: 'ZEBU_DE_MARTE' })]))), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva()], { tipo_parto: 'NORMAL', campo_x: 1 }))), ['CAMPO_DESCONHECIDO']);
  assert.deepEqual(m.contagem(), n0, 'nada gravado');
});

test('pai opcional: touro do rebanho ou externo de referência; macho, nascido antes da cria, não a própria mãe; confiança obrigatória', () => {
  const { c, m, matriz, touro, ext, novilha, vaca } = rebanho();
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva()], { pai_id: touro }))), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva()], { pai_id: novilha, pai_confianca: 'CONFIRMADA' }))), ['SEXO_DO_PROGENITOR']);
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-09-12', matriz, [viva()], { pai_id: 'nao-existe', pai_confianca: 'CONFIRMADA' }))), ['NAO_ENCONTRADO']);
  const r = m.run('registrar', nascimento('2026-09-12', matriz, [viva(), viva({ sexo: 'F' })], { pai_id: touro, pai_confianca: 'CONFIRMADA' }));
  const crias = r.dados.animais.filter((a) => a.animal_id !== matriz).map((a) => m.animal(a.animal_id));
  assert.deepEqual(crias.map((x) => [x.pai_id, x.pai_confianca]), [[touro, 'CONFIRMADA'], [touro, 'CONFIRMADA']]);
  assert.equal(m.tabela('REPRODUCAO').find((p) => p.event_id === r.dados.event_id).touro_id, touro, 'pai único vai para REPRODUCAO.touro_id');
  const rx = m.run('registrar', nascimento('2026-10-05', vaca, [viva()], { pai_id: ext, pai_confianca: 'ESTIMADA' }));
  assert.equal(m.animal(rx.dados.animais.find((a) => a.animal_id !== vaca).animal_id).pai_id, ext);
  assert.deepEqual(ficha(c, touro).genealogia.filhos.length, 2, 'as crias aparecem na ficha do touro');
});

test('avisos: idade reprodutiva da mãe (RN-061) e intervalo curto entre partos (RN-064), com aceite; um aviso por parto, não por cria', () => {
  const { m, novilha, matriz } = rebanho();
  const e = falha(m, 'registrar', nascimento('2026-08-01', novilha, [viva(), viva()]));
  assert.equal(e.code, 'NEEDS_CONFIRMATION');
  assert.deepEqual(codigos(e), ['IDADE_REPRODUTIVA'], 'novilha de 18 meses: um aviso só, mesmo com gêmeos');
  assert.match(e.details[0].mensagem, /^0150: a mãe tinha 18 meses no parto, abaixo da idade reprodutiva mínima \(24 meses\)/);
  const r = m.run('registrar', nascimento('2026-08-01', novilha, [viva(), viva()]), { avisos: ['IDADE_REPRODUTIVA'] });
  assert.deepEqual(js(m.evento(r.dados.event_id).payload_json), { avisos_aceitos: [{ codigo: 'IDADE_REPRODUTIVA', n: 1 }] });
  m.run('registrar', nascimento('2026-02-10', matriz, [viva()]));
  const i = falha(m, 'registrar', nascimento('2026-08-29', matriz, [viva()]));
  assert.deepEqual(codigos(i), ['INTERVALO_PARTO_CURTO'], 'segundo parto 200 dias após o primeiro');
  assert.match(i.details[0].mensagem, /outro parto registrado em 10\/02\/2026 \(200 dias antes\)/);
  // Retroativo: o parto novo antes de um já gravado também é conferido com o seguinte.
  const j = falha(m, 'registrar', nascimento('2026-01-20', matriz, [viva()]));
  assert.match(j.details.find((d) => d.codigo === 'INTERVALO_PARTO_CURTO').mensagem, /21 dias depois/);
  m.run('registrar', nascimento('2026-08-29', matriz, [viva()]), { avisos: ['INTERVALO_PARTO_CURTO'] });
  assert.equal(m.animal(matriz).situacao_reprodutiva, 'VAZIA', 'situação é projeção, nunca pré-condição (RN-065)');
});

test('linha do tempo: matriz fora do rebanho na data, parto depois da morte, antes do nascimento da mãe; fato no dia da saída é válido', () => {
  const { m, matriz, vaca, novilha } = rebanho();
  // Mãe morta em 01/05: parto no próprio dia é fato independente com limite inclusivo; no dia seguinte, não.
  m.run('registrar', { tipo: 'MORTE', campos: { event_date: '2026-05-01', causa: 'PARTO' }, animais: [{ animal_id: vaca }] });
  const e = falha(m, 'registrar', nascimento('2026-05-02', vaca, [viva()]));
  assert.deepEqual([e.code, codigos(e)], ['VALIDATION', ['APOS_MORTE']]);
  assert.match(e.details[0].mensagem, /^0300: o animal morreu em 01\/05\/2026 e não aceita o parto de 02\/05\/2026/);
  const r = m.run('registrar', nascimento('2026-05-01', vaca, [natimorto()]));
  assert.equal(m.evento(r.dados.event_id).status, 'CONFIRMADO', 'parto no dia da morte');
  // Mãe descartada em 10/03 e que volta em 01/06: parto entre as duas datas não cabe.
  m.run('registrar', { tipo: 'DESCARTE', campos: { event_date: '2026-03-10', destino: 'DOACAO', motivo: 'IDADE' }, animais: [{ animal_id: matriz }] });
  m.run('registrar', outraEntrada('2026-06-01', [{ animal_id: matriz, pasto_destino_id: PASTOS.B }]));
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-04-15', matriz, [viva()]))), ['FORA_DA_PERMANENCIA']);
  const volta = m.run('registrar', nascimento('2026-06-01', matriz, [viva()]));
  assert.equal(m.animal(volta.dados.animais.find((a) => a.animal_id !== matriz).animal_id).pasto_atual_id, PASTOS.B, 'no dia da volta: o pasto em que ela entrou');
  // Mãe nascida depois do parto informado: a data não cabe (antes do marco zero entra como histórico).
  assert.ok(codigos(falha(m, 'registrar', nascimento('2025-01-10', novilha, [viva()]))).includes('ANTES_DO_NASCIMENTO'));
});

test('pasto das crias: o da mãe no dia (mesmo depois de transferida no próprio dia), o informado ou erro quando a mãe está sem pasto', () => {
  const { m, matriz } = rebanho();
  m.run('registrar', transferencia('2026-07-10', PASTOS.A, PASTOS.C, [matriz]));
  const r = m.run('registrar', nascimento('2026-07-10', matriz, [viva()]));
  const cria = r.dados.animais.find((a) => a.animal_id !== matriz).animal_id;
  assert.equal(m.animal(cria).pasto_atual_id, PASTOS.C);
  const r2 = m.run('registrar', nascimento('2026-07-01', matriz, [viva()], { pasto_destino_id: PASTOS.B }), { avisos: ['INTERVALO_PARTO_CURTO'] });
  assert.equal(m.animal(r2.dados.animais.find((a) => a.animal_id !== matriz).animal_id).pasto_atual_id, PASTOS.B);
  // Lotação (RN-027): o Piquete aceita 2 cabeças.
  const l = falha(m, 'registrar', nascimento('2026-07-20', matriz, [viva(), viva(), viva()], { pasto_destino_id: PASTOS.PEQUENO }), { avisos: ['INTERVALO_PARTO_CURTO'] });
  assert.deepEqual(codigos(l), ['LOTACAO_ACIMA_DA_CAPACIDADE']);
});

test('parto antes do marco zero (04, seção 6): registro informativo, efeito 0, cria HISTORICO fora do inventário; conta para o histórico da matriz', () => {
  const { c, m, vaca, matriz } = rebanho();
  const t0 = m.inventario(D0).total;
  const r = m.run('registrar', nascimento('2024-08-15', vaca, [viva({ brinco: '6001', sexo: 'F' })]));
  const ev = m.evento(r.dados.event_id);
  assert.equal(ev.pre_marco_zero, true);
  const ea = m.tabela('EVENTO_ANIMAIS').filter((l) => l.event_id === ev.event_id);
  assert.deepEqual(ea.map((l) => [l.papel, l.efeito_inventario, l.pasto_destino_id]).sort(), [['CRIA', 0, null], ['MATRIZ', 0, null]].sort());
  const cria = m.porBrinco('6001');
  assert.deepEqual([cria.situacao_cadastral, cria.pasto_atual_id, cria.mae_id, cria.data_nascimento], ['HISTORICO', null, vaca, '2024-08-15']);
  assert.equal(m.inventario(D0).total, t0, 'fora do inventário');
  assert.equal(m.inventario('2026-11-13').total, t0);
  const g = ficha(c, vaca).reprodutivo;
  assert.deepEqual([g.partos_previos, g.partos_registrados, g.n_partos, g.partos[0].pre_marco_zero], [2, 1, 2, true], 'o parto antigo já estava entre os 2 declarados: vale o maior');
  assert.equal(m.animal(vaca).situacao_reprodutiva, 'VAZIA');
  // Validado só contra o nascimento e a chegada declarada.
  assert.ok(codigos(falha(m, 'registrar', nascimento('2021-01-01', matriz, [viva()]))).includes('ANTES_DO_NASCIMENTO'));
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2025-12-01', vaca, [viva()], { pasto_destino_id: 'nao-existe' }))), ['NAO_ENCONTRADO']);
});

// ------------------------------------------------------------------ simulação, estorno e correção ----
test('simulação: mesma validação e mesmos impactos, nada gravado', () => {
  const { m, matriz } = rebanho();
  const antes = m.contagem();
  const s = m.simular('registrar', nascimento('2026-09-12', matriz, [viva(), natimorto()]));
  assert.equal(s.ok, true);
  assert.deepEqual([s.valor.dados.simulacao, s.valor.dados.impactos.novos, s.valor.dados.impactos.parto.nascidos_vivos, s.valor.dados.impactos.parto.natimortos, s.valor.dados.impactos.parto.pasto_destino_id], [true, 1, 1, 1, PASTOS.A]);
  assert.deepEqual(s.valor.dados.linhas.REPRODUCAO, 1);
  assert.deepEqual(m.contagem(), antes);
  const e = m.simular('registrar', nascimento('2026-09-12', matriz, []));
  assert.deepEqual([e.ok, e.erro.code, codigos(e.erro)], [false, 'VALIDATION', ['SEM_CRIAS']]);
});

test('estorno: crias anuladas, a matriz volta ao histórico anterior; bloqueado por evento posterior da cria (CONFLICT com o evento)', () => {
  const { m, matriz } = rebanho();
  const r = m.run('registrar', nascimento('2026-09-12', matriz, [viva({ brinco: '8001' }), viva({ sexo: 'F' })]));
  const [b1, b2] = r.dados.animais.filter((a) => a.animal_id !== matriz).map((a) => a.animal_id);
  const t = m.run('registrar', transferencia('2026-10-01', PASTOS.A, PASTOS.B, [b2]));
  const e = falha(m, 'estornar', { event_id: r.dados.event_id, justificativa: 'Lançado na vaca errada' });
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.animal_id, d.conflito.event_id, d.conflito.tipo, d.conflito.data]), [['EVENTO_DEPENDENTE', b2, t.dados.event_id, 'TRANSFERENCIA', '2026-10-01']]);
  m.run('estornar', { event_id: t.dados.event_id, justificativa: 'Transferência lançada por engano' });
  m.run('estornar', { event_id: r.dados.event_id, justificativa: 'Lançado na vaca errada' });
  assert.deepEqual([m.animal(b1).situacao_cadastral, m.animal(b2).situacao_cadastral], ['ANULADO', 'ANULADO']);
  const mae = m.animal(matriz);
  assert.deepEqual([mae.situacao_reprodutiva, mae.cria_ao_pe], ['SEM_INFORMACAO', false]);
  assert.equal(m.inventario('2026-11-13').total, 4);
  // O brinco da cria anulada fica livre (fora da unicidade).
  m.run('registrar', nascimento('2026-09-13', matriz, [viva({ brinco: '8001' })]));
});

test('estorno de parto bloqueado quando a cria já é mãe de outro animal (referência fora da linha do tempo)', () => {
  const { m, matriz } = rebanho();
  const r = m.run('registrar', nascimento('2026-01-05', matriz, [viva({ sexo: 'F', brinco: '9001' })]));
  const filha = m.porBrinco('9001').animal_id;
  const neta = m.run('registrar', outraEntrada('2026-03-01', [bicho({ brinco: '9002', mae_id: filha, mae_confianca: 'ESTIMADA' })]), { avisos: ['IDADE_REPRODUTIVA'] });
  const e = falha(m, 'estornar', { event_id: r.dados.event_id, justificativa: 'x' });
  assert.equal(e.code, 'CONFLICT');
  assert.ok(e.details.some((d) => d.codigo === 'REFERENCIA_GENEALOGICA' && d.animal_id === filha && d.conflito.event_id === neta.dados.event_id));
});

test('correção: mesmos animal_id, mudança de sexo, peso e data; viva → natimorta anula a cria; bloqueada quando a cria anulada tem dependente', () => {
  const { m, matriz, touro } = rebanho();
  const r = m.run('registrar', nascimento('2026-09-12', matriz, [viva({ peso: 30, metodo_pesagem: 'BALANCA' }), viva({ sexo: 'F' })]));
  const [b1, b2] = r.dados.animais.filter((a) => a.animal_id !== matriz).map((a) => a.animal_id);
  const cod = [m.animal(b1).codigo_interno, m.animal(b2).codigo_interno];
  const c1 = m.run('corrigir', Object.assign(nascimento('2026-09-10', matriz, [viva({ animal_id: b1, sexo: 'F', peso: 31.5, metodo_pesagem: 'BALANCA' }), viva({ animal_id: b2, sexo: 'F' })], { pai_id: touro, pai_confianca: 'ESTIMADA' }), { event_id: r.dados.event_id, justificativa: 'Data e pai conferidos' }));
  assert.equal(m.evento(r.dados.event_id).status, 'ESTORNADO');
  assert.deepEqual([m.animal(b1).codigo_interno, m.animal(b2).codigo_interno], cod, 'mesmos animais');
  assert.deepEqual([m.animal(b1).sexo, m.animal(b1).data_nascimento, m.animal(b1).peso_atual, m.animal(b1).pai_id, m.animal(b1).evento_origem_id], ['F', '2026-09-10', 31.5, touro, c1.dados.event_id]);
  assert.equal(m.tabela('REPRODUCAO').filter((p) => p.animal_id === matriz && p.tipo_evento === 'PARTO').filter((p) => m.evento(p.event_id).status === 'CONFIRMADO').length, 1, 'um parto vigente');
  assert.equal(m.inventario('2026-09-10').total, 6);
  // A segunda cria passa a natimorta: é anulada (sem dependentes).
  const c2 = m.run('corrigir', Object.assign(nascimento('2026-09-10', matriz, [viva({ animal_id: b1, sexo: 'F', peso: 31.5, metodo_pesagem: 'BALANCA' }), natimorto()]), { event_id: c1.dados.event_id, justificativa: 'A segunda nasceu morta' }));
  assert.equal(m.animal(b2).situacao_cadastral, 'ANULADO');
  assert.deepEqual(m.tabela('REPRODUCAO').filter((p) => p.event_id === c2.dados.event_id).map((p) => [p.qtd_nascidos_vivos, p.qtd_natimortos]), [[1, 1]]);
  // Com uma transferência da cria, mudar a data do parto para depois dela é CONFLICT; tirar a cria também.
  const t = m.run('registrar', transferencia('2026-09-20', PASTOS.A, PASTOS.B, [b1]));
  const e1 = falha(m, 'corrigir', Object.assign(nascimento('2026-09-25', matriz, [viva({ animal_id: b1, sexo: 'F' }), natimorto()]), { event_id: c2.dados.event_id, justificativa: 'x' }));
  assert.equal(e1.code, 'CONFLICT');
  assert.ok(e1.details.every((d) => d.conflito.event_id === t.dados.event_id), JSON.stringify(e1.details));
  const e2 = falha(m, 'corrigir', Object.assign(nascimento('2026-09-10', matriz, [natimorto(), natimorto()]), { event_id: c2.dados.event_id, justificativa: 'x' }));
  assert.deepEqual([e2.code, e2.details[0].codigo, e2.details[0].conflito.event_id], ['CONFLICT', 'EVENTO_DEPENDENTE', t.dados.event_id]);
  // Mudar só observações e tipo de parto nunca é bloqueado pelos dependentes (RN-045).
  const c3 = m.run('corrigir', Object.assign(nascimento('2026-09-10', matriz, [viva({ animal_id: b1, sexo: 'F', peso: 31.5, metodo_pesagem: 'BALANCA', observacoes: 'mamou logo' }), natimorto()], { tipo_parto: 'NORMAL', notes: 'parto à noite' }), { event_id: c2.dados.event_id, justificativa: 'Observações' }));
  assert.equal(m.animal(b1).pasto_atual_id, PASTOS.B);
  // Cria de outro parto não entra como animal reaproveitado.
  const outro = m.run('registrar', nascimento('2026-10-20', m.porBrinco('0300').animal_id, [viva()]));
  const alheia = outro.dados.animais.find((a) => a.sexo === 'M').animal_id;
  const e3 = falha(m, 'corrigir', Object.assign(nascimento('2026-09-10', matriz, [viva({ animal_id: alheia })]), { event_id: c3.dados.event_id, justificativa: 'x' }));
  assert.ok(codigos(e3).includes('SO_ANIMAIS_NOVOS'), JSON.stringify(e3));
});

test('retroativo: parto antes de uma transferência da mãe não quebra a cadeia (fato); depois da saída dela é recusado', () => {
  const { m, matriz } = rebanho();
  m.run('registrar', transferencia('2026-08-01', PASTOS.A, PASTOS.B, [matriz]));
  m.run('registrar', { tipo: 'MORTE', campos: { event_date: '2026-10-01', causa: 'RAIO' }, animais: [{ animal_id: matriz }] });
  const r = m.run('registrar', nascimento('2026-07-15', matriz, [viva()]));
  const cria = r.dados.animais.find((a) => a.animal_id !== matriz).animal_id;
  assert.deepEqual([m.animal(cria).pasto_atual_id, m.animal(cria).situacao_cadastral], [PASTOS.A, 'ATIVO'], 'a cria ficou no pasto onde nasceu');
  assert.deepEqual(codigos(falha(m, 'registrar', nascimento('2026-10-05', matriz, [viva()]))), ['APOS_MORTE']);
});

test('reenvio com a mesma chave não duplica o parto; duplicidade semântica (mesma mãe, mesmo dia) pede confirmação', () => {
  const { m, matriz } = rebanho();
  const d = nascimento('2026-09-12', matriz, [viva()]);
  const a = m.run('registrar', d, { chave: 'parto-1' });
  const b = m.run('registrar', d, { chave: 'parto-1' });
  assert.deepEqual([b.duplicado, b.dados.event_id], [true, a.dados.event_id]);
  const e = falha(m, 'registrar', d);
  assert.deepEqual(codigos(e).sort(), ['INTERVALO_PARTO_CURTO', 'POSSIVEL_DUPLICIDADE']);
  assert.equal(e.details.find((x) => x.codigo === 'POSSIVEL_DUPLICIDADE').conflito.event_id, a.dados.event_id);
});
