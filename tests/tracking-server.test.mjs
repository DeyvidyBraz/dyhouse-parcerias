import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import * as fs from 'node:fs/promises';
import { createAppServer, TRACKING_SCHEMA, TRACKING_FILE_LIMIT } from '../server.mjs';
import { ingestDatasets, updatePartnershipTracking, normalizeTracking, applyPartnershipTracking } from '../dist/data-core.js';

const NOW = '2026-11-02T16:30:00.000Z';
const defaultHeaders = {
  host: 'localhost:8080',
  origin: 'http://localhost:8080',
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json; charset=utf-8',
};

function transport(server) {
  return (url = '/api/tracking', init = {}) => new Promise(resolve => {
    const headers = new Map();
    const body = init.body === undefined ? [] : (Array.isArray(init.body) ? init.body : [init.body]);
    const request = Readable.from(body);
    request.url = url;
    request.method = init.method || 'GET';
    request.headers = { ...defaultHeaders, ...init.headers };
    for (const [key, value] of Object.entries(request.headers)) if (value === undefined) delete request.headers[key];
    const response = {
      headersSent: false,
      statusCode: 200,
      setHeader(name, value) { headers.set(name, String(value)); },
      writeHead(status, values) {
        this.statusCode = status;
        this.headersSent = true;
        for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
      },
      end(bytes) {
        resolve(new Response(request.method === 'HEAD' ? null : bytes, { status: this.statusCode, headers: Object.fromEntries(headers) }));
      },
    };
    server.emit('request', request, response);
  });
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'parcerias-tracking-'));
  const publicDir = path.join(root, 'dist');
  const dataDir = path.join(publicDir, 'dados');
  const trackingFile = path.join(root, 'acompanhamento', 'parcerias-acompanhamento.json');
  await fs.mkdir(dataDir, { recursive: true });
  const researchFile = path.join(dataDir, 'pesquisa.json');
  const researchBytes = '{"projects":[{"id":"E1","name":"Alpha"}],"partners":[]}\n';
  await fs.writeFile(researchFile, researchBytes);
  const options = { publicDir, dataDir, trackingFile };
  const request = transport(createAppServer(options));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, publicDir, dataDir, trackingFile, researchFile, researchBytes, options, request };
}

function envelope(revision = 0, note = 'Primeiro contato a preparar') {
  return {
    schema: TRACKING_SCHEMA,
    revision,
    records: [{
      projectKey: 'barueri|alpha|empresa',
      aliases: ['E1'],
      status: 'nao_solicitada',
      updatedAt: NOW,
      statusUpdatedAt: NOW,
      requestedAt: '',
      completedAt: '',
      projectName: 'Alpha',
      city: 'Barueri',
      identities: [{ name: 'alpha', city: 'barueri', companies: ['empresa'], address: '', url: '', suffix: '' }],
      events: [{ id: 'note-1', createdAt: NOW, text: note, kind: 'note', extension: { owner: 'local' } }],
      custom: { labels: ['prioridade'] },
    }],
    extra: { source: 'test' },
  };
}

async function put(request, payload, extra = {}) {
  return request('/api/tracking', { method: 'PUT', body: JSON.stringify(payload), ...extra });
}

