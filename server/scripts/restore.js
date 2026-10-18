// Stop the server first. Usage: node server/scripts/restore.js <backup-file.db.gz>
import { restoreBackupFile } from '../src/lib/backup.js';
if (!process.argv[2]) { console.error('Usage: node server/scripts/restore.js <backup-file.db.gz>'); process.exit(1); }
console.log('Restored to', restoreBackupFile(process.argv[2]));
