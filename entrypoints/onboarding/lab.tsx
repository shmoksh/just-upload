import { AnimatePresence, m } from 'framer-motion';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  consentFor,
  DEFAULT_PREFERENCES,
  defaultCrop,
  targetRatio,
  transformOptions,
} from '../../src/decision';
import { extensionProcessor } from '../../src/images/client';
import { parseHeader } from '../../src/images/headers';
import type {
  Decision,
  FileFormat,
  FileOutput,
  ImageFormat,
  TransformResult,
  UploadRequirements,
} from '../../src/models';
import { parseText } from '../../src/requirements/text';
import { dialogCopy, formatLabel, rulesSummary } from '../../src/ui/copy';
import { FileTag, Icon } from '../../src/ui/shared';
import { errorCode } from '../../src/utils/errors';
import { formatBytes } from '../../src/utils/files';

// "Try it with your own image": the real engine, on this page. Type a rule the way a
// website words it, drop in an image, and see exactly what the website would get, pixel
// dimensions included. Nothing leaves the computer.

const PRESETS = [
  'JPG or PNG · Maximum 2 MB',
  'File size should not exceed 500 KB',
  'Images up to 1920 × 1920 pixels',
  'WebP only',
  'Square photo, 600 × 600 pixels',
];
const EASE = [0.22, 1, 0.36, 1] as const;

/** One image of each kind websites refuse, shipped with the extension. */
const SAMPLES = [
  { path: '/sample/sample.webp', name: 'vacation.webp', type: 'image/webp', label: 'WebP photo' },
  { path: '/sample/sample.heic', name: 'IMG_2041.HEIC', type: 'image/heic', label: 'HEIC photo' },
  {
    path: '/sample/sample.png',
    name: 'Screenshot.png',
    type: 'image/png',
    label: 'PNG screenshot',
  },
  { path: '/sample/sample.tif', name: 'scan.tif', type: 'image/tiff', label: 'TIFF scan' },
] as const;

interface Original {
  file: File;
  format: ImageFormat;
  width?: number;
  height?: number;
  url?: string;
}

type State =
  | { kind: 'empty' }
  | { kind: 'working' }
  | { kind: 'pass' }
  | { kind: 'kept' }
  | {
      kind: 'ask';
      title: string;
      body: string;
      confirm: string;
      run: () => void;
      /** What the website would get, if the person agrees, and a picture of it. */
      candidate?: TransformResult;
      preview: string;
    }
  | { kind: 'done'; result: TransformResult; url: string; ms: number }
  | { kind: 'failed'; message: string };

