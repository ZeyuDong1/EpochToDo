import { Task, Project, HistoryEntry, Gpu, TrainingStatus, SchedulerGpu, SchedulerTask, SchedulerAssignment } from './shared/types';

export interface IElectronAPI {
  createTask: (title: string, tag?: string, type?: Task['type'], projectId?: number, parentId?: number) => Promise<Task>;
  updateTask: (id: number, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  getTasks: () => Promise<Task[]>;
  getProjects: () => Promise<Project[]>;
  createProject: (name: string, description?: string, color?: string) => Promise<Project>;
  updateProject: (id: number, updates: Partial<Project>) => Promise<void>;
  getHistory: (dateStr?: string) => Promise<HistoryEntry[]>;
  deleteHistory: (id: number) => Promise<void>;

  exportData: () => Promise<{ success: boolean; message: string }>;
  importData: () => Promise<{ success: boolean; message: string; needsRestart?: boolean }>;
  
  getGpus: () => Promise<Gpu[]>;
  createGpu: (name: string, color?: string) => Promise<Gpu>;
  deleteGpu: (id: number) => Promise<void>;
  assignTaskToGpu: (taskId: number, gpuId: number, durationMinutes: number) => void;
  setOverlayIgnoreMouse: (ignore: boolean) => void;
  resetOverlayPosition: () => void;

  getSettings: (key: string, defaultValue?: any) => Promise<any>;
  updateSetting: (key: string, value: any) => Promise<void>;
  registerShortcut: (shortcut: string) => Promise<boolean>;
  unregisterShortcuts: () => Promise<boolean>;
  
  getSuggestions: (maxDuration?: number) => Promise<Task[]>;
  addMemo: (taskId: number, content: string) => void;
  
  startFocus: (taskId: number) => void;
  stopFocus: () => void;
  completeTask: (taskId: number) => void;
  startWait: (taskId: number, duration: number) => void;
  cancelWait: (taskId: number) => void;
  stopTraining: (taskId: number, forceComplete?: boolean) => Promise<void>;
  
  // Reminder APIs
  snoozeReminder: (taskId: number, minutes: number) => void;
  hideReminder: () => void;
  
  onTimerUpdate: (callback: (taskId: number, remaining: number) => void) => () => void;
  onTimerEnded: (callback: (taskId: number, task: Task) => void) => () => void;
  onFetchTasks: (callback: () => void) => () => void;
  onReminderRepeat: (callback: (taskId: number, task: Task) => void) => () => void;
  onTrainingUpdate: (callback: (status: TrainingStatus) => void) => () => void;
  hideSpotlight: () => void;

  // Scheduler APIs (independent GPU scheduler)
  schedulerGetGpus: () => Promise<SchedulerGpu[]>;
  schedulerCreateGpu: (name: string, color?: string) => Promise<SchedulerGpu>;
  schedulerUpdateGpu: (id: number, updates: Partial<SchedulerGpu>) => Promise<void>;
  schedulerDeleteGpu: (id: number) => Promise<void>;

  schedulerGetTasks: () => Promise<SchedulerTask[]>;
  schedulerCreateTask: (title: string, estimatedHours?: number, color?: string) => Promise<SchedulerTask>;
  schedulerUpdateTask: (id: number, updates: Partial<SchedulerTask>) => Promise<void>;
  schedulerDeleteTask: (id: number) => Promise<void>;

  schedulerGetAssignments: () => Promise<SchedulerAssignment[]>;
  schedulerCreateAssignment: (taskId: number, gpuId: number, startTime: string, durationHours: number) => Promise<SchedulerAssignment>;
  schedulerUpdateAssignment: (id: number, updates: Partial<SchedulerAssignment>) => Promise<void>;
  schedulerDeleteAssignment: (id: number) => Promise<void>;
  schedulerClearAssignments: () => Promise<void>;
}

declare global {
  interface Window {
    api: IElectronAPI;
  }
}


