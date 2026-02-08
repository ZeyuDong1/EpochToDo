import { Generated } from 'kysely';

export interface TaskTable {
  id: Generated<number>;
  title: string;
  status: 'active' | 'waiting' | 'queued' | 'archived';
  type: 'standard' | 'ad-hoc' | 'training' | 'external';
  context_memo: string | null;
  total_duration: number;
  estimated_duration: number | null;
  tag: string | null;
  project_id: number | null;
  parent_id: number | null;
  is_next_action: number; // 0 or 1
  sort_order: number;
  gpu_id: number | null;
  last_focused_at: string | null;
  created_at: string;
  started_at?: string; // Virtual/Derived or actual column? 
}

export interface GpuTable {
  id: Generated<number>;
  name: string;
  color: string;
  created_at: string;
  last_active_at: string | null;
}

export interface ProjectTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  color: string | null;
  created_at: string;
}

export interface TagTable {
  name: string;
  color: string;
}

export interface TimerTable {
  id: Generated<number>;
  task_id: number;
  type: 'focus' | 'wait' | 'training';
  target_timestamp: string | null;
  original_duration: number | null;
  started_at: string | null;
}

export interface HistoryTable {
  id: Generated<number>;
  task_id: number;
  title: string; // snapshots title in case task is deleted/renamed
  type: 'focus' | 'wait' | 'training';
  start_time: string;
  end_time: string;
}

export interface SettingsTable {
  key: string;
  value: string; // JSON stringified
}

export interface Database {
  tasks: TaskTable;
  projects: ProjectTable;
  tags: TagTable;
  timers: TimerTable;
  history: HistoryTable;
  settings: SettingsTable;
  gpus: GpuTable;
}
