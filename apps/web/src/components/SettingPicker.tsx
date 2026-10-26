import { useEffect, useRef, useState } from 'react';
import type { SettingGroup } from '../lib/object-settings';
import { useSlicer } from '../state/store';
import { ChevronRight } from 'lucide-react';

/**
 * Picks settings to add to an object, part or modifier: a search box over
 * desktop's groups, each group opening to its settings. It stays open so
 * several can be added in a row, like desktop's "Select settings" dialog.
 */
export function SettingPicker({
  groups,
  have,
  kind,
  onAdd,
  onClose,
}: {
  groups: SettingGroup[];
  have: Record<string, string>;
  kind: string;
  onAdd: (key: string) => void;
  onClose: () => void;
}) {
  const options = useSlicer((s) => s.options);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  // Typing straight away on a computer; a phone's keyboard would hide the list.
  useEffect(() => {
    if (window.matchMedia('(hover: hover)').matches) search.current?.focus();
  }, []);

  const left = groups.map((g) => ({ ...g, settings: g.settings.filter((s) => !(s.key in have)) })).filter((g) => g.settings.length);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length
    ? left.flatMap((g) =>
        g.settings
          .filter((s) => {
            const text = `${s.label} ${s.key.replace(/_/g, ' ')}`.toLowerCase();
            return words.every((w) => text.includes(w));
          })
          .map((s) => ({ ...s, group: groupName(g.group) })),
      )
    : null;
  const row = (s: { key: string; label: string }, note?: string) => (
    <li key={s.key}>
      <button type="button" className="setting-pick" data-key={s.key} title={options[s.key]?.tooltip || undefined} onClick={() => onAdd(s.key)}>
        <span>{s.label}</span>
        {note && <span className="setting-pick-note">{note}</span>}
        <span className="setting-pick-plus" aria-hidden>
          +
        </span>
      </button>
    </li>
  );
  const firstMore = left.findIndex((g) => g.group.startsWith('More: '));

  return (
    <div className="setting-picker" role="region" aria-label={`Settings to add to this ${kind}`}>
      <div className="setting-picker-head">
        <input
          ref={search}
          type="search"
          placeholder="Search settings"
          aria-label="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        />
        <button type="button" className="secondary" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="setting-picker-list">
        {matches ? (
          matches.length ? (
            <ul>{matches.map((s) => row(s, s.group))}</ul>
          ) : (
            <p className="hint">No setting matches “{query.trim()}”.</p>
          )
        ) : (
          left.map((g, i) => (
            <div key={g.group}>
              {i === firstMore && <div className="setting-picker-divider">More settings</div>}
              <button
                type="button"
                className="setting-group-toggle"
                aria-expanded={open === g.group}
                onClick={() => setOpen(open === g.group ? null : g.group)}
              >
                <span>{groupName(g.group)}</span>
                <span className="setting-pick-note">{g.settings.length}</span>
                <ChevronRight className="setting-group-chevron" size={14} aria-hidden />
              </button>
              {open === g.group && <ul>{g.settings.map((s) => row(s))}</ul>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const groupName = (group: string) => group.replace(/^More: /, '');
