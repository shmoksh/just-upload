import pica from 'pica/pica_main';
import type {
  Decision,
  ImageInfo,
  TransformChange,
  TransformOptions,
  TransformResult,
  UploadRequirements,
} from '../models';
import { evaluateCompatibility, safeMinimum } from '../compatibility';
import { decide, statesPixelSize, transformOptions } from '../decision';
import { carriesDpi, isLossy, isOutputFormat, keepsTransparency, mimeOf } from '../formats';
import { fail, type ErrorCode } from '../utils/errors';
import { ICO_MAX_SIZE } from './codecs/ico';
import { compressToTarget, QUALITY } from './compress';
import { context2d, decodeImage, type DecodedImage } from './decode';
import { readDpi, withDpi } from './dpi';
import { encodeCanvas } from './encode';
import { calculateDimensions, normalizeCrop, outputFilename } from './geometry';
import { detectFormat, displaySize, parseHeader } from './headers';
import { assertDimensions } from '../security/limits';
import { qualityKept } from './quality';
import type { Progress } from './stream/types';

const PREVIEW_SIZE = 1024;
/**
 * Big reductions (more than halving) go through pica, whose filter avoids shimmer and
 * keeps detail sharp. Smaller changes, such as trimming a photo to meet a file-size
 * limit, look the same with the browser's own high-quality scaling, which is four times
 * faster.
 */
const PICA_BELOW = 0.5;

// pica's main-thread build: no blob-URL workers (blocked by the extension CSP).
// This module already runs inside a dedicated worker.
let resizer: ReturnType<typeof pica> | undefined;
function getResizer(): ReturnType<typeof pica> {
  if (!resizer) {
    resizer = pica({ features: ['js', 'wasm'], concurrency: 1 });
    // pica only falls back to OffscreenCanvas in its own worker mode; there is no
    // document here, so give it scratch canvases directly.
    resizer.createCanvas = (width: number, height: number) => new OffscreenCanvas(width, height);
  }
  return resizer;
}

/** Prepares the resizer's WebAssembly ahead of time. */
export async function warmResizer(): Promise<void> {
  await getResizer()
    .init()
    .catch(() => {});
}

