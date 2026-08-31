# God Simulation 首个里程碑架构加固设计

状态：方案已确认，书面规格待审阅

日期：2026-08-31

关联规格：`docs/superpowers/specs/2026-08-31-basic-simulation-loop-design.md`

## 1. 目的

首个玩法循环已经能够运行，但当前实现中有四处底层边界不够稳固：

1. 模拟核心通过 `door` 标签以及物件状态中的 `open`、`locked` 字段识别门。
2. 部分角色知识和记忆引用了并不存在的 Event ID，动作失败也没有稳定形成记忆。
3. Event 与 Snapshot 分开写入 SQLite，进程在两次写入之间退出时会留下无法恢复的半份历史。
4. 模型调用记录缺少决策周期、协议版本、插件锁和决策原因，无法完整说明一次回答属于哪次思考。

本设计只加固这四处架构边界，并补全跨包依赖规则。它不改变已经确认的玩法：模型仍只负责高层决策，程序仍负责寻路、自动交互、动作执行、感知、冲突和世界时间；只有角色确实需要重新思考时，才会产生玩法暂停。

## 2. 本轮范围

### 2.1 必须完成

- 给物件插件增加正式的自动通行能力，核心不再识别官方门插件的标签或状态字段。
- 用通用的物件交互动作替代核心中的开门、关门、锁门和解锁等专用动作类型。
- 用通用的“已知通行阻碍”替代角色知识中的“已知锁门”。
- 所有新生成的知识和记忆只能引用真实 Domain Event。
- 初始背景、初始物件知识、视觉变化、身体变化和动作失败都进入同一条因果记录规则。
- Worker 以语义检查点发送 Event 与 Snapshot，本地主程序在一个 SQLite 事务中写入。
- 关键检查点写入成功前，不开始下一轮模型请求，也不推进检查点之后的世界步。
- 为 `model_calls` 补齐必要的决策身份字段，但不保存完整提示词或密钥。
- 非破坏性迁移现有开发数据库；旧格式仍可读取，新建历史采用严格因果格式。
- 完整约束各应用、包和插件之间允许的依赖方向。

### 2.2 明确不做

- 不实现完整 Event Sourcing，不能仅凭 Event 重建每一个世界步。
- 不保存每个 tick、路径中间结果、每次视线计算或渲染状态。
- 不实现时间线回滚、分支、长期记忆提炼或向量检索。
- 不建立插件安全沙箱，也不兼容违反公开插件协议的第三方插件。
- 不把 SQLite 变成运行时裁决中心；模拟进程内的 `WorldState` 仍是当前世界唯一可写事实。
- 不重写或伪造旧开发存档中的历史 Event。
- 不改变当前页面布局、美术资源或角色玩法内容。

## 3. 必须保持的底层规则

### 3.1 核心只认识能力，不认识家具种类

`packages/simulation` 可以询问一个物件是否阻挡移动、是否遮挡视线、是否支持自动通行交互，但不能通过以下方式决定行为：

- 判断定义 ID 或 `door`、`wall`、`toilet` 等标签。
- 读取 `open`、`locked`、`occupiedBy` 等插件私有字段。
- 写死 `open`、`close`、`lock` 或 `unlock` 等交互 ID。
- 把插件返回的某个原因码翻译成核心专用家具类型。

标签仍可供内容筛选、调试显示和以后编辑器使用，但不能参与模拟规则。

### 3.2 角色只能在实际经历后知道阻碍

路径算法可以知道地图几何和角色已经拥有的知识，但不能因为权威物件状态里存在“锁定”信息就提前排除路线。

正确流程是：

```text
路线经过一个当前阻挡移动、但声明了自动通行交互的物件
-> 程序把该交互插入动作计划
-> 插件根据自己的私有状态决定交互能否开始
-> 成功则重新检查通行并继续
-> 失败或完成后仍不可通行，则写入动作失败 Event
-> 角色记住这个具体物件当前无法自动通过
-> 程序排除该物件并重新寻路
-> 所有已知路线都失败后，才请求角色重新思考
```

这条规则同时适用于门、闸机、可推动障碍和以后插件提供的其他通行物，不依赖“锁”的概念。

### 3.3 Event 先取得真实身份，知识和记忆随后形成

任何知识或记忆写入角色状态前，必须先由模拟核心创建对应的 Domain Event，并取得正式的 `eventId`。知识和记忆只能引用这个正式 ID，禁止先拼出一个看似 Event ID 的字符串再等待以后补记录。

