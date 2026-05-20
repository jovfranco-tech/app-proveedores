import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { databaseProvider, dbPath, initializeDatabase } from '../db';

if (databaseProvider !== 'sqlite') {
  throw new Error('Este backup es solo para SQLite. Usa npm run db:postgres:backup para Postgres.');
}

await initializeDatabase();

const backupDir = process.env.BACKUP_DIR ?? join(process.cwd(), 'backups');
if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(backupDir, `${basename(dbPath)}.${stamp}.bak`);
copyFileSync(dbPath, out);
console.log(`Backup creado: ${out}`);
