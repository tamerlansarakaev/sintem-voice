import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../styles/index.css';
import { I18nProvider } from '../lib/i18n';
import { AppStateProvider } from '../state/app-state';
import { ToastProvider } from '../state/toasts';
import { App } from './App';

document.documentElement.classList.add(`platform-${window.config.platform}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
