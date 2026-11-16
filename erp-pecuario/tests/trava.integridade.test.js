'use strict';
/**
 * Trava única de integridade (CONTRATOS, seção 10.5): antes da fase A de todo comando que grava dado de negócio, o
 * retrato do que ficaria gravado passa pelas checagens de domínio da verificação de integridade, no escopo que o comando
 * toca e nos vizinhos; achado de ERRO novo recusa o comando (INTEGRIDADE_<CHECAGEM>, nada gravado, chave livre).
 *
 * Para cada checagem, um comando que a violaria por um caminho diferente do registro direto, e a recusa esperada:
 *  - caminhos que hoje não têm a conferência própria (achados por esta etapa): a correção do cadastro de referência do
 *    touro externo, a do sexo de uma categoria usada à mão, a do parâmetro de zeros à esquerda do brinco, a do marco zero
 *    depois de um histórico importado, a correção de cadastro da fêmea com diagnóstico de gestação, a conclusão de uma
 *    importação com o lote mexido à mão e o desfazer de uma importação sem a conferência do que volta;
 *  - caminhos que têm a conferência própria (estornar, corrigir, corrigir o substituto, estornar a correção, correção de
 *    cadastro): a recusa específica do caminho e, com a MESMA gravação feita sem essa conferência (o que um caminho
 *    incompleto gravaria), a recusa da trava.
 * E o problema antigo (adulteração à mão) que não bloqueia o comando que não o piora, mas bloqueia o que piora.
 * Depois de cada comando, a projeção gravada é a reconstrução.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./apoio-sistema');

const { PASTOS, PROP } = S;
const AV = ['INTERVALO_PARTO_CURTO', 'IDADE_REPRODUTIVA', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'BRINCO_PARECIDO', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO'];
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const FORMATO = { delimitador: ';', codificacao: 'UTF-8', formato_data: 'dd/MM/yyyy', decimal: ',' };

/** Sistema do setup com helpers: tent/reg (motor), cmd (comando qualquer), retrato (para "nada gravado"). */
function base(opcoes) {
  const s = S.sistema(opcoes || {});
  let n = 0;
  s.tent = (acao, dados, avisos) => {
    const r = s.tentar((ctx) => s.G.EventService[acao](ctx, { idempotencyKey: 'tr-' + (++n), dados, avisosAceitos: avisos || AV }));
    s.conferirProjecoes(acao + ' ' + (dados.tipo || ''));
    return r;
  };
  s.reg = (acao, dados, avisos) => {
    const r = s.tent(acao, dados, avisos);
    if (!r.ok) throw new Error(acao + ': ' + JSON.stringify(r.erro));
    return r.valor.dados;
  };
  s.cmd = (fn) => { const r = s.tentar(fn); s.conferirProjecoes('comando'); return r; };
  /** Comando que tem de passar (preparo do cenário), também com a projeção conferida depois. */
  s.ok = (fn) => { const r = s.cmd(fn); if (!r.ok) throw new Error(JSON.stringify(r.erro)); return r.valor; };
  s.erros = () => (s.integridade().achados || []).filter((x) => x.severidade === 'ERRO').map((x) => x.checagem);
  s.parceiro = (nome, tipos) => s.ok((ctx) => s.G.UnitOfWork.run(ctx, s.G.Config.comandoSalvarParceiro({ idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } }))).dados.partner_id;
  s.retrato = () => ({ ops: s.tabela('OPERACOES').length, eventos: s.tabela('EVENTOS').length, versao: s.props()['DATA_VERSION:' + s.banco()] });
  return s;
}
const vaca = (brinco, extra) => S.bicho(Object.assign({ brinco, sexo: 'F', data_nascimento: '2019-01-10', data_nascimento_confianca: 'CONFIRMADA' }, extra || {}));
const touro = (brinco, extra) => S.bicho(Object.assign({ brinco, sexo: 'M', reprodutor: true, data_nascimento: '2018-01-10', data_nascimento_confianca: 'CONFIRMADA' }, extra || {}));
const parto = (data, mae, crias, campos) => ({ tipo: 'NASCIMENTO', campos: Object.assign({ event_date: data, pasto_destino_id: PASTOS.A }, campos || {}), animais: [{ animal_id: mae }], crias });
const correcao = (data, itens) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: data, justificativa: 'conferência do cadastro' }, animais: itens });
const transferencia = (data, ids, origem, destino) => ({ tipo: 'TRANSFERENCIA', campos: { event_date: data, pasto_origem_id: origem, pasto_destino_id: destino }, animais: ids.map((id) => ({ animal_id: id })) });
function compra(forn, data, animais, extra) {
  return Object.assign({ tipo: 'COMPRA', campos: { event_date: data, partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 200000, valor_animais: 200000 * animais.length }, animais, parcelas: [{ data_vencimento: data }] }, extra || {});
}
function venda(comp, data, ids) {
  return { tipo: 'VENDA', campos: { event_date: data, partner_id: comp, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 300000, valor_bruto: 300000 * ids.length }, animais: ids.map((id) => ({ animal_id: id })), parcelas: [{ data_vencimento: data }] };
}

/** A recusa da trava: o código do erro e os códigos INTEGRIDADE_* dos detalhes (sem repetir). */
function trava(r) {
  assert.equal(r.ok, false, 'o comando devia ser recusado');
  return { code: r.erro.code, codigos: [...new Set(r.erro.details.map((d) => d.codigo))].sort() };
}
/** Nada gravado e a chave continua livre (06, seção 8: recusa não consome a chave). */
function nadaGravado(s, antes, chave) {
  assert.deepEqual(s.retrato(), antes, 'nada gravado: operações, eventos e versão iguais');
  if (chave) assert.equal(s.exec((ctx) => s.G.UnitOfWork.status(ctx, chave)).situacao, 'INEXISTENTE', 'a chave ' + chave + ' continua livre');
}

