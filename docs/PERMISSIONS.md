# Permissions, in plain English

Just Upload asks for as little as it can while still working the moment you pick a file,
on any website, without setup.

| What the browser shows                      | Manifest entry                                            | Why Just Upload needs it                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Read and change your data on all websites" | `content_scripts` matching `http://*/*` and `https://*/*` | Upload fields can be on any website, so a small script has to be present before you choose a file. It only looks at an upload field and the hint text beside it, and only after you choose or drop a file there. It changes one thing: it puts the prepared file into that upload field. |
| _(not shown)_                               | `storage`                                                 | Saves your settings, paused sites, a count of fixed files and up to 20 problem notes (no files, file names or websites) on your device. Nothing else is stored, and nothing leaves your device.                                                                                          |
| _(not shown)_                               | `web_accessible_resources`: `processor.html`, dynamic URL | Lets Just Upload add its own hidden frame to the tab you're uploading in. The image work runs there, in background workers, so websites don't slow down, a file of several GB never has to be copied, and the work can be stopped instantly. The website cannot look inside the frame.   |
| _(not shown)_                               | `offscreen`                                               | A fallback for pages that block Just Upload's frame: a hidden extension page runs the same image work instead, for files up to 40 MB.                                                                                                                                                    |
| _(not shown)_                               | `activeTab`                                               | When you open the toolbar popup, lets it see which website you're on, so it can offer "pause on this site". It gives no access until you click the icon, and only to that tab.                                                                                                           |

## Details that matter

- **Why run on every site instead of asking per site?** Asking for access site by site
  would mean a permission prompt the first time you upload anywhere, which defeats the
  point of an extension that just works. You can still restrict it: in
  `chrome://extensions` → Just Upload → _Site access_, choose _On specific sites_ or
  _On click_.
- **`document_start` and all frames.** The script must register before the website's
  own code so it can hold the original file back while it prepares the copy, and it must
  run inside embedded frames because many upload widgets live in iframes. At startup it
  adds a few event listeners and reads your settings. It does not scan or modify pages.
- **What the content script can see.** Only the `<input type="file">` you used (or the
  one belonging to the area you dropped files on), its
  `accept`, `aria-*`, `title` and `data-max-*` attributes, its label, and the short text
  around it (at most 1,500 characters, skipping scripts and styles). Never form values,
  passwords, cookies or the rest of the page.
- **The hidden frame.** Only when you open an image picker, drag a file over the page or
  choose an image that needs work does Just Upload add a hidden
  `<just-upload-processor>` element, holding a frame of its own page in a closed shadow
  root. Files are handed to it over a private message channel, opened with a one-time
  code from the background service worker, and the frame only accepts that channel when
  the code is right. Its address changes every browser session (`use_dynamic_url`,
  Chrome 130 and later), so a website cannot probe for it to detect the extension. It
  goes away after a minute unused.
- **Content Security Policy.** Extension pages use
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`.
  `'wasm-unsafe-eval'` lets the packaged image codecs (WebAssembly: HEIC, AVIF, JPEG XL)
  compile. It does not
  allow JavaScript `eval`. `default-src 'self'` means extension pages cannot connect to
  any server.
- **Not requested:** `tabs`, `history`, `webRequest`, `downloads`, `clipboardRead`,
  `clipboardWrite`, `scripting`, `unlimitedStorage`, `host_permissions`, or any
  optional permissions.
