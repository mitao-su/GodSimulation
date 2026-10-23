# Starter Home 渲染与地图编排审计

> 审计对象：`content/worlds/starter-home/world.json` + `apps/web` 的 Pixi 渲染管线 + `plugins/home-objects` 素材清单。
> 审计性质：**只读**。本轮未修改 `apps/`、`packages/`、`plugins/`、`content/`、`tests/` 下任何文件，也未改动 git 状态。
> 复现环境：Windows，node v24.22.0 / pnpm 10.34.5，`basic-loop` 测试场景（`GOD_SIM_DECISION_PROVIDER=fixed`），Playwright Chromium，视口 `1910×1062 @ DPR 1`。
> 结论所用图片均由审计期间的实测截图/图集裁切生成，见 `docs/architecture/visual-overhaul/images/render-audit-*.png`。

---

## 0. TL;DR（给决策用的结论）

### 0.1 一句话结论

**画面"粗糙、不像像素风"的主因不是素材包不够，而是：① 素材帧映射有系统性错误（把墙面当地板、把浴缸当冰箱、墙体帧落在透明区）；② 渲染管线与地图编排缺少像素室内场景必需的结构（外墙、y-sort/遮挡、地板变体/autotile、门洞/窗、选中反馈、相机），并且把 18×12 格、4 个空房间、2 件家具当成一个"场景"来渲染。**

现在的画面有 4 类可独立验证的破绽，全部有代码/像素证据：

| # | 破绽 | 直接证据 |
| --- | --- | --- |
| 1 | 厨房/卫生间"地板"其实是图集里的**墙面护墙板切片**（每 16px 一条木色腰带），所以看起来像墙纸 | `asset-manifest.json:42-55` 把 `kitchen-tile=(368,32)`、`bathroom-tile=(368,64)` 挂在 `floor` 资源下；这两帧位于 `tiles.png` 的 48×160 墙列内部（列内每 16px 一条腰带）。渲染实测与源帧逐像素 diff=0，见 §3、图 `fig3` |
| 2 | 房间之间没有墙，只有**背景空洞**：墙带 66,816 px 中 58.4% 是画布背景色 | 4 个 `wall` 帧全部错位：`wall/default+north=(48,112)` 只含 16×7 的门框碎片（44% 不透明）、`wall/south=(48,192)` **0 不透明像素**、`wall/east=(128,128)` 是楼梯碎片、`wall/west=(32,128)` 是门框碎片（`asset-manifest.json:58-98`）。像素测量见 §2.1、图 `fig2` |
| 3 | 家具/洁具错位：**"冰箱"帧实际指向浴缸**、**"马桶"帧里塞了两件洁具**、门和冰箱悬空 1 格（帧底部有 16px 透明边） | `refrigerator=(240,240,32×48)` 的可见内容是 `(245,240,23×32)` 浴缸；`toilet=(272,240,48×32)` 的可见内容横跨 `basin(274,248,21×24)`+`toilet(296,248,21×24)` 两件洁具；`door=(464,152,32×40)` 的内容 bbox 只有 rel(1,5,30×19)，底部 16 行全透明 → 门悬在墙上方 1 格 |
| 4 | 地图表现力：**187 块地板只用了 4 种帧**（同房间相邻 2×2 地块完全逐字节相同）；**全场景只有 2 件家具**（客厅 0、卧室 0、厨房冰箱 1、卫生间马桶 1）；**没有外墙/窗/踢脚/门洞**，地图边缘直接截断在深色背景上 | `world.json:14-47` 4 个 floorRegions 各一个 frameId；`view-projector.ts:96-109` 把同一 frameId 复制给区域内每个 tile；`world.json:84-119` 31 个对象里 25 个 wall、4 个 door、2 个家具；像素测量§2.3 |

### 0.2 素材 vs 管线的占比判断

> 判据：把「当前画面 → 可接受的像素室内场景」拆成 P0/P1/P2 三段（§5），统计每段里**必须新增/替换外部素材**的工作占比，并以"现有素材能否修出结构正确的画面"做交叉验证。

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 素材**量** | **不是瓶颈**。`furniture.png` 有 153 个连通块，含床/沙发/书柜/衣柜/餐桌椅/厨房台面(带水槽/灶台)/窗(4 种)/红门(2 种)/浴缸/洁具/画/植物等，manifest 只接入了 door/refrigerator/toilet 三帧；`carpets.png` 9 张地毯只接入 4 张 | §3.3、图 `fig5`；`asset-manifest.json:99-171` |
| 素材**结构** | 局部不足：`tiles.png` 是**侧视墙纸段**（3 列 48×160），没有顶视外墙/墙角/地板过渡/踢脚/门洞套件；UI 缺像素字体 | §3.1、图 `fig2`/`fig3` |
| 管线/编排 | **主要瓶颈**：墙系统、autotile、y-sort、多格 footprint、相机缩放、选中反馈、对象池/差异更新、动画生命周期、地图编排全部缺失或错误 | §2、§4 |
| **工作量估算** | **约 70% 在渲染管线 + 地图编排，约 30% 在素材**；且这 30% 里约一半（更丰富家具、外景、装饰）属可选打磨 | P0 全部可用现有素材完成；P1 需要少量切片规范工作；P2 才引入新场景素材/像素字体 |

**给决策者的建议**：先做 P0（修帧 + 接线现有素材 + 补外墙/窗/家具 + 选中反馈 + 缩放取整）——这一步 **0 新素材**，即可消除当前 4 类破绽中的 1/2/3 与大部分"空"感；P1 再做结构性升级；**不要先换素材库**。如果确实要采购/引入新素材，只需要补「顶视墙体/门窗/地板 autotile/像素 UI 字体」这一小类，现有家具层足够用。

### 0.3 修复后的验收锚点（建议写进 e2e）

- 地图内容覆盖画布 ≥ 70%（当前 45.6%，`1910×1062`）。
- 墙带背景空洞率 ≤ 5%（当前 58.4%）。
- 同一房间地板帧变体 ≥ 3 种；相邻地块不得逐字节相同。
- 每个房间家具 ≥ 3 件、装饰 ≥ 1 件。
- hover/点击实体后，地图区域像素 diff > 0（当前为 0）。
- `worldLayer.scale × rendererResolution` 为整数（DPR 1/1.25/1.5/2 均验证）。
- 角色在 RUNNING 态下动画帧会推进（非静止滑行）。

---

## 1. 复现与基线

### 1.1 环境与命令

```bash
# 1) 启动测试应用（dist 已构建；本审计期间未改源码，dist 与源码一致）
node --import tsx scripts/start-test-app.mjs --scenario basic-loop --port 4411

# 2) 用 Playwright 截图/测量（脚本在 workspace/visual-audit/，仅本地审计用，不提交）
node workspace/visual-audit/shoot.mjs    # 1910×1062 @ DPR1 / DPR1.5 两组截图
node workspace/visual-audit/shoot2.mjs   # 点击冰箱、1280×800、1366×768 几何
node workspace/visual-audit/shoot3.mjs   # RUNNING 态 world_view 推送频率
```

### 1.2 基线测量值