test('GET ausente retorna revisão zero e não cria pasta ou arquivo', async t => {
  const f = await fixture(t);
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { schema: TRACKING_SCHEMA, revision: 0, records: [] });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  await assert.rejects(fs.stat(path.dirname(f.trackingFile)), { code: 'ENOENT' });
  const head = await f.request('/api/tracking', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('persiste notas e extensões após nova instância e não modifica pesquisa nem expõe arquivo estático', async t => {
  const f = await fixture(t);
  const payload = envelope();
  const saved = await put(f.request, payload);
  assert.equal(saved.status, 200);
  const expected = { ...payload, revision: 1 };
  assert.deepEqual(await saved.json(), expected);
  const another = transport(createAppServer(f.options));
  assert.deepEqual(await (await another()).json(), expected);
  assert.deepEqual(JSON.parse(await fs.readFile(f.trackingFile, 'utf8')), expected);
  assert.equal(await fs.readFile(f.researchFile, 'utf8'), f.researchBytes);
  assert.equal((await another('/acompanhamento/parcerias-acompanhamento.json')).status, 404);
  assert.equal((await another('/dados/parcerias-acompanhamento.json')).status, 404);
  const datasets = await (await another('/api/datasets')).json();
  assert.deepEqual(datasets.files.map(file => file.fileName), ['pesquisa.json']);
  assert.equal((await another('/api/datasets', { method: 'PUT', body: '{}' })).status, 405);
});

test('envelope produzido pelo core passa pelo servidor e volta ao projeto com status e histórico', async t => {
  const f = await fixture(t);
  const model = ingestDatasets([{ fileName: 'contrato.json', payload: { projects: [{ name: 'Alpha Teste', developer: 'Empresa', city: 'Barueri', address: 'Rua Um, 1' }] } }]);
  const project = model.projects[0];
  let store = updatePartnershipTracking(null, project, { note: 'Solicitar documentos' }, NOW, 'contract-note-1');
  const first = await put(f.request, store);
  assert.equal(first.status, 200, await first.clone().text());
  store = normalizeTracking(await first.json());
  store = updatePartnershipTracking(store, project, { status: 'solicitada', note: 'Cadastro enviado' }, '2026-11-02T17:00:00.000Z', 'contract-note-2');
  const second = await put(f.request, store);
  assert.equal(second.status, 200, await second.clone().text());
  store = normalizeTracking(await second.json());
  store = updatePartnershipTracking(store, project, { status: 'feita', note: 'Aceite registrado' }, '2026-11-03T10:00:00.000Z', 'contract-note-3');
  assert.equal((await put(f.request, store)).status, 200);
  const fromDisk = await (await transport(createAppServer(f.options))()).json();
  applyPartnershipTracking(model.projects, fromDisk);
  assert.equal(project.normalized.partnershipStatus, 'feita');
  assert.equal(project.partnershipTracking.events.length, 5);
  assert.equal(project.partnershipTracking.requestedAt, '2026-11-02T17:00:00.000Z');
  assert.equal(project.partnershipTracking.completedAt, '2026-11-03T10:00:00.000Z');
  assert.equal(await fs.readFile(f.researchFile, 'utf8'), f.researchBytes);
});

test('cada gravação atômica guarda a revisão anterior em .bak e não deixa temporários', async t => {
  const f = await fixture(t);
  const first = await (await put(f.request, envelope())).json();
  await assert.rejects(fs.stat(`${f.trackingFile}.bak`), { code: 'ENOENT' });
  const second = structuredClone(first);
  second.records[0].status = 'solicitada';
  second.records[0].requestedAt = NOW;
  second.records[0].events.push({ id: 'status-2', createdAt: NOW, text: 'Parceria solicitada', kind: 'status' });
  const response = await put(f.request, second);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(`${f.trackingFile}.bak`, 'utf8')), first);
  assert.deepEqual((await fs.readdir(path.dirname(f.trackingFile))).sort(), ['parcerias-acompanhamento.json', 'parcerias-acompanhamento.json.bak']);
  assert.equal(await fs.readFile(f.researchFile, 'utf8'), f.researchBytes);
});

