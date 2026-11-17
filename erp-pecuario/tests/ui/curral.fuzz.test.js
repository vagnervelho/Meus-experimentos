'use strict';
/**
 * Teste aleatório da interface do curral e do tronco (nível 3, Playwright; etapa 3 do conserto da Fase 3 pela garantia).
 *
 * A tela de verdade (o doGet real, a 360 px) conversa com o backend real do harness pelo mock de google.script.run; um gerador
 * com semente faz AÇÕES DO USUÁRIO no curral (pesagem) ou no tronco (diagnóstico de gestação) — digitar um brinco válido,
 * inválido, de outro pasto, de quem saiu do rebanho, o código interno, repetido; peso ou resultado pelo teclado e pelo botão,
 * válido e inválido; desfazer o último; tirar; corrigir; "Está certo"; mudar data, método, pasto ou estação; enviar; terminar
 * (descartando ou voltando); recarregar a página; sair e voltar; o tempo passar — intercaladas com FALHAS DE REDE decididas no
 * Node (`apoio.abrir` com `servidor`): a resposta perdida depois de gravar, o pedido perdido antes de chegar, o transporte que
 * falha antes ou depois de gravar, a resposta segurada (o operador segue digitando com o envio no ar, e ela chega depois, ou o
 * pedido chega ao servidor depois de outro) e o servidor recusando (ocupado, falha interna); e, de vez em quando, OUTRO USUÁRIO
 * grava no mesmo banco (uma pesagem ou um diagnóstico do mesmo animal no mesmo dia; uma morte).
 *
 * O MODELO guarda o que o operador digitou (cada linha, o texto do brinco, o valor, as que ele tirou ou descartou), o cabeçalho
 * da sessão e as chaves de bloco que o aparelho já guardou. O ORÁCULO, depois de cada ação (com a tela parada):
 *  - a tela mostra as linhas do aparelho (uid, estado e valor) e as contas do status batem com elas; o rascunho guardado no
 *    aparelho é o estado da tela (recarregar não perde nada);
 *  - as linhas são as do modelo (nenhuma some, nenhuma aparece; desfazer, tirar e substituir fazem o que dizem), com o valor
 *    digitado, e cada animal é o do texto digitado NA DATA DA SESSÃO pelo resolvedor único (CONTRATOS, seção 47);
 *  - nada gravado duas vezes (cada linha em no máximo uma chave confirmada), nada gravado que a tela diga não gravado (na
 *    fila, com aviso, recusada, pendente, tirada ou descartada), toda linha "gravada" está no banco com o valor, o animal e o
 *    cabeçalho da sessão;
 *  - a mensagem de cada recusa do servidor ao lançamento aparece na tela;
 *  - depois de o tempo passar (todas as respostas entregues ou perdidas de vez), nenhum bloco preso: nada "enviando" e toda
 *    linha que não foi gravada tem saída (enviar, "Está certo", corrigir, tirar).
 * No fim, com a rede boa: os avisos aceitos, as pendências conferidas no servidor (a que ele resolve não pode ficar pendente),
 * as recusas legítimas tiradas, tudo enviado e "Terminar"; o resultado mostra as gravadas; o banco = o modelo (cada linha
 * gravada uma vez, com o animal, o valor e o cabeçalho) e a integridade sem erro, com a projeção = reconstrução.
 *
 * `npm run ui:check` roda as sementes fixas (poucas). FUZZ_SEMENTES=N roda N sementes a partir de FUZZ_INICIO (padrão 1);
 * FUZZ_ACOES muda as ações por semente (padrão 40); FUZZ_TELA=curral|tronco fixa a tela; FUZZ_LOG=1 imprime cada ação.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./apoio');

const { S } = A;
test.after(() => A.fecharBrowser());

const HOJE = '2026-11-13';
const RELOGIO = Date.parse('2026-11-13T14:00:00Z');
const N_ACOES = Number(process.env.FUZZ_ACOES || 40);
const SEMENTES_FIXAS = [11, 12, 13, 14, 15, 16];
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
    ],
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
  const rede = { falhas: [], segurados: [], log: [], novasRecusas: [] };
  const classe = (rota) => (rota === 'evento.registrar' ? 'registrar' : rota === 'animal.resolver' ? 'resolver' : rota === 'operacao.status' ? 'status' : 'outra');
  rede.servidor = (pedido, executar) => {
    const cl = classe(pedido.rota);
    const i = rede.falhas.findIndex((f) => f.classe === cl);
    const f = i >= 0 ? rede.falhas.splice(i, 1)[0] : null;
    const reg = { rota: pedido.rota, chave: pedido.idempotencyKey || null, falha: f ? f.tipo : null, textos: pedido.dados && pedido.dados.textos, entregue: false, resposta: null };
    rede.log.push(reg);
    const entregar = (json) => {
      reg.entregue = json !== PERDIDA && json !== TRANSPORTE;
      if (reg.entregue) {
        reg.resposta = JSON.parse(json);
        if (cl === 'registrar' && !reg.resposta.ok && reg.resposta.error.code !== 'LOCKED') rede.novasRecusas.push(reg);
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
      textoTodo: tudo,
      titulo: ((document.querySelector('#conteudo h1') || {}).textContent || '').trim(),
      resultadoN: document.querySelector(cfg.resultado) ? Number(document.querySelector(cfg.resultado).getAttribute(cfg.tela === 'curral' ? 'data-resultado-curral' : 'data-resultado-tronco')) : null,
    };
  }, Object.assign({ tela }, T[tela]));
}

// ------------------------------------------------------------------ uma semente ----
async function rodarSemente(semente, nAcoes, opcoes) {
  const o = opcoes || {};
  const rnd = gerador(semente * 7919 + 17);
  const tela = o.tela || process.env.FUZZ_TELA || (rnd() < 0.5 ? 'curral' : 'tronco');
  const cfg = T[tela];
  const sis = montarSistema();
  const { s } = sis;
  const rede = novaRede(s);
  const a = await A.abrir(s, { largura: 360, hash: cfg.hash, relogio: RELOGIO, servidor: rede.servidor });
  const { page } = a;
  const historico = [];
  const log = (t) => { historico.push(t); if (process.env.FUZZ_LOG) console.log('  [' + semente + '] ' + t); };
  const cont = o.contadores || {};
  const conta = (k) => { cont[k] = (cont[k] || 0) + 1; };

  // O modelo: as linhas (uid → texto, valor), a ordem, o cabeçalho, as tiradas e as descartadas, as chaves de cada bloco visto.
  const M = { sessao: null, ordem: [], linhas: {}, tiradas: new Set(), descartadas: new Set(), chaves: {}, sessoes: [], versaoOutro: 0, mortos: new Set() };
  const resolvidos = {};
  /** O resolvedor único do servidor (fora da rede da página): o animal do texto na data, com o porquê de não servir. */
  function resolverModelo(texto, data) {
    const k = M.versaoOutro + '|' + data + '|' + texto;
    if (resolvidos[k]) return resolvidos[k];
    const r = s.api({ rota: 'animal.resolver', dados: { data, textos: [texto], tipo: cfg.tipo, sexo: cfg.sexo || null } });
    if (!r.ok) throw new Error('resolvedor do modelo: ' + JSON.stringify(r.error));
    const x = r.data.textos[0];
    const est = x.animal_id ? r.data.animais[x.animal_id] : null;
    resolvidos[k] = { situacao: x.situacao, animal_id: x.situacao === 'ACHADO' ? x.animal_id : null, inelegivel: est ? est.inelegivel : null, mensagem: x.mensagem, candidatos: x.candidatos };
    return resolvidos[k];
  }
  const falhar = (msg) => { throw new Error(msg); };

  /** Espera a tela parar: todo pedido respondido (menos os segurados de propósito) e nenhuma conferência no ar. */
  async function assentar() {
    let quietas = 0;
    for (let i = 0; i < 600; i++) {
      const st = await page.evaluate((sel) => ({ em: window.__gas ? window.__gas.emCurso : 0, conf: /Conferindo/.test((document.querySelector(sel) || {}).textContent || '') }), cfg.conferencia);
      if (st.em <= rede.segurados.length && !st.conf) { quietas += 1; if (quietas >= 3) return; } else quietas = 0;
      if (st.em <= rede.segurados.length && st.conf && quietas === 0 && i > 20) {
        // A conferência do brinco espera uma resposta que se perdeu: o operador espera os 45 s do prazo.
        await page.clock.fastForward(46000);
      }
      await esperarMs(15);
    }
    falhar('a tela não parou (pedidos no ar: ' + (await page.evaluate(() => window.__gas.emCurso)) + ', segurados: ' + rede.segurados.length + ')');
  }
  /** O tempo passa (respostas soltas; prazos de 45 s, novas tentativas do servidor ocupado e conferências vencidas). */
  async function esperarLongo() {
    rede.soltar(false);
    for (let i = 0; i < 12; i++) {
      await assentar();
      const v = await lerTela(page, tela);
      const enviando = v.c && v.c.linhas.some((l) => l.estado === 'ENVIANDO');
      if (!enviando && i >= 1) return;
      await page.clock.fastForward(50000);
    }
  }
  function blocoDe(c, chave) { return c.blocos.find((b) => b.chave === chave) || null; }
  function editavel(c, l) { if (!l.bloco) return true; const b = blocoDe(c, l.bloco); return !b || b.estado === 'NOVO' || b.estado === 'AVISO' || b.estado === 'ERRO'; }
  const valorIgual = (l, v) => (tela === 'curral' ? l.peso === v : l.resultado === v.resultado && (l.idade || null) === (v.idade || null));
  const textoValor = (v) => (tela === 'curral' ? kg(v) : ROTULO_RES[v.resultado] + (v.idade ? ' (' + v.idade + ' dias)' : ''));

  /** As chaves de bloco que o aparelho guarda (o histórico de cada chave com as linhas dela). */
  function anotarChaves(c) {
    if (!c) return;
    c.blocos.forEach((b) => {
      const ja = M.chaves[b.chave];
      if (ja && JSON.stringify(ja.uids) !== JSON.stringify(b.uids)) falhar('o bloco ' + b.chave + ' mudou de linhas: ' + JSON.stringify(ja.uids) + ' → ' + JSON.stringify(b.uids));
      if (!ja) M.chaves[b.chave] = { uids: b.uids.slice(), campos: b.campos ? JSON.parse(JSON.stringify(b.campos)) : null };
    });
  }
  /** O banco: as chaves confirmadas da tela e o que cada uma gravou. */
  function gravadoNoBanco() {
    const ops = s.tabela('OPERACOES').filter((x) => String(x.idempotency_key || '').indexOf(cfg.prefixo) === 0 && x.status === 'CONFIRMADA');
    const eventos = s.tabela('EVENTOS');
    const linhas = s.tabela(cfg.aba);
    return ops.map((op) => {
      const ev = eventos.find((e) => e.idempotency_key === op.idempotency_key && e.event_type === cfg.tipo);
      const rows = ev ? linhas.filter((r) => r.event_id === ev.event_id) : [];
      return { chave: op.idempotency_key, evento: ev, rows };
    });
  }

  // ---------------------------------------------------------------- o oráculo ----
  async function verificar(o2) {
    const op = o2 || {};
    await assentar();
    const v = await lerTela(page, tela);
    anotarChaves(v.c);
    const erros = [];
    const e = (m) => erros.push(m);
    if (v.fase === 'sessao') {
      const c = v.c;
      if (!c) falhar('a tela do lote está aberta, mas o aparelho não tem a sessão');
      // A tela mostra as linhas do aparelho, a mais nova em cima.
      const esperado = c.linhas.slice().reverse().map((l) => l.uid + ':' + l.estado);
      const visto = v.linhas.map((l) => l.uid + ':' + l.estado);
      if (JSON.stringify(esperado) !== JSON.stringify(visto)) e('a tela não mostra o estado do aparelho: tela ' + JSON.stringify(visto) + ' × aparelho ' + JSON.stringify(esperado));
      c.linhas.forEach((l) => {
        const dom = v.linhas.find((x) => x.uid === l.uid);
        const val = tela === 'curral' ? l.peso : { resultado: l.resultado, idade: l.idade };
        if (dom && dom.texto.indexOf(textoValor(val)) < 0) e('a linha ' + l.uid + ' não mostra o valor ' + textoValor(val) + ': "' + dom.texto + '"');
      });
      const nGrav = c.linhas.filter((l) => l.estado === 'GRAVADA').length;
      const mG = /(\d+) gravad/.exec(v.status);
      if ((mG ? Number(mG[1]) : 0) !== nGrav) e('o status diz ' + (mG ? mG[1] : 0) + ' gravadas; o aparelho tem ' + nGrav + ': "' + v.status + '"');
      const nPend = c.linhas.filter((l) => l.estado === 'NAO_ENCONTRADO' || l.estado === 'ERRO').length;
      const mP = /(\d+) pendentes?\b/.exec(v.status);
      if ((mP ? Number(mP[1]) : 0) !== nPend) e('o status diz ' + (mP ? mP[1] : 0) + ' pendentes; o aparelho tem ' + nPend + ': "' + v.status + '"');
      // O rascunho guardado é o estado da tela (recarregar não perde nada).
      const r = v.rascunho;
      const essencial = (x) => JSON.stringify({ sessao: x.sessao, linhas: x.linhas.map((l) => [l.uid, l.estado, l.animal_id, l.peso, l.resultado, l.idade || null, l.bloco || null]), blocos: x.blocos.map((b) => [b.chave, b.estado, b.uids, b.campos, b.reenviar || false]) });
      if (!r) e('a sessão não está guardada no aparelho');
      else if (essencial(r) !== essencial(c)) e('o rascunho guardado não é o estado da tela:\n   guardado ' + essencial(r) + '\n   na tela  ' + essencial(c));
      // As linhas são as do modelo, na ordem e com o valor digitado.
      const uidsC = c.linhas.map((l) => l.uid);
      if (JSON.stringify(uidsC) !== JSON.stringify(M.ordem)) e('as linhas não são as digitadas: aparelho ' + JSON.stringify(uidsC) + ' × modelo ' + JSON.stringify(M.ordem));
      c.linhas.forEach((l) => {
        const m = M.linhas[l.uid];
        if (!m) return;
        if (!valorIgual(l, m.valor)) e('a linha ' + l.uid + ' tem o valor ' + JSON.stringify(tela === 'curral' ? l.peso : [l.resultado, l.idade]) + '; o operador digitou ' + JSON.stringify(m.valor));
        if (l.animal_id) {
          const b = l.bloco ? blocoDe(c, l.bloco) : null;
          const data = l.estado === 'GRAVADA' && b && b.campos ? b.campos.event_date : c.sessao.data;
          const rr = resolverModelo(m.texto, data);
          if (rr.animal_id !== l.animal_id && !(rr.situacao === 'VARIOS' && (rr.candidatos || []).indexOf(l.animal_id) >= 0)) e('a linha ' + l.uid + ' ("' + m.texto + '") está no animal ' + l.animal_id + '; em ' + data + ' o texto é de ' + (rr.animal_id || rr.situacao + ' (' + rr.mensagem + ')'));
        }
      });
      if (JSON.stringify(c.sessao) !== JSON.stringify(M.sessao)) e('o cabeçalho da sessão é ' + JSON.stringify(c.sessao) + '; o operador escolheu ' + JSON.stringify(M.sessao));
      // Bloco gravado: o cabeçalho é o da sessão (a sessão não muda depois de um bloco sair).
      c.blocos.forEach((b) => { if (b.estado === 'GRAVADO' && b.campos && b.campos.event_date !== c.sessao.data) e('o bloco ' + b.chave + ' gravou em ' + b.campos.event_date + ', e a sessão é de ' + c.sessao.data); });
    }
    // O banco × a tela e o modelo.
    const banco = gravadoNoBanco();
    const vezes = {};
    const c = v.fase === 'sessao' ? v.c : null;
    banco.forEach((g) => {
      const k = M.chaves[g.chave];
      if (!k) { e('a chave ' + g.chave + ' foi gravada e o aparelho nunca a guardou'); return; }
      if (!g.evento) { e('a chave ' + g.chave + ' está confirmada sem evento'); return; }
      if (g.rows.length !== k.uids.length) e('a chave ' + g.chave + ' gravou ' + g.rows.length + ' linhas; o bloco tinha ' + k.uids.length);
      k.uids.forEach((u) => {
        vezes[u] = (vezes[u] || 0) + 1;
        if (M.tiradas.has(u)) e('a linha ' + u + ' foi tirada da tela, mas está gravada (chave ' + g.chave + ')');
        if (M.descartadas.has(u)) e('a linha ' + u + ' foi descartada no "Terminar", mas está gravada (chave ' + g.chave + ')');
        const l = c ? c.linhas.find((x) => x.uid === u) : null;
        if (l && ['FILA', 'AVISO', 'ERRO', 'NAO_ENCONTRADO'].indexOf(l.estado) >= 0) e('a linha ' + u + ' está "' + l.estado + '" na tela, mas já foi gravada (chave ' + g.chave + ')');
        const m = M.linhas[u];
        if (m && m.animalGravado === undefined) m.animalGravado = null;
      });
      // O evento tem o cabeçalho da sessão em que o bloco foi criado e o valor de cada linha.
      const sess = M.sessaoDaChave ? M.sessaoDaChave(g.chave) : null;
      if (sess && g.evento.event_date !== sess.data) e('a chave ' + g.chave + ' gravou em ' + g.evento.event_date + '; a sessão é de ' + sess.data);
      if (sess && tela === 'curral') {
        g.rows.forEach((row) => { if (row.metodo !== sess.metodo || row.tipo !== sess.momento) e('a pesagem gravada pela chave ' + g.chave + ' tem ' + row.metodo + '/' + row.tipo + '; a sessão é ' + sess.metodo + '/' + sess.momento); });
      }
      if (sess && tela === 'tronco') {
        g.rows.forEach((row) => { if (row.metodo !== sess.metodo || (row.estacao_id || '') !== (sess.estacao_id || '')) e('o diagnóstico gravado pela chave ' + g.chave + ' tem ' + row.metodo + '/' + row.estacao_id + '; a sessão é ' + sess.metodo + '/' + sess.estacao_id); });
      }
      const sobra = g.rows.slice();
      k.uids.forEach((u) => {
        const m = M.linhas[u];
        if (!m) return;
        const i = sobra.findIndex((row) => (tela === 'curral' ? row.peso_kg === m.valor : row.resultado === m.valor.resultado && (row.idade_gestacional_dias || null) === (m.valor.idade || null)));
        if (i < 0) e('a linha ' + u + ' (' + JSON.stringify(m.valor) + ') não está no evento da chave ' + g.chave + ' com o valor digitado: ' + JSON.stringify(g.rows.map((x) => [x.animal_id, x.peso_kg || x.resultado])));
        else {
          const row = sobra.splice(i, 1)[0];
          const rr = resolverModelo(m.texto, g.evento.event_date);
          if (rr.animal_id && rr.animal_id !== row.animal_id && !(rr.situacao === 'VARIOS')) e('a linha ' + u + ' ("' + m.texto + '") gravou o animal ' + row.animal_id + '; em ' + g.evento.event_date + ' o texto é de ' + rr.animal_id);
        }
      });
    });
    Object.keys(vezes).forEach((u) => { if (vezes[u] > 1) e('a linha ' + u + ' foi gravada ' + vezes[u] + ' vezes'); });
    if (c) {
      c.linhas.forEach((l) => {
        if (l.estado !== 'GRAVADA') return;
        const b = blocoDe(c, l.bloco);
        if (!b || b.estado !== 'GRAVADO') e('a linha ' + l.uid + ' diz gravada, e o bloco dela não está gravado');
        if (!banco.some((g) => g.chave === l.bloco)) e('a linha ' + l.uid + ' diz gravada, e a chave ' + l.bloco + ' não está confirmada no banco');
      });
    }
    // A mensagem de cada recusa do servidor ao lançamento aparece na tela.
    rede.novasRecusas.splice(0, rede.novasRecusas.length).forEach((reg) => {
      const er = reg.resposta.error;
      const msgs = (er.details || []).length ? er.details.map((d) => d.mensagem).filter(Boolean) : [er.message];
      msgs.forEach((m) => { if (v.textoTodo.indexOf(m) < 0) e('a recusa ' + er.code + ' do servidor não aparece na tela: "' + m + '"'); });
      conta('recusa:' + er.code);
    });
    // Nada preso: com o tempo passado, nada "enviando", e toda linha não gravada tem saída.
    if (op.preso && c) {
      const pend = c.linhas.filter((l) => l.estado === 'NAO_ENCONTRADO' || l.estado === 'ERRO');
      c.linhas.forEach((l) => {
        const dom = v.linhas.find((x) => x.uid === l.uid) || { botoes: [] };
        if (l.estado === 'ENVIANDO') e('a linha ' + l.uid + ' ficou "enviando" depois de o tempo passar');
        if ((l.estado === 'FILA' || l.estado === 'SEM_SINAL') && !pend.length && (!v.enviar || v.enviar.desabilitado)) e('a linha ' + l.uid + ' está "' + l.estado + '" e o "Enviar" está desligado sem pendência: ' + JSON.stringify(v.enviar) + ' "' + v.status + '"');
        if ((l.estado === 'NAO_ENCONTRADO' || l.estado === 'ERRO') && dom.botoes.indexOf('Tirar') < 0) e('a pendência ' + l.uid + ' não tem "Tirar": ' + JSON.stringify(dom.botoes));
        if (l.estado === 'AVISO' && dom.botoes.indexOf('Está certo') < 0 && !v.avisoGeral) e('a linha com aviso ' + l.uid + ' não tem "Está certo"');
      });
      conta('preso:conferido');
    }
    if (erros.length) falhar(erros.join('\n  - '));
    conta('verificado');
    return v;
  }

  // ---------------------------------------------------------------- as ações ----
  const DATAS = [HOJE, HOJE, HOJE, '2026-11-12', '2026-11-11', '2026-11-10', '2026-11-04', '2026-10-01', '2025-12-20'];
  function sortearSessao() {
    const data = um(rnd, DATAS);
    if (tela === 'curral') return { data, metodo: um(rnd, ['BALANCA', 'BALANCA', 'FITA', 'ESTIMATIVA_VISUAL']), momento: um(rnd, ['ROTINA', 'ROTINA', 'ENTRADA', 'DESMAMA', 'VENDA']), jejum: rnd() < 0.2, pasto_id: um(rnd, ['', S.PASTOS.A, S.PASTOS.B]) };
    return { data, metodo: um(rnd, ['PALPACAO', 'ULTRASSOM', 'OBSERVACAO', 'INFORMADO']), estacao_id: um(rnd, [''].concat(sis.estacoes)), responsavel: rnd() < 0.3 ? 'Dr. Paulo' : '' };
  }
  async function preencherInicio(sessao) {
    if (tela === 'curral') {
      await page.fill('#cur-data', sessao.data);
      await page.selectOption('#cur-metodo', sessao.metodo);
      await page.selectOption('#cur-momento', sessao.momento);
      if ((await page.isChecked('#cur-jejum')) !== sessao.jejum) await page.click('label[for=cur-jejum]');
      await page.selectOption('#cur-pasto', sessao.pasto_id);
    } else {
      await page.fill('#tr-data', sessao.data);
      await page.selectOption('#tr-metodo', sessao.metodo);
      await page.selectOption('#tr-estacao', sessao.estacao_id);
      await page.fill('#tr-resp', sessao.responsavel);
    }
    await page.click('button:has-text("' + cfg.comecar + '")');
    await page.waitForSelector(cfg.brinco);
  }
  // O que o operador digita no brinco.
  const TEXTOS = tela === 'curral'
    ? [['0457', 8], ['457', 3], ['1457', 5], ['0391', 5], ['391', 2], ['12', 6], ['0520', 6], ['0611', 6], ['33', 5], ['0815', 6], ['0702', 3], ['9999', 3], ['0000', 1], ['cod-sem', 3], ['cod-com', 2]]
    : [['0457', 8], ['457', 3], ['1457', 6], ['0391', 6], ['0520', 7], ['0611', 7], ['0815', 7], ['0702', 3], ['12', 3], ['33', 2], ['9999', 3], ['cod-sem', 3], ['cod-com', 1]];
  function sortearTexto() {
    const t = ponderado(rnd, TEXTOS.map((x) => [x[1], x[0]]));
    return t === 'cod-sem' ? sis.codigoSemBrinco : t === 'cod-com' ? sis.codigoComBrinco : t;
  }
  /** O valor digitado: {texto, valor (null = inválido)}. */
  function sortearValor() {
    if (tela === 'curral') {
      if (rnd() < 0.12) return { texto: um(rnd, ['412,55', '0', 'abc', '2500', '-3', '']), valor: null };
      const v = Math.round((150 + rnd() * 400) * 10) / 10;
      const implausivel = rnd() < 0.08;
      const peso = implausivel ? 45 : v;
      return { texto: rnd() < 0.2 ? String(peso) : fmt1.format(peso).replace(/\./g, ''), valor: peso };
    }
    if (rnd() < 0.12) return { texto: um(rnd, ['x', 'v90', 'pp', '']), valor: null };
    const k = um(rnd, ['p', 'p', 'v', 'v', 'd', 'p90', 'p 120', 'P60']);
    const m = /^([pvd])\s*(\d+)?$/i.exec(k);
    const res = { p: 'POSITIVO', v: 'NEGATIVO', d: 'INCONCLUSIVO' }[m[1].toLowerCase()];
    return { texto: k, valor: { resultado: res, idade: m[2] ? Number(m[2]) : null } };
  }

  /** Brinco, Enter (ou não, o operador apressado), valor, Enter (ou o botão); a decisão do repetido; a escolha entre vários. */
  async function lancar() {
    const antes = await lerTela(page, tela);
    const c0 = antes.c;
    const texto = sortearTexto();
    let val = sortearValor();
    const viaBotao = rnd() < 0.3;
    let botaoTronco = null;
    if (tela === 'tronco' && viaBotao) {
      botaoTronco = um(rnd, ['p', 'v', 'd']);
      // O botão grava o resultado dele; do campo, só a idade da prenhe que veio junto.
      const doCampo = val.valor && val.valor.resultado === 'POSITIVO' && val.valor.idade ? val.valor.idade : null;
      val = { texto: val.texto, valor: { resultado: { p: 'POSITIVO', v: 'NEGATIVO', d: 'INCONCLUSIVO' }[botaoTronco], idade: botaoTronco === 'p' ? doCampo : null } };
    }
    const nResolverAntes = rede.log.length;
    log('lançar "' + texto + '" ' + JSON.stringify(val.texto) + (viaBotao ? ' (botão' + (botaoTronco ? ' ' + botaoTronco : '') + ')' : ''));
    await page.fill(cfg.brinco, texto);
    if (rnd() < 0.8) await page.press(cfg.brinco, 'Enter');
    await page.fill(cfg.valor, val.texto);
    if (botaoTronco) await page.click('[data-resultado-rapido="' + botaoTronco + '"]');
    else if (viaBotao && tela === 'curral') await page.click('[data-proximo]');
    else await page.press(cfg.valor, 'Enter');
    await assentar();
    let v = await lerTela(page, tela);
    const D = M.sessao.data;
    // O que o servidor disse ao resolvedor nesta ação (ou a resposta guardada no aparelho).
    const pedidos = rede.log.slice(nResolverAntes).filter((r) => r.rota === 'animal.resolver' && (r.textos || []).indexOf(texto.trim()) >= 0);
    const semResposta = pedidos.length && pedidos.every((r) => !r.entregue || !r.resposta.ok);
    const rr = resolverModelo(texto.trim(), D);
    let alvo = rr;
    if (!semResposta && rr.situacao === 'VARIOS' && v.candidatos) {
      const i = Math.floor(rnd() * v.candidatos);
      await page.click('.curral-candidatos button >> nth=' + i);
      alvo = { situacao: 'ACHADO', animal_id: rr.candidatos[i], inelegivel: null };
      if (tela === 'tronco' && botaoTronco) await page.click('[data-resultado-rapido="' + botaoTronco + '"]');
      else await page.press(cfg.valor, 'Enter');
      await assentar();
      v = await lerTela(page, tela);
    }
    const novas = v.c.linhas.filter((l) => M.ordem.indexOf(l.uid) < 0);
    const ordemAntes = M.ordem.slice();
    const add = (uid) => { M.ordem.push(uid); M.linhas[uid] = { texto: texto.trim(), valor: val.valor, criada: v.c.sessao.data }; };
    const esperaSemLinha = (porque) => { if (novas.length || JSON.stringify(v.c.linhas.map((l) => l.uid)) !== JSON.stringify(ordemAntes)) falhar('lançar "' + texto + '" ' + porque + ': nenhuma linha devia mudar, e mudou: ' + JSON.stringify(v.c.linhas.map((l) => [l.uid, l.estado]))); };
    if (val.valor === null) { esperaSemLinha('com o valor inválido "' + val.texto + '"'); conta('lancar:invalido'); return; }
    if (semResposta) {
      if (novas.length !== 1) falhar('lançar "' + texto + '" sem resposta do servidor devia criar uma linha pendente; novas: ' + JSON.stringify(novas.map((l) => [l.uid, l.estado])));
      if (novas[0].estado !== 'NAO_ENCONTRADO' && novas[0].estado !== 'FILA') falhar('a linha sem resposta do servidor está ' + novas[0].estado);
      add(novas[0].uid);
      conta('lancar:semResposta');
      return;
    }
    const X = alvo.situacao === 'ACHADO' ? alvo.animal_id : null;
    if (X && alvo.inelegivel) {
      if (tela === 'curral') { esperaSemLinha('de um animal que não entra (' + alvo.inelegivel + ')'); if (v.textoTodo.indexOf('não entra na pesagem') < 0) falhar('o curral não disse por que o animal não entra'); conta('lancar:inelegivel'); return; }
      if (novas.length !== 1 || novas[0].estado !== 'NAO_ENCONTRADO') falhar('o tronco devia deixar a fêmea que não entra (' + alvo.inelegivel + ') como pendência; novas: ' + JSON.stringify(novas));
      add(novas[0].uid);
      conta('lancar:inelegivel');
      return;
    }
    if (!X) {
      if (novas.length !== 1 || novas[0].estado !== 'NAO_ENCONTRADO') falhar('"' + texto + '" (' + rr.situacao + ') devia virar uma linha pendente; novas: ' + JSON.stringify(novas.map((l) => [l.uid, l.estado])));
      add(novas[0].uid);
      conta('lancar:naoEncontrado');
      return;
    }
    const ja = c0.linhas.filter((l) => l.animal_id === X);
    if (tela === 'curral' && ja.length) {
      const ult = ja[ja.length - 1];
      const mudavel = editavel(c0, ult) && ult.estado !== 'GRAVADA';
      if (!v.decisao) falhar('o repetido (' + texto + ') não pediu a decisão');
      const botao = mudavel ? 'Substituir o peso' : 'Pesar de novo';
      if (!(await page.isVisible('[data-decisao-repetido] ~ .acoes button:has-text("' + botao + '"), .curral-candidatos button:has-text("' + botao + '")'))) falhar('o repetido devia oferecer "' + botao + '"');
      if (rnd() < 0.25) { await page.click('.curral-candidatos button:has-text("Manter o anterior")'); await assentar(); v = await lerTela(page, tela); esperaSemLinha('com "Manter o anterior"'); conta('lancar:manter'); return; }
      await page.click('.curral-candidatos button:has-text("' + botao + '")');
      await assentar();
      v = await lerTela(page, tela);
      if (mudavel) {
        M.ordem = M.ordem.filter((u) => u !== ult.uid).concat([ult.uid]);
        M.linhas[ult.uid].valor = val.valor;
        M.linhas[ult.uid].texto = texto.trim();
        conta('lancar:substituir');
      } else {
        const n2 = v.c.linhas.filter((l) => M.ordem.indexOf(l.uid) < 0);
        if (n2.length !== 1) falhar('"Pesar de novo" devia criar uma linha');
        add(n2[0].uid);
        conta('lancar:deNovo');
      }
      return;
    }
    if (tela === 'tronco') {
      const subst = c0.linhas.filter((l) => l.animal_id === X && l.estado !== 'GRAVADA' && editavel(c0, l));
      if (subst.length) {
        const u = subst[subst.length - 1];
        if (novas.length) falhar('o diagnóstico repetido ainda não enviado devia substituir a linha ' + u.uid + ', e criou outra');
        M.ordem = M.ordem.filter((x) => x !== u.uid).concat([u.uid]);
        M.linhas[u.uid].valor = val.valor;
        M.linhas[u.uid].texto = texto.trim();
        conta('lancar:substituir');
        return;
      }
    }
    if (novas.length !== 1 || novas[0].animal_id !== X || novas[0].estado !== 'FILA') falhar('"' + texto + '" devia entrar na fila no animal ' + X + '; novas: ' + JSON.stringify(novas.map((l) => [l.uid, l.estado, l.animal_id])));
    add(novas[0].uid);
    conta('lancar:fila');
  }

  async function desfazer() {
    const c = (await lerTela(page, tela)).c;
    let alvo = null;
    for (let i = c.linhas.length - 1; i >= 0; i--) {
      const l = c.linhas[i];
      if (editavel(c, l) && ['FILA', 'NAO_ENCONTRADO', 'ERRO', 'AVISO'].indexOf(l.estado) >= 0) { alvo = l.uid; break; }
      if (l.estado !== 'GRAVADA') break;
    }
    log('desfazer o último' + (alvo ? ' (' + alvo + ')' : ' (nada)'));
    await page.click('[data-desfazer]');
    if (alvo) { M.ordem = M.ordem.filter((u) => u !== alvo); M.tiradas.add(alvo); conta('desfazer:tirou'); } else conta('desfazer:nada');
  }
  async function tirar(c) {
    const cands = c.linhas.filter((l) => l.estado !== 'GRAVADA' && l.estado !== 'ENVIANDO' && l.estado !== 'SEM_SINAL');
    if (!cands.length) return false;
    const l = um(rnd, cands);
    log('tirar ' + l.uid + ' (' + l.estado + ')');
    await page.click('[data-linha="' + l.uid + '"] button:has-text("Tirar")');
    M.ordem = M.ordem.filter((u) => u !== l.uid);
    M.tiradas.add(l.uid);
    conta('tirar');
    return true;
  }
  async function corrigirPeso(c) {
    const cands = c.linhas.filter((l) => l.estado === 'AVISO' || (l.estado === 'ERRO' && (tela === 'curral' || l.animal_id)));
    if (!cands.length) return false;
    const l = um(rnd, cands);
    if (tela === 'curral') {
      const igual = rnd() < 0.5;
      const novo = igual ? l.peso : Math.round((200 + rnd() * 300) * 10) / 10;
      log('corrigir o peso de ' + l.uid + ' para ' + novo);
      await page.click('[data-linha="' + l.uid + '"] button:has-text("Corrigir o peso")');
      await page.fill('#cur-corrige', fmt1.format(novo).replace(/\./g, ''));
      await page.click('[role=dialog] button:has-text("Corrigir")');
      M.linhas[l.uid].valor = novo;
    } else {
      if (l.estado !== 'ERRO') return false;
      // "Corrigir o resultado": o brinco volta ao campo e o veterinário digita de novo.
      log('corrigir o resultado de ' + l.uid);
      await page.click('[data-linha="' + l.uid + '"] button:has-text("Corrigir o resultado")');
      await assentar();
      const t = await page.inputValue(cfg.brinco);
      await page.fill(cfg.valor, 'v');
      await page.press(cfg.valor, 'Enter');
      M.linhas[l.uid].valor = { resultado: 'NEGATIVO', idade: null };
      M.linhas[l.uid].texto = t;
      M.ordem = M.ordem.filter((u) => u !== l.uid).concat([l.uid]);
    }
    conta('corrigir');
    return true;
  }
  async function corrigirBrinco(c) {
    if (tela !== 'curral') return false;
    const cands = c.linhas.filter((l) => l.estado === 'NAO_ENCONTRADO');
    if (!cands.length) return false;
    const l = um(rnd, cands);
    const t = sortearTexto();
    log('corrigir o brinco de ' + l.uid + ' para "' + t + '"');
    const n0 = rede.log.length;
    await page.click('[data-linha="' + l.uid + '"] button:has-text("Corrigir o brinco")');
    await page.fill('#cur-corrige-brinco', t);
    await page.click('[role=dialog] button:has-text("Corrigir")');
    await assentar();
    const v = await lerTela(page, tela);
    const r = v.c.linhas.find((x) => x.uid === l.uid);
    const pedidos = rede.log.slice(n0).filter((x) => x.rota === 'animal.resolver');
    const semResposta = pedidos.length && pedidos.every((x) => !x.entregue || !x.resposta.ok);
    const rr = resolverModelo(t, M.sessao.data);
    if (r && r.estado === 'FILA') M.linhas[l.uid].texto = t;
    else if (!semResposta && rr.situacao === 'ACHADO' && !rr.inelegivel) falhar('"Corrigir o brinco" para "' + t + '" (achado e no rebanho) não pôs a linha na fila: ' + JSON.stringify(r));
    if (v.dialogo) await page.click('[role=dialog] button:has-text("Voltar")');
    conta('corrigirBrinco');
    return true;
  }
  async function aceitar(v) {
    if (v.avisoGeral && rnd() < 0.5) { log('"Está certo (todo o lançamento)"'); await page.click('[data-aceitar-geral] >> nth=0'); conta('aceitarGeral'); return true; }
    const cands = v.linhas.filter((l) => l.estado === 'AVISO' && l.botoes.indexOf('Está certo') >= 0);
    if (!cands.length) { if (v.avisoGeral) { log('"Está certo (todo o lançamento)"'); await page.click('[data-aceitar-geral] >> nth=0'); conta('aceitarGeral'); return true; } return false; }
    const l = um(rnd, cands);
    log('"Está certo" em ' + l.uid);
    await page.click('[data-linha="' + l.uid + '"] button:has-text("Está certo")');
    conta('aceitar');
    return true;
  }
  async function enviar(v) {
    if (!v.enviar || v.enviar.desabilitado) return false;
    log('enviar (' + v.enviar.texto + ')');
    await page.click('[data-enviar]');
    conta('enviar');
    return true;
  }
  async function mudarSessao(v) {
    const c = v.c;
    const pode = !c.blocos.some((b) => b.estado === 'GRAVADO' || b.estado === 'SEM_SINAL' || b.estado === 'ENVIANDO');
    if (pode !== v.mudar) falhar('"Mudar" ' + (v.mudar ? 'aparece' : 'não aparece') + ' com os blocos ' + JSON.stringify(c.blocos.map((b) => b.estado)));
    if (!pode) return false;
    const nova = sortearSessao();
    log('mudar a sessão para ' + JSON.stringify(nova));
    await page.click(cfg.mudar);
    await page.waitForSelector(cfg.inicio);
    if (rnd() < 0.15) {
      // Desiste de mudar no meio: recarrega a página com o formulário aberto.
      log('  (recarrega com o formulário de mudar aberto)');
      await recarregar(true);
      return true;
    }
    await preencherInicio(nova);
    M.sessao = nova;
    conta('mudar');
    return true;
  }
  async function recarregar(semLog) {
    if (!semLog) log('recarregar a página');
    rede.largar(rnd);
    await page.reload();
    await A.esperarTela(page, cfg.titulo);
    conta('recarregar');
    return true;
  }
  async function sairEVoltar() {
    log('sair e voltar');
    await A.ir(page, cfg.fora, cfg.foraTitulo);
    if (rnd() < 0.5) await assentar();
    await A.ir(page, cfg.hash, cfg.titulo);
    conta('sairVoltar');
    return true;
  }
  async function terminar(v) {
    const c = v.c;
    const incertas = c.linhas.some((l) => l.estado === 'SEM_SINAL' || l.estado === 'ENVIANDO');
    const naoGravadas = c.linhas.filter((l) => l.estado !== 'GRAVADA');
    log('terminar' + (incertas ? ' (com incertas: deve recusar)' : naoGravadas.length ? ' (com ' + naoGravadas.length + ' não gravadas)' : ''));
    await page.click(cfg.status + ' button:has-text("' + cfg.terminar + '")');
    await assentar();
    if (incertas) {
      const w = await lerTela(page, tela);
      if (w.fase !== 'sessao') falhar('"Terminar" com linha sem confirmação devia recusar e ficar na sessão');
      conta('terminar:recusado');
      return true;
    }
    if (naoGravadas.length) {
      await page.waitForSelector('[role=dialog]');
      if (rnd() < 0.4) { await page.click('[role=dialog] button:has-text("Voltar")'); conta('terminar:voltou'); return true; }
      await page.click('[role=dialog] button:has-text("Descartar e terminar")');
      naoGravadas.forEach((l) => M.descartadas.add(l.uid));
    }
    await page.waitForSelector(cfg.resultado);
    const w = await lerTela(page, tela);
    const grav = c.linhas.filter((l) => l.estado === 'GRAVADA').length;
    if (w.resultadoN !== grav) falhar('o resultado diz ' + w.resultadoN + ' gravadas; a sessão tinha ' + grav);
    if (w.rascunho) falhar('o rascunho continua no aparelho depois de terminar');
    fecharSessao(c);
    conta('terminar');
    return true;
  }
  /** A sessão terminada: as linhas dela saem da tela; as gravadas ficam no modelo com o cabeçalho para a conferência do banco. */
  function fecharSessao(c) {
    const sess = M.sessao;
    const chaves = Object.keys(M.chaves).filter((k) => !M.chaves[k].sessao);
    chaves.forEach((k) => { M.chaves[k].sessao = sess; });
    c.linhas.forEach((l) => { if (l.estado === 'GRAVADA') M.linhas[l.uid].final = true; });
    M.ordem = [];
    M.sessao = null;
  }
  M.sessaoDaChave = (k) => (M.chaves[k] ? M.chaves[k].sessao || M.sessao : null);
  async function rede_() {
    const tipo = ponderado(rnd, [[3, 'perdeDepois'], [2, 'perdeAntes'], [3, 'transporte'], [2, 'transporteDepois'], [3, 'segurar'], [2, 'segurarAntes'], [2, 'ocupado'], [2, 'interna']]);
    const classe = ponderado(rnd, [[6, 'registrar'], [3, 'resolver'], [2, 'status']]);
    const n = rnd() < 0.7 ? 1 : 2;
    if (classe === 'resolver' && (tipo === 'segurar' || tipo === 'segurarAntes' || tipo === 'ocupado')) return false;
    for (let i = 0; i < n; i++) rede.falhas.push({ classe, tipo });
    log('rede: as próximas ' + n + ' de ' + classe + ' → ' + tipo);
    conta('rede:' + tipo);
    return true;
  }
  async function soltar() {
    if (!rede.segurados.length) return false;
    const inv = rnd() < 0.5;
    log('soltar ' + rede.segurados.length + ' resposta(s) segurada(s)' + (inv ? ' na ordem inversa' : ''));
    rede.soltar(inv);
    conta('soltar');
    return true;
  }
  async function tempo() {
    const ms = um(rnd, [3000, 12000, 46000, 46000, 120000]);
    log('o tempo passa (' + ms / 1000 + ' s)');
    await page.clock.fastForward(ms);
    conta('tempo');
    return true;
  }
  /** Outro usuário grava no mesmo banco: o mesmo animal no mesmo dia, ou uma morte (o servidor recusa o envio dela). */
  async function outroUsuario() {
    const vivos = [sis.ids.v520, sis.ids.v611, sis.ids.v815, sis.ids.vacaB].filter((x) => !M.mortos.has(x));
    if (!vivos.length || !M.sessao) return false;
    const x = um(rnd, vivos);
    if (rnd() < 0.25 && M.mortos.size < 1) {
      const r = s.api({ rota: 'evento.registrar', idempotencyKey: 'outro-morte-' + x, dados: { tipo: 'MORTE', campos: { event_date: HOJE, causa: 'DOENCA' }, animais: [{ animal_id: x }] } });
      log('outro usuário: morte de ' + x + ' hoje (' + (r.ok ? 'gravada' : r.error.code) + ')');
      if (r.ok) { M.mortos.add(x); M.versaoOutro += 1; }
      conta('outro:morte');
      return true;
    }
    const D = M.sessao.data;
    const dados = tela === 'curral'
      ? { tipo: 'PESAGEM', campos: { event_date: D, tipo_pesagem: 'ROTINA', metodo_pesagem: 'BALANCA' }, animais: [{ animal_id: x, peso: 400 }] }
      : { tipo: 'REPRODUCAO', subtipo: 'DIAGNOSTICO_GESTACAO', campos: { event_date: D, metodo: 'PALPACAO' }, animais: [{ animal_id: x, resultado: 'NEGATIVO' }] };
    const r = s.api({ rota: 'evento.registrar', idempotencyKey: 'outro-' + historico.length, avisosAceitos: ['POSSIVEL_DUPLICIDADE', 'PESO_IMPLAUSIVEL', 'RETROATIVO'], dados });
    log('outro usuário: ' + dados.tipo + ' de ' + x + ' em ' + D + ' (' + (r.ok ? 'gravado' : r.error.code) + ')');
    M.versaoOutro += 1;
    conta('outro:' + dados.tipo);
    return true;
  }

  // ---------------------------------------------------------------- o laço ----
  let k = 0;
  let rotulo = 'início';
  try {
    await assentar();
    M.sessao = sortearSessao();
    log('começar ' + JSON.stringify(M.sessao));
    await preencherInicio(M.sessao);
    await verificar();
    for (k = 0; k < nAcoes; k++) {
      await assentar();
      const v = await lerTela(page, tela);
      anotarChaves(v.c);
      rotulo = historico.length;
      if (v.fase === 'inicio') {
        // O formulário do começo (depois de "Nova" ou de recarregar no meio de "Mudar"): segue com a sessão sorteada.
        const nova = sortearSessao();
        log('começar ' + JSON.stringify(nova));
        await preencherInicio(nova);
        M.sessao = nova;
        if (!M.ordem.length) { /* sessão nova */ } else conta('mudar:recarga');
        await verificar();
        continue;
      }
      if (v.fase === 'resultado') {
        log('nova sessão');
        await page.click('button:has-text("' + cfg.nova + '")');
        await page.waitForSelector(cfg.inicio);
        continue;
      }
      if (v.fase !== 'sessao') falhar('a tela não está no lote: fase ' + v.fase + ' (' + v.titulo + ')');
      let feito = false;
      for (let tent = 0; tent < 6 && !feito; tent++) {
        const acao = ponderado(rnd, [[34, 'lancar'], [5, 'desfazer'], [4, 'tirar'], [3, 'corrigir'], [3, 'corrigirBrinco'], [5, 'aceitar'], [12, 'enviar'], [3, 'mudar'], [3, 'terminar'], [4, 'recarregar'], [3, 'sair'], [10, 'rede'], [4, 'soltar'], [5, 'tempo'], [2, 'outro'], [2, 'pendentes']]);
        if (acao === 'lancar') { await lancar(); feito = true; }
        else if (acao === 'desfazer') { await desfazer(); feito = true; }
        else if (acao === 'tirar') feito = await tirar(v.c);
        else if (acao === 'corrigir') feito = await corrigirPeso(v.c);
        else if (acao === 'corrigirBrinco') feito = await corrigirBrinco(v.c);
        else if (acao === 'aceitar') feito = await aceitar(v);
        else if (acao === 'enviar') feito = await enviar(v);
        else if (acao === 'mudar') feito = await mudarSessao(v);
        else if (acao === 'terminar') feito = await terminar(v);
        else if (acao === 'recarregar') feito = await recarregar();
        else if (acao === 'sair') feito = await sairEVoltar();
        else if (acao === 'rede') feito = await rede_();
        else if (acao === 'soltar') feito = await soltar();
        else if (acao === 'tempo') feito = await tempo();
        else if (acao === 'outro') feito = await outroUsuario();
        else if (acao === 'pendentes') {
          if (v.resolverPendentes) { log('conferir os brincos pendentes'); await page.click('[data-resolver-pendentes]'); feito = true; conta('pendentes'); }
          else if (v.posicaoTentar) { log('tentar de novo (posição)'); await page.click('[data-posicao-tentar]'); feito = true; conta('posicaoTentar'); }
        }
      }
      if (rnd() < 0.15) { await esperarLongo(); await verificar({ preso: true }); } else await verificar();
    }
    // ---- o fim: a rede boa, tudo resolvido, enviado e terminado.
    rotulo = 'fim';
    log('== fim: a rede volta');
    rede.limpar();
    for (let i = 0; i < 25; i++) {
      await esperarLongo();
      let v = await verificar({ preso: true });
      if (v.fase === 'inicio') { if (!M.ordem.length) break; const nova = M.sessao || sortearSessao(); await preencherInicio(nova); M.sessao = nova; continue; }
      if (v.fase === 'resultado') break;
      const c = v.c;
      if (c.linhas.every((l) => l.estado === 'GRAVADA')) break;
      if (v.avisoGeral) { log('fim: "Está certo (todo o lançamento)"'); await page.click('[data-aceitar-geral] >> nth=0'); continue; }
      const av = v.linhas.find((l) => l.estado === 'AVISO' && l.botoes.indexOf('Está certo') >= 0);
      if (av) { log('fim: "Está certo" em ' + av.uid); await page.click('[data-linha="' + av.uid + '"] button:has-text("Está certo")'); continue; }
      if (v.resolverPendentes && !M.pendentesConferidos) { log('fim: conferir os brincos pendentes'); M.pendentesConferidos = true; await page.click('[data-resolver-pendentes]'); continue; }
      if (v.posicaoTentar && !M.posicaoTentada) { M.posicaoTentada = true; log('fim: tentar de novo (posição)'); await page.click('[data-posicao-tentar]'); continue; }
      const pend = c.linhas.find((l) => l.estado === 'NAO_ENCONTRADO');
      if (pend) {
        const m = M.linhas[pend.uid];
        const rr = resolverModelo(m.texto, c.sessao.data);
        const outra = rr.animal_id && c.linhas.some((l) => l.uid !== pend.uid && l.animal_id === rr.animal_id);
        if (rr.situacao === 'ACHADO' && !rr.inelegivel && !outra && !pend.semPosicao) falhar('a linha ' + pend.uid + ' ("' + m.texto + '") ficou pendente, e em ' + c.sessao.data + ' o servidor acha o animal ' + rr.animal_id + ' no rebanho: ' + (pend.mensagem || ''));
        log('fim: tirar a pendência ' + pend.uid + ' ("' + m.texto + '": ' + (pend.mensagem || rr.situacao) + ')');
        await page.click('[data-linha="' + pend.uid + '"] button:has-text("Tirar")');
        M.ordem = M.ordem.filter((u) => u !== pend.uid);
        M.tiradas.add(pend.uid);
        continue;
      }
      const err = c.linhas.find((l) => l.estado === 'ERRO');
      if (err) {
        const injetada = (err.mensagem || '').indexOf('simulada') >= 0 || (c.erroGeral || '').indexOf('simulada') >= 0;
        if (injetada && tela === 'curral') {
          log('fim: corrigir o peso de ' + err.uid + ' (mesmo valor) depois da falha simulada');
          await page.click('[data-linha="' + err.uid + '"] button:has-text("Corrigir o peso")');
          await page.fill('#cur-corrige', fmt1.format(err.peso).replace(/\./g, ''));
          await page.click('[role=dialog] button:has-text("Corrigir")');
          continue;
        }
        log('fim: tirar a recusada ' + err.uid + ' (' + (err.mensagem || '') + ')');
        await page.click('[data-linha="' + err.uid + '"] button:has-text("Tirar")');
        M.ordem = M.ordem.filter((u) => u !== err.uid);
        M.tiradas.add(err.uid);
        continue;
      }
      if (v.enviar && !v.enviar.desabilitado) { log('fim: enviar'); await page.click('[data-enviar]'); continue; }
      falhar('bloco preso no fim: nada a fazer e há linhas não gravadas: ' + JSON.stringify(c.linhas.map((l) => [l.uid, l.estado, l.mensagem])) + ' status "' + v.status + '"');
    }
    let v = await verificar({ preso: true });
    if (v.fase === 'sessao') {
      if (!v.c.linhas.every((l) => l.estado === 'GRAVADA')) falhar('o fim não gravou tudo: ' + JSON.stringify(v.c.linhas.map((l) => [l.uid, l.estado, l.mensagem])));
      rotulo = 'terminar no fim';
      await terminar(v);
    }
    // O banco = o modelo: cada linha gravada uma vez, com o animal da data, o valor e o cabeçalho; a integridade limpa.
    await verificar();
    const banco = gravadoNoBanco();
    const gravadas = new Set();
    banco.forEach((g) => M.chaves[g.chave].uids.forEach((u) => gravadas.add(u)));
    Object.keys(M.linhas).forEach((u) => {
      const m = M.linhas[u];
      if (m.final && !gravadas.has(u)) falhar('a linha ' + u + ' apareceu como gravada e não está no banco');
      if (!m.final && gravadas.has(u)) falhar('a linha ' + u + ' está no banco e a tela não a mostrou como gravada');
      if (!m.final && !M.tiradas.has(u) && !M.descartadas.has(u)) falhar('a linha ' + u + ' ("' + m.texto + '") se perdeu: não foi tirada, descartada nem gravada');
    });
    const integ = s.integridade();
    if (integ.erros !== 0) falhar('a integridade tem ' + integ.erros + ' erro(s): ' + JSON.stringify(integ.checagens.filter((x) => x.situacao === 'ERRO')));
    s.conferirProjecoes('semente ' + semente);
    if (a.estado.erros.length) falhar('erros no console: ' + a.estado.erros.join(' | '));
    cont.gravadas = (cont.gravadas || 0) + gravadas.size;
    cont.sementes = (cont.sementes || 0) + 1;
    cont['tela:' + tela] = (cont['tela:' + tela] || 0) + 1;
  } catch (err) {
    err.message = 'semente ' + semente + ' (' + tela + '), ação ' + k + ' [' + rotulo + ']: ' + err.message + '\n  ações:\n    ' + historico.join('\n    ');
    throw err;
  } finally {
    await a.fechar().catch(() => {});
  }
}

const N = Number(process.env.FUZZ_SEMENTES || 0);
const INICIO = Number(process.env.FUZZ_INICIO || 1);
const SEMENTES = N ? Array.from({ length: N }, (_, i) => INICIO + i) : SEMENTES_FIXAS;
const COBERTURA = {};
for (const semente of SEMENTES) {
  test('curral e tronco, teste aleatório: semente ' + semente + ' (' + N_ACOES + ' ações)', { timeout: 600000 }, async () => {
    await rodarSemente(semente, N_ACOES, { contadores: COBERTURA });
  });
}
test.after(() => { if (process.env.FUZZ_COBERTURA === '1' || N) console.log('FUZZ-CURRAL-COBERTURA: ' + JSON.stringify(COBERTURA)); });

module.exports = { rodarSemente };
