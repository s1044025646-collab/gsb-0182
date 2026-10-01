# 平行束 CT 投影与滤波反投影重建后端

小规模二维平行束断层成像的**离线数值实验服务**：导入方形灰度矩阵（衰减系数分布）→
生成平行束正弦图（也可直接导入正弦图）→ Ram-Lak 滤波反投影（FBP）重建 →
与真值比较（RMSE、区域均值）或只报告投影残差。仅提供 HTTP API 与 CLI，无网页、
无 GUI、不依赖任何医学影像格式或重建库；DFT、前向投影、斜坡滤波、反投影插值均自行实现。

## 运行环境

- Windows 本地直接运行；Node.js ≥ 22（开发验证于 Node 25.5）。
- SQLite 使用 Node 内置 `node:sqlite`（`--experimental-sqlite` 标志），**无需原生编译**。
- 不依赖 Docker / WSL / 付费服务 / 外部在线 API。

```powershell
npm install
npm run build      # TypeScript 编译到 dist/
npm test           # 20 项数值与持久化测试
npm run demo       # 终端演示：剖面、指标、滤波对照、镜像、角度趋势
npm start          # 启动 HTTP API（先 build）
```

环境变量：`PORT`（默认 8182）、`CT_DATA_DIR`（默认项目内 `./data`，SQLite 与导出文件所在目录）。

## 坐标与几何约定（量纲明确）

- 长度单位为无量纲“单位长度”，`pixelSpacing`（默认 1）既是像素中心间距也是长度基准。
- 重建矩阵 `f` 为 N×N 方形；行 `i` 自上而下、列 `j` 自左而右。连续坐标原点在矩阵中心像素中心：
  - `x = (j - (N-1)/2) * pixelSpacing`（向右）
  - `y = ((N-1)/2 - i) * pixelSpacing`（向上）
- 角度 `theta`（度）为射线传播方向相对 +x 轴的转角，**逆时针为正**。
- 探测器轴与传播方向垂直：`u = -x sinθ + y cosθ`，通道位置
  `u_k = (k - (D-1)/2) * detectorSpacing`（D 为通道数，奇数保证有零通道）。
- 投影 `p(θ,u) = ∫ f ds`（沿射线积分），量纲 = 衰减系数 × 单位长度。
- 由此 `θ=0` 时 `u=y`、`θ=90°` 时 `u=-x`；中心对称圆盘在两角度的投影完全一致（镜像关系，测试覆盖）。

## 数值方法

- **前向投影**（`src/projector.ts`）：像素驱动。像素中心到射线 `u=u_k` 的有符号距离为 `d`，
  权重为帐篷核 `max(0, 1-|d|/detectorSpacing)`，再乘弦长系数
  `pixelSpacing*(|cosθ|+|sinθ|)`。权重非负 ⇒ 全零图像严格投影为零。
  探测器覆盖不到的像素不计入（调用方需给足通道数，视场对角线约 `N*pixelSpacing*√2/2`）。
- **斜坡滤波**（`src/reconstruction.ts`）：Ram-Lak 纯斜坡 `|r|`。
  每行零填充到 `L = 不小于 2D 的最小 2 的幂`，直接 DFT（O(L²)，规模受限）逐点乘斜坡后 IDFT，
  截取前 D 点；零填充同时充当边界处理（视场外视为零）并抑制周期卷绕。
  离散“周/样本”乘子经 `1/detectorSpacing²` 换算到连续 `1/长度` 量纲，
  另含一次性整体校准常数 1.58018（`src/calibrate.ts`，由中心圆盘内部均值定标，与具体输入无关）。
- **反投影**：每像素求 `u` 后在投影行内线性插值；超出探测器范围按**零延拓**并统计
  `outOfRangeSamples`。角度按实际存在的角度做梯形积分（Δθ 弧度，非等间隔用相邻间距左右平均），
  FBP 另乘理论因子 1/2。
- **缺角规则**：默认 `reject` —— 角度未近似等间隔覆盖 [0,180°)（跨度不足半周或最大间隙 >
  2 倍平均间隙）即拒绝重建；显式 `allow-sparse` 才按已有角度积分，**绝不补造缺失角度**。
- **噪声**：加性高斯（mulberry32 固定种子 + Box–Muller），相同种子逐元素可复现。
- 规模上限：矩阵 N ≤ 256（内置模体 ≤128）、角度 ≤ 720、通道 ≥ 3。

## 数据与快照

SQLite（`$CT_DATA_DIR/ct.sqlite`）中四张表：`samples`（真值/导入矩阵）、
`scans`（几何 + 正弦图 + 噪声参数）、`reconstructions`（滤波方式 + 结果矩阵 + 越界数 + 填充长度）、
`comparisons`（RMSE / 区域均值 / 投影残差）。任何参数或数据变化都 **INSERT 新行**，
旧实验永不被覆盖，重启服务后可继续查询。