| 指标 | 值 | 采集方式 |
| --- | --- | --- |
| 视口 / 画布 | `1910×1062` 视口；`.world-map__canvas` canvas `1386×788` CSS px | Playwright `getBoundingClientRect` |
| canvas backing store | `1386×788`（DPR1）；DPR1.5 时 `2079×1182` | `canvas.width/height` |
| `fitScale` → 实际 scale | `3.979` → `3`（`Math.floor`，`pixi-world-renderer.ts:156-157`） | 复算 + 截图推断 |
| 地图绘制尺寸 | `864×576` device px（18×12 格 × 48px） | 截图像素扫描 |
| **地图占画布比例** | **45.6%**（497,664 / 1,092,168 px） | 截图像素统计 |
| 1280×800 视口 | canvas `756×526`，`fitScale 2.542`→scale 2，地图 `576×384`，占画布 **55.6%** | 同左 |
| 1366×768 视口 | canvas `842×494`，`fitScale 2.448`→scale 2，地图 `576×384`，占画布 **53.2%** | 同左 |
| 每个 `world_view` 重建的显示对象 | **224 个** = 187 地板 + 4 地毯 + 31 对象 + 2 角色 | 由 `world.json` 与 `view-projector.ts` 推导 |
| `world_view` 推送频率（RUNNING，关闭审查） | **≈9.4 次/秒**（6.165s 内 58 条；对应 100ms tick） | 页面内 WebSocket 计数 + `worldVersion` 增量 |
| 同房间相邻 2×2 地板块 | **6/6 对逐字节相同** | 截图像素比较 |
| 墙带空洞率 | 墙带 66,816 px 中 **58.41%** 为画布背景色 | 截图像素统计 |
| hover / 点击冰箱 200×200 区域像素变化 | **0 / 0** | 前后截图 diff |
| 地毯可见美术中心偏移 | **-10.5 device px（-3.5 逻辑 px）** @scale 3 | 调色板定位 bbox |

### 1.3 证据文件

| 文件 | 说明 |
| --- | --- |
| `images/render-audit-fig1-current.png` | 现状全景 + 4 类破绽标注（红=墙带空洞，黄=墙面误当地板） |
| `images/render-audit-fig2-wall-frames.png` | 4 个 wall 帧在 `tiles.png` 的真实落点 + 放大内容 |
| `images/render-audit-fig3-floor-mapping.png` | 渲染结果 vs 图集真实内容 vs 可用的独立地板砖 |
| `images/render-audit-fig4-carpet.png` | 地毯 manifest 帧 vs 真实 bbox；游戏内偏移 |
| `images/render-audit-fig5-furniture-inventory.png` | 已存在但未接线的家具/窗/门素材（含坐标） |
| `images/render-audit-fig6-pixel-scaling.png` | DPR1 整数缩放 vs DPR1.5 非整数缩放 |
| `images/render-audit-fig7-target-layers.png` | 目标渲染层级 |

---

## 2. 问题清单（现象 / 证据 / 影响 / 修复方向 / 工作量）

> 工作量口径：**S** ≤ 0.5 天、**M** 1–2 天、**L** 3–5 天（单人、含测试）。

### 2.1 素材帧映射层（asset-manifest.json）

| # | 现象 | 证据（file:line / 实测） | 影响 | 修复方向 | 工作量 |
| --- | --- | --- | --- | --- | --- |
| A1 | 厨房/卫生间地板是"墙纸" | `asset-manifest.json:42-48` `kitchen-tile=(368,32,16×16)`；`:49-55` `bathroom-tile=(368,64,16×16)`。`tiles.png` 中 `(368,16,48×160)` 是**墙列**，`(368,32)` 是该列第 2 个 16px 带（瓷砖护墙板+木腰带），`(368,64)` 是第 4 个带。渲染块与源帧逐像素 diff=0 → 确证映射 | 四个房间中的两个像贴了墙纸；横向腰带每 16px 重复一次，直接破坏"地面"语义 | 这两帧改挂到墙面/护墙板资源；地面改用独立地板砖 `(432,96)`/`(432,112)`/`(464,96)`/`(464,112)`/`(496,96)`/`(496,112)`（16×16 满格、无腰带）或粉色系 `(432,144)`/`(448,144)` | S |
| A2 | 墙体几乎不可见；墙列出现"断续棕色横条" | 4 个 wall 帧全部落错：`(48,112)` 内容 rel(0,9,16×7)（门框十字底边碎片，44% 不透明）；`(48,192)` **0 不透明像素**；`(128,128)` 落在楼梯连通块 `(96,121,48×67)` 上（81%）；`(32,128)` 落在门框连通块 `(25,121,62×65)` 上（68%）。见 `asset-manifest.json:58-98`、图 `fig2` | 墙带 58.4% 是背景空洞（§2.3）；玩家看到的"墙"只是门框碎片的 7px 横条 | 不要用 16×16 单格表达墙；按 §4.3 的墙体系统重做（墙列 48×160 侧视段 / 顶视墙顶条二选一），至少先把墙帧换到真实墙顶 `(240..416,16)` 的墙顶盖带 | M |
| A3 | "冰箱"其实是浴缸 | `asset-manifest.json:112-124` `refrigerator=(240,240,32×48)`；实际可见内容 = 连通块 `(245,240,23×32)`（浴缸）；帧内下方 16 行为透明 → 冰箱还悬空 1 格 | 厨房里出现一个"浴缸形冰箱"，且不贴地 | 拆两个资源：`bathtub=(245,240,23×32)`；冰箱素材后续补充（当前图集没有真正的冰箱，`(240,240)` 区域是浴缸） | S |
| A4 | "马桶"帧里有两件洁具 | `asset-manifest.json:125-137` `toilet=(272,240,48×32)`；内容 rel(2,8,46×24) 横跨 `basin(274,248,21×24)` 与 `toilet(296,248,21×24)`，且左右被裁切 | 卫生间出现 3 件白色洁具堆叠，无法作为单件家具对准格子 | 拆成 `basin=(274,248,21×24)`、`toilet=(296,248,21×24)` 两个资源，各占 1 格 | S |
| A5 | 门/冰箱"悬空" | `door=(464,152,32×40)` 内容 rel(1,5,30×19)，帧底 16 行透明；`refrigerator` 同理（内容 rel(5,0,23×32)，底 16 行透明）。渲染时 anchor=(0.5,1) 对齐单元格底边，导致美术底边 = 单元格**顶边**（上浮 1 格）。见 `pixi-world-renderer.ts:257-263` 与 §3.2 | 门浮在墙带上方、冰箱浮在厨房上部；视觉中心错误，且让"墙/门/地面"的关系读不出来 | 帧裁到内容 bbox（如门 `(465,157,30×19)`）+ 补充资源级 anchor 语义（见 §4.5） | S |
| A6 | 地毯偏移、裁边 | 4 个 carpet 帧宽 40、高 32/40，但真实美术 bbox 为 34×32：`blue=(8,24)` 应为 `(7,24)`、`purple=(56,24)`→`(55,24)`、`orange=(152,24)`→`(151,24)`、`red=(56,72,40×40)`→`(55,72,34×32)`。`carpets.png` 连通块证明 9 张地毯均为 34×32 | 地毯美术中心左偏 3.5 逻辑 px、红地毯再上偏 4 px；且地毯是"单帧居中贴图"，不参与网格 | 帧改真实 bbox；装饰层增加 footprint(w,h) 与"左上 anchor"模式（§4.5） | S |

### 2.2 渲染管线层（`apps/web/src/features/world-map/*`）

