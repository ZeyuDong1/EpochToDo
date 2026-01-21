import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { Task, Project, Gpu } from '../../shared/types';
import { useCommandParser } from '../hooks/useCommandParser';
import { 
  Search, Clock, Brain, Check, X
} from 'lucide-react';
import clsx from 'clsx';

const CountDown = ({ target }: { target?: string }) => {
    const [display, setDisplay] = useState('--:--');
    
    useEffect(() => {
        if (!target) return;
        
        const tick = () => {
            const now = Date.now();
            const targetTime = new Date(target).getTime();
            const diff = targetTime - now;
            
            if (diff <= 0) {
                setDisplay('DONE');
                return;
            }
            
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            const secs = Math.floor((diff % 60000) / 1000);

            if (days > 0) {
                 setDisplay(`${days}:${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
            } else {
                 setDisplay(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
            }
        };
        
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [target]);
    
    return <span>{display}</span>;
}

export const Spotlight = () => {
  const [input, setInput] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [gpus, setGpus] = useState<Gpu[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [activeDuration, setActiveDuration] = useState(0);
  const [pendingReminders, setPendingReminders] = useState<Task[]>([]);
  const [showReminders, setShowReminders] = useState(true);
  const [confirmCompleteTask, setConfirmCompleteTask] = useState<Task | null>(null);
  const [projectHighlightIdx, setProjectHighlightIdx] = useState(0);

  useEffect(() => {
    if (confirmCompleteTask) setProjectHighlightIdx(0);
  }, [confirmCompleteTask]);
  
  // GPU Selection Mode
  const [selectGpuMode, setSelectGpuMode] = useState(false);
  const [pendingTrainingData, setPendingTrainingData] = useState<{ title: string; time: number; projectId?: number; sub?: string } | null>(null);

  const { parse } = useCommandParser();
  const p = parse(input);

  const fetchData = async () => {
    try {
      const [t, pr, g] = await Promise.all([
        window.api.getTasks(),
        window.api.getProjects(),
        window.api.getGpus()
      ]);
      // Sort tasks by creation time (Recent first)
      t.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setTasks(t);
      setProjects(pr);
      setGpus(g);
    } catch(err) { console.error(err); }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    setHighlightIdx(-1);
  }, [input]);

  // Use a ref to avoid stale closure for IPC listeners
  const fetchDataRef = useRef(fetchData);
  useEffect(() => {
      fetchDataRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    const u1 = window.api.onTimerUpdate(() => fetchDataRef.current());
    const u2 = window.api.onTimerEnded((_id: number, task: Task) => {
      // Add to pending reminders for overlay (Task 4)
      if (task) {
        setPendingReminders(prev => {
          if (prev.some(r => r.id === task.id)) return prev;
          return [...prev, task];
        });
        setShowReminders(true);
      }
      fetchDataRef.current();
    });
    
    // Listen for manual sync
    // @ts-ignore
    const u3 = window.api.onFetchTasks ? window.api.onFetchTasks(() => fetchDataRef.current()) : null;

    // Refetch on every window focus to sync with main page
    const handleFocus = () => fetchDataRef.current();
    window.addEventListener('focus', handleFocus);

    return () => { 
        // @ts-ignore
        u1?.(); u2?.(); u3?.();
        window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Sync pendingReminders with current tasks state to avoid duplicates if handled in Reminder window
  useEffect(() => {
    if (pendingReminders.length === 0) return;
    
    setPendingReminders(prev => prev.filter(r => {
      const currentTask = tasks.find(t => t.id === r.id);
      
      // If task is not found in active list, it was likely archived/completed
      if (!currentTask) return false;
      
      // If task exists but is no longer valid for reminder (e.g. snoozed/future)
      if (currentTask.status === 'archived') return false;
      
      // If snoozed, the target_timestamp will be in the future
      if (currentTask.target_timestamp) {
        const now = new Date();
        const target = new Date(currentTask.target_timestamp);
        // Allow a small buffer (e.g. 1 sec) for 'just finished' tasks, but snoozed ones will be minutes ahead
        if (target.getTime() > now.getTime() + 5000) return false;
      }
      
      return true;
    }));
  }, [tasks]);

  const activeTask = tasks.find(t => t.status === 'active' && t.timer_type === 'focus');
  const waitingTasks = tasks.filter(t => t.status === 'waiting' && t.type === 'standard');
  // Task 5: Filter out AD-HOC tasks from suggestions
  // Task 6: '#' Command to show Active Tasks for Completion
  const isCompleteMode = input.trim().startsWith('#');
  const isSubtaskParentSearch = p.isSubtask && p.parentSearch;
  
  const suggestions = input ? tasks.filter(t => {
      if (t.status === 'archived') return false;
      
      if (isCompleteMode) {
          // In complete mode, showing ACTIVE / WAITING tasks that are Standard (not background ad-hoc/training usually?)
          // User said "display all completed tasks" -> "come to complete task". 
          // Assuming "Candidates for completion".
          // Usually we want to complete Standard tasks. Ad-Hoc/Training are closed via 'X'. 
          // But maybe allow all? Let's allow standard tasks mainly, as they are the main workflow.
          // Or all active tasks.
          // Logic: Show all tasks that are NOT archived.
          const query = input.substring(1).trim().toLowerCase();
          return t.type !== 'ad-hoc' && t.type !== 'training' && 
                 (t.title.toLowerCase().includes(query));
      }

      // Subtask parent search mode: show tasks matching the parent search term
      if (isSubtaskParentSearch) {
          const searchTerm = p.parentSearch!.toLowerCase();
          return t.type === 'standard' && 
                 t.title.toLowerCase().includes(searchTerm);
      }

      return t.type !== 'ad-hoc' && t.type !== 'training' && // AD-HOC and TRAINING should not appear in NORMAL search
      (t.title.toLowerCase().includes(p.main?.toLowerCase() || '') || 
       (p.project && projects.find(pr => pr.id === t.project_id)?.name.toLowerCase().includes(p.project.toLowerCase())))
  }) : [];
  // Task 3: Get training tasks sorted by soonest countdown (first 3)
  const recentTraining = tasks
    .filter(t => t.type === 'training' && t.status === 'waiting')
    .sort((a, b) => {
      const timeA = a.target_timestamp ? new Date(a.target_timestamp).getTime() : Infinity;
      const timeB = b.target_timestamp ? new Date(b.target_timestamp).getTime() : Infinity;
      return timeA - timeB;
    })
    .slice(0, 3);

  useEffect(() => {
    if (activeTask) {
        const update = () => {
            if (!activeTask.started_at) {
                setActiveDuration(activeTask.total_duration);
                return;
            }
            const start = new Date(activeTask.started_at).getTime();
            const elapsed = Math.floor((Date.now() - start) / 1000);
            setActiveDuration(activeTask.total_duration + elapsed);
        };
        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    } else {
        setActiveDuration(0);
    }
  }, [activeTask?.id, activeTask?.started_at, activeTask?.total_duration]);

  const formatTime = (s: number) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) {
        return `${d}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const confirmGpuSelection = async (selectedGpu: Gpu) => {
        if (!pendingTrainingData) return;
        
        const type = 'training';
        const targetTask = await window.api.createTask(pendingTrainingData.title, undefined, type, pendingTrainingData.projectId);
        
        if (pendingTrainingData.sub) {
                await window.api.addMemo(targetTask.id, `Context: ${pendingTrainingData.sub}`);
        }

        // Calculate duration in minutes (p.time is seconds)
        const durationMins = Math.ceil(pendingTrainingData.time / 60);
        
        // Assign
        await window.api.assignTaskToGpu(targetTask.id, selectedGpu.id, durationMins);
        
        // Reset
        setSelectGpuMode(false);
        setPendingTrainingData(null);
        setInput('');
        window.api.hideSpotlight();
        fetchData();
  };

  const handleKeyDown = async (e: KeyboardEvent) => {
    if (confirmCompleteTask) {
        if (e.key === 'Escape') {
            e.preventDefault();
            setConfirmCompleteTask(null);
            return;
        }

        const needsProject = confirmCompleteTask.type === 'standard' && !confirmCompleteTask.project_id;
        
        if (needsProject) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (projects.length) setProjectHighlightIdx(prev => (prev + 1) % projects.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (projects.length) setProjectHighlightIdx(prev => (prev - 1 + projects.length) % projects.length);
            } else if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
                // Ctrl+number to select project and complete task
                e.preventDefault();
                const idx = parseInt(e.key) - 1;
                if (idx < projects.length) {
                    const selectedProj = projects[idx];
                    await window.api.updateTask(confirmCompleteTask.id, { project_id: selectedProj.id, status: 'archived' });
                    await window.api.cancelWait(confirmCompleteTask.id);
                    setConfirmCompleteTask(null);
                    setInput('');
                    window.api.hideSpotlight();
                    fetchData();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (projects.length > 0) {
                     const idx = projectHighlightIdx < 0 ? 0 : projectHighlightIdx;
                     const selectedProj = projects[idx];
                     await window.api.updateTask(confirmCompleteTask.id, { project_id: selectedProj.id, status: 'archived' });
                     await window.api.cancelWait(confirmCompleteTask.id);
                     setConfirmCompleteTask(null);
                     setInput('');
                     window.api.hideSpotlight();
                     fetchData();
                }
            }
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            await window.api.updateTask(confirmCompleteTask.id, { status: 'archived' });
            await window.api.cancelWait(confirmCompleteTask.id);
            setConfirmCompleteTask(null);
            setInput('');
            window.api.hideSpotlight();
            fetchData();
        }
        return;
    }

    if (selectGpuMode && pendingTrainingData) {
        if (e.key === 'Escape') {
            e.preventDefault();
            setSelectGpuMode(false);
            setPendingTrainingData(null);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (gpus.length) setHighlightIdx(s => (s + 1) % gpus.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (gpus.length) setHighlightIdx(s => (s === -1 ? gpus.length - 1 : (s - 1 + gpus.length) % gpus.length));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightIdx !== -1 && highlightIdx < gpus.length) {
                await confirmGpuSelection(gpus[highlightIdx]);
            }
        } else if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const idx = parseInt(e.key) - 1;
            if (idx < gpus.length) {
                await confirmGpuSelection(gpus[idx]);
            }
        }
        return;
    }

    if (e.key === 'Escape') {
      window.api.hideSpotlight();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length) setHighlightIdx(s => (s + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length) setHighlightIdx(s => (s === -1 ? suggestions.length - 1 : (s - 1 + suggestions.length) % suggestions.length));
    } else if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < suggestions.length) {
            const selected = suggestions[idx];
            
            if (isCompleteMode) {
                setConfirmCompleteTask(selected);
                return;
            }

            await window.api.startFocus(selected.id);
            setInput('');
            window.api.hideSpotlight();
        }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      
      if (isCompleteMode) {
          if (highlightIdx !== -1 && highlightIdx < suggestions.length) {
              setConfirmCompleteTask(suggestions[highlightIdx]);
          } else if (suggestions.length > 0) {
              setConfirmCompleteTask(suggestions[0]); // Default to first if none highlighted? Or do nothing?
          }
          return;
      }
      
      try {
        if (p.type === 'TRAINING' && p.time && !p.gpu) {
               // TRAINING with Time but no GPU specified -> Prompt Selection
               // THIS MUST BE CHECKED BEFORE THE GENERIC CREATE/FOCUS BLOCK
               let title = p.main || 'Training Task';
               let projectId: number | undefined;
               if (p.project) {
                   const found = projects.find(pr => pr.name.toLowerCase().includes(p.project!.toLowerCase()));
                   if (found) projectId = found.id;
               }

               setPendingTrainingData({
                   title,
                   time: p.time,
                   projectId,
                   sub: p.sub
               });
               setSelectGpuMode(true);
               setHighlightIdx(0); // Default to first GPU
               return; // Stop here, wait for second input
        } else if (p.type === 'MEMO' && p.memo && activeTask) {
           await window.api.addMemo(activeTask.id, p.memo);
        } else if (p.type === 'SUSPEND' && p.time && activeTask) {
           await window.api.startWait(activeTask.id, p.time * 60);
           if (p.memo) await window.api.addMemo(activeTask.id, p.memo);
         } else if (p.type === 'FOCUS' || p.type === 'CREATE' || p.type === 'AD_HOC' || p.type === 'TRAINING') {
            let title = p.main || '';
            let projectId: number | undefined;
            if (p.project) {
                const found = projects.find(pr => pr.name.toLowerCase().includes(p.project!.toLowerCase()));
                if (found) projectId = found.id;
            }
            let targetTask: Task | undefined;
            
            // Determine parent task for subtask creation
            let parentTaskId: number | undefined;
            if (p.isSubtask) {
                if (p.parentSearch) {
                    // Parent search mode: use highlighted suggestion as parent
                    if (highlightIdx !== -1 && highlightIdx < suggestions.length) {
                        parentTaskId = suggestions[highlightIdx].id;
                        // Inherit project from parent if not specified
                        if (projectId === undefined) {
                            projectId = suggestions[highlightIdx].project_id || undefined;
                        }
                    }
                } else {
                    // No search: use current active task as parent
                    if (activeTask) {
                        parentTaskId = activeTask.id;
                        // Inherit project from parent if not specified
                        if (projectId === undefined) {
                            projectId = activeTask.project_id || undefined;
                        }
                    }
                }
            }
            
            // Priority (only when NOT in subtask mode with parentSearch):
            // 1. Highlighted suggestion (if any)
            // 2. Exact match in specified project (or global if no project specified)
            // 3. Create new
            
            const isParentSearchMode = p.isSubtask && p.parentSearch;
            
            if (!isParentSearchMode) {
                if (highlightIdx !== -1 && highlightIdx < suggestions.length && p.type === 'FOCUS') {
                     targetTask = suggestions[highlightIdx];
                } else if (title) {
                    // Look for exact match
                    targetTask = tasks.find(t => 
                        t.title.toLowerCase() === title.toLowerCase() && 
                        (projectId !== undefined ? t.project_id === projectId : true) &&
                        t.status !== 'archived'
                    );
                }
            }

            if (!targetTask) {
              if (!title) return;
              const type = p.type === 'AD_HOC' ? 'ad-hoc' : p.type === 'TRAINING' ? 'training' : 'standard';
              targetTask = await window.api.createTask(title, undefined, type, projectId, parentTaskId);
              // Auto-promote new tasks created via Spotlight to Next Actions
              await window.api.updateTask(targetTask.id, { is_next_action: 1 });
            } else {
               // Update existing task project if specified
               if (projectId !== undefined) {
                  await window.api.updateTask(targetTask.id, { project_id: projectId });
               }
               // Also promote existing task to next action if focused via Spotlight
               await window.api.updateTask(targetTask.id, { is_next_action: 1 });
            }

           if (p.sub && targetTask) {
             await window.api.addMemo(targetTask.id, `Context: ${p.sub}`);
           }

            if (p.type === 'FOCUS') {
               if (p.time && activeTask) {
                  // The "Switch and Suspend" logic: ! Target @ Time
                  // Start wait for the PREVIOUSLY active task
                  await window.api.startWait(activeTask.id, p.time);
                  // And start focus for the NEW task
                  await window.api.startFocus(targetTask!.id);
               } else if (p.time) {
                  // No active task, just wait on target
                  await window.api.startWait(targetTask!.id, p.time);
               } else {
                  await window.api.startFocus(targetTask!.id);
               }
            } else if (p.type === 'CREATE') {
                // Just created/queued. Do nothing else.
                // Should we notify? Spotlight closes anyway.
                fetchData();
            } else if (p.gpu) {
               // TRAINING on specific GPU
               // Find GPU by name (fuzzy match?)
               const gpuCandidate = gpus.find(g => g.name.toLowerCase().includes(p.gpu!.toLowerCase()));
               if (gpuCandidate) {
                  // Determine duration (minutes). p.time is seconds.
                  const durationMins = p.time ? Math.ceil(p.time / 60) : 60; // Default 1h
                  await window.api.assignTaskToGpu(targetTask!.id, gpuCandidate.id, durationMins);
               } else {
                  // Create GPU dynamically? Or just fail? For now, assume user knows GPU name or creates it in Dashboard.
                  console.warn(`GPU not found: ${p.gpu}`);
                  // Fallback to queue if GPU not found
               }
               fetchData();
            } else {
               // AD_HOC or TRAINING (queued)
               if (p.time) {
                  await window.api.startWait(targetTask!.id, p.time);
               }
               // Force local refresh and allow IPC broadcast to propagate
               fetchData(); 
            }
         }

        setInput('');
        
        // Slight delay to ensure broadcasts are processed before hiding (helps with UI sync)
        setTimeout(() => window.api.hideSpotlight(), 50);

      } catch (err) {
        console.error(err);
      }
    }
  };

  return (
    <div className="relative w-[700px] bg-[#0F172A] rounded-xl shadow-2xl border border-[#334155] flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* 1. Input Bar */}
        <div className="p-4 bg-[#1E293B]/50 border-b border-[#334155] relative z-20">
            <div className="flex items-center gap-3">
                <Search className={clsx("w-5 h-5 transition-colors", input ? "text-[#10B981]" : "text-[#94A3B8]")} />
                <input 
                    autoFocus
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    type="text" 
                    className="bg-transparent w-full outline-none text-lg text-white placeholder-[#94A3B8]/30 font-light"
                    placeholder="Type task... (! focus, @ suspend, + ad-hoc, % training, > memo)" 
                />
            </div>
            {input && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-1 rounded border border-white/10 bg-white/5 text-emerald-400 capitalize">{p.type}</span>
                    <span className="text-[10px] text-[#94A3B8] bg-[#334155] px-1.5 rounded">↵ Enter</span>
                </div>
            )}
        </div>

        {/* 2. Active Zone */}
        <div className="flex flex-col bg-[#0F172A]/80">
            {activeTask ? (
                <div 
                    className="p-4 bg-[#10B981]/10 flex justify-between items-center relative overflow-hidden"
                    style={{ borderLeft: `4px solid ${projects.find(p => p.id === activeTask.project_id)?.color || '#10B981'}` }}
                >
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold bg-[#10B981] text-[#0F172A] px-1 rounded">FOCUS</span>
                            {(() => {
                                const pr = projects.find(p => p.id === activeTask.project_id);
                                return (
                                    <span 
                                        className="text-xs font-mono px-1.5 py-0.5 rounded"
                                        style={{ backgroundColor: `${pr?.color || '#334155'}22`, color: pr?.color || '#94A3B8', border: `1px solid ${pr?.color || '#334155'}44` }}
                                    >
                                        #{pr?.name || 'Inbox'}
                                    </span>
                                );
                            })()}
                        </div>
                        <div className="text-xl font-medium text-white truncate max-w-[400px]">
                            {activeTask.title}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-3xl font-mono text-[#10B981] tracking-tight font-bold tabular-nums">
                            + {formatTime(activeDuration)}
                        </div>
                    </div>
                </div>
            ) : (!selectGpuMode && (
                <div className="p-4 bg-[#1E293B]/20 text-center text-[#94A3B8] italic text-sm">
                    No active focus. Start something!
                </div>
            ))}

            {/* Waiting Tasks */}
            {!selectGpuMode && waitingTasks.length > 0 && (
                <div className="bg-[#1E293B]/30 border-t border-[#334155]/50">
                    {waitingTasks.map(t => {
                        const pr = projects.find(p => p.id === t.project_id);
                        return (
                            <div 
                                key={t.id} 
                                className="px-4 py-2 bg-[#F59E0B]/10 flex justify-between items-center group cursor-pointer hover:bg-white/5 relative overflow-hidden" 
                                style={{ borderLeft: `4px solid ${pr?.color || '#F59E0B'}` }}
                                onClick={() => window.api.startFocus(t.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <Clock className="w-4 h-4" style={{ color: pr?.color || '#F59E0B' }} />
                                    <div>
                                        <div className="text-gray-300 text-sm">{t.title}</div>
                                        <div className="text-[10px] text-[#94A3B8] capitalize">{pr?.name || 'Inbox'}</div>
                                    </div>
                                </div>
                                <div className="font-mono font-bold" style={{ color: pr?.color || '#F59E0B' }}>
                                    - <CountDown target={t.target_timestamp} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>

        
        {/* 2.5 Training Tasks (Task 3: Compact single-row display) */}
        {!selectGpuMode && recentTraining.length > 0 && (
            <div className="bg-[#0F172A]/80 border-t border-[#334155]/50 px-4 py-2">
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-green-400/70 font-bold whitespace-nowrap">
                        <Brain size={12} />
                        Training
                    </span>
                    <div className="flex-1 flex gap-2 overflow-x-auto">
                        {recentTraining.map(t => (
                            <div 
                                key={t.id} 
                                className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg group hover:bg-green-500/20 cursor-pointer transition-all flex-shrink-0"
                                onClick={async () => {
                                    await window.api.cancelWait(t.id);
                                    fetchData();
                                }}
                            >
                                <span className="text-gray-300 text-xs truncate max-w-[120px]" title={t.title}>{t.title}</span>
                                <span className="font-mono font-bold text-green-500 text-xs">
                                    <CountDown target={t.target_timestamp} />
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {/* 3. Suggestions / Backlog OR GPU Selection */}
        <div className="flex-1 overflow-y-auto bg-[#0F172A]/50 border-t border-[#334155]/50 custom-scrollbar">
            <div className="px-4 py-2 flex justify-between items-center text-[10px] uppercase tracking-wider text-[#94A3B8] font-bold bg-[#0F172A]/90 backdrop-blur z-10">
                <span>{selectGpuMode ? 'Select GPU for Training' : (input ? 'Suggestions' : 'Recent / Backlog')}</span>
                <span className="bg-[#1E293B] px-1.5 rounded text-white">{selectGpuMode ? gpus.length : (input ? suggestions.length : tasks.filter(t => t.status === 'queued').length)}</span>
            </div>
            
            <ul className="divide-y divide-[#334155]/20">
                {selectGpuMode ? (
                    gpus.map((gpu, idx) => {
                        // Check if GPU is busy
                        const busyTask = tasks.find(t => t.gpu_id === gpu.id && t.status === 'active');
                        return (
                             <li 
                               key={gpu.id} 
                               className={clsx(
                                 "px-4 py-3 border-b border-[#334155]/10 flex justify-between items-center cursor-pointer transition-colors relative transition-all group",
                                 (idx === highlightIdx) ? "bg-white/10" : "hover:bg-white/5"
                               )}
                               onClick={() => confirmGpuSelection(gpu)}
                             >
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: busyTask ? '#22c55e' : '#64748b' }}></div>
                                    <span className={clsx("font-bold", idx === highlightIdx ? "text-white" : "text-gray-300")}>{gpu.name}</span>
                                    {busyTask && (
                                        <span className="text-[10px] text-orange-400 bg-orange-400/10 px-1 rounded border border-orange-400/20">
                                            Busy: {busyTask.title}
                                        </span>
                                    )}
                                </div>
                                <div className="text-[10px] text-gray-500 font-mono flex gap-2">
                                    {idx < 9 && (
                                        <span className="bg-[#334155] px-1.5 py-0.5 rounded text-[#94A3B8]">^{idx + 1}</span>
                                    )}
                                    {idx === highlightIdx ? 'Press Enter' : ''}
                                </div>
                            </li>
                        );
                    })
                ) : (
                (input ? suggestions : tasks.filter(t => t.status === 'queued' && t.is_next_action === 1).slice(0, 10)).map((t, idx) => {
                    const project = projects.find(pr => pr.id === t.project_id);
                    return (
                        <li 
                          key={t.id} 
                          onClick={() => { window.api.startFocus(t.id); setInput(''); window.api.hideSpotlight(); }}
                          className={clsx(
                            "px-4 py-3 border-b border-[#334155]/10 flex justify-between items-center cursor-pointer transition-colors relative transition-all group",
                            (input && idx === highlightIdx) ? "bg-white/10" : "hover:bg-white/5"
                          )}
                          style={{ borderLeft: `4px solid ${project?.color || '#334155'}` }}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span 
                                        className="text-[9px] font-bold px-1.5 py-0.5 rounded leading-none uppercase tracking-tighter"
                                        style={{ 
                                            backgroundColor: `${project?.color || '#334155'}22`, 
                                            color: project?.color || '#94A3B8', 
                                            border: `1px solid ${project?.color || '#334155'}44` 
                                        }}
                                    >
                                        {project ? project.name : 'Inbox'}
                                    </span>
                                    {t.tag && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded leading-none uppercase tracking-tighter bg-emerald-500/20 text-emerald-400 border border-emerald-500/20">
                                            #{t.tag}
                                        </span>
                                    )}
                                </div>
                                <div className={clsx("text-sm font-medium truncate", (input && idx === highlightIdx) ? "text-white" : "text-gray-300")}>
                                    {t.title}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {input && idx < 9 && (
                                    <span className="text-[10px] font-mono text-gray-500 bg-white/5 px-1 rounded border border-white/5">
                                        ^{idx + 1}
                                    </span>
                                )}
                                {t.total_duration > 0 && (
                                    <div className="text-[10px] text-[#94A3B8] font-mono bg-[#1E293B] px-1.5 py-0.5 rounded ml-2 whitespace-nowrap">
                                        {Math.floor(t.total_duration / 60)}m
                                    </div>
                                )}
                            </div>
                        </li>
                    );
                }))}
                {input && suggestions.length === 0 && !selectGpuMode && (
                    <li className="p-8 text-center text-[#94A3B8] italic text-sm">
                        No matches. Press Enter to create "{p.main}"
                    </li>
                )}
            </ul>
        </div>

        {/* 4. Footer & Hints */}
        <div className="bg-[#1E293B] px-4 py-2 border-t border-[#334155] flex flex-col gap-2">
            <div className="flex justify-between items-center text-xs text-[#94A3B8]">
                <span>Total Focus Today: <b className="text-[#10B981]">0.0h</b></span>
                <div className="flex gap-2">
                    <span className="border border-[#334155] px-1 rounded bg-[#0F172A]/50">↑↓ Nav</span>
                    <span className="border border-[#334155] px-1 rounded bg-[#0F172A]/50">Esc Hide</span>
                </div>
            </div>
            <div className="p-2 grid grid-cols-2 gap-x-4 text-[10px] text-gray-400 font-mono border-t border-[#334155]/50">
                  <div><span className="text-[#10B981] font-bold">! Task @ 20m</span> Switch &amp; Suspend</div>
                  <div><span className="text-blue-400 font-bold">&gt; Memo</span> Add to Active</div>
                  <div><span className="text-amber-500 font-bold">+ Task @ 1h</span> Ad-hoc Task</div>
                  <div><span className="text-green-500 font-bold">% Training @ 2h</span> Training Task</div>
                  <div><span className="text-green-400 font-bold">Task ` GPU</span> GPU Task</div>
                  <div><span className="text-purple-400 font-bold">!Task:</span> Subtask of Focus</div>
            </div>
        </div>

        {/* Task 4: Pending Reminders Overlay */}
        {showReminders && pendingReminders.length > 0 && (
            <div className="absolute inset-0 bg-[#0F172A]/95 backdrop-blur-sm z-50 flex flex-col rounded-xl overflow-hidden">
                <div className="p-6 flex-1 overflow-y-auto">
                    <div className="text-center mb-6">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-500/20 text-indigo-400 mb-3 animate-pulse">
                            <Clock size={24} />
                        </div>
                        <h2 className="text-lg font-bold text-white">Tasks Ready</h2>
                        <p className="text-sm text-gray-400 mt-1">These tasks have finished their countdown</p>
                    </div>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {pendingReminders.map((task, idx) => (
                            <div 
                                key={task.id}
                                className="flex justify-between items-center p-3 bg-white/5 border border-white/10 rounded-lg group hover:bg-white/10 transition-all"
                            >
                                <div className="flex items-center gap-3">
                                    {task.type === 'training' ? (
                                        <Brain size={18} className="text-green-500" />
                                    ) : (
                                        <Clock size={18} className="text-amber-500" />
                                    )}
                                    <div>
                                        <div className="text-white font-medium">{task.title}</div>
                                        <div className="text-[10px] text-gray-500 uppercase">{task.type}</div>
                                    </div>
                                </div>
                                <button
                                    onClick={async () => {
                                        if (task.type === 'training') {
                                            await window.api.cancelWait(task.id);
                                        } else {
                                            await window.api.updateTask(task.id, { status: 'archived' });
                                            await window.api.cancelWait(task.id);
                                        }
                                        setPendingReminders(prev => prev.filter((_, i) => i !== idx));
                                        fetchData();
                                    }}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500 hover:text-white transition-all font-semibold text-sm"
                                >
                                    <Check size={14} />
                                    Done
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-4 border-t border-white/10 bg-black/30">
                    <button
                        onClick={() => setShowReminders(false)}
                        className="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-400 rounded-lg font-medium transition-all flex items-center justify-center gap-2"
                    >
                        <X size={16} />
                        Skip and continue to Spotlight
                    </button>
                </div>
            </div>
        )}
        
        {/* Task 6: Completion Confirmation Modal */}
        {confirmCompleteTask && (
             <div className="absolute inset-0 bg-[#0F172A]/95 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-200">
                 <div className="bg-[#1E293B] border border-[#334155] p-6 rounded-xl shadow-2xl max-w-sm w-full">
                     <h3 className="text-lg font-bold text-white mb-2">
                        {(confirmCompleteTask.type === 'standard' && !confirmCompleteTask.project_id) ? 'Select Project & Complete' : 'Complete this task?'}
                     </h3>
                     <div className="p-4 bg-black/20 rounded border border-white/5 mb-6 text-gray-300">
                         {confirmCompleteTask.title}
                     </div>
                     
                     {(confirmCompleteTask.type === 'standard' && !confirmCompleteTask.project_id) ? (
                        <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto mb-4 border-t border-b border-white/10 py-2 custom-scrollbar text-left">
                            {projects.map((p, idx) => (
                                <div 
                                    key={p.id}
                                    className={clsx(
                                        "px-3 py-2 rounded cursor-pointer flex items-center gap-2",
                                        idx === projectHighlightIdx ? "bg-indigo-600 text-white" : "hover:bg-white/5 text-gray-400"
                                    )}
                                    onClick={async () => {
                                         await window.api.updateTask(confirmCompleteTask.id, { project_id: p.id, status: 'archived' });
                                         await window.api.cancelWait(confirmCompleteTask.id);
                                         setConfirmCompleteTask(null);
                                         setInput('');
                                         window.api.hideSpotlight();
                                         fetchData();
                                    }}
                                >
                                    {idx < 9 && <span className="text-[10px] bg-white/10 text-gray-500 px-1 rounded font-mono">^{idx + 1}</span>}
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }}></div>
                                    <span className="flex-1 truncate">{p.name}</span>
                                    {idx === projectHighlightIdx && <span className="text-[10px] bg-white/20 px-1 rounded">↵</span>}
                                </div>
                            ))}
                        </div>
                     ) : (
                         <div className="flex gap-3 justify-center">
                             <button 
                                 onClick={(e) => { e.preventDefault(); setConfirmCompleteTask(null); }}
                                 className="px-4 py-2 rounded bg-white/5 hover:bg-white/10 text-gray-400 font-medium transition-colors border border-transparent"
                             >
                                 Cancel (Esc)
                             </button>
                             <button 
                                 onClick={async () => {
                                    await window.api.updateTask(confirmCompleteTask.id, { status: 'archived' });
                                    await window.api.cancelWait(confirmCompleteTask.id);
                                    setConfirmCompleteTask(null);
                                    setInput('');
                                    window.api.hideSpotlight();
                                    fetchData();
                                 }}
                                 className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-colors shadow-lg shadow-indigo-500/20"
                             >
                                 Complete (Enter)
                             </button>
                         </div>
                     )}
                 </div>
             </div>
        )}
    </div>
  );
};

