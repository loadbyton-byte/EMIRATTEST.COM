import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { SCHEMA, COLUMNS } from './schema.js';

let handle = null;

export function openDb(file) {
  if (handle) return handle;
  const target = file ?? path.join(config.dataDir, 'emirattest.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  handle = new DatabaseSync(target);
  handle.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  handle.exec(SCHEMA);
  for (const [table, column, def] of COLUMNS) {
    const has = handle.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
  handle.exec("UPDATE payments SET booking_id = CAST(substr(proof_note, 9) AS INTEGER) WHERE kind = 'booking' AND booking_id IS NULL AND proof_note GLOB 'booking:[0-9]*' AND EXISTS (SELECT 1 FROM bookings WHERE id = CAST(substr(payments.proof_note, 9) AS INTEGER))");
  return handle;
}

export function closeDb() {
  if (handle) handle.close();
  handle = null;
}

const db = () => openDb();

/** Run a SELECT and return all rows as plain objects. */
export const all = (sql, ...params) => db().prepare(sql).all(...params).map((r) => ({ ...r }));
export const get = (sql, ...params) => {
  const r = db().prepare(sql).get(...params);
  return r ? { ...r } : undefined;
};
export const run = (sql, ...params) => db().prepare(sql).run(...params);
export const insert = (table, row) => {
  const keys = Object.keys(row);
  const info = run(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    ...keys.map((k) => normalize(row[k])),
  );
  return Number(info.lastInsertRowid);
};
export const update = (table, id, patch, idCol = 'id') => {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${idCol} = ?`, ...keys.map((k) => normalize(patch[k])), id);
};
const normalize = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'object' && v !== null ? JSON.stringify(v) : v);

let depth = 0;
/** Re-entrant transaction: the outermost call BEGINs/COMMITs, nested calls use SAVEPOINTs. */
export function tx(fn) {
  const d = db();
  const name = `sp${depth}`;
  d.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
  depth++;
  try {
    const out = fn();
    depth--;
    d.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return out;
  } catch (e) {
    depth--;
    d.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw e;
  }
}

export const json = (s, fallback = null) => {
  if (s === null || s === undefined || s === '') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

export const getSetting = (key, fallback = null) => {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? json(r.value, r.value) : fallback;
};
export const setSetting = (key, value) =>
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
