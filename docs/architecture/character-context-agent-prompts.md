# 角色上下文并行施工 Agent 提示词

> 使用方式：每次派发时，把“公共前缀”和一个“任务块”一起发送给 agent。
>
> 当前只允许派发 L1-L4。W1-IF 与 W2-C 已完成，相关提示词保留作范围审计，不再重复派发；L5 有讨论门禁，W6 依赖 L5，因此两者暂不提供施工提示词。

## 派发顺序

TODO、Wave、AGENTS.md 和提示词文档基线已合入 `main`；下面所有施工分支都从包含这份基线的最新 `origin/main` 创建。

1. 当前可并行派 W1-A-P1、W1-B-P1、W1-D；W1-A-P1 与 W1-B-P1 各自在合入后继续 P2。
2. W1-A-P2、W1-B-P2 都合入后派 W1-C；W1-C 与 W1-D 合入后再派 W1-B-P3，最后派 W1-X。
3. 派 W2-IF；随后并行 W2-A-P1、W2-B、W2-D，A-P1 合入后滚动派 A-P2；A-P2 与 B 合入后派 W2-X。
4. W2-X 与 W2-D 合入后派 W3-IF；随后优先并行 W3-A1、A2、A3，空余名额派 B-P1，按各自前置滚动派 B-P2；A1/A2/A3 合入后派 W3-X，不等 W3-B。
5. 派 W4-IF；随后优先派 W4-A1、A2、B1、C，按前置滚动派 A3、B2；所有 L4 实现合入后派 W4-X。W3-B 与 L4 所有在施工轨合计不得超过四条，名额不足时优先 L4 主线。

W1-IF/W1-B-P3 交给同一个保存格式 owner；W2-IF/W2-X、W3-IF/W3-X、W4-IF/W4-X 也分别保持同一 owner。每个 PR 合入后仍要删除旧 worktree，并从最新 main 为下一片重新建分支。

## 公共前缀

```text
你正在 GodSimulation 仓库的独立 git worktree 中施工。先执行只读检查并确认：当前分支不是 main；分支基于最新 origin/main；任务块列出的所有前置 PR 已经合入 main。若任一前置未合入，立即停止并报告，不得基于别人的未合分支开工。

开工前完整阅读根目录 AGENTS.md、PHILOSOPHY.md、docs/architecture/character-context-implementation-todo.md 中本任务涉及阶段的全部条目及其引用的行为约束（特别是 70-78），再读 docs/architecture/character-context-parallel-waves.md 对应轨线卡。先用自己的话列出本轨受哪些约束影响、准备修改哪些文件、测试哪些可观察行为；确认没有越过文件所有权再编辑。

必须遵守当前目标协议：operation 挂在角色、物品或家具宿主上；模型侧没有动态 taskOptions/候选白名单；AI 通过角色自身的 read operation 查询静态说明书后直接提交 operationId、宿主实例和参数；清空轨道走独立的稳定空任务分支，不伪装成 operation。决策预检只查分支形状、operation 与宿主绑定、轨道、参数 Schema、同步一致性、目标补丁和取消协议；距离、能力、占用、材料、所有权等世界条件在调用建立后的首个执行步骤检查，失败走当前 operation 已声明的 domainFailure。

最终代码不得保留第二套路径。只有任务块明确写明时，过渡 PR 才可暂留仍被当前生产路径或旧快照迁移使用的旧类型；不得扩展旧路径，任务块指定的收口 PR 必须删除它。

只修改任务块授权的文件。因工作区包禁止深路径导入，公共接口 PR 必须一次补齐契约所需的包根 index.ts 导出；其他实现轨能不碰桶文件就不碰，普通实现导出留给当层集成 PR，确因本轨 app 接线需要时只追加自己的最小导出。快照接口 PR 只定义独立字段 Schema，线上快照 Schema、版本和迁移只允许当层保存格式 owner 在指定收口任务中修改。发现前置接口不足时先报告，不得在本轨另建平行类型、状态或跨包依赖。

每个行为修复必须有测试。关键测试必须做变异验证：临时恢复旧错误行为，确认新增测试失败，再还原正确实现；变异代码不得提交。完成后运行 pnpm lint、pnpm typecheck、pnpm test、pnpm build、pnpm test:e2e。失败必须修复或如实报告，禁止吞错后声称完成。

提交使用 Conventional Commits。PR 描述引用具体 TODO 条目原文，说明实现、测试、变异验证和五项全量命令结果。所有 GitHub 通信显式使用 socks5://127.0.0.1:7897；不自行 merge，不勾选 TODO，不修改 Wave 合入状态，不提交 private/、free_model.local、data/、workspace/、密钥或真实模型响应。
```

