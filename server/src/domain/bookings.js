import { all, get, insert, update, tx, json, getSetting } from '../db.js';
import { bad, forbidden, notFound, conflict, nowIso, money } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { notify } from './notify.js';
export const BOOKING_STATUS={quoted:'Quotation ready',awaiting_supplier:'Payment received · awaiting supplier',issued:'Issued by supplier',fulfilment_failed:'Supplier issue requires attention',cancellation_requested:'Cancellation requested',cancelled:'Cancelled',booked:'Legacy booking · verify supplier evidence'};
export function bookingFor(user,id,{write=false,finance=false}={}){
 const b=get('SELECT * FROM bookings WHERE id = ?',Number(id));if(!b)throw notFound();
 if(['admin','ops'].includes(user.role))return b;
 if(user.role==='support'&&!write)return b;
 if(user.role==='finance'&&finance)return b;
 if(user.role==='provider'&&get('SELECT 1 FROM provider_users WHERE provider_id=? AND user_id=?',b.supplier_id,user.id))return b;
 if(!write&&b.user_id===user.id)return b;
 throw forbidden();
}
export function bookingEvent(b,user,type,status,{note,evidence_reference}={}){insert('booking_events',{booking_id:b.id,actor_user_id:user?.id,type,previous_status:b.status,status,note,evidence_reference});}
export function bookingOut(b,{events=true}={}){return {...b,details:json(b.details,{}),status_label:BOOKING_STATUS[b.status]||b.status,events:events?all('SELECT id,type,status,note,evidence_reference,created_at FROM booking_events WHERE booking_id=? ORDER BY id',b.id):undefined,refunds:all('SELECT id,amount,reason,status,paid_at,supplier_recovery_amount FROM booking_refund_requests WHERE booking_id=? ORDER BY id DESC',b.id)};}
export function requestCancellation(b,user,reason){
 return tx(()=>{const current=get('SELECT * FROM bookings WHERE id=?',b.id);if(['cancelled','cancellation_requested'].includes(current.status))return bookingOut(current);
 if(!['quoted','awaiting_supplier','issued','booked','fulfilment_failed'].includes(current.status))throw conflict('Cancellation is not available in this state');
 const paid=get("SELECT id FROM payments WHERE booking_id=? AND status IN ('verified','partially_refunded')",b.id);
 const status=paid?'cancellation_requested':'cancelled';
 update('bookings',b.id,{status,cancellation_reason:String(reason||'Customer requested cancellation').slice(0,2000)});
 if(!paid)all("SELECT id FROM payments WHERE booking_id=? AND status='pending'",b.id).forEach(p=>update('payments',p.id,{status:'cancelled'}));
 bookingEvent(current,user,'cancellation_requested',status,{note:reason||'Customer requested cancellation'});audit(user,'booking.cancel.request','booking',b.id,{status});
 return bookingOut(get('SELECT * FROM bookings WHERE id=?',b.id));});
}
export function fulfilBooking(b,user,{action,supplier_ref,evidence_reference,note}){
 return tx(()=>{b=get('SELECT * FROM bookings WHERE id=?',b.id);
 const allowed={issue:['awaiting_supplier'],fail:['awaiting_supplier'],retry:['fulfilment_failed'],confirm_cancellation:['cancellation_requested']};
 if(!allowed[action]?.includes(b.status))throw conflict(`Cannot ${action} a booking in ${b.status}`);
 if(action==='issue'){const supplier=get("SELECT id FROM providers WHERE id=? AND status='active' AND license_verified=1",b.supplier_id);if(!supplier)throw conflict('Supplier is not active and verified');if(get("SELECT id FROM booking_refund_requests WHERE booking_id=? AND status!='rejected'",b.id))throw conflict('Resolve the refund review before issuing');}
 if(['issue','confirm_cancellation'].includes(action)&&(!supplier_ref?.trim()||!evidence_reference?.trim()))throw bad('Supplier reference and evidence are required');
 if(['fail','retry'].includes(action)&&!note?.trim())throw bad('A reason or next action is required');
 const status={issue:'issued',fail:'fulfilment_failed',retry:'awaiting_supplier',confirm_cancellation:'cancelled'}[action];
 const patch={status};if(action==='issue')Object.assign(patch,{supplier_ref,fulfilment_evidence:evidence_reference,issued_at:nowIso()});if(action==='confirm_cancellation')patch.supplier_cancel_reference=supplier_ref;
 update('bookings',b.id,patch);bookingEvent(b,user,action,status,{note,evidence_reference});
 if(action==='issue'){
  const payments=all("SELECT id FROM payments WHERE booking_id=? AND status='verified'",b.id);
  for(const p of payments){const deferred=all("SELECT * FROM ledger_entries WHERE payment_id=? AND account='deferred_service_fee' AND state='deferred'",p.id);
   for(const l of deferred){update('ledger_entries',l.id,{state:'recognised'});insert('ledger_entries',{payment_id:p.id,case_id:b.case_id,org_id:b.org_id,account:'booking_revenue',amount:l.amount,state:'recognised',category:'travel',memo:`Supplier issuance evidenced: ${b.ref}`});}
  }
 }
 audit(user,'booking.'+action,'booking',b.id,{supplier_ref,evidence_reference});notify(b.user_id,{title:`${b.ref}: ${BOOKING_STATUS[status]}`,body:note||'Open your booking to review the recorded update.',link:'/app/bookings',kind:'booking'});
 return bookingOut(get('SELECT * FROM bookings WHERE id=?',b.id));});
}
export function requestBookingRefund(b,user,{amount,reason}){
 if(!['admin','ops','finance'].includes(user.role))throw forbidden();
 amount=money(Number(amount));if(!Number.isFinite(amount)||amount<=0||!reason?.trim())throw bad('Positive amount and reason required');
 return tx(()=>{
  const p=get("SELECT * FROM payments WHERE booking_id=? AND status IN ('verified','partially_refunded') ORDER BY id LIMIT 1",b.id);if(!p)throw conflict('No verified collection for this booking');
  const reserved=get("SELECT COALESCE(SUM(amount),0) AS n FROM booking_refund_requests WHERE payment_id=? AND status!='rejected'",p.id).n;
  if(reserved+amount>p.amount+.001)throw conflict('Refund exceeds the remaining collected amount');
  const id=insert('booking_refund_requests',{booking_id:b.id,payment_id:p.id,amount,reason,requested_by:user.id});audit(user,'booking.refund.request','booking',b.id,{amount,refund:id});return get('SELECT * FROM booking_refund_requests WHERE id=?',id);
 });
}
export function actBookingRefund(id,user,{action,payout_reference,amount,reference}){
 if(!['admin','finance'].includes(user.role))throw forbidden();
 return tx(()=>{const r=get('SELECT * FROM booking_refund_requests WHERE id=?',Number(id));if(!r)throw notFound();
 if(action==='approve'){
  if(r.requested_by===user.id||r.approver1===user.id)throw forbidden('Independent approvers are required');
  if(!['requested','approved_1'].includes(r.status))throw conflict('Refund is not awaiting approval');
  const dual=r.amount>=Number(getSetting('refund_dual_threshold',300));
  update('booking_refund_requests',r.id,r.status==='requested'?{approver1:user.id,status:dual?'approved_1':'approved'}:{approver2:user.id,status:'approved'});
 }else if(action==='reject'){
  if(!['requested','approved_1'].includes(r.status))throw conflict('Refund cannot be rejected in this state');update('booking_refund_requests',r.id,{status:'rejected'});
 }else if(action==='payout'){
  if(r.status!=='approved'||!payout_reference?.trim())throw conflict('Approved refund and actual payout reference required');
  if(get('SELECT id FROM refunds WHERE payout_reference=?',payout_reference)||get('SELECT id FROM booking_refund_requests WHERE payout_reference=?',payout_reference))throw conflict('Payout reference already used');
  update('booking_refund_requests',r.id,{status:'paid',payout_reference,paid_at:nowIso()});
  const b=get('SELECT * FROM bookings WHERE id=?',r.booking_id);insert('ledger_entries',{case_id:b.case_id,payment_id:r.payment_id,org_id:b.org_id,account:'refund',amount:-r.amount,state:'settled',category:'travel',memo:`Booking refund payout ${payout_reference}`});
  const total=get("SELECT SUM(amount) AS n FROM booking_refund_requests WHERE payment_id=? AND status='paid'",r.payment_id).n;
  const p=get('SELECT * FROM payments WHERE id=?',r.payment_id);update('payments',p.id,{status:total>=p.amount-.001?'refunded':'partially_refunded'});
 }else if(action==='supplier_recovery'){
  amount=money(Number(amount));if(!Number.isFinite(amount)||amount<=0||!reference?.trim()||r.supplier_recovery_reference)throw bad('Positive recovery, reference and an unrecovered refund are required');
  const b=get('SELECT * FROM bookings WHERE id=?',r.booking_id);const total=get('SELECT COALESCE(SUM(supplier_recovery_amount),0) AS n FROM booking_refund_requests WHERE booking_id=?',b.id).n;
  if(total+amount>b.supplier_amount+.001)throw conflict('Recovery exceeds the supplier amount');
  update('booking_refund_requests',r.id,{supplier_recovery_amount:amount,supplier_recovery_reference:reference,supplier_recovery_at:nowIso()});insert('ledger_entries',{payment_id:r.payment_id,provider_id:b.supplier_id,account:'supplier_recovery',amount,state:'settled',category:'travel',memo:reference});
 }else throw bad('Unknown refund action');
 audit(user,'booking.refund.'+action,'booking_refund',r.id,{payout_reference,amount,reference});return get('SELECT * FROM booking_refund_requests WHERE id=?',r.id);
 });
}
