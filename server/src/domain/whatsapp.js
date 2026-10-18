import { all, get, insert, update, json } from '../db.js';
import { config } from '../config.js';
import { normPhone, waIdOf, nowIso, todayStr } from '../lib/util.js';
import { estimate } from './pricing.js';
import { listServices, getService, listRoutes, getRoute } from './catalog.js';
import { caseAccess } from './access.js';
import { STATUS, addEvent, addTask } from './cases.js';
import { answer } from './ai.js';
import { storeDocument } from './documents.js';
import { antivirusGate } from '../lib/clamav.js';
import { acceptQuote } from './quotes.js';
import { notifyRole } from './notify.js';
import { EMIRATES } from './catalog-data.js';
import { deadlinePlan } from './planner.js';

const isAr = (s) => /[؀-ۿ]/.test(s || '');
const L = {
  en: {
    menu: (n) => `Hello${n ? ` ${n}` : ''}, welcome to *Emirattest* — Documents cleared. Life moves.\n\nReply with a number:\n1️⃣ Check requirements for a document\n2️⃣ Get a fee estimate\n3️⃣ Track my case\n4️⃣ Book a pickup\n5️⃣ Send documents for my case\n6️⃣ Talk to a person\n7️⃣ عربي\n\nOr just ask a question. We never ask for passwords or UAE Pass codes.`,
    askDoc: 'Which document? Reply with a number:\n1 Degree / educational certificate\n2 Birth / marriage / police clearance (personal)\n3 Commercial invoice / certificate of origin\n4 Power of attorney / corporate resolution\n5 Translation\n6 Qualification recognition\n7 Emirates ID / residency renewal',
    askUse: 'Where will it be used? Reply *UAE* or the country name (e.g. India). If the country accepts an apostille, reply *apostille*.',
    askServ: 'Which service would you like an estimate for? Reply with a number:\n1 Educational attestation\n2 Personal documents attestation\n3 Commercial documents attestation\n4 Legal translation coordination\n5 PRO / Emirates ID renewal',
    askDocs: 'How many documents? (1–50)', askEm: (l) => `Pickup emirate? Reply with a number:\n${l}\n0 No pickup (I will upload / courier myself)`, askExp: 'Do you need expedited handling? (priced as extra coordination effort — it does not guarantee an authority decision)\n1 Yes  2 No',
    askRef: 'Send your case reference (e.g. EMT-26-000123).', noCase: 'I could not match that reference to your number. For privacy I can only show cases linked to this WhatsApp number. Reply 6 to speak to a person.',
    handoff: 'I have asked a team member to continue this chat. Our standard is to acknowledge within 4 business hours (Mon–Fri 09:00–18:00 GST). Your messages so far are shared so you need not repeat them.',
    askPickRef: 'Which case is this for? Send the case reference.', uploadReady: (r) => `Ready. Send photos or PDFs for *${r}* now (one message per file). Reply *done* when finished.`, gotDoc: (n, r) => `Received *${n}* for ${r}. It is virus-scanned and queued for review — this is not an authenticity check.`, done: 'Thank you. A reviewer will check completeness and mismatches and update your case.', bad: 'Sorry, I did not understand. Reply *menu* for options or *6* to speak to a person.',
    approve: (r, t, url) => `Quotation for *${r}* accepted (AED ${t}). Pay securely here: ${url}`, notYours: 'I can only act on cases linked to this WhatsApp number.', noQuote: 'There is no quotation awaiting your approval on that case.',
    pickupBooked: (em) => `Pickup request for *${em}* noted. A coordinator will confirm the window and the delivery charge for your location. Reply 5 to send documents for a case.`,
    disclaimer: 'ℹ️ Estimate only — a reviewed quotation confirms the final price. Not legal advice.',
  },
  ar: {
    menu: (n) => `مرحباً${n ? ` ${n}` : ''}، أهلاً بك في *إيميراتست* — مستنداتك جاهزة، وحياتك تتحرك.\n\nاكتب رقماً:\n1️⃣ متطلبات مستند\n2️⃣ تقدير الرسوم\n3️⃣ تتبع طلبي\n4️⃣ حجز استلام\n5️⃣ إرسال مستندات لطلبي\n6️⃣ التحدث مع موظف\n7️⃣ English\n\nأو اكتب سؤالك. لا نطلب كلمات المرور أو رموز الهوية الرقمية أبداً.`,
    askDoc: 'أي مستند؟ اكتب رقماً:\n1 شهادة جامعية\n2 ميلاد / زواج / حسن سيرة\n3 فاتورة تجارية / شهادة منشأ\n4 وكالة / قرار شركة\n5 ترجمة\n6 معادلة مؤهل\n7 تجديد الهوية / الإقامة',
    askUse: 'أين سيُستخدم؟ اكتب *الإمارات* أو اسم الدولة. وإذا كانت تقبل الأبوستيل اكتب *أبوستيل*.',
    askServ: 'لأي خدمة تريد التقدير؟ اكتب رقماً:\n1 تصديق شهادات تعليمية\n2 تصديق مستندات شخصية\n3 تصديق مستندات تجارية\n4 تنسيق ترجمة قانونية\n5 تجديد هوية / مندوب',
    askDocs: 'كم عدد المستندات؟ (1–50)', askEm: (l) => `إمارة الاستلام؟ اكتب رقماً:\n${l}\n0 بدون استلام`, askExp: 'هل تحتاج معالجة عاجلة؟ (تُسعَّر كجهد تنسيقي إضافي ولا تضمن قرار الجهة)\n1 نعم  2 لا',
    askRef: 'أرسل رقم طلبك (مثال: EMT-26-000123).', noCase: 'لم أجد هذا الرقم مرتبطاً برقمك. حفاظاً على الخصوصية أعرض فقط الطلبات المرتبطة بهذا الرقم. اكتب 6 للتحدث مع موظف.',
    handoff: 'طلبت من أحد الموظفين متابعة المحادثة. نلتزم بالرد خلال 4 ساعات عمل (الإثنين–الجمعة 9–18 بتوقيت الخليج). رسائلك السابقة مشاركة معه.',
    askPickRef: 'لأي طلب؟ أرسل رقم الطلب.', uploadReady: (r) => `جاهز. أرسل صور أو ملفات PDF للطلب *${r}* (ملف في كل رسالة) واكتب *تم* عند الانتهاء.`, gotDoc: (n, r) => `استلمنا *${n}* للطلب ${r}. تم فحصه ضد الفيروسات وهو بانتظار المراجعة — وهذا ليس فحصاً للأصالة.`, done: 'شكراً. سيراجع مختص الاكتمال والاختلافات ويحدّث طلبك.', bad: 'عذراً لم أفهم. اكتب *قائمة* للخيارات أو *6* للتحدث مع موظف.',
    approve: (r, t, url) => `تم قبول عرض السعر للطلب *${r}* (${t} درهم). ادفع بأمان من هنا: ${url}`, notYours: 'يمكنني التصرف فقط في الطلبات المرتبطة بهذا الرقم.', noQuote: 'لا يوجد عرض سعر بانتظار موافقتك على هذا الطلب.',
    pickupBooked: (em) => `تم تسجيل طلب الاستلام في *${em}*. سيؤكد المنسق الموعد ورسوم التوصيل. اكتب 5 لإرسال مستندات لطلب.`,
    disclaimer: 'ℹ️ تقدير فقط — يؤكد عرض السعر المُراجَع السعر النهائي. ليس استشارة قانونية.',
  },
};
const DOC_MAP = { 1: 'edu-degree-uae-to-abroad', 2: 'personal-civil-uae-use', 3: 'commercial-invoice-coo', 4: 'poa-corporate', 5: 'translation-certified', 6: 'qualification-recognition-mohesr', 7: 'emirates-id-renewal' };
const SERV_MAP = { 1: 'educational-attestation', 2: 'personal-attestation', 3: 'commercial-attestation', 4: 'legal-translation', 5: 'document-clearing' };
const fmt = (n) => `AED ${Number(n).toFixed(2).replace(/\.00$/, '')}`;

