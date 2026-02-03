export type TaskStatus = 'active' | 'waiting' | 'queued' | 'archived';
export type TaskType = 'standard' | 'ad-hoc' | 'training' | 'external';

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
  sort_order: number;
  gpu_id: number | null;
  last_focused_at?: string | null;
  created_at: string; // ISO string
  started_at?: string; // 加入开始时间用于前端计算专注时长
  target_timestamp?: string; // 加入目标时间用于前端计算倒计时
  timer_type?: TimerType;
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
