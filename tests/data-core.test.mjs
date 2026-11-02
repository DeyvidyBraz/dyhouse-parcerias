import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ingestDatasets, filterProjects, buildFacets, normalizeText, canonicalizeUrl,
  normalizeMcmv, normalizeStage, launchYear, safeUrl, normalizeCity,
  TRACKING_SCHEMA, normalizeTracking, validateTrackingEnvelope, mergeTracking, applyPartnershipTracking, updatePartnershipTracking,
} from '../dist/data-core.js';

const sourcePath = process.env.PARCERIAS_DATASET || new URL('../dist/dados/100_empreendimentos_parcerias_sp.json', import.meta.url);
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const base = (overrides = {}) => ({
  id: 'E001', name: 'Jardim das Acácias', developer: 'Construtora Exemplo', city: 'São Paulo',
  neighborhood: 'Santo Amaro', zone: 'Sul', address: 'Rua das Flores, 100',
  stage: 'Lançamento', launch_date: '2026-10', mcmv: 'A confirmar', checked_at: '2026-11-02',
  project_url: 'https://construtora.example/empreendimentos/jardim-das-acacias', ...overrides,
});
const file = (fileName, projects, partners = [], metadata = {}) => ({ fileName, payload: { projects, partners, ...metadata } });

test('cidade normalizada consolida grafias e mantém Alphaville como município incerto', () => {
  assert.equal(normalizeCity('Sao Paulo - SP'),'São Paulo');
  assert.equal(normalizeCity('Barueri/SP'),'Barueri');
  assert.equal(normalizeCity('Santana de Parnaiba - SP'),'Santana de Parnaíba');
  assert.equal(normalizeCity('Alphaville'),'Alphaville — município a confirmar');
  const result=ingestDatasets([file('cidades.json',[
    base({city:'Barueri'}),base({city:'Barueri/SP'}),
    base({city:'Santana de Parnaíba'}),base({city:'Alphaville'}),
  ])]);
  assert.equal(result.projects.length,3);
  assert.equal(result.stats.byCity.Barueri,1);
  assert.equal(result.projects.find(p=>p.normalized.city==='Barueri').conflicts.some(c=>c.field==='city'),false);
  assert.equal(filterProjects(result.projects,{cities:['Barueri','Santana de Parnaíba']}).length,2);
  assert.equal(filterProjects(result.projects,{query:'santana parnaiba'}).length,1);
  assert.equal(buildFacets(result.projects).cities.find(option=>option.value==='Barueri').count,1);
});

test('ano explícito desconhecido não vira ano do anúncio ou RI e tipos são filtráveis', () => {
  const old=base({launch_year:2024,property_type:'Loteamento'});
  const latest=base({launch_year:null,launch_date:'Não publicada; anúncio de 2024.',checked_at:'2026-12-01',property_type:'Loteamento'});
  const model=ingestDatasets([file('antigo.json',[old]),file('novo.json',[latest])]);
  assert.equal(model.projects[0].normalized.year,null);
  assert.equal(model.projects[0].launch_year,null);
  assert.equal(filterProjects(model.projects,{years:['2024']}).length,0);
  assert.equal(filterProjects(model.projects,{years:['nao_informado'],propertyTypes:['Loteamento']}).length,1);
  assert.equal(buildFacets(model.projects).propertyTypes[0].label,'Loteamento');
});

test('rotas adicionais usam apenas o namespace do arquivo e sobrevivem ao histórico', () => {
  const routes=[{id:'P01',developer:'Empresa A',pf_url:'https://a.example/parceiros'},{id:'P02',developer:'Empresa B',pf_url:'mailto:parceria@b.example'}];
  const input=file('a.json',[base({partner_id:'P01',partner_ids:['P01','P02','P02']})],routes);
  const model=ingestDatasets([input,file('b.json',[],[{id:'P02',developer:'Outra empresa',pf_url:'https://outra.example/cadastro'}])]);
  assert.equal(model.projects[0].routes.length,2);
  assert.ok(model.projects[0].routes.some(route=>route.pf_url==='mailto:parceria@b.example'));
  assert.equal(model.projects[0].routes.some(route=>route.developer==='Outra empresa'),false);
  const restored=ingestDatasets([file('backup.json',model.projects,model.partners)]);
  assert.equal(restored.projects[0].routes.length,2);
});