test('duas sessões concorrentes geram um sucesso e um conflito; rebase preserva as duas notas', async t => {
  const f = await fixture(t);
  const base = await (await put(f.request, envelope())).json();
  const left = structuredClone(base);
  const right = structuredClone(base);
  left.records[0].events.push({ id: 'left', createdAt: NOW, text: 'Nota da primeira sessão', kind: 'note' });
  right.records[0].events.push({ id: 'right', createdAt: NOW, text: 'Nota da segunda sessão', kind: 'note' });
  const other = transport(createAppServer(f.options));
  const responses = await Promise.all([put(f.request, left), put(other, right)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const winner = await responses.find(r => r.status === 200).json();
  const conflict = await responses.find(r => r.status === 409).json();
  assert.deepEqual(conflict.tracking, winner);
  assert.equal(winner.revision, 2);
  const rebase = structuredClone(conflict.tracking);
  const existing = new Set(rebase.records[0].events.map(event => event.id));
  for (const event of [...left.records[0].events, ...right.records[0].events]) {
    if (!existing.has(event.id)) { rebase.records[0].events.push(event); existing.add(event.id); }
  }
  assert.equal((await put(other, rebase)).status, 200);
  const final = await (await f.request()).json();
  assert.equal(final.revision, 3);
  assert.deepEqual(final.records[0].events.map(event => event.id).sort(), ['left', 'note-1', 'right']);
  assert.equal(await fs.readFile(f.researchFile, 'utf8'), f.researchBytes);
});

test('JSON, arrays, status, datas e chaves perigosas inválidos não alteram arquivo ou backup', async t => {
  const f = await fixture(t);
  const current = await (await put(f.request, envelope())).json();
  const before = await fs.readFile(f.trackingFile, 'utf8');
  const mutations = [
    p => { p.revision = '1'; },
    p => { p.records = {}; },
    p => { p.records[0].aliases = 'E1'; },
    p => { p.records[0].events = {}; },
    p => { p.records[0].status = 'aprovada'; },
    p => { p.records[0].updatedAt = '2026-02-30T10:00:00Z'; },
    p => { p.records[0].events[0].createdAt = 'amanhã'; },
    p => { p.records[0].completedAt = '2026-11-02'; },
    p => { p.records[0].events[0].kind = 'html'; },
    p => { p.records.push(structuredClone(p.records[0])); },
    p => { p.records[0].events.push(structuredClone(p.records[0].events[0])); },
    p => { p.records[0].identities[0].companies = 'empresa'; },
    p => { p.extra = JSON.parse('{"nested":{"__proto__":{"polluted":true}}}'); },
    p => { p.extra = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'); },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(current);
    mutate(candidate);
    const response = await put(f.request, candidate);
    assert.equal(response.status, 400, await response.text());
    assert.equal(await fs.readFile(f.trackingFile, 'utf8'), before);
  }
  assert.equal((await f.request('/api/tracking', { method: 'PUT', body: '{"schema":' })).status, 400);
  assert.equal((await f.request('/api/tracking', { method: 'PUT', body: '{}', headers: { 'content-length': '99' } })).status, 400);
  assert.equal({}.polluted, undefined);
  await assert.rejects(fs.stat(`${f.trackingFile}.bak`), { code: 'ENOENT' });
});

test('limite de 10 MB é aplicado ao Content-Length e ao corpo transmitido', async t => {
  const f = await fixture(t);
  assert.equal(TRACKING_FILE_LIMIT, 10 * 1024 * 1024);
  await put(f.request, envelope());
  const before = await fs.readFile(f.trackingFile, 'utf8');
  const announced = await f.request('/api/tracking', { method: 'PUT', body: '{}', headers: { 'content-length': String(TRACKING_FILE_LIMIT + 1) } });
  assert.equal(announced.status, 413);
  const streamed = await f.request('/api/tracking', { method: 'PUT', body: [Buffer.alloc(TRACKING_FILE_LIMIT, 'x'), Buffer.from('y')] });
  assert.equal(streamed.status, 413);
  assert.equal(await fs.readFile(f.trackingFile, 'utf8'), before);
  await assert.rejects(fs.stat(`${f.trackingFile}.bak`), { code: 'ENOENT' });
});

test('PUT exige JSON e Origin/Host iguais; rejeita Fetch Metadata incompatível quando enviado', async t => {
  const f = await fixture(t);
  const current = await (await put(f.request, envelope())).json();
  const before = await fs.readFile(f.trackingFile, 'utf8');
  for (const headers of [
    { origin: 'http://attacker.invalid' },
    { origin: 'http://localhost:8081' },
    { origin: 'null' },
    { origin: 'http://localhost:8080/path' },
    { origin: undefined },
    { host: undefined },
    { host: 'attacker.invalid@localhost:8080' },
    { 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': '' },
    { 'sec-fetch-site': undefined, origin: 'http://attacker.invalid' },
    { 'sec-fetch-site': undefined, origin: undefined },
    { 'sec-fetch-site': undefined, origin: 'http://localhost:8081' },
  ]) {
    assert.equal((await put(f.request, current, { headers })).status, 403);
  }
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': undefined }]) {
    assert.equal((await put(f.request, current, { headers })).status, 415);
  }
  const unsupported = await f.request('/api/tracking', { method: 'POST', body: '{}' });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'GET, HEAD, PUT');
  assert.equal(await fs.readFile(f.trackingFile, 'utf8'), before);
  assert.equal(await fs.readFile(f.researchFile, 'utf8'), f.researchBytes);
});

test('HTTP de mesma origem pode salvar sem Fetch Metadata, como no preview terminal.local', async t => {
  const f = await fixture(t);
  const saved = await put(f.request, envelope(), { headers: {
    host: 'terminal.local:4173', origin: 'http://terminal.local:4173', 'sec-fetch-site': undefined,
  } });
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await saved.json()).revision, 1);
  assert.equal((await (await f.request()).json()).records[0].events[0].text, 'Primeiro contato a preparar');
  assert.equal(await fs.readFile(f.researchFile, 'utf8'), f.researchBytes);
});

