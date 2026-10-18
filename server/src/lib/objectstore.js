import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export const s3Enabled = () => !!(config.s3.bucket && config.s3.accessKeyId);

let clientPromise = null;
async function client() {
  if (!clientPromise) {
    clientPromise = import('@aws-sdk/client-s3').then(({ S3Client }) => new S3Client({
      region: config.s3.region, endpoint: config.s3.endpoint || undefined, forcePathStyle: !!config.s3.endpoint, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
    }));
  }
  return clientPromise;
}
export const resetObjectStore = () => { clientPromise = null; };
const keyOf = (k) => `${config.s3.prefix}${k}`;

/** S3-compatible storage (MinIO, Cloudflare R2, Backblaze B2, Wasabi, AWS S3) used as an off-box copy of uploads and backups. */
export async function putObject(key, body, contentType = 'application/octet-stream') {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  await (await client()).send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: keyOf(key), Body: body, ContentType: contentType, ServerSideEncryption: config.s3.endpoint ? undefined : 'AES256' }));
}
export async function getObject(key) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const r = await (await client()).send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: keyOf(key) }));
  return Buffer.from(await r.Body.transformToByteArray());
}
export async function listObjects(prefix) {
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const r = await (await client()).send(new ListObjectsV2Command({ Bucket: config.s3.bucket, Prefix: keyOf(prefix) }));
  return (r.Contents || []).map((o) => ({ key: o.Key.slice(config.s3.prefix.length), size: o.Size, modified: o.LastModified }));
}
export async function deleteObject(key) {
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  await (await client()).send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: keyOf(key) }));
}

/** Upload documents that have no off-box copy yet. Local disk stays the primary store; this is the disaster-recovery copy. */
export async function mirrorPending(limit = 25) {
  if (!s3Enabled()) return 0;
  const { all, update } = await import('../db.js');
  const { UPLOAD_DIR } = await import('../domain/documents.js');
  const rows = all('SELECT id, storage_key, mime FROM documents WHERE storage_key IS NOT NULL AND mirrored_at IS NULL AND deleted_at IS NULL LIMIT ?', limit);
  let n = 0;
  for (const d of rows) {
    const file = path.join(UPLOAD_DIR(), d.storage_key);
    if (!fs.existsSync(file)) continue;
    await putObject(`uploads/${d.storage_key}`, fs.readFileSync(file), d.mime || undefined);
    update('documents', d.id, { mirrored_at: new Date().toISOString() });
    n++;
  }
  return n;
}

/** Fetch a missing local file back from the mirror (new instance, restored disk, ephemeral container). */
export async function restoreFromMirror(storageKey) {
  if (!s3Enabled()) return false;
  const { UPLOAD_DIR } = await import('../domain/documents.js');
  try { fs.writeFileSync(path.join(UPLOAD_DIR(), storageKey), await getObject(`uploads/${storageKey}`)); return true; } catch { return false; }
}
