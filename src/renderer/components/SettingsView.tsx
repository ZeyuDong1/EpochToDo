import { useState, useEffect } from 'react';
import { Keyboard, Save, Database, Layers, MousePointer2, Cpu, BellOff, RotateCcw, Rocket, Settings, Clock, Activity, FileText, FolderOpen, AlertTriangle, CheckCircle, Brain, Repeat } from 'lucide-react';
import clsx from 'clsx';
import { ConfirmModal } from './ConfirmModal';

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
}

const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
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
};

type TabId = 'general' | 'gpu' | 'overlay' | 'data' | 'mdsync';

const TABS: { id: TabId; label: string; icon: typeof Keyboard }[] = [
    { id: 'general', label: '通用', icon: Settings },
    { id: 'gpu', label: 'GPU 与训练', icon: Cpu },
    { id: 'overlay', label: '悬浮窗', icon: Layers },
    { id: 'mdsync', label: 'MD 同步', icon: FileText },
    { id: 'data', label: '数据', icon: Database },
];

export const SettingsView = () => {
    const [activeTab, setActiveTab] = useState<TabId>('general');

    const [shortcut, setShortcut] = useState('');
    const [originalShortcut, setOriginalShortcut] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const [overlaySettings, setOverlaySettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);

    const [showClearConfirm, setShowClearConfirm] = useState(false);

    const [wandbApiKey, setWandbApiKey] = useState('');
    const [wandbEntity, setWandbEntity] = useState('');
    const [wandbTesting, setWandbTesting] = useState(false);
    const [wandbStatus, setWandbStatus] = useState<{ ok: boolean; msg: string } | null>(null);

    const [gpuQuietHours, setGpuQuietHours] = useState({ start: 23, end: 8 });
    const [gpuIdleInterval, setGpuIdleInterval] = useState(15);
    const [reminderNagInterval, setReminderNagInterval] = useState(15);
    const [autoLaunch, setAutoLaunch] = useState(false);
    const [webhookStalledThreshold, setWebhookStalledThreshold] = useState(5);
    const [webhookStalledInterval, setWebhookStalledInterval] = useState(10);

    useEffect(() => {
        window.api.getSettings('global_shortcut', 'Alt+Space').then(setShortcut);
        // Stored value may predate newer keys — merge over defaults.
        // Spread into a literal so the inferred type keeps an index signature for SettingValue.
        window.api.getSettings('overlay_settings', { ...DEFAULT_OVERLAY_SETTINGS })
            .then(s => setOverlaySettings(prev => ({ ...prev, ...s })));

        window.api.getSettings('gpu_quiet_hours', { start: 23, end: 8 }).then(v => {
             setGpuQuietHours(typeof v === 'string' ? JSON.parse(v) : v);
        });
        window.api.getSettings('gpu_idle_interval', 15).then(v => setGpuIdleInterval(Number(v)));
        window.api.getSettings('reminder_nag_interval', 15).then(v => setReminderNagInterval(Number(v)));

        window.api.getSettings('webhook_stalled_threshold', 5).then(v => setWebhookStalledThreshold(Number(v)));
        window.api.getSettings('webhook_stalled_interval', 10).then(v => setWebhookStalledInterval(Number(v)));

        window.api.getSettings('wandb_api_key', '').then(v => setWandbApiKey(String(v)));
        window.api.getSettings('wandb_entity', '').then(v => setWandbEntity(String(v)));

        window.api.getAutoLaunch().then(setAutoLaunch);
    }, []);

    const handleKeyDown = async (e: React.KeyboardEvent) => {
        if (!isRecording) return;
        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'Escape') {
            setIsRecording(false);
            setShortcut(originalShortcut);
            await window.api.registerShortcut(originalShortcut);
            return;
        }

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

    const resetShortcut = async () => {
        const defaultShortcut = 'Alt+Space';
        try {
            const success = await window.api.registerShortcut(defaultShortcut);
            if (success) {
                setShortcut(defaultShortcut);
                setStatus('success');
                setTimeout(() => setStatus('idle'), 2000);
            } else {
                setStatus('error');
            }
        } catch (e) {
            setStatus('error');
        }
    };

    const updateOverlay = async (key: keyof OverlaySettings, value: boolean | number | string) => {
        const newS = { ...overlaySettings, [key]: value };
        setOverlaySettings(newS);
        await window.api.updateSetting('overlay_settings', newS);
        if (key === 'mouseIgnore') {
            window.api.setOverlayIgnoreMouse(value as boolean);
        }
    };

    // CSS vars consumed by .overlay-focus-glow (keyframes in index.css)
    const focusGlowVars = {
        '--focus-glow-radius': `${overlaySettings.focusGlowIntensity}px`,
        '--focus-glow-speed': `${overlaySettings.focusGlowSpeed}s`,
    } as React.CSSProperties;

    return (
        <div className="flex-1 flex flex-col bg-[#0B0F19] text-gray-200 overflow-hidden">
            <div className="h-16 border-b border-[#1f2937] flex items-center px-8 bg-[#111827]/80 backdrop-blur z-20 shrink-0">
                <h1 className="text-2xl font-light text-white tracking-tight">Settings</h1>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <nav className="w-44 border-r border-[#1f2937] py-4 shrink-0">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={clsx(
                                    "w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors border-l-2",
                                    activeTab === tab.id
                                        ? "border-indigo-500 bg-indigo-500/10 text-white font-medium"
                                        : "border-transparent text-gray-400 hover:text-white hover:bg-white/5"
                                )}
                            >
                                <Icon size={16} />
                                {tab.label}
                            </button>
                        );
                    })}
                </nav>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8">
                    <div className="max-w-2xl space-y-8">

                        {/* ===== General ===== */}
                        {activeTab === 'general' && (<>
                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Keyboard size={16} /> 快捷键
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <h3 className="font-medium text-white">Spotlight 激活键</h3>
                                            <p className="text-sm text-gray-500 mt-1">全局热键，呼出命令栏。</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div
                                                className={clsx(
                                                    "bg-[#0B0F19] border rounded px-4 py-2 font-mono text-sm min-w-[120px] text-center cursor-pointer transition-colors relative overflow-hidden",
                                                    isRecording ? "border-indigo-500 text-indigo-400" : "border-[#374151] text-gray-300 hover:border-gray-500"
                                                )}
                                                onClick={async () => {
                                                    await window.api.unregisterShortcuts();
                                                    setOriginalShortcut(shortcut);
                                                    setIsRecording(true);
                                                    setStatus('idle');
                                                }}
                                                tabIndex={0}
                                                onKeyDown={handleKeyDown}
                                                onBlur={async () => {
                                                    if (isRecording) {
                                                        setIsRecording(false);
                                                        setShortcut(originalShortcut);
                                                        await window.api.registerShortcut(originalShortcut);
                                                    }
                                                }}
                                            >
                                                {isRecording ? "Press keys..." : shortcut}
                                                {isRecording && <div className="absolute inset-0 bg-indigo-500/10 animate-pulse"></div>}
                                            </div>
                                            <button
                                                onClick={saveShortcut}
                                                disabled={isRecording}
                                                className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Save Shortcut"
                                            >
                                                <Save size={18} />
                                            </button>
                                            <button
                                                onClick={resetShortcut}
                                                disabled={isRecording}
                                                className="p-2 bg-gray-600 hover:bg-gray-500 text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Reset to Alt+Space"
                                            >
                                                <RotateCcw size={18} />
                                            </button>
                                        </div>
                                    </div>
                                    {status === 'success' && <div className="text-xs text-green-400 text-right font-mono">Saved & Registered!</div>}
                                    {status === 'error' && <div className="text-xs text-red-400 text-right font-mono">Failed to register. Standard keys only?</div>}
                                </div>
                            </section>

                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Clock size={16} /> 提醒
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6">
                                    <label className="block text-sm font-medium text-white mb-2">通用任务提醒间隔 (分钟)</label>
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
                                        <span className="text-sm text-gray-500">完成后每隔 X 分钟重复提醒</span>
                                    </div>
                                </div>
                            </section>

                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Rocket size={16} /> 系统
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-medium text-white">开机自启</h3>
                                            <p className="text-sm text-gray-500 mt-1">Windows 启动时自动打开 EpochToDo。</p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                const next = !autoLaunch;
                                                await window.api.setAutoLaunch(next);
                                                setAutoLaunch(next);
                                            }}
                                            className={clsx(
                                                "px-4 py-2 rounded text-sm font-bold transition-all",
                                                autoLaunch
                                                    ? "bg-green-500/20 text-green-400 border border-green-500/50"
                                                    : "bg-red-500/20 text-red-400 border border-red-500/50"
                                            )}
                                        >
                                            {autoLaunch ? "ENABLED" : "DISABLED"}
                                        </button>
                                    </div>
                                </div>
                            </section>
                        </>)}

                        {/* ===== GPU & Training ===== */}
                        {activeTab === 'gpu' && (<>
                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Cpu size={16} /> GPU 空闲提醒
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6 space-y-6">
                                    <div>
                                        <label className="block text-sm font-medium text-white mb-2">空闲提醒间隔 (分钟)</label>
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
                                            <span className="text-sm text-gray-500">默认 15 分钟</span>
                                        </div>
                                    </div>

                                    <div className="h-[1px] bg-[#1f2937]"></div>

                                    <div>
                                        <h3 className="font-medium text-white flex items-center gap-2 mb-2">
                                            <BellOff size={16} className="text-gray-400"/>
                                            免打扰时段
                                        </h3>
                                        <p className="text-sm text-gray-500 mb-4">此时段内不发送 GPU 空闲通知。</p>
                                        <div className="flex items-center gap-4">
                                            <div>
                                                <label className="text-xs text-gray-500 uppercase block mb-1">起始 (0-23)</label>
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
                                                <label className="text-xs text-gray-500 uppercase block mb-1">结束 (0-23)</label>
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
                                </div>
                            </section>

                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Cpu size={16} /> 训练停滞告警
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6">
                                    <p className="text-sm text-gray-500 mb-4">所有训练任务（wandb / webhook / 手动分配）统一检测。</p>
                                    <div className="grid grid-cols-2 gap-6">
                                        <div>
                                            <label className="text-xs text-gray-500 uppercase block mb-1">停滞阈值 (分钟)</label>
                                            <input
                                                type="number"
                                                min="1" max="120"
                                                value={webhookStalledThreshold}
                                                onChange={(e) => {
                                                    const v = parseInt(e.target.value);
                                                    setWebhookStalledThreshold(v);
                                                    window.api.updateSetting('webhook_stalled_threshold', v);
                                                }}
                                                className="bg-[#0B0F19] border border-[#374151] rounded px-4 py-2 text-white w-full focus:border-indigo-500 outline-none"
                                            />
                                            <p className="text-[10px] text-gray-600 mt-1">无更新超过此时长即标记停滞。</p>
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-500 uppercase block mb-1">提醒间隔 (分钟)</label>
                                            <input
                                                type="number"
                                                min="1" max="120"
                                                value={webhookStalledInterval}
                                                onChange={(e) => {
                                                    const v = parseInt(e.target.value);
                                                    setWebhookStalledInterval(v);
                                                    window.api.updateSetting('webhook_stalled_interval', v);
                                                }}
                                                className="bg-[#0B0F19] border border-[#374151] rounded px-4 py-2 text-white w-full focus:border-indigo-500 outline-none"
                                            />
                                            <p className="text-[10px] text-gray-600 mt-1">重复提醒频率。</p>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Activity size={16} /> wandb 集成
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6 space-y-4">
                                    <p className="text-sm text-gray-500">
                                        配置后自动从 wandb 拉取训练状态（主要数据源），webhook 作为兜底。
                                        按 hostname 过滤，只追踪本机的 runs。
                                    </p>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase block mb-2">Entity（用户名 / 团队名）</label>
                                        <input
                                            type="text"
                                            value={wandbEntity}
                                            placeholder="例如 my-team"
                                            onChange={(e) => setWandbEntity(e.target.value)}
                                            onBlur={() => {
                                                window.api.updateSetting('wandb_entity', wandbEntity);
                                                window.api.wandbUpdate();
                                            }}
                                            className="bg-[#0B0F19] border border-[#374151] rounded px-4 py-2 text-white w-full focus:border-indigo-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase block mb-2">API Key</label>
                                        <input
                                            type="password"
                                            value={wandbApiKey}
                                            placeholder="wandb API key"
                                            onChange={(e) => setWandbApiKey(e.target.value)}
                                            onBlur={() => {
                                                window.api.updateSetting('wandb_api_key', wandbApiKey);
                                                window.api.wandbUpdate();
                                            }}
                                            className="bg-[#0B0F19] border border-[#374151] rounded px-4 py-2 text-white w-full focus:border-indigo-500 outline-none font-mono text-xs"
                                        />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={async () => {
                                                if (!wandbEntity || !wandbApiKey) return;
                                                setWandbTesting(true);
                                                setWandbStatus(null);
                                                try {
                                                    const res = await window.api.wandbTest(wandbEntity, wandbApiKey);
                                                    if (res.valid) {
                                                        setWandbStatus({ ok: true, msg: `连接成功 · 发现 ${res.projectCount} 个 projects · hostname=${res.hostname}` });
                                                    } else {
                                                        setWandbStatus({ ok: false, msg: res.error || '连接失败' });
                                                    }
                                                } catch (err) {
                                                    setWandbStatus({ ok: false, msg: err instanceof Error ? err.message : '未知错误' });
                                                }
                                                setWandbTesting(false);
                                            }}
                                            disabled={!wandbEntity || !wandbApiKey || wandbTesting}
                                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition flex items-center gap-2"
                                        >
                                            {wandbTesting ? '测试中…' : '测试连接'}
                                        </button>
                                        {wandbStatus && (
                                            <span className={clsx(
                                                "text-xs font-mono",
                                                wandbStatus.ok ? "text-green-400" : "text-red-400"
                                            )}>
                                                {wandbStatus.ok ? '✓' : '✗'} {wandbStatus.msg}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </section>
                        </>)}

                        {/* ===== Overlay ===== */}
                        {activeTab === 'overlay' && (<>
                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <MousePointer2 size={16} /> 交互
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6 space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-medium text-white">鼠标穿透</h3>
                                            <p className="text-sm text-gray-500 mt-1">开启后点击穿透悬浮窗。关闭可拖动窗口。</p>
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
                                    <div className="flex justify-end">
                                        <button
                                            onClick={async () => { await window.api.resetOverlayPosition(); }}
                                            className="px-3 py-1 bg-[#1f2937] hover:bg-[#374151] text-xs text-gray-300 rounded border border-[#374151] transition-colors flex items-center gap-2"
                                        >
                                            <RotateCcw size={12} /> 重置位置到中心
                                        </button>
                                    </div>
                                </div>
                            </section>

                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Layers size={16} /> 外观
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6 space-y-6">
                                    <div className="grid grid-cols-2 gap-6">
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 uppercase block mb-2">不透明度 ({Math.round(overlaySettings.opacity * 100)}%)</label>
                                            <input
                                                type="range"
                                                min="0.1" max="1" step="0.05"
                                                value={overlaySettings.opacity}
                                                onChange={(e) => updateOverlay('opacity', parseFloat(e.target.value))}
                                                className="w-full accent-indigo-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 uppercase block mb-2">字号 ({overlaySettings.fontSize}px)</label>
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
                                        <label className="text-xs font-bold text-gray-500 uppercase block mb-2">文字颜色</label>
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

                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Brain size={16} /> Focus 呼吸高亮
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6 space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-medium text-white">文字呼吸效果</h3>
                                            <p className="text-sm text-gray-500 mt-1">悬浮窗第一行 Focus 任务文字的柔和闪烁，仅作用于文字，背景保持静止。</p>
                                        </div>
                                        <button
                                            onClick={() => updateOverlay('focusGlowEnabled', !overlaySettings.focusGlowEnabled)}
                                            className={clsx(
                                                "px-4 py-2 rounded text-sm font-bold transition-all",
                                                overlaySettings.focusGlowEnabled
                                                    ? "bg-green-500/20 text-green-400 border border-green-500/50"
                                                    : "bg-red-500/20 text-red-400 border border-red-500/50"
                                            )}
                                        >
                                            {overlaySettings.focusGlowEnabled ? "ENABLED" : "DISABLED"}
                                        </button>
                                    </div>
                                    <div className={clsx(
                                        "grid grid-cols-2 gap-6 transition-opacity",
                                        !overlaySettings.focusGlowEnabled && "opacity-40 pointer-events-none"
                                    )}>
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 uppercase block mb-2">强度 ({overlaySettings.focusGlowIntensity}px)</label>
                                            <input
                                                type="range"
                                                min="2" max="14" step="1"
                                                value={overlaySettings.focusGlowIntensity}
                                                onChange={(e) => updateOverlay('focusGlowIntensity', parseInt(e.target.value))}
                                                className="w-full accent-indigo-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 uppercase block mb-2">呼吸周期 ({overlaySettings.focusGlowSpeed}s)</label>
                                            <input
                                                type="range"
                                                min="1" max="6" step="0.5"
                                                value={overlaySettings.focusGlowSpeed}
                                                onChange={(e) => updateOverlay('focusGlowSpeed', parseFloat(e.target.value))}
                                                className="w-full accent-indigo-500"
                                            />
                                        </div>
                                    </div>
                                    <div
                                        className="flex items-center gap-2 bg-black/30 rounded p-2 font-bold"
                                        style={{ color: overlaySettings.color, fontSize: `${overlaySettings.fontSize}px` }}
                                    >
                                        <Brain size={overlaySettings.fontSize + 4} />
                                        <span className={clsx(overlaySettings.focusGlowEnabled && "overlay-focus-glow")} style={focusGlowVars}>预览 Focus 任务</span>
                                        <span className={clsx("font-mono ml-auto", overlaySettings.focusGlowEnabled && "overlay-focus-glow")} style={focusGlowVars}>12:34</span>
                                    </div>
                                    <div className="flex items-center justify-between pt-1 border-t border-[#1f2937]/60">
                                        <span className="text-sm text-gray-400">副 Focus 文字同样呼吸（强度/周期共用上方值）</span>
                                        <button
                                            onClick={() => updateOverlay('sideGlowEnabled', !overlaySettings.sideGlowEnabled)}
                                            className={clsx(
                                                "px-3 py-1 rounded text-xs font-bold transition-all",
                                                overlaySettings.sideGlowEnabled
                                                    ? "bg-green-500/20 text-green-400 border border-green-500/50"
                                                    : "bg-gray-700/40 text-gray-400 border border-gray-600/50"
                                            )}
                                        >
                                            {overlaySettings.sideGlowEnabled ? "ON" : "OFF"}
                                        </button>
                                    </div>
                                </div>
                            </section>

                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Repeat size={16} /> Focus 文字滚动
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6 space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-medium text-white">标题单份循环滚动</h3>
                                            <p className="text-sm text-gray-500 mt-1">同一时间只显示一份 Focus 标题向右滚动，尾部离开右边缘的同时开头从左侧接续进入，无空档；关闭后退回两行截断。</p>
                                        </div>
                                        <button
                                            onClick={() => updateOverlay('focusMarqueeEnabled', !overlaySettings.focusMarqueeEnabled)}
                                            className={clsx(
                                                "px-4 py-2 rounded text-sm font-bold transition-all",
                                                overlaySettings.focusMarqueeEnabled
                                                    ? "bg-green-500/20 text-green-400 border border-green-500/50"
                                                    : "bg-red-500/20 text-red-400 border border-red-500/50"
                                            )}
                                        >
                                            {overlaySettings.focusMarqueeEnabled ? "ENABLED" : "DISABLED"}
                                        </button>
                                    </div>
                                    <div className={clsx(
                                        "transition-opacity",
                                        !overlaySettings.focusMarqueeEnabled && "opacity-40 pointer-events-none"
                                    )}>
                                        <label className="text-xs font-bold text-gray-500 uppercase block mb-2">滚动速度 ({overlaySettings.focusMarqueeSpeed}px/s)</label>
                                        <input
                                            type="range"
                                            min="10" max="100" step="5"
                                            value={overlaySettings.focusMarqueeSpeed}
                                            onChange={(e) => updateOverlay('focusMarqueeSpeed', parseInt(e.target.value))}
                                            className="w-full accent-indigo-500"
                                        />
                                    </div>
                                    <div
                                        className="bg-black/30 rounded p-2 font-bold overflow-hidden"
                                        style={{ color: overlaySettings.color, fontSize: `${overlaySettings.fontSize}px` }}
                                    >
                                        {overlaySettings.focusMarqueeEnabled ? (
                                            <div
                                                className="overlay-marquee-track flex w-max"
                                                style={{
                                                    '--marquee-duration': `${Math.max(0.5, 560 / overlaySettings.focusMarqueeSpeed).toFixed(2)}s`,
                                                    '--marquee-cell': '560px',
                                                } as React.CSSProperties}
                                            >
                                                {[0, 1].map(i => (
                                                    <span key={i} className="whitespace-nowrap shrink-0 min-w-[560px]" aria-hidden={i > 0 ? true : undefined}>
                                                        预览：Focus 任务标题单份循环滚动
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="block truncate">预览：关闭后标题退回两行截断显示</span>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-between pt-1 border-t border-[#1f2937]/60">
                                        <span className="text-sm text-gray-400">副 Focus 标题同样滚动（速度共用上方值）</span>
                                        <button
                                            onClick={() => updateOverlay('sideMarqueeEnabled', !overlaySettings.sideMarqueeEnabled)}
                                            className={clsx(
                                                "px-3 py-1 rounded text-xs font-bold transition-all",
                                                overlaySettings.sideMarqueeEnabled
                                                    ? "bg-green-500/20 text-green-400 border border-green-500/50"
                                                    : "bg-gray-700/40 text-gray-400 border border-gray-600/50"
                                            )}
                                        >
                                            {overlaySettings.sideMarqueeEnabled ? "ON" : "OFF"}
                                        </button>
                                    </div>
                                </div>
                            </section>
                        </>)}

                        {/* ===== MD Sync ===== */}
                        {activeTab === 'mdsync' && (
                            <MdSyncSection />
                        )}

                        {/* ===== Data ===== */}
                        {activeTab === 'data' && (<>
                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Database size={16} /> 主题
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-medium text-white">外观主题</h3>
                                            <p className="text-sm text-gray-500 mt-1">当前锁定为 Midnight。</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button className="px-3 py-1.5 bg-[#1f2937] text-gray-300 rounded text-xs border border-transparent hover:border-gray-500 transition">Dark</button>
                                            <button className="px-3 py-1.5 bg-[#0B0F19] text-gray-600 rounded text-xs border border-[#1f2937] cursor-not-allowed opacity-50">Light</button>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section>
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Database size={16} /> 备份
                                </h2>
                                <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-medium text-white">导出 / 导入</h3>
                                            <p className="text-sm text-gray-500 mt-1">备份或恢复数据库。</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={async () => {
                                                    const result = await window.api.exportData();
                                                    if (result.success) {
                                                        setStatus('success');
                                                        setTimeout(() => setStatus('idle'), 2000);
                                                    }
                                                }}
                                                className="px-4 py-2 border border-indigo-600/50 hover:bg-indigo-600/20 text-indigo-400 rounded text-sm transition"
                                            >
                                                导出备份
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    const result = await window.api.importData();
                                                    if (result.success) {
                                                        if (result.needsRestart) {
                                                            alert(result.message);
                                                        }
                                                        setStatus('success');
                                                        setTimeout(() => setStatus('idle'), 2000);
                                                    }
                                                }}
                                                className="px-4 py-2 border border-amber-600/50 hover:bg-amber-600/20 text-amber-400 rounded text-sm transition"
                                            >
                                                导入备份
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section>
                                <h2 className="text-sm font-bold text-red-400/80 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Database size={16} /> 危险区域
                                </h2>
                                <div className="bg-[#111827] border border-red-900/30 rounded-lg p-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-medium text-red-400">清空数据库</h3>
                                            <p className="text-sm text-gray-500 mt-1">永久删除所有任务，不可撤销。</p>
                                        </div>
                                        <button
                                            onClick={() => setShowClearConfirm(true)}
                                            className="px-4 py-2 border border-red-900/50 hover:bg-red-900/20 text-red-400 rounded text-sm transition"
                                        >
                                            清空数据库
                                        </button>
                                    </div>
                                </div>
                            </section>
                        </>)}

                    </div>
                </div>
            </div>

            <ConfirmModal
                isOpen={showClearConfirm}
                onClose={() => setShowClearConfirm(false)}
                onConfirm={async () => {
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

/* ------------------------------------------------------------------ */
/* MD Sync Section                                                    */
/* ------------------------------------------------------------------ */

function MdSyncSection() {
    const [mdEnabled, setMdEnabled] = useState(false);
    const [folderPath, setFolderPath] = useState('');
    const [syncStatus, setSyncStatus] = useState<{ lastSyncTime: number | null; lastError: string | null; filePath: string }>({ lastSyncTime: null, lastError: null, filePath: '' });
    const [showPreview, setShowPreview] = useState(false);
    const [fileContent, setFileContent] = useState('');
    const [busy, setBusy] = useState(false);
    const [showDupConfirm, setShowDupConfirm] = useState(false);
    const [pendingEnable, setPendingEnable] = useState<{ folder: string; dups: string[] } | null>(null);

    // Load saved status from main process on mount
    useEffect(() => {
        (async () => {
            const result = await window.api.mdSyncGetStatus();
            if (result.success && result.status) {
                setMdEnabled(result.status.enabled);
                setFolderPath(result.status.folderPath);
                setSyncStatus({
                    lastSyncTime: result.status.lastSyncTime,
                    lastError: result.status.lastError,
                    filePath: result.status.filePath,
                });
            }
        })();
    }, []);

    // Poll status every 3s when enabled
    useEffect(() => {
        if (!mdEnabled) return;
        const interval = setInterval(async () => {
            const result = await window.api.mdSyncGetStatus();
            if (result.success && result.status) {
                setSyncStatus({
                    lastSyncTime: result.status.lastSyncTime,
                    lastError: result.status.lastError,
                    filePath: result.status.filePath,
                });
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [mdEnabled]);

    async function handleToggle() {
        const newEnabled = !mdEnabled;
        if (newEnabled && !folderPath) {
            // Need to select folder first
            setMdEnabled(true);
            return;
        }
        setMdEnabled(newEnabled);
        if (!newEnabled) {
            // Disabling — stop auto-sync
            await window.api.mdSyncSetConfig(false, '');
            setSyncStatus({ lastSyncTime: null, lastError: null, filePath: '' });
        }
    }

    async function handleSelectFolder() {
        const result = await window.api.mdSyncSelectFolder();
        if (result.canceled || !result.folderPath) return;
        setFolderPath(result.folderPath);
        setBusy(true);
        try {
            // Check if epochtodo.md exists in the selected folder
            const checkResult = await window.api.mdSyncCheckFile(result.folderPath);
            if (checkResult.success && checkResult.exists && (checkResult.bulletCount ?? 0) > 0) {
                // Check for duplicate task titles before starting sync
                const readResult = await window.api.mdSyncReadFile(checkResult.filePath!);
                if (readResult.success && readResult.content !== undefined) {
                    const titles: string[] = [];
                    for (const line of readResult.content.split('\n')) {
                        const m = line.match(/^\s*[-*+]\s+(?:\[( |x|X)\]\s+)?(.+)$/);
                        if (m) titles.push(m[2].trim());
                    }
                    const dups = await window.api.mdSyncCheckDuplicates(titles);
                    if (dups.length > 0) {
                        setPendingEnable({ folder: result.folderPath, dups });
                        setShowDupConfirm(true);
                        setBusy(false);
                        return;
                    }
                }
            }
            // No duplicates — start auto-sync if enabled
            if (mdEnabled) {
                await startAutoSync(result.folderPath);
            }
        } catch (e) {
            console.error('Folder selection error:', e);
        }
        setBusy(false);
    }

    async function startAutoSync(folder: string) {
        setBusy(true);
        try {
            const result = await window.api.mdSyncSetConfig(true, folder);
            if (result.success && result.status) {
                setSyncStatus({
                    lastSyncTime: result.status.lastSyncTime,
                    lastError: result.status.lastError,
                    filePath: result.status.filePath,
                });
            }
        } catch (e) {
            console.error('Start auto-sync error:', e);
        }
        setBusy(false);
    }

    async function handlePreview() {
        if (!syncStatus.filePath) return;
        const result = await window.api.mdSyncReadFile(syncStatus.filePath);
        if (result.success && result.content !== undefined) {
            setFileContent(result.content);
            setShowPreview(!showPreview);
        }
    }

    function formatTime(ts: number | null): string {
        if (!ts) return '尚未同步';
        const d = new Date(ts);
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
    }

    return (
        <>
            {/* Enable / Folder selection */}
            <section>
                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <FileText size={16} /> MD 文件自动同步
                </h2>
                <div className="bg-[#111827] border border-gray-800 rounded-lg p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-medium text-gray-200">启用自动双向同步</h3>
                            <p className="text-sm text-gray-500 mt-1">
                                自动将标准任务与 <code className="text-gray-400">epochtodo.md</code> 双向同步。文件内容变更或任务变更均自动同步。
                            </p>
                        </div>
                        <button
                            onClick={handleToggle}
                            className={clsx(
                                'relative w-12 h-6 rounded-full transition-colors',
                                mdEnabled ? 'bg-emerald-600' : 'bg-gray-700'
                            )}
                        >
                            <span
                                className={clsx(
                                    'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform',
                                    mdEnabled && 'translate-x-6'
                                )}
                            />
                        </button>
                    </div>

                    {mdEnabled && (
                        <div className="border-t border-gray-800 pt-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleSelectFolder}
                                    disabled={busy}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition disabled:opacity-50"
                                >
                                    <FolderOpen size={14} /> 选择文件夹
                                </button>
                            </div>
                            {folderPath && (
                                <p className="text-xs text-gray-500 truncate">
                                    文件夹: <code className="text-gray-400">{folderPath}</code>
                                </p>
                            )}
                            {folderPath && (
                                <p className="text-xs text-gray-500">
                                    同步文件: <code className="text-gray-400">{folderPath}/epochtodo.md</code>
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* Auto-sync status */}
            {mdEnabled && folderPath && (
                <section>
                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <FileText size={16} /> 同步状态
                    </h2>
                    <div className="bg-[#111827] border border-gray-800 rounded-lg p-6 space-y-4">
                        {/* Status row */}
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                </span>
                                <span className="text-sm text-gray-300">自动同步中</span>
                            </div>
                            <span className="text-xs text-gray-600">|</span>
                            <span className="text-xs text-gray-500">
                                上次同步: {formatTime(syncStatus.lastSyncTime)}
                            </span>
                        </div>

                        {/* Error display */}
                        {syncStatus.lastError && (
                            <div className="flex items-start gap-2 px-4 py-3 bg-red-900/20 border border-red-800/50 rounded-lg">
                                <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                                <div className="text-sm text-red-300">
                                    <p>同步错误</p>
                                    <p className="text-xs text-red-400/70 mt-1">{syncStatus.lastError}</p>
                                </div>
                            </div>
                        )}

                        {/* Info banner */}
                        <div className="flex items-start gap-2 px-4 py-3 bg-blue-900/10 border border-blue-800/30 rounded-lg">
                            <CheckCircle size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
                            <div className="text-sm text-blue-300/80">
                                <p>任务变更（创建、修改、删除）将自动写入 <code>epochtodo.md</code>。</p>
                                <p className="mt-1">外部编辑 <code>epochtodo.md</code> 也会自动同步回任务列表。</p>
                            </div>
                        </div>

                        {/* Preview toggle */}
                        <button
                            onClick={handlePreview}
                            disabled={!syncStatus.filePath}
                            className="flex items-center gap-2 px-3 py-2 border border-gray-700 hover:bg-gray-800 text-gray-300 rounded text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <FileText size={14} /> {showPreview ? '隐藏预览' : '预览文件'}
                        </button>

                        {/* File preview */}
                        {showPreview && (
                            <div className="bg-[#0d1117] border border-gray-800 rounded-lg p-4">
                                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap max-h-80 overflow-y-auto">
                                    {fileContent || '(空文件)'}
                                </pre>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {/* Duplicate confirmation modal */}
            <ConfirmModal
                isOpen={showDupConfirm}
                onClose={() => { setShowDupConfirm(false); setPendingEnable(null); }}
                onConfirm={async () => {
                    setShowDupConfirm(false);
                    if (pendingEnable) {
                        await startAutoSync(pendingEnable.folder);
                    }
                    setPendingEnable(null);
                }}
                title="发现重名任务"
                message={`epochtodo.md 中以下任务标题已在应用中存在:\n${pendingEnable?.dups.map((d) => `• ${d}`).join('\n') ?? ''}\n\n启动同步后，这些将作为重复任务导入。是否继续？`}
                strict={false}
            />
        </>
    );
}
