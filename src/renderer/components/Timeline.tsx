import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { HistoryEntry } from '../../shared/types';

export const Timeline = ({ date, onChangeDate, history, deleteHistory }: { date: Date, onChangeDate: (d: number) => void, history: HistoryEntry[], deleteHistory?: (id: number) => void }) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const filteredHistory = history.filter(e => new Date(e.end_time).getTime() > new Date(e.start_time).getTime() + 180000);

  return (
    <div className="w-72 flex-shrink-0 border-r border-[#1f2937] flex flex-col h-full bg-[#111827]/30 relative z-20">
      <div className="p-3 border-b border-[#1f2937] flex justify-between items-center bg-[#0B0F19] shadow-sm z-10">
        <button className="p-1 hover:bg-[#1f2937] rounded text-gray-400 transition" onClick={() => onChangeDate(-1)}>
          <ChevronLeft size={16} />
        </button>
        <div className="relative flex flex-col items-center cursor-pointer hover:text-white transition group">
          <input className="absolute inset-0 opacity-0 z-20 cursor-pointer" type="date" />
          <h2 className="font-bold tracking-tight text-gray-200 text-sm group-hover:text-indigo-500 transition">
             {date.toLocaleDateString(undefined, { weekday: 'long' }) === new Date().toLocaleDateString(undefined, { weekday: 'long' }) ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' })}
          </h2>
          <span className="text-[10px] font-mono text-gray-500">{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </div>
        <button className="p-1 hover:bg-[#1f2937] rounded text-gray-400 transition" onClick={() => onChangeDate(1)}>
          <ChevronRight size={16} />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto relative bg-[#0B0F19]/30 custom-scrollbar">
        {/* Grid Background */}
        <div className="absolute inset-0 opacity-20 pointer-events-none" 
             style={{ 
               backgroundImage: 'linear-gradient(to bottom, #374151 1px, transparent 1px)',
               backgroundSize: '100% 60px' 
             }}>
        </div>
        
        {/* Labels */}
        <div className="absolute left-0 top-0 bottom-0 w-10 border-r border-[#1f2937]/50 bg-[#0B0F19]/50 text-xs text-gray-600 font-mono text-right pr-2 pt-2 z-10">
           {Array.from({ length: 24 }).map((_, i) => (
             <div key={i} style={{ height: '60px' }}>{i}</div>
           ))}
        </div>
        
        {/* Current Time Line */}
        {date.toDateString() === now.toDateString() && (
            <div 
                className="absolute left-10 right-0 border-t border-red-500/80 z-20 pointer-events-none shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                style={{ top: `${(now.getHours() * 60 + now.getMinutes())}px` }}
            >
                <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500"></div>
            </div>
        )}
        
        {/* Events Container */}
        <div className="absolute left-10 right-0 top-0 bottom-0">
           {(() => {
               if (filteredHistory.length === 0) return null;
               
               // 1. Sort and Filter
               const sorted = [...filteredHistory]
                 .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
               
               if (sorted.length === 0) return null;

               // 2. Cluster entries that overlap
               const clusters: { entries: any[], maxLanes: number }[] = [];
               sorted.forEach(entry => {
                   const start = new Date(entry.start_time).getTime();
                   
                   // Try to find a cluster this entry fits into
                   let cluster = clusters.find(c => {
                       return c.entries.some(e => {
                           const eStart = new Date(e.start_time).getTime();
                           const eEnd = new Date(e.end_time).getTime();
                           const entryEnd = new Date(entry.end_time).getTime();
                           // Overlap check
                           return (start < eEnd && entryEnd > eStart);
                       });
                   });

                   if (!cluster) {
                       cluster = { entries: [], maxLanes: 0 };
                       clusters.push(cluster);
                   }

                   // Assign lane within cluster
                   const lanes: any[][] = [];
                   cluster.entries.forEach(e => {
                       if (!lanes[e.lane]) lanes[e.lane] = [];
                       lanes[e.lane].push(e);
                   });

                   let lane = 0;
                   while (lanes[lane] && lanes[lane].some(e => {
                       const eStart = new Date(e.start_time).getTime();
                       const eEnd = new Date(e.end_time).getTime();
                       const entryEnd = new Date(entry.end_time).getTime();
                       return (start < eEnd && entryEnd > eStart);
                   })) {
                       lane++;
                   }
                   
                   (entry as any).lane = lane;
                   cluster.entries.push(entry);
                   cluster.maxLanes = Math.max(cluster.maxLanes, lane + 1);
               });

               // 3. Render
               return sorted.map(entry => {
                   const start = new Date(entry.start_time);
                   const end = new Date(entry.end_time);
                   const top = (start.getHours() * 60 + start.getMinutes()); 
                   const height = Math.max(22, (end.getTime() - start.getTime()) / 60000);
                   
                   // Find its cluster to get maxLanes
                   const cluster = clusters.find(c => c.entries.includes(entry))!;
                   const lane = (entry as any).lane || 0;
                   const widthPercent = 100 / cluster.maxLanes;
                   const leftPercent = lane * widthPercent;
                   
                   return (
                       <div 
                        key={entry.id}
                        className="absolute rounded bg-indigo-500/30 border-l-2 border-indigo-400 p-1 text-[9px] text-indigo-100 overflow-hidden shadow-md transition-all hover:bg-indigo-500/50 hover:z-20 group cursor-default"
                        style={{ 
                            top: `${top}px`, 
                            height: `${height}px`,
                            left: `${leftPercent}%`,
                            width: `${widthPercent - 1}%`
                        }}
                       >
                            <button 
                                onClick={(e) => { e.stopPropagation(); deleteHistory?.(entry.id); }}
                                className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-500/50 rounded transition-all text-white/50 hover:text-white"
                                title="Delete history entry"
                            >
                                <X size={8} /> 
                            </button>
                           <div className="font-bold truncate leading-tight pr-3" title={entry.title}>{entry.title}</div>
                           <div className="text-[8px] opacity-60">
                               {Math.floor((end.getTime() - start.getTime()) / 60000)}m
                           </div>
                       </div>
                   );
               });
           })()}
        </div>
      </div>
      
      <div className="h-8 border-t border-[#1f2937] bg-[#0B0F19] flex items-center justify-between px-3 text-[10px] text-gray-500 font-mono">
        <span>Focus: {Math.floor(filteredHistory.reduce((acc, h) => acc + (new Date(h.end_time).getTime() - new Date(h.start_time).getTime()), 0) / 3600000)}h {Math.floor((filteredHistory.reduce((acc, h) => acc + (new Date(h.end_time).getTime() - new Date(h.start_time).getTime()), 0) % 3600000) / 60000)}m</span>
      </div>
    </div>
  );
};
