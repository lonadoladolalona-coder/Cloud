import { jobFileUrl, type JobRecord } from '../../shared/api';
import { Icon, Pill } from '../ui';

const tone = { queued: 'neutral', running: 'accent', succeeded: 'ok', failed: 'danger', cancelled: 'warn' } as const;

export function JobCard({ job, onReuse, onCancel, onDelete }: { job: JobRecord; onReuse: (j: JobRecord) => void; onCancel: (j: JobRecord) => void; onDelete: (j: JobRecord) => void }) {
  const active = job.status === 'queued' || job.status === 'running';
  return (
    <article className="job" data-testid="job-card" data-status={job.status}>
      <div className="job-media">
        {job.video ? (
          <video src={jobFileUrl(job.id, 'video')} poster={job.poster ? jobFileUrl(job.id, 'poster') : undefined} controls preload="metadata" playsInline />
        ) : job.poster ? (
          <img src={jobFileUrl(job.id, 'poster')} alt="Result card" />
        ) : (
          <div className="job-placeholder">
            <Icon name="film" size={26} />
            <span>{job.status === 'failed' ? 'No output' : job.message}</span>
          </div>
        )}
        {active && <div className="progress job-progress"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>}
      </div>
      <div className="job-body">
        <div className="job-meta">
          <Pill tone={tone[job.status]}>{job.status}</Pill>
          <Pill>{job.mode}</Pill>
          <span className="muted">{job.params.durationSec}s · {job.params.aspectRatio} · {job.backend}</span>
        </div>
        {job.error && <p className="job-error">{job.error}</p>}
        {active && <p className="muted">{job.message} — {Math.round(job.progress * 100)}%</p>}
        <details>
          <summary>Prompt</summary>
          <pre className="prompt-text">{job.prompt}</pre>
        </details>
        {job.log.length > 0 && (
          <details>
            <summary>Log ({job.log.length})</summary>
            <pre className="prompt-text">{job.log.join('\n')}</pre>
          </details>
        )}
        <div className="job-actions">
          <button className="btn ghost" onClick={() => onReuse(job)}><Icon name="reuse" size={14} /> Reuse prompt</button>
          {job.video && <a className="btn ghost" href={jobFileUrl(job.id, 'video', true)}><Icon name="download" size={14} /> Download</a>}
          {active ? (
            <button className="btn ghost danger" onClick={() => onCancel(job)}>Cancel</button>
          ) : (
            <button className="btn ghost" onClick={() => onDelete(job)} aria-label="Delete job"><Icon name="trash" size={14} /></button>
          )}
        </div>
      </div>
    </article>
  );
}