test('marcação persiste após nova leitura, mudança de URL e rótulo de município', () => {
  const first=ingestDatasets([file('antigo.json',[base({city:'Barueri/SP'})])]).projects[0];
  let tracking=updatePartnershipTracking(null,first,{status:'solicitada'},'2026-11-02T10:00:00Z','evento-1');
  const later=ingestDatasets([file('nova-pesquisa.json',[base({city:'Barueri',project_url:'https://novo.example/residencial',checked_at:'2026-12-01'})])]).projects;
  assert.notEqual(first.canonicalId,later[0].canonicalId);
  tracking=applyPartnershipTracking(later,JSON.parse(JSON.stringify(tracking)));
  assert.equal(later[0].normalized.partnershipStatus,'solicitada');
  assert.equal(tracking.records[0].aliases.length,2);
  assert.equal(later[0].outreach_status,undefined);
  assert.equal(later[0].partnership_approved,undefined);
  assert.equal(filterProjects(later,{partnershipStatuses:['solicitada']}).length,1);
});

test('municípios, fases e homônimos com endereços distintos não herdam a marcação', () => {
  const originals=[base({name:'Jardim das Acácias I',city:'Barueri',project_url:'https://site.example/empreendimentos'}),base({name:'Jardim das Acácias II',city:'Barueri',project_url:'https://site.example/empreendimentos'}),base({name:'Jardim das Acácias I',city:'Santana de Parnaíba',project_url:'https://site.example/empreendimentos'}),base({name:'Jardim das Acácias I',city:'Barueri',address:'Rua outra, 900',project_url:'https://site.example/empreendimentos'})];
  const projects=ingestDatasets([file('produtos.json',originals)]).projects;
  const selected=projects.find(p=>p.name.endsWith(' I')&&p.city==='Barueri'&&p.address===originals[0].address);
  const tracking=updatePartnershipTracking(null,selected,{status:'feita'},'2026-11-02T10:00:00Z','evento-2');
  applyPartnershipTracking(projects,tracking);
  assert.equal(projects.length,4);
  assert.equal(projects.filter(p=>p.normalized.partnershipStatus==='feita').length,1);
});

test('JSON com histórico reimporta status, timestamps e notas sem contaminar a pesquisa', () => {
  const input=file('pesquisa.json',[base({outreach_status:'Não contatado',partnership_approved:false})]);
  const model=ingestDatasets([input]);
  let tracking=updatePartnershipTracking(null,model.projects[0],{status:'solicitada',note:'Cadastro enviado; aguardando responsável.'},'2026-11-02T10:00:00Z','evento-3');
  tracking=applyPartnershipTracking(model.projects,tracking);
  const payload=JSON.parse(JSON.stringify({projects:model.projects,partners:model.partners,partnership_tracking:tracking}));
  const reread=ingestDatasets([{fileName:'backup.json',payload}]);
  applyPartnershipTracking(reread.projects,payload.partnership_tracking);
  assert.equal(reread.projects[0].normalized.partnershipStatus,'solicitada');
  assert.equal(reread.projects[0].partnershipTracking.events.length,2);
  assert.equal(reread.projects[0].partnershipTracking.requestedAt,'2026-11-02T10:00:00.000Z');
  assert.equal(reread.projects[0].outreach_status,'Não contatado');
  assert.equal(reread.projects[0].partnership_approved,false);
  assert.equal(reread.projects[0].versionRecords[0].record.partnershipTracking,undefined);
  assert.equal(reread.projects[0].occurrences,1);
});

