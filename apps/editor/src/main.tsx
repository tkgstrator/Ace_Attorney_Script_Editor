import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { TooltipProvider } from './components/ui/tooltip.tsx';
import { EditorProvider } from './state/editor-store.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <EditorProvider>
        <App />
      </EditorProvider>
    </TooltipProvider>
  </StrictMode>,
);
