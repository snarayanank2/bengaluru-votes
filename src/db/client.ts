import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
const client = postgres(process.env.DATABASE_URL!, { max: 10 });
export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never;
