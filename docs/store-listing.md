# Store listing (draft)

Copy for the Chrome Web Store and Microsoft Edge Add-ons. It avoids claiming that every
website will work, because some upload widgets cannot be helped (see "Good to know").

## Name

Just Upload

## Short description (132 characters max)

Fixes files websites refuse: images, PDFs, CSV and Excel. Converts and fits size limits, right on your device.

_(110 characters)_

## Category

Productivity (Chrome Web Store) · Productivity (Edge Add-ons)

## Detailed description

Ever picked a file to upload and got "Unsupported file type" or "File too large"?
Just Upload fixes that before the website even sees your file.

Keep uploading the way you always do. When you choose a file, Just Upload checks what
the website accepts. If it already fits, nothing happens at all. If it doesn't,
Just Upload prepares a compatible copy on your device and hands that to the website
instead, and a small note tells you what changed.

WHAT IT FIXES AUTOMATICALLY
• Any format a site refuses → the one it accepts: WebP, AVIF, HEIC, TIFF, BMP, GIF, SVG,
ICO and JPEG XL become JPG, PNG or whatever the site asks for, and back
• Files that are too large → smaller files at the same pixel size, keeping as much
quality as possible; if a photo truly needs fewer pixels, it asks first
• Files under a minimum size, as exam and government forms ask → brought up to it
• Images bigger than the pixel size a site states → resized to fit, never stretched
• Formats a site asks for in words, like "Please save your file as a TIFF"
• Favicons: any image → a proper .ico
• Huge scans and panoramas, up to 5 GB → the pixel size the site states
• Photos and scans where a site takes only PDF → a one-page PDF
• PDFs over a size limit → a smaller PDF, text untouched
• PDFs where a site takes only images → a JPG or PNG of the page
• Excel workbooks where a site takes only CSV → CSV, and CSV → Excel

WHAT IT ASKS ABOUT FIRST
• Cropping, for example when a site needs a square profile photo
• Filling a transparent background with white for JPG-only sites
• Turning an animation into a still image
• Saving a photo as a GIF, which can show only 256 colours
• Enlarging a small image
• Making a file smaller when it would keep less than 97% of your photo's quality
• Using only the first page of a PDF, or the first sheet of a workbook

TELLS YOU WHAT IT DID
A short note says what changed and how much of your photo's quality was kept, for
example "WebP → JPG · Quality kept: 97%". Colours stay true, including wide-colour photos
from phones and cameras.

PRIVATE BY DESIGN
• Images are processed on your device and never uploaded to us. Just Upload has no
servers at all.
• No account, no sign-in, no tracking, no analytics.
• Works offline. Your original files are never changed.

NOTHING TO LEARN
There are no settings to understand. Just Upload stays out of the way until a website
needs its help, and does nothing otherwise.

GOOD TO KNOW
• Works with upload buttons and drag-and-drop areas on most websites, including modern
apps built with popular upload widgets. Pasting images isn't supported yet.
• Just Upload reads a website's own rules, however they are worded ("JPG or PNG, max
2 MB", "File size should not exceed 500KB", "between 20 KB and 50 KB"). If a site
enforces a rule it never states, Just Upload can't know about it, and your file is
passed along unchanged.
• Your photo keeps its pixel size unless the website states one. If it can't fit a
size limit at full size, Just Upload asks before using fewer pixels, only as few as fit;
say no and the website gets your original.
• Reads JPG, PNG, WebP, AVIF, GIF, TIFF, BMP, ICO, HEIC, HEIF, SVG and JPEG XL, and
writes JPG, PNG, WebP, AVIF, GIF, TIFF, BMP and ICO.
• Images up to 5 GB in JPG, PNG, TIFF and BMP, and up to 512 MB in other formats.
• If an image can't be prepared, the website gets your original file, and Settings →
Problems has a short report you can send us. It never includes your images or the
websites you use.

## Single purpose statement

Just Upload makes files that a person selects in, or drops on, a website's upload field
(images, PDFs, CSV and Excel files) compatible with that field's stated format, size and
dimension requirements, by converting, resizing or compressing a copy locally before the
website receives it.

## Screenshots (1280 × 800)

Ready in [docs/store/screenshots/](store/screenshots/), captured from the real extension
on a neutral demo page with `pnpm build && pnpm screenshots`:

1. `1-ready-to-upload.png`: a 2.2 MB WebP photo on a "JPG or PNG · Maximum 2 MB" field,
   with "Ready to upload · WebP 2.2 MB → JPG 1.9 MB", the photo, and 97% quality kept as
   a ring.
2. `2-square-crop.png`: "This site needs a square photo".
3. `3-transparent-logo.png`: "This site only accepts JPG".
4. `4-popup.png`: "Automatic fixing · On · only when a site needs it", with the counts and
   "Files never leave this computer".
5. `5-welcome.png`: the welcome page: "Uploads that just work.", with a WebP photo the
   website refused, stamped "Accepted" as a JPG at full size with 97% quality kept, and
   tabs for PNG, PDF and Excel.

## Small promo tile (440 × 280, required)

[docs/store/promo-440x280.png](store/promo-440x280.png): the logo, "Just Upload" in the
serif of the extension's pages, and "Uploads that just work." Made by `pnpm screenshots`.

## Privacy practices answers (Chrome Web Store)

- Data collected: **none** in every category.
- "I certify that ... not sold to third parties / not used for unrelated purposes / not
  used for creditworthiness": yes.
- Remote code: **No**, all code is packaged in the extension.
- Privacy policy URL: publish [docs/privacy-policy.md](privacy-policy.md) at a public URL
  (for example GitHub Pages) and use that link.
