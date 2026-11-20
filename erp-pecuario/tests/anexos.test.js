'use strict';
/**
 * Anexos de evento (E2.9): nota fiscal, GTA, laudo e foto ligados ao event_id do evento (03a, seção 5.1), inclusive nos
 * lançamentos financeiros da compra e da venda (entidade FINANCEIRO, com o event_id do evento que criou o lançamento);
 * evento.obter devolve os anexos; o anexo de evento estornado continua consultável (histórico) e não recebe nem perde
 * arquivo; a correção passa os anexos ao substituto (mesmo arquivo do Drive, lançamento correspondente); remoção com
 * justificativa e auditoria, sem levar à lixeira o arquivo que o histórico ainda usa; os limites de tamanho e de tipo do
 * anexo de animal; gravação que falha não deixa anexo consultável; rotas pela api(). Tudo no fake do Drive; depois de
 * CADA comando, projeção = reconstrução e as invariantes financeiras (apoio-eventos).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./apoio-cadastros');
const S = require('./apoio-sistema');

const { js, PASTOS, bicho, entradaInicial, codigos } = C;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const PDF = (s) => b64('%PDF-1.4 ' + s);

function erroDe(r) {
  if (r.ok) return null;
  const e = r.erro || {};
  return { code: e.code || 'EXCECAO', message: e.message, details: js(e.details || []) };
}

/** Ambiente do motor (cadastros semeados) com a porta de arquivos sobre o fake do Drive. */
function ambiente() {
  const c = C.ambienteCadastros();
  const { m, G } = c;
  const gas = m.gas;
  const ctx = () => m.amb.ctx({ files: G.FileService.porta() });
  let n = 0;
  const a = {
    c, m, G, gas,
    parceiro: (nome, tipos) => c.run('Config.comandoSalvarParceiro', { campos: { nome, tipos } }).dados.partner_id,
    /** fn(ctx) numa execução, sem lançar; confere a projeção e as invariantes depois. */
    tentar(fn, msg) {
      const r = gas.tentar(() => js(fn(ctx())));
      m.conferirProjecoes(msg || 'depois do comando de anexo');
      return { ok: r.ok, valor: r.valor, erro: erroDe(r) };
    },
    exec(fn, msg) {
      const r = a.tentar(fn, msg);
      if (!r.ok) throw new Error('falhou: ' + r.erro.code + ' ' + r.erro.message + ' ' + JSON.stringify(r.erro.details));
      return r.valor;
    },
    pedidoAnexo: (entidade, id, extra) => ({
      idempotencyKey: 'anx-' + (++n),
      dados: Object.assign({ entidade, entity_id: id, tipo: 'NOTA_FISCAL', nome_arquivo: 'nf-' + n + '.pdf', mime_type: 'application/pdf', conteudo_base64: PDF('nota ' + n) }, extra || {}),
    }),
    anexar: (entidade, id, extra) => a.exec((x) => G.FileService.adicionarAnexo(x, a.pedidoAnexo(entidade, id, extra)), 'depois de anexar').dados,
    tentarAnexar: (entidade, id, extra) => a.tentar((x) => G.FileService.adicionarAnexo(x, a.pedidoAnexo(entidade, id, extra))),
    remover: (anexoId, justificativa, chave) => a.tentar((x) => G.FileService.removerAnexo(x, { idempotencyKey: chave || 'rem-' + (++n), dados: { anexo_id: anexoId, justificativa } })),
    obterArquivo: (anexoId, miniatura) => a.tentar((x) => G.FileService.obterAnexo(x, { anexo_id: anexoId, miniatura: !!miniatura })),
    obter: (eventId) => m.obter(eventId),
    linha: (anexoId) => m.tabela('ANEXOS').find((x) => x.anexo_id === anexoId),
    criacoes: () => gas.drive.chamadas.filter((x) => x.metodo === 'create').length,
    /** Verificação de integridade sem erro de dado (o banco do apoio não passa pelo setup: cabeçalhos e fuso ficam de fora). */
    integridadeSemErro(msg) {
      const rel = js(gas.exec(() => G.AuditService.verificarIntegridade(ctx()).dados));
      const erros = rel.achados.filter((x) => x.severidade === 'ERRO' && x.checagem !== 'CABECALHOS' && x.checagem !== 'FUSO_LOCALE');
      assert.deepEqual(erros, [], msg);
    },
  };
  return a;
}
function garrote(brinco, extra) {
  return Object.assign({ brinco, sexo: 'M', castrado: false, reprodutor: false, idade_meses: 14 }, extra || {});
}
function compra(data, fornecedor, animais, campos, extra) {
  return Object.assign({ tipo: 'COMPRA', campos: Object.assign({ event_date: data, partner_id: fornecedor, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 300000, valor_animais: 300000 * animais.length }, campos || {}), animais }, extra || {});
}
const finsDe = (m, eventId) => m.tabela('FINANCEIRO').filter((f) => f.event_id === eventId);

