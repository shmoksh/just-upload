# Test fixtures

Most test images are generated while the tests run: unit tests build minimal image
headers byte by byte (`tests/unit/helpers/images.ts`), and end-to-end tests draw images
on a canvas in the browser (`makeImage` in `tests/e2e/fixtures.ts`).

A browser can only write JPEG, PNG and WebP, so the other formats are committed. They
were made by encoders independent of Just Upload's own, so a test never reads back a
file written by the code under test:

| File                               | Made by                         | What it tests                                                                          |
| ---------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `portrait-3024x4032.heic` (3.1 MB) | macOS `sips`                    | iPhone-sized, grid-tiled HEIC whose JPEG exceeds 2 MB: the definition-of-done scenario |
| `everyday-3024x4032.heic`          | macOS `sips`                    | Light grain, like a typical phone photo: keeps 98% on a 2 MB field (exam-form test)    |
| `landscape-1600x1200.heic`         | macOS `sips`                    | HEIC conversion; truncated in a test to simulate a damaged file                        |
| `photo-640x480.avif`               | macOS `sips`                    | AVIF input                                                                             |
| `photo-320x240.gif`                | macOS `sips`                    | GIF input                                                                              |
| `photo-320x240.bmp`                | macOS `sips`                    | BMP input (BITMAPV5 header)                                                            |
| `photo-320x240.tif`                | macOS `sips`                    | LZW-compressed TIFF input                                                              |
| `icon-128.ico`                     | macOS `sips`                    | ICO input with transparency                                                            |
| `photo-640x480.jxl`                | libjxl (`@jsquash/jxl` encoder) | JPEG XL input                                                                          |
| `animated-160x120.gif`             | gifenc                          | Two-frame animation: asks before keeping the first frame                               |
| `logo.svg`                         | written by hand                 | SVG with a viewBox and a transparent background                                        |
| `../../public/sample/sample.heic`  | macOS `sips`                    | Shipped: a "Try it" sample on the welcome page, and the warm-up image                  |
| `../../public/sample/sample.png`   | macOS `sips`                    | Shipped: a "Try it" sample (a screenshot)                                              |
| `../../public/sample/sample.tif`   | macOS `sips`                    | Shipped: a "Try it" sample (a scanned page)                                            |
| `../../public/sample/sample.webp`  | the browser's WebP encoder      | Shipped: a "Try it" sample (a photo)                                                   |

**Source and license.** Every raster image was procedurally drawn for this project (a
gradient sky, leaf-like shapes and film grain, or flat panels and lines of text, from a
fixed random seed). They are original works of this project with no third-party content
or rights, and may be redistributed with the project.

## Documents and spreadsheets

| File                   | Made by                                        | What it tests                                     |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `scan-a4.pdf` (746 KB) | macOS `sips`, from a grainy photo saved as JPG | A scanned page over a limit, made smaller         |
| `certificate.pdf`      | written by hand (PDF syntax, Helvetica text)   | A one-page PDF drawn as an image                  |
| `three-pages.pdf`      | written by hand, like `certificate.pdf`        | Asking before using only the first page           |
| `two-sheets.xlsx`      | written by hand (the XML parts, zipped)        | Asking which sheet; a code stored as text "00123" |
| `people.csv`           | written by hand, UTF-8                         | Codes with leading zeros, an accented name        |

None was made by pdf-lib, PDF.js or SheetJS, so a test never reads back a file written
by the code under test.

## JPEG fixtures for the streaming decoder (`jpeg/`)

Eight small JPEGs (157 × 119, so partial blocks are exercised) covering baseline 4:2:0
and 4:2:2, 4:4:4 with restart markers, progressive, greyscale, Adobe CMYK, an embedded
ICC profile and EXIF orientation 6. Each `*.eighth.rgb` beside them is libjpeg's own
one-eighth-scale decode of the same file, as raw RGB, so Just Upload's DC-only decoder is
checked against an independent decoder. `manifest.json` pairs each JPEG with its
reference and that reference's size.

They were drawn from a fixed seed and written by Pillow (libjpeg, HPND license), which
was used only to make them and is never shipped. The images are original works of this
project, like the others above.
