import type { AssetRecord, CreateJobRequest, DirListing, EnhanceRequest, EnhanceResponse, H3Scan, H3ServerStatus, H3Variant, JobRecord, SettingsUpdate, SettingsView } from '../shared/api';
import type { LintIssue } from '../shared/types';

export class ApiFailure extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiFailure('Could not reach the Studio H3 server. Is it running?', 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  if (!res.ok) throw new ApiFailure(body.error ?? res.statusText, res.status, body.details);
  return body as T;
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  settings: () => call<SettingsView>('/api/settings'),
  saveSettings: (u: SettingsUpdate) => call<SettingsView>('/api/settings', send('PUT', u)),
  assets: () => call<AssetRecord[]>('/api/assets'),
  deleteAsset: (id: string) => call<{ ok: true }>(`/api/assets/${id}`, { method: 'DELETE' }),
  enhance: (r: EnhanceRequest) => call<EnhanceResponse>('/api/enhance', send('POST', r)),
  createJob: (r: CreateJobRequest) => call<JobRecord>('/api/jobs', send('POST', r)),
  jobs: () => call<JobRecord[]>('/api/jobs'),
  cancelJob: (id: string) => call<{ ok: true }>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  deleteJob: (id: string) => call<{ ok: true }>(`/api/jobs/${id}`, { method: 'DELETE' }),
  scanH3: (path: string) => call<H3Scan>('/api/h3/scan', send('POST', { path })),
  h3Status: () => call<H3ServerStatus>('/api/h3/status'),
  h3Start: (variant: H3Variant) => call<H3ServerStatus>('/api/h3/start', send('POST', { variant })),
  h3Stop: () => call<H3ServerStatus>('/api/h3/stop', send('POST', {})),
  dirs: (path: string) => call<DirListing>(`/api/fs/dirs?path=${encodeURIComponent(path)}`),

  /** Multipart upload with progress (fetch can't report upload progress). */
  upload(file: File, preview: Blob | undefined, onProgress: (fraction: number) => void): Promise<AssetRecord> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      if (preview) form.append('preview', preview, 'preview.jpg');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/assets');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onerror = () => reject(new ApiFailure('Upload failed — is the server running?', 0));
      xhr.onload = () => {
        let body: { error?: string } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as unknown as AssetRecord);
        else reject(new ApiFailure(body.error ?? `Upload failed (${xhr.status})`, xhr.status));
      };
      xhr.send(form);
    });
  },
};

export const lintFromError = (e: unknown): LintIssue[] => (e instanceof ApiFailure && Array.isArray(e.details) ? (e.details as LintIssue[]) : []);
export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
