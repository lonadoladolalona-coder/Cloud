import type { ReactNode } from 'react';
import type { Severity } from '../shared/types';

export function Icon({ name, size = 16 }: { name: 'spark' | 'upload' | 'play' | 'x' | 'download' | 'film' | 'music' | 'copy' | 'plus' | 'import' | 'trash' | 'reuse'; size?: number }) {
  const paths: Record<string, string> = {
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
    upload: 'M12 16V4m0 0L7 9m5-5l5 5M4 20h16',
    play: 'M8 5v14l11-7z',
    x: 'M6 6l12 12M18 6L6 18',
    download: 'M12 4v12m0 0l-5-5m5 5l5-5M4 20h16',
    film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M16 9h4M4 15h4M16 15h4',
    music: 'M9 18V6l11-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zm11-2a3 3 0 11-6 0 3 3 0 016 0z',
    copy: 'M9 9h10v11H9zM5 5h10v2M5 5v11h2',
    plus: 'M12 5v14M5 12h14',
    import: 'M12 4v12m0 0l-5-5m5 5l5-5M4 20h16',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    reuse: 'M4 12a8 8 0 0114-5l2-2v6h-6l2.2-2.2A5.5 5.5 0 006 12M20 12a8 8 0 01-14 5l-2 2v-6h6l-2.2 2.2A5.5 5.5 0 0018 12',
  };
  const filled = name === 'play' || name === 'spark';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Working" />;
}

export function Pill({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info'; children: ReactNode; title?: string }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}

export const severityTone: Record<Severity, 'danger' | 'warn' | 'info'> = { error: 'danger', warning: 'warn', info: 'info' };

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      <span>{label}</span>
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