test('mescla une notas de dois backups sem reverter status novo por causa de nota posterior', () => {
  const project=ingestDatasets([file('a.json',[base()])]).projects[0];
  const initial=updatePartnershipTracking(null,project,{status:'solicitada'},'2026-11-02T10:00:00Z','inicio');
  const deviceA=updatePartnershipTracking(initial,project,{status:'feita',note:'Habilitação confirmada.'},'2026-11-02T12:00:00Z','a');
  const deviceB=updatePartnershipTracking(initial,project,{note:'Contato administrativo atualizado.'},'2026-11-02T13:00:00Z','b');
  const combined=mergeTracking(deviceA,deviceB,deviceA);
  assert.equal(combined.records.length,1);
  assert.equal(combined.records[0].status,'feita');
  assert.equal(combined.records[0].events.length,4);
  assert.equal(combined.records[0].statusUpdatedAt,'2026-11-02T12:00:00.000Z');
  const reset=updatePartnershipTracking(combined,project,{status:'nao_solicitada'},'2026-11-02T14:00:00Z','reset');
  assert.equal(mergeTracking(reset,initial).records[0].status,'nao_solicitada');
  assert.equal(mergeTracking(reset,initial).records[0].events.length,5);
});

test('acompanhamento desconhecido é rejeitado e colisão de id de nota preserva textos com ids únicos', () => {
  assert.equal(normalizeTracking({schema:'outro',records:[{}]}).records.length,0);
  const project=ingestDatasets([file('a.json',[base()])]).projects[0];
  const a=updatePartnershipTracking(null,project,{note:'Primeira resposta.'},'2026-11-02T10:00:00Z','mesmo-id');
  const b=updatePartnershipTracking(null,project,{note:'Outro contato.'},'2026-11-02T11:00:00Z','mesmo-id');
  const merged=mergeTracking(a,b);
  assert.equal(merged.schema,TRACKING_SCHEMA);
  assert.equal(merged.records[0].events.length,2);
  assert.equal(new Set(merged.records[0].events.map(event=>event.id)).size,2);
  assert.equal(mergeTracking(merged,a,b).records[0].events.length,2);
});

test('backups preservam órfãos, extensões e notas longas com IDs distintos', () => {
  const project=ingestDatasets([file('a.json',[base()])]).projects[0];
  const original=updatePartnershipTracking(null,project,{note:'Primeira nota.'},'2026-11-02T10:00:00Z','id-a');
  original.extra={team:'Equipe de parcerias'};
  original.records[0].crm={responsavel:'Equipe'};
  original.records[0].events[0].text='Texto longo '.repeat(1000);
  original.records[0].events[0].attachment={label:'Anexo mantido'};
  original.records[0].events.push({...clone(original.records[0].events[0]),id:'id-b'});
  const orphan=clone(original.records[0]);orphan.projectKey='registro-sem-identidade';orphan.aliases=[];delete orphan.identities;
  original.records.push(orphan);
  validateTrackingEnvelope(original);
  const restored=mergeTracking(original,JSON.parse(JSON.stringify(original)));
  assert.equal(restored.records.length,2);
  assert.equal(restored.extra.team,'Equipe de parcerias');
  assert.equal(restored.records[0].crm.responsavel,'Equipe');
  assert.equal(restored.records[0].events.length,2);
  assert.equal(restored.records[0].events[0].text.length,12000);
  assert.equal(restored.records[0].events[0].attachment.label,'Anexo mantido');
  validateTrackingEnvelope(restored);
  const projects=ingestDatasets([file('a.json',[base()])]).projects;
  const applied=applyPartnershipTracking(projects,restored);
  assert.equal(applied.records.length,2);
  assert.equal(projects[0].partnershipTracking.events.length,2);
});

test('projeto importado sem cidade/empresa mantém uma única marcação e envelopes inválidos são rejeitados', () => {
  const project=ingestDatasets([file('minimo.json',[{name:'Projeto sem dados'}])]).projects[0];
  const requested=updatePartnershipTracking(null,project,{status:'solicitada'},'2026-11-02T10:00:00Z','minimo-a');
  const withNote=updatePartnershipTracking(requested,project,{note:'Contatar a empresa.'},'2026-11-02T11:00:00Z','minimo-b');
  assert.equal(withNote.records.length,1);
  assert.equal(withNote.records[0].events.length,2);
  validateTrackingEnvelope(withNote);
  applyPartnershipTracking([project],withNote);
  assert.equal(project.normalized.partnershipStatus,'solicitada');
  assert.throws(()=>validateTrackingEnvelope({schema:TRACKING_SCHEMA,revision:0,records:'inválido'}));
  assert.throws(()=>validateTrackingEnvelope({...withNote,records:[{...withNote.records[0],updatedAt:'2026-02-30T10:00:00Z'}]}));
  assert.throws(()=>validateTrackingEnvelope({...withNote,records:[{...withNote.records[0],events:null}]}));
});

