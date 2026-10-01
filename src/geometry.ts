/**
 * 扫描几何与坐标约定（全部为无量纲“单位长度”，像素间距即长度基准）。
 *
 * 重建矩阵 f，N 行 × N 列（方形），行索引 i 自上而下，列索引 j 自左而右。
 * 连续坐标 (x, y)：x 向右，y 向上，原点在矩阵中心像素中心：
 *   x = (j - (N-1)/2) * pixelSpacing
 *   y = ((N-1)/2 - i) * pixelSpacing
 *
 * 平行束：角度 theta（度）为光源到探测器的射线传播方向相对 +x 轴的转角，
 * 逆时针为正。探测器轴 u 与传播方向垂直，
 *   u = -x sin(theta) + y cos(theta)
 * 平行束投影 p(theta, u) = ∫ f(x,y) ds，沿方向 (cos theta, sin theta) 积分。
 * 注意 u 随 theta 的符号定义使 theta=0 时 u=y（上下投影），
 * theta=90° 时 u=-x（左右投影镜像），镜像关系由此产生并在测试中验证。
 */

export interface Geometry {
  /** 重建矩阵边长 N（方形）。 */
  size: number;
  /** 像素中心间距（单位长度，默认 1）。 */
  pixelSpacing: number;
  /** 探测器通道间距（单位长度，默认与 pixelSpacing 相同）。 */
  detectorSpacing: number;
  /** 探测器通道数（奇数，保证有中心通道 u=0）。 */
  detectorCount: number;
  /** 投影角度（度），通常在 [0,180) 内等间隔；必须严格递增、无重复。 */
  anglesDeg: number[];
}

export function validateGeometry(g: Geometry): void {
  if (!Number.isInteger(g.size) || g.size < 2 || g.size > 256) {
    throw new Error('size 必须是 [2,256] 内的整数');
  }
  if (!(g.pixelSpacing > 0) || !(g.detectorSpacing > 0)) {
    throw new Error('pixelSpacing 与 detectorSpacing 必须为正数');
  }
  if (!Number.isInteger(g.detectorCount) || g.detectorCount < 3) {
    throw new Error('detectorCount 必须是不小于 3 的整数');
  }
  if (!Array.isArray(g.anglesDeg) || g.anglesDeg.length < 2) {
    throw new Error('至少需要 2 个投影角度');
  }
  if (g.anglesDeg.length > 720) {
    throw new Error('角度数量过多（上限 720）');
  }
  for (const a of g.anglesDeg) {
    if (typeof a !== 'number' || !Number.isFinite(a)) throw new Error('角度必须是有限数');
  }
  for (let k = 1; k < g.anglesDeg.length; k++) {
    if (g.anglesDeg[k] <= g.anglesDeg[k - 1]) {
      throw new Error(`角度必须严格递增且不得重复（位置 ${k - 1} 与 ${k}）`);
    }
  }
}

/** 探测器通道 k 的物理坐标 u。 */
export function detectorU(g: Geometry, k: number): number {
  return (k - (g.detectorCount - 1) / 2) * g.detectorSpacing;
}

/**
 * 角度覆盖检查：平行束在 [0,180°) 内完备。
 * 返回 { spanDeg, meanStepDeg }。spanDeg 为末角-首角，
 * 对严格的“等间隔覆盖半周”，要求 angles 近似 linspace(0,180-step, n)。
 */
export function angularCoverage(anglesDeg: number[]): { spanDeg: number; meanStepDeg: number } {
  const n = anglesDeg.length;
  const spanDeg = anglesDeg[n - 1] - anglesDeg[0];
  const meanStepDeg = spanDeg / (n - 1);
  return { spanDeg, meanStepDeg };
}

/**
 * 生成 n 个等间隔角度：linspace(0, 180 - 180/n, n)。
 */
export function equispacedAngles(n: number): number[] {
  if (!Number.isInteger(n) || n < 2) throw new Error('角度数必须是不小于 2 的整数');
  const step = 180 / n;
  return Array.from({ length: n }, (_, k) => k * step);
}
