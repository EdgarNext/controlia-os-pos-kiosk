import Database from 'better-sqlite3';
import path from 'node:path';
import { OPEN_TABS_LOCAL_MIGRATIONS, type LocalMigration } from './migrations';

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function listAppliedVersions(db: Database.Database): Set<number> {
  const rows = db
    .prepare('SELECT version FROM local_migrations ORDER BY version ASC')
    .all() as Array<{ version: number }>;
  return new Set(rows.map((row) => Number(row.version)));
}

function applyMigration(db: Database.Database, migration: LocalMigration): void {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.exec(migration.sql);
    db.prepare(`
      INSERT INTO local_migrations(version, name, applied_at)
      VALUES (@version, @name, @applied_at)
    `).run({
      version: migration.version,
      name: migration.name,
      applied_at: now,
    });
  });
  tx();
}

export function applyOpenTabsLocalMigrations(userDataPath: string): void {
  const dbPath = path.join(userDataPath, 'pos-kiosk.sqlite3');
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureMigrationsTable(db);

    const applied = listAppliedVersions(db);
    const pending = OPEN_TABS_LOCAL_MIGRATIONS
      .slice()
      .sort((a, b) => a.version - b.version)
      .filter((migration) => !applied.has(migration.version));

    pending.forEach((migration) => applyMigration(db, migration));
  } finally {
    db.close();
  }
}