## L1 提示词

### W1-IF 公共接口（已合入 PR #4）

```text
审计记录：W1-IF 已于 2026-09-04 通过 PR #4 合入 main，merge commit 为 88c8ac08437099846333dfed3a5fff9abbd12c13；无需再次派发。提交者仍是后续 W1-B-P3 的 L1 保存格式 owner。

已实现且已合入的范围：AgentDefinition.operations / AgentOperationDefinition；角色、物品、家具三种宿主引用；必填静态说明书；统一外部目标需求；ObjectDefinition.capabilities；continue | replace(emptyTask | operation 引用) 的新版决策形状；统一 operation 的 start、可选 tick、complete、fail、cancel、fuse 生命周期签名；首步校验结果、类型化失败和原子终止事务窄接口；L1 所需快照字段的独立 Schema 片段和序列化端口。operation 引用包含 operationId、角色自身可省略的 hostEntityId 和 arguments；空任务分支不得携带这些字段或创建 callId。已补齐所有跨包消费者所需的包根导出。

实际变更边界：主写 packages/protocol 的新契约文件、packages/plugin-sdk 的契约类型、packages/simulation/src/execution/operation-runtime.ts 的窄接口和独立快照字段 Schema；没有修改线上快照版本，没有实现注册、执行、模型调用、规则数值或迁移。新版 Schema 与旧 taskOptionId/taskOptions 类型暂时并存以保持当前生产路径可编译，但两者不互相调用；生产切换由 W1-C 完成，死代码由 W1-X 删除。
```

### W1-A-P1 宿主、说明书与角色挂载

```text
任务：W1-A-P1，把 operation 真正挂到角色/物品/家具宿主，并实现静态说明书与 read。前置：W1-IF 已合入。分支建议 wave1/w1a-host-manuals-p1。

把 core.move/core.speak/core.recall/core.read/core.wait/core.observe 从“全局自动授予”改为 AgentDefinition.operations 显式挂载；starter agents 明确声明自己的基础 operation。核心仍持有权威运行时实现，插件只决定角色是否挂载，不能让插件或模型直接改世界。P1 对 recall 只完成挂载声明和统一契约，不设计或接入 L5 的跨进程端口；L5 接线前若实际调用 recall，必须显式进入技术阻塞，禁止伪造结果。所有宿主 operation 必须通过同一契约校验且有静态说明书；read 挂角色自身，占 HEAD、indeterminate、只读，放行事务只建调用，结果在放行后、推进下一 Tick 前执行并提交，期间 worldTick 不变，且形成独立 call/result。

主写 plugin-sdk/agent、plugin-sdk/object、operation 定义加载校验、simulation execution 的 registry 与 agent adapter、plugins/starter-agents。消费 W1-IF 的统一生命周期契约，不得另建接口。旧动态候选路径仍被当前生产代码引用，本 PR 只允许保持兼容，不得扩展；提示词和生产切换归 W1-C。不要实现首步世界校验，不要改 action runner、生命周期终止、decision、cognition、规则或快照文件。
```

### W1-A-P2 直接调用与首步校验

```text
任务：W1-A-P2，实现直接宿主绑定与首步世界校验。前置：W1-A-P1 已合入。分支建议 wave1/w1a-direct-invocation-p2。

新增不依赖 taskOptions 的直接解析路径。模型提交的 operationId、宿主实例和参数先绑定到真实宿主定义：未知 operation、宿主不存在或未声明该 operation、错误宿主形式、轨道不匹配或参数 Schema 错误返回协议预检错误；能绑定的调用在创建时照旧只解析并锁定 duration，不运行 canStart 世界预筛。为各 operation 实现自己的 start 前置校验，检查距离、能力、占用、材料、所有权与目标状态，失败必须映射到该 operation 的封闭 domainFailure；通用运行器何时调用 start 以及如何原子结束由 W1-B 负责。

主写 simulation/execution 的 resolver/planner/object adapter、core operation 的 start 校验及对应测试。旧 offers/buildTaskOptions 在 W1-C 切换前仍可保留为未扩展的兼容层，W1-X 负责删除；不得修改 action runner、effect commit、Tick 管线、decision、cognition、终止事务或快照文件。用窄接口和 fixture 测试至少覆盖“被占用/距离不足仍能建立调用且 start 返回声明失败”“宿主无法绑定不建立调用”“角色未挂载 operation 不可调用”“state 相关 duration 只在创建时锁定一次”；端到端首步终止接线留 W1-X。
```

### W1-B-P1 生命周期与失败分类

