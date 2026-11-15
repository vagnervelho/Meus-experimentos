# ERP Pecuário

Sistema de gestão de rebanho de corte que roda na conta Google do próprio pecuarista: Google Apps Script (runtime V8)
no servidor, uma planilha do Google Sheets como banco de dados e uma interface web (HtmlService) que funciona no
computador e no celular. Cada animal tem ficha, linha do tempo, genealogia e fotos; tudo o que muda o rebanho é um
evento registrado, auditado e reversível por estorno ou correção.

O desenho técnico (Fase 0) está em [`docs/fase-0/`](docs/fase-0/README.md); o resumo canônico é
[`docs/fase-0/00-desenho-base.md`](docs/fase-0/00-desenho-base.md).

## Estado atual (15/11/2026)

**Fases 1 (Fundação) e 2 (Motor de eventos): código entregue neste repositório, testado em Node e no navegador do
ambiente de desenvolvimento. Nada foi implantado nem executado na conta Google do dono.** As duas fases só fecham
depois que o dono rodar `runDiagnostics` e `runAcceptanceTests` na conta dele e, na Fase 2, validar as contas de compra
e venda com um caso real e confirmar a forma de venda (PR-09). Detalhes em
[`docs/RELATORIO_FASE1.md`](docs/RELATORIO_FASE1.md) e [`docs/RELATORIO_FASE2.md`](docs/RELATORIO_FASE2.md).

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
- Testes de aceitação e base de demonstração que rodam na conta do dono, sem tocar a base real.

O que a Fase 2 acrescenta (o inventário só se movimenta por eventos e pode ser refeito em qualquer data desde o marco
zero):

- Parto (simples, gêmeos, natimorto, peso ao nascer, histórico da vaca), transferência entre pastos, morte e descarte,
  identificação (pôr, trocar e tirar brinco), marcação (para descarte, não localizado), mudança de categoria e baixa na
  contagem; cada um com estorno e correção, inclusive retroativos e com lançamento posterior que dependa deles.
- Compra e venda completas, com o financeiro do próprio lançamento: por cabeça, kg vivo, arroba de peso vivo ou de
  carcaça e lote; frete, comissão, Funrural e outras deduções (inclusive a descontada pelo comprador); parcelas a pagar
  e a receber; rateio entre os animais ao centavo; custo de aquisição e resultado na ficha; aviso de carência na venda.
- Rebanho e pastos numa data passada (quem estava, desde quando, UA, UA/ha e ocupação); Visão geral com o movimento do
  período; documentos e fotos em qualquer lançamento (nota fiscal, GTA, boleto).
- Importação do histórico (compras, vendas, transferências, nascimentos e mortes, também de antes do marco zero) com a
  conferência contra o marco zero; verificação de integridade com 26 conferências.

Ficam para as fases seguintes ([`docs/fase-0/10-plano-de-implementacao.md`](docs/fase-0/10-plano-de-implementacao.md)):
pesagem, sanidade, reprodução e o modo curral (Fase 3); baixa de parcelas, rateio de custos compartilhados, fluxo de
caixa e resultado (Fase 4); dashboard completo, relatórios, XLSX e PDF (Fase 5). O menu mostra só o que já foi
entregue.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `src/` | O que vai para o Apps Script: 23 arquivos `.js` (viram `.gs`), 10 `.html` e o manifesto `appsscript.json` |
| `tests/` | Testes em Node (`*.test.js`), harness `vm` com fakes fiéis das APIs do Google (`harness.js`, `fakes/`) e testes de interface com Playwright (`ui/`) |
| `scripts/` | `push-gas.js` (envio com clasp), `gen-schema.js` (gera `src/Schema.js` dos dicionários de dados), `ui-check.js` |
| `docs/` | Desenho (`fase-0/`), contratos entre módulos (`CONTRATOS.md`), guia de implantação, relatórios das Fases 1 e 2, registro de alterações |

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
   com Node 22+), ou copiar os 34 arquivos à mão.
3. No editor: executar `setup`, autorizar, depois `runDiagnostics` e `runAcceptanceTests`, e guardar os relatórios.
4. Abrir o app pela URL de desenvolvimento (`/dev`) ou pela publicada (`/exec`), cadastrar propriedade e pastos,
   informar a data do marco zero e importar o rebanho.

Regras que valem sempre: o Web App executa como o dono e só o dono acessa; não se edita código no editor do
navegador (o envio substitui tudo); a planilha-banco não é editada à mão (o guia lista o que nunca fazer).

## Documentos

- [`docs/GUIA_DE_IMPLANTACAO.md`](docs/GUIA_DE_IMPLANTACAO.md) — implantação, atualização para a Fase 2, diagnóstico, aceitação, rotina de backup e restauração.
- [`docs/RELATORIO_FASE1.md`](docs/RELATORIO_FASE1.md) e [`docs/RELATORIO_FASE2.md`](docs/RELATORIO_FASE2.md) — o que foi entregue, resultados dos testes, pendências, decisões, limitações e (na Fase 2) a revisão adversarial.
- [`docs/CONTRATOS.md`](docs/CONTRATOS.md) — interfaces de cada módulo de `src/`.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — registro de alterações.
- [`docs/ESPECIFICACAO_MESTRE.md`](docs/ESPECIFICACAO_MESTRE.md) — a especificação original.
