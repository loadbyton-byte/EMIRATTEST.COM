import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

export const config = {
  port: Number(env.PORT || 8787),
  nodeEnv: env.NODE_ENV || 'development',
  baseUrl: env.APP_BASE_URL || `http://localhost:${env.PORT || 8787}`,
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me',
  demoMode: env.DEMO_MODE !== '0',
  dataDir: path.resolve(env.DATA_DIR || path.join(here, '..', 'data')),
  webDist: path.resolve(here, '..', '..', 'web', 'dist'),
  requireStaffMfa: env.REQUIRE_STAFF_MFA === '1',
  vatRate: 0.05,
  stripe: { key: env.STRIPE_SECRET_KEY || '', webhookSecret: env.STRIPE_WEBHOOK_SECRET || '' },
  whatsapp: {
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || 'emirattest-verify',
    accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    twilioSid: env.TWILIO_ACCOUNT_SID || '',
    twilioToken: env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
  },
  ai: { key: env.ANTHROPIC_API_KEY || '', model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5' },
  mail: { resendKey: env.RESEND_API_KEY || '', from: env.MAIL_FROM || 'Emirattest <no-reply@emirattest.com>' },
  // "Today" is injectable so demos and tests are deterministic.
  now: () => (env.EMT_NOW ? new Date(env.EMT_NOW) : new Date()),
};

if (config.nodeEnv === 'production' && config.sessionSecret === 'dev-only-secret-change-me') {
  console.warn('[emirattest] WARNING: SESSION_SECRET is not set; sessions are signed with an insecure default.');
}
