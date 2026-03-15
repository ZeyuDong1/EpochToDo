import { DragEvent } from 'react';
import { Plus, X, GripVertical } from 'lucide-react';
import clsx from 'clsx';
import { SchedulerTask } from '../../../shared/types';

interface TaskPoolProps {
  tasks: SchedulerTask[];
  draggingTask: SchedulerTask | null;
  onAddTask: () => void;
  onDeleteTask: (id: number) => void;
  onDragStart: (e: DragEvent, task: SchedulerTask) => void;
  onDragEnd: () => void;
}

export const TaskPool = ({
  tasks,
  draggingTask,
  onAddTask,
  onDeleteTask,
  onDragStart,
  onDragEnd,
}: TaskPoolProps) => {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-[#1f2937] bg-[#111827]/50 flex justify-between items-center">
        <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
          Task Pool
        </h2>
        <button
          onClick={onAddTask}
          className="p-1.5 text-gray-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded transition-colors"
          title="Add Task"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600">
            <p className="text-xs mb-2">No pending tasks</p>
            <button
              onClick={onAddTask}
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              + Add your first task
            </button>
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              draggable
              onDragStart={(e) => onDragStart(e, task)}
              onDragEnd={onDragEnd}
              className={clsx(
                'group bg-[#111827] border rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all relative',
                draggingTask?.id === task.id
                  ? 'border-indigo-500 opacity-50'
                  : 'border-[#1f2937] hover:border-gray-600'
              )}
            >
              {/* Drag Handle */}
              <div className="absolute left-1 top-1/2 -translate-y-1/2 p-1 text-gray-600 hover:text-gray-400">
                <GripVertical size={14} />
              </div>

              {/* Color indicator */}
              <div
                className="absolute left-6 top-2 bottom-2 w-1 rounded"
                style={{ backgroundColor: task.color }}
              />

              <div className="ml-4 flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 truncate font-medium">
                    {task.title}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    Est. {task.estimated_hours}h
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTask(task.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-600 hover:text-red-400 transition-opacity flex-shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Help Text */}
      <div className="p-2 border-t border-[#1f2937] bg-[#0B0F19]/50">
        <p className="text-[10px] text-gray-600 text-center">
          Drag tasks to the timeline to schedule
        </p>
      </div>
    </div>
  );
};
