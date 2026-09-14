import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { schema } from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  /** Which engine is behind it, for the boot log. */
  kind: 'postgres' | 'pglite-file' | 'pglite-memory';
  close(): Promise<void>;
}

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Open the database and bring its schema up to date.
 *
 *  - `url` set: a real Postgres, via a connection pool.
 *  - `dataDir` set: embedded Postgres (PGlite) persisted to disk, for local
 *    development with nothing to install.
 *  - neither: PGlite in memory. Tests only — it forgets everything on exit,
 *    which for a wallet means forgetting today's spend.
 *
 * Migrations run on every open. They are idempotent, and a server that boots
 * against a stale schema fails at the first query instead of at startup.
 */
export async function openDatabase(options: { url?: string; dataDir?: string }): Promise<Database> {
  if (options.url) {
    const pool = new pg.Pool({ connectionString: options.url });
    const db = drizzlePg({ client: pool, schema });

    await migratePg(db, { migrationsFolder: MIGRATIONS });

    return { db, kind: 'postgres', close: () => pool.end() };
  }

  // PGlite creates its own directory but not the parents, so a fresh clone
  // (no `.data/` yet) would fail to boot without this.
  if (options.dataDir) mkdirSync(options.dataDir, { recursive: true });

  const client = new PGlite(options.dataDir);
  const db = drizzlePglite({ client, schema });

  await migratePglite(db, { migrationsFolder: MIGRATIONS });

  return {
    db,
    kind: options.dataDir ? 'pglite-file' : 'pglite-memory',
    close: () => client.close(),
  };
}
