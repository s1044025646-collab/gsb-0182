# mini-fbp-ct：二维平行束 CT 前向投影与滤波反投影后端

小规模二维平行束断层重建的**离线数值实验服务**。支持导入方形灰度矩阵（衰减系数分布）、
生成正弦图、直接导入正弦图，并用滤波反投影（FBP）重建二维矩阵。只有 API 与 CLI，
没有网页、图像窗口、医学文件格式或真实设备；输入输出仅用 JSON / CSV，全部为人工合成样本。

* 语言/运行时：TypeScript + Node.js（需 Node ≥ 22，开发于 Node 25）
* 数据库：内置 `node:sqlite`（无需 C++ 编译，无需 better-sqlite3）
* 平台：Windows 本地直接运行；不依赖 Docker、WSL、付费服务或在线 API

## 几何与单位约定

这些约定是本项目的“坐标系合同”，API、CLI、测试一致遵循：

* 图像为 `N×N` 方形矩阵，元素为线性衰减系数 `mu`（单位 `1/length`，`length` 取任意一致单位）。
* 像素为边长 `d = pixelSize`（默认 1）的正方形。**图像中心为坐标原点**，`x` 向右、`y` 向上：
  行 `r`（自上而下）→ `y = ((N-1)/2 - r)·d`；列 `c`（自左而右）→ `x = (c - (N-1)/2)·d`。
* 平行束参数化：`x·cosθ + y·sinθ = t`。角度 `θ` 为**度、逆时针为正**；`θ=0°` 光束沿 `+y`。
  射线方向向量 `(-sinθ, cosθ)`。
* 探测器通道 `k` 的位置 `t_k = (k - (M-1)/2)·detectorSpacing`，`M=detectors`（默认间距 1）。
  奇数通道时中心通道严格位于 `t=0`。
* 完整观测覆盖 `[0°,180°)`（平行束 180° 即完备）。

### 离散化、边界、滤波、零填充

* **前向投影（`src/projector.ts`）**：射线驱动，逐像素求“射线与该正方形像素的截距长度”
  （x、y 两组 slab 区间的交集长度），`p = Σ mu·length`。分段常数图像下这是精确线积分，
  量纲 `mu·length`，并对镜像/旋转几何严格对称。射线不经过的像素贡献 0；
  探测器采样到物体支撑之外按 **0（零延拓）**处理。
* **滤波（`src/reconstruct.ts`，Ram-Lak 类斜坡）**：每个角度行先**零填充到
  `L = 最小的 ≥2M-1 的 2 的幂`**（抑制圆周卷积时域混叠）；用自研基数 2 Cooley–Tukey FFT
  做 DFT，频域乘 `|ν|/detectorSpacing`，其中 `ν = q/L`（周/样本），上半平面对称；
  不加窗（纯 Ram-Lak）。逆 DFT 取实部、除以 `L` 后截断回前 `M` 点。
  除以 `detectorSpacing` 使离散卷积与连续滤波器（量纲 1/t²）匹配。
* **反投影（`src/projector.ts`）**：每个像元中心计算 `t = x·cosθ + y·sinθ`，
  对探测器做**线性插值**，越界通道取 0。角度权重用 Voronoi 间隔（度，等间隔时即常数 Δθ），
  转弧度后求和，并乘全局标定常数 `CALIBRATION=1.0`（在 `src/reconstruct.ts`，
  由“中心圆盘相对 RMSE/内部均值”测试可复核地确定）。
* **有限角**：默认 `coverage="full-180"` 会检查 `[0,180)` 的最大角度缺口（含 0↔180 环绕），
  超过阈值（默认 `max(5°, 中位角距·3)`）直接**拒绝并报错**；显式给 `coverage="as-is"`
  才继续，此时缺口仍在、结果含文档化的有限角伪影，**绝不悄悄补成完整观测**。

## 规模限制

`N ≤ 256`，探测器 `M ≤ 1024`，角度数 `≤ 1024`（见 `src/validate.ts`），保证普通电脑可运行。
前向投影为 O(角度·N²·常数)，一次 64×64、90 角度、101 通道的实验在普通 PC 上为亚秒到秒级。

## 安装、构建、测试、启动、演示

```powershell
npm install
npm run build      # tsc 编译到 dist/
npm test           # 编译 + 运行 12 个 node:test 用例
npm start          # 启动 HTTP API（默认 http://localhost:3000）
npm run demo       # 终端演示：中心剖面、指标、滤波/不滤波差异、角度-RMSE 趋势
```

可配置环境变量：

* `PORT`（默认 3000）：API 端口。
* `DATA_DIR`（默认项目内 `./data`）：SQLite 数据库 `ct.db` 所在目录，重启后旧实验仍可查询。

```powershell
$env:PORT="3210"; $env:DATA_DIR="data"; npm start
```

## HTTP API

