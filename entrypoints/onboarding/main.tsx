import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { type ReactNode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { LOOKS_THE_SAME } from '../../src/decision';
import {
  Arrow,
  FileTag,
  Icon,
  Logo,
  MotionRoot,
  PRODUCT_NAME,
  Wordmark,
} from '../../src/ui/shared';
import { Lab } from './lab';
import { Walkthrough } from './walkthrough';
import '../../src/ui/pages.css';
import './onboarding.css';

const EASE = [0.22, 1, 0.36, 1] as const;

/** Sections rise into place once, as they scroll into view. */
function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </m.div>
  );
}

function FileGlyph({ tone }: { tone: 'refused' | 'after' }) {
  return (
    <svg className={`file-glyph ${tone}`} viewBox="0 0 28 34" fill="none" aria-hidden="true">
      <path d="M3 1.5h15L26.5 10v21a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 31V3A1.5 1.5 0 0 1 3 1.5Z" />
      <path d="M17.5 1.5V10h9" />
    </svg>
  );
}

interface Example {
  /** The format, on the tab under the card. */
  format: string;
  address: string;
  field: string;
  from: { name: string; detail: string; size: string };
  to: { name: string; detail: string; format: string; size: string };
  seconds: string;
  quality: number;
}

/**
 * Real results, measured with the engine on this page's "Try it": every kind of image a
 * website refuses, not only phone photos. All keep their full pixel size.
 */
const EXAMPLES: Example[] = [
  {
    format: 'WebP',
    address: 'careers.example.com/apply',
    field: 'Profile photo · JPG or PNG · Max 2 MB',
    from: { name: 'vacation.webp', detail: '4032 × 3024 · saved from the web', size: '2.7 MB' },
    to: {
      name: 'vacation.jpg',
      detail: '4032 × 3024 · full size kept',
      format: 'JPG',
      size: '1.9 MB',
    },
    seconds: '0.6 s',
    quality: 97,
  },
  {
    format: 'PNG',
    address: 'help.example.com/new-ticket',
    field: 'Attachment · Up to 1 MB',
    from: { name: 'Screenshot.png', detail: '2880 × 1800 · a screenshot', size: '2.3 MB' },
    to: {
      name: 'Screenshot.jpg',
      detail: '2880 × 1800 · full size kept',
      format: 'JPG',
      size: '781 KB',
    },
    seconds: '0.1 s',
    quality: 99,
  },
  {
    format: 'HEIC',
    address: 'exams.example.gov/apply',
    field: 'Your photo · JPG only · Max 1 MB',
    from: { name: 'IMG_2041.HEIC', detail: '3024 × 4032 · from a phone', size: '1.6 MB' },
    to: {
      name: 'IMG_2041.jpg',
      detail: '3024 × 4032 · full size kept',
      format: 'JPG',
      size: '942 KB',
    },
    seconds: '0.8 s',
    quality: 97,
  },
  {
    format: 'TIFF',
    address: 'bank.example/documents',
    field: 'ID document · JPG only · Max 2 MB',
    from: { name: 'scan.tif', detail: '2480 × 3508 · from a scanner', size: '26.1 MB' },
    to: { name: 'scan.jpg', detail: '2480 × 3508 · full size kept', format: 'JPG', size: '1.9 MB' },
    seconds: '0.4 s',
    quality: 98,
  },
];
/** How long each example stays before the next one, unless the card is pointed at. */
const EXAMPLE_MS = 5200;

/**
 * The hero's picture: a refused image, Just Upload in between, the accepted copy. It
 * cycles through a web photo, a screenshot, a phone photo and a scan; the tabs under it
 * pick one.
 */
