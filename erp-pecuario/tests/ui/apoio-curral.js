'use strict';
/**
 * Apoio ao teste aleatório do curral e do tronco (`tests/ui/curral.fuzz.test.js`) e às regressões fixas dele
 * (`tests/ui/curral.fuzz.regressoes.test.js`): o rebanho de cada semente, a rede decidida no Node (falhas, respostas
 * seguradas e recusas, por classe de rota, com o registro de cada pedido e resposta) e a leitura da tela (a fase, o estado do
 * aparelho, o rascunho, as linhas, o status e os botões). Não é arquivo de teste.
 */
const A = require('./apoio');

const { S } = A;
const HOJE = '2026-11-13';
const RELOGIO = Date.parse('2026-11-13T14:00:00Z');
const PERDIDA = '{"__mock":"perdida"}';
const TRANSPORTE = '{"__mock":"transporte"}';
const MSG_FALHA_INTERNA = 'Falha interna simulada no servidor (teste).';
const MSG_OCUPADO = 'O sistema está ocupado com outra gravação. Tente de novo.';

// ------------------------------------------------------------------ sorteio ----
function gerador(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const um = (rnd, lista) => lista[Math.floor(rnd() * lista.length)];
function ponderado(rnd, opcoes) {
  const total = opcoes.reduce((t, o) => t + o[0], 0);
  let x = rnd() * total;
  for (const o of opcoes) { x -= o[0]; if (x < 0) return o[1]; }
  return opcoes[opcoes.length - 1][1];
}
const esperarMs = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const kg = (v) => fmt1.format(v) + ' kg';
const ROTULO_RES = { POSITIVO: 'prenhe', NEGATIVO: 'vazia', INCONCLUSIVO: 'duvidosa' };
/** Fêmeas do lote grande (o bloco cheio de 20 sai sozinho; dois blocos numa sessão). */
const LOTE = Array.from({ length: 26 }, (_, i) => String(2001 + i));

// ------------------------------------------------------------------ o rebanho ----
/**
 * O rebanho de cada semente: fêmeas e machos em dois pastos, um animal sem brinco, pesagens anteriores (o aviso de peso fora do
 * esperado), o 0457 da vaca A trocado em 11/11 (1457) e reaproveitado na vaca B (0391) em 12/11, uma vaca morta em 05/11 e duas
 * estações de monta. As datas da sessão cobrem hoje, os dias das trocas, antes da morte e antes do marco zero.
 */
function montarSistema() {
  const s = A.sistema({ config: { brinco_permite_reuso: 'S' } });
  const nasc = (d) => ({ data_nascimento: d, data_nascimento_confianca: 'CONFIRMADA' });
  const sem = s.registrar({
    tipo: 'ENTRADA_INICIAL', campos: {}, animais: [
      S.bicho(Object.assign({ brinco: '0457' }, nasc('2023-02-02'))),
      S.bicho(Object.assign({ brinco: '0391', pasto_destino_id: S.PASTOS.B }, nasc('2022-05-10'))),
      S.bicho(Object.assign({ brinco: '12', sexo: 'M' }, nasc('2025-03-01'))),
      S.bicho(nasc('2025-09-12')),
      S.bicho(Object.assign({ brinco: '0520' }, nasc('2021-08-01'))),
      S.bicho(Object.assign({ brinco: '0611', pasto_destino_id: S.PASTOS.B }, nasc('2020-04-04'))),
      S.bicho(Object.assign({ brinco: '33', sexo: 'M', pasto_destino_id: S.PASTOS.B }, nasc('2024-01-10'))),
      S.bicho(Object.assign({ brinco: '0702' }, nasc('2022-02-02'))),
      S.bicho(Object.assign({ brinco: '0815' }, nasc('2021-01-01'))),
    ].concat(LOTE.map((b, i) => S.bicho(Object.assign({ brinco: b, pasto_destino_id: i % 2 ? S.PASTOS.B : S.PASTOS.A }, nasc('2022-0' + (1 + (i % 9)) + '-15'))))),
  }, 'semente-rebanho');
  const id = (b) => sem.animais.find((x) => x.brinco === b).animal_id;
  const ids = { vacaA: id('0457'), vacaB: id('0391'), m12: id('12'), m33: id('33'), v520: id('0520'), v611: id('0611'), v702: id('0702'), v815: id('0815') };
  ids.semBrinco = sem.animais.find((x) => !x.brinco).animal_id;
  s.registrar({ tipo: 'PESAGEM', campos: { event_date: '2026-09-03', tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: ids.v520, peso: 420 }, { animal_id: ids.v611, peso: 450 }, { animal_id: ids.m12, peso: 300 }, { animal_id: ids.v815, peso: 410 }] }, 'base-pesos');
  s.registrar({ tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-11-11', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: ids.vacaA, codigo: '1457', motivo: 'PERDA' }] }, 'troca-a');
  s.registrar({ tipo: 'IDENTIFICACAO', subtipo: 'SUBSTITUICAO', campos: { event_date: '2026-11-12', tipo_identificacao: 'BRINCO' }, animais: [{ animal_id: ids.vacaB, codigo: '0457', motivo: 'RENUMERACAO' }] }, 'troca-b');
  s.registrar({ tipo: 'MORTE', campos: { event_date: '2026-11-05', causa: 'DOENCA' }, animais: [{ animal_id: ids.v702 }] }, 'morte-0702');
  const est = (nome, ini, fim, k) => { const r = s.api({ rota: 'estacao.salvar', idempotencyKey: k, dados: { campos: { nome, data_inicio: ini, data_fim: fim, tipo: 'MONTA_NATURAL' } } }); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data.estacao_id; };
  const estacoes = [est('Estação 26', '2026-06-01', '2026-08-31', 'est-26'), est('Estação 27', '2026-09-01', '2026-11-30', 'est-27')];
  const anim = s.tabela('ANIMAIS');
  const codigo = (aid) => anim.find((x) => x.animal_id === aid).codigo_interno;
  return { s, ids, estacoes, codigoSemBrinco: codigo(ids.semBrinco), codigoComBrinco: codigo(ids.v520) };
}

// ------------------------------------------------------------------ a rede (no Node) ----
/**
 * As falhas de rede e as recusas, decididas no Node para cada pedido que chega (a fila `falhas`, por classe de rota), e o
 * registro de cada pedido e de cada resposta entregue. "Segurar" guarda a resposta (ou o próprio pedido, que só chega ao
 * servidor ao soltar) até a ação "soltar": o operador segue com o envio no ar, e a ordem de chegada muda.
 */
function novaRede(s) {
  const rede = { falhas: [], segurados: [], log: [], novasRecusas: [], acao: 0, rascunhoBloqueado: false };
  const classe = (rota) => (rota === 'evento.registrar' ? 'registrar' : rota === 'animal.resolver' ? 'resolver' : rota === 'operacao.status' ? 'status' : /^rascunho\./.test(rota) ? 'rascunho' : 'outra');
  rede.servidor = (pedido, executar) => {
    const cl = classe(pedido.rota);
    // A página vai embora de repente (`rascunhoBloqueado`): o envio do rascunho ao sair falha no transporte; a leitura do
    // rascunho pela página nova (rascunho.obter de um rascunho, não do índice) passa.
    const bloqueado = rede.rascunhoBloqueado && cl === 'rascunho' && !(pedido.rota === 'rascunho.obter' && pedido.dados && pedido.dados.chave !== 'indice');
    // A falha pode mirar um pedido só (`rota` e `chave`: a gravação do índice), para cair entre os dois pedidos do mesmo envio.
    const i = bloqueado ? -1 : rede.falhas.findIndex((f) => f.classe === cl && (!f.rota || pedido.rota === f.rota) && (!f.chave || (pedido.dados && pedido.dados.chave === f.chave)));
    const f = bloqueado ? { classe: cl, tipo: 'transporte' } : i >= 0 ? rede.falhas.splice(i, 1)[0] : null;
    const reg = { rota: pedido.rota, chave: pedido.idempotencyKey || null, falha: f ? f.tipo : null, textos: pedido.dados && pedido.dados.textos, entregue: false, resposta: null };
    // A nova tentativa da mesma chave fecha a espera do servidor ocupado.
    if (reg.chave) rede.log.forEach((r) => { if (r.chave === reg.chave) r.ocupadoAberto = false; });
    reg.acao = rede.acao;
    rede.log.push(reg);
    const entregar = (json) => {
      reg.entregue = json !== PERDIDA && json !== TRANSPORTE;
      // A resposta perdida deixa o aparelho esperando o prazo (45 s): só o relógio anda esse pedido.
      if (json === PERDIDA) reg.perdidaAberta = true;
      if (reg.entregue) {
        reg.resposta = JSON.parse(json);
        // A resposta que chega depois do prazo do aparelho (45 s) não é ouvida por ele: a recusa dela não precisa aparecer.
        if (cl === 'registrar' && !reg.resposta.ok && reg.resposta.error.code !== 'LOCKED' && !reg.atrasada) rede.novasRecusas.push(reg);
      // O servidor ocupado: o aparelho tenta de novo sozinho em 2, 5 e 10 s (o teste anda o relógio até a nova tentativa).
      if (reg.entregue && !reg.resposta.ok && reg.resposta.error.code === 'LOCKED') reg.ocupadoAberto = true;
      }
      return json;
    };
    if (!f) return entregar(executar());
    switch (f.tipo) {
      case 'perdeAntes': return entregar(PERDIDA);
      case 'perdeDepois': executar(); return entregar(PERDIDA);
      case 'transporte': return entregar(TRANSPORTE);
      case 'transporteDepois': executar(); return entregar(TRANSPORTE);
      case 'ocupado': return entregar(JSON.stringify({ ok: false, error: { code: 'LOCKED', message: MSG_OCUPADO, details: [] }, meta: {} }));
      case 'interna': return entregar(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: MSG_FALHA_INTERNA, details: [] }, meta: {} }));
      case 'segurar': { const json = executar(); return new Promise((res) => rede.segurados.push({ reg, soltar: () => res(entregar(json)), largar: () => res(PERDIDA) })); }
      case 'segurarAntes': return new Promise((res) => rede.segurados.push({ reg, soltar: () => res(entregar(executar())), largar: (chega) => { if (chega) executar(); res(PERDIDA); } }));
      default: throw new Error('falha desconhecida ' + f.tipo);
    }
  };
  /** Solta as respostas seguradas (na ordem de chegada ou na inversa). */
  rede.soltar = (inversa) => {
    const lista = rede.segurados.splice(0, rede.segurados.length);
    (inversa ? lista.reverse() : lista).forEach((x) => x.soltar());
    return lista.length;
  };
  /** A página foi embora (recarga): o que estava segurado se perde; o pedido que ainda não tinha chegado chega ou não. */
  rede.largar = (rnd) => { rede.segurados.splice(0, rede.segurados.length).forEach((x) => x.largar(rnd() < 0.5)); };
  rede.limpar = () => { rede.falhas = []; };
  /** O relógio da página andou: o pedido segurado por 45 s ou mais já venceu o prazo do aparelho. */
  rede.passou = (ms) => { if (ms >= 45000) rede.log.forEach((r) => { r.perdidaAberta = false; }); rede.segurados.forEach((x) => { x.reg.segurado = (x.reg.segurado || 0) + ms; if (x.reg.segurado >= 45000) x.reg.atrasada = true; }); };
  return rede;
}

