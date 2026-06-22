import { create } from 'zustand';
import { TrainingStatus, AiReminder } from '../shared/types';

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
  trainingStatus: Record<number, TrainingStatus>;
  
  // Actions
  startFocus: (taskId: number, currentTotal: number) => void;
  stopFocus: () => void;
  addWait: (taskId: number, durationSeconds: number) => void;
  removeWait: (taskId: number) => void;
  clearWait: (taskId: number) => void;
  setTrainingStatus: (status: TrainingStatus) => void;
  aiReminders: AiReminder[];
  addAiReminder: (reminder: AiReminder) => void;
  removeAiReminder: (id: string) => void;
  clearAiReminders: () => void;
}

export const useStore = create<TimerState>()((set) => ({
  focusSession: null,
  waitSessions: [],
  trainingStatus: {},
  aiReminders: [],

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
  
  setTrainingStatus: (status) => set((state) => ({
    trainingStatus: {
      ...state.trainingStatus,
      [status.taskId]: status
    }
  })),

  addAiReminder: (reminder) => set((state) => ({
    aiReminders: [reminder, ...state.aiReminders].slice(0, 20),
  })),

  removeAiReminder: (id) => set((state) => ({
    aiReminders: state.aiReminders.filter(r => r.id !== id),
  })),

  clearAiReminders: () => set({ aiReminders: [] }),
}));

