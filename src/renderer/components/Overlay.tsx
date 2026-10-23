import { useState, useEffect, useRef } from 'react';
import { Task } from '../../shared/types';
import { countBangs } from '../../shared/priority';
import clsx from 'clsx';
import { Brain, Pause, Zap, Activity, Bell, Target, Bot, ChevronRight } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { getAncestorChain } from '../../shared/hierarchy';

interface OverlaySettings {

  opacity: number;
  fontSize: number;
  color: string;
  mouseIgnore: boolean;
  focusGlowEnabled: boolean;
  focusGlowIntensity: number;
  focusGlowSpeed: number;
  focusMarqueeEnabled: boolean;
  focusMarqueeSpeed: number;
  sideGlowEnabled: boolean;
  sideMarqueeEnabled: boolean;
  position: { x: number, y: number };
}

interface MarqueeTitleProps {
  title: string;
  glowClass?: string;
  glowStyle?: React.CSSProperties;
  marqueeEnabled: boolean;
  marqueeSpeed: number; // px per second
  fontSize: number;     // re-measure dependency only
  className?: string;
  fallbackClassName?: string;
}

// Scrollable + glowable task title shared by the Focus row and the secondary
// Focus rows. Marquee: two copies, each at least one viewport wide, shift one
// cell per cycle — a single visible title wraps around with no blank gap.
// Keyframes live in index.css (.overlay-marquee-track / .overlay-focus-glow).
const MarqueeTitle = ({
  title, glowClass, glowStyle, marqueeEnabled, marqueeSpeed, fontSize,
  className, fallbackClassName = "line-clamp-2 whitespace-normal break-words"
}: MarqueeTitleProps) => {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const [cellWidth, setCellWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    if (!marqueeEnabled) return;
    const viewport = viewportRef.current;
    const copy = viewport?.firstElementChild?.firstElementChild as HTMLElement | null;
    if (!viewport || !copy) return;
    const check = () => {
      setCellWidth(copy.offsetWidth);
      setViewportWidth(viewport.clientWidth);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [title, marqueeEnabled, fontSize]);

  const trackStyle = {
    '--marquee-duration': `${Math.max(0.5, cellWidth / marqueeSpeed).toFixed(2)}s`,
    '--marquee-cell': `${cellWidth || 120}px`,
  } as React.CSSProperties;

  if (!marqueeEnabled) {
    return <span className={clsx("leading-tight", fallbackClassName, glowClass, className)} style={glowStyle}>{title}</span>;
  }
  return (
    <span ref={viewportRef} className={clsx("flex-1 min-w-0 overflow-hidden leading-tight", glowClass, className)} style={glowStyle}>
      <span className="overlay-marquee-track flex w-max" style={trackStyle}>
        {Array.from({ length: 2 }, (_, i) => (
          <span key={i} className="whitespace-nowrap shrink-0" style={{ minWidth: `${viewportWidth || 200}px` }} aria-hidden={i > 0 ? true : undefined}>{title}</span>
        ))}
      </span>
    </span>
  );
};

export const Overlay = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const trainingStatus = useStore(state => state.trainingStatus);
  const aiReminders = useStore(state => state.aiReminders);
  const [, setTick] = useState(0);
  const [settings, setSettings] = useState<OverlaySettings>({

    opacity: 0.8,
    fontSize: 14,
    color: '#ffffff',
    mouseIgnore: true,
    focusGlowEnabled: true,
    focusGlowIntensity: 6,
    focusGlowSpeed: 3,
    focusMarqueeEnabled: true,
    focusMarqueeSpeed: 30,
    sideGlowEnabled: true,
    sideMarqueeEnabled: true,
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
      mouseIgnore: true,
      focusGlowEnabled: true,
      focusGlowIntensity: 6,
      focusGlowSpeed: 3,
      focusMarqueeEnabled: true,
      focusMarqueeSpeed: 30,
      sideGlowEnabled: true,
      sideMarqueeEnabled: true
    });
    setSettings(prev => ({ ...prev, ...s }));
    
    // Apply mouse ignore state to window
    if (s.mouseIgnore !== undefined) {
        window.api.setOverlayIgnoreMouse(s.mouseIgnore);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSettings();

    const u1 = window.api.onTimerUpdate(fetchData);
    const u2 = window.api.onFetchTasks(fetchData);

    // Lightweight display tick: recalculates timer text every second
    // without fetching any data from the main process
    const tickInterval = setInterval(() => setTick(t => t + 1), 1000);

    // Settings change rarely — poll every 10s instead of 2s
    const settingsInterval = setInterval(fetchSettings, 10000);

    return () => {
      u1();
      u2();
      clearInterval(tickInterval);
      clearInterval(settingsInterval);
    };
  }, []);

  // Priority: Standard Active Task (Current Focus)
  const activeTask = tasks.find(t => t.status === 'active' && t.type === 'standard') || tasks.find(t => t.status === 'active' && t.timer_type === 'focus');

  // Breadcrumb of the focus task's position in the tree (root → immediate
  // parent), shown as a dim line above the title when it's a subtask.
  const focusAncestors = activeTask ? getAncestorChain(tasks, activeTask.id) : [];

  // Row 1.5: Secondary Focus — up to 2 flagged tasks, right below Focus
  const sideFocusTasks = tasks
      .filter(t => t.is_side_focus === 1 && t.status !== 'archived' && t.id !== activeTask?.id)
      .slice(0, 2);

  // Row 2: Suspended (Waiting Standard) - Top 3, No Ad-hoc
  const suspendedTasks = tasks
      .filter(t => t.status === 'waiting' && t.type === 'standard' && t.id !== activeTask?.id)
      .sort((a, b) => (a.target_timestamp && b.target_timestamp) ? a.target_timestamp.localeCompare(b.target_timestamp) : 0)
      .slice(0, 3);

  // Row 3: Queued - Standard, bang priority ("!" count, NO parent/child
  // aggregation by design) first, then last_focused_at (most recent first)
  const queuedTasks = tasks
      .filter(t => t.status === 'queued' && t.type === 'standard')
      .sort((a, b) => {
          const bangDiff = countBangs(b.title) - countBangs(a.title);
          if (bangDiff !== 0) return bangDiff;
          const aTime = a.last_focused_at ? new Date(a.last_focused_at).getTime() : 0;
          const bTime = b.last_focused_at ? new Date(b.last_focused_at).getTime() : 0;
          return bTime - aTime;
      })
      .slice(0, 3);

  // Row: Soft Reminders - expired reminder wait timers (breathing pulse)
  const softReminders = tasks
      .filter(t => t.type === 'reminder' && t.status === 'waiting' && t.target_timestamp && new Date(t.target_timestamp).getTime() <= Date.now())
      .slice(0, 3);

  // Row 4: Reminders - pending (non-expired) only, Top 3, sorted by timer
  const reminderTasks = tasks
      .filter(t => t.type === 'reminder' && t.status !== 'archived' && t.id !== activeTask?.id && !softReminders.includes(t))
      .sort((a, b) => (a.target_timestamp && b.target_timestamp) ? a.target_timestamp.localeCompare(b.target_timestamp) : 0)
      .slice(0, 3);

  // Row 4.5: AI Reminders — ephemeral agent cards (hook port), newest first.
  // The aiReminders store is populated in App.tsx via the ai:reminder event;
  // hard-reminder statuses never reach here (they become Reminder-window tasks).
  const aiReminderCards = aiReminders.slice(0, 2);

  // Row 5: Training - Top 3 most recent, sorted by end time
  const trainingTasks = tasks
      .filter(t => t.type === 'training' && t.status !== 'archived' && t.id !== activeTask?.id)
      .map(t => {
          const status = trainingStatus[t.id];
          const m = (status?.metrics || {}) as Record<string, unknown>;
          const etaHours = m['train/eta_hours'] as number;
          const endTime = (etaHours != null && status?.lastUpdated)
              ? status.lastUpdated + etaHours * 3600 * 1000
              : null;
          return { task: t, status, endTime };
      })
      .sort((a, b) => (a.endTime ?? 0) - (b.endTime ?? 0))
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

  const baseStyle: React.CSSProperties & { WebkitAppRegion?: string } = {
    opacity: settings.opacity,
    color: settings.color,
    fontSize: `${settings.fontSize}px`,
    WebkitAppRegion: !settings.mouseIgnore ? 'drag' : 'no-drag',
  };

  // Focus text breathing glow — title/timer text only, never the row background.
  // Keyframes live in index.css (.overlay-focus-glow) and read these CSS vars.
  const focusGlowOn = settings.focusGlowEnabled && !!activeTask;
  const focusGlowStyle = focusGlowOn ? ({
    '--focus-glow-radius': `${settings.focusGlowIntensity}px`,
    '--focus-glow-speed': `${settings.focusGlowSpeed}s`,
  } as React.CSSProperties) : undefined;

  // Secondary Focus glow — independent toggle, shares intensity/speed with the Focus row
  const sideGlowOn = settings.sideGlowEnabled && sideFocusTasks.length > 0;
  const sideGlowStyle = sideGlowOn ? ({
    '--focus-glow-radius': `${settings.focusGlowIntensity}px`,
    '--focus-glow-speed': `${settings.focusGlowSpeed}s`,
  } as React.CSSProperties) : undefined;

  return (
    <div 
      className={clsx(
        "w-full h-full flex flex-col gap-0.5 p-2 select-none overflow-hidden",
        !settings.mouseIgnore ? "cursor-move bg-black/10 border border-white/20 rounded-lg" : "pointer-events-none"
      )}
      style={baseStyle}
    >
      <style>{`@keyframes overlayBreathe{0%,100%{opacity:.55}50%{opacity:1}}.overlay-breathe{animation:overlayBreathe 2.4s ease-in-out infinite}`}</style>

      {/* Row 1: Focus (Full) */}
      <div className="flex items-center gap-2 font-bold bg-black/20 p-2 rounded mb-1">
        <Brain size={settings.fontSize + 4} />
        {activeTask ? (
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                {focusAncestors.length > 0 && (
                    <div className="flex items-center gap-0.5 text-[0.7em] font-normal opacity-60 min-w-0">
                        {focusAncestors.map(p => (
                            <span key={p.id} className="flex items-center gap-0.5 min-w-0">
                                <span className="truncate">{p.title}</span>
                                <ChevronRight size={settings.fontSize * 0.7} className="shrink-0" />
                            </span>
                        ))}
                    </div>
                )}
                <div className="flex justify-between items-start gap-2 min-w-0">
                    <MarqueeTitle
                        title={activeTask.title}
                        glowClass={focusGlowOn ? 'overlay-focus-glow' : undefined}
                        glowStyle={focusGlowStyle}
                        marqueeEnabled={settings.focusMarqueeEnabled}
                        marqueeSpeed={settings.focusMarqueeSpeed}
                        fontSize={settings.fontSize}
                    />
                    <span className={clsx("font-mono whitespace-nowrap", focusGlowOn && "overlay-focus-glow")} style={focusGlowStyle}>{getTimerDisplay(activeTask)}</span>
                </div>
            </div>
        ) : (
            <span className="opacity-50 italic">No Active Focus</span>
        )}
      </div>

      {/* Row 1.5: Secondary Focus (副 Focus) — glow/marquee mirror the Focus row, gated by their own toggles */}
      {sideFocusTasks.length > 0 && (
          <div className="flex flex-col gap-0.5 font-semibold text-sky-300 bg-sky-500/10 p-1 rounded">
              {sideFocusTasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2 text-[0.9em]">
                      <Target size={settings.fontSize * 0.8} className="shrink-0" />
                      <MarqueeTitle
                          title={t.title}
                          glowClass={sideGlowOn ? 'overlay-focus-glow' : undefined}
                          glowStyle={sideGlowStyle}
                          marqueeEnabled={settings.sideMarqueeEnabled}
                          marqueeSpeed={settings.focusMarqueeSpeed}
                          fontSize={settings.fontSize}
                          fallbackClassName="flex-1 truncate"
                      />
                      <span className={clsx("font-mono text-[0.8em] opacity-80 whitespace-nowrap", sideGlowOn && "overlay-focus-glow")} style={sideGlowStyle}>{getTimerDisplay(t)}</span>
                  </div>
              ))}
          </div>
      )}

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

      {/* Row 4: 提醒 */}
      {reminderTasks.length > 0 && (
          <div className="flex items-center gap-3 text-amber-400 font-bold bg-amber-500/10 p-1 rounded">
              <Zap size={settings.fontSize * 0.8} />
              {reminderTasks.map(t => (
                   <div key={t.id} className="flex gap-1 items-center text-[0.8em]">
                       <span className="truncate max-w-[80px]">{t.title}</span>
                       <span className="font-mono">{getTimerDisplay(t)}</span>
                   </div>
              ))}
          </div>
      )}

      {/* Row 4.5: AI Reminders (hook port) — ephemeral agent cards */}
      {aiReminderCards.length > 0 && (
          <div className="flex flex-col gap-0.5 text-cyan-300 bg-cyan-500/10 p-1 rounded">
              {aiReminderCards.map(r => (
                  <div key={r.id} className="flex items-center gap-1.5 text-[0.85em]">
                      <Bot size={settings.fontSize * 0.75} className="shrink-0" />
                      <span className="truncate flex-1 font-semibold">{r.title}</span>
                      {r.status !== 'info' && (
                          <span className="font-mono text-[0.75em] opacity-80 whitespace-nowrap">{r.status}</span>
                      )}
                  </div>
              ))}
          </div>
      )}

      {/* Row 5: Training */}
      {trainingTasks.length > 0 && (
          <div className="flex flex-col gap-0.5 text-green-400 bg-green-500/10 p-1 rounded">
              <div className="flex items-center gap-1 text-[0.8em] font-bold opacity-80">
                  <Activity size={settings.fontSize * 0.7} />
                  <span>训练</span>
              </div>
              {trainingTasks.map(({ task: t, status, endTime }) => {
                   const m = (status?.metrics || {}) as Record<string, unknown>;
                   const cfgName = (m['cfgname'] as string) || status?.modelName || t.title;
                   const fmtTime = endTime
                       ? new Date(endTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                       : (status?.eta ? `ETA: ${status.eta}` : '');
                   return (
                   <div key={t.id} className="flex justify-between items-center text-[0.8em] gap-2">
                       <span className="truncate flex-1">{cfgName}</span>
                       {fmtTime && <span className="font-mono whitespace-nowrap opacity-90">{fmtTime}</span>}
                   </div>
                   );
              })}
          </div>
       )}

      {/* Row: 过期提醒 (breathing) — bottom */}
      {softReminders.length > 0 && (
          <div className="overlay-breathe flex flex-col gap-0.5 text-rose-300 font-bold bg-rose-500/15 p-1 rounded">
              {softReminders.map(t => (
                  <div key={t.id} className="flex items-center gap-1.5 text-[0.85em]">
                      <Bell size={settings.fontSize * 0.75} className="shrink-0" />
                      <span className="truncate flex-1">{t.title || '提醒'}</span>
                  </div>
              ))}
          </div>
      )}

    </div>
  );
};
