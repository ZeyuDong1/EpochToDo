import { LayoutGrid, LayoutDashboard, FolderOpen, Settings } from 'lucide-react';
import clsx from 'clsx';

type View = 'dashboard' | 'projects' | 'settings';

export const Sidebar = ({ currentView, onViewChange }: { currentView: View, onViewChange: (v: View) => void }) => (
  <div className="w-16 flex-shrink-0 border-r border-[#1f2937] bg-[#111827] flex flex-col items-center py-6 gap-6 z-30">
    <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 mb-4">
      <LayoutGrid size={24} />
    </div>
    
    <button 
      onClick={() => onViewChange('dashboard')}
      className={clsx(
        "w-10 h-10 rounded-lg flex items-center justify-center transition-all",
        currentView === 'dashboard' ? "text-white bg-[#1f2937]" : "text-gray-400 hover:text-white hover:bg-[#1f2937]"
      )}
      title="Dashboard"
    >
      <LayoutDashboard size={20} />
    </button>
    
    <button 
      onClick={() => onViewChange('projects')}
      className={clsx(
        "w-10 h-10 rounded-lg flex items-center justify-center transition-all",
        currentView === 'projects' ? "text-white bg-[#1f2937]" : "text-gray-400 hover:text-white hover:bg-[#1f2937]"
      )}
      title="Projects"
    >
      <FolderOpen size={20} />
    </button>
    
    <div className="flex-1"></div>
    
    <button 
      onClick={() => onViewChange('settings')}
      className={clsx(
        "w-10 h-10 rounded-lg flex items-center justify-center transition-all",
        currentView === 'settings' ? "text-white bg-[#1f2937]" : "text-gray-400 hover:text-white hover:bg-[#1f2937]"
      )}
      title="Settings"
    >
      <Settings size={20} />
    </button>
  </div>
);
