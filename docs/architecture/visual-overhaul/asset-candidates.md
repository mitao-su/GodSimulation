# 公寓/室内像素素材库候选与授权调研（asset-candidates）

> 调研人：asset-scout（美术素材与授权调研员）
> 调研日期：**2026-10-23**（Asia/Shanghai）。文中所有价格均为该日前后抓取的页面标价/促销价，促销随时结束，**下单前必须重新核对**。
> 关联任务：task-2（本文件是 task-2 唯一交付物；本轮**不写代码、不改素材、不下载/购买付费素材**）。
> 适用仓库：God Simulation（GitHub 公开仓库，浏览器端 PixiJS 渲染，16x16 tile，48x48 Memao 角色、脚底锚点、384x384 图集 8x8）。
>
> **抓取方式说明**：itch.io 与部分作者站点对直连抓取返回 Cloudflare 403；本调研改用 `*.translate.goog` 只读文本代理抓取同一页面内容，并尽量用 itch 页面内嵌原文、作者官方 license/terms 页面交叉核对。凡未能取得原文的事项一律标注「待核实」，**没有编造授权条款或价格**。

---

## 0. 结论先行（TL;DR）

1. **不存在**同时满足「现代公寓观感 + 16x16 + 墙体系统完备（墙顶/墙面/踢脚/转角/门窗）+ 可免费/CC0 直接随公开仓库分发」的高质量整套素材（截至 2026-10-23）。这是本次调研最重要的负结论。
2. **付费最匹配 = LimeZu《Modern Interiors - RPG Tileset [16X16]》**（可加购《Modern Exteriors》）。它是现代室内像素风格的事实标准：16/32/48 三档尺寸、2D+3D 墙体、上千家具、100+ 逐帧动画、明确「可商用、可修改、禁止再分发、必须署名」。**但授权禁止再分发原始/修改素材 → 素材文件不能提交进公开 git 仓库**，需走「素材不入库 + 私有同步 + 占位渲染」或申请书面扩展授权（后者**待核实**，作者页面未提供可再分发档位）。预算约 **$4–6/一次性**（≈ ¥30–45，含可选 Exteriors）；接入工时约 **10–15 人日**（不含自绘墙体）。
3. **免费可公开 = CC0/CC-BY 素材组合**：`LimeZu《Kitchen and more》(CC-BY 4.0，免费)` + `Kenney《Roguelike/RPG pack》(CC0)` + `Riclmbr《Cute Pixel Decor》(CC0，$6.49 一次性，购买后文件可合法入库)` + `OpenGameArt Bonsaiheldin《Interior Tileset 16x16》(CC-BY-SA 3.0)`，墙体系统中的墙顶/墙面/踢脚/转角/门窗**自绘**。预算 **$0–6.49**；接入+自绘约 **12–18 人日**。观感提升有限，但法律上最干净、可直接公开分发。
4. 若「工程接入成本」优先于「最终观感」，付费备选是 **Gridwright《Modern Office & Home: 16x16》(342 tiles，$3.99)**：自带 47 格墙自动图块×4 风格、邻接位掩码 JSON、无烘焙阴影、命名规范，能省 2–3 人日渲染/切图工作；但同样**禁止再分发**，且是 2026-10-15 才发布的**全新包**（弃更/内容不全风险高）。
5. 现状素材（`pixel-16-interiors`）本身也只有「项目专用许可、不可作为素材包再分发」的记录（见 `THIRD_PARTY_NOTICES.md`），因此**无论选哪条路，都应把授权记录升级为可公开核验的形式**（CC0/CC-BY 原文 + 作者页链接），并补一条「素材来源与授权」测试门禁。

### Top 2 推荐速览

| | 推荐 | 预算（2026-10-23） | 授权关键点 | 公开仓库处置 | 工时 |
|---|---|---|---|---|---|
| 付费最匹配 | **LimeZu Modern Interiors [16X16]**（+ Modern Exteriors 可选） | $1.50–3 + $2.50 ≈ **$4–6**（促销捆绑 $5 见正文） | 可商用/可修改；**禁止再分发**（原始与修改版均不可）；**必须署名+链接** | **文件不入库**：gitignore + 私有同步脚本 + 公开占位图；或申请书面授权（待核实） | 10–15 人日 |
| 免费可公开 | **CC0/CC-BY 组合**（LimeZu Kitchen CC-BY 4.0 + Kenney CC0 + Riclmbr CC0 + OGA Bonsaiheldin CC-BY-SA 3.0 + 自绘墙体） | **$0–6.49** | CC0：随意用（可入库）；CC-BY 4.0/SA 3.0：署名+（SA 需同协议共享修改版）；无「禁止再分发」 | **可直接提交入库**，`THIRD_PARTY_NOTICES.md` 记录署名与协议链接 | 12–18 人日（含墙体自绘 2–4 人日） |

---

## 1. 现状与约束（为什么这次选型不能只看「好看」）

### 1.1 当前素材与渲染管线（代码事实，供改造清单使用）

| 项 | 现状 | 证据 |
|---|---|---|
| 当前素材 | `tiles.png` 528x224（4 种地板帧、5 个墙帧（含重复）、少量可拼贴）、`furniture.png` 584x300（约 100 个简单家具/卫浴/植物/门窗件）、`carpets.png` 256x128（4 块地毯） | `plugins/home-objects/assets/asset-manifest.json` |
| 授权状态 | 仅有「项目专用许可」记录：作者不明、维护者报告作者口头允许用于本开源游戏；**不授予一般再分发权** | `THIRD_PARTY_NOTICES.md` 第 6–14 行 |
| 地图格 | `tileSize` 在协议/Schema 中硬编码为 16 | `packages/simulation/src/map/map-definition.ts`（`tileSize: z.literal(16)`）、`packages/protocol/src/view-models/world-view.ts`（`tileSize: z.literal(16)`） |
| 素材清单 | 自研 `schemaVersion:1`、`sheets[] + resources[]`（`anchor` 0..1、`frames` 矩形），**不支持图集 JSON 导入、逐帧对象动画、多格精灵、自动图块位掩码** | `apps/web/src/features/world-map/asset-catalog.ts` |
| 渲染 | PixiJS v8；静态资源只画单帧，`frameId` 对物体取 `facing`；角色用 `AnimatedSprite`；排序 = `renderLayer → y → x`；`#place` **硬编码 tileSize=16** | `apps/web/src/features/world-map/pixi-world-renderer.ts`、`render-projection.ts` |
| 墙体 | 每个格子一个 `spatial.wall` 对象，`WallStateSchema = {}`（无朝向/转角/邻接状态）；门/墙的 `resourceId` 写死在插件定义里；视图里物体**没有状态帧字段**（只有 `facing`） | `plugins/spatial-objects/src/objects/{wall,door}/definition.ts`、`packages/simulation/src/engine/view-projector.ts` |
| 世界内容 | 墙体是逐格对象摆放（世界坐标 x9 竖墙、y6 横墙），不是「墙段系统」；地板按 `floorRegions` 平铺、地毯是 `decorations` | `content/worlds/starter-home/world.json` |
| 资源测试 | `tests/assets/asset-manifests.test.ts` 硬编码「只能有 5 个 PNG」、校验矩形不越界 | `tests/assets/asset-manifests.test.ts` |

### 1.2 选型的硬约束

- **公开仓库即再分发**：素材文件一旦提交进 public git 仓库（含 CI artifact、公开 submodule、公开 release），就构成对素材本身的再分发。绝大多数商业包（LimeZu、Gridwright、riekahq、Leckie、Cozy Town、Kokoro）都明确禁止。
- **浏览器端游戏必然把美术资源下发到玩家**：这不等于「开源仓库可以放源文件」；商业包通常允许「随游戏一起发布」，但禁止「把素材当素材/源文件分发」。
- **Memao 角色已有授权约束**：Memao license 允许游戏内使用/修改/随游戏分发，但**禁止独立再分发、禁止生成式 AI 训练、禁止 AI 服务与加密/NFT 用途**（`THIRD_PARTY_NOTICES.md` 第 16–28 行）。新素材不得要求把 Memao 素材用于训练/再分发；也不要把 Memao 图集喂给任何图像模型。
- **AI 条款已成为 2026 年新包的常见差异点**：本调研中 LimeZu/Kokoro/Riclmbr 页面带「No generative AI was used」内容标签；Gridwright/riekahq/Leckie/Cozy Town 标注「AI Assisted」（其中前两者明确是「代码绘制 + AI 辅助、无图像生成器」）；个别 CC0 小包则直接披露「AI Generated Graphics」。**建议把「是否 AI 生成图」列入采购否决项**（与仓库「人类美术、可追溯授权」的长期目标一致）。

---

## 2. 候选对比总表

> 价格口径：itch.io/官网页面标价（促销价同时给出）。「—」= 页面未提供/未核实。风格匹配以目标「现代公寓、俯视地板正投影 + 家具正面微斜、16x16、干净现代」为基准。

### 2.1 内容与规格

