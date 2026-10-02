import { AnimatePresence, m, useInView, useReducedMotion } from 'framer-motion';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import {
  Icon,
  Logo,
  MotionRoot,
  PRIVACY_POLICY_URL,
  PRODUCT_NAME,
  Seal,
  Wordmark,
} from '../../src/ui/shared';
import { Lab } from './lab';
import { Walkthrough } from './walkthrough';
import '../../src/ui/pages.css';
import './onboarding.css';

// The welcome page, written as the product's home page: what it does, its top features,
// a live demonstration, a place to try it, and what it never does with your files.
// Every figure on it was measured with the extension itself.

const EASE = [0.22, 1, 0.36, 1] as const;

/** Sections rise into place once, as they scroll into view. */
function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </m.div>
  );
}

/** Runs `tick` every `ms` while `active`; nothing animates off screen. */
function useTicker(ms: number, active: boolean, count: number): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setIndex((at) => (at + 1) % count), ms);
    return () => clearInterval(timer);
  }, [ms, active, count]);
  return index;
}

function Check({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m3.5 8.5 3 3 6-7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg className="arrow-right" width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">
      <path
        d="M1 5h15M12 1l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------------------------ */
/* Hero: a refused file, a copy that fits, and the stamp.                               */

interface Scene {
  tab: string;
  kind: 'photo' | 'screenshot' | 'pdf' | 'sheet';
  site: string;
  rule: string;
  before: { name: string; detail: string };
  after: { name: string; detail: string };
  note: string;
}

/** Measured with the extension: each result keeps its full pixel size. */
const SCENES: Scene[] = [
  {
    tab: 'WebP',
    kind: 'photo',
    site: 'careers.example.com',
    rule: 'Profile photo · JPG or PNG · max 2 MB',
    before: { name: 'vacation.webp', detail: 'WebP · 2.7 MB' },
    after: { name: 'vacation.jpg', detail: 'JPG · 1.9 MB' },
    note: '97% quality kept · full size · 0.6 s',
  },
  {
    tab: 'PNG',
    kind: 'screenshot',
    site: 'help.example.com',
    rule: 'Attachment · up to 1 MB',
    before: { name: 'Screenshot.png', detail: 'PNG · 2.3 MB' },
    after: { name: 'Screenshot.jpg', detail: 'JPG · 781 KB' },
    note: '99% quality kept · full size · 0.1 s',
  },
  {
    tab: 'PDF',
    kind: 'pdf',
    site: 'exams.example.gov',
    rule: 'Certificate · PDF · max 1 MB',
    before: { name: 'certificate.pdf', detail: 'PDF · 2 MB' },
    after: { name: 'certificate.pdf', detail: 'PDF · 957 KB' },
    note: '97% quality kept · text untouched',
  },
  {
    tab: 'Excel',
    kind: 'sheet',
    site: 'crm.example.com',
    rule: 'Import contacts · CSV files only',
    before: { name: 'contacts.xlsx', detail: 'Excel workbook' },
    after: { name: 'contacts.csv', detail: 'CSV file' },
    note: 'Every value kept · codes keep their zeros',
  },
];

const SHEET_ROWS = [
  ['Name', 'Code', 'Amount'],
  ['Zoë', '00123', '1,234.50'],
  ['Arjun', '04567', '99.00'],
  ['Mei', '00981', '412.75'],
  ['Omar', '01406', '58.20'],
];

/** What a file looks like inside its card. */
function Art({ kind }: { kind: Scene['kind'] }) {
  if (kind === 'photo') return <img src="/sample/sample.webp" alt="" draggable={false} />;
  if (kind === 'screenshot') return <img src="/sample/sample.png" alt="" draggable={false} />;
  if (kind === 'pdf')
    return (
      <span className="art-page">
        <b>Certificate of Completion</b>
        <i />
        <i />
        <i className="short" />
        <i />
        <i className="short" />
        <span className="art-signature" />
      </span>
    );
  return (
    <span className="art-grid">
      {SHEET_ROWS.map((row, y) =>
        row.map((cell, x) => (
          <span key={`${y}-${x}`} className={y === 0 ? 'head' : x > 0 ? 'num' : undefined}>
            {cell}
          </span>
        )),
      )}
    </span>
  );
}

function StampStage() {
  const reduced = useReducedMotion() ?? false;
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState(reduced ? 3 : 0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (reduced) {
      setPhase(3);
      return;
    }
    setPhase(0);
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1600),
      setTimeout(() => setPhase(3), 2500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [index, reduced]);
  useEffect(() => {
    if (reduced || paused || phase < 3) return;
    const timer = setTimeout(() => setIndex((at) => (at + 1) % SCENES.length), 3600);
    return () => clearTimeout(timer);
  }, [phase, paused, reduced]);
  const scene = SCENES[index]!;
  const done = phase >= 3;
  const file = done ? scene.after : scene.before;
  return (
    <div
      className="stamp-stage"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <m.p
          key={`rule-${index}`}
          className="stage-says"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          <span className="mono">{scene.site} says</span>
          <span className="display">“{scene.rule}”</span>
        </m.p>
      </AnimatePresence>
      <div
        className="desk"
        role="img"
        aria-label={`A ${scene.before.detail} file refused by a website, then accepted as ${scene.after.detail} after ${PRODUCT_NAME} prepares a copy.`}
      >
        <span className="ghost-card back" aria-hidden="true" />
        <span className="ghost-card mid" aria-hidden="true" />
        <AnimatePresence mode="wait" initial={false}>
          <m.figure
            key={index}
            className="file-card"
            data-kind={scene.kind}
            initial={{ opacity: 0, y: 26, rotate: -7, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, rotate: -2, scale: 1 }}
            exit={{ opacity: 0, y: -16, rotate: 3, scale: 0.96, transition: { duration: 0.28 } }}
            transition={{ type: 'spring', stiffness: 240, damping: 24 }}
          >
            <span className="file-art">
              <Art kind={scene.kind} />
              <AnimatePresence>
                {phase === 2 && (
                  <m.span
                    key="sweep"
                    className="file-sweep"
                    initial={{ y: '-110%' }}
                    animate={{ y: '110%' }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.9, ease: [0.45, 0, 0.55, 1] }}
                  />
                )}
              </AnimatePresence>
            </span>
            <figcaption>
              <AnimatePresence mode="wait" initial={false}>
                <m.span
                  key={done ? 'after' : 'before'}
                  className={done ? 'file-meta after' : 'file-meta'}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: EASE }}
                >
                  <b className="mono">{file.name}</b>
                  <span>{file.detail}</span>
                </m.span>
              </AnimatePresence>
            </figcaption>
            <AnimatePresence>
              {phase >= 1 && !done && (
                <m.span
                  key="refused"
                  className="refused-tag"
                  initial={{ opacity: 0, scale: 0.6, rotate: 12 }}
                  animate={{ opacity: 1, scale: 1, rotate: 6 }}
                  exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
                  transition={{ type: 'spring', stiffness: 520, damping: 20 }}
                >
                  ✕ Not accepted
                </m.span>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {done && (
                <m.span
                  key="seal"
                  className="seal-wrap"
                  initial={reduced ? false : { opacity: 0, scale: 1.9, rotate: -42 }}
                  animate={{ opacity: 1, scale: 1, rotate: -14 }}
                  transition={{ type: 'spring', stiffness: 560, damping: 21, mass: 0.9 }}
                >
                  <Seal />
                  {!reduced && (
                    <m.span
                      className="seal-ink"
                      initial={{ opacity: 0.45, scale: 0.7 }}
                      animate={{ opacity: 0, scale: 1.6 }}
                      transition={{ duration: 0.7, ease: 'easeOut', delay: 0.05 }}
                    />
                  )}
                </m.span>
              )}
            </AnimatePresence>
          </m.figure>
        </AnimatePresence>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <m.p
          key={done ? `note-${index}` : `wait-${phase}`}
          className={done ? 'stage-note done' : 'stage-note'}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          {done ? (
            <>
              <Check size={13} /> {scene.note}
            </>
          ) : phase === 2 ? (
            'Making a copy that fits, on this computer…'
          ) : (
            'The website refuses it.'
          )}
        </m.p>
      </AnimatePresence>
      <div className="stage-tabs" role="group" aria-label="Examples">
        {SCENES.map((item, at) => (
          <button
            key={item.tab}
            type="button"
            className={at === index ? 'stage-tab active' : 'stage-tab'}
            aria-pressed={at === index}
            onClick={() => setIndex(at)}
          >
            {item.tab}
          </button>
        ))}
        <span className="stage-more">and 12 more formats</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------ */
/* Top features, each with a small live picture.                                       */

const ROLL = ['HEIC', 'WebP', 'AVIF', 'TIFF', 'PNG', 'SVG', 'BMP', 'PDF'];

function AnyFormat() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { amount: 0.5 });
  const reduced = useReducedMotion() ?? false;
  const at = useTicker(1400, visible && !reduced, ROLL.length);
  return (
    <div ref={ref} className="viz viz-formats" aria-hidden="true">
      <span className="roll">
        <AnimatePresence mode="wait" initial={false}>
          <m.span
            key={ROLL[at]}
            className="format-pill"
            initial={{ y: 22, opacity: 0, filter: 'blur(4px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: -22, opacity: 0, filter: 'blur(4px)' }}
            transition={{ duration: 0.38, ease: EASE }}
          >
            {ROLL[at]}
          </m.span>
        </AnimatePresence>
      </span>
      <ArrowRight />
      <span className="format-pill accepted">
        JPG <Check />
      </span>
    </div>
  );
}

function FitsLimit() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { once: true, amount: 0.6 });
  const grow = (delay: number) => ({
    initial: { scaleX: 0 },
    animate: visible ? { scaleX: 1 } : {},
    transition: { duration: 1.1, ease: EASE, delay },
  });
  return (
    <div ref={ref} className="viz viz-size" aria-hidden="true">
      <div className="size-rows">
        <span className="size-limit">
          <span>Limit 2 MB</span>
        </span>
        <p className="size-row">
          <span className="size-label">Your photo</span>
          <span className="size-bar">
            <m.i className="over" {...grow(0.1)} />
          </span>
          <b>8.2 MB</b>
        </p>
        <p className="size-row">
          <span className="size-label">The site gets</span>
          <span className="size-bar">
            <m.i className="fits" {...grow(0.35)} />
          </span>
          <b className="ok">1.8 MB</b>
        </p>
      </div>
      <p className="viz-foot">Same 6000 × 4000 pixels · looks the same</p>
    </div>
  );
}

function MiniFile({ kind }: { kind: 'photo' | 'pdf' | 'sheet' | 'csv' }) {
  return (
    <span className="mini-file" data-kind={kind}>
      {kind === 'photo' && <img src="/sample/sample.webp" alt="" draggable={false} />}
      {kind === 'pdf' && (
        <>
          <i />
          <i />
          <i className="short" />
          <b>PDF</b>
        </>
      )}
      {kind === 'sheet' && <span className="mini-grid" />}
      {kind === 'csv' && (
        <>
          <i />
          <i className="short" />
          <i />
          <b>CSV</b>
        </>
      )}
    </span>
  );
}

function Documents() {
  const rows = [
    ['photo', 'pdf', 'Photo to PDF'],
    ['pdf', 'photo', 'PDF to JPG'],
    ['sheet', 'csv', 'Excel to CSV'],
  ] as const;
  return (
    <div className="viz viz-docs" aria-hidden="true">
      {rows.map(([from, to, label], at) => (
        <m.p
          key={label}
          className="doc-row"
          initial={{ opacity: 0, x: -10 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ duration: 0.5, ease: EASE, delay: at * 0.12 }}
        >
          <MiniFile kind={from} />
          <ArrowRight />
          <MiniFile kind={to} />
          <span>{label}</span>
        </m.p>
      ))}
    </div>
  );
}

const PHRASES = [
  { before: 'File size should ', key: 'not exceed 500KB', after: '', reads: 'max 500 KB' },
  { before: 'Image ', key: 'upto 2MB', after: '', reads: 'max 2 MB' },
  { before: 'Photo size should be ', key: 'between 20 KB and 50 KB', after: '', reads: '20–50 KB' },
  { before: '', key: 'JPG only', after: ', no PNG', reads: 'JPG' },
];

function ReadsRules() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { amount: 0.5 });
  const reduced = useReducedMotion() ?? false;
  const at = useTicker(2600, visible && !reduced, PHRASES.length);
  const phrase = PHRASES[at]!;
  return (
    <div ref={ref} className="viz viz-rules" aria-hidden="true">
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={at}
          className="rule-card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          <p className="rule-quote display">
            “{phrase.before}
            <span className="marked">
              <m.i
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.35 }}
              />
              <span>{phrase.key}</span>
            </span>
            {phrase.after}”
          </p>
          <m.p
            className="rule-reads"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.8 }}
          >
            <span>{PRODUCT_NAME} reads</span>
            <b>{phrase.reads}</b>
          </m.p>
        </m.div>
      </AnimatePresence>
    </div>
  );
}

