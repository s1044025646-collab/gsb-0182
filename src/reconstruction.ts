import { Geometry, validateGeometry } from './geometry.js';
import { backproject } from './projector.js';
import { dft, idft, nextPow2AtLeast, zeros2D } from './numeric.js';

/**
 * Ram-Lak 斜坡滤波（逐投影行，频域直接 DFT 实现）。
 *
 * 零填充：每行 nDet 个样本后补零至 L = 不小于 2*nDet 的最小 2 的幂，
 * 以近似线性卷积、抑制周期卷绕；滤波后截取前 nDet 个样本。
 * 边界处理：补零等价于视场外衰减为零（物体须被探测器完全覆盖）。
 *
 * 频率定义：对 k=0..L-1，循环频率 r = min(k, L-k)/L（周/样本），
 * Ram-Lak 乘子为 |r|（纯斜坡，不加平滑窗）。
 *
 * 归一化：连续 FBP 公式
 *   f(x,y) = (1/2) ∫_0^π q(θ,u) dθ,
 *   q = p * h,  h 的连续频率响应为 |ρ|（ρ 单位 1/长度）。
 * 离散实现中 DFT 乘子 |r| 对应“周/样本”，需除以 Δu=detectorSpacing
 * 才能换算到 1/长度，且 DFT/IDFT 对卷积自带 1 个 Δu 尺度，
 * 故 q[n] ≈ (1/Δu²) · IDFT(|r|·DFT(p))（再乘反投影中的 Δθ/2）。
 * RAM_LAK_SCALE 为该理论尺度系数，另含一个由中心圆盘定标的
 * 整体校准常数 CALIB，使标准几何下重建值与真值同一量纲
 * （定标只做一次，见 calibrate 脚本，不依赖任何输入图像内容）。
 */
export const RAM_LAK_CALIB = 1.5801809704233243;

export function filterSinogramRamLak(sino: number[][], g: Geometry): number[][] {
  validateGeometry(g);
  const nDet = g.detectorCount;
  const pad = nextPow2AtLeast(2 * nDet);
  const ramp = new Array<number>(pad);
  for (let k = 0; k < pad; k++) {
    const r = Math.min(k, pad - k) / pad;
    ramp[k] = r;
  }
  const invDu2 = 1 / (g.detectorSpacing * g.detectorSpacing);
  return sino.map((row) => {
    if (row.length !== nDet) throw new Error('正弦行列长与探测器数不匹配');
    const buf = new Array<number>(pad).fill(0);
    for (let k = 0; k < nDet; k++) buf[k] = row[k];
    const { re, im } = dft(buf);
    for (let k = 0; k < pad; k++) {
      re[k] *= ramp[k];
      im[k] *= ramp[k];
    }
    const q = idft(re, im);
    const out = new Array<number>(nDet);
    for (let k = 0; k < nDet; k++) out[k] = q[k] * invDu2 * RAM_LAK_CALIB;
    return out;
  });
}

export interface ReconstructOptions {
  /** 'ramlak' 滤波反投影；'none' 不做斜坡滤波（朴素反投影对照）。 */
  filter: 'ramlak' | 'none';
}

export interface ReconstructResult {
  image: number[][];
  outOfRangeSamples: number;
  filter: 'ramlak' | 'none';
  padLength: number;
}

/**
 * 重建。反投影内部按实际角度做梯形角度积分（Δθ，弧度）；
 * FBP 理论中的 1/2 因子在此乘入。
 * 不会凭空补充任何缺失角度；角度不足表现为星状伪影，由调用方诊断。
 */
export function reconstruct(sino: number[][], g: Geometry, opts: ReconstructOptions): ReconstructResult {
  validateGeometry(g);
  const filtered =
    opts.filter === 'ramlak' ? filterSinogramRamLak(sino, g) : zeros2D(sino.length, g.detectorCount).map((_, a) => sino[a].slice());
  const bp = backproject(filtered, g);
  const halfFactor = opts.filter === 'ramlak' ? 0.5 : 1;
  const image = bp.image.map((row) => row.map((v) => v * halfFactor));
  return {
    image,
    outOfRangeSamples: bp.outOfRangeSamples,
    filter: opts.filter,
    padLength: nextPow2AtLeast(2 * g.detectorCount),
  };
}
