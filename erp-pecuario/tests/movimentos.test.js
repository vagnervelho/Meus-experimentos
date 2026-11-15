'use strict';
/**
 * TRANSFERENCIA (E2.2), MORTE e DESCARTE (E2.5): CT-02 completo e CT-17 (a) (09, seção 3 e 4), regras de 05
 * (RN-014 a RN-020, RN-027, RN-028), BAIXAS (03b, seção 8), situação final (03a, 4.3.4), fato posterior recusado,
 * fato no dia da saída, estorno e correção com evento posterior dependente, a ficha (bloco D: pastos e dias de
 * permanência), a consulta `inventario.elegiveis` e as rotas pela api(). Depois de CADA comando o apoio confere
 * projeção gravada = reconstrução (Timeline.conferir vazio).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./apoio-cadastros');
const S = require('./apoio-sistema');

const { js, D0, PASTOS, bicho, entradaInicial, outraEntrada, codigos } = C;

function transferencia(data, origem, destino, ids, campos) {
  return { tipo: 'TRANSFERENCIA', campos: Object.assign({ event_date: data, pasto_origem_id: origem, pasto_destino_id: destino }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) };
}
function morte(data, ids, campos) {
  return { tipo: 'MORTE', campos: Object.assign({ event_date: data, causa: 'DOENCA' }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) };
}
function descarte(data, ids, campos) {
  return { tipo: 'DESCARTE', campos: Object.assign({ event_date: data, destino: 'CONSUMO_PROPRIO', motivo: 'IDADE' }, campos || {}), animais: ids.map((animal_id) => ({ animal_id })) };
}
function falha(m, acao, dados, op) {
  const r = m.tentar(acao, dados, op);
  assert.equal(r.ok, false, 'o comando deveria ter sido recusado');
  return r.erro;
}
/** Rebanho do CT-02: 0201–0210 no Pasto 1 (A) e 0211 no Pasto 2 (B), em D0. */
function rebanho() {
  const c = C.ambienteCadastros();
  const m = c.m;
  const animais = [];
  for (let i = 1; i <= 10; i++) animais.push(bicho({ brinco: '02' + String(i).padStart(2, '0'), sexo: i % 2 ? 'F' : 'M', data_nascimento: '2023-01-01', data_nascimento_confianca: 'ESTIMADA' }));
  animais.push(bicho({ brinco: '0211', pasto_destino_id: PASTOS.B }));
  const r = m.run('registrar', entradaInicial(animais));
  const ids = {};
  r.dados.animais.forEach((a) => { ids[a.brinco] = a.animal_id; });
  return { c, m, G: c.G, ids, lote: Object.keys(ids).filter((b) => b !== '0211').map((b) => ids[b]) };
}
const ficha = (c, id) => c.ler(c.G.AnimalService.consultaFicha({ animal_id: id }));

