import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { api, closeAll } from './helpers.js';
import { seoResponse } from '../src/lib/seo.js';
import { reviewStatus } from '../../shared/knowledge.js';
after(closeAll);
const template='<html><head><title>Old</title><meta name="description" content="old" /></head><body><div id="root"></div></body></html>';
test('guidance is readable without JavaScript and has matching structured article data',()=>{
 const {html,seo}=seoResponse('/guides/qualification-recognition',template);
 assert.equal(seo.noindex,false);assert.match(html,/<h1>Qualification recognition, formerly equivalency<\/h1>/);
 assert.match(html,/Begin with verification/);assert.match(html,/mohesr.gov.ae/);assert.match(html,/<link rel="canonical"/);
 const schema=JSON.parse(html.match(/<script id="page-schema" type="application\/ld\+json">(.*?)<\/script>/)[1]);
 const article=schema.find(s=>s['@type']==='Article');assert.equal(article.dateModified,'2026-10-18');assert.ok(article.citation.length);
 assert.equal((html.match(/<title>/g)||[]).length,1);
});
test('unreviewed countries and private workflows cannot acquire indexable article claims',()=>{
 const unknown=seoResponse('/countries/ca',template);assert.equal(unknown.seo.noindex,true);assert.match(unknown.html,/No country-specific law/);
 for(const path of ['/app/documents','/ops/finance','/pay/private-token','/track'])assert.equal(seoResponse(path,template).seo.noindex,true);
 const missing=seoResponse('/guides/not-a-real-guide',template);assert.equal(missing.seo.found,false);assert.equal(missing.seo.noindex,true);
 assert.equal(seoResponse('/not-a-real-page',template).seo.found,false);
});
test('sitemap includes reviewed guides and excludes private and unreviewed detail pages',async()=>{
 const r=await api(null,'GET','/sitemap.xml');assert.equal(r.status,200);assert.match(r.data,/\/guides\/power-of-attorney/);assert.match(r.data,/\/countries\/gb/);assert.doesNotMatch(r.data,/\/countries\/ca<|\/app\/|\/ops\//);
 const robots=await api(null,'GET','/robots.txt');assert.equal(robots.status,200);assert.match(robots.data,/Disallow: \/api/);
 const llms=await api(null,'GET','/llms.txt');assert.equal(llms.status,200);assert.match(llms.data,/power-of-attorney/);
});
test('knowledge review dates become stale rather than being relabelled current',()=>{
 assert.equal(reviewStatus('2026-10-18',new Date('2026-10-18T12:00:00Z')).stale,false);
 assert.equal(reviewStatus('2026-10-18',new Date('2026-11-19T12:00:00Z')).stale,true);
});