function AsksFirst() {
  return (
    <div className="viz viz-asks" aria-hidden="true">
      <div className="mini-dialog">
        <p className="mini-dialog-brand">
          <Logo size={14} /> {PRODUCT_NAME}
        </p>
        <p className="mini-dialog-title">This site needs a square photo</p>
        <span className="mini-crop">
          <img src="/sample/sample.webp" alt="" draggable={false} />
          <m.span
            className="mini-crop-frame"
            initial={{ x: -18 }}
            whileInView={{ x: 18 }}
            viewport={{ amount: 0.8 }}
            transition={{
              duration: 2.4,
              ease: 'easeInOut',
              repeat: Infinity,
              repeatType: 'mirror',
            }}
          />
        </span>
        <span className="mini-dialog-actions">
          <span>Use original</span>
          <span className="primary">Use this crop</span>
        </span>
      </div>
    </div>
  );
}

function Private() {
  return (
    <div className="viz viz-private" aria-hidden="true">
      <span className="private-seal">
        <Seal top="ON YOUR COMPUTER" bottom="NOTHING SENT TO US" />
        <span className="private-lock">
          <Icon name="lock" size={22} />
        </span>
      </span>
      <ul className="zeros">
        <li>
          <b className="display">0</b> servers
        </li>
        <li>
          <b className="display">0</b> accounts
        </li>
        <li>
          <b className="display">0</b> tracking
        </li>
      </ul>
    </div>
  );
}

