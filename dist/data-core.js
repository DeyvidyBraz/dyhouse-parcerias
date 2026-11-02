/**
 * Importação e conciliação de pesquisas de empreendimentos.
 * Sem dependências, DOM, rede, armazenamento ou execução de conteúdo importado.
 * IDs E001/P01 pertencem apenas ao arquivo que os declara.
 */

export const MCMV_LABELS = Object.freeze({
  sim_fonte_oficial: 'Sim — fonte oficial / release',
  sim_fonte_comercial: 'Sim — fonte comercial',
  sim_sem_fonte: 'Sim — fonte não especificada',
  nao_inferencia_preco: 'Não — inferência por preço',
  nao_declarado: 'Não — declaração da fonte',
  a_confirmar: 'A confirmar',
});
export const STAGE_LABELS = Object.freeze({
  pre_lancamento: 'Pré-lançamento',
  lancamento: 'Lançamento',
  em_obras: 'Em obras',
  pronto: 'Pronto / entregue',
  a_confirmar: 'A confirmar',
});
export const AI_LABELS = Object.freeze({
  assistida: 'Solicitação assistida',
  intervencao_humana: 'Etapa humana necessária',
  a_confirmar: 'A confirmar',
});
export const PARTNERSHIP_STATUS_LABELS = Object.freeze({
  nao_solicitada: 'Não solicitada', solicitada: 'Parceria solicitada', feita: 'Parceria feita',
});
export const TRACKING_SCHEMA = 'dyhouse-partnership-tracking/v1';
export const PRICE_KIND_LABELS = Object.freeze({
  a_partir_de: 'A partir de', faixa: 'Faixa anunciada', unidade_anunciada: 'Unidade anunciada',
});

const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatBRL(value) {
  return typeof value === 'number' && Number.isFinite(value) ? brlFormatter.format(value) : '';
}

/** Entrada brasileira: 500000 e R$ 500.000,00 significam quinhentos mil reais. */
export function parseBRLInput(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 100 ? value : null;
  const raw = String(value ?? '').replace(/R\$/gi, '').replace(/\s/g, '').trim();
  if (!raw || !/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{0,2})?$/.test(raw)) return null;
  const amount = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER / 100 ? amount : null;
}

/** Mascara durante a digitação sem deslocar o valor para centavos. */
export function maskBRLInput(value, finalize = false) {
  if (parseBRLInput(value) === null) return '';
  if (typeof value === 'number') return formatBRL(value);
  const raw = String(value ?? '').replace(/R\$/gi, '').replace(/[^\d,]/g, '');
  if (!raw || !/\d/.test(raw)) return '';
  const [integer, ...decimals] = raw.split(',');
  const whole = (integer || '0').replace(/^0+(?=\d)/, '');
  const fraction = decimals.join('').slice(0, 2);
  const formatted = 'R$ ' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (decimals.length ? ',' + fraction : '');
  return finalize ? formatBRL(parseBRLInput(formatted)) : formatted;
}

/** Preço é uma observação indivisível: valor, tipologia, data e fonte viajam juntos. */
export function normalizePricing(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const price = safeCopy(raw);
  const amount = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e11 ? value : null;
  const currency = raw.currency || 'BRL';
  price.currency = 'BRL';
  price.status = ['publicado', 'sob_consulta', 'nao_encontrado'].includes(raw.status) ? raw.status : 'nao_encontrado';
  price.kind = Object.hasOwn(PRICE_KIND_LABELS, raw.kind) ? raw.kind : null;
  price.min = amount(raw.min); price.max = amount(raw.max);
  price.source_url = safeUrl(raw.source_url) || null;
  price.source_name = text(raw.source_name) || null;
  price.source_type = ['oficial', 'comercial'].includes(raw.source_type) ? raw.source_type : null;
  price.checked_at = dateInfo(raw.checked_at).explicit ? text(raw.checked_at) : null;
  price.price_date = text(raw.price_date) || null;
  price.valid_until = /^\d{4}-\d{2}-\d{2}$/.test(raw.valid_until) ? raw.valid_until : null;
  price.is_historical = raw.is_historical === true || Boolean(price.valid_until && price.checked_at && price.valid_until < price.checked_at.slice(0,10));
  price.unit_details = text(raw.unit_details) || null;
  price.notes = text(raw.notes);
  price.source_refs = array(raw.source_refs).filter(value => typeof value === 'string');
  if (price.status === 'publicado' && (currency !== 'BRL' || !price.kind || !price.min || !price.source_url || (price.kind === 'faixa' && (price.max === null || price.max < price.min)))) {
    price.status = 'nao_encontrado';
    price.notes = [price.notes, 'Referência de preço incompleta ou inválida; confirmar valor e fonte.'].filter(Boolean).join(' ');
  }
  if (price.status !== 'publicado') { price.min = null; price.max = null; price.kind = null; }
  else if (price.kind !== 'faixa') price.max = null;
  return price;
}

export function priceLabel(raw) {
  const price = normalizePricing(raw);
  if (!price || price.status !== 'publicado') return price?.status === 'sob_consulta' ? 'Preço sob consulta' : 'Preço não localizado';
  if (price.kind === 'faixa') return `${formatBRL(price.min)} a ${formatBRL(price.max)}`;
  return `${price.kind === 'a_partir_de' ? 'A partir de ' : ''}${formatBRL(price.min)}`;
}

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const EMPTY_TEXT = new Set(['', '-', '—', 'n/a', 'null', 'undefined']);
const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;
const HISTORY_SCHEMA = 'parcerias-explorer/history-v1';
const GENERATED_FIELDS = new Set(['historySchema', 'versionRecords', 'canonicalId', 'normalized', 'searchText', 'provenance', 'sourceFiles', 'sources', 'occurrences', 'conflicts', 'mergeReasons', 'possibleDuplicateIds', 'originalIds', 'project_urls', 'historyContainers', 'partnershipTracking', 'partnership_status', 'partnership_status_label', 'partnership_updated_at', 'partnership_status_updated_at', 'partnership_requested_at', 'partnership_completed_at', 'partnership_timeline']);
const GENERIC_PATHS = new Set(['', '/', '/imoveis', '/empreendimentos', '/busca', '/contato', '/fale-conosco', '/home', '/index.html', '/index.php', '/lancamentos', '/catalogo', '/catalog', '/produtos', '/products', '/properties', '/projetos', '/apartamentos', '/listings', '/search']);
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

