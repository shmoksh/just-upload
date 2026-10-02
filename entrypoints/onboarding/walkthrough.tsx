import { animate, AnimatePresence, m, useInView, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Arrow, FileTag, Logo } from '../../src/ui/shared';

// "How it works": a small, real-looking upload form, played through the four things that
// happen between choosing a photo and the site accepting it. Slowed down so it can be
// followed; the real thing takes about a second.

const STEPS = [
  {
    title: 'You pick a photo, like always',
    text: 'With the site’s own button, or by dragging it in. Nothing new to learn.',
  },
  {
    title: 'Just Upload reads the site’s rules',
    text: 'From the upload field and the words beside it, like “JPG or PNG · Max 2 MB”.',
  },
  {
    title: 'It makes a copy that fits',
    text: 'On your computer, in about a second. Your original is never changed.',
  },
  {
    title: 'The site accepts it',
    text: 'A small note says what changed, and how much of the quality was kept.',
  },
] as const;

const STEP_MS = 3400;
const EASE = [0.22, 1, 0.36, 1] as const;
const SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const;

/** A size that counts down, 3.1 MB to 1.8 MB, as the copy is made. */
function Shrinking({ from, to, delay }: { from: number; to: number; delay: number }) {
  const node = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = node.current;
    if (!element) return;
    element.textContent = `${from.toFixed(1)} MB`;
    const controls = animate(from, to, {
      delay,
      duration: 0.9,
      ease: EASE,
      onUpdate: (latest) => {
        element.textContent = `${latest.toFixed(1)} MB`;
      },
    });
    return () => controls.stop();
  }, [from, to, delay]);
  return <span ref={node} />;
}

function Thumb({ tone, label, chosen }: { tone: number; label: string; chosen?: boolean }) {
  return (
    <figure className={chosen ? 'thumb chosen' : 'thumb'}>
      <span className={`thumb-image tone-${tone}`} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** The moment the copy is made: the name, the format and the size change in place. */
function Converting() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDone(true), 1000);
    return () => clearTimeout(timer);
  }, []);
  const swap = {
    initial: { opacity: 0, y: 5 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -5 },
    transition: { duration: 0.18, ease: EASE },
  } as const;
  return (
    <span className="picked">
      <AnimatePresence mode="wait" initial={false}>
        <m.span key={done ? 'jpg' : 'webp'} className="picked-name" {...swap}>
          {done ? 'vacation.jpg' : 'vacation.webp'}
        </m.span>
      </AnimatePresence>
      <span className={done ? 'tag after morph' : 'tag refused morph'}>
        <AnimatePresence mode="wait" initial={false}>
          <m.b key={done ? 'jpg' : 'webp'} {...swap}>
            {done ? 'JPG' : 'WebP'}
          </m.b>
        </AnimatePresence>
        <Shrinking from={2.7} to={1.9} delay={1} />
      </span>
    </span>
  );
}

/** The photo the person picks, as the site sees it at each step. */
function Picked({ step }: { step: number }) {
  if (step === 0)
    return (
      <m.span
        className="picked"
        initial={{ opacity: 0, y: -10, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ ...SPRING, delay: 1.9 }}
      >
        <span className="picked-name">vacation.webp</span>
        <FileTag name="WebP" size="2.7 MB" />
      </m.span>
    );
  if (step === 1)
    return (
      <span className="picked">
        <span className="picked-name">vacation.webp</span>
        <m.span
          initial={{ opacity: 0.6 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.3 }}
        >
          <FileTag name="WebP" size="2.7 MB" tone="refused" />
        </m.span>
      </span>
    );
  if (step === 2) return <Converting />;
  return (
    <span className="picked">
      <span className="picked-name">vacation.jpg</span>
      <FileTag name="JPG" size="1.9 MB" tone="after" />
    </span>
  );
}

/** What the site's rule asks, checked against the photo: wrong at first, then right. */
function Checks({ step }: { step: number }) {
  if (step === 0) return null;
  const passed = step >= 2;
  const items = ['JPG or PNG', 'Max 2 MB'];
  return (
    <div className="checks">
      {items.map((item, index) => (
        <m.span
          key={item}
          className={passed ? 'check pass' : 'check fail'}
          initial={step === 1 ? { opacity: 0, y: 6, scale: 0.9 } : false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...SPRING, delay: step === 1 ? 0.75 + index * 0.18 : 0 }}
        >
          <m.span
            key={passed ? 'pass' : 'fail'}
            className="check-mark"
            initial={step === 2 ? { scale: 0.4, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...SPRING, delay: step === 2 ? 1.5 + index * 0.15 : 0 }}
          >
            {passed ? '✓' : '✕'}
          </m.span>
          {item}
        </m.span>
      ))}
    </div>
  );
}

