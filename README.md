# dsh-topic-trail — 会话工作线索悬浮窗

给 DeepSeek Harness（dsh）的 Web UI 加一个**可拖动的悬浮窗**：实时把用户与 AI 正在做的工作提炼成「话题（线索）」和「进度步骤」，点开话题能看到一步一步都干了什么。数据来自 dsh 正在用的那套 DeepSeek API（走 `ctx.llm`，即 web 页面里配置的模型与凭据），用专门的话题总结提示词做语义提炼。

## 效果

- 右下角悬浮窗，头部可拖动，**收起为圆形小球后同样可拖动**（拖动时不会误触展开）；位置记忆在 `localStorage`。
- **右键开始总结**：在导航下拉里右键「全部工作区 / 任意工作区 / 任意会话」，或在任意线索卡片上右键，弹出「开始总结线索」菜单：
  - 右键工作区 → 批量总结该工作区下所有会话（未导入的会自动先导入，后台 2 路并发跑 LLM，响应立即返回并 toast 提示进度）；
  - 右键会话 → 总结该会话；
  - 右键全部工作区 → 总结所有工作区全部会话；
  - 右键合并线索卡片 → 总结它的全部来源会话。
- 悬浮窗里是一张张话题卡片：标题、一句话概括、状态（进行中/已完成）、步骤数、更新时间。
- **悬停动效展开**：每个线索默认只显示标题，鼠标移上去后描述（一句话概括 + 步骤数/AI 总结徽标/时间）平滑展开；点击卡片才展开步骤列表（会话视图）或来源会话（合并线索视图），两级交互互不干扰。
- **界面仿 dsh**：毛玻璃面板、圆角卡片、跟随 dsh 的深色设计语言（`#151517` 底、`#F9FAFB/#ADB2B8` 文字、强调蓝渐变、用户/助手/工具/推理四色步骤侧条、AI 总结徽标），头部带 ↻ 手动刷新与「—」收起按钮，全部动画 0.2–0.3s。
- 点开话题展开步骤列表：用户要求 / AI 做了什么 / 工具调用（含成功/失败/执行中）按时间顺序排列。
- **选择旧对话导入**：头部下拉选择任意会话（含历史会话），对还没有线索的历史会话点「导入此会话」，插件会从 dsh 的会话日志（`ctx.sessionQuery`）回溯重建话题与进度，并用 DeepSeek 提炼。
- **工作区线索网络（三级）**：dsh 会话按「工作目录」分组存放，插件据此组织成
  `全部工作区 → 工作区 → 会话` 三级导航：
  - 最顶层「全部工作区」：跨工作区的相似线索合并到一个收起栏；
  - 每个「工作区」：该工作目录下所有会话的相似话题自动合并成工作区线索（可展开下钻到来源会话）；
  - 每个「会话」：原始话题 + 步骤。
  - **悬停提示**：鼠标悬停任意线索，显示它来自哪个工作区 / 哪个会话；点开合并线索可下钻到对应会话并展开该话题。
- 每 3 秒自动刷新；会话中途和之后都能随时查看「刚才干了什么」。

## 安装

在 `harness-v2` 目录下执行（使用仓库内 pnpm）：

```powershell
# 先把仓库内 pnpm 加进 PATH
$env:PATH = "C:\Users\d\.dsh\harness-v2\tools\node_modules\.bin;" + $env:PATH
$env:DSH_HOME = "C:\Users\d\.dsh\harness-v2"

dsh plugin --profile web add file:C:/Users/d/.dsh/harness-v2/plugins/dsh-topic-trail
```

然后重启 `dsh-web.cmd`。验证已进插件树：

```powershell
dsh --profile web --dump-config | Select-String -Pattern "topic-trail" -Context 1,2
```

## 配置（cordis.patch.yml）

| 配置项 | 默认 | 说明 |
|---|---|---|
| `summarize` | `auto` | `auto`：规则即时生成步骤 + turn 结束后用 DeepSeek LLM 总结替换（失败自动回退规则）；`llm`：只靠 LLM 总结；`rule`：纯规则、零模型调用 |
| `provider` / `model` | 自动 | 留空时自动探测 dsh 已配置的 DeepSeek 路由与默认模型；也可显式指定，如 `deepseek` / `deepseek-chat` |
| `pollMs` | 3000 | 前端刷新间隔（毫秒） |
| `bufferSize` | 40 | 送入 LLM 总结的最近事件条数上限 |

