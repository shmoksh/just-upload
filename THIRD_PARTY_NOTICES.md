# Third-party software

Audited on 2026-10-02 against installed package metadata (`pnpm licenses list`). All
runtime code is packaged in the extension; nothing is loaded from a CDN or the network.
The full license texts of everything that ships are generated into
`public/licenses/THIRD_PARTY_NOTICES.txt` (`pnpm notices`, run on every build) and
included in the extension package.

## Shipped in the extension

| Package                 | Version | Purpose                                                                                   | License        | Bundled where                                                           |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| react                   | 19.3.0  | UI for the popup, settings and welcome pages                                              | MIT            | Extension pages only (not in the content script)                        |
| react-dom               | 19.3.0  | Rendering for those pages                                                                 | MIT            | Extension pages only                                                    |
| scheduler               | 0.28.0  | Dependency of react-dom                                                                   | MIT            | Extension pages only                                                    |
| framer-motion           | 13.4.6  | Animation on the popup, settings and welcome pages                                        | MIT            | Extension pages only (not in the content script)                        |
| motion-dom              | 13.4.5  | Dependency of framer-motion                                                               | MIT            | Extension pages only                                                    |
| motion-utils            | 13.3.0  | Dependency of framer-motion                                                               | MIT            | Extension pages only                                                    |
| pica                    | 10.0.3  | High-quality image resizing                                                               | MIT            | Image worker                                                            |
| glur                    | 2.0.0   | Dependency of pica (unsharp mask)                                                         | MIT            | Image worker                                                            |
| multimath               | 3.0.0   | Dependency of pica (WebAssembly helpers)                                                  | MIT            | Image worker                                                            |
| libheif-js              | 1.23.2  | HEIC/HEIF decoding (libheif + libde265 compiled to WebAssembly)                           | **LGPL-3.0 ⚑** | `vendor/libheif.mjs`, a separate unmodified file                        |
| gifenc                  | 1.0.3   | Writing GIF                                                                               | MIT            | Image worker                                                            |
| utif2                   | 4.1.0   | Reading and writing TIFF                                                                  | MIT            | Image worker, loaded on demand                                          |
| pako                    | 1.0.11  | Deflate for compressed TIFF (dependency of utif2)                                         | MIT AND Zlib   | Image worker, loaded on demand                                          |
| @jsquash/avif           | 2.1.1   | Writing AVIF (libavif + libaom + libsharpyuv, WebAssembly)                                | Apache-2.0     | Image worker, loaded on demand (3.5 MB)                                 |
| @jsquash/jxl            | 1.3.0   | Reading JPEG XL (libjxl + highway + skcms + brotli, WebAssembly)                          | Apache-2.0     | Image worker, loaded on demand (0.85 MB)                                |
| pdf-lib                 | 1.17.1  | Writing PDFs and making them smaller                                                      | MIT            | Image worker, loaded on demand (0.4 MB)                                 |
| @pdf-lib/standard-fonts | 1.0.0   | Dependency of pdf-lib (font metrics)                                                      | MIT            | Image worker, loaded on demand                                          |
| @pdf-lib/upng           | 1.0.1   | Dependency of pdf-lib (reading PNG)                                                       | MIT            | Image worker, loaded on demand                                          |
| tslib                   | 1.14.1  | Dependency of pdf-lib                                                                     | 0BSD           | Image worker, loaded on demand                                          |
| pdfjs-dist              | 6.3.289 | Drawing a PDF page as an image (PDF.js)                                                   | Apache-2.0     | Extension page + `vendor/pdf.worker.min.mjs`, loaded on demand (1.7 MB) |
| xlsx                    | 0.20.3  | Reading and writing CSV and Excel files (SheetJS Community Edition, from cdn.sheetjs.com) | Apache-2.0     | Image worker, loaded on demand (0.5 MB)                                 |

**⚑ Flag: libheif-js is not MIT/BSD/Apache.** It is the only practical HEIC decoder for a
browser extension; alternatives such as heic2any bundle the same LGPL libheif. It is
kept separate and replaceable, with exact sources in `docs/decoder-source/` and the
obligations described in [docs/heic-licensing.md](docs/heic-licensing.md).

