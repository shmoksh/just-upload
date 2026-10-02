import { browser } from 'wxt/browser';

// The content script's side of the in-page processor (entrypoints/processor). Files are
// posted to it over a private MessageChannel, by reference, so a 5 GB scan is never
// copied; the extension's message system would need it as base64, which caps a file at
// about 40 MB. If the frame cannot be added or does not answer, callers fall back to
// that message path.

/** How long the frame may take to load and answer before falling back. */
const CONNECT_MS = 5_000;
/** The frame, and the workers in it, go away after this long unused. */
const IDLE_MS = 60_000;
/** After a failed attempt, the message path is used for a while before trying again. */
const RETRY_MS = 60_000;
/**
 * While jobs run, the frame is pinged this often, and two unanswered pings in a row mean
 * it is gone. A frame whose process crashed (out of memory on a huge image) or that a
 * page removed never answers; without this, its jobs would wait for their full time
 * limit, minutes for a large scan.
 */
const HEARTBEAT_MS = 3_000;

export interface JobMessage {
  kind: 'prepare' | 'transform';
  id: string;
  file: Blob;
  [field: string]: unknown;
}

export interface ProcessorFrame {
  /** Runs a job; resolves with the processor's response, or undefined if the frame went away. */
  run(message: JobMessage, progress?: (fraction: number) => void): Promise<unknown>;
  cancel(id: string): void;
  warm(): void;
}

interface Pending {
  resolve(response: unknown): void;
  progress?: (fraction: number) => void;
}

class Link implements ProcessorFrame {
  private readonly pending = new Map<string, Pending>();
  private idleTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private unanswered = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly port: MessagePort,
  ) {
    port.onmessage = ({ data }: MessageEvent<Record<string, unknown> | undefined>) => {
      if (data?.kind === 'pong') {
        this.unanswered = 0;
        return;
      }
      const entry = typeof data?.id === 'string' ? this.pending.get(data.id) : undefined;
      if (!entry || typeof data?.id !== 'string') return;
      if (typeof data.progress === 'number') {
        entry.progress?.(data.progress);
        return;
      }
      this.pending.delete(data.id);
      entry.resolve(data.response);
      this.idle();
    };
    this.idle();
  }

  get alive(): boolean {
    return this.host.isConnected;
  }

  run(message: JobMessage, progress?: (fraction: number) => void): Promise<unknown> {
    clearTimeout(this.idleTimer);
    this.watch();
    return new Promise((resolve) => {
      this.pending.set(message.id, { resolve, progress });
      this.port.postMessage(message);
    });
  }

  cancel(id: string): void {
    this.port.postMessage({ kind: 'cancel', id });
    this.pending.get(id)?.resolve({ ok: false, error: 'cancelled' });
    this.pending.delete(id);
    this.idle();
  }

  warm(): void {
    this.port.postMessage({ kind: 'warm' });
    this.idle();
  }

  /** Pings the frame while jobs run; a frame that stops answering is closed, failing them. */
  private watch(): void {
    if (this.heartbeat) return;
    this.unanswered = 0;
    this.heartbeat = setInterval(() => {
      if (this.unanswered >= 2 || !this.alive) {
        this.close();
        return;
      }
      this.unanswered++;
      this.port.postMessage({ kind: 'ping' });
    }, HEARTBEAT_MS);
  }

  private idle(): void {
    clearTimeout(this.idleTimer);
    if (this.pending.size) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.idleTimer = setTimeout(() => this.close(), IDLE_MS);
  }

  close(): void {
    clearTimeout(this.idleTimer);
    clearInterval(this.heartbeat);
    this.port.close();
    this.host.remove();
    for (const entry of this.pending.values()) entry.resolve(undefined);
    this.pending.clear();
    if (current === this) connection = undefined;
  }
}

let connection: Promise<Link | undefined> | undefined;
let current: Link | undefined;
let failedAt = 0;

async function connect(): Promise<Link | undefined> {
  const reply = (await browser.runtime
    .sendMessage({ target: 'background', kind: 'processor-token' })
    .catch(() => undefined)) as { token?: unknown } | undefined;
  if (typeof reply?.token !== 'string') return undefined;
  // A closed shadow root keeps the frame out of the page's way.
  const host = document.createElement('just-upload-processor');
  host.style.setProperty('display', 'none', 'important');
  const frame = document.createElement('iframe');
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.src = browser.runtime.getURL('/processor.html');
  host.attachShadow({ mode: 'closed' }).append(frame);
  const loaded = new Promise<boolean>((resolve) => {
    frame.addEventListener('load', () => resolve(true), { once: true });
    setTimeout(() => resolve(false), CONNECT_MS);
  });
  document.documentElement.append(host);
  const target = (await loaded) ? frame.contentWindow : null;
  if (!target) {
    host.remove();
    return undefined;
  }
  const channel = new MessageChannel();
  const ready = new Promise<boolean>((resolve) => {
    channel.port1.onmessage = ({ data }: MessageEvent<{ kind?: unknown } | undefined>) =>
      resolve(data?.kind === 'ready');
    setTimeout(() => resolve(false), CONNECT_MS);
  });
  // Addressed to the extension's own origin: if a page swapped the frame for another
  // document, the token and channel go nowhere.
  target.postMessage(
    { type: 'just-upload-connect', token: reply.token },
    `chrome-extension://${browser.runtime.id}`,
    [channel.port2],
  );
  if (!(await ready)) {
    channel.port1.close();
    host.remove();
    return undefined;
  }
  return new Link(host, channel.port1);
}

/** The in-page processor, connected on first use; undefined when it is unavailable. */
export function processorFrame(): Promise<ProcessorFrame | undefined> {
  if (current && !current.alive) current.close();
  if (!connection) {
    if (Date.now() - failedAt < RETRY_MS) return Promise.resolve(undefined);
    connection = connect().then(
      (link) => {
        current = link;
        if (!link) {
          failedAt = Date.now();
          connection = undefined;
        }
        return link;
      },
      () => {
        failedAt = Date.now();
        connection = undefined;
        return undefined;
      },
    );
  }
  return connection;
}
