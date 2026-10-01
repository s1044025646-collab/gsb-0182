import { Geometry, detectorU, validateGeometry } from './geometry.js';
import { validateMatrix, zeros2D } from './numeric.js';

/**
 * 前向投影（像素驱动，line-integral 模型）。
 *
 * 对每个角度 theta、每个探测器通道 k（对应 u_k），射线为
 *   -x sinθ + y cosθ = u_k
 * 像素 j,i 中心 (x_j, y_i) 到该直线的有符号距离
 *   d = -x_j sinθ + y_i cosθ - u_k
 * 像素对该通道的权重取为射线在像素内的弦长近似：
 *   w = max(0, 1 - |d| / (detectorSpacing/2)) ... 用梯形核太窄，
 * 故采用宽度等于像素间距投影尺度的帐篷(线性插值)核：
 *   w = clamp(1 - |d| / detectorSpacing, 0, 1)
 * 再乘以沿射线方向的像素长度系数
 *   L = pixelSpacing * (|cosθ| + |sinθ|)
 * （像素正方形沿射线的弦长一阶近似，θ=0/90° 时为 pixelSpacing）。
 *
 * 边界处理：探测器只在离散通道上取值；物体超出探测器范围的部分自然不计入
 * （调用方应保证 detectorCount 足以覆盖视场 FOV = N*pixelSpacing*√2/2）。
 * 权重为非负数，因此全零图像严格投影为全零。
 */
export function project(image: number[][], g: Geometry): number[][] {
  validateGeometry(g);
  const { rows, cols } = validateMatrix(image);
  if (rows !== g.size || cols !== g.size) {
    throw new Error(`图像尺寸 ${rows}x${cols} 与几何 size=${g.size} 不匹配`);
  }
  const n = g.size;
  const half = (n - 1) / 2;
  const nAng = g.anglesDeg.length;
  const nDet = g.detectorCount;
  const sino = zeros2D(nAng, nDet);

  for (let a = 0; a < nAng; a++) {
    const th = (g.anglesDeg[a] * Math.PI) / 180;
    const s = Math.sin(th);
    const c = Math.cos(th);
    const chord = g.pixelSpacing * (Math.abs(c) + Math.abs(s));
    // 每个像素的 u 坐标在固定角度下预计算
    const uPixel = new Array<number>(n * n);
    for (let i = 0; i < n; i++) {
      const y = (half - i) * g.pixelSpacing;
      for (let j = 0; j < n; j++) {
        const x = (j - half) * g.pixelSpacing;
        uPixel[i * n + j] = -x * s + y * c;
      }
    }
    for (let k = 0; k < nDet; k++) {
      const uk = detectorU(g, k);
      let acc = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const d = uPixel[i * n + j] - uk;
          const w = 1 - Math.abs(d) / g.detectorSpacing;
          if (w > 0) acc += image[i][j] * w * chord;
        }
      }
      sino[a][k] = acc;
    }
  }
  return sino;
}

/**
 * 反投影（不滤波）：对每个输出像素，求其 u 坐标并在投影行内做线性插值；
 * u 落在探测器范围之外时视为 0（零延拓），并统计越界样本数。
 * 角度权重采用梯形积分 Δθ（弧度）；非等间隔时按相邻角间距左右平均，
 * 因此缺角（较大角度间隙）只会按实际存在的角度积分，绝不悄悄补角。
 */
export interface BackprojectResult {
  image: number[][];
  outOfRangeSamples: number;
}

export function backproject(sino: number[][], g: Geometry): BackprojectResult {
  validateGeometry(g);
  if (sino.length !== g.anglesDeg.length || sino[0].length !== g.detectorCount) {
    throw new Error('正弦图尺寸与几何不匹配');
  }
  const n = g.size;
  const half = (n - 1) / 2;
  const image = zeros2D(n, n);
  let oob = 0;

  // 角度权重（弧度）：梯形积分
  const nAng = g.anglesDeg.length;
  const rad = g.anglesDeg.map((a) => (a * Math.PI) / 180);
  const wAng = new Array<number>(nAng);
  for (let a = 0; a < nAng; a++) {
    const left = a === 0 ? rad[1] - rad[0] : rad[a] - rad[a - 1];
    const right = a === nAng - 1 ? rad[nAng - 1] - rad[nAng - 2] : rad[a + 1] - rad[a];
    wAng[a] = (left + right) / 2;
  }

  const kCenter = (g.detectorCount - 1) / 2;
  for (let a = 0; a < nAng; a++) {
    const th = rad[a];
    const s = Math.sin(th);
    const c = Math.cos(th);
    const row = sino[a];
    for (let i = 0; i < n; i++) {
      const y = (half - i) * g.pixelSpacing;
      for (let j = 0; j < n; j++) {
        const x = (j - half) * g.pixelSpacing;
        const u = -x * s + y * c;
        const f = (u / g.detectorSpacing + kCenter);
        const k0 = Math.floor(f);
        const t = f - k0;
        let v: number;
        if (k0 < 0 || k0 >= g.detectorCount - 1) {
          // 完全越界：零延拓；恰在端点夹区内仍允许插值
          if (f < 0 || f > g.detectorCount - 1) {
            oob++;
            v = 0;
          } else if (f === g.detectorCount - 1) {
            v = row[g.detectorCount - 1];
          } else {
            v = 0;
          }
        } else {
          v = row[k0] * (1 - t) + row[k0 + 1] * t;
        }
        image[i][j] += wAng[a] * v;
      }
    }
  }
  return { image, outOfRangeSamples: oob };
}
