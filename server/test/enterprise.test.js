import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {api,db,closeAll} from './helpers.js';
import {config} from '../src/config.js';
import {availability} from '../src/domain/readiness.js';
import {verifyPayment} from '../src/domain/payments.js';
import {expireSubscriptions} from '../src/jobs.js';
after(closeAll);
const customer='sara@emirattest.example',ops='ops@emirattest.example',admin='admin@emirattest.example',fin='finance@emirattest.example',fin2='finance2@emirattest.example';
const supplier=()=>db.get("SELECT id FROM providers WHERE kind='travel_supplier'").id;
async function quote(){const r=await api(customer,'POST','/api/account/bookings',{serviceSlug:'flights',supplierId:supplier(),details:{note:'Private booking requirement'}});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.booking;}
async function checkout(b){const r=await api(customer,'POST',`/api/account/bookings/${b.id}/confirm`);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.payment;}
async function paidBooking(){const b=await quote();const p=await checkout(b);const r=await api(null,'POST',`/api/payments/${p.token}/charge`,{card:'4242424242424242'});assert.equal(r.status,200,JSON.stringify(r.data));return db.get('SELECT * FROM bookings WHERE id=?',b.id);}

test('payment does not fabricate supplier confirmation; issuance requires evidence and is exactly once',async()=>{
 const b=await quote();const p=await checkout(b);const again=await checkout(b);assert.equal(again.token,p.token);assert.equal(p.amount,b.supplier_amount+b.fee_aed+b.vat_aed);
 assert.equal((await api(null,'POST',`/api/payments/${p.token}/charge`,{card:'4242424242424242'})).status,200);
 const current=db.get('SELECT * FROM bookings WHERE id=?',b.id);assert.equal(current.status,'awaiting_supplier');assert.equal(current.supplier_ref,null);
 assert.equal(db.get("SELECT COUNT(*) AS n FROM ledger_entries WHERE payment_id=(SELECT id FROM payments WHERE token=?) AND account='booking_revenue'",p.token).n,0);
 assert.equal((await api(fin,'POST',`/api/enterprise/bookings/${b.id}/fulfil`,{action:'issue',supplier_ref:'TICKET-001',evidence_reference:'ISSUE-001'})).status,403);
 assert.equal((await api(ops,'POST',`/api/enterprise/bookings/${b.id}/fulfil`,{action:'issue',supplier_ref:'TICKET-001'})).status,400);
 const issued=await api(ops,'POST',`/api/enterprise/bookings/${b.id}/fulfil`,{action:'issue',supplier_ref:'TICKET-001',evidence_reference:'ISSUE-001'});assert.equal(issued.data.booking.status,'issued');assert.equal(issued.data.booking.supplier_ref,'TICKET-001');
 const before=db.get("SELECT COUNT(*) AS n FROM ledger_entries WHERE account='booking_revenue'").n;
 assert.equal((await api(ops,'POST',`/api/enterprise/bookings/${b.id}/fulfil`,{action:'issue',supplier_ref:'TICKET-001',evidence_reference:'ISSUE-001'})).status,409);
 const payment=db.get('SELECT * FROM payments WHERE token=?',p.token);verifyPayment(payment.id,'REPLAY');assert.equal(db.get("SELECT COUNT(*) AS n FROM ledger_entries WHERE account='booking_revenue'").n,before);
});

test('booking data is tenant-isolated, supplier-scoped, and finance does not receive request details',async()=>{
 const b=await paidBooking();assert.equal((await api('rahul@emirattest.example','GET',`/api/enterprise/bookings/${b.id}`)).status,403);
 assert.equal((await api(null,'GET','/api/enterprise/bookings')).status,401);
 const provider=db.get("SELECT u.* FROM users u JOIN provider_users pu ON pu.user_id=u.id WHERE pu.provider_id!=? LIMIT 1",b.supplier_id);
 assert.equal((await api(provider.email,'GET',`/api/enterprise/bookings/${b.id}`)).status,403);
 db.insert('provider_users',{provider_id:b.supplier_id,user_id:provider.id});
 assert.equal((await api(provider.email,'GET',`/api/enterprise/bookings/${b.id}`)).status,200);
 db.run('DELETE FROM provider_users WHERE provider_id=? AND user_id=?',b.supplier_id,provider.id);
 const finance=await api(fin,'GET',`/api/enterprise/bookings/${b.id}`);assert.equal(finance.status,200);assert.equal(finance.data.booking.details,undefined);
 const list=await api(fin,'GET','/api/enterprise/bookings');assert.ok(list.data.bookings.every(x=>x.details===undefined));
 assert.equal((await api('support@emirattest.example','POST',`/api/enterprise/bookings/${b.id}/fulfil`,{action:'fail',note:'x'})).status,403);
});

