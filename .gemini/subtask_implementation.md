# Subtask Feature Implementation Plan

## Overview
Implement subtask functionality where subtasks are regular tasks that belong to a parent task.

## Requirements Breakdown

### 1. Command Parser (useCommandParser.ts) ✅ DONE
- `[task]:` - Create subtask with current focus as parent
- `[task]:[search]` - Create subtask with searched parent
- Added `parentSearch` and `isSubtask` fields to Command interface

### 2. Spotlight.tsx Changes
- [ ] Handle `isSubtask` flag in task creation
- [ ] When `parentSearch` is provided, show parent task candidates in suggestions
- [ ] When `parentSearch` is empty and `isSubtask` is true, use current `activeTask` as parent

### 3. Dashboard Focus Panel
- [ ] Show parent task name in smaller text when focusing on a subtask
- [ ] When subtask completes, auto-switch focus to parent

### 4. Queue Filtering
- [ ] When a subtask is focused, hide its parent from the queue

### 5. Task Completion Logic
- [ ] When parent task is completed, auto-complete all subtasks
- [ ] Timer duration handling for subtasks

### 6. Timer/Duration Logic
- [ ] Subtask timer should accumulate to parent
- [ ] If subtask changes parent, timer moves to new parent
- [ ] If subtask completes, timer is fixed to current parent
- [ ] If subtask is deleted (not completed), timer is NOT added to parent

## Implementation Order
1. Spotlight subtask creation
2. Dashboard UI changes
3. Completion cascade logic
4. Timer accumulation logic
