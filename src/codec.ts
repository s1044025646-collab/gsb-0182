import { readFileSync, writeFileSync } from "node:fs";
import type { Matrix } from "./types.js";

/** CSV 矩阵：纯逗号分隔数值，每行一条记录，无表头。 */
export function matrixToCsv(m: Matrix): string {
  return m.map((row) => row.map((v) => {
    if (!Number.isFinite(v)) throw new Error("CSV 导出遇到非有限数");
    return Number.isInteger(v) ? String(v) : v.toPrecision(10);
  }).join(",")).join("\r\n") + "\r\n";
}

export function csvToMatrix(text: string): Matrix {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (rows.length === 0) throw new Error("CSV 为空");
  const width = rows[0].split(",").length;
  return rows.map((line, r) => {
    const cells = line.split(",");
    if (cells.length !== width) throw new Error(`CSV 第 ${r} 行列数不一致`);
    return cells.map((cell, c) => {
      const v = Number(cell);
      if (!Number.isFinite(v)) throw new Error(`CSV[${r}][${c}] 非有限数`);
      return v;
    });
  });
}

export function readMatrixFile(path: string): Matrix {
  const text = readFileSync(path, "utf8");
  if (path.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(text);
    const m = (data && typeof data === "object" && "matrix" in data) ? (data as { matrix: Matrix }).matrix : data;
    return m as Matrix;
  }
  return csvToMatrix(text);
}

export function writeMatrixFile(path: string, m: Matrix): void {
  if (path.toLowerCase().endsWith(".json")) writeFileSync(path, JSON.stringify(m), "utf8");
  else writeFileSync(path, matrixToCsv(m), "utf8");
}

/** 等间隔角度工具：[start,end) 取 count 个。 */
export function linspaceAngles(startDeg: number, endDegExclusive: number, count: number): number[] {
  if (count < 1) throw new Error("角度数至少为 1");
  return Array.from({ length: count }, (_, i) => startDeg + ((endDegExclusive - startDeg) * i) / count);
}
