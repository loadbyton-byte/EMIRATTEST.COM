import { config } from '../config.js';

// UAE working week: Mon–Fri, 09:00–18:00 Gulf Standard Time (UTC+4).
const GST = 4 * 3600000;
const OPEN = 9; const CLOSE = 18;
const toGst = (d) => new Date(d.getTime() + GST);
const fromGst = (d) => new Date(d.getTime() - GST);

export function addBusinessHours(from, hours) {
  let t = toGst(new Date(from));
  let left = hours;
  const normalise = () => {
    while (t.getUTCDay() === 0 || t.getUTCDay() === 6) { t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(OPEN, 0, 0, 0); }
    if (t.getUTCHours() < OPEN) t.setUTCHours(OPEN, 0, 0, 0);
    if (t.getUTCHours() >= CLOSE) { t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(OPEN, 0, 0, 0); normalise(); }
  };
  normalise();
  while (left > 0) {
    const endOfDay = new Date(t); endOfDay.setUTCHours(CLOSE, 0, 0, 0);
    const avail = (endOfDay - t) / 3600000;
    if (left <= avail) { t = new Date(t.getTime() + left * 3600000); left = 0; }
    else { left -= avail; t = endOfDay; normalise(); }
  }
  return fromGst(t);
}
export const sqlTs = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
export const nowDate = () => config.now();
export function businessHoursBetween(a, b) {
  let t = new Date(a); const end = new Date(b); if (end <= t) return 0; let hrs = 0;
  while (t < end) {
    const g = toGst(t); const day = g.getUTCDay(); const h = g.getUTCHours() + g.getUTCMinutes() / 60;
    if (day !== 0 && day !== 6 && h >= OPEN && h < CLOSE) hrs += Math.min(0.25, (end - t) / 3600000);
    t = new Date(t.getTime() + 15 * 60000);
  }
  return Math.round(hrs * 4) / 4;
}
