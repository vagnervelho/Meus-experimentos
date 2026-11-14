#!/usr/bin/env node
'use strict';
/**
 * Gera src/Schema.js a partir dos dicionários de dados da Fase 0, que são a fonte de verdade:
 *   docs/fase-0/03a-dicionario-cadastros-suporte.md  (convenções, enums, listas, cadastros, suporte, sementes)
 *   docs/fase-0/03b-dicionario-eventos-financeiro.md (eventos, detalhes, financeiro)
 * e confere o resultado contra a lista de colunas da seção 3 de docs/fase-0/00-desenho-base.md.
 *
 * Uso: npm run gen:schema            grava src/Schema.js
 *      npm run gen:schema -- --check só confere: sai com código 1 se o arquivo gravado estiver desatualizado
 *
 * O gerador falha, com mensagem que aponta o documento, quando: não acha as 34 abas; uma aba fica sem
 * colunas; as colunas divergem do desenho-base; uma coluna ENUM não tem enum; uma FK aponta para coluna
 * inexistente; uma semente usa valor fora do enum. Nada é completado "no olho".
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs', 'fase-0');
const ARQ_BASE = '00-desenho-base.md';
const ARQ_A = '03a-dicionario-cadastros-suporte.md';
const ARQ_B = '03b-dicionario-eventos-financeiro.md';
const SAIDA = path.join(ROOT, 'src', 'Schema.js');

/** Versão do esquema (SCHEMA_META.versao) e do conjunto de sementes. Sobem quando os dicionários mudam. */
const VERSAO = 1;
const SEMENTES_VERSAO = '1';