// ------------------------------------------------------------------ CT-02 ----
test('CT-02: transferência coletiva é tudo ou nada; reenvio sem o animal errado com a mesma chave; inventário nas datas e dias no pasto', () => {
  const { c, m, ids, lote } = rebanho();
  const ops0 = m.tabela('OPERACOES').length;
  const n0 = m.contagem();
  const e = falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, lote.concat([ids['0211']])), { chave: 'ct02' });
  assert.equal(e.code, 'VALIDATION');
  assert.equal(e.details.length, 1, 'um detalhe só');
  assert.deepEqual([e.details[0].codigo, e.details[0].animal_id, e.details[0].brinco], ['ORIGEM_DIVERGENTE', ids['0211'], '0211']);
  assert.match(e.details[0].mensagem, /^0211: a transferência de 01\/03\/2026 parte do pasto Pasto A, mas nessa data o animal estaria no pasto Pasto B/);
  assert.deepEqual(m.contagem(), n0, 'nada gravado');
  assert.equal(m.tabela('OPERACOES').length, ops0, 'nem em OPERACOES');
  const r = m.run('registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, lote), { chave: 'ct02' });
  assert.equal(r.duplicado, false);
  const ea = m.tabela('EVENTO_ANIMAIS').filter((l) => l.event_id === r.dados.event_id);
  assert.equal(ea.length, 10);
  assert.ok(ea.every((l) => l.efeito_inventario === 0 && l.pasto_origem_id === PASTOS.A && l.pasto_destino_id === PASTOS.B && l.papel === 'SUJEITO'));
  const hoje = m.inventario('2026-11-13');
  assert.deepEqual([hoje.total, hoje.porPasto[PASTOS.A] || 0, hoje.porPasto[PASTOS.B]], [11, 0, 11]);
  const antes = m.inventario('2026-02-28');
  assert.deepEqual([antes.total, antes.porPasto[PASTOS.A], antes.porPasto[PASTOS.B]], [11, 10, 1]);
  assert.deepEqual(lote.map((id) => m.animal(id).pasto_atual_id), lote.map(() => PASTOS.B));
  assert.equal(m.animal(ids['0201']).data_ultimo_movimento, '2026-03-01');
  // Histórico de 0201: entrada (01/01) e transferência (01/03); 59 dias no Pasto 1 (o dia da saída não conta).
  const f = ficha(c, ids['0201']);
  assert.deepEqual(f.pastos.periodos.map((p) => [p.pasture_id, p.inicio, p.fim, p.dias, p.entrada.event_type, p.saida ? p.saida.event_type : null]),
    [[PASTOS.A, D0, '2026-03-01', 59, 'ENTRADA_INICIAL', 'TRANSFERENCIA'], [PASTOS.B, '2026-03-01', null, 257, 'TRANSFERENCIA', null]]);
  assert.deepEqual(f.pastos.por_pasto.map((p) => [p.pasture_id, p.dias, p.atual]), [[PASTOS.B, 257, true], [PASTOS.A, 59, false]]);
  assert.deepEqual(f.eventos.itens.map((x) => x.event_type), ['ENTRADA_INICIAL', 'TRANSFERENCIA']);
  // Reenvio com a mesma chave depois do sucesso: duplicado, sem nova linha.
  const d = m.run('registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, lote), { chave: 'ct02' });
  assert.deepEqual([d.duplicado, d.dados.event_id], [true, r.dados.event_id]);
});

// ------------------------------------------------------------------ CT-17 (a) ----
test('CT-17 (a): transferência com data passada que quebra a cadeia gravada → CONFLICT citando a de 10/03; mesmo dia: entrada, movimentos, saída', () => {
  const { m, ids } = rebanho();
  const a = ids['0201'];
  const t10 = m.run('registrar', transferencia('2026-03-10', PASTOS.A, PASTOS.C, [a]));
  const e = falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, [a]));
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.animal_id, d.conflito.event_id, d.conflito.tipo, d.conflito.data]), [['ORIGEM_DIVERGENTE', a, t10.dados.event_id, 'TRANSFERENCIA', '2026-03-10']]);
  assert.match(e.details[0].mensagem, /^0201: a transferência de 10\/03\/2026 parte do pasto Pasto A, mas nessa data o animal estaria no pasto Pasto B/);
  // A correção da de 10/03 para B → C sozinha não cabe (em 10/03 o animal ainda está no A): VALIDATION da própria linha.
  const c10 = falha(m, 'corrigir', Object.assign(transferencia('2026-03-10', PASTOS.B, PASTOS.C, [a]), { event_id: t10.dados.event_id, justificativa: 'Saiu do Pasto B' }));
  assert.deepEqual([c10.code, codigos(c10)], ['VALIDATION', ['ORIGEM_DIVERGENTE']]);
  // Saída do exemplo (i) de 04, seção 5.2: estornar a de 10/03, lançar a de 01/03 e relançar a de 10/03 partindo do B.
  m.run('estornar', { event_id: t10.dados.event_id, justificativa: 'Faltou a passagem pelo Pasto B' });
  m.run('registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, [a]));
  m.run('registrar', transferencia('2026-03-10', PASTOS.B, PASTOS.C, [a]));
  assert.deepEqual([m.pastoEm(a, '2026-03-05').pasture_id, m.animal(a).pasto_atual_id], [PASTOS.B, PASTOS.C]);
  // Dois movimentos no mesmo dia valem na ordem de registro (classe 1, event_seq).
  const b = ids['0202'];
  m.run('registrar', transferencia('2026-04-01', PASTOS.A, PASTOS.B, [b]));
  const dup = falha(m, 'registrar', transferencia('2026-04-01', PASTOS.B, PASTOS.C, [b]));
  assert.deepEqual(codigos(dup), ['POSSIVEL_DUPLICIDADE'], 'mesmo tipo, mesma data e mesmos animais: pede confirmação');
  m.run('registrar', transferencia('2026-04-01', PASTOS.B, PASTOS.C, [b]), { avisos: ['POSSIVEL_DUPLICIDADE'] });
  assert.equal(m.pastoEm(b, '2026-04-01').pasture_id, PASTOS.C);
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-04-01', PASTOS.A, PASTOS.C, [b]))), ['ORIGEM_DIVERGENTE']);
  // Saída e movimento no mesmo dia: a morte de 20/06 (origem C) fica sem origem se uma transferência do mesmo dia entrar antes dela.
  const mo = m.run('registrar', morte('2026-06-20', [b]));
  assert.equal(m.tabela('EVENTO_ANIMAIS').find((l) => l.event_id === mo.dados.event_id).pasto_origem_id, PASTOS.C, 'origem da saída tirada da linha do tempo');
  const e2 = falha(m, 'registrar', transferencia('2026-06-20', PASTOS.C, PASTOS.A, [b]));
  assert.deepEqual([e2.code, e2.details[0].codigo, e2.details[0].conflito.event_id], ['CONFLICT', 'ORIGEM_DIVERGENTE', mo.dados.event_id]);
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-06-21', PASTOS.C, PASTOS.A, [b]))), ['APOS_MORTE'], 'depois da morte: VALIDATION');
});

