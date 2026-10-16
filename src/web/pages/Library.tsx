import type { JobRecord } from '../../shared/api';
import { JobCard } from '../components/JobCard';

export function LibraryPage({ jobs, onReuse, onCancel, onDelete }: { jobs: JobRecord[]; onReuse: (j: JobRecord) => void; onCancel: (j: JobRecord) => void; onDelete: (j: JobRecord) => void }) {
  return (
    <div className="page">
      <h2>Library</h2>
      {jobs.length === 0 ? (
        <p className="muted">Every generation lands here with the exact prompt that produced it.</p>
      ) : (
        <div className="job-grid">{jobs.map((j) => <JobCard key={j.id} job={j} onReuse={onReuse} onCancel={onCancel} onDelete={onDelete} />)}</div>
      )}
    </div>
  );
}
