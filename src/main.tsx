import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Task-bullet drags carry the title as text/plain so external apps can
// receive it. Suppress the browser's default "insert dragged text" on drops
// inside our own windows — dropping on EpochToDo itself is a no-op, not an
// edit (the dispatch handler already skips association/paste for self).
const isTextDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('text/plain');
window.addEventListener('dragover', (e) => { if (isTextDrag(e)) e.preventDefault(); }, true);
window.addEventListener('drop', (e) => {
  if (isTextDrag(e)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

