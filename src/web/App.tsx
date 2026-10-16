import { useCallback, useEffect, useState } from 'react';
import type { JobRecord, SettingsView } from '../shared/api';
import { api, messageOf } from './api';
import { useJobs, useToasts } from './hooks';
import { CreatePage } from './pages/Create';
import { LibraryPage } from './pages/Library';
import { SettingsPage } from './pages/Settings';
import { Icon } from './ui';

type Page = 'create' | 'library' | 'settings';

export function App() {
  const [page, setPage] = useState<Page>('create');
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [reuse, setReuse] = useState<JobRecord | null>(null);
  const { jobs, removeLocal } = useJobs();
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => {
    api.settings().then(setSettings).catch((e) => push('error', messageOf(e)));
  }, [push]);

  const onReuse = useCallback((job: JobRecord) => {
    setReuse(job);
    setPage('create');
  }, []);
  const onCancel = useCallback((job: JobRecord) => void api.cancelJob(job.id).catch((e) => push('error', messageOf(e))), [push]);
  const onDelete = useCallback((job: JobRecord) => {
    api.deleteJob(job.id).then(() => removeLocal(job.id)).catch((e) => push('error', messageOf(e)));
  }, [push, removeLocal]);
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="logo"><Icon name="film" size={16} /></span> Studio H3</div>
        <nav aria-label="Main">
          {(['create', 'library', 'settings'] as Page[]).map((p) => (
            <button key={p} className={page === p ? 'on' : ''} onClick={() => setPage(p)} aria-current={page === p ? 'page' : undefined}>
              {p[0]!.toUpperCase() + p.slice(1)}
              {p === 'library' && running > 0 && <span className="badge">{running}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main>
        <div hidden={page !== 'create'}>
          <CreatePage
            settings={settings}
            jobs={jobs}
            push={push}
            reuse={reuse}
            onReuseDone={() => setReuse(null)}
            onReuse={onReuse}
            onCancel={onCancel}
            onDelete={onDelete}
            openLibrary={() => setPage('library')}
            openSettings={() => setPage('settings')}
          />
        </div>
        {page === 'library' && <LibraryPage jobs={jobs} onReuse={onReuse} onCancel={onCancel} onDelete={onDelete} />}
        {page === 'settings' && <SettingsPage settings={settings} onSaved={setSettings} push={push} />}
      </main>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} onClick={() => dismiss(t.id)}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
