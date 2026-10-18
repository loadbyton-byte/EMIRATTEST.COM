import { config } from './config.js';
import { get, insert, all } from './db.js';
import { hashPassword, passwordProblem } from './lib/auth.js';
import { seedCatalog } from './domain/catalog.js';

/**
 * First-boot setup for a real deployment: loads the service catalogue, routes, requirements registry and approved
 * knowledge, then creates the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD. No sample people, cases or money.
 */
export function bootstrapProduction({ log = console.log } = {}) {
  if (!get('SELECT COUNT(*) AS n FROM services').n) {
    seedCatalog();
    log('[bootstrap] catalogue, routes, requirements and knowledge loaded');
  }
  const admins = all("SELECT id FROM users WHERE role = 'admin'");
  if (admins.length) return { created: false };
  const { email, password, name } = config.admin;
  if (!email || !password) {
    log('[bootstrap] No administrator exists. Set ADMIN_EMAIL and ADMIN_PASSWORD (or run `npm run create-admin`) to create one.');
    return { created: false, missing: true };
  }
  const problem = passwordProblem?.(password);
  if (problem) throw new Error(`ADMIN_PASSWORD rejected: ${problem}`);
  insert('users', { email: email.toLowerCase(), name, password_hash: hashPassword(password), role: 'admin' });
  log(`[bootstrap] administrator ${email} created — MFA is required at first sign-in`);
  return { created: true };
}