## 结构

```
dsh-topic-trail/
├── package.json          # dsh.bundle.patch + dsh.client(web) 声明
├── cordis.patch.yml      # 插件挂载层（含配置）
├── lib/
│   ├── index.js          # Host 半：session/event 监听、LLM 总结、webServer 路由、持久化
│   └── client.js         # Client 半：shell.overlay 悬浮窗（ModuleLoader bundle 格式，零构建）
└── README.md
```

### 数据流

```
dsh 会话事件（user/message · assistant/message · tool/call · tool/result · turn/end）
        │  ctx.on('session/event')
        ▼
Host 缓冲（每会话 ≤ bufferSize 条，持久化到 <DSH_HOME>/data/topic-trail/<sessionId>.json）
        │  turn/end 后防抖 1.5s
        ▼
DeepSeek LLM（ctx.llm.stream + 「话题总结 skill」提示词）→ 结构化 JSON 话题/步骤
        │  失败 → 保持规则模式即时结果
        ▼
GET /plugins/topic-trail/snapshot  ──轮询 3s──►  Client 悬浮窗（shell.overlay）
```

### Host 侧路由

- `GET /plugins/topic-trail/snapshot` — 全部已提炼会话的话题/步骤快照 + 工作区线索网络（`workspaces.all` / `workspaces.byId`）
- `GET /plugins/topic-trail/sessions` — 会话列表（来自 `ctx.sessionQuery`，含标题/是否有线索），供下拉选择
- `POST /plugins/topic-trail/import` — 导入旧会话：从 dsh 会话日志重建话题/步骤（body: `{"sessionId":"..."}`，兼容 `session-<uuid>` 与裸 `<uuid>` 两种 id 格式）
- `POST /plugins/topic-trail/summarize` — 手动触发 LLM 总结。body 支持：`{"sessionId":"..."}`（单会话）、`{"sessionIds":["...","..."]}`（多会话）、`{"workspaceId":"<工作区key>"}`（整个工作区，未导入会话自动先导入）或 `{"workspaceId":"__all__"}`（全部工作区）。批量总结为异步：响应立即返回 `{ok, targets, sessions}`，导入与 LLM 总结在后台 2 路并发推进。

## 说明与限制

- 话题/步骤 id 基于会话事件序号（seq）生成，LLM 重总结后 id 保持稳定，前端 diff 平滑。
- 持久化文件位于 `harness-v2/data/topic-trail/`，重启后自动恢复；`buffer`（LLM 输入）不持久化，重启后 LLM 总结基于新的实时事件；长会话导入时 buffer 会**均匀采样**（最多 `bufferSize` 条），让 LLM 看到整体脉络而非只看会话尾部。
- 导入旧会话时，规则模式基于全部历史事件生成步骤（O(n) 即时完成），LLM 总结基于采样事件精修。
- LLM 总结失败（未配置模型、网络错误、输出非法 JSON）会静默回退到规则模式，悬浮窗仍能看到实时步骤；错误详情写 `data/topic-trail/llm-error.log`。
- **LLM 通道**：走 dsh 已配置的 `ctx.llm`（默认 `deepseek-official` + `deepseek-v4-flash`），总结请求关闭思考链（`reasoningEffort: off`）以直接输出；若 web 的 DeepSeek API key 失效，请在「模型设置」重新填写（注意环境变量里不要带多余引号）。
- 工作区线索按标题相似度合并（bigram Jaccard，规则聚类）；同一会话内相似话题也可合并；工作区/会话来源逐条列出，前端可下钻。
- 会话下拉默认选中最近有线索的会话；当前活跃会话会随实时事件自动更新。
- 后续可扩展：话题之间的关联关系（在 LLM 提示词中输出 `links` 并在前端绘制连线）、合并线索的 LLM 级语义聚类。
- 开发：`lib/` 源码修改后需同步到已安装副本（pnpm 对 `file:` 依赖是复制安装）：
  ```powershell
  Copy-Item plugins\dsh-topic-trail\lib\*.js profiles\web\node_modules\dsh-topic-trail\lib\ -Force
  ```
  离线自测：`node plugins\dsh-topic-trail\.verify.mjs`（在 `profiles/web/node_modules/dsh-topic-trail/` 下运行）；工作区网络单测：`node plugins\dsh-topic-trail\.test-workspace.mjs`（同上）。
