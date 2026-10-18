import net from 'node:net';
import { config } from '../config.js';
import { HttpError } from './util.js';

export const clamEnabled = () => !!config.clamd.host;

/** Scan a buffer with a ClamAV daemon over the INSTREAM protocol (free, open source). Resolves { clean, signature }. */
export function clamScan(buf, { host = config.clamd.host, port = config.clamd.port, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let out = '';
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.setTimeout(timeoutMs, () => fail(new Error('clamd timeout')));
    sock.on('error', fail);
    sock.on('data', (d) => { out += d.toString(); });
    sock.on('end', () => {
      const line = out.replace(/\0/g, '').trim();
      if (/OK$/.test(line)) return resolve({ clean: true });
      const m = line.match(/stream: (.+) FOUND$/);
      if (m) return resolve({ clean: false, signature: m[1] });
      reject(new Error(`clamd: ${line || 'empty response'}`));
    });
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      for (let i = 0; i < buf.length; i += 65536) {
        const chunk = buf.subarray(i, i + 65536);
        const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
        sock.write(len); sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
  });
}

/**
 * Antivirus gate called before a file is stored. With CLAMD_HOST unset it is a no-op (built-in signature checks still run).
 * With CLAMD_REQUIRED=1 an unreachable scanner rejects the upload instead of letting it through unscanned.
 */
export async function antivirusGate(buf) {
  if (!clamEnabled()) return { engine: 'builtin' };
  try {
    const r = await clamScan(buf);
    if (!r.clean) throw new HttpError(422, `Upload blocked: malware detected (${r.signature})`);
    return { engine: 'clamav' };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (config.clamd.required) throw new HttpError(503, 'Virus scanner unavailable. Please retry shortly.');
    return { engine: 'builtin', degraded: true };
  }
}