### Libraries compiled into the WebAssembly codecs

| Component                     | Inside        | License                                                   |
| ----------------------------- | ------------- | --------------------------------------------------------- |
| libheif, libde265             | libheif-js    | LGPL-3.0 (see flag above)                                 |
| libavif 1.0.1                 | @jsquash/avif | BSD-2-Clause                                              |
| libaom                        | @jsquash/avif | BSD-2-Clause + Alliance for Open Media Patent License 1.0 |
| libsharpyuv (part of libwebp) | @jsquash/avif | BSD-3-Clause + Google patent grant                        |
| libjxl                        | @jsquash/jxl  | BSD-3-Clause + patent grant                               |
| highway                       | @jsquash/jxl  | Apache-2.0 or BSD-3-Clause                                |
| skcms                         | @jsquash/jxl  | BSD-3-Clause                                              |
| brotli                        | @jsquash/jxl  | MIT                                                       |

Their license and patent-grant texts are kept in `docs/licenses/` and included in the
shipped notices file. Only the single-threaded AVIF encoder is packaged; the
multi-threaded builds and the JPEG XL encoder are never bundled.

No GPL-only or AGPL code is used.

## Development and test only (never shipped)

| Package                                                  | Version                | Purpose                                                          | License    |
| -------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------- | ---------- |
| wxt                                                      | 0.21.4                 | Extension build framework                                        | MIT        |
| @wxt-dev/module-react                                    | 1.2.2                  | React support for WXT                                            | MIT        |
| vite                                                     | 8.3.1                  | Bundler (test page)                                              | MIT        |
| typescript                                               | 6.0.3                  | Type checking                                                    | Apache-2.0 |
| vitest                                                   | 5.0.2                  | Unit tests                                                       | MIT        |
| happy-dom                                                | 20.14.5                | DOM for unit tests                                               | MIT        |
| @playwright/test                                         | 1.63.0                 | End-to-end tests                                                 | Apache-2.0 |
| eslint, @eslint/js                                       | 10.11.0, 10.0.1        | Linting                                                          | MIT        |
| typescript-eslint                                        | 8.70.1                 | TypeScript lint rules                                            | MIT        |
| prettier                                                 | 3.9.9                  | Formatting                                                       | MIT        |
| @types/node, @types/react, @types/react-dom, @types/pica | various                | Type definitions                                                 | MIT        |
| react-dropzone, filepond, dropzone                       | 20.1.2, 4.32.12, 6.3.5 | Real upload libraries on the local test page (`/libraries.html`) | MIT        |

## Assets

- **Logo and icons** (`public/logo.svg`, `public/icons/`): original work for this project.
- **Sample and test images** (`public/sample/`, `tests/fixtures/`): procedurally drawn for
  this project (gradients, shapes and text, from a fixed random seed) and encoded with
  macOS `sips` or the browser; original work with no third-party rights. See
  [tests/fixtures/README.md](tests/fixtures/README.md).
- **Grain texture** (`public/textures/grain.svg`): original work for this project, a few
  lines of SVG noise.
- **Font: Instrument Serif** (`public/fonts/instrument-serif-*.woff2`), © 2022 The
  Instrument Serif Project Authors, under the **SIL Open Font License 1.1**
  ([docs/licenses/InstrumentSerif-OFL.txt](docs/licenses/InstrumentSerif-OFL.txt)): the
  Latin and Latin Extended subsets (WOFF2) published by Google Fonts (v5), downloaded once
  and packaged in the extension. It sets headings and large figures on the extension's own
  pages (welcome, settings, popup) and is never loaded on websites, where the note and
  questions use the system font. Its copyright notice and license ship in
  `public/licenses/THIRD_PARTY_NOTICES.txt`, as the OFL requires. Everything else uses
  the system font. Its
  copyright notice and license ship in `public/licenses/THIRD_PARTY_NOTICES.txt`, as the
  OFL requires. Everything else uses the system font.
