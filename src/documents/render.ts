import { fail, ProcessingError } from '../utils/errors';

// Draws one page of a PDF as a picture, for a site that takes images only. PDF.js needs
// a page to draw on, so this runs in the extension's hidden page, not in a worker, and
// it loads only when a PDF needs it. Its own worker is packaged with the extension.

type PdfJs = typeof import('pdfjs-dist');
let library: Promise<PdfJs> | undefined;
function pdfjs(): Promise<PdfJs> {
  library ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      '/vendor/pdf.worker.min.mjs',
      self.location.origin,
    ).href;
    return lib;
  });
  return library;
}

/** Pages are drawn at 200 pixels to the inch: sharp text, a few megapixels for A4. */
const DPI = 200;
/** A poster-sized page is drawn smaller, so it stays a reasonable image. */
const MAX_PIXELS = 24_000_000;
/** Beyond this, a PDF is passed on untouched. */
export const MAX_PDF_BYTES = 200 * 1024 * 1024;

/**
 * Extra data PDF.js would fetch: character maps for some Chinese, Japanese and Korean
 * fonts, standard font shapes, and decoders for rare picture formats. None is packaged
 * (they add megabytes). Standard fonts fall back to the system's; a page that needs
 * anything else could come out with missing text or pictures, so it is not converted.
 */
function packagedOnly(missing: Set<string>) {
  return class {
    async fetch({ kind }: { kind: string }): Promise<Uint8Array> {
      missing.add(kind);
      throw new Error('not packaged');
    }
  };
}

export interface RenderedPage {
  image: Blob;
  pages: number;
}

/** Draws page `index` (from 0) on white, as a PNG, at `dpi` (the site's, if it gave one). */
export async function renderPdfPage(file: Blob, index = 0, dpi = DPI): Promise<RenderedPage> {
  if (file.size > MAX_PDF_BYTES) fail('too-large-to-process');
  const lib = await pdfjs();
  const missing = new Set<string>();
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    // Not in the published types, but read by getDocument.
    BinaryDataFactory: packagedOnly(missing),
  } as Parameters<PdfJs['getDocument']>[0]);
  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch (error) {
    // A password-protected PDF cannot be opened, and is not ours to unlock.
    return fail(
      (error as { name?: string })?.name === 'PasswordException' ? 'unsupported-format' : 'damaged',
    );
  }
  const canvas = window.document.createElement('canvas');
  try {
    const pages = document.numPages;
    const page = await document.getPage(Math.min(Math.max(1, index + 1), pages));
    const base = page.getViewport({ scale: 1 });
    const dots = Math.min(600, Math.max(72, dpi));
    const scale = Math.min(dots / 72, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    // "print" draws in one go. The display mode waits for animation frames, which a
    // hidden page never gets.
    await page.render({ canvas, viewport, background: '#ffffff', intent: 'print' }).promise;
    if (missing.has('cMapUrl') || missing.has('wasmUrl')) fail('unsupported-format');
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!image) return fail('failed');
    return { image, pages };
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    return fail('damaged');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await task.destroy();
  }
}