这里的“先创建 Event”指先进入权威模拟的有序 Event 缓冲区，不要求模拟每次形成记忆都同步等待磁盘。磁盘持久化仍由后述语义检查点批量完成。

### 3.4 检查点是唯一的世界历史写入口

新格式的世界历史禁止分别调用“追加 Event”和“保存 Snapshot”。一次检查点中的 Event 与 Snapshot 必须全部提交或全部回滚。

插件锁、模型调用和技术日志可以单独写表，因为它们不是逐步变化的可恢复世界状态；它们必须带足够身份，能够与世界 Event 对齐。

## 4. 插件自动通行能力

### 4.1 公共接口

在 `packages/plugin-sdk` 的 `ObjectDefinition` 中增加可选能力：

```ts
export interface AutomaticTraversalCapability {
  readonly interactionId: string;
}

export interface ObjectDefinition<State = unknown> {
  // 现有字段省略
  readonly movement?: MovementCapability<State>;
  readonly traversal?: AutomaticTraversalCapability;
  readonly interactions: readonly InteractionDefinition<State>[];
}
```

职责划分如下：

- `movement.blocksMovement(...)` 只回答物件此刻是否实际挡路。
- `traversal.interactionId` 声明程序遇到阻挡时可以自动尝试哪个交互。
- 对应 `InteractionDefinition.canStart(...)` 由插件根据私有状态判断能否执行。
- 交互完成后，核心再次调用 `movement.blocksMovement(...)` 验证结果，不能相信插件口头宣称已经可通行。

插件注册时必须验证：`traversal.interactionId` 能在同一物件的 `interactions` 中找到。引用不存在时插件加载失败并进入明确的技术错误，不允许运行到寻路中途才静默跳过。

官方门插件会声明 `interactionId: "open"`。门的 `open` 和 `locked` 字段仍只存在于门插件内部：移动能力根据 `open` 判断是否挡路，`open` 交互根据 `locked` 判断是否可开始。核心看不到也不解析这些字段。

### 4.2 通用动作

核心中的物件动作统一为：

```ts
export interface ObjectInteractionAction {
  readonly kind: "interact_object";
  readonly purpose: "goal" | "automatic_traversal";
  readonly targetEntityId: EntityId;
  readonly interactionId: string;
  // 动作 ID、时长、身体槽、进度和 started 等现有字段保留
}
```

角色选择“使用冰箱”和程序自动“打开门”都经过同一个交互路由、裁决和效果提交链路，区别只在 `purpose`：

- `goal` 来自已经通过校验的角色目标。
- `automatic_traversal` 由路径规划器根据插件能力插入。

浏览器显示动作时使用插件交互的 `displayName` 或通用状态文字，不再依赖 `open_object` 等核心枚举。

### 4.3 通用通行知识

`AgentKnowledge.knownLockedDoorIds` 替换为通用记录：

```ts
export interface KnownTraversalBlocker {
  readonly entityId: EntityId;
  readonly observedObjectVersion: number;
  readonly reasonCode: string;
  readonly sourceEventId: EventId;
}
```

该记录只能由角色亲自执行自动通行交互失败，或完成交互后仍被阻挡时产生。它不能由路径算法直接读取权威物件状态产生。

路径规划时，已知阻碍对应的格子不可走；其他声明了自动通行交互的阻挡物可以先作为“可尝试路线”参与规划。角色以后实际观察到该物件发生了新的可见变化时，旧阻碍记录可以失效；仅在权威状态中发生但角色不可见的变化不能自动清除知识。

失败恢复不再判断 `locked_door`。只要失败动作的 `purpose` 是 `automatic_traversal`，程序就记录该物件、排除它并重新规划；插件原因码和摘要原样进入 Event、记忆和开发界面。

### 4.4 可观察的交互可用性

插件可以在 `ObservableObjectState` 中按交互报告角色当前能观察到的可用性：

```ts
interactionAvailability?: readonly (
  | { interactionId: string; available: true }
  | {
      interactionId: string;
      available: false;
      reasonCode: string;
      summary: string;
    }
)[];
```

`details` 仍是插件自有的展示数据，模拟核心不得解析其中的 `occupiedBy`、`locked` 或其他私有字段。插件未报告某个交互表示角色不知道，程序仍允许角色尝试；只有角色实际观察到该交互不可用时，程序才从候选目标中移除它，或在它正是当前目标时形成 `perceived_goal_conflict` 并请求重新思考。