function Stage({ step }: { step: number }) {
  return (
    <div className="stage" aria-hidden="true">
      <div className="stage-bar">
        <span className="stage-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="stage-address">careers.example.com/apply</span>
      </div>
      <div className="stage-page">
        <div className="form">
          <p className="form-kicker">Application · step 2 of 3</p>
          <p className="form-title">A photo for your profile</p>
          <div className={step === 3 ? 'field accepted' : 'field'}>
            <div className="field-head">
              <span className="field-label">Profile photo</span>
              <span className="field-rule">
                {step === 1 && (
                  <m.span
                    className="rule-highlight"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
                  />
                )}
                JPG or PNG · Max 2 MB
              </span>
            </div>
            <div className="field-input">
              <span className="fake-button">Choose file</span>
              <Picked key={step} step={step} />
            </div>
            <Checks step={step} />
            <AnimatePresence>
              {step === 3 && (
                <m.p
                  className="field-ok"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.3, ease: EASE }}
                >
                  ✓ Photo added
                </m.p>
              )}
            </AnimatePresence>
          </div>
          <span className={step === 3 ? 'fake-submit ready' : 'fake-submit'}>Continue</span>
        </div>

        <AnimatePresence>
          {step === 0 && (
            <m.div
              className="sheet"
              initial={{ y: '105%' }}
              animate={{ y: ['105%', '0%', '0%', '105%'] }}
              exit={{ y: '105%' }}
              transition={{ duration: 1.9, times: [0, 0.18, 0.78, 1], ease: EASE }}
            >
              <p className="sheet-title">Photos</p>
              <div className="sheet-grid">
                <Thumb tone={1} label="IMG_2038.HEIC" />
                <m.div
                  initial={{ scale: 1 }}
                  animate={{ scale: [1, 0.94, 1] }}
                  transition={{ delay: 0.95, duration: 0.3 }}
                >
                  <Thumb tone={2} label="vacation.webp" chosen />
                </m.div>
                <Thumb tone={3} label="park.avif" />
                <Thumb tone={4} label="Screenshot.png" />
              </div>
            </m.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {step === 2 && (
            <m.div
              className="working"
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              transition={SPRING}
            >
              <Logo size={18} />
              <span>Making a copy that fits…</span>
              <span className="working-where">on this computer</span>
            </m.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {step === 3 && (
            <m.div
              className="mini-note"
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ ...SPRING, delay: 0.45 }}
            >
              {/* As on a real website: the photo itself, with the check on its corner. */}
              <span className="mini-mark">
                <span className="mini-photo tone-1" />
                <svg viewBox="0 0 32 32" fill="none">
                  <path
                    d="m10.75 16.25 3.5 3.5 7-7.5"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="mini-body">
                <b>Ready to upload</b>
                <span className="mini-receipt">
                  <FileTag name="WebP" size="2.7 MB" />
                  <Arrow />
                  <FileTag name="JPG" size="1.9 MB" tone="after" />
                </span>
              </span>
              <span className="mini-meter">
                <b>97%</b>
                <span>quality kept</span>
              </span>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function Walkthrough() {
  const [step, setStep] = useState(0);
  const [round, setRound] = useState(0);
  const area = useRef<HTMLDivElement>(null);
  const visible = useInView(area, { amount: 0.45 });
  const reduce = useReducedMotion();
  const playing = visible && !reduce;

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      setStep((current) => (current + 1) % STEPS.length);
      setRound((current) => current + 1);
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, step, round]);

  return (
    <div className="walkthrough" ref={area}>
      <ol className="steps">
        {STEPS.map((item, index) => {
          const active = index === step;
          return (
            <li key={item.title}>
              <button
                type="button"
                className={active ? 'step active' : 'step'}
                aria-current={active ? 'step' : undefined}
                onClick={() => {
                  setStep(index);
                  setRound((current) => current + 1);
                }}
              >
                <span className="step-number num">{String(index + 1).padStart(2, '0')}</span>
                <span className="step-text">
                  <span className="step-title">{item.title}</span>
                  <span className="step-detail">{item.text}</span>
                </span>
                <span className="step-progress" aria-hidden="true">
                  {active && playing && (
                    <m.span
                      key={round}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: STEP_MS / 1000, ease: 'linear' }}
                    />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="stage-wrap">
        <Stage step={step} />
        <p className="stage-caption">
          Slowed down so you can follow it. In real life it takes about a second.
        </p>
      </div>
    </div>
  );
}
