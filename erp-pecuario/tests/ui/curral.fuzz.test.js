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
 * Nada depende do tempo real (as sementes se repetem): a nova tentativa do servidor ocupado, o prazo de 45 s da resposta perdida e a
 * resposta segurada há 6 ações são andados pelo próprio teste (o relógio da página, `avancar`).
 *
 * Segunda convergência, etapa 2 (CONTRATOS, seção 52): o modo sem localStorage com o rascunho no servidor falhando e a página
 * que vai embora de repente; a data passada com o brinco trocado ou reaproveitado depois; o brinco repetido com a linha anterior
 * em qualquer estado; o brinco conferido e não lançado antes de "Mudar" (com a resposta chegando na sessão nova); a pendente sem
 * sinal resolvida depois ou barrada. O oráculo confere também que nenhuma ação altera um bloco que saiu e que tudo o que a tela
 * mostra do animal (a linha, a mensagem do servidor, a conferência) é o que o servidor deu para a data da sessão.
 *
 * `npm run ui:check` roda as sementes fixas (poucas). FUZZ_SEMENTES=N roda N sementes a partir de FUZZ_INICIO (padrão 1);
 * FUZZ_ACOES muda as ações por semente (padrão 40); FUZZ_TELA=curral|tronco fixa a tela; FUZZ_MODO=semLS|comLS fixa o modo do
 * rascunho; FUZZ_LOG=1 imprime cada ação.
 */
const test = require('node:test');
const A = require('./apoio');
const {
  HOJE, RELOGIO, ROTULO_RES, LOTE, T, MSG_RECUSA_RESOLVEDOR, gerador, um, ponderado, esperarMs, fmt1, kg, montarSistema, novaRede, lerTela,
} = require('./apoio-curral');
/** A recusa do servidor (o código dele), não a falta de sinal (o transporte, o ocupado, a falha interna). */
const recusaDoServidor = (r) => !!(r && r.entregue && !r.resposta.ok && ['LOCKED', 'INTERNAL'].indexOf(r.resposta.error.code) < 0);

const { S } = A;
test.after(() => A.fecharBrowser());

const N_ACOES = Number(process.env.FUZZ_ACOES || 40);
/** FUZZ_MODO=semLS (o rascunho no servidor, SP-06) ou comLS fixa o modo do rascunho em todas as sementes. */
const MODO = process.env.FUZZ_MODO || '';
const SEMENTES_FIXAS = [11, 12, 13, 14, 15, 16];

