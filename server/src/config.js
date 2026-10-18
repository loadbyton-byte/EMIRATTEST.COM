import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

export const config = {
  port: Number(env.PORT || 8787),
  nodeEnv: env.NODE_ENV || 'development',
  baseUrl: env.APP_BASE_URL || `http://localhost:${env.PORT || 8787}`,
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me',
  // Sample-data mode (persona launcher, mock card gateway, WhatsApp simulator). Off by default in production.
  demoMode: env.DEMO_MODE ? env.DEMO_MODE === '1' : (env.NODE_ENV || 'development') !== 'production',
  dataDir: path.resolve(env.DATA_DIR || path.join(here, '..', 'data')),
  webDist: path.resolve(here, '..', '..', 'web', 'dist'),
  requireStaffMfa: env.REQUIRE_STAFF_MFA === '1',
  tokenTtlHours: 24,
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
  // Any OpenAI-compatible endpoint works: Ollama (local, open-source models), llama.cpp server, vLLM, Groq / OpenRouter / Hugging Face free tiers.
  llm: { baseUrl: (env.LLM_BASE_URL || '').replace(/\/$/, ''), key: env.LLM_API_KEY || '', model: env.LLM_MODEL || 'llama3.2', timeoutMs: Number(env.LLM_TIMEOUT_MS || 30000) },
  ocr: { langs: (env.OCR_LANGS || 'eng+ara').split('+'), enabled: env.OCR_ENABLED !== '0' },
  clamd: { host: env.CLAMD_HOST || '', port: Number(env.CLAMD_PORT || 3310), required: env.CLAMD_REQUIRED === '1' },
  mail: { smtpUrl: env.SMTP_URL || '', host: env.SMTP_HOST || '', port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', secure: env.SMTP_SECURE === '1', resendKey: env.RESEND_API_KEY || '', from: env.MAIL_FROM || 'Emirattest <no-reply@emirattest.com>' },
  push: { subject: env.VAPID_SUBJECT || 'mailto:support@emirattest.com', publicKey: env.VAPID_PUBLIC_KEY || '', privateKey: env.VAPID_PRIVATE_KEY || '' },
  s3: { endpoint: env.S3_ENDPOINT || '', region: env.S3_REGION || 'auto', bucket: env.S3_BUCKET || '', accessKeyId: env.S3_ACCESS_KEY_ID || '', secretAccessKey: env.S3_SECRET_ACCESS_KEY || '', prefix: env.S3_PREFIX || 'emirattest/' },
  backup: { dir: path.resolve(env.BACKUP_DIR || path.join(env.DATA_DIR || path.join(here, '..', 'data'), 'backups')), keep: Number(env.BACKUP_KEEP || 14), everyHours: Number(env.BACKUP_EVERY_HOURS || 24) },
  oidc: { issuer: env.OIDC_ISSUER || '', clientId: env.OIDC_CLIENT_ID || '', clientSecret: env.OIDC_CLIENT_SECRET || '', redirectUri: env.OIDC_REDIRECT_URI || '', label: env.OIDC_LABEL || 'Single sign-on', allowSignup: env.OIDC_ALLOW_SIGNUP === '1' },
  observability: { metricsToken: env.METRICS_TOKEN || '', sentryDsn: env.SENTRY_DSN || '', logLevel: env.LOG_LEVEL || 'info' },
  admin: { email: env.ADMIN_EMAIL || '', password: env.ADMIN_PASSWORD || '', name: env.ADMIN_NAME || 'Administrator' },
  retentionDays: Number(env.RETENTION_DAYS || 730),
  // "Today" is injectable so demos and tests are deterministic.
  now: () => (env.EMT_NOW ? new Date(env.EMT_NOW) : new Date()),
};

if (config.nodeEnv === 'production' && config.sessionSecret === 'dev-only-secret-change-me') {
  console.warn('[emirattest] WARNING: SESSION_SECRET is not set; sessions are signed with an insecure default.');
}
