import { useState, useEffect } from 'react';
import { Project, Task } from '../../shared/types';
import { 
    Plus, GripVertical, Play, CheckCircle2, 
    ArrowUpCircle, Layout, Clock, 
    Target, BarChart2, Settings, X as CloseIcon, Check, Trash2
} from 'lucide-react';
import clsx from 'clsx';

const PRESET_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export const ProjectView = () => {
    const [projects, setProjects] = useState<Project[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [formName, setFormName] = useState('');
    const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
    const [draggingId, setDraggingId] = useState<number | null>(null);

    const fetchData = async () => {
        const [p, t] = await Promise.all([
            window.api.getProjects(),
            window.api.getTasks()
        ]);
        setProjects(p);
        setTasks(t);
        if (!selectedProjectId && p.length > 0) {
            setSelectedProjectId(p[0].id);
        }
    };

    useEffect(() => {
        fetchData();
        const u = window.api.onTimerUpdate(fetchData);
        return () => { 
            // @ts-ignore
            u?.(); 
        };
    }, []);

    const handleCreateProject = async () => {
        if (!formName.trim()) return;
        await window.api.createProject(formName, undefined, formColor);
        setFormName('');
        setIsCreating(false);
        fetchData();
    };

    const handleUpdateProject = async () => {
        if (!selectedProjectId || !formName.trim()) return;
        await window.api.updateProject(selectedProjectId, { name: formName, color: formColor });
        setIsEditing(false);
        fetchData();
    };

    const handleDeleteProject = async () => {
        if (!selectedProjectId) return;
        if (confirm('Delete this project? Active tasks will be unassigned.')) {
             // @ts-ignore
             await window.api.deleteProject(selectedProjectId);
             setIsEditing(false);
             setSelectedProjectId(null);
             fetchData();
        }
    };

    const startEditing = () => {
        const p = projects.find(pr => pr.id === selectedProjectId);
        if (p) {
            setFormName(p.name);
            setFormColor(p.color || PRESET_COLORS[0]);
            setIsEditing(true);
        }
    };

    const handleAddTask = async (title: string) => {
        if (!selectedProjectId) return;
        await window.api.createTask(title, undefined, 'standard', selectedProjectId);
        fetchData();
    };

    const toggleNextAction = async (task: Task) => {
        await window.api.updateTask(task.id, { is_next_action: task.is_next_action ? 0 : 1 });
        fetchData();
    };

    const formatDuration = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    };

    const handleDragStart = (id: number) => {
        setDraggingId(id);
    };

    const handleDrop = async (targetId: number) => {
        if (!draggingId || draggingId === targetId) return;
        
        const draggedTask = tasks.find(t => t.id === draggingId);
        const targetTask = tasks.find(t => t.id === targetId);
        
        if (draggedTask && targetTask) {
            // Simple swap or "place before" logic:
            // For now, let's just set draggedTask's sort_order to targetTask's - 1
            const newOrder = targetTask.sort_order - 1;
            await window.api.updateTask(draggingId, { sort_order: newOrder });
            fetchData();
        }
        setDraggingId(null);
    };

    const selectedProject = projects.find(p => p.id === selectedProjectId);
    const projectTasks = tasks.filter(t => t.project_id === selectedProjectId);
    
    // Group tasks
    const backlog = projectTasks.filter(t => t.status === 'queued' && t.is_next_action === 0);
    const nextActions = projectTasks.filter(t => t.status === 'queued' && t.is_next_action === 1);
    const inProgress = projectTasks.filter(t => t.status === 'active' || t.status === 'waiting');
    const completed = projectTasks.filter(t => t.status === 'archived');
    
    // Simple inline component for task input
    const TaskInput = () => {
        const [val, setVal] = useState('');
        return (
            <div className="relative group">
                <input 
                    className="w-full bg-[#0B0F19] border border-[#1f2937] rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                    placeholder="Capture new thought..."
                    value={val}
                    onChange={e => setVal(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && val.trim()) {
                            handleAddTask(val);
                            setVal('');
                        }
                    }}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-700 font-mono opacity-0 group-focus-within:opacity-100 transition-opacity">ENTER TO SAVE</div>
            </div>
        );
    };

    return (
        <div className="flex h-full bg-[#0B0F19] text-gray-200 overflow-hidden">
            {/* Project List Sidebar */}
            <div className="w-72 border-r border-[#1f2937] bg-[#111827]/30 flex flex-col shadow-xl z-30">
                <div className="p-6 border-b border-[#1f2937] flex justify-between items-center bg-[#0B0F19]/50">
                    <h2 className="font-bold text-xs tracking-widest text-gray-500 uppercase flex items-center gap-2">
                        <Layout size={14}/> Projects
                    </h2>
                    <button onClick={() => setIsCreating(true)} className="p-1 hover:bg-[#1f2937] rounded text-gray-500 hover:text-white transition">
                        <Plus size={18}/>
                    </button>
                </div>
                
                {isCreating && (
                    <div className="p-4 border-b border-[#1f2937] bg-indigo-500/5 animate-in slide-in-from-top-4 duration-300 space-y-3">
                        <input 
                            autoFocus
                            className="w-full bg-[#0B0F19] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                            placeholder="New project name..."
                            value={formName}
                            onChange={e => setFormName(e.target.value)}
                            onKeyDown={e => {
                                if(e.key === 'Enter') handleCreateProject();
                                if(e.key === 'Escape') setIsCreating(false);
                            }}
                        />
                        <div className="flex gap-2 flex-wrap">
                            {PRESET_COLORS.map(c => (
                                <button 
                                    key={c}
                                    onClick={() => setFormColor(c)}
                                    className={clsx("w-5 h-5 rounded-full border-2", formColor === c ? "border-white scale-110 shadow-lg" : "border-transparent opacity-60 hover:opacity-100")}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                        <div className="flex justify-end gap-2 text-[10px] font-bold">
                            <button onClick={() => setIsCreating(false)} className="px-2 py-1 text-gray-500 border border-transparent hover:border-gray-800 rounded">CANCEL</button>
                            <button onClick={handleCreateProject} className="px-2 py-1 text-indigo-400 border border-indigo-500/30 rounded bg-indigo-500/10">CREATE</button>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                    {projects.map(p => (
                        <div 
                            key={p.id}
                            onClick={() => setSelectedProjectId(p.id)}
                            className={clsx(
                                "p-4 rounded-xl cursor-pointer transition-all duration-200 flex flex-col gap-2 group relative border",
                                selectedProjectId === p.id 
                                    ? "bg-[#111827] border-gray-600 shadow-lg" 
                                    : "bg-[#111827]/40 border-transparent hover:border-[#1f2937] hover:bg-[#111827]"
                            )}
                            style={selectedProjectId === p.id ? { borderLeft: `4px solid ${p.color || '#6366f1'}` } : {}}
                        >
                            <div className="flex justify-between items-center">
                                <span className={clsx("font-semibold tracking-tight", selectedProjectId === p.id ? "text-white" : "text-gray-300")}>{p.name}</span>
                                {selectedProjectId === p.id && (
                                    <div 
                                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                                        style={{ backgroundColor: p.color || '#6366f1' }}
                                    ></div>
                                )}
                            </div>
                            <div className="flex items-center gap-3 text-[10px] font-mono">
                                <span className={clsx("flex items-center gap-1", selectedProjectId === p.id ? "text-gray-300" : "text-gray-500")}>
                                    <Target size={10}/> {p.activeCount} tasks
                                </span>
                                <span className={clsx("flex items-center gap-1", selectedProjectId === p.id ? "text-gray-400" : "text-gray-600")}>
                                    <Clock size={10}/> {formatDuration(p.totalFocused || 0)}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-[#0B0F19] via-[#0B0F19] to-[#111827]">
                {selectedProject ? (
                    <>
                        <div className="h-20 border-b border-[#1f2937] flex items-center justify-between px-10 bg-[#0B0F19]/80 backdrop-blur-md z-20">
                            <div className="flex items-end gap-6">
                                {isEditing ? (
                                    <div className="flex items-center gap-4 animate-in fade-in duration-300">
                                        <input 
                                            autoFocus
                                            className="bg-[#111827] border border-gray-700 rounded px-3 py-1 text-xl text-white outline-none focus:border-indigo-500"
                                            value={formName}
                                            onChange={e => setFormName(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleUpdateProject()}
                                        />
                                        <div className="flex gap-1.5">
                                            {PRESET_COLORS.map(c => (
                                                <button 
                                                    key={c}
                                                    onClick={() => setFormColor(c)}
                                                    className={clsx("w-4 h-4 rounded-full border border-white/20", formColor === c ? "scale-125 border-white" : "opacity-50")}
                                                    style={{ backgroundColor: c }}
                                                />
                                            ))}
                                        </div>
                                        <div className="flex gap-1">
                                            <button onClick={handleDeleteProject} className="p-1.5 text-red-500 hover:bg-red-500/10 rounded mr-1" title="Delete Project"><Trash2 size={18}/></button>
                                            <div className="w-[1px] h-6 bg-gray-700 mx-1"></div>
                                            <button onClick={handleUpdateProject} className="p-1.5 text-green-400 hover:bg-green-500/10 rounded"><Check size={18}/></button>
                                            <button onClick={() => setIsEditing(false)} className="p-1.5 text-gray-500 hover:bg-white/5 rounded"><CloseIcon size={18}/></button>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <h1 className="text-3xl font-light text-white tracking-tighter flex items-center gap-3">
                                            <div className="w-3 h-3 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]" style={{ backgroundColor: selectedProject.color || '#6366f1' }}></div>
                                            {selectedProject.name}
                                        </h1>
                                        <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-bold">PROJECT WORKSPACE</p>
                                    </div>
                                )}
                                <div className="h-10 w-[1px] bg-[#1f2937]"></div>
                                <div className="flex gap-8 mb-1">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] text-gray-600 uppercase font-black">Active</span>
                                        <span className="text-lg font-mono" style={{ color: selectedProject.color || '#6366f1' }}>{selectedProject.activeCount}</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] text-gray-600 uppercase font-black">Total Time</span>
                                        <span className="text-lg font-mono text-gray-300">{formatDuration(selectedProject.totalFocused || 0)}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={startEditing} className="p-2 hover:bg-[#1f2937] rounded-lg text-gray-500 transition-colors hover:text-white" title="Project Settings">
                                    <Settings size={20}/>
                                </button>
                                <button className="p-2 hover:bg-[#1f2937] rounded-lg text-gray-500 transition-colors"><BarChart2 size={20}/></button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-x-auto p-8 custom-scrollbar">
                            <div className="flex gap-8 h-full min-w-max pb-4">
                                
                                {/* 1. Backlog Column */}
                                <div className="w-[340px] flex flex-col gap-6">
                                    <div className="flex items-center justify-between px-1">
                                        <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-gray-500"></div>
                                            Backlog <span className="text-[10px] text-gray-700 font-mono ml-1">({backlog.length + nextActions.length})</span>
                                        </h3>
                                    </div>
                                    
                                    <TaskInput />

                                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                        {/* Next Actions Sub-section */}
                                        {nextActions.map(t => (
                                            <div 
                                                key={t.id} 
                                                draggable
                                                onDragStart={() => handleDragStart(t.id)}
                                                onDragOver={(e) => e.preventDefault()}
                                                onDrop={() => handleDrop(t.id)}
                                                className={clsx(
                                                    "p-4 border rounded-xl group transition-all cursor-default",
                                                    draggingId === t.id && "opacity-50"
                                                )}
                                                style={{ 
                                                    backgroundColor: `${selectedProject.color || '#6366f1'}15`,
                                                    borderColor: `${selectedProject.color || '#6366f1'}40`
                                                }}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="mt-1"><ArrowUpCircle size={14} style={{ color: selectedProject.color || '#6366f1' }} /></div>
                                                    <div className="flex-1">
                                                        <div className="text-sm font-medium leading-tight text-white">{t.title}</div>
                                                        <div className="flex items-center gap-3 mt-2">
                                                            <span className="text-[9px] font-bold uppercase opacity-60" style={{ color: selectedProject.color || '#6366f1' }}>NEXT ACTION</span>
                                                            <button 
                                                                onClick={() => toggleNextAction(t)}
                                                                className="text-[9px] border rounded px-1.5 py-0.5 hover:bg-white/10 transition-colors"
                                                                style={{ color: selectedProject.color || '#6366f1', borderColor: `${selectedProject.color || '#6366f1'}30` }}
                                                            >
                                                                REMOVE FROM NEXT
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}

                                        {/* Pure Backlog */}
                                        {backlog.map(t => (
                                            <div 
                                                key={t.id} 
                                                draggable
                                                onDragStart={() => handleDragStart(t.id)}
                                                onDragOver={(e) => e.preventDefault()}
                                                onDrop={() => handleDrop(t.id)}
                                                className={clsx(
                                                    "p-4 bg-[#111827]/40 border border-[#1f2937] rounded-xl group hover:border-gray-500 transition-all",
                                                    draggingId === t.id && "opacity-50"
                                                )}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <GripVertical size={14} className="text-gray-800 mt-1 cursor-grab" />
                                                    <div className="flex-1">
                                                        <div className="text-sm text-gray-400 group-hover:text-gray-200 transition-colors leading-tight">{t.title}</div>
                                                        <div className="opacity-0 group-hover:opacity-100 flex gap-4 mt-3 transition-opacity">
                                                            <button onClick={() => toggleNextAction(t)} className="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-white transition-colors">
                                                                <ArrowUpCircle size={12}/> PLAN TO NEXT
                                                            </button>
                                                            <button 
                                                                onClick={() => window.api.startFocus(t.id)} 
                                                                className="flex items-center gap-1 text-[10px] font-bold text-gray-500 hover:text-white transition-colors"
                                                            >
                                                                <Play size={12}/> START NOW
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* 2. In Progress Column */}
                                <div className="w-[340px] flex flex-col gap-6">
                                    <div className="flex items-center justify-between px-1">
                                        <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
                                            In Active Focus <span className="text-[10px] text-indigo-900 font-mono ml-1">({inProgress.length})</span>
                                        </h3>
                                    </div>

                                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                                        {inProgress.length === 0 && (
                                            <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-[#1f2937] rounded-2xl opacity-40">
                                                <Target size={32} className="text-gray-600 mb-2"/>
                                                <span className="text-xs text-gray-600 italic uppercase font-bold tracking-tighter">No Active Energy</span>
                                            </div>
                                        )}
                                        {inProgress.map(t => (
                                            <div 
                                                key={t.id} 
                                                className={clsx(
                                                    "p-5 rounded-xl shadow-lg cursor-pointer hover:translate-y-[-2px] transition-all border-l-4",
                                                    t.timer_type === 'focus' 
                                                        ? "bg-gradient-to-br from-[#111827] to-[#1f2937]/30" 
                                                        : "bg-[#111827]/40 opacity-80"
                                                )}
                                                style={{ 
                                                    borderLeftColor: selectedProject.color || '#6366f1',
                                                    boxShadow: t.timer_type === 'focus' ? `0 10px 30px -10px ${selectedProject.color || '#6366f1'}33` : 'none'
                                                }}
                                                onClick={() => window.api.startFocus(t.id)}
                                            >
                                                <div className="flex justify-between items-start mb-3">
                                                    <div className={clsx("text-md font-bold leading-snug", t.timer_type === 'focus' ? "text-white" : "text-gray-400")}>{t.title}</div>
                                                    {t.timer_type === 'focus' && (
                                                        <div 
                                                            className="w-2 h-2 rounded-full animate-ping"
                                                            style={{ backgroundColor: selectedProject.color || '#6366f1' }}
                                                        ></div>
                                                    )}
                                                </div>
                                                <div className="flex justify-between items-center text-[10px] font-mono font-bold">
                                                    <span 
                                                        className="px-2 py-0.5 rounded border uppercase tracking-widest"
                                                        style={{ 
                                                            color: selectedProject.color || '#6366f1', 
                                                            backgroundColor: `${selectedProject.color || '#6366f1'}11`,
                                                            borderColor: `${selectedProject.color || '#6366f1'}33`
                                                        }}
                                                    >{t.status}</span>
                                                    <span className="text-gray-500 flex items-center gap-1"><Clock size={10}/> {formatDuration(t.total_duration)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* 3. Completed Column */}
                                <div className="w-[340px] flex flex-col gap-6">
                                    <div className="flex items-center justify-between px-1">
                                        <h3 className="text-xs font-black text-green-500/70 uppercase tracking-widest flex items-center gap-2">
                                            <CheckCircle2 size={14}/>
                                            Archive <span className="text-[10px] text-gray-700 font-mono ml-1">({completed.length})</span>
                                        </h3>
                                    </div>

                                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all">
                                        {completed.map(t => (
                                            <div key={t.id} className="p-3 bg-[#0B0F19] border border-[#1f2937] rounded-lg">
                                                <div className="text-sm text-gray-500 line-through truncate">{t.title}</div>
                                                <div className="flex justify-between mt-2">
                                                     <span className="text-[9px] font-mono text-gray-600 italic">Finished {new Date(t.created_at).toLocaleDateString()}</span>
                                                     <span className="text-[9px] text-green-500/40 font-mono">{formatDuration(t.total_duration)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center opacity-30 select-none">
                        <BarChart2 size={64} className="text-gray-600 mb-4 stroke-1"/>
                        <p className="text-xl font-light tracking-widest uppercase">Select Workspace</p>
                    </div>
                )}
            </div>
        </div>
    );
};