function getConversation(channel, waId, name) {
  let c = get('SELECT * FROM conversations WHERE channel = ? AND wa_id = ?', channel, waId);
  if (!c) {
    const user = all('SELECT id, lang, name, phone FROM users WHERE phone IS NOT NULL').find((u) => waIdOf(u.phone) === waId);
    const id = insert('conversations', { channel, wa_id: waId, user_id: user?.id, name: user?.name || name, lang: user?.lang || 'en', state: 'menu', context: {} });
    c = get('SELECT * FROM conversations WHERE id = ?', id);
  }
  return c;
}
const setState = (c, state, ctx) => { update('conversations', c.id, { state, context: ctx ?? json(c.context, {}), last_msg_at: nowIso() }); };
const log = (c, direction, body, kind = 'text', sender) => insert('conv_messages', { conversation_id: c.id, direction, kind, body, sender: sender || (direction === 'in' ? 'customer' : 'bot') });

function renderRequirements(slug, lang, apostille) {
  const route = getRoute(apostille && slug === 'edu-degree-uae-to-abroad' ? 'edu-degree-uae-to-abroad-apostille' : slug);
  if (!route) return null;
  const stages = route.stages.filter((s) => s.necessity !== 'unnecessary_if_done').map((s, i) => `${i + 1}. ${lang === 'ar' && s.name_ar ? s.name_ar : s.name} — ${s.min_days}–${s.max_days} ${lang === 'ar' ? 'أيام (تقدير)' : 'days (estimate)'}${s.necessity === 'conditional' ? (lang === 'ar' ? ' — إن لزم' : ' — if required') : ''}`).join('\n');
  const reqs = route.requirements.map((r) => `• ${r.label}`).join('\n');
  return `*${lang === 'ar' && route.title_ar ? route.title_ar : route.title_en}*\n\n${lang === 'ar' ? 'المراحل' : 'Stages'}:\n${stages}\n\n${lang === 'ar' ? 'المطلوب' : 'You will need'}:\n${reqs}\n\n${lang === 'ar' ? 'آخر مراجعة' : 'Last reviewed'}: ${route.reviewed_on}${route.freshness.stale ? (lang === 'ar' ? ' ⚠️ البيانات تحتاج مراجعة' : ' ⚠️ registry data is due for review') : ''}\n${route.source_urls[0] ? `${lang === 'ar' ? 'المصدر' : 'Source'}: ${route.source_urls[0]}\n` : ''}\n${L[lang].disclaimer}`;
}

