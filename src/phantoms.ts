import { zeros2D } from './numeric.js';

export type PhantomKind = 'blank' | 'centerDisk' | 'offsetTwoDisks';

export interface Disk {
  cx: number;
  cy: number;
  r: number;
  value: number;
}

/**
 * 生成分段常数模体。坐标单位与像素间距一致，原点在矩阵中心像素中心
 * （与 geometry.ts 约定相同）：x=(j-(N-1)/2)，y=((N-1)/2-i)。
 * 圆盘按“像素中心到圆心距离 <= r”赋值；重叠区域后写覆盖先写。
 */
export function makePhantom(kind: PhantomKind, size: number): { image: number[][]; disks: Disk[] } {
  if (!Number.isInteger(size) || size < 2) throw new Error('size 必须是不小于 2 的整数');
  const image = zeros2D(size, size);
  const half = (size - 1) / 2;
  let disks: Disk[] = [];
  if (kind === 'blank') {
    disks = [];
  } else if (kind === 'centerDisk') {
    disks = [{ cx: 0, cy: 0, r: size * 0.25, value: 1 }];
  } else if (kind === 'offsetTwoDisks') {
    const off = size * 0.22;
    disks = [
      { cx: -off, cy: size * 0.12, r: size * 0.16, value: 0.8 },
      { cx: off, cy: -size * 0.1, r: size * 0.12, value: 1.2 },
    ];
  } else {
    throw new Error(`未知模体类型: ${kind}`);
  }
  for (const d of disks) {
    const r2 = d.r * d.r;
    for (let i = 0; i < size; i++) {
      const y = half - i;
      for (let j = 0; j < size; j++) {
        const x = j - half;
        const dx = x - d.cx;
        const dy = y - d.cy;
        if (dx * dx + dy * dy <= r2) image[i][j] = d.value;
      }
    }
  }
  return { image, disks };
}
