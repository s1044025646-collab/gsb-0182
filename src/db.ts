import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SampleRow {
  id: number;
  name: string;
  kind: string;
  size: number;
  image: number[][];
  created_at: string;
}

export interface ScanRow {
  id: number;
  sample_id: number | null;
  geometry: {
    size: number;
    pixelSpacing: number;
    detectorSpacing: number;
    detectorCount: number;
    anglesDeg: number[];
  };
  noise_seed: number | null;
  noise_sigma: number | null;
  sinogram: number[][];
  note: string | null;
  created_at: string;
}

export interface ReconstructionRow {
  id: number;
  scan_id: number;
  filter: 'ramlak' | 'none';
  image: number[][];
  out_of_range_samples: number;
  pad_length: number;
  created_at: string;
}

export interface ComparisonRow {
  id: number;
  scan_id: number;
  reconstruction_id: number;
  truth_sample_id: number | null;
  rmse: number | null;
  region: unknown;
  projection_residual_rms: number;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  image TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id INTEGER REFERENCES samples(id),
  geometry TEXT NOT NULL,
  noise_seed INTEGER,
  noise_sigma REAL,
  sinogram TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reconstructions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  filter TEXT NOT NULL,
  image TEXT NOT NULL,
  out_of_range_samples INTEGER NOT NULL,
  pad_length INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS comparisons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id),
  reconstruction_id INTEGER NOT NULL REFERENCES reconstructions(id),
  truth_sample_id INTEGER REFERENCES samples(id),
  rmse REAL,
  region TEXT,
  projection_residual_rms REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export class Store {
  readonly db: DatabaseSync;
  private closed = false;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  insertSample(name: string, kind: string, size: number, image: number[][]): SampleRow {
    const info = this.db
      .prepare('INSERT INTO samples (name, kind, size, image) VALUES (?, ?, ?, ?)')
      .run(name, kind, size, JSON.stringify(image));
    return this.getSample(Number(info.lastInsertRowid))!;
  }

  getSample(id: number): SampleRow | null {
    const row = this.db.prepare('SELECT * FROM samples WHERE id = ?').get(id) as
      | { id: number; name: string; kind: string; size: number; image: string; created_at: string }
      | undefined;
    if (!row) return null;
    return { ...row, image: JSON.parse(row.image) };
  }

  listSamples(): Omit<SampleRow, 'image'>[] {
    const rows = this.db.prepare('SELECT id, name, kind, size, created_at FROM samples ORDER BY id').all() as never;
    return rows as Omit<SampleRow, 'image'>[];
  }

  insertScan(
    sampleId: number | null,
    geometry: ScanRow['geometry'],
    sinogram: number[][],
    noiseSeed: number | null,
    noiseSigma: number | null,
    note: string | null,
  ): ScanRow {
    const info = this.db
      .prepare(
        'INSERT INTO scans (sample_id, geometry, noise_seed, noise_sigma, sinogram, note) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        sampleId,
        JSON.stringify(geometry),
        noiseSeed,
        noiseSigma,
        JSON.stringify(sinogram),
        note,
      );
    return this.getScan(Number(info.lastInsertRowid))!;
  }

  getScan(id: number): ScanRow | null {
    const row = this.db
      .prepare('SELECT * FROM scans WHERE id = ?')
      .get(id) as
      | {
          id: number;
          sample_id: number | null;
          geometry: string;
          noise_seed: number | null;
          noise_sigma: number | null;
          sinogram: string;
          note: string | null;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      sample_id: row.sample_id,
      geometry: JSON.parse(row.geometry),
      noise_seed: row.noise_seed,
      noise_sigma: row.noise_sigma,
      sinogram: JSON.parse(row.sinogram),
      note: row.note,
      created_at: row.created_at,
    };
  }

  listScans(): { id: number; sample_id: number | null; note: string | null; created_at: string }[] {
    return this.db
      .prepare('SELECT id, sample_id, note, created_at FROM scans ORDER BY id')
      .all() as never;
  }

  insertReconstruction(
    scanId: number,
    filter: 'ramlak' | 'none',
    image: number[][],
    outOfRange: number,
    padLength: number,
  ): ReconstructionRow {
    const info = this.db
      .prepare(
        'INSERT INTO reconstructions (scan_id, filter, image, out_of_range_samples, pad_length) VALUES (?, ?, ?, ?, ?)',
      )
      .run(scanId, filter, JSON.stringify(image), outOfRange, padLength);
    return this.getReconstruction(Number(info.lastInsertRowid))!;
  }

  getReconstruction(id: number): ReconstructionRow | null {
    const row = this.db
      .prepare('SELECT * FROM reconstructions WHERE id = ?')
      .get(id) as
      | {
          id: number;
          scan_id: number;
          filter: 'ramlak' | 'none';
          image: string;
          out_of_range_samples: number;
          pad_length: number;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return { ...row, image: JSON.parse(row.image) };
  }

  listReconstructions(scanId: number): { id: number; scan_id: number; filter: string; created_at: string }[] {
    return this.db
      .prepare('SELECT id, scan_id, filter, created_at FROM reconstructions WHERE scan_id = ? ORDER BY id')
      .all(scanId) as never;
  }

  insertComparison(c: {
    scanId: number;
    reconstructionId: number;
    truthSampleId: number | null;
    rmse: number | null;
    region: unknown;
    projectionResidualRms: number;
  }): ComparisonRow {
    const info = this.db
      .prepare(
        'INSERT INTO comparisons (scan_id, reconstruction_id, truth_sample_id, rmse, region, projection_residual_rms) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        c.scanId,
        c.reconstructionId,
        c.truthSampleId,
        c.rmse,
        JSON.stringify(c.region),
        c.projectionResidualRms,
      );
    return this.getComparison(Number(info.lastInsertRowid))!;
  }

  getComparison(id: number): ComparisonRow | null {
    const row = this.db.prepare('SELECT * FROM comparisons WHERE id = ?').get(id) as
      | {
          id: number;
          scan_id: number;
          reconstruction_id: number;
          truth_sample_id: number | null;
          rmse: number | null;
          region: string;
          projection_residual_rms: number;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return { ...row, region: JSON.parse(row.region) };
  }
}
