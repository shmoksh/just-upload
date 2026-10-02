import { LIMITS, processingTime } from '../security/limits';
import { errorCode, fail, ProcessingError } from '../utils/errors';
import { detectFormat, parseHeader } from './headers';
import { sanitizeRequirements } from './protocol';
import { svgRenderSize } from './svg';
import ImageWorker from './worker?worker';

// Heavy image work runs in dedicated workers owned by a hidden extension page: off the
// website's thread and stoppable at any moment. Workers stay warm between jobs (so
// decoders load once) and are terminated after a minute idle, or immediately when a
// job is cancelled or runs too long, which releases everything they allocated.

const MAX_PARALLEL = 2;
const MAX_QUEUED = 6;
const IDLE_MS = 60_000;
/** A file this large is prepared on its own: two at once could exhaust memory. */
const EXCLUSIVE_BYTES = 256 * 1024 * 1024;

export interface PoolJob {
  id: string;
  kind: 'prepare' | 'transform';
  file: Blob;
  requirements: unknown;
  options?: unknown;
  /** Results as base64 (for extension messages) rather than as files. */
  serialize: boolean;
  onProgress?: (fraction: number) => void;
}

interface PooledWorker {
  worker: Worker;
  idleTimer?: ReturnType<typeof setTimeout>;
  warmed?: boolean;
}
interface Job extends PoolJob {
  respond: (response: unknown) => void;
  stop?: () => void;
}

const idle: PooledWorker[] = [];
const running = new Map<string, Job>();
const queue: Job[] = [];

const exclusive = (job: PoolJob) => job.file.size > EXCLUSIVE_BYTES;

function takeWorker(): PooledWorker {
  const pooled = idle.pop() ?? { worker: new ImageWorker() };
  clearTimeout(pooled.idleTimer);
  return pooled;
}

function park(pooled: PooledWorker): void {
  pooled.worker.onmessage = null;
  pooled.worker.onerror = null;
  if (idle.length >= MAX_PARALLEL) {
    pooled.worker.terminate();
    return;
  }
  pooled.idleTimer = setTimeout(() => {
    idle.splice(idle.indexOf(pooled), 1);
    pooled.worker.terminate();
  }, IDLE_MS);
  idle.push(pooled);
}

/** Someone is about to pick a file: have a worker with its decoders loaded waiting. */
export function warm(): void {
  if (!idle.length && running.size < MAX_PARALLEL) park({ worker: new ImageWorker() });
  const pooled = idle.at(-1);
  if (pooled && !pooled.warmed) {
    pooled.warmed = true;
    pooled.worker.postMessage({ kind: 'warm' });
  }
}

/**
 * Workers cannot draw SVG, so this page renders it first, as an image (scripts inside
 * an SVG never run this way, and the extension's CSP blocks any external resource).
 */
async function rasterizeIfSvg(file: Blob, requirements: unknown): Promise<Blob | undefined> {
  if (detectFormat(new Uint8Array(await file.slice(0, 4096).arrayBuffer())) !== 'svg')
    return undefined;
  if (file.size > LIMITS.maxSvgBytes) fail('too-large-to-process');
  const intrinsic = parseHeader(new Uint8Array(await file.arrayBuffer()));
  const { width, height } = svgRenderSize(intrinsic, sanitizeRequirements(requirements));
  const url = URL.createObjectURL(new Blob([file], { type: 'image/svg+xml' }));
  const canvas = new OffscreenCanvas(width, height);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const context = canvas.getContext('2d');
    if (!context) fail('failed');
    context.drawImage(image, 0, 0, width, height);
    return await canvas.convertToBlob({ type: 'image/png' });
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    return fail('damaged');
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Starts as many queued jobs as memory allows, in order. */
function drain(): void {
  while (queue.length) {
    const next = queue[0]!;
    const busyWithLarge = [...running.values()].some(exclusive);
    const fits = exclusive(next)
      ? running.size === 0
      : !busyWithLarge && running.size < MAX_PARALLEL;
    if (!fits) return;
    queue.shift();
    start(next);
  }
}

function start(job: Job): void {
  let pooled: PooledWorker | undefined;
  let done = false;
  const finish = (response: unknown, reusable = false) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    // Only a worker that finished cleanly goes back to the pool.
    if (pooled && reusable) park(pooled);
    else pooled?.worker.terminate();
    running.delete(job.id);
    job.respond(response);
    drain();
  };
  const timer = setTimeout(
    () => finish({ ok: false, error: 'timeout' }),
    processingTime(job.file.size),
  );
  job.stop = () => finish({ ok: false, error: 'cancelled' });
  running.set(job.id, job);
  void (async () => {
    let raster: Blob | undefined;
    try {
      raster = await rasterizeIfSvg(job.file, job.requirements);
    } catch (error) {
      finish({ ok: false, error: errorCode(error) });
      return;
    }
    if (done) return;
    pooled = takeWorker();
    pooled.worker.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { progress?: unknown } | undefined;
      if (typeof data?.progress === 'number') job.onProgress?.(data.progress);
      else finish(event.data, true);
    };
    pooled.worker.onerror = () => finish({ ok: false, error: 'failed' });
    const { kind, file, requirements, options, serialize } = job;
    pooled.worker.postMessage({
      kind,
      file,
      requirements,
      options,
      raster,
      serialize,
    });
  })();
}

/** Runs one job; resolves with the worker's response. Never rejects. */
export function submit(job: PoolJob): Promise<unknown> {
  return new Promise((respond) => {
    if (
      running.has(job.id) ||
      queue.some((queued) => queued.id === job.id) ||
      queue.length >= MAX_QUEUED
    ) {
      respond({ ok: false, error: 'busy' });
      return;
    }
    queue.push({ ...job, respond });
    drain();
  });
}

export function cancel(id: string): void {
  running.get(id)?.stop?.();
  const index = queue.findIndex((job) => job.id === id);
  if (index >= 0) queue.splice(index, 1)[0]?.respond({ ok: false, error: 'cancelled' });
}
