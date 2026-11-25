import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface Db {
  query: Query;
  tx<T>(run: (query: Query) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS saves (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS player_stats (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    winner_id TEXT NOT NULL REFERENCES users(id),
    loser_id TEXT NOT NULL REFERENCES users(id),
    duration_seconds INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    ranked INTEGER NOT NULL DEFAULT 0,
    winner_rating_delta INTEGER NOT NULL DEFAULT 0,
    loser_rating_delta INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pvp_ratings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL DEFAULT 1000,
    season_key TEXT NOT NULL,
    season_rating INTEGER NOT NULL DEFAULT 1000,
    updated_at BIGINT NOT NULL
  )`,
];

async function createSchema(query: Query): Promise<void> {
  // serialises concurrent cold starts
  await query('SELECT pg_advisory_xact_lock(727274)');
  for (const statement of SCHEMA) await query(statement);
}

function postgres(url: string): Db {
  // BIGINT millisecond timestamps are well inside the safe integer range
  pg.types.setTypeParser(20, Number);
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  pool.on('error', (error) => console.error('Idle database connection failed.', error));
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
    async tx(run) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await run(async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[]);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Embedded Postgres for local development, tests and single-container hosting. */
function embedded(directory: string): Db {
  mkdirSync(directory, { recursive: true });
  const db = new PGlite(directory);
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows,
    tx: (run) => db.transaction((tx) => run(async <T>(sql: string, params: unknown[] = []) => (await tx.query<T>(sql, params)).rows)),
    close: () => db.close(),
  };
}

export async function openDatabase(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url && process.env.RENDER) throw new Error('DATABASE_URL must be set on Render.');
  const db = url ? postgres(url) : embedded(resolve(process.env.DATABASE_PATH ?? resolve(import.meta.dirname, '../data/pglite')));
  await db.tx(createSchema);
  return db;
}
