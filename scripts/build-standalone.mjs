import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultProjectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function localEntry(value, filename) {
  return value === filename || value === `./${filename}`;
}

function inlineScript(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

function safeJson(payload) {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function combineModules(core, app) {
  const imports = [];
  let importedCore = 0;
  const appWithoutCoreImport = app.replace(
    /\bimport\s*\{([^}]+)\}\s*from\s*(['"])\.\/data-core\.js\2\s*;?/g,
    (_full, bindings) => {
      importedCore += 1;
      for (const raw of bindings.split(',')) {
        const value = raw.trim();
        if (!value) continue;
        const match = value.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!match) throw new Error(`Importação de data-core não suportada: ${value}`);
        imports.push({ imported: match[1], local: match[2] || match[1] });
      }
      return '';
    },
  );
  if (importedCore !== 1 || imports.length === 0) {
    throw new Error('app.js deve importar uma lista de nomes de ./data-core.js exatamente uma vez.');
  }
  if (/^\s*import\s/m.test(core) || /^\s*import\s/m.test(appWithoutCoreImport)) {
    throw new Error('O HTML autônomo não pode depender de outros módulos externos.');
  }
  const coreWithoutExports = core
    .replace(/^([ \t]*)export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '$1')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  if (/^\s*export\b/m.test(coreWithoutExports)) {
    throw new Error('Exportação de data-core não suportada pelo gerador autônomo.');
  }
  const names = [...new Set(imports.map(binding => binding.imported))];
  const bindings = imports.map(binding => binding.local === binding.imported
    ? binding.imported : `${binding.imported}: ${binding.local}`);
  // Keep private module identifiers scoped: app.js can use names that also occur
  // privately in data-core without collisions after the bundle is generated.
  return `const { ${bindings.join(', ')} } = (() => {\n${coreWithoutExports}\nreturn { ${names.join(', ')} };\n})();\n\n${appWithoutCoreImport}`;
}

export async function buildStandalone(options = {}) {
  const projectDir = resolve(options.projectDir || defaultProjectDir);
  const outputPath = resolve(options.outputPath || join(projectDir, 'parcerias.html'));
  const dist = join(projectDir, 'dist');
  const [html, css, core, app] = await Promise.all([
    readFile(join(dist, 'index.html'), 'utf8'),
    readFile(join(dist, 'styles.css'), 'utf8'),
    readFile(join(dist, 'data-core.js'), 'utf8'),
    readFile(join(dist, 'app.js'), 'utf8'),
  ]);
  const datasets = [];
  async function collect(directory, prefix = '', depth = 0) {
    if (depth > 20) throw new Error('A pasta de dados excedeu 20 níveis.');
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    for (const entry of entries) {
      const fileName = prefix + entry.name;
      if (entry.isDirectory()) await collect(join(directory, entry.name), fileName + '/', depth + 1);
      else if (entry.isFile() && /\.json$/i.test(entry.name)) {
        const payload = JSON.parse((await readFile(join(directory, entry.name), 'utf8')).replace(/^\uFEFF/, ''));
        if (!Array.isArray(payload) && !Array.isArray(payload?.projects) && !Array.isArray(payload?.empreendimentos)) {
          throw new Error(`O arquivo ${fileName} precisa conter um array projects/empreendimentos ou ser um array.`);
        }
        datasets.push({ fileName, payload, lastModified: 0 });
      }
    }
  }
  await collect(join(dist, 'dados'));
  if (!datasets.length) throw new Error('Nenhum JSON de pesquisa foi encontrado em dist/dados.');
  const payload = { bundle_schema: 'parcerias-explorer/datasets-v1', datasets };
  let cssEntries = 0;
  let output = html.replace(/<link\b[^>]*>/gi, tag => {
    if (!localEntry(attribute(tag, 'href'), 'styles.css')) return tag;
    cssEntries += 1;
    return `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
  });
  if (cssEntries !== 1) throw new Error('index.html precisa de uma referência a styles.css.');

  // A placeholder may exist in the normal page. The generated file always uses
  // the current authoritative dataset, and keeps it as inert JSON text.
  output = output.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, tag =>
    attribute(tag.split('>')[0], 'id') === 'initial-data' ? '' : tag);
  const initialData = `<script id="initial-data" type="application/json">${safeJson(payload)}</script>`;
  const module = `<script type="module">\n${inlineScript(combineModules(core, app))}\n</script>`;
  let appEntries = 0;
  output = output.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, tag => {
    if (!localEntry(attribute(tag.split('>')[0], 'src'), 'app.js')) return tag;
    appEntries += 1;
    return `${initialData}\n${module}`;
  });
  if (appEntries !== 1) throw new Error('index.html precisa de uma referência a app.js.');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, 'utf8');
  return {
    outputPath,
    bytes: Buffer.byteLength(output),
    datasetCount: datasets.length,
    projectCount: datasets.reduce((total, file) => total + (Array.isArray(file.payload) ? file.payload : (file.payload.projects || file.payload.empreendimentos)).length, 0),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildStandalone().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    process.stderr.write(`Falha ao gerar parcerias.html: ${error.message}\n`);
    process.exitCode = 1;
  });
}
