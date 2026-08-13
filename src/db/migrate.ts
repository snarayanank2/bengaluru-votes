import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Set it before running migrations, e.g. against\n' +
    'the local stack (deploy/compose.local.yml):\n' +
    'export DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/gba'
  );
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(client);

(async () => {
  try {
    console.log('Running migrations...');
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations completed successfully.');
    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    await client.end();
    process.exit(1);
  }
})();
