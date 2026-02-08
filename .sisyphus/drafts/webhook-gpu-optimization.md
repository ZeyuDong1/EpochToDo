# Draft: Webhook & GPU Display Optimization

## Requirements (Confirmed)
- **Webhook Payload**: JSON containing `task_id` (or `title`), `gpu_name` (optional), `model_name`, `eta` (remaining time).
- **Matching Logic**: Match by `task_id` first, then fuzzy match `title`.
- **UI Display**: 
  - **Task Card**: Show real-time ETA and Model Name.
  - **Overlay**: Show summary of active training.
  - **Notifications**: Alert on completion or stalling.
- **Data Persistence**: 
  - Static info (GPU assignment) -> Save to DB.
  - Dynamic info (ETA, Metrics) -> In-memory (transient).

## Technical Decisions
- **Backend**: 
  - Update `/hook` endpoint in `electron/main.ts`.
  - Add `trainingStatus` map to `TimerManager`.
  - Broadcast `training-update` IPC event.
- **Frontend**:
  - Update `useStore` to merge `trainingStatus`.
  - Modify `TaskCard` and `Overlay` components.
- **Health Check**:
  - `TimerManager` checks last update time. If > 5m, flag as "Stalled".

## Scope Boundaries
- **IN**: Webhook parsing, In-memory status tracking, UI updates (Card/Overlay).
- **OUT**: Historical graphing of loss curves (not requested), managing training scripts themselves.
