import { createApp } from './app.js';
import { config } from './config.js';
import { openDb, get } from './db.js';
import { startJobs } from './jobs.js';

openDb();
// First boot: seed demonstration data when the database is empty.
if (!get('SELECT COUNT(*) AS n FROM services').n) {
  const { seedAll, seedAsync } = await import('./seed.js');
  seedAll({ quiet: false });
  await seedAsync();
}
const app = createApp();
app.listen(config.port, () => {
  console.log(`[emirattest] API + web on http://localhost:${config.port}  (demo=${config.demoMode})`);
});
startJobs();
