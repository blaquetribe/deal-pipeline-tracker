export type IconName =
  | 'work'
  | 'pipeline'
  | 'team'
  | 'approval'
  | 'settings'
  | 'bell'
  | 'sun'
  | 'moon'
  | 'camera'
  | 'logout'
  | 'chevron'
  | 'remove'
  | 'plus'
  | 'close'
  | 'drag';

const paths: Record<IconName, ReactNode> = {
  work: (
    <>
      <rect x="3.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="14" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  pipeline: (
    <>
      <rect x="3.5" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="16" rx="1.5" />
      <rect x="16.5" y="4" width="4" height="16" rx="1.5" />
    </>
  ),
  team: (
    <>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M17 11a4 4 0 0 0 0-8M21 20v-1.5a4 4 0 0 0-3-3.87" />
    </>
  ),
  approval: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16.5 9" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path
        d="m19.4 15 .1.1 1.1.9-1.1 1.9-1.3-.5a7.8 7.8 0 0 1-1.5.9l-.2 1.4h-2.2l-.3-1.4a7.8 7.8 0 0 1-1.5-.9l-1.3.5-1.1-1.9 1.1-.9a7.7 7.7 0 0 1 0-1.8l-1.1-.9 1.1-1.9 1.3.5a7.8 7.8 0 0 1 1.5-.9l.3-1.4h2.2l.2 1.4a7.8 7.8 0 0 1 1.5.9l1.3-.5 1.1 1.9-1.1.9a7.7 7.7 0 0 1 0 1.8Z"
        transform="translate(-1 -1) scale(1.08)"
      />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
    </>
  ),
  moon: <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z" />,
  camera: (
    <>
      <path d="M14 4h-4L8.5 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5L14 4Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  logout: (
    <>
      <path d="M10 17l5-5-5-5M15 12H3" />
      <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
    </>
  ),
  chevron: <path d="m7 10 5 5 5-5" />,
  remove: <path d="m6 6 12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  drag: (
    <>
      <circle cx="9" cy="6" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="18" r="1" />
    </>
  ),
};

export function Icon({
  name,
  className,
}: {
  readonly name: IconName;
  readonly className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}
import type { ReactNode } from 'react';
