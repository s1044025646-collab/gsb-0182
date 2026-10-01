import type { Geometry, Matrix } from "./types.js";

export const LIMITS = {
  maxN: 256,
  maxDetectors: 1024,
  maxAngles: 1024,
  minN: 4,
  minDetectors: 2,
  minAngles: 1,
} as const;

export class ValidationError extends Error {
 status = 400;
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export function assertFiniteMatrix(m: unknown, label = "matrix"): Matrix {
  if (!Array.isArray(m) || m.length === 0) throw new ValidationError(`${label} 必须是非空二维数组`);
  const n = m.length;
  if (!Array.isArray(m[0])) throw new ValidationError(`${label} 必须是二维数组`);
  const width = m[0].length;
  if (width !== n) throw new ValidationError(`${label} 必须是方形矩阵，得到 ${n}×${width}`);
  if (n < LIMITS.minN) throw new ValidationError(`${label} 边长至少 ${LIMITS.minN}`);
  if (n > LIMITS.maxN) throw new ValidationError(`${label} 边长超过上限 ${LIMITS.maxN}`);
  for (let r = 0; r < n; r++) {
    if (!Array.isArray(m[r]) || m[r].length !== n)
      throw new ValidationError(`${label} 第 ${r} 行长度与其它行不一致（要求方形）`);
    for (let c = 0; c < n; c++) {
      if (!isFiniteNum(m[r][c]))
        throw new ValidationError(`${label}[${r}][${c}] 不是有限数值（拒绝 NaN/Infinity）`);
    }
  }
  return m as Matrix;
}

export function validateGeometry(g: Partial<Geometry>): Geometry {
  const n = g.n;
  const detectors = g.detectors;
  const anglesDeg = g.anglesDeg;
  if (!isFiniteNum(n) || n < LIMITS.minN || n > LIMITS.maxN || !Number.isInteger(n))
    throw new ValidationError(`n 必须是 ${LIMITS.minN}..${LIMITS.maxN} 的整数`);
  if (!isFiniteNum(detectors) || detectors < LIMITS.minDetectors || detectors > LIMITS.maxDetectors ||
      !Number.isInteger(detectors))
    throw new ValidationError(`detectors 必须是 ${LIMITS.minDetectors}..${LIMITS.maxDetectors} 的整数`);
  if (!Array.isArray(anglesDeg) || anglesDeg.length < LIMITS.minAngles ||
      anglesDeg.length > LIMITS.maxAngles)
    throw new ValidationError(`anglesDeg 数量必须在 ${LIMITS.minAngles}..${LIMITS.maxAngles}`);
  const seen = new Set<number>();
  for (let i = 0; i < anglesDeg.length; i++) {
    const a = anglesDeg[i];
    if (!isFiniteNum(a)) throw new ValidationError(`anglesDeg[${i}] 不是有限数值`);
    if (seen.has(a)) throw new ValidationError(`anglesDeg 存在重复角度 ${a}（下标 ${i}）`);
    seen.add(a);
  }
  const pixelSize = g.pixelSize ?? 1;
  const detectorSpacing = g.detectorSpacing ?? 1;
  const rayStepPixels = g.rayStepPixels ?? 1;
  if (!(isFiniteNum(pixelSize) && pixelSize > 0)) throw new ValidationError("pixelSize 必须为正数");
  if (!(isFiniteNum(detectorSpacing) && detectorSpacing > 0))
    throw new ValidationError("detectorSpacing 必须为正数");
  if (!(isFiniteNum(rayStepPixels) && rayStepPixels > 0 && rayStepPixels <= 2))
    throw new ValidationError("rayStepPixels 必须在 (0,2]");
  return { n, detectors, anglesDeg: anglesDeg.slice(), pixelSize, detectorSpacing, rayStepPixels };
}

export function validateSinogramShape(s: unknown, g: Geometry): number[][] {
  if (!Array.isArray(s) || s.length !== g.anglesDeg.length)
    throw new ValidationError(`正弦图行数 ${Array.isArray(s) ? s.length : "?"} 与角度数 ${g.anglesDeg.length} 不匹配`);
  for (let i = 0; i < s.length; i++) {
    if (!Array.isArray(s[i]) || s[i].length !== g.detectors)
      throw new ValidationError(`正弦图第 ${i} 行宽度应为 ${g.detectors}（尺寸不匹配）`);
    for (let k = 0; k < g.detectors; k++)
      if (!isFiniteNum(s[i][k])) throw new ValidationError(`sinogram[${i}][${k}] 不是有限数值`);
  }
  return s as number[][];
}

export function detectorPositions(g: Geometry): number[] {
  const out: number[] = new Array(g.detectors);
  const half = (g.detectors - 1) / 2;
  for (let k = 0; k < g.detectors; k++) out[k] = (2 * k - (g.detectors - 1)) * 0.5 * g.detectorSpacing;
  return out;
}
