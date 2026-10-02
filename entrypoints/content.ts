import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { Settings } from '../src/models';
import { guessFormat } from '../src/compatibility';
import { extensionProcessor, warmProcessor } from '../src/images/client';
import {
  DEFAULT_SETTINGS,
  frameHostnames,
  loadSettings,
  normalizeSettings,
  SETTINGS_KEY,
} from '../src/settings';
import { rulesSummary } from '../src/ui/copy';
import { pageUi } from '../src/ui/injected';
import { installInterceptor } from '../src/upload/interceptor';

// Runs in every frame from document_start so its capture listeners come before any
// page script. Startup is a few listeners and one storage read; nothing touches the
// DOM or any image until a person actually picks a file.
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  main(ctx) {
    let settings: Settings = { ...DEFAULT_SETTINGS };
    const hostnames = frameHostnames();
    let lastWarm = 0;
    const dispose = installInterceptor({
      settings: () => settings,
      hostnames: () => hostnames,
      processor: extensionProcessor,
      ui: pageUi,
      warm: () => {
        // At most one warm-up request every 20 seconds per page.
        if (Date.now() - lastWarm < 20_000) return;
        lastWarm = Date.now();
        warmProcessor();
      },
      onProblem: (code, files, requirements) => {
        const file = files[0];
        if (!file) return;
        // Technical details only; never a file name or this website's address.
        const problem = {
          at: new Date().toISOString(),
          code,
          format: guessFormat(file),
          bytes: file.size,
          rules: rulesSummary(requirements),
        };
        void browser.runtime
          .sendMessage({ target: 'background', kind: 'problem', problem })
          .catch(() => {});
      },
      onFixed: (results) => {
        const changes = results.map((result) => result.changes);
        void browser.runtime
          .sendMessage({ target: 'background', kind: 'fixed', changes })
          .catch(() => {});
      },
    });
    void loadSettings()
      .then((value) => {
        settings = value;
      })
      .catch(() => {});
    const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && changes[SETTINGS_KEY])
        settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    };
    browser.storage.onChanged.addListener(onStorage);
    ctx.onInvalidated(() => {
      dispose();
      browser.storage.onChanged.removeListener(onStorage);
    });
  },
});
