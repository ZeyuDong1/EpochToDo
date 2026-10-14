export type TaskStatus = 'active' | 'waiting' | 'queued' | 'archived';
export type TaskType = 'standard' | 'reminder' | 'training' | 'notification';

export interface Project {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  color?: string;
  activeCount?: number;
  totalFocused?: number;
}

export interface Gpu {
  id: number;
  name: string;
  color: string;
  created_at: string;
  activeTaskId?: number; // Derived/Joined
  last_active_at?: string | null;
}

export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  type: TaskType;
  context_memo?: string;
  total_duration: number; // In seconds
  estimated_duration?: number; // In minutes
  tag?: string;
  project_id: number | null;
  parent_id: number | null;
  is_next_action: number;
  is_side_focus?: number; // 1 = secondary focus (max 2, shown in overlay right below Focus)
  side_focus_at?: string | null; // when the side-focus flag was set (promotion tie-break)
  sort_order: number;
  gpu_id: number | null;
  last_focused_at?: string | null;
  created_at: string; // ISO string
  started_at?: string; // 加入开始时间用于前端计算专注时长
  target_timestamp?: string; // 加入目标时间用于前端计算倒计时
  timer_type?: TimerType;
  is_webhook?: number; // 1 if created via webhook, 0 or undefined otherwise
  dispatched_target?: string | null; // JSON string of DispatchedTarget
  md_file_path?: string | null; // Path of the bound MD file for bidirectional sync
  md_line_hash?: string | null; // Hash of the synced bullet point content for change detection
}

export interface DispatchedTarget {
  processName: string;     // e.g. "Code.exe", "cmd.exe"
  windowTitle?: string;    // e.g. "main.py - Code"
  executablePath?: string; // e.g. "C:\\...\\Code.exe"
  bundleId?: string;       // macOS only
  timestamp: string;       // ISO string
}

export interface HistoryEntry {
  id: number;
  task_id: number;
  title: string;
  type: TimerType;
  start_time: string;
  end_time: string;
}

export interface Tag {
  name: string; // PK
  color: string; // Hex code
}

export type TimerType = 'focus' | 'wait' | 'training';

export interface Timer {
  id: number;
  task_id: number;
  type: TimerType;
  target_timestamp?: string; // ISO string
  original_duration?: number; // In seconds
  started_at?: string; // ISO string
}

export interface TrainingStatus {
  taskId: number;
  gpuName?: string;
  modelName?: string;
  eta?: string;
  metrics?: Record<string, unknown>;
  lastUpdated: number;
  stalled: boolean;
  source?: 'wandb' | 'webhook';
  wandbUrl?: string;
  /** epoch ms of the last stalled-nag reminder (webhook tasks) */
  lastReminded?: number;
}

// Scheduler types (independent from main task system)
export interface SchedulerGpu {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface SchedulerTask {
  id: number;
  title: string;
  estimated_hours: number;
  status: 'pending' | 'scheduled' | 'running' | 'completed';
  color: string;
  created_at: string;
}

export interface SchedulerAssignment {
  id: number;
  task_id: number;
  gpu_id: number;
  start_time: string; // ISO timestamp for absolute date/time
  duration_hours: number;
  created_at: string;
}

export interface TaskNode {
  task: Task;
  children: TaskNode[];
  depth: number;
}

/** Values a settings row may hold (stored as JSON text in SQLite) */
export type SettingValue = string | number | boolean | null | Record<string, unknown>;

export type AiReminderStatus =
  | 'success' | 'failure' | 'needs_input' | 'review' | 'info' | 'progress';

export interface AiReminder {
  id: string;
  source: string;
  title: string;
  status: AiReminderStatus;
  detail?: string;
  link?: string;
  timestamp: number; // epoch ms
}

// MD Sync types
export interface ImportResult {
  created: number;
  updated: number;
  duplicates: string[];
}

export interface ExportResult {
  written: boolean;
  bulletCount: number;
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  conflicts: { taskId: number; oldTitle: string; newTitle: string }[];
}

/** Auto-sync status returned by the main process */
export interface MdSyncStatus {
  enabled: boolean;
  folderPath: string;
  filePath: string;
  lastSyncTime: number | null;
  lastError: string | null;
}

