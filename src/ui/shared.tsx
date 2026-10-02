import { domAnimation, LazyMotion, m, MotionConfig } from 'framer-motion';
import { type ReactNode, useState } from 'react';

export const PRODUCT_NAME = 'Just Upload';

/**
 * Motion for the extension pages: only the animation features they use are loaded, and
 * every animation respects the system's reduce-motion setting.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" aria-hidden="true">
      <rect width="128" height="128" rx="30" fill="#a2ed76" />
      <path
        d="M56 96V32M32 55l24-24 24 24"
        stroke="#0e3a26"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="92" cy="92" r="22" fill="#0e3a26" />
      <path
        d="m82 92 7 7 13-14"
        stroke="#a2ed76"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="wordmark">
      <Logo size={size} />
      <span>{PRODUCT_NAME}</span>
    </span>
  );
}

let sealCount = 0;
/**
 * The stamp a file gets when a website will take it: green ink, slightly uneven. Two
 * lines on two arcs, so both read upright: one over the top, one under the bottom.
 */
export function Seal({
  top = 'ACCEPTED',
  bottom = 'READY TO UPLOAD',
}: {
  top?: string;
  bottom?: string;
}) {
  const [id] = useState(() => `seal-${++sealCount}`);
  return (
    <svg className="seal" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <path id={`${id}-top`} d="M18.5 60a41.5 41.5 0 0 1 83 0" />
        <path id={`${id}-bottom`} d="M11.3 60a48.7 48.7 0 0 0 97.4 0" />
        <filter id={`${id}-ink`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="2.4" />
        </filter>
      </defs>
      <g filter={`url(#${id}-ink)`}>
        <circle cx="60" cy="60" r="56" className="seal-line" />
        <circle cx="60" cy="60" r="34" className="seal-line thin" />
        <text className="seal-text">
          <textPath href={`#${id}-top`} startOffset="50%">
            {top}
          </textPath>
        </text>
        <text className="seal-text under">
          <textPath href={`#${id}-bottom`} startOffset="50%">
            {bottom}
          </textPath>
        </text>
        <circle cx="15" cy="60" r="2.2" className="seal-dot" />
        <circle cx="105" cy="60" r="2.2" className="seal-dot" />
        <path d="m46 61 9.5 9.5L75 50.5" className="seal-check" />
      </g>
    </svg>
  );
}

const ICONS = {
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.6 7.6 0 0 1-1.9 1.1L14.9 21h-3.8l-.3-2.5a7.6 7.6 0 0 1-1.9-1.1l-1.9.7-2-3.4 1.6-1.2a7.5 7.5 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7.6 7.6 0 0 1 1.9-1.1L11.1 3h3.8l.3 2.5a7.6 7.6 0 0 1 1.9 1.1l1.9-.7 2 3.4-1.6 1.2a7.5 7.5 0 0 1 0 3Z',
  lock: 'M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5M6 10.5h12a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1Z',
  globe:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.5 9h17M3.5 15h17M12 3c2.2 2.4 3.4 5.5 3.4 9S14.2 18.6 12 21c-2.2-2.4-3.4-5.5-3.4-9S9.8 5.4 12 3Z',
  arrow: 'M4 12h15M14 7l5 5-5 5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  shield:
    'M12 3.5 5 6.4v5.3c0 4.2 2.9 7.6 7 8.8 4.1-1.2 7-4.6 7-8.8V6.4L12 3.5ZM9 12l2.2 2.2L15.5 10',
  bolt: 'M13 3 5.5 13.5H12L11 21l7.5-10.5H12L13 3Z',
  upload: 'M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14',
  download: 'M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14',
  copy: 'M9 9h10v11H9zM15 9V4H5v11h4',
  pin: 'M15 4.5 19.5 9M9.6 14.4 5 19M14 5.5l4.5 4.5-3 2-1 4-7-7 4-1 2.5-2.5Z',
  puzzle:
    'M10 4.5a1.8 1.8 0 0 1 3.6 0V6H17a1 1 0 0 1 1 1v3.4h1.5a1.8 1.8 0 0 1 0 3.6H18V18a1 1 0 0 1-1 1h-3.4v-1.5a1.8 1.8 0 0 0-3.6 0V19H6a1 1 0 0 1-1-1v-3.9h1.5a1.8 1.8 0 0 0 0-3.6H5V7a1 1 0 0 1 1-1h4V4.5Z',
} as const;

export type IconName = keyof typeof ICONS;

/** A small, consistent line icon set, drawn for this product. */
export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={ICONS[name]}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 16 10" fill="none" aria-hidden="true">
      <path
        d="M1 5h13M10 1.5 14 5l-4 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "HEIC 3.1 MB": a file's format and size, the way the in-page note shows them. */
export function FileTag({
  name,
  size,
  tone,
}: {
  name: string;
  size?: string;
  tone?: 'after' | 'refused';
}) {
  return (
    <span className={tone ? `tag ${tone}` : 'tag'}>
      <b>{name}</b>
      {size && <span>{size}</span>}
    </span>
  );
}

const KNOB = { type: 'spring', stiffness: 640, damping: 36, mass: 0.7 } as const;

/** An on/off switch whose knob springs across. */
export function Toggle({
  checked,
  onChange,
  label,
  large = false,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  large?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={large ? 'switch large' : 'switch'}
      disabled={disabled}
      onClick={onChange}
    >
      <m.span
        className="knob"
        initial={false}
        animate={{ x: checked ? (large ? 20 : 16) : 0 }}
        transition={KNOB}
      />
    </button>
  );
}

/** A whole settings row that toggles, with the switch at its end. */
export function Switch({
  checked,
  onChange,
  title,
  detail,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  title: ReactNode;
  detail?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="row switch-row"
      disabled={disabled}
      onClick={onChange}
    >
      <span className="row-text">
        <span className="row-title">{title}</span>
        {detail && <span className="row-detail">{detail}</span>}
      </span>
      <span className="switch" data-on={checked || undefined} aria-hidden="true">
        <m.span
          className="knob"
          initial={false}
          animate={{ x: checked ? 16 : 0 }}
          transition={KNOB}
        />
      </span>
    </button>
  );
}

export function LocalNote({
  children = 'Files never leave this computer.',
}: {
  children?: ReactNode;
}) {
  return (
    <p className="local-note">
      <Icon name="lock" size={13} />
      <span>{children}</span>
    </p>
  );
}
