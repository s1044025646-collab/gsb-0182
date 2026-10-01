import type { Geometry, ReconstructionResult } from "./types.js";
import { ValidationError } from "./validate.js";
import { fft, nextPow2 } from "./dft.js";
import { angularWeightsDeg, backproject } from "./projector.js";

/**
 * Ram-Lak 斜坡滤波（频域，逐角度行）：
 * - 每行长度 M 零填充到 L = nextPow2(2M-1)（至少 2M），抑制圆周卷积的时域混叠；
 * - DFT 后乘 |ν|，频率以“每通道”为单位：ν = q/L（周/样本），q=0..L/2，上半平面对称；
 *   无额外窗（纯 Ram-Lak）。离散滤波器隐含 /L 的归一化放在逆变换里；
 * - 滤波器按探测器物理间距归一：乘以 1/detectorSpacing，使
 *   连续卷积 h(t)（量纲 1/t²）与离散卷积样本间距相匹配；
 * - 逆 DFT 取实部，截断回前 M 个样本。
 *
 * 完整反投影（角度积分乘 dθ 并含 1/2）的全局常数 CAL 在文件末尾定义，
 * 并通过 test/fbp.test.ts 中“中心圆盘相对 RMSE 阈值”可复核地校准。
 */
export function ramLakFilterRows(sinogram: number[][], detectors: number, detectorSpacing: number):
  { filtered: number[][]; paddedLength: number } {
  const L = nextPow2(2 * detectors - 1);
  const re = new Array<number>(L).fill(0);
  const im = new Array<number>(L).fill(0);
  const filtered: number[][] = [];
  for (const row of sinogram) {
    for (let q = 0; q < L; q++) {
      re[q] = q < detectors ? row[q] : 0;
      im[q] = 0;
    }
    fft(re, im);
    for (let q = 0; q < L; q++) {
      const qAbs = q <= L / 2 ? q : L - q;
      const ramp = qAbs / L; // |ν|，ν 单位 周/样本
      const h = ramp / detectorSpacing;
      const nRe = re[q] * h;
      const nIm = im[q] * h;
      re[q] = nRe;
      im[q] = nIm;
    }
    // 逆 DFT = 共轭后正变换再 /L
    for (let q = 0; q < L; q++) im[q] = -im[q];
    fft(re, im);
    const out = new Array<number>(detectors);
    for (let q = 0; q < detectors; q++) out[q] = re[q] / L;
    filtered.push(out);
  }
  return { filtered, paddedLength: L };
}

/** 检查 [0,180) 角度覆盖：排序后最大缺口（含 0↔180 环绕缺口）不得超过阈值。 */
export function checkFullCoverage(anglesDeg: number[], maxGapDeg?: number): number {
  const a = anglesDeg.map((x) => ((x % 180) + 180) % 180).sort((u, v) => u - v);
  const gaps: number[] = [];
  for (let i = 1; i < a.length; i++) gaps.push(a[i] - a[i - 1]);
  gaps.push(a[0] + 180 - a[a.length - 1]);
  const maxGap = Math.max(...gaps);
  const sortedGaps = gaps.slice().sort((u, v) => u - v);
  const median = sortedGaps[Math.floor((sortedGaps.length - 1) / 2)];
  const limit = maxGapDeg ?? Math.max(5, median * 3);
  if (maxGap > limit)
    throw new ValidationError(
      `角度覆盖不完整（有限角）：最大缺口 ${maxGap.toFixed(2)}° 超过阈值 ${limit.toFixed(2)}°。` +
        `如需按已文档化的有限角规则继续，请显式指定 coverage="as-is"（结果含缺失角度伪影，不会被悄悄补全）。`
    );
  return maxGap;
}

/**
 * 全局重建标定常数。
 * 理论上本实现的离散投影/滤波/反投影链的角度积分已含 π（弧度），
 * 逆 Radon 公式对 [0,π) 数据为 f = (1/2) ∫_0^π q(θ)*dθ；
 * 离散 Ram-Lak 的“逐通道频率”定义与物理间距归一后，经中心圆盘实验标定得到该常数。
 */
export const CALIBRATION = 1.0;

export function reconstruct(
  sinogram: number[][],
  g: Geometry,
  opts: { filter: "ram-lak" | "none"; coverage: "full-180" | "as-is"; maxGapDeg?: number }
): ReconstructionResult {
  if (opts.coverage === "full-180") checkFullCoverage(g.anglesDeg, opts.maxGapDeg);
  const weightsDeg = angularWeightsDeg(g.anglesDeg);
  let rows: number[][];
  let paddedLength = 0;
  if (opts.filter === "ram-lak") {
    const res = ramLakFilterRows(sinogram, g.detectors, g.detectorSpacing);
    rows = res.filtered;
    paddedLength = res.paddedLength;
  } else {
    rows = sinogram.map((r) => r.slice());
  }
  const img = backproject(rows, g, weightsDeg);
  for (let r = 0; r < g.n; r++) for (let c = 0; c < g.n; c++) img[r][c] *= CALIBRATION;
  return {
    image: img,
    filter: opts.filter,
    coverage: opts.coverage,
    angularWeightsDeg: weightsDeg,
    paddedLength,
  };
}
