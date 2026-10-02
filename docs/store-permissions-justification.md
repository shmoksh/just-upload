# Permission justifications for store review

Paste-ready answers for the Chrome Web Store "Privacy practices" tab and Edge Add-ons
certification notes.

## Single purpose

Just Upload makes files a person selects in (or drops on) a website's upload field
(images, PDFs, CSV and Excel files) compatible with that field's stated requirements
(format, file size, dimensions), converting or resizing a copy on the device before the
website receives it.

## Host access: content script on `http://*/*` and `https://*/*`

The extension must be present on a page before the person chooses a file, so that it
can hold back an incompatible file while it prepares a compatible copy. Upload fields
can appear on any website, and requiring a separate grant for each site would break the
extension's purpose of working without setup. The content script only reads the
selected file input, its attributes and the short hint text next to it, and only after
the person selects a file there. It does not read other page content, form values or
browsing history, and it sends nothing off the device. Users can limit site access in
the browser's extension settings.

## `storage`

Stores the user's settings (on/off switches, paused sites), a local count of fixed
files, and up to 20 technical notes about files that could not be prepared (the date,
an error code, the file format, its size rounded to two figures, and the field's
rules), which the user can copy into a problem report from the settings page. No
files, file names or website addresses are stored, and nothing is sent anywhere.

## Web accessible resource: `processor.html` (with `use_dynamic_url`)

The content script adds this extension page as a hidden iframe (inside a closed shadow
root) to the tab where the person is uploading, and hands it the chosen file over a
`MessageChannel`, by reference. The page runs decoding, resizing and encoding in Web
Workers. Passing the file by reference lets very large images (scans and panoramas up to
5 GB) be processed without copying them through extension messaging, which is limited to
64 MB. The channel is only accepted with a one-time token issued by the background
service worker. `use_dynamic_url` (Chrome 130 and later) means websites cannot probe for
the resource to detect the extension. The page runs under the extension CSP and cannot
connect to any server.

## `offscreen`

A fallback for pages where the hidden frame cannot be added. Creates an offscreen
document (reasons `WORKERS` and `BLOBS`) that runs the same work in Web Workers,
for files up to 40 MB sent as extension messages. This keeps heavy work off the
website's main thread and lets the extension stop a job immediately if the person picks
a different file or leaves the page.

## `activeTab`

Lets the toolbar popup read the current tab's hostname when the user opens it, to offer
"pause on this site". No access is granted until the user clicks the extension icon.

## Remote code

None. All JavaScript and WebAssembly (including the HEIC decoder, the AVIF encoder and
the JPEG XL decoder) is packaged in the extension. The extension-page CSP is
`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`.
`'wasm-unsafe-eval'` is required only to compile the packaged WebAssembly codecs.
There is no `eval` or `new Function` anywhere in the package.

## Data usage disclosures

The extension does not collect or transmit any user data. Files are processed locally
and passed only to the website the user chose. No analytics or telemetry. Problem notes
stay on the device unless the user copies a report and sends it themselves.

## Notes for reviewers: how to test

1. Load the extension, open any page with `<input type="file" accept="image/jpeg">`,
   and select a `.heic` photo (a sample is included in the package at
   `sample/sample.heic`). The page receives a `.jpg`, and a "Ready to upload" note
   appears.
2. Select a normal small `.jpg` on the same field: nothing happens, no note.
3. The welcome page (opened on install) has a "Try it" section: under "Or try a sample",
   choose "HEIC photo" to see the conversion without any website.
4. On a field with `accept="image/jpeg"` and the hint "Max 500 KB", select a large
   camera photo: a question offers a copy with fewer pixels that fits; "Use original"
   gives the page the original file.
