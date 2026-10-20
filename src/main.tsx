import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// No StrictMode: the fabric canvas is created imperatively and must mount exactly once.
createRoot(document.getElementById('root')!).render(<App />);
