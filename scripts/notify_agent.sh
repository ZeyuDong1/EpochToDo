#!/bin/bash
# 手动向 EpochToDo 发送 AI 软提醒（新 kind:"ai" 格式）
# 用法: notify_agent.sh <title> [status] [detail] [link]
#   status: success | failure | needs_input | review | info | progress (默认 info)
# 注意：opencode 现已通过 .opencode/plugin/epoch-reminder.ts 自动发送提醒，此脚本仅作手动兜底。
TITLE=${1:-"Agent Task Completed"}
STATUS=${2:-"info"}
DETAIL=${3:-""}
LINK=${4:-""}

BODY="{\"kind\":\"ai\",\"source\":\"OpenCode\",\"title\":\"$TITLE\",\"status\":\"$STATUS\""
[ -n "$DETAIL" ] && BODY="$BODY,\"detail\":\"$DETAIL\""
[ -n "$LINK"   ] && BODY="$BODY,\"link\":\"$LINK\""
BODY="$BODY}"

curl -s -X POST http://127.0.0.1:62222/hook \
     -H "Content-Type: application/json" \
     --max-time 2 \
     -d "$BODY" >/dev/null 2>&1 || true
