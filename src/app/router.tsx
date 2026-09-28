import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * A minimal history router.
 *
 * Kansei has four top-level sections and a handful of detail views, so a routing
 * library would be more dependency than the app needs. What this must get right
 * is the offline case: the service worker serves the app shell for any in-scope
 * navigation, and the History API keeps deep links working without a server that
 * knows the routes.
 *
 * Routes are flat and explicit rather than pattern-matched, which keeps the
 * whole navigable surface visible in one place.
 */

export type Section = 'practice' | 'characters' | 'progress' | 'settings' | 'about';

export interface Route {
  section: Section;
  /** Path segments after the section, e.g. ['hiragana'] or ['kanji', '日']. */
  rest: string[];
  /** Parsed query string. */
  query: URLSearchParams;
  /** The full path, for keys and comparisons. */
  path: string;
}

interface RouterValue {
  route: Route;
  navigate: (path: string, opts?: { replace?: boolean }) => void;
  back: () => void;
  /** True when there is somewhere to go back to within the app. */
  canGoBack: boolean;
}

const RouterContext = createContext<RouterValue | null>(null);

const SECTIONS: Section[] = ['practice', 'characters', 'progress', 'settings', 'about'];

export function parseRoute(url: string): Route {
  const parsed = new URL(url, window.location.origin);
  // The app may be served from a sub-path; BASE_URL is injected by Vite.
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const pathname = parsed.pathname.startsWith(base) ? parsed.pathname.slice(base.length) : parsed.pathname;
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const head = segments[0];
  const section: Section = SECTIONS.includes(head as Section) ? (head as Section) : 'practice';
  return {
    section,
    rest: segments.slice(1),
    query: parsed.searchParams,
    path: pathname || '/',
  };
}

export function href(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.href));
  const [depth, setDepth] = useState(0);

  useEffect(() => {
    const onPop = () => {
      setRoute(parseRoute(window.location.href));
      setDepth((d) => Math.max(0, d - 1));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((path: string, opts?: { replace?: boolean }) => {
    const target = href(path);
    if (opts?.replace) {
      window.history.replaceState(null, '', target);
    } else {
      window.history.pushState(null, '', target);
      setDepth((d) => d + 1);
    }
    setRoute(parseRoute(window.location.href));
    // A route change is a new view: move focus to the main region so keyboard
    // and screen-reader users are not left at the bottom of the previous page.
    requestAnimationFrame(() => {
      document.getElementById('main')?.focus();
    });
  }, []);

  const back = useCallback(() => window.history.back(), []);

  const value = useMemo(() => ({ route, navigate, back, canGoBack: depth > 0 }), [route, navigate, back, depth]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider');
  return ctx;
}

/**
 * An in-app link. Renders a real anchor so middle-click, copy-link and the
 * browser's own affordances keep working, and intercepts the plain-click case.
 */
export function Link({
  to,
  children,
  replace,
  ...rest
}: { to: string; children: ReactNode; replace?: boolean } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  const { navigate } = useRouter();
  return (
    <a
      href={href(to)}
      onClick={(e) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
