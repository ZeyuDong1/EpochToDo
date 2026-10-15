import { contextBridge, ipcRenderer } from 'electron'
import type { IpcInvokeMap, IpcSendMap, IpcOnMap } from '../src/shared/ipc-types'
import type { AiReminder, Task, TrainingStatus, SettingValue } from '../src/shared/types'

type InvokeKey = keyof IpcInvokeMap;
type SendKey = keyof IpcSendMap;
type OnKey = keyof IpcOnMap;

function invoke<K extends InvokeKey>(channel: K, ...args: IpcInvokeMap[K]['args']): Promise<IpcInvokeMap[K]['return']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeMap[K]['return']>;
}

function send<K extends SendKey>(channel: K, ...args: IpcSendMap[K]): void {
  ipcRenderer.send(channel, ...args);
}

function on<K extends OnKey>(channel: K, callback: IpcOnMap[K]): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => (callback as (...a: unknown[]) => void)(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  createTask: (title: string, tag?: string, type?: Task['type'], projectId?: number, parentId?: number, skipDedup?: boolean) => invoke('create-task', title, tag, type, projectId, parentId, skipDedup),
  updateTask: (id: number, updates: Record<string, unknown>) => invoke('update-task', id, updates),
  setSideFocus: (id: number, enabled: boolean) => invoke('set-side-focus', id, enabled),
  deleteTask: (id: number) => invoke('delete-task', id),
  deleteAllTasks: () => invoke('delete-all-tasks'),
  getTasks: () => invoke('get-tasks'),
  
  getProjects: () => invoke('get-projects'),
  createProject: (name: string, description?: string, color?: string) => invoke('create-project', name, description, color),
  updateProject: (id: number, updates: Record<string, unknown>) => invoke('update-project', id, updates),
  deleteProject: (id: number) => invoke('delete-project', id),
  getHistory: (dateStr?: string) => invoke('get-history', dateStr),
  deleteHistory: (id: number) => invoke('delete-history', id),

  getGpus: () => invoke('get-gpus'),
  createGpu: (name: string, color?: string) => invoke('create-gpu', name, color),
  deleteGpu: (id: number) => invoke('delete-gpu', id),
  assignTaskToGpu: (taskId: number, gpuId: number, durationMinutes: number) => send('gpu:assign-task', taskId, gpuId, durationMinutes),

  exportData: () => invoke('export-data'),
  importData: () => invoke('import-data'),

  getSettings: <T extends SettingValue = SettingValue>(key: string, defaultValue?: T) => invoke('get-settings', key, defaultValue) as Promise<T>,
  updateSetting: (key: string, value: unknown) => invoke('update-setting', key, value),
  registerShortcut: (shortcut: string) => invoke('register-shortcut', shortcut),
  unregisterShortcuts: () => invoke('unregister-shortcuts'),

  getSuggestions: (maxDuration?: number) => invoke('get-suggestions', maxDuration),
  identifyTarget: () => invoke('task:identify-target'),
  dispatchTask: (taskId: number) => invoke('task:dispatch', taskId),
  addMemo: (taskId: number, content: string) => send('timer:add-memo', taskId, content),
  
  startFocus: (taskId: number) => send('timer:start-focus', taskId),
  stopFocus: () => send('timer:stop-focus'),
  completeTask: (taskId: number) => send('timer:complete-task', taskId),
  startWait: (taskId: number, duration: number) => send('timer:start-wait', taskId, duration),
  cancelWait: (taskId: number) => send('timer:cancel-wait', taskId),
  stopTraining: (taskId: number, forceComplete?: boolean) => invoke('timer:stop-training', taskId, forceComplete),
  
  snoozeReminder: (taskId: number, minutes: number) => send('reminder:snooze', taskId, minutes),
  hideReminder: () => send('reminder:hide'),
  
  onTimerUpdate: (callback: (taskId: number, remaining: number) => void) => on('timer:update', callback),
  onTimerEnded: (callback: (taskId: number, task: Task | null) => void) => on('timer:ended', callback),
  onFetchTasks: (callback: () => void) => on('fetch-tasks', callback),
  onReminderRepeat: (callback: (taskId: number, task: Task) => void) => on('reminder:repeat', callback),
  onTrainingUpdate: (callback: (status: TrainingStatus) => void) => on('timer:training-update', callback),
  onAiReminder: (callback: (reminder: AiReminder) => void) => on('ai:reminder', callback),
  dismissAiReminder: (payload: { id?: string; source?: string; title?: string }) => send('ai:reminder-dismiss', payload),
  onAiReminderDismissed: (callback: (payload: { id?: string; source?: string; title?: string }) => void) => on('ai:reminder-dismissed', callback),

  hideSpotlight: () => send('spotlight:hide'),
  setOverlayIgnoreMouse: (ignore: boolean) => send('set-overlay-ignore-mouse', ignore),
  resetOverlayPosition: () => send('reset-overlay-position'),
  wandbUpdate: () => send('wandb:update'),
  wandbTest: (entity: string, apiKey: string) => invoke('wandb:test', entity, apiKey),
  openExternal: (url: string) => invoke('open-external', url),
  promoteAiToSoft: (source: string, title: string, detail?: string, link?: string) => invoke('ai-promote', source, title, detail, link),

  schedulerGetGpus: () => invoke('scheduler:get-gpus'),
  schedulerCreateGpu: (name: string, color?: string) => invoke('scheduler:create-gpu', name, color),
  schedulerUpdateGpu: (id: number, updates: Record<string, unknown>) => invoke('scheduler:update-gpu', id, updates),
  schedulerDeleteGpu: (id: number) => invoke('scheduler:delete-gpu', id),

  schedulerGetTasks: () => invoke('scheduler:get-tasks'),
  schedulerCreateTask: (title: string, estimatedHours?: number, color?: string) => invoke('scheduler:create-task', title, estimatedHours, color),
  schedulerUpdateTask: (id: number, updates: Record<string, unknown>) => invoke('scheduler:update-task', id, updates),
  schedulerDeleteTask: (id: number) => invoke('scheduler:delete-task', id),

  schedulerGetAssignments: () => invoke('scheduler:get-assignments'),
  schedulerCreateAssignment: (taskId: number, gpuId: number, startTime: string, durationHours: number) => invoke('scheduler:create-assignment', taskId, gpuId, startTime, durationHours),
  schedulerUpdateAssignment: (id: number, updates: Record<string, unknown>) => invoke('scheduler:update-assignment', id, updates),
  schedulerDeleteAssignment: (id: number) => invoke('scheduler:delete-assignment', id),
  schedulerClearAssignments: () => invoke('scheduler:clear-assignments'),

  getAutoLaunch: () => invoke('get-auto-launch'),
  setAutoLaunch: (enabled: boolean) => invoke('set-auto-launch', enabled),

  mdSyncSelectFolder: () => invoke('md-sync:select-folder'),
  mdSyncCheckFile: (folderPath: string) => invoke('md-sync:check-file', folderPath),
  mdSyncImport: (filePath: string, force: boolean, rootParentId?: number | null) => invoke('md-sync:import', filePath, force, rootParentId),
  mdSyncExport: (filePath: string, taskIds: number[]) => invoke('md-sync:export', filePath, taskIds),
  mdSyncSync: (filePath: string) => invoke('md-sync:sync', filePath),
  mdSyncCheckDuplicates: (titles: string[]) => invoke('md-sync:check-duplicates', titles),
  mdSyncReadFile: (filePath: string) => invoke('md-sync:read-file', filePath),
  mdSyncSetConfig: (enabled: boolean, folderPath: string) => invoke('md-sync:set-config', enabled, folderPath),
  mdSyncGetStatus: () => invoke('md-sync:get-status'),
})
