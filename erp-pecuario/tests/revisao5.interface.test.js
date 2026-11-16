'use strict';
/**
 * Revisão final da Fase 2 (rodada 5), lente INTERFACE E REGRAS (a parte que roda no Node): o aviso marcado "Bloqueia"
 * chega como erro sem pedir confirmação, pelo motor, pelos cadastros e pela trava; as mensagens da correção de cadastro
 * usam o rótulo do campo; as frases da trava dizem o que ficaria errado (no condicional) e o conselho serve ao caminho; a
 * revisão da compra chama o rateado de custo de aquisição. Os fluxos que precisam do navegador estão em
 * tests/ui/revisao5.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./apoio-sistema');
const { api } = require('./apoio-telas');

const { PASTOS } = S;
const AV = ['INTERVALO_PARTO_CURTO', 'IDADE_REPRODUTIVA', 'POSSIVEL_DUPLICIDADE', 'LOTACAO_ACIMA_DA_CAPACIDADE', 'BRINCO_PARECIDO', 'VALOR_DIVERGENTE', 'RATEIO_SEM_PESO'];

function base(opcoes) {
  const s = S.sistema(opcoes || {});
  let n = 0;
  s.tent = (acao, dados, avisos) => {
    const r = s.tentar((ctx) => s.G.EventService[acao](ctx, { idempotencyKey: 'r5i-' + (++n), dados, avisosAceitos: avisos || AV }));
    s.conferirProjecoes(acao + ' ' + (dados.tipo || ''));
    return r;
  };
  s.reg = (acao, dados, avisos) => { const r = s.tent(acao, dados, avisos); if (!r.ok) throw new Error(acao + ': ' + JSON.stringify(r.erro)); return r.valor.dados; };
  s.parceiro = (nome, tipos) => s.exec((ctx) => s.G.UnitOfWork.run(ctx, s.G.Config.comandoSalvarParceiro({ idempotencyKey: 'p-' + nome, dados: { campos: { nome, tipos } } }))).dados.partner_id;
  return s;
}
const vaca = (brinco, extra) => S.bicho(Object.assign({ brinco, sexo: 'F', data_nascimento: '2019-01-10', data_nascimento_confianca: 'CONFIRMADA' }, extra || {}));
const correcao = (data, itens) => ({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'CORRECAO_CADASTRO', campos: { event_date: data, justificativa: 'conferência do cadastro' }, animais: itens });

// ---------------------------------------------------------------- achado 8 (MÉDIA) ----
test('R5 achado 8: com a política "Bloqueia", o aviso vira erro sem "Gravar mesmo assim?" nem "Confirme com uma justificativa" (motor e trava)', () => {
  const s = base({ config: { fin_bloqueio_ate: '2026-03-31' } });
  const forn = s.parceiro('Forn', ['FORNECEDOR']);
  const V = s.reg('registrar', S.entradaInicial([vaca('100')])).animais[0].animal_id;
  assert.ok(api(s, { rota: 'config.salvar', idempotencyKey: 'pol', dados: { valores: { avisos_politica: { POSSIVEL_DUPLICIDADE: 'BLOQUEIA', PERIODO_BLOQUEADO: 'BLOQUEIA' } } } }).ok);
  const tr = { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-05-01', pasto_origem_id: PASTOS.A, pasto_destino_id: PASTOS.B }, animais: [{ animal_id: V }] };
  s.reg('registrar', tr);
  s.reg('registrar', { tipo: 'TRANSFERENCIA', campos: { event_date: '2026-05-02', pasto_origem_id: PASTOS.B, pasto_destino_id: PASTOS.A }, animais: [{ animal_id: V }] });
  const dup = s.tent('registrar', tr);
  assert.deepEqual([dup.ok, dup.erro && dup.erro.code, dup.erro && S.codigos(dup.erro)], [false, 'VALIDATION', ['POSSIVEL_DUPLICIDADE']]);
  assert.match(dup.erro.details[0].mensagem, /^Já existe a transferência de 01\/05\/2026 com este animal\. A configuração bloqueia este aviso \("Lançamento possivelmente repetido"\): resolva o motivo ou mude a política dele em Configurações › Avisos\.$/);
  // O período financeiro fechado (o motor da compra pede o aviso; com Bloqueia, recusa sem pedir justificativa).
  const c = s.tent('registrar', { tipo: 'COMPRA', campos: { event_date: '2026-03-10', partner_id: forn, pasto_destino_id: PASTOS.A, modalidade: 'CABECA', preco_unitario: 200000, valor_animais: 200000 }, animais: [{ brinco: '300', sexo: 'F', idade_meses: 20 }], parcelas: [{ data_vencimento: '2026-04-10' }] });
  assert.deepEqual([c.ok, c.erro && c.erro.code, c.erro && S.codigos(c.erro)], [false, 'VALIDATION', ['PERIODO_BLOQUEADO']]);
  assert.match(c.erro.details[0].mensagem, /dentro do período financeiro fechado \(até 31\/03\/2026\)\. A configuração bloqueia este aviso \("Período financeiro fechado"\)/);
  assert.doesNotMatch(c.erro.details[0].mensagem, /Confirme com uma justificativa/);
  // A mesma conversão, uma só: aplicada duas vezes dá o mesmo.
  const d = s.G.Validation.bloqueado(dup.erro.details[0]);
  assert.equal(d.mensagem, dup.erro.details[0].mensagem);
});

// ---------------------------------------------------------------- achado 15 (BAIXA) ----
test('R5 achado 15: as mensagens da correção de cadastro usam o rótulo do campo da tela, nunca o nome interno', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('0457')])).animais[0].animal_id;
  const igual = s.tent('registrar', correcao('2026-03-01', [{ animal_id: V, campo: 'data_nascimento', valor_novo: '2019-01-10' }]));
  assert.equal(igual.erro.details[0].mensagem, '0457: o valor informado em "Data de nascimento" já é o que está no cadastro.');
  const dois = s.tent('registrar', correcao('2026-03-01', [{ animal_id: V, campo: 'data_nascimento_confianca', valor_novo: 'ESTIMADA' }, { animal_id: V, campo: 'data_nascimento_confianca', valor_novo: 'ESTIMADA' }]));
  assert.ok(dois.erro.details.some((d) => d.mensagem === '0457: "Certeza do nascimento" aparece duas vezes para o mesmo animal: corrija cada dado uma vez só.'), JSON.stringify(dois.erro.details));
  const partos = s.tent('registrar', correcao('2026-03-01', [{ animal_id: V, campo: 'partos_previos', valor_novo: '99' }]));
  assert.equal(partos.erro.details[0].mensagem, '0457: "Partos anteriores" precisa ser um número inteiro de 0 a 30.');
  const sexo = s.tent('registrar', correcao('2026-03-01', [{ animal_id: V, campo: 'sexo', valor_novo: '' }]));
  assert.equal(sexo.erro.details[0].mensagem, '0457: informe o valor correto de "Sexo".');
  [igual, dois, partos, sexo].forEach((r) => r.erro.details.forEach((d) => assert.doesNotMatch(d.mensagem, /"(data_nascimento|data_nascimento_confianca|partos_previos|sexo|castrado)"/)));
});

// ---------------------------------------------------------------- achado 16 (BAIXA) ----
test('R5 achado 16: a trava diz o que ficaria errado no condicional e o conselho do brinco corrigido serve a qualquer identificação (retirada inclusive)', () => {
  const s = base();
  const V = s.reg('registrar', S.entradaInicial([vaca('0457')])).animais[0].animal_id;
  s.reg('registrar', { tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: '2026-05-10', justificativa: 'conferência' }, animais: [{ animal_id: V, brinco: '0458' }] });
  const ret = s.tent('registrar', { tipo: 'IDENTIFICACAO', subtipo: 'RETIRADA', campos: { event_date: '2026-04-01', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: V, motivo: 'PERDA' }] });
  assert.equal(ret.ok, false);
  const msg = ret.erro.details.map((d) => d.mensagem).join(' | ');
  assert.match(msg, /trocaria o brinco 0457, mas nessa data o animal ficaria sem brinco/);
  assert.match(msg, /Estorne antes a correção do brinco lançado errado, ou dê a esta identificação uma data depois da correção \(10\/05\/2026\)/);
  assert.doesNotMatch(msg, /deixe a troca de brinco depois dela/);
  // A fêmea que entrou prenhe, com o sexo corrigido: "passaria a ser macho", não "não é fêmea pelo cadastro".
  const s2 = base();
  const P = s2.reg('registrar', S.entradaInicial([vaca('100', { situacao_reprodutiva: 'PRENHA', partos_previos: 1 })])).animais[0].animal_id;
  const r = s2.tent('registrar', correcao('2026-03-01', [{ animal_id: P, campo: 'sexo', valor_novo: 'M' }, { animal_id: P, campo: 'castrado', valor_novo: 'N' }, { animal_id: P, campo: 'reprodutor', valor_novo: 'N' }]));
  assert.equal(r.ok, false);
  assert.match(r.erro.details.map((d) => d.mensagem).join(' | '), /é de A-000001 \(brinco 100\), que passaria a ser macho/);
  assert.doesNotMatch(r.erro.details.map((d) => d.mensagem).join(' | '), /não é fêmea pelo cadastro/);
});

// ---------------------------------------------------------------- achado 13 (BAIXA) ----
test('R5 achado 13: na revisão da compra o valor rateado por animal se chama custo de aquisição (com frete e outros custos)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Components.html'), 'utf8');
  assert.match(html, /COMPRA: \['Custo de aquisição do animal', 'Custo de aquisição por animal \(com frete e outros custos\)'\]/);
});
