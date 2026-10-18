import PDFDocument from 'pdfkit';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';

const GREEN = '#007A45';
const INK = '#151B18';
const MUTED = '#58645E';
const aed = (n) => `AED ${Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function collect(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function header(doc, title, ref) {
  const logo = path.join(config.webDist, 'brand', 'primary-full-color.png');
  if (fs.existsSync(logo)) doc.image(logo, 50, 40, { width: 220 });
  else doc.fillColor(GREEN).fontSize(22).text('Emirattest', 50, 48);
  doc.fillColor(INK).fontSize(18).text(title, 50, 110);
  doc.fillColor(MUTED).fontSize(10).text(ref, 50, 134);
  doc.moveTo(50, 154).lineTo(545, 154).strokeColor(GREEN).lineWidth(1.5).stroke();
  doc.y = 170;
}

function table(doc, lines) {
  const x = 50;
  doc.fillColor(MUTED).fontSize(9).text('Item', x, doc.y).text('Paid to', 330, doc.y - 11).text('Amount', 470, doc.y - 11, { width: 75, align: 'right' });
  doc.moveDown(0.4);
  for (const l of lines) {
    const y = doc.y;
    doc.fillColor(INK).fontSize(10).text(l.label, x, y, { width: 270 });
    const h = doc.y;
    doc.fillColor(MUTED).text(l.party || '', 330, y, { width: 130 });
    doc.fillColor(INK).text(aed(l.amount), 470, y, { width: 75, align: 'right' });
    doc.y = Math.max(h, doc.y) + 4;
  }
}

function footer(doc, note) {
  doc.moveDown(2);
  doc.fillColor(MUTED).fontSize(8.5).text(note, 50, doc.y, { width: 495 });
}

/** Quotation PDF: itemised, separating Emirattest fees from authority / partner pass-through charges, with VAT and exclusions. */
export function quotationPdf({ quote, c, customer }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Quotation ${c.ref} v${quote.version}`, Author: 'Emirattest' } });
  header(doc, quote.kind === 'variation' ? 'Variation quotation' : 'Quotation', `${c.ref} · version ${quote.version} · issued ${String(quote.created_at).slice(0, 10)}`);
  doc.fillColor(INK).fontSize(11).text(`Prepared for: ${customer?.name || ''}`).text(`Service: ${c.title}`);
  if (quote.valid_until) doc.text(`Valid until: ${quote.valid_until}`);
  doc.moveDown();
  table(doc, quote.lines);
  doc.moveDown(0.5);
  const right = (label, v, bold) => { const y = doc.y; doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).text(label, 330, y, { width: 135 }).text(aed(v), 470, y, { width: 75, align: 'right' }); doc.font('Helvetica'); };
  right('Emirattest fees', quote.subtotal_fee);
  right(`VAT (${Math.round(config.vatRate * 100)}% on fees)`, quote.vat);
  right('Official & partner charges', quote.pass_through_total);
  right('Total', quote.total, true);
  if (quote.exclusions?.length) { doc.moveDown().fillColor(INK).fontSize(10).text('Not included'); quote.exclusions.forEach((e) => doc.fillColor(MUTED).fontSize(9).text(`• ${e}`)); }
  if (quote.assumptions?.length) { doc.moveDown(0.5).fillColor(INK).fontSize(10).text('Assumptions'); quote.assumptions.forEach((e) => doc.fillColor(MUTED).fontSize(9).text(`• ${e}`)); }
  footer(doc, 'Authority charges are passed through at cost. Timelines are estimates published by authorities or partners and are not guaranteed. Emirattest does not alter official records and cannot guarantee an authority decision.');
  return collect(doc);
}

/** Payment receipt PDF. */
export function receiptPdf({ payment, c, customer }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Receipt ${payment.receipt_no || payment.id}`, Author: 'Emirattest' } });
  header(doc, 'Payment receipt', `Receipt ${payment.receipt_no || `P-${payment.id}`} · ${String(payment.verified_at || payment.created_at).slice(0, 10)}`);
  doc.fillColor(INK).fontSize(11)
    .text(`Received from: ${customer?.name || ''}`)
    .text(`Case: ${c?.ref || '—'} ${c?.title ? `— ${c.title}` : ''}`)
    .text(`Method: ${payment.method}`)
    .text(`Status: ${payment.status}`)
    .moveDown().fontSize(16).fillColor(GREEN).text(aed(payment.amount));
  footer(doc, 'Funds held for authority or partner charges are tracked separately from Emirattest service fees until the related stage is evidenced.');
  return collect(doc);
}

/** One-page case summary for hand-off to a customer, employer or authority-facing partner. */
export function caseSummaryPdf({ c, events, documents }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Case ${c.ref}`, Author: 'Emirattest' } });
  header(doc, 'Case summary', `${c.ref} · status ${c.status.replace(/_/g, ' ')}`);
  doc.fillColor(INK).fontSize(11).text(c.title).moveDown(0.5);
  if (c.next_action) doc.fillColor(MUTED).fontSize(10).text(`Next action (${c.next_action_owner || 'team'}): ${c.next_action}`).moveDown();
  doc.fillColor(INK).fontSize(12).text('Documents');
  for (const d of documents) doc.fillColor(MUTED).fontSize(9.5).text(`• ${d.kind}: ${d.filename} — sha256 ${String(d.sha256 || '').slice(0, 12)}…, scan ${d.scan_status}`);
  doc.moveDown().fillColor(INK).fontSize(12).text('Timeline');
  for (const e of events.slice(-25)) doc.fillColor(MUTED).fontSize(9.5).text(`${String(e.ts).slice(0, 16)}  ${e.type.replace(/_/g, ' ')}`);
  footer(doc, 'This summary reflects evidence recorded in Emirattest. It is not an official record and does not confirm authenticity of any document.');
  return collect(doc);
}
