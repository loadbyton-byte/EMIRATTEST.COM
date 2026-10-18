import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: process.env.EMT_NO_JOBS === '1' ? 'silent' : config.observability.logLevel,
  base: { app: 'emirattest' },
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.password_hash', '*.otp', '*.mfa_secret'], censor: '[redacted]' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