可用性是面向观察者的投影。家具可以把交互对当前占用者报告为可用、对其他观察者报告为不可用，而不向核心暴露内部状态结构。

## 5. Event、知识与记忆的因果链

### 5.1 新的主观感知 Event

新增 `perception_recorded` Domain Event，最小字段为：

```ts
{
  type: "perception_recorded";
  agentId: AgentId;
  observationKind: "vision" | "hearing" | "contact" | "interaction" | "body" | "memory";
  summary: string;
  relatedEntityId: EntityId | null;
}
```

该 Event 自身就是视觉观察、初始背景、初始物件知识或观察到其他角色的真实来源。Event 不保存完整插件私有状态，也不承担完整重放；当前主观状态仍保存在 Snapshot 中。

现有 `observation_remembered` Event 保留在协议解析器中，用于读取旧历史，但新世界不再生成它。原因是旧类型要求先提供另一个 `sourceEventId`，无法自然表示“角色第一次看到一个静态物件”而不伪造来源。

### 5.2 各类来源的写入顺序

初始角色背景和初始物件知识：

```text
插件或地图提供初始内容
-> 写 perception_recorded Event（kind = memory）
-> 用该 Event ID 建立知识和即时记忆
```

视觉观察物件或其他角色：

```text
插件 observe(...) 返回可观察结果
-> 程序确认它相对角色上次认知发生了变化
-> 写 perception_recorded Event（kind = vision）
-> 用该 Event ID 更新知识并形成即时记忆
```

身体阈值变化：

```text
写 agent_need_changed Event
-> 用该 Event ID 形成身体记忆
```

动作失败：

```text
写 action_failed Event，包含 reasonCode、summary 和可选 entityId
-> 用该 Event ID 形成 interaction 记忆
-> 如果它来自 automatic_traversal，再用同一 Event ID 建立 KnownTraversalBlocker
-> 尝试本地恢复，必要时才请求思考
```

因此新历史中，`KnownObjectState.sourceEventId`、`KnownAgentState.sourceEventId`、`ImmediateMemory.sourceEventId` 和 `KnownTraversalBlocker.sourceEventId` 都必须能在同一世界的 Event 序列中找到。

### 5.3 初始 Event

世界加载器不再直接返回一份已经含伪造来源 ID 的 `WorldState`。初始化过程返回世界状态及其初始 Event，模拟引擎按正式序列写入这些 Event 后再形成初始知识，并继续产生第一轮 `decision_requested` Event。

初次进入 `THINKING` 时的检查点必须同时包含：

- 初始背景和初始物件知识的 `perception_recorded` Event。
- 初次实际看见物件和其他角色的 `perception_recorded` Event。
- 两名角色的 `decision_requested` Event。
- 已经引用这些 Event 的完整 Snapshot。

模型请求只在这个检查点成功写入后发出。

### 5.4 运行时检查

新建世界使用严格因果 Snapshot 格式。生成检查点前必须验证：

- Event 序列连续，`parentSequence` 与上一条一致。
- Snapshot 的 `lastEventSequence` 等于本次检查点最后一条 Event 的序列；若本次没有新 Event，则等于上一个已确认序列。
- Snapshot 中所有知识和记忆引用的 Event ID 已存在于已确认历史或本次检查点。
- 同一 Event ID 不能对应不同 payload。

任一检查失败都进入 `TECHNICALLY_BLOCKED`，不能删掉记忆、编造 Event 或继续运行。

## 6. 原子语义检查点

### 6.1 检查点边界

只在以下时刻创建世界检查点：

1. 世界进入 `THINKING`，准备发出新的模型请求。
2. 一轮决定完成并从冻结状态放行为 `RUNNING`，但尚未执行下一世界步。
3. 世界进入 `TECHNICALLY_BLOCKED`，且当前内存状态仍可序列化。
4. 用户正常停止会话或本地主程序正常关闭。

普通移动、动作进度、每次视线计算和每个 tick 不单独保存。运行中进程意外崩溃时，恢复到最近一个完整语义检查点，这是本地首版明确接受的恢复粒度。

如果 `TECHNICALLY_BLOCKED` 正是由某个检查点写入失败造成，不能再递归创建第二个检查点。此时保留并重试原检查点，技术阻塞只作为内存状态和界面状态存在；原检查点成功后再恢复其先前模式。

### 6.2 IPC 消息

Worker 到 Host 增加：

```ts
{
  type: "checkpoint_ready";
  checkpointId: string;
  events: readonly DomainEvent[];
  snapshot: WorldSnapshot;
}
```

