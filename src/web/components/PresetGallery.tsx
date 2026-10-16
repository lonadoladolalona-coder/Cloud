import { PRESETS, type Preset } from '../../shared/presets';

export function PresetGallery({ selected, onSelect }: { selected: string | null; onSelect: (preset: Preset | null) => void }) {
  return (
    <div className="presets" role="listbox" aria-label="Presets">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          role="option"
          aria-selected={selected === p.id}
          className={`preset ${selected === p.id ? 'preset-on' : ''}`}
          style={{ ['--c1' as string]: p.colors[0], ['--c2' as string]: p.colors[1] }}
          onClick={() => onSelect(selected === p.id ? null : p)}
          title={p.needs ?? p.tagline}
        >
          <span className="preset-name">{p.name}</span>
          <span className="preset-tag">{p.tagline}</span>
        </button>
      ))}
    </div>
  );
}