| # | 现象 | 证据 | 影响 | 修复方向 | 工作量 |
| --- | --- | --- | --- | --- | --- |
| B1 | 逐 tile 单 Sprite、无 autotile / 无变体 | `render-projection.ts:26-37` 每个 tile 一条 RenderEntity；`pixi-world-renderer.ts:180-199` 每个实体一个 Sprite；`view-projector.ts:96-109` 房间内所有 tile 复制同一个 frameId。实测同房间 2×2 地块 6/6 对逐字节相同 | 大色块重复、无边缘过渡、地板像"平铺墙纸"；这是"不像像素游戏"最直观的来源之一 | 地板层按 §4.4 的 autotile/变体规范：同帧 6 变体（木地板 `(16,(16/32))` 3×2 帧）+ 边缘过渡帧 + 房间边界遮罩；用确定性 hash 选变体 | L（含素材切片） |
| B2 | 无 y-sort / 遮挡语义 | `view-projector.ts:191` 所有 object `renderLayer: 20`；`:219` agent `renderLayer: 30`；`render-projection.ts:50-56` 先按 renderLayer 再按 y/x 排序 → 角色永远盖在家具/墙上，家具永远盖在墙上；`RenderEntityView` 只有 position，无 size/footprint（`world-view.ts:53-64`） | 角色可以"穿"在冰箱前面；多格家具与墙/角色互相穿插；没有纵深 → 画面像贴纸叠加 | §4.2：混合实体层 + sortKey=(footprint 底边 y, layer, x)；多格 footprint 进入协议（§4.9） | L |
| B3 | 无阴影 / 环境光 / 氛围 | `pixi-world-renderer.ts:180-271` 只有 Sprite/AnimatedSprite，无 Graphics/滤镜/光照；场景背景固定 `#20222b`（`:95`） | 家具/角色像贴在背景上；房间没有"室内"感 | P2：预烘焙椭圆阴影 + 全局 tint/夜晚窗光；P0 可先给每个实体加半透明椭圆投影（Graphics） | M |
| B4 | 相机/缩放：静态居中 + 整数化丢面积；无 pan/zoom；DPR 非整数时像素破碎 | `pixi-world-renderer.ts:145-163`：`fitScale=min(availW/mapW, availH/mapH)`；`scale = fitScale<1 ? fitScale : max(1, floor(fitScale))`；无相机容器、无交互缩放。1910×1062 下 `fitScale 3.979→3`，地图仅占 45.6%；DPR1.5 时 `resolution=1.5`、`scale=3` → 每美术像素 4.5 设备像素，实测扫描线 run 长度 4/5 混排 | 大屏上地图缩在中间、四周空；Windows 125%/150% 缩放下像素网格破碎（"模糊/抖动"感） | §4.6：相机容器 + 整数 zoom 档位；渲染分辨率与 scale 联动保证 `scale×resolution ∈ ℤ`；或 canvas 固定 1× 后再整数倍 CSS 放大 | M |
| B5 | 无悬停/选中反馈 | `pixi-world-renderer.ts:265-270` 只设 `cursor="pointer"` + `pointertap`；`world-map.tsx:7-10` props 只有 `view/onSelect`，`app.tsx:162` 的 `selectedId` 从未传入渲染器；实测 hover/点击冰箱 200×200 区域像素变化 **0/0** | 地图不可交互"看起来是静态图"；点击后只有右侧面板变，地图无任何指示 | §4.7：`WorldMap` 接收 `selectedId`；renderer 增加 hover/selection 层（Graphics 描边/角标/脉冲）；点击同步镜头聚焦（可选） | M |
| B6 | 每个 `world_view` 全量重建所有显示对象 | `pixi-world-renderer.ts:132-143`：`removeChildren()` + `child.destroy({children:true})` 后重新 `#createDisplay` 全部 224 个实体；实测 RUNNING 态 ≈9.4 view/s | 每秒约 2,100 次对象创建/销毁；GC 抖动、无法做差分更新、无法维持动画状态 | 对象池 + `entityId` 复用；静态层（地板/墙）只在 view 结构变化时重建；动态层 diff | M |
| B7 | 全量重建导致角色动画被反复重置 | `pixi-world-renderer.ts:213-226` 每次新建 `AnimatedSprite` 并 `play()`；动画帧时长 180ms（`animation-manifest.json:44`），而 RUNNING 态每 ~100ms 重建一次 → 动画来不及推进到下一帧就被销毁重建 | 角色在移动时几乎静止/滑行，动作表现缺失；也解释了"2 个角色在画面里很呆" | 与 B6 一起做对象复用；或把动画状态（frame index/time）提升到 renderer 外部持有 | S（依赖 B6） |
| B8 | `tileSize` 硬编码 | `pixi-world-renderer.ts:257-263` `const tileSize = 16`，不使用 `view.map.tileSize`（协议里锁定 16，见 `world-view.ts:47`） | 当前无害，但一旦支持多尺寸/多地图或相机就会出错；也说明坐标语义分散在渲染器里 | 统一从 `view.map.tileSize` 派生；世界坐标与屏幕坐标分离 | S |
| B9 | 主体/地面绘制顺序依赖"层号约定"而非内容语义 | `view-projector.ts:104` 地板 `renderLayer: 0`、`:114` 装饰 1-19、`:191` 物体 20、`:219` 角色 30；`render-projection.ts:50-56` 排序 | 无法表达"墙上层高于角色"、"地毯在地板之上但在家具之下"等真实层级；多格家具下半部分无法压在角色上 | §4.1 显式分层（L0-L7），层号由渲染投影输出而非固定常量 | M |

### 2.3 地图编排层（`content/worlds/starter-home/world.json`）

| # | 现象 | 证据 | 影响 | 修复方向 | 工作量 |
| --- | --- | --- | --- | --- | --- |
| C1 | 没有外墙 / 窗 / 踢脚 / 门洞，地图边缘直接截断 | `world.json:84-119`：31 个对象 = 25 个 `spatial.wall`（全部 1 格、全部内部、全部 `facing:"north"`）+ 4 个 `spatial.door` + 2 件家具；没有沿地图边界的外墙段，没有窗，没有门洞/门框 | 4 个房间成为 4 块"地板色块"；没有封闭空间，读者无法建立"这是一间公寓"的印象 | P0：用现有素材沿地图边界布置外墙（可用 `tiles.png` 墙列切片 / `furniture.png` 窗 `(373,146)`、`(406,144)`、`(438,172)`、`(405,190)`）；对内部墙带做门洞；P1 用 §4.3 墙体系统 | M（P0）+ L（P1） |
| C2 | 地图尺寸与房间空置率 | 18×12 = 216 格（288×192 逻辑 px）；4 个 zone：客厅 9×6、卧室 9×5、厨房 8×6、卫生间 8×5；187 格地板、29 格是墙带/空 | 每个房间约 40–54 格，却只有 0–1 件家具；空间利用率约 1%（2 件家具 / 187 格） | 缩小房间到 7×5 / 6×4 一类，或把家具/装饰填到每间 4–8 件；补地毯对齐、墙面装饰（画/镜子）、植物 | S |
| C3 | 家具/装饰只有"单点、无尺寸" | `world.json:48-77` 4 张地毯都是 1 个 position；`map-definition.ts:34-42` `DecorationPlacementSchema` 只有 position/resourceId/frameId/renderLayer；`map-definition.ts:55-63` `ObjectPlacementSchema` 只有 position/facing/state，无 footprint | 无法表达 2×3 格冰箱、2×2 格地毯、靠墙组合柜；渲染与模拟的碰撞 footprint 也不一致（定义里 footprint 一律 `[{0,0}]`，见 `plugins/*/definition.ts`） | P1：`DecorationPlacement` 增加 `footprint`+`anchor`；`ObjectPlacement` 暴露 `footprint`；`WorldView` 透传（§4.9） | M |
| C4 | 门只有单帧、开门状态无视觉表达 | `world.json:89/93/103/112` 门有 `state.open/locked`；`asset-manifest.json:100-111` `door` 只有 `default` 一帧；`render-projection.ts:42` 物体 `frameId=facing`，door 资源只有 default → 开门/锁门状态永远同一张图 | 模拟里门会开/锁，但画面上完全看不出；交互反馈断裂 | manifest 增加 door open/closed 帧（或程序化旋转/透明）；投影输出 `state.open` 视觉帧 | S |
| C5 | 没有任何"世界外"内容 | 地图 bbox 之外全是 `#20222b`（`pixi-world-renderer.ts:95` 与 `.world-map` 背景 `app.css:500` 同色） | 地图像悬浮的贴纸；画布空区与地图背景同色，连"地图边界"都不存在 | L0 背景层：地图外地面/草地、房间外投影、地图边框/暗角；背景色与画布区分 | S–M |

