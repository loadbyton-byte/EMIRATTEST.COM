import { createApp } from './app.js';
import { config } from './config.js';
import { openDb, get } from './db.js';
import { startJobs } from './jobs.js';
import { logger } from './lib/logger.js';
import { initSentry } from './lib/sentry.js';

await initSentry();
openDb();
if (!get('SELECT COUNT(*) AS n FROM services').n) {
  if (config.demoMode) {
    // Sample data set with fictional people and cases, for evaluation and training environments.
    const { seedAll, seedAsync } = await import('./seed.js');
    seedAll({ quiet: false });
    await seedAsync();
  }
}
if (!config.demoMode) {
  const { bootstrapProduction } = await import('./bootstrap.js');
  bootstrapProduction({ log: (m) => logger.info(m) });
}
const app = createApp();
const server = app.listen(config.port, () => logger.info(`API + web on http://localhost:${config.port} (demo=${config.demoMode})`));
const jobs = startJobs();

const shutdown = (sig) => {
  logger.info(`${sig} received, shutting down`);
  if (jobs) clearInterval(jobs);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
