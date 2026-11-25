import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { normalizar } from './util.js';

export type DB = DatabaseSync;

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../migrations');

export function openDb(file: string): DB {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  // Funcion SQL para buscar sin distinguir acentos ni mayusculas
  db.function('norm', { deterministic: true }, (v) => (typeof v === 'string' ? normalizar(v) : v));
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const aplicadas = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const ficheros = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of ficheros) {
    if (aplicadas.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
    });
  }
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