test('paid cancellations retain obligations; independent refund approvals precede actual payout and recovery',async()=>{
 const b=await paidBooking();const cancellation=await api(customer,'POST',`/api/account/bookings/${b.id}/cancel`,{reason:'Travel dates changed'});assert.equal(cancellation.data.booking.status,'cancellation_requested');
 assert.equal((await api(ops,'POST',`/api/enterprise/bookings/${b.id}/fulfil`,{action:'confirm_cancellation',supplier_ref:'CANCEL-01',evidence_reference:'SUP-CANCEL-01'})).data.booking.status,'cancelled');
 const asked=await api(ops,'POST',`/api/enterprise/bookings/${b.id}/refunds`,{amount:500,reason:'Approved supplier cancellation terms'});assert.equal(asked.status,201);const id=asked.data.refund.id;
 assert.equal((await api(ops,'POST',`/api/enterprise/booking-refunds/${id}`,{action:'approve'})).status,403);
 const a1=await api(fin,'POST',`/api/enterprise/booking-refunds/${id}`,{action:'approve'});assert.equal(a1.data.refund.status,'approved_1');
 assert.equal((await api(fin,'POST',`/api/enterprise/booking-refunds/${id}`,{action:'approve'})).status,403);
 const a2=await api(fin2,'POST',`/api/enterprise/booking-refunds/${id}`,{action:'approve'});assert.equal(a2.data.refund.status,'approved');assert.equal(a2.data.refund.paid_at,null);
 assert.equal((await api(fin,'POST',`/api/enterprise/booking-refunds/${id}`,{action:'payout'})).status,409);
 const paid=await api(fin,'POST',`/api/enterprise/booking-refunds/${id}`,{action:'payout',payout_reference:'ACTUAL-BOOKING-REFUND-01'});assert.equal(paid.data.refund.status,'paid');
 assert.equal((await api(fin,'POST',`/api/enterprise/booking-refunds/${id}`,{action:'payout',payout_reference:'ACTUAL-BOOKING-REFUND-01'})).status,409);
 const recovered=await api(fin,'POST',`/api/enterprise/booking-refunds/${id}`,{action:'supplier_recovery',amount:400,reference:'SUPPLIER-RECOVERY-01'});assert.equal(recovered.data.refund.supplier_recovery_amount,400);assert.equal(recovered.data.refund.amount,500);
 assert.equal((await api(ops,'POST',`/api/enterprise/bookings/${b.id}/refunds`,{amount:b.price_aed,reason:'Over refund'})).status,409);
});

test('unpaid cancellation invalidates checkout and bank proof preserves the typed booking relation',async()=>{
 const unpaid=await quote();const p=await checkout(unpaid);assert.equal((await api(customer,'POST',`/api/account/bookings/${unpaid.id}/cancel`)).data.booking.status,'cancelled');
 assert.equal((await api(null,'POST',`/api/payments/${p.token}/charge`,{card:'4242424242424242'})).status,409);
 const b=await quote();const pay=await checkout(b);const proof=await api(customer,'POST',`/api/payments/${pay.token}/bank-proof`,{reference:'CUSTOMER-ONLY-NOT-PROOF'});assert.equal(proof.status,200);
 const payment=db.get('SELECT * FROM payments WHERE token=?',pay.token);assert.equal(payment.booking_id,b.id);assert.equal(payment.status,'pending');assert.equal(payment.proof_note,`booking:${b.id}`);
 const reconciled=await api(fin,'POST',`/api/ops/finance/payments/${payment.id}/reconcile`,{bank_ref:'BANK-STMT-BOOKING-01'});assert.equal(reconciled.status,200);assert.equal(db.get('SELECT status FROM bookings WHERE id=?',b.id).status,'awaiting_supplier');
 const another=await quote();const next=await checkout(another);const nextPayment=db.get('SELECT id FROM payments WHERE token=?',next.token);
 assert.equal((await api(fin,'POST',`/api/ops/finance/payments/${nextPayment.id}/reconcile`,{bank_ref:'BANK-STMT-BOOKING-01'})).status,409);
});

