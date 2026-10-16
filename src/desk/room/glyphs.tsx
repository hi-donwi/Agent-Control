import type { ReactNode } from 'react';
import type { StationId } from './stations';

/** A small line drawing per station, in the floor's style. */
export function StationGlyph({ id }: { id: StationId }) {
  const paths: Record<StationId, ReactNode> = {
    queue: <><rect x="4" y="5" width="16" height="4" rx="1.5" /><rect x="4" y="11" width="16" height="4" rx="1.5" /><rect x="4" y="17" width="10" height="3" rx="1.5" /></>,
    ready: <><path d="M4 12h11" /><path d="M11 7l5 5-5 5" /><path d="M19 5v14" /></>,
    hands: <><rect x="6" y="7" width="12" height="9" rx="3.5" /><path d="M12 7V4" /><circle cx="10" cy="11.5" r="0.8" /><circle cx="14" cy="11.5" r="0.8" /><path d="M8 20h8" /></>,
    review: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    shipped: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12.5l3 3 5-6" /></>,
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[id]}
    </svg>
  );
}

/** A raised hand: something on this card waits for a person. */
export function HandGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11" /><path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V11" /><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L4 14.5a1.5 1.5 0 0 1 2.3-1.9L8 14.5" />
    </svg>
  );
}
