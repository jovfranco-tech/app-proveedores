import { dbPath, initializeDatabase } from '../db';

await initializeDatabase();
console.log(`Migraciones aplicadas en ${dbPath}`);
