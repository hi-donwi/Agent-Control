import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { parseDiff, type FileDiff } from '../diff';

interface DiffResponse {
  diff: string;
  truncated: boolean;
}

/**
 * The coding session's changes so far, read from its worktree. It reloads when `version`
 * changes - the drawer bumps it after every agent turn and after a ship - and on demand.
 */
export function ChangesView({ project, version }: { project: string; version: number | string }) {
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiFetch<DiffResponse>(`coding-sessions/${encodeURIComponent(project)}/diff`)
      .then((data) => { setFiles(parseDiff(data.diff)); setTruncated(data.truncated); setError(''); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [project]);

  useEffect(load, [load, version]);

  if (error) return <p className="changes-note" role="alert">[ERROR] {error}</p>;
  if (!files) return <p className="changes-note" role="status">Reading the worktree...</p>;

  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return (
    <div className="changes" aria-label="Changes in the coding session">
      <div className="changes-head">
        <span>
          {files.length === 0 ? 'No changes yet.' : `${files.length} ${files.length === 1 ? 'file' : 'files'}`}
          {files.length > 0 && <> · <span className="diff-add">+{added}</span> <span className="diff-del">-{removed}</span></>}
        </span>
        <button type="button" className="btn" onClick={load}>Refresh</button>
      </div>
      {truncated && <p className="changes-note">[WARN] The diff is long; only its start is shown.</p>}
      {files.map((file, index) => (
        <details key={file.path} className="changes-file" open={index < 3}>
          <summary>
            <span className={`changes-status is-${file.status}`}>{file.status}</span>
            <span className="changes-path">{file.path}</span>
            <span className="diff-add">+{file.added}</span>
            <span className="diff-del">-{file.removed}</span>
          </summary>
          <pre className="changes-lines">
            {file.lines.map((line, i) => (
              <span key={i} className={`diff-line is-${line.kind}`}>
                {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'ctx' ? ' ' : ''}{line.text}{'\n'}
              </span>
            ))}
          </pre>
        </details>
      ))}
    </div>
  );
}
