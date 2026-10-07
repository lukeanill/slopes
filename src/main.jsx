import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@lukeanill/ui/globals.css';
import App from './App.jsx';
import './style.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
