import { Store } from './db.js';
import { Geometry, angularCoverage, equispacedAngles, validateGeometry } from './geometry.js';
import { makePhantom, PhantomKind } from './phantoms.js';
import { project } from './projector.js';
import { addNoise } from './noise.js';
import { reconstruct } from './reconstruction.js';
import { cloneMatrix, regionMean, rmse, validateMatrix } from './numeric.js';

/**
 * 缺角策略（平行束完备观测需要在 [0,180°) 上等间隔覆盖）：
 * - reject（默认）：角度跨度明显不足 180° 或最大角度间隙超过平均间隙 2 倍时拒绝重建；
 * - allow-sparse：允许在“已给出的角度”上重建，按梯形角度权重积分，
 *   缺失角度绝不补造，结果仅作诊断（伪影与量化偏差由指标反映）。
 */
export type GapPolicy = 'reject' | 'allow-sparse';

export interface GapCheck {
  spanDeg: number;
  meanStepDeg: number;
  maxStepDeg: number;
  accepted: boolean;
  reason: string | null;
}

export function checkAngularCoverage(anglesDeg: number[], policy: GapPolicy): GapCheck {
  const { spanDeg, meanStepDeg } = angularCoverage(anglesDeg);
  let maxStep = 0;
  for (let k = 1; k < anglesDeg.length; k++) maxStep = Math.max(maxStep, anglesDeg[k] - anglesDeg[k - 1]);
  const spanOk = spanDeg >= 179.999 - (meanStepDeg > 0 ? meanStepDeg : 0) || (anglesDeg[0] === 0 && Math.abs(spanDeg - (180 - meanStepDeg)) < 1e-6);
  const uniform = maxStep <= meanStepDeg * 2 + 1e-9;
  // 等间隔 linspace(0,180-step,n) 的跨度为 180-step
  const expectedSpan = 180 - meanStepDeg;
  const spanNearHalfTurn = Math.abs(spanDeg - expectedSpan) <= Math.max(1e-6, meanStepDeg * 0.01);
  const accepted = spanNearHalfTurn && uniform;
  let reason: string | null = null;
  if (!accepted) {
    if (!spanNearHalfTurn) reason = `角度跨度 ${spanDeg.toFixed(2)}° 未覆盖半周（期望约 ${expectedSpan.toFixed(2)}°），属于缺角数据`;
    else reason = `最大角度间隔 ${maxStep.toFixed(2)}° 超过平均间隔 ${meanStepDeg.toFixed(2)}° 的 2 倍，角度不均匀`;
  }
  void spanOk;
  if (!accepted && policy === 'reject') {
    throw new Error(`拒绝重建：${reason}。如确认按已有角度做不完整重建，请显式使用 allow-sparse 策略（不会补造缺失角度）。`);
  }
  return { spanDeg, meanStepDeg, maxStepDeg: maxStep, accepted, reason };
}

export function createBuiltinSample(store: Store, kind: PhantomKind, size: number, name?: string) {
  if (size > 128) throw new Error('内置模体尺寸上限 128（数值实验规模限制）');
  const { image } = makePhantom(kind, size);
  return store.insertSample(name ?? kind, 'builtin:' + kind, size, image);
}

export function importSample(store: Store, name: string, image: number[][]) {
  const { rows, cols } = validateMatrix(image);
  if (rows !== cols) throw new Error(`样本必须是方形矩阵，收到 ${rows}x${cols}`);
  if (rows > 256) throw new Error('矩阵边长上限 256');
  return store.insertSample(name, 'imported', rows, cloneMatrix(image));
}

export function projectSample(
  store: Store,
  sampleId: number,
  geometry: Geometry,
  noise: { seed: number; sigma: number } | null,
) {
  const sample = store.getSample(sampleId);
  if (!sample) throw new Error(`样本 ${sampleId} 不存在`);
  validateGeometry(geometry);
  if (geometry.size !== sample.size) {
    throw new Error(`几何 size=${geometry.size} 与样本尺寸 ${sample.size} 不匹配`);
  }
  let sino = project(sample.image, geometry);
  let note = 'forward projection';
  if (noise) {
    sino = addNoise(sino, noise.seed, noise.sigma);
    note += ` + gaussian noise seed=${noise.seed} sigma=${noise.sigma}`;
  }
  return store.insertScan(sampleId, geometry, sino, noise ? noise.seed : null, noise ? noise.sigma : null, note);
}

