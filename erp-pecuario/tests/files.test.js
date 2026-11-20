'use strict';
/**
 * FileService: porta de arquivos sobre o Drive v3 (pastas reencontradas ou recriadas, planilha nova, cópia, lixeira,
 * listagem com filtros e páginas, bytes por alt=media, texto em várias codificações, sonda do escopo drive.file) e os
 * comandos de anexo (adicionar ATIVO/TEMPORARIO, foto da ficha, reenvio sem novo upload, validação antes do upload,
 * dono inexistente → arquivo para a lixeira, obter como data URL, remover, promover).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./harness');
const S = require('./apoio-sistema');

const { js } = S;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

test('pastas: criadas uma vez, reencontradas pelo ID guardado; apagada ou com ID inválido é reencontrada pelo nome ou recriada', () => {
  const gas = createGas({ order: 'alpha' });
  const G = gas.G;
  const p1 = js(gas.exec(() => G.FileService.porta().garantirPastas()));
  assert.equal(p1.criadas.length, 5);
  const p2 = js(gas.exec(() => G.FileService.porta().garantirPastas()));
  assert.deepEqual(p2.criadas, []);
  assert.equal(p2.backups, p1.backups);
  // ID guardado inválido: reencontra pelo nome (sem duplicar pasta).
  gas.props.script._data.set('DRIVE_FOLDERS', JSON.stringify({ raiz: 'nao-existe' }));
  const p3 = js(gas.exec(() => G.FileService.porta().garantirPastas()));
  assert.deepEqual([p3.criadas, p3.raiz, p3.anexos], [[], p1.raiz, p1.anexos]);
  // Pasta de backups na lixeira: recriada.
  gas.exec(() => G.Drive.Files.update({ trashed: true }, p1.backups));
  const p4 = js(gas.exec(() => G.FileService.porta().garantirPastas()));
  assert.deepEqual(p4.criadas, ['ERP Pecuário/Backups']);
  assert.notEqual(p4.backups, p1.backups);
  assert.equal(JSON.parse(gas.props.script._data.get('DRIVE_FOLDERS')).backups, p4.backups);
});

test('porta: planilha nova e cópia pelo Drive v3, lixeira, listagem filtrada e paginada, bytes por alt=media e codificações', () => {
  const gas = createGas({ order: 'reverse' });
  const G = gas.G;
  const f = gas.exec(() => G.FileService.porta());
  const id = gas.exec(() => f.criarPlanilha('Banco X', 'raiz', { erp_tipo: 'BANCO' }));
  assert.ok(gas.planilhas.existe(id), 'planilha criada pelo Drive abre no Sheets');
  const c = js(gas.exec(() => f.copiar(id, { nome: 'Cópia', pasta: 'backups', appProperties: { erp_tipo: 'BACKUP', erp_banco: id } })));
  assert.equal(gas.drive.arquivo(c.id).appProperties.erp_banco, id);
  assert.equal(gas.drive.arquivo(c.id).parents[0], gas.exec(() => f.pastas().backups));
  // Listagem: por appProperties, por data de criação e com mais de uma página (200 por página).
  for (let i = 0; i < 205; i++) gas.exec(() => f.guardarArquivo({ nome: 'arq' + i + '.txt', mimeType: 'text/plain', texto: 'x' + i, pasta: 'exportacoes', appProperties: { erp_lote: i % 2 ? 'impar' : 'par' } }));
  assert.equal(gas.exec(() => f.listar('exportacoes')).length, 205);
  assert.equal(gas.exec(() => f.listar('exportacoes', { appProperties: { erp_lote: 'impar' } })).length, 102);
  const primeiro = gas.exec(() => f.listar('exportacoes'))[0];
  gas.drive.definirDatas(primeiro.id, { createdTime: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(js(gas.exec(() => f.listar('exportacoes', { criadoAntesDe: '2026-06-01T00:00:00.000Z' }))).map((x) => x.id), [primeiro.id]);
  // Lixeira: some da listagem; arquivo inexistente devolve false.
  assert.equal(gas.exec(() => f.lixeira(primeiro.id)), true);
  assert.equal(gas.exec(() => f.listar('exportacoes')).length, 204);
  assert.equal(gas.exec(() => f.lixeira('nao-existe')), false);
  assert.equal(gas.exec(() => f.obter('nao-existe')), null);
  // Bytes exatos (inclusive binário) por UrlFetchApp alt=media com o token do script.
  const binario = Buffer.from([0, 255, 128, 10, 13, 0xc3]).toString('base64');
  const arq = js(gas.exec(() => f.guardarArquivo({ nome: 'b.bin', mimeType: 'application/octet-stream', base64: binario, pasta: 'anexos' })));
  const lido = js(gas.exec(() => f.lerBytes(arq.id)));
  assert.deepEqual([lido.base64, lido.tamanho], [binario, 6]);
  const req = gas.http.calls[gas.http.calls.length - 1];
  assert.match(req.url, /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/.+\?alt=media$/);
  assert.match(req.headers.Authorization, /^Bearer /);
  // Arquivo que o app não criou (drive.file): NOT_FOUND, nunca leitura silenciosa.
  const externo = gas.drive.plantarExterno({ name: 'planilha do dono.csv', conteudo: 'a;b' });
  const r = gas.tentar(() => f.lerBytes(externo));
  assert.equal(r.erro.code, 'NOT_FOUND');
  // Codificação: Latin-1 e Windows-1252 decodificados; BOM retirado; desconhecida → VALIDATION.
  const latin1 = Buffer.from('Mãe;Raça\nção;Nelore', 'latin1').toString('base64');
  assert.equal(gas.exec(() => f.textoDeBase64(latin1, 'ISO-8859-1')), 'Mãe;Raça\nção;Nelore');
  assert.equal(gas.exec(() => f.textoDeBase64(Buffer.from('﻿Brinco', 'utf8').toString('base64'), 'utf-8')), 'Brinco');
  assert.equal(gas.tentar(() => f.textoDeBase64(latin1, 'EBCDIC')).erro.code, 'VALIDATION');
  assert.equal(gas.tentar(() => f.textoDeBase64('', 'UTF-8')).erro.code, 'VALIDATION');
  // Sonda do escopo: tudo passa no fake; nada sobra fora da lixeira.
  const sonda = js(gas.exec(() => f.sondar()));
  assert.equal(sonda.ok, true);
  assert.deepEqual(gas.exec(() => f.listar('testes', { appProperties: { erp_tipo: 'SONDA' } })).length, 0);
});

test('guardarAnexo: principal e miniatura na pasta Anexos; acima do limite vai para a lixeira e recusa', () => {
  const gas = createGas({ order: 'alpha' });
  const G = gas.G;
  const f = gas.exec(() => G.FileService.porta());
  const a = js(gas.exec(() => f.guardarAnexo({ nome: 'foto.jpg', mimeType: 'image/jpeg', base64: b64('JPEG...'), miniaturaBase64: b64('mini'), appProperties: { erp_banco: 'b1' } })));
  assert.equal(gas.drive.conteudo(a.drive_file_id).toString('utf8'), 'JPEG...');
  assert.equal(gas.drive.conteudo(a.thumb_drive_file_id).toString('utf8'), 'mini');
  assert.equal(a.tamanho_bytes, 7);
  const grande = Buffer.alloc(G.FileService.TAMANHO_MAX_ANEXO + 1, 65).toString('base64');
  const r = gas.tentar(() => f.guardarAnexo({ nome: 'g.pdf', mimeType: 'application/pdf', base64: grande }));
  assert.equal(r.erro.code, 'VALIDATION');
  assert.equal(gas.exec(() => f.listar('anexos')).length, 2, 'o arquivo grande foi para a lixeira');
});

test('anexo.adicionar: foto do animal ATIVO e foto da ficha; reenvio não sobe de novo; obter devolve data URL; remover leva à lixeira', () => {
  const s = S.sistema();
  const { gas, G } = s;
  const ev = s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '15' })]), 'ev-1');
  const animalId = ev.dados.animais[0].animal_id;
  const pedido = {
    idempotencyKey: 'anexo-1',
    dados: { entidade: 'ANIMAIS', entity_id: animalId, tipo: 'FOTO', nome_arquivo: 'vaca15.jpg', mime_type: 'image/jpeg', conteudo_base64: b64('imagem-da-vaca'), miniatura_base64: b64('mini'), definir_como_foto: true, descricao: 'No curral' },
  };
  const criacoesAntes = gas.drive.chamadas.filter((c) => c.metodo === 'create').length;
  const r = s.exec((ctx) => G.FileService.adicionarAnexo(ctx, pedido));
  assert.equal(r.duplicado, false);
  assert.deepEqual([r.dados.status, r.dados.entidade, r.dados.tem_miniatura, r.dados.tamanho_bytes], ['ATIVO', 'ANIMAIS', true, 14]);
  const linha = s.tabela('ANEXOS')[0];
  assert.equal(gas.drive.arquivo(linha.drive_file_id).appProperties.erp_banco, s.banco());
  assert.equal(s.tabela('ANIMAIS')[0].foto_anexo_id, r.dados.anexo_id, 'virou a foto da ficha (edição [cad] auditada)');
  assert.ok(s.tabela('AUDITORIA').some((a) => a.entidade === 'ANIMAIS' && a.campo === 'foto_anexo_id' && a.acao === 'ALTERAR'));
  assert.equal(gas.drive.chamadas.filter((c) => c.metodo === 'create').length - criacoesAntes, 2, 'principal + miniatura');
  // Reenvio com a mesma chave: duplicado, sem novo arquivo no Drive.
  const d = s.exec((ctx) => G.FileService.adicionarAnexo(ctx, pedido));
  assert.equal(d.duplicado, true);
  assert.equal(d.dados.anexo_id, r.dados.anexo_id);
  assert.equal(gas.drive.chamadas.filter((c) => c.metodo === 'create').length - criacoesAntes, 2);
  // Obter: conteúdo como data URL (nunca URL pública); miniatura sob pedido.
  const o = s.exec((ctx) => G.FileService.obterAnexo(ctx, { anexo_id: r.dados.anexo_id }));
  assert.equal(o.dados.data_url, 'data:image/jpeg;base64,' + b64('imagem-da-vaca'));
  const m = s.exec((ctx) => G.FileService.obterAnexo(ctx, { anexo_id: r.dados.anexo_id, miniatura: true }));
  assert.equal(m.dados.data_url, 'data:image/jpeg;base64,' + b64('mini'));
  // Remover: REMOVIDO, a ficha fica sem foto, arquivos na lixeira; obter depois → NOT_FOUND.
  const rem = s.exec((ctx) => G.FileService.removerAnexo(ctx, { idempotencyKey: 'rem-1', dados: { anexo_id: r.dados.anexo_id, justificativa: 'Foto errada' } }));
  assert.equal(rem.dados.status, 'REMOVIDO');
  assert.equal(s.tabela('ANEXOS')[0].status, 'REMOVIDO');
  assert.equal(s.tabela('ANIMAIS')[0].foto_anexo_id, null);
  assert.equal(gas.drive.arquivo(linha.drive_file_id).trashed, true);
  assert.equal(gas.drive.arquivo(linha.thumb_drive_file_id).trashed, true);
  assert.equal(s.tentar((ctx) => G.FileService.obterAnexo(ctx, { anexo_id: r.dados.anexo_id })).erro.code, 'NOT_FOUND');
  const de2 = s.tentar((ctx) => G.FileService.removerAnexo(ctx, { idempotencyKey: 'rem-2', dados: { anexo_id: r.dados.anexo_id } }));
  assert.deepEqual(S.codigos(de2.erro), ['JA_REMOVIDO']);
  s.conferirProjecoes('anexos');
});

test('anexo.adicionar: erro de envio é recusado ANTES do upload; dono inexistente → NOT_FOUND e o arquivo vai para a lixeira; temporário é promovido', () => {
  const s = S.sistema();
  const { gas, G } = s;
  const criacoes = () => gas.drive.chamadas.filter((c) => c.metodo === 'create').length;
  const antes = criacoes();
  let r = s.tentar((ctx) => G.FileService.adicionarAnexo(ctx, { idempotencyKey: 'a1', dados: { entidade: 'PASTOS', entity_id: 'x', tipo: 'SELFIE', nome_arquivo: 'a.jpg', mime_type: 'imagem', conteudo_base64: '' } }));
  assert.equal(r.erro.code, 'VALIDATION');
  assert.deepEqual(S.codigos(r.erro).sort(), ['CAMPO_OBRIGATORIO', 'FORMATO_INVALIDO', 'VALOR_FORA_DA_LISTA', 'VALOR_FORA_DA_LISTA']);
  assert.equal(criacoes(), antes, 'nada subiu para o Drive');
  r = s.tentar((ctx) => G.FileService.adicionarAnexo(ctx, { idempotencyKey: 'a2', dados: { entidade: 'ANIMAIS', entity_id: S.id(999), tipo: 'DOCUMENTO', nome_arquivo: 'gta.pdf', mime_type: 'application/pdf', conteudo_base64: b64('%PDF') } }));
  assert.equal(r.erro.code, 'NOT_FOUND');
  assert.equal(s.tabela('ANEXOS').length, 0);
  const subido = gas.drive.chamadas.filter((c) => c.metodo === 'create').slice(-1)[0];
  assert.equal(gas.drive.arquivo(subido.id).trashed, true, 'o arquivo sem linha em ANEXOS foi para a lixeira');
  // Temporário (aguarda o comando dono) e promoção dentro de outro comando.
  const ev = s.evento('registrar', S.entradaInicial([S.bicho({ brinco: '21' })]), 'ev-2');
  const t = s.exec((ctx) => G.FileService.adicionarAnexo(ctx, { idempotencyKey: 'a3', dados: { entidade: 'ANIMAIS', entity_id: ev.dados.animais[0].animal_id, tipo: 'DOCUMENTO', nome_arquivo: 'nota.pdf', mime_type: 'application/pdf', conteudo_base64: b64('%PDF-1'), temporario: true } }));
  assert.equal(t.dados.status, 'TEMPORARIO');
  s.exec((ctx) => G.UnitOfWork.run(ctx, { rota: 'teste.promover', idempotencyKey: 'p1', reads: ['ANEXOS'], tratador: (tx) => ({ resumo: { n: G.FileService.promover(tx, [t.dados.anexo_id]) } }) }));
  assert.equal(s.tabela('ANEXOS').find((a) => a.anexo_id === t.dados.anexo_id).status, 'ATIVO');
  const p = s.tentar((ctx) => G.UnitOfWork.run(ctx, { rota: 'teste.promover', idempotencyKey: 'p2', reads: ['ANEXOS'], tratador: (tx) => ({ resumo: { n: G.FileService.promover(tx, [S.id(5)]) } }) }));
  assert.equal(p.erro.code, 'VALIDATION');
});