test('a base real mantém 100 produtos, 59 Sul, 46 MCMV citados e 20 rotas', () => {
  const result = ingestDatasets([{ fileName: 'base.json', payload: source }]);
  assert.equal(result.projects.length, 100);
  assert.equal(new Set(result.projects.map(p => p.canonicalId)).size, 100);
  assert.equal(result.stats.byZone.Sul, 59);
  assert.equal(result.projects.filter(p => p.normalized.mcmv.startsWith('sim_')).length, 46);
  assert.equal(result.partners.length, 20);
  assert.equal(result.warnings.length, 0);
  assert.ok(result.projects.every(p => p.routes.length && p.sources.length));
});

test('cópia da pesquisa consolida 200 ocorrências em 100 produtos preservando fontes', () => {
  const result = ingestDatasets([{ fileName: 'base.json', payload: source }, { fileName: 'copia.json', payload: clone(source) }]);
  assert.equal(result.stats.inputProjects, 200);
  assert.equal(result.stats.uniqueProjects, 100);
  assert.equal(result.stats.duplicatesMerged, 100);
  assert.equal(result.partners.length, 20);
  assert.ok(result.projects.every(p => p.occurrences === 2 && p.provenance.length === 2 && p.sourceFiles.length === 2));
  assert.equal(result.stats.conflictProjects, 0);
});

test('versão mais recente prevalece, preenche vazios e mantém divergências e proveniência', () => {
  const old = base({ commission_pj: '4%', source_urls: ['https://exemplo.test/fonte-antiga'], mcmv_category: 'a_confirmar' });
  const latest = base({ checked_at: '2026-12-01', address: '', commission_pj: '5%', stage: 'Em obras', mcmv: 'Sim — fonte oficial', mcmv_category: 'sim_fonte_oficial', source_urls: ['https://exemplo.test/fonte-nova'] });
  const result = ingestDatasets([file('antigo.json', [old]), file('novo.json', [latest])]);
  const project = result.projects[0];
  assert.equal(result.projects.length, 1);
  assert.equal(project.commission_pj, '5%');
  assert.equal(project.address, old.address);
  assert.equal(project.normalized.mcmv, 'sim_fonte_oficial');
  assert.equal(project.normalized.stage, 'em_obras');
  assert.equal(project.source_urls.length, 2);
  assert.ok(project.conflicts.some(c => c.field === 'commission_pj' && c.values.length === 2));
  assert.ok(project.conflicts.some(c => c.field === 'mcmv_category'));
  assert.equal(project.provenance[0].fileName, 'novo.json');
});

test('texto MCMV novo sem categoria não herda categoria antiga contraditória', () => {
  const old = base({ mcmv: 'Sim — fonte oficial', mcmv_category: 'sim_fonte_oficial' });
  const latest = base({ checked_at: '2026-12-01', mcmv: 'Não — declaração da incorporadora' });
  const result = ingestDatasets([file('antigo.json', [old]), file('novo.json', [latest])]);
  assert.equal(result.projects[0].mcmv, latest.mcmv);
  assert.equal(result.projects[0].normalized.mcmv, 'nao_declarado');
});

