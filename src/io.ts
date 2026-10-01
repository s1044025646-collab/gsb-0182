import { validateMatrix } from './numeric.js';

/** 解析 CSV 文本为二维数值矩阵（逗号分隔，忽略空行与 # 注释行）。 */
export function parseCsv(text: string): number[][] {
  const rows: number[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(',').map((s) => s.trim());
    rows.push(parts.map((p) => Number(p)));
  }
  validateMatrix(rows);
  return rows;
}

export function toCsv(m: number[][]): string {
  return m.map((row) => row.map((v) => JSON.stringify(v)).join(',')).join('\n') + '\n';
}

/** JSON 支持 [[..],[..]] 裸矩阵，或 { "matrix": [[..]] } / { "image": .. }。 */
export function parseMatrixJson(text: string): number[][] {
  const data = JSON.parse(text);
  const m = Array.isArray(data) ? data : data.matrix ?? data.image ?? data.sinogram;
  if (!m) throw new Error('JSON 中未找到矩阵字段（需要数组、matrix、image 或 sinogram）');
  validateMatrix(m);
  return m;
}