### 2.4 协议/投影层

| # | 现象 | 证据 | 影响 | 修复方向 | 工作量 |
| --- | --- | --- | --- | --- | --- |
| D1 | `TileView` 只能表达"单格单帧" | `world-view.ts:34-41`（position/resourceId/frameId/renderLayer）；`MapViewSchema`（`:43-51`）无分层、无 autotile mask、无变体；`FloorRegionSchema`（`map-definition.ts:23-32`）每区域只有一个 frameId | 协议层就堵死了 autotile/变体/地板过渡/多层地板 | 扩展 `TileView`：`variant`、`autotileMask`（或 `edges`）、`layer`；`MapView` 增加 `layers`/`wallTiles` 或独立 `structures` | M |
| D2 | `renderLayer` 是魔法数字约定 | `view-projector.ts:104/114/191/219` 硬编码 0/5/20/30；`world-view.ts:39` 只是 `z.number().int()` | 层语义散落、不可扩展；无法做"墙上层" | 用枚举/具名层（`RenderLayer` 常量表）替代魔法数字；层号随投影输出 | S |
| D3 | 多格家具/装饰不可表达 | `RenderEntityViewSchema`（`world-view.ts:53-64`）无 `footprint`/`size`；`ObjectDefinition.placement.footprint` 存在但只有单格（`plugins/spatial-objects/src/objects/wall/definition.ts:17-25` 等）；渲染器不消费 footprint | 32×48 的冰箱/48×32 的洁具组只能按"1 格 + 美术溢出"画，导致错位与遮挡错误 | 暴露 `footprint:{x,y,w,h}` + `anchorPoint`；渲染器据此算包围盒/排序/遮挡；模拟侧 footprint 同步（注意不能破坏"唯一权威世界"） | M–L |
| D4 | 地板边缘过渡表达不出来 | 同 D1；`view-projector.ts:96-109` 逐格复制同一帧 | 房间边缘与墙带交界是硬切；地毯压在地板上也没有阴影/包边 | autotile 规范（§4.4）+ 边缘帧；地毯/家具加预烘焙阴影 | M |

### 2.5 UI 外壳（`apps/web/src/app/app.css`，仅评估）

| # | 现象 | 证据 | 影响 | 建议（P2） |
| --- | --- | --- | --- | --- |
| E1 | 非像素 UI 与像素画同屏 | `app.css:3` Inter/Segoe UI/微软雅黑；`:133/222/292/680` 等 `border-radius: 4-10px`；`:228-258` 圆角开关；`:800-810` 绿色渐变按钮；lucide 线性图标 | "现代暗色 dashboard + 像素地图"两种视觉语言互相削弱，加剧"像工程 demo 不像游戏" | 像素字体（如 Fusion Pixel / Silver / Zpix）+ 去圆角（radius 0）+ 2px 硬边框 + 像素图标；调色板沿用现有深绿/木色/蓝砖，反而协调 |
| E2 | 画布与舞台底色割裂且无边框 | `app.css:88` stage `#111511`；`:500` `.world-map` `#20222b`；canvas 背景同 `#20222b`（`pixi-world-renderer.ts:95`）；实测地图只占画布 45.6% | 地图看起来是"贴纸孤岛"，空区的深浅差异又把画布边界暴露出来 | 加像素风地图边框/暗角/背景纹理；地图外画布改为环境色（草地/地板延伸/雾）；放大相机（§4.6） |
| E3 | 中英文混排与调试语气文案 | `decision-review.tsx:63` 直接渲染 `pauseReason.message`（来自引擎/场景，如 "Choose a first goal"）；截图顶部横幅同时出现中文和英文；事件条出现 `#124 世界继续运行` 与英文事件名 | 观感破碎、像调试界面 | 文案统一 locale；调试信息移到 inspector 折叠区 |
| E4 | 面板密度/层级 | `app.css:52-65` 12 列/3 行网格；`:359-380` 区域列表、inspector 信息层级较平；关键操作"放行世界"在右下角（`:800-818`） | 交互重心与"看世界"不匹配；地图反而成了画面配角 | P2 视觉层级重排：地图为主、面板为次；像素化后统一间距与边框 |

---

## 3. 图集结构与坐标勘误表

### 3.1 `tiles.png`（528×224）的真实结构

对 alpha 通道做 4-连通分析（22 个连通块）后，图集实际由这些块组成：

| 区域（x,y,w×h） | 内容 | 当前是否使用 |
| --- | --- | --- |
| `(16,16,48×32)` / `(80,16,48×32)` | 木地板 3×2 变体块（两组，共 12 个 16×16 帧） | 只用了每块左上 1 帧（`living-wood`/`bedroom-wood`） |
| `(144,16,48×16)` / `(112,64,48×16)` | 木/砖装饰条（48×16 横条） | 未使用 |
| `(16,64,32×32)` / `(64,64,32×32)` | 砖墙块（2×2） | 未使用（可做外墙/壁炉背景） |
| `(240,16,48×160)` | **墙列 1**：墙顶盖 + 5 段墙纸（粉/橙/蓝/奶油…），无侧饰条 | 未使用 |
| `(304,16,48×160)` | **墙列 2**：带左右侧饰条的墙段（墙端） | 未使用 |
| `(368,16,48×160)` | **墙列 3**：墙顶盖 + 瓷砖护墙板带 + 粉/紫格/奶油带（**厨房/卫生间墙面正确素材**） | 被当作地板用了 2 帧（A1） |
| `(432,96,16×32)` / `(464,96,16×32)` / `(496,96,16×32)` | **独立小地砖 3 色 × 每色 2 变体**（16×16 满格，无腰带） | 未使用（推荐做厨房/卫生间地板） |
| `(432,144,48×32)` | 粉色瓷砖组合（6 个 16×16 中部分为透明） | 未使用 |
| `(25,121,62×65)` / `(153,121,62×65)` | 木色/白色门框（十字形，中间透明） | 未使用 |
| `(96,121,48×67)` | 楼梯 | 未使用 |
| `(432,16,32×64)` / `(480,16,32×64)` | 橙/棕"粗糙面"块（角部有缺口，疑似墙端/过渡件，语义待确认） | 未使用 |
| `(32,192,6×10)` ×4 | 门把手 | 未使用（门状态可视化可用） |