// ------------------------------------------------------------------ transferência: regras ----
test('transferência: destino diferente da origem, existente e ativo; animal externo, vendido ou morto; campo por animal desconhecido; GTA no payload', () => {
  const { m, ids, c } = rebanho();
  const a = ids['0201'];
  const ext = c.run('AnimalService.comandoCadastrarExterno', { campos: { nome: 'Touro do sêmen', sexo: 'M' } }).dados.animal_id;
  const n0 = m.contagem();
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.A, [a]))), ['DESTINO_IGUAL_ORIGEM']);
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.INATIVO, [a]))), ['PASTO_INATIVO']);
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, 'nao-existe', [a]))), ['NAO_ENCONTRADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-01', 'nao-existe', PASTOS.B, [a]))), ['NAO_ENCONTRADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-01', null, PASTOS.B, [a]))), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, [ext]))), ['ANIMAL_EXTERNO']);
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, ['nao-existe']))), ['NAO_ENCONTRADO']);
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, [a, a]))), ['ANIMAL_REPETIDO']);
  assert.deepEqual(codigos(falha(m, 'registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: a, peso: 300 }] })), ['CAMPO_DESCONHECIDO']);
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2025-12-01', PASTOS.A, PASTOS.B, [a]))), ['ANTES_DO_MARCO_ZERO'], 'transferência não tem registro histórico');
  assert.deepEqual(m.contagem(), n0);
  m.run('registrar', morte('2026-02-01', [a]));
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, [a]))), ['APOS_MORTE']);
  const b = ids['0202'];
  m.run('registrar', descarte('2026-02-01', [b]));
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, [b]))), ['FORA_DO_REBANHO']);
  const r = m.run('registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.C, [ids['0203']], { gta_numero: ' 123456 ', responsible: 'Zé', notes: 'Para o pasto alugado' }));
  const ev = m.evento(r.dados.event_id);
  assert.deepEqual([js(ev.payload_json), ev.responsible, ev.notes], [{ gta_numero: '123456' }, 'Zé', 'Para o pasto alugado']);
  assert.equal(m.obter(r.dados.event_id).evento.payload.gta_numero, '123456');
});

