import { useState } from 'react';
import type { FormEvent } from 'react';
import { TRIBE_DESCRIPTION_MAX, canTribe, checkTribeDescription } from '@clanfire/engine';
import type { Recruitment } from '@clanfire/engine';
import { api } from '../api.ts';
import { formatDate, formatInt } from '../format.ts';
import { useRules } from '../game.ts';
import { CharCount, PlainText, RECRUITMENT_HINT, RECRUITMENT_NAME, RECRUITMENT_OPTIONS, Segmented } from './bits.tsx';
import { useTribe } from './context.ts';
import type { MemberProps } from './context.ts';

function SettingsForm({ tribe }: MemberProps) {
  const { run, busy } = useTribe();
  const [description, setDescription] = useState(tribe.description);
  const [recruitment, setRecruitment] = useState<Recruitment>(tribe.recruitment);
  const [error, setError] = useState<string | null>(null);
  const check = checkTribeDescription(description);
  const descChanged = check.ok && check.text !== tribe.description;
  const recChanged = recruitment !== tribe.recruitment;
  const dirty = descChanged || recChanged;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!check.ok || !dirty || busy) return;
    const err = await run(
      () => api.tribeSettings({ ...(descChanged ? { description: check.text } : {}), ...(recChanged ? { recruitment } : {}) }),
      { ok: 'Settings saved.', toastError: false },
    );
    setError(err);
  }

  return (
    <form className="card stack" onSubmit={(e) => void save(e)} aria-labelledby="settings-title">
      <h2 id="settings-title" className="card-title">Settings</h2>
      <div className="field">
        <span>Recruitment</span>
        <Segmented label="Recruitment" value={recruitment} options={RECRUITMENT_OPTIONS} onChange={setRecruitment} />
        <span className="hint">{RECRUITMENT_HINT[recruitment]}</span>
      </div>
      <label className="field">
        <span>Description</span>
        <textarea
          className="input textarea"
          rows={6}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setError(null);
          }}
        />
      </label>
      <div className="form-row">
        <CharCount value={description} max={TRIBE_DESCRIPTION_MAX} />
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          disabled={!dirty || busy}
          onClick={() => {
            setDescription(tribe.description);
            setRecruitment(tribe.recruitment);
            setError(null);
          }}
        >
          Reset
        </button>
        <button type="submit" className="btn btn-primary" disabled={!dirty || busy || !check.ok}>
          Save
        </button>
      </div>
      {!check.ok && <p className="form-error">{check.message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

export function Overview({ tribe, role }: MemberProps) {
  const maxMembers = useRules().tribe.maxMembers;
  return (
    <>
      <section className="card" aria-labelledby="ov-title">
        <h2 id="ov-title" className="card-title">About</h2>
        {tribe.description ? <PlainText text={tribe.description} /> : <p className="muted">No description yet.</p>}
        <dl className="facts">
          <div><dt>Recruitment</dt><dd>{RECRUITMENT_NAME[tribe.recruitment]}</dd></div>
          <div><dt>Members</dt><dd>{tribe.members}/{maxMembers}</dd></div>
          <div><dt>Points</dt><dd>{formatInt(tribe.points)}</dd></div>
          <div><dt>Founded</dt><dd>{formatDate(tribe.createdAt)}</dd></div>
        </dl>
      </section>
      {canTribe(role, 'edit_settings') ? (
        <SettingsForm tribe={tribe} role={role} />
      ) : (
        <p className="muted small">Only the leader and officers can change the description and recruitment.</p>
      )}
    </>
  );
}
