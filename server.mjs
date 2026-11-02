import http from 'node:http';
import path from 'node:path';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FILE_LIMIT = 10 * 1024 * 1024;
export const DEFAULT_TOTAL_LIMIT = 50 * 1024 * 1024;
export const TRACKING_SCHEMA = 'dyhouse-partnership-tracking/v1';
export const TRACKING_FILE_LIMIT = 10 * 1024 * 1024;
const trackingWrites = new Map();
const MAX_DEPTH = 20;
const MAX_JSON_FILES = 2000;
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function within(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function relativeName(base, candidate) {
  return path.relative(base, candidate).split(path.sep).join('/');
}

async function noSymlinkPath(base, target) {
  if (!within(base, target)) return false;
  let current = base;
  if ((await fs.lstat(current)).isSymbolicLink()) return false;
  for (const part of path.relative(base, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) return false;
  }
  const [actualBase, actualTarget] = await Promise.all([fs.realpath(base), fs.realpath(target)]);
  return within(actualBase, actualTarget);
}

function limitDescription(bytes) {
  return `${Math.round(bytes / (1024 * 1024) * 100) / 100} MB`;
}

/** Discover JSON files on every call. Imported data never changes the source files. */
export async function readDatasets(dataDir, options = {}) {
  const base = path.resolve(dataDir);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_FILE_LIMIT;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_TOTAL_LIMIT;
  const files = [];
  const errors = [];
  const candidates = [];
  let traversalStopped = false;

  try {
    const rootStat = await fs.lstat(base);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return { mode: 'server-folder', folder: 'dados/', files, errors: [{ fileName: 'dados/', message: 'A pasta de dados deve ser uma pasta real; links simbólicos não são seguidos.' }] };
    }
  } catch (error) {
    return {
      mode: 'server-folder', folder: 'dados/', files,
      errors: [{ fileName: 'dados/', message: error.code === 'ENOENT' ? 'Pasta dados/ não encontrada. Crie dist/dados/ e coloque os arquivos JSON nela.' : 'Não foi possível abrir a pasta dados/.' }],
    };
  }

  async function visit(directory, depth) {
    if (traversalStopped) return;
    if (depth > MAX_DEPTH) {
      errors.push({ fileName: relativeName(base, directory), message: 'Subpasta ignorada: limite de profundidade excedido.' });
      return;
    }
    let entries;
    try {
      if (!await noSymlinkPath(base, directory)) {
        errors.push({ fileName: relativeName(base, directory) || 'dados/', message: 'Link simbólico ignorado.' });
        return;
      }
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      errors.push({ fileName: relativeName(base, directory) || 'dados/', message: 'Não foi possível ler esta subpasta.' });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    for (const entry of entries) {
      if (traversalStopped) break;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        errors.push({ fileName: relativeName(base, absolute), message: 'Link simbólico ignorado.' });
      } else if (entry.isDirectory()) {
        await visit(absolute, depth + 1);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') {
        if (candidates.length >= MAX_JSON_FILES) {
          errors.push({ fileName: 'dados/', message: `A leitura foi limitada a ${MAX_JSON_FILES} arquivos JSON.` });
          traversalStopped = true;
          break;
        }
        candidates.push(absolute);
      }
    }
  }
  await visit(base, 0);
  candidates.sort((a, b) => relativeName(base, a).localeCompare(relativeName(base, b), 'pt-BR'));

  let totalReadBytes = 0;
  for (const absolute of candidates) {
    const fileName = relativeName(base, absolute);
    let handle;
    try {
      if (!await noSymlinkPath(base, absolute)) {
        errors.push({ fileName, message: 'Link simbólico ou caminho externo ignorado.' });
        continue;
      }
      handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile()) continue;
      if (info.size > maxFileBytes) {
        errors.push({ fileName, message: `Arquivo ignorado: limite de ${limitDescription(maxFileBytes)} por arquivo.` });
        continue;
      }
      if (totalReadBytes + info.size > maxTotalBytes) {
        errors.push({ fileName, message: `Arquivo ignorado: limite de ${limitDescription(maxTotalBytes)} por leitura.` });
        continue;
      }
      // A bounded read also protects against a file growing after stat().
      const bytes = Buffer.alloc(Math.min(info.size, maxFileBytes, maxTotalBytes - totalReadBytes) + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > info.size || offset > maxFileBytes || totalReadBytes + offset > maxTotalBytes) {
        errors.push({ fileName, message: 'Arquivo alterado durante a leitura. Clique em Atualizar para reler a versão completa.' });
        continue;
      }
      totalReadBytes += offset;
      let payload;
      try {
        payload = JSON.parse(bytes.subarray(0, offset).toString('utf8').replace(/^\uFEFF/, ''));
      } catch {
        errors.push({ fileName, message: 'JSON inválido. Corrija a sintaxe e clique em Atualizar.' });
        continue;
      }
      files.push({ fileName, payload, lastModified: Math.trunc(info.mtimeMs) });
    } catch (error) {
      errors.push({ fileName, message: error.code === 'ENOENT' ? 'Arquivo removido durante a leitura; tente Atualizar novamente.' : 'Não foi possível ler este arquivo.' });
    } finally {
      await handle?.close();
    }
  }
  return { mode: 'server-folder', folder: 'dados/', files, errors };
}