const FEATURES: { title: string; text: string; visual: ReactNode }[] = [
  {
    title: 'Any format, accepted.',
    text: 'iPhone HEIC, WebP, AVIF, TIFF scans, SVG logos and more become exactly the format the website takes.',
    visual: <AnyFormat />,
  },
  {
    title: 'Fits any size limit.',
    text: 'Made smaller to fit, at full size whenever it can. If a photo truly needs fewer pixels, it asks first, and keeps as many as fit.',
    visual: <FitsLimit />,
  },
  {
    title: 'PDFs and spreadsheets too.',
    text: 'A photo becomes a PDF, a PDF becomes a JPG, a big PDF gets smaller, and Excel becomes CSV, or back.',
    visual: <Documents />,
  },
  {
    title: 'Reads the rules like you do.',
    text: '“upto 2MB”, “should not exceed 500 KB”, “between 20 and 50 KB”: it understands how websites really write them.',
    visual: <ReadsRules />,
  },
  {
    title: 'Asks before anything you’d notice.',
    text: 'Cropping, a white background or a visible drop in quality is always your choice, never a surprise.',
    visual: <AsksFirst />,
  },
  {
    title: 'Private by design.',
    text: 'Everything happens on your computer. No servers, no account, no tracking. Your originals are never changed.',
    visual: <Private />,
  },
];

