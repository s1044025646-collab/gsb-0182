import type { DatabaseSync } from "node:sqlite";
import type {
  Geometry, Matrix, Metrics, NoiseOptions, ReconOptions, ReconstructionResult,
} from "./types.js";
import { jget } from "./db.js";
import { project } from "./projector.js";
import { reconstruct } from "./reconstruct.js";
import { addNoise, projectionResidual, regionMeans, rmse } from "./metrics.js";
import { validateGeometry, validateSinogramShape } from "./validate.js";
import { SAMPLE_BUILDERS, SampleKind } from "./samples.js";

export class Store {
  constructor(private db: DatabaseSync) {}

  createSample(kind: string, name: string, matrix?: Matrix): { id: number; n: number } {
    let m: Matrix;
    if (matrix) {
      m = matrix;
    } else {
      const builder = SAMPLE_BUILDERS[kind as SampleKind];
      if (!builder) throw new Error(`未知内置样本类型: ${kind}`);
      m = builder();
    }
    const info = this.db
      .prepare("INSERT INTO samples(kind,name,n,matrix) VALUES(?,?,?,?)")
      .run(kind, name, m.length, JSON.stringify(m));
    return { id: Number(info.lastInsertRowid), n: m.length };
  }

  getSample(id: number): { id: number; kind: string; name: string; n: number; matrix: Matrix } {
    const row = this.db.prepare("SELECT * FROM samples WHERE id=?").get(id) as
      | { id: number; kind: string; name: string; n: number; matrix: string }
      | undefined;
    if (!row) throw new Error(`样本 ${id} 不存在`);
    return { ...row, matrix: jget<Matrix>(row.matrix) };
  }

  listSamples() {
    return (this.db.prepare("SELECT id,created_at,kind,name,n FROM samples ORDER BY id").all() as unknown[]);
  }

  createGeometry(name: string, g: Geometry): number {
    const valid = validateGeometry(g);
    const info = this.db.prepare("INSERT INTO geometries(name,geometry) VALUES(?,?)")
      .run(name, JSON.stringify(valid));
    return Number(info.lastInsertRowid);
  }

  getGeometry(id: number): Geometry {
    const row = this.db.prepare("SELECT geometry FROM geometries WHERE id=?").get(id) as
      | { geometry: string } | undefined;
    if (!row) throw new Error(`几何 ${id} 不存在`);
    return jget<Geometry>(row.geometry);
  }

  listGeometries() {
    return this.db.prepare("SELECT id,created_at,name FROM geometries ORDER BY id").all();
  }

  /** 前向投影生成正弦图（可加固定种子噪声）。 */
  projectSample(sampleId: number, geometryId: number, noise?: NoiseOptions): number {
    const sample = this.getSample(sampleId);
    const g = this.getGeometry(geometryId);
    if (sample.n !== g.n)
      throw new Error(`样本尺寸 ${sample.n} 与几何 n=${g.n} 不匹配`);
    let sino = project(sample.matrix, g);
    if (noise && noise.relativeSigma > 0) sino = addNoise(sino, noise);
    const info = this.db
      .prepare("INSERT INTO projections(sample_id,geometry_id,source,noise,sinogram) VALUES(?,?,?,?,?)")
      .run(sampleId, geometryId, "forward", noise ? JSON.stringify(noise) : null, JSON.stringify(sino));
    return Number(info.lastInsertRowid);
  }

  /** 直接导入正弦图（完全不需要原图）。 */
  importSinogram(geometryId: number, sinogram: number[][]): number {
    const g = this.getGeometry(geometryId);
    const valid = validateSinogramShape(sinogram, g);
    const info = this.db
      .prepare("INSERT INTO projections(sample_id,geometry_id,source,noise,sinogram) VALUES(NULL,?,?,NULL,?)")
      .run(geometryId, "import", JSON.stringify(valid));
    return Number(info.lastInsertRowid);
  }

  getProjection(id: number):
    { id: number; sampleId: number | null; geometryId: number; source: string; noise: NoiseOptions | null; sinogram: number[][] } {
    const row = this.db.prepare("SELECT * FROM projections WHERE id=?").get(id) as
      | { id: number; sample_id: number | null; geometry_id: number; source: string; noise: string | null; sinogram: string }
      | undefined;
    if (!row) throw new Error(`投影 ${id} 不存在`);
    return {
      id: row.id, sampleId: row.sample_id, geometryId: row.geometry_id, source: row.source,
      noise: row.noise ? jget<NoiseOptions>(row.noise) : null,
      sinogram: jget<number[][]>(row.sinogram),
    };
  }

  listProjections() {
    return this.db.prepare(
      "SELECT id,created_at,sample_id,geometry_id,source,noise FROM projections ORDER BY id").all();
  }

  runReconstruction(projectionId: number, opts: ReconOptions): number {
    const proj = this.getProjection(projectionId);
    const g = this.getGeometry(proj.geometryId);
    const result: ReconstructionResult = reconstruct(proj.sinogram, g, opts);
    const info = this.db.prepare(
      "INSERT INTO reconstructions(projection_id,filter,coverage,params,image,padded_length,angular_weights) VALUES(?,?,?,?,?,?,?)"
    ).run(
      projectionId, result.filter, result.coverage, JSON.stringify(opts),
      JSON.stringify(result.image), result.paddedLength, JSON.stringify(result.angularWeightsDeg)
    );
    return Number(info.lastInsertRowid);
  }

  getReconstruction(id: number): ReconstructionResult &
    { id: number; projectionId: number; image: Matrix } {
    const row = this.db.prepare("SELECT * FROM reconstructions WHERE id=?").get(id) as
      | { id: number; projection_id: number; filter: "ram-lak" | "none"; coverage: "full-180" | "as-is";
          params: string; image: string; padded_length: number; angular_weights: string }
      | undefined;
    if (!row) throw new Error(`重建 ${id} 不存在`);
    return {
      id: row.id, projectionId: row.projection_id, filter: row.filter, coverage: row.coverage,
      image: jget<Matrix>(row.image), paddedLength: row.padded_length,
      angularWeightsDeg: jget<number[]>(row.angular_weights),
    };
  }

  listReconstructions() {
    return this.db.prepare("SELECT id,created_at,projection_id,filter,coverage FROM reconstructions ORDER BY id").all();
  }

  /** 与已知真值比较；无真值时仅算投影残差（不编造精度）。 */
  compare(reconstructionId: number): Metrics & { comparisonId: number; hasTruth: boolean } {
    const rec = this.getReconstruction(reconstructionId);
    const proj = this.getProjection(rec.projectionId);
    const g = this.getGeometry(proj.geometryId);
    const residual = projectionResidual(rec.image, proj.sinogram, g);
    let metrics: Metrics;
    let hasTruth = false;
    let sampleId: number | null = null;
    if (proj.sampleId != null) {
      const sample = this.getSample(proj.sampleId);
      hasTruth = true;
      sampleId = sample.id;
      metrics = { rmse: rmse(sample.matrix, rec.image), ...regionMeans(sample.matrix, rec.image),
        projectionResidualRelative: residual };
    } else {
      metrics = {
        rmse: NaN, truthRegionMean: NaN, reconRegionMean: NaN, regionMeanDiff: NaN,
        maxAbsDiff: NaN, projectionResidualRelative: residual,
      };
    }
    const info = this.db.prepare("INSERT INTO comparisons(reconstruction_id,sample_id,metrics) VALUES(?,?,?)")
      .run(reconstructionId, sampleId, JSON.stringify(metrics));
    return { ...metrics, comparisonId: Number(info.lastInsertRowid), hasTruth };
  }
}
