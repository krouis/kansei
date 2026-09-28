import type { ReactNode } from 'react';
import { Link, useRouter } from './router';
import type { Section } from './router';
import {
  IconAbout, IconCharacters, IconPractice, IconProgress, IconSettings,
} from './icons';
import { ProgressRing } from '@/ui/primitives';
import { cx } from '@/ui/primitives';
import s from './shell.module.css';

/**
 * The application shell.
 *
 * Navigation is the same four sections everywhere; only the arrangement changes.
 * About & Science is a fifth destination, reachable from the rail at tablet size
 * and up and from the header on a phone, so it is one tap away rather than
 * buried in Settings — the brief asks for it to be easily discoverable and a
 * settings sub-page would not be.
 */

interface NavItem {
  section: Section;
  path: string;
  label: string;
  Icon: typeof IconPractice;
}

const PRIMARY: NavItem[] = [
  { section: 'practice', path: '/practice', label: 'Practice', Icon: IconPractice },
  { section: 'characters', path: '/characters', label: 'Characters', Icon: IconCharacters },
  { section: 'progress', path: '/progress', label: 'Progress', Icon: IconProgress },
  { section: 'settings', path: '/settings', label: 'Settings', Icon: IconSettings },
];

const ABOUT: NavItem = { section: 'about', path: '/about', label: 'About & Science', Icon: IconAbout };

export interface ShellProps {
  children: ReactNode;
  /** Section title shown in the header on phones. */
  title: string;
  /** Today's XP and the goal in force today. */
  xp: { today: number; goal: number };
  /** Reviews waiting, used for the Practice badge. */
  dueCount: number;
  /** True when the app is running without a network connection. */
  offline: boolean;
  /** Set when a new version is installed and waiting. */
  update?: { available: boolean; apply: () => void };
  /** Practice takes the full viewport; other sections get the measured column. */
  full?: boolean;
  /** Rendered in the header, e.g. a search field or a back button. */
  headerActions?: ReactNode;
}

export function Shell({
  children, title, xp, dueCount, offline, update, full, headerActions,
}: ShellProps) {
  const { route } = useRouter();
  const goalMet = xp.goal > 0 && xp.today >= xp.goal;

  const dueLabel = dueCount > 0 ? `Practice, ${dueCount} review${dueCount === 1 ? '' : 's'} due` : 'Practice';

  return (
    <div className={s.shell}>
      <a className="sr-only sr-only-focusable" href="#main">Skip to main content</a>

      {/* Side rail: tablet and desktop. */}
      <nav className={s.rail} aria-label="Sections">
        <Link to="/practice" className={s.railBrand}>
          <span className={s.seal} aria-hidden="true">感</span>
          <span>
            <span className={s.brandName} style={{ display: 'block' }}>Kansei</span>
            <span className={s.brandSub} lang="ja">かんせい</span>
          </span>
        </Link>

        {PRIMARY.map(({ section, path, label, Icon }) => {
          const current = route.section === section;
          return (
            <Link
              key={section}
              to={path}
              className={cx(s.railLink, current && s.railCurrent)}
              aria-current={current ? 'page' : undefined}
              aria-label={section === 'practice' ? dueLabel : undefined}
            >
              <Icon />
              <span className={s.railLabel}>{label}</span>
              {section === 'practice' && dueCount > 0 ? (
                <span className={s.railCount} aria-hidden="true">{dueCount > 99 ? '99+' : dueCount}</span>
              ) : null}
            </Link>
          );
        })}

        <span className={s.railSpacer} />
        <hr className={cx('rule', s.railRule)} />
        <Link
          to={ABOUT.path}
          className={cx(s.railLink, route.section === 'about' && s.railCurrent)}
          aria-current={route.section === 'about' ? 'page' : undefined}
        >
          <ABOUT.Icon />
          <span className={s.railLabel}>{ABOUT.label}</span>
        </Link>
      </nav>

      <header className={s.header}>
        <div className={cx(s.brand, s.headerBrand)}>
          <span className={s.seal} aria-hidden="true">感</span>
        </div>
        <h1 className={s.headerTitle}>{title}</h1>
        <span className={s.headerSpacer} />
        <div className={s.headerActions}>
          {headerActions}
          <Link
            to="/progress"
            className={s.xpBadge}
            aria-label={`${xp.today} of ${xp.goal} XP today${goalMet ? ', goal met' : ''}. View progress.`}
          >
            <ProgressRing
              value={xp.today}
              max={xp.goal}
              size={26}
              thickness={3}
              met={goalMet}
              label=""
            />
            <span className={s.xpValue}>
              {xp.today}
              <span className={s.xpGoal}>{` / ${xp.goal}`}</span>
            </span>
          </Link>
          {/* On a phone the rail is hidden, so About needs a header entry. */}
          <Link
            to={ABOUT.path}
            className={cx(s.iconButton, s.headerBrand)}
            aria-label="About & Science"
            title="About & Science"
          >
            <ABOUT.Icon />
          </Link>
        </div>
      </header>

      {offline ? (
        <div className={cx(s.banner, s.bannerInfo)} role="status">
          <span aria-hidden="true">◌</span>
          <span>Offline — everything installed still works.</span>
        </div>
      ) : null}

      {update?.available ? (
        <div className={s.banner} role="status">
          <span aria-hidden="true">↑</span>
          <span className={s.bannerSpacer}>A new version is ready. It will not interrupt your session.</span>
          <button type="button" className={s.iconButton} onClick={update.apply} aria-label="Reload to update now">
            Reload
          </button>
        </div>
      ) : null}

      {/* tabIndex -1 lets the router move focus here on navigation. */}
      <main id="main" className={cx(s.main, full && s.mainFull)} tabIndex={-1}>
        <div className={s.mainInner}>{children}</div>
      </main>

      {/* Bottom tab bar: phone. */}
      <nav className={s.tabBar} aria-label="Sections">
        {PRIMARY.map(({ section, path, label, Icon }) => {
          const current = route.section === section;
          return (
            <Link
              key={section}
              to={path}
              className={cx(s.tab, current && s.tabCurrent)}
              aria-current={current ? 'page' : undefined}
              aria-label={section === 'practice' ? dueLabel : undefined}
            >
              <span className={s.tabIcon}>
                <Icon />
                {section === 'practice' && dueCount > 0 ? <span className={s.tabDot} aria-hidden="true" /> : null}
              </span>
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