// ---------------------------------------------------------------- caminhos sem a conferência própria (helpers) ----
const COLUNAS_DO_SISTEMA = {
  EVENTOS: ['op_id', 'status', 'idempotency_key', 'reversed_by_event_id', 'confirmed_at', 'created_at'],
  FINANCEIRO: ['status', 'cancelado_em', 'cancelado_por_event_id', 'status_pagamento', 'data_pagamento', 'animal_id'],
  IDENTIFICACOES: ['data_fim'],
};
function limpo(t, r) {
  const o = Object.assign({}, r);
  (COLUNAS_DO_SISTEMA[t] || []).forEach((c) => { delete o[c]; });
  return o;
}
/**
 * ESTORNO gravado sem nenhuma conferência do motor: o que um caminho de estorno que esquecesse a dele gravaria (a linha do
 * ESTORNO, como a do EventService, e o escopo das projeções do evento estornado).
 */
function estornoSemConferencia(s, eventId, chave) {
  return s.cmd((ctx) => s.G.UnitOfWork.run(ctx, {
    rota: 'evento.estornar', idempotencyKey: chave, dados: { event_id: eventId, justificativa: 'sem conferência' }, acessoCru: true,
    reads: s.G.Timeline.LEITURAS.concat(['ANEXOS']),
    tratador: (tx) => {
      const alvo = tx.cru.cruPorId('EVENTOS', eventId);
      const id = tx.novoId();
      tx.plano.anexar('EVENTOS', {
        event_id: id, event_seq: tx.repo.contador('EVENTOS', 'event_seq'), event_type: 'ESTORNO', event_subtype: null, event_date: tx.hoje, registration_date: tx.hoje,
        property_id: alvo.property_id, source: 'APP', confiabilidade: 'CONFIRMADA', pre_marco_zero: false, payload_json: { justificativa: 'sem conferência' }, reversal_of_event_id: eventId,
      });
      const animais = [...new Set(tx.cru.cruPor('EVENTO_ANIMAIS', 'event_id', eventId).map((l) => l.animal_id))];
      return { resumo: { event_id: id }, derivados: { animais, eventos: [eventId, id] } };
    },
  }));
}
/**
 * Correção (substituto) gravada sem nenhuma conferência do motor: as linhas do original copiadas com chaves novas (o
 * substituto aponta o original), `mudar(linhas, mapa)` muda o que a correção muda, e `derivados(animais, ev, orig)` dá o
 * escopo das projeções (o de sempre: os animais e os dois eventos).
 */
function correcaoSemConferencia(s, eventId, chave, mudar, derivados) {
  return s.cmd((ctx) => s.G.UnitOfWork.run(ctx, {
    rota: 'evento.corrigir', idempotencyKey: chave, dados: { event_id: eventId, justificativa: 'sem conferência' }, acessoCru: true,
    reads: s.G.Timeline.LEITURAS.concat(['ANEXOS', 'COMPRAS', 'VENDAS', 'BAIXAS', 'PLANO_CONTAS']),
    tratador: (tx) => {
      const cru = tx.cru;
      const mapa = {};
      const novo = (x) => (x === null || x === undefined || x === '' ? x : (mapa[x] = mapa[x] || tx.novoId()));
      const orig = cru.cruPorId('EVENTOS', eventId);
      const ev = novo(eventId);
      const linhas = { EVENTOS: [Object.assign(limpo('EVENTOS', orig), { event_id: ev, event_seq: tx.repo.contador('EVENTOS', 'event_seq'), registration_date: tx.hoje, reversal_of_event_id: eventId, payload_json: Object.assign({}, orig.payload_json, { justificativa: 'sem conferência' }) })] };
      ['EVENTO_ANIMAIS', 'COMPRAS', 'VENDAS', 'PESAGENS', 'IDENTIFICACOES', 'BAIXAS', 'AJUSTES', 'REPRODUCAO', 'FINANCEIRO'].forEach((t) => {
        cru.cruPor(t, 'event_id', eventId).forEach((r) => {
          const pk = s.G.Schema.pk(t);
          (linhas[t] = linhas[t] || []).push(Object.assign(limpo(t, r), { [pk]: novo(r[pk]), event_id: ev }));
        });
      });
      (linhas.FINANCEIRO || []).slice().forEach((f) => {
        const antigo = Object.keys(mapa).find((k) => mapa[k] === f.financial_id);
        cru.cruPor('PARCELAS', 'financial_id', antigo).forEach((p) => { (linhas.PARCELAS = linhas.PARCELAS || []).push(Object.assign({}, p, { parcela_id: tx.novoId(), financial_id: f.financial_id })); });
        cru.cruPor('RATEIOS', 'financial_id', antigo).forEach((r) => {
          (linhas.RATEIOS = linhas.RATEIOS || []).push(Object.assign({}, r, { rateio_id: novo(r.rateio_id), financial_id: f.financial_id, event_id: ev, escopo_ref: r.escopo_ref === eventId ? ev : r.escopo_ref }));
          cru.cruPor('ALOCACOES_FINANCEIRAS', 'rateio_id', r.rateio_id).forEach((a) => {
            (linhas.ALOCACOES_FINANCEIRAS = linhas.ALOCACOES_FINANCEIRAS || []).push(Object.assign({}, a, { alloc_id: tx.novoId(), rateio_id: mapa[r.rateio_id], financial_id: f.financial_id }));
          });
        });
      });
      if (mudar) mudar(linhas, mapa);
      Object.keys(linhas).forEach((t) => linhas[t].forEach((r) => tx.plano.anexar(t, r)));
      const animais = [...new Set((linhas.EVENTO_ANIMAIS || []).map((l) => l.animal_id))];
      return { resumo: { event_id: ev }, derivados: derivados ? derivados(animais, ev, eventId) : { animais, eventos: [eventId, ev] } };
    },
  }));
}
/** Correção de cadastro (AJUSTE_INVENTARIO/CORRECAO_CADASTRO) gravada sem as conferências do motor. */
function correcaoDeCadastroSemConferencia(s, animalId, campo, valorNovo, data, chave) {
  return s.cmd((ctx) => s.G.UnitOfWork.run(ctx, {
    rota: 'evento.registrar', idempotencyKey: chave, dados: { animal_id: animalId, campo, valor_novo: valorNovo }, acessoCru: true,
    reads: s.G.Timeline.LEITURAS,
    tratador: (tx) => {
      const a = tx.repo.porId('ANIMAIS', animalId);
      const ev = tx.novoId();
      tx.plano.anexar('EVENTOS', {
        event_id: ev, event_seq: tx.repo.contador('EVENTOS', 'event_seq'), event_type: 'AJUSTE_INVENTARIO', event_subtype: 'CORRECAO_CADASTRO', event_date: data, registration_date: tx.hoje,
        property_id: a.propriedade_atual_id || PROP, source: 'APP', confiabilidade: 'CONFIRMADA', pre_marco_zero: false, payload_json: {},
      });
      tx.plano.anexar('EVENTO_ANIMAIS', { event_animal_id: tx.novoId(), event_id: ev, animal_id: animalId, papel: 'SUJEITO', efeito_inventario: 0 });
      tx.plano.anexar('AJUSTES', { ajuste_id: tx.novoId(), event_id: ev, animal_id: animalId, entidade: 'ANIMAIS', entity_id: animalId, tipo_ajuste: 'CORRECAO_CADASTRO', campo, valor_anterior: a[campo] === null ? null : String(a[campo]), valor_novo: valorNovo, justificativa: 'sem conferência' });
      return { resumo: { event_id: ev }, derivados: { animais: [animalId], eventos: [ev] } };
    },
  }));
}
/** Troca de brinco gravada pelo caminho da identificação, mas com o escopo das projeções esquecendo o animal (fase C incompleta). */
function trocaSemProjetar(s, animalId, codigo, data, chave) {
  return s.cmd((ctx) => s.G.UnitOfWork.run(ctx, {
    rota: 'evento.registrar', idempotencyKey: chave, dados: { animal_id: animalId, codigo }, acessoCru: true,
    reads: s.G.Timeline.LEITURAS,
    tratador: (tx) => {
      const ev = tx.novoId();
      tx.plano.anexar('EVENTOS', {
        event_id: ev, event_seq: tx.repo.contador('EVENTOS', 'event_seq'), event_type: 'IDENTIFICACAO', event_subtype: 'SUBSTITUICAO', event_date: data, registration_date: tx.hoje,
        property_id: PROP, source: 'APP', confiabilidade: 'CONFIRMADA', pre_marco_zero: false, payload_json: {},
      });
      tx.plano.anexar('EVENTO_ANIMAIS', { event_animal_id: tx.novoId(), event_id: ev, animal_id: animalId, papel: 'SUJEITO', efeito_inventario: 0 });
      tx.plano.anexar('IDENTIFICACOES', { ident_id: tx.novoId(), animal_id: animalId, event_id: ev, tipo: 'BRINCO', codigo, codigo_norm: s.G.Utils.normalizarBrinco(codigo, false), data_inicio: data, motivo: 'PERDA' });
      return { resumo: { event_id: ev }, derivados: { animais: [], eventos: [ev] } };
    },
  }));
}

