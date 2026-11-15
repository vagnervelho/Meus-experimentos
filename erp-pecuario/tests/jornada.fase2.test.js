'use strict';
/**
 * Jornada de ponta a ponta da Fase 2, só pela função pública api() (e setup() do editor), como o dono faria: setup →
 * cadastros (pastos, um arrendado; fornecedor, transportador, frigorífico, corretor) → importação do rebanho (46 animais,
 * crias ao pé com mãe e pai) → um ano de manejo: compra por kg vivo com frete (corrigido), partos (gêmeos e natimorto),
 * ida e volta do pasto arrendado (a primeira corrigida de data; o estorno dela barrado pela volta), transferência lançada
 * errada e estornada, mortes, descarte, identificação das crias, não localizado e baixa na contagem, venda de bois por
 * arroba de carcaça com Funrural retido, venda de bezerros por kg vivo com comissão (corrigida), volta de um vendido por
 * compra, recusas que não gravam nada (retroativo que quebra a cadeia, venda de quem já saiu) → importação de eventos
 * históricos (transferência e venda antes do marco zero, morte do ano) com a reconciliação da fotografia → no fim,
 * inventário em várias datas igual ao de um modelo independente (o próprio teste anota cada movimento), a pagar e a
 * receber iguais à soma das parcelas lançadas, ficha financeira, trilha de auditoria e integridade sem erro. Depois de
 * CADA comando: projeção gravada = reconstrução (Timeline.conferir vazio) e as invariantes do financeiro (03b, seção 14).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');

const js = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const HOJE = '2026-11-13';
const D0 = '2025-11-01';
const USUARIO = 'dono@gmail.com';
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

function semDate(v, onde) {
  if (Object.prototype.toString.call(v) === '[object Date]') assert.fail('Date na resposta em ' + onde);
  if (v && typeof v === 'object') Object.keys(v).forEach((k) => semDate(v[k], onde + '.' + k));
}

function montar() {
  const gas = createGas({ order: 'reverse' });
  const G = gas.G;
  let n = 0;
  const j = {
    gas, G,
    props: () => Object.fromEntries(gas.props.script._data),
    banco: () => j.props().SPREADSHEET_ID,
    api: (rota, dados, extra) => {
      const env = js(gas.exec(() => G.api(Object.assign({ rota, dados: dados || {} }, extra || {}))));
      semDate(env, rota);
      return env;
    },
    /** Projeção gravada × reconstrução e as invariantes do financeiro, na base em uso. */
    conferir: (onde) => {
      const r = js(gas.exec(() => G.UnitOfWork.read(G.Api.contexto({ usuario: USUARIO }), {
        rota: 'teste.projecoes', reads: G.FinancialService.leituras(), acessoCru: true, tratador: (tx) => ({ proj: G.Timeline.conferir(tx), fin: G.FinancialService.conferir(tx) }),
      }).dados));
      assert.deepEqual(r, { proj: [], fin: [] }, 'projeção = reconstrução e invariantes do financeiro depois de ' + onde);
    },
    /** Comando que tem de passar; confere a projeção e o financeiro depois dele. */
    cmd: (rota, dados, extra) => {
      const r = j.api(rota, dados, Object.assign({ idempotencyKey: 'j2-' + (++n) }, extra || {}));
      assert.equal(r.ok, true, rota + ': ' + JSON.stringify(r.error));
      j.conferir(rota + ' ' + ((dados && dados.tipo) || ''));
      return r.data;
    },
    /** Comando que tem de ser recusado sem gravar nada (nem a operação) e sem consumir a chave. */
    recusa: (rota, dados, code) => {
      const antes = j.contagem();
      const chave = 'j2-recusa-' + (++n);
      const r = j.api(rota, dados, { idempotencyKey: chave });
      assert.deepEqual([r.ok, r.error && r.error.code], [false, code], rota + ': ' + JSON.stringify(r.error || r.data).slice(0, 300));
      assert.deepEqual(j.contagem(), antes, 'a recusa não grava nada');
      assert.equal(j.ok('operacao.status', { chave }).situacao, 'INEXISTENTE', 'a chave fica livre');
      j.conferir('recusa');
      return r.error;
    },
    ok: (rota, dados) => {
      const r = j.api(rota, dados);
      assert.equal(r.ok, true, rota + ': ' + JSON.stringify(r.error));
      return r.data;
    },
    tabela: (aba) => js(gas.exec(() => G.Database.abrir(j.banco(), { primitiva: j.props().IO_PRIMITIVE }).ler([aba])[aba].registros)),
    contagem: () => js(gas.exec(() => { const l = G.Database.abrir(j.banco(), { primitiva: j.props().IO_PRIMITIVE }).ler(G.Schema.nomesTabelas()); const o = {}; Object.keys(l).forEach((k) => { o[k] = l[k].registros.length; }); return o; })),
  };
  return j;
}

