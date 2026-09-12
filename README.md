# dsh-topic-trail — 会话工作线索悬浮窗

> 用 dsh 写东西想到哪写到哪，写完回头一看——刚才到底干了啥？这个插件就是解决这个问题的。

给 DeepSeek Harness（dsh）的 Web UI 加一个**可拖动的悬浮窗**，实时把你和 AI 正在做的工作提炼成「话题（线索）」和「进度步骤」。点开话题能看到一步一步都干了什么，跨会话、跨工作区的工作脉络一目了然。

总结走 dsh 已配置的 DeepSeek 路由（`ctx.llm`），**不需要额外配 API key**。

**谁适合用**：多会话并行开发的人、长对话经常找不到之前决策的人、写完就忘自己干了啥的人、想给室友/同事分享工作进度的人。

---

## 30 秒快速上手

1. 安装插件（见下方「安装」），重启 dsh
2. 右下角出现「工作线索」悬浮窗，开始和 AI 对话
3. 对话过程中线索自动生成；点话题看步骤，点步骤跳转到对应对话位置

---

## 解决的痛点

| 痛点 | 插件怎么解决 |
|---|---|
| 想到哪写到哪，写完不知道自己干了啥 | 实时把会话活动提炼成话题+步骤，随时回看 |
| 长对话里找不到之前的某个决策 | 步骤按时间排列，**点击步骤直接跳转到对应对话位置**并自动滚动 |
| 多会话切换后忘记之前的进度 | 三级线索网络：全部工作区 → 工作区 → 会话，相似话题自动合并 |
| 工作区之间的工作脉络看不清 | 工作区级线索由下属会话的相似话题合并而成，可展开下钻到每个来源会话 |
| 手动整理太麻烦 | 右键「重新生成线索」一键总结；首次打开自动导入所有未归档会话 |
| 线索重复/拆分不合理 | 同一对话范围内**拖拽合并**，AI 自动找共同点、整理步骤和时间关系 |

---

## 特色功能

### 悬浮窗与交互
- **可拖动**：头部拖动面板，收起为圆形小球后也能拖动，位置记忆在 localStorage
- **悬停展开**：每个线索默认只显示标题，鼠标移上去后描述平滑展开（0.5s），点击才展开步骤列表
- **仿 dsh 深色 UI**：毛玻璃面板、圆角卡片、用户/助手/工具/推理四色步骤侧条，和 dsh 原生风格一致

### 三级线索网络
- **全部工作区**：跨工作区的相似线索合并到收起栏
- **工作区**：该工作区下所有会话的相似话题自动合并，可展开下钻到来源会话
- **会话**：原始话题 + 步骤明细
- 鼠标悬停任意线索，显示它来自哪个工作区/会话

### AI 总结与合并
- **右键重新生成线索**：右键全部工作区/工作区/会话/线索卡片，触发 LLM 重新总结
- **拖拽合并**：同一对话范围内把一条线索拖到另一条上，AI 找共同点、合并步骤并整理时间顺序；合并后锁定（🔒），不会被自动总结覆盖
- **从修改中学习**：你手动改过的线索会记录下来，下次 LLM 总结时参考你的偏好

### 跳转与定位
- **步骤点击跳转**：点开话题后点任意步骤，自动打开对应对话并滚动到该步骤发生的位置（多次重试 + 比例滚动兜底）

### 设置与性能
- **设置页集成**：dsh 设置里新增「任务线索」栏，可开关插件、切换对话时自动跟随、开关学习功能、调整总结方式和刷新间隔
- **首次自动导入**：第一次打开时后台慢慢加载所有未归档会话的线索，不截断线程
- **性能优化**：服务端快照缓存 + 前端 localStorage 秒开 + version 跳过重渲染 + 自适应轮询，不卡界面

---

## 安装

### 方法一：dsh plugin 命令（推荐）