**关键事实**：`tiles.png` 没有"顶视外墙/墙角/地板过渡/踢脚"的成套切片；墙面是**侧视墙纸段**（48 宽 × 160 高的组合块）。这决定了 §4.3 的两种墙体方案必须二选一（顶视墙顶条 vs 2.5D 侧视墙），不能直接把现在 16×16 的墙对象修一修就得到好效果。

### 3.2 坐标勘误表（当前 manifest 全部帧）

> 判定方法：alpha 连通块 bbox + 帧内可见内容 bbox + 图集上下文（48×160 墙列 / 2×3 木地板块）三重交叉验证。

| manifest 资源.帧 | 现坐标 (x,y,w×h) | 图集中的真实内容 | 问题 | 建议坐标 / 处理 |
| --- | --- | --- | --- | --- |
| `floor.living-wood` | `(16,16,16×16)` | 木地板块 A 左上帧 | 单帧铺满全房间（6 变体只用了 1） | 保留帧，另暴露 6 变体帧（`(16/32/48, 16/32)`）并按格 hash 选帧（§4.4） |
| `floor.bedroom-wood` | `(80,16,16×16)` | 木地板块 B 左上帧 | 同上 | 同上 |
| `floor.kitchen-tile` | `(368,32,16×16)` | 墙列 3 第 2 个 16px 带：瓷砖护墙板 + 木腰带 | **误作地板**；腰带每 16px 重复 | 移出 floor；地板用 `(432,96)/(432,112)` 等独立小地砖；该帧改做厨房墙面 |
| `floor.bathroom-tile` | `(368,64,16×16)` | 墙列 3 第 4 个 16px 带：蓝灰瓷砖护墙板 + 腰带 | 同上 | 移出 floor；卫生间地板用 `(464,96)/(464,112)` 或 `(496,96)/(496,112)`；该帧改做卫生间墙面 |
| `wall.default` / `wall.north` | `(48,112,16×16)` | 门框连通块 `(25,121,62×65)` 的底部 7 行，其余透明（44% 不透明） | 墙体只剩 16×7 棕色横条 | 删除；按 §4.3 重建墙系统 |
| `wall.south` | `(48,192,16×16)` | **空帧（0 不透明像素）** | 完全不渲染 | 删除 |
| `wall.east` | `(128,128,16×16)` | 楼梯连通块的一角（81% 不透明） | 墙上出现楼梯纹理碎块 | 删除 |
| `wall.west` | `(32,128,16×16)` | 门框连通块的一角（68% 不透明） | 门框碎片 | 删除 |
| `door.default` | `(464,152,32×40)` | 红门连通块 `(465,157,30×19)`；帧底 16 行透明 | 门悬空 1 格；也只有一个开/关状态 | 裁到 `(465,157,30×19)`；补开门帧/状态视觉（C4） |
| `refrigerator.default` | `(240,240,32×48)` | **浴缸**连通块 `(245,240,23×32)`；帧底 16 行透明 | 名字/用途错误 + 悬空 1 格 | 改名为 `bathtub=(245,240,23×32)`；冰箱素材需另补（图集中无真冰箱） |
| `toilet.default` | `(272,240,48×32)` | 洗手盆 `(274,248,21×24)` + 马桶 `(296,248,21×24)` 两件 | 一帧两件、左右裁切 | 拆成 `basin=(274,248,21×24)`、`toilet=(296,248,21×24)` |
| `carpet.blue` | `(8,24,40×32)` | 真实 bbox `(7,24,34×32)`；帧右多 7px 透明、左裁 1px | 美术中心左偏 3.5 逻辑 px | `(7,24,34×32)` |
| `carpet.purple` | `(56,24,40×32)` | `(55,24,34×32)` | 同上 | `(55,24,34×32)` |
| `carpet.orange` | `(152,24,40×32)` | `(151,24,34×32)` | 同上 | `(151,24,34×32)` |
| `carpet.red` | `(56,72,40×40)` | `(55,72,34×32)`；帧底 8 行透明 | 左偏 4px + 上偏 4px | `(55,72,34×32)` |

### 3.3 已存在但未接线的可用素材（`furniture.png` / `carpets.png`）

> `furniture.png` 共 153 个连通块；下面 20 个是人工核对过语义的代表性素材（坐标=图集裁剪框）。它们都不在 `asset-manifest.json` 里。

| 类别 | 素材 | 坐标 (x,y,w×h) |
| --- | --- | --- |
| 窗 | 上/下半扇双扇窗（组合 22×30） | `(373,146,22×14)` + `(373,162,22×14)` |
| 窗 | 小窗 | `(406,144,20×16)` |
| 窗 | 2×2 格窗 | `(438,172,20×20)` |
| 窗 | 四格宽窗 | `(405,190,22×18)` |
| 窗 | 四格窗（另一变体） | `(372,192,23×16)` |
| 门 | 红门（关） | `(465,157,30×19)` |
| 门 | 红拱门 | `(498,153,28×23)` |
| 厨房 | 灰色台面 | `(375,23,32×25)` |
| 厨房 | 带水槽台面 | `(423,23,32×25)` |
| 厨房 | 灶台 | `(471,23,32×25)` |
| 卧室 | 单人床（红/蓝/绿三色） | `(133,131,22×29)` / `(133,163,23×29)` / `(133,195,23×29)` |
| 客厅 | 书柜（双层） | `(16,222,48×34)` |
| 客厅 | 餐桌 | `(240,20,48×28)` |
| 客厅 | 椅子 | `(195,138,12×20)` |
| 收纳 | 衣柜/双门柜 | `(48,7,33×41)` |
| 卫生间 | 浴缸 | `(245,240,23×32)` |
| 卫生间 | 洗手盆 | `(274,248,21×24)` |
| 卫生间 | 马桶 | `(296,248,21×24)` |
| 装饰 | 画/相框（4 种：风景/海滩/鱼/植物） | `(496,96,16×11)` / `(530,96,28×11)` / `(496,114,16×11)` / `(528,114,16×11)` |
| 装饰 | 小盆栽/花（6 种） | `(500,274,10×14)` / `(516,274,10×14)` / `(532,274,10×14)` / `(468,275,10×13)` / `(483,275,11×13)` / `(529,250,16×22)` |
| 地毯 | 9 张地毯（5+4） | `carpets.png` `(7,24)`、`(55,24)`、`(103,24)`、`(151,24)`、`(199,24)`、`(7,72)`、`(55,72)`、`(103,72)`、`(151,72)`，均为 34×32 |

### 3.4 为什么现有测试没发现这些错误

| 测试 | 现状 | 缺口 |
| --- | --- | --- |
| `tests/assets/asset-manifests.test.ts:58-82` | 只校验"帧矩形在图集内、宽高>0、sheet 尺寸与 PNG 一致" | **不校验帧落在不透明内容上**（`wall.south` 全透明也能过）、不校验帧内容与资源语义、不校验帧 bbox 与美术 bbox 一致 |
| `tests/e2e/basic-loop.spec.ts:43` | `countNonBackgroundCanvasPixels > 1000` | 只要画布不是全黑就过；不校验覆盖率、墙带空洞、地板块重复 |
| `tests/e2e/canvas-pixels.ts:11-61` | 统计非背景像素数与四边 margin | 未用于"地图应占舞台多少"这类构图断言 |
| `apps/web/src/features/world-map/*.test.ts` | renderer 生命周期、投影字段映射 | 未断言帧内容、anchor 语义、遮挡顺序、选中高亮节点 |

