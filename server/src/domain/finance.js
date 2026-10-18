import { all, get, getSetting, json } from '../db.js';
import { money, todayStr, daysBetween, addDays } from '../lib/util.js';

// Plan v2.0 representative month (illustrative planning assumptions).
export const MODEL_CATEGORIES = [
  { key: 'consumer', label: 'Consumer attestation and related cases', qty: 100, fee: 200, varCost: 115 },
  { key: 'business', label: 'Business document cases', qty: 150, fee: 120, varCost: 75 },
  { key: 'pro', label: 'PRO and company support cases', qty: 50, fee: 350, varCost: 200 },
  { key: 'mobility', label: 'Immigration referral and relocation cases', qty: 20, fee: 600, varCost: 350 },
  { key: 'travel', label: 'Travel and lifestyle bookings', qty: 80, fee: 100, varCost: 55 },
  { key: 'subs', label: 'Business subscriptions', qty: 20, fee: 299, varCost: 60 },
];
export const FIXED_OVERHEAD = [
  ['Management administration and fixed support', 15000], ['Technology security and business systems', 4000], ['Marketing and business account acquisition', 5000],
  ['Workspace communications and administration', 3000], ['Professional quality and insurance allowance', 3000],
];
export const FUNDING_ENVELOPE = [
  ['Setup, contracts, product completion, security and launch readiness', 80000], ['Six months of fixed-overhead liquidity', 180000], ['Supplier timing exposure', 40000], ['Contingency', 30000],
];

export function financialModel({ multiplier = 1, fixedOverhead } = {}) {
  const mult = Number(multiplier);
  const rows = MODEL_CATEGORIES.map((c) => {
    const qty = c.qty * mult;
    return { ...c, qty, revenue: money(qty * c.fee), variable: money(qty * c.varCost), contribution: money(qty * (c.fee - c.varCost)) };
  });
  const revenue = money(rows.reduce((a, r) => a + r.revenue, 0));
  const variable = money(rows.reduce((a, r) => a + r.variable, 0));
  const contribution = money(revenue - variable);
  const baseFixed = FIXED_OVERHEAD.reduce((a, f) => a + f[1], 0);
  const fixed = fixedOverhead ?? (mult > 1.2 ? 38000 : baseFixed);
  const refContribution = MODEL_CATEGORIES.reduce((a, c) => a + c.qty * (c.fee - c.varCost), 0);
  const refRevenue = MODEL_CATEGORIES.reduce((a, c) => a + c.qty * c.fee, 0);
  const margin = refContribution / refRevenue;
  return {
    currency: 'AED', note: 'Illustrative planning assumptions from Business Plan v2.0 — not quotations, licensing costs or established sales.',
    multiplier: mult, rows, net_retained_revenue: revenue, variable_cost: variable, contribution, fixed_overhead: fixed, operating_result: money(contribution - fixed),
    breakeven_revenue: money(fixed / margin), breakeven_pct_of_reference_contribution: Math.round((fixed / refContribution) * 1000) / 10,
    fixed_breakdown: FIXED_OVERHEAD.map(([label, amount]) => ({ label, amount })), funding: FUNDING_ENVELOPE.map(([label, amount]) => ({ label, amount })), funding_total: FUNDING_ENVELOPE.reduce((a, f) => a + f[1], 0),
    scenarios: [0.6, 1, 1.4].map((m) => { const r = MODEL_CATEGORIES.reduce((a, c) => a + c.qty * m * c.fee, 0); const v = MODEL_CATEGORIES.reduce((a, c) => a + c.qty * m * c.varCost, 0); const f = m > 1.2 ? 38000 : baseFixed; return { name: m === 0.6 ? 'Lower utilisation' : m === 1 ? 'Reference mix' : 'Higher utilisation', multiplier: m, revenue: Math.round(r), variable: Math.round(v), contribution: Math.round(r - v), fixed: f, result: Math.round(r - v - f) }; }),
  };
}

const sum = (rows, k = 'amount') => money(rows.reduce((a, r) => a + r[k], 0));