// ------------------------------------------------------------------ compra ----
test('compra: nota fiscal, GTA, laudo e foto ligados ao event_id; o boleto do frete no lançamento (FINANCEIRO) com o event_id da compra; evento.obter devolve todos', () => {
  const a = ambiente();
  const { m, gas } = a;
  const f = a.parceiro('Agropecuária Rio Novo', 'FORNECEDOR');
  const t = a.parceiro('Transportes Serra', 'TRANSPORTADOR');
  const r = m.run('registrar', compra('2026-03-10', f, [garrote('0501'), garrote('0502')], { nota_fiscal: '000123', gta_numero: 'GTA-55' }, {
    parcelas: [{ data_vencimento: '2026-04-10' }], custos: [{ tipo: 'FRETE', valor: 40000, partner_id: t }],
  }));
  const ev = r.dados.event_id;
  const [principal, frete] = finsDe(m, ev);
  const nf = a.anexar('EVENTOS', ev, { tipo: 'NOTA_FISCAL', nome_arquivo: 'nf-000123.pdf', descricao: 'NF de compra 000123' });
  const gta = a.anexar('EVENTOS', ev, { tipo: 'GTA', nome_arquivo: 'gta-55.pdf' });
  const laudo = a.anexar('EVENTOS', ev, { tipo: 'DOCUMENTO', nome_arquivo: 'laudo-brucelose.pdf', descricao: 'Laudo de brucelose' });
  const foto = a.anexar('EVENTOS', ev, { tipo: 'FOTO', nome_arquivo: 'embarque.jpg', mime_type: 'image/jpeg', conteudo_base64: b64('jpeg-embarque'), miniatura_base64: b64('mini') });
  const boleto = a.anexar('FINANCEIRO', frete.financial_id, { tipo: 'DOCUMENTO', nome_arquivo: 'boleto-frete.pdf' });
  // Linhas: entidade/entity_id do dono e event_id do evento (no lançamento, o evento que o criou).
  assert.deepEqual([nf, gta, laudo, foto].map((x) => [x.entidade, x.entity_id, x.event_id, x.status, x.vigente, x.financial_id]), Array(4).fill(['EVENTOS', ev, ev, 'ATIVO', true, null]));
  assert.deepEqual([boleto.entidade, boleto.entity_id, boleto.event_id, boleto.financial_id, boleto.vigente], ['FINANCEIRO', frete.financial_id, ev, frete.financial_id, true]);
  assert.equal(a.linha(boleto.anexo_id).event_id, ev, 'gravado na planilha com o event_id da compra');
  assert.equal(gas.drive.arquivo(a.linha(boleto.anexo_id).drive_file_id).appProperties.erp_entidade, 'FINANCEIRO');
  // Criação auditada (comando próprio): uma linha CRIAR por campo, com o event_id.
  assert.ok(a.c.auditoria({ entidade: 'ANEXOS', entity_id: boleto.anexo_id, acao: 'CRIAR', campo: 'event_id' }).some((l) => l.valor_novo === ev));
  // evento.obter: os anexos do evento e os do lançamento, na ordem de envio.
  const o = a.obter(ev);
  assert.deepEqual(o.anexos.map((x) => [x.anexo_id, x.tipo, x.financial_id, x.vigente]), [
    [nf.anexo_id, 'NOTA_FISCAL', null, true], [gta.anexo_id, 'GTA', null, true], [laudo.anexo_id, 'DOCUMENTO', null, true],
    [foto.anexo_id, 'FOTO', null, true], [boleto.anexo_id, 'DOCUMENTO', frete.financial_id, true],
  ]);
  assert.equal(o.anexos[0].descricao, 'NF de compra 000123');
  assert.equal(o.anexos[3].tem_miniatura, true);
  assert.equal(o.anexos.some((x) => x.financial_id === principal.financial_id), false);
  // Conteúdo como data URL (nunca URL); miniatura sob pedido.
  assert.equal(a.obterArquivo(nf.anexo_id).valor.dados.data_url, 'data:application/pdf;base64,' + PDF('nota 1'));
  assert.equal(a.obterArquivo(foto.anexo_id, true).valor.dados.data_url, 'data:image/jpeg;base64,' + b64('mini'));
  assert.equal(a.obterArquivo(boleto.anexo_id).valor.dados.anexo.financial_id, frete.financial_id);
  // O anexo não é fato do rebanho: não muda versão de evento, não toca EVENTOS nem o financeiro.
  assert.equal(m.evento(ev).status, 'CONFIRMADO');
  assert.equal(finsDe(m, ev).length, 2);
  a.integridadeSemErro('anexos de evento e de lançamento: FK por entidade e evento pai');
});

