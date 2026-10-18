import { all, get, insert, update, tx, json } from '../db.js';
import { config } from '../config.js';
import { bad, conflict, notFound, todayStr, nowIso } from '../lib/util.js';
import { audit } from '../lib/audit.js';
export function availability(slug, {demo=config.demoMode}={}) {
 const a=get('SELECT * FROM service_arrangements WHERE service_slug = ?',slug);
 const blockers=[];
 if(!a||a.status!=='active')blockers.push(a?.status==='suspended'?'Service suspended':'Delivery arrangement not activated');
 if(a?.valid_until&&a.valid_until<todayStr())blockers.push('Delivery arrangement has expired');
 if(a?.provider_id){const p=get('SELECT status, license_verified FROM providers WHERE id = ?',a.provider_id);if(!p||p.status!=='active'||!p.license_verified)blockers.push('Authorised supplier unavailable');}
 return {status:demo?'demonstration':blockers.length?'enquiry_only':'operational',operational:demo||blockers.length===0,demonstration:demo,blockers:demo?[]:blockers,valid_until:a?.valid_until||null};
}
export function assertOperational(slug,providerId){const state=availability(slug);const arrangement=get('SELECT provider_id FROM service_arrangements WHERE service_slug=?',slug);if(!config.demoMode&&providerId&&arrangement?.provider_id&&Number(providerId)!==arrangement.provider_id)throw conflict('The selected provider is not the activated delivery arrangement for this service');if(!state.operational)throw conflict('This service is available for enquiry only until its delivery arrangement is verified.',{availability:state});return state;}
export function saveArrangement(slug, body, user){
 const service=get('SELECT * FROM services WHERE slug = ?',slug);if(!service)throw notFound('Unknown service');
 const allowed=['status','operating_entity','jurisdiction','activity_scope','licence_reference','agreement_reference','permission_reference','responsible_user_id','provider_id','valid_until'];
 const patch=Object.fromEntries(allowed.filter(k=>Object.hasOwn(body,k)).map(k=>[k,body[k]===''?null:body[k]]));
 if(Object.hasOwn(patch,'status')&&!['enquiry_only','active','suspended'].includes(patch.status))throw bad('Invalid arrangement status');
 for(const key of ['responsible_user_id','provider_id'])if(patch[key]!=null&&(!Number.isInteger(Number(patch[key]))||Number(patch[key])<1))throw bad(`Invalid ${key}`);else if(patch[key]!=null)patch[key]=Number(patch[key]);
 for(const key of allowed.filter(k=>!['responsible_user_id','provider_id'].includes(k)))if(patch[key]!=null&&(typeof patch[key]!=='string'||patch[key].length>2000))throw bad(`Invalid ${key}`);
 if(patch.valid_until&&(!/^\d{4}-\d{2}-\d{2}$/.test(patch.valid_until)||!Number.isFinite(Date.parse(patch.valid_until))||new Date(patch.valid_until).toISOString().slice(0,10)!==patch.valid_until))throw bad('A valid expiry date is required');
 return tx(()=>{const current=get('SELECT * FROM service_arrangements WHERE service_slug = ?',slug);const next={...current,...patch};
 if(next.status==='active'){
  for(const k of ['operating_entity','jurisdiction','activity_scope','licence_reference','agreement_reference','permission_reference','responsible_user_id','valid_until'])if(!next[k])throw bad(`${k} is required to activate this service`);
  if(next.valid_until<todayStr())throw bad('The delivery arrangement is expired');
  if(!get("SELECT id FROM users WHERE id = ? AND role IN ('admin','ops') AND status = 'active'",next.responsible_user_id))throw bad('Choose an active operations manager');
  if(service.regulated||service.kind==='booking'){
   if(!next.provider_id)throw bad('This service needs a named authorised provider');
  }
  if(next.provider_id){const p=get("SELECT * FROM providers WHERE id = ? AND status = 'active' AND license_verified = 1",next.provider_id);if(!p)throw bad('Provider must be active and verified');const covers=json(p.covers,[]);const route=service.default_route_slug?get('SELECT slug,doc_category FROM routes WHERE slug=?',service.default_route_slug):null;if(!covers.some(x=>['*',service.slug,service.category,route?.slug,route?.doc_category].includes(x)))throw bad('Provider coverage does not include this service');}
 }
 const data={...patch,reviewed_by:user.id,reviewed_at:nowIso(),updated_at:nowIso()};
 if(current)update('service_arrangements',slug,data,'service_slug');else insert('service_arrangements',{service_slug:slug,...data});
 audit(user,'service.arrangement','service',slug,{status:next.status,provider_id:next.provider_id});
 return get('SELECT * FROM service_arrangements WHERE service_slug = ?',slug);
 });
}
export function readinessDesk(){return all('SELECT s.slug,s.name_en,s.kind,s.regulated,a.status AS arrangement_status,a.operating_entity,a.jurisdiction,a.activity_scope,a.licence_reference,a.agreement_reference,a.permission_reference,a.responsible_user_id,a.provider_id,a.valid_until,a.reviewed_at FROM services s LEFT JOIN service_arrangements a ON a.service_slug=s.slug ORDER BY s.sort').map(s=>({...s,availability:availability(s.slug,{demo:false})}));}
