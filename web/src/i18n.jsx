import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const D = {
  en: {
    tagline: 'Documents cleared. Life moves.', nav_services: 'Services', nav_calc: 'Fee calculator', nav_req: 'Requirements', nav_business: 'For business', nav_track: 'Track a case', nav_trust: 'Trust & privacy', signin: 'Sign in', signup: 'Create account', signout: 'Sign out', my_app: 'My workspace',
    hero_title: 'Clear requirements. Clear next steps.', hero_lead: 'Attestation, PRO and relocation support for individuals, families and businesses across the UAE. You see the route, the itemised cost and who is responsible — before you commit.',
    hero_foot: 'Free guidance • Itemised approved prices • Enquiry acknowledged within 4 business hours • Never asks for passwords or UAE Pass codes',
    cta_review: 'Review requirements', cta_quote: 'Request a quotation', cta_track: 'Track your case', cta_talk: 'Talk to our team',
    cats_title: 'One platform for every document-led life event', cats_sub: 'Every category below belongs to the launch catalogue. Availability for a given transaction depends on the applicant, destination, authority rules and eligibility.',
    how_title: 'How it works', how1: 'Choose your purpose', how1d: 'Country, destination, holder and deadline — we map the correct route, not a generic chain.', how2: 'See the real cost', how2d: 'Estimate first, then a reviewed quotation with line items. Authority and courier charges are shown without markup.', how3: 'We coordinate, you choose the provider', how3d: 'Pick from eligible providers with visible track records. Sponsored placement is always labelled.', how4: 'Track every handover', how4d: 'Custody events, tasks, next update date and a completion pack you can keep.',
    trust_title: 'Built on accountability', trust1: 'Independent facilitator', trust1d: 'Official decisions remain with the responsible authorities. We never imply government affiliation or guaranteed approval.', trust2: 'Itemised, approved prices', trust2d: 'Variations need your approval before more money is spent. Refunds are visible with reason and timing.', trust3: 'Private by design', trust3d: 'Expiring links, access logs, consent per purpose. We never ask for passwords or UAE Pass one-time codes.',
    biz_title: 'For typing centres, HR teams, agencies and enterprises', biz_lead: 'Organisation workspaces with roles, bulk intake, employee readiness, purchase controls, consolidated billing and an API.',
    footer_disclaimer: 'Emirattest is an independent facilitator and service coordinator. Official attestations, immigration decisions, licences, insurance cover and banking decisions remain with the responsible authorities or authorised providers. This is a demonstration environment with fictional data.',
    email: 'Email', password: 'Password', name: 'Full name', phone: 'Phone (WhatsApp)', login_title: 'Sign in to Emirattest', register_title: 'Create your account', demo_title: 'Demo personas', demo_lead: 'One-click access to every role, each with realistic data. All data is fictional.',
    estimate: 'Estimate', total: 'Total', vat: 'VAT', service: 'Service', docs: 'Documents', pickup: 'Pickup emirate', expedite: 'Expedited handling', calc_title: 'Indicative fee calculator', calc_note: 'This is an ESTIMATE. A reviewed quotation with line items confirms the final price.',
    ask_ai: 'Ask Emirattest', ai_hello: 'Hi! Ask me about requirements, fees, timing or tracking. I answer from approved guidance and never ask for passwords or one-time codes.', send: 'Send', type_here: 'Type your question…',
    whatsapp: 'WhatsApp', open_whatsapp: 'Chat on WhatsApp', dashboard: 'Dashboard', requests: 'My requests', new_request: 'New request', family: 'Family', documents: 'Documents', bookings: 'Bookings', planner: 'Planner', settings: 'Settings', notifications: 'Notifications', messages: 'Messages',
    status: 'Status', next_action: 'Next action', next_update: 'Next update due', owner: 'Owner', provider: 'Provider', target: 'Target date', ref: 'Reference',
  },
  ar: {
    tagline: 'مستنداتك جاهزة، وحياتك تتحرك.', nav_services: 'الخدمات', nav_calc: 'حاسبة الرسوم', nav_req: 'المتطلبات', nav_business: 'للأعمال', nav_track: 'تتبع طلب', nav_trust: 'الثقة والخصوصية', signin: 'تسجيل الدخول', signup: 'إنشاء حساب', signout: 'تسجيل الخروج', my_app: 'مساحتي',
    hero_title: 'متطلبات واضحة. خطوات تالية واضحة.', hero_lead: 'خدمات التصديق والمندوب والانتقال للأفراد والعائلات والشركات في الإمارات. ترى المسار والتكلفة المفصّلة ومن المسؤول — قبل أن تلتزم.',
    hero_foot: 'إرشاد مجاني • أسعار مفصلة ومعتمدة • الرد على الاستفسارات خلال 4 ساعات عمل • لا نطلب كلمات المرور أو رموز الهوية الرقمية',
    cta_review: 'راجع المتطلبات', cta_quote: 'اطلب عرض سعر', cta_track: 'تتبع طلبك', cta_talk: 'تحدث مع فريقنا',
    cats_title: 'منصة واحدة لكل حدث يعتمد على المستندات', cats_sub: 'كل فئة أدناه ضمن كتالوج الإطلاق. يعتمد توفر الخدمة لمعاملة معينة على المتقدم والوجهة وقواعد الجهات والأهلية.',
    how_title: 'كيف تعمل الخدمة', how1: 'اختر الغرض', how1d: 'الدولة والوجهة وصاحب المستند والموعد — نحدد المسار الصحيح لا سلسلة عامة.', how2: 'شاهد التكلفة الحقيقية', how2d: 'تقدير أولاً ثم عرض سعر مُراجَع ببنود. رسوم الجهات والتوصيل بلا هامش.', how3: 'ننسّق ونترك لك اختيار المزوّد', how3d: 'اختر من المزوّدين المؤهلين مع سجل ظاهر. الإعلان المدفوع دائماً موسوم.', how4: 'تتبع كل تسليم', how4d: 'أحداث العهدة والمهام وموعد التحديث القادم وحزمة إنجاز تحتفظ بها.',
    trust_title: 'مبنية على المساءلة', trust1: 'جهة تيسير مستقلة', trust1d: 'تبقى القرارات الرسمية بيد الجهات المختصة. لا نوحي بانتساب حكومي أو موافقة مضمونة.', trust2: 'أسعار مفصلة ومعتمدة', trust2d: 'التعديلات تحتاج موافقتك قبل إنفاق المزيد. الاسترداد ظاهر بالسبب والتوقيت.', trust3: 'خصوصية بالتصميم', trust3d: 'روابط منتهية وسجلات وصول وموافقة لكل غرض. لا نطلب كلمات المرور أو رموز الهوية الرقمية.',
    biz_title: 'لمراكز الطباعة وفرق الموارد البشرية والوكالات والمؤسسات', biz_lead: 'مساحات عمل للمنشآت بأدوار وإدخال جماعي وجاهزية الموظفين وضوابط الشراء وفوترة موحدة وواجهة API.',
    footer_disclaimer: 'إيميراتست جهة تيسير وتنسيق مستقلة. تبقى التصديقات الرسمية وقرارات الهجرة والرخص والتأمين والقرارات المصرفية لدى الجهات المختصة أو المزوّدين المعتمدين. هذه بيئة عرض ببيانات وهمية.',
    email: 'البريد الإلكتروني', password: 'كلمة المرور', name: 'الاسم الكامل', phone: 'الهاتف (واتساب)', login_title: 'تسجيل الدخول إلى إيميراتست', register_title: 'أنشئ حسابك', demo_title: 'شخصيات العرض', demo_lead: 'دخول بنقرة لكل دور مع بيانات واقعية. جميع البيانات وهمية.',
    estimate: 'تقدير', total: 'الإجمالي', vat: 'ضريبة القيمة المضافة', service: 'الخدمة', docs: 'المستندات', pickup: 'إمارة الاستلام', expedite: 'معالجة عاجلة', calc_title: 'حاسبة الرسوم التقديرية', calc_note: 'هذا تقدير فقط. يؤكد عرض السعر المُراجَع بالبنود السعر النهائي.',
    ask_ai: 'اسأل إيميراتست', ai_hello: 'مرحباً! اسألني عن المتطلبات أو الرسوم أو المدة أو التتبع. أجيب من إرشادات معتمدة ولا أطلب كلمات المرور أو الرموز.', send: 'إرسال', type_here: 'اكتب سؤالك…',
    whatsapp: 'واتساب', open_whatsapp: 'تحدث عبر واتساب', dashboard: 'لوحة التحكم', requests: 'طلباتي', new_request: 'طلب جديد', family: 'العائلة', documents: 'المستندات', bookings: 'الحجوزات', planner: 'المخطط', settings: 'الإعدادات', notifications: 'الإشعارات', messages: 'الرسائل',
    status: 'الحالة', next_action: 'الإجراء التالي', next_update: 'موعد التحديث', owner: 'المسؤول', provider: 'المزوّد', target: 'التاريخ المستهدف', ref: 'الرقم المرجعي',
  },
};

const Ctx = createContext({ lang: 'en', t: (k) => k, setLang: () => {}, dir: 'ltr' });
export const useI18n = () => useContext(Ctx);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => { try { return localStorage.getItem('emt_lang') || (navigator.language?.startsWith('ar') ? 'ar' : 'en'); } catch { return 'en'; } });
  const setLang = (l) => { setLangState(l); try { localStorage.setItem('emt_lang', l); } catch { /* ignore */ } };
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; }, [lang]);
  const value = useMemo(() => ({ lang, setLang, dir: lang === 'ar' ? 'rtl' : 'ltr', t: (k) => D[lang][k] ?? D.en[k] ?? k, pick: (o, base) => (lang === 'ar' && o?.[`${base}_ar`]) || o?.[`${base}_en`] || o?.[base] }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