function send(response, status, body, contentType = 'application/json; charset=utf-8', method = 'GET') {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  response.end(method === 'HEAD' ? undefined : bytes);
}

function sendError(response, status, message, method) {
  send(response, status, JSON.stringify({ error: message }), 'application/json; charset=utf-8', method);
}

class TrackingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function emptyTracking() {
  return { schema: TRACKING_SCHEMA, revision: 0, records: [] };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value) {
  if (typeof value !== 'string' || value.length > 40) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hours, minutes, seconds] = match.map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day && hours < 24 && minutes < 60 && seconds < 60;
}

/** Validate before writing and after reading. Optional extension fields survive. */
export function validateTracking(payload) {
  const fail = message => { throw new TrackingError(400, `Acompanhamento inválido: ${message}`); };
  let nodes = 0;
  const inspect = (value, depth = 0) => {
    if (++nodes > 300000 || depth > 40) fail('estrutura muito extensa ou profunda.');
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('chave não permitida.');
        inspect(value[key], depth + 1);
      }
    }
  };
  inspect(payload);
  const string = (value, label, max = 10000, empty = true) => {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${label} deve ser texto válido.`);
  };
  const strings = (value, label, maxItems = 256) => {
    if (!Array.isArray(value) || value.length > maxItems) fail(`${label} deve ser uma lista limitada.`);
    for (const item of value) string(item, label, 10000);
  };
  if (!isObject(payload) || payload.schema !== TRACKING_SCHEMA) fail('esquema não reconhecido.');
  if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) fail('revision deve ser inteiro não negativo.');
  if (!Array.isArray(payload.records) || payload.records.length > 20000) fail('records deve ser uma lista de até 20000 registros.');
  const projectKeys = new Set();
  for (const record of payload.records) {
    if (!isObject(record)) fail('cada registro deve ser um objeto.');
    string(record.projectKey, 'projectKey', 10000, false);
    if (projectKeys.has(record.projectKey)) fail('projectKey duplicado.');
    projectKeys.add(record.projectKey);
    strings(record.aliases, 'aliases');
    if (!['nao_solicitada', 'solicitada', 'feita'].includes(record.status)) fail('status não reconhecido.');
    if (!validDate(record.updatedAt)) fail('updatedAt deve ser uma data ISO válida.');
    string(record.projectName, 'projectName');
    string(record.city, 'city');
    for (const field of ['statusUpdatedAt', 'requestedAt', 'completedAt']) {
      if (['requestedAt', 'completedAt'].includes(field) && record[field] === '') continue;
      if (record[field] !== undefined && !validDate(record[field])) fail(`${field} deve ser uma data ISO válida.`);
    }
    if (!Array.isArray(record.events) || record.events.length > 20000) fail('events deve ser uma lista de até 20000 eventos.');
    const eventIds = new Set();
    for (const event of record.events) {
      if (!isObject(event)) fail('cada evento deve ser um objeto.');
      string(event.id, 'id do evento', 1000, false);
      if (eventIds.has(event.id)) fail('id de evento duplicado no mesmo registro.');
      eventIds.add(event.id);
      if (!validDate(event.createdAt)) fail('createdAt deve ser uma data ISO válida.');
      string(event.text, 'texto do evento', 100000);
      if (event.kind !== undefined && !['note', 'status'].includes(event.kind)) fail('kind de evento não reconhecido.');
    }
    if (record.identities !== undefined) {
      if (!Array.isArray(record.identities) || record.identities.length > 256) fail('identities deve ser uma lista limitada.');
      for (const identity of record.identities) {
        if (!isObject(identity)) fail('cada identidade deve ser um objeto.');
        for (const field of ['name', 'city', 'address', 'url', 'suffix']) string(identity[field], `identities.${field}`);
        strings(identity.companies, 'identities.companies');
      }
    }
  }
  return payload;
}

/** No tracking files are created by GET or startup; no symlinks are followed. */
async function trackingPathState(projectRoot, filename, createDirectories = false) {
  const parts = path.relative(projectRoot, path.dirname(filename)).split(path.sep).filter(Boolean);
  let directory = projectRoot;
  const rootInfo = await fs.lstat(directory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new TrackingError(500, 'Pasta de acompanhamento indisponível: links simbólicos não são permitidos.');
  for (const part of parts) {
    directory = path.join(directory, part);
    let info;
    try { info = await fs.lstat(directory); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!createDirectories) return false;
      try { await fs.mkdir(directory, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      info = await fs.lstat(directory);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new TrackingError(500, 'Pasta de acompanhamento indisponível: links simbólicos não são permitidos.');
  }
  if (!await noSymlinkPath(projectRoot, directory)) throw new TrackingError(500, 'Caminho de acompanhamento não permitido.');
  try {
    const info = await fs.lstat(filename);
    if (info.isSymbolicLink() || !info.isFile()) throw new TrackingError(500, 'Arquivo de acompanhamento indisponível: use um arquivo regular sem links simbólicos.');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readTracking(projectRoot, filename) {
  let handle;
  try {
    if (!await trackingPathState(projectRoot, filename)) return { tracking: emptyTracking(), bytes: null };
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size > TRACKING_FILE_LIMIT) throw new Error('invalid file');
    const bytes = Buffer.alloc(Math.min(info.size, TRACKING_FILE_LIMIT) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== info.size || length > TRACKING_FILE_LIMIT) throw new Error('changed file');
    const content = bytes.subarray(0, length);
    const tracking = validateTracking(JSON.parse(content.toString('utf8').replace(/^\uFEFF/, '')));
    return { tracking, bytes: content };
  } catch (error) {
    if (error instanceof TrackingError && error.status === 500) throw error;
    throw new TrackingError(500, 'Não foi possível ler o acompanhamento existente. O arquivo foi preservado; verifique o JSON, as permissões ou restaure o backup antes de salvar.');
  } finally {
    await handle?.close();
  }
}

async function atomicTrackingWrite(projectRoot, filename, bytes) {
  await trackingPathState(projectRoot, filename, true);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await trackingPathState(projectRoot, filename, true);
    await fs.rename(temporary, filename);
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function withTrackingWrite(filename, operation) {
  const previous = trackingWrites.get(filename) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  trackingWrites.set(filename, current);
  try { return await current; }
  finally { if (trackingWrites.get(filename) === current) trackingWrites.delete(filename); }
}

function validateTrackingRequest(request) {
  const headers = request.headers ?? {};
  const contentType = headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(contentType.trim())) {
    throw new TrackingError(415, 'Use Content-Type application/json para salvar o acompanhamento.');
  }
  const host = headers.host;
  const origin = headers.origin;
  // Fetch Metadata is omitted for non-trustworthy HTTP origins (including the
  // managed terminal.local preview). Origin and Host remain mandatory and must
  // match exactly; when supplied, metadata may only affirm same-origin.
  const fetchSite = headers['sec-fetch-site'];
  if (typeof host !== 'string' || typeof origin !== 'string' || (fetchSite !== undefined && fetchSite !== 'same-origin') || /[\s,/@?#\\]/.test(host)) {
    throw new TrackingError(403, 'A gravação só é permitida a partir da mesma origem desta página.');
  }
  try {
    const parsedOrigin = new URL(origin);
    const parsedHost = new URL(`${parsedOrigin.protocol}//${host}`);
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin || parsedOrigin.username || parsedOrigin.password || parsedOrigin.host !== parsedHost.host) throw new Error('origin');
  } catch {
    throw new TrackingError(403, 'A gravação só é permitida a partir da mesma origem desta página.');
  }
}