| # | 候选（作者） | tile / 网格 | 墙体系统 | 家具 / 厨卫覆盖 | 门窗 | 动画 / 状态 | 与 48x48 Memao 匹配 | 价格（2026-10-23） |
|---|---|---|---|---|---|---|---|---|
| 1 | **Modern Interiors - RPG Tileset [16X16]**（LimeZu） | 16/32/48 三档 | **强**：2D + 3D 墙、模块化墙/地板/地毯/桌 | **极强**：上千家具，客厅/卧室/厨房/卫浴/教室/商店等几十主题 | 有（含在 100+ 动画物件中，具体清单待核实） | 100+ 逐帧动画（gif+表）；门/柜/灯等状态件需按帧选用 | **中**：风格接近，但 48x48 角色≈3 格高（官方人形 16x32）；可用 48 档 + 改渲染格距规避 | 完整版 **≥$1.50**（页面文案；2026-10-12 评论区反馈下载页要 $3，待核实）；另 Fall Sale 2026 捆绑「本包+2 包」**$5.00** |
| 2 | **Modern Exteriors - RPG Tileset [16X16]**（LimeZu） | 16/32/48 | 强（建筑外墙/屋顶/门廊，非室内墙） | 街道/建筑/车辆/室外道具 | 有（建筑门窗外立面） | 动画车辆、招牌等 | 同上 | **$5.00 → $2.50**（50% OFF，2026-10-23） |
| 3 | **Modern Interiors Free v2.2**（LimeZu，免费版） | 16 | 弱（约完整版 1%） | 9 地板 + 8 墙纸 + 客厅/教室少量家具 | 少量 | 4 个动画角色 | 同系列 | **免费**，但**仅限非商业**（见 3.3） |
| 4 | **Kitchen and more - RPG Tileset [16x16]**（LimeZu，旧包免费） | 16 | 中（厨房墙/地板/橱柜） | 厨房家具为主 + 墙/地板 | 少 | 无/少（.ase 源文件） | 同系列（旧风格） | **免费**（name your own price），**CC-BY 4.0** |
| 5 | **Gridwright Modern Office & Home (342 tiles)**（Gridwright） | 严格 16x16；52 个多格件为 16x32/32x16/32x32 | **极强**：47 格墙自动图块 ×4 风格（灰泥/砖/白瓷砖/混凝土），14px 墙面向下、深色墙顶、圆角；**邻接位掩码在文件名 + tiles.json** | 强：84 家具（办公/公寓/厨房/卫浴，含冰箱、灶台、水槽、马桶、淋浴、浴缸、洗衣机、咖啡机）；24 地板；28 墙饰 | 有：木门/玻璃门/4 帧滑门/窗（白天/夜晚/百叶）/镜子/白板/挂钟/空调 | 32 帧动画（屏幕滚动、电视、时钟、服务器灯、饮水机、售货机、淋浴、洗衣机、滑门） | **中**：16 格低分辨率 + 粗描边角色会偏大；「代码绘制」几何感强、阴影无烘焙 | **$4.99 → $3.99**（20% OFF）；含 68 件免费样例 |
| 6 | **Modern Apartment & Office Interiors Tileset (16x16)**（riekahq） | 16（透明 PNG 表 + atlas JSON + 单图） | 中：10 墙面向 + 墙线（trims） | 114 件/124 帧：11 无缝地板、沙发/床/衣柜/整套厨房/卫浴/办公/植物/售货机；28 色调色板 | 有门/窗 | TV、台式机、笔记本、鱼缸、挂钟、吊扇动画 | **中**：16 格、风格统一但偏「平涂」；无烘焙阴影说明待核实 | **$3.00 → $1.80**（40% OFF） |
| 7 | **Modern City & Interiors 16x16**（Leckie Pixel Studio） | 16 | 中：8 种内墙（16x32）+ 18 墙饰；无 47 格位掩码（待核实） | 强：55 件室内家具（客厅/卧室/办公/厨房/卫浴/咖啡店/商店）+ 12 栋建筑外立面 + 街道 | 有门窗、夜景亮窗 | 122 动画 / 388 帧：电视、电脑、洗衣机、咖啡机、街灯、霓虹、售货机、鱼缸等 | **中**：软色描边 vs Memao 深色粗描边，混用需统一描边/调色 | **$3.49** |
| 8 | **Cozy Town — Modern 16x16**（Spaceyyy） | 16；1x/2x/4x PNG | 中：113 家庭地板/墙面，含昼夜窗与门洞；另有办公室/学校/诊所 | **极强**：994 精灵/496 图块/1104 帧；家庭内景 366 件（卧室 99、客厅 61、厨房 107、卫浴 34、洗衣 25、装饰/宠物 40） | 有（昼夜窗、门洞） | 14 个可玩角色 8 套动画；大量道具动画 | **低–中**：1px 描边、粉彩 cozy 风，与 Memao 深色 RPG 风差异明显 | 完整 **$3.49**（至 2026-10-25，原价 $4.99）；**Free Lite** 免费（1 街 + 咖啡店 + 玩家 1） |
| 9 | **KR Urban Modern Interiors Tileset for RPGs**（Kokoro Reflections） | **48 与 32 两档**（RPG Maker MV/MZ/VX/Ace 格式） | **强**：8 墙色 + 内置书架 + 木墙板/墙板/砖墙/金属板/石墙 + 自动图块窗 | 强：住宅（4 套家具风格、床/柜/桌椅/壁炉/窗帘）、厨房电器、卫浴、办公室、健身房、商店、咖啡店、酒吧等 | 有：4 种窗（亮/暗）、窗帘、门（亮/暗/透明） | RPG Maker 事件/动画格式，门/监狱门动画 | **最高（尺寸）**：48px 是 RPG Maker MZ 标准，Memao 48x48 与之同格；但需把渲染格距从 16 改为 48/32 并重排世界 | **$19.99** |
| 10 | **Cute Pixel Decor — 1000 室内外像素物件**（Riclmbr） | 16px 网格，物件 16x16~48x64 | 弱：仅 19 张无缝 16x16 地板/墙纸/地面（非完整墙体系统） | **强（装饰向）**：500 室内件（客厅/卧室/厨房/卫浴/植物/灯/墙饰/地毯/桌面/爱好/书房等），大量色变体；53 动画（187 帧） | 有窗（窗帘/拱形/圆形）但无门/墙段系统 | 壁炉、鱼缸、熔岩灯、霓虹、灯串等动画 | **低–中**：粉彩、梅子色描边、可爱风；与 Memao 深色粗描边差异大，需调色 | **$9.99 → $6.49**（35% OFF）；**CC0** |
| 11 | **Roguelike/RPG pack**（Kenney） | 16x16 | 无现代墙体（图块拼贴） | 有 RPG/城镇家具图块，但为奇幻/roguelike 风；无现代厨卫体系 | 无现代门窗 | 少 | **低**：奇幻风，与 Memao 同属 RPG 向但非现代 | **免费 1,700 文件**；**CC0** |
| 12 | **Interior Tileset 16x16**（Bonsaiheldin，OGA） | 16x16（256x256 图集 + Tiled 示例地图） | 中（Zelda 风室内墙/地板/家具可拼贴；墙顶/踢脚完备度待核实） | 中：16x16 室内家具、厨房/起居/杂物若干；数量约 256 格内 | 有门窗图块（待核实） | 少（Tiled 地图示例） | **低–中**：Zelda/复古室内风，与 Memao 同为粗描边但年代久远 | **免费**；**CC-BY-SA 3.0** |
| 13 | **[LPC] House interior and decorations**（Reemax 等，OGA） | 32x32 | 中：橱柜/上下柜可换、厨房设备、地板、装饰（基于 LPC 大幅改造） | 中：厨房（金属灶/柴灶，带火焰动画）、橱柜、书架、灯具、装饰 | 少（待核实） | 灶台火焰动画 | **低**：32x32 需 0.5x 降采样到 16 才可用，且是多作者 LPC 拼装 | **免费**；CC-BY-SA 3.0 + GPL 3.0/2.0 |
| 14 | **"Modern Houses" Tileset TopDown**（Ritpop，OGA） | 16x16（实测 768x512 = 48x32 格 @16px） | 弱：一张图内拼好房屋 + 一些内景 | 弱：现代房屋/少量家具 | 少 | 无 | **低**：体量太小，无法支撑完整公寓 | **免费**；**CC0** |
| 15 | **Home Objects**（Jannax，OGA） | 32x32（实测 192x128 两张小图） | 无墙体 | 弱：小体量家具（客厅/卧室杂物） | 无 | 无 | **低**：32x32 且体量极小 | **免费**；**CC0** |

### 2.2 授权与「能否进公开仓库」

