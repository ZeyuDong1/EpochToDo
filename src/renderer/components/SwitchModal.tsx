import { useState, useEffect } from 'react';
import { Task } from '../../shared/types';
import { Play, Clock, X, CheckCircle } from 'lucide-react';

export const SwitchModal = () => {
  const [task, setTask] = useState<Task | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleTimerEnd = async (taskId: number) => {
      // 1. Fetch the task details
      const allTasks = await window.api.getTasks();
      const endedTask = allTasks.find(t => t.id === taskId);
      
      if (endedTask) {
        setTask(endedTask);
        setIsOpen(true);
        // Bring app to front (Main process should handle this, but ensures visibility)
      }
    };

    const removeListener = window.api.onTimerEnded(handleTimerEnd);
    return () => {
      // @ts-ignore
      removeListener?.();
    };
  }, []);

  const handleSwitchBack = () => {
    if (task) {
      window.api.startFocus(task.id);
      setIsOpen(false);
    }
  };

  const handleSnooze = (minutes: number) => {
    if (task) {
      window.api.startWait(task.id, minutes * 60);
      setIsOpen(false);
    }
  };
  
  const handleDismiss = () => {
    setIsOpen(false);
  };

  if (!isOpen || !task) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1a1a] border border-gray-700 w-full max-w-md rounded-xl shadow-2xl p-6 relative animate-in fade-in zoom-in duration-200">
        
        <button 
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-gray-500 hover:text-white"
        >
          <X size={20} />
        </button>

        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">Timer Finished</h2>
          <div className="text-xl text-blue-400 font-mono mb-4">{task.title}</div>
          
          {task.context_memo && (
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50 text-gray-300 italic text-sm">
              "{task.context_memo}"
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <button 
            onClick={handleSwitchBack}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-medium transition-colors"
          >
            <Play size={18} fill="currentColor" />
            Switch Back (Focus)
          </button>
          
          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={() => handleSnooze(5)}
              className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 py-3 rounded-lg font-medium transition-colors"
            >
              <Clock size={18} />
              Snooze 5m
            </button>
            <button 
              onClick={handleDismiss}
              className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-green-400 py-3 rounded-lg font-medium transition-colors"
            >
              <CheckCircle size={18} />
              Done
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