// ---------------------------------------------------------------- importação (apoio) ----
function criarImportacao(s, tipo, csv, chave) {
  return s.ok((ctx) => s.G.ImportService.criar(ctx, { idempotencyKey: chave, avisosAceitos: ['POSSIVEL_DUPLICIDADE'], dados: { tipo, arquivo_nome: chave + '.csv', conteudo_base64: b64(csv), formato: FORMATO } })).dados;
}
function validarTudo(s, id, mapa) {
  for (let b = 1; b < 100; b++) {
    const e = s.ok((ctx) => s.G.ImportService.validarBloco(ctx, { idempotencyKey: 'val-' + id + '-' + b, dados: { import_id: id, bloco: b, mapeamento: mapa } })).dados;
    if (e.importacao.status === 'VALIDADO') return e;
  }
  throw new Error('validação não terminou');
}
function importarBlocos(s, id) {
  let r = s.cmd((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: AV, dados: { import_id: id, bloco: 1, modo: 'TOTAL' } }));
  assert.ok(r.ok, JSON.stringify(r.erro));
  for (let b = 2; r.valor.dados.blocos.proximo !== null; b++) {
    r = s.cmd((ctx) => s.G.ImportService.importarBloco(ctx, { avisosAceitos: AV, dados: { import_id: id, bloco: b } }));
    assert.ok(r.ok, JSON.stringify(r.erro));
  }
}
const concluir = (s, id) => s.cmd((ctx) => s.G.ImportService.concluir(ctx, { dados: { import_id: id } }));
const MAPA_ANIMAIS = { colunas: { Brinco: 'brinco', Sexo: 'sexo', 'Nasc.': 'data_nascimento', Pasto: 'pasto' }, confiancas: { data_nascimento: 'ESTIMADA' }, padroes: { castrado: false, reprodutor: false } };
const MAPA_COMPRAS = {
  colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco', Brinco: 'brinco', Sexo: 'sexo', Nascimento: 'data_nascimento', Pasto: 'pasto' },
  confiancas: { data_nascimento: 'ESTIMADA' }, padroes: {},
};
const MAPA_TRANSF = { colunas: { Data: 'data', 'Pasto de origem': 'pasto_origem', 'Pasto de destino': 'pasto_destino', Brinco: 'brinco' }, confiancas: {}, padroes: {} };

// ================================================================ caminhos sem a conferência própria (achados aqui) ====
test('GENEALOGIA pela correção do cadastro de referência: o touro externo de um parto só de natimorto não vira fêmea nem nasce depois do parto (RN-060)', () => {
  const s = base();
  const ext = s.ok((ctx) => s.G.AnimalService.cadastrarExterno(ctx, { idempotencyKey: 'ext', dados: { campos: { nome: 'Touro de sêmen', sexo: 'M', data_nascimento: '2015-01-01', data_nascimento_confianca: 'ESTIMADA' } } })).dados.animal_id;
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const p = s.reg('registrar', parto('2026-03-10', V, [{ situacao_nascimento: 'NATIMORTO' }], { pai_id: ext, pai_confianca: 'CONFIRMADA' }));
  const antes = s.retrato();
  const r = s.cmd((ctx) => s.G.AnimalService.editar(ctx, { idempotencyKey: 'ext-sexo', dados: { animal_id: ext, campos: { sexo: 'F' } } }));
  assert.deepEqual(trava(r), { code: 'CONFLICT', codigos: ['INTEGRIDADE_GENEALOGIA'] });
  // Revisão final, achado 16: o que ficaria errado no condicional, e o touro de fora pelo nome.
  assert.match(r.erro.message, /^Não dá para gravar: os dados ficariam errados\. O parto de 10\/03\/2026 \(mãe A-000002 \(brinco 100\)\) teria como pai Touro de sêmen \(A-000001\), que passaria a ser fêmea\. O pai \(touro\)/);
  assert.deepEqual([r.erro.details[0].conflito.event_id, r.erro.details[0].conflito.tipo, r.erro.details[0].animal_id], [p.event_id, 'NASCIMENTO', ext], 'aponta o parto que impede');
  nadaGravado(s, antes, 'ext-sexo');
  const r2 = s.cmd((ctx) => s.G.AnimalService.editar(ctx, { idempotencyKey: 'ext-nasc', dados: { animal_id: ext, campos: { data_nascimento: '2026-05-01', data_nascimento_confianca: 'ESTIMADA' } } }));
  assert.deepEqual(trava(r2), { code: 'CONFLICT', codigos: ['INTEGRIDADE_GENEALOGIA'] });
  assert.match(r2.erro.details[0].mensagem, /teria como pai Touro de sêmen \(A-000001\), que ficaria nascido em 01\/05\/2026, não antes dele/);
  nadaGravado(s, antes, 'ext-nasc');
  // O que não quebra nada continua passando: o nome do touro.
  assert.equal(s.cmd((ctx) => s.G.AnimalService.editar(ctx, { idempotencyKey: 'ext-nome', dados: { animal_id: ext, campos: { nome: 'Touro de sêmen (lote 7)' } } })).ok, true);
  assert.deepEqual(s.erros(), []);
});

