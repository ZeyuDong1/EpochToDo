import { useState, useEffect } from 'react';
import { Dashboard } from './renderer/components/Dashboard';
import { Spotlight } from './renderer/components/Spotlight';
import { Reminder } from './renderer/components/Reminder';
import { Overlay } from './renderer/components/Overlay';
import { ErrorBoundary } from './renderer/components/ErrorBoundary';
import { useStore } from './store/useStore';

function App() {
  const [view, setView] = useState<'dashboard' | 'spotlight' | 'reminder' | 'overlay'>('dashboard');
  const [isReady, setIsReady] = useState(false);
  const setTrainingStatus = useStore(state => state.setTrainingStatus);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type') as 'dashboard' | 'spotlight' | 'reminder' | 'overlay';
    if (type) {
      setView(type);
    }

    let cleanup: (() => void) | undefined;
    if (window.api?.onTrainingUpdate) {
        cleanup = window.api.onTrainingUpdate((status) => {
            setTrainingStatus(status);
        });
    }

    let aiCleanup: (() => void) | undefined;
    if (window.api?.onAiReminder) {
      aiCleanup = window.api.onAiReminder((reminder) => {
        useStore.getState().addAiReminder(reminder);
      });
    }

    setIsReady(true);
    return () => {
        cleanup?.();
        aiCleanup?.();
    };
  }, [setTrainingStatus]);

  if (!isReady) return <div className="bg-black text-white p-10">Initializing...</div>;

  return (
    <ErrorBoundary>
      <div className="w-full h-full">
        {view === 'dashboard' && (
          <ErrorBoundary fallback={<div className="p-20 bg-red-900 text-white h-screen"><h1 className="text-2xl font-bold">Dashboard Error</h1></div>}>
            <Dashboard />
          </ErrorBoundary>
        )}
        {view === 'spotlight' && (
          <ErrorBoundary fallback={<div className="p-10 bg-red-900 text-white rounded-xl"><h1>Spotlight Error</h1></div>}>
            <div className="flex items-center justify-center h-screen bg-transparent">
              <Spotlight />
            </div>
          </ErrorBoundary>
        )}
        {view === 'reminder' && (
          <ErrorBoundary fallback={<div className="p-10 bg-red-900 text-white rounded-xl"><h1>Reminder Error</h1></div>}>
            <div className="flex items-center justify-center h-screen bg-transparent">
              <Reminder />
            </div>
          </ErrorBoundary>
        )}
        {view === 'overlay' && (
          <ErrorBoundary fallback={<div className="text-red-500 text-xs">Overlay Error</div>}>
            <div className="w-full h-full bg-transparent overflow-hidden">
              <Overlay />
            </div>
          </ErrorBoundary>
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;

