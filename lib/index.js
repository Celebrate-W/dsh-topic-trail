/**
 * dsh-topic-trail — 会话工作线索（Host 半）
 *
 * 监听 session/event，把用户与 AI 的活动实时提炼为「话题（线索）+ 进度步骤」：
 *  - 默认 auto 模式：规则模式即时生成步骤（零成本、立即可见），turn 结束后
 *    防抖调用 DeepSeek LLM（走 dsh 已配置的 ctx.llm 路由，即 web 页面里配置
 *    的那套 DeepSeek API），用「话题总结 skill」提示词做语义总结并替换话题
 *    结构；LLM 失败自动保持规则结果。
 *  - llm 模式：只依赖 LLM 总结；rule 模式：只走规则。
 *
 * 数据经 webServer 以 JSON 暴露给浏览器侧悬浮窗：
 *   GET  /plugins/topic-trail/snapshot   → 全部会话的话题/步骤快照
 *   POST /plugins/topic-trail/summarize  → 手动触发某会话的 LLM 总结
 *
 * 持久化：<DSH_HOME>/data/topic-trail/<sessionId>.json（防抖原子写，重启恢复）。
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import os from 'node:os'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-topic-trail'
export const inject = ['webServer', 'llm', 'sessionQuery']

// ── 常量 ────────────────────────────────────────────────────────────────────

const ROUTE_BASE = '/plugins/topic-trail'
const SAVE_DEBOUNCE_MS = 300
const SUMMARIZE_DEBOUNCE_MS = 1500
const TOPIC_TITLE_MAX = 14
const SUMMARY_MAX = 48
const STEP_TITLE_MAX = 32
const STEP_DETAIL_MAX = 200
const DEFAULT_BUFFER_SIZE = 40
const SESSIONS_ROOT_NAME = 'sessions'
const TITLE_CACHE_TTL_MS = 30000

/** 用户短确认/跟进句：并入当前话题，而不是新开话题。 */
const FOLLOW_UP_RE = /^(好的|好|可以|行|嗯|哦|啊|呀|吧|呢|啦|喽|喔|噢|ok|okay|yes|yeah|yep|对|对的|对啊|对呀|没错|是的|是啊|是呀|谢谢|感谢|多谢|收到|知道了|了解|明白|清楚|没问题|ok了|行吧|好吧|嗯好|好的好的|好嘞|好的呢|试|试试|试一下|试试看|开始|来吧|来|整|搞|弄|做|干|然后呢|然后|接着|接下来|继续|继续做|接着做|继续说|接着说|再说|再说说|再讲讲|详细点|具体点|展开|展开说说|详细说说|给个方案|给方案|给个思路|给思路|再想|再想想|再想想看|还有呢|还有|还有吗|还有别的|别的|其他|其他的|换个|换一下|改一下|改改|修正|优化|优化一下|调整|调整一下|完善|完善一下|补充|补充一下|增加|添加|加上|去掉|删掉|删除|移除|不是|不对|不是这样|不对不对|等等|等一下|等下|先|先这样|先这样吧|对了|顺便|顺便问一下|另外|此外|还有个问题|还有一件事|这个|那个|这个问题|那个问题|怎么|为什么|如何|为啥|咋|怎么回事|什么情况)[。！!？?，,.\s~…]*$/i
/** 文本块类型里值得记录的块。 */
const TEXT_BLOCK_TYPES = new Set(['text', 'reasoning'])

// ── 小工具 ──────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString()
}

/** 压缩空白、截断到 max 字符（按 code point）。 */
export function summarize(text, max = 80) {
  const cleaned = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max)}…`
}

/** 取首句（前 max 字）。 */
function firstSentence(text, max = 60) {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max)}…`
}

/** 从消息 content blocks 提取文本（可按类型过滤：text / reasoning）。 */
function extractBlocksText(content, maxPerBlock = 400, types = TEXT_BLOCK_TYPES) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (types.has(block.type) && typeof block.text === 'string' && block.text.length > 0) {
      parts.push(block.text.slice(0, maxPerBlock))
    }
  }
  return parts.join('\n')
}

/** 是否直接用户消息（排除 agent 注入 / skill / 指令提示等）。 */
function isDirectUserMessage(message) {
  const kind = message?.source?.kind
  return kind === 'user' || kind === 'goal'
}

/** 工具参数 JSON → 一行摘要。 */
function summarizeArgs(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || parsed === undefined) return ''
    const text = JSON.stringify(parsed)
    return summarize(text, 60)
  } catch {
    return summarize(raw, 60)
  }
}

/** 解析 LLM 输出中的 JSON（容忍 ```json 围栏与首尾杂质）。 */
export function parseTopicsJson(raw) {
  if (typeof raw !== 'string') return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return Array.isArray(parsed?.topics) ? parsed.topics : null
  } catch {
    return null
  }
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

// ── LLM 总结 skill（提示词） ────────────────────────────────────────────────

const SUMMARIZE_SYSTEM_PROMPT = [
  '你是一个「会话工作线索」总结器。用户与 AI 在 DeepSeek Harness 中协作，你会收到一段按时间顺序排列的会话活动记录（每条以 [seq=N] 开头，含用户消息、AI 回复、工具调用）。',
  '请把它提炼成「话题（线索）」结构：话题 = 一条独立的工作意图/任务线（如"修复登录接口报错"、"写季度周报"、"调研竞品"）。一段会话通常有多条线索交叉推进，必须按工作方向拆分成多个话题，不要把所有工作合并成一个。',
  '【话题拆分核心要求】',
  '- 如果会话中涉及多个不同的工作方向、任务、主题、功能模块、项目或问题，必须拆分成多个话题，每个话题对应一个明确的工作方向。',
  '- 禁止使用"进行中的工作"、"工作"、"任务"、"对话"等泛化标题，每个话题的标题必须具体描述该话题的工作内容（≤12字）。',
  '- 如果某个话题的步骤超过 30 步，检查是否可以进一步拆分成更细的子话题。',
  '- 话题数量通常在 2-10 个之间，取决于会话的复杂度；只有当整个会话确实只围绕一个单一任务时，才输出 1 个话题。',
  '输出必须是纯 JSON，禁止 markdown 代码块与任何解释文字。结构：',
  '{"topics":[{"title":"≤12字话题标题","summary":"一句话概括≤40字","status":"active或done","steps":[{"kind":"user|assistant|tool|reasoning","title":"这一步具体干了什么≤30字","toolName":"仅tool步骤填工具名，如bash/edit/web_search/read；否则省略该字段","status":"ok|error|interrupted，仅tool/assistant步骤可填","seq":原样保留的数字序号}]}]}',
  '提炼规则：',
  '1. 步骤忠实反映每一步实际动作，按时间顺序排列，不要省略工具调用，不要编造记录里没有的动作。',
  '2. 话题 title 用口语化短语，必须具体描述工作内容，禁止泛化标题；summary 概括这条线索的目标。',
  '3. status：当前正在推进的线索标 active（可以有多条 active），已完成或被搁置的标 done。',
  '4. 每条 step 的 seq 必须原样保留记录里的数字，用于前端定位进度。',
  '5. 如果记录为空，返回 {"topics":[]}。',
  '6. 输入中标注为 [LOCKED] 的话题是用户手动整理/合并的，禁止修改、拆分或合并它们，输出时必须原样保留（包含其 id、title、summary、steps、locked=true）。',
  '7. 输入中标注为 [已有话题参考] 的是上一次总结生成的话题分类。请参考它们的划分方式和命名风格：',
  '   - 尽量保留已有话题，不要随意删除或重命名；如果某条线索仍在进行，更新其步骤和状态即可。',
  '   - 当记录中出现了全新的工作方向、与所有已有话题都不相关时，创建新话题。',
  '   - 如果已有话题的工作已经完成，将 status 改为 done，但保留该话题。',
  '   - 如果已有话题过于宽泛（步骤超过 50 步或涵盖多个不相关方向），可以拆分成更细的子话题。',
  '8. 如果输入末尾有「用户修改历史」段落，这些记录反映了用户的话题划分偏好（如用户习惯把哪些类型的话题合并、偏好的命名风格），请参考此逻辑划分新话题，但不要复述历史。',
  '9. 输出语言（title/summary/steps.title）必须与输入消息的主要语言保持一致：输入以英文为主则输出英文，以中文为主则输出中文。',
].join('\n')

const MERGE_SYSTEM_PROMPT = [
  '你是一个「工作线索合并器」。用户会给你两条同一会话中的工作线索（话题），每条包含标题、描述和按时间排列的步骤。',
  '请分析两条线索的关联，将它们合并为一条线索：',
  '1. 找到两条线索的共同点、因果关系或先后顺序',
  '2. 生成一个合并后的标题（≤12字，概括整体工作）',
  '3. 合并步骤：去重、按时间排序、整理因果/先后关系，保留关键信息，不要编造没有的动作',
  '4. 如果两条线索完全无关，返回 {"canMerge":false,"reason":"简短说明为什么无关"}',
  '输出必须是纯 JSON，禁止 markdown 代码块与任何解释文字。结构：',
  '{"canMerge":true,"title":"≤12字","summary":"≤40字概括","steps":[{"kind":"user|assistant|tool|reasoning","title":"这一步具体干了什么≤30字","toolName":"仅tool步骤填工具名否则省略","status":"ok|error|interrupted仅tool/assistant可填","seq":数字序号}]}',
  '输出语言（title/summary/steps.title）必须与输入线索的主要语言保持一致。',
].join('\n')
function renderRecords(trail) {
  // 从 buffer 取最近的记录
  const fromBuffer = trail.buffer.map((rec) => {
    switch (rec.type) {
      case 'user':
        return { seq: rec.seq, text: `[seq=${rec.seq}] user: ${rec.text}` }
      case 'assistant':
        return { seq: rec.seq, text: `[seq=${rec.seq}] assistant: ${rec.text}` }
      case 'reasoning':
        return { seq: rec.seq, text: `[seq=${rec.seq}] reasoning: ${rec.text}` }
      case 'tool':
        return { seq: rec.seq, text: `[seq=${rec.seq}] tool: ${rec.toolName}(${rec.args})` }
      default:
        return { seq: rec.seq, text: `[seq=${rec.seq}] ${rec.type}` }
    }
  })
  // 从已有 topics 的步骤中提取更早的记录（补充 buffer 中没有的早期工作）
  const bufferSeqs = new Set(fromBuffer.map((r) => r.seq))
  const fromTopics = []
  for (const topic of trail.topics || []) {
    if (topic.locked) continue // locked 话题不参与重建，由 summarizeWithLlm 单独注入
    for (const step of topic.steps || []) {
      if (bufferSeqs.has(step.seq)) continue // 去重：buffer 中已有的不重复添加
      if (step.kind === 'user') fromTopics.push({ seq: step.seq, text: `[seq=${step.seq}] user: ${step.detail}` })
      else if (step.kind === 'assistant') fromTopics.push({ seq: step.seq, text: `[seq=${step.seq}] assistant: ${step.detail}` })
      else if (step.kind === 'reasoning') fromTopics.push({ seq: step.seq, text: `[seq=${step.seq}] reasoning: ${step.detail}` })
      else if (step.kind === 'tool') fromTopics.push({ seq: step.seq, text: `[seq=${step.seq}] tool: ${step.toolName}(${step.detail})` })
    }
  }
  // 合并：buffer 最近记录 + topics 早期记录，按 seq 排序
  const all = [...fromBuffer, ...fromTopics].sort((a, b) => a.seq - b.seq)
  if (all.length > 0) return all.map((r) => r.text)
  return []
}

