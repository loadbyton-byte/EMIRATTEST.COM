import { Router } from 'express';
import { all, get, json } from '../db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { validate } from '../lib/util.js';
import { availability, readinessDesk, saveArrangement } from '../domain/readiness.js';
import { bookingFor, bookingOut, fulfilBooking, requestBookingRefund, actBookingRefund } from '../domain/bookings.js';
export const enterprise=Router();enterprise.use(requireAuth);
enterprise.get('/readiness',requireRole('admin','ops'),(_req,res)=>res.json({services:readinessDesk(),managers:all("SELECT id,name FROM users WHERE role IN ('ops','admin') AND status='active'"),providers:all('SELECT id,name,status,license_verified FROM providers')}));
enterprise.put('/readiness/:slug',requireRole('admin'),(req,res)=>res.json({arrangement:saveArrangement(req.params.slug,req.body||{},req.user),availability:availability(req.params.slug)}));
enterprise.get('/bookings',requireRole('admin','ops','support','finance','provider'),(req,res)=>{
 const rows=req.user.role==='provider'?all('SELECT b.* FROM bookings b JOIN provider_users pu ON pu.provider_id=b.supplier_id WHERE pu.user_id=? ORDER BY b.id DESC',req.user.id):all('SELECT * FROM bookings ORDER BY id DESC LIMIT 250');
 res.json({bookings:rows.map(b=>{const {details,events,...out}=bookingOut(b);return req.user.role==='finance'?out:{...out,details,events};})});
});
enterprise.get('/bookings/:id',(req,res)=>{const b=bookingFor(req.user,req.params.id,{finance:true});const out=bookingOut(b);if(req.user.role==='finance'){delete out.details;delete out.events;}res.json({booking:out});});
enterprise.post('/bookings/:id/fulfil',requireRole('admin','ops','provider'),(req,res)=>{const b=bookingFor(req.user,req.params.id,{write:true});const data=validate(req.body,{action:'string!',supplier_ref:'string',evidence_reference:'string',note:'string'});res.json({booking:fulfilBooking(b,req.user,data)});});
enterprise.post('/bookings/:id/refunds',requireRole('admin','ops','finance'),(req,res)=>{const b=bookingFor(req.user,req.params.id,{finance:true});res.status(201).json({refund:requestBookingRefund(b,req.user,validate(req.body,{amount:'number!',reason:'string!'}))});});
enterprise.get('/booking-refunds',requireRole('finance','admin'),(_req,res)=>res.json({refunds:all('SELECT r.*,b.ref AS booking_ref FROM booking_refund_requests r JOIN bookings b ON b.id=r.booking_id ORDER BY r.id DESC LIMIT 250')}));
enterprise.post('/booking-refunds/:id',requireRole('finance','admin'),(req,res)=>res.json({refund:actBookingRefund(req.params.id,req.user,validate(req.body,{action:'string!',payout_reference:'string',amount:'number',reference:'string'}))}));
