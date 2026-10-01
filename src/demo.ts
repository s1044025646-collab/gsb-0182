import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "./db.js";
import { Store } from "./store.js";
import { linspaceAngles } from "./codec.js";
import { centeredDisk } from "./samples.js";
import { project } from "./projector.js";
import { reconstruct } from "./reconstruct.js";
import { rmse } from "./metrics.js";
import { validateGeometry } from "./validate.js";

function profile(img: number[][], row = img.length >> 1): string {
  const n = img.length;
  const samples = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((f) => Math.round(f * (n - 1)));
  return samples.map((c) => img[row][c].toFixed(2)).join("  ");
}

function main() {
  const dir = resolve("data-demo");
  rmSync(dir, { recursive: true, force: true });
  const store = new Store(openDb(resolve(dir, "ct.db")));
  const n = 64;

  console.log("=== 1) 三种内置样本（空白 / 中心圆盘 / 偏心双圆盘）===");
  for (const kind of ["blank", "centered-disk", "two-disks"] as const) {
    const s = store.createSample(kind, kind);
    console.log(`样本 ${kind}: id=${s.id}, n=${s.n}`);
  }

  const diskId = 2;
  const geoId = store.createGeometry("90角度", {
    ...validateGeometry({ n, detectors: 101, anglesDeg: linspaceAngles(0, 180, 90) }),
  });

  console.log("\n=== 2) 前向投影 + 固定种子噪声 + FBP / 不滤波对照 ===");
  const cleanId = store.projectSample(diskId, geoId);
  const noiseId = store.projectSample(diskId, geoId, { seed: 42, relativeSigma: 0.02 });
  const fbpId = store.runReconstruction(cleanId, { filter: "ram-lak", coverage: "full-180" });
  const unfilteredId = store.runReconstruction(cleanId, { filter: "none", coverage: "full-180" });
  const fbp = store.getReconstruction(fbpId);
  const unf = store.getReconstruction(unfilteredId);
  console.log("FBP 重建中心剖面(列20%~80%):", profile(fbp.image));
  console.log("不滤波中心剖面:             ", profile(unf.image));
  console.log("真值圆盘中心剖面:           ", profile(centeredDisk(n, 16, 1)));

  console.log("\n=== 3) 重建指标（对已知真值）===");
  console.log("干净正弦图 FBP:", JSON.stringify(store.compare(fbpId), null, 0));
  const fbpNoiseId = store.runReconstruction(noiseId, { filter: "ram-lak", coverage: "full-180" });
  console.log("2% 噪声 FBP:  ", JSON.stringify(store.compare(fbpNoiseId)));

  console.log("\n=== 4) 增加角度后的全图 RMSE 趋势（角度越多误差越小）===");
  const truth = store.getSample(diskId).matrix;
  for (const count of [8, 16, 32, 64, 128]) {
    const g = validateGeometry({ n, detectors: 101, anglesDeg: linspaceAngles(0, 180, count) });
    const rec = reconstruct(project(truth, g), g, { filter: "ram-lak", coverage: "as-is" });
    console.log(`  角度 ${String(count).padStart(3)}: RMSE=${rmse(truth, rec.image).toFixed(4)}`);
  }

  console.log("\n=== 5) 无真值导入：只能报告投影残差 ===");
  const g = store.getGeometry(geoId);
  const importId = store.importSinogram(geoId, project(truth, g));
  const importRec = store.runReconstruction(importId, { filter: "ram-lak", coverage: "full-180" });
  const cmp = store.compare(importRec);
  console.log("hasTruth=", cmp.hasTruth, " rmse=", cmp.rmse, " projectionResidualRelative=",
    cmp.projectionResidualRelative?.toFixed(4));

  console.log("\n演示数据目录:", dir);
}

main();
