import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error('Define POSTGRES_URL para crear backup Postgres.');
}

const backupDir = process.env.BACKUP_DIR ?? join(process.cwd(), 'backups');
if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(backupDir, `postgres-${stamp}.dump`);
const result = spawnSync('pg_dump', ['--format=custom', '--file', out, connectionString], { stdio: 'inherit' });

if (result.status !== 0) {
  throw new Error('pg_dump fallo. Verifica que Postgres client tools esten instaladas.');
}

console.log(`Backup Postgres creado: ${out}`);
