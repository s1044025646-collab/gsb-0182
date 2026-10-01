import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * SQLite 持久化。四类对象：
 * - samples：样本版本（真值矩阵），JSON 存矩阵；
 * - geometries：扫描几何（角度、探测器、间距）；
 * - projections：投影数据（正弦图 + 噪声参数），引用样本/几何；
 * - reconstructions：重建结果与参数，引用 projection。
 * 参数或数据任一变化都会创建新行（新实验快照），旧快照永久可查。
 */
export interface Row {
  id: number;
  created_at: string;
  kind: string;
  name: string;
  payload: string;
  parent_id: number | null;
  params: string;
}

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      n INTEGER NOT NULL,
      matrix TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS geometries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      name TEXT NOT NULL,
      geometry TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sample_id INTEGER,
      geometry_id INTEGER NOT NULL,
      source TEXT NOT NULL,           -- 'forward' | 'import'
      noise TEXT,
      sinogram TEXT NOT NULL,
      FOREIGN KEY(sample_id) REFERENCES samples(id),
      FOREIGN KEY(geometry_id) REFERENCES geometries(id)
    );
    CREATE TABLE IF NOT EXISTS reconstructions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      projection_id INTEGER NOT NULL,
      filter TEXT NOT NULL,
      coverage TEXT NOT NULL,
      params TEXT NOT NULL,
      image TEXT NOT NULL,
      padded_length INTEGER NOT NULL,
      angular_weights TEXT NOT NULL,
      FOREIGN KEY(projection_id) REFERENCES projections(id)
    );
    CREATE TABLE IF NOT EXISTS comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reconstruction_id INTEGER NOT NULL,
      sample_id INTEGER,
      metrics TEXT NOT NULL,
      FOREIGN KEY(reconstruction_id) REFERENCES reconstructions(id)
    );
  `);
  return db;
}

export function jget<T>(s: string): T {
  return JSON.parse(s) as T;
}
