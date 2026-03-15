import { create } from 'zustand';
import { SchedulerGpu, SchedulerTask, SchedulerAssignment } from '../shared/types';

interface GpuSchedulerState {
  gpus: SchedulerGpu[];
  tasks: SchedulerTask[];
  assignments: SchedulerAssignment[];
  viewStartDate: Date; // The start date for the timeline view
  hourWidth: number; // Pixels per hour in timeline
  isLoading: boolean;

  // Actions
  setGpus: (gpus: SchedulerGpu[]) => void;
  setTasks: (tasks: SchedulerTask[]) => void;
  setAssignments: (assignments: SchedulerAssignment[]) => void;
  addGpu: (gpu: SchedulerGpu) => void;
  updateGpu: (id: number, updates: Partial<SchedulerGpu>) => void;
  removeGpu: (id: number) => void;
  addTask: (task: SchedulerTask) => void;
  updateTask: (id: number, updates: Partial<SchedulerTask>) => void;
  removeTask: (id: number) => void;
  addAssignment: (assignment: SchedulerAssignment) => void;
  updateAssignment: (id: number, updates: Partial<SchedulerAssignment>) => void;
  removeAssignment: (id: number) => void;
  setViewStartDate: (date: Date) => void;
  setHourWidth: (width: number) => void;
  setLoading: (loading: boolean) => void;
  zoom: (delta: number) => void;
  reset: () => void;
}
export const useGpuSchedulerStore = create<GpuSchedulerState>((set) => ({
  gpus: [],
  tasks: [],
  assignments: [],
  viewStartDate: new Date(), // Default to today
  hourWidth: 60, // Pixels per hour
  isLoading: false,

  setGpus: (gpus) => set({ gpus }),
  setTasks: (tasks) => set({ tasks }),
  setAssignments: (assignments) => set({ assignments }),

  setViewStartDate: (date: Date) => set({ viewStartDate: date }),
  addGpu: (gpu) => set((state) => ({ gpus: [...state.gpus, gpu] })),
  updateGpu: (id, updates) => set((state) => ({
    gpus: state.gpus.map(g => g.id === id ? { ...g, ...updates } : g),
  })),
  removeGpu: (id) => set((state) => ({
    gpus: state.gpus.filter(g => g.id !== id),
    assignments: state.assignments.filter(a => a.gpu_id !== id),
  })),

  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
  updateTask: (id, updates) => set((state) => ({
    tasks: state.tasks.map(t => t.id === id ? { ...t, ...updates } : t),
  })),
  removeTask: (id) => set((state) => ({
    tasks: state.tasks.filter(t => t.id !== id),
    assignments: state.assignments.filter(a => a.task_id !== id),
  })),

  addAssignment: (assignment) => set((state) => ({
    assignments: [...state.assignments, assignment],
  })),
  updateAssignment: (id, updates) => set((state) => ({
    assignments: state.assignments.map(a => a.id === id ? { ...a, ...updates } : a),
  })),
  removeAssignment: (id) => set((state) => ({
    assignments: state.assignments.filter(a => a.id !== id),
  })),

  setHourWidth: (width: number) => set({
    hourWidth: Math.max(15, Math.min(200, width)),
  }),
  zoom: (delta: number) => set((state) => ({
    hourWidth: Math.max(15, Math.min(200, state.hourWidth + delta)),
  })),
  setLoading: (loading: boolean) => set({ isLoading: loading }),

  reset: () => set({
    gpus: [],
    tasks: [],
    assignments: [],
    viewStartDate: new Date(),
    hourWidth: 60,
    isLoading: false,
  }),
}));
