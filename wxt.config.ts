import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

// The HEIC decoder (LGPL-3.0) ships as a separate, unmodified, replaceable file.
// See docs/heic-licensing.md before changing how it is packaged.
const heifDecoder = fileURLToPath(
  new URL('./node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs', import.meta.url),
);

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifestVersion: 3,
  manifest: {
    name: 'Just Upload',
    description:
      'Makes image uploads just work. Converts any image format and fits size limits on your device when a website needs it.',
    minimum_chrome_version: '116',
    permissions: ['storage', 'offscreen', 'activeTab'],
    icons: { 16: '/icons/16.png', 32: '/icons/32.png', 48: '/icons/48.png', 128: '/icons/128.png' },
    action: {
      default_title: 'Just Upload',
      default_icon: { 16: '/icons/16.png', 32: '/icons/32.png' },
    },
    // The content script places this page in a website as a hidden frame and hands it
    // files by reference (src/images/frame.ts). A dynamic URL changes every session, so
    // a website cannot probe for it to detect the extension.
    web_accessible_resources: [
      {
        resources: ['processor.html'],
        matches: ['http://*/*', 'https://*/*'],
        use_dynamic_url: true,
      },
    ],
    content_security_policy: {
      extension_pages:
        // Everything is packaged: nothing may load from or connect to anywhere else.
        // wasm-unsafe-eval lets the bundled HEIC decoder compile; it does not allow eval.
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'",
    },
  },
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      files.push({ absoluteSrc: heifDecoder, relativeDest: 'vendor/libheif.mjs' });
    },
  },
  // No source maps in the store build (smaller, nothing extra to review); Chrome
  // supports modulepreload natively, so Vite's fetch-based polyfill is not needed.
  vite: () => ({
    build: { sourcemap: false, modulePreload: { polyfill: false } },
    worker: { format: 'es' },
  }),
});