```text
任务：W1-B-P1，统一 operation 生命周期和失败分类。前置：W1-IF 已合入。分支建议 wave1/w1b-lifecycle-failures-p1。

实现通用运行器对 W1-IF 的 start、可选 tick、complete、fail、cancel、fuse 生命周期调用；首个执行步骤只调用一次 start，fuse 只能读冻结状态，运行器不得复制具体 operation 的距离、材料等规则。domain_failure 只能使用当前顶层 operation 预注册的失败码和结果 Schema；内部微步骤先局部恢复，只有 operation 显式映射后才能成为顶层失败；插件异常、非法效果、Schema/定义/不变量错误和未声明码进入 technical_failure，调用保持可恢复且不生成角色经历。禁止按错误消息文字分类。

主写 simulation/execution/operation-lifecycle*、action runner 的生命周期调用、失败分类新增模块及对应 protocol event 文件。使用 fixture operation 验证通用调度，不修改 W1-IF 契约或任何具体 operation 的 start 规则。不要做完整补偿原子事务和快照迁移，它们分别属于 P2/P3；不要改 registry/planner 或 decision。
```

### W1-B-P2 原子终止与补偿

```text
任务：W1-B-P2，实现原子终止事务与补偿。前置：W1-B-P1 已合入。分支建议 wave1/w1b-atomic-termination-p2。

确保每个 callId 最终且只能生成一条 completed/failed/cancelled 终态 operation_result。旧调用退出、补偿效果、占用/租约释放和终态结果必须一次提交；任一步失败时保留原调用并进入技术失败，不能部分释放、重复补偿或伪造成功。已提交事实和事件绝不回滚，尚未提交的完成效果直接丢弃。

主写 operation lifecycle/termination、action runner 与 effect commit 所需的窄模块。不要修改线上快照文件、注册/候选删除或 decision。测试覆盖完成、声明失败、替换取消、补偿失败和重复调用终止，并对“先写成功结果再提交效果”的旧行为做变异验证。
```

### W1-B-P3 快照、迁移与恢复

```text
任务：W1-B-P3，完成 L1 operation 状态的快照、迁移和恢复契约。前置：W1-B-P2、W1-A-P2、W1-C、W1-D 全部已合入。分支建议 wave1/w1b-operation-snapshot-p3。

持久化宿主引用、锁定目标、startedAtTick、duration、固定 totalTicks、实际终止 Tick/来源、运行时 opaque state、首步状态和新版决策请求；恢复固定调用不得再次 resolveDuration，历史回放不得重新等待已记录完成信号。在 W1-IF 字段 Schema 基础上一次接入线上快照、升级版本并迁移当前 v3；保留已有 v2→v3 operation state 迁移链，不得在本层再升第二次版本。

主写 simulation/engine 的 snapshot codec/restorer/validation/migrations 和 operation 快照测试。验证冻结现实时间不计进度、分支恢复锁定值不漂移、非法前缀进度仍被拒绝。不要顺手接入其他轨行为。
```

### W1-C 决策纠错与原子放行

```text
任务：W1-C，改造模型决策为直接 operation 调用，并完成纠错与全员原子放行。前置：W1-A-P2 与 W1-B-P2 已合入。分支建议 wave1/w1c-direct-decision-release。

输出严格为 head/body 的 continue 或 replace；replace 再严格区分稳定空任务与 operation 引用，空任务不创建 callId，operation 引用包含 operationId、可选宿主和参数。同步 operation 的两轨必须引用同一 operation、宿主和规范参数。协议预检只检查分支形状、定义/挂载、宿主绑定、轨道、参数 Schema、同步一致性、目标补丁接口和取消协议，绝不检查距离、能力、占用、材料或资源争用。无效输出在同一冻结检查点要求完整重答，临时错误不进角色上下文；耗尽部署配置尝试次数后进入 TECHNICALLY_BLOCKED，不自动选择任何结果。

主写 simulation/decision、cognition 当前决策请求与提示词、model-gateway、protocol/model 与必要 IPC、simulation-worker 决策接线、local-server 决策协调、web 决策审查。停止生成和发送动态 taskOptions，只通过 W1-IF/W1-A execution 窄接口建立或取消调用；旧快照读取所需 Schema 留给 P3 迁移，运行时死代码留 W1-X 删除。GoalUpdateValidator 只实现接口与挂点，不伪造目标状态；实际实现留 W4-A2。测试空任务、全员 READY、乱序返回、单人纠错、整批最终预检失败和无提前生效。
```

### W1-D 规则与 Tick 时间

