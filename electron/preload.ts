import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  createTask: (title: string, tag?: string, type?: string, projectId?: number, parentId?: number) => ipcRenderer.invoke('create-task', title, tag, type, projectId, parentId),
  updateTask: (id: number, updates: any) => ipcRenderer.invoke('update-task', id, updates),
  deleteTask: (id: number) => ipcRenderer.invoke('delete-task', id),
  deleteAllTasks: () => ipcRenderer.invoke('delete-all-tasks'),
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (name: string, description?: string, color?: string) => ipcRenderer.invoke('create-project', name, description, color),
  updateProject: (id: number, updates: any) => ipcRenderer.invoke('update-project', id, updates),
  deleteProject: (id: number) => ipcRenderer.invoke('delete-project', id),
  getHistory: (dateStr?: string) => ipcRenderer.invoke('get-history', dateStr),
  deleteHistory: (id: number) => ipcRenderer.invoke('delete-history', id),

  // GPU
  getGpus: () => ipcRenderer.invoke('get-gpus'),
  createGpu: (name: string, color?: string) => ipcRenderer.invoke('create-gpu', name, color),
  deleteGpu: (id: number) => ipcRenderer.invoke('delete-gpu', id),
  assignTaskToGpu: (taskId: number, gpuId: number, durationMinutes: number) => ipcRenderer.send('gpu:assign-task', taskId, gpuId, durationMinutes),

  exportData: () => ipcRenderer.invoke('export-data'),
  importData: () => ipcRenderer.invoke('import-data'),

  getSettings: (key: string, defaultValue?: any) => ipcRenderer.invoke('get-settings', key, defaultValue),
  updateSetting: (key: string, value: any) => ipcRenderer.invoke('update-setting', key, value),
  registerShortcut: (shortcut: string) => ipcRenderer.invoke('register-shortcut', shortcut),
  unregisterShortcuts: () => ipcRenderer.invoke('unregister-shortcuts'),

  getSuggestions: (maxDuration?: number) => ipcRenderer.invoke('get-suggestions', maxDuration),
  addMemo: (taskId: number, content: string) => ipcRenderer.send('timer:add-memo', taskId, content),
  
  startFocus: (taskId: number) => ipcRenderer.send('timer:start-focus', taskId),
  stopFocus: () => ipcRenderer.send('timer:stop-focus'),
  startWait: (taskId: number, duration: number) => ipcRenderer.send('timer:start-wait', taskId, duration),
  cancelWait: (taskId: number) => ipcRenderer.send('timer:cancel-wait', taskId),
  stopTraining: (taskId: number, forceComplete?: boolean) => ipcRenderer.invoke('timer:stop-training', taskId, forceComplete),
  
  // Reminder APIs
  snoozeReminder: (taskId: number, minutes: number) => ipcRenderer.send('reminder:snooze', taskId, minutes),
  hideReminder: () => ipcRenderer.send('reminder:hide'),
  
  onTimerUpdate: (callback: (taskId: number, remaining: number) => void) => {
    const listener = (_event: any, taskId: number, remaining: number) => callback(taskId, remaining);
    ipcRenderer.on('timer:update', listener);
    return () => ipcRenderer.removeListener('timer:update', listener);
  },
  onTimerEnded: (callback: (taskId: number, task: any) => void) => {
    const listener = (_event: any, taskId: number, task: any) => callback(taskId, task);
    ipcRenderer.on('timer:ended', listener);
    return () => ipcRenderer.removeListener('timer:ended', listener);
  },
  onFetchTasks: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('fetch-tasks', listener);
    return () => ipcRenderer.removeListener('fetch-tasks', listener);
  },
  onReminderRepeat: (callback: (taskId: number, task: any) => void) => {
    const listener = (_event: any, taskId: number, task: any) => callback(taskId, task);
    ipcRenderer.on('reminder:repeat', listener);
    return () => ipcRenderer.removeListener('reminder:repeat', listener);
  },
  hideSpotlight: () => ipcRenderer.send('spotlight:hide'),
  setOverlayIgnoreMouse: (ignore: boolean) => ipcRenderer.send('set-overlay-ignore-mouse', ignore),
})


