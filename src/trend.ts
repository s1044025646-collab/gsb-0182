import { makePhantom } from './phantoms.js';
import { Geometry, equispacedAngles } from './geometry.js';
import { project } from './projector.js';
import { reconstruct } from './reconstruction.js';
import { rmse } from './numeric.js';

/**
 * 独立的角度数-误差趋势小工具：
 * npx tsx src/trend.ts
 */
const N = 64;
const { image: truth } = makePhantom('centerDisk', N);
for (const nAng of [16, 30, 60, 90, 120]) {
  const g: Geometry = {
    size: N,
    pixelSpacing: 1,
    detectorSpacing: 1,
    detectorCount: 93,
    anglesDeg: equispacedAngles(nAng),
  };
  const sino = project(truth, g);
  const fb = reconstruct(sino, g, { filter: 'ramlak' });
  const bp = reconstruct(sino, g, { filter: 'none' });
  console.log(
    `angles=${nAng}  FBP rmse=${rmse(fb.image, truth).toFixed(4)}  BP rmse=${rmse(bp.image, truth).toFixed(4)}  oob=${fb.outOfRangeSamples}`,
  );
}