```text
任务：W1-D，完成 L1-L4 已确认的规则收尾和阶段 2 时间基础。前置：W1-IF 已合入。分支建议 wave1/w1d-rules-time。

补齐声音墙/门遮挡系数、当前已确认 operation 所需规则字段、部署参数分离和策略字面量静态门禁；所有可调数值必须由世界锁定规则或版本化内容定义唯一持有。完成角色时间投影 API、最后醒来/入睡/整理开始 Tick 锚点与倍速只影响现实调度的测试；不要创建第二套时钟。perception_now 尚未存在，本轨只提供接口和锚点，实际时间接线由 W3-A3 完成。L5 睡眠曲线和其他门禁内数值不得猜定，相应 TODO 保持未勾选。

主写 content/rules、protocol/rules、simulation/world 时间模块、scripts 和必要本地配置。不要改 operation/decision 或快照 codec；序列化形状由 W1-IF/W1-B 负责。
```

### W1-X 协议集成

```text
任务：W1-X，L1 集成收口。前置：W1-A-P2、W1-B-P3、W1-C、W1-D 全部已合入。分支建议 wave1/w1x-integration。

只做跨轨接线、桶导出，删除旧 taskOptions/TaskOptionId/offers/buildTaskOptions、面向模型的 available_interactions 查询、调用建立阶段的 canStart 预筛和全局自动授予 core operation 的残留，再补跨模块契约测试，不增加新行为。仓库级验证：空任务不创建调用；角色未挂载 operation 不可调用；read 说明书不随世界状态变化，在放行后、推进下一 Tick 前完成且 worldTick 不变，并可在同一 Tick 连续形成独立调用；世界前置失败发生在调用首步；无法绑定的宿主走纠错；补偿和终态原子；固定时长恢复不重算；全员放行不按模型返回顺序生效。

发现任何轨实现缺口时开独立修复 PR 或退回原 owner，不在集成 PR 跨区大改。五项全量命令全部通过后再提 PR。
```

## L2 提示词

### W2-IF 公共接口

```text
任务：W2-IF，定义 L2 物品、外观、视觉和声音算法公共接口。前置：W1-X 已合入。分支建议 wave2/w2if-item-perception-contracts。你也是后续 W2-X 的 L2 保存格式 owner。

只增加类型/Schema/窄接口：物品定义与实例 ID、carried/worn 归属、bodyFacts、六字段外观、externallyVisible 只读投影、移动完整轨迹、nearby、perception_now、连续视觉状态、声音传播输入/输出。本层所有世界快照字段只定义为独立 Schema 片段和序列化端口，不接入线上快照、不升级版本，也不实现穿衣、FOV 累积、声音算法或数据库行为。补齐所有跨包消费者所需的包根导出，接口合入后不允许实现轨各自漂移形状。

主写 protocol 新文件、plugin-sdk 物品/外观类型骨架、simulation 窄接口和快照 Schema。W2-B 必须只能看到外观公开读取接口。合入后停止，各 L2 实现轨从新 main 开工。
```

### W2-A-P1 物品与外观状态

```text
任务：W2-A-P1，实现最小物品内核、bodyFacts 与六字段权威外观。前置：W2-IF 已合入。分支建议 wave2/w2a-item-appearance-state-p1。

实现稳定定义/实例身份、非负整数单件容量、carried/worn 互斥归属、9 单位统一计算、穿着不占携带容量；实现有版本的 bodyFacts、写权限、衣服样式锚点/实例状态、externallyVisible/internallyHidden 六字段、wornItemIds 一致性、赤裸与权限隔离。容量读取按锁定规则现算，不持久化占用值；不得用文字关键词假装校验语义样式。

主写 simulation 物品/外观状态、plugin-sdk 的物品定义加载实现及对 W2-IF 序列化端口的模块级实现；W2-IF 的公共类型只读。不要实现穿脱 operation、梳妆台或 perception，不要修改线上快照文件。测试身份、容量整数、权限、隐私和序列化往返一致性；世界快照恢复条目留 W2-X 闭环。
```

### W2-A-P2 穿衣与梳妆台

```text
任务：W2-A-P2，实现 wear、undress、adjust_clothing 和梳妆台化妆。前置：W2-A-P1 已合入。分支建议 wave2/w2a-clothing-operations-p2。

这些 operation 使用 L1 宿主与说明书机制，BODY 占用；调用参数在模型决策时携带完整 appearanceAfter 并随 callId 暂存。调用期间仍投影旧权威外观和正在进行的公开动作；首步校验身份、归属、容量、距离/占用等，不满足走声明失败且丢弃待提交外观；只有正常完成事务才原子提交物品归属、穿着集合、实例状态和六字段外观。

主写 simulation 外观 operation 新模块、plugins/home-objects 梳妆台及说明书、相应测试。不要改 perception 或线上快照文件。覆盖满容量脱衣、继续/替换、执行中旧外观、样式锚点、赤裸、权限和隐私变异测试。
```

