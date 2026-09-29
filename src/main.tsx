import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './app/app.css';

createRoot(document.getElementById('root')!).render(<App />);