```powershell
$env:PATH = "C:\Users\d\.dsh\harness-v2\tools\node_modules\.bin;" + $env:PATH
$env:DSH_HOME = "C:\Users\d\.dsh\harness-v2"
dsh plugin --profile web add file:C:/path/to/dsh-topic-trail
```

然后重启 dsh。

### 方法二：丢给你的 AI 助手

把这个仓库地址发给你的 AI 助手（豆包、Claude、ChatGPT 等），说：

> "帮我把 dsh-topic-trail 插件安装到我的 dsh 里，插件目录在 harness-v2/plugins/ 下，安装副本在 harness-v2/profiles/web/node_modules/ 下。"

AI 助手会帮你完成下载、复制、同步和重启。

### 验证

```powershell
dsh --profile web --dump-config | Select-String -Pattern "topic-trail"
```

---

## 使用方法

### 基本操作
1. 打开 dsh Web UI，右下角出现「工作线索」悬浮窗
2. 拖动头部移动位置；点「—」收起为小球，点小球展开
3. 头部下拉选择查看范围：**全部工作区** / 某个**工作区** / 某个**会话**
4. 鼠标悬停线索卡片查看描述；点击卡片展开步骤列表
5. 点任意步骤 → 自动跳转到对应对话并滚动到发生位置

### 右键菜单
- 右键导航里的工作区/会话 →「重新生成线索」：用 LLM 重新总结选中范围
- 右键线索卡片 → 重新生成该线索

### 拖拽合并
1. 确保在**会话级**视图（工作区级不支持拖拽合并）
2. 按住一条线索拖到另一条线索上
3. AI 自动分析两条线索的共同点，合并步骤并整理时间顺序
4. 合并后的线索带 🔒 标记，不会被后续自动总结覆盖

### 设置
dsh 设置 → 「任务线索」栏：

| 选项 | 说明 |
|---|---|
| 启用插件 | 全局开关，关闭后悬浮窗不显示 |
| 切换对话时跟随 | 切到新对话时自动把线索视图切到该对话（工作区级则切到该对话的工作区） |
| 从修改中学习 | 记录你手动改的线索，下次总结时参考 |
| 总结方式 | auto（规则+LLM）/ llm（纯LLM）/ rule（纯规则，零模型调用） |
| 刷新间隔 | 前端轮询快照的间隔（毫秒） |

---

## 项目结构

```
dsh-topic-trail/
├── package.json          # dsh.bundle.patch + dsh.client(web) 声明
├── cordis.patch.yml      # 插件挂载层 + 默认配置
├── lib/
│   ├── index.js          # Host 半：事件监听、LLM 总结、API 路由、持久化、工作区网络
│   └── client.js         # Client 半：shell.overlay 悬浮窗（零构建，ModuleLoader bundle）
├── .gitignore
└── README.md
```

### 数据流

```
dsh 会话事件（user/assistant/tool/turn-end）
        │  ctx.on('session/event')
        ▼
Host 缓冲（每会话 ≤40 条，持久化到 data/topic-trail/<sessionId>.json）
        │  turn/end 后防抖 1.5s
        ▼
DeepSeek LLM（ctx.llm.stream + 话题总结提示词）→ 结构化 JSON 话题/步骤
        │  失败 → 回退规则模式
        ▼
GET /plugins/topic-trail/snapshot  ──轮询──►  Client 悬浮窗
```

### Host 侧 API

| 路由 | 方法 | 说明 |
|---|---|---|
| `/plugins/topic-trail/snapshot` | GET | 全部话题/步骤快照 + 工作区线索网络 + version |
| `/plugins/topic-trail/sessions` | GET | 会话列表（含标题/是否有线索） |
| `/plugins/topic-trail/config` | GET/POST | 读取/更新运行时配置 |
| `/plugins/topic-trail/import` | POST | 导入旧会话，从日志重建话题 |
| `/plugins/topic-trail/summarize` | POST | 手动触发 LLM 总结（异步，支持单会话/多会话/工作区/全部） |
| `/plugins/topic-trail/merge` | POST | 拖拽合并两条线索（AI 找共同点） |