### W2-B 视觉与 move 回执

```text
任务：W2-B，实现阶段 4 视觉感知结果与 move 动作回执。前置：W2-IF 已合入。分支建议 wave2/w2b-visual-move-receipts。

移动执行器输出实际顺序的完整轨迹和朝向变化；视觉累积消费所有中间位置的 FOV/LOS，不假设单 Tick 一格。nearby 属于 move call，按实体/类别聚合并维护跨熔断交付游标；成功、失败、外部熔断分别返回尚未交付的沿途观察，perception_now 留给 W3-A3 统一生成。只能通过公开接口读取其他角色 externallyVisible 外观和公开行为。

主写 simulation/perception/vision 和 move 专属执行文件，消费 W2-IF 的 nearby/perception_now/连续视觉契约且不得改其形状。不要改物品私有状态、audition 或线上快照文件。覆盖跨多格、转弯、遮挡、自动开门、锁门改道、无路、去重、稳定排序和私有衣物不泄漏。
```

### W2-C 归档存储地基

```text
审计记录：W2-C 已于 2026-09-04 通过 PR #3 合入 main，merge commit 为 299e01969daa438d5799449d516fd6385d1d771a；无需再次派发，也不再占用并发名额。

已实现按世界/分支/角色/整理周期隔离的归档记忆 Schema，正文/来源/Tick/重要性/索引与编码器锁；按归档年龄直接重算指数衰减并删除，跨多日一次计算等价于逐日计算；实现 FTS 与向量命中按同一记录 ID 合并、排序纯函数和编码器/索引版本失效协议。相似正文但不同 ID 不去重，recall 不更新强度。

实际变更边界：主写 timeline 中的存储领域接口、sqlite-store 实现和 SQLite migration；没有修改 protocol IPC、simulation、cognition、worker/host。L5 如何跨进程调用以及 DTO 放置仍保留讨论标记。
```

### W2-D 声音传播算法

```text
任务：W2-D，实现阶段 11 的纯声音传播算法。前置：W2-IF 与 W1-D 已合入。分支建议 wave2/w2d-audition-algorithm。

从世界锁定规则读取小声/正常/大声初始强度、统一距离衰减、墙与门遮挡和接收阈值；静态墙可预计算，动态门每次传播读权威状态，不做区域背景噪声。输出 delivered/muffled/silent、权威声源和接收者朝向下的相对方位；模糊只使用世界确定性随机源，silent 不泄漏来源或方位。

主写 simulation/perception/audition，消费 W2-IF 的声音结果类型且不得改其形状。禁止接入 speak、事件路由或持续声音状态。覆盖无遮挡/墙/关门递减、开门即时变化、三档边界、多人不同方位和恢复回放一致。
```

### W2-X 快照与主线集成

```text
任务：W2-X，完成 L2 世界快照与主线集成。前置：W2-A-P2 与 W2-B 已合入。分支建议 wave2/w2x-item-vision-integration。必须由提交 W2-IF 的同一保存格式 owner 承担。

把 W2-IF 已声明、W2-A/B 已实现的物品、bodyFacts、外观、待提交 appearanceAfter、视觉累积与交付游标一次接入线上世界快照；只升一次版本并提供从上一版本的显式迁移。只做桶导出和跨模块场景测试，不增加业务行为；W2-D 是 W3-IF 的另一项独立前置，W2-C 不阻塞本 PR。

验证穿脱执行中保存恢复仍保留旧权威外观与待提交快照、move 多次熔断后交付游标不重复、私有外观不泄漏。运行五项全量验证；发现实现缺口退回对应 owner，不在本 PR 跨区扩功能。
```

## L3 提示词

### W3-IF 公共接口

```text
任务：W3-IF，定义 L3 感知事件、路由与熔断公共接口。前置：W2-X 与 W2-D 已合入；W2-C 不阻塞。分支建议 wave3/w3if-perception-fuse-contracts。你也是后续 W3-X 的 L3 保存格式 owner。

只增加 perception_event 信封、公开行为组合、人物/对象边沿、定向互动与声音事件、声明式 ignore 条件、Tick 触发批次、freezePending、输入截止序号和迟到结果队列的类型/窄接口；加入 W3-B give/accept 所需的目标互动提交端口。本层全部快照字段只定义为独立 Schema 片段和序列化端口，不接入线上快照、不升级版本，也不实现边沿、过滤、路由、Tick 行为或物品转移。补齐所有跨包消费者所需的包根导出，接口合入后实现轨不得各自改其形状。

主写 protocol events、新增 simulation perception/engine 接口和快照 Schema。合入后停止，A1/A2/A3/B 从新 main 开工。
```

### W3-A1 公开投影与视觉边沿

