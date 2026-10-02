import { animate, AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { LOOKS_THE_SAME } from '../../src/decision';
import type { TransformChange } from '../../src/models';
import { clearProblems } from '../../src/storage/problems';
import { resetStats } from '../../src/storage/stats';
import {
  formatLabel,
  problemLabel,
  problemReport,
  type ReportEnvironment,
} from '../../src/ui/copy';
import {
  Icon,
  MotionRoot,
  PRIVACY_POLICY_URL,
  PRODUCT_NAME,
  Seal,
  Switch,
  Wordmark,
} from '../../src/ui/shared';
import { useProblems, useSettings, useStats } from '../../src/ui/use-settings';
import { formatBytes } from '../../src/utils/files';
import '../../src/ui/pages.css';
import './options.css';

const COUNT_LABELS: [TransformChange, string][] = [
  ['converted', 'Converted'],
  ['compressed', 'Made smaller'],
  ['resized', 'Resized'],
  ['cropped', 'Cropped'],
];

/** Rows that slide open as they arrive and fold away as they go. */
const ROW = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
} as const;

interface BrandVersion {
  brand: string;
  version: string;
}

/** The browser and system, from the browser's own short description of itself. */
function environment(): ReportEnvironment {
  const data = (
    navigator as Navigator & {
      userAgentData?: { brands?: BrandVersion[]; platform?: string };
    }
  ).userAgentData;
  const brands = (data?.brands ?? []).filter(({ brand }) => !/not.?a.?brand/i.test(brand));
  const named = brands.find(({ brand }) => brand !== 'Chromium') ?? brands[0];
  return {
    version: browser.runtime.getManifest().version,
    browser: named ? `${named.brand} ${named.version}` : 'Chromium-based browser',
    platform: data?.platform || 'unknown system',
  };
}

function Section({
  id,
  title,
  description,
  note,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-head">
        <h2 id={id} className="display">
          {title}
        </h2>
        {description && <p>{description}</p>}
      </div>
      <div className="section-body">
        {children}
        {note && <p className="section-note">{note}</p>}
      </div>
    </section>
  );
}

/** A number that eases to its value when it changes. */
function Figure({ value }: { value: number }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const element = node.current;
    if (!element) return;
    if (reduce) {
      element.textContent = value.toLocaleString();
      shown.current = value;
      return;
    }
    const controls = animate(shown.current, value, {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        shown.current = latest;
        element.textContent = Math.round(latest).toLocaleString();
      },
    });
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <span ref={node} className="figure-number">
      0
    </span>
  );
}

