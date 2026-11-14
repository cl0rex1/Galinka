import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

/** Apply pending numbered SQL migrations under a transaction advisory lock. */
export async function migrate(
  pool: Pool,
  directory: URL | string = new URL('./migrations', import.meta.url),
): Promise<string[]> {
  const dirPath = directory instanceof URL ? fileURLToPath(directory) : path.resolve(directory);
  const files = (await readdir(dirPath)).filter((name) => name.endsWith('.sql')).sort();
  const db = await pool.connect();
  const appliedNow: string[] = [];
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(648291)');
    await db.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.version));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(dirPath, file), 'utf8');
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
      appliedNow.push(file);
    }
    await db.query('COMMIT');
    return appliedNow;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
