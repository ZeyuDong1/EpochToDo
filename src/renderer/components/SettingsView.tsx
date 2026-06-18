import { useState, useEffect } from 'react';
import { Keyboard, Save, Database, Layers, MousePointer2, Cpu, BellOff, RotateCcw, Rocket, Settings, Clock, Activity } from 'lucide-react';
import clsx from 'clsx';
import { ConfirmModal } from './ConfirmModal';

interface OverlaySettings {
    opacity: number;
    fontSize: number;
    color: string;
    mouseIgnore: boolean;
}

type TabId = 'general' | 'gpu' | 'overlay' | 'data';

const TABS: { id: TabId; label: string; icon: typeof Keyboard }[] = [
    { id: 'general', label: '通用', icon: Settings },
    { id: 'gpu', label: 'GPU 与训练', icon: Cpu },
    { id: 'overlay', label: '悬浮窗', icon: Layers },
    { id: 'data', label: '数据', icon: Database },
];

export const SettingsView = () => {
    const [activeTab, setActiveTab] = useState<TabId>('general');

    const [shortcut, setShortcut] = useState('');
    const [originalShortcut, setOriginalShortcut] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const [overlaySettings, setOverlaySettings] = useState<OverlaySettings>({
        opacity: 0.8,
        fontSize: 14,
        color: '#ffffff',
        mouseIgnore: true
    });

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
        window.api.getSettings('overlay_settings', {
            opacity: 0.8,
            fontSize: 14,
            color: '#ffffff',
            mouseIgnore: true
        }).then(setOverlaySettings);

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
                        </>)}

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