→ P0 测试策略必须补「帧内容不透明度/bbox 断言」和「画面构图断言」（§5.4）。

---

## 4. 目标渲染架构

图 `images/render-audit-fig7-target-layers.png` 是图层总览，下面给实现口径。

### 4.1 图层顺序（自下而上）

| 层 | 内容 | 排序键 | 说明 |
| --- | --- | --- | --- |
| L0 背景/环境 | 地图外地面/草地、房间外投影、地图边框/暗角 | 固定 | 解决"贴纸孤岛"（C5/E2） |
| L1 地板（autotile） | 16px 网格、房间内变体、边缘过渡 | 无（静态） | 一次性重建，不进 y-sort |
| L2 地毯/装饰 | 多格矩形，anchor 左上 + footprint(w,h) | 固定 | 支持 2×2 及任意尺寸地毯 |
| L3 结构下层 | 墙基/踢脚、门洞下沿、窗台 | 固定 | 1 格高、贴地 |
| L4 可排序实体 | 多格家具 + 角色混合 | `sortKey = footprint.bottomY`，相同时按 layer/x | y-sort 与遮挡的核心 |
| L5 墙上层/遮挡 | 墙顶盖、窗框、门框上沿、屋檐 | 固定 | 必须盖住其后的实体；墙上层比实体层高 |
| L6 交互反馈 | hover 轮廓、选中描边、可交互点标记、路径预览 | 固定最高 | §4.7 |
| L7 光照/氛围（可选） | 夜晚窗光、室内 tint、软阴影 | 固定 | §4.8 |

**不要**再用"objects=20 / agents=30"这种扁平常量（D2）：L4 内部必须按 footprint 底边排序，L5 必须高于 L4。

### 4.2 y-sort 与遮挡

```
sortKey = (footprint.bottomY - 1) * 1000 + zIndexBias
```

- 家具按其**占地格 bottomY**排序；角色按所在格 bottomY 排序；`footprint.bottomY >` 自身格底边的实体（如 2×3 冰箱）使用最大底边参与排序，保证"角色站在冰箱上方格"时被冰箱挡住下半身。
- 墙（L5）不参与 y-sort：整条墙带永远覆盖 L4。
- 多格家具需要每格一个遮挡片（例如桌腿/床脚）时，把家具拆成"底座（L4）+ 覆盖片（L5）"两个 sprite，共享 footprint。
- 当前反例：`view-projector.ts:191/219` 固定 20/30 + `render-projection.ts:50-56` 先层后 y → 角色永远在冰箱前面。协议需暴露 `footprint`（§4.9）。

### 4.3 墙体系统（二选一，建议先做 A）

**方案 A：2.5D 侧视墙（推荐，直接复用现有 `tiles.png` 墙列）**

- 墙由"墙段"构成：`{startCell, endCell, wallColumnVariant}`，渲染时取 `(240/304/368, 16, 48×160)` 整段 48×160 或按需要裁 16px 高条带。
- 南向墙（面向镜头）：从墙列取 `墙顶盖(16-47) + 墙纸带`，以整段贴到墙带上；玩家看到墙的正面 + 顶盖。
- 北向墙（背向镜头）：只画墙顶盖 + 2px 侧饰条（或用墙列 2 的侧饰条）。
- 门洞/窗洞：在墙段中留空一格，放门框（`(25,121,62×65)`/`(153,121,62×65)`）与窗户（`furniture.png` 窗素材）。
- 视觉收益：与 `furniture.png` 的侧视家具风格一致；素材 0 新增。

**方案 B：顶视墙顶条（更省事但视觉上限低）**

- 墙只画"墙顶盖"：取墙列第 1 个 16px 带（`(240,16,16×16)` 是 48 宽组合块，需要重新切片为可平铺的 16×16 顶面），加 2px 深色描边与阴影，形成"墙体从上方看"的窄条。
- 优点：改动小；缺点：看不到墙纸/护墙板，厨房/卫生间墙面素材用不上，画面仍是"平面图"。

### 4.4 autotile 素材切片规范（P1 落地）

| 类别 | 帧需求 | 现有素材可用性 |
| --- | --- | --- |
| 木地板 | 6 变体（3×2）+ 4 边过渡（可选） | `(16,16,48×32)`、`(80,16,48×32)` 正好是 3×2 变体块 → 直接切 12 帧 |
| 厨房地砖 | 2 色 × 2 变体 + 4 边过渡 | `(432,96,16×32)`/`(464,96,16×32)`/`(496,96,16×32)` → 6 帧 |
| 卫生间地砖 | 同上（可用 `(496,96)` 蓝白或粉色 `(432,144)`） | 同上 |
| 墙顶面 | 横/竖/四角/端头 | 需从 48×160 墙列重切，或新增素材（P2） |
| 墙纸面 | 平铺条带 | 墙列 1/2/3 的 16px 带可直接横向平铺（注意左右端头用墙列 2 的侧饰条） |
| 地板/墙体交界 | 阴影/包边 2–3px | 可用 1px 深色线 + 半透明投影程序化生成，不需素材 |

**选帧规则**：`variant = hash(worldSeed, floorRegionId, x, y) % variantCount`（确定性；同一格在不同渲染中稳定）。边缘过渡用 8 邻域 mask（N/E/S/W 四邻地板是否同类）索引过渡帧。

### 4.5 多格家具与地毯

- `DecorationPlacement` / `ObjectPlacement` 增加：`footprint: {x,y,w,h}`、`anchor: "top-left" | "bottom-center"`、可选 `flipH`。
- 渲染：`RenderEntity` 增加 `footprint`，anchor 决定 sprite 对齐方式；地毯用 top-left + footprint（2×2 → 64×64 逻辑 px），帧裁到真实 bbox 后铺满 footprint。
- 模拟侧：`ObjectDefinition.placement.footprint` 已经是单格数组，需要扩展到多格（`[{0,0},{1,0},...]`），并同步 `map-loader.ts:183-189` 的越界校验、遮挡/寻路/交互偏移。**注意**：视觉 footprint 与模拟 footprint 可以分离（视觉用 `visualFootprint`，模拟保持现状），避免一次改动破坏世界规则。

### 4.6 相机 / 缩放 / 像素对齐

- 引入 `camera` 容器：`camera.scale` 只接受整数档（1/2/3/4…），`camera.position` 取整到「一个美术像素对应的设备像素」的整数倍。
- **像素对齐公式**：`devicePixelsPerArtPixel = worldScale × rendererResolution` 必须为整数。Pixi `resolution = min(devicePixelRatio, 2)`，因此在 DPR 1.5 下需要把 `worldScale` 调成 `2/3` 的倍数（如 3 → 2）或把 canvas 固定为 1× 后用 CSS 整数倍放大。推荐：**canvas 始终 1×，CSS 整数倍放大 + `image-rendering: pixelated`**，这样任何 DPR 都像素完美。
- 至少让地图填满舞台：在 1910×1062 下可用高度 `788-24=764`，`192×3=576` 只用了 75%；若房间尺寸/地图长宽比调整到接近舞台比例，`floor(fitScale)` 可到 4，覆盖率可从 45.6% 提到 ~70%。
- 可选：滚轮缩放（整数档）+ 拖拽平移（按 map 边界 clamp）；点击实体自动居中（配合 §4.7）。

