import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Store } from '../db.js';
import {
  compareReconstruction,
  createBuiltinSample,
  importSample,
  importSinogram,
  projectSample,
  reconstructScan,
} from '../service.js';
import { equispacedAngles } from '../geometry.js';
import { makePhantom } from '../phantoms.js';
import { project } from '../projector.js';
import { parseCsv, toCsv, parseMatrixJson } from '../io.js';

const dir = resolve(tmpdir(), `ct-test-${process.pid}`);
let store: Store;

before(() => {
  rmSync(dir, { recursive: true, force: true });
  store = new Store(resolve(dir, 'ct.sqlite'));
});
after(() => {
  store.close();
});

test('快照不可变：不同角度产生不同 scan 与重建，旧结果仍可查询', () => {
  const sample = createBuiltinSample(store, 'centerDisk', 32);
  const base = { size: 32, pixelSpacing: 1, detectorSpacing: 1, detectorCount: 47 };
  const scanA = projectSample(store, sample.id, { ...base, anglesDeg: equispacedAngles(20) }, null);
  const scanB = projectSample(store, sample.id, { ...base, anglesDeg: equispacedAngles(40) }, null);
  assert.notEqual(scanA.id, scanB.id);
  const recA = reconstructScan(store, scanA.id, 'ramlak', 'reject');
  const recB = reconstructScan(store, scanB.id, 'ramlak', 'reject');
  assert.ok(store.getReconstruction(recA.row.id));
  assert.ok(store.getReconstruction(recB.row.id));
  // JSON 往返后矩阵一致
  assert.deepEqual(parseMatrixJson(JSON.stringify(recA.row.image)), recA.row.image);
});

test('参数变化（噪声）生成新快照且固定种子可复现', () => {
  const sample = createBuiltinSample(store, 'blank', 16);
  const geometry = { size: 16, pixelSpacing: 1, detectorSpacing: 1, detectorCount: 23, anglesDeg: equispacedAngles(12) };
  const s1 = projectSample(store, sample.id, geometry, { seed: 7, sigma: 0.1 });
  const s2 = projectSample(store, sample.id, geometry, { seed: 7, sigma: 0.1 });
  const s3 = projectSample(store, sample.id, geometry, { seed: 8, sigma: 0.1 });
  assert.notEqual(s1.id, s2.id);
  assert.deepEqual(s1.sinogram, s2.sinogram);
  assert.notDeepEqual(s1.sinogram, s3.sinogram);
});

test('CSV/JSON 导入导出让正弦图往返一致；仅知正弦图即可重建并给出投影残差', () => {
  const N = 32;
  const { image } = makePhantom('offsetTwoDisks', N);
  const geometry = { size: N, pixelSpacing: 1, detectorSpacing: 1, detectorCount: 47, anglesDeg: equispacedAngles(30) };
  const sino = project(image, geometry);

  const csv = toCsv(sino);
  const fromCsv = parseCsv(csv);
  assert.deepEqual(fromCsv, sino);
  const fromJson = parseMatrixJson(JSON.stringify({ sinogram: sino }));
  assert.deepEqual(fromJson, sino);

  const scan = importSinogram(store, geometry, fromCsv, 'roundtrip');
  assert.equal(scan.sample_id, null);
  const rec = reconstructScan(store, scan.id, 'ramlak', 'reject');
  const cmp = compareReconstruction(store, rec.row.id);
  assert.equal(cmp.hasTruth, false);
  assert.equal(cmp.comparison.rmse, null);
  assert.ok(cmp.comparison.projection_residual_rms >= 0);
});

test('非方形样本导入被拒绝', () => {
  assert.throws(() => importSample(store, 'bad', [[1, 2, 3], [4, 5, 6]]), /方形/);
});

test('正弦图与角度数不匹配被拒绝', () => {
  const geometry = { size: 8, pixelSpacing: 1, detectorSpacing: 1, detectorCount: 11, anglesDeg: equispacedAngles(10) };
  const sino = Array.from({ length: 9 }, () => new Array(11).fill(0));
  assert.throws(() => importSinogram(store, geometry, sino), /不匹配/);
});

test('有真值时报告 RMSE 与区域均值', () => {
  const sample = createBuiltinSample(store, 'centerDisk', 24);
  const geometry = { size: 24, pixelSpacing: 1, detectorSpacing: 1, detectorCount: 35, anglesDeg: equispacedAngles(40) };
  const scan = projectSample(store, sample.id, geometry, null);
  const rec = reconstructScan(store, scan.id, 'ramlak', 'reject');
  const cmp = compareReconstruction(store, rec.row.id);
  assert.equal(cmp.hasTruth, true);
  assert.ok(cmp.comparison.rmse !== null && cmp.comparison.rmse < 0.1);
});

test('重启后旧实验仍可查询（重新打开同一数据库文件）', () => {
  store.close();
  const reopened = new Store(resolve(dir, 'ct.sqlite'));
  assert.ok(reopened.listSamples().length > 0);
  assert.ok(reopened.listScans().length > 0);
  reopened.close();
});
