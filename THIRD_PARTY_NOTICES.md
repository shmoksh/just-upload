# Third-party software

Audited on 2026-10-02. Everything Just Upload uses is packaged in the extension; nothing
is loaded from the network. The full license text of each component ships inside the
extension, in `licenses/THIRD_PARTY_NOTICES.txt`.

## Shipped in the extension

| Package                 | Version | Purpose                                                                                   | License        |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------- | -------------- |
| react                   | 19.3.0  | UI for the popup, settings and welcome pages                                              | MIT            |
| react-dom               | 19.3.0  | Rendering for those pages                                                                 | MIT            |
| scheduler               | 0.28.0  | Dependency of react-dom                                                                   | MIT            |
| framer-motion           | 13.4.6  | Animation on the popup, settings and welcome pages                                        | MIT            |
| motion-dom              | 13.4.5  | Dependency of framer-motion                                                               | MIT            |
| motion-utils            | 13.3.0  | Dependency of framer-motion                                                               | MIT            |
| pica                    | 10.0.3  | High-quality image resizing                                                               | MIT            |
| glur                    | 2.0.0   | Dependency of pica (unsharp mask)                                                         | MIT            |
| multimath               | 3.0.0   | Dependency of pica (WebAssembly helpers)                                                  | MIT            |
| libheif-js              | 1.23.2  | HEIC/HEIF decoding (libheif + libde265 compiled to WebAssembly)                           | **LGPL-3.0 ⚑** |
| gifenc                  | 1.0.3   | Writing GIF                                                                               | MIT            |
| utif2                   | 4.1.0   | Reading and writing TIFF                                                                  | MIT            |
| pako                    | 1.0.11  | Deflate for compressed TIFF (dependency of utif2)                                         | MIT AND Zlib   |
| @jsquash/avif           | 2.1.1   | Writing AVIF (libavif + libaom + libsharpyuv, WebAssembly)                                | Apache-2.0     |
| @jsquash/jxl            | 1.3.0   | Reading JPEG XL (libjxl + highway + skcms + brotli, WebAssembly)                          | Apache-2.0     |
| pdf-lib                 | 1.17.1  | Writing PDFs and making them smaller                                                      | MIT            |
| @pdf-lib/standard-fonts | 1.0.0   | Dependency of pdf-lib (font metrics)                                                      | MIT            |
| @pdf-lib/upng           | 1.0.1   | Dependency of pdf-lib (reading PNG)                                                       | MIT            |
| tslib                   | 1.14.1  | Dependency of pdf-lib                                                                     | 0BSD           |
| pdfjs-dist              | 6.3.289 | Drawing a PDF page as an image (PDF.js)                                                   | Apache-2.0     |
| xlsx                    | 0.20.3  | Reading and writing CSV and Excel files (SheetJS Community Edition, from cdn.sheetjs.com) | Apache-2.0     |

**⚑ Flag: libheif-js is not MIT/BSD/Apache.** It is the only practical HEIC decoder for a
browser extension; alternatives such as heic2any bundle the same LGPL libheif. It is
kept as a separate, unmodified, replaceable file in the extension (`vendor/libheif.mjs`),
with exact sources in `docs/decoder-source/` and the obligations described in
[docs/heic-licensing.md](docs/heic-licensing.md).

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
shipped notices file.

No GPL-only or AGPL code is used.

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
