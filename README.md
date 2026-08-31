# God Simulation

God Simulation 是一个完全本地运行的角色模拟游戏。模型只负责角色选择高层目标；世界时间、寻路、开门、感知、冲突、家具效果和保存都由确定性的 TypeScript 程序处理。

当前仓库完成的是第一个可玩里程碑：Alice 与 Bob 可以在住宅中行动，使用冰箱和马桶，在实际感知到目标冲突或身体需求后重新思考。角色思考期间整个世界暂停，模型响应时间不会偷偷推进世界。

## 环境要求

- Node.js 24 或更高版本
- pnpm 10.34.5
- Chromium 系浏览器

安装依赖：

```powershell
pnpm install
```

## 本地启动

默认使用项目根目录下、不会被 Git 提交的 `free_model.local`：

```dotenv
BASE_URL=https://模型服务地址/v1
API_KEY=你的本地密钥
MODEL=模型标识
MODEL_TIMEOUT_MS=120000
```

`BASE_URL` 可以写到兼容服务的 `/v1`，程序会自动补全 `/chat/completions`。OpenRouter 也可以写成 `https://openrouter.ai/api`，程序会补成 `/api/v1/chat/completions`。不要把密钥写进源码、README、日志或测试文件。

启动浏览器端与本地主程序：

```powershell
pnpm dev
```

打开 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)。本地主程序默认监听 `http://127.0.0.1:4317`，模拟逻辑运行在独立进程中。

正常关闭时会把最后的完整世界快照写入 SQLite；下次使用同一个 `GOD_SIM_DATABASE` 启动时会继续该世界。快照中的地图或插件锁与当前配置不一致时，程序会明确拒绝恢复。要从新地图或新插件状态开始，请为 `GOD_SIM_DATABASE` 指定一个新的文件路径，旧时间线不会被自动删除或覆盖。

不调用模型、只检查游戏和界面时，可以使用固定决策器：

```powershell
$env:GOD_SIM_DECISION_PROVIDER="fixed"
pnpm dev
```

固定决策器默认让角色等待，适合本地开发；完整冲突、内急与重试场景由 E2E 测试的确定性决策器驱动。

## 当前玩法

- 左侧选择 Alice 或 Bob；也可以直接点击地图里的角色与家具。
- 右侧查看角色当前目标、动作、内急感觉、感知和即时记忆。
- 世界因角色思考暂停后，底部的“放行世界”会在所有必要决策准备完成时启用；也可以按空格放行。
- 关闭右上角“决策审查”后，必要决策全部准备好时会自动继续。
- 模型请求失败时，底部会显示角色、错误类别、请求 ID 和错误消息；“重试”只重试对应请求。

## 常用配置

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `GOD_SIM_DECISION_PROVIDER` | `openrouter` | `openrouter` 使用本地模型配置；`fixed` 使用固定决策器 |
| `GOD_SIM_MODEL_CONFIG` | `free_model.local` | 模型配置文件路径 |
| `GOD_SIM_REVIEW_REQUIRED` | `true` | 初始是否要求玩家放行 |
| `GOD_SIM_WORLD` | `content/worlds/starter-home/world.json` | 世界定义文件 |
| `GOD_SIM_DATABASE` | `data/god-simulation.sqlite` | SQLite 时间线数据库 |
| `GOD_SIM_LOG` | `data/logs/local-server.ndjson` | 本地开发日志 |
| `GOD_SIM_PORT` | `4317` | 本地主程序端口 |
| `GOD_SIM_DETERMINISTIC_SEED` | `1` | 确定性随机种子 |

## 验证

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

第一次运行浏览器测试前安装测试专用 Chromium：

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

E2E 会构建浏览器端，并为冰箱冲突、内急与马桶、审查开关、模型失败重试分别启动隔离的本地世界。测试数据写入系统临时目录并在结束时清理，不会使用 `free_model.local`。

## 代码边界

- `apps/web`：只读世界视图与玩家命令，不持有可写世界事实。
- `apps/local-server`：浏览器连接、模型请求、日志和 SQLite 保存。
- `apps/simulation-worker`：独立模拟进程，持有唯一可写世界。
- `packages/protocol`：跨进程命令、事件、快照和视图协议。
- `packages/simulation`：固定步进、动作、感知、冲突与需求系统。
- `packages/cognition`：把角色主观信息组装为提示词并校验模型目标。
- `plugins`：家具与角色定义、可观察状态、交互和素材。
- `content/worlds`：静态地图与实例配置。

依赖方向由自动检查约束，浏览器和插件不能绕过协议直接修改模拟进程的世界状态。

## 本里程碑暂不包含

- 完整的上帝编辑工具、强制意图和记忆编辑
- 时间线回滚、分支比较和历史编辑界面
- 社交关系、持续对话和多人会话
- 饥饿、疲劳、情绪等完整生活需求
- 长期记忆总结、遗忘、向量检索和 Reflection
- 地图编辑器、插件管理器、游戏内插件安装与热替换
- 插件安全沙箱和恶意插件兼容
- 桌面打包、云端服务、多人联机和移动端适配
- 完整动画、音效和最终美术打磨

这些功能被延期，但当前进程边界、协议版本、插件接口和状态归属已经为后续扩展保留位置。
