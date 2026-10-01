import express, { Request, Response, NextFunction } from "express";
import { resolve } from "node:path";
import { openDb } from "./db.js";
import { Store } from "./store.js";
import { assertFiniteMatrix, validateGeometry, validateSinogramShape, ValidationError } from "./validate.js";
import { matrixToCsv } from "./codec.js";

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve("data");
const db = openDb(resolve(DATA_DIR, "ct.db"));
const store = new Store(db);

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "20mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, dataDir: DATA_DIR }));

  app.post("/samples", (req, res) => {
    const body = req.body ?? {};
    let matrix;
    if (body.kind === "custom" || body.matrix) matrix = assertFiniteMatrix(body.matrix, "matrix");
    const created = store.createSample(body.kind ?? "custom", body.name ?? body.kind ?? "sample", matrix);
    res.status(201).json(created);
  });
  app.get("/samples", (_req, res) => res.json(store.listSamples()));
  app.get("/samples/:id", (req, res) => res.json(store.getSample(Number(req.params.id))));
  app.get("/samples/:id/export", (req, res) => {
    const s = store.getSample(Number(req.params.id));
    if (req.query.format === "csv") {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.send(matrixToCsv(s.matrix));
    } else res.json({ id: s.id, name: s.name, matrix: s.matrix });
  });

  app.post("/geometries", (req, res) => {
    const g = validateGeometry(req.body ?? {});
    const id = store.createGeometry(req.body?.name ?? "geometry", g);
    res.status(201).json({ id, geometry: g });
  });
  app.get("/geometries", (_req, res) => res.json(store.listGeometries()));
  app.get("/geometries/:id", (req, res) => res.json({ id: Number(req.params.id), geometry: store.getGeometry(Number(req.params.id)) }));

  app.post("/projections/project", (req, res) => {
    const b = req.body ?? {};
    const id = store.projectSample(Number(b.sampleId), Number(b.geometryId), b.noise ?? undefined);
    res.status(201).json({ id });
  });
  app.post("/projections/import", (req, res) => {
    const b = req.body ?? {};
    const g = store.getGeometry(Number(b.geometryId));
    const sino = validateSinogramShape(b.sinogram, g);
    const id = store.importSinogram(Number(b.geometryId), sino);
    res.status(201).json({ id });
  });
  app.get("/projections", (_req, res) => res.json(store.listProjections()));
  app.get("/projections/:id", (req, res) => res.json(store.getProjection(Number(req.params.id))));

  app.post("/reconstructions", (req, res) => {
    const b = req.body ?? {};
    const opts = {
      filter: b.filter === "none" ? "none" : "ram-lak",
      coverage: b.coverage === "as-is" ? "as-is" : "full-180",
      maxGapDeg: b.maxGapDeg,
    } as const;
    const id = store.runReconstruction(Number(b.projectionId), opts);
    res.status(201).json({ id, ...opts });
  });
  app.get("/reconstructions", (_req, res) => res.json(store.listReconstructions()));
  app.get("/reconstructions/:id", (req, res) => res.json(store.getReconstruction(Number(req.params.id))));
  app.get("/reconstructions/:id/export", (req, res) => {
    const r = store.getReconstruction(Number(req.params.id));
    if (req.query.format === "csv") {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.send(matrixToCsv(r.image));
    } else res.json(r);
  });

  app.post("/comparisons", (req, res) => {
    const result = store.compare(Number(req.body?.reconstructionId));
    res.status(201).json(result);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { status?: number; message?: string };
    const status = e instanceof ValidationError ? 400 : (e?.status ?? 400);
    res.status(status).json({ error: e?.message ?? String(err) });
  });
  return app;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("dist/server.js");
if (isMain) {
  createApp().listen(PORT, () => {
    console.log(`mini-fbp-ct API 已启动: http://localhost:${PORT}  数据目录: ${DATA_DIR}`);
  });
}
