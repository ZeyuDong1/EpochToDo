#!/bin/bash
TITLE=${1:-"Agent Task Completed"}
MESSAGE=${2:-"An AI agent has finished its work in the OpenCode environment."}

curl -s -X POST http://127.0.0.1:62222/hook \
     -H "Content-Type: application/json" \
     -d "{\"title\": \"$TITLE\", \"message\": \"$MESSAGE\"}"
