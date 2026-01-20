import { useState, useEffect, useRef } from 'react';
import { Task, Project } from '../../shared/types';
import { Brain, Timer, Check, Play, Folder } from 'lucide-react';
import clsx from 'clsx';

interface ReminderTask extends Omit<Task, 'type'> {
  type: Task['type'] | 'gpu-idle';
  isTraining?: boolean;
  gpuName?: string;
}

// Sound synthesizer for chime
const playChime = () => {
    try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
        oscillator.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.15); // E5
        oscillator.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.3); // G5

        gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) { console.error('Audio failed', e); }
};

export const Reminder = () => {
  const [reminders, setReminders] = useState<ReminderTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectSelectIdx, setProjectSelectIdx] = useState<number | null>(null);
  const soundIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isVisible, setIsVisible] = useState(!document.hidden);

  // Track document visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Repeating sound notification while reminders are pending AND window is visible
  useEffect(() => {
    // Clear any existing interval first
    if (soundIntervalRef.current) {
      clearInterval(soundIntervalRef.current);
      soundIntervalRef.current = null;
    }

    // Only set up sound if we have reminders AND are visible
    if (reminders.length > 0 && isVisible) {
      // Play immediately on first reminder
      playChime();
      
      // Set up repeating sound every 5 seconds
      soundIntervalRef.current = setInterval(() => {
        if (reminders.length > 0 && isVisible) {
          playChime();
        }
      }, 5000);
    }
    
    return () => {
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
        soundIntervalRef.current = null;
      }
    };
  }, [reminders.length, isVisible]);

  useEffect(() => {
    // Listen for new reminders from main process
    const handleReminder = (_id: number, task: ReminderTask) => {
      if (task) {
        setReminders(prev => {
          // Avoid duplicates
          if (prev.some(r => r.id === task.id)) return prev;
          return [...prev, task];
        });
      }
    };

    const unsub = window.api.onTimerEnded(handleReminder);
    
    // @ts-ignore
    const unsubReminder = window.api.onReminderRepeat ? window.api.onReminderRepeat(handleReminder) : null;

    return () => {
      unsub?.();
      // @ts-ignore
      unsubReminder?.();
    };
  }, []);

  useEffect(() => {
      window.api.getProjects().then(setProjects);
  }, []);

  // Safety: If no reminders, ensure window is hidden (avoids invisible click-blocking overlay)
  useEffect(() => {
    if (reminders.length === 0) {
      const t = setTimeout(() => {
         window.api.hideReminder();
      }, 100);
      return () => clearTimeout(t);
    }
  }, [reminders]);

  const handleAction = async (idx: number, action: 'complete' | 'focus' | 'dismiss' | 'snooze', snoozeMinutes?: number) => {
    const task = reminders[idx];
    
    if (action === 'complete') {
        // For training tasks, mark as complete
        if (task.type === 'training') {
            await window.api.stopTraining(task.id);
        } else if (task.type === 'gpu-idle') {
            // Dismiss
        } else if (task.type === 'standard' && !task.project_id) {
            setProjectSelectIdx(idx);
            return;
        } else {
            await window.api.updateTask(task.id, { status: 'archived' });
        }
    } else if (action === 'focus') {
      await window.api.startFocus(task.id);
    } else if (action === 'snooze') {
      if (task.type === 'training') {
          const minutes = snoozeMinutes || 15;
          await window.api.snoozeReminder(task.id, minutes);
      } else {
           const minutes = snoozeMinutes || 5;
           await window.api.snoozeReminder(task.id, minutes);
      }
    }
    
    setReminders(prev => prev.filter((_, i) => i !== idx));
    
    if (reminders.length <= 1) {
      window.api.hideReminder();
    }
  };

  // Keyboard shortcut: Enter = complete current task
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && reminders.length > 0) {
        e.preventDefault();
        const current = reminders[reminders.length - 1];
        if (current.type === 'gpu-idle') {
             handleAction(reminders.length - 1, 'dismiss');
        } else {
             handleAction(reminders.length - 1, 'complete');
        }
      } else if (e.key === 'Escape') {
          handleAction(reminders.length - 1, 'dismiss'); // 'Dismiss' for all on escape? Or snooze for training?
          // Previous logic: Escape -> Snooze Training.
          if (reminders.length > 0) {
              const current = reminders[reminders.length - 1];
              if (current.type === 'training') {
                  handleAction(reminders.length - 1, 'snooze');
              } else {
                  handleAction(reminders.length - 1, 'dismiss');
              }
          }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reminders]);

  if (reminders.length === 0) {
    return null;
  }

  const currentReminder = reminders[reminders.length - 1];
  const previousReminders = reminders.slice(0, -1).reverse();

  const mainContent = (
    <div className="w-full h-full flex items-center justify-center p-2 bg-transparent select-none">
      <div className="w-full h-full bg-[#0F172A] border border-white/10 rounded-xl shadow-[0_0_60px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-300">
        
        {/* Current Reminder - Flexible top section */}
        <div className="flex-shrink-0 p-6 text-center border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent relative overflow-hidden">
          {/* Animated background glow */}
          <div className="absolute inset-0 bg-gradient-radial from-indigo-500/10 via-transparent to-transparent animate-pulse" />
          
          <div className="relative z-10 flex flex-col items-center">
            <div className={clsx(
              "inline-flex items-center justify-center w-12 h-12 rounded-full mb-3",
              currentReminder.type === 'training' 
                ? "bg-green-500/20 text-green-400" 
                : currentReminder.type === 'gpu-idle'
                  ? "bg-red-500/20 text-red-500"
                  : currentReminder.type === 'ad-hoc'
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-indigo-500/20 text-indigo-400"
            )}>
              {currentReminder.type === 'training' ? <Brain size={24} /> : currentReminder.type === 'gpu-idle' ? <Brain size={24} className="animate-pulse" /> : <Timer size={24} />}
            </div>
            
            <h2 className={clsx(
              "text-[10px] font-bold uppercase tracking-[0.2em] mb-1",
              currentReminder.type === 'training' 
                ? "text-green-400" 
                : currentReminder.type === 'gpu-idle'
                   ? "text-red-500"
                : currentReminder.type === 'ad-hoc'
                  ? "text-amber-400"
                  : "text-indigo-400"
            )}>
              {currentReminder.type === 'training' ? 'Training Complete' : currentReminder.type === 'gpu-idle' ? 'GPU Idle Alert' : 'Task Ready'}
            </h2>
            
            <div className="text-xl font-bold text-white mb-4 leading-tight px-2 line-clamp-2">
              {currentReminder.title}
            </div>
            
            <div className="w-full flex flex-col gap-2">
              {/* Actions based on Type */}
              {currentReminder.type === 'gpu-idle' ? (
                   <div className="flex gap-2 w-full">
                       <button 
                           onClick={() => handleAction(reminders.length - 1, 'dismiss')} 
                           className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg font-bold transition-all text-xs"
                       >
                           Dismiss (Continue Waiting)
                       </button>
                   </div>
              ) : (
                <>
                  <button 
                    onClick={() => handleAction(reminders.length - 1, 'complete')}
                    className={clsx(
                      "w-full py-3 rounded-lg font-bold transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 group text-sm",
                      currentReminder.type === 'training'
                        ? "bg-green-600 hover:bg-green-500 text-white shadow-green-500/20"
                        : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20"
                    )}
                  >
                    <Check size={16} />
                    {currentReminder.type === 'training' ? 'TRAINING COMPLETE' : 'COMPLETE'}
                    <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded ml-2 font-mono group-hover:bg-white/30">ENTER</span>
                  </button>
                  
                  <div className="flex gap-2 w-full">
                    {currentReminder.type !== 'training' && (
                      <button 
                        onClick={() => handleAction(reminders.length - 1, 'focus')}
                        className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg font-semibold transition-all flex items-center justify-center gap-1 text-xs"
                      >
                        <Play size={12} />
                        Continue
                      </button>
                    )}
                    
                    <button 
                      onClick={() => handleAction(reminders.length - 1, 'snooze', 5)}
                      className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-gray-400 rounded-lg font-semibold transition-all text-xs"
                    >
                      +5min
                    </button>
                    
                    <button 
                      onClick={() => handleAction(reminders.length - 1, 'snooze', 30)}
                      className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-gray-400 rounded-lg font-semibold transition-all text-xs"
                    >
                      +30min
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        
        {/* Previous Reminders - Scrollable bottom section */}
        {previousReminders.length > 0 && (
          <div className="flex-1 bg-black/30 overflow-y-auto custom-scrollbar border-t border-white/5">
            <div className="sticky top-0 bg-[#0F172A]/90 backdrop-blur z-10 px-4 py-2 text-[10px] font-black text-gray-500 uppercase tracking-widest border-b border-white/5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              Other Pending ({previousReminders.length})
            </div>
            <div className="p-3 space-y-2">
              {previousReminders.map((r, idx) => (
                <div 
                  key={r.id} 
                  className="flex justify-between items-center p-2.5 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group cursor-pointer"
                  onClick={() => handleAction(reminders.length - 2 - idx, 'complete')}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    {r.type === 'training' ? <Brain size={14} className="text-green-500 flex-shrink-0" /> : r.type === 'gpu-idle' ? <Brain size={14} className="text-red-500 animate-pulse flex-shrink-0" /> : <Timer size={14} className="text-amber-500 flex-shrink-0" />}
                    <span className="text-xs text-gray-300 font-medium truncate">{r.title}</span>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleAction(reminders.length - 2 - idx, 'complete'); }}
                    className="text-[10px] text-gray-500 group-hover:text-green-400 transition-colors bg-white/5 hover:bg-white/10 px-2 py-1 rounded ml-2 flex-shrink-0"
                  >
                    Done
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (projectSelectIdx !== null) {
      const task = reminders[projectSelectIdx];
      if (!task) {
           setProjectSelectIdx(null);
           return null;
      }
      
      return (
        <div className="w-full h-full flex items-center justify-center p-2 bg-transparent select-none">
          <div className="w-full h-full bg-[#0F172A] border border-white/10 rounded-xl shadow-[0_0_60px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-300">
             <div className="p-6 border-b border-white/5 bg-[#111827]">
                 <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-2">Assign Project</h2>
                 <p className="text-lg text-white line-clamp-2">{task.title}</p>
             </div>
             
             <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1 bg-[#0F172A]">
                 <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2 px-2">Select a project to archive task</div>
                 {projects.map(p => (
                     <button
                        key={p.id}
                        onClick={async () => {
                            await window.api.updateTask(task.id, { project_id: p.id, status: 'archived' });
                            
                            // Remove from local list
                            setReminders(prev => prev.filter((_, i) => i !== projectSelectIdx));
                            setProjectSelectIdx(null);
                            
                            if (reminders.length <= 1) {
                                window.api.hideReminder();
                            }
                        }}
                        className="w-full text-left px-3 py-3 rounded-lg hover:bg-indigo-600/20 hover:border-indigo-500/50 border border-transparent transition-all group flex justify-between items-center"
                     >
                         <div className="flex items-center gap-3">
                             <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }}></div>
                             <span className="font-medium text-gray-300 group-hover:text-white">{p.name}</span>
                         </div>
                         <Folder size={14} className="text-gray-600 group-hover:text-indigo-400" />
                     </button>
                 ))}
             </div>
             
             <div className="p-3 bg-[#111827] border-t border-white/5">
                 <button 
                    onClick={() => setProjectSelectIdx(null)}
                    className="w-full py-2 bg-white/5 hover:bg-white/10 text-gray-400 rounded-lg text-xs font-bold"
                 >
                     Cancel
                 </button>
             </div>
          </div>
        </div>
      );
  }

  return mainContent;
};
