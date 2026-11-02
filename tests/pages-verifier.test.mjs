import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyPages } from '../scripts/verify-pages.mjs';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'parcerias-pages-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('verificador publicado aceita subpasta e nome codificado e detecta novo JSON ainda não publicado', async t => {
  const dataDir = await fixture(t);
  await mkdir(join(dataDir, 'lote sul'));
  const fileName = 'lote sul/Água #1? 100% "A".JSON';
  const payload = { projects: [{ id: 'E01', name: 'Água', city: 'São Paulo', developer: 'Exemplo' }], partners: [] };
  await writeFile(join(dataDir, fileName), JSON.stringify(payload));
  await writeFile(join(dataDir, 'ignorar.txt'), 'não é pesquisa JSON');
  const manifest = {
    schemaVersion: 1,
    files: [{ fileName, url: './dados/lote%20sul/%C3%81gua%20%231%3F%20100%25%20%22A%22.JSON' }],
  };
  const requested = [];
  const fetchImpl = async input => {
    const url = new URL(input);
    requested.push(url.href);
    if (url.pathname === '/dyhouse-parcerias/dist/datasets.manifest.json') return Response.json(manifest);
    if (url.pathname === '/dyhouse-parcerias/dist/dados/lote%20sul/%C3%81gua%20%231%3F%20100%25%20%22A%22.JSON') return Response.json(payload);
    return new Response(null, { status: 404 });
  };
  const result = await verifyPages('https://example.test/dyhouse-parcerias', { dataDir, fetchImpl });
  assert.equal(result.files, 1);
  assert.equal(result.projects, 1);
  assert.deepEqual(result.cities, ['São Paulo']);
  assert.equal(requested.length, 2);
  await writeFile(join(dataDir, 'futuro.json'), JSON.stringify({ projects: [], partners: [] }));
  await assert.rejects(verifyPages('https://example.test/dyhouse-parcerias/dist/', { dataDir, fetchImpl }), /todos os JSON/);
});

test('verificador rejeita acompanhamento antes de consultar o site e detecta caminho ou conteúdo incorreto', async t => {
  const dataDir = await fixture(t);
  const fileName = 'base.json';
  const payload = { projects: [{ name: 'Alfa', city: 'Barueri' }], partners: [] };
  await writeFile(join(dataDir, fileName), JSON.stringify({ ...payload, partnership_tracking: { records: [] } }));
  let calls = 0;
  await assert.rejects(verifyPages('https://example.test/repo/', {
    dataDir,
    fetchImpl: async () => { calls += 1; throw new Error('Não deveria consultar a rede.'); },
  }), /acompanhamento/);
  assert.equal(calls, 0);

  await writeFile(join(dataDir, fileName), JSON.stringify(payload));
  const manifest = { schemaVersion: 1, files: [{ fileName, url: './base.json' }] };
  const fetchImpl = async input => new URL(input).pathname.endsWith('/datasets.manifest.json')
    ? Response.json(manifest) : Response.json({ projects: [], partners: [] });
  await assert.rejects(verifyPages('https://example.test/repo/', { dataDir, fetchImpl }), /caminho incorreto/);
  manifest.files[0].url = './dados/base.json';
  await assert.rejects(verifyPages('https://example.test/repo/', { dataDir, fetchImpl }), /conteúdo publicado difere/);
});