/** 从事件提取 buffer 记录数组（user 消息 / assistant 正文 / reasoning / 工具调用）。
 *  advanceCounter=true 时对缺失 seq 的事件推进 trail.counter（实时流）；false 用于导入采样（seq 取事件自带）。 */
function recordsFromEvent(trail, event, advanceCounter) {
  const seq = Number.isInteger(event.seq) && event.seq >= 0 ? event.seq : (advanceCounter ? ++trail.counter : 0)
  const kind = event.type
  if (kind === 'user/message') {
    const text = extractBlocksText(event.data?.message?.content)
    if (!text || !isDirectUserMessage(event.data?.message)) return []
    return [{ seq, type: 'user', text }]
  }
  if (kind === 'assistant/message') {
    const text = extractBlocksText(event.data?.message?.content, 400, new Set(['text']))
    const reasoning = extractBlocksText(event.data?.message?.content, 200, new Set(['reasoning']))
    const recs = []
    if (text) recs.push({ seq, type: 'assistant', text })
    if (reasoning) recs.push({ seq, type: 'reasoning', text: reasoning })
    return recs
  }
  if (kind === 'tool/call') {
    const { name: toolName, arguments: args } = event.data ?? {}
    if (!toolName) return []
    return [{ seq, type: 'tool', toolName, args: summarizeArgs(args) }]
  }
  return []
}

/** 从事件序列中按序号均匀采样至多 n 条（保序），让 LLM 看到长会话的整体脉络。 */
function sampleEvents(events, n) {
  const valid = []
  for (const event of events) {
    if (event && typeof event.type === 'string') valid.push(event)
  }
  if (valid.length <= n) return valid
  const out = []
  for (let i = 0; i < n; i++) {
    out.push(valid[Math.floor((i * (valid.length - 1)) / Math.max(n - 1, 1))])
  }
  return out
}

// ── Trail 状态 ──────────────────────────────────────────────────────────────

/** 创建空 Trail。 */
function createTrail(sessionId) {
  return {
    sessionId,
    topics: [],
    buffer: [],
    counter: 0,
    lastRuleSeq: 0,
    pendingToolCalls: new Map(),
    summarizeTimer: undefined,
    saveTimer: undefined,
    summarizing: false,
    updatedAt: nowIso(),
    persist: false,
  }
}

function currentTopic(trail) {
  for (let i = trail.topics.length - 1; i >= 0; i -= 1) {
    const topic = trail.topics[i]
    if (topic.status === 'active') return topic
  }
  return undefined
}

function closeActiveTopics(trail) {
  for (const topic of trail.topics) {
    if (topic.status === 'active') topic.status = 'done'
  }
}

function createTopic(title, seq) {
  const time = nowIso()
  return {
    id: `t${seq}`,
    title: title || '未命名线索',
    summary: '',
    status: 'active',
    steps: [],
    createdAt: time,
    updatedAt: time,
    source: 'rule',
  }
}

/** 生成话题内唯一的步骤 id：同 seq 多记录（正文+推理等）追加序号后缀，保持首次 id 稳定。 */
function nextUniqueStepId(existingIds, seq) {
  const base = `s${seq}`
  if (!existingIds.has(base)) {
    existingIds.add(base)
    return base
  }
  let n = 2
  while (existingIds.has(`${base}-${n}`)) n += 1
  const id = `${base}-${n}`
  existingIds.add(id)
  return id
}

function pushStep(topic, input) {
  const time = nowIso()
  // 步骤 id 唯一化：同一 seq 可能产生多条记录（如 assistant 正文 + 推理），
  // 首次 id（s<seq>）保持稳定，后续记录追加序号后缀，避免前端 React key / 步骤跳转冲突。
  const seenIds = new Set(topic.steps.map((s) => s.id))
  const id = nextUniqueStepId(seenIds, input.seq)
  const step = {
    id,
    seq: input.seq,
    kind: input.kind,
    title: summarize(input.title, STEP_TITLE_MAX),
    detail: summarize(input.detail, STEP_DETAIL_MAX),
    time,
  }
  if (input.toolName) step.toolName = input.toolName
  if (input.status) step.status = input.status
  if (input.text) step.text = input.text
  topic.steps.push(step)
  topic.updatedAt = time
  return step
}

/** 规则模式：把一条记录派生为话题/步骤（即时、零成本），返回新步骤。 */
function appendRuleStep(trail, input) {
  let topic = currentTopic(trail)
  const isUser = input.kind === 'user'

  if (isUser) {
    const trimmedText = typeof input.text === 'string' ? input.text.trim() : ''
    const followUp = FOLLOW_UP_RE.test(trimmedText)
    // 短消息判定：少于 10 个字符且不含明显新指令关键词时，视为追问/补充
    const isShortFollowUp = !followUp && trimmedText.length > 0 && trimmedText.length < 10 &&
      !/^(我要|我想|帮我|请|如何|怎么|为什么|能不能|可以不|是否|需要|要求|需求|目标|任务|项目|功能|模块|页面|接口|api|数据库|表|字段|算法|逻辑|架构|设计|方案|计划|步骤|流程|测试|部署|上线|发布|版本|更新|升级|修复|bug|错误|问题|报错|异常|性能|优化|重构|代码|文件|目录|路径|配置|环境|依赖|安装|卸载|启动|停止|重启|运行|执行|调用|请求|响应|返回|参数|变量|函数|方法|类|对象|数组|字符串|数字|布尔|循环|条件|判断|分支|递归|迭代|排序|搜索|过滤|映射|去重|合并|拆分|转换|格式化|解析|序列化|反序列化|加密|解密|编码|解码|压缩|解压|缓存|队列|栈|链表|树|图|堆|哈希|集合|映射表|正则|匹配|替换|分割|连接|截取|拼接|遍历|迭代|回调|异步|同步|并发|并行|串行|阻塞|非阻塞|事件|监听|触发|发射|订阅|发布|观察者|中介者|单例|工厂|建造者|原型|适配器|桥接|组合|装饰器|外观|享元|代理|责任链|命令|解释器|迭代器|中介者|备忘录|观察者|状态|策略|模板方法|访问者)/.test(trimmedText)
    const effectiveFollowUp = followUp || isShortFollowUp
    if (!topic) {
      // 尚无任何线索 → 开新话题
      topic = createTopic(firstSentence(input.title, TOPIC_TITLE_MAX), input.seq)
      trail.topics.push(topic)
    } else if (!effectiveFollowUp) {
      // 明显的新指令 → 旧线索收尾，开新话题
      topic.status = 'done'
      topic = createTopic(firstSentence(input.title, TOPIC_TITLE_MAX), input.seq)
      trail.topics.push(topic)
    } else if (topic.steps.length === 1 && topic.steps[0].kind === 'user') {
      // 连续补述/修正：更新话题标题而不是另起
      topic.title = firstSentence(input.title, TOPIC_TITLE_MAX)
    }
  } else if (!topic) {
    // 工具/AI 活动先于任何用户消息（理论上罕见）→ 兜底开一个活动线索
    topic = createTopic('进行中的工作', input.seq)
    trail.topics.push(topic)
  }

  const step = pushStep(topic, input)
  trail.updatedAt = topic.updatedAt
  return step
}

// ── 持久化 ──────────────────────────────────────────────────────────────────

function dataDir() {
  const home = process.env.DSH_HOME || join(os.homedir(), '.dsh')
  return join(home, 'data', 'topic-trail')
}

/** 运行时配置（用户可经设置页改写并持久化到 data/topic-trail/config.json）。 */
function runtimeConfigPath() {
  return join(dataDir(), 'config.json')
}

async function saveRuntimeConfig(obj) {
  await mkdir(dataDir(), { recursive: true })
  await writeFile(runtimeConfigPath(), JSON.stringify(obj, null, 2), 'utf8')
}

/**
 * 同步读取运行时配置。必须同步：apply() 之后 4 秒首启 bootstrap 就会开跑
 * （见文件末尾 setTimeout），异步读会与它抢跑，导致设置页里选的 rule 模式
 * 被忽略、仍然调用模型。
 */
function loadRuntimeConfig() {
  try {
    const parsed = JSON.parse(readFileSync(runtimeConfigPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 会话标题缓存（工作区线索的来源展示用），由 /sessions 与 snapshot 低频刷新。 */
let titleCache = new Map()
let titleCacheFetchedAt = 0
let sessionCwdCache = new Map() // sessionId -> cwd（用于按真实工作目录分组，区分同路径下的不同 profile）

/** LLM 总结错误日志路径（stderr 经 PowerShell 重定向会被截断，改用文件）。 */
function trailErrorLogPath() {
  return join(dataDir(), 'llm-error.log')
}

// ── 工作区结构记忆（Workspace Profile） ─────────────────────────────────────
// 每个工作区一份：粗略结构描述 + 适用的总结规律。首次全看工作区生成，后续增量更新。
const workspaceProfiles = new Map() // wsId -> profile
let workspaceProfilesLoaded = false

function workspaceProfilesPath() {
  return join(dataDir(), 'workspace-profiles.json')
}

function loadWorkspaceProfiles() {
  if (workspaceProfilesLoaded) return
  workspaceProfilesLoaded = true
  try {
    const parsed = JSON.parse(readFileSync(workspaceProfilesPath(), 'utf8'))
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'object') workspaceProfiles.set(k, v)
      }
    }
  } catch { /* 首次无文件 */ }
}

let wsProfileSaveTimer = null
function saveWorkspaceProfiles() {
  if (wsProfileSaveTimer) clearTimeout(wsProfileSaveTimer)
  wsProfileSaveTimer = setTimeout(async () => {
    try {
      await mkdir(dataDir(), { recursive: true })
      const obj = {}
      for (const [k, v] of workspaceProfiles.entries()) obj[k] = v
      await writeFile(workspaceProfilesPath(), JSON.stringify(obj, null, 2), 'utf8')
    } catch { /* 保存失败不致命 */ }
  }, 500)
}

function getWorkspaceProfile(wsId) {
  loadWorkspaceProfiles()
  return workspaceProfiles.get(wsId) || null
}

function setWorkspaceProfile(wsId, profile) {
  loadWorkspaceProfiles()
  workspaceProfiles.set(wsId, { ...profile, id: wsId, updatedAt: nowIso() })
  saveWorkspaceProfiles()
}

/** 根据 sessionId 找到所属工作区（优先用 cwd 缓存，fallback 到目录扫描）。 */
function findWorkspaceBySession(sessionId) {
  const cwd = sessionCwdCache.get(sessionId)
  if (cwd) {
    const ws = listWorkspaces().find((w) => w.sessions.includes(sessionId))
    if (ws) return ws
  }
  return listWorkspaces().find((w) => w.sessions.includes(sessionId)) || null
}

const WS_PROFILE_SYSTEM_PROMPT = [
  '你是一个「项目结构分析器」。用户会给你一个工作区（项目目录）下多个会话的活动记录。',
  '请分析这个工作区的项目结构，并总结出适用于该工作区的「话题总结规律」。',
  '输出必须是纯 JSON，禁止 markdown 代码块与任何解释文字。结构：',
  '{"structure":"≤200字，粗略描述项目的技术栈、主要目录/模块、常见工作类型","summaryRules":"≤200字，总结这个工作区的话题划分规律：比如用户习惯按什么维度划分话题、常见的话题类型、命名风格、哪些操作应该合并为一条线索等"}',
].join('\n')

const WS_PROFILE_UPDATE_SYSTEM_PROMPT = [
  '你是一个「项目结构记忆更新器」。用户会给你一个工作区的现有结构记忆（structure + summaryRules），以及一段新的会话活动记录。',
  '请根据新会话内容，增量更新这个工作区的结构记忆和总结规律。如果新内容与现有记忆一致，保持不变；如果发现新的结构或规律，补充进去。',
  '输出必须是纯 JSON，禁止 markdown 代码块与任何解释文字。结构：',
  '{"structure":"≤200字，更新后的项目结构描述","summaryRules":"≤200字，更新后的总结规律"}',
].join('\n')

/** 首次全看工作区，生成结构记忆 + 总结规律。读取该工作区所有会话的记录（采样，避免 token 过多）。 */
async function generateWorkspaceProfile(ctx, wsId, wsTitle, config) {
  const { provider, model } = await resolveLlmTarget(ctx, config)
  const ws = listWorkspaces().find((w) => w.id === wsId)
  if (!ws) return null
  // 采样：最多取 5 个会话，每个会话最多取 30 条记录
  const sessionSamples = []
  const sids = ws.sessions.slice(0, 5)
  for (const sid of sids) {
    try {
      const snapshot = await readSessionById(ctx, sid)
      const events = Array.isArray(snapshot?.events) ? snapshot.events : []
      const sampled = events.slice(0, 30)
      const records = sampled.flatMap((e) => recordsFromEvent({ counter: 0 }, e, false)).filter(Boolean)
      if (records.length > 0) {
        sessionSamples.push(`[会话 ${sid.slice(0, 8)}]\n` + records.map((r) => `[seq=${r.seq}] ${r.kind}: ${summarize(r.text || r.detail || '', 100)}`).join('\n'))
      }
    } catch { /* 单个会话读不到跳过 */ }
  }
  if (sessionSamples.length === 0) return null
  const input = `工作区：${wsTitle}\n\n` + sessionSamples.join('\n\n')
  const userMessage = createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } })
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({ provider, model, messages: [userMessage], system: WS_PROFILE_SYSTEM_PROMPT, temperature: 0.3, maxTokens: 1024, reasoningEffort: 'off' })) {
    assembler.push(chunk)
  }
  if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') return null
  const text = assembler.blocks().filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('')
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    const profile = {
      id: wsId,
      path: wsTitle,
      structure: typeof parsed.structure === 'string' ? parsed.structure : '',
      summaryRules: typeof parsed.summaryRules === 'string' ? parsed.summaryRules : '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      analyzedSessions: sids,
      version: 1,
    }
    setWorkspaceProfile(wsId, profile)
    return profile
  } catch {
    return null
  }
}

