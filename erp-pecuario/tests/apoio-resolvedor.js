'use strict';
/**
 * Apoio ao teste tabelado do resolvedor único (conserto da Fase 3 pela garantia, etapa 2; CONTRATOS, seção 47): o rebanho dos
 * casos difíceis e a tabela dos casos, usados pelo teste dos caminhos do servidor (`tests/resolvedor.unico.test.js`) e pelo
 * dos caminhos da tela (`tests/ui/resolvedor.test.js`). Não é arquivo de teste.
 */
const S = require('./apoio-sistema');

const { PASTOS } = S;

/**
 * O rebanho dos casos difíceis (hoje = 15/11/2026; marco zero 01/01/2026): A (0457) troca para 1457 em 11/11 e B (0391)
 * recebe o 0457 em 12/11 (reuso); C (0500) teve o número lançado errado, corrigido para 0505 em 01/06; E (macho, 0700) é
 * descartado em 01/04 e volta em 01/06; a cria sem brinco de B nasce em 01/02; a cria de A nasce em 01/05 com o 0901.
 */
function rebanho(s, registrar) {
  s.gas.clock.now = Date.parse('2026-11-15T15:00:00.000Z');
  const ent = registrar(S.entradaInicial([
    S.bicho({ brinco: '0457', data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '0391', data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '0500', data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA' }),
    S.bicho({ brinco: '0700', sexo: 'M', data_nascimento: '2021-01-01', data_nascimento_confianca: 'CONFIRMADA', pasto_destino_id: PASTOS.B }),
  ]), 'rebanho');
  const id = {};
  ent.animais.forEach((a) => { id[{ '0457': 'A', '0391': 'B', '0500': 'C', '0700': 'E' }[a.brinco]] = a.animal_id; });
  const reg = registrar;
  const nasc1 = reg({ tipo: 'NASCIMENTO', campos: { event_date: '2026-02-01' }, animais: [{ animal_id: id.B }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'F' }] }, 'nasc-sem-brinco');
  id.CRIA = nasc1.animais.find((a) => a.animal_id !== id.B).animal_id;
  const nasc2 = reg({ tipo: 'NASCIMENTO', campos: { event_date: '2026-05-01' }, animais: [{ animal_id: id.A }], crias: [{ situacao_nascimento: 'VIVO', sexo: 'M', brinco: '0901' }] }, 'nasc-0901');
  id.CRIA2 = nasc2.animais.find((a) => a.animal_id !== id.A).animal_id;
  reg({ tipo: 'DESCARTE', campos: { event_date: '2026-04-01', destino: 'PERMUTA', motivo: 'IDADE' }, animais: [{ animal_id: id.E }] }, 'descarte-e');
  reg({ tipo: 'OUTRA_ENTRADA', campos: { event_date: '2026-06-01', description: 'Voltou da permuta' }, animais: [{ animal_id: id.E, pasto_destino_id: PASTOS.B }] }, 'volta-e');
  reg({ tipo: 'AJUSTE_INVENTARIO', subtipo: 'IDENTIFICACAO_INCORRETA', campos: { event_date: '2026-06-01', justificativa: 'Brinco digitado errado' }, animais: [{ animal_id: id.C, brinco: '0505' }] }, 'errado-c');
  reg({ tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-11-11', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: id.A, codigo: '1457', motivo: 'PERDA' }] }, 'troca-a');
  reg({ tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-11-12', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: id.B, codigo: '0457', motivo: 'RENUMERACAO' }] }, 'troca-b');
  const animais = s.tabela('ANIMAIS');
  const cod = (k) => animais.find((a) => a.animal_id === id[k]).codigo_interno;
  return { s, id, cod };
}

/**
 * Os casos: [rótulo, texto, data, esperado]. esperado = {animal: chave, presente} | {recusa: código do resolvedor}; o texto
 * pode ser uma função do rebanho (o código interno). `peso` é o da linha da importação.
 */
const CASOS = [
  ['reuso: o 0457 antes da troca é a vaca A', '0457', '2026-11-10', { animal: 'A', presente: true }],
  ['reuso: o 0457 depois do reaproveitamento é a vaca B', '0457', '2026-11-13', { animal: 'B', presente: true }],
  ['reuso: sem os zeros à esquerda, o 457 antes da troca é a vaca A', '457', '2026-11-10', { animal: 'A', presente: true }],
  ['reuso: o 1457 antes de a vaca A recebê-lo não é de ninguém (nunca a dona de hoje)', '1457', '2026-11-10', { recusa: 'ANTES_DO_USO' }],
  ['reuso: o 1457 depois da troca é a vaca A', '1457', '2026-11-12', { animal: 'A', presente: true }],
  ['reuso: o 0391 depois que a vaca B o trocou não é de ninguém', '0391', '2026-11-13', { recusa: 'SEM_USO' }],
  ['lançado errado: o 0500 nunca esteve na orelha', '0500', '2026-03-01', { recusa: 'LANCADO_ERRADO' }],
  ['lançado errado: o 0505 vale desde o início do errado', '0505', '2026-03-01', { animal: 'C', presente: true }],
  ['código interno: o código inteiro da vaca A (que tem brinco) é a vaca A', (r) => r.cod('A'), '2026-11-10', { animal: 'A', presente: true }],
  ['código interno: o atalho do código da vaca A (que tem brinco) é recusado com o brinco dela', (r) => r.cod('A').slice(2), '2026-11-10', { recusa: 'CODIGO_DE_ANIMAL_COM_BRINCO' }],
  ['código interno: o brinco inexistente com cara de código não acha ninguém', 'A1', '2026-11-10', { recusa: 'NAO_ENCONTRADO' }],
  ['sem brinco: a cria pelo atalho do código', (r) => r.cod('CRIA').slice(2), '2026-03-01', { animal: 'CRIA', presente: true, peso: '80' }],
  ['sem brinco: a cria pelo código inteiro', (r) => r.cod('CRIA'), '2026-03-02', { animal: 'CRIA', presente: true, peso: '80' }],
  ['saiu e voltou: fora do rebanho, o 0700 continua sendo o macho E (que não estava no rebanho)', '0700', '2026-05-01', { animal: 'E', presente: false }],
  ['saiu e voltou: de volta, o 0700 é o macho E', '0700', '2026-07-01', { animal: 'E', presente: true }],
  ['antes da entrada: o 0901 antes do nascimento da cria não é de ninguém', '0901', '2026-03-01', { recusa: 'ANTES_DO_USO' }],
  ['antes da entrada: o 0901 depois do nascimento é a cria', '0901', '2026-05-02', { animal: 'CRIA2', presente: true, peso: '40' }],
  ['antes do marco zero: o histórico cita a vaca pelo número que ela tinha no marco zero', '0391', '2025-06-01', { animal: 'B', presente: null }],
  ['nada: o número que nunca existiu', '9999', '2026-11-10', { recusa: 'NAO_ENCONTRADO' }],
];


module.exports = { rebanho, CASOS };
