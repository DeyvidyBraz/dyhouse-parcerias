import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildStandalone } from '../scripts/build-standalone.mjs';

const exec = promisify(execFile);

async function fixture(t, overrides = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), 'parcerias-bundle-test-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  await mkdir(join(projectDir, 'dist', 'dados'), { recursive: true });
  const files = {
    'index.html': '<!doctype html><html lang="pt-BR"><head><link href="./styles.css" rel="stylesheet"></head><body><script id="initial-data" type="application/json">{}</script><script src="./app.js" type="module"></script></body></html>',
    'styles.css': 'body { color: #123; }',
    'data-core.js': 'const privateLabel = "core";\nexport const FLAG = true;\nexport function ingestDatasets() { return privateLabel; }',
    'app.js': 'import { ingestDatasets, FLAG as feature } from "./data-core.js";\nconst privateLabel = "app";\nwindow.__ready = [ingestDatasets(), feature, privateLabel];',
    'dados/100_empreendimentos_parcerias_sp.json': JSON.stringify({ projects: [{ name: '</script><script>alert(1)</script>&\u2028' }], partners: [] }),
    ...overrides,
  };
  await Promise.all(Object.entries(files).map(([name, value]) => writeFile(join(projectDir, 'dist', name), value, 'utf8')));
  return projectDir;
}

test('HTML autônomo embute todos os recursos, escapa JSON e preserva escopos dos módulos', async t => {
  const projectDir = await fixture(t);
  const result = await buildStandalone({ projectDir });
  const html = await readFile(result.outputPath, 'utf8');
  assert.equal(result.projectCount, 1);
  assert.ok(result.bytes > 300);
  assert.ok(!html.includes('href="./styles.css"'));
  assert.ok(!html.includes('src="./app.js"'));
  assert.equal((html.match(/id="initial-data"/g) || []).length, 1);
  assert.equal((html.match(/<script\b/g) || []).length, 2);
  const dataset = html.match(/<script id="initial-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(dataset);
  assert.ok(!dataset.includes('<'));
  assert.equal(JSON.parse(dataset).datasets[0].payload.projects[0].name, '</script><script>alert(1)</script>&\u2028');
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(module);
  assert.ok(!/^\s*import\s/m.test(module));
  assert.ok(!/^\s*export\s/m.test(module));
  const checkFile = join(projectDir, 'bundle-check.mjs');
  await writeFile(checkFile, module);
  await exec(process.execPath, ['--check', checkFile]);
});

test('referências obrigatórias ausentes falham explicitamente', async t => {
  const projectDir = await fixture(t, { 'index.html': '<html><script src="./app.js" type="module"></script></html>' });
  await assert.rejects(() => buildStandalone({ projectDir }), /styles\.css/);
});

test('URLs versionadas do site continuam produzindo HTML autônomo sem rede', async t => {
  const projectDir = await fixture(t, {
    'index.html': '<html><head><link href="./styles.css?v=precos" rel="stylesheet"></head><body><script type="module" src="./app.js?v=precos"></script></body></html>',
    'app.js': 'import { ingestDatasets } from "./data-core.js?v=precos";\nwindow.__ready = ingestDatasets();',
  });
  const result = await buildStandalone({ projectDir });
  const html = await readFile(result.outputPath, 'utf8');
  assert.ok(!html.includes('?v=precos'));
  assert.ok(!/^\s*import\s/m.test(html));
  assert.ok(html.includes('body { color: #123; }'));
  assert.equal(result.projectCount, 1);
});

test('HTML autônomo preserva arquivos e namespaces separados ao embutir novos lotes e subpastas', async t => {
  const projectDir = await fixture(t);
  await mkdir(join(projectDir, 'dist', 'dados', 'novos'));
  await writeFile(join(projectDir, 'dist', 'dados', 'novos', 'barueri.JSON'), JSON.stringify({ projects: [{ id: 'E001', name: 'Barueri', partner_id: 'P01' }], partners: [{ id: 'P01', developer: 'Outra empresa' }] }));
  await writeFile(join(projectDir, 'dist', 'dados', 'ignorado.txt'), 'não é JSON');
  const result = await buildStandalone({ projectDir });
  const html = await readFile(result.outputPath, 'utf8');
  const payload = JSON.parse(html.match(/<script id="initial-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(result.datasetCount, 2);
  assert.equal(result.projectCount, 2);
  assert.equal(payload.bundle_schema, 'parcerias-explorer/datasets-v1');
  assert.equal(payload.datasets[1].fileName, 'novos/barueri.JSON');
  assert.equal(payload.datasets[1].payload.partners[0].developer, 'Outra empresa');
});

test('dependência externa inesperada é rejeitada no bundle autônomo', async t => {
  const projectDir = await fixture(t, {
    'app.js': 'import { ingestDatasets } from "./data-core.js";\nimport "https://example.com/external.js";\ningestDatasets();',
  });
  await assert.rejects(() => buildStandalone({ projectDir }), /módulos externos/);
});
