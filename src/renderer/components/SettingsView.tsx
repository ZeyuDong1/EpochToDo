import { useState, useEffect } from 'react';
import { Keyboard, Save, Database, Layers, MousePointer2, Cpu, BellOff } from 'lucide-react';
import clsx from 'clsx';
import { ConfirmModal } from './ConfirmModal';

interface OverlaySettings {
    opacity: number;
    fontSize: number;
    color: string;
    mouseIgnore: boolean;
}

export const SettingsView = () => {
    const [shortcut, setShortcut] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    
    // Overlay Settings
    const [overlaySettings, setOverlaySettings] = useState<OverlaySettings>({
        opacity: 0.8,
        fontSize: 14,
        color: '#ffffff',
        mouseIgnore: true
    });
    
    // Clear Database Confirm
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    // GPU Settings
    const [gpuQuietHours, setGpuQuietHours] = useState({ start: 23, end: 8 });
    const [gpuIdleInterval, setGpuIdleInterval] = useState(15);
    const [reminderNagInterval, setReminderNagInterval] = useState(15);

    useEffect(() => {
        window.api.getSettings('global_shortcut', 'Alt+Space').then(setShortcut);
        window.api.getSettings('overlay_settings', {
            opacity: 0.8, 
            fontSize: 14, 
            color: '#ffffff', 
            mouseIgnore: true
        }).then(setOverlaySettings);
        
        window.api.getSettings('gpu_quiet_hours', { start: 23, end: 8 }).then(v => {
            // Parsed JSON usually? or raw object if backend parses?
            // backend getSettings uses JSON.parse if string.
            // If default is passed as object, it returns object.
            // So if coming from DB string, it's object.
             setGpuQuietHours(typeof v === 'string' ? JSON.parse(v) : v);
        });
        window.api.getSettings('gpu_idle_interval', 15).then(v => setGpuIdleInterval(Number(v)));
        window.api.getSettings('reminder_nag_interval', 15).then(v => setReminderNagInterval(Number(v)));
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isRecording) return;
        e.preventDefault();
        
        const keys = [];
        if (e.ctrlKey) keys.push('Ctrl');
        if (e.metaKey) keys.push('Cmd');
        if (e.altKey) keys.push('Alt');
        if (e.shiftKey) keys.push('Shift');
        
        if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;

        let key = e.key;
        if (key === ' ') key = 'Space';
        else if (key.length === 1) key = key.toUpperCase();

        keys.push(key);
        setShortcut(keys.join('+'));
        setIsRecording(false);
    };

    const saveShortcut = async () => {
        try {
            const success = await window.api.registerShortcut(shortcut);
            setStatus(success ? 'success' : 'error');
            if (success) setTimeout(() => setStatus('idle'), 2000);
        } catch (e) {
            setStatus('error');
        }
    };

    const updateOverlay = async (key: keyof OverlaySettings, value: any) => {
        const newS = { ...overlaySettings, [key]: value };
        setOverlaySettings(newS);
        await window.api.updateSetting('overlay_settings', newS);
        if (key === 'mouseIgnore') {
            // @ts-ignore
            await window.api.setOverlayIgnoreMouse(value);
        }
    };

    return (
        <div className="flex-1 flex flex-col bg-[#0B0F19] text-gray-200 overflow-y-auto">
             <div className="h-16 border-b border-[#1f2937] flex items-center px-8 bg-[#111827]/80 backdrop-blur z-20">
                <h1 className="text-2xl font-light text-white tracking-tight">Settings</h1>
            </div>

            <div className="p-8 max-w-3xl space-y-12">
                
                {/* Section: Shortcuts */}
                <section>
                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                        <Keyboard size={18} /> Shortcuts
                    </h2>
                    
                    <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="font-medium text-white">Spotlight Activator</h3>
                                <p className="text-sm text-gray-500 mt-1">Global hotkey to toggle the command bar.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <div 
                                    className={clsx(
                                        "bg-[#0B0F19] border rounded px-4 py-2 font-mono text-sm min-w-[120px] text-center cursor-pointer transition-colors relative overflow-hidden",
                                        isRecording ? "border-indigo-500 text-indigo-400" : "border-[#374151] text-gray-300 hover:border-gray-500"
                                    )}
                                    onClick={() => { setIsRecording(true); setStatus('idle'); }}
                                    tabIndex={0}
                                    onKeyDown={handleKeyDown}
                                >
                                    {isRecording ? "Press keys..." : shortcut}
                                    {isRecording && <div className="absolute inset-0 bg-indigo-500/10 animate-pulse"></div>}
                                </div>
                                <button 
                                    onClick={saveShortcut}
                                    disabled={isRecording}
                                    className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Save size={18} />
                                </button>
                            </div>
                        </div>
                        {status === 'success' && <div className="text-xs text-green-400 text-right font-mono">Saved & Registered!</div>}
                        {status === 'error' && <div className="text-xs text-red-400 text-right font-mono">Failed to register. Standard keys only?</div>}
                    </div>
                </section>

                {/* Section: GPU Management */}
                <section>
                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                        <Cpu size={18} /> GPU Management
                    </h2>
                    
                    <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6 space-y-6">
                         
                         {/* Idle Interval */}
                         <div>
                            <label className="block text-sm font-medium text-white mb-2">Idle Reminder Interval (minutes)</label>
                            <div className="flex items-center gap-4">
                                <input 
                                    type="number" 
                                    min="1" max="120"
                                    value={gpuIdleInterval}
                                    onChange={(e) => {
                                        const v = parseInt(e.target.value);
                                        setGpuIdleInterval(v);
                                        window.api.updateSetting('gpu_idle_interval', v);
                                    }}
                                    className="bg-[#0B0F19] border border-[#374151] rounded px-4 py-2 text-white w-24 focus:border-indigo-500 outline-none"
                                />
                                <span className="text-sm text-gray-500">Default: 15 minutes</span>
                            </div>
                         </div>

                         <div className="h-[1px] bg-[#1f2937]"></div>

                         {/* Quiet Hours */}
                         <div>
                            <h3 className="font-medium text-white flex items-center gap-2 mb-2">
                                <BellOff size={16} className="text-gray-400"/> 
                                Quiet Hours (Do Not Disturb)
                            </h3>
                            <p className="text-sm text-gray-500 mb-4">
                                Prevent GPU idle notifications during this period.
                            </p>
                            
                            <div className="flex items-center gap-4">
                                <div>
                                    <label className="text-xs text-gray-500 uppercase block mb-1">Start Hour (0-23)</label>
                                    <input 
                                        type="number" 
                                        min="0" max="23"
                                        value={gpuQuietHours.start}
                                        onChange={(e) => {
                                             const v = parseInt(e.target.value);
                                             const newS = { ...gpuQuietHours, start: v };
                                             setGpuQuietHours(newS);
                                             window.api.updateSetting('gpu_quiet_hours', newS);
                                        }}
                                        className="bg-[#0B0F19] border border-[#374151] rounded px-4 py-2 text-white w-20 focus:border-indigo-500 outline-none"
                                    />
                                </div>
                                <span className="text-gray-500 pt-5">to</span>
                                <div>
                                    <label className="text-xs text-gray-500 uppercase block mb-1">End Hour (0-23)</label>
                                    <input 
                                        type="number" 
                                        min="0" max="23"
                                        value={gpuQuietHours.end}
                                        onChange={(e) => {
                                             const v = parseInt(e.target.value);
                                             const newS = { ...gpuQuietHours, end: v };
                                             setGpuQuietHours(newS);
                                             window.api.updateSetting('gpu_quiet_hours', newS);
                                        }}
                                        className="bg-[#0B0F19] border border-[#374151] rounded px-4 py-2 text-white w-20 focus:border-indigo-500 outline-none"
                                    />
                                </div>
                            </div>
                         </div>
                         {/* General Reminder Interval */}
                          <div className="h-[1px] bg-[#1f2937]"></div>
                         
                          <div>
                            <label className="block text-sm font-medium text-white mb-2">General Task Reminder Interval (minutes)</label>
                            <div className="flex items-center gap-4">
                                <input 
                                    type="number" 
                                    min="1" max="1440"
                                    value={reminderNagInterval}
                                    onChange={(e) => {
                                        const v = parseInt(e.target.value);
                                        setReminderNagInterval(v);
                                        window.api.updateSetting('reminder_nag_interval', v);
                                    }}
                                    className="bg-[#0B0F19] border border-[#374151] rounded px-4 py-2 text-white w-24 focus:border-indigo-500 outline-none"
                                />
                                <span className="text-sm text-gray-500">Repeats every X minutes until done</span>
                            </div>
                          </div>
                    </div>
                </section>

                {/* Section: Task Persistence Overlay */}
                <section>
                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                        <Layers size={18} /> Task Persistence Overlay
                    </h2>
                    
                    <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6 space-y-6">
                         {/* Mouse Interaction */}
                         <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-medium text-white flex items-center gap-2">
                                    <MousePointer2 size={16} className="text-gray-400"/> 
                                    Mouse Pass-Through
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    If ON, clicks pass through the overlay. Turn OFF to move/drag the window.
                                </p>
                            </div>
                            <button 
                                onClick={() => updateOverlay('mouseIgnore', !overlaySettings.mouseIgnore)}
                                className={clsx(
                                    "px-4 py-2 rounded text-sm font-bold transition-all",
                                    overlaySettings.mouseIgnore 
                                        ? "bg-green-500/20 text-green-400 border border-green-500/50" 
                                        : "bg-red-500/20 text-red-400 border border-red-500/50"
                                )}
                            >
                                {overlaySettings.mouseIgnore ? "ENABLED" : "DISABLED"}
                            </button>
                        </div>

                        <div className="h-[1px] bg-[#1f2937]"></div>

                        {/* Appearance Controls */}
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Opacity ({Math.round(overlaySettings.opacity * 100)}%)</label>
                                <input 
                                    type="range" 
                                    min="0.1" max="1" step="0.05"
                                    value={overlaySettings.opacity}
                                    onChange={(e) => updateOverlay('opacity', parseFloat(e.target.value))}
                                    className="w-full accent-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Font Size ({overlaySettings.fontSize}px)</label>
                                <input 
                                    type="range" 
                                    min="10" max="24" step="1"
                                    value={overlaySettings.fontSize}
                                    onChange={(e) => updateOverlay('fontSize', parseInt(e.target.value))}
                                    className="w-full accent-indigo-500"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Text Color</label>
                            <div className="flex gap-2">
                                {['#ffffff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6'].map(c => (
                                    <button 
                                        key={c}
                                        onClick={() => updateOverlay('color', c)}
                                        className={clsx(
                                            "w-6 h-6 rounded-full border-2 transition-all",
                                            overlaySettings.color === c ? "border-white scale-110 shadow" : "border-transparent opacity-50 hover:opacity-100"
                                        )}
                                        style={{ backgroundColor: c }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Section: General / Data */}
                <section>
                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                        <Database size={18} /> Data & System
                    </h2>
                    
                    <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6 space-y-6">
                         <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-medium text-white">App Theme</h3>
                                <p className="text-sm text-gray-500 mt-1">Appearance currently locked to 'Midnight'.</p>
                            </div>
                            <div className="flex gap-2">
                                <button className="px-3 py-1.5 bg-[#1f2937] text-gray-300 rounded text-xs border border-transparent hover:border-gray-500 transition">Dark</button>
                                <button className="px-3 py-1.5 bg-[#0B0F19] text-gray-600 rounded text-xs border border-[#1f2937] cursor-not-allowed opacity-50">Light</button>
                            </div>
                        </div>

                        <div className="border-t border-[#1f2937] pt-6 flex items-center justify-between">
                             <div>
                                <h3 className="font-medium text-red-400">Danger Zone</h3>
                                <p className="text-sm text-gray-500 mt-1">Irrevocable actions.</p>
                            </div>
                            <button 
                                onClick={() => setShowClearConfirm(true)}
                                className="px-4 py-2 border border-red-900/50 hover:bg-red-900/20 text-red-400 rounded text-sm transition"
                            >
                                Clear Database
                            </button>
                        </div>
                    </div>
                </section>
            </div>
            
            <ConfirmModal 
                isOpen={showClearConfirm}
                onClose={() => setShowClearConfirm(false)}
                onConfirm={async () => {
                   // @ts-ignore
                   await window.api.deleteAllTasks();
                   setStatus('success');
                   setTimeout(() => setStatus('idle'), 2000);
                }}
                title="DANGER: CLEAR DATABASE"
                message="This will permanently delete ALL tasks. This action cannot be undone."
                strict={true}
            />
        </div>
    );
};
