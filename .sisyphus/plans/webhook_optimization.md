# Plan: Webhook & GPU Display Optimization

## TL;DR

> **Quick Summary**: Enhance the webhook to accept detailed training metrics (GPU name, progress, ETA) and update the UI to visualize this data in real-time.
> 
> **Deliverables**:
> - Updated Database Schema (new columns for progress/metadata)
> - Enhanced Webhook Endpoint (`/hook` accepts JSON payload)
> - Updated Frontend Components (Progress bars, ETA badges)
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: DB Schema → Backend Service → Webhook → Frontend UI

---

## Context

### Original Request
Optimize webhook and GPU display to support transmission and visualization of GPU name, training remaining time, and other metrics.

### Interview Summary
**Key Discussions**:
- **Auto-Creation**: Yes, automatically create tasks/GPUs if they don't exist in the system.
- **Persistence**: Yes, save progress and status to the database.

**Research Findings**:
- Current webhook only accepts `title` and `message`.
- Database has `tasks` and `gpus` tables but lacks fields for detailed training metrics.
- Frontend components need to be identified and updated to render these new fields.

### Metis Review
**Identified Gaps** (addressed):
- **Schema Missing**: Added `progress`, `total_epochs`, `current_epoch` columns to `tasks` table.
- **Component ID**: Added exploratory step to find exact React components.

---

## Work Objectives

### Core Objective
Enable rich monitoring of external training tasks via webhook, including progress bars and ETA.

### Concrete Deliverables
- `electron/db/schema.ts`: Updated with new columns
- `electron/main.ts`: Enhanced `/hook` endpoint logic
- `src/renderer/components/TaskItem.tsx` (or similar): UI updates for progress/ETA
- `src/shared/types.ts`: Updated TypeScript interfaces

### Definition of Done
- [ ] `curl` to `/hook` with `{ "gpuName": "4090", "progress": 0.5 }` updates the UI instantly.
- [ ] Task list shows a progress bar for training tasks.
- [ ] Hovering or viewing the task details shows ETA and Epoch info.

### Must Have
- Auto-creation of GPU/Task if missing.
- Real-time UI updates (no refresh needed).
- Persistence of progress data on restart.

### Must NOT Have (Guardrails)
- Blocking the main thread with heavy DB writes (use async).
- Overwriting user-manually set titles if task already exists (unless specified).

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.

### Test Decision
- **Infrastructure exists**: NO (Standard Electron/Vite setup, no test runner configured).
- **Automated tests**: NO (Manual/Agent verification).
- **Agent-Executed QA**: ALWAYS (Primary method).

### Agent-Executed QA Scenarios (MANDATORY)

**Example — API/Backend (curl):**

```
Scenario: Webhook updates existing task progress
  Tool: Bash (curl)
  Preconditions: App running, Task ID 1 exists and is 'training' type
  Steps:
    1. curl -X POST http://127.0.0.1:62222/hook \
       -H "Content-Type: application/json" \
       -d '{"taskName": "Test Training", "gpuName": "GPU-1", "progress": 0.45, "currentEpoch": 4, "totalEpochs": 10}'
    2. Wait for 1s
    3. Query DB: SELECT progress FROM tasks WHERE title="Test Training"
    4. Assert: progress equals 0.45
  Expected Result: Database reflects new progress value
  Evidence: SQL query output
```

**Example — Frontend/UI (Playwright):**

```
Scenario: Task card shows progress bar
  Tool: Playwright
  Preconditions: App running, Webhook sent with progress 0.45
  Steps:
    1. Navigate to Dashboard
    2. Locate Task Card for "Test Training"
    3. Assert: .progress-bar exists
    4. Assert: .progress-bar width is approx 45%
    5. Assert: text contains "4/10 Epochs"
  Expected Result: UI visually indicates progress
  Evidence: Screenshot
```

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: [Database Schema Update]
└── Task 4: [Frontend Component Search & Plan]

Wave 2 (After Wave 1):
├── Task 2: [Backend Service & Webhook Logic]
└── Task 5: [Frontend Component Implementation]

Wave 3 (After Wave 2):
└── Task 3: [Verification & Cleanup]