test('GENEALOGIA pela correção de cadastro: a fêmea que entrou prenhe (diagnóstico no rebanho inicial) não vira macho nem nasce no dia do diagnóstico', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('100', { situacao_reprodutiva: 'PRENHA', partos_previos: 1 })])).animais[0].animal_id;
  const antes = s.retrato();
  const r = s.tent('registrar', correcao('2026-03-01', [{ animal_id: V, campo: 'sexo', valor_novo: 'M' }]));
  assert.deepEqual(trava(r), { code: 'CONFLICT', codigos: ['INTEGRIDADE_GENEALOGIA'] });
  assert.match(r.erro.details[0].mensagem, /O registro reprodutivo de 01\/01\/2026 é de A-000001 \(brinco 100\), que passaria a ser macho\. O registro reprodutivo é de uma fêmea/);
  nadaGravado(s, antes);
  const r2 = s.tent('registrar', correcao('2026-03-01', [{ animal_id: V, campo: 'data_nascimento', valor_novo: '2026-01-01' }]));
  assert.deepEqual(trava(r2), { code: 'CONFLICT', codigos: ['INTEGRIDADE_GENEALOGIA'] });
  nadaGravado(s, antes);
  assert.deepEqual(s.erros(), []);
});

test('LINHA_DO_TEMPO pela correção do cadastro da categoria: a categoria escolhida à mão para uma fêmea não passa a ser só de machos', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const bezerra = s.tabela('CATEGORIAS').find((c) => c.codigo === 'BEZERRA');
  const rc = s.reg('registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'RECLASSIFICACAO', campos: { event_date: '2026-02-01', justificativa: 'conferência' }, animais: [{ animal_id: V, categoria_manual_id: bezerra.category_id }] });
  const antes = s.retrato();
  const r = s.cmd((ctx) => s.G.Config.salvarCategoria(ctx, { idempotencyKey: 'cat', avisosAceitos: ['CATEGORIAS_SEM_COBERTURA'], dados: { category_id: bezerra.category_id, campos: { sexo_aplicavel: 'M' } } }));
  assert.deepEqual(trava(r), { code: 'CONFLICT', codigos: ['INTEGRIDADE_LINHA_DO_TEMPO'] });
  // Revisão final, achados 11 e 16: o que ficaria (no condicional, sem dizer que a categoria já é só de machos) e o caminho
  // que funciona (estornar ou corrigir a reclassificação; voltar à automática não a tira do histórico).
  assert.match(r.erro.details[0].mensagem, /a reclassificação de 01\/02\/2026 deixaria o animal, fêmea pelo cadastro, numa categoria só de machos \(Bezerra\)\. Estorne antes a reclassificação de 01\/02\/2026 \(ou corrija-a para uma categoria que sirva ao sexo do animal\)/);
  assert.equal(r.erro.details[0].conflito.event_id, rc.event_id);
  nadaGravado(s, antes, 'cat');
  assert.equal(s.cmd((ctx) => s.G.Config.salvarCategoria(ctx, { idempotencyKey: 'cat-nome', avisosAceitos: ['CATEGORIAS_SEM_COBERTURA'], dados: { category_id: bezerra.category_id, campos: { nome: 'Bezerra nova' } } })).ok, true, 'mudar só o nome passa');
  assert.deepEqual(s.erros(), []);
});

test('BRINCO e IDENTIFICACOES_ATIVAS pela correção do parâmetro: ligar "ignorar zeros à esquerda" com 012 e 12 em dois animais', () => {
  const s = base({ config: { brinco_ignora_zeros_esquerda: 'N' } });
  s.reg('registrar', S.entradaInicial([vaca('012'), vaca('12')]));
  const antes = s.retrato();
  const r = s.cmd((ctx) => s.G.Config.salvar(ctx, { idempotencyKey: 'zeros', dados: { valores: { brinco_ignora_zeros_esquerda: true } } }));
  assert.deepEqual(trava(r), { code: 'CONFLICT', codigos: ['INTEGRIDADE_BRINCO', 'INTEGRIDADE_IDENTIFICACOES_ATIVAS'] });
  assert.match(r.erro.message, /os dados ficariam errados em 2 pontos/);
  assert.match(r.erro.details.find((d) => d.codigo === 'INTEGRIDADE_BRINCO').mensagem, /O brinco 012 está em 2 animais: A-000001, A-000002\. Use outro número de brinco/);
  nadaGravado(s, antes, 'zeros');
  assert.deepEqual(s.erros(), []);
});

