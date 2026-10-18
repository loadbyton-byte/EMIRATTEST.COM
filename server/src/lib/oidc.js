import crypto from 'node:crypto';
import { config } from '../config.js';
import { hmac, safeEqual, randomToken, HttpError } from './util.js';

export const oidcEnabled = () => !!(config.oidc.issuer && config.oidc.clientId);

let discovery = null;
let jwks = null;
export const resetOidc = () => { discovery = null; jwks = null; };

async function meta() {
  if (!discovery) {
    const r = await fetch(`${config.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new HttpError(502, 'Single sign-on provider is unreachable');
    discovery = await r.json();
  }
  return discovery;
}

const b64 = (b) => Buffer.from(b).toString('base64url');
/** Signed, short-lived state cookie value: carries state, nonce and the PKCE verifier. */
export const sealState = (payload) => { const body = b64(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60000 })); return `${body}.${hmac(body)}`; };
export function openState(value) {
  const [body, sig] = String(value || '').split('.');
  if (!body || !sig || !safeEqual(sig, hmac(body))) throw new HttpError(400, 'Sign-in session is invalid. Start again.');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (p.exp < Date.now()) throw new HttpError(400, 'Sign-in session expired. Start again.');
  return p;
}

/** Authorization-code flow with PKCE (works with Keycloak, Authentik, Authelia, Google, Microsoft Entra, Auth0…). */
export async function startLogin() {
  const m = await meta();
  const state = randomToken(16); const nonce = randomToken(16);
  const verifier = randomToken(32);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const url = new URL(m.authorization_endpoint);
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.oidc.clientId, redirect_uri: config.oidc.redirectUri, scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  return { url: url.toString(), cookie: sealState({ state, nonce, verifier }) };
}

export async function finishLogin({ code, state, cookie }) {
  const saved = openState(cookie);
  if (!state || state !== saved.state) throw new HttpError(400, 'Sign-in state mismatch');
  const m = await meta();
  const tr = await fetch(m.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.oidc.redirectUri, client_id: config.oidc.clientId, client_secret: config.oidc.clientSecret, code_verifier: saved.verifier }),
    signal: AbortSignal.timeout(10000),
  });
  const tok = await tr.json().catch(() => ({}));
  if (!tr.ok || !tok.id_token) throw new HttpError(401, 'Single sign-on was rejected by the provider');
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  jwks ||= createRemoteJWKSet(new URL(m.jwks_uri));
  const { payload } = await jwtVerify(tok.id_token, jwks, { issuer: m.issuer, audience: config.oidc.clientId });
  if (payload.nonce !== saved.nonce) throw new HttpError(401, 'Sign-in nonce mismatch');
  return { subject: payload.sub, email: payload.email ? String(payload.email).toLowerCase() : null, emailVerified: payload.email_verified === true, name: payload.name || payload.preferred_username || null };
}
