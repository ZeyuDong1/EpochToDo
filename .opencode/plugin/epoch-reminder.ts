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
 *
 * webhook 格式与字段语义见仓库内 docs/AI_REMINDER_HOOK_GUIDE.md
 */
import type { Plugin } from "@opencode-ai/plugin"

const HOOK_URL = "http://127.0.0.1:62222/hook"
const SOURCE = "OpenCode"

async function notify(
  title: string,
  status: "info" | "success" | "failure" = "info",
): Promise<void> {
  try {
    await fetch(HOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "ai", source: SOURCE, title, status }),
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // EpochToDo 未运行或不可达 —— 静默忽略
  }
}

export default (async ({ client }) => {
  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = event.properties.sessionID

      let title = "任务完成"
      try {
        const res = await client.session.get({ path: { id: sessionID } })
        const t = (res as { data?: { title?: string } })?.data?.title
        if (t && t.trim()) title = t.trim()
      } catch {
        // 取不到会话标题就用默认值
      }

      await notify(title, "info")
    },
  }
}) satisfies Plugin