test('E001 e P01 repetidos em arquivos distintos não misturam produto ou parceria', () => {
  const a = base({ partner_id: 'P01', partner_group: 'Empresa A', developer: 'Empresa A' });
  const b = base({ name: 'Residencial Horizonte', project_url: 'https://empresa-b.example/produtos/horizonte', address: 'Rua B, 200', developer: 'Empresa B', partner_group: 'Empresa B', partner_id: 'P01' });
  const result = ingestDatasets([
    file('a.json', [a], [{ id: 'P01', developer: 'Empresa A', partner_url: 'https://empresa-a.example/parcerias', contact: 'contato@empresa-a.example' }]),
    file('b.json', [b], [{ id: 'P01', developer: 'Empresa B', partner_url: 'https://empresa-b.example/parcerias', contact: 'contato@empresa-b.example' }]),
  ]);
  assert.equal(result.projects.length, 2);
  assert.equal(result.partners.length, 2);
  const bProject = result.projects.find(p => p.developer === 'Empresa B');
  assert.equal(bProject.routes[0].contact, 'contato@empresa-b.example');
  assert.equal(bProject.pf_url, 'https://empresa-b.example/parcerias');
  assert.equal(new Set(result.projects.map(p => p.canonicalId)).size, 2);
});

test('fases, condomínios e projeto genérico não se fundem por uma página compartilhada', () => {
  const page = 'https://exemplo.test/projeto/parque';
  const phases = [base({ name: 'Parque das Águas — Fase 1', project_url: page }), base({ name: 'Parque das Águas — Fase 2', project_url: page }), base({ name: 'Parque das Águas', project_url: page })];
  const result = ingestDatasets([file('fases.json', phases)]);
  assert.equal(result.projects.length, 3);
  const condo = ingestDatasets([file('condominios.json', [base({ name: 'Cidade Parque — Condomínio Atlântica', project_url: page }), base({ name: 'Cidade Parque — Condomínio Rio Bonito', project_url: page })])]);
  assert.equal(condo.projects.length, 2);
  assert.equal(condo.possibleDuplicates.length, 0);
});

test('acentos, caixa, pontuação e utm não criam duplicidade', () => {
  const result = ingestDatasets([
    file('a.json', [base({ name: 'Jardim das Acácias', project_url: 'https://www.exemplo.test/projeto/acacias/?utm_source=x' })]),
    file('b.json', [base({ name: 'JARDIM DAS ACACIAS', project_url: 'http://exemplo.test/projeto/acacias?utm_source=y#fotos' })]),
  ]);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].occurrences, 2);
  assert.equal(canonicalizeUrl('https://www.exemplo.test/imovel?id=7&utm_medium=email'), 'https://exemplo.test/imovel?id=7');
  assert.notEqual(canonicalizeUrl('https://exemplo.test/imovel?id=7'), canonicalizeUrl('https://exemplo.test/imovel?id=8'));
});

test('home ou catálogo compartilhados não são identidade de um empreendimento', () => {
  for (const url of ['https://x.example/', 'https://x.example/lancamentos', 'https://x.example/catalogo', 'https://x.example/imoveis/sp/sao-paulo?preco=500000']) {
    const result = ingestDatasets([file('base.json', [base({ name: 'Alfa Residencial', project_url: url }), base({ name: 'Beta Residencial', project_url: url, address: 'Rua Dois, 200' })])]);
    assert.equal(result.projects.length, 2, url);
  }
  const distinct = ingestDatasets([file('base.json', [base({ name: 'Alfa Residencial', project_url: 'https://x.example/campanha-especial' }), base({ name: 'Beta Residencial', project_url: 'https://x.example/campanha-especial', address: 'Rua Dois, 200' })])]);
  assert.equal(distinct.projects.length, 2);
  assert.equal(distinct.possibleDuplicates.length, 1);
});

test('arquivo sem checked_at usa lastModified numérico, sem sobrepor data explícita', () => {
  const old = file('old.json', [base({ checked_at: '', commission_pf: '2%' })]);
  const newer = file('new.json', [base({ checked_at: '', commission_pf: '3%' })]);
  old.lastModified = Date.UTC(2026, 0, 1); newer.lastModified = Date.UTC(2026, 9, 1);
  assert.equal(ingestDatasets([newer, old]).projects[0].commission_pf, '3%');
  const dated = file('dated.json', [base({ checked_at: '2026-01-01', commission_pf: '4%' })]);
  assert.equal(ingestDatasets([newer, dated]).projects[0].commission_pf, '4%');
});