```text
任务：W3-A1，实现公开行为组合与视觉/对象语义边沿。前置：W3-IF 已合入。分支建议 wave3/w3a1-visible-semantic-edges。

从 active operations 的 publicBehavior 生成稳定 HEAD/BODY 顺序的公开投影，多槽 callId 只出现一次；speak 只显示正在说话，recall/read 只显示一般思考或隐藏，绝不泄漏参数/callId。只为人物不可见→可见、公开行为语义变化、成功提交后的 externallyVisible 外观变化，以及对象已声明公开边沿生成事件；人物离开、位置/距离/进度连续变化和未声明对象变化只更新当前视觉状态。

主写 simulation/perception/visual-events 和 plugin-sdk 公开观察边沿的加载/校验实现；W3-IF 的 protocol payload 只读。禁止改 Tick 管线、路由/ignore 和线上快照文件。测试可见阶段持久化、重新进入、组合顺序、单次触发、私有字段和恢复回放。
```

### W3-A2 定向路由与 ignore

```text
任务：W3-A2，实现角色私有事件路由、目标互动和双轨 ignore。前置：W3-IF 已合入。分支建议 wave3/w3a2-routing-ignore。

严格区分世界事实、给角色的感知内容和触发思考信号。目标互动只有 operation 正常完成时与效果、发起者成功结果同事务提交给锁定目标；按完成后可见性决定公开姓名或匿名，旁观者只能靠自身视觉/听觉。实现受限声明式 ignore 比较；事件只有被 HEAD/BODY 当前任务规则完整覆盖才忽略，空任务不贡献覆盖，生命周期完成/失败/不可继续永不忽略。

主写 simulation/perception/routing 和 simulation/perception/ignore；W3-IF 的 protocol events 只读。禁止改 operation lifecycle、Tick 管线或线上快照文件。用 fixture operation 覆盖可见/不可见发起者、失败取消不通知、双轨覆盖、声音接收强度字段和隐私。
```

### W3-A3 Tick 熔断与迟到队列

```text
任务：W3-A3，实现 Tick 唯一熔断窗口、输入组装和迟到结果队列。前置：W3-IF 已合入。分支建议 wave3/w3a3-tick-fuse-queue。

第一个未忽略触发只锁存 freezePending；完成当前 Tick 全部确定性阶段后、下一 Tick 前提交检查点并熔断。同一角色输入按“HEAD/BODY 只读中间回执、全局事件序号触发、冻结快照 perception_now”排序；perception_now 接入 W1-D 时间投影，使用相对方位和公开对象类型/状态，不含坐标、原始 Tick、callId 或动态 operation 清单。封口后异步结果按持久化接收序号排队，放行后在推进 Tick 前稳定处理；被替换调用的迟到结果只进审计。

主写 simulation/engine 与 Tick 管线接线，使用 W3-IF 序列化端口保存本轨状态；线上快照 codec/restorer/migration 留给 W3-X。A1/A2 只按 W3-IF 接口消费，不复制其规则。测试 Tick 管线完整提交、无现实 debounce、多事件不丢不去重、多角色隔离、冻结不推进和模块级序列化顺序。
```

### W3-B-P1 物品归属与世界实体

```text
任务：W3-B-P1，扩展完整物品容量、归属和世界实体。前置：W2-A-P2 与 W3-IF 已合入。分支建议 wave3/w3b-item-ownership-p1。这是可跨到 L4 继续的并行支线，但 W6 前必须完成。

把 9 单位整数容量推广到所有物品；物品实例任何时刻恰好归属于角色、家具或世界坐标之一，禁止物品容纳物品、复制或悬空。实现拾取、放下、归属变化的原子容量/所有权校验；丢弃后成为位于角色当前格的独立世界实体并参与现有 FOV/LOS，不按朝向找落点或兜底格。接入事件、分支、物品公开可见性和 W3-IF 已预留的序列化端口。

主写 plugin-sdk 物品协议、simulation 物品归属/裁决新增模块和相关 plugins。不得改 W3-A 目录或任何线上快照文件；字段必须使用 W3-IF 形状，接口不足时停止并补独立接口 PR。测试无嵌套、容量、原子失败、掉落实体、可见性和序列化往返。
```

### W3-B-P2 家具生产与两步转移

