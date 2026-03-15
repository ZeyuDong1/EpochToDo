import { useEffect, useState, DragEvent } from 'react';
import { Cpu, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Timeline } from './Timeline';
import { TaskPool } from './TaskPool';
import { useGpuSchedulerStore } from '../../../store/gpuSchedulerStore';
import { SchedulerTask } from '../../../shared/types';

export const GpuScheduler = () => {
  const {
    gpus,
    tasks,
    assignments,
    viewStartDate,
    hourWidth,
    setGpus,
    setTasks,
    setAssignments,
    setViewStartDate,
    setLoading,
    zoom,
  } = useGpuSchedulerStore();

  const [showAddGpuModal, setShowAddGpuModal] = useState(false);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [newGpuName, setNewGpuName] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskHours, setNewTaskHours] = useState('');
  const [draggingTask, setDraggingTask] = useState<SchedulerTask | null>(null);

  // Parse duration string like "2d5h", "3d", "10h", or plain number (hours)
  const parseDuration = (input: string): number | null => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;
    
    // Plain number = hours
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return parseFloat(trimmed);
    }
    
    // Parse XdYh format
    const match = trimmed.match(/^(?:(\d+)d)?(?:(\d+(?:\.\d+)?)h)?$/);
    if (!match) return null;
    
    const days = match[1] ? parseInt(match[1], 10) : 0;
    const hours = match[2] ? parseFloat(match[2]) : 0;
    
    if (days === 0 && hours === 0) return null;
    return days * 24 + hours;
  };

  // Fetch data on mount
  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [gpusData, tasksData, assignmentsData] = await Promise.all([
        window.api.schedulerGetGpus(),
        window.api.schedulerGetTasks(),
        window.api.schedulerGetAssignments(),
      ]);
      setGpus(gpusData);
      setTasks(tasksData);
      setAssignments(assignmentsData);
    } catch (e) {
      console.error('Failed to fetch scheduler data:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGpu = async () => {
    if (!newGpuName.trim()) return;
    try {
      const gpu = await window.api.schedulerCreateGpu(newGpuName.trim());
      setGpus([...gpus, gpu]);
      setNewGpuName('');
      setShowAddGpuModal(false);
    } catch (e) {
      console.error('Failed to create GPU:', e);
    }
  };

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) return;
    const hours = parseDuration(newTaskHours);
    if (!hours || hours <= 0) {
      alert('Invalid duration format. Use: 2d5h, 3d, 10h, or plain number (hours)');
      return;
    }
    try {
      const task = await window.api.schedulerCreateTask(newTaskTitle.trim(), hours);
      setTasks([...tasks, task]);
      setNewTaskTitle('');
      setNewTaskHours('');
      setShowAddTaskModal(false);
    } catch (e) {
      console.error('Failed to create task:', e);
    }
  };

  const handleDeleteGpu = async (id: number) => {
    try {
      await window.api.schedulerDeleteGpu(id);
      setGpus(gpus.filter(g => g.id !== id));
    } catch (e) {
      console.error('Failed to delete GPU:', e);
    }
  };

  const handleDeleteTask = async (id: number) => {
    try {
      await window.api.schedulerDeleteTask(id);
      setTasks(tasks.filter(t => t.id !== id));
    } catch (e) {
      console.error('Failed to delete task:', e);
    }
  };

  const handleDragStart = (e: DragEvent, task: SchedulerTask) => {
    setDraggingTask(task);
    e.dataTransfer.setData('text/plain', String(task.id));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggingTask(null);
  };

  const handleDropOnTimeline = async (gpuId: number, startTime: string, taskId?: number) => {
    console.log('[GpuScheduler] handleDropOnTimeline called:', {
      gpuId,
      startTime,
      taskId,
      draggingTask: draggingTask ? { id: draggingTask.id, title: draggingTask.title, estimated_hours: draggingTask.estimated_hours } : null
    });

    // Use passed taskId or fall back to draggingTask
    const taskToSchedule = taskId ? tasks.find(t => t.id === taskId) : draggingTask;
    
    if (!taskToSchedule) {
      console.log('[GpuScheduler] No task to schedule, returning early');
      return;
    }

    try {
      console.log('[GpuScheduler] Creating assignment with params:', {
        taskId: taskToSchedule.id,
        gpuId,
        startTime,
        durationHours: taskToSchedule.estimated_hours
      });

      const assignment = await window.api.schedulerCreateAssignment(
        taskToSchedule.id,
        gpuId,
        startTime,
        taskToSchedule.estimated_hours
      );

      console.log('[GpuScheduler] Assignment created successfully:', assignment);

      // Refresh assignments from DB to ensure we have the latest
      const allAssignments = await window.api.schedulerGetAssignments();
      setAssignments(allAssignments);
      
      // Update task status
      setTasks(tasks.map(t => t.id === taskToSchedule.id ? { ...t, status: 'scheduled' } : t));
      setDraggingTask(null);

      console.log('[GpuScheduler] State updated. Total assignments:', allAssignments.length);
    } catch (e) {
      console.error('Failed to create assignment:', e);
      alert(e instanceof Error ? e.message : 'Failed to schedule task');
    }
  };

  const handleUpdateAssignment = async (id: number, updates: { start_time?: string; duration_hours?: number }) => {
    try {
      await window.api.schedulerUpdateAssignment(id, updates);
      setAssignments(assignments.map(a => a.id === id ? { ...a, ...updates } : a));
    } catch (e) {
      console.error('Failed to update assignment:', e);
    }
  };

  const handleDeleteAssignment = async (id: number) => {
    try {
      await window.api.schedulerDeleteAssignment(id);
      const assignment = assignments.find(a => a.id === id);
      if (assignment) {
        // Update task status if no more assignments
        const remainingAssignments = assignments.filter(a => a.id !== id && a.task_id === assignment.task_id);
        if (remainingAssignments.length === 0) {
          setTasks(tasks.map(t => t.id === assignment.task_id ? { ...t, status: 'pending' } : t));
        }
      }
      setAssignments(assignments.filter(a => a.id !== id));
    } catch (e) {
      console.error('Failed to delete assignment:', e);
    }
  };

  // Helper to add hours to an ISO timestamp
  const addHoursToTime = (isoString: string, hours: number): string => {
    const date = new Date(isoString);
    date.setTime(date.getTime() + hours * 60 * 60 * 1000);
    return date.toISOString();
  };

  // Cascade update handler - updates assignment and all subsequent assignments on same GPU
  const handleCascadeUpdate = async (gpuId: number, assignmentId: number, updates: { start_time?: string; duration_hours?: number }) => {
    // Get all assignments for this GPU, sorted by start_time
    const gpuAssignments = assignments
      .filter(a => a.gpu_id === gpuId)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    // Find the index of the target assignment
    const targetIndex = gpuAssignments.findIndex(a => a.id === assignmentId);
    if (targetIndex === -1) return;

    const targetAssignment = gpuAssignments[targetIndex];

    // Calculate the new end time of the target assignment
    let newEnd: Date;
    if (updates.start_time && updates.duration_hours !== undefined) {
      newEnd = new Date(addHoursToTime(updates.start_time, updates.duration_hours));
    } else if (updates.start_time) {
      newEnd = new Date(addHoursToTime(updates.start_time, targetAssignment.duration_hours));
    } else if (updates.duration_hours !== undefined) {
      newEnd = new Date(addHoursToTime(targetAssignment.start_time, updates.duration_hours));
    } else {
      return;
    }

    // Calculate shift amount (difference in end times)
    const originalEnd = new Date(addHoursToTime(targetAssignment.start_time, targetAssignment.duration_hours));
    const shiftMs = newEnd.getTime() - originalEnd.getTime();
    const shiftHours = shiftMs / (60 * 60 * 1000);

    // Update all subsequent assignments
    const updatedAssignments = assignments.map(a => {
      if (a.id === assignmentId) {
        // Update the target assignment
        return { ...a, ...updates };
      }
      
      // Check if this assignment is a subsequent one on the same GPU
      const aIndex = gpuAssignments.findIndex(ga => ga.id === a.id);
      if (aIndex > targetIndex) {
        // Shift this assignment by the same amount
        const newStartTime = addHoursToTime(a.start_time, shiftHours);
        return { ...a, start_time: newStartTime };
      }
      return a;
    });

    // Batch update all assignments
    try {
      await Promise.all(
        updatedAssignments.map(a => 
          window.api.schedulerUpdateAssignment(a.id, {
            start_time: a.start_time,
            duration_hours: a.duration_hours
          })
        )
      );
      setAssignments(updatedAssignments);
    } catch (e) {
      console.error('Failed to cascade update:', e);
    }
  };
  // Show 30 days for continuous timeline (allows long training tasks spanning weeks)
  const daysInView = 30;
  const hoursPerDay = 24;
  const totalHours = daysInView * hoursPerDay; // 720 hours
  const timelineWidth = totalHours * hourWidth;

  // Helper to format date range
  const formatDateRange = () => {
    const endDate = new Date(viewStartDate);
    endDate.setDate(endDate.getDate() + daysInView - 1);
    const startStr = viewStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startStr} - ${endStr}`;
  };

  // Navigation helpers - move by 1 day for fine-grained control
  const goToPrevDay = () => {
    const newDate = new Date(viewStartDate);
    newDate.setDate(newDate.getDate() - 1);
    setViewStartDate(newDate);
  };

  const goToNextDay = () => {
    const newDate = new Date(viewStartDate);
    newDate.setDate(newDate.getDate() + 1);
    setViewStartDate(newDate);
  };

  const goToToday = () => {
    setViewStartDate(new Date());
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-br from-[#0B0F19] to-[#111827]">
      {/* Header */}
      <div className="h-14 border-b border-[#1f2937] flex items-center justify-between px-6 bg-[#111827]/80 backdrop-blur z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Cpu size={20} className="text-indigo-500" />
          <span className="font-semibold text-sm tracking-wide text-gray-200">GPU Scheduler</span>
          <span className="text-xs text-gray-600 ml-2">
            {gpus.length} GPUs • {tasks.length} Tasks • {assignments.length} Scheduled
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Add GPU Button */}
          <button
            onClick={() => setShowAddGpuModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus size={14} />
            Add GPU
          </button>
          <span className="text-gray-700">|</span>
          <button
            onClick={goToToday}
            className="px-2 py-1 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded"
          >
            Today
          </button>
          <span className="text-gray-600">|</span>
          <button
            onClick={goToPrevDay}
            className="p-1 text-gray-400 hover:text-white hover:bg-[#1f2937] rounded"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs text-gray-300 font-medium min-w-[140px] text-center">
            {formatDateRange()}
          </span>
          <button
            onClick={goToNextDay}
            className="p-1 text-gray-400 hover:text-white hover:bg-[#1f2937] rounded"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Timeline Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Timeline
            gpus={gpus}
            assignments={assignments}
            tasks={tasks}
            viewStartDate={viewStartDate}
            hourWidth={hourWidth}
            totalHours={totalHours}
            timelineWidth={timelineWidth}
            onDropTask={handleDropOnTimeline}
            onUpdateAssignment={handleUpdateAssignment}
            onCascadeUpdate={handleCascadeUpdate}
            onDeleteAssignment={handleDeleteAssignment}
            onAddGpu={() => setShowAddGpuModal(true)}
            onDeleteGpu={handleDeleteGpu}
            onZoom={zoom}
          />
        </div>

        {/* Task Pool */}
        <div className="w-64 border-l border-[#1f2937] flex flex-col overflow-hidden bg-[#0B0F19]/50">
          <TaskPool
            tasks={tasks.filter(t => t.status === 'pending')}
            draggingTask={draggingTask}
            onAddTask={() => setShowAddTaskModal(true)}
            onDeleteTask={handleDeleteTask}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        </div>
      </div>

      {/* Add GPU Modal */}
      {showAddGpuModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-[#1E293B] border border-[#334155] p-6 rounded-xl shadow-2xl max-w-sm w-full">
            <h3 className="text-lg font-bold text-white mb-4">Add GPU</h3>
            <input
              value={newGpuName}
              onChange={(e) => setNewGpuName(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white mb-4 focus:outline-none focus:border-indigo-500"
              placeholder="e.g. RTX 4090 #1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateGpu();
                if (e.key === 'Escape') setShowAddGpuModal(false);
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAddGpuModal(false)}
                className="px-3 py-1.5 text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateGpu}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-500"
              >
                Add GPU
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Task Modal */}
      {showAddTaskModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-[#1E293B] border border-[#334155] p-6 rounded-xl shadow-2xl max-w-sm w-full">
            <h3 className="text-lg font-bold text-white mb-4">Add Training Task</h3>
            <div className="mb-4">
              <label className="block text-xs uppercase text-gray-400 font-bold mb-2">Task Title</label>
              <input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                placeholder="e.g. Baseline A - ResNet50"
                autoFocus
              />
            </div>
            <div className="mb-4">
              <label className="block text-xs uppercase text-gray-400 font-bold mb-2">Estimated Duration</label>
              <input
                type="text"
                value={newTaskHours}
                onChange={(e) => setNewTaskHours(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                placeholder="e.g. 2d5h, 3d, 10h, or 48"
              />
              <p className="text-xs text-gray-500 mt-1">Format: 2d5h = 2 days 5 hours, 3d = 3 days, 10h = 10 hours</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAddTaskModal(false)}
                className="px-3 py-1.5 text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTask}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-500"
              >
                Add Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