function Problems() {
  const problems = useProblems();
  const [website, setWebsite] = useState('');
  const [copied, setCopied] = useState(false);
  const reportRef = useRef<HTMLTextAreaElement>(null);
  const report = problemReport(problems, { ...environment(), website });

  useEffect(() => setCopied(false), [report]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      reportRef.current?.focus();
      reportRef.current?.select();
    }
  };

  return (
    <Section
      id="problems"
      title="Problems"
      description="When a file can’t be prepared, a short note is kept here, on this computer."
      note={
        <>
          Notes hold no images, file names or website addresses, and nothing is sent anywhere. To
          tell us about a problem, copy the report and email it to{' '}
          <a href="mailto:mokshbuilds@gmail.com">mokshbuilds@gmail.com</a>.
        </>
      }
    >
      <div className="panel">
        {problems.length ? (
          <ul className="problem-list">
            <AnimatePresence initial={false}>
              {problems
                .slice()
                .reverse()
                .map((problem) => (
                  <m.li key={`${problem.at}-${problem.code}-${problem.bytes}`} {...ROW}>
                    <div className="row">
                      <span className="row-text">
                        <span className="row-title">{problemLabel(problem.code)}</span>
                        <span className="row-detail">
                          {new Date(problem.at).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                      </span>
                      <span className="tag">
                        <b>{formatLabel(problem.format)}</b>
                        <span>{formatBytes(problem.bytes)}</span>
                      </span>
                    </div>
                  </m.li>
                ))}
            </AnimatePresence>
          </ul>
        ) : (
          <p className="row empty">
            <span className="empty-mark" aria-hidden="true">
              <Icon name="check" size={14} />
            </span>
            No problems so far.
          </p>
        )}
        {problems.length > 0 && (
          <div className="report-box">
            <label className="field">
              <span>Which website was it? (optional)</span>
              <input
                type="text"
                value={website}
                maxLength={120}
                placeholder="For example, a job application site"
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
            <textarea
              ref={reportRef}
              className="report"
              aria-label="Problem report"
              readOnly
              rows={7}
              value={report}
            />
            <div className="actions">
              <button type="button" className="button" onClick={() => void copy()}>
                <Icon name={copied ? 'check' : 'copy'} />
                {copied ? 'Copied' : 'Copy report'}
              </button>
              <button type="button" className="button quiet" onClick={() => void clearProblems()}>
                Clear notes
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function Options() {
  const { settings, update, ready, error } = useSettings();
  const { stats } = useStats();
  const toggle = (key: 'enabled' | 'showNotifications' | 'askBeforeQualityChanges') => () =>
    void update({ [key]: !settings[key] });

  // Opened from a “Report a problem” button: go straight to the notes once the page has
  // its final layout.
  useEffect(() => {
    if (ready && location.hash === '#problems')
      document.getElementById('problems')?.scrollIntoView({ block: 'start' });
  }, [ready]);
  useEffect(() => {
    document.body.classList.add('grain');
  }, []);

  const version = browser.runtime.getManifest().version;
  const paused = settings.disabledSites.length;
  const state = !settings.enabled ? 'off' : paused ? 'some' : 'on';
  const status = {
    on: 'On for every website',
    some: `On · paused on ${paused} ${paused === 1 ? 'site' : 'sites'}`,
    off: 'Off · uploads stay untouched',
  }[state];

  return (
    <div className="settings-page">
      <header className="topbar">
        <Wordmark size={24} />
        <div className="topbar-links">
          <a href="onboarding.html">How it works</a>
          <span className="tag version">
            <b>v{version}</b>
          </span>
        </div>
      </header>

      <div className="intro">
        <div className="intro-text">
          <h1 className="display">Settings</h1>
          <p>Everything works without changing anything here.</p>
        </div>
        {ready && (
          <p className="intro-status" role="status">
            <span className={`status-dot ${state === 'off' ? '' : 'on'}`} aria-hidden="true" />
            {status}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      <main>
        <Section
          id="general"
          title="Automatic fixing"
          description="What Just Upload may do on its own."
          note="It always asks before cropping, removing a see-through background, or enlarging an image."
        >
          <div className="panel">
            <Switch
              checked={settings.enabled}
              disabled={!ready}
              onChange={toggle('enabled')}
              title="Automatic fixes"
              detail="Prepare a file when a site can’t take it as it is."
            />
            <Switch
              checked={settings.showNotifications}
              disabled={!ready}
              onChange={toggle('showNotifications')}
              title="Show a note after each fix"
              detail="What changed, and how much quality was kept."
            />
            <Switch
              checked={settings.askBeforeQualityChanges}
              disabled={!ready}
              onChange={toggle('askBeforeQualityChanges')}
              title="Ask before visible quality loss"
              detail={`Check with you when a prepared file would keep less than ${LOOKS_THE_SAME}% of the original’s quality.`}
            />
          </div>
        </Section>

        <Section
          id="paused"
          title="Paused sites"
          description="Sites where Just Upload stays out of the way."
          note="To pause a site, open Just Upload from the toolbar while you’re on it."
        >
          <div className="panel">
            {settings.disabledSites.length ? (
              <ul>
                <AnimatePresence initial={false}>
                  {settings.disabledSites.map((site) => (
                    <m.li key={site} {...ROW}>
                      <div className="row">
                        <span className="row-title host">{site}</span>
                        <button
                          type="button"
                          className="button quiet small"
                          aria-label={`Resume on ${site}`}
                          onClick={() =>
                            void update({
                              disabledSites: settings.disabledSites.filter((item) => item !== site),
                            })
                          }
                        >
                          Resume
                        </button>
                      </div>
                    </m.li>
                  ))}
                </AnimatePresence>
              </ul>
            ) : (
              <p className="row empty">
                <span className="empty-mark" aria-hidden="true">
                  <Icon name="check" size={14} />
                </span>
                Active on every site.
              </p>
            )}
          </div>
        </Section>

        <Section
          id="access"
          title="Site access"
          description="Why Just Upload runs on every site, and how to limit it."
        >
          <div className="panel prose">
            <p>
              {PRODUCT_NAME} has to be ready the moment you choose a file, on any site. It only
              looks at an upload field and the words next to it, and only after you pick a file.
            </p>
            <div>
              <button
                type="button"
                className="button quiet"
                onClick={() =>
                  void browser.tabs.create({ url: `chrome://extensions/?id=${browser.runtime.id}` })
                }
              >
                Limit to specific sites
                <Icon name="external" />
              </button>
            </div>
          </div>
        </Section>

        <Section
          id="numbers"
          title="Files fixed"
          description="Counts only, kept on this computer. No sites or file names."
        >
          <div className="panel figures">
            <div className="figure-main">
              <Figure value={stats.total} />
              <span className="figure-label">
                {stats.total === 1 ? 'file fixed' : 'files fixed'}
              </span>
            </div>
            <div className="figure-side">
              {stats.total > 0 && (
                <ul className="breakdown">
                  {COUNT_LABELS.filter(([change]) => stats.byChange[change]).map(
                    ([change, label]) => (
                      <li key={change}>
                        <span>{label}</span>
                        <b className="num">{stats.byChange[change]}</b>
                      </li>
                    ),
                  )}
                </ul>
              )}
              <button
                type="button"
                className="button quiet small"
                disabled={!stats.total}
                onClick={() => void resetStats()}
              >
                Reset
              </button>
            </div>
          </div>
        </Section>

        <Problems />

        <Section id="privacy" title="Privacy" description="What happens to your files.">
          <div className="panel privacy">
            <span className="privacy-seal" aria-hidden="true">
              <Seal top="PRIVATE" bottom="ON THIS COMPUTER" />
              <span className="privacy-lock">
                <Icon name="lock" size={18} />
              </span>
            </span>
            <p className="privacy-lead display">Your files never leave this computer.</p>
            <ul className="facts">
              <li>Prepared inside your browser, then passed only to the site you chose.</li>
              <li>No account, no servers, no analytics, no file history.</li>
              <li>Stores only these settings, the counts above and any problem notes.</li>
              <li>Your original files are never changed. Uninstalling removes everything.</li>
            </ul>
          </div>
        </Section>

        <Section id="about" title="About">
          <div className="panel links">
            <a className="row link-row" href="onboarding.html">
              <span className="row-title">How it works</span>
              <Icon name="arrow" size={16} />
            </a>
            <a className="row link-row" href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">
              <span className="row-title">Privacy policy</span>
              <Icon name="external" size={16} />
            </a>
            <a className="row link-row" href="licenses/THIRD_PARTY_NOTICES.txt">
              <span className="row-title">Open-source notices</span>
              <Icon name="arrow" size={16} />
            </a>
          </div>
        </Section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MotionRoot>
    <Options />
  </MotionRoot>,
);
