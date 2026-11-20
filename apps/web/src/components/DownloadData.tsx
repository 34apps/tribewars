// "Download my data" button: fetches the JSON export and saves it as a file. Shared by the lobby Account page and the world settings.

import { useState } from 'react';
import { ApiRequestError, errorMessage } from '../api.ts';
import { saveBlob } from '../download.ts';

export function downloadErrorMessage(e: unknown): string {
  return e instanceof ApiRequestError && e.status === 429 ? 'Try again in a few minutes.' : errorMessage(e);
}

export function DownloadData({ label, load }: { label: string; load: () => Promise<{ filename: string; blob: Blob }> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const f = await load();
      saveBlob(f.blob, f.filename);
    } catch (e) {
      setError(downloadErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
        {busy ? 'Preparing…' : label}
      </button>
      <div className="form-error" role="alert" aria-live="assertive">{error}</div>
    </>
  );
}
