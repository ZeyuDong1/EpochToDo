/**
 * Mock window.api shim — enables browser preview without Electron.
 * Only activates when window.api is NOT already defined (i.e. in a browser, not Electron).
 * Provides in-memory CRUD so the UI is fully interactive, plus a webhook/TrainingStatus
 * simulator so GPU panels can be tested with virtual wandb metrics.
 */
(function () {
  if (typeof window !== 'undefined' && window.api) return; // Electron context — skip

  // --- In-memory data store ---
  let nextId = 100;
  const newId = () => ++nextId;
  const now = () => new Date().toISOString();
  const offset = (mins) => new Date(Date.now() + mins * 60000).toISOString();

  const projects = [
    { id: 1, name: 'EpochToDo Core', description: 'Main app development', created_at: offset(-14400), color: '#6366f1', activeCount: 3, totalFocused: 7200 },
    { id: 2, name: 'ML Research', description: 'Paper experiments', created_at: offset(-28800), color: '#f59e0b', activeCount: 2, totalFocused: 5400 },
    { id: 3, name: 'Website Revamp', description: 'Marketing site', created_at: offset(-7200), color: '#ec4899', activeCount: 1, totalFocused: 1800 },
  ];

  const tasks = [
    // Active focus task
    { id: 10, title: 'Implement Spotlight keyboard navigation', status: 'active', type: 'standard', context_memo: 'Need to add arrow-key support to spotlight results', total_duration: 1800, estimated_duration: 90, tag: 'frontend', project_id: 1, parent_id: null, is_next_action: 1, sort_order: 1, gpu_id: null, created_at: offset(-120), started_at: offset(-25), timer_type: 'focus', is_webhook: 0 },

    // Queued tasks
    { id: 11, title: 'Fix GPU scheduler drag-and-drop bug', status: 'queued', type: 'standard', total_duration: 3600, tag: 'bug', project_id: 1, parent_id: null, is_next_action: 1, sort_order: 2, gpu_id: null, created_at: offset(-180), last_focused_at: offset(-30), is_webhook: 0 },
    { id: 12, title: 'Refactor IPC type definitions', status: 'queued', type: 'standard', total_duration: 900, tag: 'refactor', project_id: 1, parent_id: null, is_next_action: 1, sort_order: 3, gpu_id: null, created_at: offset(-300), last_focused_at: offset(-60), is_webhook: 0 },
    { id: 13, title: '  Subtask: Split shared types into separate files', status: 'queued', type: 'standard', total_duration: 0, project_id: 1, parent_id: 12, is_next_action: 1, sort_order: 1, gpu_id: null, created_at: offset(-280), is_webhook: 0 },
    { id: 14, title: 'Write unit tests for timer hook', status: 'queued', type: 'standard', total_duration: 0, tag: 'testing', project_id: 1, parent_id: null, is_next_action: 1, sort_order: 4, gpu_id: null, created_at: offset(-200), is_webhook: 0 },

    { id: 15, title: 'Run BERT fine-tuning experiment', status: 'queued', type: 'standard', total_duration: 2400, tag: 'nlp', project_id: 2, parent_id: null, is_next_action: 1, sort_order: 1, gpu_id: null, created_at: offset(-400), last_focused_at: offset(-90), is_webhook: 0 },
    { id: 16, title: 'Collect and clean dataset v3', status: 'queued', type: 'standard', total_duration: 1800, tag: 'data', project_id: 2, parent_id: null, is_next_action: 1, sort_order: 2, gpu_id: null, created_at: offset(-500), is_webhook: 0 },

    { id: 17, title: 'Design new landing page hero', status: 'queued', type: 'standard', total_duration: 0, tag: 'design', project_id: 3, parent_id: null, is_next_action: 1, sort_order: 1, gpu_id: null, created_at: offset(-150), is_webhook: 0 },

    // Waiting tasks
    { id: 20, title: 'Waiting for code review feedback', status: 'waiting', type: 'standard', total_duration: 600, project_id: 1, parent_id: null, is_next_action: 0, sort_order: 1, gpu_id: null, created_at: offset(-600), target_timestamp: offset(15), timer_type: 'wait', is_webhook: 0 },
    { id: 21, title: 'Waiting for dataset upload', status: 'waiting', type: 'standard', total_duration: 300, project_id: 2, parent_id: null, is_next_action: 0, sort_order: 2, gpu_id: null, created_at: offset(-400), target_timestamp: offset(45), timer_type: 'wait', is_webhook: 0 },

    // Ad-hoc tasks (quick timers)
    { id: 30, title: 'Check Slack messages', status: 'waiting', type: 'ad-hoc', total_duration: 0, project_id: null, parent_id: null, is_next_action: 0, sort_order: 1, gpu_id: null, created_at: offset(-5), target_timestamp: offset(3), timer_type: 'wait', is_webhook: 0 },
    { id: 31, title: 'Stand up & stretch', status: 'waiting', type: 'ad-hoc', total_duration: 0, project_id: null, parent_id: null, is_next_action: 0, sort_order: 2, gpu_id: null, created_at: offset(-2), target_timestamp: offset(10), timer_type: 'wait', is_webhook: 0 },

    // Training tasks (on GPUs) — task 40 is an active webhook training task on GPU 1
    { id: 40, title: 'ResNet-50 ImageNet Training', status: 'active', type: 'training', total_duration: 36000, project_id: 2, parent_id: null, is_next_action: 0, sort_order: 1, gpu_id: 1, created_at: offset(-600), started_at: offset(-300), target_timestamp: offset(120), timer_type: 'training', is_webhook: 1, dispatched_target: '{"processName":"python.exe"}' },
    { id: 41, title: 'GPT-2 LoRA Fine-tuning', status: 'queued', type: 'training', total_duration: 0, project_id: 2, parent_id: null, is_next_action: 0, sort_order: 2, gpu_id: null, created_at: offset(-100), is_webhook: 0 },
  ];

  const gpus = [
    { id: 1, name: 'RTX 4090', color: '#22c55e', created_at: offset(-28800), activeTaskId: 40, last_active_at: offset(-5) },
    { id: 2, name: 'A100-80GB', color: '#3b82f6', created_at: offset(-28800), activeTaskId: null, last_active_at: offset(-120) },
    { id: 3, name: 'RTX 3090', color: '#f59e0b', created_at: offset(-14400), activeTaskId: null, last_active_at: offset(-360) },
  ];

  const today = new Date().toISOString().split('T')[0];
  const history = [
    { id: 1, task_id: 10, title: 'Implement Spotlight keyboard navigation', type: 'focus', start_time: offset(-50), end_time: offset(-25) },
    { id: 2, task_id: 11, title: 'Fix GPU scheduler drag-and-drop bug', type: 'focus', start_time: offset(-120), end_time: offset(-90) },
    { id: 3, task_id: 15, title: 'Run BERT fine-tuning experiment', type: 'focus', start_time: offset(-200), end_time: offset(-150) },
    { id: 4, task_id: 12, title: 'Refactor IPC type definitions', type: 'focus', start_time: offset(-240), end_time: offset(-210) },
    { id: 5, task_id: 14, title: 'Write unit tests for timer hook', type: 'training', start_time: offset(-300), end_time: offset(-250) },
    { id: 6, task_id: 16, title: 'Collect and clean dataset v3', type: 'focus', start_time: offset(-400), end_time: offset(-320) },
    { id: 7, task_id: 10, title: 'Implement Spotlight keyboard navigation', type: 'focus', start_time: offset(-600), end_time: offset(-500) },
  ];

  // Scheduler data
  const schedulerGpus = [
    { id: 1, name: 'RTX 4090', color: '#22c55e', created_at: now() },
    { id: 2, name: 'A100-80GB', color: '#3b82f6', created_at: now() },
  ];
  const schedulerTasks = [
    { id: 1, title: 'Train ResNet-50', estimated_hours: 8, status: 'running', color: '#22c55e', created_at: now() },
    { id: 2, title: 'Fine-tune BERT', estimated_hours: 4, status: 'pending', color: '#f59e0b', created_at: now() },
    { id: 3, title: 'Eval model on test set', estimated_hours: 2, status: 'pending', color: '#3b82f6', created_at: now() },
  ];
  const schedulerAssignments = [
    { id: 1, task_id: 1, gpu_id: 1, start_time: offset(-180), duration_hours: 8, created_at: now() },
    { id: 2, task_id: 2, gpu_id: 2, start_time: offset(300), duration_hours: 4, created_at: now() },
  ];

  const settings = {
    'wandb.entity': 'my-team',
    'wandb.project': 'epoch-todo',
    'overlay.shortcut': 'Alt+Space',
    'theme': 'dark',
    'autoArchiveDays': 7,
  };

  // --- Event listener registry (simulates ipcMain <-> preload bridge) ---
  const listeners = {};
  const on = (channel, cb) => {
    (listeners[channel] = listeners[channel] || []).push(cb);
    return () => { listeners[channel] = (listeners[channel] || []).filter(x => x !== cb); };
  };
  const emit = (channel, payload) => {
    (listeners[channel] || []).forEach(cb => { try { cb(payload); } catch (e) { console.error(e); } });
  };

  // --- Training status simulator (virtual wandb webhook) ---
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // In-memory training status map (mirrors TimerManager.trainingStatus)
  const trainingStatus = new Map();

  // Virtual wandb run state for the demo webhook
  const wandbRun = {
    taskId: 40,            // ResNet-50 on GPU 1
    cfgname: 'resnet50_imagenet_v3',
    modelName: 'ResNet-50',
    hostname: 'gpu-node-01',
    gpuname: 'NVIDIA GeForce RTX 4090',
    current_epoch: 42,
    max_epochs: 100,
    current_iter: 12345,
    max_iters: 30000,
    eta_hours: 3.5,
    wandbUrl: 'https://wandb.ai/my-team/epoch-todo/runs/abc123',
    stalled: false,
  };

  function buildWandbStatus() {
    return {
      taskId: wandbRun.taskId,
      gpuName: 'RTX 4090',
      modelName: wandbRun.modelName,
      eta: `${wandbRun.eta_hours.toFixed(1)}h`,
      metrics: {
        cfgname: wandbRun.cfgname,
        hostname: wandbRun.hostname,
        gpuname: wandbRun.gpuname,
        'train/current_epoch': wandbRun.current_epoch,
        'train/max_epochs': wandbRun.max_epochs,
        'train/current_iter': wandbRun.current_iter,
        'train/max_iters': wandbRun.max_iters,
        'train/eta_hours': wandbRun.eta_hours,
        loss: +(2.3 - wandbRun.current_epoch * 0.018).toFixed(4),
        accuracy: +(0.82 + wandbRun.current_epoch * 0.0016).toFixed(4),
        'train/lr': 0.0005,
      },
      lastUpdated: Date.now(),
      stalled: wandbRun.stalled,
      source: 'wandb',
      wandbUrl: wandbRun.wandbUrl,
    };
  }

  // Push a virtual wandb webhook update (equivalent to poller writing trainingStatus)
  function pushWandb() {
    const st = buildWandbStatus();
    trainingStatus.set(st.taskId, st);
    emit('training-update', st);
  }

  // Periodically advance the virtual run to simulate a live feed
  let tickTimer = null;
  let ticking = false;
  function startTick() {
    if (tickTimer) return;
    ticking = true;
    tickTimer = setInterval(() => {
      if (!ticking) return;
      if (wandbRun.current_epoch < wandbRun.max_epochs) wandbRun.current_epoch += 1;
      if (wandbRun.current_iter < wandbRun.max_iters) wandbRun.current_iter += 311;
      if (wandbRun.eta_hours > 0.1) wandbRun.eta_hours = +(wandbRun.eta_hours - 0.03).toFixed(2);
      pushWandb();
    }, 4000);
  }

  // --- Mock API ---
  window.api = {
    // Tasks
    getTasks: async () => clone(tasks),
    createTask: async (title, tag, type = 'standard', projectId = null, parentId = null) => {
      const t = { id: newId(), title, status: 'queued', type, total_duration: 0, tag: tag || undefined, project_id: projectId, parent_id: parentId, is_next_action: 1, sort_order: tasks.length + 1, gpu_id: null, created_at: now(), is_webhook: 0 };
      tasks.push(t);
      emit('fetch-tasks');
      return clone(t);
    },
    updateTask: async (id, updates) => {
      const t = tasks.find(x => x.id === id);
      if (t) Object.assign(t, updates);
      emit('fetch-tasks');
    },
    deleteTask: async (id) => {
      const i = tasks.findIndex(x => x.id === id);
      if (i >= 0) tasks.splice(i, 1);
      emit('fetch-tasks');
    },
    deleteAllTasks: async () => { tasks.length = 0; emit('fetch-tasks'); },

    // Projects
    getProjects: async () => clone(projects),
    createProject: async (name, description, color) => {
      const p = { id: newId(), name, description: description || null, created_at: now(), color: color || '#6366f1', activeCount: 0, totalFocused: 0 };
      projects.push(p);
      emit('fetch-tasks');
      return clone(p);
    },
    updateProject: async (id, updates) => {
      const p = projects.find(x => x.id === id);
      if (p) Object.assign(p, updates);
    },
    deleteProject: async (id) => {
      const i = projects.findIndex(x => x.id === id);
      if (i >= 0) projects.splice(i, 1);
    },

    // History
    getHistory: async (dateStr) => {
      if (!dateStr || dateStr === today) return clone(history);
      return [];
    },
    deleteHistory: async (id) => {
      const i = history.findIndex(x => x.id === id);
      if (i >= 0) history.splice(i, 1);
      emit('fetch-tasks');
    },

    // GPUs
    getGpus: async () => clone(gpus),
    createGpu: async (name, color) => {
      const g = { id: newId(), name, color: color || '#22c55e', created_at: now(), last_active_at: null };
      gpus.push(g);
      emit('fetch-tasks');
      return clone(g);
    },
    deleteGpu: async (id) => {
      const i = gpus.findIndex(x => x.id === id);
      if (i >= 0) gpus.splice(i, 1);
      emit('fetch-tasks');
    },
    assignTaskToGpu: (taskId, gpuId, durationMinutes) => {
      const t = tasks.find(x => x.id === taskId);
      if (t) { t.gpu_id = gpuId; t.status = 'active'; t.started_at = now(); t.target_timestamp = offset(durationMinutes); t.timer_type = 'training'; }
      emit('fetch-tasks');
    },

    // Focus / Timer control (in-memory simulation)
    startFocus: (taskId) => {
      const prev = tasks.find(x => x.id === 10 && x.status === 'active');
      if (prev) { prev.status = 'queued'; prev.started_at = null; prev.timer_type = null; }
      const t = tasks.find(x => x.id === taskId);
      if (t) { t.status = 'active'; t.started_at = now(); t.timer_type = 'focus'; t.is_next_action = 1; }
      emit('fetch-tasks');
    },
    stopFocus: () => {
      const t = tasks.find(x => x.status === 'active' && x.timer_type === 'focus');
      if (t) { t.status = 'queued'; t.started_at = null; t.timer_type = null; }
      emit('fetch-tasks');
    },
    completeTask: (taskId) => {
      const t = tasks.find(x => x.id === taskId);
      if (t) { t.status = 'archived'; t.started_at = null; }
      emit('fetch-tasks');
    },
    startWait: (taskId, duration) => {
      const t = tasks.find(x => x.id === taskId);
      if (t) { t.status = 'waiting'; t.target_timestamp = offset(duration / 60); t.timer_type = 'wait'; }
      emit('fetch-tasks');
    },
    cancelWait: (taskId) => {
      const t = tasks.find(x => x.id === taskId);
      if (t) {
        if (t.type === 'ad-hoc') {
          const i = tasks.findIndex(x => x.id === taskId);
          if (i >= 0) tasks.splice(i, 1);
        } else {
          t.status = 'queued'; t.target_timestamp = null; t.timer_type = null;
        }
      }
      emit('fetch-tasks');
    },
    stopTraining: async (taskId, forceComplete) => {
      const t = tasks.find(x => x.id === taskId);
      if (t) { t.status = forceComplete ? 'archived' : 'queued'; t.gpu_id = null; t.started_at = null; }
      trainingStatus.delete(taskId);
      emit('training-update', buildWandbStatus());
      emit('fetch-tasks');
    },

    // Memo
    addMemo: (taskId, content) => {
      const t = tasks.find(x => x.id === taskId);
      if (t) t.context_memo = content;
    },

    // Settings
    getSettings: async (key, defaultValue) => {
      if (key) return settings[key] !== undefined ? settings[key] : defaultValue;
      return clone(settings);
    },
    updateSetting: async (key, value) => { settings[key] = value; },

    // Reminders
    snoozeReminder: () => {},
    hideReminder: () => {},
    hideSpotlight: () => {},
    promoteAiToSoft: async () => {},

    // Overlay
    setOverlayIgnoreMouse: () => {},
    resetOverlayPosition: () => {},

    // W&B
    wandbUpdate: () => { pushWandb(); },
    wandbTest: async () => ({ valid: true, projectCount: 3, hostname: 'api.wandb.ai' }),

    // Shortcuts
    registerShortcut: async () => true,
    unregisterShortcuts: async () => true,

    // Suggestions / dispatch
    getSuggestions: async () => clone(tasks.filter(t => t.status === 'queued').slice(0, 5)),
    identifyTarget: async () => ({ processName: 'Code.exe', windowTitle: 'main.ts - Code', timestamp: now() }),
    dispatchTask: async () => ({ ok: true }),

    // Export / Import
    exportData: async () => ({ success: true, message: 'Exported (mock)' }),
    importData: async () => ({ success: true, message: 'Imported (mock)' }),

    // Open external
    openExternal: async (url) => { window.open(url, '_blank'); },

    // Auto-launch
    getAutoLaunch: async () => false,
    setAutoLaunch: async () => true,

    // Event listeners (return cleanup fn) — wire to registry
    onTimerUpdate: (cb) => on('timer-update', cb),
    onTimerEnded: (cb) => on('timer-ended', cb),
    onFetchTasks: (cb) => on('fetch-tasks', cb),
    onReminderRepeat: (cb) => on('reminder-repeat', cb),
    onTrainingUpdate: (cb) => on('training-update', cb),
    onAiReminder: (cb) => on('ai-reminder', cb),

    // Scheduler APIs
    schedulerGetGpus: async () => clone(schedulerGpus),
    schedulerCreateGpu: async (name, color) => {
      const g = { id: newId(), name, color: color || '#22c55e', created_at: now() };
      schedulerGpus.push(g);
      return clone(g);
    },
    schedulerUpdateGpu: async (id, updates) => {
      const g = schedulerGpus.find(x => x.id === id);
      if (g) Object.assign(g, updates);
    },
    schedulerDeleteGpu: async (id) => {
      const i = schedulerGpus.findIndex(x => x.id === id);
      if (i >= 0) schedulerGpus.splice(i, 1);
    },
    schedulerGetTasks: async () => clone(schedulerTasks),
    schedulerCreateTask: async (title, estimatedHours, color) => {
      const t = { id: newId(), title, estimated_hours: estimatedHours || 1, status: 'pending', color: color || '#6366f1', created_at: now() };
      schedulerTasks.push(t);
      return clone(t);
    },
    schedulerUpdateTask: async (id, updates) => {
      const t = schedulerTasks.find(x => x.id === id);
      if (t) Object.assign(t, updates);
    },
    schedulerDeleteTask: async (id) => {
      const i = schedulerTasks.findIndex(x => x.id === id);
      if (i >= 0) schedulerTasks.splice(i, 1);
    },
    schedulerGetAssignments: async () => clone(schedulerAssignments),
    schedulerCreateAssignment: async (taskId, gpuId, startTime, durationHours) => {
      const a = { id: newId(), task_id: taskId, gpu_id: gpuId, start_time: startTime, duration_hours: durationHours, created_at: now() };
      schedulerAssignments.push(a);
      return clone(a);
    },
    schedulerUpdateAssignment: async (id, updates) => {
      const a = schedulerAssignments.find(x => x.id === id);
      if (a) Object.assign(a, updates);
    },
    schedulerDeleteAssignment: async (id) => {
      const i = schedulerAssignments.findIndex(x => x.id === id);
      if (i >= 0) schedulerAssignments.splice(i, 1);
    },
    schedulerClearAssignments: async () => { schedulerAssignments.length = 0; },
  };

  // --- Webhook simulator test harness ---
  // Simulates the external webhook server (POST /hook -> updateTrainingStatus).
  window.__mock = {
    // Simulate a wandb-style webhook push for task 40 (ResNet-50 on GPU 1)
    pushWandb,
    // Advance the virtual run by one epoch immediately
    tick: pushWandb,
    // Toggle a live auto-feed of the virtual run (default OFF — enable to see live ticks)
    setLiveFeed: (on) => {
      ticking = !!on;
      if (on) startTick(); else if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    },
    // Simulate a stalled/crashed training task
    setStalled: (stalled) => {
      wandbRun.stalled = !!stalled;
      pushWandb();
    },
    // Simulate webhook completion (archives task, frees GPU)
    complete: async () => {
      const t = tasks.find(x => x.id === wandbRun.taskId);
      if (t) { t.status = 'archived'; t.gpu_id = null; }
      trainingStatus.delete(wandbRun.taskId);
      emit('training-update', buildWandbStatus());
      emit('fetch-tasks');
    },
    // Inspect current virtual run
    status: () => ({ ...wandbRun }),
    // Simulate the raw webhook POST body (matches docs/Webhook_Guide.md training schema)
    webhookPost: (body) => {
      if (body.eta || body.metrics || body.model_name || body.gpu_name) {
        const st = {
          taskId: body.task_id || wandbRun.taskId,
          gpuName: body.gpu_name,
          modelName: body.model_name,
          eta: body.eta,
          metrics: body.metrics || {},
          lastUpdated: Date.now(),
          stalled: false,
          source: 'webhook',
        };
        trainingStatus.set(st.taskId, st);
        emit('training-update', st);
        return { success: true, message: 'Training status updated (simulated webhook)' };
      }
      return { success: false, error: 'not a training update' };
    },
  };

  // Push the initial wandb status shortly after load (after App registers the listener)
  setTimeout(pushWandb, 600);

  // --- Floating test toolbar ---
  function injectToolbar() {
    if (document.getElementById('mock-webhook-toolbar')) return;
    const bar = document.createElement('div');
    bar.id = 'mock-webhook-toolbar';
    bar.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;display:flex;flex-direction:column;gap:6px;font-family:ui-monospace,monospace;font-size:11px;';
    const btn = (label, fn, color) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `cursor:pointer;border:1px solid ${color};color:${color};background:rgba(11,15,25,.85);padding:6px 10px;border-radius:8px;backdrop-filter:blur(4px);text-align:left;transition:all .15s;`;
      b.onmouseenter = () => { b.style.background = color; b.style.color = '#0B0F19'; };
      b.onmouseleave = () => { b.style.background = 'rgba(11,15,25,.85)'; b.style.color = color; };
      b.onclick = fn;
      return b;
    };
    const title = document.createElement('div');
    title.textContent = '🧪 Webhook 测试台';
    title.style.cssText = 'color:#67e8f9;font-weight:bold;margin-bottom:2px;text-shadow:0 0 6px rgba(103,232,249,.4);';
    const stats = document.createElement('div');
    stats.style.cssText = 'color:#94a3b8;background:rgba(11,15,25,.7);padding:4px 8px;border-radius:6px;border:1px solid #1f2937;';
    const refreshStats = () => {
      const s = wandbRun;
      stats.textContent = `epoch ${s.current_epoch}/${s.max_epochs} · ETA ${s.eta_hours.toFixed(1)}h · ${s.stalled ? 'STALLED' : 'running'}`;
    };
    refreshStats();

    bar.appendChild(title);
    bar.appendChild(stats);
    bar.appendChild(btn('🚀 推送 wandb 指标 (webhook)', () => { pushWandb(); refreshStats(); }, '#22c55e'));
    bar.appendChild(btn('▶ 启动实时推送 (每4s)', () => { startTick(); ticking = true; refreshStats(); }, '#f59e0b'));
    bar.appendChild(btn('⏸ 暂停实时推送', () => { ticking = false; if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } refreshStats(); }, '#94a3b8'));
    bar.appendChild(btn('⚠ 模拟停滞/崩溃', () => { wandbRun.stalled = !wandbRun.stalled; pushWandb(); refreshStats(); }, '#ef4444'));
    bar.appendChild(btn('✓ 模拟训练完成', async () => { await window.__mock.complete(); refreshStats(); }, '#818cf8'));

    // Refresh stats on every training update
    on('training-update', refreshStats);

    document.body.appendChild(bar);
  }
  // Wait for body to exist
  if (document.body) injectToolbar();
  else window.addEventListener('DOMContentLoaded', injectToolbar);

  console.log('%c[MockAPI] window.api mock loaded — browser preview mode', 'color:cyan;font-weight:bold');
  console.log('%c[MockAPI] Webhook simulator: window.__mock (pushWandb / setLiveFeed / setStalled / complete)', 'color:#67e8f9');
})();
