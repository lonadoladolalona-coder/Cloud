import { useRef, useState } from 'react';
import { assetUrl, type AssetRecord } from '../../shared/api';
import { ROLES_BY_KIND, ROLE_LABELS, type AssetRef, type LabeledAsset } from '../../shared/types';
import { Icon } from '../ui';

export interface PendingUpload {
  tempId: string;
  name: string;
  progress: number;
}

interface Props {
  assets: LabeledAsset[];
  info: Record<string, AssetRecord>;
  pending: PendingUpload[];
  onFiles: (files: File[]) => void;
  onChange: (id: string, patch: Partial<AssetRef>) => void;
  onRemove: (id: string) => void;
}

function Thumb({ asset, rec }: { asset: LabeledAsset; rec?: AssetRecord }) {
  if (rec?.hasPreview) return <img src={assetUrl(asset.id, 'preview')} alt="" />;
  if (asset.kind === 'image') return <img src={assetUrl(asset.id)} alt="" />;
  return <span className="thumb-icon"><Icon name={asset.kind === 'audio' ? 'music' : 'film'} size={22} /></span>;
}

export function AssetTray({ assets, info, pending, onFiles, onChange, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="assets">
      <div
        className={`dropzone ${over ? 'dropzone-over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <Icon name="upload" size={20} />
        <div>
          <strong>Add reference images, video or audio</strong>
          <span>Drop files here or click — optional</span>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/*"
          onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ''; }}
        />
      </div>

      {pending.map((p) => (
        <div className="asset asset-pending" key={p.tempId}>
          <div className="asset-body">
            <div className="asset-name">{p.name}</div>
            <div className="progress"><i style={{ width: `${Math.round(p.progress * 100)}%` }} /></div>
          </div>
        </div>
      ))}

      {assets.map((a) => (
        <div className="asset" key={a.id} data-testid={`asset-${a.label.replace(' ', '-')}`}>
          <div className="thumb"><Thumb asset={a} rec={info[a.id]} /></div>
          <div className="asset-body">
            <div className="asset-top">
              <span className="chip-label">{a.label}</span>
              <span className="asset-name" title={a.filename}>{a.filename}</span>
              <button className="icon-btn" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.label}`}><Icon name="x" size={14} /></button>
            </div>
            <select value={a.role} aria-label={`${a.label} role`} onChange={(e) => onChange(a.id, { role: e.target.value as AssetRef['role'] })}>
              {ROLES_BY_KIND[a.kind].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <input
              className="asset-note"
              value={a.note}
              maxLength={300}
              placeholder={a.kind === 'audio' ? 'Describe it (voice, music style…)' : 'What is this? e.g. “the hero, red coat”'}
              aria-label={`${a.label} note`}
              onChange={(e) => onChange(a.id, { note: e.target.value })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
