import { config } from '../config.js';
import { mailMode } from './mailer.js';
import { llmEnabled } from './llm.js';

/** Which optional integrations are live (no secrets). */
export function integrationStatus(whatsappMode) {
  return {
    payments: config.stripe.key ? 'stripe' : 'bank_transfer_only',
    whatsapp: whatsappMode,
    llm: llmEnabled() ? config.llm.model : 'knowledge_base',
    ocr: config.ocr.enabled ? 'tesseract' : 'off',
    email: mailMode(),
    antivirus: config.clamd.host ? 'clamav' : 'signature_checks',
    push: config.push.publicKey ? 'web_push' : 'off',
    object_storage: config.s3.bucket ? 's3' : 'local_disk',
    sso: config.oidc.issuer ? 'oidc' : 'off',
    error_tracking: config.observability.sentryDsn ? 'sentry' : 'off',
  };
}