test('transferência: lotação acima da capacidade pede confirmação (RN-027); aceite fica no payload', () => {
  const { m, lote } = rebanho();
  const e = falha(m, 'registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.PEQUENO, lote.slice(0, 3)));
  assert.deepEqual([e.code, codigos(e)], ['NEEDS_CONFIRMATION', ['LOTACAO_ACIMA_DA_CAPACIDADE']]);
  assert.match(e.details[0].mensagem, /Piquete fica com 3 cabeças em 01\/03\/2026, acima da capacidade informada \(2\)/);
  const r = m.run('registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.PEQUENO, lote.slice(0, 3)), { avisos: ['LOTACAO_ACIMA_DA_CAPACIDADE'] });
  assert.deepEqual(js(m.evento(r.dados.event_id).payload_json), { avisos_aceitos: [{ codigo: 'LOTACAO_ACIMA_DA_CAPACIDADE', n: 1 }] });
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-03-02', PASTOS.A, PASTOS.PEQUENO, []))), ['SEM_ANIMAIS']);
});

test('transferência: estorno com transferência posterior dependente → CONFLICT; sem dependente, volta ao pasto anterior; correção de destino', () => {
  const { m, ids } = rebanho();
  const a = ids['0201'];
  const t1 = m.run('registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, [a, ids['0202']]));
  const t2 = m.run('registrar', transferencia('2026-04-01', PASTOS.B, PASTOS.C, [a]));
  const e = falha(m, 'estornar', { event_id: t1.dados.event_id, justificativa: 'Lançada errada' });
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.animal_id, d.conflito.event_id, d.conflito.data]), [['ORIGEM_DIVERGENTE', a, t2.dados.event_id, '2026-04-01']]);
  // Correção estrutural (destino) também é validada contra a de 01/04.
  const e2 = falha(m, 'corrigir', Object.assign(transferencia('2026-03-01', PASTOS.A, PASTOS.C, [a, ids['0202']]), { event_id: t1.dados.event_id, justificativa: 'Foi para o C' }));
  assert.deepEqual([e2.code, e2.details[0].conflito.event_id], ['CONFLICT', t2.dados.event_id]);
  // Correção sem mudar a estrutura (observações) não é bloqueada.
  const c1 = m.run('corrigir', Object.assign(transferencia('2026-03-01', PASTOS.A, PASTOS.B, [a, ids['0202']], { notes: 'Chuva' }), { event_id: t1.dados.event_id, justificativa: 'Faltou a observação' }));
  assert.equal(m.evento(t1.dados.event_id).status, 'ESTORNADO');
  assert.deepEqual(js(m.evento(c1.dados.event_id).payload_json), { justificativa: 'Faltou a observação' });
  // Tirar 0202 da transferência na correção: ele volta para o Pasto A.
  const c2 = m.run('corrigir', Object.assign(transferencia('2026-03-01', PASTOS.A, PASTOS.B, [a]), { event_id: c1.dados.event_id, justificativa: 'O 0202 ficou' }));
  assert.equal(m.animal(ids['0202']).pasto_atual_id, PASTOS.A);
  m.run('estornar', { event_id: t2.dados.event_id, justificativa: 'Não saiu do B' });
  m.run('estornar', { event_id: c2.dados.event_id, justificativa: 'Não saiu do A' });
  assert.deepEqual([m.animal(a).pasto_atual_id, m.animal(a).data_ultimo_movimento], [PASTOS.A, D0]);
  assert.equal(m.inventario('2026-11-13').porPasto[PASTOS.A], 10);
});

