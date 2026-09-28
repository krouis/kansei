/**
 * Navigation and action icons.
 *
 * Hand-drawn 24-grid stroke icons rather than an icon dependency: there are few
 * enough that a package would cost more than it saves, and drawing them here
 * keeps the weight and corner radius consistent with the type.
 *
 * Every icon is decorative. The label beside it carries the meaning, so each is
 * marked aria-hidden and no icon is ever the only indicator of anything.
 */
import type { SVGProps } from 'react';

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...props,
});

/** A brush — practice. */
export const IconPractice = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M15.5 3.8 20.2 8.5" />
    <path d="M17.9 6.2 8.6 15.5a3 3 0 0 0-.8 1.4l-.7 2.6 2.6-.7a3 3 0 0 0 1.4-.8l9.3-9.3a1.7 1.7 0 0 0 0-2.4l-.5-.5a1.7 1.7 0 0 0-2.4 0Z" />
    <path d="M6.6 17.4c-1.3.4-2.3 1.3-2.8 2.8 1.6-.4 2.6-1.2 2.8-2.8Z" />
  </svg>
);

/** A grid — the character explorer. */
export const IconCharacters = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
  </svg>
);

/** A column chart — progress. */
export const IconProgress = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3.5 20.5h17" />
    <path d="M7 20.5v-6" />
    <path d="M12 20.5V7" />
    <path d="M17 20.5v-9.5" />
  </svg>
);

/** Sliders — settings. */
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7h10" /><circle cx="17" cy="7" r="2.4" />
    <path d="M20 17H10" /><circle cx="7" cy="17" r="2.4" />
  </svg>
);

/** An open book — about & science. */
export const IconAbout = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 6.8C10.6 5.6 8.6 5 6 5H3.8v13H6c2.6 0 4.6.6 6 1.8" />
    <path d="M12 6.8C13.4 5.6 15.4 5 18 5h2.2v13H18c-2.6 0-4.6.6-6 1.8" />
    <path d="M12 6.8v13" />
  </svg>
);

export const IconChevronLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14.5 5.5 8 12l6.5 6.5" /></svg>
);
export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9.5 5.5 16 12l-6.5 6.5" /></svg>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
);
/** A speaker — audio playback. Never used alone; always has a text label. */
export const IconSound = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3L11.5 6v12L7 14.5H4Z" />
    <path d="M15 9.2a4 4 0 0 1 0 5.6" />
    <path d="M17.6 6.6a7.5 7.5 0 0 1 0 10.8" />
  </svg>
);
export const IconReplay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" />
    <path d="M4 3.5V7h3.5" />
  </svg>
);
export const IconUndo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 5.5 4 9.5l4 4" />
    <path d="M4 9.5h9a6 6 0 0 1 0 12h-4" />
  </svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4.5 12.5 9.5 17.5 19.5 6.5" /></svg>
);
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3.5v11" /><path d="M7.5 10 12 14.5 16.5 10" /><path d="M4.5 19.5h15" />
  </svg>
);
export const IconWrite = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 20h16" />
    <path d="M7 16.5 16.6 6.9a1.9 1.9 0 0 1 2.7 0l.3.3a1.9 1.9 0 0 1 0 2.7L10 19.5H6.5Z" />
  </svg>
);
