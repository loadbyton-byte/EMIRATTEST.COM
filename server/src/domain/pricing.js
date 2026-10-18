import { config } from '../config.js';
import { money, todayStr } from '../lib/util.js';
import { COURIER_FEE, EXPEDITE_COORDINATION_FEE, READINESS_REVIEW_FEE } from './catalog-data.js';
import { getService, getRoute } from './catalog.js';

export const PROCESSING_PER_DOC = 70;       // planning assumption: partner processing charge per document (pass-through)
export const INCLUDED_DOCS = 5;             // documents covered by one managed fee
export const EXTRA_DOC_FEE = 40;            // planning assumption per extra document (consumer)
export const QUOTE_VALID_DAYS = 7;

/**
 * Build itemised lines. party: emirattest | authority | courier | provider. kind: fee | pass_through.
 * estimated=true until a reviewed quotation exists.
 */
export function buildLines({ service, route, docCount = 1, expedited = false, pickupEmirate, deliveryEmirate, business = false, readinessCredit = false, providerFactor = 1, includeConditional = false }) {
  const svc = typeof service === 'string' ? getService(service) : service;
  const rt = typeof route === 'string' ? getRoute(route) : route;
  const lines = [];
  const feeBase = business ? svc.business_fee_aed : svc.base_fee_aed;
  if (feeBase > 0) lines.push({ code: 'service_fee', label: `${svc.name_en} — Emirattest service fee`, party: 'emirattest', kind: 'fee', amount: money(feeBase), basis: svc.pricing_basis === 'scoped' ? 'Scoped service fee (confirmed in quotation)' : 'Per supported standard case' });
  if (docCount > INCLUDED_DOCS && feeBase > 0) {
    const extra = docCount - INCLUDED_DOCS;
    lines.push({ code: 'extra_docs', label: `Additional document handling (${extra} × ${EXTRA_DOC_FEE})`, party: 'emirattest', kind: 'fee', amount: money(extra * (business ? EXTRA_DOC_FEE * 0.6 : EXTRA_DOC_FEE)), basis: `Covers up to ${INCLUDED_DOCS} documents per case` });
  }
  if (rt) {
    for (const st of rt.stages) {
      if (st.official_fee_aed <= 0) continue;
      const optional = st.necessity !== 'required';
      if (optional && !includeConditional) continue;
      if (st.necessity === 'unnecessary_if_done') continue;
      lines.push({ code: `authority_${st.id}`, label: `${st.name} (official charge × ${docCount})`, party: 'authority', kind: 'pass_through', amount: money(st.official_fee_aed * docCount), basis: 'Actual-cost reimbursement, no markup', conditional: optional || undefined, stage: st.name });
    }
    if (rt.stages.some((s) => s.owner === 'provider' && s.necessity !== 'unnecessary_if_done')) {
      lines.push({ code: 'processing', label: `Processing partner charge (${docCount} × ${money(PROCESSING_PER_DOC * providerFactor)})`, party: 'provider', kind: 'pass_through', amount: money(PROCESSING_PER_DOC * providerFactor * docCount), basis: 'External specialist/processing charge, shown separately' });
    }
  }
  if (pickupEmirate && COURIER_FEE[pickupEmirate] !== undefined) lines.push({ code: 'courier_pickup', label: `Pickup — ${pickupEmirate}`, party: 'courier', kind: 'pass_through', amount: COURIER_FEE[pickupEmirate], basis: 'Courier charge for your location' });
  if (deliveryEmirate && COURIER_FEE[deliveryEmirate] !== undefined) lines.push({ code: 'courier_return', label: `Return delivery — ${deliveryEmirate}`, party: 'courier', kind: 'pass_through', amount: COURIER_FEE[deliveryEmirate], basis: 'Courier charge for your location' });
  if (expedited) lines.push({ code: 'expedite', label: 'Expedited handling — coordination & transport effort', party: 'emirattest', kind: 'fee', amount: EXPEDITE_COORDINATION_FEE, basis: 'Prices extra coordination effort; it does not guarantee an authority decision' });
  if (readinessCredit) lines.push({ code: 'readiness_credit', label: 'Credit: detailed readiness review already paid', party: 'emirattest', kind: 'fee', amount: -READINESS_REVIEW_FEE, basis: 'Credited toward the managed fee; not counted again as revenue' });
  return lines;
}

export function totals(lines) {
  const fee = money(lines.filter((l) => l.kind === 'fee').reduce((a, l) => a + l.amount, 0));
  const passThrough = money(lines.filter((l) => l.kind === 'pass_through' && !l.conditional).reduce((a, l) => a + l.amount, 0));
  const conditional = money(lines.filter((l) => l.conditional).reduce((a, l) => a + l.amount, 0));
  const vat = money(Math.max(fee, 0) * config.vatRate);
  return { subtotal_fee: fee, pass_through_total: passThrough, conditional_total: conditional, vat, total: money(fee + vat + passThrough) };
}

export const STANDARD_ASSUMPTIONS = [
  'Emirattest service fees are business-planning assumptions in AED; the reviewed quotation is the final price.',
  `VAT at ${config.vatRate * 100}% is applied to Emirattest service fees; principal-versus-agent tax treatment is confirmed by the responsible qualified adviser.`,
  'Authority, embassy, courier and partner charges are actual costs shown separately; sample registry values are re-verified before quotation.',
  'Timing figures are authority estimates, not Emirattest commitments or guarantees.',
];
export const STANDARD_EXCLUSIONS = [
  'Charges arising from rejected or incorrect source documents',
  'Additional documents or changes after acceptance (create a variation requiring your approval)',
  'Official decisions: approval of every applicant or country route is not implied',
];

export function estimate(input) {
  const service = getService(input.serviceSlug);
  if (!service) return null;
  const route = input.routeSlug ? getRoute(input.routeSlug) : (service.default_route_slug ? getRoute(input.apostille && service.default_route_slug === 'edu-degree-uae-to-abroad' ? 'edu-degree-uae-to-abroad-apostille' : service.default_route_slug) : null);
  const lines = buildLines({ ...input, service, route, includeConditional: false });
  const t = totals(lines);
  const withConditional = totals(buildLines({ ...input, service, route, includeConditional: true }));
  const days = route ? route.stages.filter((s) => s.necessity !== 'unnecessary_if_done' && s.necessity !== 'conditional').reduce((a, s) => ({ min: a.min + s.min_days, max: a.max + s.max_days }), { min: 0, max: 0 }) : null;
  return {
    label: 'ESTIMATE', service: { slug: service.slug, name_en: service.name_en, name_ar: service.name_ar, pricing_basis: service.pricing_basis },
    route: route && { slug: route.slug, title_en: route.title_en, title_ar: route.title_ar, version: route.version, reviewed_on: route.reviewed_on, reviewer: route.reviewer, stale: route.freshness.stale, source_urls: route.source_urls, apostille_applicable: route.apostille_applicable },
    lines, ...t, max_total_with_conditional: withConditional.total, authority_estimate_days: days,
    assumptions: STANDARD_ASSUMPTIONS, exclusions: STANDARD_EXCLUSIONS, generated_on: todayStr(), currency: 'AED',
  };
}
