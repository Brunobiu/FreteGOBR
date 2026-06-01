import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './hooks/useAuth.tsx';
import AppErrorBoundary from './components/admin/assistant/AppErrorBoundary';
import { installGlobalErrorCapture } from './services/admin/errorCapture';
import 'leaflet/dist/leaflet.css';
import './index.css';

// Global_Error_Capture: instala handlers de window, intercept de console.error
// e wrapper de fetch uma unica vez no bootstrap (Req 3.2). O AppErrorBoundary
// abaixo cobre os erros de renderizacao do React (Req 3.1). Chamado em module
// scope para garantir instalacao unica; a propria funcao e idempotente.
installGlobalErrorCapture();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