test('arquivo existente corrompido não é ocultado nem sobrescrito por novo PUT', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.trackingFile));
  const corrupt = '{"schema":"incompleto"';
  await fs.writeFile(f.trackingFile, corrupt);
  assert.equal((await f.request()).status, 500);
  const response = await put(f.request, envelope());
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /preservado/);
  assert.equal(await fs.readFile(f.trackingFile, 'utf8'), corrupt);
  await assert.rejects(fs.stat(`${f.trackingFile}.bak`), { code: 'ENOENT' });
});

test('não segue symlink de arquivo, diretório ou backup, nem permite tracking em dados públicos', async t => {
  const f = await fixture(t);
  assert.throws(() => createAppServer({ ...f.options, trackingFile: f.researchFile }), /fora das pastas/);
  assert.throws(() => createAppServer({ ...f.options, trackingFile: path.join(f.root, '..', 'fora.json') }), /dentro do projeto/);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'parcerias-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const sentinel = path.join(outside, 'sentinel.json');
  const sentinelBytes = JSON.stringify(envelope());
  await fs.writeFile(sentinel, sentinelBytes);
  try { await fs.symlink(outside, path.dirname(f.trackingFile), 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Sem suporte a symlinks.'); return; }
    throw error;
  }
  assert.equal((await f.request()).status, 500);
  assert.equal((await put(f.request, envelope())).status, 500);
  await fs.unlink(path.dirname(f.trackingFile));
  await fs.mkdir(path.dirname(f.trackingFile));
  await fs.symlink(sentinel, f.trackingFile);
  assert.equal((await f.request()).status, 500);
  assert.equal((await put(f.request, envelope())).status, 500);
  await fs.unlink(f.trackingFile);
  const current = await (await put(f.request, envelope())).json();
  await fs.symlink(sentinel, `${f.trackingFile}.bak`);
  assert.equal((await put(f.request, current)).status, 500);
  assert.deepEqual(await (await f.request()).json(), current);
  assert.equal(await fs.readFile(sentinel, 'utf8'), sentinelBytes);
  assert.equal(await fs.readFile(f.researchFile, 'utf8'), f.researchBytes);
});

test('primeiro PUT rejeitado não cria pasta de acompanhamento', async t => {
  const f = await fixture(t);
  assert.equal((await put(f.request, envelope(), { headers: { origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await put(f.request, { schema: TRACKING_SCHEMA, revision: 0, records: 'invalid' })).status, 400);
  await assert.rejects(fs.stat(path.dirname(f.trackingFile)), { code: 'ENOENT' });
});
