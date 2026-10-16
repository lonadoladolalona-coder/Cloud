import './install';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App';
import '../styles.css';
import './demo.css';

function DemoBanner() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <aside className="demo-banner" aria-label="About this demo">
      <div>
        <strong>Interactive demo.</strong> This is the real Studio H3 interface running on a simulated backend inside your browser. Prompts come from a simple template writer instead of Claude, the model server is pretend, and generated clips are placeholders. Nothing leaves this page.
        <span className="demo-try"> Try it: pick a preset, press <b>Enhance</b>, then <b>Generate</b>. In <b>Settings</b>, press <b>Scan folder</b> or <b>Browse…</b> to explore a pretend model folder.</span>
      </div>
      <button className="demo-close" onClick={() => setOpen(false)} aria-label="Hide this note">Hide</button>
    </aside>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoBanner />
    <App />
  </StrictMode>,
);