/* ------------------------------------------------------------------------------------ */
/* What it fixes: an editorial list of real results.                                    */

interface Case {
  chosen: string;
  site: string;
  result: string;
  kind: 'auto' | 'ask' | 'none';
}

/** Real results, measured with the extension. */
const CASES: Case[] = [
  {
    chosen: 'WebP photo, 2.7 MB',
    site: 'JPG or PNG, max 2 MB',
    result: 'JPG, 1.9 MB',
    kind: 'auto',
  },
  {
    chosen: 'PNG screenshot, 2.3 MB',
    site: 'Attachments up to 1 MB',
    result: 'JPG, 781 KB',
    kind: 'auto',
  },
  { chosen: 'TIFF scan, 26.1 MB', site: 'JPG only, max 2 MB', result: 'JPG, 1.9 MB', kind: 'auto' },
  {
    chosen: 'iPhone HEIC, 1.6 MB',
    site: 'JPG only, max 1 MB',
    result: 'JPG, 942 KB',
    kind: 'auto',
  },
  {
    chosen: 'JPG, 4032 × 3024',
    site: 'Images up to 1920 × 1920 pixels',
    result: 'JPG, 1920 × 1440',
    kind: 'auto',
  },
  {
    chosen: 'JPG, 24 KB',
    site: 'File size: minimum 30 KB, maximum 1 MB',
    result: 'JPG, 41 KB',
    kind: 'auto',
  },
  { chosen: 'SVG logo', site: 'PNG only', result: 'PNG, drawn sharp', kind: 'auto' },
  { chosen: 'Photo', site: 'Upload as a PDF', result: 'A one-page PDF', kind: 'auto' },
  { chosen: 'Scanned PDF, 2 MB', site: 'PDF, max 1 MB', result: 'PDF, 957 KB', kind: 'auto' },
  { chosen: 'PDF', site: 'JPG or PNG only', result: 'JPG of the page', kind: 'auto' },
  { chosen: 'Excel workbook', site: 'CSV files only', result: 'CSV', kind: 'auto' },
  {
    chosen: '48 MP phone photo, 9.4 MB',
    site: 'File size should not exceed 500 KB',
    result: 'JPG, 476 KB, 2575 × 1931',
    kind: 'ask',
  },
  {
    chosen: 'Portrait photo',
    site: 'Square, 600 × 600',
    result: 'You choose the crop',
    kind: 'ask',
  },
  { chosen: 'See-through PNG', site: 'JPG only', result: 'White background', kind: 'ask' },
  {
    chosen: 'JPG, 900 KB',
    site: 'JPG or PNG, max 2 MB',
    result: 'Left exactly as it is',
    kind: 'none',
  },
];

