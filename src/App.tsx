import { useState, useEffect } from 'react';
import { Dashboard } from './renderer/components/Dashboard';
import { Spotlight } from './renderer/components/Spotlight';
import { Reminder } from './renderer/components/Reminder';
import { Overlay } from './renderer/components/Overlay';
import { useStore } from './store/useStore';

function App() {
  const [view, setView] = useState<'dashboard' | 'spotlight' | 'reminder' | 'overlay'>('dashboard');
  const [isReady, setIsReady] = useState(false);
  const setTrainingStatus = useStore(state => state.setTrainingStatus);

  useEffect(() => {
    console.log('App initialization...');
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type') as 'dashboard' | 'spotlight' | 'reminder' | 'overlay';
    if (type) {
      setView(type);
    }
    
    // Global Listeners
    const cleanup = window.api.onTrainingUpdate((status) => {
        setTrainingStatus(status);
    });

    setIsReady(true);
    return () => {
        cleanup();
    };
  }, [setTrainingStatus]);

  if (!isReady) return <div className="bg-black text-white p-10">Initializing...</div>;


  return (
    <div className="w-full h-full">
      {view === 'dashboard' && <SafeDashboard />}
      {view === 'spotlight' && <SafeSpotlight />}
      {view === 'reminder' && <SafeReminder />}
      {view === 'overlay' && <SafeOverlay />}
    </div>
  );
}

const SafeOverlay = () => {
  try {
    return (
      <div className="w-full h-full bg-transparent overflow-hidden">
        <Overlay />
      </div>
    );
  } catch (e) {
    return <div className="text-red-500 text-xs">Overlay Error</div>;
  }
};

const SafeDashboard = () => {
  try {
    return <Dashboard />;
  } catch (e) {
    return (
      <div className="p-20 bg-red-900 text-white h-screen">
        <h1 className="text-2xl font-bold">Dashboard Critical Failure</h1>
        <pre className="mt-4 text-xs">{String(e)}</pre>
      </div>
    );
  }
};

const SafeSpotlight = () => {
  try {
    return (
      <div className="flex items-center justify-center h-screen bg-transparent">
        <Spotlight />
      </div>
    );
  } catch (e) {
    return (
      <div className="p-10 bg-red-900 text-white rounded-xl">
        <h1>Spotlight Crash</h1>
        <pre>{String(e)}</pre>
      </div>
    );
  }
};

const SafeReminder = () => {
  try {
    return (
      <div className="flex items-center justify-center h-screen bg-transparent">
        <Reminder />
      </div>
    );
  } catch (e) {
    return (
      <div className="p-10 bg-red-900 text-white rounded-xl">
        <h1>Reminder Crash</h1>
        <pre>{String(e)}</pre>
      </div>
    );
  }
};

export default App;

