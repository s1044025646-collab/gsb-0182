import { mulberry32, gaussianNoise } from './numeric.js';

/**
 * 对正弦图加固定种子的加性高斯噪声（噪声加在线积分值上）。
 * @param seed 整数种子，相同种子 + 相同输入得到逐元素一致的结果
 * @param sigma 噪声标准差，量纲与投影值相同（衰减系数 × 单位长度）
 */
export function addNoise(sino: number[][], seed: number, sigma: number): number[][] {
  if (!(sigma >= 0)) throw new Error('sigma 必须是非负数');
  const n = sino.reduce((acc, row) => acc + row.length, 0);
  const eps = gaussianNoise(mulberry32(seed), n, sigma);
  let ptr = 0;
  return sino.map((row) => row.map((v) => v + eps[ptr++]));
}
