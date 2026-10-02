import type { TransformOptions, TransformResult, UploadRequirements } from '../models';
import { allowedOutputs, formatAllowed } from '../compatibility';
import { isSheet } from '../formats';
import { decodeImage, type DecodedImage } from '../images/decode';
import type { Progress } from '../images/stream/types';
import {
  prepareDecoded,
  prepareImage,
  renderPreview,
  transformDecoded,
  transformImage,
  type PrepareOutcome,
} from '../images/transform';
import { fail } from '../utils/errors';
import { detectFile, DETECT_BYTES } from './detect';
import { imageToPdf, shrinkPdf } from './pdf';
import { prepareSheet, transformSheet } from './sheets';

// Sends each file to the part of the engine that handles it. Images keep their own path;
// a PDF page drawn by the extension's page arrives as `raster`, with the PDF's page count.

/** A drawn PDF page, as an image the rest of the engine handles like any other. */
async function decodePage(raster: Blob, bytes: number, pages = 1): Promise<DecodedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(raster);
  } catch {
    return fail('damaged');
  }
  return {
    bitmap,
    info: {
      format: 'pdf',
      width: bitmap.width,
      height: bitmap.height,
      bytes,
      transparent: false,
      animated: false,
      pages,
    },
    scale: 1,
  };
}

/** An image goes into a PDF only where the site takes a PDF and no image at all. */
const wantsPdfOfImage = (requirements: UploadRequirements) =>
  !allowedOutputs(requirements).length && formatAllowed('pdf', requirements);

async function formatOf(file: File) {
  return detectFile(
    new Uint8Array(await file.slice(0, DETECT_BYTES).arrayBuffer()),
    file.name,
    file.type,
  );
}

export async function prepareFile(
  file: File,
  requirements: UploadRequirements,
  raster?: Blob,
  pages?: number,
  progress?: Progress,
): Promise<PrepareOutcome> {
  const format = await formatOf(file);
  if (isSheet(format)) return prepareSheet(file, format, requirements);
  if (format === 'pdf') {
    if (formatAllowed('pdf', requirements)) {
      const max = requirements.maxBytes;
      if (max === undefined || file.size <= max) return { kind: 'pass' };
      return { kind: 'fixed', result: await shrinkPdf(file, requirements, progress) };
    }
    // Drawn only where the site takes images and not PDFs; anywhere else it is left alone.
    if (!raster) return { kind: 'pass' };
    const decoded = await decodePage(raster, file.size, pages);
    try {
      return await prepareDecoded(decoded, file, requirements);
    } finally {
      decoded.bitmap.close();
    }
  }
  if (format !== 'unknown' && wantsPdfOfImage(requirements)) {
    const decoded = await decodeImage(file, raster, progress, true);
    try {
      if (decoded.info.animated)
        return {
          kind: 'confirm',
          decision: {
            action: 'USER_CONFIRMATION',
            issues: ['unsupported-format'],
            outputFormat: 'pdf',
            consents: ['animation'],
          },
          info: decoded.info,
          preview: await renderPreview(decoded.bitmap, decoded.info.transparent),
        };
      return { kind: 'fixed', result: await imageToPdf(decoded, file, requirements) };
    } finally {
      decoded.bitmap.close();
    }
  }
  return prepareImage(file, requirements, raster, progress);
}

export async function transformFile(
  file: File,
  requirements: UploadRequirements,
  options: TransformOptions,
  raster?: Blob,
  pages?: number,
  progress?: Progress,
): Promise<TransformResult> {
  const format = await formatOf(file);
  if (isSheet(format)) return transformSheet(file, format, requirements, options);
  if (format === 'pdf') {
    if (options.outputFormat === 'pdf') return shrinkPdf(file, requirements, progress);
    if (!raster) return fail('unsupported-format');
    const decoded = await decodePage(raster, file.size, pages);
    try {
      return await transformDecoded(decoded, file, requirements, options);
    } finally {
      decoded.bitmap.close();
    }
  }
  if (options.outputFormat === 'pdf') {
    const decoded = await decodeImage(file, raster, progress, true);
    try {
      return await imageToPdf(decoded, file, requirements, options);
    } finally {
      decoded.bitmap.close();
    }
  }
  return transformImage(file, requirements, options, raster, progress);
}