// ------------------------------------------------------------------ venda ----
test('venda: nota fiscal e GTA no evento, romaneio na receita e o recibo da comissão na dedução; outro evento e transferência com GTA', () => {
  const a = ambiente();
  const { m } = a;
  const comprador = a.parceiro('Frigorífico Boi Bom', 'COMPRADOR');
  const ini = m.run('registrar', entradaInicial([bicho({ brinco: '0701', sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' })]));
  const id = ini.dados.animais[0].animal_id;
  const tr = m.run('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-05-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B, gta_numero: 'GTA-9' }, animais: [{ animal_id: id }] });
  const gtaTr = a.anexar('EVENTOS', tr.dados.event_id, { tipo: 'GTA', nome_arquivo: 'gta-9.pdf' });
  const v = m.run('registrar', { tipo: 'VENDA', campos: { event_date: '2026-08-20', partner_id: comprador, finalidade: 'ABATE', modalidade: 'CABECA', preco_unitario: 450000, valor_bruto: 450000, nota_fiscal: 'NF-77' },
    animais: [{ animal_id: id, peso: 510 }], parcelas: [{ data_vencimento: '2026-09-19' }], deducoes: [{ tipo: 'COMISSAO', valor: 9000 }] });
  const ev = v.dados.event_id;
  const [receita, comissao] = finsDe(m, ev);
  const nf = a.anexar('EVENTOS', ev, { tipo: 'NOTA_FISCAL' });
  const gta = a.anexar('EVENTOS', ev, { tipo: 'GTA' });
  const romaneio = a.anexar('FINANCEIRO', receita.financial_id, { tipo: 'DOCUMENTO', nome_arquivo: 'romaneio.pdf', descricao: 'Romaneio de abate' });
  const recibo = a.anexar('FINANCEIRO', comissao.financial_id, { tipo: 'OUTRO', nome_arquivo: 'recibo-comissao.pdf' });
  assert.deepEqual(a.obter(ev).anexos.map((x) => [x.anexo_id, x.entidade, x.financial_id, x.event_id]), [
    [nf.anexo_id, 'EVENTOS', null, ev], [gta.anexo_id, 'EVENTOS', null, ev],
    [romaneio.anexo_id, 'FINANCEIRO', receita.financial_id, ev], [recibo.anexo_id, 'FINANCEIRO', comissao.financial_id, ev],
  ]);
  // Cada evento só traz os seus.
  assert.deepEqual(a.obter(tr.dados.event_id).anexos.map((x) => x.anexo_id), [gtaTr.anexo_id]);
  assert.deepEqual(a.obter(ini.dados.event_id).anexos, []);
  a.integridadeSemErro('anexos da venda');
});

// ------------------------------------------------------------------ estorno ----
test('estorno: os anexos do evento estornado continuam consultáveis (vigente = false); o evento e o lançamento cancelados não recebem nem perdem arquivo; estorno com dependente → CONFLICT e os anexos seguem valendo', () => {
  const a = ambiente();
  const { m, gas } = a;
  const f = a.parceiro('Fornecedor', 'FORNECEDOR');
  const r = m.run('registrar', compra('2026-02-05', f, [garrote('0801'), garrote('0802')], {}, { parcelas: [{ data_vencimento: '2026-03-05' }], custos: [{ tipo: 'FRETE', valor: 3000 }] }));
  const ev = r.dados.event_id;
  const frete = finsDe(m, ev)[1];
  const nf = a.anexar('EVENTOS', ev, { tipo: 'NOTA_FISCAL' });
  const boleto = a.anexar('FINANCEIRO', frete.financial_id, { tipo: 'DOCUMENTO' });
  // Dependente: a transferência posterior impede o estorno (CONFLICT com o detalhe dela); nada muda nos anexos.
  const ids = r.dados.animais.map((x) => x.animal_id);
  const t = m.run('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-03-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: ids[1] }] });
  const bloqueio = m.tentar('estornar', { event_id: ev, justificativa: 'Compra desfeita' });
  assert.equal(bloqueio.erro.code, 'CONFLICT');
  assert.deepEqual(bloqueio.erro.details.map((d) => [d.codigo, d.conflito.event_id, d.conflito.tipo]), [['EVENTO_DEPENDENTE', t.dados.event_id, 'TRANSFERENCIA']]);
  assert.ok(a.obter(ev).anexos.every((x) => x.vigente === true));
  m.run('estornar', { event_id: t.dados.event_id, justificativa: 'Transferência errada' });
  const est = m.run('estornar', { event_id: ev, justificativa: 'Compra desfeita' });
  // Histórico consultável: evento.obter do estornado traz os anexos, marcados como fora de vigência; os bytes seguem.
  const o = a.obter(ev);
  assert.equal(o.evento.status, 'ESTORNADO');
  assert.deepEqual(o.anexos.map((x) => [x.anexo_id, x.vigente, x.status]), [[nf.anexo_id, false, 'ATIVO'], [boleto.anexo_id, false, 'ATIVO']]);
  const lido = a.obterArquivo(nf.anexo_id).valor.dados;
  assert.deepEqual([lido.anexo.vigente, lido.data_url], [false, 'data:application/pdf;base64,' + PDF('nota 1')]);
  assert.equal(a.obterArquivo(boleto.anexo_id).ok, true);
  // O estorno não recebe arquivo; o estornado e o lançamento cancelado também não (o arquivo vai para a lixeira).
  const antes = m.tabela('ANEXOS').length;
  const noEstornado = a.tentarAnexar('EVENTOS', ev);
  assert.deepEqual([noEstornado.erro.code, codigos(noEstornado.erro)], ['VALIDATION', ['JA_ANULADO']]);
  assert.match(noEstornado.erro.message, /estornado ou corrigido e não vale mais/);
  const subido = gas.drive.chamadas.filter((x) => x.metodo === 'create').slice(-1)[0];
  assert.equal(gas.drive.arquivo(subido.id).trashed, true, 'o arquivo recusado foi para a lixeira');
  assert.deepEqual(codigos(a.tentarAnexar('FINANCEIRO', frete.financial_id).erro), ['JA_ANULADO']);
  assert.deepEqual(codigos(a.tentarAnexar('EVENTOS', est.dados.event_id).erro), ['ESTORNO_SEM_ANEXO']);
  assert.equal(m.tabela('ANEXOS').length, antes, 'nenhuma linha nova');
  // Nem se remove: é histórico do evento estornado. O arquivo fica no Drive.
  const rem = a.remover(nf.anexo_id, 'Arquivo errado');
  assert.deepEqual([rem.erro.code, codigos(rem.erro)], ['VALIDATION', ['JA_ANULADO']]);
  assert.equal(a.linha(nf.anexo_id).status, 'ATIVO');
  assert.equal(gas.drive.arquivo(a.linha(nf.anexo_id).drive_file_id).trashed, false);
  // A limpeza diária não leva à lixeira o arquivo do histórico.
  const limpeza = js(gas.exec(() => a.G.Maintenance.limparAnexos(m.amb.ctx({ files: a.G.FileService.porta() }))));
  assert.equal(limpeza.arquivos_removidos, 0);
  assert.equal(gas.drive.arquivo(a.linha(boleto.anexo_id).drive_file_id).trashed, false);
  a.integridadeSemErro('anexos de evento estornado: linhas filhas fora da vigência, sem achado');
});

// ------------------------------------------------------------------ correção ----
test('correção: os anexos passam ao substituto (mesmo arquivo; frete → frete, custo retirado → evento); o original guarda os seus como histórico; remover no substituto não apaga o arquivo do histórico', () => {
  const a = ambiente();
  const { m, gas } = a;
  const f = a.parceiro('Fornecedor', 'FORNECEDOR');
  const dados = compra('2026-03-10', f, [garrote('0901'), garrote('0902')], {}, {
    parcelas: [{ data_vencimento: '2026-04-10' }], custos: [{ tipo: 'FRETE', valor: 20000 }, { tipo: 'OUTRO', valor: 5000, descricao: 'Vacinas na chegada' }],
  });
  const r = m.run('registrar', dados);
  const ev = r.dados.event_id;
  const [, frete, outro] = finsDe(m, ev);
  const nf = a.anexar('EVENTOS', ev, { tipo: 'NOTA_FISCAL' });
  const boletoFrete = a.anexar('FINANCEIRO', frete.financial_id, { tipo: 'DOCUMENTO', nome_arquivo: 'boleto-frete.pdf' });
  const reciboOutro = a.anexar('FINANCEIRO', outro.financial_id, { tipo: 'OUTRO', nome_arquivo: 'recibo-vacinas.pdf' });
  const removido = a.anexar('EVENTOS', ev, { tipo: 'FOTO', nome_arquivo: 'f.jpg', mime_type: 'image/jpeg', conteudo_base64: b64('foto') });
  assert.equal(a.remover(removido.anexo_id, 'Foto de outro lote').ok, true);
  // Correção retroativa (data mais cedo), sem o custo "outro" e com o frete mais caro; os mesmos animais.
  const animais = r.dados.animais.map((x, i) => Object.assign(garrote('090' + (i + 1)), { animal_id: x.animal_id }));
  const corr = { tipo: 'COMPRA', event_id: ev, justificativa: 'Frete e data errados', campos: Object.assign({}, dados.campos, { event_date: '2026-03-01' }), animais, parcelas: dados.parcelas, custos: [{ tipo: 'FRETE', valor: 25000 }] };
  // A simulação mostra quantos anexos passam (o mesmo tratador do commit).
  assert.equal(m.simular('corrigir', corr).valor.dados.impactos.anexos, 3);
  assert.equal(m.simular('corrigir', corr).valor.dados.linhas.ANEXOS, 3);
  const s = m.run('corrigir', corr);
  const novo = s.dados.event_id;
  const freteNovo = finsDe(m, novo)[1];
  const o = a.obter(novo);
  const porNome = Object.fromEntries(o.anexos.map((x) => [x.nome_arquivo, x]));
  assert.deepEqual(o.anexos.map((x) => [x.nome_arquivo, x.entidade, x.entity_id, x.event_id, x.vigente]), [
    [nf.nome_arquivo, 'EVENTOS', novo, novo, true],
    ['boleto-frete.pdf', 'FINANCEIRO', freteNovo.financial_id, novo, true],
    ['recibo-vacinas.pdf', 'EVENTOS', novo, novo, true],
  ], 'frete → frete do substituto; o custo retirado leva o recibo para o evento; o removido não passa');
  // Mesmo arquivo do Drive, quem enviou e quando (a história do envio não muda); linha nova.
  const lNf = a.linha(nf.anexo_id);
  const lCopia = a.linha(porNome[nf.nome_arquivo].anexo_id);
  assert.notEqual(lCopia.anexo_id, lNf.anexo_id);
  assert.deepEqual([lCopia.drive_file_id, lCopia.created_by, lCopia.created_at], [lNf.drive_file_id, lNf.created_by, lNf.created_at]);
  // O original guarda os seus, fora de vigência.
  assert.deepEqual(a.obter(ev).anexos.map((x) => [x.anexo_id, x.vigente]), [[nf.anexo_id, false], [boletoFrete.anexo_id, false], [reciboOutro.anexo_id, false]]);
  // Remover a cópia no substituto (com justificativa e auditoria): o histórico do original ainda usa o arquivo.
  const semMotivo = a.remover(lCopia.anexo_id, '  ');
  assert.deepEqual(codigos(semMotivo.erro), ['CAMPO_OBRIGATORIO']);
  assert.equal(a.remover(lCopia.anexo_id, 'Nota substituída pela carta de correção').ok, true);
  assert.equal(a.linha(lCopia.anexo_id).status, 'REMOVIDO');
  assert.ok(a.c.auditoria({ entidade: 'ANEXOS', entity_id: lCopia.anexo_id, campo: 'status' }).some((l) => l.valor_novo === 'REMOVIDO' && l.justificativa === 'Nota substituída pela carta de correção'));
  assert.equal(gas.drive.arquivo(lNf.drive_file_id).trashed, false, 'o arquivo segue: o original estornado ainda o mostra');
  assert.equal(a.obterArquivo(nf.anexo_id).ok, true);
  assert.equal(a.obterArquivo(lCopia.anexo_id).erro.code, 'NOT_FOUND');
  // Correção da correção: só os ativos do substituto passam (a cópia removida não volta).
  const corr2 = Object.assign({}, corr, { event_id: novo, justificativa: 'Frete de novo', custos: [{ tipo: 'FRETE', valor: 26000 }] });
  const s2 = m.run('corrigir', corr2);
  assert.deepEqual(a.obter(s2.dados.event_id).anexos.map((x) => [x.nome_arquivo, x.entidade]), [['boleto-frete.pdf', 'FINANCEIRO'], ['recibo-vacinas.pdf', 'EVENTOS']]);
  // Estorno do último substituto: os anexos dele ficam como histórico.
  m.run('estornar', { event_id: s2.dados.event_id, justificativa: 'Compra desfeita' });
  assert.ok(a.obter(s2.dados.event_id).anexos.every((x) => x.vigente === false));
  a.integridadeSemErro('cadeia de correções com anexos');
});

test('correção de venda, compra e morte: a comissão vai para a comissão, a receita para a receita, os outros custos para os outros custos; o único lançamento da morte segue o único lançamento, ainda que a conta mude', () => {
  const a = ambiente();
  const { m } = a;
  const comprador = a.parceiro('Comprador', 'COMPRADOR');
  const boi = (b) => bicho({ brinco: b, sexo: 'M', castrado: true, reprodutor: false, data_nascimento: '2023-05-01', data_nascimento_confianca: 'ESTIMADA' });
  const ini = m.run('registrar', entradaInicial([boi('1001'), boi('1002')]));
  const [x1, x2] = ini.dados.animais.map((x) => x.animal_id);
  const vd = { tipo: 'VENDA', campos: { event_date: '2026-08-20', partner_id: comprador, finalidade: 'RECRIA_ENGORDA', modalidade: 'CABECA', preco_unitario: 400000, valor_bruto: 400000 },
    animais: [{ animal_id: x1 }], parcelas: [{ data_vencimento: '2026-09-19' }], deducoes: [{ tipo: 'FRETE', valor: 3000 }, { tipo: 'COMISSAO', valor: 8000 }] };
  const v = m.run('registrar', vd, { avisos: ['RATEIO_SEM_PESO'] });
  const [receita, , comissao] = finsDe(m, v.dados.event_id);
  a.anexar('FINANCEIRO', receita.financial_id, { tipo: 'DOCUMENTO', nome_arquivo: 'romaneio.pdf' });
  a.anexar('FINANCEIRO', comissao.financial_id, { tipo: 'OUTRO', nome_arquivo: 'comissao.pdf' });
  // A correção tira o frete: a comissão passa a ser o 2º lançamento, e o recibo vai com ela (papel, não posição).
  const vs = m.run('corrigir', Object.assign({}, vd, { event_id: v.dados.event_id, justificativa: 'Sem frete', deducoes: [{ tipo: 'COMISSAO', valor: 8000 }] }), { avisos: ['RATEIO_SEM_PESO'] });
  const [receitaN, comissaoN] = finsDe(m, vs.dados.event_id);
  assert.deepEqual(a.obter(vs.dados.event_id).anexos.map((x) => [x.nome_arquivo, x.financial_id]), [['romaneio.pdf', receitaN.financial_id], ['comissao.pdf', comissaoN.financial_id]]);
  // Compra: frete e outros custos vão na mesma conta; tirar o frete não faz o boleto dele ir para os outros custos.
  const f = a.parceiro('Fornecedor', 'FORNECEDOR');
  const cd = compra('2026-04-02', f, [garrote('1101')], {}, { parcelas: [{ data_vencimento: '2026-05-02' }], custos: [{ tipo: 'FRETE', valor: 7000 }, { tipo: 'OUTRO', valor: 2000 }] });
  const c1 = m.run('registrar', cd);
  const [, freteC, outroC] = finsDe(m, c1.dados.event_id);
  assert.equal(freteC.conta_id, outroC.conta_id, 'mesma conta: o papel é que diferencia');
  a.anexar('FINANCEIRO', freteC.financial_id, { tipo: 'DOCUMENTO', nome_arquivo: 'boleto-frete.pdf' });
  a.anexar('FINANCEIRO', outroC.financial_id, { tipo: 'OUTRO', nome_arquivo: 'recibo-outros.pdf' });
  const c2 = m.run('corrigir', Object.assign({}, cd, { event_id: c1.dados.event_id, justificativa: 'Frete por conta do vendedor', animais: [Object.assign(garrote('1101'), { animal_id: c1.dados.animais[0].animal_id })], custos: [{ tipo: 'OUTRO', valor: 2000 }] }));
  const [, outroN] = finsDe(m, c2.dados.event_id);
  assert.deepEqual(a.obter(c2.dados.event_id).anexos.map((x) => [x.nome_arquivo, x.entidade, x.entity_id]), [['boleto-frete.pdf', 'EVENTOS', c2.dados.event_id], ['recibo-outros.pdf', 'FINANCEIRO', outroN.financial_id]]);
  // Morte com custo: o laudo de necropsia vai para o evento; a nota do veterinário, para o lançamento.
  const contas = m.tabela('PLANO_CONTAS').filter((c) => c.natureza === 'CUSTEIO' && c.ativo !== false);
  const mt = { tipo: 'MORTE', campos: { event_date: '2026-09-02', causa: 'DOENCA', custo_valor: 15000, custo_conta_id: contas[0].conta_id }, animais: [{ animal_id: x2 }] };
  const r = m.run('registrar', mt);
  const laudo = a.anexar('EVENTOS', r.dados.event_id, { tipo: 'DOCUMENTO', nome_arquivo: 'laudo-necropsia.pdf' });
  const nota = a.anexar('FINANCEIRO', finsDe(m, r.dados.event_id)[0].financial_id, { tipo: 'NOTA_FISCAL', nome_arquivo: 'nota-veterinario.pdf' });
  const ms = m.run('corrigir', Object.assign({}, mt, { event_id: r.dados.event_id, justificativa: 'Conta errada', campos: Object.assign({}, mt.campos, { custo_conta_id: contas[1].conta_id }) }));
  const finNovo = finsDe(m, ms.dados.event_id)[0];
  assert.notEqual(finNovo.conta_id, contas[0].conta_id);
  assert.deepEqual(a.obter(ms.dados.event_id).anexos.map((x) => [x.nome_arquivo, x.entidade, x.entity_id]), [[laudo.nome_arquivo, 'EVENTOS', ms.dados.event_id], [nota.nome_arquivo, 'FINANCEIRO', finNovo.financial_id]]);
});

// ------------------------------------------------------------------ falhas e limites ----
test('limites e tipos como no anexo de animal: tipo de arquivo, foto que não é imagem, tamanho, dono inexistente, reenvio e justificativa — recusados antes do upload quando possível', () => {
  const a = ambiente();
  const { m, G, gas } = a;
  const ini = m.run('registrar', entradaInicial([bicho({ brinco: '1201' })]));
  const ev = ini.dados.event_id;
  const animal = ini.dados.animais[0].animal_id;
  const antes = a.criacoes();
  // Tipo de arquivo fora da lista (no evento, no lançamento e no animal: a mesma regra), foto em PDF e entidade sem anexo.
  const zip = a.tentarAnexar('EVENTOS', ev, { mime_type: 'application/zip', nome_arquivo: 'x.zip' });
  assert.deepEqual([zip.erro.code, codigos(zip.erro)], ['VALIDATION', ['TIPO_ARQUIVO_INVALIDO']]);
  assert.deepEqual(codigos(a.tentarAnexar('ANIMAIS', animal, { tipo: 'FOTO', mime_type: 'text/html', nome_arquivo: 'x.html' }).erro), ['TIPO_ARQUIVO_INVALIDO']);
  const fotoPdf = a.tentarAnexar('EVENTOS', ev, { tipo: 'FOTO' });
  assert.deepEqual(fotoPdf.erro.details.map((d) => [d.codigo, d.campo]), [['TIPO_ARQUIVO_INVALIDO', 'tipo']]);
  assert.deepEqual(codigos(a.tentarAnexar('PASTOS', PASTOS.A).erro), ['VALOR_FORA_DA_LISTA']);
  // Acima de 5 MB: recusado antes de subir.
  const grande = Buffer.alloc(G.FileService.TAMANHO_MAX_ANEXO + 10, 65).toString('base64');
  assert.equal(a.tentarAnexar('EVENTOS', ev, { conteudo_base64: grande }).erro.code, 'VALIDATION');
  assert.equal(a.criacoes(), antes, 'nada subiu para o Drive');
  // PNG e WEBP são aceitos (como a foto do animal); o limite do Drive vale para todos.
  assert.equal(a.anexar('EVENTOS', ev, { tipo: 'FOTO', mime_type: 'image/png', nome_arquivo: 'p.png', conteudo_base64: b64('png') }).status, 'ATIVO');
  // Dono inexistente: evento, lançamento, evento de gravação que falhou → NOT_FOUND e o arquivo vai para a lixeira.
  [['EVENTOS', C.id(0x9999)], ['FINANCEIRO', C.id(0x9998)]].forEach(([ent, id]) => {
    const r = a.tentarAnexar(ent, id);
    assert.equal(r.erro.code, 'NOT_FOUND', ent);
    const subido = gas.drive.chamadas.filter((x) => x.metodo === 'create').slice(-1)[0];
    assert.equal(gas.drive.arquivo(subido.id).trashed, true, ent + ': arquivo sem linha vai para a lixeira');
  });
  // Reenvio com a mesma chave: duplicado, sem subir de novo; outro conteúdo com a mesma chave → IDEMPOTENCY_MISMATCH.
  const pedido = a.pedidoAnexo('EVENTOS', ev, { tipo: 'GTA' });
  const r1 = a.exec((x) => G.FileService.adicionarAnexo(x, pedido));
  const n1 = a.criacoes();
  const r2 = a.exec((x) => G.FileService.adicionarAnexo(x, pedido));
  assert.deepEqual([r2.duplicado, r2.dados.anexo_id, r2.dados.event_id, a.criacoes()], [true, r1.dados.anexo_id, ev, n1]);
  const outro = a.tentar((x) => G.FileService.adicionarAnexo(x, { idempotencyKey: pedido.idempotencyKey, dados: Object.assign({}, pedido.dados, { conteudo_base64: PDF('outra') }) }));
  assert.equal(outro.erro.code, 'IDEMPOTENCY_MISMATCH');
  // Remoção: justificativa obrigatória; com ela, REMOVIDO, auditoria com o motivo, arquivo na lixeira, fora do evento.
  assert.deepEqual(codigos(a.remover(r1.dados.anexo_id, '').erro), ['CAMPO_OBRIGATORIO']);
  assert.equal(a.linha(r1.dados.anexo_id).status, 'ATIVO');
  assert.equal(a.remover(r1.dados.anexo_id, 'GTA de outro lote').ok, true);
  assert.ok(a.c.auditoria({ entidade: 'ANEXOS', entity_id: r1.dados.anexo_id, campo: 'status' }).some((l) => l.valor_anterior === 'ATIVO' && l.valor_novo === 'REMOVIDO' && l.justificativa === 'GTA de outro lote'));
  assert.equal(gas.drive.arquivo(a.linha(r1.dados.anexo_id).drive_file_id).trashed, true);
  assert.equal(a.obter(ev).anexos.some((x) => x.anexo_id === r1.dados.anexo_id), false);
  assert.equal(a.obterArquivo(r1.dados.anexo_id).erro.code, 'NOT_FOUND');
  assert.deepEqual(codigos(a.remover(r1.dados.anexo_id, 'de novo').erro), ['JA_REMOVIDO']);
  assert.equal(a.remover(C.id(0x7777), 'x').erro.code, 'NOT_FOUND');
});

/** Roda `fn` com a escrita seguinte à que leva linhas de ANEXOS falhando (erro tratável): a fase A fica, sem commit. */
function falharDepoisDosAnexos(gas, fn) {
  let viu = false;
  const cancelar = gas.ganchos.em('escrita', (info) => {
    if (viu) return;
    const abas = info.abas || [info.aba];
    if (abas.indexOf('ANEXOS') >= 0) { viu = true; gas.falhas.falharNaEscrita(2); }
  }, { vezes: 10000 });
  try {
    return fn();
  } finally {
    cancelar();
    gas.falhas.limpar();
    assert.equal(viu, true, 'a fase A escreveu as linhas de ANEXOS');
  }
}

test('gravação que falha: a correção interrompida deixa cópias inertes que ninguém enxerga; o reenvio com a mesma chave passa os anexos uma vez', () => {
  const a = ambiente();
  const { m, gas } = a;
  const f = a.parceiro('Fornecedor', 'FORNECEDOR');
  const dados = compra('2026-03-10', f, [garrote('1301')], {}, { parcelas: [{ data_vencimento: '2026-04-10' }] });
  const r = m.run('registrar', dados);
  const ev = r.dados.event_id;
  const nf = a.anexar('EVENTOS', ev, { tipo: 'NOTA_FISCAL' });
  const corr = { tipo: 'COMPRA', event_id: ev, justificativa: 'Preço', campos: Object.assign({}, dados.campos, { preco_unitario: 310000, valor_animais: 310000 }), animais: [Object.assign(garrote('1301'), { animal_id: r.dados.animais[0].animal_id })], parcelas: dados.parcelas };
  // Depois da escrita que leva as linhas de ANEXOS da fase A, a escrita seguinte falha: a operação não confirma.
  const falha = falharDepoisDosAnexos(gas, () => m.tentar('corrigir', corr, { chave: 'corr-1' }));
  assert.equal(falha.ok, false);
  const inertes = m.tabela('ANEXOS').filter((x) => x.event_id !== ev);
  assert.equal(inertes.length, 1, 'a cópia ficou na planilha, inerte');
  const st = m.ler({ rota: 'teste.status', reads: ['EVENTOS'], acessoCru: true, tratador: (tx) => tx.cru.avaliar(inertes[0].event_id).status });
  assert.equal(st, 'FALHOU');
  assert.equal(a.obterArquivo(inertes[0].anexo_id).erro.code, 'NOT_FOUND', 'linha inerte não é consultável');
  assert.equal(a.remover(inertes[0].anexo_id, 'x').erro.code, 'NOT_FOUND');
  assert.deepEqual(a.obter(ev).anexos.map((x) => [x.anexo_id, x.vigente]), [[nf.anexo_id, true]], 'o original segue valendo com o seu anexo');
  // O reenvio com a mesma chave grava a correção, com uma cópia só que vale.
  const ok = m.run('corrigir', corr, { chave: 'corr-1' });
  assert.deepEqual(a.obter(ok.dados.event_id).anexos.map((x) => [x.nome_arquivo, x.vigente]), [[nf.nome_arquivo, true]]);
  assert.equal(m.tabela('ANEXOS').filter((x) => x.event_id === ok.dados.event_id).length, 1);
  a.integridadeSemErro('linhas inertes de ANEXOS não viram achado de dado');
});

test('limpeza diária e remoção: a cópia inerte de uma correção que falhou não segura o arquivo do anexo removido', () => {
  const a = ambiente();
  const { m, G, gas } = a;
  const f = a.parceiro('Fornecedor', 'FORNECEDOR');
  const dados = compra('2026-03-10', f, [garrote('1401')], {}, { parcelas: [{ data_vencimento: '2026-04-10' }] });
  const r = m.run('registrar', dados);
  const nf = a.anexar('EVENTOS', r.dados.event_id, { tipo: 'NOTA_FISCAL' });
  const arquivo = a.linha(nf.anexo_id).drive_file_id;
  const corr = { tipo: 'COMPRA', event_id: r.dados.event_id, justificativa: 'Preço', campos: Object.assign({}, dados.campos, { preco_unitario: 320000, valor_animais: 320000 }), animais: [Object.assign(garrote('1401'), { animal_id: r.dados.animais[0].animal_id })], parcelas: dados.parcelas };
  assert.equal(falharDepoisDosAnexos(gas, () => m.tentar('corrigir', corr, { chave: 'corr-2' })).ok, false);
  assert.equal(m.tabela('ANEXOS').filter((x) => x.drive_file_id === arquivo).length, 2, 'original + cópia inerte');
  // O original segue valendo: removido com justificativa, o arquivo vai para a lixeira (a cópia inerte não conta).
  assert.equal(a.remover(nf.anexo_id, 'Nota errada').ok, true);
  assert.equal(gas.drive.arquivo(arquivo).trashed, true);
  // Se a lixeira tivesse falhado, a limpeza diária leva o arquivo: a linha inerte não o segura.
  gas.exec(() => G.Drive.Files.update({ trashed: false }, arquivo));
  const rel = js(gas.exec(() => G.Maintenance.limparAnexos(m.amb.ctx({ files: G.FileService.porta() }))));
  assert.deepEqual([rel.arquivos_removidos, gas.drive.arquivo(arquivo).trashed], [1, true]);
});

// ------------------------------------------------------------------ rotas ----
test('rotas pela api(): anexo.adicionar no evento e no lançamento, evento.obter com os anexos, anexo.obter e anexo.remover com justificativa; evento estornado recusa anexo novo', () => {
  const s = S.sistema();
  const chamar = (pedido) => js(s.gas.exec(() => s.G.api(pedido)));
  const reg = chamar({ rota: 'evento.registrar', idempotencyKey: 'ev-api', dados: { tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-02-01', description: 'Doação' }, animais: [S.bicho({ brinco: '40' }), S.bicho({ brinco: '41' })] } });
  assert.equal(reg.ok, true);
  const ev = reg.data.event_id;
  const doc = (nome, extra) => Object.assign({ tipo: 'DOCUMENTO', nome_arquivo: nome, mime_type: 'application/pdf', conteudo_base64: PDF(nome) }, extra || {});
  const add = chamar({ rota: 'anexo.adicionar', idempotencyKey: 'anx-api', dados: Object.assign({ entidade: 'EVENTOS', entity_id: ev }, doc('termo.pdf', { descricao: 'Termo de doação' })) });
  assert.equal(add.ok, true);
  assert.deepEqual([add.data.event_id, add.data.vigente, add.meta.duplicado], [ev, true, false]);
  const sem = chamar({ rota: 'anexo.adicionar', dados: { entidade: 'EVENTOS', entity_id: ev } });
  assert.deepEqual([sem.ok, sem.error.code], [false, 'VALIDATION'], 'comando sem chave');
  const o = chamar({ rota: 'evento.obter', dados: { event_id: ev } });
  assert.deepEqual(o.data.anexos.map((x) => [x.anexo_id, x.nome_arquivo, x.descricao]), [[add.data.anexo_id, 'termo.pdf', 'Termo de doação']]);
  const arq = chamar({ rota: 'anexo.obter', dados: { anexo_id: add.data.anexo_id } });
  assert.equal(arq.data.data_url, 'data:application/pdf;base64,' + PDF('termo.pdf'));
  const semMotivo = chamar({ rota: 'anexo.remover', idempotencyKey: 'rem-api-0', dados: { anexo_id: add.data.anexo_id } });
  assert.deepEqual([semMotivo.error.code, semMotivo.error.details.map((d) => d.codigo)], ['VALIDATION', ['CAMPO_OBRIGATORIO']]);
  const rem = chamar({ rota: 'anexo.remover', idempotencyKey: 'rem-api', dados: { anexo_id: add.data.anexo_id, justificativa: 'Documento errado' } });
  assert.deepEqual([rem.ok, rem.data.status], [true, 'REMOVIDO']);
  assert.deepEqual(chamar({ rota: 'evento.obter', dados: { event_id: ev } }).data.anexos, []);
  // Lançamento financeiro de um evento: a morte com o custo do veterinário; a nota vai no lançamento.
  const conta = s.tabela('PLANO_CONTAS').find((c) => c.natureza === 'CUSTEIO');
  const morto = reg.data.animais.find((x) => x.brinco === '41').animal_id;
  const mt = chamar({ rota: 'evento.registrar', idempotencyKey: 'morte-api', dados: { tipo: 'MORTE', campos: { event_date: '2026-03-01', causa: 'DOENCA', custo_valor: 12000, custo_conta_id: conta.conta_id }, animais: [{ animal_id: morto }] } });
  assert.equal(mt.ok, true);
  const fin = chamar({ rota: 'evento.obter', dados: { event_id: mt.data.event_id } }).data.detalhes.FINANCEIRO[0];
  const nota = chamar({ rota: 'anexo.adicionar', idempotencyKey: 'anx-api-fin', dados: Object.assign({ entidade: 'FINANCEIRO', entity_id: fin.financial_id }, doc('nota-vet.pdf', { tipo: 'NOTA_FISCAL' })) });
  assert.deepEqual([nota.ok, nota.data.entidade, nota.data.financial_id, nota.data.event_id], [true, 'FINANCEIRO', fin.financial_id, mt.data.event_id]);
  // Estornada a morte, o anexo do lançamento segue no histórico do evento; anexo novo é recusado.
  assert.equal(chamar({ rota: 'evento.estornar', idempotencyKey: 'est-api', dados: { event_id: mt.data.event_id, justificativa: 'Lançada errada' } }).ok, true);
  const hist = chamar({ rota: 'evento.obter', dados: { event_id: mt.data.event_id } }).data;
  assert.deepEqual([hist.evento.status, hist.anexos.map((x) => [x.anexo_id, x.vigente])], ['ESTORNADO', [[nota.data.anexo_id, false]]]);
  assert.equal(chamar({ rota: 'anexo.obter', dados: { anexo_id: nota.data.anexo_id } }).data.anexo.vigente, false);
  const depois = chamar({ rota: 'anexo.adicionar', idempotencyKey: 'anx-api-2', dados: Object.assign({ entidade: 'FINANCEIRO', entity_id: fin.financial_id }, doc('t.pdf')) });
  assert.deepEqual([depois.error.code, depois.error.details.map((d) => d.codigo)], ['VALIDATION', ['JA_ANULADO']]);
  s.conferirProjecoes('rotas de anexo');
});
