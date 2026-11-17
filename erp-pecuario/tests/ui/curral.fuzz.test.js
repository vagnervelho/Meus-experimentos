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
 * `npm run ui:check` roda as sementes fixas (poucas). FUZZ_SEMENTES=N roda N sementes a partir de FUZZ_INICIO (padrão 1);
 * FUZZ_ACOES muda as ações por semente (padrão 40); FUZZ_TELA=curral|tronco fixa a tela; FUZZ_LOG=1 imprime cada ação.
 */
const test = require('node:test');
const A = require('./apoio');
const {
  HOJE, RELOGIO, ROTULO_RES, LOTE, T, gerador, um, ponderado, esperarMs, fmt1, kg, montarSistema, novaRede, lerTela,
} = require('./apoio-curral');

const { S } = A;
test.after(() => A.fecharBrowser());

const N_ACOES = Number(process.env.FUZZ_ACOES || 40);
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
  const semLS = o.semLocalStorage !== undefined ? !!o.semLocalStorage : gerador(semente * 104729 + 3)() < 0.25;
  const a = await A.abrir(s, { largura: 360, hash: cfg.hash, relogio: RELOGIO, servidor: rede.servidor, semLocalStorage: semLS });
  const { page } = a;
  const historico = [];
  const log = (t) => { historico.push(t); if (process.env.FUZZ_LOG) console.log('  [' + semente + '] ' + t); };
  const cont = o.contadores || {};
  const conta = (k) => { cont[k] = (cont[k] || 0) + 1; };

  // O modelo: as linhas (uid → texto, valor), a ordem, o cabeçalho, as tiradas e as descartadas, as chaves de cada bloco visto.
  const M = { sessao: null, ordem: [], linhas: {}, tiradas: new Set(), descartadas: new Set(), chaves: {}, sessoes: [], versaoOutro: 0, mortos: new Set(), saiu: {} };
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
  const falhar = (msg) => { throw new Error(msg); };
  /** O relógio da página anda (os prazos do aparelho vencem; o que estava segurado nesse tempo chega atrasado). */
  async function avancar(ms) { rede.passou(ms); await page.clock.fastForward(ms); }

  /** Espera a tela parar: todo pedido respondido (menos os segurados de propósito) e nenhuma conferência no ar. */
  async function assentar() {
    let quietas = 0;
    let presa = 0;
    for (let i = 0; i < 2000; i++) {
      const st = await page.evaluate((sel) => ({ em: window.__gas ? window.__gas.emCurso : 0, conf: /Conferindo/.test((document.querySelector(sel) || {}).textContent || '') }), cfg.conferencia);
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
      const essencial = (x) => JSON.stringify({ sessao: x.sessao, linhas: x.linhas.map((l) => [l.uid, l.estado, l.animal_id, l.peso, l.resultado, l.idade || null, l.bloco || null]), blocos: x.blocos.map((b) => [b.chave, b.estado, b.uids, b.campos, b.reenviar || false]) });
      // Sem localStorage o rascunho vai ao servidor adiado (1 s) — a conferência dele é a da recarga (nada perdido).
      if (!semLS && !r) e('a sessão não está guardada no aparelho');
      else if (!semLS && essencial(r) !== essencial(c)) e('o rascunho guardado não é o estado da tela:\n   guardado ' + essencial(r) + '\n   na tela  ' + essencial(c));
      // Revisão final da Fase 3 (achados 3 e 4): o bloco que saiu é intocável no aparelho — nenhuma linha dele oferece mexer
      // ("Tirar", "Corrigir", "Está certo"), a sessão não muda ("Mudar" some), e ele só deixa a sessão por uma recusa do
      // servidor que prova que a chave não foi gravada (VALIDATION, CONFLICT) ou pela chave já gravada (IDEMPOTENCY_MISMATCH).
      c.linhas.forEach((l) => {
        const b = l.bloco ? blocoDe(c, l.bloco) : null;
        const dom = v.linhas.find((x) => x.uid === l.uid) || { botoes: [] };
        if (saiu(b)) ['Tirar', 'Corrigir o peso', 'Corrigir o resultado', 'Está certo'].forEach((t) => { if (dom.botoes.indexOf(t) >= 0) e('a linha ' + l.uid + ' está num bloco que saiu (' + b.estado + ') e a tela oferece "' + t + '"'); });
      });
      const algumSaiu = c.blocos.some(saiu);
      if (v.mudar === algumSaiu) e('"Mudar" ' + (v.mudar ? 'aparece com' : 'some sem') + ' bloco que saiu: ' + JSON.stringify(c.blocos.map((b) => b.estado)));
      Object.keys(M.saiu).forEach((k) => {
        const b = blocoDe(c, k);
        const antes = M.saiu[k];
        if (b && saiu(b)) { if (antes === 'GRAVADO' && b.estado !== 'GRAVADO') e('o bloco ' + k + ' estava gravado e agora está ' + b.estado); return; }
        // Deixou de "ter saído" (desfeito, ou com aviso ou recusa): só a resposta do servidor que prova que a chave não foi
        // gravada (o aviso, VALIDATION, CONFLICT) ou a chave já gravada (IDEMPOTENCY_MISMATCH) o explica.
        const provou = rede.log.some((x) => x.chave === k && x.entregue && !x.resposta.ok && ['NEEDS_CONFIRMATION', 'VALIDATION', 'CONFLICT', 'IDEMPOTENCY_MISMATCH'].indexOf(x.resposta.error.code) >= 0);
        if (!provou) e('o bloco ' + k + ' saiu (' + antes + ') e o aparelho ' + (b ? 'o pôs em ' + b.estado : 'o desfez') + ' sem a resposta do servidor');
        delete M.saiu[k];
      });
      c.blocos.forEach((b) => { if (saiu(b)) { M.saiu[b.chave] = b.estado; conta('bloco que saiu conferido'); } });
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
    if (rnd() < 0.8) await page.press(cfg.brinco, 'Enter');
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
    // A linha pendente (sem resposta antes) que o servidor resolveu para o mesmo animal durante esta ação conta como já
    // existente: a resposta chegou antes da decisão (se chegasse depois, ela veria a linha nova e continuaria pendente).
    const resolvidaAgora = (l) => l.estado === 'NAO_ENCONTRADO' && v.c.linhas.some((y) => y.uid === l.uid && y.animal_id === X);
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
    const conferido = rnd() < 0.3 ? sortearTexto() : null;
    if (conferido) { log('conferir "' + conferido + '" sem lançar'); await page.fill(cfg.brinco, conferido); await page.press(cfg.brinco, 'Enter'); await assentar(); }
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
  async function sairEVoltar() {
    log('sair e voltar');
    await assentarRascunho();
    await A.ir(page, cfg.fora, cfg.foraTitulo);
    if (rnd() < 0.5) await assentar();
    await A.ir(page, cfg.hash, cfg.titulo);
    conta('sairVoltar');
    return true;
  }
  async function terminar(v) {
    await assentarRascunho();
    v = await lerTela(page, tela);
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
    const classe = semLS && rnd() < 0.3 ? 'rascunho' : ponderado(rnd, [[6, 'registrar'], [3, 'resolver'], [2, 'status']]);
    // O rascunho no servidor que demora (gravado lá, a resposta segurada): o bloco sai depois que ele responde.
    if (classe === 'rascunho') { const n2 = rnd() < 0.5 ? 1 : 3; for (let i = 0; i < n2; i++) rede.falhas.push({ classe, tipo: 'segurar' }); log('rede: os próximos ' + n2 + ' rascunhos no servidor demoram (segurados)'); conta('rede:rascunhoSegurado'); return true; }
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
        const acao = ponderado(rnd, [[30, 'lancar'], [3, 'lote'], [5, 'desfazer'], [4, 'tirar'], [temErro || temAviso ? 8 : 1, 'corrigir'], [temErro ? 5 : 1, 'corrigirBrinco'], [temAviso ? 15 : 1, 'aceitar'], [16, 'enviar'], [3, 'mudar'], [3, 'terminar'], [4, 'recarregar'], [3, 'sair'], [10, 'rede'], [rede.segurados.length ? 10 : 1, 'soltar'], [5, 'tempo'], [2, 'outro'], [v.resolverPendentes || v.posicaoTentar ? 8 : 1, 'pendentes']]);
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
        if (rr.situacao === 'ACHADO' && !rr.inelegivel && !outra) falhar('a linha ' + pend.uid + ' ("' + m.texto + '") ficou pendente, e em ' + c.sessao.data + ' o servidor acha o animal ' + rr.animal_id + ' no rebanho: ' + (pend.mensagem || ''));
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
    const errosConsole = a.estado.erros.filter((x) => !(semLS && /armazenamento local indisponível|\[ERP\] rascunho no servidor: /.test(x)));
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
