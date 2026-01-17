import { useState, useEffect } from 'react';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    strict?: boolean;
}

export const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, strict = false }: ConfirmModalProps) => {
    const [confirmText, setConfirmText] = useState('');

    useEffect(() => {
        if (isOpen) setConfirmText('');
    }, [isOpen]);

    if (!isOpen) return null;

    const isConfirmed = !strict || confirmText === 'Confirm';

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-[#111827] border border-[#1f2937] rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6">
                    <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
                    <p className="text-gray-400 text-sm mb-6">{message}</p>
                    <div className="space-y-4">
                        {strict && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Type "Confirm" to proceed</label>
                                <input 
                                    autoFocus
                                    value={confirmText}
                                    onChange={e => setConfirmText(e.target.value)}
                                    className="w-full bg-[#0B0F19] border border-[#1f2937] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all font-mono"
                                    placeholder="Confirm"
                                    onKeyDown={(e) => {
                                        if(e.key === 'Enter' && isConfirmed) {
                                            onConfirm();
                                            onClose();
                                        }
                                    }}
                                />
                            </div>
                        )}
                        <div className="flex gap-3 pt-2">
                            <button 
                                onClick={onClose}
                                className="flex-1 px-4 py-3 rounded-lg border border-[#1f2937] text-gray-400 font-bold text-[10px] tracking-widest hover:bg-white/5 transition-all"
                            >
                                CANCEL
                            </button>
                            <button 
                                disabled={!isConfirmed}
                                onClick={() => { onConfirm(); onClose(); }}
                                className="flex-1 px-4 py-3 rounded-lg bg-red-600 disabled:bg-red-900/20 disabled:text-red-900 text-white font-bold text-[10px] tracking-widest hover:bg-red-500 transition-all shadow-[0_0_20px_rgba(220,38,38,0.2)]"
                            >
                                DELETE
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