test('COPIAS pela correção do marco zero depois de um histórico importado: a compra antiga ficaria marcada como anterior ao marco zero com data depois dele', () => {
  const s = base();
  s.parceiro('Forn', ['FORNECEDOR']);
  const csv = ['Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Brinco;Sexo;Nascimento;Pasto', 'C0;10/10/2025;Forn;cabeça;2.000,00;2.000,00;500;F;01/01/2024;Pasto A'].join('\n');
  const imp = criarImportacao(s, 'COMPRAS', csv, 'hist');
  validarTudo(s, imp.import_id, MAPA_COMPRAS);
  importarBlocos(s, imp.import_id);
  assert.equal(concluir(s, imp.import_id).ok, true);
  assert.deepEqual(s.erros(), []);
  const antes = s.retrato();
  const r = s.cmd((ctx) => s.G.Config.salvar(ctx, { idempotencyKey: 'd0', dados: { valores: { data_marco_zero: '2025-06-01' } } }));
  assert.deepEqual(trava(r), { code: 'CONFLICT', codigos: ['INTEGRIDADE_COPIAS'] });
  assert.ok(r.erro.details.every((d) => /mantenha o marco zero, ou desfaça antes o que foi lançado com a data antiga/.test(d.mensagem) && !/Restaure o backup/.test(d.mensagem)), JSON.stringify(r.erro.details));
  nadaGravado(s, antes, 'd0');
  assert.equal(s.cmd((ctx) => s.G.Config.salvar(ctx, { idempotencyKey: 'd0-ok', dados: { valores: { data_marco_zero: '2025-12-01' } } })).ok, true, 'um marco zero que ainda deixa a compra antes dele passa');
  assert.deepEqual(s.erros(), []);
});

test('BRINCO pela conclusão da importação: o lote pendente mexido à mão (o brinco de outro animal) não passa a valer', () => {
  const s = base();
  s.reg('registrar', S.entradaInicial([vaca('300')]));
  const csv = ['Brinco;Sexo;Nasc.;Pasto', '700;F;10/01/2022;Pasto A', '701;F;10/01/2022;Pasto A'].join('\n');
  const imp = criarImportacao(s, 'ANIMAIS', csv, 'rebanho');
  validarTudo(s, imp.import_id, MAPA_ANIMAIS);
  importarBlocos(s, imp.import_id);
  // O brinco pendente da linha 701 é trocado à mão para o 300, que é de um animal do rebanho.
  const idt = s.tabela('IDENTIFICACOES').find((x) => x.codigo === '701');
  s.editar('IDENTIFICACOES', idt.ident_id, 'codigo', '300');
  s.editar('IDENTIFICACOES', idt.ident_id, 'codigo_norm', '300');
  const antes = s.retrato();
  const r = concluir(s, imp.import_id);
  assert.deepEqual(trava(r), { code: 'CONFLICT', codigos: ['INTEGRIDADE_BRINCO', 'INTEGRIDADE_IDENTIFICACOES_ATIVAS'] });
  nadaGravado(s, antes, 'imp:' + imp.import_id + ':concluir');
  assert.equal(s.tabela('IMPORTACOES').find((i) => i.import_id === imp.import_id).status, 'IMPORTANDO', 'a importação continua em curso, para desfazer');
  assert.equal(s.cmd((ctx) => s.G.ImportService.desfazer(ctx, { dados: { import_id: imp.import_id, justificativa: 'lote mexido' } })).ok, true);
  assert.deepEqual(s.erros(), []);
});

test('BRINCO e IDENTIFICACOES_ATIVAS pelo desfazer da importação: sem a conferência do que volta, o brinco devolvido ao animal é hoje de outro', () => {
  const s = base({ config: { brinco_permite_reuso: 'S', importacao_lote_linhas: '50' } });
  s.parceiro('Vizinho', ['FORNECEDOR']);
  const [X, Y] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('200', { data_nascimento: '2020-01-10' })])).animais.map((a) => a.animal_id);
  s.reg('registrar', { tipo: 'DESCARTE', campos: { event_date: '2026-03-01', destino: 'DOACAO', motivo: 'IDADE' }, animais: [{ animal_id: X }] });
  const mapa = { colunas: { 'Nº da compra': 'grupo', 'Data da compra': 'data', Fornecedor: 'fornecedor', 'Como foi o preço': 'modalidade', 'Valor dos animais (R$)': 'valor_animais', 'Preço (R$)': 'preco', 'Primeiro vencimento': 'vencimento', Código: 'codigo', Brinco: 'brinco', Sexo: 'sexo', Pasto: 'pasto' }, confiancas: {}, padroes: {} };
  const codigoX = s.tabela('ANIMAIS').find((a) => a.animal_id === X).codigo_interno;
  const csv = 'Nº da compra;Data da compra;Fornecedor;Como foi o preço;Valor dos animais (R$);Preço (R$);Primeiro vencimento;Código;Brinco;Sexo;Pasto\nC1;10/05/2026;Vizinho;cabeça;2.000,00;2.000,00;10/06/2026;' + codigoX + ';500;F;Pasto A';
  const imp = criarImportacao(s, 'COMPRAS', csv, 'compras');
  validarTudo(s, imp.import_id, mapa);
  importarBlocos(s, imp.import_id);
  assert.equal(concluir(s, imp.import_id).ok, true);
  s.reg('registrar', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-06-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: Y, codigo: '100', motivo: 'PERDA' }] });
  const antes = s.retrato();
  // O caminho com a conferência própria recusa pelo motivo dele (o brinco que hoje é de outro).
  const d = s.cmd((ctx) => s.G.ImportService.desfazer(ctx, { dados: { import_id: imp.import_id, justificativa: 'arquivo errado' } }));
  assert.deepEqual([d.erro.code, S.codigos(d.erro)], ['CONFLICT', ['DEPENDENTE']]);
  nadaGravado(s, antes);
  // O mesmo desfazer sem essa conferência (o que um desfazer incompleto faria): a trava recusa.
  const conferir = s.G.EventService.conferirRestauracao;
  s.G.EventService.conferirRestauracao = () => [];
  let d2;
  try {
    d2 = s.cmd((ctx) => s.G.ImportService.desfazer(ctx, { dados: { import_id: imp.import_id, justificativa: 'arquivo errado' } }));
  } finally {
    s.G.EventService.conferirRestauracao = conferir;
  }
  assert.deepEqual(trava(d2), { code: 'CONFLICT', codigos: ['INTEGRIDADE_BRINCO', 'INTEGRIDADE_IDENTIFICACOES_ATIVAS'] });
  assert.ok(d2.erro.details.some((x) => /O brinco 100 está em 2 animais/.test(x.mensagem)), JSON.stringify(d2.erro.details));
  nadaGravado(s, antes, 'imp:' + imp.import_id + ':desfazer');
  assert.equal(s.tabela('IMPORTACOES').find((i) => i.import_id === imp.import_id).status, 'IMPORTADO');
  assert.deepEqual(s.erros(), []);
});

