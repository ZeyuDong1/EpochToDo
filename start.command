#!/bin/bash
# EpochToDo 一键启动（直接运行已构建产物）
cd "$(dirname "$0")"

if [ ! -f "dist-electron/main.js" ]; then
  echo "⚙️  首次运行，正在构建..."
  npx vite build
fi

echo "🚀 Starting EpochToDo..."
exec npx electron .
