'use strict';
/**
 * Revisão da Fase 3, rodada 3 (conserto), achados de zootecnia e dos números do servidor: as próximas doses da ficha com a
 * mesma entrada no rebanho da agenda, os partos da lista de Fêmeas com a conta da ficha, o intervalo do GMD na resposta da
 * pesagem (para a linha do curral não juntar dois intervalos), a descrição do animal na data em `inventario.elegiveis` e o
 * rótulo único de pastos com o mesmo nome no desempenho.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { js } = S;
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

function api(s, rota, dados, chave, avisos) {
  return js(s.gas.exec(() => s.G.api({ rota, dados: dados || {}, idempotencyKey: chave || 'k-' + Math.random(), avisosAceitos: avisos || [] })));
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
  return ids;
}
const AVISOS = ['PESO_IMPLAUSIVEL', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE'];
function pesar(s, data, itens, metodo) {
  return ok(api(s, 'evento.registrar', { tipo: 'PESAGEM', campos: { event_date: data, tipo_pesagem: 'ROTINA', metodo_pesagem: metodo || 'BALANCA' }, animais: itens }, null, AVISOS), 'pesagem ' + data);
}
function semErro(s, onde) {
  const rel = s.integridade();
  assert.equal(rel.ok, true, onde + ': ' + JSON.stringify(rel.achados.filter((a) => a.severidade === 'ERRO').slice(0, 3)));
  s.conferirProjecoes(onde);
}

test('achado 6: as próximas doses da ficha usam a entrada no rebanho da linha do tempo (a mesma da agenda): o nunca vacinado do rebanho inicial vence no mesmo dia na ficha e na agenda, com e sem data_entrada declarada', () => {
  const s = S.sistema();
  hoje(s, '2026-01-05');
  const id = rebanho(s, [
    S.bicho({ brinco: '10', data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '11', data_nascimento: '2023-01-01', data_nascimento_confianca: 'CONFIRMADA', data_entrada: '2025-03-01', data_entrada_confianca: 'CONFIRMADA' }),
  ]);
  hoje(s, '2026-03-01');
  ok(api(s, 'protocolo.salvar', { campos: { nome: 'Semestral', tipo_procedimento: 'VACINA', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'INTERVALO_DIAS', intervalo_dias: 180 } }), 'semestral');
  ok(api(s, 'protocolo.salvar', { campos: { nome: 'Única', tipo_procedimento: 'VERMIFUGO', sexo_aplicavel: 'AMBOS', recorrencia_tipo: 'UNICA' } }), 'única');
  hoje(s, '2026-06-01');
  semErro(s, 'base');
  const ag = ok(api(s, 'sanidade.agenda', {}), 'agenda');
  ['10', '11'].forEach((b) => {
    const ficha = ok(api(s, 'animal.ficha', { animal_id: id[b] }), 'ficha ' + b);
    const naFicha = ficha.sanitario.proximas.map((p) => [p.nome, p.vencimento, p.situacao, p.dias]).sort();
    const naAgenda = ag.pendencias.filter((p) => p.animal_id === id[b]).map((p) => [p.nome, p.vencimento, p.situacao, p.dias]).sort();
    assert.deepEqual(naFicha, naAgenda, 'animal ' + b);
    // Elegível desde a entrada no rebanho da linha do tempo (o marco zero, 01/01) e desde que o protocolo vale (o cadastro, 01/03;
    // CONTRATOS, seção 53, achado 8): vencidas desde 01/03, na ficha e na agenda — nunca pela data_entrada declarada (2025).
    assert.deepEqual(naFicha.map((x) => [x[1], x[2], x[3]]), [['2026-03-01', 'VENCIDA', 92], ['2026-03-01', 'VENCIDA', 92]], 'vencidas desde que o protocolo passou a valer (depois da entrada no rebanho), animal ' + b);
  });
});

test('achado 7: os partos da lista de Fêmeas (reproducao.matrizes, hoje e numa data passada) seguem a conta da ficha — o parto histórico importado que é o mesmo parto declarado na entrada não conta duas vezes', () => {
  const s = S.sistema({ config: { importacao_lote_linhas: '50' } });
  hoje(s, '2026-11-17');
  const id = rebanho(s, [S.bicho({ brinco: '301', sexo: 'F', data_nascimento: '2019-06-10', data_nascimento_confianca: 'CONFIRMADA', partos_previos: 1 })]);
  const csv = ['Data do parto;Brinco da mãe;Nasceu;Sexo da cria;Brinco da cria', '05/10/2025;301;vivo;F;402'].join('\n');
  const c = s.exec((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: 'criar', dados: { tipo: 'NASCIMENTOS', arquivo_nome: 'n.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
  const mapa = { colunas: { 'Data do parto': 'data', 'Brinco da mãe': 'mae', Nasceu: 'situacao', 'Sexo da cria': 'sexo', 'Brinco da cria': 'brinco' }, confiancas: {}, padroes: {} };
  for (let b = 1; b < 10; b++) { const est = s.exec((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'v' + b, dados: { import_id: c.import_id, bloco: b, mapeamento: mapa } })).dados; if (est.importacao.status === 'VALIDADO') break; }
  const r = s.tentar((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: [], dados: { import_id: c.import_id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  s.exec((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: c.import_id } }));
  semErro(s, 'importação');
  const ficha = ok(api(s, 'animal.ficha', { animal_id: id['301'] }), 'ficha');
  assert.equal(ficha.reprodutivo.n_partos, 1);
  assert.equal(ok(api(s, 'reproducao.matrizes', {}), 'hoje').itens.find((x) => x.animal_id === id['301']).partos, 1);
  assert.equal(ok(api(s, 'reproducao.matrizes', { data: '2026-01-15' }), '15/01').itens.find((x) => x.animal_id === id['301']).partos, 1);
  // Um parto depois da entrada soma: 2 na ficha e na lista.
  ok(api(s, 'evento.registrar', { tipo: 'NASCIMENTO', campos: { event_date: '2026-10-01' }, animais: [{ animal_id: id['301'] }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '403' }] }), 'parto novo');
  assert.equal(ok(api(s, 'animal.ficha', { animal_id: id['301'] }), 'ficha 2').reprodutivo.n_partos, 2);
  assert.equal(ok(api(s, 'reproducao.matrizes', {}), 'hoje 2').itens.find((x) => x.animal_id === id['301']).partos, 2);
  assert.equal(ok(api(s, 'reproducao.matrizes', { data: '2026-09-30' }), 'antes do parto novo').itens.find((x) => x.animal_id === id['301']).partos, 1);
});

test('achados 8 e 25: a resposta da pesagem traz o intervalo do GMD (de, peso, ganho e dias do MESMO intervalo), que pode começar antes da pesagem anterior mostrada; o GMD é o ganho ÷ os dias desse intervalo', () => {
  const s = S.sistema();
  hoje(s, '2026-11-15');
  const id = rebanho(s, [S.bicho({ brinco: '701', sexo: 'M', castrado: true, data_nascimento: '2024-05-01', data_nascimento_confianca: 'CONFIRMADA' })])['701'];
  pesar(s, '2026-03-01', [{ animal_id: id, peso: 300 }]);
  pesar(s, '2026-04-01', [{ animal_id: id, peso: 400 }], 'ESTIMATIVA_VISUAL');
  const r = pesar(s, '2026-05-01', [{ animal_id: id, peso: 360 }]);
  const x = r.pesagem.animais[0];
  assert.deepEqual([x.anterior.data, x.ganho_kg, x.dias], ['2026-04-01', -40, 30], 'o ganho contra a anterior (estimada)');
  assert.deepEqual(x.gmd_intervalo, { de: '2026-03-01', peso_de_kg: 300, ganho_kg: 60, dias: 61 });
  assert.equal(x.gmd_kg_dia, Math.round(60 / 61 * 1000) / 1000);
  // Duas no mesmo dia: o GMD da segunda é desde 01/05, não "em 0 dias".
  pesar(s, '2026-07-01', [{ animal_id: id, peso: 390 }]);
  const tarde = pesar(s, '2026-07-01', [{ animal_id: id, peso: 392 }]).pesagem.animais[0];
  assert.deepEqual([tarde.ganho_kg, tarde.dias], [2, 0]);
  assert.deepEqual(tarde.gmd_intervalo, { de: '2026-05-01', peso_de_kg: 360, ganho_kg: 32, dias: 61 });
  // Intervalo curto: sem GMD, com o intervalo e o porquê.
  const curto = pesar(s, '2026-07-11', [{ animal_id: id, peso: 397 }]).pesagem.animais[0];
  assert.equal(curto.gmd_kg_dia, null);
  assert.match(curto.gmd_explicacao, /Intervalo de 10 dias/);
  semErro(s, 'gmd');
});

test('achado 9: inventario.elegiveis numa data passada descreve o animal NAQUELE dia — a categoria na data e a última pesagem até a data (não a de depois)', () => {
  const s = S.sistema();
  hoje(s, '2026-11-13');
  const id = rebanho(s, [S.bicho({ brinco: '0457', sexo: 'F', data_nascimento: '2023-02-02', data_nascimento_confianca: 'CONFIRMADA' })])['0457'];
  pesar(s, '2026-10-01', [{ animal_id: id, peso: 380 }]);
  ok(api(s, 'evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-11-08', pasto_origem_id: S.PASTOS.A, pasto_destino_id: S.PASTOS.B }, animais: [{ animal_id: id }] }, null, AVISOS), 'transferência');
  pesar(s, '2026-11-12', [{ animal_id: id, peso: 455 }]);
  const x = ok(api(s, 'inventario.elegiveis', { tipo: 'PESAGEM', data: '2026-11-05' }), 'elegíveis').itens.find((i) => i.animal_id === id);
  assert.equal(x.pasture_id, S.PASTOS.A);
  assert.deepEqual(x.ultimo_peso, { kg: 380, data: '2026-10-01', estimado: false });
  assert.equal(typeof x.categoria, 'string');
  const cat = s.read({ rota: 't', reads: s.G.AnimalService.leituras(), acessoCru: true, tratador: (tx) => { const L = s.G.AnimalService.leitor(tx); return s.G.AnimalService.categoriaEm(L, tx.repo.porId('ANIMAIS', id), '2026-11-05'); } });
  assert.equal(x.categoria, cat.nome);
  const antes = ok(api(s, 'inventario.elegiveis', { tipo: 'PESAGEM', data: '2026-09-01' }), 'antes da pesagem').itens.find((i) => i.animal_id === id);
  assert.equal(antes.ultimo_peso, null);
});

test('achado 14: no desempenho, dois pastos com o mesmo nome (em propriedades diferentes) têm rótulos diferentes — nenhum some no outro', () => {
  const s = S.sistema();
  hoje(s, '2026-11-13');
  const prop2 = ok(api(s, 'propriedade.salvar', { campos: { nome: 'Retiro São José', area_total_ha: 100 } }), 'propriedade').property_id;
  const outroA = ok(api(s, 'pasto.salvar', { campos: { property_id: prop2, nome: 'Pasto A', posse: 'PROPRIO' } }), 'outro Pasto A').pasture_id;
  const garrote = (brinco, extra) => S.bicho(Object.assign({ brinco, sexo: 'M', castrado: true, data_nascimento: '2025-01-01', data_nascimento_confianca: 'CONFIRMADA' }, extra || {}));
  const ids = rebanho(s, [garrote('1'), garrote('2'), garrote('3'), garrote('4', { pasto_destino_id: outroA }), garrote('5', { pasto_destino_id: outroA }), garrote('6', { pasto_destino_id: S.PASTOS.B })]);
  assert.equal(Object.keys(ids).length, 6);
  const d = ok(api(s, 'peso.desempenho', {}), 'desempenho');
  const pastos = d.por_pasto.filter((p) => p.nome === 'Pasto A');
  assert.equal(pastos.length, 2);
  assert.notEqual(pastos[0].rotulo, pastos[1].rotulo);
  assert.deepEqual(pastos.map((p) => [p.rotulo, p.cabecas]).sort(), [['Pasto A (Fazenda Boa Vista)', 3], ['Pasto A (Retiro São José)', 2]]);
  assert.equal(d.por_pasto.find((p) => p.pasture_id === S.PASTOS.B).rotulo, 'Pasto B', 'o nome único fica como está');
});
