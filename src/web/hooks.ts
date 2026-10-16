import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobRecord } from '../shared/api';
import { api } from './api';

/** Live job list: initial fetch, then server-sent updates (re-synced whenever the stream reconnects). */
export function useJobs() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);

  useEffect(() => {
    let closed = false;
    const sync = () => api.jobs().then((list) => !closed && setJobs(list)).catch(() => undefined);
    const source = new EventSource('/api/events');
    source.addEventListener('ready', sync);
    source.addEventListener('job', (e) => {
      const job = JSON.parse((e as MessageEvent<string>).data) as JobRecord;
      setJobs((prev) => {
        const rest = prev.filter((j) => j.id !== job.id);
        return [job, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    });
    return () => {
      closed = true;
      source.close();
    };
  }, []);

  const remove = useCallback((id: string) => setJobs((prev) => prev.filter((j) => j.id !== id)), []);
  return { jobs, removeLocal: remove };
}

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'ok';
  text: string;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = next.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, push, dismiss };
}

/** useState that survives reloads (drafts are worth keeping). */
export function usePersistentState<T>(key: string, initial: () => T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* ignore corrupt draft */
    }
    return initial();
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked */
    }
  }, [key, value]);
  return [value, setValue];
}