async function readTrackingRequest(request) {
  const length = request.headers?.['content-length'];
  if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length))) throw new TrackingError(400, 'Tamanho de requisição inválido.');
  if (length !== undefined && +length > TRACKING_FILE_LIMIT) {
    request.resume?.();
    throw new TrackingError(413, 'O acompanhamento excede o limite de 10 MB.');
  }
  let total = 0;
  const chunks = [];
  try {
    const source = request.iterator ? request.iterator({ destroyOnReturn: false }) : request;
    for await (const chunk of source) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > TRACKING_FILE_LIMIT) {
        request.resume?.();
        throw new TrackingError(413, 'O acompanhamento excede o limite de 10 MB.');
      }
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof TrackingError) throw error;
    throw new TrackingError(400, 'Requisição de acompanhamento incompleta.');
  }
  if (length !== undefined && total !== +length) throw new TrackingError(400, 'Requisição de acompanhamento incompleta.');
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks, total).toString('utf8')); }
  catch { throw new TrackingError(400, 'JSON de acompanhamento inválido.'); }
  return validateTracking(payload);
}

async function handleTracking(request, response, projectRoot, trackingFile) {
  if (!['GET', 'HEAD', 'PUT'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD, PUT');
    sendError(response, 405, 'Método não permitido.', request.method);
    return;
  }
  try {
    if (request.method !== 'PUT') {
      const { tracking } = await readTracking(projectRoot, trackingFile);
      send(response, 200, JSON.stringify(tracking), 'application/json; charset=utf-8', request.method);
      return;
    }
    validateTrackingRequest(request);
    const incoming = await readTrackingRequest(request);
    const result = await withTrackingWrite(trackingFile, async () => {
      const current = await readTracking(projectRoot, trackingFile);
      if (incoming.revision !== current.tracking.revision) return { conflict: current.tracking };
      if (incoming.revision === Number.MAX_SAFE_INTEGER) throw new TrackingError(500, 'Limite de revisão atingido; o arquivo foi preservado.');
      const next = { ...incoming, revision: incoming.revision + 1 };
      const bytes = Buffer.from(JSON.stringify(next));
      if (bytes.length > TRACKING_FILE_LIMIT) throw new TrackingError(413, 'O acompanhamento excede o limite de 10 MB.');
      // A previous validated revision is backed up before replacing the main file.
      if (current.bytes !== null) await atomicTrackingWrite(projectRoot, `${trackingFile}.bak`, current.bytes);
      await atomicTrackingWrite(projectRoot, trackingFile, bytes);
      return { tracking: next };
    });
    if (result.conflict) {
      send(response, 409, JSON.stringify({ error: 'O acompanhamento mudou em outra sessão. Recarregue e una as alterações antes de salvar.', tracking: result.conflict }));
    } else {
      send(response, 200, JSON.stringify(result.tracking));
    }
  } catch (error) {
    sendError(response, error instanceof TrackingError ? error.status : 500, error instanceof TrackingError ? error.message : 'Não foi possível salvar o acompanhamento. A pesquisa original não foi alterada; tente novamente.', request.method);
  }
}

/** Return an unstarted HTTP server, allowing CLI use and isolated integration tests. */
export function createAppServer(options = {}) {
  const publicDir = path.resolve(options.publicDir ?? path.join(ROOT, 'dist'));
  const dataDir = path.resolve(options.dataDir ?? path.join(publicDir, 'dados'));
  const projectRoot = path.dirname(publicDir);
  const trackingFile = path.resolve(options.trackingFile ?? path.join(projectRoot, 'acompanhamento', 'parcerias-acompanhamento.json'));
  if (!within(projectRoot, trackingFile) || trackingFile === projectRoot || within(publicDir, trackingFile) || within(dataDir, trackingFile)) {
    throw new Error('O arquivo de acompanhamento deve ficar dentro do projeto e fora das pastas públicas e de pesquisa.');
  }
  return http.createServer(async (request, response) => {
    try {
      const rawPath = (request.url ?? '/').split('?')[0];
      let pathname;
      try { pathname = decodeURIComponent(rawPath); }
      catch { sendError(response, 400, 'Endereço inválido.', request.method); return; }
      if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\') || pathname.includes('\0')) {
        sendError(response, 400, 'Endereço inválido.', request.method);
        return;
      }
      if (pathname.split('/').some(part => part === '..' || part === '.')) {
        sendError(response, 403, 'Caminho não permitido.', request.method);
        return;
      }
      if (pathname === '/api/tracking') {
        await handleTracking(request, response, projectRoot, trackingFile);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        sendError(response, 405, 'Método não permitido.', request.method);
        return;
      }
      if (pathname === '/api/datasets') {
        const result = await readDatasets(dataDir, options);
        send(response, 200, JSON.stringify(result), 'application/json; charset=utf-8', request.method);
        return;
      }
      if (pathname.startsWith('/api/')) {
        sendError(response, 404, 'Rota não encontrada.', request.method);
        return;
      }
      const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const absolute = path.resolve(publicDir, `.${relative}`);
      if (!within(publicDir, absolute)) {
        sendError(response, 403, 'Caminho não permitido.', request.method);
        return;
      }
      try {
        if (!await noSymlinkPath(publicDir, absolute)) {
          sendError(response, 403, 'Links simbólicos não são servidos.', request.method);
          return;
        }
        const extension = path.extname(absolute).toLowerCase();
        const contentType = MIME_TYPES.get(extension);
        if (!contentType) {
          sendError(response, 404, 'Arquivo não encontrado.', request.method);
          return;
        }
        const handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let bytes;
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > DEFAULT_TOTAL_LIMIT) {
            sendError(response, 404, 'Arquivo não encontrado.', request.method);
            return;
          }
          bytes = await handle.readFile();
        } finally {
          await handle.close();
        }
        send(response, 200, bytes, contentType, request.method);
      } catch (error) {
        sendError(response, error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 403, 'Arquivo não encontrado ou acesso indisponível.', request.method);
      }
    } catch {
      if (!response.headersSent) sendError(response, 500, 'Não foi possível concluir a leitura. Tente novamente.', request.method);
      else response.end();
    }
  });
}

