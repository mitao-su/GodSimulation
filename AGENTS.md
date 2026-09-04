# AGENTS.md — God Simulation 开发准则

> 受众：在本仓库（含各 git worktree）中施工的所有开发 agent。
>
> 本文是开工前必读的唯一入口。它汇总本机环境、项目哲学、框架结构、并行纪律与验收标准。
>
> **本文可提交入库**：它刻意不含 `private/` 下私有文档（`VISION.md` / `PROJECT_DIRECTION.md` / `AGENT.md`）的原文内容——worktree 只能拿到已提交的文件，agent 需要在工作副本里读到本准则。

---

## 1. 开工三铁律

1. **所有与 GitHub 的通信走代理 `socks5://127.0.0.1:7897`**（git push/pull/fetch、gh、对 api.github.com 的 curl 全部包含）。
2. **新功能必须从最新 `main` 切新分支**，禁止在 main 或过期分支上直接施工。
3. **每完成一个功能必须规范提 PR 并等待合入**，不自 merge、不堆未审分支。

---

## 2. 项目哲学（红线，违反即返工）

完整论述见根目录 `PHILOSOPHY.md`（公开共识文档）。以下是不可越权的浓缩版：

### 三方权力边界

| 角色 | 权力 | 禁区 |
| --- | --- | --- |
| Agent（LLM） | 基于有限认知产生**意图** | 不能读全局真相、不能宣布行动成功、不能改世界 |
| 世界（程序） | 裁决**事实**：寻路、碰撞、门、占用、时间 | 不替角色编写剧情结果 |
| 玩家（导演） | **剪辑**：放行、干预、回滚分支 | 干预必须成为可见、可追溯的事件 |

**物理即真理，意图不等于结果。** LLM 说"我打开了门"不算数，门必须由世界规则真正打开。禁止让 LLM 同时承担意图生成、规则判定和世界写入。

### 工程红线（代码级）

1. **唯一权威世界**：只有独立模拟进程持有可写 `WorldState`；浏览器只读、主程序只转发、数据库只记录、插件只提议效果、模型只选意图。
2. **确定性**：固定 tick 是唯一可写时钟（`1 tick = 6 游戏秒`），种子随机，同输入必同结果。模拟 tick 绝不绑定渲染帧率。**不得引入第二套可写时钟**，天数/时刻/睡眠时长全部从 tick 与状态锚点派生。
3. **先检查点，后等待**：重要状态变化先形成原子检查点（Event + Snapshot 同事务提交），再开始模型调用等不可控等待。
4. **事件优先**：重要变化先表达为带稳定 ID 的领域事件，再应用状态。角色知识与记忆必须引用真实 Event ID。
5. **插件只认能力，不认类别**：核心不问"这是门还是冰箱"，只问"挡不挡路、能否自动通行"。插件返回 `EffectProposal`，由统一裁决层校验后一次性提交。
6. **不用 LLM 补世界规则**：规则缺失就补规则，权限缺失就补校验，不拿 Prompt 填工程缺口。
7. **错误明确暴露**：模型失败、保存失败、协议不匹配都显式阻塞并可重试；禁止静默兜底、禁止伪造成功、禁止自动代选（如决策纠错耗尽后必须进 `TECHNICALLY_BLOCKED`）。
8. **文档优先**：`private/VISION.md` > `private/PROJECT_DIRECTION.md` > `PHILOSOPHY.md` > ADR > `docs/superpowers/specs/` 规格 > 测试 > 代码。实现服务于以上约束，不反向定义产品。

### 方向符合性事实标准

改动后自问：世界在冻结时是否绝不偷偷推进？模型调用是否不能直接改变事实？玩家干预是否作为事件进入当前分支？同一机制场景能否用 Mock 确定性重放、也能换真实模型运行？答不上来就先别写代码。

---

## 3. 项目框架速览

### 技术栈与仓库结构

