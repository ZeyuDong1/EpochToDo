/**
 * EpochToDo AI 软提醒 — OpenCode 插件
 *
 * 监听 opencode 的 `session.idle` 事件（agent 完成一轮自主工作、转入空闲，
 * 即用户派发的一个任务/回复结束），向本地 EpochToDo 的 webhook 发送一条
 * `kind:"ai"` 软提醒。
 *
 * 状态判定（按可元数据可靠判定为准，不猜文本语义）：
 * - 最后一条 assistant 消息带 `error`（ApiError / Aborted / ...）→ status = "failure"
 * - 否则（正常完成）→ status = "info"（留 AI 提醒瞬时栏，不落库）
 * 说明：success / needs_input 无法从元数据可靠判定，故不硬猜；
 *       需持久化/跟进时，用户可在 EpochToDo UI 点"转软提醒"手动提升。
 *
 * 特性：纯软提醒（不响铃/不抢焦点/不弹模态）；发完即忘（失败静默）；2s 超时；
 *       请求体 UTF-8（Content-Type 带 charset=utf-8）。
 *
 * 字段语义见 docs/AI_REMINDER_HOOK_GUIDE.md
 */
import type { Plugin } from "@opencode-ai/plugin"

const HOOK_URL = "http://127.0.0.1:62222/hook"
const SOURCE = "OpenCode"

type SessionSummary = { additions?: number; deletions?: number; files?: number }
type SessionData = { title?: string; summary?: SessionSummary; share?: { url?: string } }
type MsgError = { message?: string } | string
type AnyMsg = { role?: string; error?: MsgError }

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

function formatSummary(s?: SessionSummary): string | undefined {
  if (!s) return undefined
  const parts: string[] = []
  if (s.additions != null) parts.push(`+${s.additions}`)
  if (s.deletions != null) parts.push(`-${s.deletions}`)
  if (s.files != null) parts.push(`${s.files} 文件`)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function errMsg(e?: MsgError): string | undefined {
  if (!e) return undefined
  if (typeof e === "string") return e
  return e.message
}

export default (async ({ client }) => {
  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = event.properties.sessionID

      let title = "回合结束"
      let status: "info" | "failure" = "info"
      let detail: string | undefined
      let link: string | undefined

      // 1) 会话元信息：标题 / diff 统计 / share 链接
      try {
        const res = await client.session.get({ path: { id: sessionID } })
        const s = (res as { data?: SessionData } | undefined)?.data
        if (s?.title && s.title.trim()) title = s.title.trim()
        detail = formatSummary(s?.summary)
        if (s?.share?.url) link = s.share.url
      } catch {
        // 取不到会话信息就用默认值
      }

      // 2) 取最后一条 assistant 消息：若带 error → failure
      try {
        const mres = await client.session.messages({ path: { id: sessionID } })
        const msgs = (mres as { data?: AnyMsg[] } | undefined)?.data ?? []
        const lastAssistant = [...msgs].reverse().find(m => m?.role === "assistant")
        if (lastAssistant?.error) {
          status = "failure"
          detail = `错误：${errMsg(lastAssistant.error) ?? "回复出错"}`
        }
      } catch {
        // 取不到消息就保持 info
      }

      await notify(title, status, detail, link)
    },
  }
}) satisfies Plugin
