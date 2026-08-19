import { useState, useEffect } from 'react';
import type { Task } from '../../../shared/types';

// --- Timer Display Hook ---
// Lives in its own file so utilities.tsx only exports components
// (react-refresh friendly) and the hook stays importable anywhere.
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
