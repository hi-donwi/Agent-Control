import type { ReactNode } from 'react';

/** Line icons on a 24px grid, drawn with the current text color. */
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const MenuIcon = () => (
  <Icon><path d="M4 7h16M4 12h16M4 17h10" /></Icon>
);

/** A speech bubble with a spark: the assistant. */
export const AssistantIcon = () => (
  <Icon>
    <path d="M20 12.5a7.5 7.5 0 0 1-11.2 6.5L4 20l1.1-4.2A7.5 7.5 0 1 1 20 12.5Z" />
    <path d="M12.5 9v4M10.5 11h4" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon><path d="M6 6l12 12M18 6L6 18" /></Icon>
);

export const BackIcon = () => (
  <Icon><path d="M15 6l-6 6 6 6" /></Icon>
);

export const ChevronIcon = () => (
  <Icon size={16}><path d="M9 6l6 6-6 6" /></Icon>
);

export const NewChatIcon = () => (
  <Icon><path d="M12 5v14M5 12h14" /></Icon>
);

/** A clock with a turning-back arrow: earlier conversations. */
export const HistoryIcon = () => (
  <Icon>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3.5 4v4h4" />
    <path d="M12 8v4l3 2" />
  </Icon>
);

/** A sun with radiating rays: switch to light mode. */
export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </Icon>
);

/** A crescent moon: switch to dark mode. */
export const MoonIcon = () => (
  <Icon>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </Icon>
);