test('production collections are blocked without a valid delivery arrangement and permissions are admin-only',async()=>{
 const previous=config.demoMode;config.demoMode=false;
 try{
  const blocked=await api(customer,'POST','/api/account/bookings',{serviceSlug:'flights',supplierId:supplier(),details:{}});assert.equal(blocked.status,409);
  const manager=db.get("SELECT id FROM users WHERE role='ops'").id;
  const input={status:'active',operating_entity:'Evidence test entity',jurisdiction:'Dubai',activity_scope:'Travel coordination',licence_reference:'LICENCE-EVIDENCE-TEST',agreement_reference:'SUPPLIER-AGREEMENT-TEST',permission_reference:'PERMISSION-TEST',responsible_user_id:manager,provider_id:supplier(),valid_until:'2099-12-31'};
  assert.equal((await api(ops,'PUT','/api/enterprise/readiness/flights',input)).status,403);
  assert.equal((await api(admin,'PUT','/api/enterprise/readiness/flights',{status:'active'})).status,400);
  const saved=await api(admin,'PUT','/api/enterprise/readiness/flights',input);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(availability('flights').operational,true);
  db.update('service_arrangements','flights',{valid_until:'2020-01-01'},'service_slug');assert.equal(availability('flights').operational,false);
  const publicService=await api(null,'GET','/api/public/services/flights');assert.equal(publicService.data.service.availability.status,'enquiry_only');assert.equal(publicService.data.service.agreement_reference,undefined);
 }finally{config.demoMode=previous;}
});

test('subscriptions wait for verified collection, retry one checkout, expire without deleting case evidence',async()=>{
 const owner=db.get("SELECT u.*,m.org_id FROM users u JOIN org_members m ON m.user_id=u.id WHERE m.role='owner' LIMIT 1");
 db.run("UPDATE subscriptions SET status='cancelled' WHERE org_id=?",owner.org_id);
 const before=db.get("SELECT COALESCE(SUM(amount),0) AS n FROM ledger_entries WHERE org_id=? AND account='subscription_revenue'",owner.org_id).n;
 const r=await api(owner.email,'POST',`/api/org/${owner.org_id}/subscription`);assert.equal(r.status,201);assert.equal(r.data.subscription.status,'pending_payment');assert.equal(r.data.payment.amount,313.95);
 const retry=await api(owner.email,'POST',`/api/org/${owner.org_id}/subscription`);assert.equal(retry.data.checkout.url,r.data.checkout.url);
 assert.equal(db.get("SELECT COALESCE(SUM(amount),0) AS n FROM ledger_entries WHERE org_id=? AND account='subscription_revenue'",owner.org_id).n,before);
 const token=r.data.checkout.url.split('/').at(-1);assert.equal((await api(null,'POST',`/api/payments/${token}/charge`,{card:'4242424242424242'})).status,200);
 const sub=db.get('SELECT * FROM subscriptions WHERE id=?',r.data.subscription.id);assert.equal(sub.status,'active');assert.ok(sub.paid_through);assert.equal(db.get("SELECT COALESCE(SUM(amount),0) AS n FROM ledger_entries WHERE org_id=? AND account='subscription_revenue'",owner.org_id).n,before+299);
 const docs=db.get('SELECT COUNT(*) AS n FROM documents').n;db.update('subscriptions',sub.id,{paid_through:'2020-01-01'});assert.ok(expireSubscriptions()>0);assert.equal(db.get('SELECT status FROM subscriptions WHERE id=?',sub.id).status,'expired');assert.equal(db.get('SELECT COUNT(*) AS n FROM documents').n,docs);
});

test('Stripe completion needs an actually paid AED session before booking advances',async()=>{
 const oldKey=config.stripe.key,oldSecret=config.stripe.webhookSecret;config.stripe.key='sk_test_fixture';config.stripe.webhookSecret='whsec_fixture';
 try{const b=await quote();const p=await checkout(b);const payment=db.get('SELECT * FROM payments WHERE token=?',p.token);
 const send=async(payment_status,currency)=>{const evt={type:'checkout.session.completed',data:{object:{id:'cs_fixture_'+b.id,metadata:{payment_id:String(payment.id)},amount_total:Math.round(payment.amount*100),payment_status,currency}}};const raw=JSON.stringify(evt);const t=Math.floor(Date.now()/1000);const hash=crypto.createHmac('sha256',config.stripe.webhookSecret).update(`${t}.${raw}`).digest('hex');return api(null,'POST','/api/payments/webhook/stripe',evt,{headers:{'stripe-signature':`t=${t},v1=${hash}`}});};
 assert.equal((await send('unpaid','aed')).status,200);assert.equal(db.get('SELECT status FROM payments WHERE id=?',payment.id).status,'pending');
 await send('paid','usd');assert.equal(db.get('SELECT status FROM payments WHERE id=?',payment.id).status,'pending');
 assert.equal((await send('paid','aed')).status,200);assert.equal(db.get('SELECT status FROM bookings WHERE id=?',b.id).status,'awaiting_supplier');
 }finally{config.stripe.key=oldKey;config.stripe.webhookSecret=oldSecret;}
});
