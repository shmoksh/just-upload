import type { PDFDict, PDFDocument, PDFRef } from 'pdf-lib';
import type {
  TransformChange,
  TransformOptions,
  TransformResult,
  UploadRequirements,
} from '../models';
import { compressToTarget, QUALITY } from '../images/compress';
import { context2d, type DecodedImage } from '../images/decode';
import { outputFilename } from '../images/geometry';
import { qualityKept } from '../images/quality';
import type { Progress } from '../images/stream/types';
import { fail } from '../utils/errors';

// PDFs written and shrunk on the device with pdf-lib, which loads only when needed:
// an image becomes a one-page PDF where a site takes only PDF, and a PDF over a site's
// limit is made smaller by saving its pictures at a lower quality, keeping its text and
// its layout exactly. Pictures lose pixels only when no quality fits, as few as fit, and
// the person is asked first (see needsShrinkConsent).

type PdfLib = typeof import('pdf-lib');
let library: Promise<PdfLib> | undefined;
const pdflib = () => (library ??= import('pdf-lib'));

/** A4, in points; turned to landscape for a wide image. */
const A4 = [595.28, 841.89] as const;
const MARGIN = 28;
/** An image is placed no larger than it shows on a screen: 96 pixels to the inch. */
const POINTS_PER_PIXEL = 0.75;
/** Pictures smaller than this are not worth saving again. */
const MIN_PICTURE_BYTES = 8 * 1024;
/**
 * A PDF's pictures keep at least this share of their width: a 300 dpi scan stays at 90
 * dpi or more, where its text is still easy to read.
 */
const MIN_PICTURE_SCALE = 0.3;
/** The search sees all of a PDF's pictures as one image this wide (see shrinkPdf). */
const WHOLE = 10_000;

interface Embeddable {
  bytes: Uint8Array;
  type: 'jpeg' | 'png';
  width: number;
  height: number;
}

/**
 * One A4 page holding the image. `shown` is the size it is laid out at: the original's,
 * so a copy with fewer pixels still fills the page the same way.
 */
async function pdfOf(
  image: Embeddable,
  shown: { width: number; height: number } = image,
): Promise<Uint8Array> {
  const { PDFDocument } = await pdflib();
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const embedded =
    image.type === 'jpeg' ? await pdf.embedJpg(image.bytes) : await pdf.embedPng(image.bytes);
  const [pageWidth, pageHeight] = shown.width > shown.height ? [A4[1], A4[0]] : A4;
  const scale = Math.min(
    POINTS_PER_PIXEL,
    (pageWidth - 2 * MARGIN) / shown.width,
    (pageHeight - 2 * MARGIN) / shown.height,
  );
  const [width, height] = [shown.width * scale, shown.height * scale];
  pdf.addPage([pageWidth, pageHeight]).drawImage(embedded, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  });
  return pdf.save({ useObjectStreams: true });
}

/**
 * A JPG of the picture on white: a PDF page is white, so see-through parts look the
 * same. Drawn at `width` × `height` when the picture needs fewer pixels.
 */
