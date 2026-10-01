import type { Geometry, Matrix } from "./types.js";
import { detectorPositions } from "./validate.js";

/**
 * 前向投影：射线驱动，逐像素计算“射线穿过该正方形像素的截距长度”。
 * 射线: (x,y) = (t cosθ - s sinθ, t sinθ + s cosθ)，s 沿射线方向。
 * 对每个像素用其物理边界 [x0,x1]×[y0,y1] 与射线求交：
 *   s 在 x、y 两组 slab 区间的交集长度（length）即穿该像素的物理长度。
 * 截距长度法是精确的线积分（分段常数图像下），量纲 mu*length，
 * 且对镜像/旋转几何严格对称；射线不经过的像素贡献 0。
 * rayStepPixels 参数在该方法中仅用于兼容几何结构，不影响精度。
 */
export function project(image: Matrix, g: Geometry): number[][] {
  const n = g.n;
  const d = g.pixelSize;
  const center = (n - 1) / 2;
  const ts = detectorPositions(g);
  const sinogram: number[][] = [];
  for (const thetaDeg of g.anglesDeg) {
    const th = (thetaDeg * Math.PI) / 180;
    const dx = -Math.sin(th); // 射线方向（沿 s 增大）
    const dy = Math.cos(th);
    const nx = Math.cos(th); // 探测器法向
    const ny = Math.sin(th);
    const row: number[] = new Array(g.detectors).fill(0);
    for (let k = 0; k < g.detectors; k++) {
      const t = ts[k];
      let acc = 0;
      for (let r = 0; r < n; r++) {
        const y1 = (center - r + 0.5) * d;
        const y0 = y1 - d;
        for (let c = 0; c < n; c++) {
          const x0 = (c - center - 0.5) * d;
          const x1 = x0 + d;
          // 射线 p(s) = t*(nx,ny) + s*(dx,dy)，对像素 x/y 边界求 s slab 交集
          let lo = -Infinity, hi = Infinity;
          if (Math.abs(dx) > 1e-12) {
            const sa = (x0 - t * nx) / dx;
            const sb = (x1 - t * nx) / dx;
            lo = Math.max(lo, Math.min(sa, sb));
            hi = Math.min(hi, Math.max(sa, sb));
          } else if (t * nx < x0 || t * nx > x1) continue;
          if (Math.abs(dy) > 1e-12) {
            const sa = (y0 - t * ny) / dy;
            const sb = (y1 - t * ny) / dy;
            lo = Math.max(lo, Math.min(sa, sb));
            hi = Math.min(hi, Math.max(sa, sb));
          } else if (t * ny < y0 || t * ny > y1) continue;
          if (hi > lo) acc += image[r][c] * (hi - lo);
        }
      }
      row[k] = acc;
    }
    sinogram.push(row);
  }
  return sinogram;
}

/** 对探测器轴做线性插值；越界零延拓。t 与探测器位置同单位。 */
function interpDetector(row: number[], t: number, g: Geometry): number {
  const d = g.detectorSpacing;
  const half = (g.detectors - 1) / 2;
  const f = t / d + half; // 连续通道下标
  if (f < 0 || f > g.detectors - 1) return 0; // 越界采样 → 0
  const k0 = Math.floor(f);
  const k1 = k0 + 1;
  if (k1 >= g.detectors) return row[k0];
  const a = f - k0;
  return row[k0] * (1 - a) + row[k1] * a;
}

/**
 * 反投影：
 *   f(x,y) = Σ_i w_i p_filtered(θ_i, t=x cosθ+y sinθ)
 * 角度权重 w_i 用 Voronoi 间隔（度），等间隔时等于常数 dθ，
 * 非等间隔时各自承担相邻角度中点之间的跨度，端点角度仅向内侧扩展。
 * 统一乘 π/180 转为弧度，再乘全局归一常数（见 reconstruct 中的 CAL）。
 */
export function angularWeightsDeg(anglesDeg: number[]): number[] {
  const a = anglesDeg.slice().sort((u, v) => u - v);
  const m = a.length;
  const w = new Array<number>(m).fill(0);
  if (m === 1) {
    w[0] = 180;
    return mapWeights(anglesDeg, a, w);
  }
  for (let i = 0; i < m; i++) {
    const prev = i === 0 ? a[0] - (a[1] - a[0]) / 2 : (a[i - 1] + a[i]) / 2;
    const next = i === m - 1 ? a[m - 1] + (a[m - 1] - a[m - 2]) / 2 : (a[i] + a[i + 1]) / 2;
    w[i] = next - prev;
  }
  return mapWeights(anglesDeg, a, w);
}

function mapWeights(original: number[], sorted: number[], sortedW: number[]): number[] {
  return original.map((v) => sortedW[sorted.indexOf(v)]);
}

export function backproject(filtered: number[][], g: Geometry, weightsDeg: number[]): Matrix {
  const n = g.n;
  const d = g.pixelSize;
  const center = (n - 1) / 2;
  const img: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const toRad = Math.PI / 180;
  for (let i = 0; i < g.anglesDeg.length; i++) {
    const th = g.anglesDeg[i] * Math.PI / 180;
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const row = filtered[i];
    const w = weightsDeg[i] * toRad;
    for (let r = 0; r < n; r++) {
      const y = (center - r) * d;
      for (let c = 0; c < n; c++) {
        const x = (c - center) * d;
        const t = x * cos + y * sin;
        img[r][c] += w * interpDetector(row, t, g);
      }
    }
  }
  return img;
}