function release(canvas: OffscreenCanvas | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** A small rendering the page can show, since browsers cannot display HEIC. */
export async function renderPreview(bitmap: ImageBitmap, transparent: boolean): Promise<Blob> {
  const scale = Math.min(1, PREVIEW_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  try {
    const context = context2d(canvas);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({
      type: transparent ? 'image/png' : 'image/jpeg',
      quality: 0.85,
    });
  } finally {
    release(canvas);
  }
}

export interface FileIdentity {
  name: string;
  lastModified: number;
}

/** Transforms an already-decoded image. The caller keeps ownership of `decoded.bitmap`. */
export async function transformDecoded(
  decoded: DecodedImage,
  original: FileIdentity,
  requirements: UploadRequirements,
  options: TransformOptions,
): Promise<TransformResult> {
  const { bitmap, info } = decoded;
  // Documents are written elsewhere (see documents/); this writes images.
  const outputFormat = options.outputFormat;
  if (!isOutputFormat(outputFormat)) return fail('unsupported-format');
  if (info.animated && !options.allowAnimationLoss) fail('needs-animation-consent');
  // JPEG and BMP cannot hold transparency.
  const flatten = info.transparent && !keepsTransparency(outputFormat);
  if (flatten && !options.allowTransparencyLoss) fail('needs-transparency-consent');
  // An ICO entry cannot be larger than 256 × 256; that is the format, not a choice.
  const rules: UploadRequirements =
    outputFormat === 'ico'
      ? {
          ...requirements,
          maxWidth: Math.min(requirements.maxWidth ?? ICO_MAX_SIZE, ICO_MAX_SIZE),
          maxHeight: Math.min(requirements.maxHeight ?? ICO_MAX_SIZE, ICO_MAX_SIZE),
        }
      : requirements;
  // Crops and sizes are in the image's own pixels; a very large image was decoded at a
  // smaller working size, `decoded.scale` of it.
  const crop = options.crop ? normalizeCrop(options.crop, info.width, info.height) : undefined;
  const region = crop ?? { x: 0, y: 0, width: info.width, height: info.height };
  const scale = decoded.scale;
  const source = crop
    ? await createImageBitmap(
        bitmap,
        Math.round(crop.x * scale),
        Math.round(crop.y * scale),
        Math.max(1, Math.round(crop.width * scale)),
        Math.max(1, Math.round(crop.height * scale)),
      )
    : bitmap;
  let surface: OffscreenCanvas | undefined;
  try {
    const size = calculateDimensions(region.width, region.height, rules, options.allowUpscale);
    // A working-size image cannot give more detail than it holds: without an exact size
    // to meet, the output is at most the working size, which counts as resized to fit.
    const room = Math.min(source.width / size.width, source.height / size.height);
    const target =
      scale < 1 && room < 1 && !(rules.exactWidth || rules.exactHeight)
        ? {
            width: Math.max(1, Math.floor(size.width * room)),
            height: Math.max(1, Math.floor(size.height * room)),
          }
        : size;
    assertDimensions(target.width, target.height);
    const render = async (width: number, height: number): Promise<OffscreenCanvas> => {
      if (surface?.width === width && surface.height === height) return surface;
      release(surface);
      surface = undefined;
      let canvas = new OffscreenCanvas(width, height);
      const scale = width / source.width;
      if (scale === 1 && height === source.height) context2d(canvas).drawImage(source, 0, 0);
      else if (scale < PICA_BELOW) await getResizer().resize(source, canvas, { filter: 'mks2013' });
      else {
        const context = context2d(canvas);
        context.imageSmoothingQuality = 'high';
        context.drawImage(source, 0, 0, width, height);
      }
      if (flatten) {
        // Paint white explicitly rather than let the encoder pick black.
        const flat = new OffscreenCanvas(width, height);
        const context = context2d(flat);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(canvas, 0, 0);
        release(canvas);
        canvas = flat;
      }
      surface = canvas;
      return canvas;
    };
    const mime = mimeOf(outputFormat);
    // The pixel size is settled above, by the website's own rules; a file-size limit is
    // met with quality first. Only when no quality can meet it are fewer pixels found,
    // as few fewer as fit, and then the person is asked before the file is used (see
    // needsShrinkConsent). An exact size is the website's own and never shrinks.
    const exact = Boolean(rules.exactWidth || rules.exactHeight);
    const encoded = await compressToTarget(
      {
        ...target,
        format: outputFormat,
        maxBytes: rules.maxBytes,
        minBytes: rules.minBytes,
        // Each AVIF encode takes seconds, not milliseconds.
        searchSteps: outputFormat === 'avif' ? 3 : undefined,
        ...(exact
          ? {}
          : { shrink: { minWidth: rules.minWidth ?? 1, minHeight: rules.minHeight ?? 1 } }),
      },
      async (width, height, quality) =>
        encodeCanvas(await render(width, height), outputFormat, quality),
    );

    // The DPI the site asks for goes in the file's header; the pixels are already final.
    const dpi = rules.dpi && carriesDpi(outputFormat) ? rules.dpi : undefined;
    const blob =
      dpi && carriesDpi(outputFormat)
        ? await withDpi(encoded.blob, outputFormat, dpi)
        : encoded.blob;

    const resizedToFit = encoded.width < size.width || encoded.height < size.height;
    const sizeLimited = resizedToFit || (isLossy(outputFormat) && encoded.quality < QUALITY.max);
    // A lossless file holds exactly the pixels drawn, so those are compared; a GIF's
    // palette and lossy formats are compared as the browser decodes the file.
    const lossless = !isLossy(outputFormat) && outputFormat !== 'gif';
    const quality =
      lossless && !resizedToFit
        ? 100
        : await qualityKept(
            { source, width: size.width, height: size.height },
            lossless ? await render(encoded.width, encoded.height) : encoded.blob,
          );

    const changes: TransformChange[] = [];
    if (info.format !== outputFormat) changes.push('converted');
    if (crop) changes.push('cropped');
    if (encoded.width !== region.width || encoded.height !== region.height) changes.push('resized');
    if (requirements.maxBytes !== undefined && info.bytes > requirements.maxBytes)
      changes.push('compressed');
    if (requirements.minBytes !== undefined && info.bytes < safeMinimum(requirements.minBytes))
      changes.push('raised-to-minimum');
    if (flatten) changes.push('background-added');
    if (info.animated) changes.push('first-frame');
    if ((info.pages ?? 1) > 1) changes.push('first-page');
    if ((info.orientation ?? 1) !== 1) changes.push('orientation-applied');
    if (dpi && info.dpi !== dpi) changes.push('dpi-set');
    const file = new File([blob], outputFilename(original.name, outputFormat), {
      type: mime,
      lastModified: original.lastModified,
    });
    return {
      file,
      changes,
      originalSize: info.bytes,
      finalSize: file.size,
      originalWidth: info.width,
      originalHeight: info.height,
      finalWidth: encoded.width,
      finalHeight: encoded.height,
      originalFormat: info.format,
      finalFormat: outputFormat,
      qualityKept: quality,
      resizedToFit,
      sizeLimited,
      ...(dpi ? { dpi } : {}),
    };
  } finally {
    release(surface);
    if (source !== bitmap) source.close();
  }
}

/** Decodes, transforms and releases: the one-call API for a file and a set of rules. */
export async function transformImage(
  file: File,
  requirements: UploadRequirements,
  options: TransformOptions,
  raster?: Blob,
  progress?: Progress,
): Promise<TransformResult> {
  const decoded = await decodeImage(file, raster, progress, !statesPixelSize(requirements));
  try {
    return await transformDecoded(decoded, file, requirements, options);
  } finally {
    decoded.bitmap.close();
  }
}

export type PrepareOutcome =
  | { kind: 'pass' }
  | { kind: 'fixed'; result: TransformResult }
  | { kind: 'confirm'; decision: Decision; info: ImageInfo; preview: Blob }
  | { kind: 'unsafe'; code: ErrorCode };

/**
 * Inspects and, when no one needs to be asked first, fixes in the same pass, so the
 * image is decoded once. Changes a person must choose (a crop, a white background,
 * enlarging) come back as "confirm"; a fixed file carries its quality, so the page can
 * still ask before using it.
 */
export async function prepareImage(
  file: File,
  requirements: UploadRequirements,
  raster?: Blob,
  progress?: Progress,
): Promise<PrepareOutcome> {
  const dpiOnly = await setDpiOnly(file, requirements);
  if (dpiOnly) return { kind: 'fixed', result: dpiOnly };
  const decoded = await decodeImage(file, raster, progress, !statesPixelSize(requirements));
  try {
    return await prepareDecoded(decoded, file, requirements);
  } finally {
    decoded.bitmap.close();
  }
}

/**
 * When the DPI a JPEG or PNG records is the one thing wrong, only its header changes:
 * no decoding, no new compression, every pixel as it was.
 */
async function setDpiOnly(
  file: File,
  requirements: UploadRequirements,
): Promise<TransformResult | undefined> {
  const { dpi } = requirements;
  if (!dpi) return undefined;
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const format = detectFormat(head);
  if (!carriesDpi(format)) return undefined;
  let header;
  try {
    header = file.size <= head.length ? parseHeader(head) : parseHeader(head, { partial: true });
  } catch {
    return undefined;
  }
  if (!header) return undefined;
  const { width, height } = displaySize(header);
  const info = { format, width, height, bytes: file.size, dpi: readDpi(head, format) };
  const issues = evaluateCompatibility(info, requirements);
  if (issues.length !== 1 || issues[0] !== 'wrong-dpi') return undefined;
  const blob = await withDpi(file, format, dpi);
  if (evaluateCompatibility({ ...info, bytes: blob.size, dpi }, requirements).length)
    return undefined;
  return {
    file: new File([blob], file.name, {
      type: file.type || mimeOf(format),
      lastModified: file.lastModified,
    }),
    changes: ['dpi-set'],
    originalSize: file.size,
    finalSize: blob.size,
    originalWidth: width,
    originalHeight: height,
    finalWidth: width,
    finalHeight: height,
    originalFormat: format,
    finalFormat: format,
    qualityKept: 100,
    resizedToFit: false,
    sizeLimited: false,
    dpi,
  };
}

/** The same, for an image already decoded (or a PDF page already drawn). */
export async function prepareDecoded(
  decoded: DecodedImage,
  file: File,
  requirements: UploadRequirements,
): Promise<PrepareOutcome> {
  const decision = decide(decoded.info, requirements);
  if (decision.action === 'PASS_THROUGH') return { kind: 'pass' };
  if (decision.action === 'UNSAFE_TO_FIX') {
    return {
      kind: 'unsafe',
      code: decision.issues.includes('unknown') ? 'damaged' : 'rules-conflict',
    };
  }
  if (decision.action === 'AUTO_FIX') {
    const result = await transformDecoded(decoded, file, requirements, transformOptions(decision));
    return { kind: 'fixed', result };
  }
  return {
    kind: 'confirm',
    decision,
    info: decoded.info,
    preview: await renderPreview(decoded.bitmap, decoded.info.transparent),
  };
}
