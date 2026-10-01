/**
 * 基础数值工具：有限数校验、确定性 PRNG、可复现高斯噪声、直接 DFT。
 * 全部自行实现，不依赖任何数学/信号处理第三方库。
 */

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** 断言二维矩阵为非空矩形且元素均为有限数；返回 [行数, 列数]。 */
export function validateMatrix(m: number[][]): { rows: number; cols: number } {
  if (!Array.isArray(m) || m.length === 0 || !Array.isArray(m[0]) || m[0].length === 0) {
    throw new Error('矩阵必须是非空二维数组');
  }
  const rows = m.length;
  const cols = m[0].length;
  for (let i = 0; i < rows; i++) {
    if (!Array.isArray(m[i]) || m[i].length !== cols) {
      throw new Error(`矩阵第 ${i} 行长度与首行不一致（期望 ${cols} 列）`);
    }
    for (let j = 0; j < cols; j++) {
      if (!isFiniteNumber(m[i][j])) {
        throw new Error(`矩阵元素 [${i}][${j}] 不是有限数`);
      }
    }
  }
  return { rows, cols };
}

export function zeros2D(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

export function cloneMatrix(m: number[][]): number[][] {
  return m.map((row) => row.slice());
}

/** mulberry32：固定种子可复现的均匀(0,1)伪随机数。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller：由均匀随机源生成标准正态样本。 */
export function gaussianNoise(rand: () => number, n: number, sigma: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 2) {
    let u1 = rand();
    const u2 = rand();
    if (u1 < Number.MIN_VALUE) u1 = Number.MIN_VALUE;
    const r = Math.sqrt(-2 * Math.log(u1));
    const z0 = r * Math.cos(2 * Math.PI * u2);
    const z1 = r * Math.sin(2 * Math.PI * u2);
    out.push(sigma * z0);
    if (i + 1 < n) out.push(sigma * z1);
  }
  return out;
}

/**
 * 直接 DFT（O(N^2)，仅用于小规模实验）。
 * X[k] = sum_n x[n] exp(-i 2π k n / N)。返回实部、虚部两个数组。
 */
export function dft(x: number[]): { re: number[]; im: number[] } {
  const n = x.length;
  const re = new Array<number>(n).fill(0);
  const im = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n;
      sr += x[t] * Math.cos(ang);
      si += x[t] * Math.sin(ang);
    }
    re[k] = sr;
    im[k] = si;
  }
  return { re, im };
}

/** 逆 DFT：x[n] = (1/N) sum_k X[k] exp(+i 2π k n / N)。 */
export function idft(re: number[], im: number[]): number[] {
  const n = re.length;
  const out = new Array<number>(n).fill(0);
  for (let t = 0; t < n; t++) {
    let sr = 0;
    for (let k = 0; k < n; k++) {
      const ang = (2 * Math.PI * k * t) / n;
      sr += re[k] * Math.cos(ang) - im[k] * Math.sin(ang);
    }
    out[t] = sr / n;
  }
  return out;
}

/** 不小于 2*n 的最小 2 的幂（零填充长度）。 */
export function nextPow2AtLeast(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** RMSE。 */
export function rmse(a: number[][], b: number[][]): number {
  const { rows, cols } = validateMatrix(a);
  if (b.length !== rows || b[0].length !== cols) {
    throw new Error('RMSE 要求两矩阵尺寸一致');
  }
  let s = 0;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const d = a[i][j] - b[i][j];
      s += d * d;
    }
 return Math.sqrt(s / (rows * cols));
}

/** 矩形区域（行/列闭区间，含端点）均值。 */
export function regionMean(m: number[][], r0: number, r1: number, c0: number, c1: number): number {
  const { rows, cols } = validateMatrix(m);
  if (r0 < 0 || c0 < 0 || r1 >= rows || c1 >= cols || r0 > r1 || c0 > c1) {
    throw new Error(`区域越界：矩阵 ${rows}x${cols}，给定行[${r0},${r1}] 列[${c0},${c1}]`);
  }
  let s = 0;
  let n = 0;
  for (let i = r0; i <= r1; i++)
    for (let j = c0; j <= c1; j++) {
      s += m[i][j];
      n++;
    }
  return s / n;
}