const KIND_LABEL = { auto: 'Automatic', ask: 'Asks first', none: 'Nothing to do' } as const;

function Fixes() {
  return (
    <div className="fixes" role="table" aria-label="What Just Upload fixes">
      <div className="fix-row fix-head" role="row">
        <span role="columnheader">You choose</span>
        <span role="columnheader">The website says</span>
        <span role="columnheader">The website gets</span>
        <span role="columnheader" className="visually-hidden">
          How
        </span>
      </div>
      {CASES.map((item, at) => (
        <m.div
          key={item.chosen + at}
          className="fix-row"
          role="row"
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ duration: 0.5, ease: EASE, delay: Math.min(at, 6) * 0.03 }}
        >
          <span role="cell" className="fix-from">
            {item.chosen}
          </span>
          <span role="cell" className="fix-site display">
            “{item.site}”
          </span>
          <span role="cell" className={`fix-to ${item.kind}`}>
            {item.kind === 'auto' && <Check />}
            {item.result}
          </span>
          <span role="cell" className={`fix-kind ${item.kind}`}>
            {KIND_LABEL[item.kind]}
          </span>
        </m.div>
      ))}
    </div>
  );
}

/** Claims for the top of the page: each one true, and checked against the code. */
const TRUST = [
  { icon: 'lock', title: 'Private by design', text: 'Your files never leave your computer' },
  { icon: 'check', title: 'Free', text: 'No account, no sign-up' },
  { icon: 'shield', title: 'No tracking', text: 'Not a single analytics call' },
  { icon: 'bolt', title: 'About a second', text: 'On any website, as you upload' },
] as const;