function ReceiptCard() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (reduced || paused) return;
    const timer = setTimeout(() => setIndex((at) => (at + 1) % EXAMPLES.length), EXAMPLE_MS);
    return () => clearTimeout(timer);
  }, [index, paused, reduced]);
  const example = EXAMPLES[index]!;
  const row = (delay: number) => ({
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: EASE, delay },
  });
  return (
    <div
      className="hero-receipt"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        className="receipt-card"
        role="img"
        aria-label={`A ${example.format} file refused by a website, then accepted as a ${example.to.format} after ${PRODUCT_NAME} prepares a copy.`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={index} exit={{ opacity: 0, y: -6, transition: { duration: 0.2 } }}>
            <m.div className="receipt-site" {...row(0.15)}>
              <span className="receipt-address mono">{example.address}</span>
              <span className="receipt-rule">{example.field}</span>
            </m.div>
            <m.div className="receipt-file" {...row(0.35)}>
              <FileGlyph tone="refused" />
              <span className="receipt-name">
                <b>{example.from.name}</b>
                <span>{example.from.detail}</span>
              </span>
              <FileTag name={example.format} size={example.from.size} tone="refused" />
              <span className="verdict refused">Refused</span>
            </m.div>
            <div className="receipt-bridge">
              <m.span
                className="bridge-line"
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.75 }}
              />
              <m.span className="bridge-label" {...row(0.95)}>
                <Logo size={18} />
                <span>
                  <b>{PRODUCT_NAME}</b> · {example.seconds}, on this computer
                </span>
              </m.span>
            </div>
            <m.div className="receipt-file" {...row(1.3)}>
              <FileGlyph tone="after" />
              <span className="receipt-name">
                <b>{example.to.name}</b>
                <span>{example.to.detail}</span>
              </span>
              <FileTag name={example.to.format} size={example.to.size} tone="after" />
              <span className="verdict accepted">Accepted</span>
            </m.div>
            <m.div className="receipt-quality" {...row(1.55)}>
              <span>Quality kept</span>
              <span className="quality-bar">
                <m.i
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: example.quality / 100 }}
                  transition={{ duration: 1, ease: EASE, delay: 1.7 }}
                />
              </span>
              <b className="num">{example.quality}%</b>
            </m.div>
          </m.div>
        </AnimatePresence>
      </div>
      <div className="receipt-tabs" role="group" aria-label="Examples">
        {EXAMPLES.map((item, at) => (
          <button
            key={item.format}
            type="button"
            className={at === index ? 'receipt-tab active' : 'receipt-tab'}
            aria-pressed={at === index}
            onClick={() => setIndex(at)}
          >
            {item.format}
            {at === index && !paused && !reduced && (
              <m.i
                key={index}
                className="receipt-tab-time"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: EXAMPLE_MS / 1000, ease: 'linear' }}
              />
            )}
          </button>
        ))}
        <span className="receipt-tabs-more">and 8 more formats</span>
      </div>
    </div>
  );
}

interface Case {
  chosen: [string, string?];
  site: string;
  result: [string, string?] | string;
  kind: 'auto' | 'ask' | 'none';
}

const CASES: Case[] = [
  {
    chosen: ['WebP', '2.7 MB'],
    site: 'JPG or PNG, max 2 MB',
    result: ['JPG', '1.9 MB'],
    kind: 'auto',
  },
  {
    chosen: ['PNG', '2.3 MB'],
    site: 'Attachments up to 1 MB',
    result: ['JPG', '781 KB'],
    kind: 'auto',
  },
  {
    chosen: ['TIFF', '26.1 MB'],
    site: 'JPG only, max 2 MB',
    result: ['JPG', '1.9 MB'],
    kind: 'auto',
  },
  {
    chosen: ['HEIC', '1.6 MB'],
    site: 'JPG only, max 1 MB',
    result: ['JPG', '942 KB'],
    kind: 'auto',
  },
  {
    chosen: ['JPG', '4032 × 3024'],
    site: 'Images up to 1920 × 1920 pixels',
    result: ['JPG', '1920 × 1440'],
    kind: 'auto',
  },
  {
    chosen: ['JPG', '24 KB'],
    site: 'File size: minimum 30 KB, maximum 1 MB',
    result: ['JPG', '41 KB'],
    kind: 'auto',
  },
  { chosen: ['SVG'], site: 'PNG only', result: ['PNG', '1024 px'], kind: 'auto' },
  { chosen: ['AVIF'], site: 'Please save it as a TIFF', result: ['TIFF'], kind: 'auto' },
  {
    chosen: ['JPG', '3024 × 4032'],
    site: 'Square, 600 × 600',
    result: ['JPG', '600 × 600'],
    kind: 'ask',
  },
  { chosen: ['PNG', 'see-through'], site: 'JPG only', result: ['JPG', 'white back'], kind: 'ask' },
  {
    chosen: ['JPG', '900 KB'],
    site: 'JPG or PNG, max 2 MB',
    result: 'Left exactly as it is',
    kind: 'none',
  },
];

