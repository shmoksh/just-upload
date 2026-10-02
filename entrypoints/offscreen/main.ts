import { browser } from 'wxt/browser';
import { cancel, submit, warm } from '../../src/images/pool';
import { deserializeFile } from '../../src/utils/files';

// The fallback path, for sites where Just Upload's own frame cannot be added (see
// src/images/frame.ts): jobs arrive as extension messages, with files as base64.

browser.runtime.onMessage.addListener(
  (message: Record<string, unknown> | undefined, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || sender.tab || message?.target !== 'offscreen') return;
    // Lets the background tell a busy page from a stuck one.
    if (message.kind === 'ping') {
      sendResponse({ ok: true });
      return;
    }
    if (message.kind === 'warm') {
      warm();
      return;
    }
    if (typeof message.id !== 'string') return;
    const id = message.id;
    if (message.kind === 'cancel') {
      cancel(id);
      return;
    }
    if (message.kind !== 'prepare' && message.kind !== 'transform') return;
    let file: File;
    try {
      file = deserializeFile(message.file);
    } catch {
      sendResponse({ ok: false, error: 'failed' });
      return;
    }
    void submit({
      id,
      kind: message.kind,
      file,
      requirements: message.requirements,
      options: message.options,
      serialize: true,
    }).then(sendResponse);
    return true;
  },
);