const TIPOS = ['ID', 'TEXTO', 'DATA', 'TS', 'INT', 'DEC1', 'DEC4', 'DINHEIRO', 'BOOL', 'ENUM', 'JSON'];
const CABECALHO_COLUNAS = ['Coluna', 'Tipo', 'Obrig.', 'Marca', 'Domínio / FK', 'Descrição'];
const GRUPOS_BASE = [
  { titulo: /^### 3\.1 Cadastros \((\d+)\)/, grupo: 'CADASTROS' },
  { titulo: /^### 3\.2 Eventos e detalhes \((\d+)\)/, grupo: 'EVENTOS' },
  { titulo: /^### 3\.3 Financeiro \((\d+)\)/, grupo: 'FINANCEIRO' },
  { titulo: /^### 3\.4 Suporte \((\d+)\)/, grupo: 'SUPORTE' },
];
const TOTAL_ABAS = 34;

/**
 * Colunas ENUM de 03b cujo domínio vem escrito por extenso e que não têm quadro no catálogo de enums de 03a
 * (seção 2). Os VALORES saem do dicionário; aqui só se dá o nome do enum no Schema.
 */
const ENUMS_SEM_QUADRO = {
  'COMPRAS.unidade_preco': 'UNIDADE_PRECO',
  'VENDAS.unidade_preco': 'UNIDADE_PRECO',
  'REPRODUCAO.resultado': 'RESULTADO_DIAGNOSTICO',
  'REPRODUCAO.metodo': 'METODO_REPRODUCAO',
};
/** Vocabulários fechados que não são coluna (03a, seção 2.6): rótulo do documento → nome no Schema. */
const VOCABULARIOS = {
  'Código de erro da API': 'CODIGO_ERRO',
  'Motivo de indicador nulo': 'MOTIVO_INDICADOR_NULO',
  'Política de aviso': 'POLITICA_AVISO',
  'Situação de operação': 'SITUACAO_OPERACAO',
  'Unidade de exibição de peso': 'UNIDADE_PESO_EXIBICAO',
};

function falha(msg) {
  throw new Error('gen-schema: ' + msg);
}
function ler(arquivo) {
  const p = path.join(DOCS, arquivo);
  if (!fs.existsSync(p)) falha('documento não encontrado: docs/fase-0/' + arquivo);
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}
function semCrases(s) {
  return String(s).replace(/`/g, '').trim();
}
/** Células de uma linha de tabela Markdown (respeita `\|`). Devolve null se a linha não é de tabela. */
function celulas(linha) {
  if (!/^\|.*\|\s*$/.test(linha)) return null;
  const partes = linha.trim().replace(/\\\|/g, '\u0000').split('|');
  return partes.slice(1, -1).map((c) => c.replace(/\u0000/g, '|').trim());
}
function ehSeparador(cels) {
  return cels.every((c) => /^:?-{3,}:?$/.test(c));
}
/** Trecho do documento entre o título que casa `inicio` e o primeiro título seguinte que casa `fim`. */
function secao(texto, inicio, fim, arquivo) {
  const linhas = texto.split('\n');
  const i = linhas.findIndex((l) => inicio.test(l));
  if (i < 0) falha(arquivo + ': seção não encontrada (' + inicio + ')');
  let j = linhas.length;
  for (let k = i + 1; k < linhas.length; k++) {
    if (fim.test(linhas[k])) { j = k; break; }
  }
  return linhas.slice(i, j);
}
/** Tabelas Markdown de um bloco de linhas: [{cabecalho: [..], linhas: [[..]], linhaInicial}] */
function tabelas(linhas) {
  const out = [];
  let atual = null;
  linhas.forEach((l, idx) => {
    const c = celulas(l);
    if (!c) { atual = null; return; }
    if (!atual) { atual = { cabecalho: c, linhas: [], linhaInicial: idx }; out.push(atual); return; }
    if (ehSeparador(c)) return;
    atual.linhas.push(c);
  });
  return out;
}
function tokensMaiusculos(s) {
  return String(s).split(/[·,]/).map((t) => semCrases(t)).filter((t) => /^[A-Z][A-Z0-9_]*$/.test(t));
}

// ------------------------------------------------------------------ desenho-base, seção 3 ----
function removerParenteses(s) {
  let out = '';
  let nivel = 0;
  for (const ch of s) {
    if (ch === '(') nivel++;
    else if (ch === ')') nivel = Math.max(0, nivel - 1);
    else if (nivel === 0) out += ch;
  }
  return out;
}
function parseDesenhoBase(texto) {
  const linhas = secao(texto, /^## 3\. Modelo de dados/, /^### 3\.5 /, ARQ_BASE);
  const ordem = [];
  const grupos = {};
  const colunas = {};
  let grupo = null;
  let esperado = 0;
  let contagem = 0;
  let item = null;
  const fechaItem = () => {
    if (!item) return;
    const m = /^- \*\*([A-Z_]+)\*\*(.*)$/s.exec(item);
    if (!m) falha(ARQ_BASE + ': item de aba ilegível: ' + item.slice(0, 60));
    const nome = m[1];
    const corpo = removerParenteses(m[2]);
    const doisPontos = corpo.indexOf(':');
    if (doisPontos < 0) falha(ARQ_BASE + ': aba ' + nome + ' sem lista de colunas');
    const lista = corpo.slice(doisPontos + 1).split(/\.\s/)[0].replace(/\.\s*$/, '');
    const cols = lista.split(',').map((t) => t.replace(/\[(cad|ctl)\]/g, '').replace(/\*/g, '').trim()).filter((t) => t !== '');
    cols.forEach((c) => {
      if (!/^[a-z][a-z0-9_]*$/.test(c)) falha(ARQ_BASE + ': aba ' + nome + ', nome de coluna ilegível: "' + c + '"');
    });
    if (colunas[nome]) falha(ARQ_BASE + ': aba ' + nome + ' aparece duas vezes na seção 3');
    ordem.push(nome);
    grupos[nome] = grupo;
    colunas[nome] = cols;
    contagem++;
    item = null;
  };
  const fechaGrupo = () => {
    fechaItem();
    if (grupo && contagem !== esperado) falha(ARQ_BASE + ': o grupo ' + grupo + ' anuncia ' + esperado + ' abas e lista ' + contagem);
  };
  for (const l of linhas) {
    const g = GRUPOS_BASE.find((x) => x.titulo.test(l));
    if (g) {
      fechaGrupo();
      grupo = g.grupo;
      esperado = Number(g.titulo.exec(l)[1]);
      contagem = 0;
      continue;
    }
    if (!grupo) continue;
    if (/^- \*\*[A-Z_]+\*\*/.test(l)) { fechaItem(); item = l; continue; }
    if (item && /^\s+\S/.test(l)) { item += ' ' + l.trim(); continue; }
    fechaItem();
  }
  fechaGrupo();
  return { ordem, grupos, colunas };
}
/** Chaves de CONFIGURACOES da seção 15.2 do desenho-base: {grupo: [chave, ...]} */
function parseChavesBase(texto) {
  const linhas = secao(texto, /^### 15\.2 /, /^### 15\.3 /, ARQ_BASE);
  const out = {};
  let grupo = null;
  for (const l of linhas) {
    const m = /^- ([a-z]+): (.*)$/.exec(l);
    let resto = null;
    if (m) { grupo = m[1]; out[grupo] = []; resto = m[2]; } else if (grupo && /^\s+\S/.test(l)) resto = l;
    else if (grupo && l.trim() !== '') grupo = null;
    if (grupo && resto != null) {
      for (const t of resto.matchAll(/`([a-z][a-z0-9_]*)`/g)) out[grupo].push(t[1]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ enums (03a, seção 2) ----
function parseEnums(textoA) {
  const linhas = secao(textoA, /^## 2\. Cat[aá]logo de enums/, /^## 3\. /, ARQ_A);
  const enums = {};
  const onde = {}; // 'TABELA.coluna' → nome do enum
  const ordem = [];
  let atual = null;
  let naTabela = false;
  for (const l of linhas) {
    const m = /^\*\*([A-Z][A-Z0-9_]*)\*\* — Onde: (.*)$/.exec(l);
    if (m) {
      atual = { nome: m[1], valores: [], tabelaPropria: true };
      enums[atual.nome] = atual;
      ordem.push(atual.nome);
      naTabela = false;
      const clausula = m[2].split(/\.\s|\.$/)[0];
      let tabela = null;
      for (const t of clausula.matchAll(/`([^`]+)`/g)) {
        const q = /^([A-Z][A-Z_]*)\.([a-z][a-z0-9_]*)$/.exec(t[1]);
        if (q) { tabela = q[1]; onde[q[1] + '.' + q[2]] = atual.nome; } else if (tabela && /^[a-z][a-z0-9_]*$/.test(t[1])) onde[tabela + '.' + t[1]] = atual.nome;
      }
      if (atual.nome === 'NOME_LISTA') {
        const lista = /listas abertas: ([^.]*)\./.exec(m[2]);
        if (!lista) falha(ARQ_A + ': NOME_LISTA sem a relação das listas abertas');
        atual.valores = tokensMaiusculos(lista[1]);
      }
      continue;
    }
    if (/^#{2,4} /.test(l)) { atual = null; naTabela = false; continue; }
    if (!atual) continue;
    const c = celulas(l);
    if (!c) { if (naTabela) atual = null; naTabela = false; continue; }
    if (!naTabela) {
      naTabela = true;
      if (semCrases(c[0]) !== 'Valor') atual.tabelaPropria = false; // SUBTIPO_EVENTO: quadro por tipo, lido de 03b
      continue;
    }
    if (ehSeparador(c) || !atual.tabelaPropria) continue;
    const bruto = semCrases(c[0]).replace(/−/g, '-');
    if (/^[+-]?\d+$/.test(bruto)) atual.valores.push(Number(bruto));
    else if (/^[A-Za-z][A-Za-z0-9_]*$/.test(bruto)) atual.valores.push(bruto);
    else falha(ARQ_A + ': enum ' + atual.nome + ' com valor ilegível: "' + c[0] + '"');
  }
  return { enums, onde, ordem };
}
/** 03b, seção 2.4: subtipos por tipo de evento. */
function parseSubtipos(textoB) {
  const linhas = secao(textoB, /^### 2\.4 /, /^#{2,3} /, ARQ_B);
  const t = tabelas(linhas).find((x) => semCrases(x.cabecalho[0]) === 'event_type' && semCrases(x.cabecalho[1]) === 'event_subtype');
  if (!t) falha(ARQ_B + ': quadro de subtipos (seção 2.4) não encontrado');
  const porTipo = {};
  for (const r of t.linhas) {
    if (semCrases(r[1]) === 'vazio') continue;
    const tipos = tokensMaiusculos(r[0]);
    const subs = tokensMaiusculos(r[1]);
    if (!tipos.length || !subs.length) falha(ARQ_B + ': linha ilegível no quadro de subtipos: ' + r.join(' | ').slice(0, 80));
    tipos.forEach((tp) => { porTipo[tp] = (porTipo[tp] || []).concat(subs); });
  }
  return porTipo;
}
/** 03b, seção 7.2: valores de REPRODUCAO.metodo por tipo_evento. */
function parseMetodosReproducao(textoB) {
  const linhas = secao(textoB, /^### 7\.2 /, /^#{2,3} /, ARQ_B);
  const t = tabelas(linhas).find((x) => semCrases(x.cabecalho[0]) === 'tipo_evento');
  if (!t) falha(ARQ_B + ': matriz tipo_evento × coluna (seção 7.2) não encontrada');
  const idx = t.cabecalho.findIndex((c) => /^`metodo`/.test(c));
  if (idx < 0) falha(ARQ_B + ': a matriz da seção 7.2 não tem a coluna `metodo`');
  const porTipo = {};
  for (const r of t.linhas) {
    const m = /^[SN]: (.*)$/.exec(r[idx]);
    if (!m) continue;
    const vals = tokensMaiusculos(m[1]);
    if (!vals.length) falha(ARQ_B + ': valores de `metodo` ilegíveis em ' + r[0]);
    porTipo[semCrases(r[0])] = vals;
  }
  return porTipo;
}
function parseVocabularios(textoA) {
  const linhas = secao(textoA, /^### 2\.6 /, /^## 3\. /, ARQ_A);
  const t = tabelas(linhas)[0];
  if (!t) falha(ARQ_A + ': quadro de vocabulários (seção 2.6) não encontrado');
  const out = {};
  for (const r of t.linhas) {
    const nome = VOCABULARIOS[r[0]];
    if (!nome) continue; // "Código de aviso" está incompleto aqui ("entre outros"): a lista é de 05-regras-de-negocio.md
    out[nome] = tokensMaiusculos(r[1]);
  }
  Object.keys(VOCABULARIOS).forEach((rot) => {
    if (!out[VOCABULARIOS[rot]] || !out[VOCABULARIOS[rot]].length) falha(ARQ_A + ': vocabulário "' + rot + '" não encontrado na seção 2.6');
  });
  return out;
}

// ------------------------------------------------------------------ tabelas de colunas ----
function parseObrig(bruto, onde) {
  const s = semCrases(bruto);
  if (s === 'sim' || s === 'S') return { obrig: 'S' };
  if (s === 'não' || s === 'N') return { obrig: 'N' };
  if (s === 'S (auto)') return { obrig: 'S', auto: true };
  if (s === 'N (auto)') return { obrig: 'N', auto: true };
  if (s === 'cond.') return { obrig: 'COND' };
  let m = /^S \(auto\): (.+)$/.exec(s);
  if (m) return { obrig: 'COND', auto: true, condicao: m[1] };
  m = /^S: (.+)$/.exec(s);
  if (m) return { obrig: 'COND', condicao: m[1] };
  if (/^conforme /.test(s)) return { obrig: 'COND', condicao: s };
  return falha(onde + ': obrigatoriedade ilegível: "' + bruto + '"');
}
function parseMarca(bruto, onde) {
  const s = bruto.trim();
  if (s === 'imutável') return { marca: 'IMUTAVEL' };
  if (s === '`*`') return { marca: 'PROJECAO' };
  if (s === '`[ctl]`') return { marca: 'CTL' };
  if (s === '`[cad]`') return { marca: 'CAD' };
  // Editável até o primeiro uso (PLANO_CONTAS: grupo, natureza, tipo, classe): cadastro com trava.
  if (s === 'imutável após o primeiro lançamento') return { marca: 'CAD', travaAposUso: true };
  return falha(onde + ': marca ilegível: "' + bruto + '"');
}
function parseTipo(bruto, onde) {
  const s = semCrases(bruto).replace(/\s*\(¹\)$/, '');
  if (TIPOS.indexOf(s) < 0) return falha(onde + ': tipo de coluna desconhecido: "' + bruto + '"');
  return s;
}
function parseLimites(dominio, tipo) {
  if (['INT', 'DEC1', 'DEC4', 'DINHEIRO'].indexOf(tipo) < 0) return {};
  const s = dominio.trim();
  let m = /^(>|≥) (\d+)(?=$|[,; ])/.exec(s);
  if (m) return m[1] === '>' ? { min: Number(m[2]), minExclusivo: true } : { min: Number(m[2]) };
  m = /^(\d+) < x < (\d+)$/.exec(s);
  if (m) return { min: Number(m[1]), minExclusivo: true, max: Number(m[2]), maxExclusivo: true };
  return {};
}
/** Lê as tabelas "Coluna | Tipo | Obrig. | Marca | Domínio / FK | Descrição" de um dicionário. */
function parseColunas(texto, arquivo, nomes) {
  const linhas = texto.split('\n');
  const reNomes = nomes.map((n) => ({ nome: n, re: new RegExp('(^|[^A-Z_])' + n + '($|[^A-Z_])') }));
  const out = {};
  let aba = null;
  let lendo = null;
  linhas.forEach((l, i) => {
    if (/^#{1,4} /.test(l)) {
      lendo = null;
      const achadas = reNomes.filter((x) => x.re.test(l));
      if (achadas.length === 1) aba = achadas[0].nome;
      else if (achadas.length > 1) aba = null;
      return;
    }
    const c = celulas(l);
    if (!c) { lendo = null; return; }
    if (!lendo) {
      if (c.length === CABECALHO_COLUNAS.length && c.every((x, k) => x === CABECALHO_COLUNAS[k])) {
        if (!aba) falha(arquivo + ', linha ' + (i + 1) + ': tabela de colunas sem título de aba acima');
        if (out[aba]) falha(arquivo + ', linha ' + (i + 1) + ': a aba ' + aba + ' tem duas tabelas de colunas');
        out[aba] = [];
        lendo = aba;
      } else lendo = '';
      return;
    }
    if (ehSeparador(c)) return;
    const onde = arquivo + ', linha ' + (i + 1) + ' (' + lendo + ')';
    if (c.length !== CABECALHO_COLUNAS.length) falha(onde + ': esperava 6 células, achei ' + c.length);
    const nm = /^`([a-z][a-z0-9_]*)`$/.exec(c[0]);
    if (!nm) falha(onde + ': nome de coluna ilegível: "' + c[0] + '"');
    const tipo = parseTipo(c[1], onde);
    const col = Object.assign({ nome: nm[1], tipo }, parseObrig(c[2], onde), parseMarca(c[3], onde), parseLimites(c[4], tipo));
    col.dominio = c[4];
    if (/^PK(;|$)/.test(c[4])) col.pk = true;
    out[lendo].push(col);
  });
  return out;
}

function resolverDominios(tabs, cat, subtipos, metodos) {
  const { enums, onde } = cat;
  const dependentes = {};
  const usados = {};
  const novoEnum = (nome, valores, ref) => {
    if (enums[nome]) {
      if (JSON.stringify(enums[nome].valores) !== JSON.stringify(valores)) falha(ref + ': o enum ' + nome + ' aparece com valores diferentes em duas colunas');
    } else enums[nome] = { nome, valores };
  };
  Object.keys(tabs).forEach((aba) => {
    tabs[aba].forEach((col) => {
      const ref = aba + '.' + col.nome;
      const dom = col.dominio;
      delete col.dominio;
      const fk = /→\s*`?([A-Z][A-Z_]*)\.([a-z][a-z0-9_]*)`?/.exec(dom);
      if (fk) {
        if (col.tipo !== 'ID') falha(ref + ': FK declarada em coluna que não é ID');
        col.fk = { tabela: fk[1], coluna: fk[2] };
      }
      const lista = /`LISTAS\.([A-Z_]+)`/.exec(dom) || /^lista ([A-Z_]+)\b/.exec(dom);
      if (lista) col.lista = lista[1];
      const inline = / · /.test(dom) ? dom.split(' · ').map((t) => semCrases(t).replace(/−/g, '-')) : null;
      const nomeado = /^([A-Z][A-Z0-9_]*)(?=$|[,;])/.exec(dom);
      let nomeEnum = onde[ref] || null;
      if (nomeado && enums[nomeado[1]]) {
        if (nomeEnum && nomeEnum !== nomeado[1]) falha(ref + ': o domínio cita ' + nomeado[1] + ', mas o catálogo de enums aponta ' + nomeEnum);
        nomeEnum = nomeado[1];
      }
      if (!nomeEnum && ENUMS_SEM_QUADRO[ref]) {
        nomeEnum = ENUMS_SEM_QUADRO[ref];
        if (ref === 'REPRODUCAO.metodo') {
          const todos = [];
          Object.keys(metodos).forEach((k) => metodos[k].forEach((v) => { if (todos.indexOf(v) < 0) todos.push(v); }));
          novoEnum(nomeEnum, todos, ref);
          dependentes[ref] = { por: 'tipo_evento', valores: metodos };
        } else {
          if (!inline) falha(ref + ': esperava os valores do enum por extenso no domínio');
          novoEnum(nomeEnum, inline, ref);
        }
      }
      const multi = /c[oó]digos de ([A-Z][A-Z0-9_]*), separados por v[ií]rgula/.exec(dom);
      if (multi) {
        if (!enums[multi[1]]) falha(ref + ': enum multivalorado desconhecido: ' + multi[1]);
        nomeEnum = multi[1];
        col.multi = true;
      }
      if (col.tipo === 'ENUM' && !nomeEnum) falha(ref + ': coluna ENUM sem enum no catálogo (03a, seção 2) nem em ENUMS_SEM_QUADRO');
      if (nomeEnum) {
        const def = enums[nomeEnum];
        if (!def) falha(ref + ': enum desconhecido: ' + nomeEnum);
        if (col.tipo !== 'ENUM' && !col.multi && !(col.tipo === 'INT' && def.valores.every((v) => typeof v === 'number'))) {
          falha(ref + ': o catálogo liga a coluna ao enum ' + nomeEnum + ', mas o tipo dela é ' + col.tipo);
        }
        col.enum = nomeEnum;
        usados[nomeEnum] = true;
        let restrito = null;
        if (inline && inline.every((v) => /^[A-Z][A-Z0-9_]*$|^-?\d+$/.test(v))) {
          const vals = inline.map((v) => (/^-?\d+$/.test(v) ? Number(v) : v));
          const fora = vals.filter((v) => def.valores.indexOf(v) < 0);
          if (fora.length) falha(ref + ': valores fora do enum ' + nomeEnum + ': ' + fora.join(', '));
          if (vals.length < def.valores.length) restrito = def.valores.filter((v) => vals.indexOf(v) >= 0);
        }
        const exceto = /,\s*exceto ([A-Z][A-Z0-9_]*)/.exec(dom);
        if (exceto) {
          if (def.valores.indexOf(exceto[1]) < 0) falha(ref + ': "exceto ' + exceto[1] + '" não é valor de ' + nomeEnum);
          restrito = def.valores.filter((v) => v !== exceto[1]);
        }
        if (restrito) col.valores = restrito;
      }
    });
  });
  // EVENTOS.event_subtype: o conjunto depende do tipo do evento.
  const todosSub = [];
  Object.keys(subtipos).forEach((k) => subtipos[k].forEach((v) => { if (todosSub.indexOf(v) < 0) todosSub.push(v); }));
  if (!enums.SUBTIPO_EVENTO) falha(ARQ_A + ': enum SUBTIPO_EVENTO não encontrado no catálogo');
  enums.SUBTIPO_EVENTO.valores = todosSub;
  dependentes['EVENTOS.event_subtype'] = { por: 'event_type', valores: subtipos };
  return { dependentes, usados };
}

// ------------------------------------------------------------------ sementes ----
function parseListas(textoA, nomesListas) {
  const linhas = secao(textoA, /^## 3\. Listas abertas/, /^## 4\. /, ARQ_A);
  const t = tabelas(linhas).find((x) => x.cabecalho[0] === 'Lista');
  if (!t) falha(ARQ_A + ': quadro de sementes das listas abertas (seção 3) não encontrado');
  const out = {};
  for (const r of t.linhas) {
    const lista = semCrases(r[0]);
    if (nomesListas.indexOf(lista) < 0) falha(ARQ_A + ': lista aberta fora de NOME_LISTA: ' + lista);
    const vistos = {};
    out[lista] = r[2].split(';').map((it, i) => {
      const m = /^\s*([A-Z][A-Z0-9_]*) — (.+?)\s*$/.exec(it);
      if (!m) falha(ARQ_A + ': semente ilegível na lista ' + lista + ': "' + it.trim() + '"');
      if (vistos[m[1]]) falha(ARQ_A + ': código repetido na lista ' + lista + ': ' + m[1]);
      vistos[m[1]] = true;
      const reservado = /\s*\(reservado\)$/.test(m[2]);
      const item = { codigo: m[1], rotulo: m[2].replace(/\s*\(reservado\)$/, ''), ordem: (i + 1) * 10 };
      if (reservado) item.reservado = true;
      return item;
    });
  }
  nomesListas.forEach((n) => { if (!out[n]) falha(ARQ_A + ': a lista ' + n + ' não tem sementes na seção 3'); });
  return out;
}
function parseConfiguracoes(textoA, enums, chavesBase) {
  const linhas = secao(textoA, /^### 4\.12 CONFIGURACOES/, /^### 4\.13 /, ARQ_A);
  const t = tabelas(linhas).find((x) => x.cabecalho[0] === 'Grupo' && x.cabecalho[1] === 'Chave');
  if (!t) falha(ARQ_A + ': quadro de chaves de CONFIGURACOES (seção 4.12) não encontrado');
  const vistos = {};
  const out = t.linhas.map((r) => {
    const chave = semCrases(r[1]);
    const mt = /^([A-Z]+)(?: \((data)\))?$/.exec(r[2]);
    if (!mt || enums.TIPO_CONFIGURACAO.valores.indexOf(mt[1]) < 0) falha(ARQ_A + ': tipo ilegível na chave ' + chave + ': "' + r[2] + '"');
    if (enums.GRUPO_CONFIGURACAO.valores.indexOf(r[0]) < 0) falha(ARQ_A + ': grupo desconhecido na chave ' + chave + ': ' + r[0]);
    if (vistos[chave]) falha(ARQ_A + ': chave de configuração repetida: ' + chave);
    vistos[chave] = true;
    const padrao = r[3] === 'vazio' ? '' : semCrases(r[3]);
    if (padrao !== '') {
      if (mt[1] === 'NUMERO' && !/^-?\d+(\.\d+)?$/.test(padrao)) falha(ARQ_A + ': padrão não numérico na chave ' + chave + ': ' + padrao);
      if (mt[1] === 'BOOL' && padrao !== 'S' && padrao !== 'N') falha(ARQ_A + ': padrão de BOOL fora de S/N na chave ' + chave);
      if (mt[1] === 'JSON') { try { JSON.parse(padrao); } catch (e) { falha(ARQ_A + ': padrão JSON inválido na chave ' + chave); } }
    }
    const item = { chave, grupo: r[0], tipo: mt[1], padrao, descricao: r[4].replace(/`/g, '') };
    if (mt[2]) item.formato = 'DATA';
    return item;
  });
  // Confere contra a seção 15.2 do desenho-base: mesmas chaves, nos mesmos grupos.
  Object.keys(chavesBase).forEach((g) => chavesBase[g].forEach((k) => {
    const s = out.find((x) => x.chave === k);
    if (!s) falha('a chave ' + k + ' está na seção 15.2 do desenho-base e falta em ' + ARQ_A + ', seção 4.12');
    if (s.grupo !== g) falha('a chave ' + k + ' está no grupo ' + s.grupo + ' em ' + ARQ_A + ' e em ' + g + ' no desenho-base');
  }));
  const todasBase = [].concat.apply([], Object.keys(chavesBase).map((g) => chavesBase[g]));
  out.forEach((s) => { if (todasBase.indexOf(s.chave) < 0) falha('a chave ' + s.chave + ' está em ' + ARQ_A + ' e falta na seção 15.2 do desenho-base'); });
  return out;
}
function vazioOuInt(c, onde) {
  if (c === '—' || c === '') return null;
  if (!/^\d+$/.test(c)) falha(onde + ': esperava inteiro ou "—", achei "' + c + '"');
  return Number(c);
}
function parseCategorias(textoA, enums) {
  const linhas = secao(textoA, /^### 4\.5 CATEGORIAS/, /^### 4\.6 /, ARQ_A);
  const t = tabelas(linhas).find((x) => semCrases(x.cabecalho[0]) === 'prioridade' && semCrases(x.cabecalho[1]) === 'codigo');
  if (!t) falha(ARQ_A + ': quadro de sementes de CATEGORIAS (seção 4.5) não encontrado');
  return t.linhas.map((r) => {
    const onde = ARQ_A + ', semente de categoria ' + r[1];
    if (enums.SEXO_APLICAVEL.valores.indexOf(r[3]) < 0) falha(onde + ': sexo_aplicavel fora do enum: ' + r[3]);
    if (enums.CONDICAO_CATEGORIA.valores.indexOf(r[6]) < 0) falha(onde + ': condicao fora do enum: ' + r[6]);
    return {
      codigo: r[1], nome: r[2], sexo_aplicavel: r[3], idade_minima_meses: vazioOuInt(r[4], onde), idade_maxima_meses: vazioOuInt(r[5], onde),
      condicao: r[6], peso_referencia_kg: null, prioridade: vazioOuInt(r[0], onde), descricao: r[7], ativo: true,
    };
  });
}
function parsePlanoContas(textoA, enums) {
  const linhas = secao(textoA, /^### 4\.13 PLANO_CONTAS/, /^### 4\.14 /, ARQ_A);
  const t = tabelas(linhas).find((x) => semCrases(x.cabecalho[0]) === 'ordem' && semCrases(x.cabecalho[1]) === 'codigo');
  if (!t) falha(ARQ_A + ': quadro de sementes de PLANO_CONTAS (seção 4.13) não encontrado');
  const vistos = {};
  return t.linhas.map((r) => {
    const onde = ARQ_A + ', semente de conta ' + r[1];
    const confere = (enumNome, v) => { if (enums[enumNome].valores.indexOf(v) < 0) falha(onde + ': valor fora de ' + enumNome + ': ' + v); };
    confere('GRUPO_CONTA', r[3]);
    confere('NATUREZA_CONTA', r[4]);
    confere('TIPO_LANCAMENTO', r[5]);
    confere('CLASSE_CUSTO_ANIMAL', r[6]);
    if (r[7] !== 'S' && r[7] !== 'N') falha(onde + ': sistema fora de S/N');
    if (vistos[r[1]]) falha(onde + ': código repetido');
    vistos[r[1]] = true;
    return { codigo: r[1], nome: r[2], grupo: r[3], natureza: r[4], tipo: r[5], classe_custo_animal: r[6], sistema: r[7] === 'S', ordem: vazioOuInt(r[0], onde), ativo: true };
  });
}

// ------------------------------------------------------------------ montagem e conferência ----
function montar() {
  const base = ler(ARQ_BASE);
  const textoA = ler(ARQ_A);
  const textoB = ler(ARQ_B);

  const desenho = parseDesenhoBase(base);
  if (desenho.ordem.length !== TOTAL_ABAS) falha(ARQ_BASE + ': a seção 3 lista ' + desenho.ordem.length + ' abas; esperava ' + TOTAL_ABAS);

  const colsA = parseColunas(textoA, ARQ_A, desenho.ordem);
  const colsB = parseColunas(textoB, ARQ_B, desenho.ordem);
  Object.keys(colsA).forEach((n) => { if (colsB[n]) falha('a aba ' + n + ' tem tabela de colunas nos dois dicionários'); });
  const tabs = Object.assign({}, colsA, colsB);
  const faltam = desenho.ordem.filter((n) => !tabs[n]);
  if (faltam.length) falha('não achei a tabela de colunas de ' + faltam.length + ' das ' + TOTAL_ABAS + ' abas nos dicionários: ' + faltam.join(', '));
  if (Object.keys(tabs).length !== TOTAL_ABAS) falha('os dicionários descrevem ' + Object.keys(tabs).length + ' abas; esperava ' + TOTAL_ABAS);

  desenho.ordem.forEach((n) => {
    const nomes = tabs[n].map((c) => c.nome);
    if (!nomes.length) falha('a aba ' + n + ' ficou sem colunas');
    const esperado = desenho.colunas[n];
    if (nomes.join(',') !== esperado.join(',')) {
      const soDic = nomes.filter((c) => esperado.indexOf(c) < 0);
      const soBase = esperado.filter((c) => nomes.indexOf(c) < 0);
      falha('as colunas de ' + n + ' divergem da seção 3 do desenho-base.' +
        (soDic.length ? ' Só no dicionário: ' + soDic.join(', ') + '.' : '') +
        (soBase.length ? ' Só no desenho-base: ' + soBase.join(', ') + '.' : '') +
        (!soDic.length && !soBase.length ? ' Mesmas colunas, em outra ordem.' : ''));
    }
    const repetidas = nomes.filter((c, i) => nomes.indexOf(c) !== i);
    if (repetidas.length) falha('a aba ' + n + ' repete a coluna ' + repetidas[0]);
    const pks = tabs[n].filter((c) => c.pk);
    if (pks.length !== 1 || tabs[n][0] !== pks[0]) falha('a aba ' + n + ' precisa de exatamente uma PK, na primeira coluna');
  });

  const cat = parseEnums(textoA);
  const subtipos = parseSubtipos(textoB);
  const metodos = parseMetodosReproducao(textoB);
  const { dependentes } = resolverDominios(tabs, cat, subtipos, metodos);
  const enums = {};
  Object.keys(cat.enums).forEach((n) => {
    if (!cat.enums[n].valores.length) falha('o enum ' + n + ' ficou sem valores');
    const v = cat.enums[n].valores;
    if (v.some((x, i) => v.indexOf(x) !== i)) falha('o enum ' + n + ' repete valor');
    enums[n] = v;
  });
  Object.keys(cat.onde).forEach((ref) => {
    const p = ref.split('.');
    if (!tabs[p[0]] || !tabs[p[0]].some((c) => c.nome === p[1])) falha(ARQ_A + ': o enum ' + cat.onde[ref] + ' cita a coluna inexistente ' + ref);
  });
  Object.keys(subtipos).forEach((t) => { if (enums.TIPO_EVENTO.indexOf(t) < 0) falha(ARQ_B + ': subtipos para tipo de evento desconhecido: ' + t); });
  Object.keys(metodos).forEach((t) => { if (enums.TIPO_EVENTO_REPRODUTIVO.indexOf(t) < 0) falha(ARQ_B + ': método para tipo reprodutivo desconhecido: ' + t); });

  desenho.ordem.forEach((n) => tabs[n].forEach((c) => {
    if (c.fk && (!tabs[c.fk.tabela] || !tabs[c.fk.tabela].some((x) => x.nome === c.fk.coluna && x.pk))) {
      falha(n + '.' + c.nome + ': FK para ' + c.fk.tabela + '.' + c.fk.coluna + ', que não é PK de aba conhecida');
    }
    if (c.lista && enums.NOME_LISTA.indexOf(c.lista) < 0) falha(n + '.' + c.nome + ': lista aberta desconhecida: ' + c.lista);
  }));

  const listas = parseListas(textoA, enums.NOME_LISTA);
  const sementes = {
    CONFIGURACOES: parseConfiguracoes(textoA, cat.enums, parseChavesBase(base)),
    CATEGORIAS: parseCategorias(textoA, cat.enums),
    PLANO_CONTAS: parsePlanoContas(textoA, cat.enums),
  };
  const tabelasOut = desenho.ordem.map((n) => ({ nome: n, grupo: desenho.grupos[n], pk: tabs[n][0].nome, colunas: tabs[n] }));
  return { tabelas: tabelasOut, enums, dependentes, vocabularios: parseVocabularios(textoA), listas, sementes };
}

// ------------------------------------------------------------------ emissão ----
function js(v) {
  return JSON.stringify(v);
}
function emitir(m) {
  const L = [];
  L.push('/**');
  L.push(' * ARQUIVO GERADO por scripts/gen-schema.js — NÃO EDITE À MÃO.');
  L.push(' * Fonte: docs/fase-0/' + ARQ_A + ' e docs/fase-0/' + ARQ_B + ',');
  L.push(' * conferidos contra a seção 3 de docs/fase-0/' + ARQ_BASE + '. Para mudar: altere o dicionário e rode `npm run gen:schema`.');
  L.push(' *');
  L.push(' * Schema: as ' + m.tabelas.length + ' abas (colunas na ordem física, tipo, obrigatoriedade, marca, enum, FK), os enums fechados,');
  L.push(' * as listas abertas com sementes e as sementes de CONFIGURACOES, CATEGORIAS e PLANO_CONTAS. Fonte única do setup(),');
  L.push(' * do codec e da validação. Puro: nenhum serviço do Apps Script, nenhum efeito na carga.');
  L.push(' */');
  L.push('var Schema = (function () {');
  L.push("  'use strict';");
  L.push('');
  L.push('  var VERSAO = ' + js(VERSAO) + ';');
  L.push('  var SEMENTES_VERSAO = ' + js(SEMENTES_VERSAO) + ';');
  L.push('  var TIPOS = ' + js(TIPOS) + ';');
  L.push("  var MARCAS = ['IMUTAVEL', 'PROJECAO', 'CTL', 'CAD'];");
  L.push('');
  L.push('  var ORDEM = [');
  m.tabelas.forEach((t) => L.push('    ' + js(t.nome) + ','));
  L.push('  ];');
  L.push('');
  L.push('  var TABELAS = {');
  m.tabelas.forEach((t) => {
    L.push('    ' + t.nome + ': { nome: ' + js(t.nome) + ', grupo: ' + js(t.grupo) + ', pk: ' + js(t.pk) + ', colunas: [');
    t.colunas.forEach((c) => L.push('      ' + js(c) + ','));
    L.push('    ] },');
  });
  L.push('  };');
  L.push('');
  L.push('  var ENUMS = {');
  Object.keys(m.enums).forEach((n) => L.push('    ' + n + ': ' + js(m.enums[n]) + ','));
  L.push('  };');
  L.push('');
  L.push('  /** Enum cujo conjunto válido depende de outra coluna da mesma linha: {"TABELA.coluna": {por, valores: {valorDeOutraColuna: [...]}}}. */');
  L.push('  var ENUMS_DEPENDENTES = {');
  Object.keys(m.dependentes).forEach((ref) => {
    L.push('    ' + js(ref) + ': { por: ' + js(m.dependentes[ref].por) + ', valores: {');
    Object.keys(m.dependentes[ref].valores).forEach((k) => L.push('      ' + k + ': ' + js(m.dependentes[ref].valores[k]) + ','));
    L.push('    } },');
  });
  L.push('  };');
  L.push('');
  L.push('  /** Vocabulários fechados que não são coluna (03a, seção 2.6). */');
  L.push('  var VOCABULARIOS = {');
  Object.keys(m.vocabularios).forEach((n) => L.push('    ' + n + ': ' + js(m.vocabularios[n]) + ','));
  L.push('  };');
  L.push('');
  L.push('  /** Listas abertas (aba LISTAS) com as sementes: {LISTA: [{codigo, rotulo, ordem, reservado}]}. */');
  L.push('  var LISTAS_SEMENTE = {');
  Object.keys(m.listas).forEach((n) => {
    L.push('    ' + n + ': [');
    m.listas[n].forEach((it) => L.push('      ' + js(it) + ','));
    L.push('    ],');
  });
  L.push('  };');
  L.push('');
  L.push('  /** Sementes por chave natural: CONFIGURACOES (chave), CATEGORIAS e PLANO_CONTAS (codigo). Valores de domínio, não de célula. */');
  L.push('  var SEMENTES = {');
  Object.keys(m.sementes).forEach((n) => {
    L.push('    ' + n + ': [');
    m.sementes[n].forEach((it) => L.push('      ' + js(it) + ','));
    L.push('    ],');
  });
  L.push('  };');
  L.push('');
  L.push(RODAPE);
  return L.join('\n') + '\n';
}

const RODAPE = [
  "  var PADRAO_COLUNA = { auto: false, condicao: null, pk: false, enum: null, valores: null, multi: false, fk: null, lista: null, travaAposUso: false, min: null, minExclusivo: false, max: null, maxExclusivo: false };",
  '  var INDICE = {};',
  '',
  '  function congelar(o) {',
  "    if (o && typeof o === 'object' && !Object.isFrozen(o)) {",
  '      Object.freeze(o);',
  '      Object.keys(o).forEach(function (k) { congelar(o[k]); });',
  '    }',
  '    return o;',
  '  }',
  '',
  '  // Completa cada coluna com os campos opcionais ausentes (forma única para quem consome) e indexa por nome.',
  '  ORDEM.forEach(function (nome) {',
  '    var t = TABELAS[nome];',
  '    INDICE[nome] = {};',
  '    t.colunas.forEach(function (c, i) {',
  '      Object.keys(PADRAO_COLUNA).forEach(function (k) { if (!(k in c)) c[k] = PADRAO_COLUNA[k]; });',
  '      c.indice = i;',
  '      INDICE[nome][c.nome] = c;',
  '    });',
  '  });',
  '  congelar(TABELAS); congelar(ENUMS); congelar(ENUMS_DEPENDENTES); congelar(VOCABULARIOS); congelar(LISTAS_SEMENTE); congelar(SEMENTES); congelar(ORDEM);',
  '',
  '  function temTabela(nome) {',
  '    return Object.prototype.hasOwnProperty.call(TABELAS, nome);',
  '  }',
  '  /** Definição da aba: {nome, grupo, pk, colunas: [...]}. Aba desconhecida é erro de programação. */',
  '  function tabela(nome) {',
  "    if (!temTabela(nome)) throw new Error('Schema: aba desconhecida: ' + nome);",
  '    return TABELAS[nome];',
  '  }',
  '  /** Nomes das colunas da aba, na ordem física (linha de cabeçalho). Devolve cópia. */',
  '  function colunas(nome) {',
  '    return tabela(nome).colunas.map(function (c) { return c.nome; });',
  '  }',
  '  function temColuna(nomeTabela, nomeColuna) {',
  '    return temTabela(nomeTabela) && Object.prototype.hasOwnProperty.call(INDICE[nomeTabela], nomeColuna);',
  '  }',
  '  /** Definição de uma coluna. Coluna desconhecida é erro de programação. */',
  '  function coluna(nomeTabela, nomeColuna) {',
  '    tabela(nomeTabela);',
  "    if (!temColuna(nomeTabela, nomeColuna)) throw new Error('Schema: coluna desconhecida: ' + nomeTabela + '.' + nomeColuna);",
  '    return INDICE[nomeTabela][nomeColuna];',
  '  }',
  '  /** Nomes das abas, na ordem do desenho-base. Devolve cópia. */',
  '  function nomesTabelas() {',
  '    return ORDEM.slice();',
  '  }',
  '  function pk(nomeTabela) {',
  '    return tabela(nomeTabela).pk;',
  '  }',
  '  /** Valores de um enum fechado. Enum desconhecido é erro de programação. */',
  '  function enumValores(nome) {',
  "    if (!Object.prototype.hasOwnProperty.call(ENUMS, nome)) throw new Error('Schema: enum desconhecido: ' + nome);",
  '    return ENUMS[nome];',
  '  }',
  '  /**',
  '   * Valores aceitos numa coluna com enum: o enum inteiro, o recorte da coluna (`valores`) ou, nos enums',
  '   * dependentes, o conjunto do valor da outra coluna da linha (`registro`). Coluna sem enum devolve null.',
  '   */',
  '  function valoresDaColuna(nomeTabela, nomeColuna, registro) {',
  '    var c = coluna(nomeTabela, nomeColuna);',
  '    if (!c.enum) return null;',
  "    var dep = ENUMS_DEPENDENTES[nomeTabela + '.' + nomeColuna];",
  '    if (dep && registro) {',
  '      var chave = registro[dep.por];',
  "      if (chave != null && chave !== '') return Object.prototype.hasOwnProperty.call(dep.valores, chave) ? dep.valores[chave] : [];",
  '    }',
  '    return c.valores || ENUMS[c.enum];',
  '  }',
  '',
  '  return {',
  '    VERSAO: VERSAO,',
  '    SEMENTES_VERSAO: SEMENTES_VERSAO,',
  '    TIPOS: TIPOS,',
  '    MARCAS: MARCAS,',
  '    TABELAS: TABELAS,',
  '    ENUMS: ENUMS,',
  '    ENUMS_DEPENDENTES: ENUMS_DEPENDENTES,',
  '    VOCABULARIOS: VOCABULARIOS,',
  '    LISTAS_SEMENTE: LISTAS_SEMENTE,',
  '    SEMENTES: SEMENTES,',
  '    nomesTabelas: nomesTabelas,',
  '    temTabela: temTabela,',
  '    tabela: tabela,',
  '    colunas: colunas,',
  '    temColuna: temColuna,',
  '    coluna: coluna,',
  '    pk: pk,',
  '    enumValores: enumValores,',
  '    valoresDaColuna: valoresDaColuna,',
  '  };',
  '})();',
].join('\n');

/** Texto de src/Schema.js gerado a partir dos documentos atuais (não grava). */
function gerar() {
  return emitir(montar());
}

function main() {
  let texto;
  try {
    texto = gerar();
  } catch (e) {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  }
  const atual = fs.existsSync(SAIDA) ? fs.readFileSync(SAIDA, 'utf8') : null;
  if (process.argv.indexOf('--check') >= 0) {
    if (atual !== texto) {
      console.error('gen-schema: src/Schema.js está desatualizado em relação aos dicionários. Rode: npm run gen:schema');
      process.exit(1);
    }
    console.log('src/Schema.js confere com os dicionários.');
    return;
  }
  if (atual === texto) {
    console.log('src/Schema.js já estava atualizado.');
    return;
  }
  fs.writeFileSync(SAIDA, texto);
  console.log('src/Schema.js gravado.');
}

if (require.main === module) main();

module.exports = { gerar, montar, SAIDA, parseDesenhoBase, parseColunas, parseEnums, celulas, removerParenteses, TOTAL_ABAS };
