import { useState, DragEvent, useRef, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { TaskBlock } from './TaskBlock';
import { SchedulerGpu, SchedulerTask, SchedulerAssignment } from '../../../shared/types';

interface GpuRowProps {
  gpu: SchedulerGpu;
  assignments: SchedulerAssignment[];
  tasks: SchedulerTask[];
  viewStartDate: Date;
  hourWidth: number;
  totalHours: number;
  scrollLeft: number;
  onDropTask: (gpuId: number, startTime: string, taskId: number) => void;
  onUpdateAssignment: (id: number, updates: { start_time?: string; duration_hours?: number }) => void;
  onCascadeUpdate: (gpuId: number, assignmentId: number, updates: { start_time?: string; duration_hours?: number }) => void;
  onDeleteAssignment: (id: number) => void;
  onDeleteGpu: (id: number) => void;
}

export const GpuRow = ({
  gpu,
  assignments,
  tasks,
  viewStartDate,
  hourWidth,
  totalHours,
  scrollLeft,
  onDropTask,
  onUpdateAssignment,
  onCascadeUpdate,
  onDeleteAssignment,
  onDeleteGpu,
}: GpuRowProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragOverX, setDragOverX] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Get start of day for viewStartDate to ensure consistent positioning
  const getViewStartMs = () => {
    const d = new Date(viewStartDate);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  // Helper to calculate ISO timestamp from x position
  const getTimeFromX = (x: number): string => {
    const hoursFromStart = (x + scrollLeft) / hourWidth;
    const date = new Date(getViewStartMs() + hoursFromStart * 60 * 60 * 1000);
    return date.toISOString();
  };

  // Helper to calculate x position from ISO timestamp
  const getXFromTime = (isoString: string): number => {
    const time = new Date(isoString).getTime();
    const start = getViewStartMs();
    const hoursDiff = (time - start) / (60 * 60 * 1000);
    return hoursDiff * hourWidth - scrollLeft;
  };

  // Sort assignments by start_time for cascade logic
  const sortedAssignments = useMemo(() => 
    [...assignments].sort((a, b) => 
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    ), [assignments]);

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);

    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setDragOverX(x);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if we're leaving the row entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!relatedTarget || !rowRef.current?.contains(relatedTarget)) {
      setIsDragOver(false);
      setDragOverX(null);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragOverX(null);

    const taskIdStr = e.dataTransfer.getData('text/plain');
    const taskId = parseInt(taskIdStr);

    if (!taskId || !rowRef.current) return;

    const rect = rowRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const startTime = getTimeFromX(x);

    onDropTask(gpu.id, startTime, taskId);
  };

  const timelineWidth = totalHours * hourWidth;

  return (
    <div className="relative h-20 border-b border-[#1f2937] group">
      {/* GPU Label */}
      <div
        className="absolute left-0 top-0 bottom-0 w-28 bg-[#111827] border-r border-[#1f2937] flex items-center justify-between px-3 z-10"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: gpu.color }}
          />
          <span className="text-sm text-gray-200 truncate font-medium">
            {gpu.name}
          </span>
        </div>
        <button
          onClick={() => onDeleteGpu(gpu.id)}
          className="opacity-0 group-hover:opacity-100 p-1 text-gray-600 hover:text-red-400 transition-opacity"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Timeline Row - Drop Zone */}
      <div
        ref={rowRef}
        className={clsx(
          'ml-28 h-full relative transition-colors cursor-pointer',
          isDragOver && 'bg-indigo-500/20 ring-2 ring-indigo-500 ring-inset'
        )}
        style={{ width: timelineWidth, minWidth: timelineWidth }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drop indicator */}
        {isDragOver && dragOverX !== null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-indigo-400 z-20 pointer-events-none"
            style={{ left: dragOverX }}
          />
        )}

        {/* Hour grid lines - one per day */}
        {Array.from({ length: Math.ceil(totalHours / 24) + 1 }, (_, i) => (
          <div
            key={`day-${i}`}
            className="absolute top-0 bottom-0 w-px bg-[#374151] pointer-events-none"
            style={{ left: i * 24 * hourWidth }}
          />
        ))}

        {/* Task blocks */}
        {sortedAssignments.map((assignment) => {
          const task = tasks.find((t) => t.id === assignment.task_id);
          if (!task) return null;

          const left = getXFromTime(assignment.start_time);
          const width = assignment.duration_hours * hourWidth;

          // Don't render if completely out of view
          if (left + width < -100 || left > timelineWidth + 100) return null;

          return (
            <TaskBlock
              key={assignment.id}
              assignment={assignment}
              task={task}
              left={left}
              width={width}
              hourWidth={hourWidth}
              sortedAssignments={sortedAssignments}
              onUpdate={onUpdateAssignment}
              onCascadeUpdate={(assignmentId, updates) => onCascadeUpdate(gpu.id, assignmentId, updates)}
              onDelete={onDeleteAssignment}
            />
          );
        })}
      </div>
    </div>
  );
};