/**
 * Modelo independente do inventário: cada animal (pelo rótulo) com a sua lista de [data, pasto | null] na ordem dos
 * lançamentos; a posição em D é o último registro com data ≤ D.
 */
function modelo() {
  const mov = {};
  const m = {
    entra: (rot, data, pasto) => { (mov[rot] = mov[rot] || []).push([data, pasto]); },
    move: (rots, data, pasto) => rots.forEach((r) => mov[r].push([data, pasto])),
    sai: (rots, data) => rots.forEach((r) => mov[r].push([data, null])),
    /** Tira o último registro com esta data (estorno) ou troca a data dele (correção). */
    desfaz: (rots, data) => rots.forEach((r) => { const i = mov[r].map((x) => x[0]).lastIndexOf(data); mov[r].splice(i, 1); }),
    redata: (rots, de, para) => rots.forEach((r) => { const x = mov[r].find((y) => y[0] === de); x[0] = para; mov[r].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); }),
    em: (data) => {
      const por = {};
      Object.keys(mov).forEach((r) => {
        let p = null;
        let dentro = false;
        mov[r].forEach((x) => { if (x[0] <= data) { p = x[1]; dentro = true; } });
        if (dentro && p) por[p] = (por[p] || 0) + 1;
      });
      return por;
    },
  };
  return m;
}

