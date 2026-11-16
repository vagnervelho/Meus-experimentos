# Guia de implantação — ERP Pecuário, Fases 1 e 2

Para o dono do sistema. Não é preciso conhecer Apps Script: cada passo diz onde clicar, o que deve aparecer e o que
fazer quando aparece outra coisa. A primeira implantação deve levar menos de uma hora, mais o tempo da importação do
rebanho (estimativa, ainda não medida na sua conta).

> **Já tem a Fase 1 implantada?** Vá direto à seção 11.1 (atualização para a Fase 2).

> Faça tudo com a **conta Google pessoal que será a dona do sistema**. Só essa conta abre o app; a planilha-banco,
> os backups e as fotos ficam no Google Drive dela.

Sumário: 1 Criar o projeto · 2 Enviar o código · 3 Os arquivos, um a um · 4 `setup` · 5 `runDiagnostics` ·
6 `runAcceptanceTests` · 7 Abrir o aplicativo · 8 Marco zero e importação do rebanho · 9 Backup e restauração ·
10 O que nunca fazer na planilha · 11 Atualizar o sistema depois (11.1 Fase 2) · 12 Quando algo der errado.

---

## 1. Criar o projeto do Apps Script

1. Abra [script.google.com](https://script.google.com), clique em **Novo projeto** e renomeie para `ERP Pecuário`
   (clique no título "Projeto sem título", no alto).
2. Em **Configurações do projeto** (ícone de engrenagem, à esquerda) → **IDs**, copie o **ID do script** (cerca de 57
   letras e números). Ele é usado no passo 2.
3. Ainda nas configurações, confira **Fuso horário**: o manifesto do projeto já traz `America/Porto_Velho` e o envio do
   código ajusta isso; não precisa mexer.
4. **Uma vez só, na sua conta:** ative a *Google Apps Script API* em
   [script.google.com/home/usersettings](https://script.google.com/home/usersettings). Sem isso, o envio pelo clasp
   falha. (Na cópia manual não é necessário.)

Mantenha o projeto no **projeto Cloud padrão** que o Apps Script cria. Não é preciso criar nada no Google Cloud.

## 2. Enviar o código

Há dois caminhos. O recomendado é o `clasp`, a ferramenta oficial do Google, pelo script `npm run gas:push` (o mesmo
fluxo que você já usou no Inbox Intelligence). A cópia manual funciona, mas são 34 arquivos e cada atualização exige
repetir tudo.

### 2.1 Pelo `npm run gas:push` (recomendado)

1. Abra um terminal com **Node 22 ou mais novo**. O mais simples é o **Cloud Shell**: no console do Google Cloud, botão
   *Ativar o Cloud Shell* (ícone `>_`, no alto). É gratuito, roda no navegador e já tem Node e git. Não use o modo
   temporário (*ephemeral*), que apaga a pasta pessoal.
2. Baixe o código e entre na pasta do projeto. Troque `NOME_DO_RAMO` pelo ramo do PR da Fase 1 (aparece no alto da
   página do PR no GitHub; depois que o PR for juntado, use `main`):
   ```bash
   git clone --depth 1 --branch NOME_DO_RAMO https://github.com/vagnervelho/Meus-experimentos.git
   cd Meus-experimentos/erp-pecuario
   npm run gas:push -- COLE_AQUI_O_ID_DO_SCRIPT
   ```
   Não é preciso `npm install`: o script baixa o clasp na versão fixa 3.4.1 pelo `npx`.
3. **Conferência do manifesto.** Antes de qualquer coisa, o script confere se `src/appsscript.json` é o manifesto deste
   projeto (cinco permissões, serviços avançados Sheets v4 e Drive v3, Web App "executar como você" e "somente você",
   V8). Se não for, ele se recusa a enviar e diz como restaurar: `git checkout -- src/appsscript.json`.
4. **Login.** Na primeira vez, o script mostra um link. Abra, escolha a conta dona do sistema e autorize. No fim, o
   navegador mostra um erro de conexão em `localhost`: é esperado. Copie a URL inteira da barra de endereço e cole no
   terminal, na mesma execução.
5. O script mostra a conta e o projeto e pergunta *"Enviar src/ para esse projeto, substituindo todos os arquivos dele,
   e publicar o Web App (acesso: somente você)? [s/N]"*. Confira e responda `s`.
6. O clasp envia os 34 arquivos (os 23 `.js` viram `.gs`, mais os 10 `.html` e o manifesto), apaga o `Código.gs` vazio
   do projeto novo e publica o Web App. No fim aparece a URL `https://script.google.com/macros/s/…/exec`. Guarde-a.
7. Recarregue o editor do Apps Script e abra **Serviços** na barra lateral: devem aparecer **Sheets** e **Drive**. Se
   algum faltar, adicione-o ali (*Google Sheets API* v4 com o nome `Sheets`; *Drive API* v3 com o nome `Drive`).

Opções do script: `--no-deploy` só envia o código, sem publicar versão nova (use no dia a dia e teste pela URL `/dev`;
cada publicação gasta uma das 200 versões que o Apps Script guarda); `--yes` pula a pergunta. O ID fica guardado em
`.clasp.json`, fora do git. Para remover o login do clasp depois: `npx @google/clasp@3.4.1 logout`.

> **Nunca rode `clasp create`, `clasp clone` nem `clasp pull` nesta pasta.** Os três gravam o manifesto padrão por cima
> do nosso, e o projeto ficaria sem as permissões e sem os serviços Sheets e Drive. Se acontecer,
> `git checkout -- src/appsscript.json` restaura o arquivo.

### 2.2 Cópia manual (sem terminal)

1. Em **Configurações do projeto**, marque *Mostrar arquivo de manifesto "appsscript.json" no editor*. Volte ao
   **Editor**, abra `appsscript.json` e substitua todo o conteúdo pelo de `src/appsscript.json`. Salve (Ctrl+S).
2. Para cada arquivo `src/*.js` da tabela da seção 3: no editor, **+** ao lado de *Arquivos* → **Script** → digite o
   nome **sem** `.js` (o editor acrescenta `.gs`) → apague o conteúdo de exemplo → cole o arquivo inteiro → Ctrl+S.
3. Para cada arquivo `src/*.html`: **+** → **HTML** → o nome **sem** `.html`, com as maiúsculas exatamente como na
   tabela (`Index`, `Styles`, `JavaScript`...: a página carrega as partes pelo nome) → cole → Ctrl+S.
4. Apague o `Código.gs` inicial (três pontinhos ao lado do nome → *Excluir*).
5. Copie cada arquivo da visualização *Raw* do GitHub, para não levar formatação junto. Confira no fim: 23 arquivos
   `.gs`, 10 `.html` e o manifesto.
6. Confira os **Serviços** como no passo 2.1.7.
7. Publique o Web App: **Implantar** → **Nova implantação** → tipo **App da Web** → *Executar como*: **Eu** → *Quem
   pode acessar*: **Somente eu** → **Implantar**. Nunca escolha "Qualquer pessoa".

A ordem em que os arquivos são criados não importa: nenhum arquivo depende de outro no momento em que é carregado
(isso é testado nas duas ordens).

## 3. Os arquivos, um a um

Todos ficam na lista *Arquivos* do editor, no mesmo nível (o Apps Script não tem pastas). Coluna "Tipo no editor":
**Script** cria um `.gs`; **HTML** cria um `.html`. "Depende de" lista os outros arquivos que ele usa quando roda:
todos precisam estar presentes; um que falte faz a função parar com erro.

### 3.1 Manifesto

| Arquivo | Onde | Conteúdo |
|---|---|---|
| `appsscript.json` | Manifesto (seção 2.2, passo 1) | Fuso `America/Porto_Velho`, runtime V8, as cinco permissões, serviços avançados Sheets v4 e Drive v3, acesso à rede só a `https://www.googleapis.com/`, Web App executando como o dono e acessível só por ele |

### 3.2 Servidor (Script → `.gs`)

| Arquivo em `src/` | Nome no editor | O que faz | Depende de |
|---|---|---|---|
| `Code.js` | `Code` | As oito funções que você executa ou que o Google chama: `doGet`, `api`, `setup`, `runAcceptanceTests`, `runDiagnostics`, `verifyIntegrity`, `trgManutencaoDiaria`, `trgIntegridadeSemanal`; cada uma confere primeiro se quem chama é o dono | Api, AuditService, Maintenance, TestRunner |
| `Api.js` | `Api` | Porta única do aplicativo: confere o dono, encaminha cada pedido da tela ao serviço certo, devolve sempre uma resposta padronizada, guarda rascunhos e monta a página (compactada) | AnimalService, AuditService, Config, Database, EventCatalog, EventService, FileService, ImportService, InventoryService, Maintenance, PastureService, TestRunner, UnitOfWork, Utils, Validation |
| `Config.js` | `Config` | Parâmetros, listas, categorias e parceiros (cadastros das Configurações) | AuditService, EventService, Schema, Timeline, UnitOfWork, Utils, Validation |
| `Schema.js` | `Schema` | Gerado automaticamente: as 34 abas da planilha-banco, colunas, tipos, listas fechadas e valores iniciais. Não edite à mão | — |
| `Database.js` | `Database` | Leitura e gravação na planilha pelas três formas de gravação, conversão de tipos, teste de ida e volta dos valores, trava (lock), relógio, identificadores e propriedades | Schema, Utils, Validation |
| `Repository.js` | `Repository` | Quais linhas valem, índices em memória, contadores (número do evento, código do animal) | Schema, Validation |
| `UnitOfWork.js` | `UnitOfWork` | Toda gravação: trava, registro da operação, as três fases, recuperação de operação interrompida, proteção contra envio repetido, leitura conferida | AuditService, Repository, Schema, Utils, Validation |
| `AuditService.js` | `AuditService` | Trilha de auditoria (eventos, ajustes e alterações), verificação de integridade (26 conferências, inclusive linha do tempo, partos, genealogia e as contas do financeiro), reparo | EventCatalog, EventService, FinancialService, Repository, Schema, Timeline, UnitOfWork, Utils, Validation |
| `EventCatalog.js` | `EventCatalog` | A definição dos tipos de evento (campos, regras, quem aparece no formulário, nome de cada lançamento) | Utils, Validation |
| `EventService.js` | `EventService` | Registrar, corrigir, estornar e simular eventos: entradas, nascimento, compra, venda, transferência, morte, descarte, identificação, marcação e ajustes; brinco único, genealogia, avisos com confirmação, guarda de duplicidade, histórico importado | AnimalService, AuditService, EventCatalog, FileService, FinancialService, HealthService, InventoryService, PastureService, ReproductionService, Schema, Timeline, UnitOfWork, Utils, Validation |
| `FinancialService.js` | `FinancialService` | O dinheiro de cada evento: lançamentos, parcelas (a pagar e a receber), rateio entre os animais ao centavo, a conta da negociação de compra e de venda (por cabeça, kg, arroba de peso vivo ou de carcaça, lote), deduções da venda, as conferências que garantem que os valores fecham, o custo do animal na ficha | EventCatalog, Timeline, Utils, Validation |
| `HealthService.js` | `HealthService` | Regras sanitárias; nesta versão, só a carência que a venda confere (o registro de sanidade chega na Fase 3) | Utils, Validation |
| `ReproductionService.js` | `ReproductionService` | Partos e histórico reprodutivo da vaca (ficha, avisos do parto) | Timeline, Utils |
| `Timeline.js` | `Timeline` | Linha do tempo de cada animal (ordem dos eventos e o que pode vir depois do quê), situação atual calculada pelos eventos, rebanho e pasto numa data, dias de permanência | Config, FinancialService, Repository, Schema, Utils, Validation |
| `AnimalService.js` | `AnimalService` | Lista do rebanho, ficha do animal (inclusive custo de aquisição e lançamentos), árvore genealógica, edição com auditoria, animal de fora do rebanho (touro de sêmen, mãe de outra fazenda) | AuditService, Config, EventCatalog, EventService, FinancialService, ReproductionService, Schema, Timeline, UnitOfWork, Utils, Validation |
| `PastureService.js` | `PastureService` | Propriedades, pastos (próprios e arrendados), lista e painel do pasto em qualquer data | AnimalService, AuditService, Config, InventoryService, Schema, Timeline, UnitOfWork, Utils, Validation |
| `InventoryService.js` | `InventoryService` | Posição do rebanho hoje e numa data, quem pode receber cada lançamento, números da Visão geral (movimento do período, a pagar e a receber), alertas | AnimalService, EventCatalog, FinancialService, Timeline, UnitOfWork, Utils, Validation |
| `ImportService.js` | `ImportService` | Importação de planilhas de animais, do histórico (compras, vendas, transferências, nascimentos e mortes) e do manejo (pesagens, sanidade, reprodução e ocorrências): leitura, colunas, validação, duplicidades, aprovação, lotes, conclusão, desfazer, relatório e conferência com o marco zero | AuditService, EventCatalog, EventService, Maintenance, Repository, Schema, Timeline, UnitOfWork, Utils, Validation |
| `FileService.js` | `FileService` | Google Drive: pastas do sistema, planilhas, cópias, lixeira, leitura de arquivos; fotos e documentos do animal, do lançamento e dos lançamentos financeiros (nota fiscal, GTA, boleto) | AuditService, Schema, UnitOfWork, Utils, Validation |
| `Maintenance.js` | `Maintenance` | Configuração inicial (`setup`), backup, retenção, restauração, rotina diária e semanal, gatilhos, estado do sistema | AuditService, Database, FileService, Schema, Timeline, UnitOfWork, Utils, Validation |
| `TestRunner.js` | `TestRunner` | Testes de aceitação, base de demonstração, diagnóstico e página de concorrência, sempre numa base de teste separada | Api, Database, FileService, Maintenance, Schema, UnitOfWork, Utils, Validation |
| `Utils.js` | `Utils` | Datas `aaaa-mm-dd`, dinheiro em centavos, rateio, brinco, textos e números no formato brasileiro, identificadores | Validation |
| `Validation.js` | `Validation` | Erros do sistema e mensagens, validação de cada valor pelo tipo da coluna | Schema, Utils |

### 3.3 Interface (HTML → `.html`)

| Arquivo em `src/` | Nome no editor | O que faz | Depende de |
|---|---|---|---|
| `Index.html` | `Index` | A página do app; inclui as demais nesta ordem: Styles, JavaScript, Components, Dashboard, Animals, Pastures, Events, Settings, Import | todas as abaixo |
| `Styles.html` | `Styles` | Aparência (cores, tamanhos de letra e de toque, celular e computador) | — |
| `JavaScript.html` | `JavaScript` | Núcleo da tela: conversa com o servidor, dados guardados no aparelho, navegação, rascunhos, menu | Styles |
| `Components.html` | `Components` | Peças das telas: botões, tabelas, gráficos, formulários do catálogo, seletor de animais, registrar evento | JavaScript |
| `Dashboard.html` | `Dashboard` | Tela Início (Visão geral) | JavaScript, Components |
| `Animals.html` | `Animals` | Rebanho (lista, filtros, CSV) e ficha do animal (linha do tempo, árvore, edição, fotos) | JavaScript, Components |
| `Pastures.html` | `Pastures` | Pastos e painel do pasto, também numa data passada | JavaScript, Components |
| `Events.html` | `Events` | Histórico de eventos, detalhe (com o financeiro e os documentos), estorno e correção de qualquer lançamento | JavaScript, Components |
| `Settings.html` | `Settings` | Configurações: parâmetros, listas, categorias, propriedades, parceiros, sistema (backup, restauração, integridade, diagnóstico) e auditoria | JavaScript, Components |
| `Import.html` | `Import` | Assistente de importação de animais, do histórico de eventos e do manejo (5 telas), com a conferência com o marco zero | JavaScript, Components |

## 4. Executar `setup` (configuração inicial)

1. No editor, abra `Code.gs`. Na barra de cima, escolha a função **`setup`** e clique em **Executar**.
2. Na primeira vez, o Google pede autorização. Como o app é seu e não passou por verificação do Google, aparece "O
   Google não verificou este app": clique em **Avançado** → **Acessar ERP Pecuário (não seguro)** e marque **todas** as
   permissões da lista:
   - ver, editar e criar planilhas (`spreadsheets`): ler e gravar a planilha-banco;
   - ver e gerenciar **somente os arquivos do Drive que este app criou** (`drive.file`): banco, backups, fotos;
   - gerenciar os gatilhos do script (`script.scriptapp`): backup diário e verificação semanal;
   - ver seu e-mail (`userinfo.email`): reconhecer o dono;
   - conectar a serviço externo (`script.external_request`): só `www.googleapis.com`, para ler fotos e arquivos.
3. Espere terminar (pode levar alguns minutos; o Google interrompe qualquer execução aos 6). Abra o **Registro de execução** (aparece embaixo): a linha
   `setup: {...}` mostra o resultado.

O que o `setup` faz, nesta ordem, e que pode ser repetido sem estragar nada: registra você como dono (`OWNER_EMAIL`);
cria no Drive a pasta `ERP Pecuário` com `Backups`, `Exportações`, `Anexos` e `Testes`; testa as operações do Drive;
faz backup do banco se ele já existir; **escolhe a forma de gravação** (seção 5.1); cria a planilha
`ERP Pecuário — Banco de dados` com as 34 abas; preenche os valores iniciais (parâmetros, listas, categorias, plano de
contas) sem sobrescrever o que você já mudou; fixa fuso e idioma `pt_BR`; instala os dois gatilhos; liga a proteção
"somente aviso" nas abas; roda a verificação de integridade.

No resultado, confira: `banco_criado: true` (só na primeira vez), `primitiva.primitiva` (a forma de gravação escolhida),
`gatilhos` com os dois gatilhos e `integridade` sem erros. Em **Acionadores** (ícone de relógio, à esquerda) devem
existir exatamente `trgManutencaoDiaria` (diário, por volta das 3 h) e `trgIntegridadeSemanal` (domingo, por volta das
5 h).

Se aparecer erro, veja a seção 12.

## 5. Executar `runDiagnostics` (o roteiro do spike)

O diagnóstico confere, na sua conta, o que não dá para confirmar fora dela. Ele trabalha só em planilhas temporárias
na pasta `Testes` (vão para a lixeira no fim), não lê nem grava a base real, e o relatório não contém e-mail nem
identificador de arquivo.

1. No editor, função **`runDiagnostics`** → **Executar**. Pode levar alguns minutos.
2. O resultado aparece no registro e fica salvo em `ERP Pecuário/Testes/ERP Pecuário — diagnóstico <data e hora>.json`.
   **Envie esse arquivo** para quem acompanha o desenvolvimento: é a evidência que fecha os itens do spike (E1.0).
3. `"ok": true` quer dizer que nenhum item FALHOU. Cada item tem `situacao`: `OK`, `ALERTA`, `FALHOU` ou
   `NAO_SE_APLICA`.

| Item | O que confere | OK | ALERTA | FALHOU |
|---|---|---|---|---|
| SP-01 | As três formas de gravação: cada valor do corpus de tipos (`=1+1`, `0012`, `13/11/2026`, `1.234,56`, `TRUE`…) volta idêntico? O `batchUpdate` é tudo ou nada? | Nada a fazer | A forma preferida não passou, ou o `batchUpdate` não foi tudo ou nada. O sistema continua seguro (o protocolo de gravação não depende disso). Confira na tela **Configurações → Sistema** que a *Forma de gravação* é uma das que deram `ok: true` em `corpus`; se não for, rode `setup` de novo | Nenhuma forma preservou os tipos. **Não cadastre nem importe o rebanho**; envie o relatório |
| SP-02 | Drive com a permissão `drive.file`: criar, copiar, ler, listar, mandar para a lixeira; a planilha criada pelo Drive abre | Nada a fazer | — | Aplique a **contingência do escopo do Drive** (seção 5.2) |
| SP-03 | A trava (lock): obter e soltar | Nada a fazer | — | Outra execução segurava a trava (um `setup` ou gatilho rodando). Espere um minuto e rode de novo; se repetir, envie o relatório |
| SP-04 | Seu e-mail chega ao sistema? | Nada a fazer | O e-mail veio vazio. Se o app abrir com "acesso negado" pedindo `ALLOW_EMPTY_ACTIVE_USER`, aplique a contingência da seção 12.2 | — |
| SP-05 | Tempo de gravar e ler 10 mil linhas, de anexar 5 linhas e de ler as propriedades | Compare `leitura_ms` e `anexar_5_ms` com o orçamento (comando ≤ 5 s com 10 mil linhas) e envie o relatório | — | A leitura não devolveu todas as linhas: envie o relatório |
| SP-06, SP-07, SP-08, SP-10 | Decididos sem depender da conta (rascunho no aparelho com alternativa no servidor; CSV na Fase 1; gráficos próprios; formato de texto só na forma `SPREADSHEET_APP`) | — | — | Aparecem como `NAO_SE_APLICA`. SP-06 e SP-07 você confere no celular (seção 7) |
| SP-09 | Os dois gatilhos do sistema existem, sem duplicata | Nada a fazer | Falta ou sobra gatilho: rode `setup` de novo (ele cria o que falta e apaga duplicata) | — |
| RUNTIME | O fuso do servidor bate com o do Google | Nada a fazer | — | As datas poderiam sair trocadas perto da meia-noite: envie o relatório antes de usar |

### 5.1 A escolha automática da forma de gravação

Uma planilha do Google "adivinha" o tipo do que se digita: `0012` vira 12, `13/11/2026` vira data, `=1+1` vira fórmula.
Para o sistema, isso seria perda de dado. Por isso há três formas de gravar, em ordem de preferência:

1. `SHEETS_TYPED` — Sheets API com valores tipados (cada valor vai com o tipo declarado; preferida);
2. `SHEETS_RAW` — Sheets API com entrada "crua" (sem interpretação);
3. `SPREADSHEET_APP` — o serviço comum de planilhas, com formato de texto aplicado antes de gravar.

O `setup` grava o corpus de tipos numa planilha temporária com cada forma, relê e **adota a primeira que devolve tudo
idêntico**. A escolha fica na propriedade `IO_PRIMITIVE` (o resumo, em `IO_PRIMITIVE_RELATORIO`) e aparece em
**Configurações → Sistema → Forma de gravação**. Se nenhuma passar, o `setup` para com a mensagem "Nenhuma forma de
gravação preservou os tipos dos dados nesta conta" e não mexe na planilha-banco. Não troque `IO_PRIMITIVE` à mão: se o
diagnóstico indicar outra forma, rode `setup` de novo.

### 5.2 Contingência do escopo do Drive (se SP-02 ou o `setup` reclamarem do Drive)

Sinal: o `setup` para com "O Google Drive recusou uma operação de que o sistema precisa (...). Autorize o acesso
completo ao Drive (escopo "drive")..." ou o SP-02 sai `FALHOU`. O que fazer:

1. Em `src/appsscript.json`, troque a linha `"https://www.googleapis.com/auth/drive.file",` por
   `"https://www.googleapis.com/auth/drive",` (só essa troca; as duas juntas são recusadas).
2. Envie de novo: `npm run gas:push` (ele avisa que o manifesto usa o escopo completo, o que é esperado). Na cópia
   manual, faça a mesma troca no `appsscript.json` do editor e salve.
3. Rode `setup` de novo: o Google pede nova autorização, agora com "ver, editar, criar e excluir todos os arquivos do
   Drive". Autorize. Depois rode `runDiagnostics` e confira o SP-02.
4. Avise quem acompanha o desenvolvimento: o repositório continua com `drive.file`, e o teste do manifesto em
   `npm test` acusa a troca de propósito, até a contingência ser registrada no repositório.

## 6. Executar `runAcceptanceTests` (testes de aceitação)

Os testes de aceitação rodam os cenários das Fases 1 a 3 (nascimento, transferência, compra, venda, estorno, inventário em
data, integridade, rateio na compra, venda por arroba, lançamento retroativo, correção de compra, importação com a
reconciliação, concorrência, `setup` repetido, corpus de tipos e restauração; na Fase 3, pesagem e ganho de peso, vacinação
coletiva com estoque e custo, agenda sanitária e carência, estoque de insumos e os indicadores da estação de monta) com os
serviços reais do Google, numa base de
teste nova (`ERP Pecuário — BASE DE TESTE`, na pasta `Testes`). A base real não é tocada; o último cenário confere isso.

1. Função **`runAcceptanceTests`** → **Executar**.
2. O Apps Script limita cada execução a 6 minutos. Perto de 4 minutos o teste pausa e devolve `"completo": false` com
   o próximo cenário. **Rode de novo** até vir `"completo": true`: ele continua de onde parou.
3. O relatório fica em `ERP Pecuário/Testes/ERP Pecuário — relatório de aceitação <data e hora>.json`. **Envie esse
   arquivo.** No resumo: `cenarios.PASSOU` e `cenarios.FALHOU`; nos passos, `NAO_SE_APLICA` marca o que depende de
   evento das fases seguintes (com o motivo) e `PENDENTE_NA_CONTA_DO_DONO` marca a página de concorrência.
4. **Página de concorrência** (o único passo que precisa de você no navegador): abra a URL `/dev` do app (seção 7)
   acrescentando `?pagina=concorrencia` no fim, e clique em **Executar o teste**. Ela envia ao mesmo tempo 5 gravações com chaves
   diferentes e 2 com a mesma chave na base de teste e confere: 7 respostas boas, 1 marcada como duplicada e 6 eventos
   com números distintos. Mande uma captura da tela do resultado.
5. Cenário que FALHOU: o relatório traz o passo e o detalhe. Envie o arquivo; não use o sistema com dados reais até
   entender a falha.

**Base de demonstração (opcional).** Para ver o sistema com 304 animais e 3 anos de eventos (cerca de 410 lançamentos:
partos, compras, vendas, transferências, mortes, descartes, identificações, correções e estornos; pesagens a cada 120 dias,
vacinações e vermifugações pelos protocolos, três estações de monta com diagnóstico, desmama, castração e ocorrências) sem
tocar a base real:
em **Configurações do projeto → Propriedades do script**, crie `TEST_PLAN` com o valor `DEMO`; rode `runAcceptanceTests`
de novo até `completo: true` (são várias execuções: cada uma grava o que cabe em uns 4 minutos e a seguinte continua do
lançamento em que parou); abra a URL do app com `?ambiente=DEMO` no fim (aparece a faixa "BASE DE TESTE"). Depois apague
a propriedade `TEST_PLAN` para voltar aos testes de aceitação. Se uma execução parar com `"ok": false`, o campo `falha`
diz o lançamento recusado: envie o relatório. No relatório final, `demonstracao.manejo` traz o ganho médio diário do
rebanho, as taxas de cada estação de monta e a cobertura dos protocolos, conferidos pelo próprio teste. Se você já tinha
uma base de demonstração de uma versão anterior, apague a propriedade `DEMO_SPREADSHEET_ID` antes (o plano mudou e a base
antiga não continua).

## 7. Abrir o aplicativo

- **URL de desenvolvimento (`/dev`)**: no editor, **Implantar → Testar implantações → App da Web** → copie a URL que
  termina em `/dev`. Ela sempre roda o código mais recente enviado, sem gastar versão. Use para conferir depois de cada
  envio.
- **URL publicada (`/exec`)**: a que o `npm run gas:push` mostrou (ou **Implantar → Gerenciar implantações**). É a do dia
  a dia e a que vai para a tela inicial do celular. Ela só muda de código quando você publica (envio sem
  `--no-deploy`), e o endereço continua o mesmo.

Use um **perfil de navegador só com a conta dona**, principalmente no celular: com várias contas Google logadas, o link
pode abrir com a conta errada e cair numa página de erro do Google.

Na primeira abertura, o app mostra **Início** com a nota "Para começar". Ao fazer a importação (seção 8), confira
também no celular os dois itens que só podem ser vistos lá: um formulário começado sobrevive a fechar e reabrir o
navegador (SP-06), e o CSV exportado do **Rebanho** abre no aparelho (SP-07). Em **Configurações → Sistema → Rodar o
diagnóstico**, a tela mostra também como este aparelho guarda rascunhos e navega.

## 8. Marco zero e importação do rebanho

O **marco zero** é a data da contagem do rebanho inicial: a "fotografia" a partir da qual o sistema conta o inventário.
Antes dela, a história do animal (nascimento, mãe, chegada) fica registrada como informação; depois dela, todo
movimento é evento.

1. **Configurações → Propriedades**: cadastre a fazenda.
2. **Pastos**: cadastre os pastos (área, se é próprio ou arrendado; o arrendado pede o arrendador).
3. **Configurações → Parâmetros**: preencha *Marco zero (data do rebanho inicial)* com o dia da contagem (não pode ser
   uma data que ainda não chegou) e *Propriedade principal*. Salve. Confira também *Fuso horário da fazenda*.
4. Escolha como o rebanho entra:
   - **Poucos animais**: **Rebanho → Cadastrar animal → "Como o animal entrou?" → Já estava no rebanho**, um por um.
   - **Planilha**: **Configurações → Importação → Nova importação**:
     1. *Arquivo*: baixe o modelo, preencha uma linha por animal (sexo e pasto são obrigatórios; o pasto pode vir de
        um valor padrão), salve em CSV e envie, ou cole as linhas. Até 20.000 linhas.
     2. *Colunas*: confira a ligação de cada coluna com o campo do sistema e diga a confiança das datas e da mãe e do
        pai quando a planilha não diz (confirmada, estimada ou desconhecida). A validação roda em blocos, com progresso.
     3. *Validação*: veja as linhas válidas, com erro e duplicadas, com o texto original ao lado do interpretado; baixe
        o CSV dos erros, corrija na sua planilha e envie de novo se quiser.
     4. *Confirmação*: confira totais, marco zero e propriedade. Havendo linhas reprovadas, só dá para importar
        marcando "importar só as N válidas e ignorar M" (fica registrado quem aprovou).
     5. *Importação*: os blocos gravam com progresso real. Antes de concluir, o sistema faz um backup. Se a conexão
        cair, a faixa "importação incompleta" oferece **Retomar** ou **Desfazer**; enquanto isso, os demais registros
        ficam bloqueados. O relatório final mostra o que entrou e o que ficou de fora.
5. Confira: **Início** (cabeças por pasto e categoria), **Rebanho** e, em **Configurações → Sistema**, **Verificar a
   integridade agora** (deve dar "Tudo certo").

6. **Histórico (opcional, desde a Fase 2).** Compras, vendas, transferências, nascimentos e mortes, inclusive de antes
   do marco zero, entram pelo mesmo assistente: em *Nova importação*, escolha o tipo, baixe o modelo dele e siga as
   mesmas 5 telas. Cada lançamento passa pelas mesmas regras do formulário; o que é de antes do marco zero fica como
   histórico (não muda o inventário, e o financeiro dele não entra no caixa). No relatório final, a **conferência com o
   marco zero** lista o que não bate com a fotografia (pasto diferente, animal vendido no histórico que está na
   fotografia, brinco sem animal), com o que fazer em cada caso. Ela não bloqueia nada. Só uma importação grava por vez.

Errou na importação? **Desfazer** cancela a importação inteira enquanto nenhum evento posterior depender dos animais.
Errou um animal? Corrija pela ficha (campos sensíveis pedem justificativa e viram ajuste) ou pelo evento (**Eventos →
detalhe → Corrigir** ou **Estornar**).

## 9. Backup e restauração

**Rotina automática.** Todo dia, por volta das 3 h no fuso da fazenda, o gatilho `trgManutencaoDiaria` faz o backup
(uma cópia da planilha-banco em `ERP Pecuário/Backups`), apaga as exportações com mais de 7 dias e limpa anexos
temporários. Ficam guardados os 30 backups diários mais recentes e um por mês dos últimos 12 meses (ajustável em
**Configurações → Parâmetros**). Aos domingos, por volta das 5 h, `trgIntegridadeSemanal` confere a integridade.

**Backups extras**, feitos sozinhos: antes de cada `setup` com banco existente e antes de concluir uma importação.
**Sob demanda**: **Configurações → Sistema → Fazer backup agora** (faça antes de qualquer mudança grande).

**Como acompanhar.** A tela **Configurações → Sistema** mostra o último backup, a última verificação semanal e as
rotinas instaladas. Se o backup atrasar mais que o parâmetro *Alertar backup atrasado há (dias)*, o Início mostra o
alerta. Uma vez por mês, abra a pasta `Backups` no Drive e confira que há arquivos recentes.

**Restaurar** (só pelo sistema):

1. **Configurações → Sistema → Backups** → **Restaurar** no backup desejado.
2. Leia a consequência: o que foi gravado depois daquele backup deixa de aparecer. Digite `RESTAURAR` e diga o motivo.
3. O sistema copia o backup pelo Drive, passa a usar a cópia como banco, conclui ou anula operações que estavam pela
   metade, refaz as situações dos animais e roda a verificação de integridade. A planilha anterior **não é apagada**:
   fica na pasta `ERP Pecuário` com o nome original.
4. Recarregue o app nos outros aparelhos.

Nunca restaure copiando o arquivo à mão (*Arquivo → Fazer uma cópia* no Sheets ou cópia no Drive) nem trocando
`SPREADSHEET_ID` nas propriedades: com a permissão `drive.file`, o sistema não alcança arquivo que ele mesmo não criou,
e backup, fotos e exportações deixariam de funcionar.

**Segunda linha de defesa: o histórico de versões do Sheets** (*Arquivo → Histórico de versões*), só se nenhum backup
servir. Depois de restaurar uma versão por ali, faça **Fazer backup agora** e restaure esse backup pelo sistema: é o
que refaz as situações, confere a integridade e avisa todos os aparelhos de que os dados mudaram.

**O que não está no backup** (e por que não faz falta): as propriedades do script (nada essencial vive lá) e as fotos e
documentos, que continuam na pasta `Anexos`, ligados pelo identificador.

## 10. O que nunca fazer na planilha-banco

Você pode abrir a planilha `ERP Pecuário — Banco de dados` para ler. As abas têm proteção "somente aviso": se o Sheets
perguntar se quer mesmo editar, a resposta é **Cancelar**.

| Pode | Não faça |
|---|---|
| Ler, procurar, copiar dados para **outra** planilha | Editar, apagar ou inserir linhas, em qualquer aba |
| Filtrar e ordenar por **Dados → Visualizações de filtro → Criar nova visualização de filtro** (não muda a ordem para o sistema) | Usar **Classificar página/intervalo** ou um filtro comum que reordene as linhas |
| Acrescentar uma coluna sua **ao final** de uma aba (o sistema preserva) | Renomear, apagar, reordenar ou ocultar colunas e abas; mudar a primeira linha (cabeçalhos) |
| | Corrigir peso, data, valor ou situação na célula: corrija pelo app (ficha, Corrigir, Estornar). Mudança na célula não fica na auditoria |
| | Mudar formato das células, fuso ou idioma da planilha (*Arquivo → Configurações*) |
| | Compartilhar a planilha com outras pessoas como editoras; mover para a lixeira, renomear para "testar" ou fazer cópias para usar no lugar |
| | Apagar ou mover as pastas `ERP Pecuário`, `Backups`, `Anexos`, `Testes`, ou os arquivos dentro delas |
| | Apagar ou editar as propriedades do script (`SPREADSHEET_ID`, `IO_PRIMITIVE`, `DATA_VERSION:…`, `PENDING_OP:…`) e os gatilhos (se sumir um gatilho, rode `setup`) |
| | Editar o código no editor do Apps Script (o próximo envio apaga tudo); rodar `clasp create`, `clone` ou `pull` |

Se algo assim acontecer, rode **Verificar a integridade agora**: ela aponta o que divergiu. Situação de animal alterada
na célula se conserta com **Reparar** (refaz pelos eventos); linha apagada ou coluna mexida se conserta restaurando um
backup.

## 11. Atualizar o sistema depois

`git pull` na pasta `Meus-experimentos/erp-pecuario` e `npm run gas:push` (ou `npm run gas:push -- --no-deploy` e teste
pela `/dev` antes de publicar). Depois de atualizar, rode `setup` uma vez: ele acrescenta colunas e valores iniciais
novos (nunca remove nem sobrescreve o que é seu) e faz backup antes. O app aberto mostra a faixa "Nova versão
disponível" com **Recarregar**. Quando o script avisar que passou de 150 versões, apague versões antigas em
**Implantar → Gerenciar implantações**.

### 11.1 Atualização para a Fase 2 (motor de eventos)

O que muda para você: o app passa a registrar **parto, compra, venda, transferência, morte, descarte, identificação
(brinco), marcação (para descarte, não localizado), mudança de categoria e baixa na contagem**, cada um com estorno e
correção; compra e venda já gravam o financeiro do próprio lançamento (parcelas a pagar e a receber, rateio entre os
animais ao centavo, custo de aquisição na ficha); pastos e rebanho podem ser vistos numa data passada; o histórico pode
ser importado. A planilha-banco não muda de forma: as 34 abas, as colunas e os valores iniciais já vieram completos na
Fase 1.

1. **Antes de tudo, um backup.** No app: **Configurações → Sistema → Fazer backup agora**. Anote a data e a hora.
2. **Envie o código de novo**, como na seção 2 (o envio substitui todos os arquivos). Pelo terminal:
   `git pull` na pasta `Meus-experimentos/erp-pecuario` e `npm run gas:push -- --no-deploy` (testa pela `/dev` antes de
   publicar). São agora **34 arquivos**: entrou o `HealthService` (regra de carência da venda). Na cópia manual, crie o
   `HealthService` como Script e substitua o conteúdo de todos os outros.
3. **Rode `setup` uma vez** (seção 4). Nesta atualização o esquema não mudou, então ele não deve criar aba, coluna nem
   valor inicial novo; ele faz backup, confere cabeçalhos e valores iniciais (acrescenta o que faltar, nunca sobrescreve
   o que é seu), reinstala os gatilhos se faltar algum e roda a verificação de integridade, agora com **26
   conferências**. No resultado, confira `banco_criado: false`, `abas` e `sementes` sem criação (ou só o que faltava),
   `gatilhos` com os dois gatilhos e `integridade` sem erros.
4. **Rode `runAcceptanceTests`** até `"completo": true` (seção 6). São 18 cenários das Fases 1 e 2, em várias execuções
   de até 6 minutos. Envie o relatório JSON. Faça também a página de concorrência (seção 6, passo 4).
5. **Confira no app** (pela `/dev`; o app aberto mostra "Nova versão disponível" → **Recarregar**):
   - **Registrar** mostra os tipos novos nos grupos Movimentação (comprar, vender, transferir, morte, descarte),
     Reprodução (nascimento), Manejo (identificação, marcação) e Correções.
   - **Configurações → Parceiros**: cadastre o fornecedor e o comprador antes da primeira compra e da primeira venda.
   - **Configurações → Sistema → Verificar a integridade agora**: "Tudo certo", e anote o tempo que a verificação levou
     (aparece na tela). Mande esse tempo: ele mostra se a verificação semanal cabe nos 6 minutos com a sua base.
   - **Valide as contas com um caso real** (o que só você pode fazer): lance uma compra e uma venda que você já tem no
     papel, com a nota fiscal e o romaneio na mão, e compare na revisão e no detalhe o valor de cada animal, o custo de
     aquisição na ficha, as parcelas, o frete e as deduções (Funrural, comissão) e o depósito esperado. Se algo não
     bater, não estorne ainda: mande o lançamento e a nota.
   - **Diga como você vende** (premissa PR-09): para frigorífico por arroba de carcaça, para reposição por cabeça ou
     por kg vivo, ou outra forma. Todas as formas já existem; a resposta só decide qual fica sugerida.
6. Publique (`npm run gas:push`, sem `--no-deploy`) quando a `/dev` estiver conferida.

**Base de demonstração da Fase 1?** Ela não continua com o plano novo: apague a propriedade `DEMO_SPREADSHEET_ID` antes
de gerar a nova (seção 6, "Base de demonstração"). São cerca de 380 lançamentos, em várias execuções de uns 4 minutos.

**Como voltar atrás.** O código e os dados voltam juntos; nunca só um deles.

- **Antes de gravar qualquer lançamento novo** (compra, venda, parto...): basta enviar de novo o código da Fase 1.
  `git log --oneline | grep "Fase 1" | head -1` mostra o último commit da Fase 1; `git checkout <esse commit>` e
  `npm run gas:push`, depois `git checkout -` para voltar ao ramo. Só para a URL `/exec`, também dá para reapontar a
  implantação para a versão anterior em **Implantar → Gerenciar implantações → editar (lápis) → Versão**; a `/dev` e
  as funções do editor continuam com o código enviado por último.
- **Depois de gravar lançamentos da Fase 2**, a versão da Fase 1 não sabe ler esses tipos. Ainda com o código da Fase 2,
  restaure pelo sistema o backup do passo 1 (seção 9: **Configurações → Sistema → Backups → Restaurar**, com o motivo) e só então
  envie o código da Fase 1. O que foi lançado depois do backup se perde e precisa ser lançado de novo quando você
  voltar à Fase 2; anote antes.

## 12. Quando algo der errado

### 12.1 Mensagens do `setup`

| Mensagem (início) | O que fazer |
|---|---|
| "Acesso negado" / outra conta | Rode com a conta dona (a que rodou o primeiro `setup`) |
| "O sistema está ocupado gravando outra operação" | Outra execução estava gravando; espere um minuto e rode de novo |
| "O Google Drive recusou uma operação de que o sistema precisa" | Seção 5.2 |
| "A planilha-banco registrada (...) não foi encontrada" | Tire a planilha da lixeira do Drive, ou restaure um backup pelo sistema. Para começar do zero (só se não há dado real), apague a propriedade `SPREADSHEET_ID` e rode `setup` |
| "Nenhuma forma de gravação preservou os tipos" | Não use o sistema; envie o conteúdo da propriedade `IO_PRIMITIVE_RELATORIO` e o relatório do `runDiagnostics` |
| "Não foi possível copiar a planilha para a pasta de backups" | A planilha foi copiada ou criada fora do sistema: restaure um backup pelo sistema; se continuar, seção 5.2 |
| Serviço `Sheets` ou `Drive` não definido | Passo 2.1.7 (adicionar os serviços) e rode de novo |

### 12.2 O app abre com "acesso negado"

- Abriu com outra conta: use um perfil do navegador só com a conta dona.
- A mensagem fala em `ALLOW_EMPTY_ACTIVE_USER` (o Google não informou o e-mail; o SP-04 sai `ALERTA`): em
  **Configurações do projeto → Propriedades do script**, crie `ALLOW_EMPTY_ACTIVE_USER` com o valor `true`. Isso não
  abre o app para mais ninguém: com "Somente eu", o próprio Google barra outras contas antes de o código rodar.

### 12.3 "Este app está bloqueado", sem a opção Avançado

Tente autorizar numa janela anônima com só a conta dona logada. Se continuar, avise: a saída é vincular o script a um
projeto do Google Cloud com tela de consentimento própria, uma troca que não tem volta.

### 12.4 Erro dentro do app

Toda falha inesperada fica na aba `ERROS_LOG` da planilha-banco e no registro de execuções do Apps Script
(**Execuções**, à esquerda). A tela mostra a mensagem e um detalhe técnico expansível: copie esse detalhe ao relatar.