诊断原则：扫描关联了真值样本时才报告 RMSE 与区域均值；直接导入的正弦图无真值，
只报告投影残差 RMS（重建图再前向投影与观测之差），不编造精度。

## HTTP API（JSON）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查与数据库路径 |
| POST | `/api/samples/builtin` | `{kind: blank\|centerDisk\|offsetTwoDisks, size}` 内置样本 |
| POST | `/api/samples/import` | `{name, image:[[..]]}` 导入方形矩阵 |
| GET | `/api/samples`、`/api/samples/:id` | 列表 / 详情（含矩阵） |
| POST | `/api/scans/project` | `{sampleId, geometry, noise?:{seed,sigma}}` 前向投影 |
| POST | `/api/scans/import-sinogram` | `{geometry, sinogram}` 不知原图直接导入 |
| GET | `/api/scans`、`/api/scans/:id`、`/api/scans/:id/sinogram.csv` | 查询 / CSV 导出 |
| POST | `/api/reconstructions` | `{scanId, filter: ramlak\|none, gapPolicy?: reject\|allow-sparse}` |
| GET | `/api/reconstructions/:id`、`/api/reconstructions/:id/image.csv` | 查询 / CSV 导出 |
| POST | `/api/comparisons` | `{reconstructionId, truthSampleId?, regions?}` 比较 |

```powershell
$g = @{ size=32; pixelSpacing=1; detectorSpacing=1; detectorCount=47
        anglesDeg = (0..39 | ForEach-Object { $_*4.5 }) }
$s = Invoke-RestMethod http://localhost:8182/api/samples/builtin -Method Post -ContentType 'application/json' -Body '{"kind":"centerDisk","size":32}'
$scan = Invoke-RestMethod http://localhost:8182/api/scans/project -Method Post -ContentType 'application/json' -Body (@{sampleId=$s.id; geometry=$g} | ConvertTo-Json -Depth 5)
Invoke-RestMethod http://localhost:8182/api/reconstructions -Method Post -ContentType 'application/json' -Body (@{scanId=$scan.id; filter='ramlak'} | ConvertTo-Json)
```

## CLI

```powershell
npx tsx src/cli.ts sample-builtin --kind centerDisk --size 32
npx tsx src/cli.ts project --sample 1 --size 32 --angles 40 [--seed 42 --sigma 0.02]
npx tsx src/cli.ts reconstruct --scan 1 [--filter ramlak|none] [--allow-sparse]
npx tsx src/cli.ts compare --reconstruction 1
npx tsx src/cli.ts export --reconstruction 1 --out rec.csv
npx tsx src/cli.ts import-sinogram --file sino.csv --size 48 --det 69 --angles 60
# 非等间隔角：--angles-start 0 --angles-step 10 --angles-count 5
#   或在 bash 中用 --angles-json "[0,10,20]"
```
编译后等价命令：`node --experimental-sqlite dist/cli.js ...`。
CSV 为纯逗号数值、首行非表头；JSON 支持裸矩阵或 `{matrix|image|sinogram: [[..]]}`。

## 可复核的固定阈值（`npm test` 与 `npm run demo`）

- N=48、69 通道、60 个等间隔角、间距均为 1：中心圆盘 FBP `RMSE < 0.08`（实测约 0.065），
  中心像素 |重建-1| < 0.15；16 角 RMSE > 0.1 且 60 角严格优于 16 角。
- 空白图：投影与重建最大绝对值严格为 0。
- 镜像：中心圆盘 θ=0 投影关于中心通道对称、且与 θ=90° 投影逐通道差 < 1e-10；偏心双圆盘则显著不同。
- FBP vs 不滤波：不滤波反投影 RMSE 比 FBP 大一个数量级以上（1/r 模糊对照）。
- 往返：正弦图经 CSV/JSON 序列化再解析逐元素一致；导入的正弦图可在无真值下完成重建。
- 错误覆盖：尺寸不匹配、非有限数（NaN）、重复/非递增角度、仅 1 个角度、非方形矩阵、
  正弦图行列数不匹配、探测器过窄导致越界采样、缺角数据默认拒绝。
- 持久化：关闭后用同一文件重新打开 Store，样本与扫描仍可查询。

## 限制与合理假设

- 教学/数值实验性质：像素驱动帐篷核是弦长的一阶近似，非射线驱动精确求交；
  FBP 精度受角度采样、探测器采样与离散化限制（圆盘边界像素造成约 0.06 的 RMSE 下限）。
  DFT 为 O(N²) 直接实现，不适合大规模数据。
- 假设单色 X 射线、无散射、无束流硬化；像素与探测器间距默认均为 1，几何为理想平行束。
- 仅支持方形矩阵；角度以度为单位、严格递增。