/** Rebanho do marco zero: 2 touros, 20 vacas, 8 crias ao pé (mãe e pai), 6 novilhas, 10 garrotes. */
function rebanho() {
  const linhas = [];
  linhas.push(['T01', 'M', '15/03/2018', '', '', 'Sede', 'S', 'N', '', '780']);
  linhas.push(['T02', 'M', '20/04/2019', '', '', 'Rio', 'S', 'N', '', '760']);
  for (let i = 1; i <= 20; i++) linhas.push(['V' + String(i).padStart(2, '0'), 'F', String(1 + (i % 27)).padStart(2, '0') + '/0' + (1 + (i % 9)) + '/' + (2016 + (i % 5)), '', '', i <= 12 ? 'Sede' : 'Rio', '', '', '2', '450']);
  for (let i = 1; i <= 8; i++) linhas.push(['B0' + i, i % 2 ? 'M' : 'F', String(10 + i) + '/0' + (5 + (i % 4)) + '/2025', 'V0' + i, 'T01', 'Sede', i % 2 ? 'N' : '', i % 2 ? 'N' : '', '', '120']);
  for (let i = 1; i <= 6; i++) linhas.push(['N0' + i, 'F', '1' + i + '/01/2024', '', '', 'Rio', '', '', '0', '330']);
  for (let i = 1; i <= 10; i++) linhas.push(['G' + String(i).padStart(2, '0'), 'M', '0' + (1 + (i % 9)) + '/03/2024', '', '', 'Recria', 'N', 'S', '', '360']);
  const cab = 'Brinco;Sexo;Nascimento;Mãe;Pai;Pasto;Reprodutor;Castrado;Partos prévios;Peso (kg)';
  return { texto: [cab].concat(linhas.map((l) => l.join(';'))).join('\r\n'), linhas };
}
const MAPA_ANIMAIS = {
  colunas: { Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento', 'Mãe': 'mae', Pai: 'pai', Pasto: 'pasto', Reprodutor: 'reprodutor', Castrado: 'castrado', 'Partos prévios': 'partos_previos', 'Peso (kg)': 'peso' },
  confiancas: { data_nascimento: 'ESTIMADA', mae: 'CONFIRMADA', pai: 'ESTIMADA' }, padroes: { metodo_pesagem: 'BALANCA' },
};

function importar(j, tipo, nome, texto, mapa, aprovacao) {
  const criado = j.cmd('importacao.criar', { tipo, arquivo_nome: nome, texto, formato: FORMATO });
  let est = null;
  for (let b = 1; b < 20 && (!est || est.importacao.status !== 'VALIDADO'); b++) est = j.cmd('importacao.validarBloco', { import_id: criado.import_id, bloco: b, mapeamento: mapa });
  assert.equal(est.importacao.status, 'VALIDADO');
  const primeiro = { import_id: criado.import_id, bloco: 1, modo: aprovacao ? 'PARCIAL_APROVADO' : 'TOTAL' };
  if (aprovacao) primeiro.aprovacao = aprovacao;
  let bl = j.api('importacao.importarBloco', primeiro);
  assert.equal(bl.ok, true, JSON.stringify(bl.error));
  for (let b = 2; bl.data.blocos.proximo !== null; b++) {
    bl = j.api('importacao.importarBloco', { import_id: criado.import_id, bloco: b });
    assert.equal(bl.ok, true, JSON.stringify(bl.error));
  }
  const fim = j.ok('importacao.concluir', { import_id: criado.import_id });
  j.conferir('importação ' + tipo);
  return { criado, est, fim };
}

test('jornada da Fase 2 pela API: rebanho importado → um ano de compras, partos, transferências, vendas, mortes, correções e estornos → histórico importado com reconciliação → inventário, títulos e integridade', () => {
  const j = montar();
  const { G } = j;
  const M = modelo();

  // 1. Setup e cadastros.
  const rel = js(j.gas.exec(() => G.setup()));
  assert.equal(rel.integridade.ok, true);
  const prop = j.cmd('propriedade.salvar', { campos: { nome: 'Fazenda Santa Luzia', area_total_ha: 300 } });
  const ze = j.cmd('parceiro.salvar', { campos: { nome: 'Zé do Arrendamento', tipos: ['ARRENDADOR'] } });
  const pasto = {};
  [['Sede', 60, 2.5], ['Rio', 50, 2.2], ['Recria', 50, 2.5], ['Arrendado do Zé', 60, 2, 'ARRENDADO']].forEach(([nome, area, cap, posse]) => {
    const campos = { property_id: prop.property_id, nome, area_hectares: area, capacidade_estimada_ua_ha: cap, posse: posse || 'PROPRIO' };
    if (posse) campos.arrendador_id = ze.partner_id;
    pasto[nome] = j.cmd('pasto.salvar', { campos }).pasture_id;
  });
  const parceiro = (nome, tipos) => j.cmd('parceiro.salvar', { campos: { nome, tipos } }).partner_id;
  const forn = parceiro('Fazenda Vizinha', ['FORNECEDOR']);
  const transp = parceiro('Transportes Rondon', ['TRANSPORTADOR']);
  const frig = parceiro('Frigorífico Boi Bom', ['COMPRADOR']);
  const recriador = parceiro('Recriador do Vale', ['COMPRADOR']);
  const corretor = parceiro('Corretor Antônio', ['OUTRO']);
  j.cmd('config.salvar', { valores: { data_marco_zero: D0 } });

  // 2. Rebanho do marco zero pela importação de animais (46 linhas, crias ao pé com mãe e pai).
  const arq = rebanho();
  const imp = importar(j, 'ANIMAIS', 'rebanho-marco-zero.csv', arq.texto, MAPA_ANIMAIS);
  assert.deepEqual([imp.est.contadores.validas, imp.est.contadores.erro, imp.fim.criados.ativos], [46, 0, 46], JSON.stringify(imp.est.contadores));
  const id = {};
  j.tabela('ANIMAIS').forEach((a) => { if (a.brinco) id[a.brinco] = a.animal_id; });
  arq.linhas.forEach((l) => M.entra(l[0], D0, l[5]));
  for (let i = 1; i <= 8; i++) assert.equal(j.tabela('ANIMAIS').find((a) => a.brinco === 'B0' + i).mae_id, id['V0' + i], 'mãe da cria B0' + i);
  const G1a10 = ['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G10'];

  // 3. Compra de 6 garrotes por kg vivo (R$ 13,00/kg) com frete do transportador, 2 parcelas; o frete era 750,00 (correção).
  const pesosC = [250, 262, 275, 281, 290, 300];
  const itensC = pesosC.map((p, i) => ({ brinco: 'C0' + (i + 1), sexo: 'M', castrado: true, reprodutor: false, idade_meses: 18, peso: p, metodo_pesagem: 'BALANCA' }));
  const valorC = pesosC.reduce((s, p) => s + p, 0) * 1300;
  const dadosC = {
    tipo: 'COMPRA', campos: { event_date: '2025-12-10', partner_id: forn, pasto_destino_id: pasto.Recria, finalidade: 'RECRIA_ENGORDA', modalidade: 'KG_VIVO', preco_unitario: 1300, valor_animais: valorC, nota_fiscal: 'NF-1001' },
    animais: itensC, parcelas: [{ data_vencimento: '2026-01-10' }, { data_vencimento: '2026-02-10' }],
    custos: [{ tipo: 'FRETE', valor: 60000, partner_id: transp, data_vencimento: '2025-12-20' }],
  };
  const sim = j.api('evento.simular', { acao: 'registrar', dados: dadosC });
  assert.equal(sim.ok, true, JSON.stringify(sim.error));
  assert.equal(sim.data.impactos.compra.criterio, 'PESO_VIVO');
  const compra = j.cmd('evento.registrar', dadosC, { dataVersionEsperada: sim.meta.dataVersion });
  compra.animais.forEach((a) => { id[a.brinco] = a.animal_id; });
  itensC.forEach((it) => M.entra(it.brinco, '2025-12-10', 'Recria'));
  const corrC = JSON.parse(JSON.stringify(dadosC));
  corrC.animais.forEach((it) => { it.animal_id = id[it.brinco]; });
  corrC.custos[0].valor = 75000;
  const compraK = j.cmd('evento.corrigir', Object.assign(corrC, { event_id: compra.event_id, justificativa: 'Frete conferido no conhecimento de transporte' }));
  assert.deepEqual(compraK.animais.map((a) => a.animal_id).sort(), compra.animais.map((a) => a.animal_id).sort(), 'mesmos animais');
  const custoC1 = j.tabela('ANIMAIS').find((a) => a.brinco === 'C01').custo_aquisicao;
  const totalPesoC = pesosC.reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(custoC1 - (250 * 1300 + Math.round(75000 * 250 / totalPesoC))) <= 1, 'custo do C01 = valor pelo peso + frete corrigido rateado pelo peso');

  // 4. Partos de janeiro a março (um gemelar; um natimorto); as crias nascem no pasto da mãe.
  const partos = [['V09', '2026-01-15', ['M']], ['V10', '2026-01-20', ['F']], ['V11', '2026-02-05', ['M', 'F']], ['V12', '2026-02-10', []], ['V13', '2026-02-20', ['M']], ['V14', '2026-03-01', ['F']], ['V15', '2026-03-05', ['M']], ['V16', '2026-03-20', ['F']]];
  const crias = {};
  partos.forEach(([mae, data, sexos]) => {
    const lista = sexos.length ? sexos.map((sexo, k) => ({ situacao_nascimento: 'VIVO', sexo, peso: 30 + k, metodo_pesagem: 'BALANCA' })) : [{ situacao_nascimento: 'NATIMORTO' }];
    const r = j.cmd('evento.registrar', { tipo: 'NASCIMENTO', campos: Object.assign({ event_date: data }, sexos.length > 1 ? { tipo_parto: 'ASSISTIDO' } : {}), animais: [{ animal_id: id[mae] }], crias: lista });
    const novas = r.animais.filter((a) => a.animal_id !== id[mae]);
    assert.equal(novas.length, sexos.length, 'só nascido vivo cria animal');
    novas.forEach((a) => {
      const rot = 'cria-' + mae + '-' + a.sexo;
      crias[rot] = a.animal_id;
      M.entra(rot, data, mae <= 'V12' ? 'Sede' : 'Rio');
      assert.equal(a.pasto_atual_id, pasto[mae <= 'V12' ? 'Sede' : 'Rio'], 'a cria nasce no pasto da mãe');
    });
  });
  assert.equal(Object.keys(crias).length, 8);
  assert.equal(j.tabela('REPRODUCAO').filter((r) => r.tipo_evento === 'PARTO').length, 8, 'um parto = uma linha, também o natimorto');

  // 5. Garrotes para o pasto arrendado em 01/02 (a data certa era 03/02: correção); retroativo que quebra a cadeia → CONFLICT.
  const ida = j.cmd('evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-02-01', pasto_origem_id: pasto.Recria, pasto_destino_id: pasto['Arrendado do Zé'] }, animais: G1a10.map((b) => ({ animal_id: id[b] })) });
  M.move(G1a10, '2026-02-01', 'Arrendado do Zé');
  const retro = j.recusa('evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-01-20', pasto_origem_id: pasto.Recria, pasto_destino_id: pasto.Rio }, animais: [{ animal_id: id.G01 }] }, 'CONFLICT');
  assert.deepEqual(retro.details.map((d) => [d.codigo, d.conflito.event_id]), [['ORIGEM_DIVERGENTE', ida.event_id]], 'cita a transferência de 01/02');
  const idaK = j.cmd('evento.corrigir', { event_id: ida.event_id, justificativa: 'A data era 03/02', tipo: 'TRANSFERENCIA', campos: { event_date: '2026-02-03', pasto_origem_id: pasto.Recria, pasto_destino_id: pasto['Arrendado do Zé'] }, animais: G1a10.map((b) => ({ animal_id: id[b] })) });
  M.redata(G1a10, '2026-02-01', '2026-02-03');

  // 6. Morte de uma cria (predador); transferência lançada no pasto errado e estornada; morte de vaca; descarte.
  j.cmd('evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-02-25', causa: 'PREDADOR' }, animais: [{ animal_id: crias['cria-V13-M'] }] });
  M.sai(['cria-V13-M'], '2026-02-25');
  const errada = j.cmd('evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-15', pasto_origem_id: pasto.Rio, pasto_destino_id: pasto.Sede }, animais: ['V17', 'V18', 'V19', 'V20'].map((b) => ({ animal_id: id[b] })) });
  M.move(['V17', 'V18', 'V19', 'V20'], '2026-03-15', 'Sede');
  j.cmd('evento.estornar', { event_id: errada.event_id, justificativa: 'Pasto errado: as vacas ficaram no Rio' });
  M.desfaz(['V17', 'V18', 'V19', 'V20'], '2026-03-15');
  j.cmd('evento.registrar', { tipo: 'MORTE', campos: { event_date: '2026-04-10', causa: 'DOENCA' }, animais: [{ animal_id: id.V20 }] });
  M.sai(['V20'], '2026-04-10');
  j.cmd('evento.registrar', { tipo: 'DESCARTE', campos: { event_date: '2026-05-05', destino: 'CONSUMO_PROPRIO', motivo: 'IDADE' }, animais: [{ animal_id: id.V19 }] });
  M.sai(['V19'], '2026-05-05');
  // Venda de quem já morreu → VALIDATION, nada gravado.
  const morta = j.recusa('evento.registrar', { tipo: 'VENDA', campos: { event_date: '2026-06-01', partner_id: frig, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 }, animais: [{ animal_id: id.V20 }], parcelas: [{ data_vencimento: '2026-07-01' }] }, 'VALIDATION');
  assert.ok(morta.details.some((d) => d.animal_id === id.V20), JSON.stringify(morta.details));

  // 7. Identificação das crias do ano (brinco no curral em 10/06).
  const vivas = Object.keys(crias).filter((r) => r !== 'cria-V13-M').sort();
  const brincos = {};
  vivas.forEach((r, i) => { brincos[r] = 'B' + (20 + i); });
  const ident = j.cmd('evento.registrar', { tipo: 'IDENTIFICACAO', subtipo: 'PRIMEIRA_IDENTIFICACAO', campos: { event_date: '2026-06-10', tipo_identificacao: 'BRINCO' }, animais: vivas.map((r) => ({ animal_id: crias[r], codigo: brincos[r] })) });
  assert.deepEqual(ident.animais.map((a) => a.brinco).sort(), vivas.map((r) => brincos[r]).sort());

  // 8. Volta do arrendado em 01/07: o estorno da ida passa a ser barrado por ela.
  const volta = j.cmd('evento.registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-07-01', pasto_origem_id: pasto['Arrendado do Zé'], pasto_destino_id: pasto.Recria }, animais: G1a10.map((b) => ({ animal_id: id[b] })) });
  M.move(G1a10, '2026-07-01', 'Recria');
  const barrado = j.recusa('evento.estornar', { event_id: idaK.event_id, justificativa: 'teste' }, 'CONFLICT');
  assert.ok(barrado.details.length === 10 && barrado.details.every((d) => d.conflito && d.conflito.event_id === volta.event_id), 'a volta impede, animal por animal');

  // 9. Não localizado em 20/07 e baixa na contagem em 20/08.
  j.cmd('evento.registrar', { tipo: 'MARCACAO', subtipo: 'NAO_LOCALIZADO', campos: { event_date: '2026-07-20', acao: 'MARCAR' }, animais: [{ animal_id: id.G10 }] });
  assert.ok(j.ok('alerta.listar', {}).alertas.find((a) => a.codigo === 'NAO_LOCALIZADO').ids.includes(id.G10));
  j.cmd('evento.registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'DIVERGENCIA_CONTAGEM', campos: { event_date: '2026-08-20', justificativa: 'Não apareceu em duas contagens' }, animais: [{ animal_id: id.G10 }] });
  M.sai(['G10'], '2026-08-20');

  // 10. Venda de 6 bois por arroba de carcaça (romaneio), Funrural retido pelo comprador.
  const bois = ['G01', 'G02', 'G03', 'G04', 'G05', 'G06'];
  const vivos = [520, 525, 530, 535, 540, 545];
  const carc = [270, 273, 276, 278, 281, 284];
  const brutoBois = Math.round(carc.reduce((s, x) => s + x, 0) * 31000 / 15);
  const funrural = Math.round(brutoBois * 0.015);
  const vBois = j.cmd('evento.registrar', {
    tipo: 'VENDA', campos: { event_date: '2026-08-15', partner_id: frig, finalidade: 'ABATE', modalidade: 'ARROBA', base_peso: 'CARCACA', preco_unitario: 31000, valor_bruto: brutoBois, nota_fiscal: 'NF-2207' },
    animais: bois.map((b, i) => ({ animal_id: id[b], peso: vivos[i], peso_carcaca_kg: carc[i] })), parcelas: [{ data_vencimento: '2026-09-15' }],
    deducoes: [{ tipo: 'FUNRURAL', valor: funrural, retida_pelo_comprador: true }],
  });
  M.sai(bois, '2026-08-15');
  assert.deepEqual(j.tabela('PESAGENS').filter((p) => p.event_id === vBois.event_id).map((p) => p.peso_kg).sort(), vivos, 'pesagens com o peso vivo, nunca a carcaça');

  // 11. Venda de 4 bezerros por kg vivo com comissão do corretor; o preço era R$ 12,50 (correção).
  const bez = ['B01', 'B02', 'B03', 'B04'];
  const pesosB = [228, 236, 241, 247];
  const kgB = pesosB.reduce((s, p) => s + p, 0);
  const vendaB = (preco) => ({
    tipo: 'VENDA', campos: { event_date: '2026-09-10', partner_id: recriador, finalidade: 'RECRIA_ENGORDA', modalidade: 'KG_VIVO', preco_unitario: preco, valor_bruto: kgB * preco },
    animais: bez.map((b, i) => ({ animal_id: id[b], peso: pesosB[i] })), parcelas: [{ data_vencimento: '2026-10-10' }],
    deducoes: [{ tipo: 'COMISSAO', valor: Math.round(kgB * preco * 0.02), partner_id: corretor, data_vencimento: '2026-09-20' }],
  });
  const vB = j.cmd('evento.registrar', vendaB(1200));
  M.sai(bez, '2026-09-10');
  const simB = j.api('evento.simular', { acao: 'corrigir', dados: Object.assign(vendaB(1250), { event_id: vB.event_id, justificativa: 'Preço conferido com o recriador' }) });
  assert.equal(simB.ok, true, JSON.stringify(simB.error));
  const vBK = j.cmd('evento.corrigir', Object.assign(vendaB(1250), { event_id: vB.event_id, justificativa: 'Preço conferido com o recriador' }), { dataVersionEsperada: simB.meta.dataVersion });
  assert.equal(j.ok('evento.obter', { event_id: vB.event_id }).evento.status, 'ESTORNADO');
  const finB = j.tabela('FINANCEIRO').filter((f) => f.event_id === vBK.event_id);
  assert.deepEqual(finB.map((f) => [f.natureza, f.valor]), [['RECEITA_VENDA_ANIMAIS', kgB * 1250], ['DESPESA_VENDA', Math.round(kgB * 1250 * 0.02)]]);
  assert.ok(j.tabela('FINANCEIRO').filter((f) => f.event_id === vB.event_id).every((f) => f.status === 'CANCELADO'), 'os lançamentos da venda original ficam cancelados');

  // 12. O G02 volta ao rebanho por compra (mesmo animal_id), em 05/10.
  const volta02 = j.cmd('evento.registrar', { tipo: 'COMPRA', campos: { event_date: '2026-10-05', partner_id: forn, pasto_destino_id: pasto.Recria, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 300000 }, animais: [{ animal_id: id.G02 }], parcelas: [{ data_vencimento: '2026-12-05' }] });
  assert.deepEqual(volta02.animais.map((a) => [a.animal_id, a.situacao_cadastral]), [[id.G02, 'ATIVO']]);
  M.entra('G02', '2026-10-05', 'Recria');

  // 13. Histórico importado: transferência e venda antes do marco zero (divergem da fotografia) e a morte do ano.
  const hT = importar(j, 'TRANSFERENCIAS', 'transferencias-antigas.csv', 'Data;Pasto de origem;Pasto de destino;Brinco\r\n01/07/2025;Sede;Rio;V02',
    { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} });
  assert.equal(hT.fim.importacao.status, 'IMPORTADO');
  const hV = importar(j, 'VENDAS', 'vendas-antigas.csv', 'Nº da venda;Data da venda;Comprador;Para que foram vendidos;Como foi o preço;Preço (R$);Valor bruto (R$);Brinco\r\nH1;01/05/2025;Frigorífico Boi Bom;recria e engorda;cabeça;2.500,00;2.500,00;N01',
    { colunas: { 'Nº da venda': 'grupo', 'Data da venda': 'data', Comprador: 'comprador', 'Para que foram vendidos': 'finalidade', 'Como foi o preço': 'modalidade', 'Preço (R$)': 'preco', 'Valor bruto (R$)': 'valor_bruto', Brinco: 'brinco' }, confiancas: {}, padroes: {} });
  assert.equal(hV.fim.importacao.status, 'IMPORTADO');
  const hM = importar(j, 'MORTES', 'mortes-2026.csv', 'Data da morte;Causa da morte;Brinco\r\n20/10/2026;raio;N06', { colunas: { 'Data da morte': 'data', 'Causa da morte': 'causa', Brinco: 'brinco' }, confiancas: {}, padroes: {} });
  assert.equal(hM.fim.criados.eventos, 1);
  M.sai(['N06'], '2026-10-20');
  const rec = j.ok('importacao.reconciliacao', {});
  assert.deepEqual(rec.animais.map((a) => [a.brinco, a.codigo]).sort(), [['N01', 'SAIDA_HISTORICA_NA_FOTOGRAFIA'], ['V02', 'PASTO_DIVERGENTE']]);
  assert.equal(rec.resumo.bloqueia, false, 'a reconciliação lista sem bloquear');
  assert.deepEqual([j.tabela('ANIMAIS').find((a) => a.brinco === 'N01').situacao_cadastral, j.tabela('ANIMAIS').find((a) => a.brinco === 'V02').pasto_atual_id], ['ATIVO', pasto.Sede], 'o histórico não mexe na posição de hoje');
  assert.ok(j.tabela('EVENTOS').filter((e) => e.import_id === hV.criado.import_id).every((e) => e.pre_marco_zero === true), 'venda antiga é registro histórico');
  assert.equal(j.tabela('FINANCEIRO').filter((f) => j.tabela('EVENTOS').some((e) => e.event_id === f.event_id && e.import_id === hV.criado.import_id)).every((f) => f.status_pagamento === 'SEM_CAIXA'), true, 'venda antiga sem caixa');

  // 14. Inventário em várias datas = o do modelo (total e por pasto), também nos cartões e no painel do pasto.
  const nomeDe = Object.fromEntries(Object.entries(pasto).map(([n, i]) => [i, n]));
  const antes = j.ok('inventario.posicao', { data: '2025-10-31' });
  assert.deepEqual([antes.cabecas, antes.motivo], [null, 'ANTERIOR_AO_MARCO_ZERO']);
  ['2025-11-01', '2025-12-09', '2025-12-31', '2026-02-02', '2026-02-28', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31', '2026-10-31', HOJE].forEach((data) => {
    const esperado = M.em(data);
    const pos = j.ok('inventario.posicao', { data });
    const obtido = Object.fromEntries(pos.por_pasto.filter((p) => p.cabecas > 0).map((p) => [nomeDe[p.pasture_id], p.cabecas]));
    assert.deepEqual(obtido, esperado, 'inventário por pasto em ' + data);
    assert.equal(pos.cabecas, Object.values(esperado).reduce((s, n) => s + n, 0), 'total em ' + data);
    const cartoes = j.ok('pasto.listar', { data });
    cartoes.forEach((c) => assert.equal(c.cabecas, esperado[c.nome] || 0, 'cartão ' + c.nome + ' em ' + data));
  });
  assert.equal(j.ok('pasto.painel', { pasture_id: pasto['Arrendado do Zé'], data: '2026-03-31' }).cabecas, 10, 'os 10 garrotes no arrendado em março');
  assert.deepEqual(M.em(HOJE), { Sede: 21, Rio: 15, Recria: 10 }, 'conta à mão: 46 + 6 comprados + 8 crias − 1 cria morta − 2 vacas − 1 baixa − 6 bois − 4 bezerros + 1 volta − 1 morte importada = 46');

  // 15. Títulos: a pagar e a receber = a soma das parcelas lançadas (nada se baixa na Fase 2).
  const aPagar = valorC + 75000 + funrural + Math.round(kgB * 1250 * 0.02) + 300000;
  const aReceber = brutoBois + kgB * 1250;
  const tit = j.ok('dashboard.obter', {}).titulos;
  assert.deepEqual([tit.a_pagar, tit.a_receber], [aPagar, aReceber]);
  assert.deepEqual([tit.vencido_pagar, tit.vencido_receber], [aPagar - 300000, aReceber], 'em 13/11 só a parcela da volta do G02 (05/12) ainda não venceu: ' + JSON.stringify(tit));
  // Ficha: o comprado tem o custo pelas alocações; o boi vendido, a receita alocada pela carcaça.
  const fC = j.ok('animal.ficha', { animal_id: id.C01 }).financeiro;
  assert.equal(fC.custo_aquisicao, custoC1);
  const fG = j.ok('animal.ficha', { animal_id: id.G01 }).financeiro;
  assert.ok(Math.abs(fG.receitas - brutoBois * 270 / carc.reduce((s, x) => s + x, 0)) <= 1, 'receita do G01 pela carcaça');

  // 16. Trilha e histórico: correções e estornos com quem, quando e por quê; integridade sem erro.
  const aud = j.ok('auditoria.listar', { por_pagina: 500 });
  const motivos = aud.itens.filter((a) => a.origem === 'EVENTO' && (a.acao === 'ESTORNAR' || a.acao === 'CORRIGIR')).map((a) => a.justificativa).sort();
  assert.deepEqual(motivos, ['A data era 03/02', 'Frete conferido no conhecimento de transporte', 'Pasto errado: as vacas ficaram no Rio', 'Preço conferido com o recriador'].sort(), JSON.stringify(aud.itens.filter((a) => a.origem === 'EVENTO').map((a) => [a.acao, a.justificativa]).slice(0, 12)));
  assert.ok(aud.itens.every((a) => a.usuario === USUARIO), 'quem em toda linha');
  const doG01 = j.ok('evento.listar', { animal_id: id.G01 }).itens.map((e) => [e.event_type, e.status]);
  assert.deepEqual(doG01, [['VENDA', 'CONFIRMADO'], ['TRANSFERENCIA', 'CONFIRMADO'], ['TRANSFERENCIA', 'CONFIRMADO'], ['TRANSFERENCIA', 'ESTORNADO'], ['ENTRADA_INICIAL', 'CONFIRMADO']], 'histórico do G01 (a ida original fica anulada pela correção)');
  const final = j.ok('sistema.integridade', {});
  assert.equal(final.ok, true, JSON.stringify(final.achados.slice(0, 5)));
  assert.deepEqual(final.checagens.filter((c) => c.situacao === 'ERRO').map((c) => c.codigo), []);
  const efeitos = j.tabela('EVENTO_ANIMAIS').filter((l) => j.tabela('EVENTOS').find((e) => e.event_id === l.event_id).status === 'CONFIRMADO').reduce((s, l) => s + (l.efeito_inventario || 0), 0);
  assert.equal(efeitos, 46, 'Σ efeito dos eventos vigentes = ativos (RN-024)');
  assert.equal(j.ok('sistema.bootstrap', {}).animais.n, 46);
  // Todo evento grava ocorrência, registro, usuário, origem e status (RN-111); os importados com a origem IMPORTACAO.
  j.tabela('EVENTOS').forEach((e) => {
    assert.ok(e.event_date && e.registration_date && e.created_by === USUARIO && e.status && (e.source === 'APP' || (e.source === 'IMPORTACAO' && e.import_id)), 'evento ' + e.event_type + ' ' + e.event_id + ' completo');
  });
  assert.ok(compraK.event_id && idaK.event_id && hT.criado.import_id && hM.criado.import_id);
});