/** 通过新会话内容增量更新工作区 profile。 */
async function updateWorkspaceProfileFromSession(ctx, wsId, wsTitle, trail, config) {
  const existing = getWorkspaceProfile(wsId)
  if (!existing) {
    // 没有 profile 时，延迟生成（不阻塞总结流程）
    void generateWorkspaceProfile(ctx, wsId, wsTitle, config).catch(() => {})
    return
  }
  // 增量更新：取最近的记录（最多 20 条）
  const records = renderRecords(trail).slice(-20)
  if (records.length === 0) return
  const { provider, model } = await resolveLlmTarget(ctx, config)
  const input = `现有结构记忆：\nstructure: ${existing.structure}\nsummaryRules: ${existing.summaryRules}\n\n新会话活动：\n${records.join('\n')}`
  const userMessage = createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } })
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({ provider, model, messages: [userMessage], system: WS_PROFILE_UPDATE_SYSTEM_PROMPT, temperature: 0.2, maxTokens: 800, reasoningEffort: 'off' })) {
    assembler.push(chunk)
  }
  if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') return
  const text = assembler.blocks().filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('')
  if (!text) return
  try {
    const parsed = JSON.parse(text)
    const updated = {
      ...existing,
      structure: typeof parsed.structure === 'string' && parsed.structure ? parsed.structure : existing.structure,
      summaryRules: typeof parsed.summaryRules === 'string' && parsed.summaryRules ? parsed.summaryRules : existing.summaryRules,
      updatedAt: nowIso(),
      version: (existing.version || 1) + 1,
    }
    setWorkspaceProfile(wsId, updated)
  } catch { /* 解析失败保持原样 */ }
}

function trailFile(sessionId) {
  return join(dataDir(), `${sessionId}.json`)
}

async function loadPersistedTrail(sessionId) {
  try {
    const text = await readFile(trailFile(sessionId), 'utf8')
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed?.topics)) return undefined
    return {
      ...createTrail(sessionId),
      topics: parsed.topics,
      counter: typeof parsed.counter === 'number' ? parsed.counter : 0,
      updatedAt: parsed.updatedAt ?? nowIso(),
      persist: true,
    }
  } catch {
    return undefined
  }
}

function serializeTrail(trail) {
  return JSON.stringify({
    version: 1,
    updatedAt: trail.updatedAt,
    counter: trail.counter,
    topics: trail.topics,
  })
}

function scheduleSave(trail) {
  if (!trail.persist) return
  clearTimeout(trail.saveTimer)
  trail.saveTimer = setTimeout(() => {
    void writeFile(trailFile(trail.sessionId), serializeTrail(trail), 'utf8').catch(() => {
      // 持久化失败不影响内存视图；下次保存重试
    })
  }, SAVE_DEBOUNCE_MS)
}

// ── LLM 总结 ────────────────────────────────────────────────────────────────

/** 解析 dsh 当前配置的 DeepSeek 路由：config 优先，否则探测。 */
async function resolveLlmTarget(ctx, config) {
  if (typeof config.provider === 'string' && config.provider && typeof config.model === 'string' && config.model) {
    return { provider: config.provider, model: config.model }
  }
  let providers
  try {
    providers = ctx.llm.listProviders()
  } catch {
    providers = []
  }
  const provider = typeof config.provider === 'string' && config.provider
    ? config.provider
    : providers[0]?.id
  if (!provider) throw new Error('no llm provider available (ctx.llm.listProviders empty)')
  let model = typeof config.model === 'string' && config.model ? config.model : undefined
  if (!model) {
    try {
      const models = await ctx.llm.listModels(provider)
      model = models[0]?.id
      console.error(`[dsh-topic-trail] resolved provider=${provider} models=${JSON.stringify((models || []).slice(0, 5).map((m) => m.id))}`)
    } catch {
      model = undefined
    }
  }
  if (!model) throw new Error(`no model resolved for provider "${provider}"`)
  return { provider, model }
}

/** 调 DeepSeek（ctx.llm）做一次话题总结，返回清洗后的 topics 数组或 null。 */
async function summarizeWithLlm(ctx, trail, config) {
  const { provider, model } = await resolveLlmTarget(ctx, config)
  let records = renderRecords(trail)
  // 记录数上限保护：超过 300 条时均匀采样，避免输入过长导致 LLM 上下文溢出
  const MAX_RECORDS = 300
  if (records.length > MAX_RECORDS) {
    const sampled = []
    for (let i = 0; i < MAX_RECORDS; i++) {
      sampled.push(records[Math.floor((i * (records.length - 1)) / Math.max(MAX_RECORDS - 1, 1))])
    }
    records = sampled
  }
  // preserveTopics 模式：非 locked 的已有话题允许 LLM 更新步骤，但不删除；locked 话题原样保留
  const preserveAll = config.preserveTopics === true
  // locked 话题：用户手动锁定的，必须原样保留，禁止修改
  const lockedTopics = Array.isArray(trail.topics)
    ? trail.topics.filter((t) => t.locked === true)
    : []
  // 非 locked 的已有话题作为参考输入（让 AI 参考之前的分类，尽量保留/更新而不是替换）
  const existingTopics = Array.isArray(trail.topics)
    ? trail.topics.filter((t) => t.locked !== true)
    : []
  // 工作区结构记忆：该会话所属工作区的 profile（结构描述 + 总结规律）
  const ws = trail.sessionId ? findWorkspaceBySession(trail.sessionId) : null
  const wsProfile = ws ? getWorkspaceProfile(ws.id) : null
  // 输入：时间线记录 + 工作区结构记忆 + locked 话题清单 + 已有话题参考 + 修改历史
  let inputText = records.join('\n')
  if (wsProfile && (wsProfile.structure || wsProfile.summaryRules)) {
    inputText += '\n\n[工作区结构记忆（该项目的技术栈与话题划分规律，请参考此规律划分话题）]\n'
    if (wsProfile.structure) inputText += `项目结构：${wsProfile.structure}\n`
    if (wsProfile.summaryRules) inputText += `总结规律：${wsProfile.summaryRules}`
  }
  if (lockedTopics.length > 0) {
    inputText += '\n\n[LOCKED 话题清单（用户手动整理/合并，必须原样保留 id/title/steps，禁止修改或拆分）]\n'
    inputText += JSON.stringify(lockedTopics.map((t) => ({
      id: t.id, title: t.title, summary: t.summary, status: t.status,
      steps: t.steps, locked: true,
    })), null, 2)
  }
  if (existingTopics.length > 0) {
    inputText += '\n\n[已有话题参考（上一次总结的分类，请参考划分方式和命名风格，尽量保留/更新，不要随意删除或重命名）]\n'
    inputText += JSON.stringify(existingTopics.map((t) => ({
      id: t.id, title: t.title, summary: t.summary, status: t.status,
      stepCount: Array.isArray(t.steps) ? t.steps.length : 0,
    })), null, 2)
  }
  if (config.learnFromModifications && Array.isArray(trail.modificationLog) && trail.modificationLog.length > 0) {
    inputText += '\n\n[用户修改历史（反映用户的话题划分偏好与命名风格，请参考此逻辑划分新话题，不要复述历史）]\n'
    inputText += JSON.stringify(trail.modificationLog.slice(-20), null, 2)
  }
  if (records.length === 0 && lockedTopics.length === 0 && existingTopics.length === 0) return []

  const userMessage = createUserMessage({
    content: [{ type: 'text', text: inputText }],
    source: { kind: 'user' },
  })

  const assembler = new BlockAssembler()
  // 根据记录数量动态调整 maxTokens：长会话需要更大的输出空间
  const recordCount = records.length
  const maxTokens = recordCount > 80 ? 16384 : recordCount > 40 ? 8192 : 4096
  // LLM 调用重试机制：最多 3 次，间隔 1 秒，处理网络/传输错误
  const MAX_RETRIES = 3
  let text = ''
  let lastError = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const attemptAssembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream({
        provider,
        model,
        messages: [userMessage],
        system: SUMMARIZE_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens,
        reasoningEffort: 'off',
      })) {
        attemptAssembler.push(chunk)
      }
      if (attemptAssembler.finish.kind === 'error' || attemptAssembler.finish.kind === 'aborted') {
        const failure = attemptAssembler.finish.failure
        let detail = ''
        try {
          if (failure && typeof failure === 'object') {
            detail = `${failure.code || ''} ${failure.message || ''}`.trim()
          } else if (failure) {
            detail = String(failure).slice(0, 300)
          }
        } catch {
          detail = ''
        }
        throw new Error(`llm stream ${attemptAssembler.finish.kind} (provider=${provider}, model=${model}) ${detail}`)
      }
      const blocks = attemptAssembler.blocks()
      text = blocks
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
      if (text) break // 成功获取输出，跳出重试
      lastError = new Error('llm returned empty text')
    } catch (err) {
      lastError = err
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 1000)) // 等待 1 秒后重试
      }
    }
  }
  if (!text) {
    // LLM 无输出但有 locked 话题：至少保留 locked 的
    if (lockedTopics.length > 0) return lockedTopics
    throw lastError || new Error('llm returned empty text after retries')
  }

  const rawTopics = parseTopicsJson(text)
  if (!rawTopics) {
    if (lockedTopics.length > 0) return lockedTopics
    throw new Error('llm output is not valid topics JSON')
  }
  const llmTopics = cleanLlmTopics(rawTopics)
  // 合并策略：
  // - locked 话题原样保留，禁止修改
  // - LLM 输出的话题与已有话题标题匹配 → 更新已有话题的步骤（用 LLM 输出替换），保留 id/createdAt
  // - 不匹配 → 作为新话题追加
  // - preserveTopics 模式：所有已有话题（非 locked）都保留，即使 LLM 没输出
  // - 非 preserveTopics 模式：LLM 输出的话题整体替换已有话题（除了 locked）
  const lockedIds = new Set(lockedTopics.map((t) => t.id))
  const existingNonLocked = (trail.topics || []).filter((t) => t.locked !== true)
  const existingTitleToTopic = new Map()
  for (const t of existingNonLocked) {
    if (t && t.title) existingTitleToTopic.set(String(t.title).trim().toLowerCase(), t)
  }
  const matchedExistingIds = new Set()
  const updatedTopics = []
  for (const t of llmTopics) {
    if (lockedIds.has(t.id)) continue
    const key = String(t.title || '').trim().toLowerCase()
    if (key && existingTitleToTopic.has(key)) {
      // 标题匹配：更新已有话题的步骤和状态，保留 id/createdAt
      const existing = existingTitleToTopic.get(key)
      matchedExistingIds.add(existing.id)
      updatedTopics.push({
        ...existing,
        title: t.title,
        summary: t.summary || existing.summary,
        status: t.status,
        steps: t.steps,
        updatedAt: new Date().toISOString(),
        source: 'llm-updated',
      })
    } else {
      // 不匹配：新话题
      updatedTopics.push(t)
    }
  }
  // 最终合并：优先级 locked > LLM 更新/新增 >（preserve 模式）未匹配已有话题；
  // 全程按 id 去重——LLM 新话题 id（t<首步seq>）可能与保留的旧话题 id 撞车，
  // 只保留先到者（locked 优先），杜绝同一会话内同 id 并存。
  const mergedResult = []
  const seenTopicIds = new Set()
  const pushUnique = (t) => {
    if (!t || seenTopicIds.has(t.id)) return
    seenTopicIds.add(t.id)
    mergedResult.push(t)
  }
  for (const t of lockedTopics) pushUnique(t)
  for (const t of updatedTopics) pushUnique(t)
  if (preserveAll) {
    // preserveTopics 模式：保留所有未被 LLM 匹配的已有话题（id 已被占用则丢弃旧版）
    const unmatchedExisting = existingNonLocked.filter((t) => !matchedExistingIds.has(t.id))
    for (const t of unmatchedExisting) pushUnique(t)
  }
  return mergedResult
}