```text
任务：W3-B-P2，实现物品→家具、多实例生产、销毁声明和 give/accept。前置：W3-B-P1 与 W3-A2 已合入。分支建议 wave3/w3b-item-interactions-p2。

物品与家具通过双方声明的交互协议工作；一次 BODY operation 可指定多个携带实例，首步整组校验归属、重复、组合、数量、家具处理能力和状态，效果裁决一次原子提交。配方来自版本化内容定义，正常完成才消耗/转换/生成真实物品，熔断不产物；禁止在生产 operation 内自动串联取物/放物等其他语义操作。销毁只由物品插件声明。give 正常完成只写 pendingTransfer 并定向通知目标，accept 由目标自己决策后才原子转移。

主写 plugin-sdk 交互扩展、plugins 对象定义、simulation 物品效果裁决新增模块。不得改事件路由、Tick 管线或线上快照文件。测试多实例原子性、配方确定性、生产熔断、未声明销毁、give 后归属不变、accept 转移及 pendingTransfer 恢复。
```

### W3-X 事件熔断集成

```text
任务：W3-X，收口 W3-A1/A2/A3。前置：三轨均已合入；不要求等待 W3-B。分支建议 wave3/w3x-event-fuse-integration。

只做跨轨接线、桶导出和场景测试：同 Tick 多人物/对象事件只形成一个世界决策周期；每个角色只收到自身事件；目标互动完成事务和匿名裁剪正确；回执→触发→perception_now 顺序稳定；检查点封口后结果排队；冻结期间世界事实和任务进度不变。由提交 W3-IF 的同一 owner 把事件、队列和预留物品字段一次接入线上快照、升级版本并完成恢复/回放；W3-B 后续不得再改版本。speak 完整传播和持续声音留 W4-C，物品 give/accept 由 W3-B-P2 自测。

发现实现缺陷退回对应 owner 或开小修复 PR，不跨区重写。五项全量命令通过后 L4 可开工，W3-B 可继续作为支线。
```

## L4 提示词

### W4-IF 公共接口

```text
任务：W4-IF，定义日内上下文、目标、Token/疲惫和持续声音公共接口。前置：W3-X 已合入。分支建议 wave4/w4if-context-fatigue-contracts。你也是后续 W4-X 的 L4 保存格式 owner。

只增加日内语义消息、上下文读写、目标状态/补丁、Token 分区统计、疲惫分解、昏睡信号、持续声音接收状态、厂商无关模型消息和 app 接线端口；L4 所需快照字段只定义为独立 Schema 片段和序列化端口，不接入线上快照、不升级版本。不实现消息写入、目标更新、提示词、Token 计数、疲惫或声音行为。补齐所有跨包消费者所需的包根导出，接口合入后实现轨不得各自改其形状。

主写 protocol 新文件、cognition/simulation 窄接口和快照 Schema。合入后停止，各 L4 轨从新 main 开工。
```

### W4-A1 日内上下文

```text
任务：W4-A1，实现项目持有的日内语义消息时间线。前置：W4-IF 已合入。分支建议 wave4/w4a1-daily-context。

每角色上下文必须可持久化、恢复、回放、分支；按 Tick 和事件序号保存有效决策、operation_call、唯一终态/允许的中间 operation_result、perception_event、perception_now 和目标更新。无效模型输出与技术错误只进审计；自发感知不能伪造 callId；result 必须引用该角色已有 call。实现幂等重建及 simulation-worker 从本地状态组装请求的接线，不依赖供应商会话。

主写 cognition/context、simulation 上下文状态/写入点、simulation-worker 请求接线和 W4-IF 序列化端口实现。simulation 不得导入 cognition，只能共享 protocol 消息类型；线上快照 codec/migration 留 W4-X。不要实现目标行为、供应商适配、Token 或 memory。测试模块级重建顺序、重复投递幂等和私有事件隔离。
```

### W4-A2 目标事务

```text
任务：W4-A2，实现长期/短期目标和 goalUpdates 原子事务。前置：W4-IF 与 W1-C 已合入。分支建议 wave4/w4a2-goal-transactions。

目标有稳定 ID、持久化且与 HEAD/BODY 任务分离；严格补丁支持新增、修改、完成、放弃，并校验角色权限、ID 存在性和单次一致性。goalUpdates 与双轨 continue/replace 在同一放行事务提交，任一无效整份拒绝；任务完成/失败/替换不得隐式改目标。实现 W1-C 预留的 GoalUpdateValidator，并把成功目标更新写入 W4-IF 上下文端口。

主写 simulation 目标状态和 simulation/decision validator/release 接线，消费 W4-IF 目标协议且不得改其形状。不要改上下文存储内部、提示词或线上快照文件。测试原子回滚、跨角色拒绝、任务不隐式改目标和恢复。
```

### W4-A3 提示词与模型适配

