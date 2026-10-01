import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePhantom } from '../phantoms.js';
import { Geometry, equispacedAngles, validateGeometry } from '../geometry.js';
import { project } from '../projector.js';
import { reconstruct } from '../reconstruction.js';
import { zeros2D, rmse } from '../numeric.js';
import { checkAngularCoverage } from '../service.js';

const N = 48;
const DET = 69;
function geom(anglesDeg: number[], det = DET): Geometry {
  return { size: N, pixelSpacing: 1, detectorSpacing: 1, detectorCount: det, anglesDeg };
}

test('空白图前向投影与 FBP 重建严格为零', () => {
  const g = geom(equispacedAngles(60));
  const sino = project(zeros2D(N, N), g);
  assert.equal(Math.max(...sino.flat().map(Math.abs)), 0);
  const rec = reconstruct(sino, g, { filter: 'ramlak' });
  assert.equal(Math.max(...rec.image.flat().map(Math.abs)), 0);
});

test('中心圆盘 FBP 在固定参数下达到可复核误差阈值', () => {
  const { image: truth } = makePhantom('centerDisk', N);
  const g = geom(equispacedAngles(60));
  const rec = reconstruct(project(truth, g), g, { filter: 'ramlak' });
  const e = rmse(rec.image, truth);
  assert.ok(e < 0.08, `期望 RMSE<0.08，实际 ${e}`);
  // 圆盘内部应接近真值 1
  const c = (N - 1) / 2;
  assert.ok(Math.abs(rec.image[Math.floor(c)][Math.floor(c)] - 1) < 0.15);
});

test('增加角度数量总体降低误差（16 角差，60 角好）', () => {
  const { image: truth } = makePhantom('centerDisk', N);
  const e16 = rmse(reconstruct(project(truth, geom(equispacedAngles(16))), geom(equispacedAngles(16)), { filter: 'ramlak' }).image, truth);
  const e60 = rmse(reconstruct(project(truth, geom(equispacedAngles(60))), geom(equispacedAngles(60)), { filter: 'ramlak' }).image, truth);
  assert.ok(e16 > 0.1, `16 角 RMSE 应明显偏大，实际 ${e16}`);
  assert.ok(e60 < e16, `60 角(${e60}) 应优于 16 角(${e16})`);
});

test('几何镜像关系：中心圆盘 theta=0 与 theta=90 投影一致，且每行关于中心通道对称', () => {
  const { image: truth } = makePhantom('centerDisk', N);
  const g = geom([0, 90]);
  const s = project(truth, g);
  for (let k = 0; k < DET; k++) {
    assert.ok(Math.abs(s[0][k] - s[0][DET - 1 - k]) < 1e-12);
    assert.ok(Math.abs(s[0][k] - s[1][k]) < 1e-10);
  }
});

test('偏心双圆盘破坏镜像：theta=0 与 theta=90 投影不同', () => {
  const { image } = makePhantom('offsetTwoDisks', N);
  const s = project(image, geom([0, 90]));
  let d = 0;
  for (let k = 0; k < DET; k++) d = Math.max(d, Math.abs(s[0][k] - s[1][k]));
  assert.ok(d > 0.01);
});

test('滤波反投影显著优于不滤波反投影', () => {
  const { image: truth } = makePhantom('centerDisk', N);
  const g = geom(equispacedAngles(60));
  const sino = project(truth, g);
  const eFbp = rmse(reconstruct(sino, g, { filter: 'ramlak' }).image, truth);
  const ePlain = rmse(reconstruct(sino, g, { filter: 'none' }).image, truth);
  assert.ok(ePlain > 10 * eFbp);
});

test('缺角数据默认拒绝，allow-sparse 显式放行且不补角', () => {
  const angles = [0, 10, 20, 30, 40]; // 只覆盖 40°
  assert.throws(() => checkAngularCoverage(angles, 'reject'), /缺角|拒绝/);
  const r = checkAngularCoverage(angles, 'allow-sparse');
  assert.equal(r.accepted, false);
});

test('重复或非递增角度被拒绝', () => {
  assert.throws(() => validateGeometry(geom([0, 10, 10, 30])), /重复|递增/);
  assert.throws(() => validateGeometry(geom([30, 20, 10])), /递增/);
});

test('极少角度（仅 1 个）被拒绝', () => {
  assert.throws(() => validateGeometry(geom([0])), /至少需要 2 个/);
});

test('非有限数元素被拒绝', () => {
  const bad = zeros2D(N, N);
  bad[3][4] = NaN;
  assert.throws(() => project(bad, geom(equispacedAngles(8))), /有限数/);
});

test('图像与几何尺寸不匹配被拒绝', () => {
  const { image } = makePhantom('centerDisk', 32);
  assert.throws(() => project(image, geom(equispacedAngles(8))), /不匹配/);
});

test('探测器不足时报告越界采样；充足探测器零越界', () => {
  const { image: truth } = makePhantom('centerDisk', N);
  const gWide = geom(equispacedAngles(30), DET);
  assert.equal(reconstruct(project(truth, gWide), gWide, { filter: 'ramlak' }).outOfRangeSamples, 0);
  const gNarrow = geom(equispacedAngles(30), 11);
  assert.ok(reconstruct(project(truth, gNarrow), gNarrow, { filter: 'ramlak' }).outOfRangeSamples > 0);
});

test('零填充长度为不小于 2 倍通道数的 2 的幂', () => {
  const { image: truth } = makePhantom('centerDisk', N);
  const g = geom(equispacedAngles(20));
  const res = reconstruct(project(truth, g), g, { filter: 'ramlak' });
  assert.ok(res.padLength >= 2 * DET);
  assert.ok(Number.isInteger(Math.log2(res.padLength)));
});