- pnpm 10.34.5 monorepo，Node ≥ 24，TypeScript 6，全 ESM（`"type": "module"`）。
- `packages/`：`protocol`（类型/Schema/规则）、`plugin-sdk`、`simulation`（引擎/决策/执行/感知）、`cognition`（上下文/记忆/提示词）、`model-gateway`、`timeline`、`sqlite-store`。
- `apps/`：`simulation-worker`（独立模拟进程）、`local-server`（主程序）、`web`（浏览器端）。
- `plugins/`：`home-objects`、`spatial-objects`、`starter-agents`（版本化插件，构建后才可被测试消费）。
- `content/rules/default.json`：**所有会改变模拟行为的可调数值唯一来源**（版本化规则集 + 严格 Schema）。代码里禁止散落后备默认值；部署参数（端口、密钥、GPU、超时）属本地配置，不进规则集。

### 依赖方向（dependency-cruiser 强制门禁）

```
protocol（无依赖）
  ← plugin-sdk / timeline / model-gateway
    ← simulation / cognition（可依赖 plugin-sdk + protocol）
      ← sqlite-store（protocol + timeline）
        ← apps/*（按 .dependency-cruiser.cjs 白名单）
plugins/* → 只可依赖 plugin-sdk + protocol
```

- `packages/simulation/execution` 与 `decision` 内部另有 ESLint `no-restricted-imports` 门禁：**只许依赖窄接口 `OperationRuntimeRegistry`（execution/operation-runtime），禁止引用 engine 组合根 `simulation-registry`**。depcruise 看值引用、ESLint 看 type-only 引用，双门禁都过才算过。
- 新增跨包依赖前先看 `.dependency-cruiser.cjs` 白名单，方向错了宁可上移类型到 `protocol`，不许反向引用。

### 验证命令（提 PR 前必须全绿）

```bash
pnpm lint        # eslint + depcruise
pnpm typecheck   # tsc -b
pnpm test        # 先 build:plugins 再 vitest run
pnpm build       # pnpm -r build
pnpm test:e2e    # playwright
```

### 本地运行

- `pnpm dev` 启动 server + web；web 在 `http://127.0.0.1:5173`，local-server 默认 `http://127.0.0.1:4317`（`GOD_SIM_PORT` 可改）。
- 模型配置在根目录 `free_model.local`（已被 .gitignore）：`BASE_URL` / `API_KEY` / `MODEL` / `MODEL_TIMEOUT_MS`。**密钥永不进源码、文档、日志、测试。**
- 不用模型调试时：`GOD_SIM_DECISION_PROVIDER=fixed`。

---

## 4. 网络与 GitHub 访问

```bash
# git：显式指定代理（配置不进 .gitconfig，每次命令带上）
git -c http.proxy=socks5://127.0.0.1:7897 push origin <branch>

# gh / curl：用环境变量
export HTTPS_PROXY=socks5://127.0.0.1:7897 HTTP_PROXY=socks5://127.0.0.1:7897

# gh CLI 未登录，用凭据管理器里的 token 临时注入
export GH_TOKEN=$(echo -e "protocol=https\nhost=github.com\n" | git credential fill | grep '^password=' | cut -d= -f2)
```

通不了时先检查代理变量是否带上。

---

## 5. 并行开发准则（多 worktree 施工）

施工总编排见 `docs/architecture/character-context-parallel-waves.md`（下称「Wave 编排」）；验收基线与勾选规则见 `docs/architecture/character-context-implementation-todo.md`（下称「TODO」）。并行纪律浓缩如下：

### 三层纪律

1. **接口先行**：每层启动时先把跨轨引用的类型/接口骨架以最小 PR 合入 main，各 worktree 随即 rebase。骨架只含类型、Schema、空实现，不含行为逻辑。
2. **文件所有权**：严格按 Wave 编排中轨线卡的「主写 / 只读 / 禁碰」执行。`packages/protocol`、`packages/simulation` 是冲突高发区；桶文件 `index.ts` 的导出追加冲突留到层末合并统一整理。**快照 schema 每层只有唯一 owner，版本号每层只升一次。**
3. **层末汇合**：轨线完成 → 提 PR → 全量验证绿 → 合入 main → 合并人在 TODO 勾选对应条目（TODO 维护规则：只有验收测试证明完成才许勾选）→ 下一层从合并后的 main 切出。**禁止基于未合并的上游分支开工。**

### worktree 实操

