import { makePhantom } from './phantoms.js';
import { Geometry, equispacedAngles } from './geometry.js';
import { project } from './projector.js';
import { reconstruct } from './reconstruction.js';

/**
 * 一次性定标脚本：在标准几何（N=64，90 角，65 通道，间距均为 1）下，
 * 用中心圆盘内部均值相对真值的比例确定 FBP 整体常数。
 * 输出建议常数；该常数与具体重建任务无关，只修正离散推导的固定尺度。
 */
const N = 64;
const g: Geometry = {
  size: N,
  pixelSpacing: 1,
  detectorSpacing: 1,
  detectorCount: N + 1,
  anglesDeg: equispacedAngles(90),
};
const { image: truth } = makePhantom('centerDisk', N);
const sino = project(truth, g);

function diskMean(img: number[][]): number {
  let s = 0;
  let c = 0;
  const half = (N - 1) / 2;
  const r = N * 0.25;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = j - half;
      const y = half - i;
      if (x * x + y * y <= (r * 0.6) ** 2) {
        s += img[i][j];
        c++;
      }
    }
  return s / c;
}

const rec = reconstruct(sino, g, { filter: 'ramlak' });
const mean = diskMean(rec.image);
console.log('calibration factor =', 1 / mean);
console.log('uncalibrated disk mean =', mean);
