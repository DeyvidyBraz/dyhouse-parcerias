import { ingestDatasets, filterProjects, buildFacets, MCMV_LABELS, STAGE_LABELS, AI_LABELS, normalizeText, PARTNERSHIP_STATUS_LABELS, TRACKING_SCHEMA, normalizeTracking, validateTrackingEnvelope, mergeTracking, applyPartnershipTracking, updatePartnershipTracking } from './data-core.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const txt = value => typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
const array = value => Array.isArray(value) ? value : value == null ? [] : [value];
const icons = {
  building:'<path d="M4 21V5h10v16M14 10h6v11M2 21h20M7 8h4M7 12h4M7 16h4M17 13h1M17 17h1"/>',
  home:'<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-8h6v8"/>',
  folder:'<path d="M3 7V4h6l3 3h9v13H3Z"/><path d="M3 10h18"/>',
  files:'<path d="M8 3h8l4 4v14H8Z"/><path d="M16 3v5h4M5 6H3v15M11 12h6M11 16h6"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  link:'<path d="m10 13 4-4M8 15l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 0M16 9l2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-6 0" transform="translate(0 -1) scale(.95)"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  refresh:'<path d="M20 8a8 8 0 0 0-14-3L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3M21 21v-5h-5"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  handshake:'<path d="m2 8 5-4 5 2 5-2 5 4-4 9-5 4-9-7Z"/><path d="m7 5 5 2-4 5 3 2 4-4 5 5M5 15l4-4M8 18l3-4M11 20l3-4"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  'chevron-down':'<path d="m6 9 6 6 6-6"/>',
  'chevron-right':'<path d="m9 5 7 7-7 7"/>',
  'chevron-left':'<path d="m15 5-7 7 7 7"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  sliders:'<path d="M4 7h8m4 0h4M4 17h3m4 0h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-1 1-2 1-2 3M12 17v.2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  external:'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 5V3H3v13h2"/>',
  warning:'<path d="M12 3 1.8 21h20.4Z"/><path d="M12 9v5M12 17v.2"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg>`; }
function paintIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
function safeLink(value) {
  try { const url = new URL(txt(value)); return ['https:','http:','mailto:','tel:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function externalLink(value, label, className = '') {
  const url = safeLink(value);
  return url ? `<a class="${className}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}${className.includes('button') ? icon('external') : ''}</a>` : '';
}
function readableDate(value) {
  if (!value) return 'Data não informada';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? txt(value) : d.toLocaleDateString('pt-BR', {timeZone:'UTC'});
}
function formatNumber(value) { return Number(value || 0).toLocaleString('pt-BR'); }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function openDialog(id) { const el = document.getElementById(id); if (!el.open) el.showModal(); }
function closeDialog(id) { document.getElementById(id)?.close(); }
const emptyFilters = () => ({query:'',companies:[],cities:[],zones:[],neighborhoods:[],mcmv:[],stages:[],years:[],routeQualities:[],ai:[],contactStatuses:[],partnershipStatuses:[],propertyTypes:[],onlyConflicts:false,onlyDuplicates:false,onlyPossibleDuplicates:false});
const FILTER_LABELS = {companies:'Empresa',cities:'Cidade',zones:'Região',neighborhoods:'Bairro',mcmv:'MCMV',stages:'Estágio',years:'Ano de lançamento',routeQualities:'Canal',ai:'Solicitação por IA',contactStatuses:'Contato na pesquisa',partnershipStatuses:'Minha parceria',propertyTypes:'Tipo'};
const state = {
  model:null, facets:{}, baseFiles:[], extraFiles:[], folderFiles:[], loadErrors:[], baseMode:'loading', baseLabel:'Base inicial', useBase:true,
  folderHandle:null, folderName:'', folderSnapshot:false, filters:emptyFilters(), sort:'original', page:1, pageSize:25, tab:'projects',
  detailId:null, detailTab:'overview', routeId:null, autoTimer:null, busy:false, loadRevision:0,
  tracking:normalizeTracking(null),trackingMode:'browser',trackingHandle:null,trackingRevision:0,trackingReady:false,
  trackingSaving:false,trackingDirty:false,trackingError:'',trackingCacheError:false,trackingSavedAt:'',noteDrafts:new Map()
};
try {
  const settings = JSON.parse(localStorage.getItem('dyhouse-parcerias-view-v1') || 'null');
  if (settings && typeof settings === 'object') {
    for (const key of Object.keys(state.filters)) {
      if (Array.isArray(state.filters[key]) && Array.isArray(settings.filters?.[key])) state.filters[key] = settings.filters[key].map(String).slice(0,200);
      else if (typeof state.filters[key] === 'boolean') state.filters[key] = settings.filters?.[key] === true;
      else if (key === 'query' && typeof settings.filters?.query === 'string') state.filters.query = settings.filters.query.slice(0,300);
    }
    if (['original','name','company','city','zone','recent','conflicts'].includes(settings.sort)) state.sort=settings.sort;
    if ([25,50,100].includes(settings.pageSize)) state.pageSize=settings.pageSize;
  }
} catch { /* Private browsing may disable local storage. */ }
function persistView() { try { localStorage.setItem('dyhouse-parcerias-view-v1',JSON.stringify({filters:state.filters,sort:state.sort,pageSize:state.pageSize})); } catch {} }

const TRACKING_CACHE_KEY='dyhouse-parcerias-tracking-v1';
try {state.tracking=mergeTracking(JSON.parse(localStorage.getItem(TRACKING_CACHE_KEY)||'null'));} catch {state.trackingCacheError=true;}
function trackingFingerprint(store) {return JSON.stringify(normalizeTracking(store).records);}
function persistTrackingCache() {
  try {localStorage.setItem(TRACKING_CACHE_KEY,JSON.stringify(state.tracking));state.trackingCacheError=false;}
  catch {state.trackingCacheError=true;}
}
function readableTimestamp(value) {const date=new Date(value);return value && Number.isFinite(date.getTime())?date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'';}
function renderTrackingState() {
  let message;
  if(state.trackingError) message=state.trackingError+' '+(state.trackingCacheError?'Mantenha esta página aberta e exporte um backup.':'As alterações continuam no navegador; exporte um backup ou tente salvar novamente.');
  else if(state.trackingSaving || state.trackingDirty && state.trackingMode!=='browser') message='Salvando acompanhamento no arquivo…';
  else if(state.trackingMode==='server') message='Acompanhamento salvo automaticamente no arquivo local.';
  else if(state.trackingMode==='file') message=`Acompanhamento salvo em ${state.trackingHandle?.name||'arquivo JSON'}.`;
  else if(state.trackingCacheError) message='O navegador não permitiu salvar as marcações. Mantenha esta página aberta e exporte um backup.';
  else message='Marcações e notas salvas neste navegador. Exporte para backup/outro dispositivo ou vincule um arquivo JSON.';
  $$('[data-tracking-save-state]').forEach(el=>{el.textContent=message;el.classList.toggle('save-error',Boolean(state.trackingError||state.trackingCacheError));});
  const retry=$('#tracking-retry');if(retry)retry.hidden=!state.trackingError;
}
function overlayTracking({detail=true}={}) {
  if(state.model) {
    state.tracking=applyPartnershipTracking(state.model.projects,state.tracking);state.facets=buildFacets(state.model.projects);
    renderFilters();renderProjects();
    if(detail && $('#detail-dialog').open && state.detailId) {
      const project=state.model.projects.find(p=>p.canonicalId===state.detailId);
      if(project) {const draft=$('#tracking-note')?.value||'';renderProjectDetail(project);if($('#tracking-note'))$('#tracking-note').value=draft;}
    }
  }
  persistTrackingCache();renderTrackingState();
}
async function initializeTracking() {
  if(location.protocol!=='file:') {
    try {
      const incoming=await getJson('./api/tracking',5000);
      if(incoming?.schema===TRACKING_SCHEMA && Array.isArray(incoming.records)) {
        validateTrackingEnvelope(incoming);
        state.trackingMode='server';state.trackingRevision=normalizeTracking(incoming).revision;
        state.tracking=mergeTracking(incoming,state.tracking);state.tracking.revision=state.trackingRevision;
        state.trackingDirty=trackingFingerprint(state.tracking)!==trackingFingerprint(incoming);
      }
    } catch(error) {
      if(/^HTTP 5\d\d$/.test(error.message)||error.message.startsWith('Acompanhamento inválido:')) {
        state.trackingMode='server';state.trackingError='Não foi possível ler o arquivo de acompanhamento no servidor. Verifique o arquivo local antes de tentar salvar.';
      }
      // Static hosts (404 or HTML instead of JSON) have no tracking API.
    }
  }
  state.trackingReady=true;overlayTracking();if(state.trackingDirty&&!state.trackingError)queueTrackingWrite();
}
function queueTrackingWrite() {
  persistTrackingCache();state.trackingDirty=true;renderTrackingState();
  if(state.trackingReady && !state.trackingSaving && state.trackingMode!=='browser') void flushTrackingWrites();
}
async function flushTrackingWrites() {
  if(state.trackingSaving||state.trackingMode==='browser')return;
  state.trackingSaving=true;state.trackingError='';renderTrackingState();
  try {
    let conflicts=0;
    while(state.trackingDirty) {
      state.trackingDirty=false;
      let snapshot=normalizeTracking(state.tracking),saved;
      if(state.trackingMode==='server') {
        snapshot.revision=state.trackingRevision;
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
        let response;try {response=await fetch('./api/tracking',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot),signal:controller.signal});} finally {clearTimeout(timer);}
        let payload;try {payload=await response.json();} catch {throw new Error('O servidor não devolveu um arquivo de acompanhamento válido.');}
        if(response.status===409 && payload?.tracking?.schema===TRACKING_SCHEMA) {
          validateTrackingEnvelope(payload.tracking);
          if(++conflicts>3)throw new Error('O arquivo foi alterado em outra janela. Tente salvar novamente.');
          state.tracking=mergeTracking(payload.tracking,state.tracking);state.trackingRevision=normalizeTracking(payload.tracking).revision;
          state.trackingDirty=true;overlayTracking();continue;
        }
        if(!response.ok)throw new Error(typeof payload?.error==='string'&&payload.error.trim()?payload.error.trim().slice(0,1200):'Não foi possível gravar o arquivo de acompanhamento.');
        if(payload?.schema!==TRACKING_SCHEMA)throw new Error('O servidor não devolveu um arquivo de acompanhamento válido.');
        validateTrackingEnvelope(payload);saved=normalizeTracking(payload);state.trackingRevision=saved.revision;
      } else {
        if(!state.trackingHandle)throw new Error('Selecione novamente o arquivo de acompanhamento.');
        const handle=state.trackingHandle;
        const write=async()=>{
          const existing=await handle.getFile();
          if(existing.size) {if(existing.size>MAX_FILE_BYTES)throw new Error('O arquivo vinculado excede 10 MB.');const onDisk=validateTrackingEnvelope(JSON.parse((await existing.text()).replace(/^\uFEFF/,'')));snapshot=mergeTracking(onDisk,snapshot);}
          snapshot.revision+=1;validateTrackingEnvelope(snapshot);
          const contents=JSON.stringify(snapshot,null,2);
          if(new TextEncoder().encode(contents).length>MAX_FILE_BYTES)throw new Error('O acompanhamento consolidado excede 10 MB. O arquivo anterior foi preservado; exporte um backup.');
          const writer=await handle.createWritable();
          try {await writer.write(contents);await writer.close();} catch(error) {try {await writer.abort();} catch {}throw error;}
          return snapshot;
        };
        saved=navigator.locks?.request?await navigator.locks.request('dyhouse-tracking-file-'+handle.name,write):await write();
      }
      state.tracking=mergeTracking(saved,state.tracking);state.tracking.revision=saved.revision;
      state.trackingSavedAt=new Date().toISOString();persistTrackingCache();overlayTracking();
    }
  } catch(error) {
    state.trackingDirty=true;state.trackingError=error?.message||'Falha ao salvar o arquivo de acompanhamento.';persistTrackingCache();
  } finally {state.trackingSaving=false;renderTrackingState();}
}
function trackingPayloadFrom(raw) {return raw?.schema===TRACKING_SCHEMA?raw:raw?.partnership_tracking?.schema===TRACKING_SCHEMA?raw.partnership_tracking:null;}
async function importTrackingFile(file,handle=null) {
  if(file.size>MAX_FILE_BYTES)throw new Error('O arquivo de acompanhamento excede 10 MB.');
  const raw=JSON.parse((await file.text()).replace(/^\uFEFF/,'')),payload=trackingPayloadFrom(raw);
  if(!payload)throw new Error('Escolha um JSON de acompanhamento ou uma exportação da página com marcações.');
  validateTrackingEnvelope(payload);
  if(handle && raw.schema===TRACKING_SCHEMA) {
    if(await handle.queryPermission({mode:'readwrite'})!=='granted' && await handle.requestPermission({mode:'readwrite'})!=='granted')throw new Error('Autorize a gravação para vincular o arquivo.');
    state.trackingHandle=handle;state.trackingMode='file';
  }
  state.tracking=mergeTracking(payload,state.tracking);
  overlayTracking();queueTrackingWrite();toast('Acompanhamento importado. Notas e marcações anteriores foram preservadas.');
}
async function openTrackingFile() {
  if(!window.showOpenFilePicker){$('#tracking-input').click();return;}
  try {const [handle]=await window.showOpenFilePicker({multiple:false,types:[{description:'Acompanhamento JSON',accept:{'application/json':['.json']}}]});await importTrackingFile(await handle.getFile(),handle);}
  catch(error) {if(error.name!=='AbortError')toast(error.message||'Não foi possível abrir o acompanhamento.');}
}
function exportTrackingBackup() {downloadFile(JSON.stringify(state.tracking,null,2),'application/json;charset=utf-8','parcerias-acompanhamento-'+new Date().toISOString().slice(0,10)+'.json');toast('Backup do acompanhamento exportado, com todas as marcações e notas.');}
async function linkTrackingFile() {
  if(!window.showSaveFilePicker){exportTrackingBackup();return;}
  try {
    const handle=await window.showSaveFilePicker({suggestedName:'parcerias-acompanhamento.json',types:[{description:'Acompanhamento JSON',accept:{'application/json':['.json']}}]});
    // Existing research/other JSON files are never overwritten by the tracker.
    const file=await handle.getFile();if(file.size){if(file.size>MAX_FILE_BYTES)throw new Error('O arquivo escolhido excede 10 MB.');const existing=JSON.parse((await file.text()).replace(/^\uFEFF/,''));if(existing?.schema!==TRACKING_SCHEMA)throw new Error('Este JSON contém outros dados. Escolha um novo nome para o acompanhamento.');validateTrackingEnvelope(existing);state.tracking=mergeTracking(existing,state.tracking);}
    state.trackingHandle=handle;state.trackingMode='file';overlayTracking();queueTrackingWrite();
  } catch(error) {if(error.name!=='AbortError')toast(error.message||'Não foi possível vincular o arquivo.');}
}
function recordProjectProgress(project,change) {
  const eventId=globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  state.tracking=updatePartnershipTracking(state.tracking,project,change,new Date().toISOString(),eventId);
  overlayTracking();queueTrackingWrite();
}

// Data loading. No imported content is executed or sent to a remote service.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;
async function getJson(url, timeout = 12000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try { const response = await fetch(url,{cache:'no-store',signal:controller.signal}); if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json(); } finally { clearTimeout(timer); }
}
async function fetchBase() {
  const embedded = $('#initial-data');
  function embeddedBase() {
    const payload=JSON.parse(embedded.textContent);
    const files=payload?.bundle_schema==='parcerias-explorer/datasets-v1'&&Array.isArray(payload.datasets)
      ?payload.datasets.map(file=>({fileName:'dados/'+txt(file.fileName).replace(/^dados\//,''),payload:file.payload,lastModified:file.lastModified||0}))
      :[{fileName:'Base inicial/100_empreendimentos_parcerias_sp.json',payload,lastModified:0}];
    return {files,mode:'embedded',label:'Pesquisas incluídas no HTML',errors:[]};
  }
  if (embedded && location.protocol === 'file:') return embeddedBase();
  if (location.protocol !== 'file:') {
    try {
      const data = await getJson('./api/datasets');
      if (data.mode === 'server-folder' && Array.isArray(data.files)) return {files:data.files.map(f=>({...f,fileName:'dados/'+f.fileName})),mode:'server-folder',label:'Pasta do servidor · dados/',errors:array(data.errors)};
    } catch { /* A static hosted Site has no directory API; use the published manifest. */ }
    try {
      const manifest = await getJson('./datasets.manifest.json');
      if (!Array.isArray(manifest.files) || manifest.files.length>2000) throw new Error('Manifesto inválido.');
      const files=[], errors=[];
      for (const item of manifest.files) {
        try {
          const url = new URL(item.url,location.href);
          if (url.origin !== location.origin || !/\.json$/i.test(url.pathname)) throw new Error('Caminho de dados inválido.');
          files.push({fileName:'Base publicada/'+item.fileName,payload:await getJson(url.href),lastModified:0});
        } catch(error) { errors.push({fileName:item.fileName,message:'Não foi possível ler este arquivo da base publicada.'}); }
      }
      return {files,mode:'manifest',label:'Pesquisa inicial publicada',errors};
    } catch(error) { if (!embedded) throw new Error('Não foi possível carregar a base inicial. Você pode selecionar a pasta ou os arquivos JSON.'); }
  }
  if (embedded) return embeddedBase();
  throw new Error('Abra parcerias.html ou inicie o servidor local para carregar a pesquisa. Você também pode adicionar arquivos JSON.');
}
async function readFileList(fileList, prefix) {
  const files=[],errors=[]; let total=0,count=0;
  for (const file of fileList) {
    const name = file.webkitRelativePath || file.name;
    if (!/\.json$/i.test(name)) continue;
    count++;
    if (count>2000) { errors.push({fileName:prefix,message:'Limite de 2.000 arquivos JSON por leitura atingido.'}); break; }
    if (file.size>MAX_FILE_BYTES || total+file.size>MAX_BATCH_BYTES) { errors.push({fileName:name,message:'Arquivo excede o limite de 10 MB por arquivo ou 50 MB por leitura.'}); continue; }
    total+=file.size;
    try { files.push({fileName:prefix+'/'+name,payload:JSON.parse((await file.text()).replace(/^\uFEFF/,'')),lastModified:file.lastModified}); }
    catch { errors.push({fileName:name,message:'JSON inválido ou arquivo indisponível. Corrija o arquivo e importe novamente.'}); }
  }
  if (!count) errors.push({fileName:prefix,message:'Nenhum arquivo .json encontrado na seleção.'});
  return {files,errors};
}
async function readDirectory(handle) {
  const collected=[],errors=[];
  async function walk(directory,prefix='',depth=0) {
    if(depth>20) { errors.push({fileName:prefix,message:'Limite de profundidade de subpastas atingido.'}); return; }
    const entries=[]; for await (const [name,entry] of directory.entries()) entries.push([name,entry]);
    entries.sort((a,b)=>a[0].localeCompare(b[0],'pt-BR'));
    for(const [name,entry] of entries) {
      if(collected.length>=2000) { errors.push({fileName:prefix,message:'Limite de 2.000 arquivos JSON por leitura atingido.'}); return; }
      if(entry.kind==='directory') { await walk(entry,prefix+name+'/',depth+1); continue; }
      if(!/\.json$/i.test(name)) continue;
      try { const file=await entry.getFile(); collected.push({file,name:prefix+name}); } catch { errors.push({fileName:prefix+name,message:'Não foi possível acessar o arquivo.'}); }
    }
  }
  await walk(handle);
  let total=0; const files=[];
  for(const {file,name} of collected) {
    if(file.size>MAX_FILE_BYTES||total+file.size>MAX_BATCH_BYTES) { errors.push({fileName:name,message:'Arquivo excede o limite de leitura (10 MB por arquivo / 50 MB total).'}); continue; }
    total+=file.size;
    try { files.push({fileName:'Pasta '+handle.name+'/'+name,payload:JSON.parse((await file.text()).replace(/^\uFEFF/,'')),lastModified:file.lastModified}); }
    catch { errors.push({fileName:name,message:'JSON inválido. Os demais arquivos continuam disponíveis.'}); }
  }
  if(!collected.length) errors.push({fileName:handle.name,message:'Nenhum arquivo .json encontrado nesta pasta.'});
  return {files,errors};
}
function allFiles() { return [...(state.useBase?state.baseFiles:[]),...state.folderFiles,...state.extraFiles]; }
function rebuild() {
  const previousTracking=trackingFingerprint(state.tracking);
  const importedTracking=[],trackingWarnings=[];
  for(const file of allFiles()) {const tracking=trackingPayloadFrom(file.payload);if(tracking)try{validateTrackingEnvelope(tracking);importedTracking.push(tracking);}catch(error){trackingWarnings.push({fileName:file.fileName,message:error.message+' O acompanhamento deste arquivo não foi importado; a pesquisa continua disponível.'});}}
  state.tracking=mergeTracking(...importedTracking,state.tracking);
  state.model=ingestDatasets(allFiles());state.tracking=applyPartnershipTracking(state.model.projects,state.tracking);
  state.model.warnings.push(...trackingWarnings);
  state.facets=buildFacets(state.model.projects); state.loadRevision++;
  renderStats(); renderFilters(); renderProjects(); renderPartners(); renderFiles(); renderSourceState(); renderNotices();
  if($('#detail-dialog').open && state.detailId) {
    const project=state.model.projects.find(p=>p.canonicalId===state.detailId);
    if(project) renderProjectDetail(project); else closeDialog('detail-dialog');
  }
  persistTrackingCache();renderTrackingState();
  if(previousTracking!==trackingFingerprint(state.tracking))queueTrackingWrite();
}
async function refresh({silent=false,initial=false}={}) {
  if(state.busy) return; state.busy=true; $('#refresh-button').disabled=true;
  try {
    const errors=[]; let didRead=false;
    if(initial || state.useBase) {
      const base=await fetchBase(); state.baseFiles=base.files; state.baseMode=base.mode; state.baseLabel=base.label; errors.push(...base.errors); didRead=true;
    }
    if(state.folderHandle) {
      let permission=await state.folderHandle.queryPermission({mode:'read'});
      if(permission!=='granted'&&!silent) permission=await state.folderHandle.requestPermission({mode:'read'});
      if(permission==='granted') { const result=await readDirectory(state.folderHandle); state.folderFiles=result.files; errors.push(...result.errors); didRead=true; }
      else errors.push({fileName:state.folderName,message:'Autorize a leitura da pasta novamente para atualizar seus arquivos.'});
    }
    state.loadErrors=errors; rebuild();
    if(!silent&&!initial) toast(state.folderSnapshot?'Base atualizada. Para reler a pasta selecionada, escolha a pasta novamente.':didRead?'Dados atualizados e repetições consolidadas.':'Reimporte os arquivos para ler novas versões.');
  } catch(error) { state.loadErrors=[{fileName:'Carregamento',message:error.message}]; if(!state.model) rebuild(); else {renderNotices();renderFiles();} if(!silent) toast(error.message); }
  finally {state.busy=false;$('#refresh-button').disabled=false;renderSourceState();}
}
function importMode() { return $('input[name="import-mode"]:checked')?.value || 'add'; }
function prepareReplacement() { state.useBase=false;state.extraFiles=[];state.folderFiles=[];state.folderHandle=null;state.folderSnapshot=false;state.folderName=''; }
function incorporate(result,{kind='files',mode='add',handle=null,name='',sameFolder=false}={}) {
  if(!result.files.length) { state.loadErrors=result.errors;renderNotices();renderFiles();toast('Nenhum arquivo válido foi adicionado.');return; }
  if(mode==='replace') prepareReplacement();
  if(kind==='folder') {
    if(mode==='add'&&state.folderFiles.length&&!sameFolder) {
      const snapshots=new Map(state.extraFiles.map(f=>[f.fileName,f]));
      for(const file of state.folderFiles) snapshots.set(file.fileName,file);
      state.extraFiles=[...snapshots.values()];
    }
    const incoming=new Set(result.files.map(f=>f.fileName));
    state.extraFiles=state.extraFiles.filter(f=>!incoming.has(f.fileName));
    state.folderFiles=result.files;state.folderHandle=handle;state.folderSnapshot=!handle;state.folderName=name;
  } else {
    const map=new Map(state.extraFiles.map(f=>[f.fileName,f])); for(const file of result.files) map.set(file.fileName,file); state.extraFiles=[...map.values()];
  }
  state.loadErrors=result.errors;state.page=1;rebuild();toast(`${result.files.length} arquivo(s) lido(s). A base foi consolidada.`);
}
async function chooseFolder() {
  if(typeof window.showDirectoryPicker==='function') {
    try {
      const handle=await window.showDirectoryPicker({id:'dyhouse-parcerias-json',mode:'read'});
      const sameFolder=state.folderHandle?await handle.isSameEntry(state.folderHandle):state.folderName===handle.name;
      const result=await readDirectory(handle);incorporate(result,{kind:'folder',mode:importMode(),handle,name:handle.name,sameFolder});return;
    } catch(error) {
      if(error.name==='AbortError') return;
      if(!['SecurityError','NotAllowedError','TypeError'].includes(error.name)) {toast('Não foi possível ler a pasta. Tente adicionar os arquivos JSON.');return;}
    }
  }
  $('#folder-input').click();
}
function setupAutoRefresh() {
  clearInterval(state.autoTimer);state.autoTimer=null;
  const supported=(state.useBase&&state.baseMode==='server-folder')||Boolean(state.folderHandle);
  $('#auto-refresh').disabled=!supported;
  if(!supported) $('#auto-refresh').checked=false;
  if($('#auto-refresh').checked&&supported) state.autoTimer=setInterval(()=>{if(!document.hidden)refresh({silent:true});},30000);
  $('#auto-refresh-note').textContent=supported?'A pasta será relida a cada 30 segundos enquanto esta página estiver visível.':'Neste modo, clique em selecionar a pasta ou adicionar arquivos novamente para ler novos lotes.';
}

// Filtering and rendering.
function mcmvTone(category) {return category==='sim_fonte_oficial'?'green':category==='sim_fonte_comercial'?'blue':category==='sim_sem_fonte'?'purple':category?.startsWith('nao_')?'gray':'amber';}
function mcmvShort(category) {return ({sim_fonte_oficial:'Sim · oficial',sim_fonte_comercial:'Sim · comercial',sim_sem_fonte:'Sim · sem fonte',nao_inferencia_preco:'Não · por preço',nao_declarado:'Não · declarado',a_confirmar:'A confirmar'})[category]||'A confirmar';}
function badge(label,tone='neutral',title='') {return `<span class="tag ${tone}"${title?` title="${escapeHtml(title)}"`:''}>${escapeHtml(label)}</span>`;}
function companyName(project) {return project.developer||project.partner_group||'Empresa não informada';}
function projectCode(project) {return [...new Set(array(project.provenance).map(p=>p.originalId).filter(Boolean))].join(' · ')||project.id||'Sem código de origem';}
function renderStats() {
  const model=state.model;const projects=model.projects;const stats=model.stats||{};
  $('#stat-projects').textContent=formatNumber(projects.length);$('#stat-records').textContent=`${formatNumber(stats.inputProjects)} registros · ${formatNumber(allFiles().length)} arquivo(s)`;
  const official=projects.filter(p=>p.normalized.mcmv==='sim_fonte_oficial').length;const commercial=projects.filter(p=>p.normalized.mcmv==='sim_fonte_comercial').length;const unspecified=projects.filter(p=>p.normalized.mcmv==='sim_sem_fonte').length;
  $('#stat-mcmv').textContent=formatNumber(official+commercial+unspecified);$('#stat-mcmv-note').textContent=`${official} oficial · ${commercial} comercial${unspecified?' · '+unspecified+' sem fonte':''}`;
  $('#stat-south').textContent=formatNumber(projects.filter(p=>p.normalized.zone==='Sul').length);$('#stat-partners').textContent=formatNumber(model.partners.length);
  $('#tab-project-count').textContent=projects.length;$('#tab-partner-count').textContent=model.partners.length;$('#tab-file-count').textContent=allFiles().length;
}
function renderSourceState() {
  const fileCount=allFiles().length;
  $('#source-status').textContent=state.folderHandle?`Pasta conectada · ${state.folderName}`:state.folderSnapshot?`Pasta selecionada · ${state.folderName}`:state.extraFiles.length?`${fileCount} arquivo(s) na base`:(state.useBase?state.baseLabel:'Arquivos selecionados');
  $('#updated-status').textContent=`Última leitura ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
  const pieces=[];if(state.useBase) pieces.push(state.baseLabel);if(state.folderName) pieces.push(`Pasta: ${state.folderName}${state.folderSnapshot?' (seleção pontual)':' (conectada)'}`);if(state.extraFiles.length) pieces.push(`${state.extraFiles.length} arquivo(s) adicionado(s)`);
  $('#folder-status').textContent=pieces.join(' · ')||'Nenhuma fonte selecionada.';setupAutoRefresh();
}
function renderNotices() {
  const errors=state.loadErrors.length+array(state.model?.warnings).filter(w=>/invalid|error|missing/i.test(w.code)).length;
  const conflicts=state.model?.projects.filter(p=>p.conflicts.length).length||0;
  let html='';
  if(errors) html+=`<div class="notice error">${icon('warning')}<span>${errors} aviso(s) de leitura. Os arquivos válidos continuam disponíveis.</span><button class="text-button" data-go-tab="files">Ver arquivos</button></div>`;
  if(conflicts) html+=`<div class="notice">${icon('info')}<span>${conflicts} empreendimento(s) têm informações diferentes entre os arquivos. Consulte as versões antes de usar esses dados.</span><button class="text-button" data-quality-filter="onlyConflicts">Conferir</button></div>`;
  $('#notice-area').innerHTML=html;
}
function optionsFor(key) {return array(state.facets[key]);}
function checkOptions(key) {return optionsFor(key).map(o=>`<label class="check-row" data-option-text="${escapeHtml(normalizeText(o.label))}"><input type="checkbox" data-filter="${key}" value="${escapeHtml(o.value)}" ${state.filters[key].map(String).includes(String(o.value))?'checked':''}><span class="option-label">${escapeHtml(o.label)}</span><span class="option-count">${o.count}</span></label>`).join('');}
function selectFilter(key,label=FILTER_LABELS[key]) {return `<label class="select-filter">${escapeHtml(label)}<select data-select-filter="${key}" aria-label="${escapeHtml(label)}"><option value="">Todos</option>${optionsFor(key).map(o=>`<option value="${escapeHtml(o.value)}" ${state.filters[key].map(String).includes(String(o.value))?'selected':''}>${escapeHtml(o.label)} (${o.count})</option>`).join('')}</select></label>`;}
function renderFilters() {
  const openState=new Map($$('#filter-groups details').map(d=>[d.dataset.group,d.open]));const companySearch=$('#company-filter-search')?.value||'';
  $('#filter-groups').innerHTML=`<details class="filter-group" data-group="companies" open><summary>Empresa</summary><input class="filter-search" id="company-filter-search" type="search" placeholder="Encontrar empresa…" aria-label="Encontrar empresa no filtro" value="${escapeHtml(companySearch)}"><div class="filter-options" id="company-options">${checkOptions('companies')}</div></details>
    <details class="filter-group" data-group="cities" open><summary>Cidade</summary><div class="filter-options">${checkOptions('cities')}</div></details>
    <details class="filter-group" data-group="zones" open><summary>Região</summary><div class="zone-options">${optionsFor('zones').map(o=>`<button class="zone-chip ${state.filters.zones.includes(o.value)?'active':''}" data-toggle-zone="${escapeHtml(o.value)}" aria-pressed="${state.filters.zones.includes(o.value)}">${escapeHtml(o.label)}</button>`).join('')}</div>${selectFilter('neighborhoods')}</details>
    <details class="filter-group" data-group="partnershipStatuses" open><summary>Minha parceria</summary><div class="filter-options">${checkOptions('partnershipStatuses')}</div></details>
    <details class="filter-group" data-group="mcmv" open><summary>Minha Casa Minha Vida</summary><div class="filter-options">${checkOptions('mcmv')}</div></details>
    <details class="filter-group" data-group="propertyTypes"><summary>Tipo de empreendimento</summary><div class="filter-options">${checkOptions('propertyTypes')}</div></details>
    <details class="filter-group" data-group="stages" open><summary>Estágio</summary><div class="filter-options">${checkOptions('stages')}</div>${selectFilter('years')}</details>
    <details class="filter-group" data-group="more"><summary>Parceria & qualidade</summary>${selectFilter('routeQualities','Verificação do canal')}${selectFilter('ai')}${selectFilter('contactStatuses')}<div class="filter-options"><label class="check-row"><input type="checkbox" data-boolean-filter="onlyConflicts" ${state.filters.onlyConflicts?'checked':''}><span>Com divergências entre arquivos</span></label><label class="check-row"><input type="checkbox" data-boolean-filter="onlyDuplicates" ${state.filters.onlyDuplicates?'checked':''}><span>Repetidos já consolidados</span></label><label class="check-row"><input type="checkbox" data-boolean-filter="onlyPossibleDuplicates" ${state.filters.onlyPossibleDuplicates?'checked':''}><span>Possíveis duplicidades</span></label></div></details>`;
  $$('#filter-groups details').forEach(d=>{if(openState.has(d.dataset.group))d.open=openState.get(d.dataset.group);});
  filterCompaniesInSidebar(companySearch);
}
function filterCompaniesInSidebar(query) {const term=normalizeText(query);$$('#company-options .check-row').forEach(el=>{el.hidden=!el.dataset.optionText.includes(term);});}
function filterSize() {return Object.values(state.filters).reduce((n,v)=>n+(Array.isArray(v)?v.length:typeof v==='boolean'?(v?1:0):v?1:0),0);}
function labelFor(key,value) {return optionsFor(key).find(o=>String(o.value)===String(value))?.label||String(value);}
function renderActiveFilters() {
  const chips=[];
  for(const [key,value] of Object.entries(state.filters)) {
    if(Array.isArray(value)) value.forEach(v=>chips.push({key,value:v,label:`${FILTER_LABELS[key]}: ${labelFor(key,v)}`}));
    else if(key==='query'&&value) chips.push({key,value:'',label:`Busca: ${value}`});
    else if(value===true) chips.push({key,value:'',label:({onlyConflicts:'Com divergências',onlyDuplicates:'Repetidos consolidados',onlyPossibleDuplicates:'Possíveis duplicidades'})[key]||key});
  }
  $('#active-filters').innerHTML=chips.map(c=>`<button class="active-chip" data-remove-filter="${c.key}" data-remove-value="${escapeHtml(c.value)}" aria-label="Remover filtro ${escapeHtml(c.label)}">${escapeHtml(c.label)}${icon('close')}</button>`).join('');
  $('#filter-count').textContent=chips.length?`(${chips.length})`:'';
}
function filteredProjects() {
  const projects=filterProjects(state.model?.projects||[],state.filters);const compare=(a,b)=>txt(a).localeCompare(txt(b),'pt-BR',{sensitivity:'base',numeric:true});
  if(state.sort==='original') {
    const fileOrder=new Map(allFiles().map((file,index)=>[file.fileName,index]));
    const originalOrder=p=>array(p.provenance).reduce((best,entry)=>{
      const fileIndex=fileOrder.get(entry.fileName);
      return fileIndex===undefined?best:Math.min(best,fileIndex*1000000+(Number(entry.rowIndex)||0));
    },Number.MAX_SAFE_INTEGER);
    projects.sort((a,b)=>originalOrder(a)-originalOrder(b)||compare(projectCode(a),projectCode(b))||compare(a.name,b.name));
  }
  if(state.sort==='name') projects.sort((a,b)=>compare(a.name,b.name));
  if(state.sort==='company') projects.sort((a,b)=>compare(companyName(a),companyName(b))||compare(a.name,b.name));
  if(state.sort==='city') projects.sort((a,b)=>compare(a.normalized.city,b.normalized.city)||compare(a.name,b.name));
  if(state.sort==='zone') projects.sort((a,b)=>compare(a.normalized.zone,b.normalized.zone)||compare(a.neighborhood,b.neighborhood)||compare(a.name,b.name));
  if(state.sort==='recent') projects.sort((a,b)=>(Date.parse(b.checked_at)||0)-(Date.parse(a.checked_at)||0)||compare(a.name,b.name));
  if(state.sort==='conflicts') projects.sort((a,b)=>b.conflicts.length-a.conflicts.length||compare(a.name,b.name));
  return projects;
}
function projectFlag(p) {return p.conflicts.length?`<div class="quality-dots"><span title="Há informações divergentes entre as fontes">${p.conflicts.length} divergência(s)</span></div>`:p.occurrences>1?`<span class="cell-secondary">${p.occurrences} registros consolidados</span>`:'';}
function partnershipBadge(p) {const status=p.normalized.partnershipStatus||'nao_solicitada';return `<span class="partnership-badge status-${status}" title="Marcação do usuário">${escapeHtml(PARTNERSHIP_STATUS_LABELS[status])}${p.partnershipTracking?.events?.filter(event=>event.kind==='note').length?` · ${p.partnershipTracking.events.filter(event=>event.kind==='note').length} nota(s)`:''}</span>`;}
function propertyBadge(p) {return p.property_type && !/^apartamento$/i.test(p.property_type)?badge(p.property_type,'amber'):'';}
function projectRow(p,index) {
  return `<tr><td><div class="project-cell"><span class="project-avatar tone-${index%4}">${icon('building')}</span><div><button class="project-name" data-project-id="${p.canonicalId}">${escapeHtml(p.name)}</button><span class="project-code">${escapeHtml(projectCode(p))}</span>${partnershipBadge(p)}${propertyBadge(p)}${projectFlag(p)}</div></div></td><td class="company-cell">${escapeHtml(companyName(p))}</td><td class="location-cell">${escapeHtml(p.neighborhood||'Bairro não informado')}<span class="cell-secondary">${escapeHtml(p.normalized.city)} · ${escapeHtml(p.normalized.zone)}</span></td><td>${badge(mcmvShort(p.normalized.mcmv),mcmvTone(p.normalized.mcmv),p.mcmv_evidence)}</td><td class="stage-column">${badge(STAGE_LABELS[p.normalized.stage]||p.stage,'neutral',p.stage)}<span class="cell-secondary">${p.normalized.year||'Data a confirmar'}</span></td><td><button class="row-detail" data-project-id="${p.canonicalId}" aria-label="Ver detalhes de ${escapeHtml(p.name)}">${icon('chevron-right')}</button></td></tr>`;
}
function projectCard(p,index) {return `<article class="project-card"><div class="project-card-top"><span class="project-avatar tone-${index%4}">${icon('building')}</span><div><button class="project-name" data-project-id="${p.canonicalId}">${escapeHtml(p.name)}</button><p class="project-card-company">${escapeHtml(companyName(p))}</p><span class="project-code">${escapeHtml(projectCode(p))}</span></div><button class="row-detail" data-project-id="${p.canonicalId}" aria-label="Ver detalhes de ${escapeHtml(p.name)}">${icon('chevron-right')}</button></div><p class="project-card-meta">${icon('pin')}${escapeHtml(p.neighborhood||'Bairro não informado')} · ${escapeHtml(p.normalized.city)} · ${escapeHtml(p.normalized.zone)}</p><div class="project-card-tags">${partnershipBadge(p)}${propertyBadge(p)}${badge(mcmvShort(p.normalized.mcmv),mcmvTone(p.normalized.mcmv))}${badge(STAGE_LABELS[p.normalized.stage]||'Estágio a confirmar','neutral')}</div>${projectFlag(p)}</article>`;}
function renderProjects() {
  const projects=filteredProjects();const total=state.model?.projects.length||0;const pageCount=Math.max(1,Math.ceil(projects.length/state.pageSize));state.page=Math.max(1,Math.min(state.page,pageCount));
  const start=(state.page-1)*state.pageSize;const page=projects.slice(start,start+state.pageSize);
  $('#result-count').textContent=formatNumber(projects.length);$('#result-noun').textContent=projects.length===1?'empreendimento':'empreendimentos';$('#result-context').textContent=filterSize()?`de ${formatNumber(total)} na base`:'';
  $('#result-caption').textContent=filterSize()?'Exibindo o recorte dos filtros selecionados.':'Todos os critérios da pesquisa preservados.';renderActiveFilters();
  if(!projects.length) $('#project-results').innerHTML=`<div class="empty-state"><div class="empty-icon">${icon('search')}</div><h3>${total?'Nenhum empreendimento neste recorte':'Sua base está vazia'}</h3><p>${total?'Experimente remover um filtro ou buscar por outro bairro. Seus arquivos continuam preservados.':'Adicione um arquivo JSON ou selecione uma pasta para começar.'}</p><button class="button primary" ${total?'data-clear-filters':'data-open-sources'}>${total?'Limpar filtros':'Adicionar dados'}</button></div>`;
  else $('#project-results').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Empreendimento</th><th>Empresa</th><th>Localização</th><th>MCMV</th><th class="stage-column">Estágio</th><th><span class="sr-only">Detalhes</span></th></tr></thead><tbody>${page.map(projectRow).join('')}</tbody></table></div><div class="project-cards">${page.map(projectCard).join('')}</div>`;
  $('#pagination').hidden=!projects.length;$('#page-info').textContent=`${start+1}–${Math.min(start+state.pageSize,projects.length)} de ${projects.length}`;$('#page-number').textContent=`${state.page} / ${pageCount}`;$('#previous-page').disabled=state.page<=1;$('#next-page').disabled=state.page>=pageCount;
  $('#sort-select').value=state.sort;$('#page-size').value=String(state.pageSize);persistView();
}
function applyFilters() {state.page=1;renderFilters();renderProjects();}
function clearFilters() {state.filters=emptyFilters();$('#search-input').value='';applyFilters();}
function switchTab(tab) {
  if(!['projects','partners','files'].includes(tab))return;state.tab=tab;
  ['projects','partners','files'].forEach(t=>{document.getElementById(t+'-panel').hidden=t!==tab;});
  $$('[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===tab);if(el.dataset.tab===tab)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
}

// Details, partner routes and provenance.
function definition(label,value,wide=false) {return `<div${wide?' class="wide"':''}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(txt(value)||'Não informado')}</dd></div>`;}
function detailText(title,content,callout='') {return content?`<section class="detail-section ${callout?'detail-callout '+callout:''}"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(txt(content))}</p></section>`:'';}
function sourceLinks(values) {
  const urls=[...new Set(array(values).map(s=>safeLink(typeof s==='string'?s:s?.url)).filter(Boolean))];
  return urls.length?urls.map(url=>{let label=url;try{label=new URL(url).hostname.replace(/^www\./,'');}catch{}return `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${escapeHtml(label)}<small>${escapeHtml(url)}</small></span></a>`;}).join(''):'<p class="small-copy">Nenhum link de fonte informado neste registro.</p>';
}
function stepText(value) {return txt(value).replace(/\s+(?=\d+[.)]\s)/g,'\n');}
function routeHtml(route,project=null) {
  const pf=route.pf_url||route.partner_url||project?.pf_url;const pj=route.pj_url||route.partner_url||project?.pj_url;
  const message=project?.request_template||route.request_template||'';
  const commissionPf=project?(project.commission_pf||'Não publicada para este empreendimento'):(route.commission_pf||'Não publicada');
  const commissionPj=project?(project.commission_pj||'Não publicada para este empreendimento'):(route.commission_pj||'Não publicada');
  return `<article class="route-block"><div class="route-block-head"><div><h3>${escapeHtml(route.developer||route.partner_group||'Canal de parceria')}</h3><p class="route-qualifier">${escapeHtml(route.route_status||project?.route_status||'Verificação não informada')}</p></div>${badge(route.id||'Canal','neutral')}</div>
    <div class="route-links">${externalLink(pf,'Abrir canal PF','button primary small')}${externalLink(pj,'Abrir canal PJ','button secondary small')}</div>
    ${detailText('Contato',route.contact||project?.partner_contact)}
    <div class="route-grid"><div><span>Condições PF</span><strong>${escapeHtml(route.pf||project?.pf_summary||'A confirmar')}</strong></div><div><span>Condições PJ</span><strong>${escapeHtml(route.pj||project?.pj_summary||'A confirmar')}</strong></div><div><span>Comissão PF${project?' — empreendimento':' publicada'}</span><strong>${escapeHtml(commissionPf)}</strong></div><div><span>Comissão PJ${project?' — empreendimento':' publicada'}</span><strong>${escapeHtml(commissionPj)}</strong></div></div>
    ${detailText('Próxima ação',project?.next_action,'')}
    <details open><summary>Passo a passo do credenciamento</summary><p>${escapeHtml(stepText(route.steps||'Solicitar à empresa as instruções de credenciamento para este empreendimento.'))}</p></details>
    <details><summary>Condições para solicitação por IA</summary><p>${escapeHtml(route.ai_eligibility||route.ai_status||project?.ai_status||'A confirmar')}</p><p>${escapeHtml(route.barriers||'')}</p></details>
    ${route.commission_basis?`<details><summary>${project?'Referência do canal — confirmar aplicação ao empreendimento':'Base e ressalvas da comissão'}</summary><p>${escapeHtml(route.commission_basis)}</p></details>`:''}
    ${message?`<details><summary>Mensagem sugerida</summary><div class="message-box">${escapeHtml(message)}</div><button class="button secondary small" data-copy-message ${project?`data-copy-project="${project.canonicalId}"`:`data-copy-route="${route.routeId}"`}>${icon('copy')}Copiar mensagem</button></details>`:''}
    ${route.source_urls?.length?`<details><summary>Fontes deste canal</summary>${sourceLinks(route.source_urls)}</details>`:''}
  </article>`;
}
function projectDetailBody(p) {
  if(state.detailTab==='partnership') {
    const routes=p.routes?.length?p.routes:[{developer:companyName(p),pf_url:p.pf_url,pj_url:p.pj_url,contact:p.partner_contact}];
    return `<div class="detail-section detail-callout"><h3>Solicitação de parceria externa</h3><p>Peça a habilitação nominal deste empreendimento. O canal encontrado não representa parceria aprovada nem garante a comissão.</p></div>${routes.map(r=>routeHtml(r,p)).join('')}`;
  }
  if(state.detailTab==='sources') {
    const conflicts=array(p.conflicts);const fieldNames={mcmv:'Minha Casa Minha Vida',mcmv_category:'Classificação MCMV',stage:'Estágio',launch_date:'Lançamento',address:'Endereço',developer:'Empresa',zone:'Zona',neighborhood:'Bairro',commission_pf:'Comissão PF',commission_pj:'Comissão PJ',name:'Nome',route_status:'Verificação do canal'};
    return `${conflicts.length?`<section class="detail-section"><h3>Divergências entre versões</h3><p>A consulta mais recente orienta os dados principais. Os valores encontrados permanecem abaixo para conferência.</p>${conflicts.map(c=>`<div class="conflict-card"><h4>${escapeHtml(fieldNames[c.field]||c.field)}</h4><ul>${array(c.values).map(v=>`<li>${escapeHtml(txt(v.value))}<br><small>${escapeHtml(array(v.files).join(' · '))}</small></li>`).join('')}</ul></div>`).join('')}</section>`:''}
      <section class="detail-section"><h3>Origem dos registros · ${p.occurrences}</h3>${array(p.provenance).map(v=>`<div class="provenance-row"><strong>${escapeHtml(v.fileName)}</strong><br>${escapeHtml(v.originalId||'Sem ID')} · Consulta ${escapeHtml(readableDate(v.checkedAt))}</div>`).join('')}</section>
      ${p.aliases?.length>1?detailText('Nomes encontrados',p.aliases.join(' · ')):''}
      <section class="detail-section"><h3>Fontes da pesquisa</h3>${sourceLinks([...array(p.source_urls),...array(p.sources),...array(p.project_urls),p.project_url])}</section>`;
  }
  return `<dl class="definition-grid">${definition('Empresa',companyName(p))}${definition('Região',p.normalized.zone)}${p.property_type?definition('Tipo',p.property_type):''}${definition('Endereço',p.address,true)}${definition('Cidade',p.normalized.city)}${definition('Consulta',readableDate(p.checked_at))}${definition('Estágio publicado',p.stage)}${definition('Lançamento / ressalva',p.launch_date)}${definition('Contato registrado na pesquisa',p.outreach_status||'Não contatado')}${definition('Registros consolidados',p.occurrences)}</dl>
    ${detailText('Minha Casa Minha Vida',p.mcmv_evidence,'amber')}${detailText('Evidência da fase e recência',p.recency_evidence)}${detailText('Observações do empreendimento',p.notes)}
    ${p.possibleDuplicateIds?.length?`<div class="detail-section detail-callout amber"><h3>Possível repetição em outro registro</h3><p>Há nomes ou endereços semelhantes que foram mantidos separados para preservar fases e produtos distintos.</p>${p.possibleDuplicateIds.map(id=>{const other=state.model.projects.find(v=>v.canonicalId===id);return other?`<button class="text-button" data-project-id="${id}">${escapeHtml(other.name)}</button>`:'';}).join(' · ')}</div>`:''}
    ${p.conflicts.length?`<button class="button secondary small" data-detail-tab="sources">${icon('warning')}Conferir ${p.conflicts.length} divergência(s)</button>`:''}`;
}
function trackingPanel(p) {
  const tracking=p.partnershipTracking||{status:'nao_solicitada',events:[]};
  return `<section class="project-tracking" aria-labelledby="tracking-heading"><div class="tracking-heading"><div><h3 id="tracking-heading">Meu acompanhamento</h3><p>Registre o andamento do contato e da parceria.</p></div>${partnershipBadge(p)}</div>
    <div class="tracking-status-label"><label for="project-partnership-status">Situação da parceria</label><select id="project-partnership-status" data-project-status="${p.canonicalId}">${Object.entries(PARTNERSHIP_STATUS_LABELS).map(([value,label])=>`<option value="${value}" ${tracking.status===value?'selected':''}>${label}</option>`).join('')}</select></div>
    <p class="tracking-disclaimer">Marcações do usuário. A página não envia solicitações nem confirma a aprovação pela empresa.${tracking.statusUpdatedAt?` Última marcação: ${escapeHtml(readableTimestamp(tracking.statusUpdatedAt))}.`:''}</p>
    <form id="tracking-note-form" data-note-project="${p.canonicalId}"><label for="tracking-note">Progresso do contato</label><textarea id="tracking-note" name="note" maxlength="6000" rows="3" placeholder="Ex.: cadastro enviado, responsável pelo atendimento, documentos pendentes ou próximo retorno…" required>${escapeHtml(state.noteDrafts.get(tracking.projectKey||p.canonicalId)||'')}</textarea><div class="tracking-note-actions"><span>A nota entra na linha do tempo com data e hora.</span><button type="submit" class="button primary small">Registrar progresso</button></div></form>
    <details class="tracking-timeline" open><summary>Linha do tempo <span>(${tracking.events.length})</span></summary>${tracking.events.length?`<ol>${[...tracking.events].reverse().map(event=>`<li class="timeline-${event.kind}"><time datetime="${escapeHtml(event.createdAt)}">${escapeHtml(readableTimestamp(event.createdAt))}</time><p>${escapeHtml(event.text)}</p></li>`).join('')}</ol>`:'<p class="tracking-empty">Nenhum registro ainda. Adicione uma nota ou altere a situação acima.</p>'}</details><p class="tracking-save-state" data-tracking-save-state></p></section>`;
}
function renderProjectDetail(p) {
  $('#detail-content').innerHTML=`<div class="dialog-top"><div><p class="eyebrow">EMPREENDIMENTO · ${escapeHtml(projectCode(p))}</p><h2 id="detail-title">${escapeHtml(p.name)}</h2><div class="detail-meta">${icon('pin')}${escapeHtml(p.neighborhood||'Bairro não informado')} · ${escapeHtml(p.normalized.city)}</div></div><button class="icon-button" data-close="detail-dialog" aria-label="Fechar detalhes">${icon('close')}</button></div>
    <div class="detail-tags">${propertyBadge(p)}${badge(MCMV_LABELS[p.normalized.mcmv]||p.mcmv,mcmvTone(p.normalized.mcmv))}${badge(STAGE_LABELS[p.normalized.stage]||p.stage,'neutral')}${p.occurrences>1?badge(p.occurrences+' registros consolidados','blue'):''}${p.conflicts.length?badge(p.conflicts.length+' divergência(s)','amber'):''}</div>
    ${trackingPanel(p)}
    <nav class="detail-tabs" aria-label="Detalhes do empreendimento">${[['overview','Visão geral'],['partnership','Parceria'],['sources','Fontes & versões']].map(([id,label])=>`<button class="detail-tab ${state.detailTab===id?'active':''}" data-detail-tab="${id}" ${state.detailTab===id?'aria-current="page"':''}>${label}</button>`).join('')}</nav>
    <div class="detail-body">${projectDetailBody(p)}</div><div class="detail-bottom">${externalLink(p.project_url,'Página do empreendimento','button secondary small')}<button class="button primary small" data-detail-tab="partnership">${icon('handshake')}Ver caminho de parceria</button></div>`;
  renderTrackingState();
}
function openProject(id,tab='overview') {const p=state.model?.projects.find(p=>p.canonicalId===id);if(!p)return;state.detailId=id;state.routeId=null;state.detailTab=tab;renderProjectDetail(p);openDialog('detail-dialog');$('#detail-dialog').scrollTop=0;}
function openRoute(id) {const route=state.model?.partners.find(r=>r.routeId===id);if(!route)return;state.detailId=null;state.routeId=id;$('#detail-content').innerHTML=`<div class="dialog-top"><div><p class="eyebrow">CANAL DE PARCERIA</p><h2 id="detail-title">${escapeHtml(route.developer||route.partner_group||'Canal')}</h2></div><button class="icon-button" data-close="detail-dialog" aria-label="Fechar detalhes">${icon('close')}</button></div><div class="detail-body">${routeHtml(route)}</div>`;openDialog('detail-dialog');$('#detail-dialog').scrollTop=0;}
function renderPartners() {
  const query=normalizeText($('#partner-search').value);const partners=(state.model?.partners||[]).filter(r=>normalizeText([r.developer,r.partner_group,r.channel,r.contact].join(' ')).includes(query));
  $('#partner-results').innerHTML=partners.length?partners.map(r=>{const count=state.model.projects.filter(p=>p.routes.some(v=>v.routeId===r.routeId)).length;return `<article class="partner-card"><div class="partner-card-head"><div><h3>${escapeHtml(r.developer||r.partner_group||'Canal de parceria')}</h3><p>${count} empreendimento(s) na base</p></div><span class="partner-mark">${escapeHtml((r.developer||'PC').split(/\s+/).map(s=>s[0]).slice(0,2).join(''))}</span></div><p>${escapeHtml(r.channel||'Solicitar credenciamento')}</p><p class="route-contact">${escapeHtml(r.contact||'Contato pelo portal indicado')}</p><span class="route-qualifier">${escapeHtml(r.route_status||'Verificação a confirmar')}</span><div class="partner-actions"><button class="button primary small" data-route-id="${r.routeId}">Ver credenciamento ${icon('chevron-right')}</button>${externalLink(r.pj_url||r.pf_url||r.partner_url,'Abrir canal','button secondary small')}</div></article>`;}).join(''):`<div class="empty-state"><h3>Nenhum canal encontrado</h3><p>Busque por outro nome de empresa.</p></div>`;
}
function renderFiles() {
  if(!state.model)return;const m=state.model;const stats=m.stats;
  $('#quality-summary').innerHTML=[[stats.inputProjects,'Registros recebidos'],[stats.duplicatesMerged,'Repetições consolidadas'],[stats.conflictProjects,'Empreendimentos com divergências'],[stats.possibleDuplicatePairs,'Pares para conferência']].map(([n,label])=>`<div class="quality-mini"><strong>${formatNumber(n)}</strong><span>${label}</span></div>`).join('');
  $('#file-results').innerHTML=m.files.length?m.files.map(f=>`<div class="file-row"><span class="file-icon">${icon('files')}</span><div class="file-meta"><strong>${escapeHtml(f.fileName)}</strong><p>${f.acceptedCount||0} registro(s) aproveitado(s) · ${f.partnerCount||0} parceiro(s)</p>${f.error?`<p>${escapeHtml(f.error)}</p>`:''}</div>${badge(f.valid?'Lido':'Revisar',f.valid?'green':'amber')}<button class="icon-button" data-remove-file="${escapeHtml(f.fileName)}" aria-label="Remover ${escapeHtml(f.fileName)} da sessão">${icon('close')}</button></div>`).join(''):'<p class="small-copy">Nenhum arquivo carregado.</p>';
  const warnings=[...state.loadErrors,...array(m.warnings)];
  $('#data-warnings').innerHTML=warnings.length?`<div class="data-block"><h3>Avisos de leitura</h3>${warnings.map(w=>`<div class="notice error">${icon('warning')}<span><strong>${escapeHtml(w.fileName||'Arquivo')}</strong> · ${escapeHtml(w.message||w.code)}</span></div>`).join('')}</div>`:'';
  const duplicates=m.projects.filter(p=>p.occurrences>1);
  $('#duplicates-results').innerHTML=duplicates.length?`<div class="data-block"><h3>Repetições consolidadas</h3><p>Cada empreendimento aparece uma vez na lista. As versões e os canais continuam disponíveis.</p>${duplicates.map(p=>`<div class="data-row"><div><h4>${escapeHtml(p.name)}</h4><p>${p.occurrences} registros · ${p.conflicts.length} divergência(s)</p></div><button class="button secondary small" data-project-id="${p.canonicalId}" data-open-detail-tab="sources">Ver versões</button></div>`).join('')}</div>`:'';
  $('#possible-duplicates-results').innerHTML=m.possibleDuplicates.length?`<div class="data-block"><h3>Possíveis duplicidades · mantidas separadas</h3><p>A semelhança não foi suficiente para juntar os produtos com segurança. Confira os registros e suas fontes.</p>${m.possibleDuplicates.map(pair=>{const a=m.projects.find(p=>p.canonicalId===pair.leftId);const b=m.projects.find(p=>p.canonicalId===pair.rightId);if(!a||!b)return '';return `<div class="data-row"><div><h4>${escapeHtml(a.name)} / ${escapeHtml(b.name)}</h4><p>${escapeHtml(pair.reason)}</p><button class="text-button" data-project-id="${a.canonicalId}">Ver primeiro</button> · <button class="text-button" data-project-id="${b.canonicalId}">Ver segundo</button></div>${badge('Conferir','amber')}</div>`;}).join('')}</div>`:'';
}

// Downloads and clipboard.
function exportDataset() {
  const selected=filteredProjects();const routes=new Map();selected.forEach(p=>p.routes.forEach(r=>routes.set(r.routeId,r)));
  const partners=[...routes.values()].map((r,i)=>({...r,id:'P'+String(i+1).padStart(3,'0')}));const ids=new Map(partners.map(r=>[r.routeId,r.id]));
  const trackedKeys=new Set(selected.map(p=>p.partnershipTracking?.projectKey).filter(Boolean));
  return {schema_version:'1.0',title:'Recorte de parcerias — DyHouse',consultation_date:new Date().toISOString().slice(0,10),exported_at:new Date().toISOString(),applied_filters:state.filters,methodology:['Exportação do recorte visível. Datas de consulta, evidências e origens de cada registro foram preservadas.','Status, notas e datas do acompanhamento são registros manuais do usuário. Nenhuma solicitação é enviada pela página.'],
    partnership_tracking:{...normalizeTracking(state.tracking),records:state.tracking.records.filter(record=>trackedKeys.has(record.projectKey))},
    projects:selected.map(p=>({...p,city:p.normalized.city,partner_id:ids.get(p.routes[0]?.routeId)||p.partner_id,partner_ids:p.routes.map(route=>ids.get(route.routeId)).filter(Boolean),
      partnership_status:p.normalized.partnershipStatus,partnership_status_label:PARTNERSHIP_STATUS_LABELS[p.normalized.partnershipStatus],partnership_updated_at:p.partnershipTracking?.updatedAt||'',
      partnership_status_updated_at:p.partnershipTracking?.statusUpdatedAt||'',partnership_requested_at:p.partnershipTracking?.requestedAt||'',partnership_completed_at:p.partnershipTracking?.completedAt||'',partnership_timeline:p.partnershipTracking?.events||[]})),partners};
}
function downloadFile(content,mime,name) {const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportData(type) {
  const data=exportDataset();const date=new Date().toISOString().slice(0,10);
  if(type==='json') downloadFile(JSON.stringify(data,null,2),'application/json;charset=utf-8',`parcerias-filtradas-${date}.json`);
  else {
    const columns=[['Empreendimento','name'],['Empresa','developer'],['Cidade','city'],['Bairro','neighborhood'],['Zona','zone'],['Tipo','property_type'],['Minha parceria','partnership_status_label'],['Acompanhamento atualizado em','partnership_updated_at'],['Status marcado em','partnership_status_updated_at'],['Solicitada marcada em','partnership_requested_at'],['Feita marcada em','partnership_completed_at'],['Linha do tempo','partnership_timeline'],['MCMV','mcmv'],['Estágio','stage'],['Lançamento','launch_date'],['Canal PF','pf_url'],['Canal PJ','pj_url'],['Contato','partner_contact'],['Próxima ação','next_action'],['Comissão PF','commission_pf'],['Comissão PJ','commission_pj'],['IA','ai_status'],['Endereço','address'],['Consulta','checked_at'],['Fontes','source_urls']];
    const cell=value=>{let s=Array.isArray(value)?value.map(item=>typeof item==='object'&&item?`${item.createdAt||''}: ${item.text||txt(item)}`:txt(item)).join(' | '):txt(value);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const csv=[columns.map(c=>cell(c[0])).join(';'),...data.projects.map(p=>columns.map(c=>cell(p[c[1]])).join(';'))].join('\r\n');downloadFile('\uFEFF'+csv,'text/csv;charset=utf-8',`parcerias-filtradas-${date}.csv`);
  }
  $('#export-menu').hidden=true;$('#export-button').setAttribute('aria-expanded','false');toast(`${data.projects.length} empreendimento(s) exportado(s).`);
}
async function copyMessage(message) {
  try { await navigator.clipboard.writeText(message);toast('Mensagem copiada. Revise os campos entre colchetes antes de enviar.'); }
  catch {const ta=document.createElement('textarea');ta.value=message;ta.style.position='fixed';ta.style.opacity='0';const host=$('#detail-dialog').open?$('#detail-dialog'):document.body;host.append(ta);ta.select();const ok=document.execCommand('copy');ta.remove();toast(ok?'Mensagem copiada.':'Selecione o texto da mensagem e copie manualmente.');}
}

// Event bindings.
paintIcons();$('#search-input').value=state.filters.query;
$('#search-input').addEventListener('input',()=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>{state.filters.query=$('#search-input').value;state.page=1;renderProjects();},120);});
$('#partner-search').addEventListener('input',renderPartners);
$('#filter-panel').addEventListener('input',event=>{if(event.target.id==='company-filter-search')filterCompaniesInSidebar(event.target.value);});
$('#filter-panel').addEventListener('change',event=>{
  const el=event.target;
  if(el.dataset.filter){const key=el.dataset.filter;state.filters[key]=el.checked?[...new Set([...state.filters[key],el.value])]:state.filters[key].filter(v=>String(v)!==el.value);applyFilters();}
  if(el.dataset.selectFilter){state.filters[el.dataset.selectFilter]=el.value?[el.value]:[];applyFilters();}
  if(el.dataset.booleanFilter){state.filters[el.dataset.booleanFilter]=el.checked;applyFilters();}
});
$('#sort-select').addEventListener('change',event=>{state.sort=event.target.value;renderProjects();});
$('#page-size').addEventListener('change',event=>{state.pageSize=Number(event.target.value);state.page=1;renderProjects();});
$('#previous-page').addEventListener('click',()=>{state.page--;renderProjects();$('#results').scrollIntoView({block:'start',behavior:'smooth'});});
$('#next-page').addEventListener('click',()=>{state.page++;renderProjects();$('#results').scrollIntoView({block:'start',behavior:'smooth'});});
$('#refresh-button').addEventListener('click',()=>refresh());$('#clear-filters').addEventListener('click',clearFilters);
$('#export-button').addEventListener('click',()=>{const hidden=!$('#export-menu').hidden;$('#export-menu').hidden=hidden;$('#export-button').setAttribute('aria-expanded',String(!hidden));});
for(const id of ['import-button','files-add-button']) document.getElementById(id).addEventListener('click',()=>openDialog('source-dialog'));
for(const id of ['help-button','footer-help']) document.getElementById(id).addEventListener('click',()=>openDialog('help-dialog'));
function closeFilters() {$('#filter-panel').classList.remove('open');$('#filter-backdrop').hidden=true;document.body.style.overflow='';}
$('#show-filters').addEventListener('click',()=>{$('#filter-panel').classList.add('open');$('#filter-backdrop').hidden=false;document.body.style.overflow='hidden';$('#close-filters').focus();});
$('#close-filters').addEventListener('click',closeFilters);$('#filter-backdrop').addEventListener('click',closeFilters);
$('#choose-folder').addEventListener('click',chooseFolder);$('#choose-files').addEventListener('click',()=>$('#files-input').click());
$('#files-input').addEventListener('change',async event=>{const selected=[...event.target.files];if(selected.length){const mode=importMode();const result=await readFileList(selected,'Arquivos');incorporate(result,{mode});}event.target.value='';});
$('#folder-input').addEventListener('change',async event=>{const files=[...event.target.files];if(files.length){const mode=importMode();const name=files[0].webkitRelativePath.split('/')[0]||'Pasta';const result=await readFileList(files,'Pasta selecionada');incorporate(result,{kind:'folder',mode,name,sameFolder:state.folderName===name});}event.target.value='';});
$('#auto-refresh').addEventListener('change',setupAutoRefresh);
$('#tracking-open').addEventListener('click',openTrackingFile);
$('#tracking-link').addEventListener('click',linkTrackingFile);
$('#tracking-export').addEventListener('click',exportTrackingBackup);
$('#tracking-retry').addEventListener('click',queueTrackingWrite);
$('#tracking-input').addEventListener('change',async event=>{try {if(event.target.files[0])await importTrackingFile(event.target.files[0]);}catch(error){toast(error.message||'Não foi possível importar o acompanhamento.');}event.target.value='';});
$('#detail-content').addEventListener('change',event=>{const id=event.target.dataset.projectStatus;if(!id)return;const project=state.model?.projects.find(p=>p.canonicalId===id);if(project)recordProjectProgress(project,{status:event.target.value});});
$('#detail-content').addEventListener('input',event=>{if(event.target.id!=='tracking-note')return;const project=state.model?.projects.find(p=>p.canonicalId===state.detailId);if(project)state.noteDrafts.set(project.partnershipTracking?.projectKey||project.canonicalId,event.target.value);});
$('#detail-content').addEventListener('submit',event=>{
  const form=event.target;if(form.id!=='tracking-note-form')return;event.preventDefault();
  const note=$('#tracking-note').value.trim();if(!note)return;
  const project=state.model?.projects.find(p=>p.canonicalId===form.dataset.noteProject);if(!project)return;
  state.noteDrafts.delete(project.partnershipTracking?.projectKey||project.canonicalId);$('#tracking-note').value='';recordProjectProgress(project,{note});toast('Progresso registrado na linha do tempo.');
});
$('#restore-base').addEventListener('click',async()=>{state.useBase=true;state.extraFiles=[];state.folderFiles=[];state.folderHandle=null;state.folderName='';state.folderSnapshot=false;$('#auto-refresh').checked=false;await refresh();toast('Pesquisa inicial restaurada. Os filtros atuais foram mantidos.');});
document.addEventListener('click',event=>{
  const target=event.target.closest('button,a');if(!target)return;
  if(target.dataset.close)closeDialog(target.dataset.close);
  if(target.dataset.tab)switchTab(target.dataset.tab);
  if(target.dataset.goTab)switchTab(target.dataset.goTab);
  if(target.hasAttribute('data-clear-filters'))clearFilters();
  if(target.hasAttribute('data-open-sources'))openDialog('source-dialog');
  if(target.dataset.toggleZone){const zone=target.dataset.toggleZone;state.filters.zones=state.filters.zones.includes(zone)?state.filters.zones.filter(v=>v!==zone):[...state.filters.zones,zone];applyFilters();}
  if(target.dataset.removeFilter){const key=target.dataset.removeFilter;if(Array.isArray(state.filters[key]))state.filters[key]=state.filters[key].filter(v=>String(v)!==target.dataset.removeValue);else state.filters[key]=typeof state.filters[key]==='boolean'?false:'';$('#search-input').value=state.filters.query;applyFilters();}
  if(target.dataset.qualityFilter){state.filters=emptyFilters();state.filters[target.dataset.qualityFilter]=true;$('#search-input').value='';switchTab('projects');applyFilters();}
  if(target.dataset.projectId)openProject(target.dataset.projectId,target.dataset.openDetailTab||'overview');
  if(target.dataset.routeId)openRoute(target.dataset.routeId);
  if(target.dataset.detailTab&&state.detailId){state.detailTab=target.dataset.detailTab;renderProjectDetail(state.model.projects.find(p=>p.canonicalId===state.detailId));}
  if(target.dataset.export)exportData(target.dataset.export);
  if(target.hasAttribute('data-copy-message')){const p=state.model.projects.find(p=>p.canonicalId===target.dataset.copyProject);const r=state.model.partners.find(r=>r.routeId===target.dataset.copyRoute);copyMessage(p?.request_template||r?.request_template||'');}
  if(target.dataset.removeFile){const name=target.dataset.removeFile;state.baseFiles=state.baseFiles.filter(f=>f.fileName!==name);state.extraFiles=state.extraFiles.filter(f=>f.fileName!==name);state.folderFiles=state.folderFiles.filter(f=>f.fileName!==name);rebuild();toast('Arquivo removido desta sessão. A fonte original foi preservada; reler a pasta o incluirá novamente.');}
});
document.addEventListener('click',event=>{if(!event.target.closest('.export-wrap')){$('#export-menu').hidden=true;$('#export-button').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')closeFilters();
  if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.querySelector('dialog[open]')){event.preventDefault();switchTab('projects');$('#search-input').focus();}
});
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
$('#project-results').innerHTML='<div class="loading-skeleton"></div><div class="loading-skeleton"></div><div class="loading-skeleton"></div>';
await Promise.all([initializeTracking(),refresh({initial:true,silent:true})]);
