// Small shared pieces of the Tribe tab. All user-written text goes through React children only (never HTML).

import type { DiplomacyKind, TribeRole } from '@clanfire/engine';
import { DIPLOMACY_SHORT, ROLE_NAME } from '../relations.ts';

export function TribeLabel({ tag, name }: { tag: string; name?: string }) {
  return (
    <span className="tribe-label">
      <span className="tribe-tag">[{tag}]</span>
      {name !== undefined && ` ${name}`}
    </span>
  );
}

export function RoleBadge({ role }: { role: TribeRole }) {
  return <span className={`tag tag-role role-${role}`}>{ROLE_NAME[role]}</span>;
}

export function KindBadge({ kind }: { kind: DiplomacyKind }) {
  return <span className={`tag tag-kind kind-${kind}`}>{DIPLOMACY_SHORT[kind]}</span>;
}

/** User-written text: shown as plain text, line breaks kept (CSS white-space: pre-wrap). */
export function PlainText({ text, className }: { text: string; className?: string }) {
  return <p className={`plain${className ? ` ${className}` : ''}`}>{text}</p>;
}

export function CharCount({ value, max }: { value: string; max: number }) {
  const n = [...value.trim()].length;
  return <span className={`char-count${n > max ? ' is-over' : ''}`} aria-live="off">{n}/{max}</span>;
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** Radio-style buttons in a row; wraps on narrow screens. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`segment${value === o.value ? ' is-active' : ''}`}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const RECRUITMENT_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'application', label: 'Application' },
  { value: 'invite', label: 'Invite only' },
] as const;

export const RECRUITMENT_NAME = { open: 'Open', application: 'Application', invite: 'Invite only' } as const;

export const RECRUITMENT_HINT = {
  open: 'Anyone without a tribe can join at once.',
  application: 'Players apply with a short message; officers decide.',
  invite: 'Only players you invite can join.',
} as const;