```bash
# 从最新 main 切轨线分支（命名：wave<N>/<轨线号>-<slug>）
git fetch origin && git -c http.proxy=socks5://127.0.0.1:7897 pull
git worktree add ../GodSimulation-wt/w2a-items -b wave2/w2a-item-appearance origin/main

# 施工目录即 ../GodSimulation-wt/w2a-items；
# 进入 worktree 后按需执行 pnpm install 安装依赖。
```

- 一个轨线 = 一个 worktree = 一条分支 = 最终一个 PR。不串轨、不带私货。
- 开工先读：本文件 → `PHILOSOPHY.md` → TODO 对应阶段 → Wave 编排中你的轨线卡。
- 合并冲突只许在自己的所有权范围内解决；碰到别人地盘的冲突，停下来报告，不猜。

---

## 6. 代码规范

- **语言/模块**：TypeScript 严格模式，全 ESM；导入类型用 inline type import（`import { type Foo }`），ESLint `consistent-type-imports` 强制；`no-explicit-any` 是 error，不存在"先 any 一下"。
- **数值与配置**：会改变模拟行为的数值只能来自 `content/rules/default.json`（世界锁定的版本化规则集）；协议版本、数组下标、纯算法常量不是规则。业务代码和 Schema 都不得以数字字面量静默补默认值。
- **错误分类**：游戏内 `domain_failure` 只能来自 operation 预注册的封闭失败码目录；插件异常、Schema 错误、不变量破坏一律 `technical_failure`。**禁止按错误消息字符串分类。**
- **提交信息**：Conventional Commits 前缀（`feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:`）。
- **注释与文档**：简体中文；代码标识符保留英文。
- **永不提交**：`private/`、`free_model.local`、`data/`、`workspace/`、任何密钥或真实 API 响应录制（.gitignore 已覆盖，提交前 `git status` 自查）。
- **HANDS 槽位已删除**：手部行为全归 `BODY`（行为约束 #6）。不要按任何旧稿重新引入第三轨道。

### 关键架构事实（避免按直觉改坏运行时）

- `proposeInteraction` 完全不解析/返回 duration。时长所有权只归 planner：调用创建时经 adapter `resolveDuration` 锁定进 `ActiveOperation.duration`，此后任何路径（含已建立调用的 start）绝不触碰 resolver。
- 快照恢复共享不变量：action 进度 ≤ 自身时长；`currentActionIndex` 之前的前缀 action 只允许两种形态——`progress === duration`（正常完成）或 `interact_object + automatic_traversal + progress 0 + 未 started`（stale skip，贡献 0）；`progressTicks ≥ Σ前缀贡献 + 当前 action 进度`。
- `ActiveOperation.state` 是不透明 JsonObject，runtime 用 `stateSchema`/`initialState` 自持私有状态。快照 state schema v3，带 v2→v3 迁移。
- `available_interactions` 查询对必填参数交互返回 `requiresParameters: true, duration: null, availability: null`，不抛错。
- 测试 fixture 冰箱（`simulation-test-fixtures.ts`）：`use`（空参 10t）、`stock`（state 相关时长 10/20t）、`configure`（必填 mode 参数）三个交互，新测试优先复用。

### 2026-09-04 拍板决定（完整原文见 TODO 文档约束 70-78，施工前必读）

这几条是新增契约，与旧代码现状**不一致**，按直觉实现会做错：