---

## 更改与更新

### 修改源码后
`lib/` 是源码，pnpm 对 `file:` 依赖是**复制安装**，改完必须同步到已安装副本：

```powershell
Copy-Item lib\*.js ..\..\profiles\web\node_modules\dsh-topic-trail\lib\ -Force
```

- 改 `lib/index.js`（host）→ **重启 dsh** 生效
- 改 `lib/client.js`（前端）→ **浏览器刷新**即可

### 数据文件
运行时数据在 `harness-v2/data/topic-trail/`：
- `<sessionId>.json` — 每个会话的线索、步骤、缓冲、修改日志
- `config.json` — 运行时配置（设置页改动持久化到这里）
- `llm-error.log` — LLM 总结失败日志

这些**不要提交到 git**（已在 .gitignore 排除）。

### 更新到新版本
```powershell
cd harness-v2
git -C plugins/dsh-topic-trail pull   # 如果是 git clone 的
# 或重新下载覆盖 lib/
Copy-Item plugins\dsh-topic-trail\lib\*.js profiles\web\node_modules\dsh-topic-trail\lib\ -Force
# 重启 dsh
```

---

## 配置（cordis.patch.yml）

| 配置项 | 默认 | 说明 |
|---|---|---|
| `summarize` | `auto` | auto：规则即时生成 + turn 结束后 LLM 总结替换；llm：纯 LLM；rule：纯规则零调用 |
| `provider` / `model` | 自动 | 留空自动探测 dsh 已配置的 DeepSeek 路由；可显式指定 |
| `pollMs` | 3000 | 前端刷新间隔（毫秒） |
| `bufferSize` | 40 | 送入 LLM 总结的最近事件条数上限 |

---

## 常见问题

**Q：悬浮窗不显示？**
A：检查 dsh 设置 → 任务线索 → 「启用插件」是否打开；重启 dsh；查看控制台是否有 React 错误。

**Q：线索一直是空的？**
A：新会话需要等一轮对话结束（turn/end）后才会触发 LLM 总结；可以右键会话 →「重新生成线索」手动触发。

**Q：点击步骤跳转定位不准？**
A：dsh 用虚拟列表，目标消息可能不在 DOM 里。插件会先滚到底部触发加载，再按时间匹配，匹配不到时按步骤序号比例滚动，最后兜底底部。大部分情况能定位到大概位置。

**Q：拖拽合并不生效？**
A：拖拽合并仅在**会话级**视图可用，工作区级和全部工作区级不支持。确保你当前选中的是某个具体会话。

**Q：LLM 总结失败怎么办？**
A：检查 dsh 的 DeepSeek API key 是否有效（web 页面 → 模型设置）；失败会自动回退规则模式，错误详情写在 `data/topic-trail/llm-error.log`。

---

## 说明与限制

- 话题/步骤 id 基于会话事件序号生成，LLM 重总结后 id 保持稳定，前端 diff 平滑
- LLM 总结失败（未配置模型、网络错误、输出非法 JSON）静默回退规则模式
- 工作区线索按标题相似度合并（bigram Jaccard 聚类）；dsh 的工作区分组从 `localStorage['dsh.workspace.view.v5']` 读取，和 dsh 界面一致
- 合并后的线索锁定（🔒），防止被自动总结覆盖

---

## 📌 文档维护提醒

**每次新增/修改功能后，请同步更新本 README**，重点检查：

- [ ] 「特色功能」是否新增了条目
- [ ] 「使用方法」是否有新操作需要说明
- [ ] 「Host 侧 API」表格是否有新增/变更路由
- [ ] 「配置」表格是否有新增配置项
- [ ] 「常见问题」是否需要补充
- [ ] 「项目结构」是否有新增文件

模型迭代快，文档和代码不同步会让使用者困惑。改完代码顺手改 README，保持一致。