test('conciliação é determinística independente da ordem de leitura dos arquivos', () => {
  const a = file('a.json', [base({ checked_at: '2026-11-02', commission_pf: '2%' })]);
  const b = file('b.json', [base({ checked_at: '2026-11-02', commission_pf: '3%' })]);
  const first = ingestDatasets([a, b]).projects[0], second = ingestDatasets([b, a]).projects[0];
  assert.equal(first.canonicalId, second.canonicalId);
  assert.equal(first.commission_pf, second.commission_pf);
  assert.deepEqual(first.provenance, second.provenance);
});

test('filtros combinam dimensões com AND e alternativas com OR; busca ignora acentos', () => {
  const { projects } = ingestDatasets([{ fileName: 'base.json', payload: source }]);
  assert.equal(filterProjects(projects, { zones: ['Sul'] }).length, 59);
  assert.equal(filterProjects(projects, { mcmv: ['sim_fonte_oficial', 'sim_fonte_comercial'] }).length, 46);
  const filtered = filterProjects(projects, { zones: ['Sul'], mcmv: ['sim_fonte_oficial', 'sim_fonte_comercial'] });
  assert.ok(filtered.length > 0 && filtered.every(p => p.normalized.zone === 'Sul' && p.normalized.mcmv.startsWith('sim_')));
  assert.ok(filterProjects(projects, { query: 'essencia ipiranga' }).some(p => p.name === 'Mundo Apto Essência Ipiranga'));
  assert.equal(filterProjects(projects, { zones: ['Norte'] }).length, 0);
  assert.equal(filterProjects(projects, { query: 'nome-inexistente-xyz' }).length, 0);
  const facets = buildFacets(projects);
  assert.equal(facets.zones.find(option => option.value === 'Sul').count, 59);
  assert.ok(facets.years.some(option => option.value === 'nao_informado'));
  assert.ok(facets.mcmv.every(option => option.label && option.count > 0));
});

test('ano de RI não é lançamento e classificações mantêm ressalvas', () => {
  assert.equal(launchYear('Lançamento não publicado; RI: 03/06/2026'), null);
  assert.equal(launchYear('2026 (RI em 03/06/2026)'), null);
  assert.equal(launchYear('Não divulgada; material publicado em 2026-09'), null);
  assert.equal(launchYear('2026-11 (previsão comercial)'), 2026);
  assert.equal(launchYear('4T2025'), 2025);
  assert.equal(normalizeStage('Lançamento / pré-lançamento em validação'), 'pre_lancamento');
  assert.equal(normalizeStage('Em obras — lançamento recente'), 'em_obras');
  assert.equal(normalizeMcmv('Sim'), 'sim_sem_fonte');
  assert.equal(normalizeMcmv('Não — inferência por preço'), 'nao_inferencia_preco');
  assert.equal(normalizeText('São   PAULO / Sul'), 'sao paulo sul');
});

test('erro de arquivo e registros inválidos não apagam os arquivos válidos', () => {
  const result = ingestDatasets([file('valid.json', [base(), null, { developer: 'Sem nome' }]), { fileName: 'broken.json', payload: '{bad' }, { fileName: 'wrong.json', payload: { parceiros: [] } }]);
  assert.equal(result.projects.length, 1);
  assert.equal(result.stats.invalidFiles, 2);
  assert.equal(result.warnings.length, 4);
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,<script>'), '');
  assert.equal(safeUrl('https://user:password@example.test/'), '');
  assert.equal(safeUrl('https://example.test/'), 'https://example.test/');
});