1. **operation 一律定义在宿主对象（物品/家具）的 `interactions` 内**，不存在脱离宿主独立存在的 operation。宿主自身的 operation（锅的 `cook`）目标隐含为宿主实例本身，由候选生成时绑定；只有作用于外部对象的 operation（鸡蛋的 `put_into`）才声明目标需求。
2. **目标需求在契约层统一声明**：无目标 / 目标角色 / 写明 `requiredCapabilities` 的目标对象。核心据此做候选过滤、调用校验、目标 ID 随 `callId` 锁定三件事。**禁止各 operation 自行约定目标字段名**，否则核心无法统一校验与锁定。
3. **`capabilities` 与 `tags` 分离**：`ObjectDefinition` 新增 `capabilities: string[]`（`heating` / `cooling` / `storage`），`tags` 仍只表类别（`home` / `food`）。**能力用于匹配，类别不用于匹配**——这是「只认能力，不认类别」在操作目标层的落实。空间类能力继续用 `movement` / `vision` / `traversal` / `occupancy` 结构化字段。
4. **候选生成只按可达性与目标能力过滤，不调用 `canStart` 预筛前置条件**。操作用法由角色通过 `read` 说明书理解；选错时在 operation 首个执行步骤以权威状态校验，不满足则以已声明游戏内失败码原子关闭、说明缺失原因并触发思考，状态全不变。
5. **不存在复合 operation**：禁止在 operation 内部静默串联多个语义操作（做菜 = 逐个 `put_into` 再 `cook`，不是一键完成）。每次结束触发熔断，由角色重新决策。
6. **说明书机制**：核心提供通用 `read` 工具并在系统提示词声明其存在，角色按需调用；以**对象类型（定义 ID）**而非实例为输入，返回插件在定义中声明的**静态**用法说明，不含当前可用状态（可用性一律由 `canStart` 实时判）。缺声明的对象定义加载期拒绝。
7. **物品容量占用一律非负整数**，只在规则集维护、读取时现算，**不在快照持久化**（避免第二份数值真相与迁移成本）。整组占用 = 单件 × 数量。
8. **不支持容器嵌套**：只有角色与家具有容器，物品不能装物品，容量计算不递归。
9. **声音传播受墙与门遮挡衰减**，衰减系数进规则集（静态墙预计算、动态门实时叠加）；**不做区域环境噪声**。
10. 物品行为无类别字段：不存在 `equippable` / `visible` / `destroyable` / `droppable`。装备（`wear` / `undress` / `adjust_clothing`）、化妆、销毁、抛弃全是 operation；公开可见性属于**角色**的结构化外观分区，不属于物品。

---

## 7. 测试与验收

- 测试围绕**可观察行为**，不绑定当前类名；测试失败必须返回失败状态，禁止捕获断言后继续打印"测试完成"。
- **每个修复必须带测试**；关键测试做**变异验证**：临时恢复旧行为确认测试会失败，再还原。没有这个证据，评审会打回。
- 数据库、日志、随机种子、模型响应全部隔离；Mock、固定响应、真实模型走同一套 Schema。
- 提 PR 前跑全量：`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`，把结果写进 PR 描述。
- PR 自审工作流：每轮"修复→复审"会往更深的运行时链路钻；回复评论时逐条说明 修复方式 + 测试 + 变异验证 + 全套验证结果。

---

## 8. 禁止事项（旧项目反面经验 + 本项目纪律）

- 用一个 God Object 同时管主循环、线程、UI、存档、业务规则。
- 把模拟 tick 绑定渲染帧率；每帧深拷贝完整运行时对象图。
- 在多个 clone/缓存/线程中各自维护可写世界状态。
- 用角色级布尔状态覆盖 `HEAD/BODY` 双轨的真实进度；用预览临时路径承担正式执行状态。
- 用 LLM Prompt 弥补缺失的世界规则或权限校验。
- 依赖随机生成 ID 后又在玩法代码里硬编码旧 ID。
- 用 README 勾选框代替可复现的验收测试；接口已预留 ≠ 功能已完成。
- 静默兜底、伪造成功、自动代选 `continue`/空任务。
- 在上层临时建立平行状态绕开前置依赖（发现新前置依赖应调整编排并记录原因）。

---

## 9. 委派 agent 开工检查单

- [ ] 读完：本文件（**含 §6 的 2026-09-04 拍板决定 10 条**）→ `PHILOSOPHY.md` → TODO 对应阶段条目 + 约束 70-78 → Wave 编排轨线卡
- [ ] 逐条确认约束 70-78 中哪些影响自己这一轨，并在开工前写进自己的实现方案（这些是新契约，与旧代码现状不一致）
- [ ] worktree 从最新 main 切出，已 rebase 当层接口先行 PR
- [ ] 确认自己的文件所有权范围与快照 schema owner
- [ ] 代理环境变量已就位（§4）
- [ ] 修复带测试 + 关键测试变异验证
- [ ] PR 前全量验证五件套，结果写入 PR 描述
- [ ] PR 描述引用对应 TODO 条目编号；合入后由合并人勾选 TODO
