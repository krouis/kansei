import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ThemePreference } from '@/domain';

/**
 * Theme and motion preferences.
 *
 * Three states, not two: 'system' stamps nothing on the root element and lets
 * the CSS media query decide, while 'light'/'dark' stamp `data-theme` so the
 * learner's explicit choice wins in both directions. The tokens file mirrors
 * this, which is why a chosen light theme still looks light on a dark system.
 *
 * Motion is handled the same way: 'system' defers to prefers-reduced-motion,
 * and an explicit choice stamps `data-motion`.
 */

export type MotionPreference = 'system' | 'always' | 'never';

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
  /** What is actually being rendered right now. */
  resolved: 'light' | 'dark';
  motion: MotionPreference;
  setMotion: (m: MotionPreference) => void;
  /** True when animations should be suppressed. */
  reducedMotion: boolean;
  /** Japanese type scale multiplier. */
  jpScale: number;
  setJpScale: (n: number) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export interface ThemeProviderProps {
  children: ReactNode;
  theme: ThemePreference;
  motion: MotionPreference;
  jpScale: number;
  /** Persisted by the settings store; the provider only reflects and reports. */
  onChange: (next: { theme?: ThemePreference; motion?: MotionPreference; jpScale?: number }) => void;
}

export function ThemeProvider({ children, theme, motion, jpScale, onChange }: ThemeProviderProps) {
  const [systemDark, setSystemDark] = useState(prefersDark);
  const [systemReduced, setSystemReduced] = useState(prefersReducedMotion);

  // Follow the system while the preference is 'system'. The listeners stay
  // attached regardless so switching back to 'system' is immediately correct.
  useEffect(() => {
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onDark = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    const onReduced = (e: MediaQueryListEvent) => setSystemReduced(e.matches);
    dark.addEventListener('change', onDark);
    reduced.addEventListener('change', onReduced);
    return () => {
      dark.removeEventListener('change', onDark);
      reduced.removeEventListener('change', onReduced);
    };
  }, []);

  const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  const reducedMotion = motion === 'system' ? systemReduced : motion === 'never';

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (motion === 'system') root.removeAttribute('data-motion');
    else root.setAttribute('data-motion', motion === 'never' ? 'reduce' : 'allow');
  }, [motion]);

  useEffect(() => {
    document.documentElement.style.setProperty('--jp-scale', String(jpScale));
  }, [jpScale]);

  // Keep the OS chrome (address bar, task switcher) in step with the theme.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
    if (!meta) return;
    const styles = getComputedStyle(document.documentElement);
    meta.content = styles.getPropertyValue('--paper').trim() || (resolved === 'dark' ? '#14161a' : '#fbf9f4');
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: (t) => onChange({ theme: t }),
      resolved,
      motion,
      setMotion: (m) => onChange({ motion: m }),
      reducedMotion,
      jpScale,
      setJpScale: (n) => onChange({ jpScale: n }),
    }),
    [theme, resolved, motion, reducedMotion, jpScale, onChange],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/** Convenience for components that only need to know whether to animate. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const attr = root.getAttribute('data-motion');
      if (attr === 'reduce') return true;
      if (attr === 'allow') return false;
      return prefersReducedMotion();
    };
    setReduced(read());
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(read());
    mq.addEventListener('change', onChange);
    const observer = new MutationObserver(onChange);
    observer.observe(root, { attributes: true, attributeFilter: ['data-motion'] });
    return () => {
      mq.removeEventListener('change', onChange);
      observer.disconnect();
    };
  }, []);
  const ctx = useContext(ThemeContext);
  return ctx ? ctx.reducedMotion : reduced;
}
