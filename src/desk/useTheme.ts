import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'ac-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function stored(): ThemePref {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** The operator's theme choice, shared with the classic view, and whether it resolves to dark. */
export function useTheme() {
  const [theme, setTheme] = useState<ThemePref>(stored);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const dark = theme === 'system' ? systemDark : theme === 'dark';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable: the choice lasts this page */ }
  }, [theme, dark]);

  return { theme, setTheme, dark };
}
