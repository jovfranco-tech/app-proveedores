import { closeDatabase, databaseProvider, getUserByEmail, initializeDatabase, listCategories, listRequests } from '../db';

if (databaseProvider !== 'postgres') {
  throw new Error('Define POSTGRES_URL y no uses DB_DRIVER=sqlite para probar runtime Postgres.');
}

await initializeDatabase();

const categories = await listCategories();
const admin = await getUserByEmail('admin@conectapro.mx');
if (!admin) throw new Error('Seed admin no existe en Postgres.');

const requests = await listRequests({
  role: 'admin',
  userId: admin.id
});

console.log(
  JSON.stringify(
    {
      provider: databaseProvider,
      categories: categories.length,
      requests: requests.length,
      admin: admin.email
    },
    null,
    2
  )
);

await closeDatabase();
