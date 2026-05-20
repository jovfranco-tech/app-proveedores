import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('Define POSTGRES_URL para ejecutar migraciones Postgres.');
}

const client = new Client({ connectionString, ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
await client.connect();

const sql = readFileSync(join(process.cwd(), 'server/postgres/schema.sql'), 'utf8');
await client.query('BEGIN');
await client.query(sql);
await client.query(
  `INSERT INTO schema_migrations (version, applied_at)
   VALUES ($1, now())
   ON CONFLICT (version) DO NOTHING`,
  ['postgres_schema_v1']
);
await client.query('COMMIT');
await client.end();

console.log('Migracion Postgres aplicada.');