function caseStatusText(c, lang) {
  const s = STATUS[c.status];
  const plan = deadlinePlan(c);
  const ar = lang === 'ar';
  return `*${c.ref}* — ${c.title}\n${ar ? 'الحالة' : 'Status'}: ${s.label}\n${ar ? 'الإجراء التالي' : 'Next action'}: ${c.next_action || '—'}${c.next_action_owner ? ` (${c.next_action_owner})` : ''}\n${ar ? 'التحديث القادم' : 'Next update due'}: ${c.next_update_due || '—'}\n${plan.target_date ? `${ar ? 'التاريخ المستهدف' : 'Target date'}: ${plan.target_date} — ${plan.status.replace('_', ' ')}\n` : ''}${ar ? 'التفاصيل الكاملة' : 'Full details'}: ${config.baseUrl}/app/cases/${c.id}`;
}

/** Process one inbound WhatsApp message. Returns replies (strings) and the conversation. Never asks for passwords/OTPs. */
export async function handleInbound({ channel = 'whatsapp', waId, name, text = '', media = null, waMsgId }) {
  const conv = getConversation(channel, waId, name);
  const clean = String(text || '').trim();
  if (isAr(clean) && conv.lang !== 'ar') update('conversations', conv.id, { lang: 'ar' });
  let c = get('SELECT * FROM conversations WHERE id = ?', conv.id);
  const lang = c.lang === 'ar' ? 'ar' : 'en';
  const m = L[lang];
  if (waMsgId && get('SELECT id FROM conv_messages WHERE wa_msg_id = ?', waMsgId)) return { replies: [], conversation: c, duplicate: true };
  const inId = log(c, 'in', media ? `[${media.mime || 'file'}] ${media.filename || ''} ${clean}`.trim() : clean, media ? 'document' : 'text');
  if (waMsgId) update('conv_messages', inId, { wa_msg_id: waMsgId });
  update('conversations', c.id, { last_msg_at: nowIso() });

  const user = c.user_id ? get('SELECT * FROM users WHERE id = ?', c.user_id) : null;
  const ctx = json(c.context, {});
  const replies = [];
  const say = (t) => { replies.push(t); log(c, 'out', t); };
  const low = clean.toLowerCase();

  if (c.handoff) { // a human owns the chat; keep context, bot stays quiet unless customer asks for menu
    if (/^(menu|قائمة|bot)$/i.test(clean)) { update('conversations', c.id, { handoff: 0 }); setState(c, 'menu', {}); say(m.menu(c.name)); }
    return { replies, conversation: get('SELECT * FROM conversations WHERE id = ?', c.id) };
  }

  if (/^(menu|hi|hello|start|0|قائمة|مرحبا|السلام)/i.test(clean) && c.state !== 'upload' && !(c.state.startsWith('est_') && /^\d+$/.test(clean))) { setState(c, 'menu', {}); say(m.menu(c.name)); return done(); }
  if (/^(7|english|عربي|arabic)$/i.test(clean) && c.state === 'menu') {
    const to = /^(english|7)$/i.test(clean) && lang === 'ar' ? 'en' : /^(عربي|arabic|7)$/i.test(clean) && lang === 'en' ? 'ar' : lang === 'ar' ? 'en' : 'ar';
    update('conversations', c.id, { lang: to }); c = get('SELECT * FROM conversations WHERE id = ?', c.id); say(L[to].menu(c.name)); return done();
  }
  const ap = clean.match(/^(approve|accept|موافق|اقبل)\s+(EMT-\d{2}-\d{6})/i);
  if (ap) { await approveQuote(ap[2].toUpperCase()); return done(); }
  if (/(human|agent|person|موظف|بشري|complain|شكوى)/i.test(clean) || (c.state === 'menu' && clean === '6')) { handoff(); return done(); }
  if (media) { await receiveMedia(); return done(); }

  switch (c.state) {
    case 'menu': {
      if (clean === '1') { setState(c, 'req_doc', {}); say(m.askDoc); }
      else if (clean === '2') { setState(c, 'est_service', {}); say(m.askServ); }
      else if (clean === '3') { await trackFlow(); }
      else if (clean === '4') { setState(c, 'book_emirate', {}); say(m.askEm(EMIRATES.map((e, i) => `${i + 1} ${e}`).join('\n'))); }
      else if (clean === '5') { setState(c, 'upload_ref', {}); say(m.askPickRef); }
      else { const r = await answer({ question: clean, lang }); say(`${r.answer}\n\n${r.disclaimer}`); if (r.handoff) say(lang === 'ar' ? 'للتحدث مع موظف اكتب 6.' : 'To speak to a person reply 6.'); }
      break;
    }
    case 'req_doc': { const slug = DOC_MAP[clean]; if (!slug) { say(m.askDoc); break; } setState(c, 'req_use', { slug }); say(m.askUse); break; }
    case 'req_use': { const apostille = /apostille|أبوستيل/i.test(clean); const t = renderRequirements(ctx.slug, lang, apostille); say(t); setState(c, 'menu', {}); say(lang === 'ar' ? 'اكتب 2 لتقدير الرسوم أو 6 للتحدث مع موظف.' : 'Reply 2 for a fee estimate or 6 to talk to a person.'); break; }
    case 'est_service': { const slug = SERV_MAP[clean]; if (!slug) { say(m.askServ); break; } setState(c, 'est_docs', { slug }); say(m.askDocs); break; }
    case 'est_docs': { const n = Number(clean); if (!(n >= 1 && n <= 50)) { say(m.askDocs); break; } setState(c, 'est_em', { ...ctx, docs: n }); say(m.askEm(EMIRATES.map((e, i) => `${i + 1} ${e}`).join('\n'))); break; }
    case 'est_em': { const i = Number(clean); if (!(i >= 0 && i <= 7)) { say(m.askEm(EMIRATES.map((e, k) => `${k + 1} ${e}`).join('\n'))); break; } setState(c, 'est_exp', { ...ctx, emirate: i ? EMIRATES[i - 1] : null }); say(m.askExp); break; }
    case 'est_exp': {
      const est = estimate({ serviceSlug: ctx.slug, docCount: ctx.docs, pickupEmirate: ctx.emirate, deliveryEmirate: ctx.emirate, expedited: clean === '1' });
      const lines = est.lines.map((l) => `• ${l.label}: ${fmt(l.amount)}`).join('\n');
      say(`*${lang === 'ar' ? 'تقدير' : 'ESTIMATE'}* — ${lang === 'ar' ? est.service.name_ar : est.service.name_en}\n\n${lines}\n• VAT 5% (${lang === 'ar' ? 'على رسوم إيميراتست' : 'on Emirattest fees'}): ${fmt(est.vat)}\n\n*${lang === 'ar' ? 'الإجمالي التقديري' : 'Estimated total'}: ${fmt(est.total)}*\n${est.authority_estimate_days ? `${lang === 'ar' ? 'المدة (تقدير الجهات)' : 'Timing (authority estimate)'}: ${est.authority_estimate_days.min}–${est.authority_estimate_days.max} ${lang === 'ar' ? 'أيام' : 'days'}\n` : ''}\n${m.disclaimer}`);
      say(lang === 'ar' ? 'لبدء طلب: ' + config.baseUrl + '/app/new  — أو اكتب 6 للتحدث مع موظف.' : `To start a request: ${config.baseUrl}/app/new — or reply 6 to talk to a person.`);
      setState(c, 'menu', {}); break;
    }
    case 'track_ref': { await showCase(clean); setState(c, 'menu', {}); break; }
    case 'book_emirate': { const i = Number(clean); if (!(i >= 1 && i <= 7)) { say(m.askEm(EMIRATES.map((e, k) => `${k + 1} ${e}`).join('\n'))); break; } const em = EMIRATES[i - 1]; insert('callbacks', { user_id: user?.id, name: c.name, phone: `+${waId}`, topic: `WhatsApp pickup request — ${em}` }); notifyRole(['support', 'ops'], { title: `WhatsApp pickup request (${em})`, body: `+${waId}`, link: '/ops/support', kind: 'ops' }); say(m.pickupBooked(em)); setState(c, 'menu', {}); break; }
    case 'upload_ref': { const cs = findOwnCase(clean); if (!cs) { say(m.noCase); setState(c, 'menu', {}); break; } setState(c, 'upload', { caseId: cs.id, ref: cs.ref }); say(m.uploadReady(cs.ref)); break; }
    case 'upload': { if (/^(done|تم|خلاص)/i.test(clean)) { say(m.done); setState(c, 'menu', {}); } else say(m.uploadReady(ctx.ref)); break; }
    default: setState(c, 'menu', {}); say(m.bad);
  }
  return done();

  function done() { return { replies, conversation: get('SELECT * FROM conversations WHERE id = ?', conv.id) }; }
  function findOwnCase(ref) {
    if (!user) return null;
    const cs = get('SELECT * FROM cases WHERE ref = ?', ref.toUpperCase().replace(/\s/g, ''));
    return cs && caseAccess(user, cs) && cs.customer_id === user.id ? cs : null;
  }
  async function trackFlow() {
    if (!user) { say(m.noCase); return; }
    const mine = all("SELECT * FROM cases WHERE customer_id = ? AND status NOT IN ('delivered','refunded','cancelled') ORDER BY updated_at DESC LIMIT 3", user.id);
    if (mine.length === 1) { say(caseStatusText(mine[0], lang)); return; }
    if (mine.length > 1) { say(mine.map((x) => `• ${x.ref} — ${STATUS[x.status].label}`).join('\n')); }
    setState(c, 'track_ref', {}); say(m.askRef);
  }
  async function showCase(ref) { const cs = findOwnCase(ref); say(cs ? caseStatusText(cs, lang) : m.noCase); }
  function handoff() {
    update('conversations', c.id, { handoff: 1, state: 'handoff' });
    notifyRole(['support'], { title: `WhatsApp handoff from ${c.name || waId}`, body: clean.slice(0, 120), link: '/ops/support', kind: 'handoff' });
    say(m.handoff);
  }
  async function approveQuote(ref) {
    const cs = findOwnCase(ref);
    if (!cs) { say(m.notYours); return; }
    const q = get("SELECT * FROM quotes WHERE case_id = ? AND status = 'awaiting_approval' ORDER BY id DESC LIMIT 1", cs.id);
    if (!q) { say(m.noQuote); return; }
    try {
      const out = acceptQuote(cs, q.id, user);
      addEvent(cs.id, null, 'whatsapp_approval', { from: `+${waId}` });
      say(m.approve(cs.ref, q.total, `${config.baseUrl}${out.checkout.url || `/app/cases/${cs.id}`}`));
    } catch (e) { say(e.message); }
  }
  async function receiveMedia() {
    let target = ctx.caseId ? get('SELECT * FROM cases WHERE id = ?', ctx.caseId) : null;
    if (!target && user) target = get("SELECT * FROM cases WHERE customer_id = ? AND status IN ('customer_action_required','correction_required') ORDER BY updated_at DESC LIMIT 1", user.id);
    if (!target || !user) { setState(c, 'upload_ref', {}); say(m.askPickRef); return; }
    try {
      await antivirusGate(media.buffer);
      const d = storeDocument({ user, caseId: target.id, profileId: target.profile_id, kind: 'other', filename: media.filename || `whatsapp-${Date.now()}.jpg`, buffer: media.buffer, meta: {} });
      addEvent(target.id, user, 'document_uploaded', { filename: d.filename, via: 'whatsapp' });
      setState(c, 'upload', { caseId: target.id, ref: target.ref });
      say(m.gotDoc(d.filename, target.ref));
    } catch (e) { say(`⚠️ ${e.message}`); }
  }
}

export function conversationMessages(id) { return all('SELECT * FROM conv_messages WHERE conversation_id = ? ORDER BY id', id); }
export const _w = { listServices, getService, listRoutes, normPhone, todayStr, addTask };
