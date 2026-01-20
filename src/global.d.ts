import { Task, Project, HistoryEntry, Gpu } from './shared/types';

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

  getSettings: (key: string, defaultValue?: any) => Promise<any>;
  updateSetting: (key: string, value: any) => Promise<void>;
  registerShortcut: (shortcut: string) => Promise<boolean>;
  
  getSuggestions: (maxDuration?: number) => Promise<Task[]>;
  addMemo: (taskId: number, content: string) => void;
  
  startFocus: (taskId: number) => void;
  stopFocus: () => void;
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
  hideSpotlight: () => void;
}

declare global {
  interface Window {
    api: IElectronAPI;
  }
}

