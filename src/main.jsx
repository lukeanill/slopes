import { createRoot } from 'react-dom/client';
import '@lukeanill/ui/globals.css';
import App from './App.jsx';
import './style.css';

// No StrictMode: its development-only double mount leaves metal-fx controls (Metal.jsx) that
// appear after load stuck invisible — they only reveal once their first metal frame is painted,
// which the discarded first mount swallows. Production never double-mounts.
createRoot(document.getElementById('root')).render(<App />);
