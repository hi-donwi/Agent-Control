import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DeskApp } from './desk/DeskApp';
import 'uidl-runtime/style.css';
import './styles.css';

// The desk is the default; `?ui=classic` keeps the single-chat layout during the transition.
const classic = new URLSearchParams(window.location.search).get('ui') === 'classic';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      {classic ? <App /> : <DeskApp />}
    </StrictMode>,
  );
}
