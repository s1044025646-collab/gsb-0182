import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertFiniteMatrix, validateGeometry, validateSinogramShape, ValidationError,
} from "../validate.js";
import { blank, centeredDisk } from "../samples.js";
import { project } from "../projector.js";
import { reconstruct } from "../reconstruct.js";
import { addNoise, projectionResidual, rmse } from "../metrics.js";
import { linspaceAngles, csvToMatrix, matrixToCsv } from "../codec.js";
import { openDb } from "../db.js";
import { Store } from "../store.js";

const N = 48;
function geo(over: Partial<{ angles: number; detectors: number; anglesDeg: number[] }> = {}) {
  return validateGeometry({
    n: N,
    detectors: over.detectors ?? 81,
    anglesDeg: over.anglesDeg ?? linspaceAngles(0, 180, over.angles ?? 60),
  });
}

test("零输入保持为零（空白图投影与重建均为零）", () => {
  const g = geo();
  const sino = project(blank(N), g);
  assert.ok(sino.every((row) => row.every((v) => v === 0)));
  const rec = reconstruct(sino, g, { filter: "ram-lak", coverage: "as-is" });
  assert.ok(rec.image.every((row) => row.every((v) => v === 0)));
});

test("固定参数中心圆盘 FBP 的可复核误差阈值", () => {
  const g = geo({ angles: 90, detectors: 101 });
  const truth = centeredDisk(N, 12, 1);
  const rec = reconstruct(project(truth, g), g, { filter: "ram-lak", coverage: "as-is" });
  const e = rmse(truth, rec.image);
  assert.ok(e < 0.08, `全图 RMSE 应小于 0.08，实际 ${e}`);
  // 圆盘内部均值应接近真值 1
  let s = 0, c = 0;
  for (let r = 0; r < N; r++) for (let col = 0; col < N; col++)
    if (truth[r][col] > 0.5) { s += rec.image[r][col]; c++; }
  assert.ok(Math.abs(s / c - 1) < 0.08, `内部均值偏差过大: ${s / c}`);
});

test("几何镜像关系：关于 y 轴对称的真值满足 p(θ,t)=p(180°−θ,t)；θ=0 时水平镜像等价于通道逆序", () => {
  const truth = blank(N);
  const g = validateGeometry({ n: N, detectors: 81, anglesDeg: [0, 30, 45, 135, 150, 180] });
  const stamp = (cx: number, cy: number, rad: number, mu: number) => {
    const cc = (N - 1) / 2;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const x = c - cc, y = cc - r;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) truth[r][c] = mu;
    }
  };
  stamp(0, 0, 7, 1);
  stamp(-12, 6, 4, 0.7);
  stamp(12, 6, 4, 0.7);
  const sino = project(truth, g);
  const at = (deg: number) => sino[g.anglesDeg.indexOf(deg)];
  for (const deg of [30, 45]) {
    const p = at(deg);
    const q = at(180 - deg);
    for (let k = 0; k < p.length; k++)
      assert.ok(Math.abs(p[k] - q[k]) < 1e-9, `p(${deg}) 与 p(${180 - deg}) 不对称`);
  }
  for (let k = 0; k < 81; k++)
    assert.ok(Math.abs(at(0)[k] - at(180)[80 - k]) < 1e-9);
});

test("增加角度后误差总体下降（64 角优于 8 角）", () => {
  const truth = centeredDisk(N, 12, 1);
  const e8 = rmse(truth, reconstruct(project(truth, geo({ angles: 8 })), geo({ angles: 8 }),
    { filter: "ram-lak", coverage: "as-is" }).image);
  const e64 = rmse(truth, reconstruct(project(truth, geo({ angles: 64 })), geo({ angles: 64 }),
    { filter: "ram-lak", coverage: "as-is" }).image);
  assert.ok(e64 < e8, `期望 e64(${e64}) < e8(${e8})`);
});

test("滤波优于不滤波对照", () => {
  const g = geo({ angles: 90 });
  const truth = centeredDisk(N, 12, 1);
  const sino = project(truth, g);
  const eF = rmse(truth, reconstruct(sino, g, { filter: "ram-lak", coverage: "as-is" }).image);
  const eN = rmse(truth, reconstruct(sino, g, { filter: "none", coverage: "as-is" }).image);
  assert.ok(eF < eN, `FBP(${eF}) 应优于不滤波(${eN})`);
});