// ------------------------------------------------------------------ a tela ----
const T = {
  curral: {
    hash: 'pesagens/curral', titulo: 'Pesagem no curral', brinco: '#cur-brinco', valor: '#cur-peso', conferencia: '#cur-conferencia',
    status: '[data-curral-status]', mudar: '[data-curral-mudar] button', inicio: '[data-curral-inicio]', comecar: 'Começar a pesar',
    resultado: '[data-resultado-curral]', terminar: 'Terminar a pesagem', nova: 'Nova pesagem no curral', fora: 'pesagens', foraTitulo: 'Pesagens',
    rascunho: 'curral-pesagem', prefixo: 'curral:', tipo: 'PESAGEM', aba: 'PESAGENS',
  },
  tronco: {
    hash: 'reproducao/tronco', titulo: 'Diagnóstico no tronco', brinco: '#tr-brinco', valor: '#tr-resultado', conferencia: '#tr-conferencia',
    status: '[data-tronco-status]', mudar: '[data-tronco-mudar] button', inicio: '[data-tronco-inicio]', comecar: 'Começar',
    resultado: '[data-resultado-tronco]', terminar: 'Terminar', nova: 'Novo diagnóstico', fora: 'reproducao/matrizes', foraTitulo: 'Reprodução',
    rascunho: 'tronco-diagnostico', prefixo: 'tronco:', tipo: 'REPRODUCAO', aba: 'REPRODUCAO', sexo: 'F',
  },
};