export function importSinogram(
  store: Store,
  geometry: Geometry,
  sinogram: number[][],
  note = 'imported sinogram（无关联真值）',
) {
  validateGeometry(geometry);
  if (sinogram.length !== geometry.anglesDeg.length) {
    throw new Error(`正弦图行数 ${sinogram.length} 与角度数 ${geometry.anglesDeg.length} 不匹配`);
  }
  validateMatrix(sinogram);
  if (sinogram[0].length !== geometry.detectorCount) {
    throw new Error(`正弦图列数 ${sinogram[0].length} 与探测器数 ${geometry.detectorCount} 不匹配`);
  }
  return store.insertScan(null, geometry, cloneMatrix(sinogram), null, null, note);
}

export function reconstructScan(store: Store, scanId: number, filter: 'ramlak' | 'none', gapPolicy: GapPolicy) {
  const scan = store.getScan(scanId);
  if (!scan) throw new Error(`扫描 ${scanId} 不存在`);
  const gap = checkAngularCoverage(scan.geometry.anglesDeg, gapPolicy);
  const res = reconstruct(scan.sinogram, scan.geometry, { filter });
  const row = store.insertReconstruction(scanId, filter, res.image, res.outOfRangeSamples, res.padLength);
  return { row, gap, outOfRangeSamples: res.outOfRangeSamples };
}

/**
 * 比较：有真值时给 RMSE 与区域均值；始终给投影残差
 * RMS = sqrt(mean((P(f) - p)^2))（重建图前向投影 vs 观测正弦图）。
 */
export function compareReconstruction(
  store: Store,
  reconstructionId: number,
  opts: { truthSampleId?: number; regions?: { name: string; r0: number; r1: number; c0: number; c1: number }[] } = {},
) {
  const rec = store.getReconstruction(reconstructionId);
  if (!rec) throw new Error(`重建结果 ${reconstructionId} 不存在`);
  const scan = store.getScan(rec.scan_id)!;

  let rmseVal: number | null = null;
  let truthId: number | null = null;
  const regionsOut: Record<string, { reconstruction: number; truth?: number }> = {};

  const truthSampleId = opts.truthSampleId ?? scan.sample_id;
  if (truthSampleId != null) {
    const truth = store.getSample(truthSampleId);
    if (truth) {
      if (truth.size !== scan.geometry.size) {
        throw new Error(`真值尺寸 ${truth.size} 与重建尺寸 ${scan.geometry.size} 不匹配`);
      }
      rmseVal = rmse(rec.image, truth.image);
      truthId = truth.id;
      const c = Math.floor((truth.size - 1) / 2);
      const regions = opts.regions ?? [
        { name: 'center', r0: c - 3, r1: c + 3, c0: c - 3, c1: c + 3 },
      ];
      for (const r of regions) {
        regionsOut[r.name] = {
          reconstruction: regionMean(rec.image, r.r0, r.r1, r.c0, r.c1),
          truth: regionMean(truth.image, r.r0, r.r1, r.c0, r.c1),
        };
      }
    }
  }

  const reproj = project(rec.image, scan.geometry);
  let s = 0;
  let count = 0;
  for (let a = 0; a < reproj.length; a++)
    for (let k = 0; k < reproj[a].length; k++) {
      const d = reproj[a][k] - scan.sinogram[a][k];
      s += d * d;
      count++;
    }
  const projectionResidualRms = Math.sqrt(s / count);

  const comp = store.insertComparison({
    scanId: scan.id,
    reconstructionId,
    truthSampleId: truthId,
    rmse: rmseVal,
    region: regionsOut,
    projectionResidualRms,
  });
  return { comparison: comp, hasTruth: rmseVal !== null };
}

export { equispacedAngles };
