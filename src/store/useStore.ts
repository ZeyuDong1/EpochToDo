import { create } from 'zustand';

interface FocusSession {
  taskId: number;
  startTime: number; // Date.now()
  accumulatedOnStart: number; // total_duration when session started
}

interface WaitSession {
  taskId: number;
  targetTime: number; // Date.now() + duration * 1000
  originalDuration: number;
}

interface TimerState {
  focusSession: FocusSession | null;
  waitSessions: WaitSession[];
  
  // Actions
  startFocus: (taskId: number, currentTotal: number) => void;
  stopFocus: () => void;
  addWait: (taskId: number, durationSeconds: number) => void;
  removeWait: (taskId: number) => void;
  clearWait: (taskId: number) => void;
}

export const useStore = create<TimerState>((set) => ({
  focusSession: null,
  waitSessions: [],

  startFocus: (taskId, currentTotal) => set({
    focusSession: {
      taskId,
      startTime: Date.now(),
      accumulatedOnStart: currentTotal,
    }
  }),

  stopFocus: () => set({ focusSession: null }),

  addWait: (taskId, durationSeconds) => set((state) => ({
    waitSessions: [
      ...state.waitSessions.filter(w => w.taskId !== taskId), // Replace existing if any
      {
        taskId,
        targetTime: Date.now() + durationSeconds * 1000,
        originalDuration: durationSeconds,
      }
    ]
  })),

  removeWait: (taskId) => set((state) => ({
    waitSessions: state.waitSessions.filter(w => w.taskId !== taskId)
  })),

  clearWait: (taskId) => set((state) => ({
    waitSessions: state.waitSessions.filter(w => w.taskId !== taskId)
  })),
}));
