import { makePhantom } from './phantoms.js';
import { Geometry, equispacedAngles } from './geometry.js';
import { project } from './projector.js';
import { reconstruct } from './reconstruction.js';
import { rmse, regionMean, zeros2D } from './numeric.js';
import { addNoise } from './noise.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const N = 48;
const DET = 69;
const ANG = 60;

function makeGeometry(anglesDeg: number[]): Geometry {
  return { size: N, pixelSpacing: 1, detectorSpacing: 1, detectorCount: DET, anglesDeg };
}

/** 以 ASCII 折线打印矩阵中间行剖面。 */
function printProfile(label: string, row: number[], truth?: number[]): void {
  const width = 64;
  const maxV = Math.max(1e-9, ...row.map(Math.abs), ...(truth ?? []).map(Math.abs));
  console.log(`\n${label}（横向=列索引，纵向=数值，满刻度 ${maxV.toFixed(2)}）`);
  for (let x = 0; x < width; x++) {
    const f = (x / (width - 1)) * (row.length - 1);
    const k0 = Math.floor(f);
    const t = f - k0;
    const v = row[k0] * (1 - t) + row[Math.min(k0 + 1, row.length - 1)] * t;
    const tv = truth
      ? truth[k0] * (1 - t) + truth[Math.min(k0 + 1, row.length - 1)] * t
      : undefined;
    const col = Math.round((v / maxV) * 28);
    const tcol = tv != null ? Math.round((tv / maxV) * 28) : -1;
    const line = new Array(30).fill(' ');
    line[Math.max(0, Math.min(29, col))] = '*';
    if (tcol >= 0 && line[tcol] === ' ') line[tcol] = '+';
    process.stdout.write('|' + line.join('') + '|\n');
  }
  console.log('(* = 重建, + = 真值)');
}

function main(): void {
  console.log('=== 平行束 CT 离线数值演示 ===');
  console.log(`固定参数: N=${N}（边长，单位长度），探测器通道=${DET}（间距=1），角度=${ANG} 个，linspace(0,180-180/n,n)`);

  // 1) 零输入保持为零
  const blank = zeros2D(N, N);
  const g = makeGeometry(equispacedAngles(ANG));
  const sBlank = project(blank, g);
  const rBlank = reconstruct(sBlank, g, { filter: 'ramlak' });
  const blankMax = Math.max(...rBlank.image.flat().map(Math.abs));
  console.log(`\n[1] 空白图：前向投影最大绝对值=${Math.max(...sBlank.flat())}，FBP 重建最大绝对值=${blankMax.toExponential(2)}（应=0）`);

  // 2) 中心圆盘，FBP vs 不滤波
  const { image: truth } = makePhantom('centerDisk', N);
  const sino = project(truth, g);
  const fbp = reconstruct(sino, g, { filter: 'ramlak' });
  const plain = reconstruct(sino, g, { filter: 'none' });
  const c = Math.floor((N - 1) / 2);
  const rmseFbp = rmse(fbp.image, truth);
  const rmsePlain = rmse(plain.image, truth);
  const meanTruth = regionMean(truth, c - 3, c + 3, c - 3, c + 3);
  const meanFbp = regionMean(fbp.image, c - 3, c + 3, c - 3, c + 3);
  console.log('\n[2] 中心圆盘（真值内部=1，外部=0）');
  console.log(`    FBP  RMSE=${rmseFbp.toFixed(4)}  中心 7x7 均值=${meanFbp.toFixed(3)}（真值 ${meanTruth.toFixed(3)}）`);
  console.log(`    不滤波反投影 RMSE=${rmsePlain.toFixed(4)}（1/r 模糊导致数值发散，对照用）`);
  printProfile('中心行剖面 FBP', fbp.image[c], truth[c]);

  // 3) 角度增加的误差趋势
  console.log('\n[3] 角度数 → FBP RMSE（应随角度增加总体下降）');
  let prev = Infinity;
  for (const na of [16, 30, 60]) {
    const gg = makeGeometry(equispacedAngles(na));
    const e = rmse(reconstruct(project(truth, gg), gg, { filter: 'ramlak' }).image, truth);
    console.log(`    angles=${na}: RMSE=${e.toFixed(4)}`);
    if (na === 60 && e >= 0.08) throw new Error('60 角 RMSE 超出阈值 0.08');
    if (na === 30 && e >= prev) throw new Error('30 角未优于 16 角');
    prev = e;
  }

  // 4) 固定种子噪声可复现
  const noisy1 = addNoise(sino, 42, 0.05);
  const noisy2 = addNoise(sino, 42, 0.05);
  const same = JSON.stringify(noisy1) === JSON.stringify(noisy2);
  const fbpNoisy = reconstruct(noisy1, g, { filter: 'ramlak' });
  console.log(`\n[4] 固定种子噪声：同种子逐元素一致=${same}；含噪 FBP RMSE=${rmse(fbpNoisy.image, truth).toFixed(4)}`);

  // 5) 几何镜像关系：theta=0 投影 u=y（圆盘关于 y 对称→关于中心通道对称）；
  //    theta=90° 投影 u=-x，同一中心圆盘投影应与 theta=0 完全一致（对称物体）。
  const gMirror: Geometry = { ...g, anglesDeg: [0, 90] };
  const sMirror = project(truth, gMirror);
  const row0 = sMirror[0];
  let maxAsym = 0;
  for (let k = 0; k < DET; k++) maxAsym = Math.max(maxAsym, Math.abs(row0[k] - row0[DET - 1 - k]));
  let maxMirrorDiff = 0;
  for (let k = 0; k < DET; k++) maxMirrorDiff = Math.max(maxMirrorDiff, Math.abs(sMirror[0][k] - sMirror[1][k]));
  console.log(`\n[5] 几何镜像：theta=0 行中心对称最大偏差=${maxAsym.toExponential(2)}；theta=0 与 theta=90 行最大偏差=${maxMirrorDiff.toExponential(2)}（中心圆盘应≈0）`);

  // 6) 偏心双圆盘
  const two = makePhantom('offsetTwoDisks', N);
  const sTwo = project(two.image, g);
  const rTwo = reconstruct(sTwo, g, { filter: 'ramlak' });
  console.log(`\n[6] 偏心双圆盘 FBP RMSE=${rmse(rTwo.image, two.image).toFixed(4)}`);
  printProfile('偏心双圆盘中心行剖面', rTwo.image[c], two.image[c]);

  // 7) 导出 CSV 往返
  const outDir = resolve('data', 'demo');
  mkdirSync(outDir, { recursive: true });
  const csv = fbp.image.map((row) => row.join(',')).join('\n');
  writeFileSync(resolve(outDir, 'fbp_center_disk.csv'), csv, 'utf8');
  console.log(`\n[7] 已导出 ${resolve(outDir, 'fbp_center_disk.csv')}`);
}

main();
