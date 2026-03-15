import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { GpuRow } from './GpuRow';
import { SchedulerGpu, SchedulerTask, SchedulerAssignment } from '../../../shared/types';

interface TimelineProps {
  gpus: SchedulerGpu[];
  assignments: SchedulerAssignment[];
  tasks: SchedulerTask[];
  viewStartDate: Date;
  hourWidth: number;
  totalHours: number;
  timelineWidth: number;
  onDropTask: (gpuId: number, startTime: string, taskId: number) => void;
  onUpdateAssignment: (id: number, updates: { start_time?: string; duration_hours?: number }) => void;
  onCascadeUpdate: (gpuId: number, assignmentId: number, updates: { start_time?: string; duration_hours?: number }) => void;
  onDeleteAssignment: (id: number) => void;
  onAddGpu: () => void;
  onDeleteGpu: (id: number) => void;
  onZoom: (delta: number) => void;
}

export const Timeline = ({
  gpus,
  assignments,
  tasks,
  viewStartDate,
  hourWidth,
  totalHours,
  timelineWidth,
  onDropTask,
  onUpdateAssignment,
  onCascadeUpdate,
  onDeleteAssignment,
  onAddGpu,
  onDeleteGpu,
  onZoom,
}: TimelineProps) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Sync header scroll with content scroll
  const handleContentScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (headerRef.current) {
      headerRef.current.scrollLeft = target.scrollLeft;
    }
    setScrollLeft(target.scrollLeft);
  };

  // Handle Ctrl+wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) {
      e.preventDefault();
      // Zoom in (scroll up) or out (scroll down)
      const delta = e.deltaY > 0 ? -5 : 5;
      onZoom(delta);
    }
  };

  // Generate day headers and hour labels
  const daysInView = Math.floor(totalHours / 24);
  const hoursPerDay = 24;

  // Generate day headers
  const dayHeaders = Array.from({ length: daysInView }, (_, dayIndex) => {
    const date = new Date(viewStartDate);
    date.setDate(date.getDate() + dayIndex);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = date.getDate();
    const monthName = date.toLocaleDateString('en-US', { month: 'short' });

    return (
      <div
        key={dayIndex}
        className="absolute top-0 text-[10px] text-gray-400 font-medium"
        style={{ left: dayIndex * hoursPerDay * hourWidth, width: hoursPerDay * hourWidth }}
      >
        <span className="text-gray-300">{dayName}</span>
        <span className="ml-1 text-gray-500">{monthName} {dayNum}</span>
      </div>
    );
  });

  // Generate hour tick marks (every 6 hours)
  const hourTicks = Array.from({ length: totalHours }, (_, i) => {
    if (i % 6 !== 0) return null; // Only show every 6 hours
    const hour = i % 24;
    return (
      <div
        key={i}
        className="absolute top-5 text-[9px] text-gray-600 font-mono"
        style={{ left: i * hourWidth }}
      >
        {hour.toString().padStart(2, '0')}h
      </div>
    );
  }).filter(Boolean);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Day/Hour Header - scrollable */}
      <div
        ref={headerRef}
        className="h-10 border-b border-[#1f2937] bg-[#111827]/80 flex-shrink-0 overflow-x-hidden"
      >
        <div className="relative" style={{ width: timelineWidth, marginLeft: 112 }}>
          {dayHeaders}
          {hourTicks}
        </div>
      </div>

      {/* GPU Rows - scrollable */}
      <div
        ref={contentRef}
        className="flex-1 overflow-auto custom-scrollbar"
        onScroll={handleContentScroll}
        onWheel={handleWheel}
      >
        <div style={{ width: timelineWidth, minWidth: '100%' }}>
          {gpus.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <div className="mb-4">
                <svg
                  className="w-16 h-16 text-gray-700"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 0H3m2 0H3m14 0h2m-2 0h2m-2 0h2M12 9a3 3 0 11-6 0 3 3 0 016 0 3 3 0 01-6 0z"
                  />
                </svg>
              </div>
              <p className="text-sm mb-2">No GPUs added yet</p>
              <button
                onClick={onAddGpu}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
              >
                <Plus size={16} />
                Add GPU
              </button>
            </div>
          ) : (
            <>
              {gpus.map((gpu) => (
                <GpuRow
                  key={gpu.id}
                  gpu={gpu}
                  assignments={assignments.filter((a) => a.gpu_id === gpu.id)}
                  tasks={tasks}
                  viewStartDate={viewStartDate}
                  hourWidth={hourWidth}
                  totalHours={totalHours}
                  scrollLeft={scrollLeft}
                  onDropTask={onDropTask}
                  onUpdateAssignment={onUpdateAssignment}
                  onCascadeUpdate={onCascadeUpdate}
                  onDeleteAssignment={onDeleteAssignment}
                  onDeleteGpu={onDeleteGpu}
                />
              ))}
            </>
          )}
        </div>
      </div>
      
      {/* Add GPU button - always visible at bottom */}
      {gpus.length > 0 && (
        <div 
          className="h-12 border-t border-[#1f2937] flex items-center justify-center cursor-pointer hover:bg-indigo-500/10 transition-colors bg-[#111827]/80 flex-shrink-0"
          onClick={onAddGpu}
        >
          <div className="flex items-center gap-2 text-gray-500 hover:text-indigo-400 transition-colors">
            <Plus size={16} />
            <span className="text-sm">Add GPU</span>
          </div>
        </div>
      )}
    </div>
  );
};
