import { useState, useEffect } from 'react';
import type { Task } from '../../../shared/types';

// --- Timer Display Hook ---
export const useTimer = (activeTask: Task | null) => {
  const [display, setDisplay] = useState('00:00:00');

  useEffect(() => {
    if (!activeTask?.started_at) {
      setDisplay('00:00:00');
      return;
    }

    const format = (s: number) => {
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      if (d > 0) {
          return `${d}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
      }
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    };

    const updateLabel = () => {
      if (!activeTask?.started_at) {
          return;
      }
      const start = new Date(activeTask.started_at).getTime();
      const now = Date.now();
      const elapsed = Math.floor((now - start) / 1000);
      setDisplay(format(elapsed));
    };

    const interval = setInterval(updateLabel, 1000);
    return () => clearInterval(interval);
  }, [activeTask]);

  return display;
};

// --- Countdown Component ---
export const CountDown = ({ target }: { target?: string }) => {
    const [display, setDisplay] = useState('--:--');

    useEffect(() => {
        if (!target) return;

        const tick = () => {
            const now = Date.now();
            const targetTime = new Date(target).getTime();
            const diff = targetTime - now;

            if (diff <= 0) {
                setDisplay('00:00');
                return;
            }

            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            const secs = Math.floor((diff % 60000) / 1000);

            if (days > 0) {
                setDisplay(`${days}d ${hours}h ${mins}m`);
            } else {
                setDisplay(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
            }
        };

        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [target]);

    return <span>{display}</span>;
};

// --- Idle Timer Component ---
export const IdleTimer = ({ start }: { start?: string | null }) => {
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

            if (d > 0) setElapsed(`${d}d ${h}h ${m}m`);
            else if (h > 0) setElapsed(`${h}h ${m}m`);
            else setElapsed(`${m}m`);
        };

        update();
        const int = setInterval(update, 60000);
        return () => clearInterval(int);
    }, [start]);

    return <span className="font-mono text-gray-500">Idle: {elapsed}</span>;
};

// --- Duration Input Modal ---
export const DurationInputModal = ({ isOpen, onClose, onConfirm }: { isOpen: boolean, onClose: () => void, onConfirm: (minutes: number) => void }) => {
    const [val, setVal] = useState('60');

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-[#1a1a2e] p-6 rounded-xl border border-gray-700 w-80" onClick={e => e.stopPropagation()}>
                <h3 className="text-white font-semibold mb-4">Set Duration (minutes)</h3>
                <input
                    type="number"
                    value={val}
                    onChange={e => setVal(e.target.value)}
                    className="w-full bg-[#16213e] text-white px-3 py-2 rounded-lg border border-gray-600 mb-4"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') { onConfirm(parseInt(val) || 60); onClose(); } }}
                />
                <div className="flex gap-2 justify-end">
                    <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
                    <button onClick={() => { onConfirm(parseInt(val) || 60); onClose(); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Confirm</button>
                </div>
            </div>
        </div>
    );
};

// --- Create GPU Modal ---
export const CreateGpuModal = ({ isOpen, onClose, onConfirm }: { isOpen: boolean, onClose: () => void, onConfirm: (name: string) => void }) => {
    const [val, setVal] = useState('');

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-[#1a1a2e] p-6 rounded-xl border border-gray-700 w-80" onClick={e => e.stopPropagation()}>
                <h3 className="text-white font-semibold mb-4">Create GPU</h3>
                <input
                    type="text"
                    value={val}
                    onChange={e => setVal(e.target.value)}
                    placeholder="GPU name (e.g., 4090)"
                    className="w-full bg-[#16213e] text-white px-3 py-2 rounded-lg border border-gray-600 mb-4"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { onConfirm(val.trim()); setVal(''); onClose(); } }}
                />
                <div className="flex gap-2 justify-end">
                    <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
                    <button onClick={() => { if (val.trim()) { onConfirm(val.trim()); setVal(''); onClose(); } }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create</button>
                </div>
            </div>
        </div>
    );
};
