import type { SerializedTransform, TransformResult } from '../models';
import { errorCode } from '../utils/errors';
import { deserializeFile, serializeFile } from '../utils/files';
import { sanitizeOptions, sanitizeRequirements, type JobResponse } from './protocol';
import { heicDecoder } from './heic';
import { prepareImage, warmResizer } from './transform';
import { prepareFile, transformFile } from '../documents/route';

async function serializeResult(result: TransformResult): Promise<SerializedTransform> {
  return { ...result, file: await serializeFile(result.file) };
}

/**
 * Runs the whole pipeline once on the small sample photo that ships with the extension,
 * while the person is still choosing a file: decoders, encoders and code paths all start
 * cold, and a real photo shouldn't pay for that. Most conversions start from an iPhone
 * photo, so the rehearsal does too.
 */
async function rehearse(): Promise<void> {
  try {
    await Promise.all([heicDecoder.warm(), warmResizer()]);
    const response = await fetch(new URL('/sample/sample.heic', self.location.origin));
    const sample = new File([await response.blob()], 'sample.heic', { type: 'image/heic' });
    await prepareImage(sample, {
      acceptedMimeTypes: ['image/jpeg'],
      acceptedExtensions: [],
      maxBytes: 60_000,
      confidence: 1,
      sources: [],
    });
  } catch {
    // Only a warm-up; the real job will simply start cold.
  }
}

/** Reports reading progress for huge images, at most once per 2%. */
function progressReporter(): (fraction: number) => void {
  let last = 0;
  return (fraction) => {
    if (fraction - last < 0.02 && fraction < 1) return;
    last = fraction;
    globalThis.postMessage({ progress: Math.min(1, fraction) });
  };
}

// Workers are reused while warm, so decoders load once instead of per photo. A worker
// handles one job at a time; its page terminates it if a job is cancelled or runs too
// long, which releases everything the decoders allocated.
globalThis.onmessage = async (event: MessageEvent<Record<string, unknown>>) => {
  const message = event.data;
  if (message.kind === 'warm') {
    await rehearse();
    return;
  }
  let response: JobResponse;
  try {
    // Files arrive as themselves from the in-page frame, or as base64 from messages.
    const file =
      message.file instanceof File
        ? message.file
        : message.file instanceof Blob
          ? new File([message.file], 'image')
          : deserializeFile(message.file);
    const serialize = message.serialize !== false;
    const requirements = sanitizeRequirements(message.requirements);
    // SVG, and a PDF page for a site that takes images, arrive drawn by the extension page.
    const raster = message.raster instanceof Blob ? message.raster : undefined;
    const pages =
      typeof message.pages === 'number' && Number.isInteger(message.pages) && message.pages > 0
        ? message.pages
        : undefined;
    const progress = progressReporter();
    const asResult = (result: TransformResult) =>
      serialize ? serializeResult(result) : Promise.resolve(result);
    if (message.kind === 'prepare') {
      const outcome = await prepareFile(file, requirements, raster, pages, progress);
      let value: unknown;
      if (outcome.kind === 'fixed')
        value = { kind: 'fixed', result: await asResult(outcome.result) };
      else if (outcome.kind === 'confirm')
        value = serialize
          ? { ...outcome, preview: await serializeFile(outcome.preview, 'preview') }
          : outcome;
      else value = outcome;
      response = { ok: true, value } as JobResponse;
    } else {
      response = {
        ok: true,
        value: await asResult(
          await transformFile(
            file,
            requirements,
            sanitizeOptions(message.options),
            raster,
            pages,
            progress,
          ),
        ),
      } as JobResponse;
    }
  } catch (error) {
    // Only a code crosses this boundary: no names, text or pixels.
    response = { ok: false, error: errorCode(error) };
  }
  globalThis.postMessage(response);
};