export function parseCliOptions(args = process.argv.slice(2), environment = process.env) {
  const values = { host: environment.HOST || '127.0.0.1', port: environment.PORT || '8080' };
  for (let i = 0; i < args.length; i++) {
    // The managed preview injects this flag. This server already fails rather
    // than choosing another port when the requested address is occupied.
    if (args[i] === '--strictPort') continue;
    const match = args[i].match(/^--(host|port)(?:=(.*))?$/);
    if (!match) throw new Error(`Argumento não reconhecido: ${args[i]}`);
    const value = match[2] ?? args[++i];
    if (!value) throw new Error(`Falta o valor de --${match[1]}.`);
    values[match[1]] = value;
  }
  if (!/^\d+$/.test(values.port) || +values.port > 65535) throw new Error('A porta deve ser um número de 0 a 65535.');
  return { host: values.host, port: +values.port };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { host, port } = parseCliOptions();
    const server = createAppServer();
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `Porta ${port} em uso. Tente: node server.mjs --port 8081` : `Não foi possível iniciar: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      const actualPort = server.address().port;
      const shownHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
      console.log(`Parcerias SP: http://${shownHost.includes(':') ? `[${shownHost}]` : shownHost}:${actualPort}`);
      console.log('Dados: dist/dados/ — adicione arquivos .json e clique em Atualizar na página.');
      console.log('Pressione Ctrl+C para encerrar.');
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => server.close(() => { process.exitCode = 0; }));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