const KIND_LABEL = { auto: 'Automatic', ask: 'Asks you first', none: 'Nothing to do' } as const;

function Ledger() {
  return (
    <div className="ledger" role="table" aria-label="Examples of what Just Upload fixes">
      <div className="ledger-head" role="row">
        <span role="columnheader">You choose</span>
        <span role="columnheader">The website wants</span>
        <span role="columnheader">The website gets</span>
        <span role="columnheader" className="visually-hidden">
          How
        </span>
      </div>
      {CASES.map((item, index) => (
        <m.div
          key={item.site + index}
          className="ledger-row"
          role="row"
          initial={{ opacity: 0, x: -10 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.5, ease: EASE, delay: index * 0.05 }}
        >
          <span role="cell">
            <FileTag name={item.chosen[0]} size={item.chosen[1]} />
          </span>
          <span role="cell" className="ledger-site">
            “{item.site}”
          </span>
          <span role="cell" className="ledger-result">
            <Arrow />
            {typeof item.result === 'string' ? (
              <span className="ledger-same">{item.result}</span>
            ) : (
              <FileTag
                name={item.result[0]}
                size={item.result[1]}
                tone={item.kind === 'ask' ? 'ask' : 'after'}
              />
            )}
          </span>
          <span role="cell" className={`ledger-kind ${item.kind}`}>
            {KIND_LABEL[item.kind]}
          </span>
        </m.div>
      ))}
    </div>
  );
}

const READS = [
  'JPG',
  'PNG',
  'WebP',
  'AVIF',
  'GIF',
  'TIFF',
  'BMP',
  'ICO',
  'HEIC',
  'HEIF',
  'SVG',
  'JPEG XL',
];
const WRITES = ['JPG', 'PNG', 'WebP', 'AVIF', 'GIF', 'TIFF', 'BMP', 'ICO'];

/** Two real outcomes measured against the point where a copy looks the same. */
function QualityRuler() {
  const from = 80;
  const at = (value: number) => `${((value - from) / (100 - from)) * 100}%`;
  const rows = [
    { value: 98, label: 'A typical phone photo, made to fit 2 MB', tone: 'ok' },
    { value: 88, label: 'Squeezed hard for a tiny limit: asks you first', tone: 'ask' },
  ] as const;
  // The panel decides when it is in view: a bar that starts at zero width has no area
  // for the browser to see.
  return (
    <m.div
      className="ruler"
      aria-hidden="true"
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.5 }}
    >
      <div className="ruler-rows">
        {rows.map((row, index) => (
          <div className="ruler-row" key={row.value}>
            <p className="ruler-head">
              <b className={`num ${row.tone}`}>{row.value}%</b>
              <span>{row.label}</span>
            </p>
            <div className="ruler-track">
              <m.i
                className={row.tone}
                style={{ width: at(row.value) }}
                variants={{
                  hidden: { scaleX: 0 },
                  shown: {
                    scaleX: 1,
                    transition: { duration: 1, ease: EASE, delay: 0.2 + index * 0.18 },
                  },
                }}
              />
            </div>
          </div>
        ))}
        <div className="ruler-line" style={{ left: at(LOOKS_THE_SAME) }}>
          <span className="num">{LOOKS_THE_SAME}% · looks the same</span>
        </div>
      </div>
      <div className="ruler-labels num">
        {[80, 85, 90, 95, 100].map((value) => (
          <span key={value} style={{ left: at(value) }}>
            {value}%
          </span>
        ))}
      </div>
    </m.div>
  );
}

