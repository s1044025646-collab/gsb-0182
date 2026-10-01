/**
 * 全局坐标与几何约定（务必先读 README“几何与单位约定”一节）：
 *
 * - 图像为 N×N 方形灰度矩阵，元素为线性衰减系数 mu（单位 1/length，length 为任意一致单位）。
 * - 像素为边长 d（pixelSize）的正方形。取图像中心为坐标原点 (0,0)，x 向右、y 向上。
 *   行下标 r（自上而下）对应 y = ( (N-1)/2 - r ) * d；
 *   列下标 c（自左而右）对应 x = ( c - (N-1)/2 ) * d。
 * - 平行束：角度 theta（度，逆时针为正，0° 时光束沿 +y 方向，即射线穿过左右排列的像元列）。
 *   射线参数化为：
 *       x cos(theta) + y sin(theta) = t
 *   其中 theta 是“探测器坐标方向向量”相对 +x 轴的角度；射线方向向量为
 *       (-sin(theta), cos(theta))，故 theta=0 时光束沿 +y。
 *   探测器位置 t_k = ( k - (M-1)/2 ) * detectorSpacing，M 为探测器通道数。
 * - 前向投影（线积分）：对每条射线在射线方向上做等步长采样、长度用像素间距 d 归一，
 *   最近邻取像素值后乘以物理步长 d，故 p 的量纲为“无量纲衰减” mu*length。
 * - 反投影：在每个像元中心计算 t = x cos(theta)+y sin(theta)，对探测器做线性插值，
 *   越界探测器按 0（零延拓）处理。
 * - 角度范围：标准完整扫描为 [0,180)（平行束 180° 即完备）。
 */

export interface Geometry {
  /** 图像边长（像素数），N×N */
  n: number;
  /** 探测器通道数 M */
  detectors: number;
  /** 投影角度（度），允许非等间隔；完整观测一般覆盖 [0,180) */
  anglesDeg: number[];
  /** 像素边长 d（length/像素），默认 1 */
  pixelSize: number;
  /** 探测器通道间距（length），默认 1 */
  detectorSpacing: number;
  /** 前向投影沿射线方向的采样步长（像素），默认 1；越小越精确越慢 */
  rayStepPixels: number;
}

export type Matrix = number[][];

export interface ProjectionResult {
  /** 正弦图：sinogram[角度下标][探测器下标]，量纲 mu*length */
  sinogram: number[][];
  geometry: Geometry;
}

export interface ReconOptions {
  /** ram-lak（默认，零填充到 >=2M 的 2 的幂）或 none（不滤波，直接反投影对照） */
  filter: "ram-lak" | "none";
  /**
 * 角度覆盖模式：
 * "full-180" 要求角度（排序、环绕后）在 [0,180) 上没有大于 maxGapDeg 的缺口；
 * "as-is" 不做完整性检查，缺口仍在（有限角），重建会有文档化的伪影。
 */
  coverage: "full-180" | "as-is";
  /** full-180 模式允许的最大角度缺口（度），默认按中位角距的 3 倍与 5° 取大 */
  maxGapDeg?: number;
}

export interface ReconstructionResult {
  image: Matrix;
  filter: "ram-lak" | "none";
  coverage: "full-180" | "as-is";
  /** 实际使用的反投影角度权重（度），等间隔时≈dtheta */
  angularWeightsDeg: number[];
  paddedLength: number;
}

export interface NoiseOptions {
  seed: number;
  /** 以无噪声正弦图最大值为基准的相对高斯噪声标准差，例如 0.01 表示 1% */
  relativeSigma: number;
}

export interface Metrics {
  rmse: number;
  /** 区域均值：真值圆/方框区域与重建区域的均值对比 */
  truthRegionMean: number;
  reconRegionMean: number;
  regionMeanDiff: number;
  maxAbsDiff: number;
  /** 投影域残差：对重建图重新前向投影后与原正弦图的相对 RMSE（无需真值也可算） */
  projectionResidualRelative?: number;
}
