import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { Store } from './db.js';
import { toCsv } from './io.js';
import {
  compareReconstruction,
  createBuiltinSample,
  GapPolicy,
  importSample,
  importSinogram,
  projectSample,
  reconstructScan,
} from './service.js';

const PORT = Number(process.env.PORT ?? 8182);
const DATA_DIR = process.env.CT_DATA_DIR ?? resolve('data');
const DB_PATH = resolve(DATA_DIR, 'ct.sqlite');

const store = new Store(DB_PATH);

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
}

function sendCsv(res: ServerResponse, filename: string, csv: string): void {
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
  });
  res.end(csv);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const p = url.pathname;
  try {
    // 健康检查与几何约定说明
    if (req.method === 'GET' && p === '/api/health') {
      return send(res, 200, { ok: true, db: DB_PATH });
    }

    // 样本
    if (req.method === 'POST' && p === '/api/samples/builtin') {
      const b = await readJson(req);
      const row = createBuiltinSample(store, b.kind, b.size ?? 64, b.name);
      return send(res, 201, row);
    }
    if (req.method === 'POST' && p === '/api/samples/import') {
      const b = await readJson(req);
      const row = importSample(store, b.name ?? 'imported', b.image ?? b.matrix);
      return send(res, 201, row);
    }
    if (req.method === 'GET' && p === '/api/samples') {
      return send(res, 200, store.listSamples());
    }
    if (req.method === 'GET' && p.startsWith('/api/samples/')) {
      const id = Number(p.split('/').pop());
      const row = store.getSample(id);
      return row ? send(res, 200, row) : send(res, 404, { error: '样本不存在' });
    }

    // 投影
    if (req.method === 'POST' && p === '/api/scans/project') {
      const b = await readJson(req);
      const row = projectSample(store, b.sampleId, b.geometry, b.noise ?? null);
      return send(res, 201, row);
    }
    if (req.method === 'POST' && p === '/api/scans/import-sinogram') {
      const b = await readJson(req);
      const row = importSinogram(store, b.geometry, b.sinogram, b.note);
      return send(res, 201, row);
    }
    if (req.method === 'GET' && p === '/api/scans') {
      return send(res, 200, store.listScans());
    }
    if (req.method === 'GET' && p.startsWith('/api/scans/') && p.endsWith('/sinogram.csv')) {
      const id = Number(p.split('/')[3]);
      const row = store.getScan(id);
      return row ? sendCsv(res, `sinogram_${id}.csv`, toCsv(row.sinogram)) : send(res, 404, { error: '扫描不存在' });
    }
    if (req.method === 'GET' && p.startsWith('/api/scans/')) {
      const id = Number(p.split('/').pop());
      const row = store.getScan(id);
      return row ? send(res, 200, row) : send(res, 404, { error: '扫描不存在' });
    }

    // 重建
    if (req.method === 'POST' && p === '/api/reconstructions') {
      const b = await readJson(req);
      const policy: GapPolicy = b.gapPolicy === 'allow-sparse' ? 'allow-sparse' : 'reject';
      const out = reconstructScan(store, b.scanId, b.filter === 'none' ? 'none' : 'ramlak', policy);
      return send(res, 201, {
        id: out.row.id,
        scan_id: out.row.scan_id,
        filter: out.row.filter,
        pad_length: out.row.pad_length,
        out_of_range_samples: out.outOfRangeSamples,
        gap: out.gap,
        image: out.row.image,
      });
    }
    if (req.method === 'GET' && /^\/api\/reconstructions\/\d+$/.test(p)) {
      const id = Number(p.split('/').pop());
      const row = store.getReconstruction(id);
      return row ? send(res, 200, row) : send(res, 404, { error: '重建结果不存在' });
    }
    if (req.method === 'GET' && /^\/api\/reconstructions\/\d+\/image\.csv$/.test(p)) {
      const id = Number(p.split('/')[3]);
      const row = store.getReconstruction(id);
      return row ? sendCsv(res, `reconstruction_${id}.csv`, toCsv(row.image)) : send(res, 404, { error: '重建结果不存在' });
    }

    // 比较
    if (req.method === 'POST' && p === '/api/comparisons') {
      const b = await readJson(req);
      const out = compareReconstruction(store, b.reconstructionId, {
        truthSampleId: b.truthSampleId,
        regions: b.regions,
      });
      return send(res, 201, out);
    }
    if (req.method === 'GET' && /^\/api\/comparisons\/\d+$/.test(p)) {
      const id = Number(p.split('/').pop());
      const row = store.getComparison(id);
      return row ? send(res, 200, row) : send(res, 404, { error: '比较结果不存在' });
    }

    send(res, 404, { error: '未找到路由', path: p });
  } catch (err) {
    send(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`平行束 CT 后端已启动: http://localhost:${PORT}  数据目录: ${DATA_DIR}`);
});