function exportedPayload(result) {
  const routes = new Map();
  for (const project of result.projects) for (const route of project.routes) routes.set(route.routeId, route);
  const ids = new Map([...routes.keys()].map((id, index) => [id, `P${String(index + 1).padStart(3, '0')}`]));
  return {
    consultation_date: '2026-12-31',
    projects: result.projects.map(project => ({ ...clone(project), partner_id: ids.get(project.routes[0]?.routeId) || '' })),
    partners: [...routes.values()].map(route => ({ ...clone(route), id: ids.get(route.routeId) })),
  };
}
function historyFixture() {
  return [1, 2].map(number => file(number === 1 ? 'primeiro.json' : 'segundo.json', [base({
    name: 'Residencial Alfa', developer: 'Empresa A', partner_group: 'Empresa A',
    address: 'Rua A, 10', project_url: 'https://x.example/alfa', partner_id: 'P01',
    checked_at: number === 1 ? '2026-01-01' : '2026-02-01',
    mcmv: number === 1 ? 'Sim — fonte oficial' : 'Não — declaração da fonte',
  })], [{
    id: 'P01', developer: 'Empresa A', partner_group: 'Empresa A',
    partner_url: `https://x.example/parceria-${number}`, pf_url: `https://x.example/parceria-${number}`, pj_url: `https://x.example/parceria-${number}`,
    commission_pj: number === 1 ? '3%' : '5%',
  }]));
}

test('exportar e reimportar mantém duas versões, duas rotas e todas as divergências', () => {
  const initial = ingestDatasets(historyFixture());
  const reimport = ingestDatasets([{ fileName: 'exportado.json', payload: exportedPayload(initial) }]);
  const before = initial.projects[0], after = reimport.projects[0];
  assert.equal(before.routes.length, 2);
  assert.equal(before.conflicts.length, 4);
  assert.equal(after.routes.length, 2);
  assert.deepEqual(after.conflicts, before.conflicts);
  assert.deepEqual(after.provenance, before.provenance);
  assert.equal(after.occurrences, 2);
  assert.equal(after.commission_pj, '5%');
  assert.equal(after.canonicalId, before.canonicalId);
  assert.equal(after.versionRecords.length, 2);
  assert.equal(reimport.warnings.length, 0);
});

test('exportado e fontes originais juntos não duplicam as versões ou a proveniência', () => {
  const originals = historyFixture(), first = ingestDatasets(originals);
  const result = ingestDatasets([...originals, { fileName: 'exportado.json', payload: exportedPayload(first) }]);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].occurrences, 2);
  assert.equal(result.projects[0].provenance.length, 2);
  assert.equal(result.projects[0].versionRecords.length, 2);
  assert.equal(result.projects[0].routes.length, 2);
  assert.equal(result.stats.inputProjects, 2);
  assert.equal(result.stats.repeatedHistoryRecords, 2);
  assert.deepEqual(result.projects[0].conflicts, first.projects[0].conflicts);
});

test('recordId repetido com conteúdo diferente não descarta uma versão alterada', () => {
  const original = ingestDatasets(historyFixture()), payload = exportedPayload(original);
  const altered = clone(payload);
  altered.projects[0].versionRecords[0].record.commission_pj = '9%';
  const result = ingestDatasets([{ fileName: 'export1.json', payload }, { fileName: 'export2.json', payload: altered }]);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].occurrences, 3);
  assert.ok(result.projects[0].conflicts.find(conflict => conflict.field === 'commission_pj').values.some(value => value.value === '9%'));
  assert.equal(new Set(result.projects[0].versionRecords.map(version => version.recordId)).size, 3);
});

test('round-trip da base completa mantém 100 entidades e não cresce ao reimportar novamente', () => {
  const initial = ingestDatasets([{ fileName: 'base.json', payload: source }]);
  const second = ingestDatasets([{ fileName: 'exportado.json', payload: exportedPayload(initial) }]);
  const third = ingestDatasets([{ fileName: 'exportado2.json', payload: exportedPayload(second) }]);
  assert.equal(third.projects.length, 100);
  assert.deepEqual(third.projects.map(project => project.canonicalId), initial.projects.map(project => project.canonicalId));
  assert.ok(third.projects.every(project => project.occurrences === 1 && project.versionRecords.length === 1));
  assert.equal(third.stats.byZone.Sul, 59);
  assert.equal(third.partners.length, 20);
  assert.equal(third.warnings.length, 0);
  assert.deepEqual(third.projects[0].versionRecords, initial.projects[0].versionRecords);
});