### 4.7 悬停 / 选中反馈

- `WorldMap` props 增加 `selectedId`；`app.tsx:162` 传入（当前只传 `onSelect`）。
- Renderer 维护 `#hoveredId` / `#selectedId`；L6 层为选中实体画：
  - 2px 亮色描边（矩形/轮廓）；
  - 底部椭圆/角标；
  - 可选：脉冲 alpha 动画（0.6–1.0）。
- hover 用 `pointerover/pointerout`（目前只有 `pointertap`，`pixi-world-renderer.ts:265-270`）。
- 选中状态不能依赖 sprite 重建：对象池（B6）后按 id 更新描边即可。

### 4.8 光照 / 阴影（P2，可选）

- 预烘焙：家具 sprite 自带底部投影（当前素材没有）；程序化：每个 L4 实体脚下画半透明白/黑椭圆（Pixi Graphics，1 个 draw call 一个容器）。
- 环境：夜晚模式给整个 worldLayer 加 tint（暖黄/冷蓝）；窗外光斑用 L5 层半透明矩形。
- 性能：避免每帧 filter；用静态容器 + tint。

### 4.9 协议/数据模型改动汇总

| 变更 | 位置 | 兼容策略 |
| --- | --- | --- |
| `TileView` 增加 `variant` / `autotileMask` / `layer` | `packages/protocol/src/view-models/world-view.ts:34-41` | schemaVersion 不升，字段可选默认 0 |
| `MapView` 增加 `layers` 或 `structures`（墙段/门洞/窗） | 同上 `:43-51` | 可选字段，旧客户端忽略 |
| `RenderEntityView` 增加 `footprint` / `anchorMode` / `flipH` | 同上 `:53-64` | 可选字段 |
| `DecorationPlacement` / `ObjectPlacement` 增加 sizing | `packages/simulation/src/map/map-definition.ts:34-42` / `:55-63` | 默认 1×1；世界文件按需填写 |
| 层号具名化（`RenderLayer`） | `view-projector.ts:104/114/191/219` + 渲染投影 | 纯内部重构 |
| floorRegions 扩展为 tile-level 变体/边缘 | `map-definition.ts:23-32` | 先保留 region 表达，渲染侧按 hash 派生变体（P0 就能做，无需改协议） |

---

## 5. 分阶段落地计划

### 5.1 P0：修错映射与空场景（0 新素材，~2–3 天）

| 项 | 内容 | 拟改文件 | 测试 |
| --- | --- | --- | --- |
| P0-1 | 修 manifest 全部勘误（§3.2）：墙帧删除/重映射、厨房/卫生间地板换独立小地砖、门/冰箱/马桶/地毯帧裁到真实 bbox | `plugins/home-objects/assets/asset-manifest.json` | 扩展 `tests/assets/asset-manifests.test.ts`：帧不透明度≥阈值、内容 bbox 与声明宽高偏差≤1px；地板帧必须 100% 不透明 |
| P0-2 | 扩充资源接线：床、沙发、台面、水槽、灶台、窗、红门、浴缸、洗手盆、马桶、书柜、餐桌、椅子、衣柜、植物（§3.3） | `asset-manifest.json` + `plugins/home-objects/src/objects/*`（新增定义需 host 交互定义；纯装饰可走 `decorations` 不进模拟） | 新增 manifest 单测；`tests/scenarios/starter-home-load.test.ts` 回归 |
| P0-3 | `world.json` 重排：加外墙（沿边界）、窗户、门洞/门框、每间 ≥3 件家具 + 1 件装饰；地毯改 2×2 且对齐网格；地图缩到 14×10 或按舞台比例拉长 | `content/worlds/starter-home/world.json` | `map-loader` 校验；新增构图 e2e（§0.3） |
| P0-4 | 门/地毯/装饰的 anchor 修正：按内容 bbox 或 resource 级 anchor 显式声明；装饰加 `footprint`（先做渲染侧，不改模拟） | `pixi-world-renderer.ts`、`render-projection.ts`、`map-definition.ts`（可选） | 单测：给定 anchor + frame 断言 sprite 位置；截图对比 |
| P0-5 | 选中/悬停反馈：`WorldMap` 收 `selectedId`，renderer 画描边 | `world-map.tsx`、`pixi-world-renderer.ts`、`app.tsx` | 单测（高亮节点数）；e2e：点击后地图区域 diff > 0 |
| P0-6 | 缩放取整：canvas 固定 1× + 整数倍 CSS 放大；地图覆盖画布 ≥70% | `pixi-world-renderer.ts`、`app.css` | e2e 断言 DPR 1/1.5 下 run length 只有整数；覆盖率断言 |
| P0-7 | 动画生命周期随对象复用修复（至少避免每 view 重建 AnimatedSprite） | `pixi-world-renderer.ts` | 单测：两次 render 后同一 agent 的 sprite 实例复用 |

**P0 验收**：图 `fig2`/`fig3`/`fig4` 中所有错帧消失；画面上能看到 4 间带外墙、带窗、带门的房间，每间 ≥3 件家具；地图覆盖 ≥70%；hover/选中可见；DPR 1.5 下像素网格完整。

### 5.2 P1：渲染结构升级（~5–7 天）

| 项 | 内容 | 拟改文件 | 测试 |
| --- | --- | --- | --- |
| P1-1 | 图层化 + 相机容器（L0–L6）+ 整数 zoom | `pixi-world-renderer.ts`（拆模块）、`render-projection.ts` | 单测：layer 顺序、camera 取整；e2e：缩放后 run length |
| P1-2 | y-sort + 多格 footprint（渲染 + 协议） | `render-projection.ts`、`world-view.ts`、`view-projector.ts`、`map-definition.ts` | 单测：给定位置/footprint 断言排序；场景测试：角色在冰箱后/前 |
| P1-3 | 墙体系统（§4.3 方案 A）+ 门洞/窗洞 | `render-projection.ts`、`world.json`、新增 wall model | 单测：墙段拼装/门洞留空；e2e：墙带空洞率 ≤5% |
| P1-4 | 地板 autotile/变体（§4.4） | `render-projection.ts`、`renderer`、协议（可选） | 单测：帧选择确定性、边缘 mask；e2e：相邻地块不逐字节相同 |
| P1-5 | 对象池 + 差异更新 + 动画状态外置 | `pixi-world-renderer.ts` | 性能测试：100 次 render < 预算；单测：复用实例 |
| P1-6 | 地牢式照明预留（L7 容器） | `pixi-world-renderer.ts` | 快照回归 |

**P1 风险**：协议字段扩展要同步 simulation worker / view projector / 测试 fixtures；多格 footprint 改动可能影响寻路/占用/交互距离 → **视觉 footprint 与模拟 footprint 分离**，模拟侧保持现有单格逻辑直到单独 PR 验证。

### 5.3 P2：素材/表现打磨（~3 天）