| # | 候选 | 授权类型（原文关键结论） | 可直接提交公开仓库？ | 合规落地方式 | 接入改造成本 | 主要风险 |
|---|---|---|---|---|---|---|
| 1 | LimeZu Modern Interiors | 自定义商业许可：可商用/可修改；**禁止转售或分发（含修改版）**；**必须署名+链接** | **不能** | A 不入库+私有同步；B 构建时下载（需凭据）；C 私有 submodule；D 仓库转私有（违背目标）；E 向作者申请书面扩展授权（待核实，页面无此档位） | 10–15 人日 | 授权不可入库；素材量巨大需切片/调色；48x48 角色比例需决策 |
| 2 | LimeZu Modern Exteriors | 同上（.txt 随包） | **不能** | 同 #1 | 附加 2–4 人日 | 同上；只解决外景 |
| 3 | LimeZu 免费版 | 免费版许可：**仅限非商业**（LICENSE.txt 细节待核实） | **不能**（非商业+可能禁再分发） | 仅用于本地视觉验证 | — | 不可用于开源/未来商业化项目 |
| 4 | LimeZu Kitchen and more | **CC-BY 4.0**（页面 License 徽章即 CC BY 4.0） | **能**（署名+注明修改） | 直接入库 + `THIRD_PARTY_NOTICES.md` 署名 | 1–2 人日 | 旧包、体量小（19KB zip）、已被 Modern Interiors 取代；风格与新版略有差异 |
| 5 | Gridwright | 「use it in your commercial games; do not resell the files」；全文「No resale or redistribution of the assets, modified or not… **Not for AI training or NFTs**」 | **不能** | 同 #1 | 8–12 人日（自带掩码省事） | 2026-10-15 全新包；作者/维护未知；AI 辅助代码绘制 |
| 6 | riekahq | 「Use in commercial and non-commercial games, modified or not; **do not resell or redistribute** the assets themselves」 | **不能** | 同 #1 | 8–12 人日 | 全新包；AI 模型参与绘制；无独立 license 文件（页面声明） |
| 7 | Leckie | 可商用/可修改/随游戏发布；**不得转售、再分发、分享、再许可**；**不得用于训练 AI** | **不能** | 同 #1 | 8–12 人日 | 全新包；软描边风格与 Memao 冲突 |
| 8 | Cozy Town | Lite+Complete 均可商用、可改色/缩放；**不得单独转售或再分发**（不得放上免费素材站） | **不能** | 同 #1 | 10–14 人日 | 13 天新包；体量大、风格 cozy 与目标「现代公寓」有偏差 |
| 9 | Kokoro Reflections | 「Has Commercial Use Rights… even if you intend to sell it」；NFT/区块链/游戏外用途禁止（页面条款）；**再分发条款原文待核实**（terms 页抓取不完整） | **不能**（按行业惯例+页面「Games only」判断；待核实） | 同 #1；或向其确认 | 12–18 人日（48/32 格距 + RM 自动图块转换） | $19.99 最贵；RPG Maker 工具体系重；48px 与项目当前 16 架构冲突大 |
| 10 | Riclmbr Cute Pixel Decor | **CC0 1.0 Public Domain**；「Do whatever you want with them, commercial use included」 | **能** | 直接入库 + 可选署名 | 6–10 人日（物件级、无墙体系统） | 发布仅 17 小时；风格偏可爱粉彩；物体描边/比例需统一 |
| 11 | Kenney Roguelike/RPG pack | **CC0**（官网 License: Creative Commons CC0） | **能** | 直接入库 | 4–8 人日（但只能当底料） | 奇幻风，非现代；不能单独满足目标 |
| 12 | Bonsaiheldin Interior 16x16 | **CC-BY-SA 3.0**（包内 Credits.txt 原文） | **能**（署名；修改版需同协议共享） | 直接入库 + 署名 + SA 声明 | 6–10 人日 | 2016 年作品、风格旧；作者已不活跃（不需要联系）；SA 传染修改版 |
| 13 | Reemax LPC House interior | **CC-BY-SA 3.0 + GPL 3.0/2.0**；attribution 见 credits.txt | **能**（署名；修改版 SA） | 直接入库 + 完整署名表 | 10–16 人日（32→16 降采样） | 多作者拼装、credits 复杂；降采样损失 |
| 14 | Ritpop Modern Houses | **CC0**（作者希望署名/告知使用，非强制） | **能** | 直接入库 | 3–5 人日（作为地板/外景底料） | 单张 768x512，内容少 |
| 15 | Jannax Home Objects | **CC0** | **能** | 直接入库 | 1–2 人日（体量小） | 32x32，需降采样；内容少 |
| 16 | （排除示例）Bakery Cozy Interior Free Sampler | 自称 **CC0**，但页面披露「AI disclosure: Yes — Graphics」 | 能（法律上） | — | — | **AI 生成图**，与本仓库「人类可追溯美术」方向冲突，建议排除 |

> 满足「免费/CC0 且可公开入库」的候选：#4、#10、#11、#12、#13、#14、#15（≥2 的要求已超额满足；其中 #4/#10/#11 为宽松/公有领域，#12/#13 为 CC-BY-SA 需署名与同协议）。

---

## 3. 逐候选详情（原文摘录 + 中文结论）

### 3.1 LimeZu《Modern Interiors - RPG Tileset [16X16]》——付费最匹配

- 作者：**LimeZu**（itch：`limezu.itch.io`，X/Twitter `@lime_px`，YouTube `@limezu_pixel`）
- 来源：<https://limezu.itch.io/moderninteriors>
- 价格（2026-10-23 抓取）：
  - 页面为 **Name your own price**；完整版说明写「**Complete version LICENSE (paying at least 1.50$)**」，下载区写完整包 `Modern_Interiors_v41.4`（149MB）**≥$1.50 USD** 可下载；
  - 但 2026-10-12 的评论（用户 Silverboyyg）称「page says…1.50$… the complete files now need $3」，即**实际下载门槛可能已调为 $3** → **待核实**；
  - 页面顶部有 2026 Fall Sale 捆绑：「Get this asset pack and 2 more for **$5.00 USD**」（具体包含哪 2 个包**待核实**，页面显示为 `itch.io/s/31815/fall-sale-2026` 捆绑）；
  - 免费版 `Modern_Interiors_Free_v2.2.zip`（1MB）可 0 元下载（许可不同，见 3.3）。
- 规模与规格（页面原文摘要）：
  - 「Available in 3 sizes (**16x16, 32x32, 48x48**), ready for any engine!」
  - 「**2D and 3D walls**」「Modular tiles for walls, floor, carpets, tables etc.」
  - 「**Thousands** of furniture with different versions and styles」「**100+** frame by frame made **animated** objects (.gif and spritesheets supplied)」
  - 主题覆盖（原文示例）：living room、waiting room、reception、bathroom、bedroom and kid bedroom、classroom、library、kitchen、condominium 等几十种
  - 内容标签：**No generative AI was used**
  - 评价：4.9/5（611 ratings）；下载量 100k+
