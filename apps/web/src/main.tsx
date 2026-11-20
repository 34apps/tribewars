import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { warmVillage } from './warmup.ts';
// Self-hosted fonts (no request to Google): latin + latin-ext only.
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-500.css';
import '@fontsource/rubik/latin-600.css';
import '@fontsource/rubik/latin-700.css';
import '@fontsource/rubik/latin-ext-400.css';
import '@fontsource/rubik/latin-ext-500.css';
import '@fontsource/rubik/latin-ext-600.css';
import '@fontsource/rubik/latin-ext-700.css';
import '@fontsource/bagel-fat-one/latin-400.css';
import '@fontsource/bagel-fat-one/latin-ext-400.css';
import './styles.css';
import './hud.css';
import './pages.css';
import './bring-home.css';

warmVillage();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