async function jpegOf(
  bitmap: ImageBitmap,
  quality: number,
  width = bitmap.width,
  height = bitmap.height,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  try {
    const context = context2d(canvas);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function pngOf(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  try {
    context2d(canvas).drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
/** pdf-lib's bytes are always backed by an ArrayBuffer. */
const part = (bytes: Uint8Array) => bytes as Uint8Array<ArrayBuffer>;

function pdfResult(
  original: File,
  bytes: Uint8Array,
  details: Pick<
    TransformResult,
    | 'changes'
    | 'originalFormat'
    | 'originalWidth'
    | 'originalHeight'
    | 'finalWidth'
    | 'finalHeight'
    | 'qualityKept'
    | 'sizeLimited'
    | 'resizedToFit'
  >,
): TransformResult {
  const file = new File([part(bytes)], outputFilename(original.name, 'pdf'), {
    type: 'application/pdf',
    lastModified: original.lastModified,
  });
  return {
    ...details,
    file,
    originalSize: original.size,
    finalSize: file.size,
    finalFormat: 'pdf',
  };
}

/**
 * An image as a one-page PDF. A JPG or PNG goes in exactly as it is; anything else is
 * saved as a JPG (or a PNG, when it is see-through). Over a size limit, the picture is
 * saved as a smaller JPG, with fewer pixels only if no quality fits; the person is asked
 * if that costs pixels or visible quality.
 */
export async function imageToPdf(
  decoded: DecodedImage,
  original: File,
  requirements: UploadRequirements,
  options: Pick<TransformOptions, 'allowAnimationLoss'> = {},
): Promise<TransformResult> {
  const { bitmap, info } = decoded;
  if (info.animated && !options.allowAnimationLoss) fail('needs-animation-consent');
  const [width, height] = [bitmap.width, bitmap.height];
  const asIs =
    (info.format === 'jpeg' && (info.orientation ?? 1) === 1) ||
    (info.format === 'png' && !info.animated);
  let image: Embeddable = asIs
    ? {
        bytes: await bytesOf(original),
        type: info.format === 'png' ? 'png' : 'jpeg',
        width,
        height,
      }
    : info.transparent
      ? { bytes: await bytesOf(await pngOf(bitmap)), type: 'png', width, height }
      : { bytes: await bytesOf(await jpegOf(bitmap, QUALITY.max)), type: 'jpeg', width, height };
  let pdf: Uint8Array;
  try {
    pdf = await pdfOf(image);
  } catch {
    // pdf-lib reads 8-bit PNG and baseline JPEG; anything it cannot take is saved anew.
    image = {
      bytes: await bytesOf(await jpegOf(bitmap, QUALITY.max)),
      type: 'jpeg',
      width,
      height,
    };
    pdf = await pdfOf(image);
  }
  let quality = image.type === 'png' || asIs ? 100 : -1;
  let sizeLimited = false;
  const changes: TransformChange[] = ['converted'];
  if (info.animated) changes.push('first-frame');
  const max = requirements.maxBytes;
  if (max !== undefined && pdf.length > Math.floor(max * QUALITY.margin)) {
    const overhead = pdf.length - image.bytes.length;
    const encoded = await compressToTarget(
      {
        width,
        height,
        format: 'jpeg',
        maxBytes: Math.max(1, max - overhead),
        shrink: { minWidth: 1, minHeight: 1 },
      },
      (w, h, q) => jpegOf(bitmap, q, w, h),
    );
    image = {
      bytes: await bytesOf(encoded.blob),
      type: 'jpeg',
      width: encoded.width,
      height: encoded.height,
    };
    pdf = await pdfOf(image, { width, height });
    if (pdf.length > max) fail('target-unreachable');
    quality = await qualityKept({ source: bitmap, width, height }, encoded.blob);
    sizeLimited = encoded.quality < QUALITY.max || encoded.width < width;
    changes.push('compressed');
    if (encoded.width < width) changes.push('resized');
  }
  if (quality < 0)
    quality = await qualityKept(
      { source: bitmap, width, height },
      new Blob([part(image.bytes)], { type: 'image/jpeg' }),
    );
  return pdfResult(original, pdf, {
    changes,
    originalFormat: info.format,
    originalWidth: info.width,
    originalHeight: info.height,
    finalWidth: image.width,
    finalHeight: image.height,
    qualityKept: quality,
    sizeLimited,
    resizedToFit: image.width < width,
  });
}

interface Picture {
  ref: PDFRef;
  dict: PDFDict;
  contents: Uint8Array;
  /** 1 (grey) or 3 (colour); the saved JPG is always colour. */
  components: number;
}

/** The PDF's JPG pictures that can be saved again without changing how they look. */
function pictures(pdf: PDFDocument, lib: PdfLib): Picture[] {
  const { PDFArray, PDFName, PDFNumber, PDFRawStream } = lib;
  const found: Picture[] = [];
  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.contents.length < MIN_PICTURE_BYTES) continue;
    const { dict } = object;
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const filter = dict.lookup(PDFName.of('Filter'));
    const jpeg =
      filter === PDFName.of('DCTDecode') ||
      (filter instanceof PDFArray &&
        filter.size() === 1 &&
        filter.lookup(0) === PDFName.of('DCTDecode'));
    // A Decode array inverts or remaps values; such pictures are left as they are.
    if (!jpeg || dict.has(PDFName.of('Decode'))) continue;
    const bits = dict.lookup(PDFName.of('BitsPerComponent'));
    if (!(bits instanceof PDFNumber) || bits.asNumber() !== 8) continue;
    const space = dict.lookup(PDFName.of('ColorSpace'));
    let components = 0;
    if (space === PDFName.of('DeviceRGB')) components = 3;
    else if (space === PDFName.of('DeviceGray')) components = 1;
    else if (space instanceof PDFArray && space.lookup(0) === PDFName.of('ICCBased')) {
      const profile = space.lookup(1);
      const count = profile instanceof PDFRawStream ? profile.dict.lookup(PDFName.of('N')) : null;
      if (count instanceof PDFNumber) components = count.asNumber();
    }
    if (components !== 1 && components !== 3) continue;
    found.push({ ref, dict, contents: object.contents, components });
  }
  return found;
}

interface Resaved {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * A picture saved as a JPG at `quality`, keeping its values, at `scale` of its pixel
 * size (1 unless no quality fits and the person agrees to fewer).
 */
async function resave(picture: Picture, quality: number, scale = 1): Promise<Resaved> {
  const bitmap = await createImageBitmap(
    new Blob([part(picture.contents)], { type: 'image/jpeg' }),
    {
      colorSpaceConversion: 'none',
    },
  );
  try {
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = context2d(canvas);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    canvas.width = 0;
    canvas.height = 0;
    return { bytes: await bytesOf(blob), width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * Makes a PDF that is over a site's limit smaller. Saving it again with compact
 * structure comes first; then its JPG pictures are saved at a lower quality, all at the
 * same one, found by measuring the result. Only if no quality fits do the pictures get
 * fewer pixels, all by the same share, as little as fits; the person is asked before
 * that copy is used. Text, vector drawings, page sizes and where each picture sits are
 * never touched. A signed or password-protected PDF is left as it is, as is one with
 * nothing that can be made smaller.
 */
export async function shrinkPdf(
  original: File,
  requirements: UploadRequirements,
  progress?: Progress,
): Promise<TransformResult> {
  const max = requirements.maxBytes;
  if (max === undefined) return fail('unsupported-format');
  const bytes = await bytesOf(original);
  // A signature covers the file's exact bytes: any change would void it.
  if (new TextDecoder('latin1').decode(bytes).includes('/ByteRange'))
    return fail('unsupported-format');
  const lib = await pdflib();
  let pdf: PDFDocument;
  try {
    pdf = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    return fail(error instanceof lib.EncryptedPDFError ? 'unsupported-format' : 'damaged');
  }
  const details = {
    originalFormat: 'pdf' as const,
    originalWidth: 0,
    originalHeight: 0,
    finalWidth: 0,
    finalHeight: 0,
  };
  const compact = await pdf.save({ useObjectStreams: true });
  if (compact.length <= Math.floor(max * QUALITY.margin))
    return pdfResult(original, compact, {
      ...details,
      changes: ['compressed'],
      qualityKept: 100,
      sizeLimited: false,
      resizedToFit: false,
    });
  const found = pictures(pdf, lib);
  if (!found.length) return fail('target-unreachable');
  const steps = found.length * (QUALITY.searchSteps + QUALITY.fitSteps + 2);
  let done = 0;
  const saveAt = async (quality: number, scale: number) => {
    for (const picture of found) {
      const smaller = await resave(picture, quality, scale);
      const keep = scale === 1 && smaller.bytes.length >= picture.contents.length;
      const dict = keep ? picture.dict : picture.dict.clone(pdf.context);
      if (!keep) {
        dict.set(lib.PDFName.of('Filter'), lib.PDFName.of('DCTDecode'));
        dict.delete(lib.PDFName.of('DecodeParms'));
        if (picture.components === 1)
          dict.set(lib.PDFName.of('ColorSpace'), lib.PDFName.of('DeviceRGB'));
        // A picture is drawn to the same place on the page whatever its pixel count.
        dict.set(lib.PDFName.of('Width'), lib.PDFNumber.of(smaller.width));
        dict.set(lib.PDFName.of('Height'), lib.PDFNumber.of(smaller.height));
      }
      pdf.context.assign(
        picture.ref,
        lib.PDFRawStream.of(dict, keep ? picture.contents : smaller.bytes),
      );
      progress?.(Math.min(0.99, ++done / steps));
    }
    return new Blob([part(await pdf.save({ useObjectStreams: true }))], {
      type: 'application/pdf',
    });
  };
  // The search treats all the pictures as one image WHOLE pixels wide: a width it tries
  // is that share of each picture's own.
  const encoded = await compressToTarget(
    {
      width: WHOLE,
      height: WHOLE,
      format: 'jpeg',
      maxBytes: max,
      shrink: { minWidth: WHOLE * MIN_PICTURE_SCALE, minHeight: 1 },
    },
    (width, _height, quality) => saveAt(quality, width / WHOLE),
  );
  const scale = encoded.width / WHOLE;
  // Quality is measured on the largest picture, where any loss shows most.
  const largest = found.reduce((a, b) => (b.contents.length > a.contents.length ? b : a));
  const source = await createImageBitmap(
    new Blob([part(largest.contents)], { type: 'image/jpeg' }),
    {
      colorSpaceConversion: 'none',
    },
  );
  // Read before closing: a closed bitmap reports no size.
  const { width: pictureWidth, height: pictureHeight } = source;
  let kept: number;
  let saved: Resaved;
  try {
    saved = await resave(largest, encoded.quality, scale);
    kept = await qualityKept(
      { source, width: pictureWidth, height: pictureHeight },
      new Blob([part(saved.bytes)], { type: 'image/jpeg' }),
    );
  } finally {
    source.close();
  }
  return pdfResult(original, await bytesOf(encoded.blob), {
    ...details,
    // The largest picture's pixels stand for the PDF's in a question about fewer of them.
    originalWidth: pictureWidth,
    originalHeight: pictureHeight,
    finalWidth: saved.width,
    finalHeight: saved.height,
    changes: ['compressed'],
    qualityKept: kept,
    sizeLimited: true,
    resizedToFit: scale < 1,
  });
}
