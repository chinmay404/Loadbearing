import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LoadingBar } from './ui/LoadingBar';
import './styles/index.css';
import './ui/prefs';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LoadingBar />
    <App />
  </StrictMode>,
);
