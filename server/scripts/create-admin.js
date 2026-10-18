// Usage: node server/scripts/create-admin.js admin@example.org   (prompts via ADMIN_PASSWORD env var)
import { openDb, get, insert, update } from '../src/db.js';
import { hashPassword, passwordProblem, totpSecret } from '../src/lib/auth.js';

const email = (process.argv[2] || process.env.ADMIN_EMAIL || '').toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
if (!email || !password) { console.error('Usage: ADMIN_PASSWORD=... node server/scripts/create-admin.js <email>'); process.exit(1); }
const problem = passwordProblem(password);
if (problem) { console.error(`Password rejected: ${problem}`); process.exit(1); }
openDb();
const secret = totpSecret();
const existing = get('SELECT id FROM users WHERE email = ?', email);
const fields = { password_hash: hashPassword(password), role: 'admin', status: 'active', mfa_secret: secret, mfa_enabled: 1 };
if (existing) update('users', existing.id, fields); else insert('users', { email, name: process.env.ADMIN_NAME || 'Administrator', ...fields });
console.log(`Administrator ${email} ready.`);
console.log(`Authenticator setup (TOTP): otpauth://totp/Emirattest:${encodeURIComponent(email)}?secret=${secret}&issuer=Emirattest`);
