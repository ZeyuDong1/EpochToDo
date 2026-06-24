/**
 * EpochToDo AI 软提醒 — OpenCode 插件
 *
 * 监听 opencode 的 `session.idle` 事件（agent 完成一轮自主工作、转入空闲，
 * 即用户派发的一个任务结束），向本地 EpochToDo 的 webhook 发送一条
 * `kind:"ai"` 软提醒。提醒在 EpochToDo 的 Dashboard / Spotlight 里以
 * 非阻塞的青色卡片呈现。
 *
 * 特性：
 * - 纯软提醒：不发声音、不抢焦点、不弹模态。
 * - 发完即忘：EpochToDo 未运行时 fetch 立即失败，被 catch 静默吞掉，
 *   绝不影响 opencode 主流程。
 * - 2 秒超时，防止挂起。
 * - 请求体 UTF-8 编码（Content-Type 带 charset=utf-8）。
 *
 * webhook 格式与字段语义见仓库内 docs/AI_REMINDER_HOOK_GUIDE.md
 */
import type { Plugin } from "@opencode-ai/plugin"

const HOOK_URL = "http://127.0.0.1:62222/hook"
const SOURCE = "OpenCode"

type SessionSummary = { additions?: number; deletions?: number; files?: number }
type SessionData = { title?: string; summary?: SessionSummary; share?: { url?: string } }

async function notify(
  title: string,
  status: "info" | "success" | "failure" = "info",
  detail?: string,
  link?: string,
): Promise<void> {
  const payload: Record<string, unknown> = { kind: "ai", source: SOURCE, title, status }
  if (detail) payload.detail = detail
  if (link) payload.link = link
  try {
    await fetch(HOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // EpochToDo 未运行或不可达 —— 静默忽略
  }
}

// 把 diff 统计压成一行分流信息，如 "+12 · -3 · 4 文件"
function formatSummary(s?: SessionSummary): string | undefined {
  if (!s) return undefined
  const parts: string[] = []
  if (s.additions != null) parts.push(`+${s.additions}`)
  if (s.deletions != null) parts.push(`-${s.deletions}`)
  if (s.files != null) parts.push(`${s.files} 文件`)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

export default (async ({ client }) => {
  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = event.properties.sessionID

      let title = "回合结束"
      let detail: string | undefined
      let link: string | undefined
      try {
        const res = await client.session.get({ path: { id: sessionID } })
        const s = (res as { data?: SessionData } | undefined)?.data
        if (s?.title && s.title.trim()) title = s.title.trim()
        detail = formatSummary(s?.summary)
        if (s?.share?.url) link = s.share.url
      } catch {
        // 取不到会话信息就用默认值
      }

      // status 用 info：保留在 AI Reminders 瞬时栏，不落库；
      // 用户若要转为可操作任务，可在 EpochToDo UI 点"转软提醒"。
      await notify(title, "info", detail, link)
    },
  }
}) satisfies Plugin
