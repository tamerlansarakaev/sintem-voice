import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../styles/index.css';
import { I18nProvider } from '../lib/i18n';
import { SubtitlesApp } from './SubtitlesApp';

document.documentElement.classList.add(`platform-${window.config.platform}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <SubtitlesApp />
    </I18nProvider>
  </StrictMode>,
);
