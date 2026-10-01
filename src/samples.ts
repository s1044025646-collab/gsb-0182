import type { Matrix } from "./types.js";

/** 全零（空白）图：检验零输入保持为零 */
export function blank(n: number, mu = 0): Matrix {
  return Array.from({ length: n }, () => new Array<number>(n).fill(mu));
}

/** 中心圆盘：半径 r（length），内部衰减 mu，外部 0 */
export function centeredDisk(n: number, radius: number, mu = 1, pixelSize = 1): Matrix {
  const img = blank(n);
  const c = (n - 1) / 2;
  for (let r = 0; r < n; r++)
    for (let col = 0; col < n; col++) {
      const x = (col - c) * pixelSize;
      const y = (c - r) * pixelSize;
      if (x * x + y * y <= radius * radius) img[r][col] = mu;
    }
  return img;
}

/** 偏心双圆盘：主盘 + 偏移的小盘，用于检验几何定位与镜像关系 */
export function twoDisks(
  n: number,
  big = { radius: 0.32, mu: 1, dx: -0.18, dy: 0 },
  small = { radius: 0.18, mu: 0.6, dx: 0.3, dy: 0.18 },
  pixelSize = 1
): Matrix {
  const img = blank(n);
  const c = (n - 1) / 2;
  const half = ((n - 1) / 2) * pixelSize;
  for (let r = 0; r < n; r++)
    for (let col = 0; col < n; col++) {
      const x = (col - c) * pixelSize;
      const y = (c - r) * pixelSize;
      const inDisk = (cx: number, cy: number, rad: number) =>
        (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
      if (inDisk(big.dx * half * 2, big.dy * half * 2, big.radius * half * 2)) img[r][col] = big.mu;
      if (inDisk(small.dx * half * 2, small.dy * half * 2, small.radius * half * 2)) img[r][col] = small.mu;
    }
  return img;
}

export const SAMPLE_BUILDERS = {
  blank: () => blank(64),
  "centered-disk": () => centeredDisk(64, 16, 1),
  "two-disks": () => twoDisks(64),
} as const;

export type SampleKind = keyof typeof SAMPLE_BUILDERS;
