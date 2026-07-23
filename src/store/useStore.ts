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
  // Dismiss every ephemeral reminder that belongs to the same AI reply
  // (matched by source + title), EXCEPT those that need user action
  // (status 'needs_input' or 'review'). Used after the user promotes one
  // status of the reply to a soft reminder — the other informational
  // statuses (info/progress/failure/success) are noise and should disappear,
  // but action-required statuses must stay visible.
  dismissAiReply: (source: string, title: string) => void;
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

  dismissAiReply: (source, title) => set((state) => ({
    aiReminders: state.aiReminders.filter(r => {
      // Keep reminders that don't match this reply at all
      const isSameReply = r.source === source && r.title === title;
      if (!isSameReply) return true;
      // For matching reminders, only keep action-required statuses
      return r.status === 'needs_input' || r.status === 'review';
    }),
  })),

  clearAiReminders: () => set({ aiReminders: [] }),
}));

