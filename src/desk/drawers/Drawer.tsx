import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  label: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A right-hand drawer. Non-modal on wide screens - the floor stays usable, so clicking
 * another agent re-targets the open drawer - and full width on narrow ones. Escape
 * closes it; focus moves in on open and back to where it came from on close.
 */
export function Drawer({ label, wide = false, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  return (
    <div ref={ref} className={`drawer${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="false" aria-label={label} tabIndex={-1}>
      {children}
    </div>
  );
}
