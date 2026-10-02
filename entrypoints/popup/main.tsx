import { animate, AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { Icon, LocalNote, MotionRoot, Toggle, Wordmark } from '../../src/ui/shared';
import { useSettings, useStats } from '../../src/ui/use-settings';
import '../../src/ui/pages.css';
import './popup.css';

/** The site in the active tab. Readable only because opening the popup grants activeTab. */
function useCurrentSite(): string {
  const [site, setSite] = useState('');
  useEffect(() => {
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        const url = tab?.url ? new URL(tab.url) : undefined;
        if (url && /^https?:$/.test(url.protocol)) setSite(url.hostname.toLowerCase());
      })
      .catch(() => {});
  }, []);
  return site;
}

/** A number that counts up to its value, once, as the popup opens. */
function Count({ value }: { value: number }) {
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
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        shown.current = latest;
        element.textContent = Math.round(latest).toLocaleString();
      },
    });
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <span ref={node} className="count">
      0
    </span>
  );
}

function Popup() {
  const { settings, update, ready, error } = useSettings();
  const { stats, session } = useStats();
  const site = useCurrentSite();
  const pausedHere = Boolean(site) && settings.disabledSites.includes(site);
  const state = !settings.enabled ? 'off' : pausedHere ? 'paused' : 'on';
  const status = {
    on: 'On · only when a site needs it',
    paused: `Paused on ${site}`,
    off: 'Off · uploads stay untouched',
  }[state];

  const togglePause = () =>
    void update({
      disabledSites: pausedHere
        ? settings.disabledSites.filter((item) => item !== site)
        : [...settings.disabledSites, site],
    });

  return (
    <main className="popup" data-state={state}>
      <header className="popup-head">
        <Wordmark size={22} />
        <button
          type="button"
          className="icon-button"
          aria-label="Settings"
          title="Settings"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          <Icon name="gear" />
        </button>
      </header>

      <section className="control" aria-label="Automatic fixing">
        <div className="control-row">
          <div className="control-text">
            <h1>Automatic fixing</h1>
            <div className="status" role="status">
              <AnimatePresence mode="wait" initial={false}>
                <m.p
                  key={state}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <span
                    className={`status-dot ${state === 'off' ? '' : state}`}
                    aria-hidden="true"
                  />
                  {status}
                </m.p>
              </AnimatePresence>
            </div>
          </div>
          <Toggle
            large
            label="Automatic fixing"
            checked={settings.enabled}
            disabled={!ready}
            onChange={() => void update({ enabled: !settings.enabled })}
          />
        </div>
        {site && (
          <div className="site">
            <Icon name="globe" size={15} />
            <span className="host" title={site}>
              {site}
            </span>
            <button
              type="button"
              className="button quiet small"
              disabled={!ready || !settings.enabled}
              onClick={togglePause}
            >
              {pausedHere ? 'Resume here' : 'Pause here'}
            </button>
          </div>
        )}
      </section>

      <section className="figures" aria-label="Files fixed">
        <div className="figure">
          <Count value={session} />
          <span className="label">fixed this session</span>
        </div>
        <div className="figure">
          <Count value={stats.total} />
          <span className="label">fixed in total</span>
        </div>
      </section>

      {error && (
        <p className="error popup-error" role="alert">
          {error}
        </p>
      )}

      <footer className="popup-foot">
        <LocalNote />
        <button
          type="button"
          className="link-button"
          onClick={() =>
            void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') })
          }
        >
          How it works
          <Icon name="arrow" />
        </button>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <MotionRoot>
    <Popup />
  </MotionRoot>,
);