/** Live metrics from the platform ledger. Completed revenue is reported separately from deposits and quotations. */
export function liveFinance() {
  const ledger = all('SELECT * FROM ledger_entries');
  const by = (acc, state) => sum(ledger.filter((l) => l.account === acc && (!state || l.state === state)));
  const recognised = by('service_fee_revenue');
  const deferred = sum(ledger.filter((l) => l.account === 'deferred_service_fee' && l.state === 'deferred'));
  const authorityOpen = sum(ledger.filter((l) => l.account === 'authority_payable' && l.state === 'open'));
  const supplierOpen = sum(ledger.filter((l) => l.account === 'supplier_payable' && l.state === 'open'));
  const vat = by('vat_payable');
  const refunds = Math.abs(by('refund'));
  const cash = sum(ledger.filter((l) => l.account === 'cash')) - 0;
  const outstandingQuotes = get("SELECT COALESCE(SUM(total),0) AS s, COUNT(*) AS n FROM quotes WHERE status = 'awaiting_approval'");
  const byCategory = all(`SELECT category, SUM(amount) AS revenue, COUNT(DISTINCT case_id) AS cases FROM ledger_entries WHERE account = 'service_fee_revenue' GROUP BY category`);
  const subs = all("SELECT * FROM subscriptions WHERE status = 'active'");
  const top = all(`SELECT COALESCE(o.name, u.name) AS customer, SUM(p.amount) AS collected FROM payments p LEFT JOIN orgs o ON o.id = p.org_id JOIN users u ON u.id = p.user_id WHERE p.status = 'verified' GROUP BY COALESCE(o.name, u.name) ORDER BY collected DESC LIMIT 5`);
  const totalCollected = top.reduce((a, r) => a + r.collected, 0);
  const providerBalances = all(`SELECT p.id, p.name, COALESCE(SUM(CASE WHEN s.status IN ('accrued','invoiced') THEN s.amount ELSE 0 END),0) AS payable FROM providers p LEFT JOIN provider_settlements s ON s.provider_id = p.id GROUP BY p.id ORDER BY payable DESC`);
  const refundLiab = get("SELECT COALESCE(SUM(amount),0) AS s FROM refunds WHERE status IN ('requested','approved_1')").s;
  const monthly = all(`SELECT substr(ts,1,7) AS month, SUM(amount) AS revenue FROM ledger_entries WHERE account = 'service_fee_revenue' GROUP BY substr(ts,1,7) ORDER BY month`);
  return {
    completed_revenue: recognised, deposits_deferred: deferred, outstanding_quotations: { count: outstandingQuotes.n, value: money(outstandingQuotes.s) },
    pass_through: { authority_payable: authorityOpen, supplier_payable: supplierOpen }, vat_payable: vat, refunds_paid: refunds, refund_liability: money(refundLiab),
    cash_collected: cash, net_service_revenue_by_category: byCategory.map((r) => ({ ...r, revenue: money(r.revenue) })),
    subscription_mrr: sum(subs, 'price_aed'), subscriptions: subs.length, provider_balances: providerBalances,
    customer_concentration: top.map((r) => ({ ...r, share_pct: totalCollected ? Math.round((r.collected / totalCollected) * 100) : 0 })), monthly_revenue: monthly.map((m) => ({ ...m, revenue: money(m.revenue) })),
    note: 'Large customer payments are not automatically Emirattest revenue: pass-through, VAT and deposits are separated from recognised fees.',
  };
}

export function collectionAging() {
  const today = todayStr();
  const rows = all("SELECT i.*, o.name AS org_name FROM invoices i LEFT JOIN orgs o ON o.id = i.org_id WHERE i.status IN ('issued','overdue')");
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d60_plus: 0 };
  for (const r of rows) {
    const late = daysBetween(r.due_date, today);
    if (late <= 0) buckets.current += r.total; else if (late <= 30) buckets.d1_30 += r.total; else if (late <= 60) buckets.d31_60 += r.total; else buckets.d60_plus += r.total;
  }
  const awaitingPay = all("SELECT p.id, p.amount, p.created_at, c.ref FROM payments p JOIN cases c ON c.id = p.case_id WHERE p.status = 'pending'");
  return { invoices: rows.map((r) => ({ ...r, days_overdue: Math.max(0, daysBetween(r.due_date, today)) })), buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, money(v)])), pending_payments: awaitingPay };
}

/** 13-week cash forecast from accepted-unpaid quotes, subscriptions, fixed overhead, supplier and authority obligations, and pending refunds. */
export function cashForecast({ newOrdersPerWeek = 90, avgNetFee = 160 } = {}) {
  const start = todayStr();
  const live = liveFinance();
  const fixedWeekly = FIXED_OVERHEAD.reduce((a, f) => a + f[1], 0) / 4.33;
  const subsWeekly = (MODEL_CATEGORIES[5].qty * MODEL_CATEGORIES[5].fee) / 4.33;
  const pendingPay = get("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'pending'").s;
  const supplierDue = live.pass_through.supplier_payable; const authDue = live.pass_through.authority_payable;
  const refundDue = live.refund_liability;
  let balance = Math.max(0, getSetting('opening_cash', 330000));
  const weeks = [];
  for (let w = 0; w < 13; w++) {
    const inflowOrders = newOrdersPerWeek * avgNetFee * (w < 2 ? 0.6 + w * 0.2 : 1);
    const inflows = inflowOrders + subsWeekly + (w === 0 ? pendingPay : 0);
    const outflows = fixedWeekly + inflowOrders * 0.55 + (w < 4 ? supplierDue / 4 : 0) + (w < 3 ? authDue / 3 : 0) + (w === 1 ? refundDue : 0);
    balance += inflows - outflows;
    weeks.push({ week: w + 1, starts: addDays(start, w * 7), inflows: money(inflows), outflows: money(outflows), net: money(inflows - outflows), closing_balance: money(balance) });
  }
  return { currency: 'AED', assumptions: { newOrdersPerWeek, avgNetFee, variable_cost_ratio: 0.55, opening_cash: getSetting('opening_cash', 330000), note: 'Opening cash is the plan funding envelope (illustrative). Money committed to authorities and customer refunds is excluded from free cash.' }, weeks, min_balance: Math.min(...weeks.map((x) => x.closing_balance)) };
}
export const _f = { json };