// ------------------------------------------------------------------ morte e descarte ----
test('morte: BAIXAS com causa, diagnóstico e responsável; MORTO terminal; fatos posteriores e reentrada recusados; inventário nas datas', () => {
  const { c, m, ids } = rebanho();
  const a = ids['0201'];
  const b = ids['0203'];
  const n0 = m.contagem();
  assert.deepEqual(codigos(falha(m, 'registrar', morte('2026-05-01', [a], { causa: null }))), ['CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(falha(m, 'registrar', morte('2026-05-01', [a], { causa: 'BRUXARIA' }))), ['VALOR_FORA_DA_LISTA']);
  assert.deepEqual(codigos(falha(m, 'registrar', morte('2026-05-01', [a], { destino: 'DOACAO' }))), ['CAMPO_DESCONHECIDO'], 'destino é do descarte');
  assert.deepEqual(m.contagem(), n0);
  const r = m.run('registrar', { tipo: 'MORTE', campos: { event_date: '2026-05-01', causa: 'RAIO', diagnostico: 'Tempestade da madrugada', responsible: 'Vaqueiro João', notes: 'Perto da cerca' }, animais: [{ animal_id: a, observacoes: 'Achado de manhã' }, { animal_id: b }] });
  const bx = m.tabela('BAIXAS').filter((x) => x.event_id === r.dados.event_id);
  assert.deepEqual(bx.map((x) => [x.animal_id, x.tipo, x.causa, x.diagnostico, x.motivo, x.destino, x.responsavel, x.observacoes]),
    [[a, 'MORTE', 'RAIO', 'Tempestade da madrugada', null, null, 'Vaqueiro João', 'Achado de manhã'], [b, 'MORTE', 'RAIO', 'Tempestade da madrugada', null, null, 'Vaqueiro João', null]]);
  const ea = m.tabela('EVENTO_ANIMAIS').filter((l) => l.event_id === r.dados.event_id);
  assert.ok(ea.every((l) => l.efeito_inventario === -1 && l.pasto_origem_id === PASTOS.A && l.pasto_destino_id === null));
  assert.deepEqual([m.animal(a).situacao_cadastral, m.animal(a).data_saida, m.animal(a).pasto_atual_id, m.animal(a).propriedade_atual_id], ['MORTO', '2026-05-01', null, null]);
  assert.deepEqual([m.inventario('2026-04-30').total, m.inventario('2026-05-01').total], [11, 9], 'a saída vale ao fim do dia');
  assert.equal(m.obter(r.dados.event_id).detalhes.BAIXAS.length, 2);
  assert.deepEqual(codigos(falha(m, 'registrar', morte('2026-06-01', [a]))), ['APOS_MORTE']);
  assert.deepEqual(codigos(falha(m, 'registrar', morte('2026-05-01', [a]))), ['FORA_DO_REBANHO'], 'não morre duas vezes no mesmo dia');
  assert.deepEqual(codigos(falha(m, 'registrar', outraEntrada('2026-07-01', [{ animal_id: a, pasto_destino_id: PASTOS.A }]))), ['ANIMAL_MORTO'], 'MORTO não volta ao rebanho (RN-015)');
  assert.equal(ficha(c, a).pastos.periodos[0].fim, '2026-05-01');
  // Animal sem brinco também morre (aceita animal sem brinco).
  const semBrinco = m.run('registrar', outraEntrada('2026-02-01', [bicho()])).dados.animais[0].animal_id;
  m.run('registrar', morte('2026-02-02', [semBrinco], { causa: 'DESCONHECIDA' }));
  assert.equal(m.animal(semBrinco).situacao_cadastral, 'MORTO');
});

test('morte retroativa com fatos posteriores → CONFLICT listando-os; estorno devolve ATIVO; estorno bloqueado não existe para morte sem dependentes', () => {
  const { m, ids } = rebanho();
  const a = ids['0201'];
  const t = m.run('registrar', transferencia('2026-06-01', PASTOS.A, PASTOS.B, [a]));
  const e = falha(m, 'registrar', morte('2026-05-01', [a]));
  assert.equal(e.code, 'CONFLICT');
  assert.deepEqual(e.details.map((d) => [d.codigo, d.conflito.event_id]), [['APOS_MORTE', t.dados.event_id]]);
  const r = m.run('registrar', morte('2026-07-01', [a], { causa: 'ACIDENTE' }));
  assert.equal(m.animal(a).situacao_cadastral, 'MORTO');
  // Correção: mudar a data da morte para antes da transferência é estrutural → CONFLICT; mudar a causa vale.
  const e2 = falha(m, 'corrigir', Object.assign(morte('2026-05-15', [a]), { event_id: r.dados.event_id, justificativa: 'Data errada' }));
  assert.deepEqual([e2.code, e2.details[0].conflito.event_id], ['CONFLICT', t.dados.event_id]);
  const c1 = m.run('corrigir', Object.assign(morte('2026-07-01', [a], { causa: 'PICADA_COBRA' }), { event_id: r.dados.event_id, justificativa: 'Causa confirmada' }));
  assert.deepEqual(m.tabela('BAIXAS').filter((x) => x.animal_id === a).map((x) => [x.event_id, x.causa]), [[r.dados.event_id, 'ACIDENTE'], [c1.dados.event_id, 'PICADA_COBRA']], 'BAIXAS do original fica, sem valer');
  assert.equal(m.obter(c1.dados.event_id).detalhes.BAIXAS[0].causa, 'PICADA_COBRA');
  m.run('estornar', { event_id: c1.dados.event_id, justificativa: 'Animal foi achado vivo' });
  assert.deepEqual([m.animal(a).situacao_cadastral, m.animal(a).pasto_atual_id, m.animal(a).data_saida], ['ATIVO', PASTOS.B, null]);
  assert.equal(m.inventario('2026-11-13').total, 11);
});

test('morte da cria desliga a cria ao pé da mãe; estorno da morte religa', () => {
  const { m, ids } = rebanho();
  const mae = ids['0201'];
  const p = m.run('registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-04-01' }, animais: [{ animal_id: mae }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }, { avisos: ['IDADE_REPRODUTIVA'] });
  const cria = p.dados.animais.find((a) => a.animal_id !== mae).animal_id;
  assert.equal(m.animal(mae).cria_ao_pe, true);
  const mo = m.run('registrar', morte('2026-04-10', [cria], { causa: 'DOENCA' }));
  assert.equal(m.animal(mae).cria_ao_pe, false);
  m.run('estornar', { event_id: mo.dados.event_id, justificativa: 'Era outra bezerra' });
  assert.equal(m.animal(mae).cria_ao_pe, true);
});

test('descarte: motivo e destino da lista; BAIXAS; DESCARTADO admite reentrada; estorno bloqueado pela reentrada (CONFLICT com o evento)', () => {
  const { c, m, ids } = rebanho();
  const a = ids['0201'];
  assert.deepEqual(codigos(falha(m, 'registrar', descarte('2026-05-01', [a], { destino: null, motivo: null }))).sort(), ['CAMPO_OBRIGATORIO', 'CAMPO_OBRIGATORIO']);
  assert.deepEqual(codigos(falha(m, 'registrar', descarte('2026-05-01', [a], { destino: 'VENDA' }))), ['VALOR_FORA_DA_LISTA'], 'venda é VENDA, nunca descarte');
  assert.deepEqual(codigos(falha(m, 'registrar', descarte('2026-05-01', [a], { causa: 'RAIO' }))), ['CAMPO_DESCONHECIDO']);
  const vendas0 = m.amb.tabela('VENDAS').length;
  const r = m.run('registrar', descarte('2026-05-01', [a], { destino: 'DOACAO', motivo: 'FALHA_REPRODUTIVA', responsible: 'Dono' }));
  assert.deepEqual(m.tabela('BAIXAS').filter((x) => x.event_id === r.dados.event_id).map((x) => [x.tipo, x.motivo, x.destino, x.causa, x.responsavel]), [['DESCARTE', 'FALHA_REPRODUTIVA', 'DOACAO', null, 'Dono']]);
  assert.equal(m.amb.tabela('VENDAS').length, vendas0, 'DESCARTE grava BAIXAS, nunca VENDAS');
  assert.deepEqual([m.animal(a).situacao_cadastral, m.animal(a).data_saida], ['DESCARTADO', '2026-05-01']);
  assert.equal(m.evento(r.dados.event_id).total_value, null, 'sem receita nesta etapa');
  assert.deepEqual(codigos(falha(m, 'registrar', transferencia('2026-05-02', PASTOS.A, PASTOS.B, [a]))), ['FORA_DO_REBANHO']);
  // Fato no próprio dia da saída é válido; reentrada depois.
  const volta = m.run('registrar', outraEntrada('2026-08-01', [{ animal_id: a, pasto_destino_id: PASTOS.C }]));
  assert.equal(m.animal(a).situacao_cadastral, 'ATIVO');
  const e = falha(m, 'estornar', { event_id: r.dados.event_id, justificativa: 'Não foi doado' });
  assert.deepEqual([e.code, e.details[0].codigo, e.details[0].conflito.event_id], ['CONFLICT', 'ENTRADA_JA_DENTRO', volta.dados.event_id]);
  // Correção do destino (não estrutural) vale mesmo com a reentrada posterior.
  const c1 = m.run('corrigir', Object.assign(descarte('2026-05-01', [a], { destino: 'PERMUTA', motivo: 'FALHA_REPRODUTIVA' }), { event_id: r.dados.event_id, justificativa: 'Foi trocado' }));
  assert.equal(m.tabela('BAIXAS').find((x) => x.event_id === c1.dados.event_id).destino, 'PERMUTA');
  const f = ficha(c, a);
  assert.deepEqual(f.pastos.periodos.map((p) => [p.pasture_id, p.inicio, p.fim]), [[PASTOS.A, D0, '2026-05-01'], [PASTOS.C, '2026-08-01', null]]);
  assert.deepEqual(f.pastos.por_pasto.map((p) => [p.pasture_id, p.dias]), [[PASTOS.A, 120], [PASTOS.C, 104]]);
});

test('saída coletiva é tudo ou nada; simulação de morte e de transferência não grava; data futura recusada', () => {
  const { m, ids, lote } = rebanho();
  m.run('registrar', morte('2026-02-01', [ids['0210']]));
  const n0 = m.contagem();
  const e = falha(m, 'registrar', descarte('2026-03-01', lote));
  assert.deepEqual([e.code, e.details.length, e.details[0].animal_id, e.details[0].codigo], ['VALIDATION', 1, ids['0210'], 'APOS_MORTE']);
  assert.deepEqual(m.contagem(), n0);
  const s = m.simular('registrar', morte('2026-03-01', lote.slice(0, 3)));
  assert.deepEqual([s.ok, s.valor.dados.impactos.baixas, s.valor.dados.linhas.BAIXAS, s.valor.dados.linhas.EVENTO_ANIMAIS], [true, 3, 3, 3]);
  const st = m.simular('registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, lote.slice(0, 2)));
  assert.deepEqual(js(st.valor.dados.impactos.transferencia), { pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B });
  assert.deepEqual(m.contagem(), n0, 'simulação não grava');
  assert.deepEqual(codigos(falha(m, 'registrar', morte('2026-11-20', [ids['0201']]))), ['DATA_FUTURA']);
  assert.deepEqual(codigos(falha(m, 'registrar', descarte('2025-11-20', [ids['0201']]))), ['ANTES_DO_MARCO_ZERO']);
});

// ------------------------------------------------------------------ inventario.elegiveis e rotas ----
test('inventario.elegiveis: posição na data pela linha do tempo (não a de hoje), por pasto e sexo do tipo; antes do marco zero → null com motivo', () => {
  const { c, m, G, ids, lote } = rebanho();
  m.run('registrar', transferencia('2026-03-01', PASTOS.A, PASTOS.B, lote.slice(0, 4)));
  m.run('registrar', morte('2026-04-01', [ids['0205']]));
  const el = (d) => c.ler(G.InventoryService.consultaElegiveis(d));
  const fev = el({ tipo: 'TRANSFERENCIA', data: '2026-02-15', pasture_id: PASTOS.A });
  assert.deepEqual([fev.n, fev.motivo, fev.pasture_id], [10, null, PASTOS.A], 'em 15/02 os 10 ainda estavam no A');
  assert.equal(el({ tipo: 'TRANSFERENCIA', data: '2026-03-01', pasture_id: PASTOS.A }).n, 6);
  assert.equal(el({ tipo: 'MORTE', data: '2026-04-01' }).n, 10, 'quem morreu no dia já não é elegível (fim do dia)');
  const partos = el({ tipo: 'NASCIMENTO', data: '2026-03-15' });
  assert.ok(partos.itens.every((x) => x.sexo === 'F') && partos.n === 6, 'só fêmeas para o parto');
  assert.deepEqual(js(el({ tipo: 'MORTE', data: '2025-12-31' })), { data: '2025-12-31', tipo: 'MORTE', pasture_id: null, motivo: 'ANTERIOR_AO_MARCO_ZERO', n: null, itens: null });
  assert.throws(() => el({ tipo: 'OUTRA_ENTRADA', data: '2026-03-01' }), (e) => e.code === 'VALIDATION' && e.details[0].codigo === 'TIPO_SEM_ELEGIVEIS');
  assert.throws(() => el({ tipo: 'COMPRA', data: '2026-03-01' }), (e) => e.code === 'VALIDATION');
  assert.throws(() => el({ tipo: 'MORTE', data: '2026-12-01' }), (e) => e.code === 'VALIDATION');
  assert.throws(() => el({ tipo: 'MORTE', data: '2026-03-01', pasture_id: 'nao-existe' }), (e) => e.code === 'NOT_FOUND');
});

test('rotas pela api(): evento.registrar de nascimento, transferência, morte e descarte; evento.simular; inventario.elegiveis ligada (não é mais de fase futura)', () => {
  const s = S.sistema();
  const chamar = (pedido) => JSON.parse(JSON.stringify(s.gas.exec(() => s.G.api(pedido))));
  const ini = chamar({ rota: 'evento.registrar', idempotencyKey: 'k1', dados: { tipo: 'ENTRADA_INICIAL', campos: {}, animais: [S.bicho({ brinco: '1', data_nascimento: '2020-01-01', data_nascimento_confianca: 'ESTIMADA' }), S.bicho({ brinco: '2' })] } });
  assert.equal(ini.ok, true, JSON.stringify(ini.error));
  const [vaca, outro] = ini.data.animais.map((a) => a.animal_id);
  const n = chamar({ rota: 'evento.registrar', idempotencyKey: 'k2', dados: { tipo: 'NASCIMENTO', campos: { event_date: '2026-03-01' }, animais: [{ animal_id: vaca }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F', brinco: '3' }] } });
  assert.deepEqual([n.ok, n.data.event_type, n.data.animais.length], [true, 'NASCIMENTO', 2]);
  const sim = chamar({ rota: 'evento.simular', dados: { acao: 'registrar', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-02', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: outro }] } } });
  assert.deepEqual([sim.ok, sim.data.simulacao], [true, true]);
  const t = chamar({ rota: 'evento.registrar', idempotencyKey: 'k3', dados: { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-02', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: outro }] } });
  assert.equal(t.ok, true);
  const mo = chamar({ rota: 'evento.registrar', idempotencyKey: 'k4', dados: { tipo: 'MORTE', campos: { event_date: '2026-03-03', causa: 'DOENCA' }, animais: [{ animal_id: outro }] } });
  assert.deepEqual([mo.ok, mo.data.animais[0].situacao_cadastral], [true, 'MORTO']);
  const de = chamar({ rota: 'evento.registrar', idempotencyKey: 'k5', dados: { tipo: 'DESCARTE', campos: { event_date: '2026-03-04', destino: 'SACRIFICIO', motivo: 'SANITARIO' }, animais: [{ animal_id: vaca }] } });
  assert.deepEqual([de.ok, de.data.animais[0].situacao_cadastral], [true, 'DESCARTADO']);
  const el = chamar({ rota: 'inventario.elegiveis', dados: { tipo: 'TRANSFERENCIA', data: '2026-03-02', pasture_id: S.PASTOS.B } });
  assert.deepEqual([el.ok, el.data.n], [true, 1]);
  const ob = chamar({ rota: 'evento.obter', dados: { event_id: mo.data.event_id } });
  assert.equal(ob.data.detalhes.BAIXAS[0].causa, 'DOENCA');
  const rotas = js(s.G.Api.rotas());
  assert.equal(rotas['inventario.elegiveis'].tipo, 'CONSULTA');
  const fic = chamar({ rota: 'animal.ficha', dados: { animal_id: vaca } });
  assert.deepEqual([fic.ok, fic.data.reprodutivo.n_partos, fic.data.reprodutivo.partos[0].crias[0].brinco], [true, 1, '3']);
  // Verificação de integridade completa sobre o que os quatro tipos gravaram: nenhum erro.
  const integ = chamar({ rota: 'sistema.integridade', dados: {} });
  assert.equal(integ.ok, true, JSON.stringify(integ.error));
  assert.deepEqual(integ.data.achados.filter((x) => x.severidade === 'ERRO'), []);
  assert.equal(integ.data.ok, true);
});