Host 到 Worker 增加：

```ts
{
  type: "checkpoint_committed";
  checkpointId: string;
}
```

`checkpointId` 由 `worldId`、`worldVersion` 和 `lastEventSequence` 确定，同一份检查点重试时保持不变。

旧的 `event_batch`、`snapshot_ready` 和 `request_snapshot` 不再用于新会话的世界历史写入。协议解析可以在迁移期间保留旧消息测试，但生产路径只能走检查点。

### 6.3 顺序与屏障

检查点流程固定为：

```text
Worker 到达语义边界
-> 冻结一份不可变的 events + snapshot
-> 发送 checkpoint_ready
-> Host 调用 TimelineStore.commitCheckpoint(...)
-> SQLite 事务成功
-> Host 发送 checkpoint_committed
-> Worker 丢弃已确认 Event 缓冲，并继续后续工作
```

在收到 `checkpoint_committed` 前：

- 进入思考的检查点不能开始模型请求。
- 放行运行的检查点不能执行下一世界步。
- 关闭检查点不能结束 Worker 或关闭数据库。
- Worker 可以继续回应只读查询和显示当前 View。

等待持久化不是角色重思考，也不能创建新的 `DecisionRequested`。它是很短的技术写入屏障；写入失败时才转为可见的技术阻塞。

### 6.4 写入失败与重试

`PersistenceWriter` 把一个完整检查点作为一个排队操作。SQLite 任一步骤失败时：

- 整个数据库事务回滚，不能留下只有 Event 或只有 Snapshot 的状态。
- Writer 保留原始检查点，不拆分也不重建 payload。
- Host 通知 Worker 进入 `TECHNICALLY_BLOCKED`。
- 玩家选择重试后，Writer 原样重试同一个 `checkpointId`。
- 成功后才发送 `checkpoint_committed` 并恢复原先的 `THINKING`、`READY_FOR_RELEASE` 或关闭流程。

重复提交同一检查点必须幂等；如果相同世界、序列或检查点身份对应不同 payload，则判为历史冲突并停止，不允许覆盖。

## 7. Timeline 与 SQLite

### 7.1 TimelineStore 接口

世界历史写接口收敛为：

```ts
export interface WorldCheckpoint {
  readonly checkpointId: string;
  readonly events: readonly DomainEvent[];
  readonly snapshot: WorldSnapshot;
}

export interface TimelineStore {
  commitCheckpoint(checkpoint: WorldCheckpoint): Promise<void>;
  savePluginLock(record: PluginLockRecord): Promise<void>;
  saveModelCall(record: ModelCallRecord): Promise<void>;
  recordFailure(worldId: WorldId, failure: TechnicalFailure): Promise<void>;
  loadLatest(worldId: WorldId): Promise<RestoredTimeline>;
  close(): Promise<void>;
}
```

`appendEvents` 与 `saveSnapshot` 从公开生产接口移除，避免以后再次绕开原子边界。

### 7.2 SQLite 事务

`commitCheckpoint` 在一个事务内按以下顺序工作：

1. 校验消息中的世界 ID、序列、父序列和 Snapshot 尾序列一致。
2. 确认现有 Event 尾部与本次批次连续；幂等重试允许已存在的完全相同记录。
3. 按序插入 Event，并对已存在记录逐条比对 Event ID 与完整 JSON。
4. 插入 Snapshot；同一版本已存在时必须与完整 JSON 一致。
5. 再次确认数据库 Event 尾序列等于 Snapshot 的 `lastEventSequence`。
6. 提交事务。

任何比对不一致都会回滚并报告历史冲突。

### 7.3 数据库迁移

新增独立的 `002` 迁移，并让迁移过程可重复执行。迁移只增加缺失的列和索引，不删除、不重写旧行。

`model_calls` 增加可空列以容纳旧数据：

- `protocol_schema_version`
- `decision_cycle_id`
- `plugin_lock_hash`
- `decision_reason_code`

TypeScript 中的新 `ModelCallRecord` 对这些字段要求非空；只有迁移前的旧行允许数据库中为空。

Snapshot 协议增加严格因果的新版本：

- 新建世界写新版本 Snapshot，并执行第 5.4 节的完整引用检查。
- 旧版本 Snapshot 继续由恢复器读取，并标记为 legacy history。
- 从旧 Snapshot 恢复的会话不伪造过去 Event，也不宣称旧引用已经完整；新产生的 Event 和记忆仍遵守新规则。
- 迁移不会自动删除旧数据库中 Snapshot 之后已经存在的孤立 Event。遇到这种原有不一致仍明确报错，由开发者选择恢复副本，禁止静默忽略或猜测状态。