```text
任务：W4-A3，实现稳定提示词组装和供应商投影。前置：W4-A1 已合入。分支建议 wave4/w4a3-prompt-adapters。

系统内容稳定顺序为压缩长期记忆/长期目标/短期目标/区域语义地图，然后角色完整衣物与 bodyFacts，再是核心规则；环境事实只留日内消息。渲染有效决策、call/result、perception event/now，供应商缺少自定义角色时用严格信封普通消息表达，不能伪造工具关系。彻底移除动态 taskOptions；系统只引导 read，具体 operation 说明来自 read 的日内结果。

主写 cognition prompt/context renderer、model-gateway adapters 和必要 simulation-worker 接线，消费 W4-IF 的厂商无关消息协议且不得改其形状。不要实现 Token 压力、目标事务或记忆整理。测试同一本地状态对不同供应商的因果关系一致、坐标和私有字段不泄漏。
```

### W4-B1 Token 与疲惫纯模块

```text
任务：W4-B1，实现真实 Token 计数、预算统计和疲惫纯计算。前置：W4-IF 已合入。分支建议 wave4/w4b1-token-fatigue-core。

按目标模型选择真实 tokenizer；分别统计系统、日内对话、operation 定义/协议开销和输出预留，实施约 200k 安全预算及独立技术硬上限。用锁定规则把清醒时间压力和 Token 压力归一化后按 0.6/0.4 组合，43,200 ticks 为时间 1.0 基线、0.6 为暂定强制昏睡阈值；输出必须能解释两个分量。所有曲线/阈值/预留来自规则，配长运行校准工具。

主写 cognition/token、simulation/fatigue 纯模块、rules 字段和仿真脚本。只针对 W4-IF 标准消息输入，不改 W4-A1/A3；simulation 纯函数只接收 protocol 中的统计值，不得导入 cognition。实际请求接线留 W4-B2。
```

### W4-B2 疲惫运行时接线

```text
任务：W4-B2，把真实请求 Token 与疲惫状态接入运行时。前置：W4-A3 与 W4-B1 已合入。分支建议 wave4/w4b2-fatigue-runtime。

对实际组装请求执行分区计数，确保任何发送都不越技术硬上限；更新角色可解释疲惫状态，警戒线成为角色感知，强制阈值发出统一昏睡入口信号但本轨不实现睡眠。冻结时 Tick 和疲惫不推进，恢复/回放结果一致。执行长时间仿真校准，把最终数值写回规则并用测试锁定。

主写 simulation 疲惫接线新增文件和校准测试，消费 W4-IF 的检查器投影。不要改提示词组装、睡眠状态机或线上快照文件。
```

### W4-C 听觉接线

```text
任务：W4-C，接入 speak 瞬时传播和持续环境声音。前置：W4-IF、W2-D、W3-A2、W3-A3 已合入。分支建议 wave4/w4c-hearing-runtime。

speak 正常完成 Tick 只计算一次传播并产生多接收者批次；每人得到独立完整/模糊结果、权威声源和自身朝向方位，silent 无事件；失败取消不投递内容。持续声对每个角色只在不可听→可听、产生新内容、可听→不可听时发事件，持续期间方向/距离/音量变化只更新状态。所有投递持久化，进入 W3 路由/熔断和 W4-IF 上下文端口；不另建“说话对象”通道。

主写消费 L1 speak 正常完成信号的 simulation 接线、hearing state 新目录和环境声插件声明。不得重新全局注册或绕过角色挂载 speak；不要改 W2-D 算法、W3 路由/Tick 管线或线上快照文件。完成阶段 5 延后的声音契约测试和阶段 11 剩余测试。
```

### W4-X 上下文、疲惫与听觉集成

```text
任务：W4-X，L4 集成收口。前置：W4-A1/A2/A3、W4-B2、W4-C 已合入。分支建议 wave4/w4x-context-fatigue-hearing-integration。

只做跨轨接线、桶导出和场景测试，并由提交 W4-IF 的同一 owner 把上下文、目标、疲惫和听觉字段一次接入线上快照、升级版本及迁移：恢复后下一请求一致；goal 与双轨调用原子提交；read/operation/perception/sound 消息因果顺序正确；声音只进入实际听者上下文；Token 分解对应真实请求且不越硬上限；疲惫冻结不推进；动态 taskOptions 不再出现在协议、提示词或 UI。发现实现缺陷退回 owner，不在集成 PR 扩功能。

运行五项全量验证。合入后必须停在 Wave 文档的“⚠️ L5 开工前讨论门禁”，不得自行开始睡眠、整理、SQLite IPC 或 recall 接线。
```

## L5/L6 状态

```text
⚠️ 不派发：L5 的 worker/host、模型调用、SQLite、迟到结果和回放边界尚待专项讨论。L5 讨论完成并先合 W5-IF 后，才能生成 W5-A/B/C 提示词；W6 依赖 L5，也暂不派发。
```