/** In numbers. Formats: 12 kinds of image, PDF, CSV and two Excel formats. */
const CLAIMS = [
  { figure: '0', text: 'files sent to us. Everything happens on your computer.' },
  { figure: '16', text: 'file formats read: photos, scans, PDFs and spreadsheets.' },
  { figure: '140+', text: 'ways websites word their upload rules, understood.' },
  { figure: '97%', text: 'of the quality kept or better, or it asks you first.' },
];

const PLACES = [
  'Job applications',
  'Exam and government forms',
  'Bank and identity checks',
  'Marketplace listings',
  'Profile photos',
  'Support tickets',
  'School portals',
];

function Welcome() {
  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  useEffect(() => {
    document.body.classList.add('grain');
  }, []);

  return (
    <div className="welcome">
      <header className="top">
        <Wordmark size={26} />
        <nav aria-label="On this page">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#try">Try it</a>
          <a href="#privacy">Privacy</a>
        </nav>
        <a className="button quiet small" href="options.html">
          Settings
        </a>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-text">
            <m.p
              className="hero-status"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              <span className="pulse" aria-hidden="true" />
              Installed. Ready on every website.
            </m.p>
            <m.h1
              id="hero-title"
              className="display"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.05 }}
            >
              Uploads that <em>just work.</em>
            </m.h1>
            <m.p
              className="lead"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.14 }}
            >
              When a website says no to your photo, PDF or spreadsheet, {PRODUCT_NAME} quietly makes
              a copy it accepts, right on your computer, in about a second. You keep uploading the
              way you always do.
            </m.p>
            <m.div
              className="hero-actions"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.22 }}
            >
              <button type="button" className="button large" onClick={() => scrollTo('try')}>
                Try it with your own file
              </button>
              <button type="button" className="text-link" onClick={() => scrollTo('how')}>
                See how it works <ArrowRight />
              </button>
            </m.div>
            <m.ul
              className="hero-trust"
              aria-label="Why it is safe to use"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.32 }}
            >
              {TRUST.map((claim) => (
                <li key={claim.title}>
                  <span className="trust-icon" aria-hidden="true">
                    <Icon name={claim.icon} size={15} />
                  </span>
                  <span>
                    <b>{claim.title}</b>
                    {claim.text}
                  </span>
                </li>
              ))}
            </m.ul>
          </div>
          <m.div
            className="hero-visual"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, ease: EASE, delay: 0.1 }}
          >
            <StampStage />
          </m.div>
        </section>

        <section className="claims" aria-label="Just Upload in numbers">
          {CLAIMS.map((claim, at) => (
            <m.p
              key={claim.figure}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.45 + at * 0.07 }}
            >
              <b className="display">{claim.figure}</b>
              <span>{claim.text}</span>
            </m.p>
          ))}
        </section>

        <section className="places" aria-label="Where it helps">
          <p className="places-title">Made for the uploads that say no</p>
          {/* A slow ticker: the list, then a copy of it, so the loop has no seam. */}
          <div className="places-track">
            {[false, true].map((copy) => (
              <ul key={String(copy)} className="places-list" aria-hidden={copy || undefined}>
                {PLACES.map((place) => (
                  <li key={place} className="display">
                    {place}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </section>

        <section id="features" className="block" aria-labelledby="features-title">
          <Reveal>
            <header className="block-head" data-label="Features">
              <h2 id="features-title" className="display">
                Everything a picky upload needs.
              </h2>
              <p className="block-lead">
                Six things {PRODUCT_NAME} does for you, without a single setting to learn.
              </p>
            </header>
          </Reveal>
          <div className="features">
            {FEATURES.map((feature, at) => (
              <m.article
                key={feature.title}
                className="feature"
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.8, ease: EASE, delay: (at % 3) * 0.08 }}
              >
                <div className="feature-visual">{feature.visual}</div>
                <h3 className="display">{feature.title}</h3>
                <p>{feature.text}</p>
              </m.article>
            ))}
          </div>
        </section>

        <section id="how" className="block" aria-labelledby="how-title">
          <Reveal>
            <header className="block-head" data-label="How it works">
              <h2 id="how-title" className="display">
                Pick a file. <em>That’s the whole job.</em>
              </h2>
              <p className="block-lead">
                Everything happens between choosing a file and the website receiving it, in about a
                second. Here it is, slowed down.
              </p>
            </header>
          </Reveal>
          <Reveal delay={0.1}>
            <Walkthrough />
          </Reveal>
        </section>

        <section id="try" className="block" aria-labelledby="try-title">
          <Reveal>
            <header className="block-head" data-label="Try it">
              <h2 id="try-title" className="display">
                See it for yourself.
              </h2>
              <p className="block-lead">
                Type a rule the way a website words it, then choose a file or one of our samples.
                You’ll see exactly what the website would get. Nothing leaves this computer.
              </p>
            </header>
          </Reveal>
          <Reveal delay={0.1}>
            <Lab />
          </Reveal>
        </section>

        <section id="fixes" className="block" aria-labelledby="fixes-title">
          <Reveal>
            <header className="block-head" data-label="What it fixes">
              <h2 id="fixes-title" className="display">
                The reasons websites say no, <em>fixed.</em>
              </h2>
              <p className="block-lead">
                Real results, measured on this computer. Your photo keeps its full size unless the
                website asks for other dimensions, or you agree to fewer pixels to fit a limit.
              </p>
            </header>
          </Reveal>
          <Reveal delay={0.05}>
            <Fixes />
          </Reveal>
        </section>

        <section id="privacy" className="block privacy" aria-labelledby="privacy-title">
          <Reveal>
            <div className="privacy-inner">
              <span className="privacy-seal" aria-hidden="true">
                <Seal top="PRIVATE" bottom="ON THIS COMPUTER" />
                <span className="private-lock">
                  <Icon name="lock" size={24} />
                </span>
              </span>
              <h2 id="privacy-title" className="display">
                Your files never leave this computer.
              </h2>
              <p className="block-lead">
                {PRODUCT_NAME} has no servers. Your photos, PDFs and spreadsheets are prepared
                inside your browser and go only to the website you chose, exactly as they would
                without it.
              </p>
              <ul className="privacy-facts">
                <li>
                  <b>No account</b>
                  <span>Nothing to sign up for.</span>
                </li>
                <li>
                  <b>No tracking</b>
                  <span>No analytics of any kind.</span>
                </li>
                <li>
                  <b>Works offline</b>
                  <span>Nothing is downloaded later.</span>
                </li>
                <li>
                  <b>Originals untouched</b>
                  <span>It always works on a copy.</span>
                </li>
              </ul>
            </div>
          </Reveal>
        </section>

        <section className="closing" aria-labelledby="closing-title">
          <Reveal>
            <h2 id="closing-title" className="display">
              That’s it. <em>Keep uploading</em> the way you always do.
            </h2>
            <p className="pin-hint">
              <span className="pin-keys" aria-hidden="true">
                <Icon name="puzzle" size={15} />
                <Icon name="pin" size={15} />
              </span>
              Pin {PRODUCT_NAME} from Chrome’s puzzle-piece menu to see it in your toolbar.
            </p>
            <div className="closing-actions">
              <button type="button" className="button large" onClick={() => scrollTo('try')}>
                Try it with your own file
              </button>
              <a className="text-link" href="options.html">
                Open settings <ArrowRight />
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="foot">
        <Wordmark size={20} />
        <span className="foot-links">
          <a href="options.html">Settings</a>
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">
            Privacy policy
          </a>
          <a href="licenses/THIRD_PARTY_NOTICES.txt">Open-source notices</a>
          <span className="num">v{browser.runtime.getManifest().version}</span>
        </span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MotionRoot>
    <Welcome />
  </MotionRoot>,
);