/** Formats the browser can show as a picture; a HEIC is shown from its prepared copy. */
const SHOWABLE = new Set<ImageFormat>(['jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'ico']);

async function inspect(file: File): Promise<Original> {
  const head = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  let header;
  try {
    header = parseHeader(head, { partial: true });
  } catch {
    header = undefined;
  }
  const format = header?.format ?? 'unknown';
  return {
    file,
    format,
    width: header?.width || undefined,
    height: header?.height || undefined,
    url: SHOWABLE.has(format) ? URL.createObjectURL(file) : undefined,
  };
}

const pixels = (width?: number, height?: number) =>
  width && height ? `${width} × ${height}` : '—';

function failure(error: unknown): string {
  const code = typeof error === 'string' ? error : errorCode(error);
  if (code === 'rules-conflict')
    return 'Those rules contradict each other, so nothing would be changed.';
  if (code === 'too-large-to-process')
    return 'This image is too large to prepare at its full size, so the website would get it unchanged.';
  if (code === 'damaged' || code === 'unsupported-format')
    return 'This file couldn’t be read as an image, so the website would get it unchanged.';
  if (code === 'target-unreachable')
    return 'It can’t get under that limit, even with fewer pixels, so the website would get your original.';
  return 'This one couldn’t be prepared, so the website would get your original.';
}

export function Lab() {
  const [rule, setRule] = useState(PRESETS[0]!);
  const [original, setOriginal] = useState<Original | undefined>();
  const [state, setState] = useState<State>({ kind: 'empty' });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const requirements: UploadRequirements = useMemo(() => parseText(rule), [rule]);
  const reading = rulesSummary(requirements);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => void (original?.url && URL.revokeObjectURL(original.url)), [original]);
  useEffect(
    () => () => {
      if (state.kind === 'done') URL.revokeObjectURL(state.url);
      if (state.kind === 'ask') URL.revokeObjectURL(state.preview);
    },
    [state],
  );

  // Whenever the photo or the rule changes, prepare it again (after typing pauses).
  useEffect(() => {
    if (!original) return;
    const timer = setTimeout(() => void run(original, requirements), 350);
    return () => clearTimeout(timer);
  }, [original, requirements]);

  async function run(photo: Original, rules: UploadRequirements) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ kind: 'working' });
    const started = performance.now();
    const finish = (result: TransformResult) => {
      if (current.signal.aborted) return;
      setState({
        kind: 'done',
        result,
        url: URL.createObjectURL(result.file),
        ms: Math.round(performance.now() - started),
      });
    };
    // A prepared file that needed fewer pixels, or lost visible quality, is shown with
    // the question a website would ask, and used only if the person agrees.
    const review = (result: TransformResult) => {
      if (current.signal.aborted) return;
      const consent = consentFor(result, DEFAULT_PREFERENCES);
      if (!consent) return finish(result);
      const copy = dialogCopy(
        { action: 'USER_CONFIRMATION', issues: [], consents: [consent] },
        rules,
        false,
        result.qualityKept,
        {
          format: photo.format,
          width: result.originalWidth,
          height: result.originalHeight,
          ...(result.resizedToFit
            ? { fitted: { width: result.finalWidth, height: result.finalHeight } }
            : {}),
        },
      );
      setState({
        kind: 'ask',
        title: copy.title,
        body: copy.body,
        confirm: copy.confirm,
        candidate: result,
        preview: URL.createObjectURL(result.file),
        run: () => finish(result),
      });
    };
    const apply = async (decision: Decision) => {
      const ratio = targetRatio(rules);
      const crop =
        decision.consents.includes('crop') && ratio && photo.width && photo.height
          ? defaultCrop(photo.width, photo.height, ratio)
          : undefined;
      setState({ kind: 'working' });
      try {
        review(
          await extensionProcessor.transform(
            photo.file,
            rules,
            transformOptions(decision, crop),
            current.signal,
          ),
        );
      } catch (error) {
        if (!current.signal.aborted) setState({ kind: 'failed', message: failure(error) });
      }
    };
    try {
      const outcome = await extensionProcessor.prepare(photo.file, rules, current.signal);
      if (current.signal.aborted) return;
      if (outcome.kind === 'pass') return setState({ kind: 'pass' });
      if (outcome.kind === 'unsafe')
        return setState({ kind: 'failed', message: failure(outcome.code) });
      if (outcome.kind === 'confirm') {
        const copy = dialogCopy(outcome.decision, rules, false);
        return setState({
          kind: 'ask',
          title: copy.title,
          body: [copy.body, ...copy.notes].join(' '),
          confirm: copy.confirm,
          preview: URL.createObjectURL(outcome.preview),
          run: () => void apply(outcome.decision),
        });
      }
      review(outcome.result);
    } catch (error) {
      if (!current.signal.aborted) setState({ kind: 'failed', message: failure(error) });
    }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setOriginal(await inspect(file));
  }

  async function useSample(sample: (typeof SAMPLES)[number]) {
    const response = await fetch(browser.runtime.getURL(sample.path));
    await choose(new File([await response.blob()], sample.name, { type: sample.type }));
  }

  // What the website gets, or would get if the person agrees.
  const result =
    state.kind === 'done' ? state.result : state.kind === 'ask' ? state.candidate : undefined;
  const picture =
    state.kind === 'done' ? state.url : state.kind === 'ask' ? state.preview : undefined;
  const untouched = state.kind === 'pass' || state.kind === 'kept';
  const sameSize =
    result &&
    result.finalWidth === result.originalWidth &&
    result.finalHeight === result.originalHeight;

  return (
    <div className="lab">
      <div className="lab-controls">
        <label className="lab-label" htmlFor="lab-rule">
          The website says
        </label>
        <input
          id="lab-rule"
          className="lab-rule"
          value={rule}
          maxLength={160}
          spellCheck={false}
          onChange={(event) => setRule(event.target.value)}
        />
        <div className="lab-presets" role="group" aria-label="Examples">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={preset === rule ? 'chip active' : 'chip'}
              aria-pressed={preset === rule}
              onClick={() => setRule(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
        <p className="lab-reads">
          <span>Just Upload reads</span>
          <b className="num">{reading}</b>
        </p>

        <div
          className={dragging ? 'lab-drop over' : 'lab-drop'}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void choose(event.dataTransfer.files[0]);
          }}
        >
          <Icon name="upload" size={22} />
          <p>
            <b>Drop an image here</b>
            <span>Any format, any size. It stays on this computer.</span>
          </p>
          <button type="button" className="button" onClick={() => input.current?.click()}>
            Choose an image
          </button>
          <div className="lab-samples" role="group" aria-label="Samples">
            <span>Or try a sample:</span>
            {SAMPLES.map((sample) => (
              <button
                key={sample.path}
                type="button"
                className="chip"
                onClick={() => void useSample(sample)}
              >
                {sample.label}
              </button>
            ))}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/*,.heic,.heif,.jxl"
            hidden
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="lab-result" aria-live="polite">
        <div className="compare-head">
          <span />
          <span>Your image</span>
          <span>What the website gets</span>
        </div>
        <div className="compare-thumbs">
          <span />
          {/* The browser can't show a HEIC: its prepared copy is the same picture. */}
          <Thumb url={original?.url ?? picture} format={original?.format} />
          <Thumb
            url={untouched ? (original?.url ?? undefined) : picture}
            format={result?.finalFormat ?? (untouched ? original?.format : undefined)}
            busy={state.kind === 'working'}
            pending={state.kind === 'ask'}
          />
        </div>
        <Row
          label="Format"
          before={original && <FileTag name={formatLabel(original.format)} />}
          after={
            result ? (
              <FileTag name={formatLabel(result.finalFormat)} tone="after" />
            ) : untouched && original ? (
              <FileTag name={formatLabel(original.format)} tone="after" />
            ) : undefined
          }
        />
        <Row
          label="File size"
          before={original && <span className="num">{formatBytes(original.file.size)}</span>}
          after={
            result ? (
              <span className="num">{formatBytes(result.finalSize)}</span>
            ) : untouched && original ? (
              <span className="num">{formatBytes(original.file.size)}</span>
            ) : undefined
          }
        />
        <Row
          label="Pixels"
          before={
            original && <span className="num">{pixels(original.width, original.height)}</span>
          }
          after={
            result ? (
              <span className="pixels-after">
                <span className="num">{pixels(result.finalWidth, result.finalHeight)}</span>
                <span className={sameSize ? 'badge ok' : 'badge'}>
                  {sameSize
                    ? 'Full size kept'
                    : result.resizedToFit
                      ? 'Fewer, to fit the limit'
                      : 'As the website asks'}
                </span>
              </span>
            ) : untouched && original ? (
              <span className="pixels-after">
                <span className="num">{pixels(original.width, original.height)}</span>
                <span className="badge ok">Full size kept</span>
              </span>
            ) : undefined
          }
        />
        <Row
          label="Quality"
          before={original && <span className="muted">Your original</span>}
          after={
            result ? (
              <span className={result.qualityKept < 97 ? 'num quality low' : 'num quality'}>
                {result.qualityKept}% kept
              </span>
            ) : untouched ? (
              <span className="num quality">100% kept</span>
            ) : undefined
          }
        />

        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={state.kind}
            className="lab-status"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            {state.kind === 'empty' && (
              <p className="muted">Choose an image to see what the website would get.</p>
            )}
            {state.kind === 'working' && <p className="muted">Preparing, on this computer…</p>}
            {state.kind === 'pass' && (
              <p>
                <b>Already fits.</b> The website gets your image exactly as it is: Just Upload does
                nothing.
              </p>
            )}
            {state.kind === 'kept' && (
              <p>
                <b>Kept as it is.</b> The website gets your original, unchanged.
              </p>
            )}
            {state.kind === 'failed' && <p className="lab-error">{state.message}</p>}
            {state.kind === 'ask' && (
              <div className="lab-ask">
                <p>
                  <b>{state.title}.</b> {state.body}
                </p>
                <div className="lab-actions">
                  <button type="button" className="button" onClick={state.run}>
                    {state.confirm}
                  </button>
                  <button
                    type="button"
                    className="button quiet"
                    onClick={() => setState({ kind: 'kept' })}
                  >
                    Keep my original
                  </button>
                </div>
                <p className="muted small">On a website, this is the question you would see.</p>
              </div>
            )}
            {state.kind === 'done' && (
              <div className="lab-done">
                <p>
                  <b>Ready to upload</b> · prepared in {(state.ms / 1000).toFixed(1)} s, on this
                  computer.
                </p>
                <a
                  className="button quiet small"
                  href={state.url}
                  download={state.result.file.name}
                >
                  <Icon name="download" />
                  Save the result
                </a>
              </div>
            )}
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Thumb({
  url,
  format,
  busy,
  pending,
}: {
  url?: string;
  format?: FileFormat | FileOutput;
  busy?: boolean;
  pending?: boolean;
}) {
  return (
    <span className={busy ? 'thumb-box busy' : pending ? 'thumb-box pending' : 'thumb-box'}>
      {url ? (
        <img src={url} alt="" />
      ) : format ? (
        <span className="thumb-format mono">{formatLabel(format)}</span>
      ) : null}
    </span>
  );
}

function Row({ label, before, after }: { label: string; before?: ReactNode; after?: ReactNode }) {
  return (
    <div className="compare-row">
      <span className="compare-label">{label}</span>
      <span>{before ?? <span className="ghost" />}</span>
      <span>{after ?? <span className="ghost" />}</span>
    </div>
  );
}