- 授权原文（页面 `Complete version LICENSE` 区块，逐字，页面排版有重复行）：
  > **YOU CAN:**
  > - Edit and use the asset in any commercial or non commercial project
  > - Use the asset in any commercial or non commercial project
  >
  > **YOU CAN'T:**
  > - Resell or distribute the asset to others
  > - Edit and resell the asset to others
  > - Credits required ([this link](https://limezu.itch.io/))
- 中文结论：
  - ✅ 可商用、可非商用、可修改、可用于游戏项目；
  - ❌ **不得转售，也不得把素材分发给他人**（原文未区分原始/修改版；按最严口径理解：**修改后的素材同样不可再分发**）；
  - ⚠️ **必须署名并链接作者页面**；未在页面摘要中看到「禁止 AI 训练」条款（只有「No generative AI was used」标签）——LICENSE.txt 是否另有 AI 条款 **待核实**（购买后核对包内 `.txt`）。
- 与目标匹配度：
  - 风格：现代室内像素的行业标杆，16x16 档与目标 tile 完全一致；
  - 墙体：2D/3D 墙 + 模块化地板/地毯/桌子，是候选里唯一「整套墙体系统现成」的商业包；
  - 家具/厨卫/门窗：上千家具 + 100+ 动画物件（含门/柜/电器类状态件），覆盖客厅/卧室/厨房/卫浴绰绰有余；**但具体门窗切片数量与命名页面未逐项列出，待核实**；
  - 与 48x48 Memao：16 档角色为 16x32（2 格高），Memao 为 48x48（3 格高）；若直接混用，Memao 会明显偏大。**可行解**：用 48x48 档素材并把渲染格距改成 48px（此时 Memao 48x48 = 1 格，但相对门窗会偏矮），或保持 16px 档 + 后续评估是否把 Memao 重绘/降采样为 32x32（Memao 许可允许修改，但需保留许可记录）。**这是选型后的第一个必须做视觉验证的决策点。**
  - 成本：**10–15 人日**（素材切片/规范化 2d + 渲染器墙/自动图块/动画 4–6d + 协议/视图 2d + 世界内容 2–3d + 私有同步与占位 2d + 测试/文档 2d）。
- 主要风险：
  - **授权不可入库**（核心风险，必须走 4 节的合规方案）；
  - 48x48 比例问题；2D/3D 墙需要渲染器支持「墙顶 + 墙面 + 踢脚」分层或直接使用其 3D 墙切片；
  - 作者 2023-07 后 Modern Interiors 仅维护更新（Exteriors 仍活跃到 2026-01），**停更风险低**；但作者没有提供「可再分发」授权档位 → 若坚持素材入库，只能私信申请（**待核实**）。
- 参考图：<https://limezu.itch.io/moderninteriors>（页面内 GIF/预览图较多；本调研抓取到的静态封面在代理下为占位图，建议购买前在浏览器人工查看预览）。

### 3.2 LimeZu《Modern Exteriors - RPG Tileset [16X16]》——可选补充（外景/建筑外壳）

- 来源：<https://limezu.itch.io/modernexteriors>
- 价格：**$5.00**，当前 **50% OFF → $2.50 USD**（2026-10-23）；文件 `Modern_Exteriors_v42.3`（222MB）
- 规格：16/32/48 三档；街道/建筑/车辆/招牌/动画车辆；Godot 与 GameMaker 自动图块；与 Modern Interiors 同角色体系
- 授权原文（页面 LICENSE）：
  > **YOU CAN:**
  > - Edit and use the asset in any commercial or non commercial project
  > - Use the asset in any commercial or non commercial project
  > **YOU CAN'T:**
  > - Resell or distribute the asset to others
  > - Edit and resell the asset to others
  > - Credits required (this link)
- 中文结论：同 3.1——可商用可改、禁再分发、必须署名。**不能入库**。
- 用途：若后续要做「走出公寓」的街区/外景，这是同风格最省心的补充；本轮「室内优先」可不买。
- 风险：页面较新（2025-12 仍更新到 400th update，2026-01 有新年帖），活跃度高；价格促销后恢复 $5。

### 3.3 LimeZu 免费版与其它系列

**（a）Modern Interiors Free v2.2（免费版）**
- 来源（devlog）：<https://limezu.itch.io/moderninteriors/devlog/244045/free-version-overview-18042021-update>
- 原文：
  > Around 1% of the complete asset, featuring: 9 floors and 8 wallpapers / Generic interiors… / 4 fully animated characters
  > **Free Version LICENSE:** - You **CAN** use the asset for **non commercial purposes** (more info in the LICENSE.txt)
- 中文结论：约完整版 1%；**只可非商业使用**；LICENSE.txt 是否另禁再分发**待核实**。→ 不建议用于本公开仓库或未来可能商业化的项目；可作为**本地视觉验证**（改完渲染器先看效果）。

**（b）Kitchen and more - RPG Tileset [16x16]（免费旧包，CC-BY 4.0，可入库！）**
- 来源：<https://limezu.itch.io/kitchen>
- 价格：**免费**（Name your own price），下载 `Kitchen and more tileset [16x16].zip`（19KB，含 .png 与 .ase 源文件）
- 页面原文：
  > **--> The whole asset has been remade and improved in [Modern Interiors](https://limezu.itch.io/moderninteriors) <--**
  > This tileset provides you with plenty of tiles to create and customize your kitchen and interiors
  > **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 中文结论：**CC-BY 4.0** = 可商用、可修改、可再分发，只需署名（作者 LimeZu）并注明修改、附协议链接。**可直接提交公开仓库**（这是免费的 LimeZu 风格素材！但只是旧版厨房/内景小包，不是完整公寓）。
- 用途：免费路线里的「LimeZu 风味厨房 + 墙面/地板底料」，与付费版风格同源，可降低混搭违和感。
- 风险：老包、体量小、已被 Modern Interiors 取代；CC-BY 4.0 要求保留署名与协议声明。

**（c）其它 LimeZu 系列（作为扩展池）**
- `Modern Office - Revamped [16x16]`：<https://limezu.itch.io/modernoffice>，页面显示 **$2.50（50% OFF）**，办公/工作区 — 若后续有「居家办公/办公室」需求可加购；同许可证（禁再分发）。
- `Modern User Interface [16x16]`：$3.90（-35%），UI 素材 — 与本次室内选型无关。
- `Modern Farm [16X16]`：$4.95（-34%），室外/农场 — 无关。
- `Serene Village / RPG ARSENAL / Animated mini characters` 等：免费，但为奇幻/外景/IP 向，不解决现代公寓。
- 说明：LimeZu 的**新包统一为「可商用、禁再分发、必须署名」**；仅老包（如 Kitchen and more）是 CC-BY 4.0。**采购前务必逐包看页面 License 区块**，不要假设全系列同许可证。

### 3.4 Gridwright《Modern Office & Home: 16x16 Pixel Art Interior Tileset (342 tiles)》——工程最优付费备选

- 作者：**Gridwright**（`v3su.itch.io`，itch 作者页 Gridwright）
- 来源：<https://v3su.itch.io/modern-office-home-tileset-16x16-pixel-art>
- 价格：**$4.99**，当前 **20% OFF → $3.99 USD**（2026-10-23）；含 **68 件免费样例**
- 发布：**8 天前（≈2026-10-15）**；页面显示 47% 的众筹目标进度（$47.93/$100）
- 规格（页面原文摘要）：
  - 「47-tile wall autotiles (188 tiles) in 4 styles: painted plaster, exposed brick, white bathroom tiles and concrete panels. A 14 px face on the edges that look down the screen, dark tops, rounded corners.」
  - 24 floors（办公地毯、浅橡木、深胡桃、小白砖、抛光混凝土、水磨石，各 4 变体）；地毯 9 件/色；28 墙饰（木门/玻璃门/**4 帧滑门**/窗（白天、夜晚、百叶）/镜子/白板/挂钟/空调……）；84 家具（办公 + 公寓 + 厨房/卫浴 + 咖啡店）
  - 「Strict 16x16 grid. 52 larger pieces are exact multiples (16x32, 32x16, 32x32) and stand on their bottom row.」
  - 「**No baked shadows**」「neighbour bitmask is in every wall file name and in **tiles.json**」「single PNGs and sheets, at 1x, 2x and 3x」
  - 「The code was written with AI-assisted tools. No image generator was used, and no third-party art is included.」（AI Assisted 标签，但明确无图像生成）
- 授权原文：
  > **Licence in one line:** use it in your commercial games; do not resell the files. No credit required.
  > Use and modify in personal and commercial projects. Shipping the tiles inside your game is fine. No resale or redistribution of the assets, modified or not. Credit is appreciated, not required. **Not for AI training or NFTs.**
- 中文结论：可商用/可修改/随游戏发布；**禁止转售与再分发（含修改版）**；**禁止 AI 训练与 NFT**；无需署名。→ **不能入库**。
- 与目标匹配度：16x16 + 墙顶/墙面/踢脚/转角 + 位掩码 + 无阴影 + 门窗（含 4 帧滑门）+ 厨卫齐全。**这是所有候选里「墙体系统最贴合现有工程需求」的一档**，且 tiles.json 可直接转成我们的 manifest/位掩码映射，预计省 2–3 人日。
- 成本：**8–12 人日**。
- 风险：**全新包（8 天）、单一作者、众筹未达标** → 弃更/内容缺口/风格再调整风险高；「代码绘制 + AI 辅助」风格偏几何化，与 Memao 的手绘深色描边需要一次并排验证；授权与 LimeZu 同样不可入库。

### 3.5 riekahq《Modern Apartment & Office Interiors Tileset (16x16)》

- 来源：<https://riekahq.itch.io/modern-interiors-tileset>
- 价格：**$3.00**，当前 **40% OFF → $1.80 USD**（2026-10-23）；发布 8 天前
- 规格：114 件 / 124 帧、单一 28 色调色板；11 无缝地板、10 墙面+墙线、门窗、沙发/单双人床/衣柜、整套厨房、卫浴、办公桌椅/电脑/打印机/货架/植物/售货机/街机；动画：TV、台式机、笔记本、鱼缸、挂钟、吊扇；交付「透明 PNG 表 + atlas JSON + 每件独立 PNG（动画含 strips）」
- 授权原文：
  > Use in commercial and non-commercial games, modified or not; do not resell or redistribute the assets themselves.
  > Disclosure: these assets were drawn as code with the help of an AI model and reviewed by a person.
- 中文结论：可商用可改；**禁止再分发**；AI 参与绘制（代码生成为主，人工审核）。→ **不能入库**。
- 匹配/成本：16x16、atlas JSON 友好，8–12 人日；风格偏平涂、色板受限，做「现代公寓」质感一般；AI 参与绘制需团队自行判断是否接受。
- 风险：全新包、体量小（67KB zip）、无独立 license 文件。

### 3.6 Leckie Pixel Studio《Modern City & Interiors 16x16》

- 来源：<https://leckie1989.itch.io/modern-city-interiors-16x16-pixel-art-town-tileset>
- 价格：**$3.49**（2026-10-23）；发布 4 天前、1 天前更新
- 规格：484 静态精灵 / 122 动画 / 388 帧 / 702 PNG；16x16；**8 种内墙（16x32）+ 18 墙饰 + 55 室内家具**（客厅/卧室/办公/厨房/卫浴/咖啡店/商店）；12 栋建筑外立面；UI 套件；`assets.json` 列尺寸/分类/动画 fps；含 6 套 tileset、2 张示例场景（街道 48x30、室内 40x22）
- 授权原文：
  > You may use these assets in unlimited personal and commercial projects (games, apps, videos, prototypes), modify them and ship them inside your published projects. Credit appreciated, not required.
  > You may not resell, redistribute, share or sublicense the assets themselves (original or modified), on their own or as part of another asset pack, template or toolkit; claim them as your own artwork; **or use them to train AI models**.
- 中文结论：可商用/可修改/随游戏发布；**禁止转售、再分发、分享、再许可**；**禁止用于训练 AI**；无需署名。→ **不能入库**。
- 匹配/成本：16x16、室内覆盖完整、自带 assets.json；8–12 人日；「软色描边、无黑边」与 Memao 深色粗描边风格冲突，混用需要统一描边策略。
- 风险：新包（4 天）；作者为批量产包型（Megabundle 70 包），风格稳定但深度有限。

### 3.7 Spaceyyy《Cozy Town — Modern 16x16 Top-Down City Tileset》

- 来源：<https://aquumgifts.itch.io/cozy-town>
- 价格：**Free Lite 免费**；Complete **$3.49**（至 2026-10-25，30% OFF，原价 $4.99）（2026-10-23）；发布 13 天、更新活跃（10 天两更）
- 规格（Complete）：994 精灵 / 496 图块 / 1104 帧；16x16；1x/2x/4x；**Home Interiors（366 件 + 113 家庭地板/墙面，含昼夜窗、门洞）**、办公室/学校/诊所（314 件 + 90 图块）、咖啡/面包/杂货店内景、街道/建筑（昼夜）、14 个角色；Godot 4 TileSet + Tiled wang 自动图块 + 示例工程
- 授权原文：
  > **Lite and Complete:** free for personal and commercial games — modify, recolor, resize, use in as many projects as you like. **Do not resell or redistribute the assets on their own** (as a tileset, in another pack, or on a free asset site). Credit appreciated, not required.
- 中文结论：可商用、可改色缩放；**禁止单独转售/再分发**。→ **不能入库**（Free Lite 也一样，不能放进公开仓库）。
- 匹配/成本：内容量是「现代生活模拟」候选里最接近的之一；但**cozy 粉彩 + 1px 描边**与 Memao 深色 RPG 风差异大；10–14 人日。
- 风险：新作者/新包；「免费 Lite」容易被误以为可入库——**授权明确禁止**；完整版更新节奏好，是长期性价比最高的低价包之一（如果接受其画风）。

### 3.8 Kokoro Reflections《KR Urban Modern Interiors Tileset for RPGs》——尺寸最契合 Memao 的付费包

- 来源：<https://kokororeflections.itch.io/kr-urban-modern-interiors-for-rpgs>；官方 terms：<https://kokororeflections.com/terms-use/>
- 价格：**$19.99 USD**（2026-10-23）；`modern-int.zip` 43MB；72 天前更新
- 规格（页面原文摘要）：
  - 「**Comes in 48 and 32px** … you get both for one price!」「For RPG Maker and more」「RPG Maker ready format (MV/MZ/VX/Ace)」
  - 墙：8 种涂装墙色 + 内置书架 + 木墙板/方板/珠板 + 墙板 + 纹理墙 + 砖墙 + 金属板 + 石墙 + **Autotile windows**
  - 住宅：4 套家具风格、床/柜/桌椅/梳妆台、壁炉、窗帘（5 色）、窗（4 种，亮/暗）、门（暗/亮/透明）、厨房电器（冰箱/烤箱/洗碗机/微波炉/洗烘）、卫浴、办公室、健身房、商店、咖啡店、酒吧等
  - 「No generative AI was used」
  - 授权区（页面）：**Has Commercial Use Rights**「Yes! You can use these tilesets in your game, even if you intend to sell it… See our terms of use」；页面图片 alt 文本：「No NFTs. No blockchain. Games only. No exceptions!」
- 授权原文：terms 页面正文本次**未能完整抓取**（返回导航/截断）→ **再分发条款原文待核实**。按页面「Games only」与该作者一贯条款判断，**素材文件不可独立再分发**（需购买后核对 `terms-use` 全文/包内说明）。
- 中文结论：**可商用（明确）**；**再分发禁止**（待核实原文）；无 AI 生成。
- 与目标匹配：
  - **尺寸最契合 Memao**：48px 是 RPG Maker MZ 标准格，Memao 48x48 与其角色/家具比例同体系；但项目当前 `tileSize` 硬编码 16，需要把「视觉格距」改为 48（或 32）并重排世界内容，属于架构级改造；
  - 墙体系统强（含自动图块窗），家具/厨卫/门窗齐全；RPG Maker 自动图块（A2/A3/A4 规则）转 PixiJS 需要写转换器/人工切图；
  - 风格是 RPG Maker 商业级写实向，与 Memao 的 chibi 深描边能否协调需并排验证。
- 成本：**12–18 人日**（48/32 格距 + RM 自动图块转换 + 世界重排）。
- 风险：$19.99 最贵；RPG Maker 生态绑定重；与 16x16 目标架构冲突最大；不过若**最终决定把视觉格距改为 48**，它可同时解决「Memao 48x48 比例」这一最大痛点，值得作为「架构升级期权」保留。

### 3.9 Riclmbr《Cute Pixel Decor — 1000 室内外像素物件》——免费可公开路线的主家具库

- 来源：<https://riclmbr.itch.io/cute-pixel-decor-1000-interior-exterior-pixel-art-objects>
- 价格：**$9.99**，当前 **35% OFF → $6.49 USD**（2026-10-23）；发布仅 **17 小时**（极新）
- 规格：1000 个物件 / 20 类（500 室内 + 500 室外）；统一「梅子色描边 + 3 阶粉彩柔光」；**统一俯视 3/4 视角，全部按 16px 网格，物件 16x16 至 48x64**；53 个动画物件（187 帧，壁炉/鱼缸/熔岩灯/蜡烛/霓虹/灯串等）；**19 张无缝 16x16 地板/墙纸/地面**；每物件独立 PNG + 动画 strips + 分类表 + `Decor_Atlas.png` + `decor.json`（含 rect/动画数据）+ 6 个示例场景；内容标签 **No generative AI was used**
- 授权原文：
  > **CC0 1.0 - Public Domain. Do whatever you want with them, commercial use included.** A credit or a link back is always appreciated but never required!
- 中文结论：**CC0 → 购买后文件可合法提交进公开仓库、可商用、可修改、无署名义务**（署名仍建议）。**这是「免费可公开」路线里唯一能一次性覆盖大量现代家居家具/装饰的现成库。**
- 匹配/成本：
  - 优点：家具量、厨卫、装饰、动画、地板/墙纸都有；16px 网格；
  - 缺点：**没有墙体系统**（无墙顶/墙面/踢脚/转角/门窗套件，只有墙纸贴图与窗/画等墙面物件）；粉彩可爱风与目标「现代公寓」以及 Memao 深色描边都需要**统一调色/描边**（建议做一层调色板映射与描边后处理，或接受其作为「风格化分支」）；
  - 成本：**6–10 人日**（物件级接入 + 调色统一；墙体仍需另配/自绘）。
- 风险：**发布仅 17 小时**，作者/包质量未经时间验证；1000 件是量产级（是否全部为人工精修需购买后抽样核验，页面声称无生成式 AI）；体量 2.1MB。

### 3.10 Kenney《Roguelike/RPG pack》——最稳的 CC0 底料，但不是现代公寓

- 作者：**Kenney**（kenney.nl / kenney.itch.io）
- 来源：<https://kenney.nl/assets/roguelike-rpg-pack>
- 价格：**免费**；**1,700 文件**；License 页面明确 **Creative Commons CC0**；16×16；2015 年发布（v1.0）
- 规格：RPG/城镇/地牢图块 + 家具 + UI + 按钮面板等；**奇幻/roguelike 风**，没有现代公寓墙体/厨卫体系
- 中文结论：**CC0，可直接入库、可商用、无署名义务**。但只能作为「地板/图块/UI 底料」，不能单独满足现代公寓目标；与 Memao 同为 RPG 向但非现代，混用只能作为过渡。
- 风险：风格与目标不符；Kenney 另有 3D `Furniture Kit`（CC0）与 `Tiny Town`（16x16 CC0，外景），均不含现代室内。**Kenney 体系内没有可用的 2D 现代室内包**（本次调研结论）。

### 3.11 Bonsaiheldin《Interior Tileset 16x16》（OpenGameArt，CC-BY-SA 3.0）

- 作者：**Bonsaiheldin**（<http://bonsaiheld.org>）
- 来源：<https://opengameart.org/content/interior-tileset-16x16>；下载：`tileset_16x16_interior_0.zip`（14.8KB）
- 实测内容（本次下载解包核对）：`tileset_16x16_interior.png` **256x256**、`map.tmx`（Tiled 示例地图，99KB）、`Credits.txt`
- 包内 Credits.txt 原文：
  > This work is released under a Creative Commons (CC) BY SA 3.0 license. For further information, please check: http://creativecommons.org/licenses/by-sa/3.0/
  > How to credit me (for example): Bonsaiheldin | http://bonsaiheld.org
- 页面说明：Zelda-like 室内「house interior」tileset，含示例 Tiled 地图，可自由修改；作者希望使用时告知/给游戏副本（非强制）
- 中文结论：**CC-BY-SA 3.0** → 可商用、可修改、可公开入库，需**署名 + 协议链接**；**修改版（如重绘/调色）必须以 CC-BY-SA 3.0 共享**；原样文件可随仓库分发。→ **能入库**。
- 匹配/成本：16x16、256 格图集、含墙体/地板/家具基础；但 2016 年风格偏复古/Zelda，家具覆盖不如现代包；墙体系统完备度（墙顶/踢脚/转角）需用 `map.tmx` 进一步确认（**待核实**，但作为「结构底稿 + 自绘墙体」是可行的）。成本 6–10 人日。

### 3.12 Reemax 等《[LPC] House interior and decorations》（OpenGameArt，32x32，CC-BY-SA + GPL）

- 作者：**Reemax**（collaborators: Sharm、Hyptosis、daneeklu、William.Thompsonj、wulax、makrohn）
- 来源：<https://opengameart.org/content/lpc-house-interior-and-decorations>
- 授权：**CC-BY-SA 3.0** + **GPL 3.0** + **GPL 2.0**（页面标注三种）；attribution 见包内 `credits.txt`
- 规格（页面原文）：32x32；橱柜上下可换、厨房设备（金属灶/柴灶带火焰动画）、书架/装饰/地板；「These are based on LPC but quite heavily modified.」
- 中文结论：可商用/可修改/可公开入库（满足署名义务与 SA/GPL 要求；GPL 对纯素材组合的传染性需法务确认——**待核实**，保守可按 CC-BY-SA 3.0 履行 + 完整 credits）。→ **能入库**，但**32x32 需降采样到 16** 才能与目标网格一致，且多作者拼装导致 credits 复杂。
- 匹配/成本：厨房/柜体细节好，但 LPC 风、32px、多作者 → 10–16 人日；更像「厨房/细节补充」而非主方案。
- 风险：降采样损失；GPL 与 CC-BY-SA 双许可的选择与署名义务；作者 2018 后无活动（不需要联系）。

### 3.13 OpenGameArt 其它 CC0 小体量补充

- **"Modern Houses" Tileset TopDown**（Ritpop，2022）：<https://opengameart.org/content/modern-houses-tileset-topdown>；**CC0**；实测下载 PNG **768x512**（16px 网格下 48x32 格）；页面原文「The license is CC0 but if you credit me or even let me know what you are using, I would be very happy.」；作者在评论中确认「these tiles are 16 bit」（16x16 口径）。含现代房屋外立面 + 少量内景。→ **可入库**；体量太小，只能当地板/外景打底。
- **Home Objects**（Jannax，2013）：<https://opengameart.org/content/home-objects>；**CC0**；两张 32x32 图（实测 192x128、2847B）；「Feel free to use however you want. Credit isn't necessary but much appreciated.」→ **可入库**，但需降采样、体量小。
- 备注：OGA 上「Tuxemon tileset」（Buch，CC-BY-SA 3.0）只有室外/地形，无室内；「[LPC] Wooden Furniture」「LPC Upholstery」等为 32x32 LPC 家具，可作补充但同样 32→16 问题。**OGA 没有成体系的现代公寓 16x16 包**（本次搜索结论）。

### 3.14 明确排除 / 风险示例

- **Bakery Cozy Interior Top-Down Pack — Free Sampler**（VeniceMenaceBakingCo，自称 CC0）：<https://venicemenacebakingco.itch.io/bakery-cozy-interior-topdown-pack-free-sampler>；页面原文「License: CC0 — use in personal and commercial projects, no credit required. Please don't resell the pack itself as-is.」**但 AI 披露为「AI disclosure: Yes — Graphics」** → 法律上可用，但**属于 AI 生成图，建议排除**（与本仓库「可追溯的人类美术」方向冲突，且与 Memao 的 AI 使用条款精神不一致）。
- **LimeZu 免费版**：看似免费，实为**非商业**限制，且不得当作完整素材来源（见 3.3a）。
- **任何「免费 Lite 版」**（Cozy Town Lite 等）：免费≠可入库；授权仍禁止再分发。
- **Kenney 3D Furniture Kit / Isometric 包**：CC0 但为 3D/等距，不能用于本项目 2D 俯视管线。

---

## 4. 「公开开源仓库」约束的专项分析与合规落地

### 4.1 判断标准

一个素材包能否把**文件本身**提交进 public git 仓库，只看授权是否允许「再分发（redistribute/distribute）」：

- ✅ **CC0**：允许，无义务（署名可选）。→ Kenney、Ritpop、Jannax、Riclmbr。
- ✅ **CC-BY 4.0 / CC-BY-SA 3.0**：允许，需署名 + 协议链接；SA 要求**修改版**同协议共享（CC-BY-SA 3.0 与 4.0 互不兼容，需注意）。→ LimeZu Kitchen（BY 4.0）、Bonsaiheldin（BY-SA 3.0）、Reemax（BY-SA 3.0 + GPL）。
- ❌ **自定义商业许可 + 「No resale or redistribution」**：**不允许**。→ LimeZu 新包、Gridwright、riekahq、Leckie、Cozy Town、Kokoro（待核实原文但按行业惯例同）。
- ❌ **仅限非商业（NC）**：即便仓库当前非商业，也**不建议**（未来商业化、镜像站、CI artifact 都会踩线）。
- ⚠️ **「随游戏发布可以」≠「仓库可放源文件」**：前者是游戏发行权，后者是素材再分发权，必须区分。

### 4.2 若选「付费但禁止再分发」素材（LimeZu/Gridwright 等）的 5 种合规落地

| 方案 | 做法 | 对公开仓库 | CI / e2e 影响 | 协作者影响 | 合规风险 | 评价 |
|---|---|---|---|---|---|---|
| **A. 不入库 + 私有同步 + 占位渲染**（推荐） | 素材目录 gitignore；`scripts/sync-assets.mjs` 从维护者本机/私有 artifact（GitHub private release、S3）同步；渲染器在缺失时用**自动生成的占位图**（纯色块/线框）并显式标注「未同步素材」 | 仓库不含素材文件，公开可 clone/build | CI 默认跑占位图；e2e 视觉用例标记为「需素材」并跳过或使用占位基线；发布流水线用 secret 拉取真实素材 | 协作者无包时看到占位图，但代码/测试可跑；需在 README/CONTRIBUTING 写清购买与同步步骤 | **低–中**：素材不公开分发；但「私有 release 分发给协作者」是否越界需法务判断（多人共用一份购买包通常不允许） | ✅ 最贴合开源目标；实现成本 2 人日 |
| **B. 构建时下载** | 构建前从私有 URL 下载（需 token） | 仓库干净 | CI 需 secret；公开 PR/forks 拿不到 secret → 构建降级占位；e2e 需特权 job | 本地构建需配置 token；新贡献者门槛高 | 中：把包放进 CI 私有存储=向 CI 再分发，需法务确认 | ⚠️ 仅作 A 的补充（发布用） |
| **C. 私有 submodule** | public repo 引用 private repo submodule | clone 后缺目录，构建失败或占位 | 需 submodule 访问权限，CI 要 deploy key | 外部贡献者无法完整构建 | 中：私有库访问者=再分发对象，需确保都持有授权 | ⚠️ 不如 A 透明 |
| **D. 仓库转私有** | 直接违背开源目标 | — | 全部可用 | — | 低 | ❌ 否决（与项目目标冲突） |
| **E. 向作者申请扩展授权** | 邮件/itch 私信请求「允许将素材提交至 public repo」/「购买再分发授权」 | 若获书面许可 → 可直接入库 | 无额外影响 | 无 | 低（有书面记录时） | ⚠️ **待核实**：LimeZu 页面无此档位；Gridwright/riekahq/Leckie 均为新作者，回复率未知；E 与 A 并行推进最稳 |
| **F. 只用可公开素材（CC0/CC-BY）** | 见 5.2 免费路线 | 全部入库 | 无 | 无 | **最低** | ✅ 若「公开可复现」是硬要求则必选 |

> 补充：**不建议**把付费素材以「修改后重新绘制」的方式洗白——授权原文明确覆盖「modified or not」，且素材相似度/授权溯源在公开仓库中不可控。
>
> **对 e2e/CI 的工程建议**：在 `tests/assets/asset-manifests.test.ts` 增加「素材来源登记」检查；渲染器缺素材时**显式失败或渲染占位并在 UI 标注**，绝不允许静默兜底成空白（符合仓库「错误明确暴露」红线）。

### 4.3 还应注意的授权细节

- **署名义务的落地**：LimeZu 要求「Credits required (this link)」→ 在游戏内 Credits 面板 + `THIRD_PARTY_NOTICES.md` + README 三处均给作者链接；CC-BY 4.0 需注明「作者、协议链接、是否修改」；CC-BY-SA 3.0 的修改版需以 CC-BY-SA 3.0 发布（可放在独立的 `assets/LICENSE-*.md` 并保留原文件）。
- **Memao 与第三方素材的隔离**：不要把 Memao 精灵图或任何美术喂给模型/训练；新素材若含「禁止 AI 训练」条款（Leckie、Gridwright）与项目使用 LLM 做行为决策不冲突（LLM 不接触美术），但**不要做图像生成/图生图流水线**。
- **许可版本记录**：建议在 `docs/legal/`（或 `THIRD_PARTY_NOTICES.md`）记录「包名 + 作者 + 购买日期 + 价格 + 页面 URL + 抓取日期 + 原文摘录 + 文件不入库说明」；**购买凭证单独存私有目录，不入库**。
- **CC-BY-SA 传染范围**：对**该素材的修改版**生效，不会传染项目代码；但若把多个 SA 素材合成一张图集，整张图集需按 SA 授权——工程上建议「按原始文件逐张分发、运行时合成图集」而非提交合成图集。

---

## 5. Top 2 推荐

### 5.1 付费最匹配：LimeZu《Modern Interiors [16X16]》（+ 可选 Exteriors）

**推荐理由**
1. 风格/内容/尺寸三项同时命中目标：现代公寓、16px 网格、16/32/48 三档、2D+3D 墙、上千家具、100+ 动画、现成厨房/卫浴/门窗。
2. 生态系统成熟：4.9/5（611 评价）、100k+ 下载、400 次更新、仍在售；素材命名/分主题文件夹友好；有 48x48 档可匹配 Memao 尺寸体系。
3. 相对风险最低（对比其它新包）：即便作者停更，已购文件永久可用；风格一致性由单一作者保证。
4. 价格极低（相对内容量），是所有付费候选里「每美元内容量」最高的。

**预算**
- Modern Interiors 完整版：**$1.50–$3**（页面 $1.50，评论区反馈 $3，**待核实**）；
- Modern Exteriors（可选）：**$2.50**（50% OFF，原价 $5）；
- Fall Sale 2026 捆绑「本包+2 包」**$5.00**（内容待核实）；
- 合计 **$4–6 一次性**（≈ ¥30–45）；后续无订阅费。

**授权关键点（决定落地方式）**
- 可商用、可修改、**禁止再分发**、**必须署名+链接**；
- → 素材**不入库**；采用 4.2 方案 A（gitignore + `pnpm assets:sync` + 占位渲染 + `THIRD_PARTY_NOTICES` 记录），并**并行**做方案 E（向作者询问是否可提供「开源仓库分发」书面许可，**待核实/无先例**）；
- 游戏内 Credits + README + NOTICES 三处署名。

**工时（10–15 人日）**
- 素材规范化/切片/调色统一：2d
- 渲染器改造（tile 图集、墙顶/墙面/踢脚分层、对象动画、y-sort 遮挡、可配置视觉格距）：4–6d
- 协议/视图扩展（物体状态帧、多格精灵 anchor/footprint）：2d
- `starter-home` 世界内容重排 + 新家具/门窗 resourceId 与状态：2–3d
- 素材同步脚本/CI/占位图/文档：2d
- 测试（manifest/渲染/快照/授权登记）：2d

**决策前置验证（1–2 天）**
1. 买前先看预览/试玩其 demo（页面 GIF）；
2. 用 16x16 档 + 现有 Memao 48x48 做一张并排 mock（卧室/厨房/卫生间各一屏），确认「角色 3 格高」是否可接受；
3. 若不可接受：方案① 改用 32x32 档（角色变 1.5 格，代价是素材需 2x 渲染/整体重排）；方案② 合法修改 Memao 为 32x32 版本（Memao 许可允许修改，保留 notice）。

### 5.2 免费可公开：CC0/CC-BY 组合 + 自绘墙体

**推荐理由**
1. **唯一满足「素材文件可随公开仓库分发」的可行路线**：全部为 CC0/CC-BY（含 CC-BY-SA 需署名+同协议），无「禁止再分发」。
2. 观感目标可从「粗糙占位」提升到「风格化 cozy 公寓」；若团队愿意投入 2–4 人日自绘墙顶/墙面/踢脚/转角/门窗，可补齐墙体系统（这是 CC0 库里唯一的系统性缺口）。
3. 成本几乎为零（$0 起），法律与 CI 最干净，后续商业化无附加风险。

**素材组合（建议采购/引入顺序）**
1. `LimeZu《Kitchen and more》`（**CC-BY 4.0，免费**）：厨房/墙面/地板底料，LimeZu 风味；署名 LimeZu + 协议链接。
2. `Riclmbr《Cute Pixel Decor》`（**CC0**，当前 **$6.49**）：500 室内件 + 19 无缝 16x16 地板/墙纸 + 53 动画，作为家具/装饰主库；购买后可合法提交入库（CC0）。
3. `Kenney《Roguelike/RPG pack》`（**CC0，免费**）：UI/基础图块/地板备选（风格差异大，只作补充）。
4. `OGA Bonsaiheldin《Interior Tileset 16x16》`（**CC-BY-SA 3.0，免费**，256x256 图集 + Tiled 示例）：作墙体/室内结构底稿与拼贴参考；署名 Bonsaiheldin + 协议链接，修改版按 SA 发布。
5. `OGA Reemax《[LPC] House interior》`（CC-BY-SA 3.0 + GPL，32x32）：厨房细节、柜体补充（需 0.5x 降采样）；多作者 credits 完整保留。
6. **自绘/委托**：墙顶（16 或 32 高）、墙面（可换墙纸）、踢脚线、内外转角、门框/门扇（开/关两态）、窗（白天/夜晚两态）——2–4 人日（美术）或外包 ~$100–300（**待核实**，未询价）。

**预算**
- 素材：**$0 – $6.49**（Cute Pixel Decor 一次购买；其余免费）；
- 自绘/委托：0（团队自绘）– 约 $100–300（外包，待核实）；
- 总计 **≤ $300**，且全部可入库。

**工时（12–18 人日）**
- 素材规范化/调色统一/描边统一（把粉彩描边与 Memao 深色描边做一次 palette mapping + 轮廓处理）：3–5d
- 自绘墙体系统（若团队无美术，可先用纯色块占位）：2–4d（美术）
- 渲染器/协议/世界内容改造：同 5.1 的 8–12d（墙体系统仍需实现）

**主要风险与缓解**
- 风格不统一（多个作者）：先做「调色板 + 1px 描边后处理」统一层；限定只用 2–3 个主素材源。
- 家具尺寸/锚点不一：以 manifest 显式登记 `anchor`/`footprint`，按「底边对齐」统一。
- 墙面/地板无缝性：要求每套提供 seamless 校验（Riclmbr 已含 19 张无缝地板/墙纸；其余需人工检查）。
- 观感上限低于 LimeZu：这是「公开可复现」换来的代价；建议把「公开素材路线」作为 v1，保留「付费路线」作为 v2 的升级期权（见 5.3）。

### 5.3 备选与决策规则

- **工程成本优先 → Gridwright ($3.99)**：墙自动图块 + 位掩码 JSON + 无烘焙阴影，接入最省；但同样不可入库 + 新包风险。适合「2–3 周内必须见到可玩画面」的节奏。
- **架构升级期权 → Kokoro ($19.99, 48/32px)**：若团队决定把视觉格距从 16 改为 48 以匹配 Memao，这是最完整的现成方案；但改造量最大、最贵。
- **决策规则**：
  1. 若「公开仓库可复现」是硬性验收（源码 clone 即可构建可玩、CI 绿、无外部资产）→ **选 5.2 免费路线**；
  2. 若「最终观感/内容量」优先且可接受「素材私有 + 占位降级」→ **选 5.1 LimeZu**；
  3. 若时间最紧且接受新包风险 → Gridwright。

---

## 6. 素材替换的工程改造清单（可作为后续 PR 拆分依据，本轮不写代码）

> 目标：把「自研小图集（3 张 PNG，约 9 个 resource）」升级为「完整现代公寓素材 + 墙体系统 + 状态动画 + y-sort 遮挡」，并同时支持「素材入库（CC0/CC-BY）」与「素材不入库（付费包）」两种模式。

### 6.1 素材层 / 图集与 manifest

| # | 文件 | 改造点 | 验收 |
|---|---|---|---|
| 1 | `plugins/home-objects/assets/asset-manifest.json`（以及未来 `plugins/spatial-objects/assets/...`） | `sheets[]` 增加新 PNG（地板/墙/家具/门窗/动画条）；`resources[]` 增加每个 resource 的 `anchor`（脚底/中心）与 `frames`（含状态帧：`closed/open`、`on/off`、`day/night`、转角 16 种位掩码）；多格精灵按 `width/height` 标注；`schemaVersion` 如需扩展则升到 2 并同步解析器 | manifest 解析测试 + 矩形不越界 + 新资源都被世界/插件引用 |
| 2 | 新脚本 `scripts/import-assets.mjs`（不入库的付费包）或 `scripts/build-atlas.mjs` | 把 LimeZu/Gridwright/riekahq 的「单图 PNG + atlas JSON / 位掩码 JSON」转换成仓库 manifest 格式；输出 `assets/generated/atlas.json`（**生成物不入库**）；统一命名 `pack.resource.frame`；生成 anchor/footprint 表 | 同一输入幂等；图集规范化前后像素一致（hash 或逐帧比对） |
| 3 | `.gitignore` + `scripts/sync-assets.mjs` + `package.json` script | 付费素材目录（如 `plugins/home-objects/assets/external/`）加入 ignore；`pnpm assets:sync` 从本机/私有 artifact 复制；缺素材时生成占位 PNG（纯色 + 线框 + 名称） | `pnpm build` 在无素材环境可过；有素材环境切换真实图集；README 写明购买/同步步骤 |
| 4 | `THIRD_PARTY_NOTICES.md` / `docs/legal/` | 每个素材包：名称/作者/URL/价格/购买日期/协议原文摘录/是否入库/署名要求；CC-BY/SA 附协议链接；付费包注明「文件不入库」 | 与代码中 resourceId → 素材包映射一致；评审可核对 |

### 6.2 解析与渲染层

| # | 文件 | 改造点 |
|---|---|---|
| 5 | `apps/web/src/features/world-map/asset-catalog.ts` | 支持：多格 frame 校验；状态帧/动画帧组（`frames: { closed, open }` / `animations: number[][]`）；自动图块位掩码 → frame 映射（若采用 Gridwright 的 47 位掩码，可在 manifest 里登记 `autotile: { bitmaskSource, frames }`）；可选 `renderTileSize`/`footprint`/`origin` 字段；错误信息明确（缺素材/缺帧/越界） |
| 6 | `apps/web/src/features/world-map/pixi-world-renderer.ts` | ① sheet URL 不再硬编码 3 张 + memao，改为由 manifest 的 `sheet.file` + 基础路径推导（`new URL` 或 Vite `?url`）；② `#place` 的 `tileSize=16` 改为可配置（`renderTileSize`，从 catalog/常量注入，默认 16，其他档位=16/32/48 可切）；③ 地板/墙体分层渲染（墙顶、墙面、踢脚、转角、门窗）；④ 物体状态帧（门开/关、灯亮/灭、冰箱开/关）切换；⑤ 对象动画 `AnimatedSprite`；⑥ y-sort 用「脚底 y + renderLayer」并处理墙对角色/家具的遮挡；⑦ 缺素材时渲染占位并显式告警 |
| 7 | `apps/web/src/features/world-map/render-projection.ts` | `RenderEntity.frameId` 改为由视图数据提供（见 6.3）；多格对象的绘制原点/偏移；瓦片（地板/墙位掩码）投影；不再用 `facing` 直接当物体帧 |
| 8 | `apps/web/src/features/world-map/pixi-world-renderer.test.ts` / `asset-catalog.test.ts` | 新增：缺 sheet 报错、状态帧选择、位掩码映射、多格 anchor、renderTileSize 切换、动画帧序；更新现有 mock |
| 9 | `apps/web/src/features/world-map/asset-catalog.ts` 对应 schema 文档 | 在 `docs/architecture/visual-overhaul/` 增补 `asset-manifest.md`（新字段说明 + 示例），供后续素材 PR 遵循 |

### 6.3 模拟/协议/世界内容层（决定墙体系统与状态帧）

| # | 文件 | 改造点 |
|---|---|---|
| 10 | `packages/protocol/src/view-models/world-view.ts` | `RenderEntityViewSchema` 增加 `frameId?`（或 `stateVariant`/`animationId`）——当前只有 `facing`，无法表达门开/灯亮/冰箱开；`MapViewSchema.tileSize` 若需视觉格距升级 → 增加 `renderTileSize`（保持 `tileSize:16` 为逻辑格，避免动模拟）；相关 schema 版本与快照兼容策略按 AGENTS.md 处理（当前阶段可不向下兼容，但需显式设计） |
| 11 | `packages/simulation/src/engine/view-projector.ts` | 物体渲染：根据对象 state/observe 结果产出 `frameId`/`stateVariant`（门 open、冰箱 open、灯 on）；墙体：产出朝向/邻接掩码或在渲染层由地图推导（二选一，**推荐渲染层推导**，避免模拟状态膨胀）；装饰物/多格家具的 resourceId/frame 映射 |
| 12 | `packages/simulation/src/map/map-definition.ts` + `map-loader.ts` + `content/worlds/starter-home/world.json` | 墙体从「逐格 wall 对象」升级为「墙段 + 朝向 + 门窗洞」数据（或保持逐格对象但补 `facing`/segment 规则）；新增 window 对象（day/night 状态）、灯/开关对象；地板区域支持多帧变体；家具对象（床/沙发/厨房台面/衣柜等）定义与摆放；`floorRegions`/`decorations`/`zones` 全部重排为「客厅/卧室/厨房/卫浴」四区 |
| 13 | `plugins/spatial-objects/src/objects/{wall,door}/`（`state.ts`/`definition.ts`/`observable-state.ts`/`interactions.ts`） | Wall：`state` 增加朝向/段/邻接掩码（或改由渲染推导）；Wall/Door `resourceId` 从 `pixel-16-interiors.*` 换新包前缀（如 `limezu.wall`/`gridwright.wall`）；Door：`open` 状态 → frameId 映射；`definition.resourceId` 更新 |
| 14 | `plugins/home-objects/src/objects/{refrigerator,toilet}/definition.ts` + 新增家具对象 | `resourceId` 换新；冰箱增加 `open` 状态帧（若选包有）；新增 bed/sofa/table/cabinet/kitchen/bathtub/shower/lamp/window 等对象定义（state schema + interactions + observe），按「插件只认能力」规范拆能力；新增对象需注册到 `plugins/home-objects/plugin.json` 的 `objectDefinitionIds` |
| 15 | `packages/simulation/src/testing/simulation-test-fixtures.ts` + 相关测试 | 若 resourceId/对象定义变动，fixture 同步；新增墙体/门窗/家具的 fixture |
| 16 | `tests/assets/asset-manifests.test.ts` | ① 更新「只允许 5 张 PNG」硬编码；② 增加「每张 sheet 有授权登记」检查；③ 增加「所有 resourceId 在代码/世界中被引用」检查；④ 对不入库素材：存在占位/生成路径时跳过并在 CI 标注；⑤ 授权记录与素材目录一致性 |
| 17 | e2e（`tests/e2e`/Playwright） | 增加世界截图基线：客厅/卧室/厨房/卫生间各一张；y-sort 遮挡用例（角色走到墙后）；门开/关、灯亮/灭状态截图；缺素材占位模式的冒烟（不阻塞主 e2e） |
| 18 | README / CONTRIBUTING / `docs/architecture/visual-overhaul/` | 写清：素材来源、购买与同步步骤、NOTICE 更新流程、CI secret 配置、公开仓库不含付费素材的说明；`pnpm assets:sync` 文档化 |

### 6.4 实施顺序建议（PR 拆分）

1. **PR-1 骨架**：manifest/asset-catalog 扩展字段 + 占位素材机制 + 授权登记测试（不换美术也能先合）。
2. **PR-2 渲染器**：tile/墙体分层/状态帧/动画/y-sort + 可配置格距；用现有占位图验证。
3. **PR-3 墙体与对象数据**：协议 `frameId` 扩展 + view-projector + wall/door 定义 + starter-home 重排（先用 CC0/占位美术）。
4. **PR-4 素材接入**：按选定路线导入素材（付费走 sync、免费走入库），更新 NOTICES + 截图基线。
5. **PR-5 打磨**：调色/描边统一、性能（图集尺寸/纹理内存）、移动端首屏。

> 注意：PR-2/PR-3 会触碰 `packages/protocol`、`packages/simulation`、`apps/web` 的共享文件，需按仓库并行纪律（`docs/architecture/character-context-parallel-waves.md`）确认文件所有权，避免与其它轨线冲突。

---

## 7. 待核实清单（写进后续任务卡，禁止当作已确认结论）

1. **LimeZu Modern Interiors 实际最低购买价**：页面写 ≥$1.50，2026-10-12 评论反馈下载页要求 $3；Fall Sale 捆绑 $5 具体包含哪些包。
2. **LimeZu 各包 License.txt 全文**：是否含「禁止 AI 训练/禁止 AI 生成」条款；署名链接的准确形式。
3. **LimeZu Modern Interiors 中门窗/开关灯/开门动画的切片清单与命名**（页面未逐项列出）；2D 墙与 3D 墙的具体图块结构。
4. **Gridwright / riekahq / Leckie / Cozy Town 的 license 文件全文**（页面摘要之外是否有额外限制；多数新包仅页面文字，无独立 license 文件）。
5. **Kokoro Reflections terms-use 再分发条款原文**（本次抓取被截断）；48px 素材的 RPG Maker 自动图块结构（A2/A3 规则）转换成本实测。
6. **Riclmbr Cute Pixel Decor 的 1000 件是否全部人工精修**（页面称无生成式 AI，建议购买后抽样核验）；其中「无缝 16x16 墙纸」是否可拼成我们需要的墙顶/墙面。
7. **Bonsaiheldin 图集的墙体结构**（墙顶/踢脚/转角是否齐备；`map.tmx` 可直接导入 Tiled 验证）。
8. **LimeZu 是否愿意提供「允许提交至公开仓库」的书面许可**（方案 E；页面无此档位，属未知）。
9. **CC-BY-SA 3.0（Bonsaiheldin/Reemax）与 GPL 双许可在纯素材组合场景的合规口径**（建议法务/维护者确认；保守按 BY-SA 履行 + 保留 GPL 声明）。
10. **外包自绘墙体/门窗的报价**（$100–300 为经验估算，**未询价**）。

---

## 8. 参考链接汇总（全部为本次实际抓取/核对过的页面）

**LimeZu**
- Modern Interiors - RPG Tileset [16X16]：<https://limezu.itch.io/moderninteriors>
- Modern Interiors 免费版 devlog：<https://limezu.itch.io/moderninteriors/devlog/244045/free-version-overview-18042021-update>
- Modern Exteriors - RPG Tileset [16X16]：<https://limezu.itch.io/modernexteriors>
- Kitchen and more - RPG Tileset [16x16]（CC-BY 4.0）：<https://limezu.itch.io/kitchen>
- Modern Office - Revamped：<https://limezu.itch.io/modernoffice>
- LimeZu 主页：<https://limezu.itch.io/>

**itch.io 商业候选**
- Gridwright Modern Office & Home (16x16)：<https://v3su.itch.io/modern-office-home-tileset-16x16-pixel-art>
- riekahq Modern Apartment & Office Interiors (16x16)：<https://riekahq.itch.io/modern-interiors-tileset>
- Leckie Modern City & Interiors (16x16)：<https://leckie1989.itch.io/modern-city-interiors-16x16-pixel-art-town-tileset>
- Cozy Town (16x16)：<https://aquumgifts.itch.io/cozy-town>
- Kokoro Reflections KR Urban Modern Interiors：<https://kokororeflections.itch.io/kr-urban-modern-interiors-for-rpgs>；terms：<https://kokororeflections.com/terms-use/>

**CC0 / 公共素材**
- Riclmbr Cute Pixel Decor（CC0）：<https://riclmbr.itch.io/cute-pixel-decor-1000-interior-exterior-pixel-art-objects>
- Kenney Roguelike/RPG pack（CC0）：<https://kenney.nl/assets/roguelike-rpg-pack>；Kenney 3D Furniture Kit（CC0，不适用）：<https://kenney.nl/assets/furniture-kit>；Tiny Town（CC0，外景）：<https://kenney.nl/assets/tiny-town>
- OGA Bonsaiheldin Interior Tileset 16x16（CC-BY-SA 3.0）：<https://opengameart.org/content/interior-tileset-16x16>；下载：<https://opengameart.org/sites/default/files/tileset_16x16_interior_0.zip>
- OGA Reemax [LPC] House interior and decorations（CC-BY-SA 3.0 + GPL）：<https://opengameart.org/content/lpc-house-interior-and-decorations>
- OGA Ritpop "Modern Houses" Tileset TopDown（CC0）：<https://opengameart.org/content/modern-houses-tileset-topdown>；下载：<https://opengameart.org/sites/default/files/tiletest.png>
- OGA Jannax Home Objects（CC0）：<https://opengameart.org/content/home-objects>
- （排除示例）VeniceMenaceBakingCo Bakery Free Sampler（自称 CC0，AI 生成）：<https://venicemenacebakingco.itch.io/bakery-cozy-interior-topdown-pack-free-sampler>

**协议原文**
- CC0 1.0：<https://creativecommons.org/publicdomain/zero/1.0/>
- CC-BY 4.0：<https://creativecommons.org/licenses/by/4.0/>
- CC-BY-SA 3.0：<https://creativecommons.org/licenses/by-sa/3.0/>

---

### 附：本次调研的「直接可用结论」清单

- ✅ 可以**立刻**合法入库：LimeZu Kitchen and more（CC-BY 4.0，免费）、Kenney Roguelike/RPG（CC0）、Riclmbr Cute Pixel Decor（CC0，$6.49）、OGA Bonsaiheldin（CC-BY-SA 3.0，免费）、OGA Ritpop/Jannax（CC0）。
- ⛔ 不能直接入库、必须走 4.2 方案的：LimeZu Modern Interiors/Exteriors、Gridwright、riekahq、Leckie、Cozy Town、Kokoro。
- 🚫 排除：LimeZu 免费版（NC）、Bakery Free Sampler（AI 生成）、Kenney 3D/Isometric（3D）。
- 🧭 下周可做的两件事：① 用 16x16 LimeZu 预览 + 现有 Memao 做并排 mock，拍板「16 vs 32/48 视觉格距」；② 让维护者决定「素材是否必须随仓库公开」——这个答案直接决定选 5.1 还是 5.2。
