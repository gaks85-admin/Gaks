import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import DebugPage from './pages/DebugPage.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/debug' ? <DebugPage /> : <App />}
  </StrictMode>,
);