test("固定种子噪声可复现，且噪声增大投影残差", () => {
  const g = geo();
  const truth = centeredDisk(N, 12, 1);
  const sino = project(truth, g);
  const a = addNoise(sino, { seed: 7, relativeSigma: 0.05 });
  const b = addNoise(sino, { seed: 7, relativeSigma: 0.05 });
  assert.deepEqual(a, b);
  const cleanRes = projectionResidual(
    reconstruct(sino, g, { filter: "ram-lak", coverage: "as-is" }).image, sino, g);
  const noiseRes = projectionResidual(
    reconstruct(a, g, { filter: "ram-lak", coverage: "as-is" }).image, sino, g);
  assert.ok(noiseRes > cleanRes);
});

test("无真值导入：compare 不编造 RMSE，但给出投影残差", () => {
  const dir = mkTmp();
  const store = new Store(openDb(join(dir, "ct.db")));
  const gid = store.createGeometry("g", geo({ angles: 60 }));
  const pid = store.importSinogram(gid, project(centeredDisk(N, 10, 1), store.getGeometry(gid)));
  const rid = store.runReconstruction(pid, { filter: "ram-lak", coverage: "as-is" });
  const m = store.compare(rid);
  assert.equal(m.hasTruth, false);
  assert.ok(Number.isNaN(m.rmse));
  assert.ok((m.projectionResidualRelative ?? 1) < 0.06);
});

test("CSV 往返一致", () => {
  const m = centeredDisk(6, 2, 1.5);
  const back = csvToMatrix(matrixToCsv(m));
  assert.equal(back.length, 6);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++)
    assert.ok(Math.abs(back[r][c] - m[r][c]) < 1e-8);
});

test("完整投影→导入→重建→导出快照在重启后仍可查询", () => {
  const dir = mkTmp();
  const path = join(dir, "ct.db");
  const s1 = new Store(openDb(path));
  const sid = s1.createSample("custom", "d", centeredDisk(N, 12, 1)).id;
  const gid = s1.createGeometry("g", geo({ angles: 30 }));
  const pid = s1.projectSample(sid, gid);
  const rid = s1.runReconstruction(pid, { filter: "ram-lak", coverage: "as-is" });
  const before = s1.getReconstruction(rid).image;
  const s2 = new Store(openDb(path)); // 重开连接模拟重启
  const after = s2.getReconstruction(rid).image;
  assert.deepEqual(after, before);
  assert.equal(s2.getSample(sid).name, "d");
});

test("拒绝非有限数、尺寸不匹配、重复角度、越界形状", () => {
  assert.throws(() => assertFiniteMatrix([[1, NaN], [0, 1]]), ValidationError);
  assert.throws(() => assertFiniteMatrix([[1, 0, 0], [0, 1, 0]]), ValidationError); // 非方形
  assert.throws(() => validateGeometry({ n: N, detectors: 5, anglesDeg: [0, 0] }), ValidationError);
  assert.throws(() => validateGeometry({ n: 2, detectors: 5, anglesDeg: [0] }), ValidationError);
  const g = geo();
  assert.throws(() => validateSinogramShape([new Array(g.detectors - 1).fill(0)], g), ValidationError);
  assert.throws(() => validateSinogramShape([new Array(g.detectors).fill(Infinity)], g), ValidationError);
});

test("极少角度：可运行但明确有限角，full-180 拒绝、as-is 放行", () => {
  const g = validateGeometry({ n: N, detectors: 41, anglesDeg: [0, 4] });
  const sino = project(centeredDisk(N, 10, 1), g);
  assert.throws(() => reconstruct(sino, g, { filter: "ram-lak", coverage: "full-180" }), ValidationError);
  const rec = reconstruct(sino, g, { filter: "ram-lak", coverage: "as-is" });
  assert.equal(rec.image.length, N); // 不补全，伪影由调用方知晓
});

test("越界采样零延拓：圆盘外探测器通道投影为零", () => {
  const g = validateGeometry({ n: N, detectors: 51, anglesDeg: [0] });
  const sino = project(centeredDisk(N, 8, 1), g);
  assert.equal(sino[0][0], 0);
  assert.equal(sino[0][50], 0);
  assert.ok(sino[0][25] > 0);
});

function mkTmp(): string {
  const dir = resolve(tmpdir(), `fbpct-${Math.random().toString(36).slice(2)}`);
  rmSync(dir, { recursive: true, force: true });
  return dir;
}
