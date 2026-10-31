import { ContextExplorer } from '@context-atlas/viewer';
import '@context-atlas/viewer/styles.css';
import type { ProjectDetail } from '../types';
import { buildProjectSnapshot } from './context-atlas';

interface Props {
  detail: ProjectDetail;
}

/** Renders a local, read-only projection of one already-scoped project room response. */
export default function ProjectContextAtlas({ detail }: Props) {
  try {
    const snapshot = buildProjectSnapshot(detail);
    return (
      <section className="room-context-atlas" aria-label="Visual project context">
        <ContextExplorer
          snapshot={snapshot}
          allowedSourceIds={snapshot.sources.map((source) => source.id)}
        />
      </section>
    );
  } catch {
    return (
      <section className="room-context-atlas-error" role="alert" aria-label="Visual project context">
        <h2>Context map unavailable</h2>
        <p>The selected project room could not be converted into a valid snapshot. Refresh the room and try again.</p>
      </section>
    );
  }
}
