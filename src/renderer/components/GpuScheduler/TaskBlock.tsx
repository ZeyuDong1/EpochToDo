import { useState, MouseEvent, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { SchedulerTask, SchedulerAssignment } from '../../../shared/types';

interface TaskBlockProps {
  assignment: SchedulerAssignment;
  task: SchedulerTask;
  left: number;
  width: number;
  hourWidth: number;
  sortedAssignments: SchedulerAssignment[]; // All assignments on this GPU, sorted by start_time
  onUpdate: (id: number, updates: { start_time?: string; duration_hours?: number }) => void;
  onCascadeUpdate: (assignmentId: number, updates: { start_time?: string; duration_hours?: number }) => void;
  onDelete: (id: number) => void;
}

export const TaskBlock = ({
  assignment,
  task,
  left,
  width,
  hourWidth,
  sortedAssignments,
  onUpdate,
  onCascadeUpdate,
  onDelete,
}: TaskBlockProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<'left' | 'right' | null>(null);
  
  // Use refs to store original values - these don't cause re-renders and work correctly in closures
  const dragStartX = useRef(0);
  const originalStartTime = useRef('');
  const originalDuration = useRef(0);
  const originalPrevEnd = useRef<string | null>(null);

  // Helper to add hours to an ISO timestamp
  const addHoursToTime = useCallback((isoString: string, hours: number): string => {
    const date = new Date(isoString);
    date.setTime(date.getTime() + hours * 60 * 60 * 1000);
    return date.toISOString();
  }, []);

  const handleMouseDown = (e: MouseEvent, type: 'drag' | 'resize-left' | 'resize-right') => {
    e.stopPropagation();
    e.preventDefault();

    // Store original values in refs immediately
    dragStartX.current = e.clientX;
    originalStartTime.current = assignment.start_time;
    originalDuration.current = assignment.duration_hours;

    // Find previous assignment and store its end time
    const myIndex = sortedAssignments.findIndex(a => a.id === assignment.id);
    if (myIndex > 0) {
      const prevAssignment = sortedAssignments[myIndex - 1];
      originalPrevEnd.current = addHoursToTime(prevAssignment.start_time, prevAssignment.duration_hours);
    } else {
      originalPrevEnd.current = null;
    }

    if (type === 'drag') {
      setIsDragging(true);
    } else {
      setIsResizing(type === 'resize-left' ? 'left' : 'right');
    }

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const deltaX = moveEvent.clientX - dragStartX.current;
      const deltaHours = deltaX / hourWidth;

      if (type === 'drag') {
        // Moving the task - cascade to subsequent tasks
        let newStartTime = addHoursToTime(originalStartTime.current, deltaHours);
        
        // Apply boundary constraint (cannot overlap with previous task)
        if (originalPrevEnd.current) {
          const minTime = new Date(originalPrevEnd.current).getTime();
          const newTime = new Date(newStartTime).getTime();
          if (newTime < minTime) {
            newStartTime = originalPrevEnd.current;
          }
        }
        
        // Update with cascade
        onCascadeUpdate(assignment.id, { start_time: newStartTime });
      } else if (type === 'resize-left') {
        // Resizing left edge - affects start_time and duration
        // Cannot extend past previous task's end
        let newStartTime = addHoursToTime(originalStartTime.current, deltaHours);
        let newDuration = originalDuration.current - deltaHours;
        
        // Apply boundary constraint
        if (originalPrevEnd.current) {
          const minTime = new Date(originalPrevEnd.current).getTime();
          const newTime = new Date(newStartTime).getTime();
          if (newTime < minTime) {
            const diffHours = (minTime - newTime) / (60 * 60 * 1000);
            newStartTime = originalPrevEnd.current;
            newDuration += diffHours; // Adjust duration to compensate
          }
        }
        
        // Minimum duration constraint
        if (newDuration < 0.5) {
          newDuration = 0.5;
          newStartTime = addHoursToTime(originalStartTime.current, originalDuration.current - 0.5);
        }
        
        onUpdate(assignment.id, { start_time: newStartTime, duration_hours: newDuration });
      } else if (type === 'resize-right') {
        // Resizing right edge - affects duration, cascade subsequent tasks
        let newDuration = originalDuration.current + deltaHours;
        if (newDuration < 0.5) newDuration = 0.5;
        
        // Update with cascade (duration change affects subsequent tasks' positions)
        onCascadeUpdate(assignment.id, { duration_hours: newDuration });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const formatDuration = (hours: number) => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  return (
    <div
      className={clsx(
        'absolute top-1 bottom-1 rounded cursor-move group transition-shadow',
        (isDragging || isResizing) && 'shadow-lg shadow-black/50 z-10'
      )}
      style={{
        left: Math.max(0, left),
        width: Math.max(20, width),
        backgroundColor: task.color,
        marginLeft: left < 0 ? left : 0,
      }}
      onMouseDown={(e) => handleMouseDown(e, 'drag')}
    >
      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 rounded-l"
        onMouseDown={(e) => handleMouseDown(e, 'resize-left')}
      />

      {/* Content */}
      <div className="h-full flex items-center justify-between px-2 overflow-hidden">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white font-medium truncate drop-shadow">
            {task.title}
          </div>
          <div className="text-[10px] text-white/70 font-mono">
            {formatDuration(assignment.duration_hours)}
          </div>
        </div>

        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(assignment.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-white/70 hover:text-white hover:bg-white/20 rounded transition-opacity"
        >
          <X size={12} />
        </button>
      </div>

      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 rounded-r"
        onMouseDown={(e) => handleMouseDown(e, 'resize-right')}
      />
    </div>
  );
};
