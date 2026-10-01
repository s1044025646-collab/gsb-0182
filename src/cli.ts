import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { Store } from './db.js';
import {
  compareReconstruction,
  createBuiltinSample,
  GapPolicy,
  importSample,
  importSinogram,
  projectSample,
  reconstructScan,
} from './service.js';
import { equispacedAngles } from './geometry.js';
import { parseCsv, parseMatrixJson, toCsv } from './io.js';

function usage(): never {
  console.error(`
用法: ct <命令> [参数]

  init-db [--data-dir DIR]
  sample-builtin --kind blank|centerDisk|offsetTwoDisks [--size 64] [--name N]
  sample-import --file matrix.json|.csv [--name N]
  project --sample ID --size N [--angles 90] [--det 93] [--seed 42 --sigma 0.02]
  import-sinogram --file sino.json|.csv --size N --det D --angles N|--angles-json "[0,10,..]"
  reconstruct --scan ID [--filter ramlak|none] [--allow-sparse]
  compare --reconstruction ID [--truth SAMPLE_ID]
  export --reconstruction ID --out rec.csv
  list

环境变量: CT_DATA_DIR (默认 ./data), PORT (HTTP, 默认 8182)
`);
  process.exit(1);
}

type Args = Record<string, string | boolean>;
function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let k = 2; k < argv.length; k++) {
    const a = argv[k];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (k + 1 < argv.length && !argv[k + 1].startsWith('--')) {
        out[key] = argv[++k];
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function readMatrixFile(file: string): number[][] {
  const text = readFileSync(file, 'utf8');
  return file.toLowerCase().endsWith('.csv') ? parseCsv(text) : parseMatrixJson(text);
}

function main(): void {
  const cmd = process.argv[2];
  if (!cmd) usage();
  const args = parseArgs(process.argv);
  const dataDir = String(args['data-dir'] ?? process.env.CT_DATA_DIR ?? resolve('data'));
  const store = new Store(resolve(dataDir, 'ct.sqlite'));

  switch (cmd) {
    case 'init-db':
      console.log('数据库就绪:', resolve(dataDir, 'ct.sqlite'));
      break;
    case 'sample-builtin': {
      const kind = String(args.kind ?? 'centerDisk') as never;
      const row = createBuiltinSample(store, kind, Number(args.size ?? 64), args.name ? String(args.name) : undefined);
      console.log(JSON.stringify({ id: row.id, name: row.name, kind: row.kind, size: row.size }, null, 2));
      break;
    }
    case 'sample-import': {
      if (!args.file) throw new Error('需要 --file');
      const m = readMatrixFile(String(args.file));
      const row = importSample(store, String(args.name ?? 'imported'), m);
      console.log(JSON.stringify({ id: row.id, size: row.size }));
      break;
    }
    case 'project': {
      const size = Number(args.size);
      const det = Number(args.det ?? Math.round(size * 1.45));
      const angles = equispacedAngles(Number(args.angles ?? 90));
      const scan = projectSample(
        store,
        Number(args.sample),
        { size, pixelSpacing: 1, detectorSpacing: 1, detectorCount: det, anglesDeg: angles },
        args.seed != null ? { seed: Number(args.seed), sigma: Number(args.sigma ?? 0.02) } : null,
      );
      console.log(JSON.stringify({ scanId: scan.id, angles: angles.length, detectorCount: det }));
      break;
    }
    case 'import-sinogram': {
      if (!args.file) throw new Error('需要 --file');
      const sino = readMatrixFile(String(args.file));
      const size = Number(args.size);
      let angles: number[];
      if (args['angles-json']) {
        angles = JSON.parse(String(args['angles-json'])) as number[];
      } else if (args['angles-start'] != null && args['angles-step'] != null) {
        const start = Number(args['angles-start']);
        const step = Number(args['angles-step']);
        const count = Number(args['angles-count'] ?? sino.length);
        angles = Array.from({ length: count }, (_, k) => start + k * step);
      } else {
        angles = equispacedAngles(Number(args.angles ?? sino.length));
      }
      const scan = importSinogram(
        store,
        { size, pixelSpacing: 1, detectorSpacing: 1, detectorCount: Number(args.det ?? sino[0].length), anglesDeg: angles },
        sino,
      );
      console.log(JSON.stringify({ scanId: scan.id, angles: angles.length }));
      break;
    }
    case 'reconstruct': {
      const policy: GapPolicy = args['allow-sparse'] ? 'allow-sparse' : 'reject';
      const filter = String(args.filter ?? 'ramlak') as 'ramlak' | 'none';
      const out = reconstructScan(store, Number(args.scan), filter, policy);
      console.log(
        JSON.stringify(
          {
            reconstructionId: out.row.id,
            filter,
            outOfRangeSamples: out.outOfRangeSamples,
            padLength: out.row.pad_length,
            gap: out.gap,
          },
          null,
          2,
        ),
      );
      break;
    }
    case 'compare': {
      const out = compareReconstruction(store, Number(args.reconstruction), {
        truthSampleId: args.truth != null ? Number(args.truth) : undefined,
      });
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case 'export': {
      if (!args.out) throw new Error('需要 --out');
      const rec = store.getReconstruction(Number(args.reconstruction));
      if (!rec) throw new Error('重建结果不存在');
      writeFileSync(String(args.out), toCsv(rec.image), 'utf8');
      console.log('已写出 CSV:', args.out);
      break;
    }
    case 'list': {
      console.log('samples:', JSON.stringify(store.listSamples(), null, 2));
      console.log('scans:', JSON.stringify(store.listScans(), null, 2));
      break;
    }
    default:
      usage();
  }
  store.close();
}

main();