这保证旧开发数据不会因升级被破坏，同时所有新建历史都具备可验证的完整因果链。

## 8. 模型调用身份

每次 `ModelCallRecord` 除现有字段外，必须从原始 `ModelDecisionRequest` 复制：

- `schemaVersion` -> `protocol_schema_version`
- `decisionCycleId` -> `decision_cycle_id`
- `pluginLockHash` -> `plugin_lock_hash`
- `decisionReason.code` -> `decision_reason_code`

`requestId` 继续作为模型调用和 `decision_requested` / `decision_accepted` Event 之间的连接键。

`model_calls.status = accepted` 只表示模型回答通过网关格式校验、选择了程序实际提供的选项并被送入 Worker；世界是否真正采用该决定，以同一 `requestId` 的 `decision_accepted` Event 为准。Worker 拒绝过期或身份不匹配的结果时，必须保留拒绝诊断，不能把调用记录当成已经执行的世界事实。

数据库不保存：

- 完整 system/user 提示词。
- HTTP 授权头或密钥。
- 可从请求身份和 Event 还原的完整世界数据。
- 未经显式诊断开关要求的供应商原始响应包。

模型失败、重试和拒绝继续通过 `requestId`、`retryOfRequestId`、技术失败记录和 Event 追踪。

## 9. 跨包依赖规则

`.dependency-cruiser.cjs` 必须同时约束源码路径和 `@god-sim/*` 包别名。允许的工作区依赖如下：

| 模块 | 允许依赖的工作区模块 |
| --- | --- |
| `packages/protocol` | 无 |
| `packages/plugin-sdk` | `protocol` |
| `packages/simulation` | `protocol`、`plugin-sdk` |
| `packages/cognition` | `protocol`、`plugin-sdk` |
| `packages/timeline` | `protocol` |
| `packages/model-gateway` | `protocol` |
| `packages/sqlite-store` | `protocol`、`timeline` |
| `apps/web` | `protocol` |
| `apps/simulation-worker` | `protocol`、`plugin-sdk`、`simulation`、`cognition` |
| `apps/local-server` | `protocol`、`timeline`、`model-gateway`、`sqlite-store` |
| `plugins/*` | `protocol`、`plugin-sdk`，以及插件自身内部文件 |

另外继续强制：

- `packages` 和 `plugins` 不能导入 `apps`。
- `packages` 不能导入任何具体官方插件。
- 所有跨包导入只能走包根导出，禁止 `@god-sim/foo/src/...` 等深层导入。
- 禁止循环依赖。
- 测试可以组合多个公开包，但生产源码不能借测试路径绕过规则。

依赖检查必须作为根目录验证命令的一部分。任何新增包都要先在这张允许表中确定位置，不能只在出错后临时放宽规则。

## 10. 错误处理

### 10.1 插件协议错误

- 自动通行交互不存在：插件加载失败。
- `canStart` 或效果返回值不符合 Schema：进入 `TECHNICALLY_BLOCKED`。
- 自动通行交互完成后仍挡路：形成正常、可感知的动作失败，先自动重规划；它不是技术错误。
- 插件返回未约定原因码：原因码按普通字符串记录，不要求核心认识，但仍必须满足长度和字符边界校验。

### 10.2 因果完整性错误

- 知识或记忆引用不存在的 Event：技术阻塞。
- Event 序列断裂、父序列错误或重复 ID 对应不同内容：技术阻塞。
- 严格 Snapshot 与 Event 尾序列不一致：技术阻塞。

开发日志必须写出世界 ID、检查点 ID、期望序列和实际序列，但不写模型密钥或完整提示词。

### 10.3 关闭与崩溃

- 正常关闭必须等待最终检查点提交和 Writer flush 完成。
- 正常关闭写入失败时不能伪装成已经安全保存；界面和日志显示失败，并允许重试。
- Worker、Host 或机器意外退出时，重新启动只加载最后一个完整检查点。

## 11. 测试与验收

### 11.1 插件边界测试

- 使用一个不带 `door` 标签、状态字段也不叫 `open` / `locked` 的测试通行物，证明程序能够自动交互并通过。
- 自动交互被插件拒绝后，角色形成通用通行阻碍、重新寻路；无路时才请求思考。
- 官方门仍能自动打开；锁门仍先尝试其他路线，不提前泄露锁定事实。
- `packages/simulation` 生产代码中不存在对 `door` 标签、`open` 字段、`locked` 字段和 `locked_door` 原因的规则判断。
- 插件声明不存在的自动通行交互时加载失败。

