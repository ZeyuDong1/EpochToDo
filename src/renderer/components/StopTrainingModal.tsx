// import { useState, useEffect } from 'react';

interface StopTrainingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onBackToQueue: () => void;
    onEarlyComplete: () => void;
    title: string;
    isFinished: boolean; // Tells us if the countdown is already 0
}

export const StopTrainingModal = ({ isOpen, onClose, onBackToQueue, onEarlyComplete, title, isFinished }: StopTrainingModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-[#111827] border border-[#1f2937] rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6">
                    <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
                    <p className="text-gray-400 text-sm mb-6">
                        {isFinished 
                           ? "Task has finished its duration. Mark as complete?" 
                           : "Task is still running. Do you want to stop it?"}
                    </p>
                    
                    <div className="flex flex-col gap-3">
                         {isFinished ? (
                            <div className="flex gap-3">
                                <button 
                                    onClick={onClose}
                                    className="flex-1 px-4 py-3 rounded-lg border border-[#1f2937] text-gray-400 font-bold text-[10px] tracking-widest hover:bg-white/5 transition-all"
                                >
                                    CANCEL
                                </button>
                                <button 
                                    onClick={onEarlyComplete} // Standard complete flow
                                    className="flex-1 px-4 py-3 rounded-lg bg-green-600 text-white font-bold text-[10px] tracking-widest hover:bg-green-500 transition-all shadow-[0_0_20px_rgba(34,197,94,0.2)]"
                                >
                                    COMPLETE
                                </button>
                            </div>
                         ) : (
                             <>
                                {/* Not Finished Options */}
                                <button 
                                    onClick={onEarlyComplete}
                                    className="w-full px-4 py-3 rounded-lg bg-green-900/40 text-green-400 border border-green-500/20 font-bold text-[10px] tracking-widest hover:bg-green-900/60 hover:text-green-300 transition-all flex justify-between items-center group"
                                >
                                    <span>EARLY COMPLETE</span>
                                    <span className="text-[9px] opacity-50 group-hover:opacity-100">Creation Follow-up</span>
                                </button>
                                
                                <button 
                                    onClick={onBackToQueue}
                                    className="w-full px-4 py-3 rounded-lg bg-indigo-900/40 text-indigo-400 border border-indigo-500/20 font-bold text-[10px] tracking-widest hover:bg-indigo-900/60 hover:text-indigo-300 transition-all flex justify-between items-center group"
                                >
                                    <span>BACK TO QUEUE</span>
                                    <span className="text-[9px] opacity-50 group-hover:opacity-100">Keep Data</span>
                                </button>

                                <button 
                                    onClick={onClose}
                                    className="w-full px-4 py-2 rounded-lg text-gray-600 font-bold text-[10px] tracking-widest hover:text-gray-400 transition-all mt-2"
                                >
                                    CANCEL
                                </button>
                             </>
                         )}
                    </div>
                </div>
            </div>
        </div>
    );
};