/** 清洗 LLM 输出为内部 Topic 结构，id 基于 seq 保持稳定（同 seq 记录去重唯一）。 */
export function cleanLlmTopics(rawTopics) {
  const topics = []
  const topicIds = new Set()
  for (const raw of rawTopics) {
    if (!raw || typeof raw !== 'object') continue
    const steps = Array.isArray(raw.steps) ? raw.steps : []
    const cleanedSteps = []
    const stepIds = new Set()
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue
      const seq = Number.isInteger(step.seq) ? step.seq : 0
      if (seq <= 0) continue
      const kind = ['user', 'assistant', 'tool', 'reasoning'].includes(step.kind) ? step.kind : 'assistant'
      const cleaned = {
        id: nextUniqueStepId(stepIds, seq),
        seq,
        kind,
        title: summarize(step.title, STEP_TITLE_MAX),
        detail: summarize(step.title, STEP_DETAIL_MAX),
        time: nowIso(),
      }
      if (kind === 'tool' && typeof step.toolName === 'string' && step.toolName) {
        cleaned.toolName = summarize(step.toolName, 40)
      }
      if (kind === 'tool' && ['ok', 'error'].includes(step.status)) cleaned.status = step.status
      if (kind === 'assistant' && step.status === 'interrupted') cleaned.status = 'interrupted'
      cleanedSteps.push(cleaned)
    }
    // 不过滤无步骤话题：保留并标记，用户可手动编辑补充
    const hasSteps = cleanedSteps.length > 0
    const time = nowIso()
    let topicId = hasSteps ? `t${cleanedSteps[0].seq}` : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // 话题 id 唯一化：同一会话内禁止同 id 并存（保留首个，冲突者追加后缀）
    if (topicIds.has(topicId)) {
      let n = 2
      while (topicIds.has(`${topicId}-${n}`)) n += 1
      topicId = `${topicId}-${n}`
    }
    topicIds.add(topicId)
    topics.push({
      id: topicId,
      title: summarize(raw.title, TOPIC_TITLE_MAX) || '未命名线索',
      summary: summarize(raw.summary, SUMMARY_MAX),
      status: raw.status === 'active' ? 'active' : 'done',
      steps: cleanedSteps,
      createdAt: time,
      updatedAt: time,
      source: hasSteps ? 'llm' : 'llm-no-steps',
      locked: raw.locked === true,
    })
  }
  return topics
}

/** 解析 LLM 合并输出的 JSON（容忍围栏与首尾杂质）。 */
function parseMergeJson(raw) {
  if (typeof raw !== 'string') return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try { return JSON.parse(candidate.slice(start, end + 1)) } catch { return null }
}

/** 清洗 LLM 合并结果为内部 Topic 结构。 */
function cleanMergedTopic(raw, idA, idB) {
  if (!raw || typeof raw !== 'object' || raw.canMerge === false) return null
  const steps = Array.isArray(raw.steps) ? raw.steps : []
  const cleanedSteps = []
  const stepIds = new Set()
  let seqCounter = 0
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue
    seqCounter++
    const seq = Number.isInteger(step.seq) && step.seq > 0 ? step.seq : seqCounter
    const kind = ['user', 'assistant', 'tool', 'reasoning'].includes(step.kind) ? step.kind : 'assistant'
    const cleaned = {
      id: nextUniqueStepId(stepIds, seq),
      seq,
      kind,
      title: summarize(step.title, STEP_TITLE_MAX) || '步骤',
      detail: summarize(step.title || step.detail || '', STEP_DETAIL_MAX),
      time: nowIso(),
    }
    if (kind === 'tool' && typeof step.toolName === 'string' && step.toolName) {
      cleaned.toolName = summarize(step.toolName, 40)
    }
    if (kind === 'tool' && ['ok', 'error'].includes(step.status)) cleaned.status = step.status
    if (kind === 'assistant' && step.status === 'interrupted') cleaned.status = 'interrupted'
    cleanedSteps.push(cleaned)
  }
  const time = nowIso()
  return {
    id: `m${Date.now()}`,
    title: summarize(raw.title, TOPIC_TITLE_MAX) || '合并线索',
    summary: summarize(raw.summary, SUMMARY_MAX) || '',
    status: 'done',
    steps: cleanedSteps,
    createdAt: time,
    updatedAt: time,
    source: 'llm-merged',
    mergedFrom: [idA, idB],
    locked: true,
  }
}

/** 调 DeepSeek（ctx.llm）合并两条线索，返回清洗后的 Topic 或 null（无法合并）。 */
async function mergeTopicsWithLlm(ctx, topicA, topicB, config) {
  const { provider, model } = await resolveLlmTarget(ctx, config)
  const input = JSON.stringify({
    topicA: { title: topicA.title, summary: topicA.summary, steps: topicA.steps },
    topicB: { title: topicB.title, summary: topicB.summary, steps: topicB.steps },
  }, null, 2)
  const userMessage = createUserMessage({
    content: [{ type: 'text', text: input }],
    source: { kind: 'user' },
  })
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({
    provider, model,
    messages: [userMessage],
    system: MERGE_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 4096,
    reasoningEffort: 'off',
  })) {
    assembler.push(chunk)
  }
  if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
    throw new Error(`llm merge stream ${assembler.finish.kind}`)
  }
  const text = assembler.blocks()
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
  if (!text) throw new Error('llm merge returned empty text')
  const raw = parseMergeJson(text)
  if (!raw) throw new Error('llm merge output is not valid JSON')
  return cleanMergedTopic(raw, topicA.id, topicB.id)
}

/** 对某会话执行一次总结（带 in-flight 保护），失败回退规则结果。 */
async function summarizeTrail(ctx, trail, config, logger) {
  if (trail.summarizing) return
  trail.summarizing = true
  try {
    if (config.summarize === 'rule') return
    const topics = await summarizeWithLlm(ctx, trail, config)
    // LLM 清空时（记录为空）保持现状；否则整体替换（id 按 seq 稳定，前端 diff 平滑）
    if (Array.isArray(topics)) {
      if (topics.length > 0) trail.topics = topics
      trail.updatedAt = nowIso()
      scheduleSave(trail)
      // 总结成功后，增量更新工作区结构记忆（后台异步，不阻塞）
      if (config.workspaceMemory !== false && trail.sessionId) {
        const wsForUpdate = findWorkspaceBySession(trail.sessionId)
        if (wsForUpdate) {
          void updateWorkspaceProfileFromSession(ctx, wsForUpdate.id, wsForUpdate.title, trail, config).catch(() => {})
        }
      }
    }
  } catch (error) {
    // LLM 不可用/失败 → 保持规则模式的即时结果，静默降级；错误详情写文件（stderr 经 PowerShell 重定向会被截断）
    try {
      const errLine = `${new Date().toISOString()} ${String(error && error.stack || error)}\n`
      void import('node:fs').then((fs) => fs.promises.appendFile(trailErrorLogPath(), errLine, 'utf8').catch(() => {}))
    } catch {
      // ignore
    }
  } finally {
    trail.summarizing = false
  }
}

/** turn 结束后防抖触发 LLM 总结（auto/llm 模式）。 */
function scheduleSummarize(ctx, trail, config, logger) {
  if (config.summarize === 'rule') return
  clearTimeout(trail.summarizeTimer)
  trail.summarizeTimer = setTimeout(() => {
    void summarizeTrail(ctx, trail, config, logger)
  }, SUMMARIZE_DEBOUNCE_MS)
}

// ── 事件处理 ────────────────────────────────────────────────────────────────

function pushRecord(trail, rec) {
  trail.buffer.push(rec)
  if (trail.buffer.length > trail.maxBuffer) {
    trail.buffer = trail.buffer.slice(-trail.maxBuffer)
  }
  if (rec.seq >= trail.counter) trail.counter = rec.seq
}