function Welcome() {
  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="welcome">
      <header className="top">
        <Wordmark size={26} />
        <nav aria-label="On this page">
          <a href="#how">How it works</a>
          <a href="#fixes">What it fixes</a>
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
              className="eyebrow"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <span className="status-dot on" aria-hidden="true" />
              Installed and ready on every site
            </m.p>
            <m.h1
              id="hero-title"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.05 }}
            >
              Uploads that <em>just work.</em>
            </m.h1>
            <m.p
              className="lead"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.12 }}
            >
              When a website refuses an image because of its format or size, {PRODUCT_NAME} quietly
              makes a copy that fits, on this computer, before the site sees it. You keep uploading
              exactly as you do today.
            </m.p>
            <m.div
              className="hero-actions"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.2 }}
            >
              <button type="button" className="button large" onClick={() => scrollTo('try')}>
                Try it with your own image
              </button>
              <button type="button" className="button quiet large" onClick={() => scrollTo('how')}>
                See how it works
              </button>
            </m.div>
            <m.p
              className="pin-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
            >
              <span className="pin-keys" aria-hidden="true">
                <Icon name="puzzle" size={15} />
                <Icon name="pin" size={15} />
              </span>
              Pin {PRODUCT_NAME} from Chrome’s puzzle-piece menu to see it in your toolbar.
            </m.p>
          </div>
          <div className="hero-visual">
            <ReceiptCard />
          </div>
        </section>

        <section id="how" className="block" aria-labelledby="how-title">
          <Reveal>
            <p className="kicker">How it works</p>
            <h2 id="how-title">Four steps, about a second, nothing to do.</h2>
            <p className="block-lead">
              Everything happens between choosing a file and the website receiving it.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <Walkthrough />
          </Reveal>
        </section>

        <section id="try" className="block" aria-labelledby="try-title">
          <Reveal>
            <p className="kicker">Try it</p>
            <h2 id="try-title">Try it with your own image.</h2>
            <p className="block-lead">
              Type a rule the way a website words it, then choose an image or a sample. You’ll see
              exactly what the website would get, down to the pixels. Nothing leaves this computer.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <Lab />
          </Reveal>
        </section>

        <section id="fixes" className="block" aria-labelledby="fixes-title">
          <Reveal>
            <p className="kicker">What it fixes</p>
            <h2 id="fixes-title">The reasons websites say no.</h2>
            <p className="block-lead">
              Safe changes happen on their own. Anything you would notice is a question first, and
              your photo keeps its full size unless the website asks for other dimensions.
            </p>
          </Reveal>
          <Reveal delay={0.05}>
            <Ledger />
          </Reveal>
          <Reveal>
            <div className="formats">
              <div>
                <span className="formats-label">Reads</span>
                <span className="formats-list">
                  {READS.map((name) => (
                    <FileTag key={name} name={name} />
                  ))}
                </span>
              </div>
              <div>
                <span className="formats-label">Writes</span>
                <span className="formats-list">
                  {WRITES.map((name) => (
                    <FileTag key={name} name={name} tone="after" />
                  ))}
                </span>
              </div>
              <p className="formats-note">
                Files up to 5 GB. Huge scans and panoramas are resized only when the website states
                a pixel size.
              </p>
            </div>
          </Reveal>
        </section>

        <section className="block split" aria-labelledby="quality-title">
          <Reveal>
            <p className="kicker">Quality</p>
            <h2 id="quality-title">You always know what you kept.</h2>
            <p className="block-lead">
              Every fix is measured against your photo, the way your eye compares them, and the note
              tells you the result. Below {LOOKS_THE_SAME}%, where a difference starts to show,{' '}
              {PRODUCT_NAME} asks before uploading.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <QualityRuler />
          </Reveal>
        </section>

        <section id="privacy" className="block" aria-labelledby="privacy-title">
          <Reveal>
            <div className="privacy-panel">
              <div className="privacy-icon" aria-hidden="true">
                <Icon name="lock" size={22} />
              </div>
              <div>
                <h2 id="privacy-title">Your photos never leave this computer.</h2>
                <p>
                  {PRODUCT_NAME} has no servers. Images are prepared inside your browser and go only
                  to the website you chose, exactly as they would without it.
                </p>
              </div>
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
      </main>

      <footer className="foot">
        <Wordmark size={20} />
        <span className="foot-links">
          <a href="options.html">Settings</a>
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