- 像素 UI 主题：像素字体、去圆角、硬边框、像素图标（`app.css` 全量主题化）。
- 素材补齐：顶视外墙/墙角/地板过渡套件（或采用外购/免费素材，需登记 manifest + LICENSE）；更多家具变体；外景（草地/天空/夜景）。
- 光照/阴影：家具投影、夜晚窗光、房间 tint。
- 文案与信息架构：中英统一、调试信息收进折叠面板。

**P2 风险**：素材许可证合规（沿用 `tests/assets/asset-manifests.test.ts` 的"只提交 5 张运行时 PNG"约束）；scope 蔓延；像素字体要在 UI 中保持可读性（字号/行高）。

### 5.4 测试策略总表

| 层级 | 新增/扩展 | 断言 |
| --- | --- | --- |
| 素材单测 | `tests/assets/asset-manifests.test.ts` | 帧在图集内（已有）+ 帧不透明度阈值 + 内容 bbox 与帧尺寸一致 + 地板帧 100% 不透明 |
| 渲染单测 | `render-projection.test.ts` / `pixi-world-renderer.test.ts` | 帧选择确定性、anchor 位置、layer 顺序、选中高亮节点、对象复用 |
| 模拟/世界单测 | `map-loader.test.ts`、`starter-home-load.test.ts` | 新 world.json 可加载、footprint 不越界、装饰 ID 唯一 |
| e2e 构图断言 | `tests/e2e/basic-loop.spec.ts`（扩展）+ 新增 `world-render-quality.spec.ts` | 覆盖率≥70%、墙带空洞≤5%、相邻地块不同、每间家具≥3、hover/点击 diff>0、DPR1/1.5 像素对齐 |
| 视觉回归 | Playwright `toHaveScreenshot` | 固定视口/场景的关键帧快照（P0 完成后建立基线） |

---

## 6. 素材 vs 管线：量化判断的依据

### 6.1 交叉验证：只改 manifest + world.json 能到什么程度？

把 §3.2 的勘误全部修正、并按 §3.3 接入 20 个已有素材（0 新素材）后：

| 当前破绽 | P0 后是否消除 | 依据 |
| --- | --- | --- |
| 厨房/卫生间像墙纸 | ✅ | 换 `(432,96)` 等独立小地砖；墙纸帧改做墙面 |
| 没墙、房间是色块 | ✅ 大部分 | 用现有墙列切片布置外墙/内墙带 + 门洞；墙带空洞从 58.4% 降到 <10% |
| 家具只有 2 件 | ✅ | 接入床/沙发/台面/窗/门/浴缸等 20+ 素材 |
| 地毯偏移/单帧 | ✅ | 裁真实 bbox + footprint 对齐 |
| 门/冰箱悬空 | ✅ | 裁内容 bbox/修正 anchor |
| 角色永远盖住家具 | ❌ | 需要 P1 y-sort + footprint |
| 地板重复、无过渡 | ⚠️ 部分 | 可用 6 变体 hash 替换，但边缘过渡/autotile 需 P1 |
| 地图只占 45.6% | ❌ | P0 可缓解（重排世界尺寸/整数倍放大），根治需 P1 相机 |
| 像素破碎（DPR1.5） | ✅ | P0-6 可修 |

→ **P0（0 新素材）可消除当前画面 4 类破绽中的 3 类，并把"结构缺失"从致命降为可接受。** 这是"素材不是主因"的最直接证明。

### 6.2 占比估算

| 阶段 | 工作量 | 其中需要新素材的比例 | 说明 |
| --- | --- | --- | --- |
| P0 修映射+接线+编排 | ~2–3 天 | **0%** | 全部使用现有图集 |
| P1 渲染结构 | ~5–7 天 | ~5% | 墙体切片规范可能需补 1 张过渡图；其余用现有素材 |
| P2 打磨 | ~3 天 | ~50–60% | 顶视墙套件、外景、像素字体、更多家具变体 |
| 合计 | ~10–13 天 | **约 20–30%** | 管线/编排 ≈70–80%，素材 ≈20–30% |

**结论**：当前问题按"症状"排序是「素材帧错误（免费修）→ 场景编排空（免费修）→ 渲染结构缺失（代码工作量）→ 素材风格上限（最后再补）」。**先投渲染管线与地图编排，收益率最高；素材库不是当前瓶颈。**

---

## 7. 附录

### 7.1 当前画面逐项清单（截图证据）

图 `images/render-audit-fig1-current.png` 中逐项标注：

1. 画布 1386×788，地图 864×576（45.6%），四周纯背景。
2. 墙带（第 9 列 + 第 6 行）66,816 px 中 58.4% 是背景空洞；可见的棕色横条只是门框碎片的 7px 部分。
3. 厨房"地板"= 墙列第 2 个 16px 带（蓝瓷砖护墙板 + 木腰带）。
4. 卫生间"地板"= 墙列第 4 个 16px 带（蓝灰瓷砖护墙板 + 腰带）。
5. 地毯 4 张：单帧、居中、偏 3.5 逻辑 px。
6. "冰箱"= 浴缸；"马桶"= 洗手盆 + 马桶两件。
7. 187 块地板 4 种帧；客厅/卧室 0 件家具。
8. 角色 2 个，48×48 帧（3×3 格），与环境 16px/格的比例尚可，但动画在 RUNNING 态被反复重置（B7）。

### 7.2 测量方法

- **帧内容核验**：Pillow 读 PNG → alpha 连通块 bbox → 与 manifest 帧相交 → 帧内可见内容 bbox；再用「渲染截图 16×16 抽样块 vs 图集帧」逐像素 diff（结果 0 或 22.6/255 平均误差两种，前者为命中）。
- **构图测量**：Playwright 截图 → 找非背景像素 bbox（地图内容 bbox）→ tile 尺寸 = bbox 宽/18 → scale 推断；墙带空洞 = 墙带范围内等于背景色 `#20222b` 的像素数。
- **DPR 缩放**：`deviceScaleFactor=1.5` context 截图 → 扫描线 run-length 直方图（DPR1 只有 3；DPR1.5 为 4/5 混排）。
- **消息频率**：页面内 `addInitScript` 包装 `WebSocket`，计数 `message` 事件 5 秒 + `worldVersion` 增量交叉验证。
- **选中反馈**：点击冰箱精确屏幕坐标（由地图原点 + 格坐标 + scale 推导）→ 点击前后 200×200 区域逐像素 diff。
- 审计辅助脚本（不提交，仅复现用）：`workspace/visual-audit/{shoot.mjs,shoot2.mjs,shoot3.mjs,atlas_audit.py,frame_catalog.py,analyze_repro2.py,make_figures*.py}`。

### 7.3 未覆盖 / 待确认

- `tiles.png` 两个 32×64"粗糙面"块 `(432,16)`/`(480,16)` 的语义（疑为墙端/过渡件）未确认；若确认可用于外墙，可减少 P2 素材缺口。
- 图集来源/许可文件未在仓库中（`tests/assets/asset-manifests.test.ts:120-147` 只约束文件清单）；引入新素材前需补 LICENSE 记录。
- 侧视/顶视风格最终取向（§4.3 方案 A vs B）属于产品审美决策，需要与场景 mock/素材选型结果对齐后定稿。
- 性能基线（对象池收益、Draw call 数）未做 profile，P1 前需补一次浏览器 Performance 录制。

---

*本审计为只读产出；所有数字均可由 §7.2 方法在 `basic-loop` 场景复现。*
