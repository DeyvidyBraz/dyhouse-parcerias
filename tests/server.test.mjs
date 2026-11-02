import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import * as fs from 'node:fs/promises';
import { createAppServer, readDatasets, parseCliOptions, DEFAULT_FILE_LIMIT, DEFAULT_TOTAL_LIMIT } from '../server.mjs';

test('aceita os argumentos do preview gerenciado incluindo --strictPort', () => {
  const args = ['--host', '0.0.0.0', '--host', '0.0.0.0', '--port', '4173', '--strictPort'];
  assert.deepEqual(parseCliOptions(args, {}), { host: '0.0.0.0', port: 4173 });
  assert.deepEqual(parseCliOptions([], {}), { host: '127.0.0.1', port: 8080 });
  assert.deepEqual(parseCliOptions(['--strictPort', '--port=9090'], { HOST: 'localhost', PORT: '8081' }), { host: 'localhost', port: 9090 });
  assert.throws(() => parseCliOptions(['--unexpected'], {}), /Argumento não reconhecido/);
  assert.throws(() => parseCliOptions(['--port', '70000'], {}), /porta deve ser/);
});

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'parcerias-server-'));
  const publicDir = path.join(root, 'dist');
  const dataDir = path.join(publicDir, 'dados');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>Consulta</title>');
  const server = createAppServer({ publicDir, dataDir, ...options });
  // Execute the real HTTP request handler without opening a port. The managed
  // test environment rejects listen(); production still uses node:http normally.
  const request = (requestPath = '/', init = {}) => new Promise(resolve => {
    const headers = new Map();
    const response = {
      headersSent: false,
      statusCode: 200,
      setHeader(name, value) { headers.set(name, String(value)); },
      writeHead(status, values) {
        this.statusCode = status;
        this.headersSent = true;
        for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
      },
      end(body) {
        resolve(new Response(init.method === 'HEAD' ? null : body, {
          status: this.statusCode,
          headers: Object.fromEntries(headers),
        }));
      },
    };
    server.emit('request', { url: requestPath, method: init.method || 'GET' }, response);
  });
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, publicDir, dataDir, request };
}

async function getDatasets(request) {
  const response = await request('/api/datasets');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  return response.json();
}

test('descobre JSON de subpastas, aceita BOM e extensão em maiúsculas e ignora outros tipos', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.dataDir, 'novembro'));
  await fs.writeFile(path.join(f.dataDir, 'base.json'), JSON.stringify({ projects: [{ name: 'Ares' }], partners: [] }));
  await fs.writeFile(path.join(f.dataDir, 'novembro', 'lote.JSON'), '\ufeff' + JSON.stringify({ projects: [{ name: 'Leven' }] }));
  await fs.writeFile(path.join(f.dataDir, 'ignorar.csv'), 'name\nSem importar');
  const result = await getDatasets(f.request);
  assert.equal(result.mode, 'server-folder');
  assert.equal(result.folder, 'dados/');
  assert.deepEqual(result.files.map(file => file.fileName), ['base.json', 'novembro/lote.JSON']);
  assert.equal(result.files[1].payload.projects[0].name, 'Leven');
  assert.equal(typeof result.files[0].lastModified, 'number');
  assert.equal(result.errors.length, 0);
});

test('reencontra arquivos adicionados, alterados e removidos sem reiniciar o servidor', async t => {
  const f = await fixture(t);
  assert.equal((await getDatasets(f.request)).files.length, 0);
  await fs.writeFile(path.join(f.dataDir, 'novo.json'), JSON.stringify({ projects: [{ name: 'Primeira versão' }] }));
  assert.equal((await getDatasets(f.request)).files[0].payload.projects[0].name, 'Primeira versão');
  await fs.writeFile(path.join(f.dataDir, 'novo.json'), JSON.stringify({ projects: [{ name: 'Atualizado' }] }));
  assert.equal((await getDatasets(f.request)).files[0].payload.projects[0].name, 'Atualizado');
  await fs.unlink(path.join(f.dataDir, 'novo.json'));
  assert.equal((await getDatasets(f.request)).files.length, 0);
});

