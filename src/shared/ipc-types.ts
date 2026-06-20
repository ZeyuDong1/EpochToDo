import type { Task, TaskType, Project, HistoryEntry, Gpu, TrainingStatus, SchedulerGpu, SchedulerTask, SchedulerAssignment, AiReminder } from './types';

export type IpcInvokeMap = {
  'get-tasks': { args: []; return: Task[] };
  'create-task': { args: [title: string, tag?: string, type?: TaskType, projectId?: number, parentId?: number, skipDedup?: boolean]; return: Task };
  'update-task': { args: [id: number, updates: Record<string, unknown>]; return: void };
  'delete-task': { args: [id: number]; return: void };
  'delete-all-tasks': { args: []; return: void };
  'get-projects': { args: []; return: Project[] };
  'create-project': { args: [name: string, description?: string, color?: string]; return: Project };
  'update-project': { args: [id: number, updates: Record<string, unknown>]; return: void };
  'delete-project': { args: [id: number]; return: void };
  'get-history': { args: [dateStr?: string]; return: HistoryEntry[] };
  'delete-history': { args: [id: number]; return: void };
  'get-gpus': { args: []; return: Gpu[] };
  'create-gpu': { args: [name: string, color?: string]; return: Gpu };
  'delete-gpu': { args: [id: number]; return: void };
  'export-data': { args: []; return: { success: boolean; message: string } };
  'import-data': { args: []; return: { success: boolean; message: string; needsRestart?: boolean } };
  'get-settings': { args: [key: string, defaultValue?: unknown]; return: unknown };
  'update-setting': { args: [key: string, value: unknown]; return: void };
  'register-shortcut': { args: [shortcut: string]; return: boolean };
  'unregister-shortcuts': { args: []; return: boolean };
  'get-auto-launch': { args: []; return: boolean };
  'set-auto-launch': { args: [enabled: boolean]; return: boolean };
  'get-suggestions': { args: [maxDuration?: number]; return: Task[] };
  'timer:stop-training': { args: [taskId: number, forceComplete?: boolean]; return: void };
  'scheduler:get-gpus': { args: []; return: SchedulerGpu[] };
  'scheduler:create-gpu': { args: [name: string, color?: string]; return: SchedulerGpu };
  'scheduler:update-gpu': { args: [id: number, updates: Record<string, unknown>]; return: void };
  'scheduler:delete-gpu': { args: [id: number]; return: void };
  'scheduler:get-tasks': { args: []; return: SchedulerTask[] };
  'scheduler:create-task': { args: [title: string, estimatedHours?: number, color?: string]; return: SchedulerTask };
  'scheduler:update-task': { args: [id: number, updates: Record<string, unknown>]; return: void };
  'scheduler:delete-task': { args: [id: number]; return: void };
  'scheduler:get-assignments': { args: []; return: SchedulerAssignment[] };
  'scheduler:create-assignment': { args: [taskId: number, gpuId: number, startTime: string, durationHours: number]; return: SchedulerAssignment | { error: string } };
  'scheduler:update-assignment': { args: [id: number, updates: Record<string, unknown>]; return: void };
  'scheduler:delete-assignment': { args: [id: number]; return: void };
  'scheduler:clear-assignments': { args: []; return: void };
  'wandb:test': { args: [entity: string, apiKey: string]; return: { valid: boolean; projectCount: number; hostname: string; error?: string } };
  'open-external': { args: [url: string]; return: void };
};

export type IpcSendMap = {
  'timer:start-focus': [taskId: number];
  'timer:stop-focus': [];
  'timer:complete-task': [taskId: number];
  'timer:start-wait': [taskId: number, duration: number];
  'timer:cancel-wait': [taskId: number];
  'timer:add-memo': [taskId: number, content: string];
  'gpu:assign-task': [taskId: number, gpuId: number, durationMinutes: number];
  'spotlight:hide': [];
  'reminder:hide': [];
  'reminder:snooze': [taskId: number, minutes: number];
  'set-overlay-ignore-mouse': [ignore: boolean];
  'reset-overlay-position': [];
  'wandb:update': [];
};

export type IpcOnMap = {
  'timer:update': (taskId: number, remaining: number) => void;
  'timer:ended': (taskId: number, task: Task | null) => void;
  'fetch-tasks': () => void;
  'reminder:repeat': (taskId: number, task: Task) => void;
  'timer:training-update': (status: TrainingStatus) => void;
  'ai:reminder': (reminder: AiReminder) => void;
};
