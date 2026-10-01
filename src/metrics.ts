import type { Matrix, NoiseOptions } from "./types.js";
import { project } from "./projector.js";
import type { Geometry } from "./types.js";

export function rmse(a: Matrix, b: Matrix): number {
  const n = a.length;
  let s = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const d = a[r][c] - b[r][c];
    s += d * d;
  }
  return Math.sqrt(s / (n * n));
}

/** 以真值支撑区域（mu>阈值）为“感兴趣区域”比较区域均值；无真值支撑时退回全图。 */
export function regionMeans(truth: Matrix, recon: Matrix, threshold = 0.2) {
  let tSum = 0, rSum = 0, count = 0;
  let maxAbs = 0;
  for (let r = 0; r < truth.length; r++)
    for (let c = 0; c < truth.length; c++) {
      maxAbs = Math.max(maxAbs, Math.abs(truth[r][c] - recon[r][c]));
      if (truth[r][c] > threshold) {
        tSum += truth[r][c];
        rSum += recon[r][c];
        count++;
      }
    }
  if (count === 0) {
    // 空白真值：对全图比较
    for (let r = 0; r < truth.length; r++)
      for (let c = 0; c < truth.length; c++) {
        tSum += truth[r][c];
        rSum += recon[r][c];
        count++;
      }
  }
  const tm = tSum / count;
  const rm = rSum / count;
  return { truthRegionMean: tm, reconRegionMean: rm, regionMeanDiff: rm - tm, maxAbsDiff: maxAbs };
}

/** 投影域相对 RMSE：对重建图重新前向投影，与给定正弦图比较，按正弦图尺度归一。无真值也可计算。 */
export function projectionResidual(recon: Matrix, sinogram: number[][], g: Geometry): number {
  const repro = project(recon, g);
  let s = 0;
  let scale = 0;
  let count = 0;
  for (let i = 0; i < sinogram.length; i++)
    for (let k = 0; k < g.detectors; k++) {
      const d = repro[i][k] - sinogram[i][k];
      s += d * d;
      scale += sinogram[i][k] ** 2;
      count++;
    }
  return Math.sqrt(s / count) / (Math.sqrt(scale / count) || 1);
}

/** 可重复高斯噪声：固定种子的 mulberry32 + Box-Muller。 */
export function addNoise(sinogram: number[][], opts: NoiseOptions): number[][] {
  let s = opts.seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let max = 0;
  for (const row of sinogram) for (const v of row) max = Math.max(max, Math.abs(v));
  const sigma = opts.relativeSigma * max;
  return sinogram.map((row) =>
    row.map(() => {
      const u1 = Math.max(rand(), 1e-12);
      const u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return z * sigma;
    }).map((nz, k) => row[k] + nz)
  );
}