// ================================================================ caminhos com a conferência própria ====
test('FK pelo estorno da correção: o estorno do rebanho inicial corrigido (anula a mãe posta por correção de cadastro) — o caminho recusa; sem a conferência, a trava', () => {
  const s = base();
  const ent = s.reg('registrar', S.entradaInicial([vaca('100')]));
  const X = ent.animais[0].animal_id;
  const Y = s.reg('registrar', S.entradaInicial([vaca('200', { data_nascimento: '2023-01-10' })])).animais[0].animal_id;
  const l = s.tabela('EVENTO_ANIMAIS').find((x) => x.event_id === ent.event_id && x.animal_id === X);
  const at = Object.assign({}, l.atributos_iniciais_json);
  ['castrado', 'reprodutor'].forEach((k) => { if (at[k] === 'S' || at[k] === 'N') at[k] = at[k] === 'S'; });
  const cor = s.reg('corrigir', { tipo: 'ENTRADA_INICIAL', event_id: ent.event_id, justificativa: 'observação', campos: {}, animais: [Object.assign({ animal_id: X, pasto_destino_id: l.pasto_destino_id, brinco: '100' }, at, { observacoes: 'corrigido' })] });
  s.reg('registrar', correcao('2026-03-01', [{ animal_id: Y, campo: 'mae_id', valor_novo: X }, { animal_id: Y, campo: 'mae_confianca', valor_novo: 'CONFIRMADA' }]));
  const antes = s.retrato();
  const r = s.tent('estornar', { event_id: cor.event_id, justificativa: 'correção errada' });
  assert.deepEqual([r.erro.code, S.codigos(r.erro)], ['CONFLICT', ['REFERENCIA_GENEALOGICA']], 'o caminho recusa pelo motivo dele');
  nadaGravado(s, antes);
  const r2 = estornoSemConferencia(s, cor.event_id, 'est-cru');
  assert.deepEqual(trava(r2), { code: 'CONFLICT', codigos: ['INTEGRIDADE_FK'] });
  assert.match(r2.erro.details[0].mensagem, /^A-000002 \(brinco 200\) ficaria com a mãe A-000001, que seria anulada \(sem o lançamento que a criou\)\. O registro citado/);
  assert.equal(r2.erro.details[0].animal_id, Y);
  nadaGravado(s, antes, 'est-cru');
  assert.deepEqual(s.erros(), []);
});

test('ENTRADA_ABERTA pelo estorno: estornar a venda de um animal recomprado depois — o caminho recusa; sem a conferência, a trava', () => {
  const s = base();
  const FORN = s.parceiro('Forn', ['FORNECEDOR']);
  const COMP = s.parceiro('Comp', ['COMPRADOR']);
  const X = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const v = s.reg('registrar', venda(COMP, '2026-03-01', [X]));
  s.reg('registrar', compra(FORN, '2026-05-01', [{ animal_id: X }]));
  const antes = s.retrato();
  const r = s.tent('estornar', { event_id: v.event_id, justificativa: 'venda errada' });
  assert.deepEqual([r.erro.code, S.codigos(r.erro)], ['CONFLICT', ['ENTRADA_JA_DENTRO']]);
  const r2 = estornoSemConferencia(s, v.event_id, 'est-venda');
  const t = trava(r2);
  assert.equal(t.code, 'CONFLICT');
  assert.ok(t.codigos.indexOf('INTEGRIDADE_ENTRADA_ABERTA') >= 0 && t.codigos.indexOf('INTEGRIDADE_LINHA_DO_TEMPO') >= 0, JSON.stringify(t));
  assert.ok(r2.erro.details.some((d) => /está ativo, mas os eventos somam 2 entrada\(s\) em aberto\. Cada animal do rebanho tem uma entrada só em aberto/.test(d.mensagem)));
  nadaGravado(s, antes, 'est-venda');
  assert.deepEqual(s.erros(), []);
});