// ------------------------------------------------------------------ uma semente ----
async function rodarSemente(semente, nAcoes, opcoes) {
  const o = opcoes || {};
  const rnd = gerador(semente * 7919 + 17);
  const tela = o.tela || process.env.FUZZ_TELA || (rnd() < 0.5 ? 'curral' : 'tronco');
  const cfg = T[tela];
  const sis = montarSistema();
  const { s } = sis;
  const rede = novaRede(s);
  // Revisão final da Fase 3 (achado 4): parte das sementes roda sem localStorage (o rascunho no servidor, SP-06), com o
  // rascunho que demora (segurado) enquanto o bloco sai. Sorteado à parte: as sequências das outras sementes não mudam.
  const sorteioLS = gerador(semente * 104729 + 3)() < 0.25;
  const semLS = o.semLocalStorage !== undefined ? !!o.semLocalStorage : MODO === 'semLS' ? true : MODO === 'comLS' ? false : sorteioLS;
  const a = await A.abrir(s, { largura: 360, hash: cfg.hash, relogio: RELOGIO, servidor: rede.servidor, semLocalStorage: semLS });
  const { page } = a;
  const historico = [];
  const log = (t) => { historico.push(t); if (process.env.FUZZ_LOG) console.log('  [' + semente + '] ' + t); };
  const cont = o.contadores || {};
  const conta = (k) => { cont[k] = (cont[k] || 0) + 1; };

  // O modelo: as linhas (uid → texto, valor), a ordem, o cabeçalho, as tiradas e as descartadas, as chaves de cada bloco visto.
  const M = { sessao: null, ordem: [], linhas: {}, tiradas: new Set(), descartadas: new Set(), chaves: {}, sessoes: [], versaoOutro: 0, mortos: new Set(), saiu: {}, saiuLinhas: {}, tocados: new Set() };
  if (semLS) { historico.push('(sem localStorage: o rascunho fica no servidor)'); conta('semLocalStorage'); }
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
  /** O animal em D pelo servidor (fora da rede da página): o brinco em uso naquele dia, a categoria, o pasto, a presença. */
  const estados = {};
  function estadoModelo(id, data) {
    const k = M.versaoOutro + '|' + data + '|' + id;
    if (estados[k]) return estados[k];
    const r = s.api({ rota: 'animal.resolver', dados: { data, textos: [], ids: [id], tipo: cfg.tipo, sexo: cfg.sexo || null } });
    if (!r.ok) throw new Error('resolvedor do modelo (ids): ' + JSON.stringify(r.error));
    estados[k] = r.data.animais[id];
    return estados[k];
  }
  const nomesPasto = {};
  s.tabela('PASTOS').forEach((p) => { nomesPasto[p.pasture_id] = p.nome; });
  /** O rascunho guardado no servidor (sem localStorage), lido fora da rede da página. */
  function rascunhoServidor() {
    const r = s.api({ rota: 'rascunho.obter', dados: { chave: 'r.' + cfg.rascunho } });
    if (!r.ok) throw new Error('rascunho.obter do modelo: ' + JSON.stringify(r.error));
    return r.data.existe ? r.data.conteudo : null;
  }
  const falhar = (msg) => { throw new Error(msg); };
  const essencialRascunho = (x) => JSON.stringify({ sessao: x.sessao, linhas: x.linhas.map((l) => [l.uid, l.estado, l.animal_id, l.peso, l.resultado, l.idade || null, l.bloco || null]), blocos: x.blocos.map((b) => [b.chave, b.estado, b.uids, b.campos, b.reenviar || false]) });
  /** O relógio da página anda (os prazos do aparelho vencem; o que estava segurado nesse tempo chega atrasado). */
  async function avancar(ms) { rede.passou(ms); await page.clock.fastForward(ms); }

  /** Espera a tela parar: todo pedido respondido (menos os segurados de propósito) e nenhuma conferência no ar. */
  async function assentar(o3) {
    const semConf = !!(o3 && o3.semConferencia);
    let quietas = 0;
    let presa = 0;
    for (let i = 0; i < 2000; i++) {
      const st = await page.evaluate((sel) => ({ em: window.__gas ? window.__gas.emCurso : 0, conf: /Conferindo/.test((document.querySelector(sel) || {}).textContent || '') }), cfg.conferencia);
      if (semConf) st.conf = false;
      if (st.em <= rede.segurados.length && !st.conf && rede.log.some((r) => r.ocupadoAberto)) {
        // O servidor estava ocupado: o aparelho espera 2, 5 ou 10 s para tentar de novo; o relógio anda até lá (nada fica
        // para o tempo real decidir no meio da próxima ação).
        rede.log.forEach((r) => { r.ocupadoAberto = false; });
        await avancar(10500);
        quietas = 0;
        await esperarMs(15);
        continue;
      }
      if (st.em <= rede.segurados.length && !st.conf) { quietas += 1; if (quietas >= 3) return; } else quietas = 0;
      presa = st.em <= rede.segurados.length && st.conf ? presa + 1 : 0;
      if (presa >= 3 && rede.log.some((r) => r.perdidaAberta && r.rota === 'animal.resolver')) {
        presa = 0;
        // A conferência do brinco espera uma resposta que se perdeu: o operador espera os 45 s do prazo.
        await avancar(46000);
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
      await avancar(50000);
    }
  }
  function blocoDe(c, chave) { return c.blocos.find((b) => b.chave === chave) || null; }
  function editavel(c, l) { if (!l.bloco) return true; const b = blocoDe(c, l.bloco); return !b || b.estado === 'NOVO' || b.estado === 'AVISO' || b.estado === 'ERRO'; }
  /** O bloco que saiu (no ar, sem confirmação ou gravado): só a resposta do servidor decide o destino dele (CONTRATOS, seção 48). */
  const saiu = (b) => !!b && ['ENVIANDO', 'SEM_SINAL', 'GRAVADO'].indexOf(b.estado) >= 0;
  /** A linha ainda é do aparelho: na sessão, não gravada e fora de bloco que saiu. */
  const mexivel = (c, l) => !!l && c.linhas.some((y) => y.uid === l.uid) && ['GRAVADA', 'ENVIANDO', 'SEM_SINAL'].indexOf(l.estado) < 0 && editavel(c, l);
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
  /** A mensagem de cada recusa do servidor ao lançamento, entregue desde a última olhada, aparece na tela. */
  function recusasNaTela(v) {
    const erros = [];
    rede.novasRecusas.splice(0, rede.novasRecusas.length).forEach((reg) => {
      const er = reg.resposta.error;
      const msgs = (er.details || []).length ? er.details.map((d) => d.mensagem).filter(Boolean) : [er.message];
      msgs.forEach((m) => { if (v.textoTodo.indexOf(m) < 0) erros.push('a recusa ' + er.code + ' do servidor não aparece na tela: "' + m + '"'); });
      conta('recusa:' + er.code);
    });
    return erros;
  }
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
      const essencial = essencialRascunho;
      // Sem localStorage o rascunho vai ao servidor adiado (1 s) — a conferência dele é a da recarga (nada perdido).
      if (!semLS && !r) e('a sessão não está guardada no aparelho');
      else if (!semLS && essencial(r) !== essencial(c)) e('o rascunho guardado não é o estado da tela:\n   guardado ' + essencial(r) + '\n   na tela  ' + essencial(c));
      // Revisão final da Fase 3 (achados 3 e 4): o bloco que saiu é intocável no aparelho — nenhuma linha dele oferece mexer
      // ("Tirar", "Corrigir", "Está certo"), a sessão não muda ("Mudar" some), e ele só deixa a sessão por uma recusa do
      // servidor que prova que a chave não foi gravada (VALIDATION, CONFLICT) ou pela chave já gravada (IDEMPOTENCY_MISMATCH).
      c.linhas.forEach((l) => {
        const b = l.bloco ? blocoDe(c, l.bloco) : null;
        const dom = v.linhas.find((x) => x.uid === l.uid) || { botoes: [] };
        if (saiu(b)) ['Tirar', 'Corrigir o peso', 'Corrigir o resultado', 'Corrigir o brinco', 'Está certo'].forEach((t) => { if (dom.botoes.indexOf(t) >= 0) e('a linha ' + l.uid + ' está num bloco que saiu (' + b.estado + ') e a tela oferece "' + t + '"'); });
      });
      // Segunda convergência, rodada 1 (achado 12): duas linhas do mesmo animal nunca estão juntas no aparelho (todo caminho
      // aplica a regra do repetido), e o servidor nunca recusa um bloco por animal repetido.
      // Um bloco (um lançamento) nunca leva o mesmo animal duas vezes, por qualquer caminho que a linha tenha chegado à fila (a
      // segunda pesagem do mesmo dia sai no bloco seguinte).
      const doAnimal = {};
      c.linhas.forEach((l) => {
        if (!l.animal_id || !l.bloco) return;
        const k = l.bloco + '|' + l.animal_id;
        if (doAnimal[k]) e('as linhas ' + doAnimal[k].uid + ' (' + doAnimal[k].estado + ') e ' + l.uid + ' (' + l.estado + ') são do mesmo animal (' + l.animal_id + ') no bloco ' + l.bloco);
        doAnimal[k] = l;
      });
      if (rede.log.some((x) => x.rota === 'evento.registrar' && x.entregue && !x.resposta.ok && (x.resposta.error.details || []).some((d) => d.codigo === 'ANIMAL_REPETIDO'))) e('o servidor recusou um bloco com o animal repetido (ANIMAL_REPETIDO)');
      // Achado 13: a pendente que espera o servidor não se lê "brinco não encontrado"; o macho achado no tronco, também não.
      c.linhas.forEach((l) => {
        if (l.estado !== 'NAO_ENCONTRADO') return;
        const dom = v.linhas.find((x) => x.uid === l.uid);
        if (!dom) return;
        // Segunda convergência, rodada 2 (achado 16): a barrada por outra linha do mesmo animal diz "barrada", não "a conferir no
        // servidor" (o servidor já respondeu); e só é barrada se o texto dela, na data da sessão, é de um animal com outra linha
        // ainda do aparelho.
        if (l.semPosicao && l.barrada) {
          const m = M.linhas[l.uid];
          const rr = m ? resolverModelo(m.texto, c.sessao.data) : null;
          const justa = rr && rr.situacao === 'ACHADO' && !rr.inelegivel && c.linhas.some((y) => y.uid !== l.uid && y.animal_id === rr.animal_id && mexivel(c, y));
          if (dom.texto.indexOf('barrada') < 0 || dom.texto.indexOf('a conferir no servidor') >= 0 || dom.texto.indexOf('brinco não encontrado') >= 0) e('a pendente ' + l.uid + ' (barrada por outra linha do mesmo animal) aparece como "' + dom.texto + '"');
          else if (m && !justa) e('a pendente ' + l.uid + ' ("' + m.texto + '") está barrada sem outra linha do mesmo animal ainda do aparelho em ' + c.sessao.data);
          else conta('rotulo:barrada');
        } else if (l.semPosicao && (dom.texto.indexOf('brinco não encontrado') >= 0 || dom.texto.indexOf('a conferir no servidor') < 0)) e('a pendente ' + l.uid + ' (sem resposta do servidor) aparece como "' + dom.texto + '"');
        else if (l.semPosicao) conta('rotulo:pendente');
        // Achado 15: a recusada pelo servidor se lê assim, com o porquê, e não espera sinal.
        else if (l.recusada && (dom.texto.indexOf('recusada pelo servidor') < 0 || dom.texto.indexOf('O servidor recusou a conferência') < 0)) e('a linha ' + l.uid + ' recusada pelo servidor aparece como "' + dom.texto + '"');
        else if (l.recusada) conta('rotulo:recusada');
      });
      // Achado 17: o contador do tronco conta as fêmeas achadas, não as linhas.
      if (tela === 'tronco' && v.contador !== null) {
        const femeas = new Set(c.linhas.filter((l) => l.animal_id).map((l) => l.animal_id)).size;
        if (Number(v.contador) !== femeas) e('o contador do tronco diz ' + v.contador + ' diagnosticadas; a sessão tem ' + femeas + ' fêmeas achadas');
        else conta('contador:conferido');
      }
      const algumSaiu = c.blocos.some(saiu);
      if (v.mudar === algumSaiu) e('"Mudar" ' + (v.mudar ? 'aparece com' : 'some sem') + ' bloco que saiu: ' + JSON.stringify(c.blocos.map((b) => b.estado)));
      const fotoBloco = (b) => JSON.stringify(c.linhas.filter((l) => l.bloco === b.chave).map((l) => [l.uid, l.animal_id, tela === 'curral' ? l.peso : l.resultado, l.idade || null]));
      Object.keys(M.saiu).forEach((k) => {
        const b = blocoDe(c, k);
        const antes = M.saiu[k];
        if (b && saiu(b)) {
          if (antes === 'GRAVADO' && b.estado !== 'GRAVADO') e('o bloco ' + k + ' estava gravado e agora está ' + b.estado);
          // Nenhuma ação na tela altera o bloco que saiu: as mesmas linhas, com o mesmo animal e o mesmo valor.
          if (M.saiuLinhas[k] && M.saiuLinhas[k] !== fotoBloco(b)) e('o bloco ' + k + ' saiu (' + b.estado + ') e as linhas dele mudaram: ' + M.saiuLinhas[k] + ' → ' + fotoBloco(b));
          return;
        }
        // Deixou de "ter saído" (desfeito, ou com aviso ou recusa): só a resposta do servidor que prova que a chave não foi
        // gravada (o aviso, VALIDATION, CONFLICT) ou a chave já gravada (IDEMPOTENCY_MISMATCH) o explica — ou o bloco nunca
        // ter saído do aparelho (a chave não ficou guardada no rascunho, e o envio não foi feito; CONTRATOS, seção 52).
        const provou = rede.log.some((x) => x.chave === k && x.entregue && !x.resposta.ok && ['NEEDS_CONFIRMATION', 'VALIDATION', 'CONFLICT', 'IDEMPOTENCY_MISMATCH'].indexOf(x.resposta.error.code) >= 0);
        const nuncaSaiu = !rede.log.some((x) => x.chave === k);
        if (nuncaSaiu) conta('bloco que não saiu (chave não guardada)');
        if (!provou && !nuncaSaiu) e('o bloco ' + k + ' saiu (' + antes + ') e o aparelho ' + (b ? 'o pôs em ' + b.estado : 'o desfez') + ' sem a resposta do servidor');
        if (b && nuncaSaiu && b.estado === 'NOVO' && v.naoGuardado.indexOf(k) < 0) e('o bloco ' + k + ' não saiu (a chave não ficou guardada) e a tela não diz por quê');
        delete M.saiu[k];
        delete M.saiuLinhas[k];
      });
      c.blocos.forEach((b) => { if (saiu(b)) { M.saiu[b.chave] = b.estado; if (!M.saiuLinhas[b.chave]) M.saiuLinhas[b.chave] = fotoBloco(b); conta('bloco que saiu conferido'); } });
      // O rascunho no servidor que falhou é avisado em qualquer tela (o curral e o tronco também), até ir de novo.
      if (v.situacaoRascunho && v.situacaoRascunho.estado === 'FALHOU') { conta('rascunho:falhou'); if (!v.faixaRascunho) e('o rascunho no servidor falhou (' + (v.situacaoRascunho.erro && v.situacaoRascunho.erro.message) + ') e a tela não avisa'); }
      // Tudo o que a tela mostra do animal é o que o servidor deu para a data da sessão: a linha começa pelo brinco daquele dia
      // (o número trocado ou reaproveitado depois é o de hoje, entre parênteses), ou pelo código do animal sem brinco.
      c.linhas.forEach((l) => {
        if (!l.animal_id) return;
        const dom = v.linhas.find((x) => x.uid === l.uid);
        if (!dom) return;
        const est = estadoModelo(l.animal_id, c.sessao.data);
        const esperado = (est && (est.brinco || est.codigo_interno)) || null;
        const rot = dom.texto.split(' · ')[1] || '';
        if (esperado && rot !== esperado && rot.indexOf(esperado + ' (hoje ') !== 0) e('a linha ' + l.uid + ' mostra o animal como "' + rot + '"; em ' + c.sessao.data + ' o servidor dá o brinco ' + esperado + ': "' + dom.texto + '"');
        else conta('rotulo:conferido');
        // A mensagem do servidor na linha (o aviso, a recusa) nomeia o animal pelo brinco daquele dia (o de hoje entre parênteses).
        const mm = (l.estado === 'AVISO' || l.estado === 'ERRO') && l.mensagem && !l.jaGravada ? /^(\S+)(?: \(hoje [^)]*\))?: /.exec(l.mensagem) : null;
        if (mm && esperado && mm[1] !== esperado) e('a mensagem da linha ' + l.uid + ' nomeia o animal como ' + mm[1] + '; em ' + c.sessao.data + ' o brinco é ' + esperado + ': "' + l.mensagem + '"');
        else if (mm) conta('mensagem:brincoDaData');
        if (est && est.brinco_hoje !== est.brinco && est.brinco && c.sessao.data !== HOJE) conta('rotulo:brincoTrocado');
      });
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
    recusasNaTela(v).forEach(e);
    // Nada preso: com o tempo passado, nada "enviando", e toda linha não gravada tem saída.
    if (op.preso && c) {
      const pend = c.linhas.filter((l) => l.estado === 'NAO_ENCONTRADO' || l.estado === 'ERRO');
      c.linhas.forEach((l) => {
        const dom = v.linhas.find((x) => x.uid === l.uid) || { botoes: [] };
        if (l.estado === 'ENVIANDO') e('a linha ' + l.uid + ' ficou "enviando" depois de o tempo passar');
        // A linha na fila de um bloco com aviso espera a decisão do aviso (de uma linha dele ou o geral), que tem botão.
        const b = l.bloco ? blocoDe(c, l.bloco) : null;
        const esperaAviso = b && b.estado === 'AVISO' && (c.linhas.some((x) => x.bloco === b.chave && x.estado === 'AVISO') || ((b.gerais || []).length && !b.geralAceito));
        if ((l.estado === 'FILA' || l.estado === 'SEM_SINAL') && !esperaAviso && !pend.length && (!v.enviar || v.enviar.desabilitado)) e('a linha ' + l.uid + ' está "' + l.estado + '" e o "Enviar" está desligado sem pendência: ' + JSON.stringify(v.enviar) + ' "' + v.status + '"');
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
  // As datas da sessão: hoje, os dias das trocas do 0457 (11/11 e 12/11) e antes delas (o brinco trocado ou reaproveitado
  // depois é o daquele dia), antes da morte, um mês antes e antes do marco zero.
  const DATAS = [HOJE, HOJE, HOJE, '2026-11-12', '2026-11-12', '2026-11-11', '2026-11-11', '2026-11-10', '2026-11-04', '2026-11-04', '2026-10-01', '2025-12-20'];
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

  /**
   * Depois do Enter no brinco, o operador lê a conferência: o animal achado aparece com o brinco DAQUELA data (ou o código do
   * animal sem brinco), a categoria e o pasto do servidor na data da sessão — nunca o estado de hoje do aparelho.
   */
  async function olharConferencia(texto) {
    await assentar();
    const v = await lerTela(page, tela);
    if (v.fase !== 'sessao' || !M.sessao) return;
    const rr = resolverModelo(texto, M.sessao.data);
    if (rr.situacao !== 'ACHADO' || M.tocados.has(rr.animal_id)) return;
    if (v.conferenciaTipo !== 'OK' && v.conferenciaTipo !== 'INATIVO') return;
    const est = estadoModelo(rr.animal_id, M.sessao.data);
    const erros = [];
    const nome = est.brinco || est.codigo_interno;
    if (v.conferenciaTexto.indexOf(nome) !== 0) erros.push('começa pelo brinco ' + nome);
    if (est.categoria && v.conferenciaTexto.indexOf(est.categoria) < 0) erros.push('mostra a categoria ' + est.categoria);
    const presente = !(est.presente === false);
    if (presente && est.pasture_id && v.conferenciaTexto.indexOf(nomesPasto[est.pasture_id]) < 0) erros.push('mostra o pasto ' + nomesPasto[est.pasture_id]);
    if (erros.length) falhar('a conferência de "' + texto + '" em ' + M.sessao.data + ' devia vir do servidor (' + erros.join('; ') + '): "' + v.conferenciaTexto + '"');
    conta('conferencia:conferida');
  }
  function sortearValorValido() {
    const x = sortearValor();
    if (x.valor !== null) return x;
    return tela === 'curral' ? { texto: '321', valor: 321 } : { texto: 'p', valor: { resultado: 'POSITIVO', idade: null } };
  }
  /**
   * "Conferir os brincos pendentes": com a resposta do servidor, a pendente sem sinal cujo texto o servidor acha (no rebanho na
   * data) sai da pendência — só a barrada por outra linha do mesmo animal (ainda do aparelho) continua esperando.
   */
  async function conferirPendentes() {
    const n0 = rede.log.length;
    await page.click('[data-resolver-pendentes]');
    await assentar();
    const pedidos = rede.log.slice(n0).filter((x) => x.rota === 'animal.resolver');
    if (pedidos.some((x) => x.perdidaAberta)) {
      // A resposta perdida: até o prazo do aparelho (45 s), o toque já tem resposta na tela — o botão diz "Conferindo…" e fica
      // travado (o toque repetido não pede de novo). Depois do prazo, vale a regra de baixo (sem resposta do servidor).
      const w0 = await lerTela(page, tela);
      if (w0.fase === 'sessao' && !/Conferindo os brincos pendentes no servidor/.test(w0.textoTodo)) falhar('"Conferir os brincos pendentes no servidor" à espera da resposta do servidor não disse nada na tela');
      conta('pendentes:noAr');
      await avancar(46000);
      await assentar();
    }
    if (pedidos.length && pedidos.every((x) => !x.entregue || !x.resposta.ok)) {
      const w = await lerTela(page, tela);
      // Segunda convergência, rodada 2 (achado 15): a recusa do servidor diz a recusa e o caminho, e tira as linhas da espera
      // (o botão some: tocar de novo repetiria a mesma recusa).
      if (pedidos.some(recusaDoServidor)) {
        if (w.fase === 'sessao' && (w.textoTodo.indexOf('O servidor recusou a conferência') < 0 || w.textoTodo.indexOf('à espera dele') >= 0)) falhar('"Conferir os brincos pendentes no servidor" recusado pelo servidor não disse a recusa (ou disse "sem resposta")');
        if (w.fase === 'sessao' && w.c.linhas.some((l) => l.estado === 'NAO_ENCONTRADO' && l.semPosicao)) falhar('depois da recusa do servidor, linhas continuam à espera de sinal: ' + JSON.stringify(w.c.linhas.filter((l) => l.semPosicao).map((l) => l.uid)));
        conta('pendentes:recusado');
        return;
      }
      // Segunda convergência, rodada 1 (achado 13): o toque sem resposta do servidor tem resposta na tela.
      if (w.fase === 'sessao' && w.textoTodo.indexOf('à espera dele') < 0) falhar('"Conferir os brincos pendentes no servidor" sem resposta do servidor não disse nada na tela');
      conta('pendentes:semResposta');
      return;
    }
    const v = await lerTela(page, tela);
    if (v.fase !== 'sessao') return;
    const c = v.c;
    c.linhas.filter((l) => l.estado === 'NAO_ENCONTRADO' && l.semPosicao).forEach((l) => {
      const m = M.linhas[l.uid];
      const rr = resolverModelo(m.texto, c.sessao.data);
      if (rr.situacao !== 'ACHADO' || rr.inelegivel) return;
      const outra = c.linhas.some((y) => y.uid !== l.uid && y.animal_id === rr.animal_id && mexivel(c, y));
      if (!outra) falhar('a pendente ' + l.uid + ' ("' + m.texto + '") continuou esperando depois da resposta do servidor, que acha ' + rr.animal_id + ' em ' + c.sessao.data + ' sem outra linha dele');
      conta('pendentes:barrada');
    });
  }
  /** Brinco, Enter (ou não, o operador apressado), valor, Enter (ou o botão); a decisão do repetido; a escolha entre vários. */
  async function lancar() {
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
    await lancarUm(texto, val, viaBotao, botaoTronco, false);
  }
  async function lancarUm(texto, val, viaBotao, botaoTronco, quieto) {
    const antes = await lerTela(page, tela);
    const c0 = antes.c;
    const nResolverAntes = rede.log.length;
    if (!quieto) log('lançar "' + texto + '" ' + JSON.stringify(val.texto) + (viaBotao ? ' (botão' + (botaoTronco ? ' ' + botaoTronco : '') + ')' : ''));
    await page.fill(cfg.brinco, texto);
    if (rnd() < 0.8) {
      await page.press(cfg.brinco, 'Enter');
      if (rnd() < 0.5) await olharConferencia(texto.trim());
    }
    await page.fill(cfg.valor, val.texto);
    if (botaoTronco) await page.click('[data-resultado-rapido="' + botaoTronco + '"]');
    else if (viaBotao && tela === 'curral') await page.click('[data-proximo]');
    else await page.press(cfg.valor, 'Enter');
    await assentar();
    let v = await lerTela(page, tela);
    // O bloco cheio sai sozinho: a recusa dele aparece já (o passo seguinte do operador pode desfazê-lo).
    const rec = recusasNaTela(v);
    if (rec.length) falhar(rec.join('\n  - '));
    const D = M.sessao.data;
    // O que o servidor disse ao resolvedor nesta ação (ou a resposta guardada no aparelho).
    // A conferência pergunta o texto junto com as pendentes sem sinal (a resposta guardada no aparelho não vai de novo): sem a
    // resposta dessa pergunta, a linha fica pendente — mesmo com o texto já conhecido, a decisão do repetido espera as pendentes.
    const daAcao = rede.log.slice(nResolverAntes).filter((r) => r.rota === 'animal.resolver');
    const doTexto = daAcao.filter((r) => (r.textos || []).indexOf(texto.trim()) >= 0);
    const pedidos = doTexto.length ? doTexto : daAcao;
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
      // Segunda convergência, rodada 2 (achado 15): a recusa do servidor à pergunta deste texto não é falta de sinal — a linha
      // sai recusada (com o porquê do servidor), não fica à espera de um sinal que não resolve; as pendentes da mesma pergunta
      // também.
      if (doTexto.length && doTexto.some(recusaDoServidor)) {
        const l = novas[0];
        const dom = v.linhas.find((x) => x.uid === l.uid) || { texto: '' };
        if (l.estado !== 'NAO_ENCONTRADO' || l.semPosicao || !l.recusada) falhar('lançar "' + texto + '" com a conferência recusada pelo servidor devia deixar a linha recusada, não à espera de sinal: ' + JSON.stringify([l.estado, !!l.semPosicao, !!l.recusada]));
        if (dom.texto.indexOf('recusada pelo servidor') < 0 || dom.texto.indexOf(MSG_RECUSA_RESOLVEDOR) < 0) falhar('a linha recusada pelo servidor não diz a recusa: "' + dom.texto + '"');
        const presas = v.c.linhas.filter((y) => y.estado === 'NAO_ENCONTRADO' && y.semPosicao && doTexto.some((r) => recusaDoServidor(r) && (r.textos || []).indexOf(String(y.texto || y.brinco).trim()) >= 0));
        if (presas.length) falhar('as pendentes ' + presas.map((y) => y.uid).join(', ') + ' foram na pergunta recusada pelo servidor e continuam à espera de sinal');
        conta('lancar:recusado');
      }
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
    // A linha pendente (sem resposta antes) que o servidor resolveu para o mesmo animal durante esta ação conta como já
    // existente: a resposta chegou antes da decisão (se chegasse depois, ela veria a linha nova e continuaria pendente).
    const resolvidaAgora = (l) => l.estado === 'NAO_ENCONTRADO' && v.c.linhas.some((y) => y.uid === l.uid && y.animal_id === X);
    if (c0.linhas.some(resolvidaAgora)) conta('lancar:pendenteResolvidaPelaConferencia');
    const c0b = Object.assign({}, c0, { linhas: c0.linhas.map((l) => (resolvidaAgora(l) ? Object.assign({}, l, { animal_id: X, estado: 'FILA', bloco: null }) : l)) });
    const ja = c0b.linhas.filter((l) => l.animal_id === X);
    if (tela === 'curral' && ja.length) {
      let ult = ja[ja.length - 1];
      let mudavel = editavel(c0b, ult) && ult.estado !== 'GRAVADA';
      if (!v.decisao) falhar('o repetido (' + texto + ') não pediu a decisão');
      let botao = mudavel ? 'Substituir o peso' : 'Pesar de novo';
      if (!(await page.isVisible('[data-decisao-repetido] ~ .acoes button:has-text("' + botao + '"), .curral-candidatos button:has-text("' + botao + '")'))) falhar('o repetido devia oferecer "' + botao + '"');
      if (rnd() < 0.25) { await page.click('.curral-candidatos button:has-text("Manter o anterior")'); await assentar(); v = await lerTela(page, tela); esperaSemLinha('com "Manter o anterior"'); conta('lancar:manter'); return; }
      // Revisão final da Fase 3 (achado 3): as respostas seguradas chegam com a pergunta na tela (o envio continua, a linha
      // anterior entra num bloco que sai ou é gravada). A decisão vale pelo estado da hora do clique: mudou, a pergunta é refeita
      // e nada muda; o operador decide de novo.
      if (rede.segurados.length && rnd() < 0.6) {
        log('  (as respostas seguradas chegam com a pergunta na tela)');
        rede.soltar(false);
        await assentar();
        const w0 = await lerTela(page, tela);
        // A recusa que chegou agora aparece antes de o operador decidir (a decisão pode desfazer o bloco com aviso).
        const rec0 = recusasNaTela(w0);
        if (rec0.length) falhar(rec0.join('\n  - '));
        const c1 = w0.c;
        const ult1 = c1.linhas.filter((l) => l.animal_id === X).pop() || null;
        const agora = mexivel(c1, ult1);
        if (!ult1 || ult1.uid !== ult.uid || agora !== mudavel) {
          const uids1 = JSON.stringify(c1.linhas.map((l) => [l.uid, l.estado, l.peso, l.bloco || null]));
          await page.click('.curral-candidatos button:has-text("' + botao + '")');
          await assentar();
          const w = await lerTela(page, tela);
          if (JSON.stringify(w.c.linhas.map((l) => [l.uid, l.estado, l.peso, l.bloco || null])) !== uids1) falhar('a decisão velha ("' + botao + '") mexeu nas linhas: ' + uids1 + ' → ' + JSON.stringify(w.c.linhas.map((l) => [l.uid, l.estado, l.peso, l.bloco || null])));
          if (!w.decisao || w.textoTodo.indexOf('mudou enquanto você decidia') < 0) falhar('a decisão velha ("' + botao + '") não refez a pergunta');
          ult = ult1; mudavel = agora; botao = mudavel ? 'Substituir o peso' : 'Pesar de novo';
          if (!(await page.isVisible('.curral-candidatos button:has-text("' + botao + '")'))) falhar('a pergunta refeita devia oferecer "' + botao + '"');
          conta('lancar:decisaoRefeita');
        }
      }
      if (mudavel && !/Substituir pelo peso novo/.test((await lerTela(page, tela)).decisaoTexto)) falhar('o repetido ainda do aparelho não avisa que o novo peso substitui o anterior');
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
      const subst = c0b.linhas.filter((l) => l.animal_id === X && l.estado !== 'GRAVADA' && editavel(c0b, l));
      if (subst.length) {
        const u = subst[subst.length - 1];
        if (novas.length) falhar('o diagnóstico repetido ainda não enviado devia substituir a linha ' + u.uid + ', e criou outra');
        // O aviso "o novo resultado substitui o anterior" aparece em todo caminho que substitui (nunca calado).
        if (v.textoTodo.indexOf('substituiu o anterior') < 0) falhar('o diagnóstico de ' + u.uid + ' foi substituído sem o aviso: "' + v.textoTodo.slice(0, 400) + '"');
        M.ordem = M.ordem.filter((x) => x !== u.uid).concat([u.uid]);
        M.linhas[u.uid].valor = val.valor;
        M.linhas[u.uid].texto = texto.trim();
        conta('lancar:substituir');
        return;
      }
    }
    // Na fila — ou já saindo, quando ela fechou o bloco de 20 (que sai sozinho).
    if (novas.length !== 1 || novas[0].animal_id !== X || novas[0].estado === 'NAO_ENCONTRADO') falhar('"' + texto + '" devia entrar na fila no animal ' + X + '; novas: ' + JSON.stringify(novas.map((l) => [l.uid, l.estado, l.animal_id])));
    add(novas[0].uid);
    conta('lancar:fila');
  }

  /** O lote passando depressa: de 6 a 24 animais do lote grande, um atrás do outro (o bloco cheio sai sozinho). */
  async function lote() {
    const n = 6 + Math.floor(rnd() * 19);
    const ini = Math.floor(rnd() * LOTE.length);
    log('lote de ' + n + ' a partir de ' + LOTE[ini]);
    for (let i = 0; i < n; i++) {
      const v0 = await lerTela(page, tela);
      if (v0.fase !== 'sessao') return;
      const texto = LOTE[(ini + i) % LOTE.length];
      const val = tela === 'curral' ? { texto: fmt1.format(300 + i).replace(/\./g, ''), valor: 300 + i } : { texto: i % 3 ? 'v' : 'p', valor: { resultado: i % 3 ? 'NEGATIVO' : 'POSITIVO', idade: null } };
      await lancarUm(texto, val, false, null, true);
    }
    conta('lote');
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
      // O brinco que volta ao campo é o texto digitado na linha (o da data da sessão), e a conferência mostra o animal daquele dia.
      if (t !== M.linhas[l.uid].texto) falhar('"Corrigir o resultado" de ' + l.uid + ' pôs "' + t + '" no brinco; o operador digitou "' + M.linhas[l.uid].texto + '"');
      await olharConferencia(t);
      await page.fill(cfg.valor, 'v');
      await page.press(cfg.valor, 'Enter');
      await assentar();
      const w = await lerTela(page, tela);
      if (t && w.c.linhas.some((y) => y.uid === l.uid && y.resultado === 'NEGATIVO') && w.textoTodo.indexOf('substituiu o anterior') < 0) falhar('"Corrigir o resultado" de ' + l.uid + ' substituiu o diagnóstico sem o aviso');
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
    // Segunda convergência, rodada 1 (achado 12): metade das vezes, o brinco de outra linha da sessão (o mesmo animal duas vezes).
    const outros = c.linhas.filter((y) => y.uid !== l.uid && y.animal_id && M.linhas[y.uid]).map((y) => M.linhas[y.uid].texto);
    const t = outros.length && rnd() < 0.5 ? um(rnd, outros) : sortearTexto();
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
    // Segunda convergência, rodada 2 (achado 15): a recusa do servidor ao "Corrigir o brinco" se diz recusa, com o caminho.
    if (pedidos.some(recusaDoServidor)) {
      if (v.textoTodo.indexOf('O servidor recusou a conferência do brinco') < 0 || /Corrija com sinal/.test(v.textoTodo)) falhar('"Corrigir o brinco" recusado pelo servidor não disse a recusa (ou disse "sem resposta")');
      if (r && r.estado !== 'NAO_ENCONTRADO') falhar('"Corrigir o brinco" recusado pelo servidor mudou a linha para ' + r.estado);
      conta('corrigirBrinco:recusado');
    }
    const rr = resolverModelo(t, M.sessao.data);
    // A mesma regra do repetido de todo caminho: outra linha do mesmo animal ainda do aparelho barra (a linha não muda); a que
    // já saiu deixa entrar com o aviso de pesar de novo.
    const outraMexivel = rr.situacao === 'ACHADO' && c.linhas.some((y) => y.uid !== l.uid && y.animal_id === rr.animal_id && mexivel(c, y));
    const outraSaiu = rr.situacao === 'ACHADO' && c.linhas.some((y) => y.uid !== l.uid && y.animal_id === rr.animal_id && !mexivel(c, y));
    if (outraMexivel) conta('corrigirBrinco:barrado');
    if (r && (r.estado === 'FILA' || r.estado === 'AVISO')) {
      if (outraMexivel) falhar('"Corrigir o brinco" para "' + t + '" pôs na fila uma segunda linha do animal ' + rr.animal_id + ', que já tem outra ainda do aparelho');
      if (r.estado === 'AVISO' && !outraSaiu) falhar('"Corrigir o brinco" para "' + t + '" pôs a linha com aviso sem outra pesagem do animal que já saiu');
      if (outraSaiu) conta('corrigirBrinco:pesarDeNovo');
      M.linhas[l.uid].texto = t;
    } else if (!semResposta && rr.situacao === 'ACHADO' && !rr.inelegivel && !outraMexivel) falhar('"Corrigir o brinco" para "' + t + '" (achado e no rebanho) não pôs a linha na fila: ' + JSON.stringify(r));
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
    if (v.enviar && v.enviar.desabilitado && v.c.linhas.some((l) => l.estado === 'NAO_ENCONTRADO' || l.estado === 'ERRO')) {
      // A pendência impede o envio: o operador resolve uma (corrige o brinco ou tira a linha) para poder enviar.
      if (tela === 'curral' && rnd() < 0.4 && await corrigirBrinco(v.c)) return true;
      const pend = v.c.linhas.filter((l) => l.estado === 'NAO_ENCONTRADO' || l.estado === 'ERRO');
      const l = um(rnd, pend);
      log('tirar a pendência ' + l.uid + ' para enviar');
      await page.click('[data-linha="' + l.uid + '"] button:has-text("Tirar")');
      M.ordem = M.ordem.filter((u) => u !== l.uid);
      M.tiradas.add(l.uid);
      conta('tirarParaEnviar');
      return true;
    }
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
    // Revisão final da Fase 3 (achado 7): às vezes o operador conferiu um brinco (Enter) sem lançar antes de mudar a sessão.
    const conferido = rnd() < 0.5 ? sortearTexto() : null;
    // A resposta da conferência às vezes ainda está no ar quando a sessão muda (chega depois, na sessão nova).
    const segurada = conferido && rnd() < 0.4;
    if (segurada) rede.falhas.unshift({ classe: 'resolver', tipo: 'segurar' });
    if (conferido) { log('conferir "' + conferido + '" sem lançar' + (segurada ? ' (a resposta fica no ar)' : '')); await page.fill(cfg.brinco, conferido); await page.press(cfg.brinco, 'Enter'); await assentar({ semConferencia: segurada }); }
    // A conferência que já estava guardada no aparelho não vai ao servidor: a falha de rede que sobrou não vale para depois.
    rede.falhas = rede.falhas.filter((f) => !(f.classe === 'resolver' && f.tipo === 'segurar'));
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
    if (segurada) {
      // A resposta velha chega na sessão nova: a conferência dela não aparece (era de outra sessão); o animal de cada linha
      // continua o do texto na data da sessão nova (o oráculo confere na verificação desta ação).
      rede.segurados.filter((x) => x.reg.rota === 'animal.resolver').forEach((x) => { rede.segurados.splice(rede.segurados.indexOf(x), 1); x.soltar(); });
      await assentar();
      const w = await lerTela(page, tela);
      if (w.conferenciaTipo) falhar('a conferência de "' + conferido + '" da sessão de antes apareceu na sessão nova: "' + w.conferenciaTexto + '"');
      conta('mudar:respostaVelha');
    }
    if (conferido) {
      // O valor digitado na sessão nova, sem brinco: nada entra (a conferência de antes era de outra sessão).
      await assentar();
      const antes = (await lerTela(page, tela)).c.linhas.map((l) => l.uid);
      await page.fill(cfg.valor, tela === 'curral' ? '300' : 'v');
      await page.press(cfg.valor, 'Enter');
      await assentar();
      const depois = (await lerTela(page, tela)).c.linhas.map((l) => l.uid);
      if (JSON.stringify(antes) !== JSON.stringify(depois)) falhar('o valor lançado na sessão nova sem brinco usou o animal conferido antes de mudar: ' + JSON.stringify(depois));
      await page.fill(cfg.valor, '');
      conta('mudar:conferidoAntes');
      // E o mesmo brinco digitado de novo na sessão nova é conferido na data nova (o animal pode ser outro).
      if (rnd() < 0.5) { log('  lançar "' + conferido + '" de novo na sessão nova'); await lancarUm(conferido, sortearValorValido(), false, null, true); conta('mudar:conferidoDeNovo'); }
    }
    return true;
  }
  /** Sem localStorage, o rascunho adiado (1 s) chega ao servidor antes de a página ir embora (o operador não recarrega no mesmo instante). */
  async function assentarRascunho() {
    if (!semLS) return;
    rede.falhas = rede.falhas.filter((f) => f.classe !== 'rascunho');
    if (rede.segurados.some((x) => /^rascunho\./.test(x.reg.rota))) { rede.soltar(false); await assentar(); }
    await avancar(1500);
    await assentar();
    // O que falhou vai de novo sozinho (5 s depois); a resposta perdida vence em 45 s.
    for (let i = 0; i < 4; i++) {
      const v0 = await lerTela(page, tela);
      const st = v0.situacaoRascunho;
      if (!st || st.estado === 'GUARDADO') break;
      if (rede.segurados.length) { rede.soltar(false); await assentar(); }
      await avancar(i < 2 ? 6000 : 46000);
      await assentar();
    }
    // Sem localStorage, o rascunho no servidor é o estado da tela (recarregar não perde nada).
    const v = await lerTela(page, tela);
    anotarChaves(v.c);
    // Segunda convergência, rodada 1 (achado 14): com o servidor de volta, nada fica preso — nem a falha só do índice.
    if (v.situacaoRascunho && v.situacaoRascunho.estado === 'FALHOU') falhar('com o servidor de volta, o rascunho continua com a falha (' + ((v.situacaoRascunho.erro || {}).message || '') + ') e não vai de novo');
    if (v.fase === 'sessao' && v.c) {
      const r = rascunhoServidor();
      if (!r) falhar('sem localStorage, a sessão não está guardada no servidor');
      if (essencialRascunho(r) !== essencialRascunho(v.c)) falhar('o rascunho guardado no servidor não é o estado da tela:\n   servidor ' + essencialRascunho(r) + '\n   na tela  ' + essencialRascunho(v.c));
      // O índice do servidor (o Início lista os rascunhos por ele) tem o rascunho da sessão.
      const ix = s.api({ rota: 'rascunho.obter', dados: { chave: 'indice' } });
      if (!ix.ok || !ix.data.existe || !(ix.data.conteudo || []).some((x) => x.id === cfg.rascunho)) falhar('o índice dos rascunhos no servidor não lista a sessão do ' + tela + ': ' + JSON.stringify(ix.ok ? ix.data.conteudo : ix.error).slice(0, 300));
      conta('rascunho:servidorConferido');
    }
  }
  async function recarregar(semLog) {
    if (!semLog) log('recarregar a página');
    await assentarRascunho();
    rede.largar(rnd);
    await page.reload();
    await A.esperarTela(page, cfg.titulo);
    conta('recarregar');
    return true;
  }
  /**
   * O operador digita de novo o brinco de uma linha que já está na sessão — a pendente sem sinal (resolvida agora pela mesma
   * conferência, ou barrada por outra linha do mesmo animal), a que está num bloco no ar, gravado, recusado ou com aviso: a
   * decisão do repetido vale pelo estado da linha anterior (substituir só a que ainda é do aparelho, sempre com o aviso).
   */
  async function repetir(c) {
    const pend = c.linhas.filter((l) => l.estado === 'NAO_ENCONTRADO' && l.semPosicao);
    const cands = pend.length && rnd() < 0.7 ? pend : c.linhas;
    if (!cands.length) return false;
    const l = um(rnd, cands);
    const m = M.linhas[l.uid];
    if (!m) return false;
    const b = l.bloco ? blocoDe(c, l.bloco) : null;
    conta('repetir:' + (l.semPosicao && l.estado === 'NAO_ENCONTRADO' ? 'pendente' : b ? 'bloco ' + b.estado : l.estado));
    log('repetir o brinco de ' + l.uid + ' ("' + m.texto + '", ' + l.estado + (b ? ', bloco ' + b.estado : '') + ')');
    let val = sortearValor();
    if (val.valor === null) val = tela === 'curral' ? { texto: '333', valor: 333 } : { texto: 'v', valor: { resultado: 'NEGATIVO', idade: null } };
    await lancarUm(m.texto, val, false, null, true);
    return true;
  }
  /**
   * Sem localStorage, a página vai embora de repente (o aparelho trava ou a aba é descartada) com o rascunho no servidor
   * falhando: o que não chegou ao servidor se perde, mas nada que saiu para o servidor fica sem a chave (o bloco só sai com a
   * chave guardada; CONTRATOS, seção 52) — nada grava duas vezes nem fica gravado sem aparecer. O modelo adota o rascunho do
   * servidor (lido fora da rede da página) e confere que a tela recarregada é ele.
   */
  async function recarregarBrusco() {
    if (!semLS) return false;
    log('a página vai embora de repente (o rascunho no servidor falha ao sair)');
    // A página nova lê o rascunho do servidor (a falha que sobrou na fila não vale para ela).
    rede.falhas = rede.falhas.filter((f) => f.classe !== 'rascunho');
    rede.rascunhoBloqueado = true;
    rede.largar(rnd);
    try {
      await page.reload();
      await A.esperarTela(page, cfg.titulo);
    } finally { rede.rascunhoBloqueado = false; }
    await assentar();
    const r = rascunhoServidor();
    const v = await lerTela(page, tela);
    const uids = r ? r.linhas.map((l) => l.uid) : [];
    if (v.fase === 'sessao' && JSON.stringify(v.c.linhas.map((l) => l.uid)) !== JSON.stringify(uids)) falhar('a tela recarregada não é o rascunho do servidor: ' + JSON.stringify(v.c.linhas.map((l) => l.uid)) + ' × ' + JSON.stringify(uids));
    let perdidas = 0;
    M.ordem.forEach((u) => { if (uids.indexOf(u) < 0) { M.tiradas.add(u); perdidas += 1; } });
    (r ? r.linhas : []).forEach((l) => {
      M.tiradas.delete(l.uid);
      const valor = tela === 'curral' ? l.peso : { resultado: l.resultado, idade: l.idade || null };
      M.linhas[l.uid] = Object.assign(M.linhas[l.uid] || {}, { texto: String(l.texto || l.brinco).trim(), valor });
    });
    M.ordem = uids;
    if (r && r.sessao) M.sessao = r.sessao;
    // A confirmação que não chegou ao rascunho do servidor volta a ser incerta (o bloco gravado que o rascunho ainda diz
    // "enviando" é conferido de novo pela chave): o que vale para o bloco que saiu passa a ser o estado do rascunho.
    (r ? r.blocos : []).forEach((b) => { if (M.saiu[b.chave] && saiu(b)) M.saiu[b.chave] = b.estado; });
    if (perdidas) conta('recargaBrusca:perdeu');
    conta('recargaBrusca');
    return true;
  }
  async function sairEVoltar() {
    log('sair e voltar');
    await assentarRascunho();
    await A.ir(page, cfg.fora, cfg.foraTitulo);
    if (rnd() < 0.5) await assentar();
    await A.ir(page, cfg.hash, cfg.titulo);
    conta('sairVoltar');
    return true;
  }
  async function terminar(v, o) {
    await assentarRascunho();
    v = await lerTela(page, tela);
    anotarChaves(v.c);
    // A resposta que chegou enquanto o rascunho assentava aparece antes de o operador decidir terminar.
    const rec = recusasNaTela(v);
    if (rec.length) falhar(rec.join('\n  - '));
    const c = v.c;
    const incertas = c.linhas.some((l) => l.estado === 'SEM_SINAL' || l.estado === 'ENVIANDO');
    const naoGravadas = c.linhas.filter((l) => l.estado !== 'GRAVADA');
    log('terminar' + (incertas ? ' (com incertas: deve recusar)' : naoGravadas.length ? ' (com ' + naoGravadas.length + ' não gravadas)' : ''));
    // Rodada 2 da segunda convergência (achado 14): sem localStorage, o rascunho do servidor é apagado ao terminar — a remoção
    // que falha (o transporte, a falha interna) não pode terminar a sessão: a que voltasse do rascunho enviaria o descartado.
    const removeFalha = !(o && o.semFalha) && semLS && !incertas && rnd() < 0.3;
    if (removeFalha) { rede.falhas.push({ classe: 'rascunho', tipo: um(rnd, ['transporte', 'interna']), rota: 'rascunho.remover' }); log('rede: a remoção do rascunho no servidor falha'); }
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
      if (rnd() < 0.4) { if (removeFalha) rede.falhas.splice(rede.falhas.findIndex((f) => f.rota === 'rascunho.remover'), 1); await page.click('[role=dialog] button:has-text("Voltar")'); conta('terminar:voltou'); return true; }
      await page.click('[role=dialog] button:has-text("Descartar e terminar")');
      naoGravadas.forEach((l) => M.descartadas.add(l.uid));
    }
    await assentar();
    if (removeFalha) {
      const x = await lerTela(page, tela);
      if (x.fase === 'resultado') falhar('"Terminar" mostrou o resultado sem o servidor confirmar que apagou o rascunho (a sessão voltaria com o descartado)');
      if (!/não terminou: o servidor não confirmou que apagou o rascunho/.test(x.textoTodo)) falhar('"Terminar" sem a remoção confirmada e sem dizer por quê');
      if (x.faixaRascunho && !/Não foi possível apagar o rascunho no servidor/.test(x.textoTodo)) falhar('a faixa da remoção que falhou diz outra coisa: ' + x.textoTodo.slice(0, 300));
      // O descarte não valeu: as linhas continuam na sessão.
      naoGravadas.forEach((l) => M.descartadas.delete(l.uid));
      conta('terminar:remoção sem confirmação (avisada, a sessão continua)');
      return true;
    }
    await page.waitForSelector(cfg.resultado);
    const w = await lerTela(page, tela);
    if (semLS && rascunhoServidor()) falhar('terminou, mas o rascunho continua no servidor (a sessão voltaria com o descartado)');
    if (semLS) conta('terminar: rascunho do servidor apagado');
    const grav = c.linhas.filter((l) => l.estado === 'GRAVADA').length;
    if (w.resultadoN !== grav) falhar('o resultado diz ' + w.resultadoN + ' gravadas; a sessão tinha ' + grav);
    if (w.rascunho) falhar('o rascunho continua no aparelho depois de terminar');
    fecharSessao(c);
    conta('terminar');
    return true;
  }
  /** A sessão terminada: as linhas dela saem da tela; as gravadas ficam no modelo com o cabeçalho para a conferência do banco. */
  function fecharSessao(c) {
    M.saiu = {};
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
    const classe = semLS && rnd() < 0.3 ? 'rascunho' : ponderado(rnd, [[6, 'registrar'], [4, 'resolver'], [2, 'status']]);
    // O rascunho no servidor que demora (gravado lá, a resposta segurada): o bloco sai depois que ele responde.
    // Ou falha (o transporte, a falha interna, o servidor ocupado, a resposta perdida depois de gravar ou o pedido perdido): o
    // bloco que ia sair sem a chave guardada não sai (CONTRATOS, seção 52), e a tela avisa.
    if (classe === 'rascunho') {
      // Segunda convergência, rodada 1 (achados 5 e 14): o pedido do rascunho que chega ao servidor DEPOIS dos mais novos
      // (`segurarAntes`: o aparelho desiste dele aos 45 s e ele chega quando for solto) e a falha só no índice (entre os dois
      // pedidos do mesmo envio).
      const tr = ponderado(rnd, [[4, 'segurar'], [3, 'segurarAntes'], [3, 'transporte'], [2, 'interna'], [1, 'ocupado'], [1, 'perdeDepois'], [1, 'perdeAntes']]);
      const soIndice = tr !== 'segurar' && tr !== 'segurarAntes' && rnd() < 0.3;
      const n2 = rnd() < 0.5 ? 1 : 3;
      for (let i = 0; i < n2; i++) rede.falhas.push(soIndice ? { classe, tipo: tr, rota: 'rascunho.salvar', chave: 'indice' } : { classe, tipo: tr });
      log('rede: os próximos ' + n2 + ' rascunhos ' + (soIndice ? '(só o índice) ' : '') + 'no servidor → ' + tr);
      conta(tr === 'segurar' ? 'rede:rascunhoSegurado' : 'rede:rascunho:' + tr + (soIndice ? ':indice' : ''));
      return true;
    }
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
    await avancar(ms);
    conta('tempo');
    return true;
  }
  /** Outro usuário grava no mesmo banco: o mesmo animal no mesmo dia, ou uma morte (o servidor recusa o envio dela). */
  async function outroUsuario() {
    const vivos = [sis.ids.v520, sis.ids.v611, sis.ids.v815, sis.ids.vacaB].filter((x) => !M.mortos.has(x));
    if (!vivos.length || !M.sessao) return false;
    const x = um(rnd, vivos);
    M.tocados.add(x);
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
      rede.acao = k;
      // Nada espera o tempo real: a resposta segurada há 6 ações chega, e a perdida há 6 ações vence o prazo (o operador esperou).
      if (rede.segurados.some((x) => k - x.reg.acao >= 6)) { log('(a resposta segurada chega)'); rede.soltar(false); }
      if (rede.log.some((r) => r.perdidaAberta && k - r.acao >= 6)) { log('(o prazo da resposta perdida vence)'); await avancar(46000); }
      await assentar();
      const v = await lerTela(page, tela);
      anotarChaves(v.c);
      rotulo = historico.length;
      // A recusa que chegou com o tempo andando (antes da ação) aparece antes de o operador mexer.
      const rec = recusasNaTela(v);
      if (rec.length) falhar(rec.join('\n  - '));
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
        const temAviso = v.avisoGeral || v.linhas.some((l) => l.estado === 'AVISO');
        const temErro = v.linhas.some((l) => l.estado === 'ERRO' || l.estado === 'NAO_ENCONTRADO');
        const acao = ponderado(rnd, [[30, 'lancar'], [3, 'lote'], [5, 'desfazer'], [4, 'tirar'], [temErro || temAviso ? 8 : 1, 'corrigir'], [temErro ? 5 : 1, 'corrigirBrinco'], [temAviso ? 15 : 1, 'aceitar'], [16, 'enviar'], [4, 'mudar'], [3, 'terminar'], [4, 'recarregar'], [3, 'sair'], [10, 'rede'], [rede.segurados.length ? 10 : 1, 'soltar'], [5, 'tempo'], [2, 'outro'], [v.resolverPendentes || v.posicaoTentar ? 8 : 1, 'pendentes'], [v.c.linhas.length ? 6 : 0, 'repetir'], [semLS ? 2 : 0, 'recarregarBrusco'], [3, 'semSinal']]);
        if (acao === 'lancar') { await lancar(); feito = true; }
        else if (acao === 'lote') { await lote(); feito = true; }
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
        else if (acao === 'repetir') feito = await repetir(v.c);
        else if (acao === 'recarregarBrusco') feito = await recarregarBrusco();
        else if (acao === 'semSinal') {
          // Segunda convergência, rodada 2 (achado 15): às vezes não é o sinal que cai — o servidor recusa a conferência (a data
          // que ele não aceita), e repetir não muda a resposta.
          if (rnd() < 0.25) { rede.falhas.push({ classe: 'resolver', tipo: 'recusa' }); log('rede: o servidor recusa a próxima conferência de brinco'); conta('rede:recusaResolvedor'); }
          else { const n3 = 2 + Math.floor(rnd() * 3); for (let i = 0; i < n3; i++) rede.falhas.push({ classe: 'resolver', tipo: 'transporte' }); log('rede: o sinal cai para as próximas ' + n3 + ' conferências de brinco'); conta('rede:semSinal'); }
          feito = true;
        }
        else if (acao === 'pendentes') {
          if (v.resolverPendentes) { log('conferir os brincos pendentes'); await conferirPendentes(); feito = true; conta('pendentes'); }
          else if (v.posicaoTentar) { log('tentar de novo (posição)'); await page.click('[data-posicao-tentar]'); feito = true; conta('posicaoTentar'); }
        }
      }
      if (rnd() < 0.15) { await esperarLongo(); await verificar({ preso: true }); } else await verificar();
    }
    // ---- o fim: a rede boa, tudo resolvido, enviado e terminado.
    rotulo = 'fim';
    log('== fim: a rede volta');
    rede.limpar();
    for (let i = 0; i < 200; i++) {
      await esperarLongo();
      let v = await verificar({ preso: true });
      if (v.fase === 'inicio') { if (!M.ordem.length) break; const nova = M.sessao || sortearSessao(); await preencherInicio(nova); M.sessao = nova; continue; }
      if (v.fase === 'resultado') break;
      const c = v.c;
      if (c.linhas.every((l) => l.estado === 'GRAVADA')) break;
      if (v.avisoGeral) { log('fim: "Está certo (todo o lançamento)"'); await page.click('[data-aceitar-geral] >> nth=0'); continue; }
      const av = v.linhas.find((l) => l.estado === 'AVISO' && l.botoes.indexOf('Está certo') >= 0);
      if (av) { log('fim: "Está certo" em ' + av.uid); await page.click('[data-linha="' + av.uid + '"] button:has-text("Está certo")'); continue; }
      if (v.resolverPendentes && (M.pendentesConferidos || 0) < 3) { log('fim: conferir os brincos pendentes'); M.pendentesConferidos = (M.pendentesConferidos || 0) + 1; await page.click('[data-resolver-pendentes]'); continue; }
      if (v.posicaoTentar && !M.posicaoTentada) { M.posicaoTentada = true; log('fim: tentar de novo (posição)'); await page.click('[data-posicao-tentar]'); continue; }
      const pend = c.linhas.find((l) => l.estado === 'NAO_ENCONTRADO');
      if (pend) {
        const m = M.linhas[pend.uid];
        const rr = resolverModelo(m.texto, c.sessao.data);
        const outra = rr.animal_id && c.linhas.some((l) => l.uid !== pend.uid && l.animal_id === rr.animal_id);
        // A recusada pelo servidor saiu da espera (achado 15): com a rede de volta, ela não se resolve sozinha — o operador a tira
        // (ou corrige o brinco, ou muda a data). Só a recusa que aconteceu (a simulada) a explica.
        const recusada = !!pend.recusada && (pend.mensagem || '').indexOf(MSG_RECUSA_RESOLVEDOR) >= 0;
        if (pend.recusada && !recusada) falhar('a linha ' + pend.uid + ' ("' + m.texto + '") está "recusada pelo servidor" sem a recusa ter acontecido: ' + (pend.mensagem || ''));
        if (rr.situacao === 'ACHADO' && !rr.inelegivel && !outra && !recusada) falhar('a linha ' + pend.uid + ' ("' + m.texto + '") ficou pendente, e em ' + c.sessao.data + ' o servidor acha o animal ' + rr.animal_id + ' no rebanho: ' + (pend.mensagem || ''));
        if (recusada) conta('fim:recusadaTirada');
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
      if (c.erroGeral && v.mudar && !c.linhas.some((l) => l.estado === 'GRAVADA')) {
        // A recusa geral (a data antes do marco zero): o operador muda a data da sessão.
        const nova = Object.assign({}, c.sessao, { data: um(rnd, [HOJE, '2026-11-12', '2026-11-04']) });
        log('fim: a recusa geral ("' + c.erroGeral + '"): mudar a data para ' + nova.data);
        await page.click(cfg.mudar);
        await page.waitForSelector(cfg.inicio);
        await preencherInicio(nova);
        M.sessao = nova;
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
      // A remoção do rascunho que falhou no "Terminar" deixa a sessão aberta: com sinal, terminar de novo.
      const w2 = await lerTela(page, tela);
      if (w2.fase === 'sessao') { rotulo = 'terminar no fim (de novo, com sinal)'; await terminar(w2, { semFalha: true }); }
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
    // Sem localStorage, o aviso de que o armazenamento do aparelho não está disponível é esperado (o rascunho vai ao servidor).
    // E a falha registrada da gravação do rascunho no servidor que a rede do teste segurou além do prazo (a faixa avisa o operador).
    // E a remoção do rascunho que falhou no "Terminar" (seção 54: a tela diz que não terminou).
    const errosConsole = a.estado.erros.filter((x) => !(semLS && /armazenamento local indisponível|\[ERP\] rascunho no servidor( ao sair)?: |\[ERP\] remover o rascunho do (curral|tronco): /.test(x)));
    if (errosConsole.length) falhar('erros no console: ' + errosConsole.join(' | '));
    cont.gravadas = (cont.gravadas || 0) + gravadas.size;
    cont.sementes = (cont.sementes || 0) + 1;
    cont['tela:' + tela] = (cont['tela:' + tela] || 0) + 1;
  } catch (err) {
    const ultimos = rede.log.slice(-Number(process.env.FUZZ_ULTIMOS || 8)).map((r) => r.rota + (r.chave ? ' ' + r.chave.slice(0, 15) : '') + (r.falha ? ' [' + r.falha + ']' : '') + ' → ' + (r.entregue ? (r.resposta.ok ? 'ok' : r.resposta.error.code + ': ' + r.resposta.error.message) : 'não entregue'));
    err.message = 'semente ' + semente + ' (' + tela + '), ação ' + k + ' [' + rotulo + ']: ' + err.message + '\n  ações:\n    ' + historico.join('\n    ') + '\n  últimos pedidos:\n    ' + ultimos.join('\n    ');
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