Critical Path: Task 1 → Task 2 → Task 5
Parallel Speedup: ~30%
```

---

## TODOs

- [ ] 1. [Database Schema Update]

  **What to do**:
  - Modify `electron/db/schema.ts` to add columns to `TaskTable`:
    - `progress`: number (0-1 or 0-100)
    - `current_epoch`: number
    - `total_epochs`: number
    - `training_status`: string ('training', 'paused', 'finished', 'error')
    - `last_updated`: string (ISO timestamp)
  - Create a migration script (or update `initDB` in `electron/db/index.ts`) to alter existing table if needed (or just add columns if using Kysely migration, but simple `ALTER TABLE` in `initDB` is safer for this project).

  **Must NOT do**:
  - Delete existing data.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2
  - **Blocked By**: None

  **References**:
  - `electron/db/schema.ts` - Current schema
  - `electron/db/index.ts` - DB initialization logic

  **Acceptance Criteria**:
  - [ ] Schema file contains new fields in `TaskTable` interface.
  - [ ] Application starts without DB errors.
  - [ ] `sqlite3 electron/db/data.db "PRAGMA table_info(tasks)"` shows new columns.

---

- [ ] 2. [Backend Service & Webhook Logic]

  **What to do**:
  - Update `TaskService` in `electron/db/service.ts`:
    - Add `updateTrainingProgress(taskId, data)` method.
    - Add `findTaskByGpuAndName(gpuName, taskName)` helper.
  - Update `/hook` handler in `electron/main.ts`:
    - Parse new JSON payload fields.
    - Logic:
      1. Find/Create GPU by `gpuName` (use `GpuService`).
      2. Find/Create Task by `taskName` linked to that GPU.
      3. Call `updateTrainingProgress`.
      4. Broadcast `fetch-tasks` event.

  **Must NOT do**:
  - Remove existing generic notification support (keep it as fallback if only `title` provided).

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:
  - `electron/main.ts:343` - Current webhook handler
  - `electron/db/service.ts` - TaskService implementation

  **Acceptance Criteria**:
  - [ ] POST /hook with `{ "gpuName": "A100", "taskName": "LLM Train", "progress": 0.1 }` returns 200 OK.
  - [ ] DB query shows task "LLM Train" created with gpu_id linked to "A100".
  - [ ] DB query shows progress=0.1.

---

- [ ] 3. [Shared Types Update]

  **What to do**:
  - Update `src/shared/types.ts` (or wherever `Task` interface is shared between main/renderer) to include the new fields.
  - Ensure both `electron` and `src/renderer` use this updated type definition.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `src/shared/types.ts` (Verify path via file search if needed)

  **Acceptance Criteria**:
  - [ ] `Task` interface includes `progress`, `current_epoch`, etc.
  - [ ] No TypeScript errors in `electron` or `src` regarding missing properties.

---

- [ ] 4. [Frontend Component Search & Plan]

  **What to do**:
  - Use `find` or `grep` to locate the React component rendering the task list (look for `.map`, `TaskItem`, `Card`).
  - Identify where the `GPU` badge/card is rendered.
  - Note the file paths for Task 5.

  **Recommended Agent Profile**:
  - **Category**: `explore`
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:
  - `src/renderer` directory

  **Acceptance Criteria**:
  - [ ] File paths for Task Item and GPU Card identified.

---

- [ ] 5. [Frontend Component Implementation]

  **What to do**:
  - Update the Task Component (found in Task 4):
    - If `task.type === 'training'` or `progress` is set:
      - Render a progress bar (use `<progress>` or a styled div).
      - Display "Epoch X/Y" if available.
      - Display "ETA: Z min" if available.
  - Update GPU Card (if applicable) to show status color (Green=Active, Yellow=Idle).

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-ui-ux`, `git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 3
  - **Blocked By**: Task 3, Task 4

  **References**:
  - (Output from Task 4)

  **Acceptance Criteria**:
  - [ ] Sending webhook update makes the progress bar move in the UI.
  - [ ] Epoch text appears correctly.
  - [ ] UI looks clean and aligned with existing design (Tailwind).

---

## Success Criteria

### Verification Commands
```bash
# Test the full flow
curl -X POST http://127.0.0.1:62222/hook -H "Content-Type: application/json" -d '{"title": "Test Task", "gpuName": "RTX 4090", "progress": 50, "totalEpochs": 100, "currentEpoch": 50}'
```

### Final Checklist
- [ ] Database schema updated safely.
- [ ] Webhook handles both legacy (simple) and new (rich) payloads.
- [ ] UI renders progress bars for training tasks.
- [ ] No regressions in standard task behavior.
