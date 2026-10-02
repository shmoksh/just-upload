import { browser } from 'wxt/browser';
import { cancel, submit, warm } from '../../src/images/pool';

// A hidden extension page that Just Upload's content script places in the website, so a
// file is handed over by reference and the result comes back the same way: a 5 GB scan
// is never copied. Its workers run in the extension's process, not the website's.
//
// A website could embed this page too, so it takes work only over a channel the
// background vouches for, with a one-time token that only the content script can get.

window.addEventListener('message', (event) => {
  const port = event.ports[0];
  const data = event.data as { type?: unknown; token?: unknown } | undefined;
  if (!port || data?.type !== 'just-upload-connect' || typeof data.token !== 'string') return;
  void connect(port, data.token);
});

async function connect(port: MessagePort, token: string): Promise<void> {
  const verdict = (await browser.runtime
    .sendMessage({ target: 'background', kind: 'processor-verify', token })
    .catch(() => undefined)) as { ok?: boolean } | undefined;
  if (verdict?.ok !== true) {
    port.close();
    return;
  }
  port.onmessage = ({ data }: MessageEvent<Record<string, unknown> | undefined>) => {
    // The content script checks this page is still alive while its jobs run.
    if (data?.kind === 'ping') {
      port.postMessage({ kind: 'pong' });
      return;
    }
    if (data?.kind === 'warm') {
      warm();
      return;
    }
    const id = data?.id;
    if (typeof id !== 'string') return;
    if (data?.kind === 'cancel') {
      cancel(id);
      return;
    }
    if ((data?.kind !== 'prepare' && data?.kind !== 'transform') || !(data.file instanceof Blob))
      return;
    void submit({
      id,
      kind: data.kind,
      file: data.file,
      requirements: data.requirements,
      options: data.options,
      serialize: false,
      onProgress: (progress) => port.postMessage({ id, progress }),
    }).then((response) => port.postMessage({ id, response }));
  };
  port.postMessage({ kind: 'ready' });
}
