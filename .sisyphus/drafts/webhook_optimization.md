# Draft: Webhook & GPU Display Optimization

## Requirements (User Request)
- **Goal**: Optimize webhook and GPU display.
- **New Capabilities**:
    - Webhook must support: `gpu_name`, `estimated_remaining_time`, `training_info` (implied).
    - UI must display: GPU Name, Estimated Time, Training Progress.

## Current State Analysis
- **Webhook**: Located in `electron/main.ts` (port 62222). Currently accepts `{ title, message }`.
- **Database**: `TaskTable` has `gpu_id`, `estimated_duration`. `GpuTable` has `name`, `color`.
- **Missing**:
    - Way to link incoming webhook to specific GPU by name (currently manual assignment via UI?).
    - Fields for `current_epoch`, `total_epochs`, `eta`.

## Open Questions
- Persistence vs Real-time? (Asked user)
- Auto-creation? (Asked user)

## Proposed Changes (Draft)

### 1. Electron / Backend
- **Update `/hook` endpoint**:
    - Accept generic JSON payload with:
        - `gpu_name` (string)
        - `task_name` (string, optional)
        - `progress` (float 0-1 or percentage)
        - `current_epoch` / `total_epochs` (numbers)
        - `eta_seconds` (number)
    - **Logic**:
        - Find GPU by `gpu_name`.
        - Find active task on that GPU.
        - Update task metadata (needs DB schema update? or use `context_memo` as JSON storage for now? Or add columns?).

### 2. Frontend / UI
- **Update Task Component**:
    - Show Progress Bar.
    - Show ETA badge.
    - Show Epoch info (e.g., "Epoch 5/100").
