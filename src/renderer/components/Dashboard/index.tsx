import { useState, useEffect, useRef, DragEvent } from 'react';
import { Task, Project, HistoryEntry, Gpu } from '../../../shared/types';
import { 
  Play, Timer, Brain, Edit, 
  GripVertical, Plus, Folder, X, Trash2
} from 'lucide-react';
import clsx from 'clsx';
import { Timeline } from '../Timeline';

// --- Utilities ---
const useTimer = (activeTask: Task | null) => {
  const [display, setDisplay] = useState('00:00:00');
  
  useEffect(() => {
    if (!activeTask) {
      setDisplay('00:00:00');
      return;
    }
    
    const format = (s: number) => {
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (d > 0) {
            return `${d}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
        }
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    };

    const updateLabel = () => {
        if (!activeTask.started_at) {
            setDisplay(format(activeTask.total_duration));
            return;
        }
        const start = new Date(activeTask.started_at).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - start) / 1000);
        setDisplay(format(activeTask.total_duration + elapsed));
    };

    updateLabel();
    const interval = setInterval(updateLabel, 1000);
    return () => clearInterval(interval);
  }, [activeTask?.id, activeTask?.started_at, activeTask?.total_duration]);

  return display;
};

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
const IdleTimer = ({ start }: { start?: string | null }) => {
    const [elapsed, setElapsed] = useState('');
    
    useEffect(() => {
        if (!start) {
            setElapsed('');
            return;
        }
        
        const update = () => {
            const now = Date.now();
            const val = new Date(start).getTime();
            if (isNaN(val)) return;
            const s = Math.floor((now - val) / 1000);
            
            const d = Math.floor(s / 86400);
            const h = Math.floor((s % 86400) / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = s % 60;
            
            let str = '';
            if (d > 0) str += `${d}d `;
            if (h > 0 || d > 0) str += `${h}h `;
            str += `${m}m ${sec}s`;
            setElapsed(str);
        };
        
        update();
        const int = setInterval(update, 1000);
        return () => clearInterval(int);
    }, [start]);
    
    if (!elapsed) return <span className="italic">Idle</span>;
    return <span className="font-mono text-gray-500">Idle: {elapsed}</span>;
};

const DurationInputModal = ({ isOpen, onClose, onConfirm }: { isOpen: boolean, onClose: () => void, onConfirm: (minutes: number) => void }) => {
    const [val, setVal] = useState('60');
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
             <div className="bg-[#1E293B] border border-[#334155] p-6 rounded-xl shadow-2xl max-w-sm w-full">
                 <h3 className="text-lg font-bold text-white mb-4">Set Duration</h3>
                 <div className="mb-4">
                     <label className="block text-xs uppercase text-gray-400 font-bold mb-2">Duration (Minutes)</label>
                     <input 
                        type="number" 
                        value={val} 
                        onChange={e => setVal(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter') onConfirm(parseInt(val));
                            if (e.key === 'Escape') onClose();
                        }}
                     />
                 </div>
                 <div className="flex justify-end gap-2">
                     <button onClick={onClose} className="px-3 py-1.5 text-gray-400 hover:text-white">Cancel</button>
                     <button onClick={() => onConfirm(parseInt(val))} className="px-3 py-1.5 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-500">Confirm</button>
                 </div>
             </div>
        </div>
    );
};

const CreateGpuModal = ({ isOpen, onClose, onConfirm }: { isOpen: boolean, onClose: () => void, onConfirm: (name: string) => void }) => {
    const [val, setVal] = useState('');
    if (!isOpen) return null;
    return (
         <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
             <div className="bg-[#1E293B] border border-[#334155] p-6 rounded-xl shadow-2xl max-w-sm w-full">
                 <h3 className="text-lg font-bold text-white mb-4">Add New GPU</h3>
                 <input 
                    value={val} 
                    onChange={e => setVal(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white mb-4 focus:outline-none focus:border-green-500"
                    placeholder="e.g. RTX 4090-1"
                    autoFocus
                 />
                 <div className="flex justify-end gap-2">
                     <button onClick={onClose} className="px-3 py-1.5 text-gray-400 hover:text-white">Cancel</button>
                     <button onClick={() => onConfirm(val)} className="px-3 py-1.5 bg-green-600 text-white rounded font-bold hover:bg-green-500">Add GPU</button>
                 </div>
             </div>
        </div>
    );
};

import { ConfirmModal } from '../ConfirmModal';
import { StopTrainingModal } from '../StopTrainingModal';

// --- Components ---
import { Sidebar } from '../Sidebar';
import { ProjectView } from '../ProjectView';
import { SettingsView } from '../SettingsView';

interface DashboardViewProps {
    tasks: Task[];
    projects: Project[];
    history: HistoryEntry[];
    gpus: Gpu[]; // New prop
    viewDate: Date;
    setViewDate: (date: Date) => void;
    fetchData: () => void;
    completeTask: (taskId: number) => void;
    deleteTask: (taskId: number) => void;
    deleteHistory: (entryId: number) => void;
    switchProject: (projectId: number) => void;
    createGpu: (name: string) => void;
    deleteGpu: (id: number) => void;
    assignTaskToGpu: (taskId: number, gpuId: number, durationMinutes: number) => void;
}

// --- Dashboard View Component ---
const DashboardView = ({ 
    tasks, 
    projects, 
    history,
    gpus,
    viewDate, 
    setViewDate, 
    fetchData,
    completeTask,
    deleteTask,
    deleteHistory,
    switchProject,
    createGpu,
    deleteGpu,
    assignTaskToGpu
}: DashboardViewProps) => {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [showGpuModal, setShowGpuModal] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState<{taskId: number, gpuId: number} | null>(null);
  const [confirmStopTaskId, setConfirmStopTaskId] = useState<number | null>(null);

  // Resizing Logic
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
      const saved = localStorage.getItem('dashboard-right-width');
      return saved ? parseInt(saved) : 320;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    localStorage.setItem('dashboard-right-width', rightPanelWidth.toString());
  }, [rightPanelWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing) return;
        e.preventDefault();
        // Calculate new width: Total Window Width - Mouse X
        // We assume the right panel is docked to the right.
        const newWidth = document.body.clientWidth - e.clientX;
        // Constraints
        if (newWidth >= 250 && newWidth <= 600) {
            setRightPanelWidth(newWidth);
        }
    };

    const handleMouseUp = () => {
        setIsResizing(false);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto'; // Re-enable text selection
    };

    if (isResizing) {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none'; // Prevent text selection while dragging
    }

    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);
  
  const isChildOf = (potentialChildId: number, potentialParentId: number) => {
      let currId: number | null | undefined = tasks.find((t:any) => t.id === potentialChildId)?.parent_id;
      while(currId) {
          if(currId === potentialParentId) return true;
          currId = tasks.find((t:any) => t.id === currId)?.parent_id;
      }
      return false;
  };

  const activeTask = tasks.find((t:any) => t.status === 'active' && t.timer_type === 'focus') || null;
  const waitingTasks = tasks.filter((t:any) => t.status === 'waiting' && t.type === 'standard');
  const adHocTasks = tasks.filter((t:any) => t.type === 'ad-hoc' && t.status !== 'archived');
  const queuedTasks = tasks.filter((t:any) => t.status === 'queued' && t.type === 'standard' && t.is_next_action === 1);
  const trainingQueue = tasks.filter((t:any) => t.type === 'training' && t.status === 'queued');
  // Helpers to get active training task per GPU
  const getGpuTask = (gpuId: number) => tasks.find((t:any) => t.type === 'training' && t.status === 'active' && t.gpu_id === gpuId);

  const focusDisplay = useTimer(activeTask);

  // --- Drag & Drop Handlers (Keep same logic) ---
  const handleDragStart = (e: DragEvent, id: number) => {
    setDraggingId(id);
    e.dataTransfer.setData('text/plain', String(id));
    e.dataTransfer.effectAllowed = 'move';
    let target = e.currentTarget as HTMLElement;
    if (!target.classList.contains('task-card')) {
        const card = target.closest('.task-card');
        if (card) target = card as HTMLElement;
    }
    target.style.opacity = '0.5';
  };

  const handleDragEnd = (e: DragEvent) => {
    setDraggingId(null);
    let target = e.currentTarget as HTMLElement;
    if (!target.classList.contains('task-card')) {
        const card = target.closest('.task-card');
        if (card) target = card as HTMLElement;
    }
    target.style.opacity = '1';
    document.querySelectorAll('.drag-over-child').forEach(el => el.classList.remove('drag-over-child'));
  };

  const handleDragOver = (e: DragEvent, targetId?: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggingId === targetId) return;
    const target = e.currentTarget as HTMLElement;
    target.classList.add('drag-over-child');
  };

  const handleDragLeave = (e: DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.classList.remove('drag-over-child');
  };

  const handleDrop = async (e: DragEvent, targetId: number) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.classList.remove('drag-over-child');
    
    if (draggingId && draggingId !== targetId) {
        if (isChildOf(targetId, draggingId)) {
            alert("Cannot move a parent task into its own subtask.");
            setDraggingId(null);
            return;
        }
        const targetTask = tasks.find((t:any) => t.id === targetId);
        if (targetTask) {
            await window.api.updateTask(draggingId, { 
                parent_id: targetId,
                project_id: targetTask.project_id
            });
            fetchData();
        }
    }
    setDraggingId(null);
  };

  const handleDropRoot = async (e: DragEvent, projectId: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggingId) {
        await window.api.updateTask(draggingId, {
            parent_id: null,
            project_id: projectId
        // @ts-ignore
        } as any);
        fetchData();
    }
  };

  // --- Render Helpers ---
  const renderTaskRow = (t: Task, level: number = 0) => {
    const children = queuedTasks.filter((c:any) => c.parent_id === t.id);
    
    return (
      <div key={t.id} className="group relative mb-2" style={{ paddingLeft: level > 0 ? 20 : 0 }}>
        {level > 0 && (
            <>
                <div className="absolute left-[-12px] top-0 bottom-0 w-[2px] bg-[#374151]"></div>
                <div className="absolute left-[-12px] top-[1.5rem] w-[12px] h-[2px] bg-[#374151]"></div>
            </>
        )}
        
        <div 
          className={clsx(
              "task-card flex items-center justify-between p-3 bg-[#111827]/50 border border-[#1f2937] rounded-lg hover:bg-[#1f2937] hover:border-gray-700 transition-all select-none",
              draggingId === t.id && "bg-[#1f2937] border-dashed border-indigo-500 opacity-50"
          )}
          // Removed draggable/start/end from here
          onDragOver={(e) => handleDragOver(e, t.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, t.id)}
        >
          <div className="flex items-center gap-3 flex-1 overflow-hidden">
             <div
                draggable
                onDragStart={(e) => {
                    // Set drag image to the main card
                    const card = e.currentTarget.closest('.task-card');
                    if (card) {
                       e.dataTransfer.setDragImage(card, 0, 0);
                    }
                    handleDragStart(e, t.id);
                }}
                onDragEnd={handleDragEnd}
                className="cursor-grab p-1 -ml-1 hover:bg-[#1f2937] rounded flex items-center justify-center"
             >
                <GripVertical size={16} className="text-gray-700 hover:text-gray-400" />
             </div>
             {(() => {
                const pr = projects.find((p:any) => p.id === t.project_id);
                return (
                    <div 
                        className="w-1.5 h-full absolute left-0 top-0 rounded-l cursor-grab" 
                        style={{ backgroundColor: pr?.color || 'transparent' }}
                    />
                );
             })()}
             <div className="flex flex-col truncate">
                <span className="text-sm text-gray-200 font-medium truncate">{t.title}</span>
                <span className="text-[10px] text-gray-500 font-mono">
                   {t.total_duration > 0 ? `${Math.ceil(t.total_duration/60)}m logged` : 'Not started'}
                   {t.tag && ` • #${t.tag}`}
                </span>
             </div>
          </div>

          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={(e) => { e.stopPropagation(); window.api.startFocus(t.id); }}
              className="p-1.5 text-gray-500 hover:text-green-400 hover:bg-gray-800 rounded transition-colors"
              title="Start Focus"
            >
              <Play size={14} fill="currentColor" />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); completeTask(t.id); }}
              className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-gray-800 rounded transition-colors"
              title="Complete Task"
            >
              <Plus size={14} className="rotate-45" /> 
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); deleteTask(t.id); }}
              className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded transition-colors"
              title="Delete Task"
            >
              <Trash2 size={14} /> 
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); /* TODO: Edit logic */ }}
              className="p-1.5 text-gray-500 hover:text-indigo-400 hover:bg-gray-800 rounded transition-colors"
              title="Edit Task"
            >
              <Edit size={14} /> 
            </button>
          </div>
        </div>

        {children.length > 0 && (
            <div className="relative ml-2 border-l border-[#1f2937]/50">
               {children.map((c:any) => renderTaskRow(c, level + 1))}
            </div>
        )}
      </div>
    );
  };

  // Group queued tasks
  const projectGroups = projects.map((p:any) => ({
    project: p,
    tasks: queuedTasks.filter((t:any) => t.project_id === p.id && !t.parent_id)
  }));
  const inboxTasks = queuedTasks.filter((t:any) => !t.project_id && !t.parent_id);
  if (inboxTasks.length > 0) {
      projectGroups.unshift({ 
          project: { id: 0, name: 'Inbox', description: null, created_at: '' } as Project, 
          tasks: inboxTasks 
      });
  }

  return (
       <div className="flex-1 flex overflow-hidden relative">
            <Timeline 
                date={viewDate} 
                onChangeDate={(d: number) => {
                    const next = new Date(viewDate);
                    next.setDate(next.getDate() + d);
                    setViewDate(next);
                }} 
                history={history}
                deleteHistory={deleteHistory}
            />
        <div className="flex-1 flex flex-col h-full relative overflow-hidden bg-gradient-to-br from-[#0B0F19] to-[#111827]">
           {/* Header */}
           <div className="h-14 border-b border-[#1f2937] flex items-center justify-between px-6 bg-[#111827]/80 backdrop-blur z-20 flex-shrink-0">
              <div className="flex items-center space-x-2 text-gray-400">
                 <span className="font-semibold text-sm tracking-wide text-gray-200">Dashboard</span>
              </div>
              <div className="text-[10px] text-gray-600 border border-[#1f2937] px-2 py-1 rounded bg-[#0B0F19] font-mono">
                 <span className="font-bold text-gray-400">Alt + Space</span> to CMD
              </div>
           </div>

           <div className="flex-1 flex overflow-hidden">
                {/* 2. Middle Column: Tasks */}
               <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8 relative">

              <section>
                 <div className="flex justify-between items-end mb-4">
                    <h2 className="text-xs font-bold text-indigo-500 uppercase tracking-wider flex items-center gap-2">
                       <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                       </span>
                       Current Focus
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">STOPWATCH</div>
                 </div>
                 
                 <div className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl relative overflow-hidden group">
                    <div className="h-[2px] w-full bg-[#1f2937]">
                       {activeTask && (
                           <div className="h-full bg-indigo-500 w-full animate-progress-stripe" 
                                style={{ 
                                    backgroundImage: 'linear-gradient(45deg,rgba(255,255,255,.1) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.1) 75%,transparent 75%,transparent)',
                                    backgroundSize: '1rem 1rem'
                                }}>
                           </div>
                       )}
                    </div>
                    
                    <div className="p-6 relative z-10">
                       {activeTask ? (
                           <>
                             <div className="flex justify-between items-start mb-6">
                                 <div className="flex-1 pr-4">
                                   <div className="flex items-center gap-2 mb-2">
                                     <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#1f2937] text-gray-400">
                                        {projects.find((p:any) => p.id === activeTask.project_id)?.name || 'Inbox'}
                                     </span>
                                   </div>
                                   <h1 className="text-3xl font-light text-white tracking-tight break-words">{activeTask.title}</h1>
                                </div>
                                <div className="text-right">
                                   <div className="text-4xl font-mono font-light text-gray-100 tracking-tighter tabular-nums">
                                      {focusDisplay}
                                   </div>
                                </div>
                             </div>
                             
                             <div className="relative group/input">
                                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-600">
                                   <Edit size={16} />
                                </span>
                                <input 
                                   className="block w-full pl-10 pr-3 py-3 border border-[#1f2937] rounded-lg bg-[#0B0F19]/50 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm transition-all"
                                   placeholder="Log context anchor..."
                                   defaultValue={activeTask.context_memo || ''}
                                   onKeyDown={(e) => {
                                      if(e.key === 'Enter') {
                                         window.api.addMemo(activeTask.id, e.currentTarget.value);
                                         e.currentTarget.blur();
                                      }
                                   }}
                                />
                             </div>
                           </>
                       ) : (
                           <div className="py-10 text-center text-gray-600">
                               <h3 className="text-xl font-light mb-2">No Active Task</h3>
                               <p className="text-sm">Press Alt + Space to start focus</p>
                           </div>
                       )}
                    </div>
                 </div>
              </section>

              {/* 3. Waiting Focus */}
              {waitingTasks.length > 0 && (
                  <section>
                    <h2 className="text-[11px] font-bold text-orange-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Timer size={14} />
                        Paused / Waiting Focus
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {waitingTasks.map((t:any) => {
                            const pr = projects.find((p:any) => p.id === t.project_id);
                            return (
                                <div 
                                    key={t.id} 
                                    onClick={() => window.api.startFocus(t.id)} 
                                    className="bg-[#111827] border border-[#1f2937] rounded p-3 flex justify-between hover:border-orange-500/50 cursor-pointer transition-colors group relative overflow-hidden"
                                >
                                    <div 
                                        className="absolute left-0 top-0 bottom-0 w-1" 
                                        style={{ backgroundColor: pr?.color || 'transparent' }}
                                    />
                                    <span className="text-sm text-gray-300 group-hover:text-white transition-colors">{t.title}</span>
                                    <span className="text-orange-400 font-mono text-sm">
                                        <CountDown target={t.target_timestamp} />
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                  </section>
              )}

              {/* 4. Task List */}
              <section className="pb-20">
                 <div className="flex justify-between items-center mb-3 border-b border-[#1f2937] pb-2">
                    <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Next Actions</h2>
                    <div className="text-[10px] text-gray-600">Drag to reorganize • Drop on task to nest</div>
                 </div>
                 
                 {projectGroups.map((group: any) => (
                    <div 
                        key={group.project.id} 
                        className="mb-6 p-2 rounded border border-transparent hover:border-[#1f2937] transition"
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = '#1f2937'; }}
                        onDragLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        onDrop={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; handleDropRoot(e, group.project.id); }}
                    >
                        <div className="flex items-center gap-2 mb-2">
                           <Folder size={16} className="text-gray-600" />
                           <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">{group.project.name}</h3>
                           {group.project.id > 0 && (
                               <button 
                                   onClick={() => switchProject(group.project.id)}
                                   className="ml-2 p-1 text-[9px] font-bold text-indigo-500 hover:text-indigo-300 hover:bg-indigo-500/10 rounded border border-indigo-500/20 transition-all uppercase tracking-tighter"
                               >
                                   Switch & Focus
                               </button>
                           )}
                           <button className="ml-auto text-gray-600 hover:text-white" title="Add Task"><Plus size={14} /></button>
                        </div>
                        {group.tasks.length === 0 ? (
                            <div className="text-[10px] text-gray-700 italic pl-6">No tasks</div>
                        ) : (
                            group.tasks.map((t:any) => renderTaskRow(t))
                        )}
                    </div>
                 ))}
              </section>

           </div>

           {/* Resize Handle */}
            <div 
                className="w-1 cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500 transition-colors z-10 flex flex-col justify-center items-center group"
                onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
            >
                <div className="w-[1px] h-8 bg-gray-600 group-hover:bg-white rounded transition-colors"></div>
            </div>

           {/* 3. New Right Column: GPU & Background */}
           <div 
              style={{ width: rightPanelWidth }}
              className="border-l border-[#1f2937] bg-[#0B0F19]/50 flex flex-col overflow-hidden shrink-0"
            >
                
                {/* Region 1: GPUs */}
                <div className="flex-1 flex flex-col border-b border-[#1f2937] overflow-hidden min-h-[40%]">
                    <div className="p-3 border-b border-[#1f2937] bg-[#111827]/50 flex justify-between items-center">
                        <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                           <Brain size={14} className="text-green-500" />
                           GPUs ({gpus.length})
                        </h2>
                        <button onClick={() => setShowGpuModal(true)} className="text-gray-500 hover:text-green-400">
                            <Plus size={14} />
                        </button>
                    </div>
                    <div className={clsx(
                        "flex-1 overflow-y-auto custom-scrollbar p-3 grid gap-3 content-start",
                        rightPanelWidth > 420 ? "grid-cols-2" : "grid-cols-1"
                    )}>
                        {gpus.map(gpu => {
                            const task = getGpuTask(gpu.id);
                            return (
                                <div 
                                    key={gpu.id} 
                                    className={clsx(
                                        "bg-[#111827] border rounded p-3 relative overflow-hidden group transition-colors min-h-[80px] shrink-0",
                                        task ? "border-green-500/30" : "border-[#1f2937] hover:border-gray-600"
                                    )}
                                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#10b981'; }}
                                    onDragLeave={(e) => { e.currentTarget.style.borderColor = ''; }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.currentTarget.style.borderColor = '';
                                        if (draggingId) {
                                            const t = tasks.find(x => x.id === draggingId);
                                            // Only allow training tasks
                                            if (t && t.type === 'training') {
                                                setPendingAssignment({ taskId: draggingId, gpuId: gpu.id });
                                                setDraggingId(null);
                                            } else {
                                                // Ask to create training task from standard? Nah, spec doesn't say.
                                            }
                                        }
                                    }}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: task ? '#22c55e' : '#64748b' }}></div>
                                            <span className="font-bold text-xs text-gray-200">{gpu.name}</span>
                                        </div>
                                        <div className="opacity-0 group-hover:opacity-100 flex gap-2">
                                            <button 
                                                onClick={() => { /* Quick Task UI? No, spec says + on title. But card has actions too. */ }}
                                                className="text-gray-600 hover:text-white"
                                            >
                                                {/* <Plus size={12} /> */}
                                            </button>
                                            <button 
                                                onClick={() => deleteGpu(gpu.id)}
                                                className="text-gray-600 hover:text-red-400"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {task ? (
                                        <div className="mt-2 text-xs">
                                            <div className="text-white mb-1 line-clamp-1">{task.title}</div>
                                            <div className="text-green-500 font-mono font-bold flex justify-between">
                                                <CountDown target={task.target_timestamp} />
                                                <button onClick={() => setConfirmStopTaskId(task.id)} className="hover:text-red-400 z-10"><X size={12}/></button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mt-2 text-[10px] text-gray-600">
                                            <IdleTimer start={gpu.last_active_at} />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Region 2: Queued Training */}
                <div className="h-[30%] border-b border-[#1f2937] flex flex-col overflow-hidden">
                    <div className="p-3 border-b border-[#1f2937] bg-[#111827]/50">
                        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                           Training Queue
                        </h2>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                        {trainingQueue.map((t:any) => (
                             <div 
                                key={t.id} 
                                className="bg-[#111827] border border-[#1f2937] rounded p-2 relative group hover:border-gray-500/50 cursor-grab active:cursor-grabbing"
                                draggable
                                onDragStart={(e) => handleDragStart(e, t.id)}
                                onDragEnd={handleDragEnd}
                             >
                                <div className="flex justify-between items-center">
                                     <span className="text-xs text-gray-300 truncate">{t.title}</span>
                                     <button 
                                        onClick={() => deleteTask(t.id)}
                                        className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                             </div>
                        ))}
                        {trainingQueue.length === 0 && <div className="text-gray-700 text-[10px] italic text-center mt-4">Empty Queue</div>}
                    </div>
                </div>

                {/* Region 3: Ad-Hoc */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="p-3 border-b border-[#1f2937] bg-[#111827]/50">
                        <h2 className="text-[11px] font-bold text-amber-500 uppercase tracking-widest flex items-center gap-2">
                           <Timer size={14} />
                           Ad-Hoc
                        </h2>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                         {adHocTasks.map((t:any) => (
                             <div key={t.id} className="bg-[#111827] border border-[#1f2937] rounded p-3 relative group hover:border-amber-500/30">
                                <div className="flex justify-between items-start mb-1">
                                     <div className="font-bold text-xs text-gray-300 line-clamp-2">{t.title}</div>
                                      <button 
                                        onClick={() => window.api.cancelWait(t.id)}
                                        className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                                <div className="text-right text-sm font-mono font-bold text-amber-500">
                                    <CountDown target={t.target_timestamp} />
                                </div>
                             </div>
                        ))}
                    </div>
                </div>
           </div>

           {/* Modals */}
           <CreateGpuModal 
                isOpen={showGpuModal} 
                onClose={() => setShowGpuModal(false)} 
                onConfirm={(name) => { createGpu(name); setShowGpuModal(false); }} 
           />
           <DurationInputModal
                isOpen={!!pendingAssignment}
                onClose={() => setPendingAssignment(null)}
                // @ts-ignore
                onConfirm={(minutes) => { assignTaskToGpu(pendingAssignment.taskId, pendingAssignment.gpuId, minutes); setPendingAssignment(null); }}
           />
            {/* ... */}
            <StopTrainingModal
                isOpen={confirmStopTaskId !== null}
                onClose={() => setConfirmStopTaskId(null)}
                title="Stop Training Task?"
                // Find the task to check status
                isFinished={(() => {
                    if (!confirmStopTaskId) return false;
                    const t = tasks.find(x => x.id === confirmStopTaskId);
                    if (!t || !t.target_timestamp) return false;
                    return new Date(t.target_timestamp).getTime() <= Date.now();
                })()}
                onBackToQueue={async () => {
                     if (confirmStopTaskId) {
                        await window.api.stopTraining(confirmStopTaskId, false); // forceComplete = false
                        setConfirmStopTaskId(null);
                     }
                }}
                onEarlyComplete={async () => {
                     if (confirmStopTaskId) {
                        await window.api.stopTraining(confirmStopTaskId, true); // forceComplete = true
                        setConfirmStopTaskId(null);
                     }
                }}
            />
           </div>
        </div>
        </div>
  );
};

// --- MAIN LAYOUT/WINDOW ---
export const Dashboard = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [gpus, setGpus] = useState<Gpu[]>([]);
  const [viewDate, setViewDate] = useState(new Date());
  
  // Routing
  const [currentView, setCurrentView] = useState<'dashboard' | 'projects' | 'settings'>('dashboard');
  const [taskAwaitingProject, setTaskAwaitingProject] = useState<number | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean, title: string, message: string, onConfirm: () => void } | null>(null);

  const switchProject = async (projectId: number) => {
      const projectTasks = tasks.filter(t => t.project_id === projectId && t.status !== 'archived');
      if (projectTasks.length === 0) return;

      // Find last task in history (from the current visible history or latest)
      const lastTaskInHistory = [...history].reverse().find(h => 
          projectTasks.some(t => t.id === h.task_id)
      );

      const targetId = lastTaskInHistory ? lastTaskInHistory.task_id : projectTasks[0].id;
      window.api.startFocus(targetId);
  };

  useEffect(() => {
    // Auto-refresh when window regains focus (e.g. after Spotlight close)
    const handleFocus = () => fetchData();

    window.addEventListener('focus', handleFocus);
    return () => {
        window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const fetchData = async () => {
    try {
      const dateStr = viewDate.toISOString().split('T')[0];
      const [t, p, h, g] = await Promise.all([
        window.api.getTasks(),
        window.api.getProjects(),
        window.api.getHistory(dateStr),
        window.api.getGpus()
      ]);
      setTasks(t);
      setProjects(p);
      setHistory(h);
      setGpus(g);
    } catch(e) { console.error(e); }
  };

  const completeTask = async (id: number) => {
      const task = tasks.find(t => t.id === id);
      if (task && !task.project_id && task.type === 'standard') {
          setTaskAwaitingProject(id);
          return;
      }

      await window.api.updateTask(id, { status: 'archived' });
      // Clean children
      const children = tasks.filter(t => t.parent_id === id);
      for (const child of children) {
          await window.api.updateTask(child.id, { status: 'archived' });
      }
      fetchData();
  };

  const deleteTask = (id: number) => {
      const task = tasks.find(t => t.id === id);
      setConfirmModal({
          isOpen: true,
          title: 'Delete Task?',
          message: `Are you sure you want to permanently delete "${task?.title}"? This cannot be undone.`,
          onConfirm: async () => {
              await window.api.deleteTask(id);
              fetchData();
          }
      });
  };

  const deleteHistory = (id: number) => {
     const entry = history.find(h => h.id === id);
     setConfirmModal({
         isOpen: true,
         title: 'Delete History Entry?',
         message: `Remove this session for "${entry?.title}" from your timeline?`,
         onConfirm: async () => {
             await window.api.deleteHistory(id);
             fetchData();
         }
     });
  };

  useEffect(() => {
    const cleanAndFetch = async () => {
        try {
            const today = new Date().toISOString().split('T')[0];
            const h = await window.api.getHistory(today);
            for (const entry of h) {
                const duration = new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime();
                if (duration <= 10000) { 
                    await window.api.deleteHistory(entry.id);
                }
            }
        } catch(e) {}
        fetchData();
    };

    cleanAndFetch();
  }, [viewDate]);

  // Use ref to avoid stale closure in IPC listeners
  const fetchDataRef = useRef(fetchData);
  useEffect(() => {
      fetchDataRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    if (window.api.onTimerUpdate) {
        const u1 = window.api.onTimerUpdate(() => fetchDataRef.current()); 
        // Timer ended is now handled by the independent reminder window
        const u2 = window.api.onTimerEnded(() => {
            fetchDataRef.current();
        });

        // @ts-ignore
        const u3 = window.api.onFetchTasks ? window.api.onFetchTasks(() => fetchDataRef.current()) : null;

        return () => { 
            // @ts-ignore
            u1?.(); u2?.(); u3?.();
        }
    }
  }, []);

  return (
    <div className="flex h-screen bg-[#0B0F19] text-gray-100 font-sans overflow-hidden selection:bg-indigo-500 selection:text-white">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      
      {currentView === 'dashboard' && (
          <DashboardView 
            tasks={tasks} 
            projects={projects} 
            history={history}
            gpus={gpus} 
            viewDate={viewDate} 
            setViewDate={setViewDate}
            fetchData={fetchData}
            completeTask={completeTask}
            deleteTask={deleteTask}
            switchProject={switchProject}
            deleteHistory={deleteHistory}
            createGpu={async (name) => { await window.api.createGpu(name); fetchData(); }}
            deleteGpu={async (id) => { await window.api.deleteGpu(id); fetchData(); }}
            assignTaskToGpu={async (tid, gid, mins) => { await window.api.assignTaskToGpu(tid, gid, mins); fetchData(); }}
          />
      )}

      {currentView === 'projects' && <ProjectView />}
      
      {currentView === 'settings' && <SettingsView />}

      {taskAwaitingProject && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <div className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6">
                      <h2 className="text-lg font-bold text-white mb-2 font-display">Assign to Project</h2>
                      <p className="text-sm text-gray-400 mb-6">This task needs to be assigned to a project before completion.</p>
                      
                      <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2 mb-2">
                          {projects.map(p => (
                              <button 
                                key={p.id}
                                onClick={async () => {
                                    await window.api.updateTask(taskAwaitingProject, { project_id: p.id, status: 'archived' });
                                    setTaskAwaitingProject(null);
                                    fetchData();
                                }}
                                className="w-full text-left p-3 rounded-lg bg-[#1f2937]/50 hover:bg-indigo-600/20 hover:border-indigo-500/50 border border-transparent transition-all group flex justify-between items-center"
                              >
                                  <span className="font-medium text-gray-300 group-hover:text-white">{p.name}</span>
                                  <Folder size={14} className="text-gray-600 group-hover:text-indigo-400" />
                              </button>
                          ))}
                      </div>
                  </div>
                  <div className="bg-[#0B0F19]/50 p-4 border-t border-[#1f2937] flex justify-end gap-3">
                      <button onClick={() => setTaskAwaitingProject(null)} className="text-sm text-gray-500 hover:text-white transition-colors">Cancel</button>
                  </div>
              </div>
          </div>
      )}


       {confirmModal && (
           <ConfirmModal 
               isOpen={confirmModal.isOpen}
               onClose={() => setConfirmModal(null)}
               onConfirm={confirmModal.onConfirm}
               title={confirmModal.title}
               message={confirmModal.message}
           />
       )}
    </div>
  );
};