所有请求/响应为 JSON。矩阵是行优先的二维数组。错误返回 `400 {"error": "..."}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查与数据目录 |
| POST | `/samples` | 创建样本：`{"kind":"blank"|"centered-disk"|"two-disks"|"custom", name, matrix?}` |
| GET | `/samples` `/samples/:id` | 列表 / 详情 |
| GET | `/samples/:id/export?format=csv` | 导出矩阵 JSON/CSV |
| POST | `/geometries` | `{name,n,detectors,anglesDeg:[...],pixelSize?,detectorSpacing?}` |
| GET | `/geometries` `/geometries/:id` | 列表 / 详情 |
| POST | `/projections/project` | `{sampleId,geometryId,noise?:{seed,relativeSigma}}` 前向投影 |
| POST | `/projections/import` | `{geometryId,sinogram:[[...]]}` 直接导入正弦图（无需原图） |
| GET | `/projections` `/projections/:id` | 列表 / 详情 |
| POST | `/reconstructions` | `{projectionId,filter:"ram-lak"|"none",coverage:"full-180"|"as-is"}` |
| GET | `/reconstructions` `/reconstructions/:id` | 列表 / 详情 |
| GET | `/reconstructions/:id/export?format=csv` | 导出重建矩阵 |
| POST | `/comparisons` | `{reconstructionId}` → RMSE/区域均值/投影残差 |

参数或数据任一变化都会产生**新行（实验快照）**；旧快照永不覆盖，重启后可继续查询。

### PowerShell 端到端示例

```powershell
$s = Invoke-RestMethod -Uri http://localhost:3000/samples -Method Post -ContentType application/json -Body '{"kind":"centered-disk"}'
$g = Invoke-RestMethod -Uri http://localhost:3000/geometries -Method Post -ContentType application/json -Body (@{n=64;detectors=101;anglesDeg=(0..89|%{$_*2})}|ConvertTo-Json)
$p = Invoke-RestMethod -Uri http://localhost:3000/projections/project -Method Post -ContentType application/json -Body (@{sampleId=$s.id;geometryId=$g.id}|ConvertTo-Json)
$r = Invoke-RestMethod -Uri http://localhost:3000/reconstructions -Method Post -ContentType application/json -Body (@{projectionId=$p.id;filter="ram-lak"}|ConvertTo-Json)
Invoke-RestMethod -Uri http://localhost:3000/comparisons -Method Post -ContentType application/json -Body (@{reconstructionId=$r.id}|ConvertTo-Json)
```

## CLI

```powershell
node --experimental-sqlite dist/cli.js sample --kind centered-disk --name disk
node --experimental-sqlite dist/cli.js sample --import truth.csv --name mine   # JSON/CSV 均可
node --experimental-sqlite dist/cli.js geometry --n 64 --detectors 101 --angles 90
node --experimental-sqlite dist/cli.js project --sample 1 --geometry 1 --seed 42 --noise 0.02
node --experimental-sqlite dist/cli.js import --geometry 1 --file sino.csv      # 导入正弦图
node --experimental-sqlite dist/cli.js reconstruct --projection 1 --filter ram-lak
node --experimental-sqlite dist/cli.js reconstruct --projection 1 --filter none
node --experimental-sqlite dist/cli.js reconstruct --projection 1 --as-is        # 显式接受有限角
node --experimental-sqlite dist/cli.js compare --reconstruction 1
node --experimental-sqlite dist/cli.js export --reconstruction 1 --out rec.csv
node --experimental-sqlite dist/cli.js export --projection 1 --out sino.csv
node --experimental-sqlite dist/cli.js list projections
```

加 `--data-dir <目录>` 可切换数据目录（默认 `./data`）。CSV 为无表头逗号数值，`.json` 可直接是二维数组或
`{"matrix":[[...]]}`。

## 指标

* **有真值**（前向投影产生）：全图 `RMSE`、真值支撑区域均值 vs 重建区域均值、最大绝对差、
  以及对重建图重新前向投影得到的**投影域相对 RMSE**。
* **无真值**（导入正弦图）：`RMSE/区域均值为 NaN`，**只报告投影残差**，不编造精度。
* 噪声为固定种子（mulberry32 + Box–Muller）的加性高斯白噪声，`relativeSigma` 以无噪声正弦图
  最大绝对值为基准，同种子结果可复现。

## 内置样本与测试阈值

内置 `blank`（空白）、`centered-disk`（中心圆盘）、`two-disks`（偏心双圆盘）。
`npm test`（`src/test/fbp.test.ts`，12 个用例）覆盖并断言：

* 零输入投影/重建严格为零；
* **固定参数**（48×48、半径 12、mu=1、90 角度、101 通道）中心圆盘全图 **RMSE < 0.08**、
  圆盘内部均值与 1 的偏差 < 0.08；
* 几何镜像关系 `p(θ,t)=p(180°−θ,t)`（关于 y 轴对称体）及 `θ=0` 水平镜像=通道逆序；
* 8→64 角度 RMSE 严格下降；FBP 严格优于不滤波；
* 固定种子噪声可复现、噪声增大投影残差；
* 无真值导入不报 RMSE 仅报投影残差（60 角度时 < 0.06）；
* CSV 往返一致；SQLite 重开连接（模拟重启）后快照一致；
* 拒绝非有限数、非方形/尺寸不匹配、重复角度、极少/非法尺寸、越界探测器形状；
* 2 个近角（0°,4°）在 `full-180` 下被拒绝、在 `as-is` 下放行；越界探测器通道投影为 0。

## 已知限制

* 前向投影复杂度随 `N²` 增长，超过约 256² 时变慢；这是刻意的规模上限。
* Ram-Lak 未加平滑窗（无 Hann/Shepp-Logan），对噪声敏感；如需可在滤波器处加窗扩展。
* 仅支持平行束、单色、无散射的二维线积分模型；不含锥束、衰减硬化、真实探测器响应或 DICOM。
* `node:sqlite` 在当前 Node 版本带实验性警告，需以 `--experimental-sqlite` 运行（脚本已内置）。
