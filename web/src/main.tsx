import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';
import './hex/hex.css';
import './diagram/diagram.css';
import './explain.css';
createRoot(document.getElementById('root')!).render(<App />);
