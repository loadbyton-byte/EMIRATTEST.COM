import { GUIDES, COUNTRY_NOTES, SOURCES, REVIEWED, getGuide } from './knowledge.js';
import countries from './countries.json' with { type:'json' };
export const SITE='https://emirattest.com';
const pages={
 '/':['Attestation & document coordination in the UAE','Understand your document route, review indicative fees and manage attestation, translation, recognition and business paperwork.'],
 '/services':['Document, attestation & PRO services','Explore educational, personal and commercial attestation, translation, qualification recognition and business coordination.'],
 '/requirements':['Attestation requirements & document routes','Search document routes, check sources and review country-specific guidance before submitting your request.'],
 '/calculator':['Attestation fee calculator','Explore an itemised indicative estimate. Authority, partner and coordination charges are distinguished before a reviewed quotation.'],
 '/business':['Document operations for HR & business','Coordinate team requests, employee documents, approvals and billing in the Emirattest business workspace.'],
 '/trust':['Document care, accountability & privacy','Understand Emirattest’s independent coordination role, document access controls and case-accountability approach.'],
 '/guides':['Attestation knowledge centre','Read source-linked guides to MoFA attestation, recognition, powers of attorney, business setup, PRO services and document problems.'],
 '/countries':['Country & territory document directory','Search 249 country and territory entries. Published source notes are labelled separately from routes requiring mission review.'],
};
export function pageSEO(path, {service,base=SITE}={}) {
 const canonical=base.replace(/\/$/,'')+path;let title=pages[path]?.[0]||'Your Emirattest workspace';let description=pages[path]?.[1]||'Secure document coordination and case management.';let noindex=!pages[path];let found=!!pages[path]||/^\/(app|ops|provider|agent)(\/|$)/.test(path)||/^\/(login|register|demo|whatsapp-demo|track|forgot-password|reset-password|verify-email)$/.test(path)||/^\/(pay|invite|legal)\/[^/]+$/.test(path);let image='document-detail';let guide;
 if(path.startsWith('/guides/')){guide=getGuide(path.split('/')[2]);found=!!guide;if(guide){title=guide.title;description=guide.answer;image=guide.image;noindex=false;}}
 if(path.startsWith('/countries/')){const country=countries.find(c=>c.code.toLowerCase()===path.split('/')[2]);found=!!country;if(country){title=`${country.name}: document guidance`;description=COUNTRY_NOTES[country.code]?.summary||'Country-specific route review is required before arranging document certification.';noindex=!COUNTRY_NOTES[country.code];image='east-coast-document-service';}}
 if(path.startsWith('/services/')){found=!!service;if(service){title=service.name_en;description=service.summary_en;noindex=false;}else{title='Document service';description='Review the scope and requirements of your document service.';noindex=true;}}
 if(!found){title='Page not found';description='Find a service or browse the Emirattest knowledge centre.';noindex=true;}
 const schema=[{'@context':'https://schema.org','@type':'WebSite','@id':base+'/#website',name:'Emirattest',url:base}];
 if(!noindex){schema.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Home',item:base},...(path!=='/'?[{'@type':'ListItem',position:2,name:title,item:canonical}]:[])]});}
 if(guide){schema.push({'@context':'https://schema.org','@type':'Article',headline:guide.title,description:guide.answer,dateModified:guide.reviewed,author:{'@type':'Organization',name:'Emirattest editorial desk'},publisher:{'@type':'Organization',name:'Emirattest',url:base},mainEntityOfPage:canonical,image:base+`/images/${image}.webp`,citation:guide.sources.map(x=>SOURCES[x].url),inLanguage:'en'});}
 if(service){schema.push({'@context':'https://schema.org','@type':'Service',name:title,description,provider:{'@type':'Organization',name:'Emirattest'},url:canonical});}
 return {title:title+' | Emirattest',description,canonical,noindex,found,image:base+`/images/${image}.webp`,schema,guide};
}
export function indexablePaths(){return [...Object.keys(pages),...GUIDES.map(g=>`/guides/${g.slug}`),...Object.keys(COUNTRY_NOTES).map(c=>`/countries/${c.toLowerCase()}`)];}
export const CONTENT_REVIEWED=REVIEWED;
