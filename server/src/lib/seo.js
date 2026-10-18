import { pageSEO, indexablePaths, CONTENT_REVIEWED } from '../../../shared/seo.js';
import { GUIDES, COUNTRY_NOTES, SOURCES } from '../../../shared/knowledge.js';
import countries from '../../../shared/countries.json' with {type:'json'};
import { getService, listServices } from '../domain/catalog.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=v=>JSON.stringify(v).replace(/</g,'\\u003c');
const configured=process.env.SEO_BASE_URL||process.env.APP_BASE_URL;
export const seoBase=configured&&/^https:\/\//.test(configured)?configured.replace(/\/$/,''):'https://emirattest.com';
export function seoResponse(path, template) {
 const slug=path.startsWith('/services/')?path.split('/')[2]:null;const service=slug?getService(slug):null;const seo=pageSEO(path,{service,base:seoBase});if(slug&&!service)seo.found=false;
 let html=template.replace(/<title>[^<]*<\/title>/,'').replace(/<meta\s+(?:name="description"|property="og:[^"]+")[^>]*>/g,'');
 const head=`<title>${esc(seo.title)}</title><meta name="description" content="${esc(seo.description)}"><meta name="robots" content="${seo.noindex?'noindex,follow':'index,follow,max-image-preview:large'}"><link rel="canonical" href="${esc(seo.canonical)}"><meta property="og:type" content="${seo.guide?'article':'website'}"><meta property="og:title" content="${esc(seo.title)}"><meta property="og:description" content="${esc(seo.description)}"><meta property="og:url" content="${esc(seo.canonical)}"><meta property="og:image" content="${esc(seo.image)}"><meta name="twitter:card" content="summary_large_image"><script id="page-schema" type="application/ld+json">${json(seo.schema)}</script>`;
 html=html.replace('</head>',head+'</head>');
 let body='';const g=seo.guide;
 if(g){body=`<article><p>Knowledge centre · Sources checked ${esc(g.reviewed)}</p><h1>${esc(g.title)}</h1><p>${esc(g.answer)}</p>${g.sections.map(([h,p])=>`<section><h2>${esc(h)}</h2><p>${esc(p)}</p></section>`).join('')}<h2>Preparation checklist</h2><ul>${g.checklist.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><h2>Common scenarios</h2>${g.scenarios.map(s=>`<p>${esc(s)}</p>`).join('')}<h2>Official sources</h2><ul>${g.sources.map(id=>`<li><a href="${esc(SOURCES[id].url)}">${esc(SOURCES[id].label)}</a></li>`).join('')}</ul><p>Editorial procedural guidance, not an individual legal opinion. Confirm current official requirements before submission.</p><a href="/app/new?service=${esc(g.service)}">Start a reviewed request</a></article>`;}
 else if(path==='/guides'){body=`<h1>Attestation knowledge centre</h1>${GUIDES.map(g=>`<section><h2><a href="/guides/${g.slug}">${esc(g.title)}</a></h2><p>${esc(g.answer)}</p></section>`).join('')}`;}
 else if(path==='/countries'){body=`<h1>Country and territory directory</h1><p>Published notes and entries requiring mission review are clearly distinguished.</p><ul>${countries.map(c=>`<li><a href="/countries/${c.code.toLowerCase()}">${esc(c.name)}</a> — ${COUNTRY_NOTES[c.code]?'Published source note':'Mission review required'}</li>`).join('')}</ul>`;}
 else if(path.startsWith('/countries/')&&seo.found){const code=path.split('/')[2].toUpperCase();const note=COUNTRY_NOTES[code];body=`<h1>${esc(seo.title.replace(' | Emirattest',''))}</h1><p>${esc(seo.description)}</p>${note?`<p>Sources checked ${CONTENT_REVIEWED}</p><ol>${note.steps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol><ul>${note.sources.map(id=>`<li><a href="${esc(SOURCES[id].url)}">${esc(SOURCES[id].label)}</a></li>`).join('')}</ul>${note.caution?`<p>${esc(note.caution)}</p>`:''}`:'<p>No country-specific law, fee or sequence is asserted. Contact the responsible mission.</p>'}`;}
 else if(service){body=`<h1>${esc(service.name_en)}</h1><p>${esc(service.summary_en)}</p><h2>What to prepare</h2><ul>${service.requirements.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><a href="/guides">Read current source-linked guidance</a>`;}
 else if(!seo.noindex){body=`<h1>${esc(seo.title.replace(' | Emirattest',''))}</h1><p>${esc(seo.description)}</p><a href="/guides">Document guidance</a> · <a href="/countries">Country directory</a> · <a href="/services">Services</a>`;}
 if(body)html=html.replace('<div id="root"></div>',`<div id="root"><main class="wrap section crawl-content"><nav><a href="/">Emirattest</a> · <a href="/services">Services</a> · <a href="/guides">Guides</a> · <a href="/countries">Countries</a></nav>${body}</main></div>`);
 return {html,seo};
}
export function sitemap(){const paths=[...indexablePaths(),...listServices().map(s=>`/services/${s.slug}`)];return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p=>`<url><loc>${esc(seoBase+p)}</loc></url>`).join('')}</urlset>`;}
export function robots(){return `User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /ops\nDisallow: /provider\nDisallow: /agent\nDisallow: /api\nDisallow: /pay/\nDisallow: /invite/\nSitemap: ${seoBase}/sitemap.xml\n`;}

export function llmsIndex(){return `# Emirattest

Independent UAE document-service coordination. Public procedural summaries are editorial guidance, not individual legal opinions. Sources checked ${CONTENT_REVIEWED}; consult original authorities for current requirements.

## Public guidance
${GUIDES.map(g=>`- [${g.title}](${seoBase}/guides/${g.slug}): ${g.answer}`).join('\n')}

## Directories
- [Countries](${seoBase}/countries): country and territory directory. Only labelled source notes are reviewed; unreviewed entries make no procedural claims.
- [Services](${seoBase}/services)
- [Trust](${seoBase}/trust)

Do not infer official endorsement, guaranteed approval, live integration readiness or coverage in every country from this site. Private case records, payments and identity information are not public knowledge sources.
`;}
