import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from '../config.js';
import { openDb, run } from '../db.js';
import { s3Enabled, putObject } from './objectstore.js';

export const backupDir = () => { fs.mkdirSync(config.backup.dir, { recursive: true }); return config.backup.dir; };

/** Consistent online snapshot using SQLite VACUUM INTO (safe while the app is serving traffic), gzip-compressed. */
export async function createBackup() {
  openDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const raw = path.join(backupDir(), `emirattest-${stamp}.db`);
  run(`VACUUM INTO '${raw.replace(/'/g, "''")}'`);
  const gz = `${raw}.gz`;
  fs.writeFileSync(gz, zlib.gzipSync(fs.readFileSync(raw)));
  fs.rmSync(raw);
  let remote = false;
  if (s3Enabled()) { await putObject(`backups/${path.basename(gz)}`, fs.readFileSync(gz), 'application/gzip'); remote = true; }
  pruneBackups();
  return { file: path.basename(gz), size: fs.statSync(gz).size, remote };
}

export function listBackups() {
  const dir = backupDir();
  return fs.readdirSync(dir).filter((f) => f.endsWith('.db.gz')).sort().reverse().map((f) => ({ file: f, size: fs.statSync(path.join(dir, f)).size, created_at: fs.statSync(path.join(dir, f)).mtime.toISOString() }));
}

export function pruneBackups(keep = config.backup.keep) {
  for (const b of listBackups().slice(keep)) fs.rmSync(path.join(backupDir(), b.file));
}

/** Restore helper used by `npm run restore -- <file>` (server must be stopped). */
export function restoreBackupFile(file, target = path.join(config.dataDir, 'emirattest.db')) {
  const src = path.isAbsolute(file) ? file : path.join(backupDir(), file);
  fs.writeFileSync(target, zlib.gunzipSync(fs.readFileSync(src)));
  for (const ext of ['-wal', '-shm']) fs.rmSync(target + ext, { force: true });
  return target;
}
