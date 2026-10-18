import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';

const require = createRequire(import.meta.url);
let workerPromise = null;

const langDir = (l) => path.join(path.dirname(require.resolve(`@tesseract.js-data/${l}/package.json`)), '4.0.0_best_int');

/** Tesseract reads every language from one directory, so link the bundled per-language files into a single folder. */
function tessdataDir(langs) {
  const dir = path.join(config.dataDir, 'tessdata');
  fs.mkdirSync(dir, { recursive: true });
  for (const l of langs) {
    const dest = path.join(dir, `${l}.traineddata.gz`);
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(langDir(l), `${l}.traineddata.gz`), dest);
  }
  return dir;
}

/** Lazily start one Tesseract worker with bundled language data (no network access needed). */
async function worker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const langs = config.ocr.langs.filter((l) => { try { langDir(l); return true; } catch { return false; } });
      if (!langs.length) throw new Error('No OCR language data installed');
      return createWorker(langs.join('+'), 1, { langPath: tessdataDir(langs), gzip: true, cacheMethod: 'none' });
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

export async function terminateOcr() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  if (w) await w.terminate();
}

/** Extract text from a PNG/JPEG (OCR) or a PDF with a text layer. Returns '' if nothing readable. */
export async function readText(buffer, mime) {
  if (!config.ocr.enabled) return '';
  try {
    if (mime === 'application/pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const out = await parser.getText();
      await parser.destroy?.();
      return (out.text || '').trim();
    }
    if (mime === 'image/png' || mime === 'image/jpeg') {
      const w = await worker();
      const r = await w.recognize(buffer);
      return (r.data.text || '').trim();
    }
  } catch {
    return '';
  }
  return '';
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function normaliseDate(raw) {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]); // UAE/most issuing countries write day first
  m = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}
const iso = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

/** Heuristic field parser for certificates, passports and licences (English labels; Arabic labels for key fields). */
export function parseFields(text) {
  const t = text.replace(/\r/g, '');
  const line = (re) => { const m = t.match(re); return m ? m[1].trim() : null; };
  const dateCapture = '([0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{1,4}|[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4})';
  const holder = line(/(?:^|\n)\s*(?:full\s+)?(?:name(?: of (?:holder|student|candidate|bearer))?|holder|student|candidate|bearer|surname and given names|الاسم|اسم)\s*[:：\-]\s*([^\n]{3,80})/i);
  const docNo = line(/(?:certificate|document|passport|licen[cs]e|licence|registration|reference|serial|card|id)?\s*(?:no\.?|number|#|رقم)\s*[:：\-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,24})/i);
  const issue = line(new RegExp(`(?:date of issue|issued(?: on)?|issue date|تاريخ الإصدار)\\s*[:：\\-]?\\s*${dateCapture}`, 'i'));
  const expiry = line(new RegExp(`(?:date of expiry|expiry(?: date)?|expires(?: on)?|valid (?:until|till|to)|تاريخ الانتهاء)\\s*[:：\\-]?\\s*${dateCapture}`, 'i'));
  const authority = (t.split('\n').map((l) => l.trim()).find((l) => /(university|ministry|authority|department|court|chamber|college|institute|municipality|embassy|council|وزارة|جامعة|هيئة)/i.test(l) && l.length < 90)) || null;
  const pages = line(/page\s*\d+\s*(?:of|\/)\s*(\d+)/i);
  const fields = { holder_name: holder, doc_number: docNo, issue_date: normaliseDate(issue), expiry_date: normaliseDate(expiry), issuing_authority: authority, pages: pages ? Number(pages) : null };
  const found = Object.values(fields).filter((v) => v !== null && v !== undefined).length;
  return { fields, confidence: Math.round((found / 6) * 100) / 100 };
}
