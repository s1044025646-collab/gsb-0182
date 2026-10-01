/**
 * 直接离散傅里叶变换（DFT）——教学用途的 O(N^2) 实现，
 * 仅作用于每个探测器行的零填充一维信号（M<=1024，填充到 2 的幂），规模可控。
 * 使用迭代 Cooley-Tukey FFT（基数 2），避免真正 O(N^2) 直接求和。
 */

export function fft(re: number[], im: number[]): void {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error("FFT 长度必须是 2 的幂");
  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nxtRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nxtRe;
      }
    }
  }
}

export function nextPow2(x: number): number {
  let p = 1;
  while (p < x) p <<= 1;
  return p;
}
