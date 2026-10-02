# Changelog

All notable changes to Just Upload. Versions follow the `version` in package.json, which
is also the version people see in the store and on the settings page.

## 1.0.0 (not yet released)

The first public release.

### What it does

- **Makes picky upload fields accept your image.** When a website can't take an image
  as it is, Just Upload prepares a copy that fits on your device (converted, resized or
  made smaller) and hands that to the website instead. Images that already fit are never
  touched and never delayed.
- **Reads the website's own rules** from the upload field and the words next to it,
  however they are worded: "JPG or PNG, max 2 MB", "File size should not exceed 500KB",
  "Image upto 2MB", "Photo size should be between 20 KB and 50 KB", "600 × 600 pixels",
  "Please save your file as a TIFF" and 141 tested phrasings in all.
- **Keeps your photo's pixel size** unless the website states one. A file-size limit is
  met with quality alone; a photo that can't fit at its full size goes to the website
  unchanged, with a note.
- **Minimum file sizes too**, as exam and government forms ask ("between 20 KB and
  50 KB"): a file that is too small is saved in more detail, or padded with bytes image
  readers skip, without changing its pixels.
- **Every common format.** Reads JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, ICO, HEIC/HEIF,
  SVG and JPEG XL. Writes JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP and ICO.
- **Very large images, up to 5 GB.** JPEG, PNG, TIFF (including BigTIFF) and BMP files
  of any size are read in a stream and shrunk while they are read, so gigapixel scans
  and panoramas fit the pixel size a website states. Other formats work up to 512 MB.
- **Says how much quality was kept.** Every note shows it, for example "Quality kept:
  98%". When a size limit would keep less than 97%, Just Upload asks first.
- **Colours stay true.** Photos in Display P3, Adobe RGB and other colour spaces are
  converted, so they look the same on the website.
- **Asks before changing what an image shows:** cropping, filling a transparent
  background, turning an animation into a still image, enlarging, and saving as GIF.
- **Upload buttons and drag and drop**, including React Dropzone, FilePond and
  Dropzone.js.
- **Fails safe.** If anything goes wrong, the website gets your original file, exactly
  as if Just Upload were not installed.
- **Problem notes.** When an image can't be prepared, a short technical note (no images,
  file names or website addresses) is kept on your device. Settings → Problems turns
  them into a report you can copy and send.

### Design

- **A note that shows the change at a glance:** "HEIC 3.1 MB → JPG 1.8 MB", with the
  quality kept beside it. "Preparing…" turns into the result in place, and the countdown
  pauses while you point at it.
- **Questions that say who is asking**, with a quality scale that marks where a copy
  starts to look different.
- **A welcome page that shows how it works**, step by step, on a real-looking form, and
  lets you try it with your own photo and the website's own wording, showing exactly
  what the website would get, down to the pixels.
- **Green and white, or black and green**, following the computer's light or dark
  setting on every screen: the note on websites, questions, popup, settings and welcome
  page. A leaf green for "accepted", amber or red only where something needs attention.
- **The note shows your photo**: the prepared image itself, with a green check on its
  corner, so you see at a glance which photo is ready.
- **A calmer popup and settings page.**

### Privacy

- Images are prepared on your device and go only to the website you chose.
- No servers, accounts, analytics or telemetry. The extension's own pages cannot
  connect to the internet.