export function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function text(value) { return value == null ? '' : String(value).trim(); }
function array(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function nonEmpty(value) {
  if (value == null) return false;
  if (typeof value === 'string') return !EMPTY_TEXT.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
function unique(values, key = value => String(value)) {
  const seen = new Set();
  return values.filter(value => {
    const token = key(value);
    if (!nonEmpty(value) || seen.has(token)) return false;
    seen.add(token); return true;
  });
}
function safeCopy(value, depth = 0) {
  if (depth > 40) return null;
  if (Array.isArray(value)) return value.map(item => safeCopy(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) if (!BLOCKED_KEYS.has(key)) out[key] = safeCopy(item, depth + 1);
    return out;
  }
  return value;
}
function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function hash(value) {
  let n = 0x811c9dc5;
  for (const character of String(value)) { n ^= character.codePointAt(0); n = Math.imul(n, 0x01000193); }
  return (n >>> 0).toString(36);
}

/** Retorna URL segura para links. Não aceita javascript:, data:, file: ou protocolos desconhecidos. */
export function safeUrl(value, { allowContact = false } = {}) {
  try {
    const url = new URL(text(value));
    const allowed = allowContact ? ['https:', 'http:', 'mailto:', 'tel:'] : ['https:', 'http:'];
    if (!allowed.includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

/** Chave de identidade; preserva parâmetros funcionais e remove apenas rastreamento comum. */
export function canonicalizeUrl(value) {
  const safe = safeUrl(value);
  if (!safe) return '';
  const url = new URL(safe);
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  return url.href.replace(/\/$/, '');
}
function specificProjectUrl(value) {
  const canonical = canonicalizeUrl(value);
  if (!canonical) return '';
  const url = new URL(canonical);
  const path = url.pathname.toLowerCase();
  const lastSegment = '/' + path.split('/').filter(Boolean).at(-1);
  return GENERIC_PATHS.has(path) || GENERIC_PATHS.has(lastSegment) || /^\/(?:imoveis|empreendimentos|apartamentos)\/(?:sp\/)?sao-paulo\/?$/.test(path) ? '' : canonical;
}
function urlList(value) { return unique(array(value).map(safeUrl).filter(Boolean), canonicalizeUrl); }

export function normalizeMcmv(value, category = '') {
  const given = text(category);
  if (Object.hasOwn(MCMV_LABELS, given)) return given;
  const term = normalizeText(value);
  if (!term || /confirm|nao informad|nao divulgad|desconhec/.test(term)) return 'a_confirmar';
  if (/^sim\b|^yes\b|^true$/.test(term)) {
    if (/comercial|secundari|imobiliari|corretor|apto/.test(term)) return 'sim_fonte_comercial';
    if (/oficial|release|incorporadora/.test(term)) return 'sim_fonte_oficial';
    return 'sim_sem_fonte';
  }
  if (/^nao\b|^no\b|^false$/.test(term)) return /preco|infer/.test(term) ? 'nao_inferencia_preco' : 'nao_declarado';
  return 'a_confirmar';
}

export function normalizeStage(value) {
  const term = normalizeText(value);
  if (/pre lancamento|breve lancamento|em breve|futuro lancamento|coming soon/.test(term)) return 'pre_lancamento';
  if (/em obras|obras inici|obras inicial|em construcao|construcao recente/.test(term)) return 'em_obras';
  if (/pronto|entregue|concluido/.test(term)) return 'pronto';
  if (/lancamento|na planta/.test(term)) return 'lancamento';
  return 'a_confirmar';
}

export function normalizeZone(value) {
  const term = normalizeText(value).replace(/^zona\s+/, '');
  const zones = { sul: 'Sul', oeste: 'Oeste', leste: 'Leste', norte: 'Norte', centro: 'Centro', central: 'Centro' };
  return zones[term] || (text(value) || 'Não informada');
}

/** Alphaville is a region shared by municipalities, never a synonym for Barueri. */
export function normalizeCity(value) {
  const raw = text(value);
  const term = normalizeText(raw).replace(/^(?:municipio|cidade) (?:de )?/, '').replace(/ (?:sp|sao paulo)$/, '');
  if (/^sao paulo(?: capital)?$/.test(term)) return 'São Paulo';
  if (term === 'barueri') return 'Barueri';
  if (/^santana (?:de|do) parnaiba$/.test(term)) return 'Santana de Parnaíba';
  if (term === 'alphaville') return 'Alphaville — município a confirmar';
  if (term === 'alphaville municipio a confirmar') return 'Alphaville — município a confirmar';
  return raw || 'Não informada';
}
function cityKey(value) { return nonEmpty(value) ? normalizeText(normalizeCity(value)) : ''; }

export function launchYear(value) {
  const term = normalizeText(value);
  // Datas de RI, consulta, atualização e entrega não são datas de lançamento.
  if (/nao publicad|nao divulgad|sem data|sem ano|registro|\bri\b|material publicado/.test(term)) return null;
  const years = [...term.matchAll(/(?:^|[^0-9])(20\d{2})(?![0-9])/g)].map(match => Number(match[1]));
  return years.length ? years[0] : null;
}

function aiCategory(value, channelKind = '') {
  const term = normalizeText(value);
  if (['app_humano', 'cadastro_humano', 'formulario_antirrobo'].includes(channelKind) || /^(humano|preparacao por ia)/.test(term)) return 'intervencao_humana';
  if (/assistid|formulario publico|email|e mail|whatsapp/.test(term)) return 'assistida';
  return 'a_confirmar';
}
function routeQuality(value) { return /^[ABC](?=\b|\s|—|-)/i.exec(text(value))?.[0].toUpperCase() || 'Não informada'; }
function dateInfo(value) {
  if (value instanceof Date || typeof value === 'number') {
    const date = new Date(value), timestamp = date.getTime();
    return Number.isFinite(timestamp) && timestamp > 0 ? { string: date.toISOString(), timestamp, explicit: true } : { string: '', timestamp: 0, explicit: false };
  }
  const string = text(value);
  let normalized = string;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(string);
  if (br) normalized = `${br[3]}-${br[2]}-${br[1]}`;
  const timestamp = Date.parse(normalized);
  return { string, timestamp: Number.isFinite(timestamp) ? timestamp : 0, explicit: Boolean(string && Number.isFinite(timestamp)) };
}
function normalizedAddress(value) {
  return normalizeText(value).replace(/^(r|rua)\s+/, '').replace(/^(av|avenida)\s+/, '').replace(/\bnumero\b/g, '').replace(/\s+/g, ' ').trim();
}
function identitySuffix(name) {
  const normalized = normalizeText(name);
  const parts = [];
  const phase = /\b(fase|etapa|torre)\s+([a-z0-9]+)\b/.exec(normalized);
  const phaseNumber = value => ({ i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' })[value] || value;
  if (phase) parts.push(`${phase[1]}:${phaseNumber(phase[2])}`);
  const condo = /\bcondominio\s+(.+)$/.exec(normalized);
  if (condo) parts.push('condominio:' + condo[1]);
  const suffix = /\s+(i{1,3}|iv|v|vi{0,3}|ix|x|[1-9]|[12][0-9]|30)$/.exec(normalized);
  if (suffix && !phase) parts.push('fase:' + phaseNumber(suffix[1]));
  return parts.join('|');
}
function companyKeys(project) {
  return unique([project.developer, project.partner_group, ...project.routes.map(route => route.developer)].map(normalizeText).filter(Boolean));
}
function intersects(a, b) { const values = new Set(a); return b.some(value => values.has(value)); }
function compatibleCity(a, b) { return !a._city || !b._city || a._city === b._city; }
function compatibleSuffix(a, b) { return a._suffix === b._suffix; }
function nameMatch(a, b) {
  if (a._name !== b._name || !a._name || !a._city || !b._city || !compatibleCity(a, b)) return false;
  if (!intersects(a._companies, b._companies) || !compatibleSuffix(a, b)) return false;
  if (a._address && b._address) return a._address === b._address;
  const neighborhoodA = normalizeText(a.neighborhood), neighborhoodB = normalizeText(b.neighborhood);
  if (neighborhoodA && neighborhoodB && neighborhoodA !== neighborhoodB) return false;
  return a._name.split(' ').length >= 2 || Boolean(a._address || b._address);
}
function urlMatch(a, b) {
  if (!compatibleCity(a, b) || !compatibleSuffix(a, b)) return false;
  if (a._name === b._name) return true;
  if (a._address && a._address === b._address && intersects(a._companies, b._companies)) return true;
  const left = new Set(a._name.split(' ')), right = new Set(b._name.split(' '));
  const overlap = [...left].filter(token => right.has(token)).length;
  return intersects(a._companies, b._companies) && overlap / new Set([...left, ...right]).size >= 0.75;
}

function routeIdentity(route) {
  const company = normalizeText(route.partner_group || route.developer || route.company);
  const channels = unique([route.pf_url, route.pj_url, route.partner_url].map(value => canonicalizeUrl(value) || safeUrl(value,{allowContact:true})).filter(Boolean)).sort();
  return company + '|' + (channels.length ? channels.join('|') : normalizeText(route.contact || route.channel));
}
function normalizeRoute(raw, fileName, date) {
  const route = safeCopy(raw);
  route.developer = text(route.developer || route.empresa || route.company || route.partner_group);
  route.partner_group = text(route.partner_group || route.developer);
  route.partner_url = safeUrl(route.partner_url || route.url || route.pf_url || route.pj_url,{allowContact:true});
  route.pf_url = safeUrl(route.pf_url || route.partner_url,{allowContact:true});
  route.pj_url = safeUrl(route.pj_url || route.partner_url,{allowContact:true});
  route.contact = text(route.contact || route.partner_contact || route.contato);
  route.source_urls = urlList(route.source_urls);
  route.sourceFiles = [fileName];
  route.checked_at = text(route.checked_at || date);
  route.routeId = 'route-' + hash(routeIdentity(route));
  return route;
}
function mergeRoutes(routes) {
  const groups = new Map();
  for (const route of routes) {
    const key = routeIdentity(route);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(route);
  }
  return [...groups.entries()].map(([key, versions]) => {
    versions.sort((a, b) => dateInfo(b.checked_at).timestamp - dateInfo(a.checked_at).timestamp || collator.compare(a.sourceFiles[0] || '', b.sourceFiles[0] || ''));
    const route = {};
    for (const version of versions) for (const [field, value] of Object.entries(version)) if (!nonEmpty(route[field]) && nonEmpty(value)) route[field] = safeCopy(value);
    route.routeId = 'route-' + hash(key);
    route.sourceFiles = unique(versions.flatMap(version => version.sourceFiles)).sort(collator.compare);
    route.source_urls = urlList(versions.flatMap(version => version.source_urls));
    route.versions = versions.map(version => ({ fileName: version.sourceFiles[0], checkedAt: version.checked_at, originalId: version.id || '' }));
    return route;
  });
}

function pickRaw(raw, keys) { for (const key of keys) if (nonEmpty(raw[key])) return raw[key]; return ''; }
function originalSnapshot(raw) {
  return Object.fromEntries(Object.entries(safeCopy(raw)).filter(([field]) => !field.startsWith('_') && !GENERATED_FIELDS.has(field)));
}
function routeSnapshotIdentity(route) {
  return Object.fromEntries(Object.entries(safeCopy(route)).filter(([field]) => !['routeId', 'sourceFiles', 'versions'].includes(field)));
}
function versionKey(version) {
  return stableStringify({
    record: version.record,
    resolvedRoutes: version.resolvedRoutes.map(routeSnapshotIdentity).sort((a, b) => collator.compare(stableStringify(a), stableStringify(b))),
    origin: { fileName: version.provenance.fileName, rowIndex: version.provenance.rowIndex, originalId: version.provenance.originalId },
    effectiveDate: version.effectiveDate,
  });
}
function normalizeRecord(raw, context, rowIndex) {
  const p = safeCopy(raw);
  const aliases = {
    name: ['name', 'nome', 'empreendimento', 'Empreendimento'],
    developer: ['developer', 'empresa', 'incorporadora', 'construtora', 'Empresa'],
    neighborhood: ['neighborhood', 'bairro', 'Bairro'], zone: ['zone', 'zona', 'regiao', 'região', 'Zona'],
    city: ['city', 'cidade', 'Cidade'], address: ['address', 'endereco', 'endereço', 'Endereço'],
    stage: ['stage', 'estagio', 'estágio', 'Estágio'], launch_date: ['launch_date', 'lancamento', 'data_lancamento'],
    project_url: ['project_url', 'url_empreendimento', 'pagina_empreendimento'],
    mcmv: ['mcmv', 'MCMV', 'minha_casa_minha_vida'], checked_at: ['checked_at', 'consultado_em', 'consulta_em'],
  };
  for (const [field, keys] of Object.entries(aliases)) p[field] = text(pickRaw(p, keys));
  if (!p.name) return null;
  // Texto e classificação devem vir da mesma versão, sem herdar categoria antiga no merge.
  if (nonEmpty(p.mcmv) || nonEmpty(p.mcmv_category)) {
    p.mcmv_category = normalizeMcmv(p.mcmv, p.mcmv_category);
    if (!p.mcmv) p.mcmv = MCMV_LABELS[p.mcmv_category];
  }
  p.id = text(p.id || p.ID || p.codigo);
  p.partner_group = text(p.partner_group || p.grupo_parceria);
  p.project_url = safeUrl(p.project_url);
  p.source_urls = urlList(p.source_urls || p.fontes);
  p.partnership_source_urls = urlList(p.partnership_source_urls);
  p.checked_at = p.checked_at || context.date;
  if (Object.hasOwn(p, 'pricing')) p.pricing = normalizePricing(p.pricing);

  const restoredRoutes = context.restoredRoutes ? context.restoredRoutes.map(route => normalizeRoute(route, context.fileName, '')) : null;
  let candidates = restoredRoutes || context.partnersById.get(text(p.partner_id)) || [];
  if (candidates.length > 1) {
    if (restoredRoutes) {
      candidates = [candidates.find(route => canonicalizeUrl(route.pf_url) === canonicalizeUrl(p.pf_url) && p.pf_url) || candidates[0]];
    } else {
      candidates = candidates.filter(route => normalizeText(route.partner_group) === normalizeText(p.partner_group));
      if (candidates.length !== 1) context.warnings.push({ fileName: context.fileName, rowIndex, code: 'ambiguous_partner_id', message: `O código ${p.partner_id} tem mais de um parceiro neste arquivo; confirme a rota de ${p.name}.` });
    }
  }
  if (!restoredRoutes && !candidates.length && p.partner_group) candidates = context.partners.filter(route => normalizeText(route.partner_group) === normalizeText(p.partner_group));
  const resolved = candidates.length === 1 ? candidates[0] : null;
  p.routes = restoredRoutes || (resolved ? [safeCopy(resolved)] : []);
  if (!restoredRoutes) for (const partnerId of unique(array(p.partner_ids).map(text)).filter(id => id !== text(p.partner_id))) {
    let additional = context.partnersById.get(partnerId) || [];
    if (additional.length > 1) additional = additional.filter(route => normalizeText(route.partner_group) === normalizeText(p.partner_group));
    if (additional.length === 1) p.routes.push(safeCopy(additional[0]));
    else context.warnings.push({fileName:context.fileName,rowIndex,code:'additional_partner_not_resolved',message:`Parceria adicional ${partnerId} de ${p.name} não foi resolvida de forma única neste arquivo.`});
  }
  if (!restoredRoutes && p.partner_id && !resolved) context.warnings.push({ fileName: context.fileName, rowIndex, code: 'partner_not_resolved', message: `Parceria ${p.partner_id} de ${p.name} não foi resolvida neste arquivo; canais diretos foram preservados.` });
  const directPf = safeUrl(p.pf_url,{allowContact:true}), directPj = safeUrl(p.pj_url,{allowContact:true});
  if (!restoredRoutes && (directPf || directPj || p.partner_contact) && (!resolved || (directPf && canonicalizeUrl(directPf) !== canonicalizeUrl(resolved.pf_url)) || (directPj && canonicalizeUrl(directPj) !== canonicalizeUrl(resolved.pj_url)))) {
    p.routes.push(normalizeRoute({
      ...(resolved || {}), developer: resolved?.developer || p.partner_group || p.developer,
      partner_group: resolved?.partner_group || p.partner_group || p.developer,
      pf_url: directPf || resolved?.pf_url, pj_url: directPj || resolved?.pj_url,
      partner_url: directPf || directPj || resolved?.partner_url,
      contact: p.partner_contact || resolved?.contact || '',
      pf: p.pf_summary || resolved?.pf || '', pj: p.pj_summary || resolved?.pj || '',
      commission_pf: p.commission_pf || resolved?.commission_pf || '', commission_pj: p.commission_pj || resolved?.commission_pj || '',
      route_status: p.route_status || resolved?.route_status || '', ai_status: p.ai_status || resolved?.ai_status || '',
      channel_kind: p.channel_kind || resolved?.channel_kind || '', source_urls: p.partnership_source_urls,
    }, context.fileName, p.checked_at));
  }
  if (resolved) {
    for (const [field, routeField] of [['pf_url', 'pf_url'], ['pj_url', 'pj_url'], ['partner_contact', 'contact'], ['pf_summary', 'pf'], ['pj_summary', 'pj'], ['commission_pf', 'commission_pf'], ['commission_pj', 'commission_pj'], ['ai_status', 'ai_status'], ['channel_kind', 'channel_kind'], ['route_status', 'route_status']]) {
      if (!nonEmpty(p[field])) p[field] = resolved[routeField] || '';
    }
  }
  p.pf_url = safeUrl(p.pf_url,{allowContact:true}); p.pj_url = safeUrl(p.pj_url,{allowContact:true});
  p.routes = mergeRoutes(p.routes);
  const dated = dateInfo(p.checked_at);
  p._date = dated.explicit ? dated : { ...dateInfo(context.lastModified), explicit: false };
  p._name = normalizeText(p.name); p._city = cityKey(p.city);
  p._address = normalizedAddress(p.address); p._suffix = identitySuffix(p.name);
  p._companies = companyKeys(p); p._url = specificProjectUrl(p.project_url);
  p._provenance = { fileName: context.fileName, rowIndex, originalId: p.id, checkedAt: p.checked_at, datasetKey: context.datasetKey };
  p._stable = context.fileName + '|' + String(rowIndex).padStart(8, '0') + '|' + hash(stableStringify(raw));
  p._container = context.containerFileName || context.fileName;
  p._versionRecord = {
    record: originalSnapshot(raw), resolvedRoutes: safeCopy(p.routes),
    provenance: { ...p._provenance }, effectiveDate: { ...p._date },
  };
  p._versionKey = versionKey(p._versionRecord);
  p._versionRecord.recordId = 'record-' + hash(p._versionKey);
  return p;
}

function normalizedFields(project) {
  return {
    company: text(project.developer || project.partner_group) || 'Não informada',
    city: normalizeCity(project.city), zone: normalizeZone(project.zone), mcmv: normalizeMcmv(project.mcmv, project.mcmv_category),
    stage: normalizeStage(project.stage), year: Object.hasOwn(project,'launch_year') ? (Number.isInteger(project.launch_year) && project.launch_year >= 2000 && project.launch_year <= 2100 ? project.launch_year : null) : launchYear(project.launch_date),
    propertyType: text(project.property_type) || 'Não informado',
    routeQuality: routeQuality(project.route_status), ai: aiCategory(project.ai_status || project.ai_eligibility, project.channel_kind),
    contactStatus: text(project.outreach_status) || 'Não informado', partnershipStatus: 'nao_solicitada',
  };
}
const CONFLICT_FIELDS = ['developer', 'neighborhood', 'zone', 'city', 'address', 'stage', 'launch_date', 'mcmv_category', 'commission_pf', 'commission_pj', 'pf_url', 'pj_url', 'partner_contact', 'route_status', 'pricing'];
function conflictValue(record, field) {
  if (field === 'mcmv_category') return nonEmpty(record.mcmv) || nonEmpty(record.mcmv_category) ? normalizeMcmv(record.mcmv, record.mcmv_category) : '';
  return record[field];
}
function conflictKey(field, value) {
  if (field === 'pricing') return stableStringify([value.status, value.kind, value.min, value.max, value.currency]);
  if (['pf_url', 'pj_url'].includes(field)) return canonicalizeUrl(value) || safeUrl(value,{allowContact:true});
  if (field === 'stage') return normalizeStage(value);
  if (field === 'address') return normalizedAddress(value);
  if (field === 'city') return cityKey(value);
  return normalizeText(value);
}
function mergeGroup(records, reasons) {
  records.sort((a, b) => Number(b._date.explicit) - Number(a._date.explicit) || b._date.timestamp - a._date.timestamp || collator.compare(a._stable, b._stable));
  const merged = {};
  for (const record of records) for (const [field, value] of Object.entries(record)) {
    if (field.startsWith('_') || field === 'routes' || GENERATED_FIELDS.has(field)) continue;
    if (!nonEmpty(merged[field]) && nonEmpty(value)) merged[field] = safeCopy(value);
  }
  // Explicit null is an intentional absence of a confirmed launch year, not a gap to backfill.
  const datedYearRecord = records.find(record => Object.hasOwn(record,'launch_year'));
  if (datedYearRecord) merged.launch_year = datedYearRecord.launch_year;
  const priceRecords = records.filter(record => record.pricing).sort((a, b) =>
    (Date.parse(b.pricing.checked_at) || b._date.timestamp) - (Date.parse(a.pricing.checked_at) || a._date.timestamp));
  if (priceRecords.length) merged.pricing = safeCopy(priceRecords[0].pricing);
  merged.routes = mergeRoutes(records.flatMap(record => record.routes));
  merged.aliases = unique(records.flatMap(record => [record.name, ...array(record.aliases)]), normalizeText);
  merged.originalIds = unique(records.map(record => record.id));
  merged.provenance = records.map(record => ({ ...record._provenance }));
  merged.historySchema = HISTORY_SCHEMA;
  merged.versionRecords = records.map(record => safeCopy(record._versionRecord));
  merged.historyContainers = unique(records.map(record => record._container)).sort(collator.compare);
  merged.sourceFiles = unique(records.map(record => record._provenance.fileName)).sort(collator.compare);
  merged.source_urls = urlList(records.flatMap(record => record.source_urls));
  merged.partnership_source_urls = urlList([...records.flatMap(record => record.partnership_source_urls), ...merged.routes.flatMap(route => route.source_urls)]);
  merged.project_urls = urlList(records.map(record => record.project_url));
  merged.sources = urlList([...merged.project_urls, ...merged.source_urls, ...merged.partnership_source_urls, ...records.map(record => record.pricing?.source_url)]);
  merged.occurrences = records.length;
  merged.mergeReasons = unique(reasons);
  merged.conflicts = [];
  for (const field of CONFLICT_FIELDS) {
    const values = new Map();
    for (const record of records) {
      const value = conflictValue(record, field);
      if (!nonEmpty(value)) continue;
      const key = conflictKey(field, value);
      if (!values.has(key)) values.set(key, { value, files: [], checkedAt: [] });
      values.get(key).files.push(record._provenance.fileName);
      values.get(key).checkedAt.push(record.checked_at);
    }
    if (values.size > 1) merged.conflicts.push({ field, selected: conflictValue(merged, field), values: [...values.values()].map(value => ({ ...value, files: unique(value.files), checkedAt: unique(value.checkedAt) })) });
  }
  const identityKeys = records.map(record => record._city + '|' + record._companies[0] + '|' + record._name + '|' + record._suffix).sort();
  const identity = identityKeys[0] || records[0]._stable;
  merged.canonicalId = 'project-' + hash(identity + '|' + (records.some(record => record._url) ? records.map(record => record._url).filter(Boolean).sort()[0] : records.map(record => record._address).sort()[0]));
  merged.normalized = normalizedFields(merged);
  merged.mcmv_category = merged.normalized.mcmv;
  merged.possibleDuplicateIds = [];
  merged.searchText = normalizeText([merged.name, merged.aliases.join(' '), merged.developer, merged.partner_group, merged.neighborhood, merged.zone, merged.city, merged.normalized.city, merged.address, merged.stage, merged.id, merged.originalIds.join(' ')].join(' '));
  return merged;
}

function possibleMatches(projects) {
  const pairs = [];
  const sets = projects.map(project => ({
    name: normalizeText(project.name), city: cityKey(project.city), address: normalizedAddress(project.address),
    suffix: identitySuffix(project.name), companies: companyKeys(project), tokens: new Set(normalizeText(project.name).split(' ')),
    urls: project.project_urls.map(specificProjectUrl).filter(Boolean),
  }));
  for (let i = 0; i < projects.length; i++) for (let j = i + 1; j < projects.length; j++) {
    const a = sets[i], b = sets[j];
    if (a.city && b.city && a.city !== b.city) continue;
    // Fases e condomínios explicitamente distintos não são candidatos à fusão.
    if (a.suffix && b.suffix && a.suffix !== b.suffix) continue;
    const sameCompany = intersects(a.companies, b.companies);
    let reason = '', score = 0;
    if (intersects(a.urls, b.urls)) { reason = 'Mesma página, mas fase/identidade não confirmada'; score = 0.98; }
    else if (a.name && a.name === b.name) { reason = 'Nome igual; empresa ou localização precisa de revisão'; score = 0.96; }
    else if (sameCompany && a.address && a.address === b.address) { reason = 'Mesma empresa e endereço; nomes diferentes'; score = 0.86; }
    else if (sameCompany) {
      const shared = [...a.tokens].filter(token => b.tokens.has(token)).length;
      const union = new Set([...a.tokens, ...b.tokens]).size;
      const similarity = shared / (union || 1);
      if (Math.min(a.tokens.size, b.tokens.size) >= 2 && similarity >= 0.75) { reason = 'Nomes semelhantes na mesma empresa e cidade'; score = similarity; }
    }
    if (reason) {
      pairs.push({ leftId: projects[i].canonicalId, rightId: projects[j].canonicalId, reason, score });
      projects[i].possibleDuplicateIds.push(projects[j].canonicalId);
      projects[j].possibleDuplicateIds.push(projects[i].canonicalId);
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

/**
 * datasets: [{fileName, payload: objeto|array|string JSON, lastModified?}]
 * Importações inválidas geram warnings; as demais continuam disponíveis.
 */
export function ingestDatasets(datasets = []) {
  let records = [];
  const allRoutes = [], files = [], warnings = [];
  for (const [fileIndex, dataset] of array(datasets).entries()) {
    const fileName = text(dataset?.fileName || dataset?.name) || `arquivo-${fileIndex + 1}.json`;
    try {
      let payload = dataset?.payload ?? dataset?.data;
      if (typeof payload === 'string') payload = JSON.parse(payload.replace(/^\uFEFF/, ''));
      const rawProjects = Array.isArray(payload) ? payload : payload?.projects ?? payload?.empreendimentos;
      if (!Array.isArray(rawProjects)) throw new Error('O JSON precisa conter projects/empreendimentos ou ser uma lista de empreendimentos.');
      const rawPartners = Array.isArray(payload) ? [] : array(payload.partners ?? payload.parcerias);
      const date = text(payload?.consultation_date || payload?.research_date || payload?.checked_at || payload?.data_consulta);
      const partners = rawPartners.filter(partner => partner && typeof partner === 'object' && !Array.isArray(partner)).map(partner => normalizeRoute(partner, fileName, date));
      const partnersById = new Map();
      for (const partner of partners) {
        const key = text(partner.id || partner.codigo);
        if (!key) continue;
        if (!partnersById.has(key)) partnersById.set(key, []);
        partnersById.get(key).push(partner);
      }
      const context = { fileName, date, lastModified: dataset.lastModified, partners, partnersById, warnings, datasetKey: fileName + ':' + hash(stableStringify(payload)) };
      let accepted = 0;
      let historicalRecords = 0;
      rawProjects.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          warnings.push({ fileName, rowIndex: index + 1, code: 'invalid_record', message: `Registro ${index + 1} ignorado: esperado um objeto.` }); return;
        }
        if (raw.historySchema === HISTORY_SCHEMA && Array.isArray(raw.versionRecords) && raw.versionRecords.length) {
          let restored = 0;
          for (const version of raw.versionRecords) {
            if (!version?.record || typeof version.record !== 'object' || Array.isArray(version.record) || !version.provenance || typeof version.provenance !== 'object') {
              warnings.push({ fileName, rowIndex: index + 1, code: 'invalid_history_record', message: `Uma versão histórica de ${raw.name || 'empreendimento'} não pôde ser restaurada.` });
              continue;
            }
            const origin = version.provenance;
            const originFile = text(origin.fileName) || fileName;
            const originRow = Number.isInteger(origin.rowIndex) && origin.rowIndex > 0 ? origin.rowIndex : index + 1;
            const historyContext = {
              ...context, fileName: originFile, containerFileName: fileName,
              date: text(origin.checkedAt), lastModified: version.effectiveDate?.timestamp,
              datasetKey: text(origin.datasetKey) || context.datasetKey,
              restoredRoutes: array(version.resolvedRoutes).filter(route => route && typeof route === 'object' && !Array.isArray(route)),
            };
            const restoredRecord = normalizeRecord(originalSnapshot(version.record), historyContext, originRow);
            if (restoredRecord) { records.push(restoredRecord); restored++; historicalRecords++; }
          }
          if (restored) { accepted++; return; }
          warnings.push({ fileName, rowIndex: index + 1, code: 'history_fallback', message: `Histórico de ${raw.name || 'empreendimento'} inválido; importado apenas o registro visível.` });
        }
        const record = normalizeRecord(raw, context, index + 1);
        if (!record) { warnings.push({ fileName, rowIndex: index + 1, code: 'missing_name', message: `Registro ${index + 1} ignorado: nome do empreendimento ausente.` }); return; }
        records.push(record); accepted++;
      });
      allRoutes.push(...partners);
      files.push({ fileName, valid: true, recordCount: rawProjects.length, acceptedCount: accepted, partnerCount: partners.length, historicalRecords, checkedAt: date, datasetKey: context.datasetKey });
    } catch (error) {
      files.push({ fileName, valid: false, recordCount: 0, acceptedCount: 0, partnerCount: 0, error: error.message });
      warnings.push({ fileName, code: 'invalid_dataset', message: error.message });
    }
  }

  // Reimportar um consolidado junto das fontes não duplica as mesmas versões.
  // A comparação usa conteúdo completo + origem, nunca confia em recordId fornecido.
  const versionKeys = new Set();
  const repeatedHistoryRecords = records.length;
  records = records.filter(record => {
    if (versionKeys.has(record._versionKey)) return false;
    versionKeys.add(record._versionKey); return true;
  });

  const parents = records.map((_, index) => index), members = records.map((_, index) => [index]), reasons = records.map(() => []);
  function find(index) { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; }
  function union(a, b, reason) {
    let left = find(a), right = find(b);
    if (left === right) return;
    // Impede que um registro genérico una transitivamente fases diferentes.
    if (members[left].some(i => members[right].some(j => !compatibleSuffix(records[i], records[j]) || !compatibleCity(records[i], records[j])))) return;
    if (left > right) [left, right] = [right, left];
    parents[right] = left; members[left].push(...members[right]); reasons[left].push(reason, ...reasons[right]);
  }
  const urls = new Map(), names = new Map();
  records.forEach((record, index) => {
    if (record._url) {
      for (const other of urls.get(record._url) || []) {
        if (urlMatch(record, records[other])) union(index, other, 'URL específica e identidade compatíveis');
      }
      if (!urls.has(record._url)) urls.set(record._url, []);
      urls.get(record._url).push(index);
    }
    const nameKey = record._name + '|' + record._city;
    for (const other of names.get(nameKey) || []) if (nameMatch(record, records[other])) union(index, other, 'Nome, empresa e localização compatíveis');
    if (!names.has(nameKey)) names.set(nameKey, []);
    names.get(nameKey).push(index);
  });
  const groups = new Map();
  records.forEach((record, index) => { const root = find(index); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(record); });
  const projects = [...groups.entries()].map(([root, group]) => mergeGroup(group, reasons[root]));
  // Dois homônimos na mesma cidade/endereço ainda precisam de IDs de UI diferentes.
  const usedIds = new Map();
  projects.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.sourceFiles.join('|'), b.sourceFiles.join('|')));
  for (const project of projects) {
    const count = usedIds.get(project.canonicalId) || 0; usedIds.set(project.canonicalId, count + 1);
    if (count) project.canonicalId += '-' + (count + 1);
  }
  const possibleDuplicates = possibleMatches(projects);
  const partners = mergeRoutes([...allRoutes, ...projects.flatMap(project => project.routes)]);
  const countBy = key => projects.reduce((counts, project) => { const value = project.normalized[key]; counts[value] = (counts[value] || 0) + 1; return counts; }, {});
  return {
    projects, partners, files, warnings, possibleDuplicates,
    stats: {
      files: files.length, validFiles: files.filter(file => file.valid).length, invalidFiles: files.filter(file => !file.valid).length,
      inputProjects: records.length, uniqueProjects: projects.length, duplicatesMerged: records.length - projects.length,
      repeatedHistoryRecords: repeatedHistoryRecords - records.length,
      conflictProjects: projects.filter(project => project.conflicts.length).length,
      possibleDuplicatePairs: possibleDuplicates.length, routes: partners.length,
      byCity: countBy('city'), byZone: countBy('zone'), byMcmv: countBy('mcmv'), byStage: countBy('stage'),
    },
  };
}

const FILTER_FIELDS = {
  companies: project => project.normalized.company, cities: project => project.normalized.city, zones: project => project.normalized.zone,
  neighborhoods: project => project.neighborhood || 'Não informado', mcmv: project => project.normalized.mcmv,
  stages: project => project.normalized.stage, years: project => project.normalized.year == null ? 'nao_informado' : String(project.normalized.year),
  routeQualities: project => project.normalized.routeQuality, ai: project => project.normalized.ai,
  contactStatuses: project => project.normalized.contactStatus,
  partnershipStatuses: project => project.normalized.partnershipStatus || 'nao_solicitada',
  propertyTypes: project => project.normalized.propertyType || 'Não informado',
};

export function filterProjects(projects = [], filters = {}) {
  const words = normalizeText(filters.query).split(' ').filter(Boolean);
  const priceMin = parseBRLInput(filters.priceMin), priceMax = parseBRLInput(filters.priceMax);
  const byPrice = priceMin !== null || priceMax !== null;
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) return [];
  const selections = Object.fromEntries(Object.keys(FILTER_FIELDS).map(key => [key, new Set(array(filters[key]).filter(nonEmpty).map(String))]));
  return projects.filter(project => {
    if (words.length && !words.every(word => project.searchText.includes(word))) return false;
    for (const [key, getter] of Object.entries(FILTER_FIELDS)) if (selections[key].size && !selections[key].has(String(getter(project)))) return false;
    if (filters.onlyConflicts && !project.conflicts.length) return false;
    if (filters.onlyDuplicates && project.occurrences < 2) return false;
    if (filters.onlyPossibleDuplicates && !project.possibleDuplicateIds.length) return false;
    if (byPrice) {
      const price = normalizePricing(project.pricing);
      if (price?.status !== 'publicado') return false;
      // Faixas se sobrepõem; uma referência "a partir de" é comparada como ponto,
      // sem pressupor estoque ou inventar um limite superior para o empreendimento.
      if (priceMin !== null && (price.max ?? price.min) < priceMin) return false;
      if (priceMax !== null && price.min > priceMax) return false;
    }
    return true;
  });
}

export function buildFacets(projects = []) {
  const facets = {};
  for (const [key, getter] of Object.entries(FILTER_FIELDS)) {
    const counts = new Map(key === 'partnershipStatuses' ? Object.keys(PARTNERSHIP_STATUS_LABELS).map(value => [value,0]) : []);
    for (const project of projects) { const value = String(getter(project)); counts.set(value, (counts.get(value) || 0) + 1); }
    facets[key] = [...counts.entries()].map(([value, count]) => ({
      value, label: key === 'mcmv' ? MCMV_LABELS[value] || value : key === 'stages' ? STAGE_LABELS[value] || value : key === 'ai' ? AI_LABELS[value] || value : key === 'partnershipStatuses' ? PARTNERSHIP_STATUS_LABELS[value] || value : key === 'years' && value === 'nao_informado' ? 'Ano não confirmado' : value, count,
    })).sort((a, b) => key === 'years' && a.value !== 'nao_informado' && b.value !== 'nao_informado' ? Number(b.value) - Number(a.value) : collator.compare(a.label, b.label));
  }
  return facets;
}

// User-owned contact tracking. Original research and its history remain unchanged.
function trackingIdentity(raw = {}, fallback = {}) {
  const name = normalizeText(raw.name || fallback.name);
  const city = cityKey(raw.city || fallback.city);
  const companies = unique(array(raw.companies).length ? raw.companies.map(normalizeText) : [raw.developer || fallback.developer, raw.partner_group || fallback.partner_group].map(normalizeText).filter(Boolean));
  return {
    name, city, companies, address: normalizedAddress(raw.address || fallback.address),
    url: specificProjectUrl(raw.url || raw.project_url || fallback.project_url), suffix: identitySuffix(name),
  };
}
function projectIdentities(project) {
  return unique([trackingIdentity(project), ...array(project.versionRecords).map(version => trackingIdentity(version.record, project))], stableStringify);
}
function identitiesMatch(a, b) {
  // An unspecified/ambiguous municipality cannot borrow another municipality's status.
  if (a.city !== b.city || a.suffix !== b.suffix) return false;
  const asRecord = value => ({_name:value.name, _city:value.city, _companies:value.companies, _address:value.address, _suffix:value.suffix});
  const left = asRecord(a), right = asRecord(b);
  if (a.url && a.url === b.url && urlMatch(left, right)) return true;
  if (nameMatch(left, right)) return true;
  return a.name === b.name && a.address === b.address && a.url === b.url && stableStringify(a.companies) === stableStringify(b.companies);
}
function recordsMatch(a, b) {
  if (!a.identities.length || !b.identities.length) return Boolean(a.projectKey && a.projectKey === b.projectKey && normalizeText(a.projectName) === normalizeText(b.projectName) && cityKey(a.city) === cityKey(b.city));
  return a.identities.some(left => b.identities.some(right => identitiesMatch(left, right)));
}
function isoDate(value) {
  if (typeof value !== 'string' || value.length > 40) return '';
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return '';
  const [,year,month,day,hours,minutes,seconds]=match.map(Number), calendar=new Date(0);
  calendar.setUTCFullYear(year,month-1,day);
  if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day||hours>23||minutes>59||seconds>59)return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}
function cleanTrackingRecord(raw) {
  if (!raw || typeof raw !== 'object' || !Object.hasOwn(PARTNERSHIP_STATUS_LABELS, raw.status)) return null;
  const projectKey = text(raw.projectKey), updatedAt = isoDate(raw.updatedAt);
  const identities = unique(array(raw.identities).filter(value => value && typeof value === 'object').map(value => ({...safeCopy(value),...trackingIdentity(value)})).filter(value => value.name), stableStringify);
  if (!projectKey || projectKey.length > 10000 || !updatedAt) return null;
  const eventKey=event=>{const copy={...event,id:event.collisionOriginalId||event.id};delete copy.collisionOriginalId;return stableStringify(copy);};
  const events = unique(array(raw.events).filter(event => event && typeof event.id === 'string' && event.id.length > 0 && event.id.length <= 1000 && isoDate(event.createdAt) && typeof event.text === 'string').map(event => ({
    ...safeCopy(event),id:event.id, createdAt:isoDate(event.createdAt), text:event.text, kind:event.kind === 'status' ? 'status' : 'note',
  })), eventKey).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const eventIdCounts = new Map();for(const event of events){const key=event.collisionOriginalId||event.id;eventIdCounts.set(key,(eventIdCounts.get(key)||0)+1);}
  const usedEventIds=new Set();
  for(const event of events){const key=event.collisionOriginalId||event.id;if(eventIdCounts.get(key)>1){event.collisionOriginalId=key;event.id=key.slice(0,970)+'-'+hash(eventKey(event));}while(usedEventIds.has(event.id))event.id+='-2';usedEventIds.add(event.id);}
  return {...safeCopy(raw),projectKey, aliases:unique([projectKey,...array(raw.aliases).filter(value => typeof value === 'string' && value.length <= 10000)]), status:raw.status,
    updatedAt, statusUpdatedAt:isoDate(raw.statusUpdatedAt) || updatedAt, requestedAt:isoDate(raw.requestedAt), completedAt:isoDate(raw.completedAt),
    projectName:text(raw.projectName), city:normalizeCity(raw.city), identities, events};
}
export function normalizeTracking(payload) {
  const valid = payload?.schema === TRACKING_SCHEMA && Array.isArray(payload.records);
  return {...(valid?safeCopy(payload):{}),schema:TRACKING_SCHEMA, revision:valid && Number.isSafeInteger(payload.revision) && payload.revision >= 0 ? payload.revision : 0,
    records:valid ? payload.records.map(cleanTrackingRecord).filter(Boolean) : []};
}
/** Reject malformed files before any overwrite; optional extensions and orphan records survive. */
export function validateTrackingEnvelope(payload) {
  const fail=message=>{throw new Error('Acompanhamento inválido: '+message);};
  const object=value=>value && typeof value==='object' && !Array.isArray(value);
  let nodes=0;const inspect=(value,depth=0)=>{if(++nodes>300000||depth>40)fail('estrutura muito extensa.');if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){if(BLOCKED_KEYS.has(key))fail('chave não permitida.');inspect(item,depth+1);}};inspect(payload);
  const string=(value,max=10000,empty=true)=>typeof value==='string'&&value.length<=max&&(empty||Boolean(value.trim()));
  const strings=value=>Array.isArray(value)&&value.length<=256&&value.every(item=>string(item));
  if(!object(payload)||payload.schema!==TRACKING_SCHEMA||!Number.isSafeInteger(payload.revision)||payload.revision<0||!Array.isArray(payload.records)||payload.records.length>20000)fail('formato de arquivo não reconhecido.');
  const keys=new Set();
  for(const record of payload.records) {
    if(!object(record)||!string(record.projectKey,10000,false)||keys.has(record.projectKey)||!strings(record.aliases)||!Object.hasOwn(PARTNERSHIP_STATUS_LABELS,record.status)||!isoDate(record.updatedAt)||!string(record.projectName)||!string(record.city))fail('há um registro incompleto ou repetido.');
    keys.add(record.projectKey);
    for(const field of ['statusUpdatedAt','requestedAt','completedAt'])if(record[field]!==undefined&&!(field!=='statusUpdatedAt'&&record[field]==='')&&!isoDate(record[field]))fail('há uma data inválida.');
    if(!Array.isArray(record.events)||record.events.length>20000)fail('a linha do tempo deve ser uma lista.');
    const ids=new Set();for(const event of record.events){if(!object(event)||!string(event.id,1000,false)||ids.has(event.id)||!isoDate(event.createdAt)||!string(event.text,100000)||event.kind!==undefined&&!['note','status'].includes(event.kind))fail('há um evento inválido ou repetido.');ids.add(event.id);}
    if(record.identities!==undefined&&(!Array.isArray(record.identities)||record.identities.length>256||record.identities.some(identity=>!object(identity)||['name','city','address','url','suffix'].some(field=>!string(identity[field]))||!strings(identity.companies))))fail('identidade de empreendimento inválida.');
  }
  return payload;
}
function mergeTrackingRecords(a, b) {
  const latest = a.updatedAt > b.updatedAt ? a : b;
  const status = a.statusUpdatedAt > b.statusUpdatedAt ? a : b;
  const dates = (field) => [a[field],b[field]].filter(Boolean).sort().at(-1) || '';
  return cleanTrackingRecord({...a,...b,...latest, projectKey:a.projectKey, aliases:unique([...a.aliases,...b.aliases]),
    identities:unique([...a.identities,...b.identities],stableStringify), status:status.status, statusUpdatedAt:status.statusUpdatedAt,
    requestedAt:dates('requestedAt'), completedAt:dates('completedAt'), events:[...a.events,...b.events]});
}
/** Merge status by its own timestamp and union timeline entries; notes never revert status. */
export function mergeTracking(...payloads) {
  const stores = payloads.map(normalizeTracking), records=[];
  for (const store of stores) for (const record of store.records) {
    const index = records.findIndex(existing => recordsMatch(existing,record));
    if (index < 0) records.push(record); else records[index] = mergeTrackingRecords(records[index],record);
  }
  const usedKeys=new Set();for(const record of records){if(usedKeys.has(record.projectKey)){const original=record.projectKey;record.projectKey=original.slice(0,9900)+'-'+hash(stableStringify(record.identities)+record.city+record.projectName);while(usedKeys.has(record.projectKey))record.projectKey+='-2';record.aliases=unique([...record.aliases,original,record.projectKey]);}usedKeys.add(record.projectKey);}
  return {...Object.assign({},...stores),schema:TRACKING_SCHEMA, revision:Math.max(0,...stores.map(store => store.revision)), records:records.sort((a,b) => a.projectKey.localeCompare(b.projectKey))};
}
/** Returns an updated tracking envelope while attaching display-only fields to merged projects. */
export function applyPartnershipTracking(projects, payload) {
  const store = mergeTracking(payload);
  const candidates = projects.map(project => ({project,identities:projectIdentities(project)}));
  for (const project of projects) {
    project.partnershipTracking = {status:'nao_solicitada',updatedAt:'',statusUpdatedAt:'',requestedAt:'',completedAt:'',events:[]};
    project.normalized.partnershipStatus = 'nao_solicitada';
  }
  for (let index=0;index<store.records.length;index++) {
    const record = store.records[index];
    const matches = candidates.filter(candidate => recordsMatch(record,candidate));
    // An ambiguous research identity stays in the backup, without being copied to two products.
    if (matches.length !== 1) continue;
    const {project,identities} = matches[0];
    const updated = cleanTrackingRecord({...record,aliases:unique([...record.aliases,project.canonicalId]),identities:unique([...record.identities,...identities],stableStringify),projectName:project.name,city:project.normalized.city});
    store.records[index] = updated;
    project.partnershipTracking = safeCopy(updated);
    project.normalized.partnershipStatus = updated.status;
  }
  return store;
}
/** Explicit user action only. These timestamps record markings, not automatically sent requests. */
export function updatePartnershipTracking(payload, project, change, timestamp, eventId) {
  const now = isoDate(timestamp);
  if (!now || !text(eventId)) throw new Error('Data e identificador do registro são obrigatórios.');
  const store = normalizeTracking(payload), identities = projectIdentities(project);
  const found = store.records.find(record => recordsMatch(record,{identities}));
  const record = found ? safeCopy(found) : {projectKey:project.canonicalId,aliases:[project.canonicalId],identities,status:'nao_solicitada',updatedAt:now,statusUpdatedAt:now,requestedAt:'',completedAt:'',projectName:project.name,city:project.normalized.city,events:[]};
  record.aliases = unique([...record.aliases,project.canonicalId]);
  record.identities = unique([...record.identities,...identities],stableStringify);
  if (Object.hasOwn(PARTNERSHIP_STATUS_LABELS,change.status) && change.status !== record.status) {
    record.status=change.status; record.statusUpdatedAt=now;
    if (change.status === 'solicitada') record.requestedAt=now;
    if (change.status === 'feita') record.completedAt=now;
    record.events.push({id:eventId+'-status',createdAt:now,text:'Status marcado: '+PARTNERSHIP_STATUS_LABELS[change.status]+'.',kind:'status'});
  }
  const note = typeof change.note === 'string' ? change.note.trim().slice(0,6000) : '';
  if (note) record.events.push({id:eventId,createdAt:now,text:note,kind:'note'});
  record.updatedAt=now;
  const retained = store.records.filter(existing => existing !== found);
  return mergeTracking({...store,records:[...retained,record]});
}
