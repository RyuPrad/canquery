/* eslint-disable react-refresh/only-export-components -- provider + hook belong together */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const DARK = 'canquery';
const LIGHT = 'canquery-light';
const STORAGE_KEY = 'cq-theme';

function currentTheme() {
  if (typeof document !== 'undefined') {
    const t = document.documentElement.dataset.theme;
    if (t === DARK || t === LIGHT) return t;
  }
  return DARK;
}

function apply(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === LIGHT ? '#f4f7fc' : '#0a0e16');
}

const ThemeContext = createContext({ theme: DARK, dark: true, setTheme: () => {}, toggle: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(currentTheme);

  const setTheme = useCallback((next) => {
    const value = next === LIGHT ? LIGHT : DARK;
    apply(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* ignore */ }
    setThemeState(value);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === DARK ? LIGHT : DARK;
      apply(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // If the user has not chosen a theme, follow live OS changes.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e) => {
      let stored = null;
      try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* ignore */ }
      if (stored !== DARK && stored !== LIGHT) {
        const next = e.matches ? LIGHT : DARK;
        apply(next);
        setThemeState(next);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, dark: theme === DARK, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