/** O que a página mostra e guarda agora: a fase, o estado do aparelho, o rascunho, as linhas na tela, o status e os botões. */
async function lerTela(page, tela) {
  return page.evaluate((cfg) => {
    const mod = cfg.tela === 'curral' ? window.TelaPesagens : window.TelaReproducao;
    const c = mod && mod.sessao ? mod.sessao() : null;
    let rascunho = null;
    try { const k = Object.keys(localStorage).find((x) => x.endsWith(':rascunho:' + cfg.rascunho)); rascunho = k ? JSON.parse(localStorage.getItem(k)) : null; } catch (e) { rascunho = null; }
    const fase = document.querySelector(cfg.brinco) ? 'sessao' : document.querySelector(cfg.inicio) ? 'inicio' : document.querySelector(cfg.resultado) ? 'resultado' : 'outra';
    const linhas = Array.from(document.querySelectorAll('.curral-lista [data-linha]')).map((li) => ({
      uid: li.dataset.linha, estado: li.dataset.estado, texto: li.textContent.replace(/\s+/g, ' ').trim(),
      botoes: Array.from(li.querySelectorAll('button')).map((b) => b.textContent.trim()),
    }));
    const st = document.querySelector(cfg.status);
    const enviar = document.querySelector('[data-enviar]');
    const tudo = [document.getElementById('conteudo'), document.getElementById('avisos'), document.querySelector('[role=dialog]')].filter(Boolean).map((e) => e.innerText).join('\n') + '\n' + document.body.innerText;
    return {
      fase, c, rascunho, linhas,
      status: st ? st.innerText.replace(/\s+/g, ' ').trim() : '',
      enviar: enviar ? { desabilitado: enviar.disabled, texto: enviar.textContent.trim() } : null,
      mudar: !!document.querySelector(cfg.mudar),
      avisoGeral: !!document.querySelector('[data-aceitar-geral]'),
      resolverPendentes: !!document.querySelector('[data-resolver-pendentes]'),
      posicaoTentar: !!document.querySelector('[data-posicao-tentar]'),
      conferindo: /Conferindo/.test((document.querySelector(cfg.conferencia) || {}).textContent || ''),
      decisao: !!document.querySelector('[data-decisao-repetido]'),
      candidatos: document.querySelectorAll('.curral-candidatos button').length,
      dialogo: !!document.querySelector('[role=dialog]'),
      emCurso: window.__gas ? window.__gas.emCurso : 0,
      // O rascunho no servidor (sem localStorage): a situação do último envio e o aviso da falha.
      situacaoRascunho: window.Rascunhos && Rascunhos.modo() === 'SERVIDOR' ? Rascunhos.situacao(cfg.rascunho) : null,
      faixaRascunho: !!document.querySelector('[data-faixa="rascunho-falhou"]'),
      naoGuardado: Array.from(document.querySelectorAll('[data-nao-guardado]')).map((x) => x.dataset.naoGuardado),
      conferenciaTexto: ((document.querySelector(cfg.conferencia + ' [data-conferencia]') || {}).textContent || '').trim(),
      conferenciaTipo: ((document.querySelector(cfg.conferencia + ' [data-conferencia]') || { dataset: {} }).dataset.conferencia) || null,
      decisaoTexto: ((document.querySelector('[data-decisao-repetido]') || {}).textContent || '').trim(),
      contador: ((document.querySelector('.curral-contador [data-contador]') || { dataset: {} }).dataset.contador) || null,
      textoTodo: tudo,
      titulo: ((document.querySelector('#conteudo h1') || {}).textContent || '').trim(),
      resultadoN: document.querySelector(cfg.resultado) ? Number(document.querySelector(cfg.resultado).getAttribute(cfg.tela === 'curral' ? 'data-resultado-curral' : 'data-resultado-tronco')) : null,
    };
  }, Object.assign({ tela }, T[tela]));
}

module.exports = {
  HOJE, RELOGIO, PERDIDA, TRANSPORTE, MSG_FALHA_INTERNA, MSG_OCUPADO, ROTULO_RES, LOTE, T,
  gerador, um, ponderado, esperarMs, fmt1, kg, montarSistema, novaRede, lerTela,
};
