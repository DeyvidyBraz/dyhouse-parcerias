import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ingestDatasets, filterProjects, normalizePricing, priceLabel,
  parseBRLInput, maskBRLInput, updatePartnershipTracking, applyPartnershipTracking,
} from '../dist/data-core.js';

const quoted = (overrides={}) => ({currency:'BRL',status:'publicado',kind:'a_partir_de',min:300000,max:null,
  source_url:'https://construtora.example/produto',source_type:'oficial',checked_at:'2026-11-02',...overrides});
const project = (name,pricing,overrides={}) => ({name,developer:'Empresa',city:'São Paulo',zone:'Sul',
  address:`Rua ${name}, 100`,project_url:`https://construtora.example/${name}`,checked_at:'2026-11-02',pricing,...overrides});
const file = (name,projects) => ({fileName:name,payload:{projects}});

test('entrada em reais interpreta valores inteiros como reais, aceita colagem e preserva centavos',()=>{
  assert.equal(parseBRLInput('500000'),500000);
  assert.equal(parseBRLInput('R$ 1.234.567,89'),1234567.89);
  assert.equal(parseBRLInput('R$\u00a0300.000,00'),300000);
  assert.equal(parseBRLInput('0'),0);
  assert.equal(parseBRLInput(''),null);
  assert.equal(parseBRLInput(null),null);
  assert.equal(parseBRLInput('-100'),null);
  assert.equal(parseBRLInput('300 mil'),null);
  assert.equal(parseBRLInput('500000.00'),null);
  for(const invalid of ['-300000','300 mil','500000.00','1.234,567']) {
    assert.equal(maskBRLInput(invalid),'');
    assert.equal(parseBRLInput(maskBRLInput(invalid)),null);
  }
  assert.equal(maskBRLInput('500000'),'R$ 500.000');
  assert.equal(maskBRLInput('R$ 500.000',true).replaceAll('\u00a0',' '),'R$ 500.000,00');
  assert.equal(maskBRLInput('1234567,89'),'R$ 1.234.567,89');
  assert.equal(maskBRLInput(''), '');
});

test('preço sem fonte, moeda errada ou faixa invertida não se torna uma oferta filtrável',()=>{
  for(const invalid of [quoted({min:0}),quoted({source_url:'javascript:alert(1)'}),quoted({currency:'USD'}),quoted({kind:'faixa',min:500000,max:300000}),quoted({kind:'faixa',max:null})]) {
    const normalized=normalizePricing(invalid);
    assert.equal(normalized.status,'nao_encontrado');
    assert.equal(normalized.min,null);
    assert.equal(normalized.max,null);
  }
  assert.equal(normalizePricing(quoted({max:900000})).max,null);
  assert.equal(priceLabel({status:'sob_consulta'}),'Preço sob consulta');
  assert.equal(priceLabel(null),'Preço não localizado');
});

test('faixa filtra interseção inclusiva; a partir de não presume teto nem estoque',()=>{
  const model=ingestDatasets([file('precos.json',[
    project('Faixa',quoted({kind:'faixa',min:250000,max:450000})),
    project('Inicial',quoted({min:300000})),
    project('Unidade',quoted({kind:'unidade_anunciada',min:500000})),
    project('Sem',null),project('Consulta',{status:'sob_consulta'}),
    project('OutraCidade',quoted({min:350000}),{city:'Barueri'}),
  ])]);
  const names=filters=>filterProjects(model.projects,filters).map(p=>p.name).sort();
  assert.deepEqual(names({priceMin:400000,priceMax:500000}),['Faixa','Unidade']);
  assert.deepEqual(names({priceMin:450000,priceMax:450000}),['Faixa']);
  assert.deepEqual(names({priceMax:'R$ 300.000,00'}),['Faixa','Inicial']);
  assert.deepEqual(names({priceMin:300000,priceMax:400000,cities:['São Paulo']}),['Faixa','Inicial']);
  assert.deepEqual(names({priceMin:600000,priceMax:200000}),[]);
  assert.equal(names({}).length,6);
  assert.equal(names({priceMin:0}).length,4);
});

test('consolidação escolhe preço pela própria data sem combinar valores de ofertas diferentes',()=>{
  const old=project('Mesmo',quoted({kind:'faixa',min:250000,max:400000,checked_at:'2026-10-01'}),{checked_at:'2026-11-02'});
  const fresh=project('Mesmo',quoted({min:320000,checked_at:'2026-11-02',source_url:'https://comercial.example/mesmo'}),{checked_at:'2026-10-01'});
  const model=ingestDatasets([file('antigo.json',[old]),file('novo.json',[fresh])]);
  assert.equal(model.projects.length,1);
  const p=model.projects[0];
  assert.equal(p.pricing.min,320000);
  assert.equal(p.pricing.max,null);
  assert.equal(p.pricing.source_url,'https://comercial.example/mesmo');
  assert.ok(p.conflicts.some(c=>c.field==='pricing'));
  assert.ok(p.sources.includes('https://comercial.example/mesmo'));
  const restored=ingestDatasets([file('exportado.json',model.projects)]);
  assert.deepEqual(restored.projects[0].pricing,p.pricing);
});

test('nova consulta sem preço preserva referência antiga no histórico sem exibi-la como atual',()=>{
  const old=project('Mesmo',quoted({checked_at:'2026-10-01'}));
  const fresh=project('Mesmo',{currency:'BRL',status:'sob_consulta',checked_at:'2026-11-02',source_url:'https://construtora.example/produto'});
  const model=ingestDatasets([file('a.json',[old]),file('b.json',[fresh])]);
  assert.equal(model.projects[0].pricing.status,'sob_consulta');
  assert.equal(model.projects[0].versionRecords.length,2);
  assert.equal(filterProjects(model.projects,{priceMax:999999}).length,0);
});

test('enriquecer preço mantém identidade e acompanhamento do empreendimento',()=>{
  const first=ingestDatasets([file('base.json',[project('Mesmo',null)])]).projects[0];
  const tracking=updatePartnershipTracking(null,first,{status:'feita',note:'Aprovada pela empresa.'},'2026-11-02T10:00:00Z','price-test');
  const next=ingestDatasets([file('base.json',[project('Mesmo',quoted())])]).projects;
  applyPartnershipTracking(next,tracking);
  assert.equal(next[0].canonicalId,first.canonicalId);
  assert.equal(next[0].normalized.partnershipStatus,'feita');
  assert.equal(next[0].partnershipTracking.events.filter(e=>e.kind==='note').length,1);
});
