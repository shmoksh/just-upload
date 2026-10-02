# Privacy

**Your images, PDFs and spreadsheets are processed on your device. Just Upload does not
upload them to its own
servers. It has no servers.**

This page describes how the extension handles data. The store-ready privacy policy is in
[docs/privacy-policy.md](docs/privacy-policy.md).

## What is processed, and where

When you choose a file in a website's upload field, or drop one on its upload area,
Just Upload reads:

- **The file you chose**, to check its format, size and dimensions and, if the website
  needs it, to prepare a compatible copy. This happens inside your browser, on your
  computer: in a hidden Just Upload frame added to the tab (an extension page that the
  website cannot look into) and in background workers it starts.
- **The upload field and the text right next to it** (its `accept` attribute, label and
  hint text such as "JPG or PNG, max 2 MB"), to learn what the website accepts. It never
  reads the rest of the page, form values or anything you type.

The prepared file goes only to the website you chose, exactly as your original would
have. Nothing is sent anywhere else.

## What is stored

Only on your device, in the extension's local storage:

- Your settings (on/off switches and any sites where you paused Just Upload).
- A count of files fixed, by kind (converted, resized, made smaller, cropped), plus a
  count for the current browser session.
- Up to 20 **problem notes**, one for each file that could not be prepared: when it
  happened, what went wrong (for example "the file could not be read"), the file's
  format and its size rounded to two figures, and the upload field's rules in Just
  Upload's own words (for example "JPG · max 2 MB").

Just Upload never stores files, file names, website addresses, page text or upload
history. Prepared files exist only in memory for as long as it takes to hand them to
the website.

## What is never transmitted

No images, file names, website addresses, page content, upload requirements, image
dimensions, usage statistics or behaviour. There is no analytics, telemetry, crash
reporting or remote logging. Problem notes stay on your device: Settings → Problems can
turn them into a report, which leaves your device only if you copy it and send it
yourself.

This is enforced, not just promised:

- The extension contains no code that sends data to a server, and loads no remote code.
- Its Content Security Policy (`default-src 'self'`) blocks its own pages and worker from
  connecting to any server.
- It works fully offline once installed.

## Permissions

See [docs/PERMISSIONS.md](docs/PERMISSIONS.md) for a plain-English explanation of each
permission.

## Deleting your data

- **Counts:** Settings → Files fixed → Reset.
- **Problem notes:** Settings → Problems → Clear notes.
- **Paused sites:** Settings → Paused sites → Resume.
- **Everything:** uninstalling the extension removes all of its stored data.

Your original files are never modified; Just Upload always works on a copy.