test('BAIXADO_SEM_POSTERIOR pelo estorno da volta ao rebanho com uma transferência depois — o caminho recusa; sem a conferência, a trava', () => {
  const s = base();
  const COMP = s.parceiro('Comp', ['COMPRADOR']);
  const X = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  s.reg('registrar', venda(COMP, '2026-03-01', [X]));
  const volta = s.reg('registrar', { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-04-01', description: 'Devolvida' }, animais: [{ animal_id: X, pasto_destino_id: PASTOS.A }] });
  s.reg('registrar', transferencia('2026-05-01', [X], PASTOS.A, PASTOS.B));
  const antes = s.retrato();
  const r = s.tent('estornar', { event_id: volta.event_id, justificativa: 'não voltou' });
  assert.equal(r.erro.code, 'CONFLICT', 'o caminho recusa pelo motivo dele');
  assert.ok(!S.codigos(r.erro).some((c) => /^INTEGRIDADE_/.test(c)), JSON.stringify(r.erro));
  const r2 = estornoSemConferencia(s, volta.event_id, 'est-volta');
  const t = trava(r2);
  assert.ok(t.codigos.indexOf('INTEGRIDADE_BAIXADO_SEM_POSTERIOR') >= 0, JSON.stringify(t));
  assert.ok(r2.erro.details.some((d) => /"Transferir de pasto de 01\/05\/2026" vale depois da saída do rebanho \("Vender animais de 01\/03\/2026"\)\. Estorne um dos dois\. Animal que saiu do rebanho/.test(d.mensagem)), JSON.stringify(r2.erro.details));
  nadaGravado(s, antes, 'est-volta');
  assert.deepEqual(s.erros(), []);
});

test('PARTOS pela correção de cadastro: a mãe de um parto não vira macho — o caminho recusa; sem a conferência, a trava', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const p = s.reg('registrar', parto('2026-03-10', V, [{ situacao_nascimento: 'VIVO', sexo: 'F' }]));
  const antes = s.retrato();
  const r = s.tent('registrar', correcao('2026-04-01', [{ animal_id: V, campo: 'sexo', valor_novo: 'M' }]));
  assert.deepEqual([r.erro.code, S.codigos(r.erro)], ['VALIDATION', ['SEXO_DO_PROGENITOR']], 'o caminho recusa pelo motivo dele (a mãe da cria)');
  const r2 = correcaoDeCadastroSemConferencia(s, V, 'sexo', 'M', '2026-04-01', 'cad-cru');
  const t = trava(r2);
  assert.equal(t.code, 'CONFLICT');
  assert.ok(t.codigos.indexOf('INTEGRIDADE_PARTOS') >= 0 && t.codigos.indexOf('INTEGRIDADE_GENEALOGIA') >= 0, JSON.stringify(t));
  const dp = r2.erro.details.find((d) => d.codigo === 'INTEGRIDADE_PARTOS');
  assert.match(dp.mensagem, /O parto de 10\/03\/2026 \(mãe A-000001 \(brinco 100\)\) teria como mãe um animal que passaria a ser macho\. A mãe, a data e as crias precisam bater com o parto/);
  assert.equal(dp.conflito.event_id, p.event_id);
  nadaGravado(s, antes, 'cad-cru');
  assert.deepEqual(s.erros(), []);
});

test('PROJECAO pela fase C incompleta: a troca de brinco cujo escopo de projeções esquece o animal deixaria a ficha desatualizada', () => {
  const s = base();
  const X = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  const antes = s.retrato();
  const r = trocaSemProjetar(s, X, '150', '2026-02-01', 'troca-cru');
  assert.deepEqual(trava(r), { code: 'CONFLICT', codigos: ['INTEGRIDADE_PROJECAO'] });
  assert.ok(r.erro.details.some((d) => /A-000001 \(brinco 100\): .*brinco gravado "100", calculado "150".* A ficha desse animal ficaria desatualizada/.test(d.mensagem)), JSON.stringify(r.erro.details));
  nadaGravado(s, antes, 'troca-cru');
  // A mesma troca pelo caminho de sempre passa (e projeta o animal).
  const ok = s.reg('registrar', { tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-02-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: X, codigo: '150', motivo: 'PERDA' }] });
  assert.ok(ok.event_id);
  assert.deepEqual(s.erros(), []);
});

test('PARCELAS, ALOCACOES e FINANCEIRO pela correção da compra (substituto) gravada sem as conferências do motor', () => {
  const s = base();
  const FORN = s.parceiro('Forn', ['FORNECEDOR']);
  const c = s.reg('registrar', compra(FORN, '2026-02-01', [{ brinco: '500', sexo: 'F', idade_meses: 20 }, { brinco: '501', sexo: 'F', idade_meses: 20 }]));
  const antes = s.retrato();
  const casos = [
    ['PARCELAS', (l) => { l.PARCELAS[0].valor += 100; }, /As parcelas somam R\$ 4\.001,00 e o lançamento vale R\$ 4\.000,00/],
    ['ALOCACOES', (l) => { l.ALOCACOES_FINANCEIRAS[0].valor_alocado += 100; l.ALOCACOES_FINANCEIRAS[1].valor_alocado -= 100; l.ALOCACOES_FINANCEIRAS[0].base_valor += 1; }, /As bases das alocações somam/],
    ['FINANCEIRO', (l) => { l.COMPRAS[0].valor_total += 100; }, /A compra registra R\$ 4\.001,00 no total e os lançamentos do evento somam R\$ 4\.000,00/],
  ];
  casos.forEach(([codigo, mudar, frase], i) => {
    const r = correcaoSemConferencia(s, c.event_id, 'cor-cru-' + i, mudar);
    const t = trava(r);
    assert.ok(t.codigos.indexOf('INTEGRIDADE_' + codigo) >= 0, codigo + ': ' + JSON.stringify(t));
    assert.equal(t.code, 'VALIDATION', codigo + ': o problema é das linhas do próprio lançamento');
    assert.ok(r.erro.details.some((d) => frase.test(d.mensagem)), codigo + ': ' + JSON.stringify(r.erro.details.map((d) => d.mensagem)));
    nadaGravado(s, antes, 'cor-cru-' + i);
  });
  // O substituto sem mudança nenhuma passa (as cópias fecham), e a projeção é a reconstrução.
  assert.equal(correcaoSemConferencia(s, c.event_id, 'cor-cru-igual').ok, true);
  assert.deepEqual(s.erros(), []);
});

test('ALOCACAO_DIRETA e CUSTO_AQUISICAO pela correção do substituto: corrigir de novo a compra de um animal só, com o escopo das projeções sem o lançamento e sem o animal', () => {
  const s = base();
  const FORN = s.parceiro('Forn', ['FORNECEDOR']);
  const c = s.reg('registrar', compra(FORN, '2026-02-01', [{ brinco: '500', sexo: 'F', idade_meses: 20 }]));
  const A = c.animais[0].animal_id;
  // Primeira correção pelo caminho de sempre (o preço); a correção do substituto é a que esquece as projeções.
  const sub = s.reg('corrigir', Object.assign(compra(FORN, '2026-02-01', [{ animal_id: A, brinco: '500', sexo: 'F', idade_meses: 20 }]), { event_id: c.event_id, justificativa: 'preço' }));
  const antes = s.retrato();
  const subir = (l) => {
    l.FINANCEIRO[0].valor += 10000;
    l.PARCELAS[0].valor += 10000;
    l.RATEIOS[0].total_alocado += 10000;
    l.RATEIOS[0].base_total += 100;
    l.ALOCACOES_FINANCEIRAS[0].valor_alocado += 10000;
    l.ALOCACOES_FINANCEIRAS[0].base_valor += 100;
    l.COMPRAS[0].valor_animais += 10000;
    l.COMPRAS[0].valor_total += 10000;
    l.EVENTOS[0].total_value += 10000;
    l.EVENTO_ANIMAIS[0].valor_individual += 10000;
  };
  const r = correcaoSemConferencia(s, sub.event_id, 'sub-cru', subir, (animais, ev, orig) => ({ animais: [], eventos: [orig] }));
  const t = trava(r);
  assert.ok(t.codigos.indexOf('INTEGRIDADE_ALOCACAO_DIRETA') >= 0 && t.codigos.indexOf('INTEGRIDADE_CUSTO_AQUISICAO') >= 0, JSON.stringify(t));
  assert.ok(r.erro.details.some((d) => d.codigo === 'INTEGRIDADE_CUSTO_AQUISICAO' && /custo_aquisicao gravado 200000, calculado 210000/.test(d.mensagem)), JSON.stringify(r.erro.details.map((d) => d.mensagem)));
  nadaGravado(s, antes, 'sub-cru');
  // O mesmo substituto com o escopo de sempre passa.
  assert.equal(correcaoSemConferencia(s, sub.event_id, 'sub-ok', subir).ok, true);
  assert.equal(s.tabela('ANIMAIS').find((a) => a.animal_id === A).custo_aquisicao, 210000);
  assert.deepEqual(s.erros(), []);
});

