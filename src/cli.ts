#!/usr/bin/env node
import { resolve } from "node:path";
import { openDb } from "./db.js";
import { Store } from "./store.js";
import { readMatrixFile, writeMatrixFile, linspaceAngles } from "./codec.js";
import { ValidationError } from "./validate.js";

/**
 * 用法示例：
 *   fbpct sample --kind centered-disk --name disk
 *   fbpct sample --import truth.json --name mine
 *   fbpct geometry --n 64 --detectors 101 --angles 90
 *   fbpct project --sample 1 --geometry 1 [--seed 42 --noise 0.01]
 *   fbpct import --geometry 1 --file sino.csv
 *   fbpct reconstruct --projection 1 [--filter ram-lak|none] [--as-is]
 *   fbpct compare --reconstruction 1
 *   fbpct export --reconstruction 1 --out rec.csv
 *   fbpct list samples|geometries|projections|reconstructions
 */
function arg(args: string[], key: string): string | undefined {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const dataDir = resolve(arg(args, "--data-dir") ?? "data");
  const db = openDb(resolve(dataDir, "ct.db"));
  const store = new Store(db);

  try {
    switch (cmd) {
      case "sample": {
        const importPath = arg(args, "--import");
        if (importPath) {
          const matrix = readMatrixFile(importPath);
          const r = store.createSample("custom", arg(args, "--name") ?? importPath, matrix);
          console.log(JSON.stringify(r));
        } else {
          const kind = arg(args, "--kind") ?? "centered-disk";
          const r = store.createSample(kind, arg(args, "--name") ?? kind);
          console.log(JSON.stringify(r));
        }
        break;
      }
      case "geometry": {
        const n = Number(arg(args, "--n") ?? "64");
        const detectors = Number(arg(args, "--detectors") ?? "101");
        const count = Number(arg(args, "--angles") ?? "90");
        const explicit = arg(args, "--angles-deg");
        const anglesDeg = explicit
          ? explicit.split(",").map(Number)
          : linspaceAngles(0, 180, count);
        const g = {
          n, detectors, anglesDeg,
          pixelSize: Number(arg(args, "--pixel-size") ?? "1"),
          detectorSpacing: Number(arg(args, "--detector-spacing") ?? "1"),
          rayStepPixels: Number(arg(args, "--ray-step") ?? "1"),
        };
        const id = store.createGeometry(arg(args, "--name") ?? `geo-${n}`, g);
        console.log(JSON.stringify({ id }));
        break;
      }
      case "project": {
        const sampleId = Number(arg(args, "--sample"));
        const geometryId = Number(arg(args, "--geometry"));
        const seed = Number(arg(args, "--seed") ?? "1");
        const noise = Number(arg(args, "--noise") ?? "0");
        const id = store.projectSample(sampleId, geometryId,
          noise > 0 ? { seed, relativeSigma: noise } : undefined);
        console.log(JSON.stringify({ id }));
        break;
      }
      case "import": {
        const geometryId = Number(arg(args, "--geometry"));
        const file = arg(args, "--file");
        if (!file) throw new Error("需要 --file");
        const matrix = readMatrixFile(file);
        const id = store.importSinogram(geometryId, matrix);
        console.log(JSON.stringify({ id }));
        break;
      }
      case "reconstruct": {
        const projectionId = Number(arg(args, "--projection"));
        const id = store.runReconstruction(projectionId, {
          filter: arg(args, "--filter") === "none" ? "none" : "ram-lak",
          coverage: args.includes("--as-is") ? "as-is" : "full-180",
        });
        console.log(JSON.stringify({ id }));
        break;
      }
      case "compare": {
        const reconstructionId = Number(arg(args, "--reconstruction"));
        console.log(JSON.stringify(store.compare(reconstructionId), null, 2));
        break;
      }
      case "export": {
        const rid = arg(args, "--reconstruction");
        const sid = arg(args, "--sample");
        const pid = arg(args, "--projection");
        const out = arg(args, "--out");
        if (!out) throw new Error("需要 --out");
        const m = rid
          ? store.getReconstruction(Number(rid)).image
          : sid
            ? store.getSample(Number(sid)).matrix
            : pid
              ? store.getProjection(Number(pid)).sinogram
              : null;
        if (!m) throw new Error("需要 --reconstruction、--sample 或 --projection");
        writeMatrixFile(out, m);
        console.log(`已导出 ${m.length}×${m.length} -> ${out}`);
        break;
      }
      case "list": {
        const what = args[1] ?? "samples";
        const table: Record<string, () => unknown> = {
          samples: () => store.listSamples(),
          geometries: () => store.listGeometries(),
          projections: () => store.listProjections(),
          reconstructions: () => store.listReconstructions(),
        };
        if (!table[what]) throw new Error(`未知列表: ${what}`);
        console.log(JSON.stringify(table[what](), null, 2));
        break;
      }
      default:
        console.log("命令: sample | geometry | project | import | reconstruct | compare | export | list");
        process.exitCode = 1;
    }
  } catch (err) {
    const msg = err instanceof ValidationError ? err.message : (err as Error).message;
    console.error("错误:", msg);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
