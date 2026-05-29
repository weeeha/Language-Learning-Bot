import React from 'react';
import { createRoot } from 'react-dom/client';
import { initTelegram } from './telegram';
import App from './App';
import './ui.css';
initTelegram();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