// ================================================================ problema antigo, simulação e chave ====
test('problema antigo não bloqueia o comando que não o piora; o comando que o piora é recusado', () => {
  const s = base();
  const [A, B, C] = s.reg('registrar', S.entradaInicial([vaca('100'), vaca('200'), vaca('300')])).animais.map((a) => a.animal_id);
  // Adulteração à mão: o brinco de B vira 100 (identificação e cadastro), como o de A.
  const idB = s.tabela('IDENTIFICACOES').find((x) => x.animal_id === B);
  s.editar('IDENTIFICACOES', idB.ident_id, 'codigo', '100');
  s.editar('IDENTIFICACOES', idB.ident_id, 'codigo_norm', '100');
  s.editar('ANIMAIS', B, 'brinco', '100');
  s.editar('ANIMAIS', B, 'brinco_norm', '100');
  const velhos = s.erros();
  assert.ok(velhos.indexOf('BRINCO') >= 0 && velhos.indexOf('IDENTIFICACOES_ATIVAS') >= 0, JSON.stringify(velhos));
  // Comandos que tocam A (o vizinho do problema) sem piorá-lo passam: transferência, correção de cadastro, estorno.
  const t = s.reg('registrar', transferencia('2026-02-01', [A], PASTOS.A, PASTOS.B));
  s.reg('registrar', correcao('2026-02-02', [{ animal_id: A, campo: 'data_nascimento', valor_novo: '2019-02-10' }]));
  s.reg('estornar', { event_id: t.event_id, justificativa: 'pasto errado' });
  assert.deepEqual(s.erros().sort(), velhos.sort(), 'o problema antigo continua o mesmo');
  // Piorar: dar o mesmo número a um terceiro animal (C) por uma troca gravada sem as conferências do motor.
  const antes = s.retrato();
  const r = s.cmd((ctx) => s.G.UnitOfWork.run(ctx, {
    rota: 'evento.registrar', idempotencyKey: 'piora', dados: { animal_id: C }, acessoCru: true, reads: s.G.Timeline.LEITURAS,
    tratador: (tx) => {
      const ev = tx.novoId();
      tx.plano.anexar('EVENTOS', { event_id: ev, event_seq: tx.repo.contador('EVENTOS', 'event_seq'), event_type: 'IDENTIFICACAO', event_subtype: 'SUBSTITUICAO', event_date: '2026-03-01', registration_date: tx.hoje, property_id: PROP, source: 'APP', confiabilidade: 'CONFIRMADA', pre_marco_zero: false, payload_json: {} });
      tx.plano.anexar('EVENTO_ANIMAIS', { event_animal_id: tx.novoId(), event_id: ev, animal_id: C, papel: 'SUJEITO', efeito_inventario: 0 });
      tx.plano.anexar('IDENTIFICACOES', { ident_id: tx.novoId(), animal_id: C, event_id: ev, tipo: 'BRINCO', codigo: '100', codigo_norm: '100', data_inicio: '2026-03-01', motivo: 'PERDA' });
      return { resumo: { event_id: ev }, derivados: { animais: [C], eventos: [ev] } };
    },
  }));
  const tr = trava(r);
  assert.equal(tr.code, 'VALIDATION', 'o número repetido é da linha do próprio lançamento');
  assert.ok(tr.codigos.indexOf('INTEGRIDADE_BRINCO') >= 0, JSON.stringify(tr));
  assert.ok(r.erro.details.some((d) => /O brinco 100 está em 3 animais/.test(d.mensagem)), JSON.stringify(r.erro.details));
  nadaGravado(s, antes, 'piora');
});

test('a simulação passa pela mesma trava; a recusa não consome a chave, e o mesmo formulário corrigido grava com ela', () => {
  const s = base();
  const ext = s.ok((ctx) => s.G.AnimalService.cadastrarExterno(ctx, { idempotencyKey: 'ext', dados: { campos: { nome: 'Touro de sêmen', sexo: 'M' } } })).dados.animal_id;
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  s.reg('registrar', parto('2026-03-10', V, [{ situacao_nascimento: 'NATIMORTO' }], { pai_id: ext, pai_confianca: 'CONFIRMADA' }));
  const pedido = { animal_id: ext, campos: { sexo: 'F' } };
  const sim = s.cmd((ctx) => s.G.UnitOfWork.run(ctx, Object.assign(s.G.AnimalService.comandoEditar({ idempotencyKey: 'chave-1', dados: pedido }), { modo: 'SIMULAR' })));
  assert.deepEqual(trava(sim), { code: 'CONFLICT', codigos: ['INTEGRIDADE_GENEALOGIA'] });
  const antes = s.retrato();
  const r = s.cmd((ctx) => s.G.AnimalService.editar(ctx, { idempotencyKey: 'chave-1', dados: pedido }));
  assert.deepEqual(trava(r), { code: 'CONFLICT', codigos: ['INTEGRIDADE_GENEALOGIA'] });
  assert.equal(r.erro.message, sim.erro.message, 'a simulação recusa com a mesma mensagem');
  nadaGravado(s, antes, 'chave-1');
  // A chave continua livre: o formulário corrigido (outro conteúdo) grava com ela, sem IDEMPOTENCY_MISMATCH.
  const ok = s.cmd((ctx) => s.G.AnimalService.editar(ctx, { idempotencyKey: 'chave-1', dados: { animal_id: ext, campos: { nome: 'Touro de sêmen A' } } }));
  assert.equal(ok.ok, true, JSON.stringify(ok.erro));
  assert.deepEqual(s.erros(), []);
});
