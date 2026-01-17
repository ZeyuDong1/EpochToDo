import { useState, useEffect } from 'react';
import { Task } from '../../shared/types';
import clsx from 'clsx';
import { Brain, Pause, Zap, Activity } from 'lucide-react';

interface OverlaySettings {
  opacity: number;
  fontSize: number;
  color: string;
  mouseIgnore: boolean;
  position: { x: number, y: number };
}

export const Overlay = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<OverlaySettings>({
    opacity: 0.8,
    fontSize: 14,
    color: '#ffffff',
    mouseIgnore: true,
    position: { x: 0, y: 0 }
  });

  const fetchData = async () => {
    const t = await window.api.getTasks();
    setTasks(t);
  };

  const fetchSettings = async () => {
    // We assume settings are stored under 'overlay_settings' key
    const s = await window.api.getSettings('overlay_settings', {
      opacity: 0.8,
      fontSize: 14,
      color: '#ffffff',
      mouseIgnore: true
    });
    setSettings(prev => ({ ...prev, ...s }));
    
    // Apply mouse ignore state to window
    if (s.mouseIgnore !== undefined) {
        // @ts-ignore
        window.api.setOverlayIgnoreMouse(s.mouseIgnore);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSettings();
    
    const u1 = window.api.onTimerUpdate(fetchData);
    // @ts-ignore
    const u2 = window.api.onFetchTasks ? window.api.onFetchTasks(fetchData) : null;
    
    // Listen for settings updates if we implement a settings changed event
    // For now we might poll or rely on manual refresh if settings change in Dashboard
    const interval = setInterval(fetchSettings, 2000); // Poll settings for now to verify changes from Dashboard

    return () => {
      // @ts-ignore
      u1?.(); u2?.();
      clearInterval(interval);
    };
  }, []);

  const activeTask = tasks.find(t => t.status === 'active');

  // Row 2: Suspended (Waiting Standard) - Top 3, No Ad-hoc
  const suspendedTasks = tasks
      .filter(t => t.status === 'waiting' && t.type === 'standard' && t.id !== activeTask?.id)
      .sort((a, b) => (a.target_timestamp && b.target_timestamp) ? a.target_timestamp.localeCompare(b.target_timestamp) : 0)
      .slice(0, 3);

  // Row 3: Queued - Standard
  const queuedTasks = tasks
      .filter(t => t.status === 'queued' && t.type === 'standard')
      .slice(0, 3);

  // Row 4: Ad-Hoc - Top 3, sorted by timer
  const adHocTasks = tasks
      .filter(t => t.type === 'ad-hoc' && t.status !== 'archived' && t.id !== activeTask?.id)
      .sort((a, b) => (a.target_timestamp && b.target_timestamp) ? a.target_timestamp.localeCompare(b.target_timestamp) : 0)
      .slice(0, 3);

  // Row 5: Training - Top 3, sorted by timer
  const trainingTasks = tasks
      .filter(t => t.type === 'training' && t.status !== 'archived' && t.id !== activeTask?.id)
      .sort((a, b) => (a.target_timestamp && b.target_timestamp) ? a.target_timestamp.localeCompare(b.target_timestamp) : 0)
      .slice(0, 3);

  // Helper to calculate countdown or stopwatch
  const getTimerDisplay = (task: Task) => {
    // Priority 1: Countdown (Target)
    if (task.target_timestamp) {
        const diff = new Date(task.target_timestamp).getTime() - new Date().getTime();
        // If overlap or just done
        if (diff <= -2000) return 'DONE'; 
        if (diff <= 0) return '00:00';
        
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);

        if (d > 0) return `${d}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    
    // Priority 2: Stopwatch (Elapsed) - only for active/running tasks
    if (task.status === 'active' && task.started_at) {
        const start = new Date(task.started_at).getTime();
        const now = Date.now();
        const totalSeconds = task.total_duration + Math.max(0, Math.floor((now - start) / 1000));
        
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        
        if (d > 0) return `${d}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    
    return '';
  };

  const baseStyle: React.CSSProperties = {
    opacity: settings.opacity,
    color: settings.color,
    fontSize: `${settings.fontSize}px`,
    // @ts-ignore
    WebkitAppRegion: !settings.mouseIgnore ? 'drag' : 'no-drag'
  };

  return (
    <div 
      className={clsx(
        "w-full h-full flex flex-col gap-0.5 p-2 select-none overflow-hidden",
        !settings.mouseIgnore ? "cursor-move bg-black/10 border border-white/20 rounded-lg" : "pointer-events-none"
      )}
      style={baseStyle}
    >
      {/* Row 1: Focus (Full) */}
      <div className="flex items-center gap-2 font-bold bg-black/20 p-2 rounded mb-1">
        <Brain size={settings.fontSize + 4} />
        {activeTask ? (
            <div className="flex-1 flex justify-between items-start gap-2">
                <span className="line-clamp-2 whitespace-normal break-words leading-tight">{activeTask.title}</span>
                <span className="font-mono whitespace-nowrap">{getTimerDisplay(activeTask)}</span>
            </div>
        ) : (
            <span className="opacity-50 italic">No Active Focus</span>
        )}
      </div>

      {/* Row 2: Suspended (Narrower) */}
      {suspendedTasks.length > 0 && (
          <div className="flex flex-col gap-0.5 bg-black/10 p-1 rounded">
             {suspendedTasks.map(t => (
                 <div key={t.id} className="flex items-center gap-2 opacity-80 text-[0.9em]">
                    <Pause size={settings.fontSize * 0.9} />
                    <span className="truncate flex-1">{t.title}</span>
                    <span className="font-mono text-[0.8em]">{getTimerDisplay(t)}</span>
                 </div>
             ))}
          </div>
      )}

      {/* Row 3: Queued */}
      {queuedTasks.length > 0 && (
          <div className="flex flex-col gap-0.5 opacity-70 text-[0.9em] px-1 my-1">
              {queuedTasks.map(t => (
                  <div key={t.id} className="truncate">• {t.title}</div>
              ))}
          </div>
      )}

      {/* Row 4: Ad-Hoc */}
      {adHocTasks.length > 0 && (
          <div className="flex items-center gap-3 text-amber-400 font-bold bg-amber-500/10 p-1 rounded">
              <Zap size={settings.fontSize * 0.8} />
              {adHocTasks.map(t => (
                   <div key={t.id} className="flex gap-1 items-center text-[0.8em]">
                       <span className="truncate max-w-[80px]">{t.title}</span>
                       <span className="font-mono">{getTimerDisplay(t)}</span>
                   </div>
              ))}
          </div>
      )}

      {/* Row 5: Training */}
      {trainingTasks.length > 0 && (
          <div className="flex items-center gap-3 text-green-400 font-bold bg-green-500/10 p-1 rounded">
              <Activity size={settings.fontSize * 0.8} />
              {trainingTasks.map(t => (
                   <div key={t.id} className="flex gap-1 items-center text-[0.8em]">
                       <span className="truncate max-w-[80px]">{t.title}</span>
                       <span className="font-mono">{getTimerDisplay(t)}</span>
                   </div>
              ))}
          </div>
      )}
    </div>
  );
};
