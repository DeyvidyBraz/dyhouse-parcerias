import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ingestDatasets, TRACKING_SCHEMA } from '../dist/data-core.js';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trackingKeys = new Set(['partnership_tracking', 'partnershipTracking', 'partnership_timeline']);

function assertResearchOnly(value, fileName) {
  if (!value || typeof value !== 'object') return;
  assert.notEqual(value.schema, TRACKING_SCHEMA, `${fileName}: acompanhamento privado não deve ser publicado.`);
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!trackingKeys.has(key), `${fileName}: campo de acompanhamento ${key} não deve ser publicado.`);
    assertResearchOnly(child, fileName);
  }
}

async function localDatasets(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fileName = prefix + entry.name;
    assert.ok(!entry.isSymbolicLink(), `${fileName}: use arquivos regulares de pesquisa.`);
    if (entry.isDirectory()) files.push(...await localDatasets(join(directory, entry.name), `${fileName}/`));
    else if (entry.isFile() && /\.json$/i.test(entry.name)) {
      const payload = JSON.parse((await readFile(join(directory, entry.name), 'utf8')).replace(/^\uFEFF/, ''));
      assert.ok(Array.isArray(payload) || Array.isArray(payload?.projects) || Array.isArray(payload?.empreendimentos), `${fileName}: formato de pesquisa não reconhecido.`);
      assertResearchOnly(payload, fileName);
      files.push({ fileName, payload });
    }
  }
  return files;
}

/** Compara o site realmente publicado com todos os JSON locais, sem alterar dados. */
export async function verifyPages(siteUrl, { fetchImpl = fetch, dataDir = join(projectDir, 'dist', 'dados') } = {}) {
  const site = new URL(siteUrl);
  assert.ok(['https:', 'http:'].includes(site.protocol), 'Informe a URL HTTP(S) do site.');
  site.search = '';
  site.hash = '';
  if (!site.pathname.endsWith('/')) site.pathname += '/';
  const app = site.pathname.endsWith('/dist/') ? site : new URL('dist/', site);
  const manifestUrl = new URL('datasets.manifest.json', app);
  const dataBase = new URL('dados/', app);
  const expected = await localDatasets(dataDir);
  assert.ok(expected.length > 0, 'Nenhum arquivo local de pesquisa encontrado.');

  async function getJson(url) {
    const response = await fetchImpl(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200, `${url}: HTTP ${response.status}.`);
    return response.json();
  }

  const manifest = await getJson(manifestUrl);
  assert.equal(manifest.schemaVersion, 1, 'Versão inesperada do catálogo publicado.');
  assert.ok(Array.isArray(manifest.files), 'O catálogo publicado não contém uma lista de arquivos.');
  assert.ok(manifest.files.length <= 2000, 'O painel aceita até 2.000 arquivos por leitura.');
  assert.deepEqual(
    manifest.files.map(file => file.fileName).sort(),
    expected.map(file => file.fileName).sort(),
    'O catálogo publicado deve conter todos os JSON de dist/dados/. Aguarde o build do Pages e verifique nomes iniciados em ., _ ou #.',
  );

  const expectedByName = new Map(expected.map(file => [file.fileName, file.payload]));
  const published = [];
  for (const file of manifest.files) {
    const url = new URL(file.url, app);
    const encodedName = file.fileName.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const expectedUrl = new URL(encodedName, dataBase);
    assert.equal(url.origin, app.origin, `${file.fileName}: URL fora do site.`);
    assert.equal(url.search, '', `${file.fileName}: caminho com query inesperada.`);
    assert.equal(url.hash, '', `${file.fileName}: caminho com fragmento inesperado.`);
    // Different valid percent encodings are equivalent, including Ruby CGI's escaping of apostrophes.
    assert.equal(decodeURIComponent(url.pathname), decodeURIComponent(expectedUrl.pathname), `${file.fileName}: caminho incorreto.`);
    const payload = await getJson(url);
    assertResearchOnly(payload, file.fileName);
    assert.deepEqual(payload, expectedByName.get(file.fileName), `${file.fileName}: conteúdo publicado difere do arquivo local.`);
    published.push({ fileName: file.fileName, payload, lastModified: 0 });
  }
  const model = ingestDatasets(published);
  assert.ok(model.files.every(file => file.valid), 'Há arquivo de pesquisa que o painel não conseguiu importar.');
  return {
    site: app.href,
    manifest: manifestUrl.href,
    files: published.length,
    projects: model.projects.length,
    partners: model.partners.length,
    cities: [...new Set(model.projects.map(project => project.city).filter(Boolean))].sort(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) {
    process.stderr.write('Uso: node scripts/verify-pages.mjs https://USUARIO.github.io/dyhouse-parcerias/\n');
    process.exitCode = 1;
  } else {
    verifyPages(process.argv[2]).then(result => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }).catch(error => {
      process.stderr.write(`Falha na verificação do GitHub Pages: ${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