### 11.2 因果测试

- 新世界首个 Snapshot 中每条初始记忆和初始知识都能在首个 Event 批次中找到来源。
- 第一次看到静态物件时产生真实 `perception_recorded` Event，不再拼接伪 Event ID。
- 第一次看到其他角色及其位置时同样产生真实 `perception_recorded` Event。
- 视觉状态没有变化时不重复形成同一记忆。
- 身体阈值记忆引用对应的 `agent_need_changed` Event。
- 自动通行失败和普通目标交互失败都形成记忆，并引用对应的 `action_failed` Event。
- 场景结束后遍历 Snapshot 中全部知识和记忆引用，数据库中缺失数量必须为 0。
- 旧 Snapshot 仍能恢复，但被明确识别为 legacy，不会通过严格历史检查冒充新格式。

### 11.3 原子检查点测试

- 在 Event 插入后、Snapshot 插入前注入数据库失败，事务结束后两者都不存在。
- 玩家重试同一个检查点后，Event 和 Snapshot 各保存一次且内容一致。
- 重复提交相同检查点成功，提交相同序列但不同内容失败。
- 进入思考时，检查点确认前模型 Provider 不会被调用。
- 放行时，检查点确认前世界 tick 不增加。
- 正常关闭等待最终检查点完成。
- 新格式数据库不存在“最大 Event 序列大于最新 Snapshot 尾序列”的状态。

### 11.4 模型与迁移测试

- 成功、失败和重试的模型记录都保存协议版本、决策周期、插件锁和决策原因码。
- 模型记录可通过 `requestId` 找到对应的 `decision_requested` Event；被世界采用时还能找到 `decision_accepted` Event。
- `002` 迁移可以在旧数据库和已经迁移的数据库上安全执行。
- 迁移不改变旧 Event、Snapshot、模型调用和技术失败行。

### 11.5 依赖与完整回归

- 为每个禁止方向提供至少一个依赖检查夹具或配置级断言。
- 运行 lint、TypeScript 类型检查、依赖图检查、全部 Vitest、生产构建和 Playwright。
- 使用固定模型重跑完整基础循环。
- 使用本地免费真实模型做一次手动冒烟，确认等待模型期间世界 tick 不变。
- 对真实冒烟数据库执行 SQLite integrity check 和知识/记忆 Event 引用审计。

## 12. 预期修改位置

本轮主要修改以下边界，避免无关重构：

- `packages/plugin-sdk/src/object/`：自动通行公共能力。
- `plugins/spatial-objects/src/objects/door/`：门插件声明能力，私有状态保持在插件内。
- `packages/simulation/src/execution/`：通用物件动作、路径规划和本地恢复。
- `packages/simulation/src/perception/`：Event 驱动的知识和记忆形成。
- `packages/simulation/src/engine/`：Event 缓冲、检查点及严格因果检查。
- `packages/protocol/src/events/`、`ipc/`、`world/`：新 Event、检查点消息和 Snapshot 兼容版本。
- `packages/timeline/`、`packages/sqlite-store/`：检查点接口、原子事务和迁移。
- `apps/simulation-worker/`、`apps/local-server/`：检查点握手、持久化屏障和模型身份记录。
- `.dependency-cruiser.cjs`：完整允许矩阵。
- 相邻单元测试以及 `tests/scenarios`、`tests/integration`、`tests/e2e` 中受影响的回归测试。

## 13. 完成条件

只有同时满足以下条件，本轮架构加固才算完成：

1. 核心不再依赖任何官方家具的标签、交互 ID 或私有状态字段。
2. 门的现有基础玩法和有限认知行为保持不变。
3. 新世界中所有知识和记忆来源都能追溯到真实 Event，动作失败稳定进入角色记忆。
4. Event 与 Snapshot 只能通过一个 SQLite 事务形成检查点，故障注入无法制造半份新历史。
5. 模型调用可以明确定位到世界、角色、世界版本、决策周期、协议、插件锁和思考原因。
6. 旧数据库经过非破坏迁移后仍可检查和恢复兼容 Snapshot；原有不一致不会被静默掩盖。
7. 跨包非法依赖会在自动检查中失败。
8. 全部自动验证、固定模型场景、浏览器端到端测试和真实模型冒烟通过。
