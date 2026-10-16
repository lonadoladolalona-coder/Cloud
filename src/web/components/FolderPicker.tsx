import { useEffect, useState } from 'react';
import type { DirListing } from '../../shared/api';
import { api, messageOf } from '../api';
import { Modal, Pill, Spinner } from '../ui';

/** Server-side folder browser: a web page can't read absolute paths from a native picker, but the local server can list them. */
export function FolderPicker({ start, onPick, onClose }: { start: string; onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const open = (p: string) => {
    setLoading(true);
    setError('');
    api
      .dirs(p)
      .then(setListing)
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    api.dirs(start).then(setListing).catch(() => api.dirs('').then(setListing).catch((e) => setError(messageOf(e)))).finally(() => setLoading(false));
  }, [start]);

  return (
    <Modal title="Choose the H3 model folder" onClose={onClose} wide>
      <p className="muted">Pick the folder that contains <code>FL2VA</code> and/or <code>Ref2VA</code> (or any folder above it — I will look inside).</p>
      <div className="picker-path" data-testid="picker-path">{listing ? listing.path || 'This computer' : '…'}</div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="picker-list" role="list">
        {loading && <div className="picker-row"><Spinner /></div>}
        {listing && listing.parent !== null && !loading && (
          <button className="picker-row" role="listitem" onClick={() => open(listing.parent!)}>↑ Up</button>
        )}
        {listing?.roots?.map((r) => !listing.path && (
          <button key={r} className="picker-row" role="listitem" onClick={() => open(r)}>{r}</button>
        ))}
        {!loading && listing?.dirs.map((d) => (
          <div className="picker-row split" role="listitem" key={d.path}>
            <button className="link-row" onClick={() => open(d.path)}>📁 {d.name}</button>
            {d.isModel && <><Pill tone="ok">H3 model</Pill><button className="btn" onClick={() => onPick(d.path)}>Use this</button></>}
          </div>
        ))}
        {!loading && listing && listing.dirs.length === 0 && listing.path && <div className="picker-row muted">No sub-folders here.</div>}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!listing?.path} onClick={() => listing && onPick(listing.path)}>Use this folder</button>
      </div>
    </Modal>
  );
}