function handleEvent(trail, event, ctx, config) {
  const kind = event.type

  if (kind === 'user/message' || kind === 'assistant/message') {
    const recs = recordsFromEvent(trail, event, true)
    for (const rec of recs) {
      pushRecord(trail, rec)
      if (rec.type === 'user') {
        appendRuleStep(trail, {
          seq: rec.seq,
          kind: 'user',
          title: rec.text,
          detail: rec.text,
          text: rec.text,
        })
      } else if (rec.type === 'assistant') {
        appendRuleStep(trail, {
          seq: rec.seq,
          kind: 'assistant',
          title: firstSentence(rec.text, 48),
          detail: rec.text,
          status: event.data?.interrupted ? 'interrupted' : 'done',
        })
      } else if (rec.type === 'reasoning') {
        appendRuleStep(trail, {
          seq: rec.seq,
          kind: 'reasoning',
          title: firstSentence(rec.text, 40),
          detail: rec.text,
        })
      }
    }
    return
  } else if (kind === 'tool/call') {
    const recs = recordsFromEvent(trail, event, true)
    if (recs.length === 0) return
    const rec = recs[0]
    const { callId } = event.data ?? {}
    pushRecord(trail, rec)
    const step = appendRuleStep(trail, {
      seq: rec.seq,
      kind: 'tool',
      toolName: rec.toolName,
      title: `${rec.toolName} ${rec.args}`,
      detail: `${rec.toolName}(${rec.args})`,
      status: 'running',
    })
    if (typeof callId === 'string' && callId) trail.pendingToolCalls.set(callId, step.id)
  } else if (kind === 'tool/result') {
    // 按 callId 配对更新状态；缺失时回退到最近的 running 步骤
    const failed = Boolean(event.data?.error)
    const callId = extractToolResultCallId(event.data?.message)
    const step = callId
      ? findStepById(trail, trail.pendingToolCalls.get(callId))
      : undefined
    const target = step ?? findLastRunningToolStep(trail)
    if (target) {
      target.status = failed ? 'error' : 'ok'
      target.updatedAt = nowIso()
    }
  } else if (kind === 'turn/end') {
    scheduleSummarize(ctx, trail, config, ctx.logger)
    return
  } else {
    return
  }
  trail.updatedAt = nowIso()
  scheduleSave(trail)
}

/** 从 tool/result 消息的 content blocks 提取 callId（tool-result block 携带）。 */
function extractToolResultCallId(message) {
  if (!Array.isArray(message?.content)) return undefined
  for (const block of message.content) {
    if (block?.type !== 'tool-result') continue
    const callId = block.callId ?? block.toolCallId
    if (typeof callId === 'string' && callId) return callId
  }
  return undefined
}

/** 按 id 在全部话题中找步骤。 */
function findStepById(trail, stepId) {
  if (typeof stepId !== 'string') return undefined
  for (const topic of trail.topics) {
    for (const step of topic.steps) {
      if (step.id === stepId) return step
    }
  }
  return undefined
}

/** 找最近一个仍为 running 的 tool 步骤（无 callId 时的回退）。 */
function findLastRunningToolStep(trail) {
  let last
  for (const topic of trail.topics) {
    for (const step of topic.steps) {
      if (step.kind === 'tool' && step.status === 'running') {
        if (!last || step.seq > last.seq) last = step
      }
    }
  }
  return last
}

/** 从历史会话完整事件日志重建 trail（全量重放，规则即时生成；LLM 精修走 scheduleSummarize）。 */
function replayTrailFromEvents(trail, events, ctx, cfg, fullImport = false) {
  trail.topics = []
  trail.buffer = []
  trail.pendingToolCalls = new Map()
  trail.counter = 0
  for (const event of events) {
    if (!event || typeof event.type !== 'string') continue
    handleEvent(trail, event, ctx, cfg)
  }
  // 均匀采样重建 buffer：长会话下 LLM 看到整体脉络，而非只看尾部 bufferSize 条
  // fullImport 模式（forceRegenerate）：使用全部事件构建 buffer，不截断，确保线索全面
  const sampledEvents = fullImport ? events.filter((e) => e && typeof e.type === 'string') : sampleEvents(events, trail.maxBuffer)
  trail.buffer = sampledEvents
    .flatMap((event) => recordsFromEvent(trail, event, false))
    .filter(Boolean)
    .sort((a, b) => a.seq - b.seq)
  trail.imported = true
  trail.updatedAt = nowIso()
  scheduleSave(trail)
  scheduleSummarize(ctx, trail, cfg, ctx.logger)
}