test('JSON inválido gera aviso individual e preserva lotes válidos', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dataDir, 'bom.json'), '{"projects":[]}');
  await fs.writeFile(path.join(f.dataDir, 'ruim.json'), '{"projects": [}');
  const result = await getDatasets(f.request);
  assert.deepEqual(result.files.map(file => file.fileName), ['bom.json']);
  assert.equal(result.errors[0].fileName, 'ruim.json');
  assert.match(result.errors[0].message, /JSON inválido/);
  assert.ok(!JSON.stringify(result.errors).includes(f.root));
});

test('limites por arquivo e por leitura protegem a ingestão sem ocultar erros', async t => {
  assert.equal(DEFAULT_FILE_LIMIT, 10 * 1024 * 1024);
  assert.equal(DEFAULT_TOTAL_LIMIT, 50 * 1024 * 1024);
  const f = await fixture(t, { maxFileBytes: 40, maxTotalBytes: 60 });
  await fs.writeFile(path.join(f.dataDir, 'a.json'), JSON.stringify({ value: 'a'.repeat(20) }));
  await fs.writeFile(path.join(f.dataDir, 'b.json'), JSON.stringify({ value: 'b'.repeat(20) }));
  await fs.writeFile(path.join(f.dataDir, 'grande.json'), JSON.stringify({ value: 'x'.repeat(50) }));
  const result = await getDatasets(f.request);
  assert.equal(result.files.length, 1);
  assert.deepEqual(result.errors.map(error => error.fileName), ['b.json', 'grande.json']);
  assert.match(result.errors[0].message, /por leitura/);
  assert.match(result.errors[1].message, /por arquivo/);
});

test('não segue links simbólicos de arquivo ou diretório', async t => {
  const f = await fixture(t);
  const external = path.join(f.root, 'segredo.json');
  const externalDir = path.join(f.root, 'fora');
  await fs.mkdir(externalDir);
  await fs.writeFile(external, '{"secret":true}');
  await fs.writeFile(path.join(externalDir, 'privado.json'), '{"secret":true}');
  try {
    await fs.symlink(external, path.join(f.dataDir, 'atalho.json'));
    await fs.symlink(externalDir, path.join(f.dataDir, 'pasta-atalho'), 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Ambiente sem permissão para criar symlinks.'); return; }
    throw error;
  }
  const result = await getDatasets(f.request);
  assert.equal(result.files.length, 0);
  assert.equal(result.errors.length, 2);
  assert.equal((await f.request('/dados/atalho.json')).status, 403);
  assert.equal((await f.request('/dados/pasta-atalho/privado.json')).status, 403);
});

test('bloqueia path traversal literal, codificado e com separador Windows', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'segredo.txt'), 'não expor');
  for (const requestPath of ['/../segredo.txt', '/%2e%2e/segredo.txt', '/%2e%2e%2fsegredo.txt', '/..%5csegredo.txt']) {
    const result = await f.request(requestPath);
    assert.ok([400, 403].includes(result.status), `${requestPath}: ${result.status}`);
    assert.ok(!(await result.text()).includes('não expor'));
  }
  assert.equal((await f.request('/%ZZ')).status, 400);
});

test('serve HTML/JS/CSS/JSON com MIME correto, aceita HEAD e rejeita escrita', async t => {
  const f = await fixture(t);
  const cases = [['app.js', 'export const ok=true;', 'text/javascript'], ['styles.css', 'body{}', 'text/css'], ['dados/a.json', '{"projects":[]}', 'application/json']];
  for (const [name, value, mime] of cases) {
    await fs.writeFile(path.join(f.publicDir, name), value);
    const response = await f.request(`/${name}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(mime));
    assert.equal(await response.text(), value);
  }
  const index = await f.request('/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const head = await f.request('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await f.request('/api/datasets', { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await f.request('/server.mjs')).status, 404);
  assert.equal((await f.request('/api/unknown')).status, 404);
});

test('pasta ausente devolve instrução recuperável', async () => {
  const result = await readDatasets(path.join(os.tmpdir(), 'parcerias-pasta-inexistente-376925'));
  assert.equal(result.files.length, 0);
  assert.match(result.errors[0].message, /Pasta dados\/ não encontrada/);
});
