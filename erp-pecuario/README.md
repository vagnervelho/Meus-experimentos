# ERP Pecuário

Sistema de gestão de rebanho de corte que roda na conta Google do próprio pecuarista: Google Apps Script (runtime V8)
no servidor, uma planilha do Google Sheets como banco de dados e uma interface web (HtmlService) que funciona no
computador e no celular. Cada animal tem ficha, linha do tempo, genealogia e fotos; tudo o que muda o rebanho é um
evento registrado, auditado e reversível por estorno ou correção.

O desenho técnico (Fase 0) está em [`docs/fase-0/`](docs/fase-0/README.md); o resumo canônico é
[`docs/fase-0/00-desenho-base.md`](docs/fase-0/00-desenho-base.md).

## Estado atual (15/11/2026)

**Fase 1 — Fundação: código entregue neste repositório, testado em Node e no navegador do ambiente de
desenvolvimento. Ainda não foi implantado nem executado na conta Google do dono.** A fase só fecha depois que o dono
rodar `runDiagnostics` e `runAcceptanceTests` na conta dele (detalhes em
[`docs/RELATORIO_FASE1.md`](docs/RELATORIO_FASE1.md)).

O que a Fase 1 faz:

- `setup()` idempotente: cria a planilha-banco com as 34 abas, sementes, gatilhos e proteção de aviso, e escolhe
  sozinho a forma de gravação que preserva os tipos dos dados nesta conta.
- Gravação em três fases com registro de operações: nada fica pela metade, reenvio não duplica, queda no meio é
  recuperada sozinha.
- Entrada do rebanho: cadastro pelo formulário (rebanho inicial e outras entradas) ou importação de planilha de
  animais com validação, duplicidades, aprovação parcial, desfazer e relatório.
- Correções: ajuste de cadastro, de identificação e de localização; estorno e correção das entradas.
- Rebanho (lista com filtros, exportação CSV), ficha do animal, árvore genealógica, fotos e documentos.
- Propriedades, pastos próprios e arrendados com painel, categorias, listas e parâmetros.
- Visão geral com números reais; backup diário e sob demanda, restauração pelo sistema, verificação de integridade.
- Testes de aceitação e base de demonstração (cerca de 300 animais) que rodam na conta do dono, sem tocar a base real.

Pesagens, sanidade, reprodução, compra, venda, transferência, morte e financeiro chegam nas Fases 2 a 5
([`docs/fase-0/10-plano-de-implementacao.md`](docs/fase-0/10-plano-de-implementacao.md)). O menu mostra só o que já
foi entregue.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `src/` | O que vai para o Apps Script: 20 arquivos `.js` (viram `.gs`), 10 `.html` e o manifesto `appsscript.json` |
| `tests/` | Testes em Node (`*.test.js`), harness `vm` com fakes fiéis das APIs do Google (`harness.js`, `fakes/`) e testes de interface com Playwright (`ui/`) |
| `scripts/` | `push-gas.js` (envio com clasp), `gen-schema.js` (gera `src/Schema.js` dos dicionários de dados), `ui-check.js` |
| `docs/` | Desenho (`fase-0/`), contratos entre módulos (`CONTRATOS.md`), guia de implantação, relatório da Fase 1, registro de alterações |

## Como rodar os testes

Requisitos: Node 22 ou mais novo. Não há dependência de execução; `npm install` só traz os tipos do Apps Script
(usados para conferir assinaturas).

```bash
cd erp-pecuario
npm install            # uma vez
npm test               # nível 1: node --test tests/*.test.js (lógica, persistência sob queda, setup, importação, API, interface sem navegador)
npm run ui:check       # páginas sem recurso externo e dentro de 450 KB + nível 3 (Playwright, Chromium)
npm run gen:schema -- --check   # confere se src/Schema.js está em dia com os dicionários
```

`npm run ui:check` precisa do Playwright com o Chromium instalados no ambiente (não são dependências declaradas do
projeto; aqui foi usado o Playwright 1.63.0). Sem eles, `npm run ui:check -- --so-estatica` faz só a parte estática.

Última execução (15/11/2026, Node 22.23.4): `npm test` com 327 testes, 327 aprovados, 0 falhas; `npm run ui:check`
com 29 testes de navegador, 29 aprovados, 0 falhas. Contagem por arquivo em
[`docs/RELATORIO_FASE1.md`](docs/RELATORIO_FASE1.md).

## Como implantar (resumo)

O passo a passo completo, para quem não é especialista em Apps Script, está em
[`docs/GUIA_DE_IMPLANTACAO.md`](docs/GUIA_DE_IMPLANTACAO.md). Em resumo:

1. Criar um projeto vazio em script.google.com e ativar a Google Apps Script API nas configurações do usuário.
2. Enviar o código: `npm run gas:push -- <ID do script>` (clasp em versão fixa, pelo Cloud Shell ou por um terminal
   com Node 22+), ou copiar os 31 arquivos à mão.
3. No editor: executar `setup`, autorizar, depois `runDiagnostics` e `runAcceptanceTests`, e guardar os relatórios.
4. Abrir o app pela URL de desenvolvimento (`/dev`) ou pela publicada (`/exec`), cadastrar propriedade e pastos,
   informar a data do marco zero e importar o rebanho.

Regras que valem sempre: o Web App executa como o dono e só o dono acessa; não se edita código no editor do
navegador (o envio substitui tudo); a planilha-banco não é editada à mão (o guia lista o que nunca fazer).

## Documentos

- [`docs/GUIA_DE_IMPLANTACAO.md`](docs/GUIA_DE_IMPLANTACAO.md) — implantação, diagnóstico, aceitação, rotina de backup e restauração.
- [`docs/RELATORIO_FASE1.md`](docs/RELATORIO_FASE1.md) — o que foi entregue, resultados dos testes, pendências, decisões e limitações.
- [`docs/CONTRATOS.md`](docs/CONTRATOS.md) — interfaces de cada módulo de `src/`.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — registro de alterações.
- [`docs/ESPECIFICACAO_MESTRE.md`](docs/ESPECIFICACAO_MESTRE.md) — a especificação original.