// ── HTTP 响应工具 ───────────────────────────────────────────────────────────

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ── apply ───────────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  const baseCfg = {
    summarize: ['auto', 'llm', 'rule'].includes(config?.summarize) ? config.summarize : 'auto',
    provider: typeof config?.provider === 'string' ? config.provider : undefined,
    model: typeof config?.model === 'string' ? config.model : undefined,
    maxBuffer: clampInt(config?.bufferSize, DEFAULT_BUFFER_SIZE, 10, 200),
    pollMs: clampInt(config?.pollMs, 3000, 800, 60000),
    followSession: config?.followSession !== false,
    learnFromModifications: config?.learnFromModifications !== false,
    enabled: config?.enabled !== false,
    workspaceViewMode: 'merge',
    eyeAnimation: false,
    preserveTopics: true,
    workspaceMemory: true,
  }
  // 运行时配置（设置页可改，持久化在 data/topic-trail/config.json，覆盖 cordis 默认值）。
  // loadRuntimeConfig() 是同步的：apply() 阶段就要拿到真实值，不能等异步读。
  let runtimeCfg = loadRuntimeConfig()
  /**
   * 生效配置 cfg：**始终是同一个对象引用**，内容随 runtimeCfg 变化就地刷新。
   * 事件热路径、首启 bootstrap、各路由都持有这份引用，所以设置页保存后立即生效，不必重启。
   * 旧实现是 apply() 时的一次性快照（const cfg = effectiveCfg()），异步读的运行时配置
   * 还没回来就拍了板：于是 summarize/maxBuffer 等设置项对 bootstrap 与事件处理全部失效——
   * 设置页选了 rule 也会照样调用模型，必须重启才生效。
   */
  const cfg = {}
  function refreshCfg() {
    const merged = {
      ...baseCfg,
      ...runtimeCfg,
      followSession: typeof runtimeCfg.followSession === 'boolean'
        ? runtimeCfg.followSession
        : baseCfg.followSession,
    }
    for (const key of Object.keys(cfg)) if (!(key in merged)) delete cfg[key]
    Object.assign(cfg, merged)
  }
  /** 运行时配置的唯一写入口：更新配置并立刻刷新生效配置。 */
  function setRuntimeCfg(next) {
    runtimeCfg = next && typeof next === 'object' ? next : {}
    refreshCfg()
  }
  /** 生效配置的独立副本（JSON 响应与 config patch 基线用，避免外部改动污染生效配置）。 */
  function effectiveCfg() {
    return { ...cfg }
  }
  refreshCfg()

  /** sessionId → Trail（含未持久化的活跃会话）。 */
  const trails = new Map()

  // 快照响应缓存：会话事件后 1s 内强制重算（保证实时），之后 5s 内直接命中缓存
  // （buildWorkspaceNetwork 较重，避免轮询/刷新在空闲时重复全量重算）
  let snapCache = null
  let snapCacheAt = 0
  let snapDirtyAt = 0
  // 数据版本：会话事件每处理一次 +1，随快照返回；client 凭此跳过未变化的重复渲染
  let dataVersion = 0

  // 首次打开自动补全：所有未归档且尚无线索的会话，后台逐个完整导入 + 慢速总结（不截断线程）
  const bootstrapState = { running: false, done: 0, total: 0 }

  // 会话列表缓存（5s TTL）：避免每次轮询都枚举全部会话+读标题
  let sessionListCache = null
  let sessionListCacheAt = 0

  /** 获取（或同步占位创建）某会话的 trail。持久化会话在启动恢复阶段已预载。 */
  function getTrail(sessionId) {
    let trail = trails.get(sessionId)
    if (!trail) {
      trail = { ...createTrail(sessionId), maxBuffer: cfg.maxBuffer, ready: true }
      trails.set(sessionId, trail)
    }
    return trail
  }

  // 事件监听：所有会话（含未 persist 的活跃会话）实时积累
  ctx.on('session/event', (session, event) => {
    if (effectiveCfg().enabled === false) return
    const sessionId = session?.id
    if (!sessionId || !event || typeof event.type !== 'string') return
    const trail = trails.get(sessionId)
    if (trail) {
      // 占位 trail（正在异步加载持久化）→ 事件进待处理队列；其余直接处理
      if (trail.ready === false) trail.pendingEvents.push(event)
      else { handleEvent(trail, event, ctx, cfg); snapDirtyAt = Date.now(); dataVersion++ }
    } else {
      // 首次遇到该会话：同步占位（当前事件一并入队），异步加载持久化状态后再冲刷队列
      const placeholder = { ...createTrail(sessionId), maxBuffer: cfg.maxBuffer, ready: false, pendingEvents: [event] }
      trails.set(sessionId, placeholder)
      void (async () => {
        let target = placeholder
        const persisted = await loadPersistedTrail(sessionId).catch(() => undefined)
        if (persisted) {
          persisted.maxBuffer = cfg.maxBuffer
          persisted.ready = true
          persisted.pendingEvents = placeholder.pendingEvents
          trails.set(sessionId, persisted)
          target = persisted
        } else {
          placeholder.ready = true
        }
        const pending = target.pendingEvents || []
        target.pendingEvents = []
        for (const ev of pending) { handleEvent(target, ev, ctx, cfg); snapDirtyAt = Date.now(); dataVersion++ }
      })()
    }
  })

  /**
   * 轻索引：快照只带话题元数据 + stepCount，不再携带 steps 数组。
   *
   * 为什么：真实数据（45 会话 / 15944 步）下每轮快照 5.18MB，而前端默认每 3 秒轮询一次——
   * 浏览器每次都要下载 5MB 并 JSON.parse 一遍，localStorage 的「刷新秒开」缓存也会因
   * 超出配额被 QuotaExceededError 静默丢弃。步骤改为按需分页加载（GET /steps），
   * 只在展开某条线索时才取它自己的步骤。
   */
  function lightTopics(topics) {
    return topics.map((t) => {
      const { steps, ...rest } = t
      return { ...rest, stepCount: Array.isArray(steps) ? steps.length : 0 }
    })
  }

  /** 步骤分页：单页上限，避免把 7000+ 步的巨型线索整包塞给前端。 */
  const STEPS_PAGE_DEFAULT = 200
  const STEPS_PAGE_MAX = 500

  // 步骤按需加载：GET /steps?sessionId=&topicId=&offset=&limit= → { steps, total, updatedAt, offset }
  const disposeSteps = ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/steps`,
    handler: async (req, res) => {
      try {
        let query
        try {
          query = new URL(req.url || '', 'http://localhost').searchParams
        } catch {
          query = new URLSearchParams(String(req.url || '').split('?')[1] || '')
        }
        const sessionId = query.get('sessionId') || ''
        const topicId = query.get('topicId') || ''
        const offset = clampInt(query.get('offset'), 0, 0, 1000000)
        const limit = clampInt(query.get('limit'), STEPS_PAGE_DEFAULT, 1, STEPS_PAGE_MAX)
        if (!sessionId || !topicId) {
          sendJson(res, 400, { error: 'sessionId and topicId required' })
          return
        }
        const trail = trails.get(sessionId)
        const topic = trail ? trail.topics.find((t) => t.id === topicId) : undefined
        if (!topic) {
          sendJson(res, 404, { error: 'topic not found' })
          return
        }
        const all = Array.isArray(topic.steps) ? topic.steps : []
        sendJson(res, 200, {
          sessionId,
          topicId,
          updatedAt: topic.updatedAt,
          total: all.length,
          offset,
          limit,
          steps: all.slice(offset, offset + limit),
        })
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message || error) })
      }
    },
  })

  // 快照路由：client 轮询（会话话题 + 工作区线索网络）
  const disposeSnapshot = ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/snapshot`,
    handler: async (req, res) => {
      try {
        // 快照缓存命中（事件后已过 1s 且 5s 内无重建）：直接返回上次构建结果
        if (snapCache && Date.now() - snapDirtyAt >= 1000 && Date.now() - snapCacheAt < 5000) {
          sendJson(res, 200, snapCache)
          return
        }
        const sessions = []
        const seenSids = new Set()
        const normId = (id) => String(id || '').replace(/^session-/, '')
        for (const trail of trails.values()) {
          if (trail.topics.length === 0) continue
          const nid = normId(trail.sessionId)
          if (seenSids.has(nid)) continue
          seenSids.add(nid)
          sessions.push({
            sessionId: trail.sessionId,
            title: titleCache.get(trail.sessionId) || '',
            cwd: sessionCwdCache.get(trail.sessionId) || '',
            updatedAt: trail.updatedAt,
            summarize: cfg.summarize,
            topics: lightTopics(trail.topics),
          })
        }
        // 补充没有线索的会话：用目录 mtime 作为 updatedAt，title 从标题缓存取，供前端排序与显示
        try {
          for (const ws of listWorkspaces()) {
            for (const sid of ws.sessions) {
              const nid = normId(sid)
              if (seenSids.has(nid)) continue
              seenSids.add(nid)
              sessions.push({
                sessionId: sid,
                title: titleCache.get(sid) || '',
                cwd: sessionCwdCache.get(sid) || '',
                updatedAt: getSessionMtime(ws.id, sid),
                summarize: cfg.summarize,
                topics: [],
              })
            }
          }
        } catch { /* 工作区扫描失败不致命 */ }
        // 工作区线索网络：刷新会话标题与 cwd 缓存
        // 首次（cwd 缓存为空）同步等待，确保 snapshot 里的会话有 cwd 字段；后续异步刷新不阻塞
        if (Date.now() - titleCacheFetchedAt > TITLE_CACHE_TTL_MS) {
          titleCacheFetchedAt = Date.now()
          const refreshCaches = async () => {
            try {
              if (!ctx.sessionQuery) return
              const records = await ctx.sessionQuery.listSessions()
              const ids = records.map((r) => r.header.id)
              const cwdNext = new Map()
              for (const r of records) {
                if (r.header?.cwd) {
                  const rid = r.header.id
                  cwdNext.set(rid, r.header.cwd)
                  // 兼容带/不带 session- 前缀
                  const norm = String(rid).replace(/^session-/, '')
                  cwdNext.set(norm, r.header.cwd)
                  cwdNext.set('session-' + norm, r.header.cwd)
                }
              }
              sessionCwdCache = cwdNext
              const next = new Map()
              try {
                const results = await ctx.sessionQuery.readTitleSnapshots(ids)
                for (const result of results) {
                  if (result?.status === 'fulfilled') {
                    const titleText = result.value?.title?.title
                    if (typeof titleText === 'string' && titleText) {
                      next.set(result.sessionId, titleText)
                      const norm = String(result.sessionId).replace(/^session-/, '')
                      next.set(norm, titleText)
                      next.set('session-' + norm, titleText)
                    }
                  }
                }
              } catch {
                // 标题不可用不致命
              }
              titleCache = next
            } catch {
              // 会话枚举失败不致命
            }
          }
          if (sessionCwdCache.size === 0) {
            await refreshCaches()
          } else {
            void refreshCaches()
          }
        }
        let workspaces = { all: { id: 'all', title: '全部工作区', topics: [] }, byId: {} }
        try {
          workspaces = buildWorkspaceNetwork(trails, titleCache)
        } catch (error) {
          console.error(`[dsh-topic-trail] workspace build failed: ${String(error && error.message || error)}`)
        }
        const payload = { sessions, workspaces, updatedAt: nowIso(), version: dataVersion, bootstrap: { ...bootstrapState } }
        snapCache = payload
        snapCacheAt = Date.now()
        sendJson(res, 200, payload)
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message || error) })
      }
    },
  })

  // 会话列表路由：悬浮窗的「选择旧对话」下拉数据源
  const disposeSessions = ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/sessions`,
    handler: async (req, res) => {
      try {
        if (!ctx.sessionQuery) {
          sendJson(res, 200, { sessions: [], error: 'sessionQuery unavailable' })
          return
        }
        // 会话列表缓存（5s TTL）：避免每次轮询都枚举全部会话+读标题
        if (sessionListCache && Date.now() - sessionListCacheAt < 5000) {
          sendJson(res, 200, sessionListCache)
          return
        }
        const records = await ctx.sessionQuery.listSessions()
        const ids = records.map((r) => r.header.id)
        let titleBySession = new Map()
        try {
          const results = await ctx.sessionQuery.readTitleSnapshots(ids)
          for (const result of results) {
            if (result?.status === 'fulfilled') {
              const titleText = result.value?.title?.title
              if (typeof titleText === 'string' && titleText) {
                titleBySession.set(result.sessionId, titleText)
              }
            }
          }
        } catch {
          // 标题读取失败不致命，回落为未命名会话
        }
        titleCache = titleBySession
        titleCacheFetchedAt = Date.now()
        const list = records.map((r) => {
          const id = r.header.id
          const trail = trails.get(id)
          return {
            sessionId: id,
            title: titleBySession.get(id) || '未命名会话',
            createdAt: r.header.createdAt ?? null,
            live: Boolean(r.live),
            persisted: Boolean(r.persisted),
            hasTrail: Boolean(trail && trail.topics.length > 0),
            trailUpdatedAt: trail?.updatedAt ?? null,
          }
        })
        const listPayload = { sessions: list }
        sessionListCache = listPayload
        sessionListCacheAt = Date.now()
        sendJson(res, 200, listPayload)
      } catch (error) {
        sendJson(res, 500, { error: String(error && error.message || error) })
      }
    },
  })

  // 配置路由：GET 返回当前生效配置；POST 以 patch 合并并持久化到 config.json
  const disposeConfig = ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/config`,
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          sendJson(res, 200, effectiveCfg())
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}')
        const next = { ...effectiveCfg(), ...body }
        if (typeof next.followSession !== 'boolean') next.followSession = true
        if (!['auto', 'llm', 'rule'].includes(next.summarize)) next.summarize = 'auto'
        next.maxBuffer = clampInt(next.maxBuffer, DEFAULT_BUFFER_SIZE, 10, 200)
        next.pollMs = clampInt(next.pollMs, 3000, 800, 60000)
        if (typeof next.learnFromModifications !== 'boolean') next.learnFromModifications = true
        if (typeof next.enabled !== 'boolean') next.enabled = true
        if (!['merge', 'bySession'].includes(next.workspaceViewMode)) next.workspaceViewMode = 'merge'
        if (typeof next.eyeAnimation !== 'boolean') next.eyeAnimation = false
        if (typeof next.preserveTopics !== 'boolean') next.preserveTopics = true
        if (typeof next.workspaceMemory !== 'boolean') next.workspaceMemory = true
        await saveRuntimeConfig(next)
        setRuntimeCfg(next)
        sendJson(res, 200, { ok: true, config: next })
      } catch (error) {
        sendJson(res, 400, { error: String(error && error.message || error) })
      }
    },
  })

  // 导入路由：把历史会话日志重建为话题/步骤
  const disposeImport = ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/import`,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        if (!ctx.sessionQuery) {
          sendJson(res, 503, { error: 'sessionQuery unavailable' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}')
        const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined
        if (!sessionId) {
          sendJson(res, 400, { error: 'sessionId required' })
          return
        }
        const snapshot = await readSessionById(ctx, sessionId)
        const events = Array.isArray(snapshot?.events) ? snapshot.events : []
        if (events.length === 0) {
          sendJson(res, 404, { error: 'session has no events' })
          return
        }
        const trail = getTrail(sessionId)
        // 若该会话仍在对历史持久化做异步加载，等待就绪再重建，避免队列冲刷覆盖导入结果
        while (trail.ready === false) {
          await new Promise((r) => setTimeout(r, 20))
        }
        trail.persist = true
        replayTrailFromEvents(trail, events, ctx, cfg)
        // 导入后 hasTrail 等状态已变化：让 /sessions 的 5s 缓存立即失效，
        // 否则前端下拉最多滞后 5 秒才反映「导入此会话」的结果
        sessionListCache = null
        sessionListCacheAt = 0
        sendJson(res, 200, {
          ok: true,
          eventCount: events.length,
          topics: trail.topics,
          summarize: cfg.summarize,
        })
      } catch (error) {
        sendJson(res, 400, { error: String(error && error.message || error) })
      }
    },
  })

  /**
   * 批量总结：把 scope 解析成目标会话列表，本地导入 + LLM 总结全部在后台推进，
   * 响应立即返回（导入/总结对大会话耗时较长，不能阻塞 HTTP 响应）。
   * scope: 'all' | 'ws:<key>' | sessionId | sessionIds[]
   */
  async function summarizeScope(scope, logger, forceRegenerate = false) {
    let targets = []
    if (Array.isArray(scope)) {
      for (const sid of scope) targets.push({ sessionId: sid })
    } else if (scope === 'all') {
      for (const ws of listWorkspaces()) {
        for (const sid of ws.sessions) {
          targets.push({ sessionId: sid, workspaceId: ws.id, workspaceTitle: ws.title })
        }
      }
    } else if (typeof scope === 'string' && scope.startsWith('ws:')) {
      const key = scope.slice(3)
      const ws = listWorkspaces().find((w) => w.id === key)
      if (!ws) throw new Error('workspace not found')
      for (const sid of ws.sessions) {
        targets.push({ sessionId: sid, workspaceId: ws.id, workspaceTitle: ws.title })
      }
    } else if (typeof scope === 'string' && scope) {
      targets = [{ sessionId: scope }]
    } else {
      throw new Error('invalid summarize scope')
    }
    if (targets.length === 0) return { ok: true, targets: 0, imported: 0, sessions: [] }

    // 后台：先本地导入所有还没有话题的会话（readSession 本地重放，快），再并发 LLM 总结（限 2 路）
    void (async () => {
      const imported = []
      for (const t of targets) {
        const trail = getTrail(t.sessionId)
        // forceRegenerate 模式：清除已有线索，重新完整导入
        if (forceRegenerate) {
          trail.topics = []
          trail.counter = 0
          trail.updatedAt = nowIso()
        }
        if (trail.topics.length > 0) continue
        try {
          const snapshot = await readSessionById(ctx, t.sessionId)
          const events = Array.isArray(snapshot?.events) ? snapshot.events : []
          if (events.length === 0) continue
          while (trail.ready === false) await new Promise((r) => setTimeout(r, 20))
          trail.persist = true
          replayTrailFromEvents(trail, events, ctx, cfg, forceRegenerate)
          // forceRegenerate：清除 replayTrailFromEvents 设置的延迟总结定时器，避免 1.5s 后重复总结去重
          if (forceRegenerate && trail.summarizeTimer) {
            clearTimeout(trail.summarizeTimer)
            trail.summarizeTimer = undefined
          }
          imported.push(t.sessionId)
        } catch {
          // 该会话读不到（日志缺失/损坏）就跳过，不阻塞整体
        }
      }
      if (imported.length > 0) {
        try { logger?.info?.(`[dsh-topic-trail] workspace summarize imported ${imported.length} sessions${forceRegenerate ? ' (force regenerate)' : ''}`) } catch { /* ignore */ }
      }
      let idx = 0
      const worker = async () => {
        while (idx < targets.length) {
          const t = targets[idx++]
          const trail = getTrail(t.sessionId)
          if (trail.topics.length === 0 && !forceRegenerate) continue
          // forceRegenerate：清空规则话题，让 LLM 从零开始总结，避免标题匹配去重导致线索丢失
          if (forceRegenerate) {
            trail.topics = []
            trail.counter = 0
          }
          try {
            await summarizeTrail(ctx, trail, cfg, logger)
          } catch {
            // 单个会话总结失败不阻塞队列
          }
        }
      }
      await Promise.all([worker(), worker()])
    })()

    return { ok: true, targets: targets.length, imported: 0, sessions: targets.map((t) => t.sessionId), forceRegenerate }
  }

  /**
   * 首次打开自动补全（bootstrap）：枚举全部会话，跳过已归档与已有线索的，
   * 对剩余会话逐个完整读取日志（不截断线程）重建话题，再用 LLM 慢速总结。
   * 串行导入 + 2 路并发总结，后台推进，进度写入 bootstrapState 随快照返回。
   */
  async function bootstrapUnarchived() {
    if (bootstrapState.running) return
    if (!ctx.sessionQuery) return
    bootstrapState.running = true
    bootstrapState.done = 0
    bootstrapState.total = 0
    try {
      // 阶段零：从磁盘预加载所有已有线索的会话（重启后 trails Map 为空，先恢复历史数据）
      try {
        const dataDirPath = dataDir()
        const files = await readdir(dataDirPath).catch(() => [])
        let preloaded = 0
        for (const f of files) {
          if (!f.endsWith('.json') || f === 'config.json' || f === 'workspace-profiles.json') continue
          const sid = f.replace(/\.json$/, '')
          if (trails.has(sid)) continue
          const persisted = await loadPersistedTrail(sid).catch(() => undefined)
          if (persisted && Array.isArray(persisted.topics) && persisted.topics.length > 0) {
            persisted.maxBuffer = cfg.maxBuffer
            persisted.ready = true
            trails.set(sid, persisted)
            preloaded++
          }
        }
        if (preloaded > 0) {
          try { ctx.logger?.info?.(`[dsh-topic-trail] preloaded ${preloaded} sessions from disk`) } catch { /* ignore */ }
        }
      } catch { /* 预加载失败不致命，后续 bootstrap 会重新导入 */ }

      const records = await ctx.sessionQuery.listSessions()
      const targets = []
      for (const r of records) {
        const id = r?.header?.id
        if (!id) continue
        // 跳过已归档会话（dsh 字段兼容 header/顶层两种位置）
        if (r?.header?.archived === true || r?.archived === true) continue
        const trail = trails.get(id)
        if (trail && trail.topics.length > 0) continue // 已有线索跳过（幂等）
        targets.push({ sessionId: id })
      }
      bootstrapState.total = targets.length
      if (targets.length === 0) return
      try { ctx.logger?.info?.(`[dsh-topic-trail] bootstrap: ${targets.length} unarchived sessions need topics`) } catch { /* ignore */ }

      // 阶段一：串行完整导入（readSession 本地重放，不截断）
      const imported = []
      for (const t of targets) {
        try {
          const snapshot = await readSessionById(ctx, t.sessionId)
          const events = Array.isArray(snapshot?.events) ? snapshot.events : []
          if (events.length === 0) continue
          const trail = getTrail(t.sessionId)
          while (trail.ready === false) await new Promise((r2) => setTimeout(r2, 20))
          trail.persist = true
          replayTrailFromEvents(trail, events, ctx, cfg)
          imported.push(t.sessionId)
          // 导入完成 → 让快照版本变化，前端轮询能看到线索陆续出现
          snapDirtyAt = Date.now()
          dataVersion++
        } catch {
          // 单个会话读不到（日志缺失/损坏）跳过，不阻塞整体
        }
      }
      if (imported.length > 0) {
        try { ctx.logger?.info?.(`[dsh-topic-trail] bootstrap imported ${imported.length} sessions`) } catch { /* ignore */ }
      }

      // 阶段二：2 路并发 LLM 慢速总结，每完成一个更新进度
      let idx = 0
      const worker = async () => {
        while (idx < targets.length) {
          const t = targets[idx++]
          const trail = trails.get(t.sessionId)
          if (!trail || trail.topics.length === 0) { bootstrapState.done++; continue }
          try {
            await summarizeTrail(ctx, trail, cfg, ctx.logger)
          } catch {
            // 单个会话总结失败不阻塞队列
          }
          bootstrapState.done++
          // 总结完成 → 快照版本变化，前端能看到进度推进
          snapDirtyAt = Date.now()
          dataVersion++
        }
      }
      await Promise.all([worker(), worker()])
      try { ctx.logger?.info?.(`[dsh-topic-trail] bootstrap finished: ${bootstrapState.done}/${bootstrapState.total}`) } catch { /* ignore */ }
    } catch (error) {
      try { ctx.logger?.error?.(`[dsh-topic-trail] bootstrap failed: ${String(error && error.message || error)}`) } catch { /* ignore */ }
    } finally {
      bootstrapState.running = false
    }
  }

  // 手动总结路由：支持单会话 / 多会话 / 工作区 / 全部
  const disposeSummarize = ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/summarize`,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}')
        const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined
        const sessionIds = Array.isArray(body.sessionIds)
          ? body.sessionIds.filter((v) => typeof v === 'string' && v)
          : undefined
        const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId ? body.workspaceId : undefined
        const scope = typeof body.scope === 'string' && body.scope ? body.scope : undefined
        const forceRegenerate = body.forceRegenerate === true
        if (workspaceId === '__all__') {
          const result = await summarizeScope('all', ctx.logger, forceRegenerate)
          sendJson(res, 200, result)
          return
        }
        if (workspaceId) {
          const result = await summarizeScope('ws:' + workspaceId, ctx.logger, forceRegenerate)
          sendJson(res, 200, result)
          return
        }
        if (Array.isArray(sessionIds) && sessionIds.length > 0) {
          const result = await summarizeScope(sessionIds, ctx.logger, forceRegenerate)
          sendJson(res, 200, result)
          return
        }
        if (sessionId) {
          const trail = await getTrail(sessionId)
          while (trail.ready === false) {
            await new Promise((r) => setTimeout(r, 20))
          }
          // forceRegenerate 模式：清除已有线索，重新完整导入
          if (forceRegenerate) {
            trail.topics = []
            trail.counter = 0
            trail.updatedAt = nowIso()
            try {
              const snapshot = await readSessionById(ctx, sessionId)
              const events = Array.isArray(snapshot?.events) ? snapshot.events : []
              if (events.length > 0) {
                trail.persist = true
                replayTrailFromEvents(trail, events, ctx, cfg, true)
                // 清除延迟总结定时器，避免 1.5s 后重复总结去重
                if (trail.summarizeTimer) {
                  clearTimeout(trail.summarizeTimer)
                  trail.summarizeTimer = undefined
                }
              }
            } catch { /* 导入失败不阻塞总结 */ }
            // 再次清空规则话题，让 LLM 从零开始总结，避免标题匹配去重导致线索丢失
            trail.topics = []
            trail.counter = 0
          }
          await summarizeTrail(ctx, trail, cfg, ctx.logger)
          sendJson(res, 200, { ok: true, topics: trail.topics, forceRegenerate })
          return
        }
        sendJson(res, 400, { error: 'sessionId / sessionIds / workspaceId / scope required' })
      } catch (error) {
        sendJson(res, 400, { error: String(error && error.message || error) })
      }
    },
  })

  // 合并线索路由：同一会话内把两条线索拖到一起，AI 找共同点并合并步骤/时间关系
  const disposeMerge = ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/merge`,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}')
        const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined
        const topicIdA = typeof body.topicIdA === 'string' && body.topicIdA ? body.topicIdA : undefined
        const topicIdB = typeof body.topicIdB === 'string' && body.topicIdB ? body.topicIdB : undefined
        if (!sessionId || !topicIdA || !topicIdB) {
          sendJson(res, 400, { error: 'sessionId, topicIdA, topicIdB required' })
          return
        }
        if (topicIdA === topicIdB) {
          sendJson(res, 400, { error: 'cannot merge a topic with itself' })
          return
        }
        const trail = await getTrail(sessionId)
        while (trail.ready === false) await new Promise((r) => setTimeout(r, 20))
        const topicA = trail.topics.find((t) => t.id === topicIdA)
        const topicB = trail.topics.find((t) => t.id === topicIdB)
        if (!topicA || !topicB) {
          sendJson(res, 404, { error: 'topic not found' })
          return
        }
        // rule 模式或 LLM 不可用时回退：简单拼接（按步骤 seq 排序），不调 AI
        let merged
        if (cfg.summarize === 'rule') {
          const allSteps = [...topicA.steps, ...topicB.steps].sort((a, b) => (a.seq || 0) - (b.seq || 0))
          // 拼接去重：两条话题可能含同 seq 步骤（正文+推理），保证合并后步骤 id 唯一
          const mergedStepIds = new Set()
          for (const st of allSteps) {
            if (!st || typeof st.id !== 'string') continue
            if (mergedStepIds.has(st.id)) {
              let n = 2
              while (mergedStepIds.has(`${st.id}-${n}`)) n += 1
              st.id = `${st.id}-${n}`
            }
            mergedStepIds.add(st.id)
          }
          merged = {
            id: `m${Date.now()}`,
            title: summarize(topicA.title + ' + ' + topicB.title, TOPIC_TITLE_MAX),
            summary: summarize((topicA.summary || '') + ' ' + (topicB.summary || ''), SUMMARY_MAX),
            status: 'done',
            steps: allSteps,
            createdAt: topicA.createdAt || topicB.createdAt || nowIso(),
            updatedAt: nowIso(),
            source: 'rule-merged',
            mergedFrom: [topicIdA, topicIdB],
            locked: true,
          }
        } else {
          merged = await mergeTopicsWithLlm(ctx, topicA, topicB, cfg)
          if (!merged) {
            sendJson(res, 200, { ok: false, cannotMerge: true, reason: 'AI 判断两条线索无关联，未合并' })
            return
          }
        }
        // 记录修改历史（供 LLM 学习用户划分偏好）
        if (!Array.isArray(trail.modificationLog)) trail.modificationLog = []
        trail.modificationLog.push({
          time: nowIso(),
          type: 'merge',
          from: [
            { id: topicIdA, title: topicA.title },
            { id: topicIdB, title: topicB.title },
          ],
          to: { id: merged.id, title: merged.title },
        })
        if (trail.modificationLog.length > 100) trail.modificationLog = trail.modificationLog.slice(-100)
        // 替换：删除原两条，加入合并结果
        trail.topics = trail.topics.filter((t) => t.id !== topicIdA && t.id !== topicIdB)
        trail.topics.push(merged)
        trail.updatedAt = nowIso()
        trail.persist = true
        scheduleSave(trail)
        snapDirtyAt = Date.now()
        dataVersion++
        sendJson(res, 200, { ok: true, topic: merged, removed: [topicIdA, topicIdB] })
      } catch (error) {
        sendJson(res, 400, { error: String(error && error.message || error) })
      }
    },
  })

  // 删除/编辑话题路由
  const disposeTopic = ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/topic`,
    handler: async (req, res) => {
      try {
        if (req.method !== 'DELETE' && req.method !== 'PATCH') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = JSON.parse((await readBody(req)) || '{}')
        const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined
        const topicId = typeof body.topicId === 'string' && body.topicId ? body.topicId : undefined
        if (!sessionId || !topicId) {
          sendJson(res, 400, { error: 'sessionId, topicId required' })
          return
        }
        const trail = await getTrail(sessionId)
        while (trail.ready === false) await new Promise((r) => setTimeout(r, 20))
        const idx = trail.topics.findIndex((t) => t.id === topicId)
        if (idx < 0) {
          sendJson(res, 404, { error: 'topic not found' })
          return
        }
        if (req.method === 'DELETE') {
          const removed = trail.topics.splice(idx, 1)[0]
          trail.updatedAt = nowIso()
          trail.persist = true
          scheduleSave(trail)
          snapDirtyAt = Date.now()
          dataVersion++
          sendJson(res, 200, { ok: true, removed: removed.id })
        } else {
          const patch = body.patch && typeof body.patch === 'object' ? body.patch : {}
          const topic = trail.topics[idx]
          if (typeof patch.title === 'string' && patch.title.trim()) topic.title = patch.title.trim()
          if (typeof patch.summary === 'string') topic.summary = patch.summary
          if (typeof patch.status === 'string' && ['active', 'done'].includes(patch.status)) topic.status = patch.status
          topic.updatedAt = nowIso()
          trail.updatedAt = nowIso()
          trail.persist = true
          scheduleSave(trail)
          snapDirtyAt = Date.now()
          dataVersion++
          sendJson(res, 200, { ok: true, topic: topic })
        }
      } catch (error) {
        sendJson(res, 400, { error: String(error && error.message || error) })
      }
    },
  })

  // 工作区结构记忆路由：查看/手动生成 profile
  const disposeWsProfile = ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_BASE}/workspace-profile`,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const wsId = url.searchParams.get('workspaceId') || ''
        if (req.method === 'GET') {
          loadWorkspaceProfiles()
          if (wsId) {
            const p = getWorkspaceProfile(wsId)
            sendJson(res, 200, { ok: true, profile: p })
          } else {
            const all = {}
            for (const [k, v] of workspaceProfiles.entries()) all[k] = v
            sendJson(res, 200, { ok: true, profiles: all })
          }
          return
        }
        if (req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}')
          const targetWsId = typeof body.workspaceId === 'string' ? body.workspaceId : wsId
          if (!targetWsId) { sendJson(res, 400, { error: 'workspaceId required' }); return }
          const ws = listWorkspaces().find((w) => w.id === targetWsId)
          if (!ws) { sendJson(res, 404, { error: 'workspace not found' }); return }
          // 后台生成，立即返回
          void generateWorkspaceProfile(ctx, ws.id, ws.title, cfg).catch(() => {})
          sendJson(res, 200, { ok: true, generating: true })
          return
        }
        sendJson(res, 405, { error: 'method not allowed' })
      } catch (error) {
        sendJson(res, 400, { error: String(error && error.message || error) })
      }
    },
  })

  void (async () => {
    try {
      await mkdir(dataDir(), { recursive: true })
      const files = await readdir(dataDir())
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const sessionId = file.slice(0, -'.json'.length)
        const trail = await loadPersistedTrail(sessionId)
        if (trail) {
          trail.maxBuffer = cfg.maxBuffer
          trails.set(sessionId, trail)
        }
      }
      // 数据版本跨重启递增：以恢复的 trail 数为基准（前端缓存 version 不同 → 必然拉新数据覆盖旧缓存）
      dataVersion = trails.size
    } catch {
      // 数据目录不可用不致命，仅失去跨重启恢复
    }
  })()

  // 首次打开自动补全：实例就绪后延迟启动（等持久化恢复完成、路由稳定），后台慢慢生成
  setTimeout(() => {
    void bootstrapUnarchived()
  }, 4000)

  // 卸载清理：路由与计时器随插件纤维自动回收；显式清理定时器
  return () => {
    disposeSnapshot()
    disposeSteps()
    disposeSessions()
    disposeConfig()
    disposeImport()
    disposeSummarize()
    disposeMerge()
    disposeTopic()
    disposeWsProfile()
    for (const trail of trails.values()) {
      clearTimeout(trail.summarizeTimer)
      clearTimeout(trail.saveTimer)
    }
  }
}

// ── 工作区（workspace）线索网络 ─────────────────────────────────────────────
// dsh 的会话持久化按「项目工作目录」分组存放：<DSH_HOME>/sessions/<projectKey>/<sessionId>/
// projectKey 的编码规则：路径分隔符（/ \ :）合并为一个 '-'，安全字符保留，
// 其余字符（含中文）转义为 ~XXXX（UTF-16 hex），整体包成 --KEY--。
// 这里把「工作区 → 会话 → 话题」组织成三级线索网络：
//   全部工作区（跨工作区合并） → 工作区（相似话题合并） → 会话（原始话题+步骤）

/** 把 dsh 的 projectKey 目录名解码为可读路径（分隔符有损，统一显示为 \）。 */
export function decodeWorkspaceKey(key) {
  const inner = key.replace(/^--/, '').replace(/--$/, '')
  let out = ''
  let prevSep = false
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '~') {
      const hex = inner.slice(i + 1, i + 5)
      if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16))
        i += 4
        prevSep = false
        continue
      }
      out += ch
      prevSep = false
    } else if (ch === '-') {
      if (!prevSep) out += '\\'
      prevSep = true
    } else {
      out += ch
      prevSep = false
    }
  }
  if (/^[A-Za-z]\\/.test(out)) out = `${out[0]}:${out.slice(1)}`
  return out
}

/** 会话目录名 → 会话 id：直接使用目录名原样（dsh 新旧会话 id 可能是 session-<uuid> 或裸 <uuid>）。 */
function normalizeSessionDir(name) {
  return name
}

/** 兼容新旧两种会话 id 格式读取：session-<uuid> 与裸 <uuid>。 */
async function readSessionById(ctx, sessionId) {
  try {
    return await ctx.sessionQuery.readSession(sessionId)
  } catch (error) {
    const variant = sessionId.startsWith('session-')
      ? sessionId.slice('session-'.length)
      : `session-${sessionId}`
    return await ctx.sessionQuery.readSession(variant)
  }
}

/** 把 cwd 编码成 dsh sessions 目录名（与 dsh 内部编码一致）。 */
function cwdToFsKey(cwd) {
  let inner = ''
  let prevSep = false
  for (const ch of cwd) {
    if (/[\\/:]/.test(ch)) {
      if (!prevSep) inner += '-'
      prevSep = true
    } else if (ch === ' ') {
      inner += '~0020'
      prevSep = false
    } else if (/[a-zA-Z0-9._-]/.test(ch)) {
      inner += ch
      prevSep = false
    } else {
      inner += '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')
      prevSep = false
    }
  }
  return '--' + inner + '--'
}

/** 从 sessionCwdCache 按真实工作目录分组（同路径不同 cwd 会分成不同工作区）。 */
function listWorkspacesByCwd() {
  const wsMap = new Map()
  for (const [sid, cwd] of sessionCwdCache.entries()) {
    if (!cwd) continue
    if (!wsMap.has(cwd)) {
      wsMap.set(cwd, { id: cwd, title: cwd, sessions: new Set() })
    }
    wsMap.get(cwd).sessions.add(sid)
  }
  return Array.from(wsMap.values()).map((ws) => ({
    id: ws.id,
    title: ws.title,
    sessions: Array.from(ws.sessions),
  }))
}

/** 读取会话目录的 mtime（最后修改时间），用于无话题会话的排序。wsId 可能是 cwd 或 fsKey。 */
function getSessionMtime(wsId, sessionId) {
  const root = join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), SESSIONS_ROOT_NAME)
  const candidates = [wsId]
  if (!wsId.startsWith('--')) candidates.push(cwdToFsKey(wsId))
  for (const key of candidates) {
    try {
      return new Date(statSync(join(root, key, sessionId)).mtimeMs).toISOString()
    } catch { /* try next */ }
  }
  return new Date(0).toISOString()
}

/** 扫描 <DSH_HOME>/sessions/，返回全部工作区及其会话 id 列表。优先用 cwd 分组。 */
export function listWorkspaces() {
  if (sessionCwdCache.size > 0) {
    return listWorkspacesByCwd()
  }
  const root = join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), SESSIONS_ROOT_NAME)
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const workspaces = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '_no-cwd') continue
    const wsId = entry.name
    let sessionIds = []
    try {
      sessionIds = readdirSync(join(root, wsId), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => normalizeSessionDir(e.name))
    } catch {
      sessionIds = []
    }
    if (sessionIds.length > 0) {
      workspaces.push({ id: wsId, title: decodeWorkspaceKey(wsId), sessions: sessionIds })
    }
  }
  return workspaces
}

/** bigram 字符 Jaccard 相似度，用于话题标题聚类。 */
function bigramJaccard(a, b) {
  const grams = (s) => {
    const set = new Set()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2).toLowerCase())
    return set
  }
  const A = grams(a)
  const B = grams(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

function titleSimilar(a, b) {
  const sim = bigramJaccard(a, b)
  if (sim >= 0.3) return true
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true
  return false
}

/** 话题聚类：相似标题合并成组。 */
function clusterTopics(topics) {
  const groups = []
  for (const t of topics) {
    let placed = false
    for (const g of groups) {
      if (titleSimilar(g[0].title, t.title)) {
        g.push(t)
        placed = true
        break
      }
    }
    if (!placed) groups.push([t])
  }
  return groups
}

/** 把一组话题聚合成一条合并线索（取最短标题为代表，来源逐个列出）。 */
function mergeGroup(group, scopeId, scopeTitle) {
  const rep = group.reduce((best, t) => (t.title.length < best.title.length ? t : best), group[0])
  const sources = group.map((t) => ({
    sessionId: t._sessionId,
    sessionTitle: t._sessionTitle || t._sessionId,
    workspaceId: t._workspaceId,
    workspaceTitle: t._workspaceTitle,
    topicId: t.id,
    title: t.title,
    summary: t.summary,
    status: t.status,
  }))
  return {
    id: `${scopeId}:${rep.id}`,
    title: rep.title,
    summary: rep.summary || (group.length > 1 ? `来自 ${group.length} 条相关线索` : ''),
    status: group.some((t) => t.status === 'active') ? 'active' : 'done',
    source: group.some((t) => t.source === 'llm') ? 'llm' : 'rule',
    sources,
    count: group.length,
  }
}

/**
 * 构建三级线索网络：
 *   workspaces.byId[wsId].topics — 该工作区内相似话题合并后的线索
 *   workspaces.all.topics        — 跨工作区再次合并后的「全部工作区」线索
 * 每条合并线索携带 sources（来源：工作区/会话/原始话题），供前端悬停提示与下钻。
 */
export function buildWorkspaceNetwork(trails, titleCache) {
  const workspaces = listWorkspaces()
  const byId = {}
  const allCarriers = [] // {workspaceId, workspaceTitle, topic}
  for (const ws of workspaces) {
    const topics = []
    for (const sid of ws.sessions) {
      const trail = trails.get(sid)
      if (!trail || trail.topics.length === 0) continue
      for (const t of trail.topics) {
        topics.push({
          ...t,
          _sessionId: sid,
          _sessionTitle: titleCache.get(sid),
          _workspaceId: ws.id,
          _workspaceTitle: ws.title,
        })
      }
    }
    if (topics.length === 0) continue
    const wsTopics = clusterTopics(topics).map((group, i) => {
      const merged = mergeGroup(group, `ws:${ws.id}`, ws.title)
      merged.id = `ws:${ws.id}:${i}`
      return merged
    })
    byId[ws.id] = { id: ws.id, title: ws.title, sessionCount: ws.sessions.length, sessions: ws.sessions, topics: wsTopics }
    for (const wt of wsTopics) {
      allCarriers.push({ ...wt, _workspaceId: ws.id, _workspaceTitle: ws.title })
    }
  }
  let all = { id: 'all', title: '全部工作区', topics: [] }
  if (allCarriers.length > 0) {
    const carriers = allCarriers.map((t) => ({ ...t, _sessionId: t.sources?.[0]?.sessionId, _sessionTitle: t.sources?.[0]?.sessionTitle }))
    const groups = clusterTopics(carriers)
    all.topics = groups.map((group, i) => {
      const merged = mergeGroup(group, 'all', '全部工作区')
      merged.id = `all:${i}`
      return merged
    })
  }
  return { all, byId }
}
